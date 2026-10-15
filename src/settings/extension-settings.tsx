import { render, type ComponentChild, type TargetedEvent } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles/extension-settings.css';
import { AppearanceTab } from './tabs/appearance-tab';
import { DealsTab } from './tabs/deals-tab';
import { SettingsTab } from './tabs/settings-tab';
import { UserDropdown } from './components/user-dropdown';
import { InfoBox } from './components/info-box';
import { LoadingState } from './components/loading-state';
import {
    APPEARANCE,
    DEALS,
    SETTINGS,
    type GGUserSettingsData,
    type TabKey,
    saveSettings,
    loadBarEnabled,
    loadSubscriptionsEnabledFromChromeStorage,
    saveSubscriptionsEnabled,
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
import { BAR_SUBSCRIPTIONS_ENABLED_STORAGE_KEY, GG_CUSTOM_MESSAGES, GG_SERVER_MESSAGE_BADGE, GG_USER_SETTINGS } from '../utils/extension-settings-constants';
import {
    GG_DEALS_LOGIN_URL,
    POPUP_INITIAL_TAB_STORAGE_KEY,
    POPUP_LAST_ACTIVE_TAB_STORAGE_KEY,
    POPUP_SETTINGS_SCROLL_TARGET_BOTTOM,
    POPUP_SETTINGS_SCROLL_TARGET_STORAGE_KEY,
    POPUP_SETTINGS_SHOW_BLACKLIST_ALERT_STORAGE_KEY,
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

function ExtensionSettings() {
    const [barEnabled, setBarEnabled] = useState<boolean>(() => loadBarEnabled());
    const [subscriptionsEnabled, setSubscriptionsEnabled] = useState<boolean | null>(null);
    const [isSavingSubscriptions, setIsSavingSubscriptions] = useState(false);
    const [appearanceSettings, setAppearanceSettings] = useState<SettingsAppearanceData>(() => loadAppearanceSettings());
    // null until the initial load resolves - user settings are complete from then on
    const [userSettings, setUserSettings] = useState<GGUserSettingsData | null>(null);
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
        let subscriptionsPreferenceChanged = false;

        void loadSubscriptionsEnabledFromChromeStorage()
            .then((enabled) => {
                if (!isCancelled && !subscriptionsPreferenceChanged) {
                    setSubscriptionsEnabled(enabled);
                }
            })
            .catch((error: unknown) => {
                console.warn('[gg.deals-extension] Failed to load subscriptions visibility:', error);
            });

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

            if (changes[BAR_SUBSCRIPTIONS_ENABLED_STORAGE_KEY]) {
                subscriptionsPreferenceChanged = true;
                setSubscriptionsEnabled(changes[BAR_SUBSCRIPTIONS_ENABLED_STORAGE_KEY].newValue !== false);
            }

            const nextUserSettings = changes[GG_USER_SETTINGS]?.newValue as GGUserSettingsData | undefined;
            if (nextUserSettings) {
                saveGGUserSettingsToLocalStorage(nextUserSettings);
                setUserSettings((current) => JSON.stringify(current) === JSON.stringify(nextUserSettings)
                    ? current
                    : nextUserSettings);
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
        let animationFrameId: number | null = null;

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
                setScrollMetrics((current) => (
                    current.visible || current.thumbHeight !== 0 || current.thumbTop !== 0
                        ? { visible: false, thumbHeight: 0, thumbTop: 0 }
                        : current
                ));
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

            setScrollMetrics((current) => (
                current.visible
                    && current.thumbHeight === calculatedThumbHeight
                    && current.thumbTop === calculatedThumbTop
                    ? current
                    : {
                        visible: true,
                        thumbHeight: calculatedThumbHeight,
                        thumbTop: calculatedThumbTop,
                    }
            ));
        };

        const scheduleScrollbarCalculation = () => {
            if (animationFrameId !== null) {
                return;
            }

            animationFrameId = requestAnimationFrame(() => {
                animationFrameId = null;
                calculateScrollbar();
            });
        };

        const resizeObserver = new ResizeObserver(scheduleScrollbarCalculation);
        resizeObserver.observe(document.body);

        window.addEventListener('scroll', scheduleScrollbarCalculation, { passive: true });
        window.addEventListener('resize', scheduleScrollbarCalculation);

        calculateScrollbar();

        return () => {
            resizeObserver.disconnect();
            window.removeEventListener('scroll', scheduleScrollbarCalculation);
            window.removeEventListener('resize', scheduleScrollbarCalculation);
            if (animationFrameId !== null) {
                cancelAnimationFrame(animationFrameId);
            }
        };
    }, [activeTab]);

    function updateUserSettings(
        current: GGUserSettingsData,
        patch: Partial<Pick<GGUserSettingsData, 'platform' | 'region' | 'showKeyshops'>>,
    ) {
        const nextUserSettings: GGUserSettingsData = {
            ...current,
            ...patch,
        };

        saveGGUserSettings(nextUserSettings);
        setUserSettings(nextUserSettings);
    }

    async function updateSubscriptionsEnabled(enabled: boolean): Promise<void> {
        setIsSavingSubscriptions(true);
        try {
            await saveSubscriptionsEnabled(enabled);
            setSubscriptionsEnabled(enabled);
        } catch (error: unknown) {
            console.warn('[gg.deals-extension] Failed to save subscriptions visibility:', error);
        } finally {
            setIsSavingSubscriptions(false);
        }
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
        if (activeTab !== SETTINGS || !userSettings) {
            return;
        }

        browser.storage.session.get([
            POPUP_SETTINGS_SCROLL_TARGET_STORAGE_KEY,
            POPUP_SETTINGS_SHOW_BLACKLIST_ALERT_STORAGE_KEY,
        ]).then((result) => {
            const scrollTarget = result?.[POPUP_SETTINGS_SCROLL_TARGET_STORAGE_KEY];
            if (scrollTarget !== POPUP_SETTINGS_SCROLL_TARGET_BOTTOM) {
                return;
            }

            setShowBlacklistAlert(result[POPUP_SETTINGS_SHOW_BLACKLIST_ALERT_STORAGE_KEY] === true);

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

            void browser.storage.session.remove([
                POPUP_SETTINGS_SCROLL_TARGET_STORAGE_KEY,
                POPUP_SETTINGS_SHOW_BLACKLIST_ALERT_STORAGE_KEY,
            ]);
        });
    }, [activeTab, userSettings]);

    useEffect(() => {
        if (!userSettings) {
            return;
        }

        saveSettings({
            platform: userSettings.platform,
            region: userSettings.region,
            keyshopsEnabled: userSettings.showKeyshops,
            barEnabled,
        });
    }, [userSettings, barEnabled]);

    const loadInitialUserSettings = async (): Promise<void> => {
        setIsSyncingUserSettings(true);

        try {
            const initialUserSettings = await loadGGUserSettings();
            setUserSettings(initialUserSettings);
            console.log('[gg.deals-extension] Loaded initial GG user settings:', initialUserSettings);
        } catch (error) {
            console.warn('[gg.deals-extension] Failed to load initial GG user settings:', error);
        } finally {
            setIsSyncingUserSettings(false);
        }
    };

    async function signOut(): Promise<void> {
        // Remove login data, but keep the user's settings
        const signedOutUserSettings = signOutFromExtensionMemory(userSettings ?? await loadGGUserSettings());
        setUserSettings(signedOutUserSettings);
    }

    const fetchSettings = async (preserveLocalSettings = false, options?: {
        includeApiKeyHeader?: boolean;
        openLoginPageOnMissingSession?: boolean;
    }): Promise<void> => {
        setIsSyncingUserSettings(true);

        const includeApiKeyHeader = options?.includeApiKeyHeader ?? true;
        const openLoginPageOnMissingSession = options?.openLoginPageOnMissingSession ?? true;

        try {
            // Signing in adds the account to the settings the extension already uses,
            // it does not replace platform, region and keyshops with the account ones
            const localUserSettings = preserveLocalSettings ? await loadGGUserSettings() : null;
            const freshUserSettings = await requestGGUserSettingsSync({
                mode: 'authenticated',
                includeApiKeyHeader,
                requireAuthenticated: true,
                ...(localUserSettings ? {
                    overrides: {
                        platform: localUserSettings.platform,
                        region: localUserSettings.region,
                        showKeyshops: localUserSettings.showKeyshops,
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
        void loadInitialUserSettings();
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

        const platform = userSettings?.platform;

        const searchUrl = `https://gg.deals/search${platform && platform !== 'all' ? `/${platform}/` : '/'}?title=${encodeURIComponent(searchQuery)}`;
        window.open(searchUrl, '_blank', 'noopener');
    }

    const handleSignInFetch = () => {
        if (isSyncingUserSettings) {
            return;
        }

        void fetchSettings(true, {
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
                            href="https://gg.deals/login/"
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

                    {activeTab === DEALS && (userSettings
                        ? <DealsTab
                            userSettings={userSettings}
                            isSyncingUserSettings={isSyncingUserSettings}
                            onSignInClick={handleSignInFetch}
                            onApiKeyInvalid={signOut}
                            onEmailUnverified={setEmailUnverifiedMessage}
                        />
                        : <LoadingState />
                    )}
                </section>

                <section className="gg-tab-panel" id="tab-panel-settings" role="tabpanel" hidden={activeTab !== SETTINGS}>
                    {activeTab === SETTINGS && (userSettings
                        ? <SettingsTab
                            isLoggedIn={isLoggedIn}
                            platform={userSettings.platform}
                            region={userSettings.region}
                            keyshopsEnabled={userSettings.showKeyshops}
                            subscriptionsEnabled={subscriptionsEnabled}
                            isSavingSubscriptions={isSavingSubscriptions}
                            barEnabled={barEnabled}
                            showBlacklistAlert={showBlacklistAlert}
                            onSignInClick={handleSignInFetch}
                            onPlatformChange={(platform) => updateUserSettings(userSettings, { platform })}
                            onRegionChange={(region) => updateUserSettings(userSettings, { region })}
                            onKeyshopsEnabledChange={(showKeyshops) => updateUserSettings(userSettings, { showKeyshops })}
                            onSubscriptionsEnabledChange={(enabled) => { void updateSubscriptionsEnabled(enabled); }}
                            onBarEnabledChange={setBarEnabled}
                        />
                        : <LoadingState />
                    )}
                </section>

                <section className="gg-tab-panel" id="tab-panel-appearance" role="tabpanel" hidden={activeTab !== APPEARANCE}>
                    {activeTab === APPEARANCE && (userSettings
                        ? <AppearanceTab
                            isLoggedIn={isLoggedIn}
                            theme={appearanceSettings.theme}
                            barWidth={appearanceSettings.barWidth}
                            rounding={appearanceSettings.rounding}
                            onSignInClick={handleSignInFetch}
                            onThemeChange={(theme) => updateAppearanceSettings({ theme })}
                            onBarWidthChange={(barWidth) => updateAppearanceSettings({ barWidth })}
                            onRoundingChange={(rounding) => updateAppearanceSettings({ rounding })}
                        />
                        : <LoadingState />
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
