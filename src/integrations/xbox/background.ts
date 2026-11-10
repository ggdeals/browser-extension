import browser from 'webextension-polyfill';
import { USER_SETTINGS_URL } from '../../utils/gg-api-constants';
import { XboxCollectionClient } from './client';
import { fetchXboxBrowserAccount } from './session';

export type XboxBackgroundMessage =
    | { type: 'FETCH_XBOX_ACCOUNT'; expectedAccountId?: string }
    | { type: 'START_XBOX_AUTHORIZATION' }
    | { type: 'POLL_XBOX_AUTHORIZATION'; authorizationId: string; requestId: string }
    | { type: 'CANCEL_XBOX_AUTHORIZATION'; authorizationId: string; requestId: string }
    | { type: 'FETCH_XBOX_COLLECTION_PAGE'; accountId: string; currentPage: number; continuationToken?: string }
    | { type: 'DISCONNECT_XBOX'; keepPendingAuthorization?: boolean };

const client = new XboxCollectionClient();
let pending: Promise<unknown> = Promise.resolve();
// The Microsoft tab of the pending device code. Lost on a worker restart,
// which only means a new tab is opened.
let verificationTab: { tabId: number; authorizationId: string } | null = null;
const types = new Set(['FETCH_XBOX_ACCOUNT', 'START_XBOX_AUTHORIZATION', 'POLL_XBOX_AUTHORIZATION',
    'CANCEL_XBOX_AUTHORIZATION', 'FETCH_XBOX_COLLECTION_PAGE', 'DISCONNECT_XBOX']);

export function isXboxMessage(message: { type?: string }): message is XboxBackgroundMessage {
    return types.has(message.type ?? '');
}

async function focusVerificationTab(authorizationId: string): Promise<boolean> {
    if (!verificationTab || verificationTab.authorizationId !== authorizationId) return false;
    try {
        const tab = await browser.tabs.get(verificationTab.tabId);
        // Reuse it only while it still shows Microsoft sign-in, not after the user navigated away.
        const url = new URL(tab.pendingUrl || tab.url || 'about:blank');
        const hostname = url.hostname;
        if (url.protocol !== 'https:' || !/(^|\.)(microsoft|live|microsoftonline)\.com$/.test(hostname)) {
            throw new Error('Tab navigated away');
        }
        await browser.tabs.update(verificationTab.tabId, { active: true });
        if (typeof tab.windowId === 'number') {
            await browser.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
        }
        return true;
    } catch {
        // Closed or navigated away: open a new tab instead.
        verificationTab = null;
        return false;
    }
}

export function handleXboxMessage(
    message: XboxBackgroundMessage,
    senderUrl?: string,
    onProgress?: (currentPage: number, totalPages: number | null) => void,
    incognito = false
) {
    // In Chrome's spanning mode the normal profile owns this worker and grant.
    if (incognito) return Promise.resolve({ ok: false, error: 'XBOX_INCOGNITO_UNSUPPORTED' });
    // Other store content scripts must not be able to use the Xbox grant.
    try {
        if (!senderUrl || new URL(senderUrl).origin !== new URL(USER_SETTINGS_URL).origin) {
            return Promise.resolve({ ok: false, error: 'Xbox sync is only available on GG.deals' });
        }
    } catch { return Promise.resolve({ ok: false, error: 'Invalid Xbox sync sender' }); }

    // Serialize refreshes and disconnects; two tabs must not race rotated tokens.
    const result = pending.then(async () => {
        try {
            switch (message.type) {
                case 'FETCH_XBOX_ACCOUNT': {
                    if (message.expectedAccountId !== undefined
                        && (typeof message.expectedAccountId !== 'string' || !/^\d+$/.test(message.expectedAccountId))) {
                        throw new Error('Invalid expected Xbox account ID');
                    }
                    // Wait for any token refresh before releasing the credential queue.
                    const [account, browserAccount] = await Promise.allSettled([client.getAccount(), fetchXboxBrowserAccount()]);
                    if (account.status === 'rejected') throw account.reason;
                    // The home session exposes an explicit sign-in flag and the
                    // active XUID. Do not silently reuse a grant when that identity
                    // cannot be verified; the content script can request fresh auth.
                    if (browserAccount.status === 'rejected') throw new Error('XBOX_BROWSER_SESSION_UNAVAILABLE');
                    if (browserAccount.value === null) {
                        throw new Error('XBOX_BROWSER_SESSION_REQUIRED');
                    }
                    // A different GG.deals link cannot reuse the previous user's
                    // grant after a page consent alone, even if Xbox.com stayed signed in.
                    if (message.expectedAccountId && message.expectedAccountId !== account.value.accountId) {
                        throw new Error('XBOX_AUTH_REQUIRED');
                    }
                    return { ok: true, data: { ...account.value, browserAccount: browserAccount.value } };
                }
                case 'START_XBOX_AUTHORIZATION': {
                    const data = await client.startAuthorization();
                    try {
                        // Another GG.deals tab may join a pending device code; show its tab again.
                        if (!await focusVerificationTab(data.authorizationId)) {
                            const tab = await browser.tabs.create({ url: data.verificationUrl, active: true });
                            verificationTab = typeof tab?.id === 'number'
                                ? { tabId: tab.id, authorizationId: data.authorizationId }
                                : null;
                        }
                    } catch (error) {
                        // The caller never received its subscription, so it cannot
                        // release it in the content script's finally block.
                        await client.cancelAuthorization(data.authorizationId, data.requestId);
                        throw error;
                    }
                    return { ok: true, data };
                }
                case 'POLL_XBOX_AUTHORIZATION':
                    return { ok: true, data: await client.pollAuthorization(message.authorizationId, message.requestId) };
                case 'CANCEL_XBOX_AUTHORIZATION':
                    await client.cancelAuthorization(message.authorizationId, message.requestId);
                    return { ok: true };
                case 'FETCH_XBOX_COLLECTION_PAGE': {
                    if (!Number.isSafeInteger(message.currentPage) || message.currentPage < 1) {
                        throw new Error('Invalid Xbox collection page number');
                    }
                    const data = await client.fetchCollectionPage(message.accountId, message.continuationToken);
                    onProgress?.(message.currentPage, data.continuationToken ? null : message.currentPage);
                    return { ok: true, data };
                }
                case 'DISCONNECT_XBOX':
                    await client.disconnect(message.keepPendingAuthorization);
                    if (!message.keepPendingAuthorization) verificationTab = null;
                    return { ok: true };
            }
        } catch (error) {
            // Client errors are deliberately sanitized; never return provider bodies.
            return { ok: false, error: error instanceof Error ? error.message : 'Xbox sync failed' };
        }
    });
    pending = result.catch(() => undefined);
    return result;
}
