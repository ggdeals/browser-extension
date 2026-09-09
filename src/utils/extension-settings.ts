import browser from 'webextension-polyfill';
import {
    APPEARANCE_STORAGE_KEY,
    EMAIL_UNVERIFIED_ERROR_CODE,
    EXCLUDED_WEBSITES_STORAGE_KEY,
    GG_CUSTOM_MESSAGES,
    GG_SERVER_MESSAGE_BADGE,
    GG_API_INVALID_API_KEY_CODE,
    GG_USER_SETTINGS,
    SETTINGS_STORAGE_KEY
} from './extension-settings-constants';
import { USER_SETTINGS_URL } from './gg-api-constants';

export type RegionCurrency =
    | 'aud-au'
    | 'eur-be'
    | 'brl-br'
    | 'cad-ca'
    | 'dkk-dk'
    | 'eur-eu'
    | 'eur-fi'
    | 'eur-fr'
    | 'eur-de'
    | 'eur-ie'
    | 'eur-it'
    | 'eur-nl'
    | 'nok-no'
    | 'pln-pl'
    | 'eur-es'
    | 'sek-se'
    | 'chf-ch'
    | 'gbp-gb'
    | 'usd-us';

export type SettingsData = {
    platform: 'all' | 'pc' | 'steam' | 'xbox' | 'playstation' | 'nintendo';
    // Set this from extensionData/user. Do not guess a region
    regionCurrency: RegionCurrency | null;
    keyshopsEnabled: boolean;
    barEnabled: boolean;
}

export const DEFAULT_EXTENSION_SETTINGS: SettingsData = {
    platform: 'all',
    regionCurrency: null,
    keyshopsEnabled: true,
    barEnabled: true,
};

export type SettingsAppearanceData = {
    systemTheme: 'dark' | 'light' | 'system';
    theme: 'dark' | 'light' | 'system';
    barWidth: 'fixed' | 'fit-content' | 'edge-to-edge';
    rounding: 'rounded' | 'rounded-corners' | 'rounded-top';
}

export const DEFAULT_APPEARANCE_SETTINGS: SettingsAppearanceData = {
    systemTheme: 'system',
    theme: 'system',
    barWidth: 'fit-content',
    rounding: 'rounded',
};

export type GGUserSettingsData = {
    username: string | null;
    avatar: string | null;
    apiKey: string | null;
    platform: string;
    region: string;
    showKeyshops: boolean;
};

export type AuthenticatedGGUserSettingsData = GGUserSettingsData & {
    username: string;
    apiKey: string;
};

export type GGUserSettingsSyncMode = 'auto' | 'guest' | 'authenticated';

export type GGUserSettingsSyncOptions = {
    mode?: GGUserSettingsSyncMode;
    includeApiKeyHeader?: boolean;
    requireAuthenticated?: boolean;
    overrides?: Partial<Pick<GGUserSettingsData, 'platform' | 'region' | 'showKeyshops'>>;
};

export const SYNC_GG_USER_SETTINGS_MESSAGE = 'SYNC_GG_USER_SETTINGS';

export const SIGNED_OUT_GG_USER_SETTINGS: GGUserSettingsData = {
    username: null,
    apiKey: null,
    avatar: null,
    platform: 'all',
    region: '',
    showKeyshops: true,
};

export const SIGNED_OUT_EXTENSION_SETTINGS: SettingsData = {
    platform: 'all',
    regionCurrency: null,
    keyshopsEnabled: true,
    barEnabled: true,
};

export type GGPayloadMessage = {
    code: string;
    type?: GGMessageType;
    ttl?: number;
    title?: string;
    constraint?: string;
    message: string;
};

export type GGMessageType = 'info' | 'warning' | 'success' | 'error';

export type GGGamePrice = {
    price: string;
    isHistoricalLow: boolean;
    isBestDeal: boolean;
};

export type GGGame = {
    title: string;
    url: string;
    prices: {
        currentRetail: GGGamePrice | null;
        currentKeyshops: GGGamePrice | null;
    };
};

export type GGGameLookupResponse = {
    success: boolean;
    data: {
        foundBy: 'url' | 'title' | null;
        games: GGGame[];
    };
    messages?: GGPayloadMessage[];
};

export type GGActionResponse = {
    success: boolean;
    data: {
        status?: string;
    };
    messages?: GGPayloadMessage[];
};

export type GGMessagesCarrier = {
    messages?: GGPayloadMessage[];
};

function isGGPayloadMessage(value: unknown): value is GGPayloadMessage {
    return Boolean(
        value
        && typeof value === 'object'
        && 'code' in value
        && typeof value.code === 'string'
        && 'message' in value
        && typeof value.message === 'string'
    );
}

export function isInvalidApiKeyResponse(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object' || !('messages' in payload)) {
        return false;
    }

    const { messages } = payload;
    return Array.isArray(messages) && messages.some(
        (message: unknown) =>
            isGGPayloadMessage(message)
            && message.code === GG_API_INVALID_API_KEY_CODE
    );
}

export function isEmailUnverifiedResponse(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object' || !('messages' in payload)) {
        return false;
    }

    const { messages } = payload;
    return Array.isArray(messages) && messages.some(
        (message: unknown) =>
            isGGPayloadMessage(message)
            && message.code === EMAIL_UNVERIFIED_ERROR_CODE
    );
}

export function getEmailUnverifiedMessage(payload: GGMessagesCarrier | null | undefined): string | null {
    const messages = payload?.messages;
    if (!Array.isArray(messages)) {
        return null;
    }

    for (const message of messages) {
        if (message.code === EMAIL_UNVERIFIED_ERROR_CODE) {
            return message.message;
        }
    }

    return null;
}

const CUSTOM_MESSAGE_PREFIX = 'custom:';
const RATE_LIMIT_MESSAGE_ID = 'internal:rate-limit';
const DEFAULT_RATE_LIMIT_TTL_SECONDS = 60;
let customMessageMutationQueue: Promise<void> = Promise.resolve();

type SemanticVersion = {
    major: number;
    minor: number;
    patch: number;
    prerelease: Array<number | string>;
};

export type GGCustomMessage = {
    id: string;
    type?: GGMessageType;
    ttl?: number;
    title?: string;
    constraint?: string;
    message: string;
    receivedAt: number;
    dismissed: boolean;
    showBadge: boolean;
    badgeType?: 'server' | 'rate-limit';
    badgeAcknowledged: boolean;
    fingerprint: string;
};

function parseSemanticVersion(value: string): SemanticVersion | null {
    const match = value.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    if (!match) {
        return null;
    }

    return {
        major: Number(match[1]),
        minor: Number(match[2] ?? 0),
        patch: Number(match[3] ?? 0),
        prerelease: match[4]
            ? match[4].split('.').map((identifier) => /^\d+$/.test(identifier) ? Number(identifier) : identifier)
            : [],
    };
}

function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
    for (const part of ['major', 'minor', 'patch'] as const) {
        if (left[part] !== right[part]) {
            return left[part] < right[part] ? -1 : 1;
        }
    }

    if (left.prerelease.length === 0 || right.prerelease.length === 0) {
        if (left.prerelease.length === right.prerelease.length) {
            return 0;
        }
        return left.prerelease.length === 0 ? 1 : -1;
    }

    const identifiersCount = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < identifiersCount; index += 1) {
        const leftIdentifier = left.prerelease[index];
        const rightIdentifier = right.prerelease[index];
        if (typeof leftIdentifier === 'undefined' || typeof rightIdentifier === 'undefined') {
            return typeof leftIdentifier === 'undefined' ? -1 : 1;
        }
        if (leftIdentifier === rightIdentifier) {
            continue;
        }
        if (typeof leftIdentifier === 'number' && typeof rightIdentifier === 'number') {
            return leftIdentifier < rightIdentifier ? -1 : 1;
        }
        if (typeof leftIdentifier === 'number' || typeof rightIdentifier === 'number') {
            return typeof leftIdentifier === 'number' ? -1 : 1;
        }
        return leftIdentifier < rightIdentifier ? -1 : 1;
    }

    return 0;
}

export function matchesVersionConstraint(constraint: string | undefined, version: string): boolean {
    const normalizedConstraint = constraint?.trim();
    if (!normalizedConstraint) {
        return true;
    }

    const currentVersion = parseSemanticVersion(version);
    if (currentVersion === null || normalizedConstraint.includes('||')) {
        return false;
    }

    const tokens = normalizedConstraint
        .replace(/(<=|>=|<|>|=)\s+/g, '$1')
        .split(/\s+/)
        .filter(Boolean);
    if (tokens.length === 0) {
        return false;
    }

    return tokens.every((token) => {
        const match = token.match(/^(<=|>=|<|>|=)?(.+)$/);
        const expectedVersion = match ? parseSemanticVersion(match[2]) : null;
        if (!match || expectedVersion === null) {
            return false;
        }

        const comparison = compareSemanticVersions(currentVersion, expectedVersion);
        switch (match[1] ?? '=') {
            case '<':
                return comparison < 0;
            case '<=':
                return comparison <= 0;
            case '>':
                return comparison > 0;
            case '>=':
                return comparison >= 0;
            default:
                return comparison === 0;
        }
    });
}

function normalizeMessageType(value: unknown): GGMessageType | undefined {
    return value === 'info' || value === 'warning' || value === 'success' || value === 'error'
        ? value
        : undefined;
}

function createMessageFingerprint(message: Pick<GGCustomMessage, 'type' | 'ttl' | 'title' | 'constraint' | 'message' | 'showBadge' | 'badgeType'>): string {
    return JSON.stringify({
        type: message.type,
        ttl: message.ttl,
        title: message.title,
        constraint: message.constraint,
        message: message.message,
        showBadge: message.showBadge,
        badgeType: message.badgeType,
    });
}

function getExtensionVersion(): string {
    return browser.runtime.getManifest().version;
}

function enqueueCustomMessageMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = customMessageMutationQueue
        .catch(() => undefined)
        .then(mutation);
    customMessageMutationQueue = result.then(() => undefined, () => undefined);

    return result;
}

function hasCustomPayloadMessage(payload: GGMessagesCarrier | null | undefined): boolean {
    return Array.isArray(payload?.messages) && payload.messages.some(
        (message) => isGGPayloadMessage(message) && message.code.startsWith(CUSTOM_MESSAGE_PREFIX)
    );
}

export function resolveCustomMessages(
    payload: GGMessagesCarrier | null | undefined,
    previous: GGCustomMessage[] = [],
    now: number = Date.now(),
    extensionVersion: string = getExtensionVersion()
): GGCustomMessage[] {
    const incoming = payload?.messages;
    const merged = new Map<string, GGCustomMessage>(
        getActiveCustomMessages(previous, now, extensionVersion).map((message) => [message.id, message])
    );

    if (Array.isArray(incoming)) {
        for (const message of incoming) {
            if (!isGGPayloadMessage(message)) {
                continue;
            }

            const id = message.code.startsWith(CUSTOM_MESSAGE_PREFIX)
                ? message.code.slice(CUSTOM_MESSAGE_PREFIX.length)
                : null;
            if (!id) {
                continue;
            }

            const constraint = typeof message.constraint === 'string' && message.constraint.trim().length > 0
                ? message.constraint.trim()
                : undefined;
            if (!matchesVersionConstraint(constraint, extensionVersion)) {
                merged.delete(id);
                continue;
            }

            const existing = merged.get(id);
            const nextMessage: GGCustomMessage = {
                id,
                type: normalizeMessageType(message.type),
                ttl: typeof message.ttl === 'number' && Number.isFinite(message.ttl)
                    ? Math.max(0, message.ttl)
                    : undefined,
                title: typeof message.title === 'string' ? message.title : undefined,
                constraint,
                message: message.message,
                receivedAt: now,
                dismissed: false,
                showBadge: true,
                badgeType: 'server',
                badgeAcknowledged: false,
                fingerprint: '',
            };
            nextMessage.fingerprint = createMessageFingerprint(nextMessage);
            if (existing?.fingerprint === nextMessage.fingerprint) {
                nextMessage.receivedAt = existing.receivedAt;
                nextMessage.dismissed = existing.dismissed;
                nextMessage.badgeAcknowledged = existing.badgeAcknowledged;
            }

            merged.set(id, nextMessage);
        }
    }

    return getActiveCustomMessages(Array.from(merged.values()), now, extensionVersion);
}

function normalizeStoredCustomMessage(value: unknown): GGCustomMessage | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const message = value as Partial<GGCustomMessage>;
    if (
        typeof message.id !== 'string'
        || message.id.length === 0
        || typeof message.message !== 'string'
        || typeof message.receivedAt !== 'number'
        || !Number.isFinite(message.receivedAt)
    ) {
        return null;
    }

    const normalized: GGCustomMessage = {
        id: message.id,
        type: normalizeMessageType(message.type),
        ttl: typeof message.ttl === 'number' && Number.isFinite(message.ttl)
            ? Math.max(0, message.ttl)
            : undefined,
        title: typeof message.title === 'string' ? message.title : undefined,
        constraint: typeof message.constraint === 'string' && message.constraint.trim().length > 0
            ? message.constraint.trim()
            : undefined,
        message: message.message,
        receivedAt: message.receivedAt,
        dismissed: message.dismissed === true,
        showBadge: message.showBadge === true,
        badgeType: message.badgeType === 'server' || message.badgeType === 'rate-limit'
            ? message.badgeType
            : message.showBadge === true
                ? 'rate-limit'
                : undefined,
        badgeAcknowledged: message.badgeAcknowledged === true,
        fingerprint: '',
    };
    normalized.fingerprint = createMessageFingerprint(normalized);

    return normalized;
}

export function getActiveCustomMessages(
    value: unknown,
    now: number = Date.now(),
    extensionVersion: string = getExtensionVersion()
): GGCustomMessage[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map(normalizeStoredCustomMessage)
        .filter((message): message is GGCustomMessage => message !== null)
        .filter((message) => matchesVersionConstraint(message.constraint, extensionVersion))
        .filter((message) => typeof message.ttl !== 'number' || now - message.receivedAt < message.ttl * 1000);
}

export function getVisibleCustomMessages(value: unknown, now: number = Date.now()): GGCustomMessage[] {
    return getActiveCustomMessages(value, now).filter((message) => !message.dismissed);
}

export function getNextCustomMessageExpiration(messages: GGCustomMessage[]): number | null {
    const expirations = messages
        .filter((message) => typeof message.ttl === 'number')
        .map((message) => message.receivedAt + (message.ttl as number) * 1000);

    return expirations.length > 0 ? Math.min(...expirations) : null;
}

export async function loadCustomMessagesFromChromeStorage(now: number = Date.now()): Promise<GGCustomMessage[]> {
    if (!browser.storage?.local) {
        return [];
    }

    const result = await browser.storage.local.get([GG_CUSTOM_MESSAGES]);
    const stored = result?.[GG_CUSTOM_MESSAGES];
    const active = getActiveCustomMessages(stored, now);

    if (Array.isArray(stored) && active.length !== stored.length) {
        await browser.storage.local.set({ [GG_CUSTOM_MESSAGES]: active });
    }

    return active;
}

export async function storeCustomMessagesFromPayload(
    payload: GGMessagesCarrier | null | undefined,
    now: number = Date.now()
): Promise<GGCustomMessage[]> {
    if (!hasCustomPayloadMessage(payload)) {
        return loadCustomMessagesFromChromeStorage(now);
    }

    return enqueueCustomMessageMutation(async () => {
        const previous = await loadCustomMessagesFromChromeStorage(now);
        const messages = resolveCustomMessages(payload, previous, now);

        if (browser.storage?.local) {
            await browser.storage.local.set({ [GG_CUSTOM_MESSAGES]: messages });
        }

        return messages;
    });
}

export async function dismissCustomMessage(id: string): Promise<void> {
    return enqueueCustomMessageMutation(async () => {
        const messages = await loadCustomMessagesFromChromeStorage();
        const message = messages.find((item) => item.id === id);
        if (!message || message.dismissed) {
            return;
        }

        message.dismissed = true;
        await browser.storage.local.set({ [GG_CUSTOM_MESSAGES]: messages });
    });
}

export async function acknowledgeServerMessageBadges(): Promise<void> {
    return enqueueCustomMessageMutation(async () => {
        const messages = await loadCustomMessagesFromChromeStorage();
        let hasChanges = false;
        for (const message of messages) {
            if (message.badgeType === 'server' && !message.badgeAcknowledged) {
                message.badgeAcknowledged = true;
                hasChanges = true;
            }
        }

        if (hasChanges) {
            await browser.storage.local.set({ [GG_CUSTOM_MESSAGES]: messages });
        }
        await browser.storage.local.remove(GG_SERVER_MESSAGE_BADGE);
    });
}

function getRetryAfterSeconds(response: Response): number {
    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds > 0) {
            return Math.ceil(seconds);
        }

        const retryAt = Date.parse(retryAfter);
        if (Number.isFinite(retryAt)) {
            return Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
        }
    }

    const reset = Number(response.headers.get('X-RateLimit-Reset'));
    if (Number.isFinite(reset) && reset > 0) {
        return Math.max(1, Math.ceil(reset - Date.now() / 1000));
    }

    return DEFAULT_RATE_LIMIT_TTL_SECONDS;
}

async function storeRateLimitMessage(response: Response): Promise<void> {
    return enqueueCustomMessageMutation(async () => {
        const now = Date.now();
        const ttl = getRetryAfterSeconds(response);
        const messages = await loadCustomMessagesFromChromeStorage(now);
        const message: GGCustomMessage = {
            id: RATE_LIMIT_MESSAGE_ID,
            type: 'warning',
            ttl,
            title: 'Request limit reached',
            message: 'Too many requests were sent. Try again later.',
            receivedAt: now,
            dismissed: false,
            showBadge: true,
            badgeType: 'rate-limit',
            badgeAcknowledged: false,
            fingerprint: '',
        };
        message.fingerprint = createMessageFingerprint(message);

        const index = messages.findIndex((item) => item.id === message.id);
        if (index === -1) {
            messages.push(message);
        } else {
            messages[index] = message;
        }

        await browser.storage.local.set({ [GG_CUSTOM_MESSAGES]: messages });
    });
}

export async function processExtensionResponse(response: Response, payload: unknown): Promise<void> {
    const messagesCarrier = payload as GGMessagesCarrier | null | undefined;
    await storeCustomMessagesFromPayload(messagesCarrier);
    if (
        Array.isArray(messagesCarrier?.messages)
        && messagesCarrier.messages.some((message) => isGGPayloadMessage(message) && !message.code.startsWith(CUSTOM_MESSAGE_PREFIX))
    ) {
        await browser.storage.local.set({ [GG_SERVER_MESSAGE_BADGE]: true });
    }
    if (response.status === 429) {
        await storeRateLimitMessage(response);
    }
}

export function logServerResponseMessages(payload: GGActionResponse | null | undefined): boolean {
    const messages = payload?.messages;
    if (!messages || messages.length === 0) {
        return false;
    }

    messages.forEach((message) => {
        console.log(
            `[gg.deals-extension] Server message: ${message.title ?? message.code} - ${message.message}`
        );
    });

    return true;
}

export class GGInvalidApiKeyError extends Error {
    constructor() {
        super('GG.deals rejected the stored API key.');
        this.name = 'GGInvalidApiKeyError';
    }
}

export function signOutFromExtensionMemory(): GGUserSettingsData {
    const previousUserSettings = loadGGUserSettings();
    const signedOutUserSettings: GGUserSettingsData = {
        ...SIGNED_OUT_GG_USER_SETTINGS,
        // Remove login data, but keep the user's settings
        platform: previousUserSettings?.platform ?? SIGNED_OUT_GG_USER_SETTINGS.platform,
        region: previousUserSettings?.region ?? SIGNED_OUT_GG_USER_SETTINGS.region,
        showKeyshops: previousUserSettings?.showKeyshops ?? SIGNED_OUT_GG_USER_SETTINGS.showKeyshops,
    };

    saveGGUserSettings(signedOutUserSettings);
    void browser.storage?.local?.remove([GG_CUSTOM_MESSAGES, GG_SERVER_MESSAGE_BADGE]).catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to clear server messages:', errorMessage);
    });

    return signedOutUserSettings;
}

export const loadSettings = (): SettingsData => {
    try {
        const storedData = localStorage.getItem(SETTINGS_STORAGE_KEY);

        if (!storedData) {
            return DEFAULT_EXTENSION_SETTINGS;
        }
        return JSON.parse(storedData) as SettingsData;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to load extension settings:', errorMessage);
        return DEFAULT_EXTENSION_SETTINGS;
    }
}

export const saveSettings = (data: SettingsData) => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data));

    if (browser.storage?.local) {
        void browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: data }).catch((error: unknown) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn('[gg.deals-extension] Failed to sync settings to browser.storage.local:', errorMessage);
        });
    }
};

export async function loadSettingsFromChromeStorage(): Promise<SettingsData | null> {
    if (!browser.storage?.local) {
        return null;
    }

    try {
        const result = await browser.storage.local.get([SETTINGS_STORAGE_KEY]);
        const settings = result?.[SETTINGS_STORAGE_KEY];
        if (!settings || typeof settings !== 'object') {
            return null;
        }

        return settings as SettingsData;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to read settings from browser.storage.local:', errorMessage);
        return null;
    }
}

export const loadAppearanceSettings = (): SettingsAppearanceData => {
    try {
        const storedData = localStorage.getItem(APPEARANCE_STORAGE_KEY);

        if (!storedData) {
            return DEFAULT_APPEARANCE_SETTINGS;
        }
        return JSON.parse(storedData) as SettingsAppearanceData;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to load appearance settings:', errorMessage);
        return DEFAULT_APPEARANCE_SETTINGS;
    }
}

export const saveAppearanceSettings = (data: SettingsAppearanceData) => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(data));

    if (browser.storage?.local) {
        void browser.storage.local.set({ [APPEARANCE_STORAGE_KEY]: data }).catch((error: unknown) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn('[gg.deals-extension] Failed to sync appearance settings to browser.storage.local:', errorMessage);
        });
    }
};

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

export const saveExcludedWebsites = (domains: string[]) => {
    const sanitized = sanitizeExcludedDomains(domains);
    if (!browser.storage?.local) {
        console.warn('[gg.deals-extension] Failed to save excluded websites: browser.storage.local is unavailable');
        return;
    }

    void browser.storage.local.set({ [EXCLUDED_WEBSITES_STORAGE_KEY]: sanitized }).catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to save excluded websites to browser.storage.local:', errorMessage);
    });
};

export async function loadExcludedWebsitesFromChromeStorage(): Promise<string[] | null> {
    if (!browser.storage?.local) {
        return null;
    }

    try {
        const result = await browser.storage.local.get([EXCLUDED_WEBSITES_STORAGE_KEY]);
        return sanitizeExcludedDomains(result?.[EXCLUDED_WEBSITES_STORAGE_KEY]);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to read excluded websites from browser.storage.local:', errorMessage);
        return null;
    }
}

export const saveGGUserSettingsToLocalStorage = (data: GGUserSettingsData): void => {
    localStorage.setItem(GG_USER_SETTINGS, JSON.stringify(data));
};

export async function saveGGUserSettingsToChromeStorage(data: GGUserSettingsData): Promise<void> {
    if (!browser.storage?.local) {
        throw new Error('Failed to save GG user settings: browser.storage.local is unavailable.');
    }

    await browser.storage.local.set({ [GG_USER_SETTINGS]: data });
}

export const saveGGUserSettings = (data: GGUserSettingsData): void => {
    saveGGUserSettingsToLocalStorage(data);

    if (browser.storage?.local) {
        void saveGGUserSettingsToChromeStorage(data).catch((error: unknown) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn('[gg.deals-extension] Failed to sync GG user settings to browser.storage.local:', errorMessage);
        });
    }
};

export const loadGGUserSettings = (): GGUserSettingsData | null => {
    try {
        const storedData = localStorage.getItem(GG_USER_SETTINGS);

        if (!storedData) {
            return null;
        }

        return JSON.parse(storedData) as GGUserSettingsData;
    }
    catch {
        return null;
    }
};

export async function loadGGUserSettingsFromChromeStorage(): Promise<GGUserSettingsData | null> {
    if (!browser.storage?.local) {
        return null;
    }

    try {
        const result = await browser.storage.local.get([GG_USER_SETTINGS]);
        const settings = result?.[GG_USER_SETTINGS];
        if (!settings || typeof settings !== 'object') {
            return null;
        }

        return settings as GGUserSettingsData;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to read GG user settings from browser.storage.local:', errorMessage);
        return null;
    }
}

export const hasGGUserSettingsData = (data: GGUserSettingsData | null): data is AuthenticatedGGUserSettingsData => {
    return Boolean(
        data
        && typeof data.username === 'string'
        && data.username.trim().length > 0
        && typeof data.apiKey === 'string'
        && data.apiKey.trim().length > 0
    );
};

function isNullableString(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}

function isGGUserSettingsResponse(value: unknown): value is GGUserSettingsData {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const data = value as Partial<GGUserSettingsData>;
    return isNullableString(data.username)
        && isNullableString(data.avatar)
        && isNullableString(data.apiKey)
        && typeof data.platform === 'string'
        && typeof data.region === 'string'
        && typeof data.showKeyshops === 'boolean';
}

export async function fetchGGUserSettings(
    existingUserSettings: GGUserSettingsData | null,
    options: {
        includeApiKeyHeader?: boolean;
        credentials?: RequestCredentials;
    } = {},
): Promise<GGUserSettingsData> {
    const includeApiKeyHeader = options.includeApiKeyHeader ?? true;
    const response = await fetch(USER_SETTINGS_URL, {
        method: 'POST',
        credentials: options.credentials ?? 'include',
        headers: includeApiKeyHeader ? withGGApiKeyHeader({
            Accept: 'application/json',
        }, existingUserSettings) : {
            Accept: 'application/json',
        },
    });

    const data: unknown = await response.json().catch(() => ({}));
    try {
        await processExtensionResponse(response, data);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to process user-settings messages:', errorMessage);
    }
    if (!response.ok) {
        throw new Error(`Failed to fetch user settings. HTTP ${response.status}`);
    }

    if (isInvalidApiKeyResponse(data)) {
        throw new GGInvalidApiKeyError();
    }

    if (!isGGUserSettingsResponse(data)) {
        throw new Error('Failed to fetch user settings. Invalid response payload.');
    }

    return data;
}

export function fetchGuestGGUserSettings(): Promise<GGUserSettingsData> {
    return fetchGGUserSettings(null, {
        includeApiKeyHeader: false,
        credentials: 'omit',
    });
}

type GGUserSettingsSyncResponse = {
    ok: boolean;
    data?: unknown;
    error?: string;
    errorCode?: 'INVALID_API_KEY';
};

export async function requestGGUserSettingsSync(
    options: GGUserSettingsSyncOptions = {},
): Promise<GGUserSettingsData> {
    const response = await browser.runtime.sendMessage({
        type: SYNC_GG_USER_SETTINGS_MESSAGE,
        options,
    }) as GGUserSettingsSyncResponse;

    if (!response?.ok) {
        if (response?.errorCode === 'INVALID_API_KEY') {
            throw new GGInvalidApiKeyError();
        }

        throw new Error(response?.error ?? 'Failed to synchronize GG user settings.');
    }

    if (!isGGUserSettingsResponse(response.data)) {
        throw new Error('Failed to synchronize GG user settings. Invalid response payload.');
    }

    return response.data;
}

export const getGGApiKey = (data?: GGUserSettingsData | null): string | null => {
    const settings = data ?? loadGGUserSettings();
    const apiKey = settings?.apiKey;

    if (typeof apiKey !== 'string') {
        return null;
    }

    const trimmedApiKey = apiKey.trim();
    return trimmedApiKey.length > 0 ? trimmedApiKey : null;
};

export const withGGApiKeyHeader = (
    baseHeaders: Record<string, string>,
    data?: GGUserSettingsData | null,
): Record<string, string> => {
    const apiKey = getGGApiKey(data);

    if (!apiKey) {
        return baseHeaders;
    }

    return {
        ...baseHeaders,
        'x-api-key': apiKey,
    };
};
