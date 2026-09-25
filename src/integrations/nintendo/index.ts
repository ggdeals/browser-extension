import {
    EXTENSION_VERSION,
    NINTENDO_SOURCE_ID,
    NINTENDO_SIGNIN_URL,
    NINTENDO_WISHLIST_SYNC_BUTTON_ID,
    NINTENDO_COLLECTION_SYNC_BUTTON_ID
} from '../../utils/sync-constants';
import { NINTENDO_SYNC_ERROR_MESSAGES } from '../../utils/sync-error-messages';
import {
    callSwal,
    bindSyncPaginationProgressDescription,
    isElementInSyncingState,
    isSyncCanceledError,
    lockElementSyncClick,
    lookForElement,
    markSourceNewViaPageSyncWidget,
    markSourceQueuedViaPageSyncWidget,
    persistTrimmedAttribute,
    readTrimmedAttribute,
    resetSourceStateViaPageSyncWidget,
    restoreSyncElementSnapshot,
    requestUserIdConsentViaPageSwal,
    sendMessageToServer,
    sendRuntimeMessage,
    snapshotSyncElement,
    toErrorMessage,
    unmarkAsNewViaPageSyncWidget,
    unlockElementSyncClick,
    showErrorToast,
    showWarningToast,
    type RuntimeMessageResponse
} from '../../utils/sync-helpers';

type NintendoAccountPayload = {
    accountId?: string | null;
    username?: string | null;
};

// Nintendo NextAuth session does not expose any username; accounts are identified by accountId (naId) only
type NintendoAccount = {
    accountId: string;
    username: string;
};

function formatNintendoAccountLabel(account: NintendoAccount): string {
    return account.username
        ? `${account.username} (ID: ${account.accountId})`
        : `Nintendo Account (ID: ${account.accountId})`;
}

type NintendoCollectionPayload = NintendoAccountPayload & {
    items?: unknown[];
};

// Full Nintendo GraphQL wishlist item objects, kept 1:1 as returned by the InfiniteScrollWishlist query
type NintendoWishlistPayload = NintendoAccountPayload & {
    items?: unknown[];
};

type SyncTarget = 'collection' | 'wishlist';

const MESSAGE_TIMEOUT_MS = 180000;

function isNintendoEmptyDataError(error: unknown): boolean {
    const errorMessage = toErrorMessage(error);
    return errorMessage.includes('Nintendo wishlist data payload is missing in response')
        || errorMessage.includes('Nintendo wishlist is empty')
        || errorMessage.includes('Nintendo collection is empty');
}

function isNintendoAccountMismatchError(error: unknown): boolean {
    return toErrorMessage(error).includes('Invalid accountId:');
}

function isNintendoManualRefreshRequiredError(error: unknown): boolean {
    return toErrorMessage(error).includes('NINTENDO_WISHLIST_MANUAL_REFRESH_REQUIRED');
}

export function readConfiguredUsernameFromElement(element: Element): string {
    return readTrimmedAttribute(element, 'data-username');
}

export function readConfiguredAccountIdFromElement(element: Element): string {
    return readTrimmedAttribute(element, 'data-account-id');
}

function persistAccountOnSyncElements(account: NintendoAccount): void {
    [
        NINTENDO_COLLECTION_SYNC_BUTTON_ID,
        NINTENDO_WISHLIST_SYNC_BUTTON_ID
    ].forEach((buttonId) => {
        const element = document.getElementById(buttonId);
        if (!element) {
            return;
        }

        persistTrimmedAttribute(element, 'data-account-id', account.accountId);
        if (account.username) {
            persistTrimmedAttribute(element, 'data-username', account.username);
        }
    });
}

function isExtensionContextInvalidatedError(error: unknown): boolean {
    return toErrorMessage(error).includes('Extension context invalidated');
}

function isFetchNetworkError(error: unknown): boolean {
    const errorMessage = toErrorMessage(error);
    return errorMessage.includes('Failed to fetch')
        || errorMessage.includes('NetworkError when attempting to fetch resource');
}

export function isAuthRequiredError(error: unknown): boolean {
    const errorMessage = toErrorMessage(error);
    return isFetchNetworkError(error)
        || errorMessage.includes('NINTENDO_AUTH_REQUIRED');
}

export async function openLoginInBackgroundTab(): Promise<boolean> {
    try {
        const response = await sendRuntimeMessage<RuntimeMessageResponse>({
            type: 'OPEN_URL_IN_NEW_TAB',
            url: NINTENDO_SIGNIN_URL,
            active: false
        }, MESSAGE_TIMEOUT_MS);

        if (response?.ok) {
            return true;
        }

        console.warn('[gg.deals-extension] Failed to open Nintendo login in background tab:', response?.error);
    } catch (error) {
        console.warn('[gg.deals-extension] Failed to open Nintendo login in background tab:', error);
    }

    return false;
}

export async function requestAuthRecovery(): Promise<boolean> {
    const isConfirmed = await callSwal({
        html: 'Account not connected or session expired. Log in on Nintendo Account to enable Nintendo sync.',
        confirmButtonText: 'Open Nintendo'
    });

    if (!isConfirmed) {
        return false;
    }

    return openLoginInBackgroundTab();
}

async function postImportDataWithFallback(url: string, payload: unknown): Promise<void> {
    try {
        await sendMessageToServer(url, payload as JSON);
        return;
    } catch (error) {
        if (!isFetchNetworkError(error)) {
            throw error;
        }

        console.warn('[gg.deals-extension] Nintendo direct POST failed, retrying via background POST_IMPORT_DATA');
        const fallbackResponse = await sendRuntimeMessage<RuntimeMessageResponse>({
            type: 'POST_IMPORT_DATA',
            url,
            payload
        }, MESSAGE_TIMEOUT_MS);

        if (!fallbackResponse?.ok) {
            throw new Error(fallbackResponse?.error ?? 'Unknown error while posting Nintendo data via background');
        }
    }
}

async function ensureSyncConsent(accountLabel: string): Promise<void> {
    const isAccepted = await requestUserIdConsentViaPageSwal('Nintendo', accountLabel);
    if (!isAccepted) {
        throw new Error('Sync canceled: account not confirmed');
    }
}

async function postImportWithAccountMismatchRecovery(
    importUrl: string,
    importPayload: unknown,
    configuredAccountId: string,
    configuredUsername: string,
    didConnectAccount: boolean,
    accountLabel: string,
    connectUrl: string | null,
    accountId: string,
    username: string
): Promise<void> {
    try {
        await postImportDataWithFallback(importUrl, importPayload);
    } catch (error) {
        if (didConnectAccount || (!configuredAccountId && !configuredUsername) || !isNintendoAccountMismatchError(error)) {
            throw error;
        }

        await ensureSyncConsent(accountLabel);

        if (!connectUrl) {
            throw new Error('Missing connect URL');
        }

        await postImportDataWithFallback(connectUrl, {
            version: EXTENSION_VERSION,
            accountId,
            username,
            overwrite: true
        });
        await postImportDataWithFallback(importUrl, importPayload);
    }
}

async function fetchAccountData(): Promise<NintendoAccountPayload> {
    const response = await sendRuntimeMessage<RuntimeMessageResponse>({
        type: 'FETCH_NINTENDO_ACCOUNT'
    }, MESSAGE_TIMEOUT_MS);

    if (!response?.ok) {
        throw new Error(response?.error ?? 'Unknown error while fetching Nintendo account data');
    }

    console.log('[gg.deals-extension] Received response for Nintendo account data:', response);
    const accountData = (response.data as NintendoAccountPayload | undefined) ?? {};
    console.log('[gg.deals-extension] Nintendo account data:', accountData);
    return accountData;
}

async function fetchWishlistData(): Promise<NintendoWishlistPayload> {
    const response = await sendRuntimeMessage<RuntimeMessageResponse>({
        type: 'FETCH_NINTENDO_WISHLIST'
    }, MESSAGE_TIMEOUT_MS);

    if (!response?.ok) {
        throw new Error(response?.error ?? 'Unknown error while fetching Nintendo wishlist data');
    }

    console.log('[gg.deals-extension] Received response for Nintendo wishlist data:', response);
    const wishlistData = (response.data as NintendoWishlistPayload | undefined) ?? {};
    console.log('[gg.deals-extension] Nintendo wishlist data:', wishlistData);
    return wishlistData;
}

async function fetchCollectionData(): Promise<NintendoCollectionPayload> {
    const response = await sendRuntimeMessage<RuntimeMessageResponse>({
        type: 'FETCH_NINTENDO_COLLECTION'
    }, MESSAGE_TIMEOUT_MS);

    if (!response?.ok) {
        throw new Error(response?.error ?? 'Unknown error while fetching Nintendo collection data');
    }

    console.log('[gg.deals-extension] Received response for Nintendo collection data:', response);
    const collectionData = (response.data as NintendoCollectionPayload | undefined) ?? {};
    console.log('[gg.deals-extension] Nintendo collection data:', collectionData);
    return collectionData;
}

async function acquireAccountInfo(configuredUsername: string): Promise<NintendoAccount> {
    console.log('[gg.deals-extension] Fetching Nintendo account data before library data');
    const accountData = await fetchAccountData();
    const accountId = typeof accountData.accountId === 'string' ? accountData.accountId.trim() : '';
    const username = typeof accountData.username === 'string' ? accountData.username.trim() : '';
    const resolvedUsername = username || configuredUsername;

    if (!accountId) {
        throw new Error('Nintendo account ID is missing in account response');
    }

    return { accountId, username: resolvedUsername };
}

async function connectAccountBeforeLibraryFetch(
    account: NintendoAccount,
    configuredAccountId: string,
    configuredUsername: string,
    connectUrl: string | null
): Promise<boolean> {
    const hasAccountMismatch = Boolean(configuredAccountId && configuredAccountId !== account.accountId);
    const hasMatchingLegacyUsername = !configuredAccountId
        && Boolean(configuredUsername)
        && configuredUsername === account.username;
    if (!hasAccountMismatch && (configuredAccountId || hasMatchingLegacyUsername)) {
        return false;
    }

    await ensureSyncConsent(formatNintendoAccountLabel(account));

    if (!connectUrl) {
        throw new Error('Missing connect URL');
    }

    await postImportDataWithFallback(connectUrl, {
        version: EXTENSION_VERSION,
        accountId: account.accountId,
        username: account.username,
        ...(hasAccountMismatch ? { overwrite: true } : {})
    });

    return true;
}

export async function syncCollectionByImportUrl(
    importUrl: string,
    configuredUsername: string,
    connectUrl: string | null = null,
    configuredAccountId = ''
): Promise<NintendoAccount> {
    const collectionData = await fetchCollectionData();
    const accountId = typeof collectionData.accountId === 'string' ? collectionData.accountId.trim() : '';
    const collectionUsername = typeof collectionData.username === 'string' ? collectionData.username.trim() : '';
    if (!accountId) {
        throw new Error('Nintendo collection account ID is missing in response');
    }

    const account: NintendoAccount = {
        accountId,
        username: collectionUsername || configuredUsername
    };
    const didConnectAccount = await connectAccountBeforeLibraryFetch(
        account,
        configuredAccountId,
        configuredUsername,
        connectUrl
    );

    const games = Array.isArray(collectionData.items) ? collectionData.items : [];
    if (games.length === 0) {
        throw new Error('Nintendo collection is empty');
    }

    const targetUrl = new URL(importUrl, window.location.origin).toString();
    const importPayload = {
        version: EXTENSION_VERSION,
        accountId: account.accountId,
        username: account.username,
        data: [
            {
                games
            }
        ]
    };
    await postImportWithAccountMismatchRecovery(
        targetUrl,
        importPayload,
        configuredAccountId,
        configuredUsername,
        didConnectAccount,
        formatNintendoAccountLabel(account),
        connectUrl,
        account.accountId,
        account.username
    );
    console.log('[gg.deals-extension] Nintendo collection data sent to server successfully');
    return account;
}

export async function syncWishlistByImportUrl(
    importUrl: string,
    configuredUsername: string,
    connectUrl: string | null = null,
    configuredAccountId = ''
): Promise<NintendoAccount> {
    const account = await acquireAccountInfo(configuredUsername);
    const didConnectAccount = await connectAccountBeforeLibraryFetch(
        account,
        configuredAccountId,
        configuredUsername,
        connectUrl
    );

    const wishlistData = await fetchWishlistData();
    const accountId = typeof wishlistData.accountId === 'string' ? wishlistData.accountId.trim() : '';
    const username = typeof wishlistData.username === 'string' ? wishlistData.username.trim() : '';

    if (accountId && accountId !== account.accountId) {
        throw new Error('Nintendo account changed during wishlist sync');
    }

    if (username && username !== account.username) {
        throw new Error('Nintendo username changed during wishlist sync');
    }

    // Nintendo wishlist items are full GraphQL item objects fetched by the background handler
    const data = wishlistData.items;
    if (typeof data === 'undefined' || data === null) {
        throw new Error('Nintendo wishlist data payload is missing in response');
    }
    if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Nintendo wishlist is empty');
    }

    const targetUrl = new URL(importUrl, window.location.origin).toString();
    const importPayload = {
        version: EXTENSION_VERSION,
        accountId: account.accountId,
        username: account.username,
        data
    };
    await postImportWithAccountMismatchRecovery(
        targetUrl,
        importPayload,
        configuredAccountId,
        configuredUsername,
        didConnectAccount,
        formatNintendoAccountLabel(account),
        connectUrl,
        account.accountId,
        account.username
    );
    console.log('[gg.deals-extension] Nintendo wishlist data sent to server successfully');
    return account;
}

function bindSyncButton(element: Element): void {
    console.log('[gg.deals-extension] Nintendo sync button exists:', element.id || '(no id)');
    const importUrl: string | null = element.getAttribute('data-link-to-import');
    const connectUrl: string | null = element.getAttribute('data-connect-url');
    const syncTarget: SyncTarget = element.id === NINTENDO_COLLECTION_SYNC_BUTTON_ID ? 'collection' : 'wishlist';
    let configuredUsername = readConfiguredUsernameFromElement(element);
    let configuredAccountId = readConfiguredAccountIdFromElement(element);
    console.log('[gg.deals-extension] Nintendo linkToImport from container:', importUrl);
    console.log('[gg.deals-extension] Nintendo connectUrl from container:', connectUrl);
    console.log('[gg.deals-extension] Nintendo configured accountId:', configuredAccountId || '<missing>');

    const syncLinkElement: Element | null =
        element.matches('a.sync-link') ? element : element.querySelector('a.sync-link');

    if (syncLinkElement) {
        syncLinkElement.remove();
        console.log('[gg.deals-extension] Nintendo sync-link element removed from button');
    } else {
        console.log('[gg.deals-extension] Nintendo no .sync-link found inside button');
    }

    element.addEventListener('click', async (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (isElementInSyncingState(element)) {
            console.log('[gg.deals-extension] Nintendo tile is syncing, click ignored');
            return;
        }

        const initialState = snapshotSyncElement(element);
        lockElementSyncClick(element);
        const stopSyncProgress = bindSyncPaginationProgressDescription(element, NINTENDO_SOURCE_ID);
        console.log('[gg.deals-extension] Nintendo sync button clicked ...');
        configuredUsername = readConfiguredUsernameFromElement(element);
        configuredAccountId = readConfiguredAccountIdFromElement(element);
        await markSourceNewViaPageSyncWidget(NINTENDO_SOURCE_ID);

        try {
            if (syncTarget === 'collection') {
                if (!importUrl) {
                    console.warn('[gg.deals-extension] Missing import URL for Nintendo collection sync');
                    await resetSourceStateViaPageSyncWidget(NINTENDO_SOURCE_ID);
                    stopSyncProgress();
                    restoreSyncElementSnapshot(element, initialState);
                    unlockElementSyncClick(element);
                    return;
                }

                const syncedAccount = await syncCollectionByImportUrl(
                    importUrl,
                    configuredUsername,
                    connectUrl,
                    configuredAccountId
                );
                await markSourceQueuedViaPageSyncWidget(NINTENDO_SOURCE_ID);
                persistAccountOnSyncElements(syncedAccount);
                configuredUsername = syncedAccount.username;
                configuredAccountId = syncedAccount.accountId;
                stopSyncProgress();
                unlockElementSyncClick(element);
                return;
            }

            if (!importUrl) {
                console.warn('[gg.deals-extension] Missing import URL for Nintendo wishlist sync');
                await resetSourceStateViaPageSyncWidget(NINTENDO_SOURCE_ID);
                stopSyncProgress();
                restoreSyncElementSnapshot(element, initialState);
                unlockElementSyncClick(element);
                return;
            }

            const syncedAccount = await syncWishlistByImportUrl(
                importUrl,
                configuredUsername,
                connectUrl,
                configuredAccountId
            );
            await markSourceQueuedViaPageSyncWidget(NINTENDO_SOURCE_ID);
            persistAccountOnSyncElements(syncedAccount);
            configuredUsername = syncedAccount.username;
            configuredAccountId = syncedAccount.accountId;
            stopSyncProgress();
            unlockElementSyncClick(element);
        } catch (error) {
            if (isSyncCanceledError(error)) {
                await unmarkAsNewViaPageSyncWidget(NINTENDO_SOURCE_ID);
                stopSyncProgress();
                restoreSyncElementSnapshot(element, initialState);
                unlockElementSyncClick(element);
                return;
            }

            console.log('[gg.deals-extension] Error during Nintendo sync:', error);
            await resetSourceStateViaPageSyncWidget(NINTENDO_SOURCE_ID);
            stopSyncProgress();
            restoreSyncElementSnapshot(element, initialState);
            unlockElementSyncClick(element);
            if (isExtensionContextInvalidatedError(error)) {
                console.warn('[gg.deals-extension] Extension updated. Reload page and try again.');
                return;
            }

            if (syncTarget !== 'collection' && isNintendoManualRefreshRequiredError(error)) {
                await showWarningToast(NINTENDO_SYNC_ERROR_MESSAGES.manualRefreshRequired);
                return;
            }

            if (syncTarget !== 'collection' && isAuthRequiredError(error)) {
                console.warn('[gg.deals-extension] Nintendo wishlist session refresh failed.');
                return;
            }

            if (isNintendoEmptyDataError(error)) {
                const emptyDataMessage = syncTarget === 'collection'
                    ? NINTENDO_SYNC_ERROR_MESSAGES.emptyCollection
                    : NINTENDO_SYNC_ERROR_MESSAGES.emptyWishlist;
                await showWarningToast(emptyDataMessage);
                return;
            }

            console.error('[gg.deals-extension] Nintendo connecting failed:', error);
            await showErrorToast(NINTENDO_SYNC_ERROR_MESSAGES.generic);
        }
    }, { capture: true });
}

export default function NintendoIntegration(buttonIds?: string[]): void {
    const syncButtonIds = buttonIds ?? [
        NINTENDO_WISHLIST_SYNC_BUTTON_ID,
        NINTENDO_COLLECTION_SYNC_BUTTON_ID
    ];

    syncButtonIds.forEach((buttonId) => {
        lookForElement(`#${buttonId}`).then((element: Element) => {
            bindSyncButton(element);
        }).catch((error: unknown) => {
            console.warn(`[gg.deals-extension] Nintendo sync button not found: #${buttonId}`, error);
        });
    });
}
