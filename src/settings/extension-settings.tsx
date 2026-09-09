import { render, type ComponentChild, type TargetedEvent } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles/extension-settings.css';
import { AppearanceTab } from './tabs/appearance-tab';
import { DealsTab } from './tabs/deals-tab';
import { SettingsTab } from './tabs/settings-tab';
import { UserDropdown } from './components/user-dropdown';
import { InfoBox } from './components/info-box';
import {
    APPEARANCE,
    DEALS,
    SETTINGS,
    type SettingsData,
    type RegionCurrency,
    type GGUserSettingsData,
    type TabKey,
    saveSettings,
    loadSettings,
    loadAppearanceSettings,
    loadGGUserSettings,
    hasGGUserSettingsData,
    type SettingsAppearanceData,
    saveAppearanceSettings,
    saveGGUserSettings,
    saveGGUserSettingsToLocalStorage,
    GGInvalidApiKeyError,
    requestGGUserSettingsSync,
    signOutFromExtensionMemory,
} from './helpers';
import {
    acknowledgeServerMessageBadges,
    dismissCustomMessage,
    getNextCustomMessageExpiration,
    getVisibleCustomMessages,
    loadCustomMessagesFromChromeStorage,
    type GGCustomMessage,
} from '../utils/extension-settings';
import { GG_CUSTOM_MESSAGES, GG_SERVER_MESSAGE_BADGE } from '../utils/extension-settings-constants';
import {
    GG_DEALS_LOGIN_URL,
    POPUP_INITIAL_TAB_STORAGE_KEY,
    POPUP_LAST_ACTIVE_TAB_STORAGE_KEY,
    POPUP_SETTINGS_SCROLL_TARGET_BOTTOM,
    POPUP_SETTINGS_SCROLL_TARGET_STORAGE_KEY,
    SHOULD_FETCH_USER_SETTINGS_AFTER_SIGN_IN_KEY,
    PLATFORM_PC,
    PLATFORM_STEAM,
    PLATFORM_XBOX,
    PLATFORM_PLAYSTATION,
    PLATFORM_ALL,
    PLATFORM_NINTENDO,
    PLATFORM_SWITCH,
    SETTINGS_THEME_DARK,
    SETTINGS_THEME_LIGHT,
    SETTINGS_THEME_SYSTEM,
    DEFAULT_SETTINGS_THEME,
} from './constants';
import * as Icons from './icons';
import browser from 'webextension-polyfill';
import { t } from '../utils/i18n';

function isTabKey(value: unknown): value is TabKey {
    return value === DEALS || value === SETTINGS || value === APPEARANCE;
}

function getSafeMessageHref(value: string | null): string | null {
    const href = value?.trim();
    if (!href) {
        return null;
    }
    if (href.startsWith('#')) {
        return href;
    }

    try {
        const url = new URL(href, 'https://gg.deals/');
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
    } catch {
        return null;
    }
}

function renderCustomMessageNode(node: Node, key: string): ComponentChild {
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
    }
    if (!(node instanceof HTMLElement)) {
        return null;
    }
    if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE' || node.tagName === 'IFRAME' || node.tagName === 'OBJECT') {
        return null;
    }

    const children = Array.from(node.childNodes, (child, index) => (
        renderCustomMessageNode(child, `${key}:${index}`)
    ));
    if (node.tagName !== 'A') {
        return children;
    }

    const href = getSafeMessageHref(node.getAttribute('href'));
    if (href === null) {
        return children;
    }

    const isFragment = href.startsWith('#');
    return (
        <a
            key={key}
            href={href}
            target={isFragment ? undefined : '_blank'}
            rel={isFragment ? undefined : 'noreferrer'}
            className="gg-info-box-content-link"
        >
            {children}
        </a>
    );
}

function CustomMessageContent({ message }: { message: string }) {
    const document = new DOMParser().parseFromString(message, 'text/html');
    return <>{Array.from(document.body.childNodes, (node, index) => renderCustomMessageNode(node, String(index)))}</>;
}

function mapUserPlatformToSettingsPlatform(platform: string | undefined): SettingsData['platform'] {
    const normalizedPlatform = platform?.trim().toLowerCase();

    if (normalizedPlatform === PLATFORM_PC || normalizedPlatform === PLATFORM_STEAM) {
        return PLATFORM_PC;
    }

    if (normalizedPlatform === PLATFORM_XBOX || normalizedPlatform === PLATFORM_PLAYSTATION || normalizedPlatform === PLATFORM_ALL) {
        return normalizedPlatform;
    }

    if (normalizedPlatform === PLATFORM_NINTENDO || normalizedPlatform === PLATFORM_SWITCH) {
        return PLATFORM_NINTENDO;
    }

    return PLATFORM_ALL;
}

function mapUserRegionToRegionCurrency(region: string | undefined): SettingsData['regionCurrency'] {
    const normalizedRegion = region?.trim().toLowerCase();

    const countryToRegionCurrencyMap: Record<string, SettingsData['regionCurrency']> = {
        'au': 'aud-au',
        'be': 'eur-be',
        'br': 'brl-br',
        'ca': 'cad-ca',
        'dk': 'dkk-dk',
        'eu': 'eur-eu',
        'fi': 'eur-fi',
        'fr': 'eur-fr',
        'de': 'eur-de',
        'ie': 'eur-ie',
        'it': 'eur-it',
        'nl': 'eur-nl',
        'no': 'nok-no',
        'pl': 'pln-pl',
        'es': 'eur-es',
        'se': 'sek-se',
        'ch': 'chf-ch',
        'gb': 'gbp-gb',
        'us': 'usd-us',
    };

    const directRegionValueMap: Record<string, SettingsData['regionCurrency']> = {
        'aud-au': 'aud-au',
        'eur-be': 'eur-be',
        'brl-br': 'brl-br',
        'cad-ca': 'cad-ca',
        'dkk-dk': 'dkk-dk',
        'eur-eu': 'eur-eu',
        'eur-fi': 'eur-fi',
        'eur-fr': 'eur-fr',
        'eur-de': 'eur-de',
        'eur-ie': 'eur-ie',
        'eur-it': 'eur-it',
        'eur-nl': 'eur-nl',
        'nok-no': 'nok-no',
        'pln-pl': 'pln-pl',
        'eur-es': 'eur-es',
        'sek-se': 'sek-se',
        'chf-ch': 'chf-ch',
        'gbp-gb': 'gbp-gb',
        'usd-us': 'usd-us',
    };

    if (!normalizedRegion) {
        return null;
    }

    if (directRegionValueMap[normalizedRegion]) {
        return directRegionValueMap[normalizedRegion];
    }

    if (countryToRegionCurrencyMap[normalizedRegion]) {
        return countryToRegionCurrencyMap[normalizedRegion];
    }

    const normalizedRegionParts = normalizedRegion.split('-').filter((part) => part.length > 0);
    const lastRegionPart = normalizedRegionParts[normalizedRegionParts.length - 1];

    if (lastRegionPart && countryToRegionCurrencyMap[lastRegionPart]) {
        return countryToRegionCurrencyMap[lastRegionPart];
    }

    return null;
}
function mapSettingsPlatformToUserPlatform(platform: SettingsData['platform']): string {
    if (platform === PLATFORM_STEAM) {
        return PLATFORM_PC;
    }

    return platform;
}

function mapSettingsRegionCurrencyToUserRegion(regionCurrency: RegionCurrency): string | null {
    const normalizedRegionCurrency = regionCurrency.trim().toLowerCase();
    const [, regionCode] = normalizedRegionCurrency.split('-');

    if (regionCode && regionCode.length > 0) {
        return regionCode;
    }

    return null;
}

function ExtensionSettings() {
    const [settings, setSettings] = useState<SettingsData>(() => loadSettings());
    const [appearanceSettings, setAppearanceSettings] = useState<SettingsAppearanceData>(() => loadAppearanceSettings());
    const [userSettings, setUserSettings] = useState<GGUserSettingsData | null>(() => loadGGUserSettings());
    const [isSyncingUserSettings, setIsSyncingUserSettings] = useState(false);
    const [showBlacklistAlert, setShowBlacklistAlert] = useState(false);
    const [emailUnverifiedMessage, setEmailUnverifiedMessage] = useState<string | null>(null);
    const [customMessages, setCustomMessages] = useState<GGCustomMessage[]>([]);
    const [activeTab, setActiveTab] = useState<TabKey>(() => {
        const lastActiveTab = localStorage.getItem(POPUP_LAST_ACTIVE_TAB_STORAGE_KEY);
        return isTabKey(lastActiveTab) ? lastActiveTab : DEALS;
    });

    useEffect(() => {
        let isCancelled = false;

        void acknowledgeServerMessageBadges().catch((error: unknown) => {
            console.warn('[gg.deals-extension] Failed to acknowledge server message badge:', error);
        });

        void loadCustomMessagesFromChromeStorage()
            .then((messages) => {
                if (!isCancelled) {
                    setCustomMessages(getVisibleCustomMessages(messages));
                }
            })
            .catch((error: unknown) => {
                console.warn('[gg.deals-extension] Failed to load server messages:', error);
            });

        const handleStorageChange = (
            changes: Record<string, browser.Storage.StorageChange>,
            areaName: string
        ) => {
            if (areaName !== 'local' || isCancelled) {
                return;
            }

            if (changes[GG_CUSTOM_MESSAGES]) {
                const messages = getVisibleCustomMessages(changes[GG_CUSTOM_MESSAGES].newValue);
                setCustomMessages(messages);
                if (messages.some((message) => message.badgeType === 'server' && !message.badgeAcknowledged)) {
                    void acknowledgeServerMessageBadges().catch((error: unknown) => {
                        console.warn('[gg.deals-extension] Failed to acknowledge server message badge:', error);
                    });
                }
            }
            if (changes[GG_SERVER_MESSAGE_BADGE]?.newValue === true) {
                void acknowledgeServerMessageBadges().catch((error: unknown) => {
                    console.warn('[gg.deals-extension] Failed to acknowledge server message badge:', error);
                });
            }
        };

        browser.storage.onChanged.addListener(handleStorageChange);

        return () => {
            isCancelled = true;
            browser.storage.onChanged.removeListener(handleStorageChange);
        };
    }, []);

    useEffect(() => {
        const nextExpiration = getNextCustomMessageExpiration(customMessages);
        if (nextExpiration === null) {
            return;
        }

        const timeout = window.setTimeout(() => {
            void loadCustomMessagesFromChromeStorage()
                .then((messages) => setCustomMessages(getVisibleCustomMessages(messages)))
                .catch((error: unknown) => {
                    console.warn('[gg.deals-extension] Failed to expire server messages:', error);
                });
        }, Math.min(2_147_483_647, Math.max(0, nextExpiration - Date.now())));

        return () => window.clearTimeout(timeout);
    }, [customMessages]);

    // --- Custom Indicator Scrollbar Logic ---
    const [scrollMetrics, setScrollMetrics] = useState({
        visible: false,
        thumbHeight: 0,
        thumbTop: 0
    });

    useEffect(() => {
        const calculateScrollbar = () => {
            const root = document.documentElement;
            const body = document.body;

            // Gather standard sizing metrics
            const scrollTop = window.scrollY || root.scrollTop || body.scrollTop;
            const windowHeight = window.innerHeight;
            const totalHeight = Math.max(
                body.scrollHeight,
                body.offsetHeight,
                root.scrollHeight,
                root.offsetHeight
            );

            if (totalHeight <= windowHeight) {
                setScrollMetrics({ visible: false, thumbHeight: 0, thumbTop: 0 });
                return;
            }

            const topBoundaryOffset = 112;

            const hasBottomPinnedLink = document.querySelector('.gg-settings-bottom-pinned') !== null;
            const bottomBoundaryOffset = hasBottomPinnedLink ? (48 + 4) : 4;

            const trackHeight = windowHeight - topBoundaryOffset - bottomBoundaryOffset;

            const visibleRatio = windowHeight / totalHeight;
            const calculatedThumbHeight = Math.max(36, trackHeight * visibleRatio);

            const maxWindowScrollableDistance = totalHeight - windowHeight;
            const currentScrollPercent = maxWindowScrollableDistance > 0 ? scrollTop / maxWindowScrollableDistance : 0;

            const maxThumbTravelDistance = trackHeight - calculatedThumbHeight;

            const calculatedThumbTop = topBoundaryOffset + (maxThumbTravelDistance * currentScrollPercent);

            setScrollMetrics({
                visible: true,
                thumbHeight: calculatedThumbHeight,
                thumbTop: calculatedThumbTop
            });
        };

        const resizeObserver = new ResizeObserver(() => calculateScrollbar());
        resizeObserver.observe(document.body);

        window.addEventListener('scroll', calculateScrollbar, { passive: true });
        window.addEventListener('resize', calculateScrollbar);

        calculateScrollbar();

        return () => {
            resizeObserver.disconnect();
            window.removeEventListener('scroll', calculateScrollbar);
            window.removeEventListener('resize', calculateScrollbar);
        };
    }, [activeTab]);

    function updateSettings(patch: Partial<SettingsData>, syncGGUserSettings = true) {
        setSettings((previous) => {
            const next = {
                ...previous,
                ...patch,
            };

            saveSettings(next);

            return next;
        });

        if (!syncGGUserSettings) {
            return;
        }

        setUserSettings((previous) => {
            if (!previous) {
                return previous;
            }

            const hasPlatformPatch = typeof patch.platform === 'string';
            const hasRegionPatch = typeof patch.regionCurrency === 'string';
            const hasKeyshopsPatch = typeof patch.keyshopsEnabled === 'boolean';

            if (!hasPlatformPatch && !hasRegionPatch && !hasKeyshopsPatch) {
                return previous;
            }

            const nextUserSettings: GGUserSettingsData = {
                ...previous,
                platform: hasPlatformPatch
                    ? mapSettingsPlatformToUserPlatform(patch.platform as SettingsData['platform'])
                    : previous.platform,
                region: hasRegionPatch
                    ? mapSettingsRegionCurrencyToUserRegion(patch.regionCurrency as RegionCurrency) ?? previous.region
                    : previous.region,
                showKeyshops: hasKeyshopsPatch
                    ? (patch.keyshopsEnabled as boolean)
                    : previous.showKeyshops,
            };

            saveGGUserSettings(nextUserSettings);

            return nextUserSettings;
        });
    }

    function updateAppearanceSettings(patch: Partial<SettingsAppearanceData>) {
        setAppearanceSettings((previous) => {
            const next = {
                ...previous,
                ...patch,
            };

            saveAppearanceSettings(next);

            return next;
        });
    }

    function resolveTheme(theme: string | undefined): string {
        if (theme === SETTINGS_THEME_DARK || theme === SETTINGS_THEME_LIGHT) {
            return theme;
        }

        if (theme === SETTINGS_THEME_SYSTEM) {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? SETTINGS_THEME_DARK : SETTINGS_THEME_LIGHT;
        }

        return DEFAULT_SETTINGS_THEME;
    }

    useEffect(() => {
        browser.storage.session.get([POPUP_INITIAL_TAB_STORAGE_KEY]).then((result) => {
            const initialTab = result?.[POPUP_INITIAL_TAB_STORAGE_KEY];

            if (isTabKey(initialTab)) {
                setActiveTab(initialTab);
            }

            void browser.storage.session.remove(POPUP_INITIAL_TAB_STORAGE_KEY);
        });

    }, []);

    useEffect(() => {
        localStorage.setItem(POPUP_LAST_ACTIVE_TAB_STORAGE_KEY, activeTab);
    }, [activeTab]);

    useEffect(() => {
        if (activeTab !== SETTINGS) {
            return;
        }

        browser.storage.session.get([POPUP_SETTINGS_SCROLL_TARGET_STORAGE_KEY]).then((result) => {
            const scrollTarget = result?.[POPUP_SETTINGS_SCROLL_TARGET_STORAGE_KEY];
            if (scrollTarget !== POPUP_SETTINGS_SCROLL_TARGET_BOTTOM) {
                return;
            }

            setShowBlacklistAlert(true);

            requestAnimationFrame(() => {
                const root = document.documentElement;
                const body = document.body;
                const maxScrollTop = Math.max(
                    body.scrollHeight,
                    body.offsetHeight,
                    root.scrollHeight,
                    root.offsetHeight,
                ) - window.innerHeight;

                window.scrollTo({
                    top: Math.max(0, maxScrollTop),
                    behavior: 'auto',
                });
            });

            void browser.storage.session.remove(POPUP_SETTINGS_SCROLL_TARGET_STORAGE_KEY);
        });
    }, [activeTab]);

    useEffect(() => {
        if (!userSettings) {
            return;
        }

        updateSettings({
            platform: mapUserPlatformToSettingsPlatform(userSettings.platform),
            regionCurrency: mapUserRegionToRegionCurrency(userSettings.region),
            keyshopsEnabled: userSettings.showKeyshops,
        }, false);
    }, [userSettings]);

    const synchronizeInitialUserSettings = async (): Promise<void> => {
        setIsSyncingUserSettings(true);

        try {
            const freshUserSettings = await requestGGUserSettingsSync({ mode: 'auto' });
            saveGGUserSettingsToLocalStorage(freshUserSettings);
            setUserSettings(freshUserSettings);
            console.log('[gg.deals-extension] Synchronized initial GG user settings:', freshUserSettings);
        } catch (error) {
            console.warn('[gg.deals-extension] Failed to synchronize initial GG user settings:', error);
        } finally {
            setIsSyncingUserSettings(false);
        }
    };

    async function signOut(): Promise<void> {
        // Remove login data, but keep the user's settings
        const signedOutUserSettings = signOutFromExtensionMemory();
        void browser.storage.session.remove(SHOULD_FETCH_USER_SETTINGS_AFTER_SIGN_IN_KEY);
        setUserSettings(signedOutUserSettings);
    }

    const fetchSettings = async (preserveLocalOverrides = false, options?: {
        includeApiKeyHeader?: boolean;
        openLoginPageOnMissingSession?: boolean;
    }): Promise<void> => {
        setIsSyncingUserSettings(true);

        const includeApiKeyHeader = options?.includeApiKeyHeader ?? true;
        const openLoginPageOnMissingSession = options?.openLoginPageOnMissingSession ?? true;

        try {
            const freshUserSettings = await requestGGUserSettingsSync({
                mode: 'authenticated',
                includeApiKeyHeader,
                requireAuthenticated: true,
                ...(preserveLocalOverrides ? {
                    overrides: {
                        platform: mapSettingsPlatformToUserPlatform(settings.platform),
                        ...(settings.regionCurrency ? {
                            region: mapSettingsRegionCurrencyToUserRegion(settings.regionCurrency)
                                ?? userSettings?.region,
                        } : {}),
                        showKeyshops: settings.keyshopsEnabled,
                    },
                } : {}),
            });

            if (!hasGGUserSettingsData(freshUserSettings)) {
                if (openLoginPageOnMissingSession) {
                    window.open(GG_DEALS_LOGIN_URL, '_blank', 'noopener');
                }
                return;
            }

            saveGGUserSettingsToLocalStorage(freshUserSettings);
            setUserSettings(freshUserSettings);
            console.log('[gg.deals-extension] Synchronized GG user settings:', freshUserSettings);
        }
        catch (error) {
            if (error instanceof GGInvalidApiKeyError) {
                await signOut();
                return;
            }

            console.warn('[gg.deals-extension] Failed to fetch/save GG user settings:', error);
        }
        finally {
            setIsSyncingUserSettings(false);
        }
    };

    useEffect(() => {
        browser.storage.session.get([SHOULD_FETCH_USER_SETTINGS_AFTER_SIGN_IN_KEY]).then((result) => {
            const shouldFetchAfterSignIn = result?.[SHOULD_FETCH_USER_SETTINGS_AFTER_SIGN_IN_KEY] === true;

            if (shouldFetchAfterSignIn) {
                void browser.storage.session.remove(SHOULD_FETCH_USER_SETTINGS_AFTER_SIGN_IN_KEY);
                void fetchSettings();
                return;
            }

            void synchronizeInitialUserSettings();
        });
    }, []);

    const isLoggedIn = hasGGUserSettingsData(userSettings);
    const theme = resolveTheme(appearanceSettings.theme);

    const handleSearchSubmit = (event: TargetedEvent<HTMLFormElement>) => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem('gg-ext-search');

        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        const searchQuery = input.value.trim();

        if (searchQuery.length === 0) {
            return;
        }

        const platformParam = `/${settings.platform}/`;

        const searchUrl = `https://gg.deals/search${platformParam !== '/all/' ? platformParam : '/'}?title=${encodeURIComponent(searchQuery)}`;
        window.open(searchUrl, '_blank', 'noopener');
    }

    const handleSignInFetch = () => {
        if (isSyncingUserSettings) {
            return;
        }

        void fetchSettings(false, {
            includeApiKeyHeader: false,
            openLoginPageOnMissingSession: true,
        });
    };

    const handleSignInClick = (event: TargetedEvent<HTMLAnchorElement, MouseEvent>) => {
        event.preventDefault();
        handleSignInFetch();
    };

    return (
        <section className={`gg-ext-settings theme-${theme}`} aria-label={t('extensionSettingsAria')}>
            {/* Custom Vertical Scrollbar Indicator */}
            {scrollMetrics.visible && (
                <div
                    className="gg-custom-scroll-indicator"
                    style={{
                        height: `${scrollMetrics.thumbHeight}px`,
                        top: `${scrollMetrics.thumbTop}px`
                    }}
                />
            )}

            <div className="gg-ext-settings-top">
                <a href="https://gg.deals" title={t('goToGgDeals')} className="gg-logo" target="_blank" rel="external">
                    <Icons.ICON_GG_LOGO />
                </a>

                <div className="gg-ext-settings-search-wrapper">
                    <form onSubmit={handleSearchSubmit}>
                        <input className="gg-ext-settings__search" type="text" name="gg-ext-search" placeholder="" aria-label={t('search')} />
                        <span className="gg-ext-settings-search-label">{t('searchGameOnGgDeals')}</span>
                        <button className="gg-icon-search-btn" title={t('searchOnGgDeals')}>
                            <Icons.ICON_SEARCH />
                        </button>
                    </form>
                </div>
                <div className="gg-ext-settings__login">
                    {isLoggedIn
                        ? <UserDropdown signOut={signOut} fetchSettings={fetchSettings} userSettings={userSettings} />
                        : <a
                            href="https://gg.deals/login"
                            className="gg-ext-login-link"
                            aria-busy={isSyncingUserSettings}
                            onClick={handleSignInClick}
                        >
                            <span className="gg-ext-login-label">
                                <span className="login-label-text">{t('signIn')}</span>
                                <Icons.ICON_EXT_ARROW />
                            </span>

                            <span className="gg-user-avatar">
                                <Icons.ICON_LOGIN_AVATAR />
                            </span>
                        </a>}
                </div>
            </div>
            <nav className="gg-tabs" aria-label={t('mainSettingsTabsAria')}>
                <button
                    className={`gg-tab-trigger${activeTab === DEALS ? ' is-active' : ''}`}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === DEALS}
                    aria-controls="tab-panel-deals"
                    onClick={() => setActiveTab(DEALS)}
                >
                    {t('tabDeals')}
                </button>
                <button
                    className={`gg-tab-trigger${activeTab === SETTINGS ? ' is-active' : ''}`}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === SETTINGS}
                    aria-controls="tab-panel-settings"
                    onClick={() => setActiveTab(SETTINGS)}
                >
                    {t('tabSettings')}
                </button>
                <button
                    className={`gg-tab-trigger${activeTab === APPEARANCE ? ' is-active' : ''}`}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === APPEARANCE}
                    aria-controls="tab-panel-appearance"
                    onClick={() => setActiveTab(APPEARANCE)}
                >
                    {t('tabAppearance')}
                </button>
            </nav>

            <div className="gg-tab-panel-wrapper">
                <section className="gg-tab-panel" id="tab-panel-deals" role="tabpanel" hidden={activeTab !== DEALS}>
                    {emailUnverifiedMessage && (
                        <InfoBox
                            type="warning"
                            heading={t('verifyEmailAddress')}
                            dismissStorageKey="emailUnverifiedMessageDismissed"
                        >
                            {emailUnverifiedMessage}
                        </InfoBox>
                    )}

                    {customMessages.map((message) => (
                        <InfoBox
                            key={`${message.id}:${message.fingerprint}`}
                            type={message.type ?? 'info'}
                            heading={message.title ?? t('notice')}
                            onDismiss={() => dismissCustomMessage(message.id)}
                        >
                            <CustomMessageContent message={message.message} />
                        </InfoBox>
                    ))}

                    {activeTab === DEALS && (
                        <DealsTab
                            userSettings={userSettings}
                            platform={settings.platform}
                            keyshopsEnabled={settings.keyshopsEnabled}
                            isSyncingUserSettings={isSyncingUserSettings}
                            onSignInClick={handleSignInFetch}
                            onApiKeyInvalid={signOut}
                            onEmailUnverified={setEmailUnverifiedMessage}
                        />
                    )}
                </section>

                <section className="gg-tab-panel" id="tab-panel-settings" role="tabpanel" hidden={activeTab !== SETTINGS}>
                    {activeTab === SETTINGS && (
                        <SettingsTab
                            platform={settings.platform}
                            regionCurrency={settings.regionCurrency}
                            keyshopsEnabled={settings.keyshopsEnabled}
                            barEnabled={settings.barEnabled}
                            showBlacklistAlert={showBlacklistAlert}
                            onSignInClick={handleSignInFetch}
                            onPlatformChange={(platform) => updateSettings({ platform })}
                            onRegionCurrencyChange={(regionCurrency) => updateSettings({ regionCurrency })}
                            onKeyshopsEnabledChange={(keyshopsEnabled) => updateSettings({ keyshopsEnabled })}
                            onBarEnabledChange={(barEnabled) => updateSettings({ barEnabled })}
                        />
                    )}
                </section>

                <section className="gg-tab-panel" id="tab-panel-appearance" role="tabpanel" hidden={activeTab !== APPEARANCE}>
                    {activeTab === APPEARANCE && (
                        <AppearanceTab
                            theme={appearanceSettings.theme}
                            barWidth={appearanceSettings.barWidth}
                            rounding={appearanceSettings.rounding}
                            onSignInClick={handleSignInFetch}
                            onThemeChange={(theme) => updateAppearanceSettings({ theme })}
                            onBarWidthChange={(barWidth) => updateAppearanceSettings({ barWidth })}
                            onRoundingChange={(rounding) => updateAppearanceSettings({ rounding })}
                        />
                    )}
                </section>
            </div>
        </section>
    );
}

export function mountExtensionSettings(target: HTMLElement): void {
    render(<ExtensionSettings />, target);
}

export function unmountExtensionSettings(target: HTMLElement): void {
    render(null, target);
}
