import { createAccountSync } from '../../utils/sync-account';
import {
    EXTENSION_VERSION,
    EPIC_SOURCE_ID,
    EPIC_GAMES_COLLECTION_SYNC_BUTTON_ID,
    EPIC_GAMES_WISHLIST_SYNC_BUTTON_ID,
    EPIC_ID_LOGIN_URL
} from '../../utils/sync-constants';
import { EPIC_SYNC_ERROR_MESSAGES } from '../../utils/sync-error-messages';
import {
    callSwal,
    isElementInSyncingState,
    isSyncCanceledError,
    bindSyncPaginationProgressDescription,
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

type EpicTokenPayload = {
    displayName?: string;
    access_token?: string;
    account_id?: string;
};

type EpicAccountSession = {
    accessToken: string;
    accountId: string;
    username: string;
};

export type SyncedAccount = {
    username: string;
    accountId: string;
};

type SyncTarget = 'collection' | 'wishlist';

const MESSAGE_TIMEOUT_MS = 20000;

function isEpicCollectionOrWishlistEmpty(data: unknown): boolean {
    if (Array.isArray(data)) {
        return data.length === 0;
    }

    if (!data || typeof data !== 'object') {
        return false;
    }

    const payload = data as Record<string, unknown>;
    const listCandidate = payload.elements ?? payload.records ?? payload.items ?? payload.games;
    if (Array.isArray(listCandidate)) {
        return listCandidate.length === 0;
    }

    return Object.keys(payload).length === 0;
}

function isEpicEmptyDataError(error: unknown): boolean {
    const errorMessage = toErrorMessage(error);
    return errorMessage.includes('Epic collection is empty')
        || errorMessage.includes('Epic wishlist is empty');
}

function sanitizeEpicPayloadData(epicData: unknown): unknown {
    if (!epicData || typeof epicData !== 'object' || Array.isArray(epicData)) {
        return epicData;
    }

    const dataObject = epicData as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(dataObject, 'elements')) {
        return epicData;
    }

    const keys = Object.keys(dataObject);
    if (keys.length === 1) {
        return dataObject.elements;
    }

    const { elements: _removedElements, ...withoutElements } = dataObject;
    return withoutElements;
}

export function readConfiguredUsernameFromElement(element: Element): string {
    return readTrimmedAttribute(element, 'data-username');
}

export function readConfiguredAccountIdFromElement(element: Element): string {
    return readTrimmedAttribute(element, 'data-account-id');
}

function persistUsernameOnElement(element: Element, username: string): void {
    persistTrimmedAttribute(element, 'data-username', username);
}

function persistAccountIdOnElement(element: Element, accountId: string): void {
    persistTrimmedAttribute(element, 'data-account-id', accountId);
}

function persistAccountOnSyncElements(username: string, accountId: string): void {
    [
        EPIC_GAMES_COLLECTION_SYNC_BUTTON_ID,
        EPIC_GAMES_WISHLIST_SYNC_BUTTON_ID
    ].forEach((buttonId) => {
        const element = document.getElementById(buttonId);
        if (!element) {
            return;
        }

        persistUsernameOnElement(element, username);
        persistAccountIdOnElement(element, accountId);
    });
}

export function isAuthorizationCodeMissingError(error: unknown): boolean {
    return toErrorMessage(error).includes('authorizationCode missing in Epic response');
}

async function openUrlInNewWindow(url: string): Promise<void> {
    try {
        const response = await sendRuntimeMessage<RuntimeMessageResponse>({
            type: 'OPEN_URL_IN_NEW_TAB',
            url
        }, MESSAGE_TIMEOUT_MS);

        if (response?.ok) {
            return;
        }
    } catch (error) {
        console.warn('[gg.deals-extension] OPEN_URL_IN_NEW_TAB failed, falling back to window.open:', error);
    }

    const popupWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (popupWindow) {
        return;
    }

    window.location.assign(url);
}

export async function openLoginInNewWindow(): Promise<void> {
    await openUrlInNewWindow(EPIC_ID_LOGIN_URL);
}

export async function requestAuthRecovery(): Promise<boolean> {
    const isConfirmed = await callSwal({
        html: 'Account not connected or session expired. Log in on Epic Games Store to enable Epic sync.',
        confirmButtonText: 'Open Epic Games'
    });

    if (!isConfirmed) {
        return false;
    }

    await openLoginInNewWindow();
    return true;
}

async function acquireAccountSession(configuredUsername: string): Promise<EpicAccountSession> {
    const response = await sendRuntimeMessage<RuntimeMessageResponse>({
        type: 'FETCH_EPIC_TOKEN',
        forceFresh: true
    }, MESSAGE_TIMEOUT_MS);
    if (!response?.ok) {
        throw new Error(response?.error ?? 'Unknown error while fetching Epic token');
    }

    const token = response.data as EpicTokenPayload;
    if (!token.access_token) {
        throw new Error('Missing access token in Epic response');
    }

    const tokenDisplayName = typeof token.displayName === 'string' ? token.displayName.trim() : '';
    const accountId = typeof token.account_id === 'string' ? token.account_id.trim() : '';
    const username = tokenDisplayName || configuredUsername;

    if (!accountId) {
        throw new Error('Epic account ID is missing in token response');
    }

    return {
        accessToken: token.access_token,
        accountId,
        username
    };
}

async function fetchLibraryData(
    accessToken: string,
    syncTarget: SyncTarget
): Promise<unknown> {
    const isWishlist = syncTarget === 'wishlist';
    const response = await sendRuntimeMessage<RuntimeMessageResponse>({
        type: 'FETCH_EPIC_LIBRARY_ITEMS',
        accessToken,
        isWishlist
    }, MESSAGE_TIMEOUT_MS);

    if (!response?.ok) {
        throw new Error(response?.error ?? 'Unknown error while fetching Epic library items');
    }

    const epicData = response.data;
    console.log('[gg.deals-extension] Epic library items:', epicData);
    const libraryData = sanitizeEpicPayloadData(epicData);

    if (isEpicCollectionOrWishlistEmpty(libraryData)) {
        throw new Error(isWishlist ? 'Epic wishlist is empty' : 'Epic collection is empty');
    }

    return libraryData;
}

async function syncLibraryByImportUrl(
    importUrl: string,
    configuredUsername: string,
    syncTarget: SyncTarget,
    connectUrl: string | null = null,
    configuredAccountId = ''
): Promise<SyncedAccount> {
    const { accessToken, accountId, username } = await acquireAccountSession(configuredUsername);
    const accountSync = createAccountSync({
        serviceName: 'Epic',
        account: { accountId, username },
        accountLabel: username || 'Epic account',
        configuredUsername,
        configuredAccountId,
        connectUrl,
        postData: async (url, payload) => { await sendMessageToServer(url, payload as JSON); }
    });
    await accountSync.confirmAccountBeforeLibraryFetch();
    await accountSync.connectAccount();

    const libraryData = await fetchLibraryData(accessToken, syncTarget);
    await accountSync.postImportWithAccountMismatchRecovery(importUrl, {
        version: EXTENSION_VERSION,
        accountId,
        username,
        data: libraryData
    });
    console.log('[gg.deals-extension] Epic library items sent to server successfully');

    return { username, accountId };
}

export function syncCollectionByImportUrl(
    importUrl: string,
    configuredUsername: string,
    connectUrl: string | null = null,
    configuredAccountId = ''
): Promise<SyncedAccount> {
    return syncLibraryByImportUrl(importUrl, configuredUsername, 'collection', connectUrl, configuredAccountId);
}

export function syncWishlistByImportUrl(
    importUrl: string,
    configuredUsername: string,
    connectUrl: string | null = null,
    configuredAccountId = ''
): Promise<SyncedAccount> {
    return syncLibraryByImportUrl(importUrl, configuredUsername, 'wishlist', connectUrl, configuredAccountId);
}

async function redirectToLoginIfMissingAuthorizationCode(error: unknown): Promise<boolean> {
    if (!isAuthorizationCodeMissingError(error)) {
        return false;
    }

    console.warn('[gg.deals-extension] Missing authorizationCode. Redirecting user to Epic login page');
    await requestAuthRecovery();
    return true;
}

function bindSyncButton(element: Element): void {
    console.log('[gg.deals-extension] Epic sync button exists:', element.id || '(no id)');
    const importUrl: string | null = element.getAttribute('data-link-to-import');
    const connectUrl: string | null = element.getAttribute('data-connect-url');
    const syncTarget: SyncTarget = element.id === EPIC_GAMES_WISHLIST_SYNC_BUTTON_ID ? 'wishlist' : 'collection';
    let configuredUsername = readConfiguredUsernameFromElement(element);
    let configuredAccountId = readConfiguredAccountIdFromElement(element);
    console.log('[gg.deals-extension] Epic linkToImport from container:', importUrl);
    console.log('[gg.deals-extension] Epic connectUrl from container:', connectUrl);
    console.log('[gg.deals-extension] Epic configured accountId:', configuredAccountId || '<missing>');

    const syncLinkElement: Element | null =
        element.matches('a.sync-link') ? element : element.querySelector('a.sync-link');

    if (syncLinkElement) {
        syncLinkElement.remove();
        console.log('[gg.deals-extension] Epic sync-link element removed from button');
    } else {
        console.log('[gg.deals-extension] Epic no .sync-link found inside button');
    }

    element.addEventListener('click', async (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (isElementInSyncingState(element)) {
            console.log('[gg.deals-extension] Epic tile is syncing, click ignored');
            return;
        }

        const initialState = snapshotSyncElement(element);
        lockElementSyncClick(element);
        const stopSyncProgress = bindSyncPaginationProgressDescription(element, EPIC_SOURCE_ID);
        console.log('[gg.deals-extension] Epic sync button clicked');
        configuredUsername = readConfiguredUsernameFromElement(element);
        configuredAccountId = readConfiguredAccountIdFromElement(element);
        await markSourceNewViaPageSyncWidget(EPIC_SOURCE_ID);

        if (!importUrl) {
            console.warn('[gg.deals-extension] Missing import URL for Epic sync');
            await resetSourceStateViaPageSyncWidget(EPIC_SOURCE_ID);
            stopSyncProgress();
            restoreSyncElementSnapshot(element, initialState);
            unlockElementSyncClick(element);
            return;
        }

        try {
            const syncByImportUrl = syncTarget === 'wishlist'
                ? syncWishlistByImportUrl
                : syncCollectionByImportUrl;
            const syncedAccount = await syncByImportUrl(importUrl, configuredUsername, connectUrl, configuredAccountId);
            await markSourceQueuedViaPageSyncWidget(EPIC_SOURCE_ID);
            persistAccountOnSyncElements(syncedAccount.username, syncedAccount.accountId);
            if (configuredUsername !== syncedAccount.username) {
                configuredUsername = syncedAccount.username;
            }
            if (configuredAccountId !== syncedAccount.accountId) {
                configuredAccountId = syncedAccount.accountId;
            }
            stopSyncProgress();
            unlockElementSyncClick(element);
        } catch (error) {
            if (isSyncCanceledError(error)) {
                await unmarkAsNewViaPageSyncWidget(EPIC_SOURCE_ID);
                stopSyncProgress();
                restoreSyncElementSnapshot(element, initialState);
                unlockElementSyncClick(element);
                return;
            }

            if (isAuthorizationCodeMissingError(error)) {
                await resetSourceStateViaPageSyncWidget(EPIC_SOURCE_ID);
                stopSyncProgress();
                restoreSyncElementSnapshot(element, initialState);
                unlockElementSyncClick(element);
                await redirectToLoginIfMissingAuthorizationCode(error);
                return;
            }

            await resetSourceStateViaPageSyncWidget(EPIC_SOURCE_ID);
            stopSyncProgress();
            restoreSyncElementSnapshot(element, initialState);
            unlockElementSyncClick(element);
            if (isEpicEmptyDataError(error)) {
                const emptyDataMessage = syncTarget === 'wishlist'
                    ? EPIC_SYNC_ERROR_MESSAGES.emptyWishlist
                    : EPIC_SYNC_ERROR_MESSAGES.emptyCollection;
                await showWarningToast(emptyDataMessage);
                return;
            }

            console.error('[gg.deals-extension] Epic sync failed:', error);
            await showErrorToast(EPIC_SYNC_ERROR_MESSAGES.generic);
        }
    }, { capture: true });
}

export default function EpicIntegration(buttonIds?: string[]): void {
    const syncButtonIds = buttonIds ?? [
        EPIC_GAMES_COLLECTION_SYNC_BUTTON_ID,
        EPIC_GAMES_WISHLIST_SYNC_BUTTON_ID
    ];

    syncButtonIds.forEach((buttonId) => {
        lookForElement(`#${buttonId}`).then((element: Element) => {
            bindSyncButton(element);
        }).catch((error: unknown) => {
            console.warn(`[gg.deals-extension] Epic sync button not found: #${buttonId}`, error);
        });
    });
}
