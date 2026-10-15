import browser from 'webextension-polyfill';
import {
    APPEARANCE_STORAGE_KEY,
    BAR_SUBSCRIPTIONS_ENABLED_STORAGE_KEY,
    EMAIL_UNVERIFIED_ERROR_CODE,
    EXCLUDED_WEBSITES_STORAGE_KEY,
    GG_CUSTOM_MESSAGES,
    GG_SERVER_MESSAGE_BADGE,
    GG_API_INVALID_API_KEY_CODE,
    GG_USER_SETTINGS,
    SETTINGS_STORAGE_KEY
} from './extension-settings-constants';
import { USER_SETTINGS_URL } from './gg-api-constants';

// Supported values, in the order the settings dropdowns list them
export const PLATFORMS = ['all', 'pc', 'xbox', 'playstation', 'nintendo'] as const;
export const REGIONS = [
    'au', 'be', 'br', 'ca', 'dk', 'eu', 'fi', 'fr', 'de', 'ie',
    'it', 'nl', 'no', 'pl', 'es', 'se', 'ch', 'gb', 'us',
] as const;

export type Platform = typeof PLATFORMS[number];
export type Region = typeof REGIONS[number];

export function isPlatform(value: unknown): value is Platform {
    return PLATFORMS.includes(value as Platform);
}

export function isRegion(value: unknown): value is Region {
    return REGIONS.includes(value as Region);
}

// Platform, region and keyshops come from extensionData/user. Do not guess them.
// barEnabled is local to the extension and is on unless the user turned it off.
export type SettingsData = {
    platform: Platform;
    region: Region;
    keyshopsEnabled: boolean;
    barEnabled: boolean;
}

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
    rounding: 'rounded-top',
};

export function normalizeAppearanceSettings(value: unknown): SettingsAppearanceData {
    const settings = value && typeof value === 'object' ? value as Partial<SettingsAppearanceData> : {};
    const isTheme = (theme: unknown): theme is SettingsAppearanceData['theme'] =>
        theme === 'dark' || theme === 'light' || theme === 'system';

    return {
        systemTheme: isTheme(settings.systemTheme) ? settings.systemTheme : DEFAULT_APPEARANCE_SETTINGS.systemTheme,
        theme: isTheme(settings.theme) ? settings.theme : DEFAULT_APPEARANCE_SETTINGS.theme,
        barWidth: settings.barWidth === 'fixed' || settings.barWidth === 'fit-content' || settings.barWidth === 'edge-to-edge'
            ? settings.barWidth : DEFAULT_APPEARANCE_SETTINGS.barWidth,
        rounding: settings.rounding === 'rounded' || settings.rounding === 'rounded-corners' || settings.rounding === 'rounded-top'
            ? settings.rounding : DEFAULT_APPEARANCE_SETTINGS.rounding,
    };
}

export type GGUserSettingsData = {
    username: string | null;
    avatar: string | null;
    apiKey: string | null;
    platform: Platform;
    region: Region;
    showKeyshops: boolean;
};

export type AuthenticatedGGUserSettingsData = GGUserSettingsData & {
    username: string;
    avatar: string;
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

export type GGGameSubscription = {
    name: string;
    url: string;
};

export type GGGame = {
    title: string;
    url: string;
    prices: {
        currentRetail: GGGamePrice | null;
        currentKeyshops: GGGamePrice | null;
    };
    // API order: cheapest subscription is first and used as the bar label
    subscriptions?: GGGameSubscription[];
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

        await browser.storage.local.set({ [GG_CUSTOM_MESSAGES]: messages });

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

/** Removes login data, but keeps the user's platform, region and keyshops settings */
export function clearGGUserCredentials(userSettings: GGUserSettingsData): GGUserSettingsData {
    return {
        ...userSettings,
        username: null,
        avatar: null,
        apiKey: null,
    };
}

export function signOutFromExtensionMemory(userSettings: GGUserSettingsData): GGUserSettingsData {
    const signedOutUserSettings = clearGGUserCredentials(userSettings);

    saveGGUserSettings(signedOutUserSettings);
    void browser.storage.local.remove([GG_CUSTOM_MESSAGES, GG_SERVER_MESSAGE_BADGE]).catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to clear server messages:', errorMessage);
    });

    return signedOutUserSettings;
}

/** Returns a supported region, or null when the value is not one */
function normalizeRegion(value: unknown): Region | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalizedValue = value.trim().toLowerCase();
    // Legacy values have the form "currency-region" (for example, "pln-pl").
    const region = normalizedValue.match(/^[a-z]{3}-([a-z]{2})$/)?.[1] ?? normalizedValue;

    return isRegion(region) ? region : null;
}

// special type for settings stored in browser - we can't be sure what is stored there
type StoredSettingsData = {
    platform?: unknown;
    region?: unknown;
    regionCurrency?: unknown;
    keyshopsEnabled?: unknown;
    barEnabled?: unknown;
}

// What survived validation. Platform, region and keyshops are missing when the stored
// value was invalid, so they can be read from the server instead of being guessed.
type ValidStoredSettings = Partial<SettingsData> & Pick<SettingsData, 'barEnabled'>;

function dropInvalidSettings(data: unknown): ValidStoredSettings {
    const stored = data && typeof data === 'object' ? data as StoredSettingsData : {};

    return {
        platform: isPlatform(stored.platform) ? stored.platform : undefined,
        region: normalizeRegion(stored.region ?? stored.regionCurrency) ?? undefined,
        keyshopsEnabled: typeof stored.keyshopsEnabled === 'boolean' ? stored.keyshopsEnabled : undefined,
        barEnabled: typeof stored.barEnabled === 'boolean' ? stored.barEnabled : true,
    };
}

function hasCompleteSettings(settings: ValidStoredSettings): settings is SettingsData {
    return settings.platform !== undefined
        && settings.region !== undefined
        && settings.keyshopsEnabled !== undefined;
}

/**
    Returns complete settings. Whatever is missing or invalid in the stored data is read
    from GG.deals - platform, region and keyshops are never guessed.
    Fetch errors are not caught, preventing extension from using fallback or incomplete data
 */
export async function normalizeSettings(data: unknown): Promise<SettingsData> {
    const storedSettings = dropInvalidSettings(data);
    if (hasCompleteSettings(storedSettings)) {
        return storedSettings;
    }

    const userSettings = await requestGGUserSettingsSync({ mode: 'auto' });
    const settings = dropInvalidSettings({
        platform: storedSettings.platform ?? userSettings.platform,
        region: storedSettings.region ?? userSettings.region,
        keyshopsEnabled: storedSettings.keyshopsEnabled ?? userSettings.showKeyshops,
        barEnabled: storedSettings.barEnabled,
    });

    if (!hasCompleteSettings(settings)) {
        throw new Error('Failed to read extension settings. GG.deals returned an unsupported platform or region.');
    }

    return settings;
}

function areSettingsEqual(storedData: unknown, settings: SettingsData): boolean {
    const storedSettings = dropInvalidSettings(storedData);

    return hasCompleteSettings(storedSettings)
        && storedSettings.platform === settings.platform
        && storedSettings.region === settings.region
        && storedSettings.keyshopsEnabled === settings.keyshopsEnabled
        && storedSettings.barEnabled === settings.barEnabled;
}

function readSettingsFromLocalStorage(): unknown {
    try {
        const storedData = localStorage.getItem(SETTINGS_STORAGE_KEY);

        return storedData ? JSON.parse(storedData) : null;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to load extension settings:', errorMessage);
        return null;
    }
}

/** The bar toggle is the only setting the extension owns, so it is the only one with a default */
export const loadBarEnabled = (): boolean => {
    return dropInvalidSettings(readSettingsFromLocalStorage()).barEnabled;
}

export async function loadSubscriptionsEnabledFromChromeStorage(): Promise<boolean> {
    const result = await browser.storage.local.get([BAR_SUBSCRIPTIONS_ENABLED_STORAGE_KEY]);
    return result[BAR_SUBSCRIPTIONS_ENABLED_STORAGE_KEY] !== false;
}

export async function saveSubscriptionsEnabled(subscriptionsEnabled: boolean): Promise<void> {
    await browser.storage.local.set({ [BAR_SUBSCRIPTIONS_ENABLED_STORAGE_KEY]: subscriptionsEnabled });
}

/** Updates both settings records without writing to the host page's localStorage. */
export async function saveKeyshopsEnabled(keyshopsEnabled: boolean): Promise<void> {
    const [settings, userSettings] = await Promise.all([
        getNormalizedSettings(),
        requestGGUserSettingsSync({ mode: 'auto' }),
    ]);
    await browser.storage.local.set({
        [SETTINGS_STORAGE_KEY]: { ...settings, keyshopsEnabled },
        [GG_USER_SETTINGS]: { ...userSettings, showKeyshops: keyshopsEnabled },
    });
}

export const saveSettings = (data: SettingsData) => {
    const settings = dropInvalidSettings(data);
    if (!hasCompleteSettings(settings)) {
        console.warn('[gg.deals-extension] Refused to save settings with an unsupported platform or region:', data);
        return;
    }

    if (areSettingsEqual(readSettingsFromLocalStorage(), settings)) {
        return;
    }

    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));

    void browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings }).catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to sync settings to browser.storage.local:', errorMessage);
    });
};

async function readSettingsFromChromeStorage(): Promise<unknown> {
    try {
        const result = await browser.storage.local.get([SETTINGS_STORAGE_KEY]);

        return result?.[SETTINGS_STORAGE_KEY] ?? null;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to read settings from browser.storage.local:', errorMessage);
        return null;
    }
}

/** Returns the stored settings, or null when they are missing or incomplete */
export async function loadSettingsFromChromeStorage(): Promise<SettingsData | null> {
    const storedSettings = dropInvalidSettings(await readSettingsFromChromeStorage());

    return hasCompleteSettings(storedSettings) ? storedSettings : null;
}

/**
    Returns complete settings and keeps the stored ones up to date. Anything missing is
    read from GG.deals.
    Fetch errors are not caught, preventing extension from using fallback or incomplete data
 */
export async function getNormalizedSettings(): Promise<SettingsData> {
    const storedData = await readSettingsFromChromeStorage();
    const settings = await normalizeSettings(storedData);

    if (!areSettingsEqual(storedData, settings)) {
        await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
    }

    return settings;
}

export const loadAppearanceSettings = (): SettingsAppearanceData => {
    try {
        const storedData = localStorage.getItem(APPEARANCE_STORAGE_KEY);

        if (!storedData) {
            return normalizeAppearanceSettings(null);
        }
        return normalizeAppearanceSettings(JSON.parse(storedData));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to load appearance settings:', errorMessage);
        return normalizeAppearanceSettings(null);
    }
}

export const saveAppearanceSettings = (data: SettingsAppearanceData) => {
    const appearance = normalizeAppearanceSettings(data);
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));

    void browser.storage.local.set({ [APPEARANCE_STORAGE_KEY]: appearance }).catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to sync appearance settings to browser.storage.local:', errorMessage);
    });
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

    void browser.storage.local.set({ [EXCLUDED_WEBSITES_STORAGE_KEY]: sanitized }).catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to save excluded websites to browser.storage.local:', errorMessage);
    });
};

export async function loadExcludedWebsitesFromChromeStorage(): Promise<string[] | null> {
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
    await browser.storage.local.set({ [GG_USER_SETTINGS]: data });
}

export const saveGGUserSettings = (data: GGUserSettingsData): void => {
    saveGGUserSettingsToLocalStorage(data);

    void saveGGUserSettingsToChromeStorage(data).catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('[gg.deals-extension] Failed to sync GG user settings to browser.storage.local:', errorMessage);
    });
};

/**
    Reads the local mirror of the user settings. Returns null when nothing usable is stored,
    so the caller fetches the real values instead of guessing them.
 */
function readStoredGGUserSettings(): GGUserSettingsData | null {
    try {
        const storedData = localStorage.getItem(GG_USER_SETTINGS);

        if (!storedData) {
            return null;
        }

        const parsedData: unknown = JSON.parse(storedData);

        return isGGUserSettingsResponse(parsedData) ? parsedData : null;
    }
    catch {
        return null;
    }
}

/**
    Returns complete user settings: browser storage first, then the local mirror, otherwise the ones
    fetched from GG.deals. Platform, region and keyshops are never made up locally.
    Fetch errors are not caught, preventing extension from using fallback or incomplete data
 */
export async function loadGGUserSettings(): Promise<GGUserSettingsData> {
    const browserUserSettings = await loadGGUserSettingsFromChromeStorage();
    if (isGGUserSettingsResponse(browserUserSettings)) {
        saveGGUserSettingsToLocalStorage(browserUserSettings);
        return browserUserSettings;
    }

    const storedUserSettings = readStoredGGUserSettings();

    if (storedUserSettings) {
        return storedUserSettings;
    }

    const userSettings = await requestGGUserSettingsSync({ mode: 'auto' });
    saveGGUserSettingsToLocalStorage(userSettings);

    return userSettings;
}

export async function loadGGUserSettingsFromChromeStorage(): Promise<GGUserSettingsData | null> {
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
        && typeof data.avatar === 'string'
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
        && isPlatform(data.platform)
        && isRegion(data.region)
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
        // Custom-site builds may need HTTP Basic Auth to reach the dev server
        credentials: import.meta.env.VITE_GG_GUEST_CREDENTIALS === 'include' ? 'include' : 'omit',
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

export const getGGApiKey = (userSettings: GGUserSettingsData | null): string | null => {
    const apiKey = userSettings?.apiKey;

    if (typeof apiKey !== 'string') {
        return null;
    }

    const trimmedApiKey = apiKey.trim();
    return trimmedApiKey.length > 0 ? trimmedApiKey : null;
};

export const withGGApiKeyHeader = (
    baseHeaders: Record<string, string>,
    userSettings: GGUserSettingsData | null,
): Record<string, string> => {
    const apiKey = getGGApiKey(userSettings);

    if (!apiKey) {
        return baseHeaders;
    }

    return {
        ...baseHeaders,
        'x-api-key': apiKey,
    };
};
