import { createAccountSync } from '../../utils/sync-account';
import {
    EXTENSION_VERSION,
    STEAM_COLLECTION_SYNC_BUTTON_ID,
    STEAM_HOME_URL,
    STEAM_IGNORELIST_BUTTON_ID,
    STEAM_NOT_LOGGED_IN_MESSAGE,
    STEAM_SOURCE_ID,
    STEAM_WARMUP_WAIT_MS,
    STEAM_WISHLIST_BUTTON_ID
} from '../../utils/sync-constants';
import { STEAM_SYNC_ERROR_MESSAGES } from '../../utils/sync-error-messages';
import {
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
    snapshotSyncElement,
    toErrorMessage,
    unmarkAsNewViaPageSyncWidget,
    unlockElementSyncClick,
    showErrorToast,
    showWarningToast,
    type RuntimeMessageResponse
} from '../../utils/sync-helpers';
import browser from 'webextension-polyfill';

type SteamAccountNamePayload = {
    account_name?: string;
    steamid?: string;
};

type SteamAccountInfo = {
    username: string;
    accountId: string;
    version: string;
};

type SteamLibraryPayload = {
    rgOwnedApps?: unknown[];
};

type SyncTarget = 'collection' | 'ignorelist' | 'wishlist';

const EMPTY_IGNORE_LIST_SERVER_ERROR_CODE = 3;

export const STEAM_IGNORELIST_FALLBACK_BUTTON_IDS: string[] = [
    STEAM_IGNORELIST_BUTTON_ID
];

export const STEAM_WISHLIST_FALLBACK_BUTTON_IDS: string[] = [
    STEAM_WISHLIST_BUTTON_ID
];

function isSteamEmptyDataError(error: unknown): boolean {
    return toErrorMessage(error).includes('Steam returned an empty library');
}

function getOwnedAppsCount(steamData: unknown): number {
    if (!steamData || typeof steamData !== 'object') {
        return -1;
    }

    const payload = steamData as SteamLibraryPayload;
    if (!Array.isArray(payload.rgOwnedApps)) {
        return -1;
    }

    return payload.rgOwnedApps.length;
}

export function readConfiguredUsernameFromElement(element: Element): string {
    return readTrimmedAttribute(element, 'data-username');
}

function persistUsernameOnElement(element: Element, username: string): void {
    persistTrimmedAttribute(element, 'data-username', username);
}

async function fetchAccountInfo(configuredUsername: string): Promise<SteamAccountInfo> {
    const response = await browser.runtime.sendMessage({ type: 'FETCH_STEAM_ACCOUNT_NAME' }) as RuntimeMessageResponse;
    if (!response?.ok) {
        throw new Error(response?.error ?? 'Unknown error while fetching Steam account name');
    }

    const payload = response.data as SteamAccountNamePayload;
    const resolvedUsername = typeof payload?.account_name === 'string' ? payload.account_name.trim() : '';
    const username = resolvedUsername || configuredUsername;
    const accountId = typeof payload?.steamid === 'string' ? payload.steamid.trim() : '';
    if (!username) {
        throw new Error('Steam account name is missing in background response');
    }
    if (!accountId) {
        throw new Error('Steam account ID is missing in background response');
    }

    return {
        username,
        accountId,
        version: EXTENSION_VERSION
    };
}

function isSteamAccountNameMissingError(error: unknown): boolean {
    const errorMessage = toErrorMessage(error);
    return errorMessage.includes('Could not extract Steam account info from application_config[data-userinfo]')
        || errorMessage.includes('Steam account name is missing in background response')
        || errorMessage.includes('Steam account ID is missing in background response');
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

export async function openLoginTab(): Promise<boolean> {
    const response = await browser.runtime.sendMessage({
        type: 'OPEN_URL_IN_NEW_TAB',
        url: STEAM_HOME_URL + 'login/',
        active: true
    }) as RuntimeMessageResponse;

    if (response?.ok) {
        return true;
    }

    console.warn('[gg.deals-extension] Failed to open Steam page in a tab:', response?.error);
    return false;
}

export async function requestAuthRecovery(): Promise<boolean> {
    const isConfirmed = await callSwal({
        html: 'Account not connected or session expired. Open Steam Store in the background to enable Steam sync.',
        confirmButtonText: 'Open Steam'
    });

    if (!isConfirmed) {
        return false;
    }

    return openLoginTab();
}

async function acquireAccountInfo(configuredUsername: string): Promise<SteamAccountInfo> {
    try {
        return await fetchAccountInfo(configuredUsername);
    } catch (error) {
        if (!isSteamAccountNameMissingError(error)) {
            throw error;
        }

        console.warn('[gg.deals-extension] Steam account name not found on first attempt, opening Steam home in background and retrying');
        const didOpenSteam = await requestAuthRecovery();
        if (!didOpenSteam) {
            throw new Error('Sync canceled: account not confirmed');
        }

        await wait(STEAM_WARMUP_WAIT_MS);

        try {
            return await fetchAccountInfo(configuredUsername);
        } catch (retryError) {
            if (!isSteamAccountNameMissingError(retryError)) {
                throw retryError;
            }

            throw new Error(STEAM_NOT_LOGGED_IN_MESSAGE);
        }
    }
}

async function fetchLibraryData(): Promise<unknown> {
    const response = await browser.runtime.sendMessage({ type: 'FETCH_STEAM_USERDATA' }) as RuntimeMessageResponse;
    if (!response?.ok) {
        throw new Error(response?.error ?? 'Unknown error while fetching Steam JSON');
    }

    const libraryData = response.data;
    console.log('[gg.deals-extension] Steam JSON:', libraryData);

    const ownedAppsCount = getOwnedAppsCount(libraryData);
    console.log('[gg.deals-extension] Steam owned apps count:', ownedAppsCount);
    if (ownedAppsCount === 0) {
        throw new Error('Steam returned an empty library. Check Steam session/cookies and try again.');
    }

    return libraryData;
}

async function syncLibraryByImportUrl(
    importUrl: string,
    configuredUsername: string,
    connectUrl: string | null = null
): Promise<string> {
    const { username, accountId, version } = await acquireAccountInfo(configuredUsername);
    const accountSync = createAccountSync({
        serviceName: 'Steam',
        account: { accountId, username },
        accountLabel: username,
        configuredUsername,
        connectUrl,
        postData: async (url, payload) => { await sendMessageToServer(url, payload as JSON); }
    });
    await accountSync.confirmAccountBeforeLibraryFetch();

    const libraryData = await fetchLibraryData();
    // Steam's connect endpoint also receives library data, so connect after fetching,
    // but always confirm the account before fetching, just like the other providers.
    await accountSync.connectAccount(libraryData);
    await accountSync.postImportWithAccountMismatchRecovery(importUrl, {
        data: libraryData,
        username,
        accountId,
        version
    });

    return username;
}

export async function syncCollectionByImportUrl(
    importUrl: string,
    configuredUsername: string,
    connectUrl: string | null = null
): Promise<string> {
    return syncLibraryByImportUrl(importUrl, configuredUsername, connectUrl);
}

export async function syncIgnorelistByImportUrl(
    importUrl: string,
    configuredUsername: string,
    connectUrl: string | null = null
): Promise<string> {
    // Ignorelist expects the same payload as Steam collection sync.
    return syncLibraryByImportUrl(importUrl, configuredUsername, connectUrl);
}

export async function syncWishlistByImportUrl(
    importUrl: string,
    configuredUsername: string,
    connectUrl: string | null = null
): Promise<string> {
    // Wishlist expects the same payload as Steam collection sync.
    return syncLibraryByImportUrl(importUrl, configuredUsername, connectUrl);
}

function bindSyncButton(element: Element, syncTarget: SyncTarget): void {
    console.log('[gg.deals-extension] button exists');
    let configuredUsername = readConfiguredUsernameFromElement(element);

    const importUrl: string | null = element.getAttribute('data-link-to-import');
    const connectUrl: string | null = element.getAttribute('data-connect-url');
    console.log('[gg.deals-extension] linkToImport from container:', importUrl);
    console.log('[gg.deals-extension] connectUrl from container:', connectUrl);

    const syncLinkElement: Element | null =
        element.matches('a.sync-link') ? element : element.querySelector('a.sync-link');

    if (syncLinkElement) {
        syncLinkElement.remove();
        console.log('[gg.deals-extension] Steam sync-link element removed from button');
    } else {
        console.log('[gg.deals-extension] Steam no .sync-link found inside button');
    }

    element.addEventListener('click', async (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (isElementInSyncingState(element)) {
            console.log('[gg.deals-extension] Steam tile is syncing, click ignored');
            return;
        }

        const initialState = snapshotSyncElement(element);
        lockElementSyncClick(element);
        console.log('[gg.deals-extension] button clicked');
        console.log('[gg.deals-extension] linkToImport value:', importUrl);
        console.log('[gg.deals-extension] fetching Steam JSON via background');
        configuredUsername = readConfiguredUsernameFromElement(element);
        await markSourceNewViaPageSyncWidget(STEAM_SOURCE_ID);

        if (!importUrl) {
            console.warn('[gg.deals-extension] No linkToImport URL found; skipping sending data to server');
            await resetSourceStateViaPageSyncWidget(STEAM_SOURCE_ID);
            restoreSyncElementSnapshot(element, initialState);
            unlockElementSyncClick(element);
            return;
        }

        try {
            const syncByImportUrl = syncTarget === 'ignorelist'
                ? syncIgnorelistByImportUrl
                : syncTarget === 'wishlist'
                    ? syncWishlistByImportUrl
                    : syncCollectionByImportUrl;
            const syncedUsername = await syncByImportUrl(importUrl, configuredUsername, connectUrl);
            await markSourceQueuedViaPageSyncWidget(STEAM_SOURCE_ID);
            if (syncedUsername && configuredUsername !== syncedUsername) {
                persistUsernameOnElement(element, syncedUsername);
                configuredUsername = syncedUsername;
            }
            console.log('[gg.deals-extension] Steam JSON sent to server successfully');
            unlockElementSyncClick(element);
        } catch (error) {
            if (isSyncCanceledError(error)) {
                await unmarkAsNewViaPageSyncWidget(STEAM_SOURCE_ID);
                restoreSyncElementSnapshot(element, initialState);
                unlockElementSyncClick(element);
                return;
            }

            console.error('[gg.deals-extension] Error fetching Steam JSON:', error);
            await resetSourceStateViaPageSyncWidget(STEAM_SOURCE_ID);
            restoreSyncElementSnapshot(element, initialState);
            unlockElementSyncClick(element);
            if (isSteamAccountNameMissingError(error) || (error instanceof Error && error.message === STEAM_NOT_LOGGED_IN_MESSAGE)) {
                console.warn(`[gg.deals-extension] ${STEAM_NOT_LOGGED_IN_MESSAGE}`);
                await showErrorToast(STEAM_SYNC_ERROR_MESSAGES.platformLogin);
                return;
            }

            if (
                syncTarget === 'ignorelist'
                && (
                    isSteamEmptyDataError(error)
                    || String(readServerErrorCode(error)) === String(EMPTY_IGNORE_LIST_SERVER_ERROR_CODE)
                )
            ) {
                await showWarningToast(STEAM_SYNC_ERROR_MESSAGES.emptyIgnoreList);
                return;
            }

            if (isSteamEmptyDataError(error)) {
                const emptyDataMessage = syncTarget === 'wishlist'
                    ? STEAM_SYNC_ERROR_MESSAGES.emptyWishlist
                    : STEAM_SYNC_ERROR_MESSAGES.emptyCollection;
                await showErrorToast(emptyDataMessage);
                return;
            }

            await showErrorToast(STEAM_SYNC_ERROR_MESSAGES.generic);
        }
    }, { capture: true });
}

export default function SteamIntegration(buttonIds?: string[]): void {
    const syncButtonIds = buttonIds ?? [STEAM_COLLECTION_SYNC_BUTTON_ID];

    syncButtonIds.forEach((buttonId) => {
        const syncTarget: SyncTarget = buttonId === STEAM_IGNORELIST_BUTTON_ID
            ? 'ignorelist'
            : buttonId === STEAM_WISHLIST_BUTTON_ID
                ? 'wishlist'
                : 'collection';

        lookForElement(`#${buttonId}`).then((element: Element) => {
            bindSyncButton(element, syncTarget);
        }).catch((error: unknown) => {
            console.warn(`[gg.deals-extension] Steam sync button not found: #${buttonId}`, error);
        });
    });
}
