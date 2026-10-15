import SteamIntegration, {
    readConfiguredUsernameFromElement as readConfiguredSteamUsername,
    STEAM_IGNORELIST_FALLBACK_BUTTON_IDS,
    STEAM_WISHLIST_FALLBACK_BUTTON_IDS,
    syncCollectionByImportUrl as syncSteamCollectionByImportUrl
} from './integrations/steam';
import EpicIntegration, {
    isAuthorizationCodeMissingError as isEpicAuthorizationCodeMissingError,
    readConfiguredAccountIdFromElement as readConfiguredEpicAccountId,
    readConfiguredUsernameFromElement as readConfiguredEpicUsername,
    requestAuthRecovery as requestEpicAuthRecovery,
    syncCollectionByImportUrl as syncEpicCollectionByImportUrl
} from './integrations/epic';
import PlayStationIntegration, {
    isAuthRequiredError as isPlayStationAuthRequiredError,
    readConfiguredAccountIdFromElement as readConfiguredPlayStationAccountId,
    readConfiguredUsernameFromElement as readConfiguredPlayStationUsername,
    requestAuthRecovery as requestPlayStationAuthRecovery,
    syncWishlistByImportUrl as syncPlayStationWishlistByImportUrl
} from './integrations/playstation';
import NintendoIntegration, {
    isAuthRequiredError as isNintendoAuthRequiredError,
    readConfiguredAccountIdFromElement as readConfiguredNintendoAccountId,
    readConfiguredUsernameFromElement as readConfiguredNintendoUsername,
    requestAuthRecovery as requestNintendoAuthRecovery,
    syncCollectionByImportUrl as syncNintendoCollectionByImportUrl
} from './integrations/nintendo';
import {
    EPIC_GAMES_COLLECTION_SYNC_BUTTON_ID,
    EPIC_GAMES_WISHLIST_SYNC_BUTTON_ID,
    EPIC_SOURCE_ID,
    EXTENSION_INSTALLED_CLASSNAME,
    EXTENSION_VERSION,
    NINTENDO_COLLECTION_SYNC_BUTTON_ID,
    NINTENDO_SOURCE_ID,
    NINTENDO_WISHLIST_SYNC_BUTTON_ID,
    PLAYSTATION_COLLECTION_SYNC_BUTTON_ID,
    PLAYSTATION_SOURCE_ID,
    PLAYSTATION_WISHLIST_SYNC_BUTTON_ID,
    STEAM_COLLECTION_SYNC_BUTTON_ID,
    STEAM_SOURCE_ID,
    USER_SETTINGS_PAGE_CLASSNAME
} from './utils/sync-constants';
import {
    bindSyncPaginationProgressDescription,
    isSyncCanceledError,
    markSourceNewViaPageSyncWidget,
    markSourceQueuedViaPageSyncWidget,
    resetSourceStateViaPageSyncWidget,
    unmarkAsNewViaPageSyncWidget
} from './utils/sync-helpers';

function markExtensionInstalledOnBody(): void {
    const apply = (): void => {
        if (!document.body) {
            return;
        }

        document.body.classList.add(EXTENSION_INSTALLED_CLASSNAME);
        document.body.setAttribute('data-extension-version', EXTENSION_VERSION);
    };

    apply();

    if (!document.body) {
        window.addEventListener('DOMContentLoaded', apply, { once: true });
    }
}

function markExtensionInstallOnHtml(): void {
    document.documentElement.classList.add(EXTENSION_INSTALLED_CLASSNAME);
    document.documentElement.setAttribute('data-extension-version', EXTENSION_VERSION);
}

function detectProvider(statusElement: Element, connectUrl = ''): number | null {
    const row = statusElement.closest('.sync-provider-item, .extension-sync-popup-provider-item');
    const nameElement = row?.querySelector('.sync-provider-name, .extension-sync-popup-provider-name');
    const label = nameElement?.textContent?.trim().toLowerCase() ?? '';
    const normalizedConnectUrl = connectUrl.trim().toLowerCase();

    if (label.includes('steam') || normalizedConnectUrl.includes('/steam')) {
        return STEAM_SOURCE_ID;
    }

    if (label.includes('epic') || normalizedConnectUrl.includes('/epic')) {
        return EPIC_SOURCE_ID;
    }

    if (
        label.includes('playstation')
        || normalizedConnectUrl.includes('/pswishlist')
        || normalizedConnectUrl.includes('/pscollection')
    ) {
        return PLAYSTATION_SOURCE_ID;
    }

    if (label.includes('nintendo') || normalizedConnectUrl.includes('/nintendo')) {
        return NINTENDO_SOURCE_ID;
    }

    return null;
}

type ChildNodesSnapshot = Node[];

function snapshotChildNodes(element: Element): ChildNodesSnapshot {
    return Array.from(element.childNodes, (child) => child.cloneNode(true));
}

function restoreChildNodes(element: Element, snapshot: ChildNodesSnapshot): void {
    element.replaceChildren(...snapshot.map((child) => child.cloneNode(true)));
}

function markProviderConnectedInSettingsModal(host: HTMLElement, originalChildren: ChildNodesSnapshot): void {
    host.classList.remove('syncing');
    host.classList.add('connected');
    host.dataset.ggdealsSyncBusy = '0';

    restoreChildNodes(host, originalChildren);
    const labelElement = host.querySelector('.sync-provider-label, .sync-provider-status-label, .extension-sync-popup-provider-status-label');
    if (labelElement) {
        labelElement.textContent = 'Connected';
        return;
    }

    host.textContent = 'Connected';
}

function bindSettingsProviderSyncActions(container: Element): void {
    const statusElements = container.querySelectorAll(
        '.sync-provider-status[data-connect-url], .extension-sync-popup-provider-status[data-connect-url], .sync-provider-item[data-connect-url]'
    );
    statusElements.forEach((statusElement) => {
        const host = statusElement as HTMLElement;
        if (host.dataset.ggdealsSyncBound === '1') {
            return;
        }

        host.dataset.ggdealsSyncBound = '1';
        host.style.cursor = 'pointer';

        host.addEventListener('click', async (event: MouseEvent) => {
            const target = event.target as Element | null;
            if (target?.closest('.sync-provider-disconnect')) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            if (host.dataset.ggdealsSyncBusy === '1') {
                return;
            }

            const connectUrl = host.getAttribute('data-connect-url')?.trim() ?? '';
            if (!connectUrl) {
                return;
            }

            const provider = detectProvider(host, connectUrl);
            if (!provider) {
                console.warn('[gg.deals-extension] Unsupported provider in settings popup:', host.textContent?.trim());
                return;
            }

            console.log('[gg.deals-extension] Settings popup provider detected:', provider, 'connectUrl:', connectUrl);

            host.dataset.ggdealsSyncBusy = '1';
            host.classList.add('syncing');
            const originalChildren = snapshotChildNodes(host);
            host.textContent = 'Connecting...';
            const stopSyncProgress = bindSyncPaginationProgressDescription(host, provider);
            if (provider !== EPIC_SOURCE_ID) {
                await markSourceNewViaPageSyncWidget(provider);
            }

            try {
                if (provider === STEAM_SOURCE_ID) {
                    const configuredUsername = readConfiguredSteamUsername(host);
                    await syncSteamCollectionByImportUrl(connectUrl, configuredUsername, connectUrl);
                } else if (provider === EPIC_SOURCE_ID) {
                    const configuredEpicUsername = readConfiguredEpicUsername(host);
                    const configuredEpicAccountId = readConfiguredEpicAccountId(host);
                    const syncedAccount = await syncEpicCollectionByImportUrl(
                        connectUrl,
                        configuredEpicUsername,
                        connectUrl,
                        configuredEpicAccountId
                    );
                    host.setAttribute('data-username', syncedAccount.username);
                    host.setAttribute('data-account-id', syncedAccount.accountId);
                } else if (provider === PLAYSTATION_SOURCE_ID) {
                    const configuredPlayStationUsername = readConfiguredPlayStationUsername(host);
                    const configuredPlayStationAccountId = readConfiguredPlayStationAccountId(host);
                    const syncedAccount = await syncPlayStationWishlistByImportUrl(
                        connectUrl,
                        configuredPlayStationUsername,
                        undefined,
                        connectUrl,
                        configuredPlayStationAccountId
                    );
                    host.setAttribute('data-username', syncedAccount.username);
                    host.setAttribute('data-account-id', syncedAccount.accountId);
                } else if (provider === NINTENDO_SOURCE_ID) {
                    const configuredNintendoUsername = readConfiguredNintendoUsername(host);
                    const configuredNintendoAccountId = readConfiguredNintendoAccountId(host);
                    const syncedAccount = await syncNintendoCollectionByImportUrl(
                        connectUrl,
                        configuredNintendoUsername,
                        connectUrl,
                        configuredNintendoAccountId
                    );
                    host.setAttribute('data-username', syncedAccount.username);
                    host.setAttribute('data-account-id', syncedAccount.accountId);
                }

                await markSourceQueuedViaPageSyncWidget(provider);
                stopSyncProgress();
                markProviderConnectedInSettingsModal(host, originalChildren);
            } catch (error) {
                if (isSyncCanceledError(error)) {
                    if (provider !== EPIC_SOURCE_ID) {
                        await unmarkAsNewViaPageSyncWidget(provider);
                    }
                    stopSyncProgress();
                    host.classList.remove('syncing');
                    restoreChildNodes(host, originalChildren);
                    host.dataset.ggdealsSyncBusy = '0';
                    return;
                }

                const errorMessage = error instanceof Error ? error.message : String(error);
                if (provider === EPIC_SOURCE_ID && isEpicAuthorizationCodeMissingError(error)) {
                    const didOpenEpicLogin = await requestEpicAuthRecovery();
                    stopSyncProgress();
                    host.classList.remove('syncing');
                    if (didOpenEpicLogin) {
                        host.textContent = 'Reload page to sync';
                    } else {
                        restoreChildNodes(host, originalChildren);
                    }
                    host.dataset.ggdealsSyncBusy = '0';
                    return;
                }

                await resetSourceStateViaPageSyncWidget(provider);
                if (provider === PLAYSTATION_SOURCE_ID && isPlayStationAuthRequiredError(error)) {
                    await requestPlayStationAuthRecovery();
                    stopSyncProgress();
                    host.classList.remove('syncing');
                    restoreChildNodes(host, originalChildren);
                    host.dataset.ggdealsSyncBusy = '0';
                    return;
                }
                if (provider === NINTENDO_SOURCE_ID && isNintendoAuthRequiredError(error)) {
                    await requestNintendoAuthRecovery();
                    stopSyncProgress();
                    host.classList.remove('syncing');
                    restoreChildNodes(host, originalChildren);
                    host.dataset.ggdealsSyncBusy = '0';
                    return;
                }

                stopSyncProgress();
                host.classList.remove('syncing');
                host.textContent = `Connecting failed: ${errorMessage}`;

                window.setTimeout(() => {
                    restoreChildNodes(host, originalChildren);
                    host.dataset.ggdealsSyncBusy = '0';
                }, 2500);
            }
        });
    });
}

function applyInstalledState(container: Element): void {
    if (container.classList.contains('extension-installed')) {
        return;
    }

    container.classList.add(EXTENSION_INSTALLED_CLASSNAME);
    container.setAttribute('data-extension-version', EXTENSION_VERSION);

    console.log('[gg.deals-extension] Added extension-installed state on settings popup');
}

function initializeExtensionSettings(body: HTMLElement): void {
    if (!body.classList.contains(USER_SETTINGS_PAGE_CLASSNAME)) {
        return;
    }

    console.log('[gg.deals-extension] Settings page detected, marking extension as installed');

    const processNode = (node: ParentNode): void => {
        const settingsContainer = node instanceof Element && node.id === 'user-extension-settings'
            ? node
            : node.querySelector?.('#user-extension-settings') ?? null;


        if (settingsContainer) {
            applyInstalledState(settingsContainer);
            bindSettingsProviderSyncActions(settingsContainer);
        }
    };

    processNode(document);

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const addedNode of mutation.addedNodes) {
                if (addedNode instanceof Element) {
                    processNode(addedNode);
                }
            }
        }
    });

    observer.observe(body, { childList: true, subtree: true });
}

function initPageSpecificIntegrations(): void {
    const body = document.body;
    if (!body) return;

    initializeExtensionSettings(body);

    const isCollection = body.classList.contains('user-collection-page');
    const isWishlist = body.classList.contains('user-wishlist-page');
    const isIgnorelist = body.classList.contains('user-ignorelist-page');

    if (isCollection) {
        SteamIntegration([STEAM_COLLECTION_SYNC_BUTTON_ID]);
        EpicIntegration([EPIC_GAMES_COLLECTION_SYNC_BUTTON_ID]);
        PlayStationIntegration([PLAYSTATION_COLLECTION_SYNC_BUTTON_ID]);
        NintendoIntegration([NINTENDO_COLLECTION_SYNC_BUTTON_ID]);
        return;
    }

    if (isWishlist) {
        SteamIntegration(STEAM_WISHLIST_FALLBACK_BUTTON_IDS);
        EpicIntegration([EPIC_GAMES_WISHLIST_SYNC_BUTTON_ID]);
        PlayStationIntegration([PLAYSTATION_WISHLIST_SYNC_BUTTON_ID]);
        NintendoIntegration([NINTENDO_WISHLIST_SYNC_BUTTON_ID]);
        return;
    }

    if (isIgnorelist) {
        SteamIntegration(STEAM_IGNORELIST_FALLBACK_BUTTON_IDS);
    }
}

function runOnSupportedPages(): void {
    const { hostname, pathname } = window.location;
    console.log('[gg.deals-extension] content script injected on:', `${hostname}${pathname}`);

    markExtensionInstallOnHtml();
    markExtensionInstalledOnBody();

    // Use body classes to determine page type; wait if body not yet available
    if (document.body) {
        initPageSpecificIntegrations();
    } else {
        window.addEventListener('DOMContentLoaded', initPageSpecificIntegrations, { once: true });
    }
}

runOnSupportedPages();
