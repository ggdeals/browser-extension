// This file exports functions called when the bar is injected into pages.
import {
    STEAM_APP_URL_PREFIX,
    GAME_BILLET_PRODUCT_URL_PREFIX,
    TWO_GAME_PRODUCT_URL_PREFIX,
    XBOX_PRODUCT_URL_PREFIX,
    GAMESPLANET_PRODUCT_URL_PREFIX,
    FANATICAL_PRODUCT_URL_PREFIX,
    EPIC_GAMES_PRODUCT_URL_PREFIX,
    PLANETPLAY_PRODUCT_URL_PREFIX,
    ALLYOUPLAY_PC_PREFIX,
    GREENMANGAMING_GAMES_PREFIX,
    GAMERSGATE_PRODUCT_PREFIX,
    GAMERS_OUTLET_PRODUCT_PREFIX,
    GAMERALL_PRODUCT_PREFIX,
    JOYBUGGY_PREFIX,
    GAMEBOOST_PRODUCT_PREFIX,
    DRIFFLE_PRODUCT_PREFIX,
    DISCOVER_GAMES_PRODUCT_PREFIX,
    ELDORADO_PRODUCT_PREFIX,
    DIFMARK_PRODUCT_PREFIX,
    GAMIVO_PRODUCT_PREFIX,
    GAMESEAL_PRODUCT_PREFIX,
    KINGUIN_PRODUCT_PREFIX,
    G2PLAY_PRODUCT_PREFIX,
    KEYCENSE_PRODUCT_PREFIX,
    LOADED_PRODUCT_PREFIX,
    PREMIUMCDKEYS_PRODUCT_PREFIX,
    INSTANT_GAMING_PRODUCT_PREFIX,
    K4G_PRODUCT_PREFIX,
    ENEBA_PRODUCT_PREFIX,
    G2A_PRODUCT_PREFIX,
    HRK_GAME_PRODUCT_PREFIX,
    YUPLAY_PRODUCT_PREFIX,
    MUVE_PRODUCT_PREFIX,
    MTCGAME_PRODUCT_PREFIX,
    NEWEGG_PRODUCT_PREFIX,
    ROCKSTAR_STORE_PRODUCT_PREFIX,
    CHEAP_GAMING_PRODUCT_PREFIX,
    ELECTRONIC_FIRST_PRODUCT_PREFIX,
    AMAZON_PRODUCT_PREFIX,
    PLAY_ASIA_PRODUCT_PREFIX,
    DREAMGAME_PRODUCT_PREFIX,
    FORTUNADIGITAL_PRODUCT_PREFIX,
    GAMESTOP_PRODUCT_PREFIX,
    GOG_GAME_PREFIX,
    HYPE_GAMES_PRODUCT_PREFIX,
    INDIEGALA_STORE_GAME_PREFIX,
    LOOTBAR_PRODUCT_PREFIX,
    LDSHOP_PRODUCT_PREFIX,
    NINTENDO_STORE_PRODUCT_PREFIX,
    NUUVEM_ITEM_PREFIX,
    EA_GAME_PREFIX,
    PLAYER_LAND_PREFIX,
    PLAYSUM_PRODUCT_PREFIX,
    PLAYSTATION_PRODUCT_PREFIX,
    STARTSELECT_PRODUCT_PREFIX,
    UBISOFT_STORE_PRODUCT_PREFIX,
    UBISOFT_GAME_EDITION_PREFIX,
    BATTLE_NET_PRODUCT_PREFIX,
    ISTHEREANYDEAL_GAME_PREFIX,
    LESTRADES_GAME_PREFIX,
    BARTER_VG_ITEM_PREFIX,
    STEAMDB_APP_PREFIX,
    STEAMCHARTS_APP_PREFIX,
    HOWLONGTOBEAT_GAME_PREFIX,
    METACRITIC_GAME_PREFIX,
    OPENCRITIC_GAME_PREFIX,
    RELEASES_PRODUCT_PREFIX,
    EGDATA_OFFER_PREFIX,
    IGDB_GAME_PREFIX,
    GRY_ONLINE_GAME_PREFIX,
    GAMEPRESSURE_GAME_PREFIX,
} from './regexes';
import {
    WINGAMESTORE_PRODUCT_URL_PREFIX,
    HUMBLE_STORE_PRODUCT_URL_PREFIX,
    TRZYKROPKI_PRODUCT_PREFIX,
    GAMESPORIUM_PRODUCTS_PREFIX,
    API_URL,
    API_GAMES_URL,
    BAR_THEME_DARK,
    BAR_THEME_LIGHT,
    BAR_THEME_SYSTEM,
    DEFAULT_BAR_THEME,
    BAR_LAYOUT_ROUNDED,
    BAR_LAYOUT_ROUNDED_CORNERS,
    BAR_LAYOUT_ROUNDED_TOP,
    BAR_LAYOUT_BOTTOM_EDGE,
    DEFAULT_BAR_LAYOUT,
    BAR_WIDTH_FIXED,
    BAR_WIDTH_FIT_CONTENT,
    BAR_WIDTH_EDGE_TO_EDGE,
    DEFAULT_BAR_WIDTH,
} from './constants';
import { extractPageIdentityFromLdJson } from './ld-json-helpers';
import { resolveBottomBarPageContext, waitForRequiredDomainTitle } from '../integrations';
import {
    loadGGUserSettingsFromChromeStorage,
    loadSettingsFromChromeStorage,
    requestGGUserSettingsSync,
    isInvalidApiKeyResponse,
    DEFAULT_EXTENSION_SETTINGS,
    SIGNED_OUT_GG_USER_SETTINGS,
    type GGGame,
    type GGGameLookupResponse,
    type SettingsData,
} from '../../utils/extension-settings';
import {
    APPEARANCE_STORAGE_KEY,
    EXCLUDED_WEBSITES_STORAGE_KEY,
    GG_USER_SETTINGS,
    SETTINGS_STORAGE_KEY
} from '../../utils/extension-settings-constants';
import browser from 'webextension-polyfill';
import type { BarGameRequestPayload, BarGamesRequestPayload } from '../integrations/types';

type ProductUrlRule = string | RegExp;

const PRODUCT_URL_RULES: ProductUrlRule[] = [
    STEAM_APP_URL_PREFIX,
    WINGAMESTORE_PRODUCT_URL_PREFIX,
    GAME_BILLET_PRODUCT_URL_PREFIX,
    TWO_GAME_PRODUCT_URL_PREFIX,
    XBOX_PRODUCT_URL_PREFIX,
    GAMESPLANET_PRODUCT_URL_PREFIX,
    FANATICAL_PRODUCT_URL_PREFIX,
    EPIC_GAMES_PRODUCT_URL_PREFIX,
    PLANETPLAY_PRODUCT_URL_PREFIX,
    HUMBLE_STORE_PRODUCT_URL_PREFIX,
    ALLYOUPLAY_PC_PREFIX,
    GREENMANGAMING_GAMES_PREFIX,
    GAMERSGATE_PRODUCT_PREFIX,
    GAMERS_OUTLET_PRODUCT_PREFIX,
    GAMERALL_PRODUCT_PREFIX,
    JOYBUGGY_PREFIX,
    TRZYKROPKI_PRODUCT_PREFIX,
    GAMESPORIUM_PRODUCTS_PREFIX,
    GAMEBOOST_PRODUCT_PREFIX,
    DRIFFLE_PRODUCT_PREFIX,
    DISCOVER_GAMES_PRODUCT_PREFIX,
    ELDORADO_PRODUCT_PREFIX,
    DIFMARK_PRODUCT_PREFIX,
    GAMIVO_PRODUCT_PREFIX,
    GAMESEAL_PRODUCT_PREFIX,
    KINGUIN_PRODUCT_PREFIX,
    G2PLAY_PRODUCT_PREFIX,
    KEYCENSE_PRODUCT_PREFIX,
    LOADED_PRODUCT_PREFIX,
    PREMIUMCDKEYS_PRODUCT_PREFIX,
    INSTANT_GAMING_PRODUCT_PREFIX,
    K4G_PRODUCT_PREFIX,
    ENEBA_PRODUCT_PREFIX,
    G2A_PRODUCT_PREFIX,
    HRK_GAME_PRODUCT_PREFIX,
    YUPLAY_PRODUCT_PREFIX,
    MUVE_PRODUCT_PREFIX,
    MTCGAME_PRODUCT_PREFIX,
    NEWEGG_PRODUCT_PREFIX,
    ROCKSTAR_STORE_PRODUCT_PREFIX,
    CHEAP_GAMING_PRODUCT_PREFIX,
    ELECTRONIC_FIRST_PRODUCT_PREFIX,
    AMAZON_PRODUCT_PREFIX,
    PLAY_ASIA_PRODUCT_PREFIX,
    DREAMGAME_PRODUCT_PREFIX,
    FORTUNADIGITAL_PRODUCT_PREFIX,
    GAMESTOP_PRODUCT_PREFIX,
    GOG_GAME_PREFIX,
    HYPE_GAMES_PRODUCT_PREFIX,
    INDIEGALA_STORE_GAME_PREFIX,
    LOOTBAR_PRODUCT_PREFIX,
    LDSHOP_PRODUCT_PREFIX,
    NINTENDO_STORE_PRODUCT_PREFIX,
    NUUVEM_ITEM_PREFIX,
    EA_GAME_PREFIX,
    PLAYER_LAND_PREFIX,
    PLAYSUM_PRODUCT_PREFIX,
    PLAYSTATION_PRODUCT_PREFIX,
    STARTSELECT_PRODUCT_PREFIX,
    UBISOFT_STORE_PRODUCT_PREFIX,
    UBISOFT_GAME_EDITION_PREFIX,
    BATTLE_NET_PRODUCT_PREFIX,
    ISTHEREANYDEAL_GAME_PREFIX,
    LESTRADES_GAME_PREFIX,
    BARTER_VG_ITEM_PREFIX,
    STEAMDB_APP_PREFIX,
    STEAMCHARTS_APP_PREFIX,
    HOWLONGTOBEAT_GAME_PREFIX,
    METACRITIC_GAME_PREFIX,
    OPENCRITIC_GAME_PREFIX,
    RELEASES_PRODUCT_PREFIX,
    EGDATA_OFFER_PREFIX,
    IGDB_GAME_PREFIX,
    GRY_ONLINE_GAME_PREFIX,
    GAMEPRESSURE_GAME_PREFIX,
];

type GameDataResponse = {
    success: boolean;
    data: GGGame[];
};

type NestedGameDataResponse = {
    success?: boolean;
    data?: GameDataResponse;
};

type GameEntry = GGGame;

type RuntimeMessageResponse = {
    ok: boolean;
    data?: unknown;
    error?: string;
};

type AppearanceSettingsPayload = {
    theme?: string;
    barWidth?: string;
    rounding?: string;
};

type BarDebugData = {
    request: BarGameRequestPayload | BarGamesRequestPayload;
    response: unknown;
};

let pendingBarGameData: GameDataResponse | null = null;
let pendingBarDebugData: BarDebugData | null = null;
let currentBarElement: HTMLElement | null = null;

async function clearExtensionSessionInStorage(): Promise<void> {
    if (!browser.storage?.local) {
        return;
    }

    const existingUserSettings = await loadGGUserSettingsFromChromeStorage();
    await browser.storage.local.set({
        [GG_USER_SETTINGS]: {
            ...SIGNED_OUT_GG_USER_SETTINGS,
            platform: existingUserSettings?.platform ?? SIGNED_OUT_GG_USER_SETTINGS.platform,
            region: existingUserSettings?.region ?? SIGNED_OUT_GG_USER_SETTINGS.region,
            showKeyshops: existingUserSettings?.showKeyshops ?? SIGNED_OUT_GG_USER_SETTINGS.showKeyshops,
        },
    });
}

let barChange_TO: any;
const appliedBarAppearance = new WeakMap<HTMLElement, Required<AppearanceSettingsPayload>>();

const KEYSHOPS_HIDDEN_CLASS = 'keyshops-hidden';
const DOMAIN_HIDDEN_CLASS = 'domain-hidden';
let appearanceChangeListenerInstalled = false;
let systemThemeChangeListenerInstalled = false;

const BOTTOM_BAR_DEBUG_ENABLED = ['1', 'true', 'yes', 'on']
    .includes(String(import.meta.env.VITE_BOTTOM_BAR_DEBUG ?? '').toLowerCase());

const TITLE_DROPDOWN_ARROW_PATH = 'M5.67063 9.82806C5.70733 9.88136 5.75644 9.92494 5.81372 9.95505C5.871 9.98515 5.93475 10.0009 5.99946 10.0009C6.06417 10.0009 6.12791 9.98515 6.1852 9.95505C6.24248 9.92494 6.29158 9.88136 6.32828 9.82806L9.92857 4.62765C9.97024 4.56767 9.99468 4.49741 9.99923 4.42452C10.0038 4.35162 9.98826 4.27887 9.95436 4.21417C9.92047 4.14948 9.86949 4.09531 9.80697 4.05755C9.74445 4.01979 9.67278 3.99989 9.59974 4H2.39918C2.32631 4.0003 2.2549 4.02046 2.19263 4.05831C2.13036 4.09616 2.07959 4.15027 2.04578 4.21481C2.01196 4.27936 1.99638 4.35191 2.00071 4.42465C2.00504 4.49739 2.02912 4.56757 2.07035 4.62765L5.67063 9.82806Z';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function createTitleDropdownArrowIcon(): SVGSVGElement {
    const icon = document.createElementNS(SVG_NAMESPACE, 'svg');
    icon.classList.add('svg-icon');
    icon.setAttribute('width', '12');
    icon.setAttribute('height', '12');
    icon.setAttribute('viewBox', '0 0 12 12');
    icon.setAttribute('fill', 'none');

    const path = document.createElementNS(SVG_NAMESPACE, 'path');
    path.setAttribute('d', TITLE_DROPDOWN_ARROW_PATH);
    path.setAttribute('fill', 'currentColor');
    icon.appendChild(path);

    return icon;
}

function logBottomBarDebugReason(reason: string, payload?: Record<string, unknown>): void {
    if (!BOTTOM_BAR_DEBUG_ENABLED) {
        return;
    }

    if (payload === undefined) {
        console.warn('[gg.deals-extension][bar][debug] Bottom bar not injected:', reason);
        return;
    }

    console.warn('[gg.deals-extension][bar][debug] Bottom bar not injected:', reason, payload);
}

function hasRenderableGameData(data: unknown): data is GameDataResponse {
    if (!data || typeof data !== 'object') {
        return false;
    }

    const payload = data as GameDataResponse;
    return Array.isArray(payload?.data) && payload.data.length > 0;
}

function isGameLookupResponse(data: unknown): data is GGGameLookupResponse {
    if (!data || typeof data !== 'object') {
        return false;
    }

    const payload = data as Partial<GGGameLookupResponse>;
    if (typeof payload.success !== 'boolean' || !payload.data || typeof payload.data !== 'object') {
        return false;
    }

    const { foundBy, games } = payload.data;
    return (
        (foundBy === 'url' || foundBy === 'title' || foundBy === null)
        && Array.isArray(games)
    );
}

function normalizeGameData(data: unknown): GameDataResponse | null {
    if (hasRenderableGameData(data)) {
        return data;
    }

    if (isGameLookupResponse(data) && data.success && data.data.games.length > 0) {
        return {
            success: true,
            data: data.data.games,
        };
    }

    if (!data || typeof data !== 'object') {
        return null;
    }

    const nested = data as NestedGameDataResponse;
    if (hasRenderableGameData(nested.data)) {
        return nested.data;
    }

    return null;
}

function formatDebugJson(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2) ?? 'null';
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return `Unable to format debugging data: ${errorMessage}`;
    }
}

function renderBarDebugData(barElement: HTMLElement, debugData: BarDebugData | null): void {
    if (!debugData) {
        return;
    }

    const requestElement = barElement.querySelector<HTMLElement>('.gg-bar-debug-request-json');
    const responseElement = barElement.querySelector<HTMLElement>('.gg-bar-debug-response-json');

    if (requestElement) {
        requestElement.textContent = formatDebugJson(debugData.request);
    }

    if (responseElement) {
        responseElement.textContent = formatDebugJson(debugData.response);
    }
}

// async function fetchGameData(): Promise<GameDataResponse> {
//     const response = await browser.runtime.sendMessage({
//         type: 'FETCH_TEST_GAME_DATA',
//         url: URL
//     }) as RuntimeMessageResponse;
//
//     if (!response?.ok) {
//         throw new Error(response?.error ?? 'Failed to fetch fallback game data');
//     }
//
//     const normalizedData = normalizeGameData(response.data);
//     if (!normalizedData) {
//         throw new Error('Fallback game data payload is missing required fields');
//     }
//
//     return normalizedData;
// }

export function isSupportedProductPage(url: string): boolean {
    const normalizedUrl = url.replace('://www.', '://');

    return PRODUCT_URL_RULES.some((rule) => {
        if (typeof rule === 'string') {
            const normalizedRule = rule.replace('://www.', '://');
            return normalizedUrl.startsWith(normalizedRule);
        }

        // Accept both www and non-www variants even when regex was authored with one form
        const normalizedRuleSource = rule.source.replace('https:\\/\\/www\\.', 'https:\\/\\/(?:www\\.)?');
        const normalizedRule = new RegExp(normalizedRuleSource, rule.flags);

        return normalizedRule.test(url) || normalizedRule.test(normalizedUrl);
    });
}

function renderGameData(container: HTMLElement, data: GameDataResponse): void {
    const entries = data.data;
    if (!Array.isArray(entries) || entries.length === 0) {
        return;
    }

    const offersContainer = container.querySelector('.gg-bar-game-offers');
    const gameLink = container.querySelector<HTMLAnchorElement>('.gg-bar-game-link');
    const fullLink = container.querySelector<HTMLAnchorElement>('.full-link');
    const titleRoot = container.querySelector<HTMLElement>('.gg-bar-game-title');

    const renderSelectedGame = (gameData: GameEntry): void => {
        const name = typeof gameData.title === 'string' && gameData.title.trim().length > 0
            ? gameData.title.trim()
            : 'Unknown game';

        const priceRetail = typeof gameData.prices?.currentRetail?.price === 'string' && gameData.prices.currentRetail.price.trim().length > 0
            ? gameData.prices.currentRetail.price.trim()
            : '-';

        const priceKeyshop = typeof gameData.prices?.currentKeyshops?.price === 'string' && gameData.prices.currentKeyshops.price.trim().length > 0
            ? gameData.prices.currentKeyshops.price.trim()
            : '-';

        const gameUrl = gameData.url;
        const priceRetailHistorical = gameData.prices?.currentRetail?.isHistoricalLow ?? false;
        const priceKeyshopHistorical = gameData.prices?.currentKeyshops?.isHistoricalLow ?? false;

        if (offersContainer) {
            const priceRetailContainer = offersContainer.querySelector('.game-price-retail');
            if (priceRetailContainer) {
                priceRetailContainer.textContent = priceRetail;

                if (priceRetailHistorical) {
                    priceRetailContainer.classList.add('historical');
                } else {
                    priceRetailContainer.classList.remove('historical');
                }
            }

            const priceKeyshopContainer = offersContainer.querySelector('.game-price-keyshop');
            if (priceKeyshopContainer) {
                priceKeyshopContainer.textContent = priceKeyshop;

                if (priceKeyshopHistorical) {
                    priceKeyshopContainer.classList.add('historical');
                } else {
                    priceKeyshopContainer.classList.remove('historical');
                }
            }
        }

        if (gameLink && gameUrl) {
            gameLink.setAttribute('href', gameUrl);
        }

        if (fullLink && gameUrl) {
            fullLink.setAttribute('href', gameUrl);
        }

        if (titleRoot) {
            const activeTitle = titleRoot.querySelector<HTMLElement>('.gg-bar-dropdown-active, [data-gg-game-info="title"]');
            if (activeTitle) {
                activeTitle.textContent = name;
            }
        }
    };

    const renderTitleSelector = (selectedIndex: number): void => {
        if (!titleRoot) {
            return;
        }

        titleRoot.replaceChildren();

        const selectedEntry = entries[selectedIndex];
        const selectedTitle = typeof selectedEntry?.title === 'string' && selectedEntry.title.trim().length > 0
            ? selectedEntry.title.trim()
            : 'Unknown game';

        if (entries.length === 1) {
            const titleSpan = document.createElement('span');
            titleSpan.className = 'title-label';
            titleSpan.dataset.ggGameInfo = 'title';
            titleSpan.textContent = selectedTitle;
            titleRoot.appendChild(titleSpan);
            return;
        }

        const dropdownWrapper = document.createElement('div');
        dropdownWrapper.className = 'gg-bar-dropdown gg-bar-game-title-dropdown dropdown-left';

        const triggerButton = document.createElement('button');
        triggerButton.className = 'gg-options-btn';
        triggerButton.dataset.action = 'bar-dropdown-trigger';
        triggerButton.type = 'button';

        const activeTitle = document.createElement('span');
        activeTitle.className = 'title-label gg-bar-dropdown-active';
        activeTitle.dataset.ggGameInfo = 'title';
        activeTitle.textContent = selectedTitle;

        const arrow = document.createElement('span');
        arrow.className = 'gg-bar-dropdown-arrow';
        arrow.appendChild(createTitleDropdownArrowIcon());

        triggerButton.appendChild(activeTitle);
        triggerButton.appendChild(arrow);
        dropdownWrapper.appendChild(triggerButton);

        const optionsList = document.createElement('div');
        optionsList.className = 'gg-options-list';

        entries.forEach((entry, index) => {
            if (index === selectedIndex) {
                return;
            }

            const option = document.createElement('div');
            option.className = 'gg-option-single';
            option.dataset.action = 'dropdown-title-option';
            option.dataset.gameIndex = String(index);

            const label = document.createElement('span');
            label.className = 'gg-option-label';
            label.textContent = typeof entry.title === 'string' && entry.title.trim().length > 0
                ? entry.title.trim()
                : 'Unknown game';

            option.appendChild(label);
            option.addEventListener('click', (event: MouseEvent): void => {
                event.stopPropagation();
                renderSelectedGame(entries[index]);
                renderTitleSelector(index);
            });

            optionsList.appendChild(option);
        });

        dropdownWrapper.appendChild(optionsList);

        triggerButton.addEventListener('click', (event: MouseEvent): void => {
            event.stopPropagation();
            dropdownWrapper.classList.toggle('open');
        });

        titleRoot.appendChild(dropdownWrapper);
    };

    renderSelectedGame(entries[0]);
    renderTitleSelector(0);
}

function setBarTheme(barElement: HTMLElement, colorTheme: string): void {
    if (colorTheme !== BAR_THEME_DARK && colorTheme !== BAR_THEME_LIGHT) { return; }

    barElement.classList.remove('theme-light');
    barElement.classList.remove('theme-dark');
    barElement.classList.add('theme-' + colorTheme);
}
function setBarLayout(barElement: HTMLElement, layoutTheme: string): void {
    if (layoutTheme !== BAR_LAYOUT_ROUNDED
        && layoutTheme !== BAR_LAYOUT_ROUNDED_CORNERS
        && layoutTheme !== BAR_LAYOUT_ROUNDED_TOP
        && layoutTheme !== BAR_LAYOUT_BOTTOM_EDGE) { return; }

    barElement.classList.remove('layout-rounded');
    barElement.classList.remove('layout-rounded-corners');
    barElement.classList.remove('layout-rounded-top');
    barElement.classList.remove('layout-bottom-edge');

    if (layoutTheme === BAR_LAYOUT_BOTTOM_EDGE) {
        barElement.classList.remove('width-fixed');
        barElement.classList.remove('width-fit-content');
    }

    barElement.classList.add('layout-' + layoutTheme);
}

function setBarWidth(barElement: HTMLElement, barWidth: string): void {
    if (barWidth !== BAR_WIDTH_FIXED && barWidth !== BAR_WIDTH_FIT_CONTENT) {
        return;
    }

    barElement.classList.remove('width-fixed');
    barElement.classList.remove('width-fit-content');
    barElement.classList.add('width-' + barWidth);
}

function resolveTheme(theme: string | undefined): string {
    if (theme === BAR_THEME_DARK || theme === BAR_THEME_LIGHT) {
        return theme;
    }

    if (theme === BAR_THEME_SYSTEM) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? BAR_THEME_DARK : BAR_THEME_LIGHT;
    }

    return DEFAULT_BAR_THEME;
}

function resolveLayout(layout: string | undefined, width: string): string {
    if (width === BAR_WIDTH_EDGE_TO_EDGE) {
        return BAR_LAYOUT_BOTTOM_EDGE;
    }

    if (layout === BAR_LAYOUT_ROUNDED
        || layout === BAR_LAYOUT_ROUNDED_CORNERS
        || layout === BAR_LAYOUT_ROUNDED_TOP
        || layout === BAR_LAYOUT_BOTTOM_EDGE) {
        return layout;
    }

    return DEFAULT_BAR_LAYOUT;
}

function resolveBarWidth(width: string | undefined): string {
    if (width === BAR_WIDTH_FIXED || width === BAR_WIDTH_FIT_CONTENT || width === BAR_WIDTH_EDGE_TO_EDGE) {
        return width;
    }

    return DEFAULT_BAR_WIDTH;
}

function applyAppearanceToBar(barElement: HTMLElement, settings: AppearanceSettingsPayload | null, force: boolean = false): void {
    // if possible - timeouts and toggling 'shown' class gonna be only needed for layout === 'bottom-edge'
    const barWidth = resolveBarWidth(settings?.barWidth);
    const theme = resolveTheme(settings?.theme);
    const layout = resolveLayout(settings?.rounding, barWidth);
    const previousAppearance = appliedBarAppearance.get(barElement);
    const themeChanged = force || previousAppearance?.theme !== theme;
    const barWidthChanged = force || previousAppearance?.barWidth !== barWidth;
    const layoutChanged = force || previousAppearance?.rounding !== layout;

    clearTimeout(barChange_TO);

    if (!themeChanged && !barWidthChanged && !layoutChanged) {
        barElement.classList.add('shown');
        return;
    }

    barElement.classList.remove('shown');

    const applyChanges = (): void => {
        if (themeChanged) {
            setBarTheme(barElement, theme);
        }
        if (barWidthChanged) {
            setBarWidth(barElement, barWidth);
        }
        if (layoutChanged) {
            setBarLayout(barElement, layout);
        }

        appliedBarAppearance.set(barElement, {
            theme,
            barWidth,
            rounding: layout,
        });
    };

    if (force) {
        applyChanges();

        barChange_TO = setTimeout(function () {
            barElement.classList.add('shown');
        }, 200);

        return;
    }

    barChange_TO = setTimeout(function () {
        applyChanges();

        setTimeout(function () {
            barElement.classList.add('shown');
        }, 200);
    }, 200);
}

async function readAppearanceSettingsFromStorage(): Promise<AppearanceSettingsPayload | null> {
    if (!browser.storage?.local) {
        return null;
    }

    try {
        const result = await browser.storage.local.get([APPEARANCE_STORAGE_KEY]);
        const settings = result?.[APPEARANCE_STORAGE_KEY];
        if (!settings || typeof settings !== 'object') {
            return null;
        }

        return settings as AppearanceSettingsPayload;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to read appearance settings from browser.storage.local:', errorMessage);
        return null;
    }
}

function normalizeExcludedDomain(value: string): string {
    return value.trim().toLowerCase().replace(/^www\./, '');
}

function sanitizeExcludedDomains(data: unknown): string[] {
    if (!Array.isArray(data)) {
        return [];
    }

    const normalized = data
        .filter((item): item is string => typeof item === 'string')
        .map((item) => normalizeExcludedDomain(item))
        .filter((item) => item.length > 0);

    return Array.from(new Set(normalized));
}

function isHostExcluded(hostname: string, excludedDomains: string[]): boolean {
    const normalizedHost = normalizeExcludedDomain(hostname);

    return excludedDomains.some((domain) => {
        return normalizedHost === domain || normalizedHost.endsWith(`.${domain}`);
    });
}

async function readExcludedDomainsFromStorage(): Promise<string[]> {
    if (!browser.storage?.local) {
        return [];
    }

    try {
        const result = await browser.storage.local.get([EXCLUDED_WEBSITES_STORAGE_KEY]);
        return sanitizeExcludedDomains(result?.[EXCLUDED_WEBSITES_STORAGE_KEY]);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to read excluded websites from browser.storage.local:', errorMessage);
        return [];
    }
}

export async function isCurrentHostExcludedByPreferences(): Promise<boolean> {
    const currentHost = normalizeExcludedDomain(window.location.hostname ?? '');
    if (currentHost.length === 0) {
        return false;
    }

    const excludedDomains = await readExcludedDomainsFromStorage();
    return isHostExcluded(currentHost, excludedDomains);
}

async function addCurrentDomainToExcludedWebsites(): Promise<void> {
    if (!browser.storage?.local) {
        return;
    }

    const currentDomain = normalizeExcludedDomain(window.location.hostname ?? '');
    if (currentDomain.length === 0) {
        return;
    }

    const currentDomains = await readExcludedDomainsFromStorage();
    if (currentDomains.includes(currentDomain)) {
        return;
    }

    const nextDomains = [...currentDomains, currentDomain];
    try {
        await browser.storage.local.set({ [EXCLUDED_WEBSITES_STORAGE_KEY]: nextDomains });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to save excluded websites to browser.storage.local:', errorMessage);
    }
}

async function syncBarAppearanceFromStorage(barElement: HTMLElement): Promise<void> {
    const settings = await readAppearanceSettingsFromStorage();
    if (currentBarElement !== barElement) {
        return;
    }

    applyAppearanceToBar(barElement, settings, true);
}

function applyKeyshopsVisibility(barElement: HTMLElement, keyshopsEnabled: boolean): void {
    const keyshopElement = barElement.querySelector<HTMLElement>('#gg-bar-keyshop-label');

    if (keyshopElement) {
        keyshopElement.style.display = keyshopsEnabled ? '' : 'none';
    }

    barElement.classList.toggle(KEYSHOPS_HIDDEN_CLASS, !keyshopsEnabled);
}

async function syncKeyshopsVisibilityFromStorage(barElement: HTMLElement): Promise<void> {
    const settings = await loadSettingsFromChromeStorage();
    if (currentBarElement !== barElement) {
        return;
    }

    const keyshopsEnabled = settings?.keyshopsEnabled ?? DEFAULT_EXTENSION_SETTINGS.keyshopsEnabled;
    applyKeyshopsVisibility(barElement, keyshopsEnabled);
}

function installAppearanceSyncListeners(): void {
    if (appearanceChangeListenerInstalled || !browser.storage?.onChanged) {
        return;
    }

    browser.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') {
            return;
        }

        const appearanceChange = changes[APPEARANCE_STORAGE_KEY];
        const settingsChange = changes[SETTINGS_STORAGE_KEY];
        const excludedWebsitesChange = changes[EXCLUDED_WEBSITES_STORAGE_KEY];
        if (!appearanceChange && !settingsChange && !excludedWebsitesChange) {
            return;
        }

        // Handle bar enabled toggle even without an active bar element
        if (settingsChange) {
            const nextValue = settingsChange.newValue;
            const settingsData = nextValue && typeof nextValue === 'object'
                ? nextValue as SettingsData
                : null;

            if (settingsData && typeof settingsData.barEnabled === 'boolean') {
                if (settingsData.barEnabled && (!currentBarElement || !currentBarElement.isConnected)) {
                    // Bar was turned on - trigger re-injection
                    window.dispatchEvent(new CustomEvent('gg-extension:bartoggle'));
                    return;
                }

                if (!settingsData.barEnabled && currentBarElement?.isConnected) {
                    currentBarElement.remove();
                    currentBarElement = null;
                    return;
                }
            }
        }

        if (!currentBarElement || !currentBarElement.isConnected) {
            return;
        }

        if (excludedWebsitesChange) {
            const excludedDomains = sanitizeExcludedDomains(excludedWebsitesChange.newValue);
            const currentHost = normalizeExcludedDomain(window.location.hostname ?? '');
            currentBarElement.classList.toggle(
                DOMAIN_HIDDEN_CLASS,
                isHostExcluded(currentHost, excludedDomains),
            );
        }

        if (appearanceChange) {
            const nextValue = appearanceChange.newValue;
            const parsedValue = nextValue && typeof nextValue === 'object'
                ? nextValue as AppearanceSettingsPayload
                : null;

            applyAppearanceToBar(currentBarElement, parsedValue);
        }

        if (settingsChange) {
            const settingsData = settingsChange.newValue && typeof settingsChange.newValue === 'object'
                ? settingsChange.newValue as SettingsData
                : null;

            const keyshopsEnabled = settingsData?.keyshopsEnabled ?? DEFAULT_EXTENSION_SETTINGS.keyshopsEnabled;
            applyKeyshopsVisibility(currentBarElement, keyshopsEnabled);
        }
    });

    appearanceChangeListenerInstalled = true;

    if (!systemThemeChangeListenerInstalled) {
        const darkSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const onSystemThemeChange = (): void => {
            if (!currentBarElement || !currentBarElement.isConnected) {
                return;
            }

            void syncBarAppearanceFromStorage(currentBarElement);
        };

        darkSchemeQuery.addEventListener('change', onSystemThemeChange);

        systemThemeChangeListenerInstalled = true;
    }
}

function closeGgDropdowns(barElement: HTMLElement): void {
    const dropdownWrappers = barElement.querySelectorAll<HTMLElement>('.gg-bar-dropdown');
    dropdownWrappers.forEach((dropdown) => {
        dropdown.classList.remove('open');
    });
}

function mapSettingsPlatformToRequestPlatform(platform: SettingsData['platform']): string {
    const normalizedPlatform = platform.trim().toLowerCase();

    if (normalizedPlatform === 'pc' || normalizedPlatform === 'all') {
        return 'pc';
    }

    if (normalizedPlatform === 'switch') {
        return 'nintendo';
    }

    return normalizedPlatform;
}

export async function shouldInjectBottomBar(isStale: () => boolean = () => false): Promise<boolean> {
    // Early exit if bar is disabled in extension settings
    const barSettings = await loadSettingsFromChromeStorage();
    const barEnabled = barSettings?.barEnabled ?? DEFAULT_EXTENSION_SETTINGS.barEnabled;
    if (!barEnabled) {
        logBottomBarDebugReason('bar is disabled in extension settings');
        return false;
    }

    const ldJson: Element | null = document.querySelector('script[type="application/ld+json"]');
    const canonicalLink: HTMLLinkElement | null = document.querySelector('link[rel="canonical"]');
    const ldIdentity = extractPageIdentityFromLdJson();
    const pageHostname = normalizeExcludedDomain(window.location.hostname ?? '');
    const documentTitle = document.querySelector('title')?.textContent;
    const pageContext = await resolveBottomBarPageContext({
        hostname: pageHostname,
        documentTitle,
        ldJsonTitle: ldIdentity.title,
        canonicalUrl: canonicalLink?.href,
        ldJsonRequestUrl: ldIdentity.requestUrl,
        windowUrl: window.location.href ?? document.URL,
    });
    let title = pageContext.title;
    let hasTitle = typeof title === 'string' && title.trim().length > 0;
    const requestUrl = pageContext.requestUrl;
    const requestUrls = pageContext.requestUrls;
    const hasRequestUrl = typeof requestUrl === 'string' && requestUrl.trim().length > 0;
    const hasRequestUrls = requestUrls.length > 0;
    const excludedDomains = await readExcludedDomainsFromStorage();
    console.log('[gg.deals-extension] ld+json element:', ldJson);
    console.log('[gg.deals-extension] ld+json identity:', ldIdentity);

    if (pageContext.pageEligibility && pageContext.pageEligibility.status !== 'eligible') {
        console.info(
            '[gg.deals-extension][bar] Bottom bar not shown:',
            pageContext.pageEligibility.reason,
            {
                pageHostname,
                status: pageContext.pageEligibility.status,
                evidence: pageContext.pageEligibility.evidence ?? [],
            },
        );
        return false;
    }

    if (!hasRequestUrl && !hasRequestUrls) {
        logBottomBarDebugReason('missing request URL signal', {
            pageHostname,
            requestUrl,
            requestUrls,
            hasTitle,
            isIntegrationRequired: pageContext.isIntegrationRequired,
        });
        return false;
    }

    if (pageContext.isIntegrationRequired && !hasTitle && pageContext.titleResolveRetryMs > 0) {
        const retriedTitle = await waitForRequiredDomainTitle(pageHostname);
        if (retriedTitle) {
            title = retriedTitle;
            hasTitle = true;
        }
    }

    if (pageContext.isIntegrationRequired && !hasTitle) {
        logBottomBarDebugReason('required domain integration did not resolve title', {
            pageHostname,
            requestUrl,
            requestUrls,
        });
        return false;
    }

    if (isHostExcluded(pageHostname, excludedDomains)) {
        logBottomBarDebugReason('domain is excluded by user preferences', {
            pageHostname,
            excludedDomains,
            requestUrl,
            requestUrls,
        });
        return false;
    }

    // If we can't find any page identity signal at all, it's probably not a product page.
    if (ldJson == null && canonicalLink == null && !hasTitle) {
        logBottomBarDebugReason('missing page identity signal', {
            hasLdJson: ldJson != null,
            hasCanonical: canonicalLink != null,
            hasTitle,
            requestUrl,
            requestUrls,
        });
        return false;
    }

    pendingBarGameData = null;
    pendingBarDebugData = null;

    try {
        const [storedUserSettings, extensionSettingsFromStorage] = await Promise.all([
            loadGGUserSettingsFromChromeStorage(),
            loadSettingsFromChromeStorage(),
        ]);
        let userSettings = storedUserSettings;
        const extensionSettings = extensionSettingsFromStorage ?? DEFAULT_EXTENSION_SETTINGS;

        if (!userSettings?.region?.trim()) {
            try {
                userSettings = await requestGGUserSettingsSync({ mode: 'auto' });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logBottomBarDebugReason('failed to synchronize region from extensionData/user', {
                    error: errorMessage,
                });
            }
        }

        const platform = userSettings?.platform?.trim().toLowerCase()
            || mapSettingsPlatformToRequestPlatform(extensionSettings.platform);

        const showKeyshops = typeof userSettings?.showKeyshops === 'boolean'
            ? userSettings.showKeyshops
            : extensionSettings.keyshopsEnabled;
        const region = userSettings?.region?.trim().toLowerCase();

        if (!region) {
            logBottomBarDebugReason('region is not available from extensionData/user yet');
            return false;
        }

        const commonPayload = {
            platform,
            showKeyshops,
            region,
            sourcePlatform: pageContext.sourcePlatform,
            ...(!pageContext.omitSourceUrl
                ? { sourceUrl: window.location.href ?? document.URL }
                : {}),
        };
        let endpoint: string;
        let payload: BarGameRequestPayload | BarGamesRequestPayload;

        if (hasRequestUrls) {
            if (!title) {
                logBottomBarDebugReason('multi-URL request is missing a title', {
                    pageHostname,
                    requestUrls,
                });
                return false;
            }

            endpoint = API_GAMES_URL;
            payload = {
                ...commonPayload,
                urls: requestUrls,
                title,
            };
        } else {
            endpoint = API_URL;
            payload = {
                ...commonPayload,
                url: requestUrl as string,
                title,
            };
        }

        console.log('[gg.deals-extension] Sending runtime message to fetch bottom bar data with context:', payload);

        const response = await browser.runtime.sendMessage({
            type: 'POST_IMPORT_DATA',
            url: endpoint,
            payload,
        }) as RuntimeMessageResponse;

        if (isStale()) {
            return false;
        }

        pendingBarDebugData = {
            request: payload,
            response: response?.data ?? null,
        };

        // Debug:
        console.log('[gg.deals-extension] Runtime message response for bottom bar data:', response);

        if (!response?.ok) {
            logBottomBarDebugReason('runtime message returned non-ok response', {
                error: response?.error ?? 'Unknown error',
                requestUrl,
                requestUrls,
                title,
            });
            console.warn('[gg.deals-extension] Failed to resolve bottom bar data:', response?.error ?? 'Unknown error');
            return false;
        }

        if (isInvalidApiKeyResponse(response.data)) {
            await clearExtensionSessionInStorage();
            logBottomBarDebugReason('api key invalid in bottom bar response, cleared extension session', {
                requestUrl,
                requestUrls,
                title,
            });
            return false;
        }

        const normalizedData = normalizeGameData(response.data);
        if (normalizedData) {
            pendingBarGameData = normalizedData;
        } else {
            logBottomBarDebugReason('runtime payload missing required game data fields', {
                requestUrl,
                requestUrls,
                title,
            });
            console.warn('[gg.deals-extension] Bottom bar data payload is missing required fields', response.data);
            return BOTTOM_BAR_DEBUG_ENABLED;
        }
    } catch (er: unknown) {
        logBottomBarDebugReason('runtime message threw while resolving bottom bar data', {
            requestUrl,
            requestUrls,
            title,
            error: er instanceof Error ? er.message : String(er),
        });
        console.warn('[gg.deals-extension] Failed to send page context for bottom bar injection decision:', er);
        return false;
    }

    console.log('[gg.deals-extension] Checking if bottom bar should be injected:', 'LD+JSON presence:', ldJson?.textContent, 'Canonical link presence:', canonicalLink?.href, 'Title presence:', title);
    return true;
}

export function onBottomBarInjected(barElement: HTMLElement): void {
    console.log('[gg.deals-extension] Bottom bar injected:', barElement);

    currentBarElement = barElement;
    installAppearanceSyncListeners();
    applyAppearanceToBar(barElement, null);
    void syncBarAppearanceFromStorage(barElement);
    void syncKeyshopsVisibilityFromStorage(barElement);
    renderBarDebugData(barElement, pendingBarDebugData);

    const gameInfoContainer = barElement.querySelector<HTMLElement>('#gg-bottom-bar-game-info');
    if (!gameInfoContainer) {
        console.warn('[gg.deals-extension] Missing #gg-bottom-bar-game-info in bar template');
        return;
    }

    if (!isSupportedProductPage(window.location.href)) {
        return;
    }

    const gameData = pendingBarGameData;
    pendingBarGameData = null;

    if (gameData && hasRenderableGameData(gameData)) {
        renderGameData(gameInfoContainer, gameData);
    } else {
        console.warn('[gg.deals-extension] Missing renderable game data:', gameData);
    }

    const minimizeBtns = barElement.querySelectorAll<HTMLElement>('[data-action="bar-minimize"]');
    minimizeBtns.forEach((btn) => {
        btn.addEventListener('click', (): void => {
            barElement.classList.toggle('minimized');
        });
    });

    const dropdownTriggers = barElement.querySelectorAll<HTMLElement>('#gg-bar-options [data-action="bar-dropdown-trigger"]');
    dropdownTriggers.forEach((trigger) => {
        const wrapper = trigger.closest<HTMLElement>('.gg-bar-dropdown');

        if (wrapper) {
            trigger.addEventListener('click', (e: MouseEvent): void => {
                e.stopPropagation();

                wrapper.classList.toggle('open');
            });
        }
    });

    const changeAppearance = document.querySelector<HTMLElement>('#gg-change-appearance');
    if (changeAppearance) {
        changeAppearance.addEventListener('click', (): void => {
            const wrapper = document.querySelector<HTMLElement>('#gg-bar-options');
            if (wrapper) {
                wrapper.classList.toggle('open');
            }

            void browser.runtime.sendMessage({ type: 'OPEN_POPUP', tab: 'appearance' });
        });
    }

    const alwaysHide = document.querySelector<HTMLElement>('#gg-always-hide');
    if (alwaysHide) {
        alwaysHide.addEventListener('click', (): void => {
            void browser.runtime.sendMessage({
                type: 'OPEN_POPUP',
                tab: 'settings',
                settingsScrollTarget: 'bottom',
            });

            void addCurrentDomainToExcludedWebsites().finally(() => {
                barElement.classList.add(DOMAIN_HIDDEN_CLASS);
            });
        });
    }

    document.addEventListener('click', (e: MouseEvent): void => {
        const target = e.target as HTMLElement;
        if (!target.closest('.gg-bar-dropdown')) {
            closeGgDropdowns(barElement);
        }
    });

}
