import { createAccountSync } from '../../utils/sync-account';
import {
    EXTENSION_VERSION,
    XBOX_COLLECTION_SYNC_BUTTON_ID,
    XBOX_COLLECTION_TIMEOUT_MS,
    XBOX_SIGNIN_URL,
    XBOX_SOURCE_ID
} from '../../utils/sync-constants';
import { XBOX_SYNC_ERROR_MESSAGES } from '../../utils/sync-error-messages';
import {
    bindSyncPaginationProgressDescription,
    callSwal,
    isElementInSyncingState,
    isSyncCanceledError,
    lockElementSyncClick,
    lookForElement,
    markSourceNewViaPageSyncWidget,
    markSourceQueuedViaPageSyncWidget,
    persistTrimmedAttribute,
    readTrimmedAttribute,
    readServerErrorCode,
    resetSourceStateViaPageSyncWidget,
    restoreSyncElementSnapshot,
    sendMessageToServer,
    sendRuntimeMessage,
    showErrorToast,
    snapshotSyncElement,
    toErrorMessage,
    unmarkAsNewViaPageSyncWidget,
    unlockElementSyncClick,
    type RuntimeMessageResponse
} from '../../utils/sync-helpers';
import type { XboxAccount, XboxCollectionPage, XboxItem, XboxPendingAuthorization } from './client';
import type { XboxBackgroundMessage } from './background';

type SyncOptions = { signal?: AbortSignal; onProgress?: (page: number) => void };
const MESSAGE_TIMEOUT_MS = 70000;

async function request<T>(message: XboxBackgroundMessage): Promise<T> {
    let response: RuntimeMessageResponse;
    try {
        response = await sendRuntimeMessage<RuntimeMessageResponse>(message, MESSAGE_TIMEOUT_MS);
    } catch (error) {
        console.warn(`[gg.deals-extension] Xbox ${message.type} failed: RUNTIME_UNAVAILABLE`);
        throw error;
    }
    if (!response?.ok) {
        const error = response?.error ?? 'Xbox sync failed';
        // Only known codes and our sanitized provider descriptions may be logged.
        // Never print arbitrary runtime errors, response bodies, IDs or credentials.
        const safe = /^XBOX_[A-Z_]+$/.test(error)
            || /^Xbox request failed \(HTTP \d{3}\)(?: \[(?:device-code|token|user-auth|xsts|collection|unknown)\])?$/.test(error)
            || /^Xbox request failed or returned an invalid response \[(?:device-code|token|user-auth|xsts|collection|unknown)\]$/.test(error)
            || error === 'Microsoft rejected the Xbox token request origin (AADSTS90023). [token]';
        const needsSignIn = message.type === 'FETCH_XBOX_ACCOUNT'
            && ['XBOX_AUTH_REQUIRED', 'XBOX_BROWSER_SESSION_REQUIRED', 'XBOX_BROWSER_SESSION_UNAVAILABLE'].includes(error);
        if (!needsSignIn) console.warn(`[gg.deals-extension] Xbox ${message.type} failed: ${safe ? error : 'UNEXPECTED_RUNTIME_ERROR'}`);
        throw new Error(error);
    }
    return response.data as T;
}

function checkCanceled(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error('Sync canceled: Xbox sync canceled');
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
    checkCanceled(signal);
    return new Promise((resolve, reject) => {
        const abort = () => {
            clearTimeout(timer);
            reject(new Error('Sync canceled: Xbox authorization canceled'));
        };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
        signal?.addEventListener('abort', abort, { once: true });
    });
}

async function acquireAccountInfo(options: SyncOptions, configuredAccountId: string): Promise<{ account: XboxAccount; requiresAuthorization: boolean }> {
    try {
        const account = await request<XboxAccount & { browserAccount?: XboxAccount | null }>({
            type: 'FETCH_XBOX_ACCOUNT', ...(configuredAccountId ? { expectedAccountId: configuredAccountId } : {})
        });
        if (account.browserAccount && account.browserAccount.accountId !== account.accountId) {
            return { account: account.browserAccount, requiresAuthorization: true };
        }
        return { account: { accountId: account.accountId, username: account.username }, requiresAuthorization: false };
    } catch (error) {
        const message = toErrorMessage(error);
        if (message.includes('XBOX_BROWSER_SESSION_REQUIRED')) {
            await requestBrowserSessionRecovery('signed-out');
            throw new Error('Sync canceled: Xbox.com sign-in required');
        }
        if (message.includes('XBOX_BROWSER_SESSION_UNAVAILABLE')) {
            // A new Microsoft grant cannot repair an unreadable Xbox.com page.
            // Keep the existing grant and stop, otherwise every retry reauthorizes.
            await requestBrowserSessionRecovery('unavailable');
            throw new Error('Sync canceled: Xbox.com session could not be verified');
        }
        if (!message.includes('XBOX_AUTH_REQUIRED')) throw error;
    }
    // Normal sync reuses the grant after checking the home page's active XUID.
    // Missing/invalid credentials or a different linked XUID require fresh
    // Microsoft authorization.
    await confirmMicrosoftSignIn(options);
    return { account: await authorizeAccount(options), requiresAuthorization: false };
}

// Microsoft's consent page names the public "Xbox" web client, not GG.deals.
async function confirmMicrosoftSignIn(options: SyncOptions): Promise<void> {
    checkCanceled(options.signal);
    if (!await callSwal({
        html: 'Sign in on the Microsoft page that opens. Microsoft will ask you to allow access for the "Xbox" app. '
            + 'Review the permissions shown by Microsoft. '
            + 'The extension uses it only to read your game collection. The sign-in is saved only in this browser, '
            + 'is never sent to GG.deals, and is removed when you disconnect Xbox sync.',
        confirmButtonText: 'Sign in to Xbox'
    })) throw new Error('Sync canceled: account not confirmed');
}

// Mirrors the login recovery of other providers. The stored grant is kept,
// so signing in to Xbox.com with the same account is enough to sync again.
async function requestBrowserSessionRecovery(reason: 'signed-out' | 'unavailable'): Promise<void> {
    if (!await callSwal({
        html: reason === 'unavailable'
            ? 'Could not verify your Xbox.com session. Open Xbox.com in this browser, make sure you are signed in with the account you want to sync, then start the sync again.'
            : 'Sign in to Xbox.com in this browser with the Xbox account you want to sync, then start the sync again.',
        confirmButtonText: 'Open Xbox.com'
    })) return;
    try {
        const response = await sendRuntimeMessage<RuntimeMessageResponse>(
            { type: 'OPEN_URL_IN_NEW_TAB', url: XBOX_SIGNIN_URL, active: true }, MESSAGE_TIMEOUT_MS);
        if (!response?.ok) console.warn('[gg.deals-extension] Failed to open Xbox.com:', response?.error);
    } catch (error) {
        console.warn('[gg.deals-extension] Failed to open Xbox.com:', error);
    }
}

async function authorizeAccount(options: SyncOptions): Promise<XboxAccount> {
    checkCanceled(options.signal);
    let pending = await request<XboxPendingAuthorization>({ type: 'START_XBOX_AUTHORIZATION' });
    const authorizationId = pending.authorizationId;
    const requestId = pending.requestId;
    try {
        while (Date.now() < pending.expiresAt) {
            await wait(Math.min(Math.max(1000, pending.retryAfter), pending.expiresAt - Date.now()), options.signal);
            checkCanceled(options.signal);
            const result = await request<XboxAccount | XboxPendingAuthorization>({ type: 'POLL_XBOX_AUTHORIZATION', authorizationId, requestId });
            if ('accountId' in result) return result;
            pending = result;
        }
        throw new Error('Xbox authorization expired. Please connect again.');
    } finally {
        // Release only this caller; other tabs may still be using the device grant.
        await request({ type: 'CANCEL_XBOX_AUTHORIZATION', authorizationId, requestId }).catch(() => undefined);
    }
}

export function readConfiguredUsernameFromElement(element: Element): string {
    return readTrimmedAttribute(element, 'data-username');
}

export function readConfiguredAccountIdFromElement(element: Element): string {
    return readTrimmedAttribute(element, 'data-account-id');
}

export async function disconnectAccount(keepPendingAuthorization = false): Promise<void> {
    await request({ type: 'DISCONNECT_XBOX', ...(keepPendingAuthorization ? { keepPendingAuthorization: true } : {}) });
}

export function getSyncErrorMessage(error: unknown): string {
    const message = toErrorMessage(error);
    if (message.includes('AADSTS90023')) {
        return XBOX_SYNC_ERROR_MESSAGES.tokenTransport;
    }
    if (message === 'XBOX_BROWSER_ACCOUNT_MISMATCH') return XBOX_SYNC_ERROR_MESSAGES.browserAccountMismatch;
    if (message === 'XBOX_INCOGNITO_UNSUPPORTED') return XBOX_SYNC_ERROR_MESSAGES.incognito;
    return XBOX_SYNC_ERROR_MESSAGES.generic;
}

function accountLabel(account: XboxAccount): string {
    return `${account.username} (ID: ${account.accountId})`.replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]!);
}

function resolveServerUrl(url: string): string {
    const target = new URL(url, window.location.href);
    if (target.origin !== window.location.origin) throw new Error('Xbox URL must belong to GG.deals');
    return target.toString();
}

async function postData(url: string, payload: unknown): Promise<void> {
    try {
        await sendMessageToServer(resolveServerUrl(url), payload as JSON);
    } catch (error) {
        const serverCode = String(readServerErrorCode(error));
        console.warn(`[gg.deals-extension] Xbox SERVER_POST failed: ${/^\d+$/.test(serverCode) ? `CODE_${serverCode}` : 'SERVER_ERROR'}`);
        throw error;
    }
}

async function acquireAccountSync(
    configuredUsername: string,
    configuredAccountId: string,
    connectUrl: string | null,
    options: SyncOptions
) {
    const { account, requiresAuthorization } = await acquireAccountInfo(options, configuredAccountId);
    checkCanceled(options.signal);
    if (!/^\d+$/.test(account.accountId) || !account.username) throw new Error('Xbox returned an invalid account');
    const accountSync = createAccountSync({
        serviceName: 'Xbox',
        account,
        accountLabel: accountLabel(account),
        configuredUsername,
        configuredAccountId,
        connectUrl,
        connectOnImport: !connectUrl,
        postData
    });
    await accountSync.confirmAccountBeforeLibraryFetch();
    // Ask before saving the account, so declining the sign-in changes nothing.
    if (requiresAuthorization) await confirmMicrosoftSignIn(options);
    checkCanceled(options.signal);
    // Persist the accepted account through the same CSRF connection flow as
    // the other providers, even if Microsoft authorization takes longer or is canceled.
    await accountSync.connectAccount();
    checkCanceled(options.signal);
    if (requiresAuthorization) {
        // The saved link is metadata only. A token for the accepted XUID is
        // still required before any collection can be fetched or imported.
        const authorizedAccount = await authorizeAccount(options);
        checkCanceled(options.signal);
        if (authorizedAccount.accountId !== account.accountId) throw new Error('XBOX_BROWSER_ACCOUNT_MISMATCH');
        if (!authorizedAccount.username) throw new Error('Xbox returned an invalid account');
        account.username = authorizedAccount.username;
    }
    return { account, accountSync };
}

export async function connectAccountByUrl(
    connectUrl: string,
    configuredUsername: string,
    configuredAccountId = '',
    options: SyncOptions = {}
): Promise<XboxAccount> {
    checkCanceled(options.signal);
    const targetUrl = resolveServerUrl(connectUrl);
    // An explicit Connect starts a fresh authorization without canceling a
    // sign-in already shared by another tab.
    await disconnectAccount(true);
    const { account } = await acquireAccountSync(configuredUsername, configuredAccountId, targetUrl, options);
    return account;
}

export async function syncCollectionByImportUrl(
    importUrl: string,
    configuredUsername: string,
    connectUrl: string | null = null,
    configuredAccountId = '',
    options: SyncOptions = {}
): Promise<XboxAccount> {
    checkCanceled(options.signal);
    const targetUrl = resolveServerUrl(importUrl);
    const { account, accountSync } = await acquireAccountSync(configuredUsername, configuredAccountId, connectUrl, options);

    const pages: { items: XboxItem[] }[] = [];
    const seen = new Set<string>();
    let continuationToken: string | undefined;
    let totalItems = 0;
    const deadline = Date.now() + XBOX_COLLECTION_TIMEOUT_MS;
    while (true) {
        checkCanceled(options.signal);
        if (Date.now() >= deadline) throw new Error('Xbox collection pagination time limit exceeded');
        const page = await request<XboxCollectionPage>({
            type: 'FETCH_XBOX_COLLECTION_PAGE',
            accountId: account.accountId,
            currentPage: pages.length + 1,
            continuationToken
        });
        if (page.accountId !== account.accountId) throw new Error('Xbox account changed during collection sync');
        if (!Array.isArray(page.items)) throw new Error('Xbox returned an invalid collection page');
        pages.push({ items: page.items });
        totalItems += page.items.length;
        options.onProgress?.(pages.length);
        if (!page.continuationToken) break;
        if (typeof page.continuationToken !== 'string' || seen.has(page.continuationToken)) {
            throw new Error('Xbox repeated or returned an invalid continuation token');
        }
        seen.add(page.continuationToken);
        continuationToken = page.continuationToken;
    }
    checkCanceled(options.signal);
    if (Date.now() >= deadline) throw new Error('Xbox collection pagination time limit exceeded');
    const payload = { version: EXTENSION_VERSION, accountId: account.accountId, username: account.username,
        complete: true, pagesCount: pages.length, totalItems, data: pages };
    await accountSync.postImportWithAccountMismatchRecovery(targetUrl, payload);
    return account;
}

function bindSyncButton(element: Element): void {
    const host = element as HTMLElement;
    if (host.dataset.ggdealsXboxBound === '1') return;
    host.dataset.ggdealsXboxBound = '1';
    const syncLinkElement = host.matches('a.sync-link') ? host : host.querySelector('a.sync-link');
    syncLinkElement?.remove();
    let activeSync: AbortController | null = null;
    host.addEventListener('click', async (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        // Scripts on the page can call click(). The stored grant needs no Microsoft
        // sign-in, so only a real user click may start a sync.
        if (!event.isTrusted) return;
        if (activeSync || isElementInSyncingState(host)) return;
        const importUrl = host.getAttribute('data-link-to-import');
        if (!importUrl) return;
        const initialState = snapshotSyncElement(host);
        activeSync = new AbortController();
        const controller = activeSync;
        const abort = () => controller.abort();
        window.addEventListener('pagehide', abort, { once: true });
        lockElementSyncClick(host);
        const stopSyncProgress = bindSyncPaginationProgressDescription(host, XBOX_SOURCE_ID);
        // Show the bar in this click handler, even while the page bridge is
        // loading or waiting to acknowledge the state change.
        host.classList.add('new');
        try {
            await markSourceNewViaPageSyncWidget(XBOX_SOURCE_ID);
            const account = await syncCollectionByImportUrl(importUrl, readConfiguredUsernameFromElement(host),
                host.getAttribute('data-connect-url'), readConfiguredAccountIdFromElement(host), {
                    signal: controller.signal
                });
            await markSourceQueuedViaPageSyncWidget(XBOX_SOURCE_ID);
            persistTrimmedAttribute(host, 'data-account-id', account.accountId);
            persistTrimmedAttribute(host, 'data-username', account.username);
        } catch (error) {
            if (isSyncCanceledError(error)) await unmarkAsNewViaPageSyncWidget(XBOX_SOURCE_ID);
            else await resetSourceStateViaPageSyncWidget(XBOX_SOURCE_ID);
            stopSyncProgress();
            restoreSyncElementSnapshot(host, initialState);
            if (!isSyncCanceledError(error)) {
                const message = toErrorMessage(error);
                if (message.includes('Extension context invalidated')) return;
                await showErrorToast(getSyncErrorMessage(error));
            }
        } finally {
            stopSyncProgress();
            activeSync = null;
            unlockElementSyncClick(host);
            window.removeEventListener('pagehide', abort);
        }
    }, { capture: true });
}

export default function XboxIntegration(buttonIds = [XBOX_COLLECTION_SYNC_BUTTON_ID]): void {
    buttonIds.forEach((buttonId) => {
        lookForElement(`#${buttonId}`).then(bindSyncButton).catch(() => undefined);
    });
}
