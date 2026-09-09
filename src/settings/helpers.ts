import type { RegionCurrency, SettingsData } from '../utils/extension-settings';

export {
    DEFAULT_APPEARANCE_SETTINGS,
    DEFAULT_EXTENSION_SETTINGS,
    GGInvalidApiKeyError,
    SIGNED_OUT_EXTENSION_SETTINGS,
    SIGNED_OUT_GG_USER_SETTINGS,
    getGGApiKey,
    hasGGUserSettingsData,
    isInvalidApiKeyResponse,
    loadAppearanceSettings,
    loadExcludedWebsitesFromChromeStorage,
    loadGGUserSettings,
    loadGGUserSettingsFromChromeStorage,
    loadSettings,
    loadSettingsFromChromeStorage,
    saveAppearanceSettings,
    saveExcludedWebsites,
    saveGGUserSettings,
    saveGGUserSettingsToLocalStorage,
    saveSettings,
    signOutFromExtensionMemory,
    requestGGUserSettingsSync,
    withGGApiKeyHeader
} from '../utils/extension-settings';
export type {
    AuthenticatedGGUserSettingsData,
    GGGame,
    GGGameLookupResponse,
    GGGamePrice,
    GGPayloadMessage,
    GGUserSettingsData,
    GGUserSettingsSyncOptions,
    RegionCurrency,
    SettingsAppearanceData,
    SettingsData
} from '../utils/extension-settings';

export const DARK = 'dark';
export const LIGHT = 'light';
export const SYSTEM = 'system';

export type SettingsTheme = typeof DARK | typeof LIGHT | typeof SYSTEM;

export const ROUNDED = 'rounded';
export const ROUNDED_CORNERS = 'rounded-corners';
export const ROUNDED_TOP = 'rounded-top';
export const BOTTOM_EDGE = 'bottom-edge';
export type SettingsLayout = typeof ROUNDED | typeof ROUNDED_CORNERS | typeof ROUNDED_TOP | typeof BOTTOM_EDGE;

export const FIXED = 'fixed';
export const FIT_CONTENT = 'fit-content';
export const EDGE_TO_EDGE = 'edge-to-edge';
export type BarWidth = typeof FIXED | typeof FIT_CONTENT | typeof EDGE_TO_EDGE;

export const DEALS = 'deals';
export const SETTINGS = 'settings';
export const APPEARANCE = 'appearance';

export type TabKey = typeof DEALS | typeof SETTINGS | typeof APPEARANCE;

const MD5_SHIFT_AMOUNTS = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_CONSTANTS = Array.from({ length: 64 }, (_, index) => (
    Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0
));

function rotateLeft(value: number, amount: number): number {
    return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

export function md5(value: string): string {
    const bytes = new TextEncoder().encode(value);
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    const view = new DataView(padded.buffer);
    const bitLength = bytes.length * 8;

    padded.set(bytes);
    padded[bytes.length] = 0x80;
    view.setUint32(paddedLength - 8, bitLength >>> 0, true);
    view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let offset = 0; offset < paddedLength; offset += 64) {
        const words = Array.from({ length: 16 }, (_, index) => view.getUint32(offset + index * 4, true));
        let a = a0;
        let b = b0;
        let c = c0;
        let d = d0;

        for (let index = 0; index < 64; index += 1) {
            let result: number;
            let wordIndex: number;

            if (index < 16) {
                result = (b & c) | (~b & d);
                wordIndex = index;
            } else if (index < 32) {
                result = (d & b) | (~d & c);
                wordIndex = (5 * index + 1) % 16;
            } else if (index < 48) {
                result = b ^ c ^ d;
                wordIndex = (3 * index + 5) % 16;
            } else {
                result = c ^ (b | ~d);
                wordIndex = (7 * index) % 16;
            }

            const nextB = (b + rotateLeft(
                (a + result + MD5_CONSTANTS[index] + words[wordIndex]) >>> 0,
                MD5_SHIFT_AMOUNTS[index],
            )) >>> 0;

            a = d;
            d = c;
            c = b;
            b = nextB;
        }

        a0 = (a0 + a) >>> 0;
        b0 = (b0 + b) >>> 0;
        c0 = (c0 + c) >>> 0;
        d0 = (d0 + d) >>> 0;
    }

    return [a0, b0, c0, d0]
        .flatMap((word) => [0, 8, 16, 24].map((shift) => (word >>> shift) & 0xff))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

export type ExtensionSettingsValue = {
    theme: SettingsTheme;
    layout: SettingsLayout;
};

export type ExtensionSettingsProps = {
    initialValue?: ExtensionSettingsValue;
    onChange?: (value: ExtensionSettingsValue) => void;
};

export type SettingsTabProps = {
    platform: string;
    regionCurrency: RegionCurrency | null;
    keyshopsEnabled: boolean;
    barEnabled: boolean;
    showBlacklistAlert: boolean;
    onSignInClick?: () => void;
    onPlatformChange: (value: SettingsData['platform']) => void;
    onRegionCurrencyChange: (value: RegionCurrency) => void;
    onKeyshopsEnabledChange: (value: boolean) => void;
    onBarEnabledChange: (value: boolean) => void;
};

export type AppearanceTabProps = {
    theme: SettingsTheme;
    barWidth: BarWidth;
    rounding: Exclude<SettingsLayout, 'bottom-edge'>;
    onSignInClick?: () => void;
    onThemeChange: (value: SettingsTheme) => void;
    onBarWidthChange: (value: BarWidth) => void;
    onRoundingChange: (value: Exclude<SettingsLayout, 'bottom-edge'>) => void;
};

export const ALL: string = 'all';
export const PC: string = 'pc';
export const STEAM: string = 'steam';
export const XBOX: string = 'xbox';
export const PLAYSTATION: string = 'playstation';
export const SWITCH: string = 'nintendo';
