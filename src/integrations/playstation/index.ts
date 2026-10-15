import { createAccountSync } from '../../utils/sync-account';
import {
    EXTENSION_VERSION,
    PLAYSTATION_SOURCE_ID,
    PLAYSTATION_SIGNIN_URL,
    PLAYSTATION_WISHLIST_SYNC_BUTTON_ID,
    PLAYSTATION_WISHLIST_URL,
    PLAYSTATION_COLLECTION_URL,
    PLAYSTATION_COLLECTION_SYNC_BUTTON_ID
} from '../../utils/sync-constants';
import { PLAYSTATION_SYNC_ERROR_MESSAGES } from '../../utils/sync-error-messages';
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

type PlayStationWishlistPayload = {
    apolloState?: unknown;
    accountId?: string | null;
    onlineId?: string | null;
};

type PlayStationAccountPayload = {
    accountId?: string | null;
    onlineId?: string | null;
};

type PlayStationAccount = {
    accountId: string;
    username: string;
};

type PlayStationCollectionPayload = {
    accountId?: string | null;
    onlineId?: string | null;
    games?: unknown[];
    pageInfo?: {
        isLast?: boolean;
        size?: number;
        totalCount?: number;
        offset?: number;
    } | null;
};

type SyncTarget = 'collection' | 'wishlist';

const MESSAGE_TIMEOUT_MS = 180000;

function isPlayStationEmptyDataError(error: unknown): boolean {
    const errorMessage = toErrorMessage(error);
    return errorMessage.includes('PlayStation wishlist data payload is missing in response')
        || errorMessage.includes('PlayStation wishlist is empty')
        || errorMessage.includes('PlayStation collection is empty');
}

function isEmptyObject(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    return Object.keys(value as Record<string, unknown>).length === 0;
}

function isPlayStationWishlistEmpty(data: unknown): boolean {
    if (Array.isArray(data)) {
        return data.length === 0;
    }

    if (isEmptyObject(data)) {
        return true;
    }

    if (!data || typeof data !== 'object') {
        return false;
    }

    const rootQuery = (data as { ROOT_QUERY?: unknown }).ROOT_QUERY;
    if (!rootQuery || typeof rootQuery !== 'object' || Array.isArray(rootQuery)) {
        return false;
    }

    const wishlistEntries = Object.entries(rootQuery as Record<string, unknown>)
        .filter(([key]) => key === 'storeWishlistSecure' || key.startsWith('storeWishlistSecure('))
        .map(([, value]) => value);

    return wishlistEntries.length > 0
        && wishlistEntries.every((entry) => Array.isArray(entry) && entry.length === 0);
}

export function readConfiguredUsernameFromElement(element: Element): string {
    return readTrimmedAttribute(element, 'data-username');
}

export function readConfiguredAccountIdFromElement(element: Element): string {
    return readTrimmedAttribute(element, 'data-account-id');
}

function persistAccountOnSyncElements(account: PlayStationAccount): void {
    [
        PLAYSTATION_COLLECTION_SYNC_BUTTON_ID,
        PLAYSTATION_WISHLIST_SYNC_BUTTON_ID
    ].forEach((buttonId) => {
        const element = document.getElementById(buttonId);
        if (!element) {
            return;
        }

        persistTrimmedAttribute(element, 'data-username', account.username);
        persistTrimmedAttribute(element, 'data-account-id', account.accountId);
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
        || errorMessage.includes('PLAYSTATION_AUTH_REQUIRED')
        || errorMessage.includes('script#__NEXT_DATA__ not found');
}

export async function openLoginInBackgroundTab(): Promise<boolean> {
    try {
        const response = await sendRuntimeMessage<RuntimeMessageResponse>({
            type: 'OPEN_URL_IN_NEW_TAB',
            url: PLAYSTATION_SIGNIN_URL,
            active: false
        }, MESSAGE_TIMEOUT_MS);

        if (response?.ok) {
            return true;
        }

        console.warn('[gg.deals-extension] Failed to open PlayStation login in background tab:', response?.error);
    } catch (error) {
        console.warn('[gg.deals-extension] Failed to open PlayStation login in background tab:', error);
    }

    return false;
}

export async function requestAuthRecovery(): Promise<boolean> {
    const isConfirmed = await callSwal({
        html: 'Account not connected or session expired. Log in on PlayStation Store to enable PSN sync.',
        confirmButtonText: 'Open PS Store'
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

        console.warn('[gg.deals-extension] PlayStation direct POST failed, retrying via background POST_IMPORT_DATA');
        const fallbackResponse = await sendRuntimeMessage<RuntimeMessageResponse>({
            type: 'POST_IMPORT_DATA',
            url,
            payload
        }, MESSAGE_TIMEOUT_MS);

        if (!fallbackResponse?.ok) {
            throw new Error(fallbackResponse?.error ?? 'Unknown error while posting PlayStation data via background');
        }
    }
}

async function fetchWishlistData(wishlistUrl = PLAYSTATION_WISHLIST_URL): Promise<PlayStationWishlistPayload> {
    const response = await sendRuntimeMessage<RuntimeMessageResponse>({
        type: 'FETCH_PLAYSTATION_WISHLIST',
        url: wishlistUrl
    }, MESSAGE_TIMEOUT_MS);

    if (!response?.ok) {
        throw new Error(response?.error ?? 'Unknown error while fetching PlayStation wishlist data');
    }

    console.log('[gg.deals-extension] Received response for PlayStation wishlist data:', response);
    const wishlistData = (response.data as PlayStationWishlistPayload | undefined) ?? {};
    console.log('[gg.deals-extension] PlayStation wishlist data:', wishlistData);
    return wishlistData;
}

async function fetchCollectionData(collectionUrl = PLAYSTATION_COLLECTION_URL): Promise<PlayStationCollectionPayload> {
    console.log('[gg.deals-extension] Fetching PlayStation collection data from background with URL:', collectionUrl);
    const response = await sendRuntimeMessage<RuntimeMessageResponse>({
        type: 'FETCH_PLAYSTATION_COLLECTION',
        url: collectionUrl
    }, MESSAGE_TIMEOUT_MS);

    if (!response?.ok) {
        throw new Error(response?.error ?? 'Unknown error while fetching PlayStation collection data');
    }
    console.log('[gg.deals-extension] Received response for PlayStation collection data:', response);
    const collectionData = (response.data as PlayStationCollectionPayload | undefined) ?? {};
    console.log('[gg.deals-extension] PlayStation collection data:', collectionData);
    return collectionData;
}

async function acquireAccountInfo(
    accountUrl: string,
    configuredUsername: string
): Promise<PlayStationAccount> {
    console.log('[gg.deals-extension] Fetching PlayStation account data before library data');
    const response = await sendRuntimeMessage<RuntimeMessageResponse>({
        type: 'FETCH_PLAYSTATION_ACCOUNT',
        url: accountUrl
    }, MESSAGE_TIMEOUT_MS);

    if (!response?.ok) {
        throw new Error(response?.error ?? 'Unknown error while fetching PlayStation account data');
    }

    const accountData = (response.data as PlayStationAccountPayload | undefined) ?? {};
    const accountId = typeof accountData.accountId === 'string' ? accountData.accountId.trim() : '';
    const onlineId = typeof accountData.onlineId === 'string' ? accountData.onlineId.trim() : '';
    const username = onlineId || configuredUsername;

    if (!accountId) {
        throw new Error('PlayStation account ID is missing in account response');
    }

    if (!username) {
        throw new Error('PlayStation username is missing in account response');
    }

    return { accountId, username };
}

export async function syncCollectionByImportUrl(
    importUrl: string,
    configuredUsername: string,
    collectionUrl = PLAYSTATION_COLLECTION_URL,
    connectUrl: string | null = null,
    configuredAccountId = ''
): Promise<PlayStationAccount> {
    const account = await acquireAccountInfo(collectionUrl, configuredUsername);
    const accountSync = createAccountSync({
        serviceName: 'PlayStation',
        account,
        accountLabel: `${account.username} (ID: ${account.accountId})`,
        configuredUsername,
        configuredAccountId,
        connectUrl,
        postData: postImportDataWithFallback
    });
    await accountSync.confirmAccountBeforeLibraryFetch();
    await accountSync.connectAccount();

    const collectionData = await fetchCollectionData(collectionUrl);
    const accountId = typeof collectionData.accountId === 'string' ? collectionData.accountId.trim() : '';
    const onlineId = typeof collectionData.onlineId === 'string' ? collectionData.onlineId.trim() : '';

    if (accountId && accountId !== account.accountId) {
        throw new Error('PlayStation account changed during collection sync');
    }

    if (onlineId && onlineId !== account.username) {
        throw new Error('PlayStation username changed during collection sync');
    }

    const games = Array.isArray(collectionData.games) ? collectionData.games : [];
    if (games.length === 0) {
        throw new Error('PlayStation collection is empty');
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
    await accountSync.postImportWithAccountMismatchRecovery(targetUrl, importPayload);
    console.log('[gg.deals-extension] PlayStation collection data sent to server successfully');
    return account;
}

export async function syncWishlistByImportUrl(
    importUrl: string,
    configuredUsername: string,
    wishlistUrl = PLAYSTATION_WISHLIST_URL,
    connectUrl: string | null = null,
    configuredAccountId = ''
): Promise<PlayStationAccount> {
    const account = await acquireAccountInfo(wishlistUrl, configuredUsername);
    const accountSync = createAccountSync({
        serviceName: 'PlayStation',
        account,
        accountLabel: `${account.username} (ID: ${account.accountId})`,
        configuredUsername,
        configuredAccountId,
        connectUrl,
        postData: postImportDataWithFallback
    });
    await accountSync.confirmAccountBeforeLibraryFetch();
    await accountSync.connectAccount();

    const wishlistData = await fetchWishlistData(wishlistUrl);
    const accountId = typeof wishlistData.accountId === 'string' ? wishlistData.accountId.trim() : '';
    const onlineId = typeof wishlistData.onlineId === 'string' ? wishlistData.onlineId.trim() : '';

    if (accountId && accountId !== account.accountId) {
        throw new Error('PlayStation account changed during wishlist sync');
    }

    if (onlineId && onlineId !== account.username) {
        throw new Error('PlayStation username changed during wishlist sync');
    }

    const data = wishlistData.apolloState;
    if (typeof data === 'undefined' || data === null) {
        throw new Error('PlayStation wishlist data payload is missing in response');
    }
    if (isPlayStationWishlistEmpty(data)) {
        throw new Error('PlayStation wishlist is empty');
    }

    const targetUrl = new URL(importUrl, window.location.origin).toString();
    const importPayload = {
        version: EXTENSION_VERSION,
        accountId: account.accountId,
        username: account.username,
        data
    };
    await accountSync.postImportWithAccountMismatchRecovery(targetUrl, importPayload);
    console.log('[gg.deals-extension] PlayStation wishlist data sent to server successfully');
    return account;
}

function bindSyncButton(element: Element): void {
    console.log('[gg.deals-extension] PlayStation sync button exists:', element.id || '(no id)');
    const importUrl: string | null = element.getAttribute('data-link-to-import');
    const connectUrl: string | null = element.getAttribute('data-connect-url');
    const syncTarget: SyncTarget = element.id === PLAYSTATION_COLLECTION_SYNC_BUTTON_ID ? 'collection' : 'wishlist';
    let configuredUsername = readConfiguredUsernameFromElement(element);
    let configuredAccountId = readConfiguredAccountIdFromElement(element);
    console.log('[gg.deals-extension] PlayStation linkToImport from container:', importUrl);
    console.log('[gg.deals-extension] PlayStation connectUrl from container:', connectUrl);
    console.log('[gg.deals-extension] PlayStation configured accountId:', configuredAccountId || '<missing>');

    const syncLinkElement: Element | null =
        element.matches('a.sync-link') ? element : element.querySelector('a.sync-link');

    if (syncLinkElement) {
        syncLinkElement.remove();
        console.log('[gg.deals-extension] PlayStation sync-link element removed from button');
    } else {
        console.log('[gg.deals-extension] PlayStation no .sync-link found inside button');
    }

    element.addEventListener('click', async (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (isElementInSyncingState(element)) {
            console.log('[gg.deals-extension] PlayStation tile is syncing, click ignored');
            return;
        }

        const initialState = snapshotSyncElement(element);
        lockElementSyncClick(element);
        const stopSyncProgress = bindSyncPaginationProgressDescription(element, PLAYSTATION_SOURCE_ID);
        console.log('[gg.deals-extension] PlayStation sync button clicked ...');
        configuredUsername = readConfiguredUsernameFromElement(element);
        configuredAccountId = readConfiguredAccountIdFromElement(element);
        await markSourceNewViaPageSyncWidget(PLAYSTATION_SOURCE_ID);

        try {
            if (syncTarget === 'collection') {
                if (!importUrl) {
                    console.warn('[gg.deals-extension] Missing import URL for PlayStation collection sync');
                    await resetSourceStateViaPageSyncWidget(PLAYSTATION_SOURCE_ID);
                    stopSyncProgress();
                    restoreSyncElementSnapshot(element, initialState);
                    unlockElementSyncClick(element);
                    return;
                }

                const syncedAccount = await syncCollectionByImportUrl(
                    importUrl,
                    configuredUsername,
                    PLAYSTATION_COLLECTION_URL,
                    connectUrl,
                    configuredAccountId
                );
                await markSourceQueuedViaPageSyncWidget(PLAYSTATION_SOURCE_ID);
                persistAccountOnSyncElements(syncedAccount);
                configuredUsername = syncedAccount.username;
                configuredAccountId = syncedAccount.accountId;
                stopSyncProgress();
                unlockElementSyncClick(element);
                return;
            }

            if (!importUrl) {
                console.warn('[gg.deals-extension] Missing import URL for PlayStation wishlist sync');
                await resetSourceStateViaPageSyncWidget(PLAYSTATION_SOURCE_ID);
                stopSyncProgress();
                restoreSyncElementSnapshot(element, initialState);
                unlockElementSyncClick(element);
                return;
            }

            const syncedAccount = await syncWishlistByImportUrl(
                importUrl,
                configuredUsername,
                PLAYSTATION_WISHLIST_URL,
                connectUrl,
                configuredAccountId
            );
            await markSourceQueuedViaPageSyncWidget(PLAYSTATION_SOURCE_ID);
            persistAccountOnSyncElements(syncedAccount);
            configuredUsername = syncedAccount.username;
            configuredAccountId = syncedAccount.accountId;
            stopSyncProgress();
            unlockElementSyncClick(element);
        } catch (error) {
            if (isSyncCanceledError(error)) {
                await unmarkAsNewViaPageSyncWidget(PLAYSTATION_SOURCE_ID);
                stopSyncProgress();
                restoreSyncElementSnapshot(element, initialState);
                unlockElementSyncClick(element);
                return;
            }

            console.log('[gg.deals-extension] Error during PlayStation sync:', error);
            await resetSourceStateViaPageSyncWidget(PLAYSTATION_SOURCE_ID);
            stopSyncProgress();
            restoreSyncElementSnapshot(element, initialState);
            unlockElementSyncClick(element);
            if (isExtensionContextInvalidatedError(error)) {
                console.warn('[gg.deals-extension] Extension updated. Reload page and try again.');
                return;
            }

            if (isAuthRequiredError(error)) {
                await requestAuthRecovery();
                console.warn('[gg.deals-extension] PlayStation auth required. Start the sync again after the background tab loads.');
                return;
            }

            if (isPlayStationEmptyDataError(error)) {
                const emptyDataMessage = syncTarget === 'collection'
                    ? PLAYSTATION_SYNC_ERROR_MESSAGES.emptyCollection
                    : PLAYSTATION_SYNC_ERROR_MESSAGES.emptyWishlist;
                await showWarningToast(emptyDataMessage);
                return;
            }

            console.error('[gg.deals-extension] PlayStation connecting failed:', error);
            await showErrorToast(PLAYSTATION_SYNC_ERROR_MESSAGES.generic);
        }
    }, { capture: true });
}

export default function PlayStationIntegration(buttonIds?: string[]): void {
    const syncButtonIds = buttonIds ?? [
        PLAYSTATION_WISHLIST_SYNC_BUTTON_ID,
        PLAYSTATION_COLLECTION_SYNC_BUTTON_ID
    ];

    syncButtonIds.forEach((buttonId) => {
        lookForElement(`#${buttonId}`).then((element: Element) => {
            bindSyncButton(element);
        }).catch((error: unknown) => {
            console.warn(`[gg.deals-extension] PlayStation sync button not found: #${buttonId}`, error);
        });
    });
}
