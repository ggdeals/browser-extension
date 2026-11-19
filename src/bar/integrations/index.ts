import { fanaticalPageRule } from './fanatical';
import { steamPageRule } from './steam';
import { epicPageRule } from './epic';
import { enebaPageRule } from './eneba';
import { planetplayPageRule } from './planetplay';
import { allyouplayPageRule } from './allyouplay';
import { drifflePageRule } from './driffle';
import { discoverGamesPageRule } from './discovergames';
import { gameboostPageRule } from './gameboost';
import { gamivoPageRule } from './gamivo';
import { keycensePageRule } from './keycense';
import { kinguinPageRule } from './kinguin';
import { lootbarPageRule } from './lootbar';
import { ldShopPageRule } from './ldshop';
import { nintendoPageRule } from './nintendo';
import { playerlandPageRule } from './playerland';
import { isThereAnyDealPageRule } from './isthereanydeal';
import { lestradesPageRule } from './lestrades';
import { lowcygierBazarPageRule } from './lowcygierbazar';
import { barterVgPageRule } from './bartervg';
import { steamDbPageRule } from './steamdb';
import { steamChartsPageRule } from './steamcharts';
import { howLongToBeatPageRule } from './howlongtobeat';
import { metacriticPageRule } from './metacritic';
import { openCriticPageRule } from './opencritic';
import { releasesPageRule } from './releases';
import { egDataPageRule } from './egdata';
import { igdbPageRule } from './igdb';
import { gryOnlinePageRule } from './gryonline';
import { gamePressurePageRule } from './gamepressure';
import { gameStopPageRule } from './gamestop';
import { mtcgamePageRule } from './mtcgame';
import { xboxPageRule } from './xbox';
import { neweggPageRule } from './newegg';
import { rockstarPageRule } from './rockstar';
import { ubisoftPageRule } from './ubisoft';
import { cheapGamingPageRule } from './cheapgaming';
import { amazonPageRules } from './amazon';
import { battleNetPageRule } from './battlenet';
import { loadedPageRule } from './loaded';
import { difmarkPageRule } from './difmark';
import { dreamgamePageRule } from './dreamgame';
import { fortunaDigitalPageRule } from './fortunadigital';
import { g2aPageRule } from './g2a';
import { g2playPageRule } from './g2play';
import { gamersGatePageRule } from './gamersgate';
import { gamersOutletPageRule } from './gamersoutlet';
import { gamerAllPageRule } from './gamerall';
import { gamesealPageRule } from './gameseal';
import { gamesplanetPageRule } from './gamesplanet';
import { greenManGamingPageRule } from './greenmangaming';
import { hrkGamePageRule } from './hrkgame';
import { humbleBundlePageRule } from './humblebundle';
import { hypeGamesPageRule } from './hypegames';
import { indiegalaPageRule } from './indiegala';
import { instantGamingPageRule } from './instantgaming';
import { joybuggyPageRule } from './joybuggy';
import { zapaGamesPageRule } from './zapagames';
import { bitcodesPageRule } from './bitcodes';
import { ewwPageRule } from './eww';
import { k4gPageRule } from './k4g';
import { muvePageRules } from './muve';
import { nuuvemPageRule } from './nuuvem';
import { premiumCdKeysPageRule } from './premiumcdkeys';
import { twoGamePageRule } from './2game';
import { winGameStorePageRule } from './wingamestore';
import { eldoradoPageRule } from './eldorado';
import { playsumPageRule } from './playsum';
import { playAsiaPageRule } from './playasia';
import { electronicFirstPageRule } from './electronicfirst';
import { twitchPageRule } from './twitch';
import type { DomainPageEligibility, DomainPageRule } from './types';

type BottomBarContextInput = {
    hostname: string;
    documentTitle: string | null | undefined;
    ldJsonTitle: string | null | undefined;
    canonicalUrl: string | null | undefined;
    ldJsonRequestUrl: string | null | undefined;
    windowUrl: string | null | undefined;
};

type BottomBarContextOutput = {
    title: string | null;
    requestUrl: string | null;
    requestUrls: string[];
    sourcePlatform: string | null;
    isIntegrationRequired: boolean;
    pageEligibility: DomainPageEligibility | null;
    omitSourceUrl: boolean;
    titleResolveRetryMs: number;
};

const DOMAIN_PAGE_RULES: DomainPageRule[] = [
    steamPageRule,
    fanaticalPageRule,
    epicPageRule,
    enebaPageRule,
    planetplayPageRule,
    allyouplayPageRule,
    drifflePageRule,
    discoverGamesPageRule,
    gameboostPageRule,
    gamivoPageRule,
    keycensePageRule,
    kinguinPageRule,
    lootbarPageRule,
    ldShopPageRule,
    nintendoPageRule,
    playerlandPageRule,
    isThereAnyDealPageRule,
    lestradesPageRule,
    lowcygierBazarPageRule,
    barterVgPageRule,
    steamDbPageRule,
    steamChartsPageRule,
    howLongToBeatPageRule,
    metacriticPageRule,
    openCriticPageRule,
    releasesPageRule,
    egDataPageRule,
    igdbPageRule,
    gryOnlinePageRule,
    gamePressurePageRule,
    gameStopPageRule,
    mtcgamePageRule,
    xboxPageRule,
    neweggPageRule,
    rockstarPageRule,
    ubisoftPageRule,
    cheapGamingPageRule,
    battleNetPageRule,
    loadedPageRule,
    difmarkPageRule,
    dreamgamePageRule,
    fortunaDigitalPageRule,
    g2aPageRule,
    g2playPageRule,
    gamersGatePageRule,
    gamersOutletPageRule,
    gamerAllPageRule,
    gamesealPageRule,
    gamesplanetPageRule,
    greenManGamingPageRule,
    hrkGamePageRule,
    humbleBundlePageRule,
    hypeGamesPageRule,
    indiegalaPageRule,
    instantGamingPageRule,
    joybuggyPageRule,
    zapaGamesPageRule,
    bitcodesPageRule,
    ewwPageRule,
    k4gPageRule,
    ...muvePageRules,
    nuuvemPageRule,
    premiumCdKeysPageRule,
    twoGamePageRule,
    winGameStorePageRule,
    eldoradoPageRule,
    playsumPageRule,
    playAsiaPageRule,
    electronicFirstPageRule,
    twitchPageRule,
    ...amazonPageRules,
];

function normalizeDomain(value: string): string {
    return value.trim().toLowerCase().replace(/^www\./, '');
}

function normalizeTitle(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeUrl(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function findDomainPageRule(hostname: string): DomainPageRule | null {
    const normalizedHost = normalizeDomain(hostname);
    const matchedRule = DOMAIN_PAGE_RULES.find(({ domain }) => {
        return normalizedHost === domain || normalizedHost.endsWith(`.${domain}`);
    });

    return matchedRule ?? null;
}

export function resolveBottomBarPageStateKey(hostname: string): string | null {
    const matchedRule = findDomainPageRule(hostname);
    if (!matchedRule?.resolvePageStateKey) {
        return null;
    }

    try {
        return normalizeTitle(matchedRule.resolvePageStateKey());
    } catch (error: unknown) {
        console.warn('[gg.deals-extension] Domain page state resolver failed:', {
            domain: matchedRule.domain,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

function resolveTitleFromDomainIntegration(matchedRule: DomainPageRule): string | null {
    if (!matchedRule.resolveTitle) {
        return null;
    }

    try {
        return normalizeTitle(matchedRule.resolveTitle());
    } catch (error: unknown) {
        console.warn('[gg.deals-extension] Domain title resolver failed:', {
            domain: matchedRule.domain,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

function resolveSourcePlatformFromDomainIntegration(matchedRule: DomainPageRule): string | null {
    if (!matchedRule.resolveSourcePlatform) {
        return null;
    }

    try {
        const sourcePlatform = matchedRule.resolveSourcePlatform();
        if (typeof sourcePlatform !== 'string') {
            return null;
        }

        const normalizedSourcePlatform = sourcePlatform.trim().toLowerCase();
        return normalizedSourcePlatform.length > 0 ? normalizedSourcePlatform : null;
    } catch (error: unknown) {
        console.warn('[gg.deals-extension] Domain sourcePlatform resolver failed:', {
            domain: matchedRule.domain,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

function getEligibilityResolveRetryMs(matchedRule: DomainPageRule): number {
    const retryMs = matchedRule.eligibilityResolveRetryMs;
    if (typeof retryMs !== 'number' || !Number.isFinite(retryMs) || retryMs <= 0) {
        return 0;
    }

    return Math.floor(retryMs);
}

async function resolvePageEligibilityFromDomainIntegration(
    matchedRule: DomainPageRule,
): Promise<DomainPageEligibility | null> {
    const eligibilityResolver = matchedRule.resolvePageEligibility;
    if (!eligibilityResolver) {
        return null;
    }

    const resolveOnce = async (): Promise<DomainPageEligibility> => {
        try {
            return await eligibilityResolver();
        } catch (error: unknown) {
            console.warn('[gg.deals-extension] Domain page eligibility resolver failed:', {
                domain: matchedRule.domain,
                error: error instanceof Error ? error.message : String(error),
            });

            return {
                status: 'unknown',
                reason: 'page eligibility check failed',
            };
        }
    };

    const retryMs = getEligibilityResolveRetryMs(matchedRule);
    const startedAt = Date.now();
    let eligibility = await resolveOnce();

    while (eligibility.status === 'unknown' && Date.now() - startedAt < retryMs) {
        await sleep(120);
        eligibility = await resolveOnce();
    }

    return eligibility;
}

async function resolveRequestUrlFromDomainIntegration(matchedRule: DomainPageRule): Promise<string | null> {
    if (!matchedRule.resolveRequestUrl) {
        return null;
    }

    try {
        return normalizeUrl(await matchedRule.resolveRequestUrl());
    } catch (error: unknown) {
        console.warn('[gg.deals-extension] Domain requestUrl resolver failed:', {
            domain: matchedRule.domain,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

async function resolveRequestUrlsFromDomainIntegration(matchedRule: DomainPageRule): Promise<string[]> {
    const requestUrlsResolver = matchedRule.resolveRequestUrls;
    if (!requestUrlsResolver) {
        return [];
    }

    try {
        const resolveOnce = async (): Promise<string[]> => {
            const requestUrls = await requestUrlsResolver();
            const normalizedUrls = requestUrls
                .map((requestUrl) => normalizeUrl(requestUrl))
                .filter((requestUrl): requestUrl is string => requestUrl !== null);

            return [...new Set(normalizedUrls)];
        };
        const retryMs = matchedRule.requestUrlsResolveRetryMs;
        const expectedCount = matchedRule.requestUrlsExpectedCount;
        const normalizedRetryMs = typeof retryMs === 'number' && Number.isFinite(retryMs) && retryMs > 0
            ? Math.floor(retryMs)
            : 0;
        const normalizedExpectedCount = typeof expectedCount === 'number'
            && Number.isFinite(expectedCount)
            && expectedCount > 0
            ? Math.floor(expectedCount)
            : 1;
        const startedAt = Date.now();
        let bestRequestUrls = await resolveOnce();

        while (
            bestRequestUrls.length < normalizedExpectedCount
            && Date.now() - startedAt < normalizedRetryMs
        ) {
            await sleep(120);
            const requestUrls = await resolveOnce();
            if (requestUrls.length > bestRequestUrls.length) {
                bestRequestUrls = requestUrls;
            }
        }

        return bestRequestUrls;
    } catch (error: unknown) {
        console.warn('[gg.deals-extension] Domain requestUrls resolver failed:', {
            domain: matchedRule.domain,
            error: error instanceof Error ? error.message : String(error),
        });
        return [];
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

function getTitleResolveRetryMs(matchedRule: DomainPageRule): number {
    const retryMs = matchedRule.titleResolveRetryMs;
    if (typeof retryMs !== 'number' || !Number.isFinite(retryMs) || retryMs <= 0) {
        return 0;
    }

    return Math.floor(retryMs);
}

export async function waitForRequiredDomainTitle(hostname: string): Promise<string | null> {
    const matchedRule = findDomainPageRule(hostname);
    if (!matchedRule || !matchedRule.resolveTitle) {
        return null;
    }

    const retryMs = getTitleResolveRetryMs(matchedRule);
    if (retryMs <= 0) {
        return null;
    }

    const startedAt = Date.now();
    const pollIntervalMs = 120;

    while (Date.now() - startedAt < retryMs) {
        const title = resolveTitleFromDomainIntegration(matchedRule);
        if (title) {
            return title;
        }

        await sleep(pollIntervalMs);
    }

    return resolveTitleFromDomainIntegration(matchedRule);
}

export async function resolveBottomBarPageContext(input: BottomBarContextInput): Promise<BottomBarContextOutput> {
    const matchedRule = findDomainPageRule(input.hostname);

    if (!matchedRule) {
        return {
            title: normalizeTitle(input.documentTitle) ?? normalizeTitle(input.ldJsonTitle),
            requestUrl: normalizeUrl(input.windowUrl) ?? normalizeUrl(input.canonicalUrl) ?? normalizeUrl(input.ldJsonRequestUrl),
            requestUrls: [],
            sourcePlatform: null,
            isIntegrationRequired: false,
            pageEligibility: null,
            omitSourceUrl: false,
            titleResolveRetryMs: 0,
        };
    }

    const integrationTitle = resolveTitleFromDomainIntegration(matchedRule);
    const integrationSourcePlatform = resolveSourcePlatformFromDomainIntegration(matchedRule);
    const [pageEligibility, integrationRequestUrl, integrationRequestUrls] = await Promise.all([
        resolvePageEligibilityFromDomainIntegration(matchedRule),
        resolveRequestUrlFromDomainIntegration(matchedRule),
        resolveRequestUrlsFromDomainIntegration(matchedRule),
    ]);
    const fallbackRequestUrl = normalizeUrl(input.windowUrl);
    const resolvedRequestUrl = integrationRequestUrl
        ?? (!matchedRule.resolveRequestUrls ? fallbackRequestUrl : null);
    const resolvedRequestUrls = matchedRule.resolveRequestUrls
        && integrationRequestUrls.length === 0
        && fallbackRequestUrl
        ? [fallbackRequestUrl]
        : integrationRequestUrls;

    return {
        title: integrationTitle,
        requestUrl: resolvedRequestUrl,
        requestUrls: resolvedRequestUrls,
        sourcePlatform: integrationSourcePlatform,
        isIntegrationRequired: true,
        pageEligibility,
        omitSourceUrl: matchedRule.omitSourceUrl === true,
        titleResolveRetryMs: getTitleResolveRetryMs(matchedRule),
    };
}
