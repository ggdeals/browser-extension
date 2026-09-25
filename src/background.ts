import {
  EPIC_AUTH_CODE_URL,
  EPIC_LIBRARY_ITEMS_URL,
  EPIC_OAUTH_CLIENT_ID,
  EPIC_OAUTH_CLIENT_SECRET,
  EPIC_STORE_HOME_URL,
  EPIC_STORE_WARMUP_WAIT_MS,
  EPIC_STORE_WISHLIST_URL,
  EPIC_TOKEN_EXPIRY_SKEW_MS,
  EPIC_TOKEN_STORAGE_KEY,
  EPIC_TOKEN_URL,
  EPIC_WISHLIST_PERSISTED_QUERY_HASH,
  EPIC_SOURCE_ID,
  NINTENDO_GRAPHQL_URL,
  NINTENDO_GRAPHQL_LANGUAGE,
  NINTENDO_GRAPHQL_NAS_LANGUAGE,
  NINTENDO_COLLECTION_DISCOVERY_URL,
  NINTENDO_COLLECTION_OPERATION,
  NINTENDO_COLLECTION_PAGE_SIZE,
  NINTENDO_NICKNAME_PAGE_TIMEOUT_MS,
  NINTENDO_SESSION_INITIAL_REFRESH_TIMEOUT_MS,
  NINTENDO_SESSION_REFRESH_POLL_INTERVAL_MS,
  NINTENDO_SESSION_REFRESH_TIMEOUT_MS,
  NINTENDO_SESSION_REFRESH_URL,
  NINTENDO_SESSION_URL,
  NINTENDO_SHOP_ID,
  NINTENDO_SAVANNA_CLIENT_ID_STORAGE_KEY,
  NINTENDO_SAVANNA_CLIENT_ID_TIMEOUT_MS,
  NINTENDO_SOURCE_ID,
  NINTENDO_WISHLIST_OPERATION,
  NINTENDO_WISHLIST_PAGE_SIZE,
  NINTENDO_WISHLIST_QUERY_HASH_STORAGE_KEY,
  NINTENDO_WISHLIST_QUERY_HASH_TIMEOUT_MS,
  PLAYSTATION_COLLECTION_URL,
  PLAYSTATION_SOURCE_ID,
  PLAYSTATION_WISHLIST_URL,
  STEAM_URL
} from './utils/sync-constants';
import {
  restoreOriginalIcon,
  SERVER_MESSAGE_ICON_COLOR,
  setGrayIcon,
  SYNC_PAGINATION_PROGRESS_MESSAGE,
} from './utils/sync-helpers';
import {
  fetchGGUserSettings,
  fetchGuestGGUserSettings,
  GGInvalidApiKeyError,
  hasGGUserSettingsData,
  isPlatform,
  isRegion,
  loadCustomMessagesFromChromeStorage,
  loadGGUserSettingsFromChromeStorage,
  processExtensionResponse,
  saveGGUserSettingsToChromeStorage,
  SYNC_GG_USER_SETTINGS_MESSAGE,
  type GGUserSettingsData,
  type GGUserSettingsSyncOptions,
} from './utils/extension-settings';
import {
  GG_CUSTOM_MESSAGES,
  GG_SERVER_MESSAGE_BADGE,
} from './utils/extension-settings-constants';
import {
  GG_USER_SETTINGS,
  POPUP_INITIAL_TAB_STORAGE_KEY,
  POPUP_SETTINGS_SCROLL_TARGET_STORAGE_KEY,
} from './settings/constants';
import browser from "webextension-polyfill";


type FetchSteamMessage = {
  type: 'FETCH_STEAM_USERDATA';
};

type FetchSteamAccountNameMessage = {
  type: 'FETCH_STEAM_ACCOUNT_NAME';
};

type PostImportDataMessage = {
  type: 'POST_IMPORT_DATA';
  url: string;
  payload: unknown;
};

type FetchEpicTokenMessage = {
  type: 'FETCH_EPIC_TOKEN';
  forceFresh?: boolean;
};

type RefreshEpicTokenMessage = {
  type: 'REFRESH_EPIC_TOKEN';
  refreshToken: string;
};

type FetchEpicLibraryItemsMessage = {
  type: 'FETCH_EPIC_LIBRARY_ITEMS';
  accessToken: string;
  isWishlist?: boolean;
};

type FetchPlaystationWishlistMessage = {
  type: 'FETCH_PLAYSTATION_WISHLIST';
  url?: string;
};

type FetchPlaystationAccountMessage = {
  type: 'FETCH_PLAYSTATION_ACCOUNT';
  url?: string;
};

type FetchPlaystationCollectionMessage = {
  type: 'FETCH_PLAYSTATION_COLLECTION';
  url?: string;
};

type FetchNintendoAccountMessage = {
  type: 'FETCH_NINTENDO_ACCOUNT';
};

type FetchNintendoWishlistMessage = {
  type: 'FETCH_NINTENDO_WISHLIST';
};

type FetchNintendoCollectionMessage = {
  type: 'FETCH_NINTENDO_COLLECTION';
};

type NintendoAccountNicknameReadyMessage = {
  type: 'NINTENDO_ACCOUNT_NICKNAME_READY';
  nickname?: string;
};

type NintendoWishlistQueryHashDiscoveredMessage = {
  type: 'NINTENDO_WISHLIST_QUERY_HASH_DISCOVERED';
  hash?: string;
};

type NintendoSavannaClientIdDiscoveredMessage = {
  type: 'NINTENDO_SAVANNA_CLIENT_ID_DISCOVERED';
  clientId?: string;
};

type NintendoCollectionBootstrapReadyMessage = {
  type: 'NINTENDO_COLLECTION_BOOTSTRAP_READY';
  clientId?: string;
  idToken?: string;
  nickname?: string;
};

type OpenUrlInNewTabMessage = {
  type: 'OPEN_URL_IN_NEW_TAB';
  url: string;
  active?: boolean;
};

type FetchTestGameDataMessage = {
  type: 'FETCH_TEST_GAME_DATA';
  url: string;
};

type OpenPopupMessage = {
  type: 'OPEN_POPUP';
  tab?: 'deals' | 'settings' | 'appearance';
  settingsScrollTarget?: 'bottom';
};

type UpdateBadgeMessage = {
  type: 'UPDATE_BADGE';
  isBlacklisted: boolean;
};

type SyncGGUserSettingsMessage = {
  type: typeof SYNC_GG_USER_SETTINGS_MESSAGE;
  options?: GGUserSettingsSyncOptions;
};

type BackgroundMessage = FetchSteamMessage | FetchSteamAccountNameMessage | PostImportDataMessage | FetchEpicTokenMessage | RefreshEpicTokenMessage | FetchEpicLibraryItemsMessage | FetchPlaystationWishlistMessage | FetchPlaystationAccountMessage | FetchPlaystationCollectionMessage | FetchNintendoAccountMessage | FetchNintendoWishlistMessage | FetchNintendoCollectionMessage | NintendoAccountNicknameReadyMessage | NintendoWishlistQueryHashDiscoveredMessage | NintendoSavannaClientIdDiscoveredMessage | NintendoCollectionBootstrapReadyMessage | OpenUrlInNewTabMessage | FetchTestGameDataMessage | OpenPopupMessage | UpdateBadgeMessage | SyncGGUserSettingsMessage;

type RuntimeMessageResponse = {
  ok: boolean;
  data?: unknown;
  error?: string;
  errorCode?: 'INVALID_API_KEY';
  status?: number;
};

const pendingNintendoNicknameResolvers = new Map<number, (nickname: string) => void>();
const pendingNintendoQueryHashResolvers = new Map<number, (hash: string) => void>();
const pendingNintendoSavannaClientIdResolvers = new Map<number, (clientId: string) => void>();
type NintendoCollectionBootstrap = {
  savannaClientId: string;
  idToken: string;
  accountId: string;
  country: string;
  username: string;
};
type NintendoCollectionBootstrapPayload = Pick<NintendoCollectionBootstrap, 'savannaClientId' | 'idToken' | 'username'>;
const pendingNintendoCollectionBootstrapResolvers = new Map<number, (bootstrap: NintendoCollectionBootstrapPayload) => void>();
let pendingNintendoCollectionBootstrap: Promise<NintendoCollectionBootstrap> | null = null;

type PaginationProgress = {
  sourceId: number;
  currentPage: number;
  totalPages?: number | null;
};

type PaginationProgressReporter = (progress: PaginationProgress) => void;

type EpicLibraryResponse = {
  records?: unknown[];
  responseMetadata?: {
    nextCursor?: string;
  };
  totalCount?: number;
  total?: number;
  count?: number;
  errorMessage?: string;
};

type EpicWishlistResponse = {
  errors?: Array<{
    message?: string;
    status?: number;
  }>;
  data?: {
    Wishlist?: {
      wishlistItems?: unknown;
    };
  };
};

type EpicTokenData = Record<string, unknown> & {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  expires_at?: number;
  stored_at?: number;
};

type GGUserSettingsStorageData = {
  apiKey?: string | null;
};

function getStorageValue<T>(key: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    browser.storage.local.get([key]).then((result) => {
      resolve((result?.[key] as T | undefined) ?? null);
    }).catch((error) => {
      reject(new Error(error.message));
    });
  });
}

function setStorageValue<T>(key: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    browser.storage.local.set({ [key]: value }).then(() => {
      resolve();
    }).catch((error) => {
      reject(new Error(error.message));
    });
  });
}

function getPositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.floor(value);
}

const ggUserSettingsSyncs = new Map<string, Promise<GGUserSettingsData>>();
let ggUserSettingsSyncQueue: Promise<void> = Promise.resolve();

function synchronizeGGUserSettings(options: GGUserSettingsSyncOptions = {}): Promise<GGUserSettingsData> {
  const syncKey = JSON.stringify(options);
  const pendingSync = ggUserSettingsSyncs.get(syncKey);
  if (pendingSync) {
    return pendingSync;
  }

  const sync = ggUserSettingsSyncQueue
    .catch(() => undefined)
    .then(async () => {
      const existingUserSettings = await loadGGUserSettingsFromChromeStorage();
      const mode = options.mode ?? 'auto';

      // "auto" keeps the cached value and only fetches when it is missing or unsupported
      if (mode === 'auto'
        && isPlatform(existingUserSettings?.platform)
        && isRegion(existingUserSettings?.region)) {
        return existingUserSettings;
      }

      const useGuestRequest = mode === 'guest'
        || (mode === 'auto' && !hasGGUserSettingsData(existingUserSettings));
      const freshUserSettings = useGuestRequest
        ? await fetchGuestGGUserSettings()
        : await fetchGGUserSettings(existingUserSettings, {
            includeApiKeyHeader: options.includeApiKeyHeader ?? true,
            credentials: 'include',
          });

      if (options.requireAuthenticated && !hasGGUserSettingsData(freshUserSettings)) {
        return freshUserSettings;
      }

      const nextUserSettings: GGUserSettingsData = {
        ...freshUserSettings,
        ...options.overrides,
      };
      await saveGGUserSettingsToChromeStorage(nextUserSettings);
      return nextUserSettings;
    });

  ggUserSettingsSyncs.set(syncKey, sync);
  ggUserSettingsSyncQueue = sync.then(() => undefined, () => undefined);
  void sync.finally(() => {
    if (ggUserSettingsSyncs.get(syncKey) === sync) {
      ggUserSettingsSyncs.delete(syncKey);
    }
  }).catch(() => undefined);

  return sync;
}

function sendPaginationProgressToTab(tabId: number | undefined, progress: PaginationProgress): void {
  if (typeof tabId !== 'number') {
    return;
  }

  void browser.tabs.sendMessage(tabId, {
    type: SYNC_PAGINATION_PROGRESS_MESSAGE,
    ...progress
  }).catch((error) => {
    console.warn('[gg.deals-extension][background] Failed to send pagination progress:', error);
  });
}

const TAB_GRAY_ICON_STATES_STORAGE_KEY = 'gg-ext-tab-gray-icon-states';
const tabGrayIconStates = new Map<number, boolean>();
let tabGrayIconStatesLoaded = false;
let serverMessageIconIndicatorEnabled: boolean | null = null;
let serverMessageIconIndicatorApplied = true;

async function loadTabGrayIconStates(): Promise<void> {
  if (tabGrayIconStatesLoaded) {
    return;
  }

  const stored = await browser.storage.session.get([TAB_GRAY_ICON_STATES_STORAGE_KEY]);
  const states = stored[TAB_GRAY_ICON_STATES_STORAGE_KEY];
  if (states && typeof states === 'object' && !Array.isArray(states)) {
    for (const [tabIdValue, isGray] of Object.entries(states)) {
      const tabId = Number(tabIdValue);
      if (Number.isInteger(tabId) && typeof isGray === 'boolean') {
        tabGrayIconStates.set(tabId, isGray);
      }
    }
  }
  tabGrayIconStatesLoaded = true;
}

async function storeTabGrayIconStates(): Promise<void> {
  await browser.storage.session.set({
    [TAB_GRAY_ICON_STATES_STORAGE_KEY]: Object.fromEntries(tabGrayIconStates),
  });
}

async function setServerMessageIconIndicator(enabled: boolean): Promise<boolean> {
  await loadTabGrayIconStates();
  if (serverMessageIconIndicatorEnabled === enabled) {
    return serverMessageIconIndicatorApplied;
  }

  const updates: Array<Promise<boolean>> = [restoreOriginalIcon(undefined, enabled)];
  for (const [tabId, isGray] of tabGrayIconStates) {
    updates.push(isGray
      ? setGrayIcon(tabId, enabled)
      : restoreOriginalIcon(tabId, enabled));
  }

  const results = await Promise.all(updates.map((update) => update.catch(() => false)));
  serverMessageIconIndicatorEnabled = enabled;
  serverMessageIconIndicatorApplied = results.every(Boolean);

  return serverMessageIconIndicatorApplied;
}

async function synchronizeCustomMessageState(): Promise<void> {
  const [messages, badgeStorage] = await Promise.all([
    loadCustomMessagesFromChromeStorage(),
    browser.storage.local.get([GG_SERVER_MESSAGE_BADGE]),
  ]);
  const visibleBadgeMessages = messages.filter(
    (message) => message.showBadge && !message.dismissed && !message.badgeAcknowledged
  );
  const hasRateLimitBadge = visibleBadgeMessages.some((message) => message.badgeType === 'rate-limit');
  const hasServerMessageBadge = badgeStorage[GG_SERVER_MESSAGE_BADGE] === true
    || visibleBadgeMessages.some((message) => message.badgeType === 'server');

  if (hasRateLimitBadge) {
    await setServerMessageIconIndicator(false);
    await browser.action.setBadgeTextColor({ color: '#FFFFFF' }).catch(() => undefined);
    await browser.action.setBadgeBackgroundColor({ color: '#E5484D' });
    await browser.action.setBadgeText({ text: '!' });
  } else if (hasServerMessageBadge) {
    const iconIndicatorSet = await setServerMessageIconIndicator(true);
    if (iconIndicatorSet) {
      await browser.action.setBadgeText({ text: '' });
    } else {
      await browser.action.setBadgeTextColor({ color: '#3B2F00' }).catch(() => undefined);
      await browser.action.setBadgeBackgroundColor({ color: SERVER_MESSAGE_ICON_COLOR });
      await browser.action.setBadgeText({ text: '\u200A' });
    }
  } else {
    await setServerMessageIconIndicator(false);
    await browser.action.setBadgeText({ text: '' });
  }
}

let customMessageStateSynchronizationQueue: Promise<void> = Promise.resolve();

function queueCustomMessageStateSynchronization(): Promise<void> {
  customMessageStateSynchronizationQueue = customMessageStateSynchronizationQueue
    .catch(() => undefined)
    .then(synchronizeCustomMessageState);

  return customMessageStateSynchronizationQueue;
}

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || (!changes[GG_CUSTOM_MESSAGES] && !changes[GG_SERVER_MESSAGE_BADGE])) {
    return;
  }

  void queueCustomMessageStateSynchronization().catch((error: unknown) => {
    console.warn('[gg.deals-extension][background] Failed to update message badge:', error);
  });
});

void queueCustomMessageStateSynchronization().catch((error: unknown) => {
  console.warn('[gg.deals-extension][background] Failed to initialize message badge:', error);
});

browser.tabs.onRemoved.addListener((tabId) => {
  void loadTabGrayIconStates().then(async () => {
    if (tabGrayIconStates.delete(tabId)) {
      await storeTabGrayIconStates();
    }
  }).catch((error: unknown) => {
    console.warn('[gg.deals-extension][background] Failed to remove tab icon state:', error);
  });
});

function resolveEpicTotalPages(libraryData: EpicLibraryResponse, pageSize: number): number | null {
  if (pageSize <= 0) {
    return null;
  }

  const totalItems = getPositiveInteger(libraryData.totalCount)
    ?? getPositiveInteger(libraryData.total)
    ?? getPositiveInteger(libraryData.count);

  return totalItems === null ? null : Math.max(1, Math.ceil(totalItems / pageSize));
}

async function readGGApiKeyFromStorage(): Promise<string | null> {
  try {
    const settings = await getStorageValue<GGUserSettingsStorageData>(GG_USER_SETTINGS);
    const apiKey = settings?.apiKey;

    if (typeof apiKey !== 'string') {
      return null;
    }

    const trimmedApiKey = apiKey.trim();
    return trimmedApiKey.length > 0 ? trimmedApiKey : null;
  } catch (error) {
    console.warn('[gg.deals-extension][background] Failed to read GG apiKey from storage:', error);
    return null;
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function resolveEpicTokenExpiryMs(token: EpicTokenData): number | null {
  const expiresAt = toNumber(token.expires_at);
  if (expiresAt && expiresAt > 0) {
    return expiresAt;
  }

  const expiresInSeconds = toNumber(token.expires_in);
  if (!expiresInSeconds || expiresInSeconds <= 0) {
    return null;
  }

  const storedAt = toNumber(token.stored_at) ?? Date.now();
  return storedAt + (expiresInSeconds * 1000);
}

function isEpicTokenStillValid(token: EpicTokenData): boolean {
  if (typeof token.access_token !== 'string' || token.access_token.trim().length === 0) {
    return false;
  }

  const expiresAtMs = resolveEpicTokenExpiryMs(token);
  if (!expiresAtMs) {
    return true;
  }

  return expiresAtMs > (Date.now() + EPIC_TOKEN_EXPIRY_SKEW_MS);
}

async function readStoredEpicToken(): Promise<EpicTokenData | null> {
  const stored = await getStorageValue<unknown>(EPIC_TOKEN_STORAGE_KEY);
  if (!stored || typeof stored !== 'object') {
    return null;
  }

  return stored as EpicTokenData;
}

async function saveEpicToken(tokenData: EpicTokenData): Promise<EpicTokenData> {
  const nowMs = Date.now();
  const normalized: EpicTokenData = {
    ...tokenData,
    stored_at: nowMs
  };

  const expiresAt = toNumber(normalized.expires_at);
  if (!expiresAt || expiresAt <= 0) {
    const expiresInSeconds = toNumber(normalized.expires_in);
    if (expiresInSeconds && expiresInSeconds > 0) {
      normalized.expires_at = nowMs + (expiresInSeconds * 1000);
    }
  }

  await setStorageValue(EPIC_TOKEN_STORAGE_KEY, normalized);
  return normalized;
}

function preserveEpicRefreshToken(tokenData: EpicTokenData, fallbackToken: EpicTokenData | null): EpicTokenData {
  const nextRefreshToken = typeof tokenData.refresh_token === 'string' ? tokenData.refresh_token.trim() : '';
  if (nextRefreshToken) {
    return tokenData;
  }

  const nextAccountId = typeof tokenData.account_id === 'string' ? tokenData.account_id.trim() : '';
  const fallbackAccountId = typeof fallbackToken?.account_id === 'string'
    ? fallbackToken.account_id.trim()
    : '';
  if (!nextAccountId || !fallbackAccountId || nextAccountId !== fallbackAccountId) {
    return tokenData;
  }

  const fallbackRefreshToken = typeof fallbackToken?.refresh_token === 'string'
    ? fallbackToken.refresh_token.trim()
    : '';
  if (!fallbackRefreshToken) {
    return tokenData;
  }

  return {
    ...tokenData,
    refresh_token: fallbackRefreshToken
  };
}

async function exchangeEpicToken(tokenBody: URLSearchParams, operationLabel: string): Promise<EpicTokenData> {
  const basicToken = btoa(`${EPIC_OAUTH_CLIENT_ID}:${EPIC_OAUTH_CLIENT_SECRET}`);
  const tokenResponse = await fetch(EPIC_TOKEN_URL, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'Authorization': `Basic ${basicToken}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: tokenBody.toString()
  });

  console.log(`[gg.deals-extension][background] ${operationLabel} status:`, tokenResponse.status);

  const tokenData = await tokenResponse.json() as EpicTokenData;
  console.log(`[gg.deals-extension][background] ${operationLabel} payload keys:`, Object.keys(tokenData ?? {}));
  if (!tokenResponse.ok || typeof tokenData.error === 'string') {
    const description = typeof tokenData.error_description === 'string' ? tokenData.error_description : undefined;
    const messageText = typeof tokenData.errorMessage === 'string' ? tokenData.errorMessage : undefined;
    const code = typeof tokenData.errorCode === 'string' ? tokenData.errorCode : undefined;
    throw new Error(description ?? messageText ?? code ?? `HTTP ${tokenResponse.status}`);
  }

  return tokenData;
}

async function fetchEpicAuthCodeFromSession(): Promise<string> {
  console.log('[gg.deals-extension][background] FETCH_EPIC_TOKEN auth code URL:', EPIC_AUTH_CODE_URL);
  const authCodeResponse = await fetch(EPIC_AUTH_CODE_URL, {
    method: 'GET',
    credentials: 'include'
  });

  console.log('[gg.deals-extension][background] FETCH_EPIC_TOKEN auth code status:', authCodeResponse.status);

  const authCodeData = await authCodeResponse.json() as { authorizationCode?: string; errorMessage?: string; error?: string };
  console.log('[gg.deals-extension][background] FETCH_EPIC_TOKEN auth code payload keys:', Object.keys(authCodeData ?? {}));

  if (!authCodeResponse.ok) {
    throw new Error(authCodeData?.errorMessage ?? authCodeData?.error ?? `HTTP ${authCodeResponse.status}`);
  }

  const authorizationCode = authCodeData?.authorizationCode;
  if (!authorizationCode) {
    throw new Error('authorizationCode missing in Epic response');
  }

  return authorizationCode;
}

async function fetchEpicTokenByAuthorizationCode(): Promise<EpicTokenData> {
  const authorizationCode = await fetchEpicAuthCodeFromSession();
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code: authorizationCode,
    token_type: 'eg1'
  });

  console.log('[gg.deals-extension][background] FETCH_EPIC_TOKEN token exchange start');
  return exchangeEpicToken(tokenBody, 'FETCH_EPIC_TOKEN token exchange');
}

async function refreshEpicTokenByRefreshToken(refreshToken: string): Promise<EpicTokenData> {
  const tokenBody = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });

  console.log('[gg.deals-extension][background] REFRESH_EPIC_TOKEN exchange start');
  return exchangeEpicToken(tokenBody, 'REFRESH_EPIC_TOKEN exchange');
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildEpicWishlistUrl(accountId: string): string {
  const requestUrl = new URL(EPIC_STORE_WISHLIST_URL);
  requestUrl.searchParams.set('operationName', 'getWishlist');
  requestUrl.searchParams.set('variables', JSON.stringify({ accountId }));
  requestUrl.searchParams.set('extensions', JSON.stringify({
    persistedQuery: {
      version: 1,
      sha256Hash: EPIC_WISHLIST_PERSISTED_QUERY_HASH
    }
  }));

  return requestUrl.toString();
}

function isEpicWishlistNotLoggedIn(payload: EpicWishlistResponse): boolean {
  if (!Array.isArray(payload?.errors)) {
    return false;
  }

  return payload.errors.some((errorItem) => {
    const message = typeof errorItem?.message === 'string' ? errorItem.message : '';
    return message.includes('com.epicgames.wishlist.notLoggedIn');
  });
}

function getEpicWishlistErrorMessage(payload: EpicWishlistResponse, httpStatus: number): string {
  const firstError = Array.isArray(payload?.errors) ? payload.errors[0] : undefined;
  const firstMessage = typeof firstError?.message === 'string' ? firstError.message : '';
  if (firstMessage.trim().length > 0) {
    return firstMessage;
  }

  return `Epic wishlist request failed (HTTP ${httpStatus})`;
}

async function warmupEpicStoreInBackgroundTab(): Promise<void> {
  const tab = await browser.tabs.create({ url: EPIC_STORE_HOME_URL, active: false });

  await wait(EPIC_STORE_WARMUP_WAIT_MS);

  if (typeof tab.id === 'number') {
    try {
      await browser.tabs.remove(tab.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('[gg.deals-extension][background] Failed to close Epic warmup tab:', errorMessage);
    }
  }
}

async function fetchEpicWishlistGraphQL(accessToken: string, accountId: string): Promise<EpicWishlistResponse> {
  const wishlistUrl = buildEpicWishlistUrl(accountId);
  const response = await fetch(wishlistUrl, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Accept': 'application/json',
      'Authorization': `bearer ${accessToken}`
    }
  });

  console.log('[gg.deals-extension][background] FETCH_EPIC_WISHLIST status:', response.status);

  const payload = await response.json() as EpicWishlistResponse;
  if (!response.ok || (Array.isArray(payload.errors) && payload.errors.length > 0)) {
    if (isEpicWishlistNotLoggedIn(payload)) {
      throw new Error('EPIC_WISHLIST_NOT_LOGGED_IN');
    }

    throw new Error(getEpicWishlistErrorMessage(payload, response.status));
  }

  return payload;
}

async function fetchEpicWishlistWithRetry(accessToken: string): Promise<unknown> {
  const storedToken = await readStoredEpicToken();
  const accountId = typeof storedToken?.account_id === 'string' ? storedToken.account_id.trim() : '';
  if (!accountId) {
    throw new Error('Missing account_id in stored Epic token');
  }

  try {
    const payload = await fetchEpicWishlistGraphQL(accessToken, accountId);
    return payload?.data?.Wishlist?.wishlistItems ?? payload;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage !== 'EPIC_WISHLIST_NOT_LOGGED_IN') {
      throw error;
    }

    console.warn('[gg.deals-extension][background] FETCH_EPIC_WISHLIST not logged in, warming Epic store session and retrying once');
    await warmupEpicStoreInBackgroundTab();

    try {
      const retryPayload = await fetchEpicWishlistGraphQL(accessToken, accountId);
      return retryPayload?.data?.Wishlist?.wishlistItems ?? retryPayload;
    } catch (retryError) {
      const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
      if (retryMessage === 'EPIC_WISHLIST_NOT_LOGGED_IN') {
        throw new Error('Epic wishlist request failed after warmup retry: not logged in');
      }

      throw retryError;
    }
  }
}

async function fetchEpicLibraryItemsWithPagination(
  accessToken: string,
  reportProgress?: PaginationProgressReporter
): Promise<unknown[]> {
  const records: unknown[] = [];
  let cursor: string | null = null;
  let page = 1;
  let expectedPages: number | null = null;

  while (true) {
    const requestUrl = new URL(EPIC_LIBRARY_ITEMS_URL);
    requestUrl.searchParams.set('includeMetadata', 'true');
    if (cursor) {
      requestUrl.searchParams.set('cursor', cursor);
    }

    console.log('[gg.deals-extension][background] FETCH_EPIC_LIBRARY_ITEMS requesting page:', page, 'cursor:', cursor ?? '<none>');

    const libraryResponse = await fetch(requestUrl.toString(), {
      method: 'GET',
      credentials: 'omit',
      headers: {
        'Authorization': `bearer ${accessToken}`
      }
    });

    console.log('[gg.deals-extension][background] FETCH_EPIC_LIBRARY_ITEMS page status:', libraryResponse.status);

    const libraryData = await libraryResponse.json() as EpicLibraryResponse;
    if (!libraryResponse.ok) {
      throw new Error(libraryData?.errorMessage ?? `HTTP ${libraryResponse.status}`);
    }

    const pageRecords = Array.isArray(libraryData.records) ? libraryData.records : [];
    records.push(...pageRecords);
    console.log('[gg.deals-extension][background] FETCH_EPIC_LIBRARY_ITEMS page records:', pageRecords.length, 'total:', records.length);

    const nextCursor = libraryData?.responseMetadata?.nextCursor;
    expectedPages = resolveEpicTotalPages(libraryData, pageRecords.length) ?? expectedPages;
    reportProgress?.({
      sourceId: EPIC_SOURCE_ID,
      currentPage: page,
      totalPages: expectedPages ?? (nextCursor ? null : page)
    });

    if (!nextCursor) {
      break;
    }

    cursor = nextCursor;
    page += 1;
  }

  return records;
}

console.log('[gg.deals-extension][background] service worker loaded');

type SteamAccountInfo = {
  account_name: string;
  steamid: string;
};

function decodeHtmlAttributeValue(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}

function extractSteamAccountName(html: string): SteamAccountInfo | null {
  const applicationConfigMatch = html.match(/<div[^>]*id=["']application_config["'][^>]*data-userinfo="([\s\S]*?)"[^>]*>/i);
  if (!applicationConfigMatch?.[1]) {
    return null;
  }

  const rawUserInfo = decodeHtmlAttributeValue(applicationConfigMatch[1]);
  let parsedUserInfo: unknown;

  try {
    parsedUserInfo = JSON.parse(rawUserInfo) as unknown;
  } catch {
    return null;
  }

  if (!parsedUserInfo || typeof parsedUserInfo !== 'object') {
    return null;
  }

  const accountName = (parsedUserInfo as { account_name?: unknown }).account_name;
  const steamId = (parsedUserInfo as { steamid?: unknown }).steamid;
  if (typeof accountName !== 'string' || typeof steamId !== 'string') {
    return null;
  }

  const normalizedAccountName = accountName.trim();
  const normalizedSteamId = steamId.trim();
  if (!normalizedAccountName || !normalizedSteamId) {
    return null;
  }

  return {
    account_name: normalizedAccountName,
    steamid: normalizedSteamId
  };
}

async function fetchPlaystationWishlistHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    redirect: 'manual',
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });

  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    throw new Error('PLAYSTATION_AUTH_REQUIRED');
  }

  const resolvedUrl = response.url || url;
  if (response.redirected && resolvedUrl.toLowerCase().includes('/signin')) {
    throw new Error('PLAYSTATION_AUTH_REQUIRED');
  }

  console.log('[gg.deals-extension][background] FETCH_PLAYSTATION_WISHLIST status:', response.status);
  if (!response.ok) {
    throw new Error(`PlayStation wishlist request failed (HTTP ${response.status})`);
  }

  return response.text();
}

async function fetchPlaystationCollectionHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    redirect: 'manual',
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });

  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    throw new Error('PLAYSTATION_AUTH_REQUIRED');
  }

  const resolvedUrl = response.url || url;
  if (response.redirected && resolvedUrl.toLowerCase().includes('/signin')) {
    throw new Error('PLAYSTATION_AUTH_REQUIRED');
  }

  console.log('[gg.deals-extension][background] FETCH_PLAYSTATION_COLLECTION status:', response.status);
  if (!response.ok) {
    throw new Error(`PlayStation collection request failed (HTTP ${response.status})`);
  }

  return response.text();
}

function extractPlaystationNextDataPayload(html: string): unknown {
  const nextDataMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!nextDataMatch?.[1]) {
    throw new Error('PlayStation wishlist: script#__NEXT_DATA__ not found');
  }

  const rawPayload = nextDataMatch[1].trim();
  if (!rawPayload) {
    throw new Error('PlayStation wishlist: __NEXT_DATA__ is empty');
  }

  try {
    return JSON.parse(rawPayload) as unknown;
  } catch {
    throw new Error('PlayStation wishlist: failed to parse __NEXT_DATA__ JSON');
  }
}

function extractPlaystationApolloState(nextDataPayload: unknown): unknown {
  if (!nextDataPayload || typeof nextDataPayload !== 'object') {
    throw new Error('PlayStation wishlist: __NEXT_DATA__ payload is invalid');
  }

  const props = (nextDataPayload as { props?: unknown }).props;
  if (!props || typeof props !== 'object') {
    throw new Error('PlayStation wishlist: props field is missing');
  }

  if (!Object.prototype.hasOwnProperty.call(props, 'apolloState')) {
    throw new Error('PlayStation wishlist: props.apolloState not found');
  }

  return (props as { apolloState?: unknown }).apolloState;
}

function extractPlaystationAccountId(nextDataPayload: unknown): string | null {
  if (!nextDataPayload || typeof nextDataPayload !== 'object') {
    return null;
  }

  const props = (nextDataPayload as { props?: unknown }).props;
  if (!props || typeof props !== 'object') {
    return null;
  }

  const appProps = (props as { appProps?: unknown }).appProps;
  if (!appProps || typeof appProps !== 'object') {
    return null;
  }

  const session = (appProps as { session?: unknown }).session;
  if (!session || typeof session !== 'object') {
    return null;
  }

  const userData = (session as { userData?: unknown }).userData;
  if (!userData || typeof userData !== 'object') {
    return null;
  }

  const accountId = (userData as { accountId?: unknown }).accountId;
  if (typeof accountId !== 'string') {
    return null;
  }

  const normalized = accountId.trim();
  return normalized.length > 0 ? normalized : null;
}

function extractPlaystationOnlineId(nextDataPayload: unknown): string | null {
  if (!nextDataPayload || typeof nextDataPayload !== 'object') {
    return null;
  }
  const props = (nextDataPayload as { props?: unknown }).props;
  if (!props || typeof props !== 'object') {
    return null;
  }
  const appProps = (props as { appProps?: unknown }).appProps;
  if (!appProps || typeof appProps !== 'object') {
    return null;
  }
  const session = (appProps as { session?: unknown }).session;
  if (!session || typeof session !== 'object') {
    return null;
  }
  const userData = (session as { userData?: unknown }).userData;
  if (!userData || typeof userData !== 'object') {
    return null;
  }
  const onlineId = (userData as { onlineId?: unknown }).onlineId;
  if (typeof onlineId !== 'string') {
    return null;
  }

  const normalized = onlineId.trim();
  return normalized.length > 0 ? normalized : null;
}

type PlaystationCollectionPageInfo = {
  isLast?: boolean;
  size?: number;
  totalCount?: number;
  offset?: number;
};

type PlaystationCollectionPageData = {
  games: unknown[];
  pageInfo: PlaystationCollectionPageInfo | null;
  page: number;
};

type NintendoSessionLocaleInfo = {
  country: string;
  language: string;
};

type NintendoSessionResponse = {
  user?: Record<string, unknown>;
  expires?: string;
  idToken?: string;
  naId?: string;
  country?: string;
  region?: string;
  language?: string;
  localeInfo?: NintendoSessionLocaleInfo;
  isIdTokenExpired?: boolean;
};

type NintendoWishlistOffsetInfo = {
  offset: number;
  total: number;
};

type NintendoWishlistItemV2 = Record<string, unknown> & {
  __typename: string;
};

type NintendoWishlistItem = Record<string, unknown> & {
  nsUid: string;
  itemV2: NintendoWishlistItemV2 | null;
};

type NintendoGraphQLError = {
  message: string;
  extensions?: {
    type?: string;
    status?: number;
    module?: string;
    title?: string;
    errorCode?: string;
    traceId?: string;
  };
};

type NintendoWishlistGraphQLResponse = {
  errors?: NintendoGraphQLError[];
  data?: {
    account?: {
      wishlist?: {
        wishlistItems?: {
          items: NintendoWishlistItem[];
          offsetInfo: NintendoWishlistOffsetInfo;
        };
      };
    };
  };
};

type NintendoCollectionOffsetInfo = {
  offset: number;
  total: number;
};

type NintendoCollectionView = Record<string, unknown> & {
  id: string;
};

type NintendoCollectionGraphQLResponse = {
  errors?: NintendoGraphQLError[];
  data?: {
    account?: {
      vgc?: {
        vgcViews?: {
          views: NintendoCollectionView[];
          offsetInfo: NintendoCollectionOffsetInfo;
        };
      };
    };
  };
};

const NINTENDO_COLLECTION_QUERY = `query getVgcsVgcs(
  $idToken: String!
  $isHidden: Boolean!
  $country: CountryCode!
  $language: LanguageCode!
  $shopId: Int!
  $limit: Int!
  $nasLanguage: String!
  $offset: Int!
  $order: RequestableVgcViewOrder!
  $sortBy: RequestableVgcViewSortBy!
  $vgcViewType: VgcViewTypeInput
  $vgcViewStatus: VgcViewStatusInput
) @inContext(country: $country, language: $language, shopId: $shopId) {
  account {
    vgc {
      vgcViews(
        idToken: $idToken,
        limit: $limit,
        nasLanguage: $nasLanguage,
        offset: $offset,
        order: $order,
        sortBy: $sortBy,
        isHidden: $isHidden,
        vgcViewType: $vgcViewType,
        vgcViewStatus: $vgcViewStatus,
      ) {
        offsetInfo {
          total
          offset
        }
        views {
          id
          applicationId
          applicationName
          apparentPlatform
          publisher
          icon {
            url
            upgradedIconUrl
            sizes
          }
          ownerNaId
          userNaId
          isHidden
          isLending
          isDisabledAllContents
          isPartialLending
          lendingExpireDatetime
          insertedNsDeviceId
          hasReleasedApplication
          hasReleasedAddOnContents
          hasReleasedUpgrade
          hasReleasedNxApplication
          hasReleasedNxAddOnContents
          hasReleasedOunceApplication
          hasReleasedOunceAddOnContents
          containsReleased
          containsUnreleased
        }
      }
    }
  }
}`;

class NintendoWishlistQueryHashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NintendoWishlistQueryHashError';
  }
}

function extractPlaystationCollectionPageData(nextDataPayload: unknown): PlaystationCollectionPageData {
  if (!nextDataPayload || typeof nextDataPayload !== 'object') {
    throw new Error('PlayStation collection: __NEXT_DATA__ payload is invalid');
  }

  const props = (nextDataPayload as { props?: unknown }).props;
  if (!props || typeof props !== 'object') {
    throw new Error('PlayStation collection: props field is missing');
  }

  const pageProps = (props as { pageProps?: unknown }).pageProps;
  const pageValue = pageProps && typeof pageProps === 'object'
    ? (pageProps as { page?: unknown }).page
    : undefined;
  const page = typeof pageValue === 'number' && Number.isFinite(pageValue) && pageValue > 0
    ? Math.floor(pageValue)
    : 1;

  const apolloState = (props as { apolloState?: unknown }).apolloState;
  if (!apolloState || typeof apolloState !== 'object') {
    throw new Error('PlayStation collection: props.apolloState not found');
  }

  const rootQuery = (apolloState as { ROOT_QUERY?: unknown }).ROOT_QUERY;
  if (!rootQuery || typeof rootQuery !== 'object') {
    throw new Error('PlayStation collection: apolloState.ROOT_QUERY not found');
  }

  const purchasedEntry = Object.entries(rootQuery).find(([key, value]) => {
    if (!key.startsWith('purchasedTitlesRetrieve(')) {
      return false;
    }

    if (!value || typeof value !== 'object') {
      return false;
    }

    return Array.isArray((value as { games?: unknown }).games);
  });

  if (!purchasedEntry) {
    throw new Error('PlayStation collection: purchasedTitlesRetrieve(...) not found in ROOT_QUERY');
  }

  const collectionNode = purchasedEntry[1] as { games?: unknown; pageInfo?: unknown };
  const games = Array.isArray(collectionNode.games) ? collectionNode.games : [];

  let pageInfo: PlaystationCollectionPageInfo | null = null;
  if (collectionNode.pageInfo && typeof collectionNode.pageInfo === 'object') {
    const rawPageInfo = collectionNode.pageInfo as Record<string, unknown>;
    pageInfo = {
      isLast: typeof rawPageInfo.isLast === 'boolean' ? rawPageInfo.isLast : undefined,
      size: typeof rawPageInfo.size === 'number' && Number.isFinite(rawPageInfo.size) ? rawPageInfo.size : undefined,
      totalCount: typeof rawPageInfo.totalCount === 'number' && Number.isFinite(rawPageInfo.totalCount) ? rawPageInfo.totalCount : undefined,
      offset: typeof rawPageInfo.offset === 'number' && Number.isFinite(rawPageInfo.offset) ? rawPageInfo.offset : undefined
    };
  }

  return { games, pageInfo, page };
}

function buildPlaystationCollectionPageUrl(baseUrl: string, page: number): string {
  const target = new URL(baseUrl);
  target.searchParams.set('page', String(page));
  return target.toString();
}

async function fetchPlaystationCollectionWithPagination(url: string, reportProgress?: PaginationProgressReporter): Promise<{
  accountId: string | null;
  onlineId: string | null;
  games: unknown[];
  pageInfo: PlaystationCollectionPageInfo | null;
}> {
  const allGames: unknown[] = [];
  let accountId: string | null = null;
  let onlineId: string | null = null;
  let lastPageInfo: PlaystationCollectionPageInfo | null = null;
  let page = 1;
  let expectedPages: number | null = null;
  let expectedPageSize: number | null = null;

  while (page <= 50) { // todo: probably this should not be hardcoded

    const requestUrl = page === 1 ? url : buildPlaystationCollectionPageUrl(url, page);
    console.log('[gg.deals-extension][background] FETCH_PLAYSTATION_COLLECTION requesting page:', page, requestUrl);

    const html = await fetchPlaystationCollectionHtml(requestUrl);
    const nextDataPayload = extractPlaystationNextDataPayload(html);
    const pageData = extractPlaystationCollectionPageData(nextDataPayload);

    if (!accountId) {
      accountId = extractPlaystationAccountId(nextDataPayload);
    }
    if (!onlineId) {
      onlineId = extractPlaystationOnlineId(nextDataPayload);
    }

    allGames.push(...pageData.games);
    lastPageInfo = pageData.pageInfo;

    const size = pageData.pageInfo?.size;
    const totalCount = pageData.pageInfo?.totalCount;
    if (typeof size === 'number' && size > 0) {
      expectedPageSize = Math.max(expectedPageSize ?? 0, size);
    }
    if (expectedPageSize !== null && typeof totalCount === 'number' && totalCount >= 0) {
      expectedPages = Math.max(page, Math.ceil(totalCount / expectedPageSize));
    }

    const isLast = pageData.pageInfo?.isLast === true;
    console.log('[gg.deals-extension][background] FETCH_PLAYSTATION_COLLECTION page stats:', {
      page,
      pageGames: pageData.games.length,
      totalGames: allGames.length,
      isLast,
      expectedPageSize: expectedPageSize ?? '<unknown>',
      expectedPages: expectedPages ?? '<unknown>'
    });

    reportProgress?.({
      sourceId: PLAYSTATION_SOURCE_ID,
      currentPage: page,
      totalPages: expectedPages ?? (isLast ? page : null)
    });

    if (isLast) {
      break;
    }

    if (expectedPages !== null && page >= expectedPages) {
      break;
    }

    if (pageData.games.length === 0 && expectedPages === null) {
      break;
    }

    page += 1;
  }

  return {
    accountId,
    onlineId,
    games: allGames,
    pageInfo: lastPageInfo
  };
}

function getNintendoTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getNintendoNonNegativeInteger(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.floor(value);
}

// Both the wishlist persisted query hash and the Savanna client ID are SHA-256 hex strings.
function isNintendoSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

type NintendoWishlistFrontendConfig = {
  queryHash: string;
  savannaClientId: string;
};

async function readNintendoWishlistQueryHash(): Promise<string | null> {
  const storedValues = await browser.storage.local.get(NINTENDO_WISHLIST_QUERY_HASH_STORAGE_KEY);
  const storedHash = storedValues[NINTENDO_WISHLIST_QUERY_HASH_STORAGE_KEY];
  if (isNintendoSha256Hex(storedHash)) {
    return storedHash.toLowerCase();
  }

  if (typeof storedHash !== 'undefined') {
    await browser.storage.local.remove(NINTENDO_WISHLIST_QUERY_HASH_STORAGE_KEY);
  }
  return null;
}

async function saveNintendoWishlistQueryHash(hash: string): Promise<void> {
  await browser.storage.local.set({
    [NINTENDO_WISHLIST_QUERY_HASH_STORAGE_KEY]: hash.toLowerCase()
  });
}

async function readNintendoSavannaClientId(): Promise<string | null> {
  const storedValues = await browser.storage.local.get(NINTENDO_SAVANNA_CLIENT_ID_STORAGE_KEY);
  const storedClientId = storedValues[NINTENDO_SAVANNA_CLIENT_ID_STORAGE_KEY];
  if (isNintendoSha256Hex(storedClientId)) {
    return storedClientId.toLowerCase();
  }

  if (typeof storedClientId !== 'undefined') {
    await browser.storage.local.remove(NINTENDO_SAVANNA_CLIENT_ID_STORAGE_KEY);
  }
  return null;
}

async function saveNintendoSavannaClientId(clientId: string): Promise<void> {
  await browser.storage.local.set({
    [NINTENDO_SAVANNA_CLIENT_ID_STORAGE_KEY]: clientId.toLowerCase()
  });
}

function createNintendoTabValueWait<T>(
  tabId: number,
  resolvers: Map<number, (value: T) => void>,
  timeoutMs: number,
  unavailableError: string
): { promise: Promise<T>; cancel: () => void } {
  let cancel = (): void => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    let settled = false;
    const rejectUnavailable = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolvers.delete(tabId);
      reject(new Error(unavailableError));
    };
    const timeoutId = setTimeout(rejectUnavailable, timeoutMs);
    cancel = () => {
      clearTimeout(timeoutId);
      rejectUnavailable();
    };

    resolvers.set(tabId, (value: T) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolvers.delete(tabId);
      resolve(value);
    });
  });

  // Keep a rejection handler attached if navigation fails before the promise is awaited.
  void promise.catch(() => undefined);
  return { promise, cancel };
}

async function discoverNintendoWishlistFrontendConfig(
  knownQueryHash: string | null,
  knownSavannaClientId: string | null
): Promise<NintendoWishlistFrontendConfig> {
  let tabId: number | undefined;
  const cancelWaits: Array<() => void> = [];
  try {
    // Register the resolvers before navigating so fast discoveries cannot be missed.
    const tab = await browser.tabs.create({ url: 'about:blank', active: false });
    tabId = tab.id;
    if (typeof tabId !== 'number') {
      throw new Error(knownSavannaClientId
        ? 'NINTENDO_QUERY_HASH_UNAVAILABLE'
        : 'NINTENDO_SAVANNA_CLIENT_ID_UNAVAILABLE');
    }
    const nintendoTabId = tabId;

    const hashWait = knownQueryHash
      ? null
      : createNintendoTabValueWait(
        nintendoTabId,
        pendingNintendoQueryHashResolvers,
        NINTENDO_WISHLIST_QUERY_HASH_TIMEOUT_MS,
        'NINTENDO_QUERY_HASH_UNAVAILABLE'
      );
    const clientIdWait = knownSavannaClientId
      ? null
      : createNintendoTabValueWait(
        nintendoTabId,
        pendingNintendoSavannaClientIdResolvers,
        NINTENDO_SAVANNA_CLIENT_ID_TIMEOUT_MS,
        'NINTENDO_SAVANNA_CLIENT_ID_UNAVAILABLE'
      );
    if (hashWait) {
      cancelWaits.push(hashWait.cancel);
    }
    if (clientIdWait) {
      cancelWaits.push(clientIdWait.cancel);
    }

    await browser.tabs.update(nintendoTabId, { url: NINTENDO_SESSION_REFRESH_URL });
    const [queryHash, savannaClientId] = await Promise.all([
      hashWait?.promise ?? Promise.resolve(knownQueryHash),
      clientIdWait?.promise ?? Promise.resolve(knownSavannaClientId)
    ]);
    if (!queryHash) {
      throw new Error('NINTENDO_QUERY_HASH_UNAVAILABLE');
    }
    if (!savannaClientId) {
      throw new Error('NINTENDO_SAVANNA_CLIENT_ID_UNAVAILABLE');
    }
    return { queryHash, savannaClientId };
  } catch (error) {
    if (
      error instanceof Error
      && (
        error.message === 'NINTENDO_QUERY_HASH_UNAVAILABLE'
        || error.message === 'NINTENDO_SAVANNA_CLIENT_ID_UNAVAILABLE'
      )
    ) {
      throw error;
    }
    throw new Error(knownSavannaClientId
      ? 'NINTENDO_QUERY_HASH_UNAVAILABLE'
      : 'NINTENDO_SAVANNA_CLIENT_ID_UNAVAILABLE');
  } finally {
    cancelWaits.forEach((cancelWait) => cancelWait());
    if (typeof tabId === 'number') {
      pendingNintendoQueryHashResolvers.delete(tabId);
      pendingNintendoSavannaClientIdResolvers.delete(tabId);
      try {
        await browser.tabs.remove(tabId);
      } catch (error) {
        console.warn('[gg.deals-extension][background] Failed to close Nintendo frontend config discovery tab:', error);
      }
    }
  }
}

async function getNintendoWishlistFrontendConfig(): Promise<NintendoWishlistFrontendConfig & { usesStoredValues: boolean }> {
  const [queryHash, savannaClientId] = await Promise.all([
    readNintendoWishlistQueryHash(),
    readNintendoSavannaClientId()
  ]);
  const usesStoredValues = Boolean(queryHash || savannaClientId);
  if (queryHash && savannaClientId) {
    return { queryHash, savannaClientId, usesStoredValues };
  }

  return {
    ...await discoverNintendoWishlistFrontendConfig(queryHash, savannaClientId),
    usesStoredValues
  };
}

async function fetchNintendoNickname(): Promise<string> {
  let tabId: number | undefined;
  const cancelWaits: Array<() => void> = [];
  try {
    const [storedQueryHash, storedSavannaClientId] = await Promise.all([
      readNintendoWishlistQueryHash(),
      readNintendoSavannaClientId()
    ]);

    // Start blank so the listeners are registered before the content scripts can report their results.
    const tab = await browser.tabs.create({ url: 'about:blank', active: false });
    tabId = tab.id;
    if (typeof tabId !== 'number') {
      return '';
    }

    const nicknameWait = createNintendoTabValueWait(
      tabId,
      pendingNintendoNicknameResolvers,
      NINTENDO_NICKNAME_PAGE_TIMEOUT_MS,
      'NINTENDO_NICKNAME_UNAVAILABLE'
    );
    cancelWaits.push(nicknameWait.cancel);

    // The same wishlist page exposes the wishlist frontend config. The message handlers store it,
    // so waiting for it here lets the following wishlist fetch skip opening its own discovery tab.
    const frontendConfigWaits = [
      storedQueryHash
        ? null
        : createNintendoTabValueWait(
          tabId,
          pendingNintendoQueryHashResolvers,
          NINTENDO_WISHLIST_QUERY_HASH_TIMEOUT_MS,
          'NINTENDO_QUERY_HASH_UNAVAILABLE'
        ),
      storedSavannaClientId
        ? null
        : createNintendoTabValueWait(
          tabId,
          pendingNintendoSavannaClientIdResolvers,
          NINTENDO_SAVANNA_CLIENT_ID_TIMEOUT_MS,
          'NINTENDO_SAVANNA_CLIENT_ID_UNAVAILABLE'
        )
    ].filter((frontendConfigWait) => frontendConfigWait !== null);
    frontendConfigWaits.forEach((frontendConfigWait) => cancelWaits.push(frontendConfigWait.cancel));

    await browser.tabs.update(tabId, { url: NINTENDO_SESSION_REFRESH_URL });
    const [nickname] = await Promise.all([
      nicknameWait.promise.catch(() => ''),
      ...frontendConfigWaits.map((frontendConfigWait) => frontendConfigWait.promise.catch(() => null))
    ]);
    console.log('[gg.deals-extension][background] Nintendo nickname found:', Boolean(nickname));
    return nickname;
  } catch (error) {
    // A nickname is descriptive only; naId remains the account identity when this page is unavailable.
    console.warn('[gg.deals-extension][background] Unable to read Nintendo nickname:', error);
    return '';
  } finally {
    cancelWaits.forEach((cancelWait) => cancelWait());
    if (typeof tabId === 'number') {
      pendingNintendoNicknameResolvers.delete(tabId);
      pendingNintendoQueryHashResolvers.delete(tabId);
      pendingNintendoSavannaClientIdResolvers.delete(tabId);
      try {
        await browser.tabs.remove(tabId);
      } catch (error) {
        console.warn('[gg.deals-extension][background] Failed to close Nintendo nickname discovery tab:', error);
      }
    }
  }
}

async function fetchNintendoSessionRaw(): Promise<NintendoSessionResponse> {
  const response = await fetch(NINTENDO_SESSION_URL, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Accept': 'application/json',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });

  console.log('[gg.deals-extension][background] FETCH_NINTENDO_SESSION status:', response.status);


  if (!response.ok) {
    throw new Error('NINTENDO_AUTH_REQUIRED');
  }

  let session: NintendoSessionResponse | null = null;
  try {
    session = await response.json() as NintendoSessionResponse;
    console.log('[gg.deals-extension][background] Nintendo session debug:', {
      status: response.status,
      keys: session ? Object.keys(session) : [],
      hasIdToken: Boolean(getNintendoTrimmedString(session?.idToken)),
      isIdTokenExpired: session?.isIdTokenExpired,
      hasNaId: Boolean(getNintendoTrimmedString(session?.naId))
    });
  } catch {
    console.warn('[gg.deals-extension][background] FETCH_NINTENDO_SESSION failed to parse session JSON');
  }

  if (!session) {
    throw new Error('NINTENDO_AUTH_REQUIRED');
  }

  return session;
}

function isNintendoSessionFresh(session: NintendoSessionResponse): boolean {
  return getNintendoTrimmedString(session.idToken).length > 0
    && session.isIdTokenExpired !== true;
}

async function pollFreshNintendoSession(timeoutMs: number): Promise<NintendoSessionResponse | null> {
  const startedAtMs = Date.now();
  while (Date.now() - startedAtMs < timeoutMs) {
    await wait(NINTENDO_SESSION_REFRESH_POLL_INTERVAL_MS);
    try {
      const session = await fetchNintendoSessionRaw();
      if (isNintendoSessionFresh(session)) {
        return session;
      }
    } catch {
      // The session endpoint may be temporarily unavailable while Nintendo refreshes the page session.
    }
  }
  return null;
}

async function reloadNintendoTabAndWaitForComplete(tabId: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      browser.tabs.onUpdated.removeListener(onUpdated);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const onUpdated = (updatedTabId: number, changeInfo: { status?: string }): void => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish();
      }
    };
    const timeoutId = setTimeout(() => {
      finish(new Error('Nintendo wishlist tab reload timed out'));
    }, NINTENDO_SESSION_REFRESH_TIMEOUT_MS);

    browser.tabs.onUpdated.addListener(onUpdated);
    void browser.tabs.reload(tabId).catch((error: unknown) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

async function refreshNintendoSession(): Promise<NintendoSessionResponse> {
  console.log('[gg.deals-extension][background] Nintendo session refresh required');
  let tabId: number | undefined;
  let keepTabOpenForManualRefresh = false;
  try {
    const tab = await browser.tabs.create({
      url: NINTENDO_SESSION_REFRESH_URL,
      active: false
    });
    tabId = tab.id;
    console.log('[gg.deals-extension][background] Nintendo wishlist refresh tab opened');
    if (typeof tabId !== 'number') {
      throw new Error('Nintendo wishlist refresh tab has no id');
    }

    const initialSession = await pollFreshNintendoSession(NINTENDO_SESSION_INITIAL_REFRESH_TIMEOUT_MS);
    if (initialSession) {
      return initialSession;
    }

    console.log('[gg.deals-extension][background] Nintendo session still expired, reloading wishlist tab');
    await reloadNintendoTabAndWaitForComplete(tabId);
    console.log('[gg.deals-extension][background] Nintendo wishlist tab reload completed');

    const reloadedSession = await pollFreshNintendoSession(NINTENDO_SESSION_REFRESH_TIMEOUT_MS);
    if (reloadedSession) {
      console.log('[gg.deals-extension][background] Nintendo session refreshed after tab reload');
      return reloadedSession;
    }

    console.warn('[gg.deals-extension][background] Nintendo session still expired after wishlist tab reload');
    keepTabOpenForManualRefresh = true;
    throw new Error('NINTENDO_WISHLIST_MANUAL_REFRESH_REQUIRED');
  } catch (error) {
    if (!(error instanceof Error && error.message === 'NINTENDO_WISHLIST_MANUAL_REFRESH_REQUIRED')) {
      console.warn('[gg.deals-extension][background] Nintendo session refresh failed:', error);
    }
    throw error;
  } finally {
    if (typeof tabId === 'number' && !keepTabOpenForManualRefresh) {
      try {
        await browser.tabs.remove(tabId);
      } catch (error) {
        console.warn('[gg.deals-extension][background] Failed to close Nintendo silent refresh tab:', error);
      }
    }
  }
}

async function getNintendoSession(): Promise<NintendoSessionResponse> {
  let session: NintendoSessionResponse;
  try {
    session = await fetchNintendoSessionRaw();
  } catch (error) {
    if (error instanceof Error && error.message === 'NINTENDO_AUTH_REQUIRED') {
      return refreshNintendoSession();
    }
    throw error;
  }

  if (isNintendoSessionFresh(session)) {
    return session;
  }

  return refreshNintendoSession();
}

function extractNintendoAccountId(session: NintendoSessionResponse): string {
  return getNintendoTrimmedString(session.naId);
}

function extractNintendoSessionCountry(session: NintendoSessionResponse): string {
  return getNintendoTrimmedString(session.localeInfo?.country)
    || getNintendoTrimmedString(session.country);
}

function buildNintendoWishlistRequestUrl(
  country: string,
  idToken: string,
  offset: number,
  queryHash: string
): string {
  const requestUrl = new URL(NINTENDO_GRAPHQL_URL);
  requestUrl.searchParams.set('operationName', NINTENDO_WISHLIST_OPERATION);
  requestUrl.searchParams.set('variables', JSON.stringify({
    country,
    idToken,
    language: NINTENDO_GRAPHQL_LANGUAGE,
    limit: NINTENDO_WISHLIST_PAGE_SIZE,
    offset,
    shopId: NINTENDO_SHOP_ID
  }));
  requestUrl.searchParams.set('extensions', JSON.stringify({
    persistedQuery: {
      version: 1,
      sha256Hash: queryHash
    }
  }));

  return requestUrl.toString();
}

function isNintendoGraphqlAuthError(payload: { errors?: NintendoGraphQLError[] }): boolean {
  if (!Array.isArray(payload?.errors)) {
    return false;
  }

  return payload.errors.some((errorItem) => {
    const message = typeof errorItem?.message === 'string' ? errorItem.message : '';
    return /unauthor|forbidden|invalid\s+token|token\s+expired|expired\s+token/i.test(message);
  });
}

function isNintendoGraphqlQueryHashError(payload: NintendoWishlistGraphQLResponse): boolean {
  if (!Array.isArray(payload?.errors)) {
    return false;
  }

  return payload.errors.some((errorItem) => {
    const extensions = errorItem?.extensions;
    const type = getNintendoTrimmedString(extensions?.type);
    const title = getNintendoTrimmedString(extensions?.title);
    const errorCode = getNintendoTrimmedString(extensions?.errorCode);
    return errorCode === '1802'
      && title === 'INVALID_PARAM'
      && type.endsWith('/invalid-param');
  });
}

function getNintendoGraphqlErrorMessage(payload: NintendoWishlistGraphQLResponse, httpStatus: number): string {
  const firstError = Array.isArray(payload?.errors) ? payload.errors[0] : undefined;
  const firstMessage = typeof firstError?.message === 'string' ? firstError.message.trim() : '';
  return firstMessage.length > 0
    ? firstMessage
    : `Nintendo wishlist request failed (HTTP ${httpStatus})`;
}

async function fetchNintendoWishlistPage(
  requestUrl: string,
  savannaClientId: string
): Promise<NintendoWishlistGraphQLResponse> {
  const response = await fetch(requestUrl, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Accept': 'application/graphql-response+json, application/graphql+json, application/json, text/event-stream, multipart/mixed',
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json',
      'Pragma': 'no-cache',
      'X-Nintendo-Savanna-Client-Id': savannaClientId
    }
  });

  console.log('[gg.deals-extension][background] FETCH_NINTENDO_WISHLIST page status:', response.status);

  if (response.status === 401 || response.status === 403) {
    throw new Error('NINTENDO_AUTH_REQUIRED');
  }

  let payload: NintendoWishlistGraphQLResponse | null = null;
  try {
    payload = await response.json() as NintendoWishlistGraphQLResponse;
  } catch {
    console.warn('[gg.deals-extension][background] FETCH_NINTENDO_WISHLIST failed to parse page JSON');
  }

  if (!payload) {
    throw new Error(`Nintendo wishlist request returned invalid JSON (HTTP ${response.status})`);
  }

  if (isNintendoGraphqlAuthError(payload)) {
    throw new Error('NINTENDO_AUTH_REQUIRED');
  }

  if (isNintendoGraphqlQueryHashError(payload)) {
    throw new NintendoWishlistQueryHashError('NINTENDO_QUERY_HASH_OUTDATED');
  }

  if (!response.ok) {
    throw new Error(getNintendoGraphqlErrorMessage(payload, response.status));
  }

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(getNintendoGraphqlErrorMessage(payload, response.status));
  }

  const wishlistItems = payload?.data?.account?.wishlist?.wishlistItems;
  if (!wishlistItems || typeof wishlistItems !== 'object' || !Array.isArray(wishlistItems.items)) {
    throw new Error('Nintendo wishlist: data.account.wishlist.wishlistItems is missing in response');
  }

  return payload;
}

function isNintendoWishlistItemAccepted(item: NintendoWishlistItem): boolean {
  const typename = item.itemV2?.__typename;
  return typename === 'ApplicationItem'
    || typename === 'DlcItem'
    || typename === 'BundleItem'
    || item.itemV2 === null;
}

async function fetchNintendoWishlistWithPagination(
  session: NintendoSessionResponse,
  queryHash: string,
  savannaClientId: string,
  reportProgress?: PaginationProgressReporter
): Promise<NintendoWishlistItem[]> {
  const country = extractNintendoSessionCountry(session);
  const idToken = getNintendoTrimmedString(session.idToken);

  if (!country) {
    throw new Error('Nintendo session is missing country info required for wishlist request');
  }

  const seenNsUids = new Set<string>();
  const allItems: NintendoWishlistItem[] = [];
  let offset = 0;
  let page = 1;
  let fetchedItemsCount = 0;
  let expectedTotalPages: number | null = null;

  // Safety guard against infinite loops when the backend keeps returning unexpected totals
  const maxPages = 200;

  while (true) {
    if (page > maxPages) {
      throw new Error(`Nintendo wishlist pagination exceeded the page limit (${maxPages} pages)`);
    }

    const requestUrl = buildNintendoWishlistRequestUrl(country, idToken, offset, queryHash);
    const payload = await fetchNintendoWishlistPage(requestUrl, savannaClientId);

    const wishlistItems = payload.data?.account?.wishlist?.wishlistItems;
    const pageItems = wishlistItems?.items ?? [];

    for (const item of pageItems) {
      const nsUid = getNintendoTrimmedString(item.nsUid);
      if (nsUid) {
        if (seenNsUids.has(nsUid)) {
          continue;
        }
        seenNsUids.add(nsUid);
      }

      if (!isNintendoWishlistItemAccepted(item)) {
        continue;
      }

      allItems.push(item);
    }

    fetchedItemsCount += pageItems.length;

    const offsetInfo = (wishlistItems?.offsetInfo && typeof wishlistItems.offsetInfo === 'object')
      ? wishlistItems.offsetInfo as NintendoWishlistOffsetInfo
      : null;
    const totalValue = getNintendoNonNegativeInteger(offsetInfo?.total);
    expectedTotalPages = totalValue !== null
      ? Math.max(1, Math.ceil(totalValue / NINTENDO_WISHLIST_PAGE_SIZE))
      : expectedTotalPages;

    console.log('[gg.deals-extension][background] FETCH_NINTENDO_WISHLIST page stats:', {
      page,
      pageItems: pageItems.length,
      acceptedItems: allItems.length,
      fetchedItemsCount,
      total: totalValue ?? '<unknown>'
    });

    reportProgress?.({
      sourceId: NINTENDO_SOURCE_ID,
      currentPage: page,
      totalPages: expectedTotalPages
    });

    if (pageItems.length === 0) {
      break;
    }

    if (totalValue !== null && fetchedItemsCount >= totalValue) {
      break;
    }

    // Fallback when offsetInfo.total is missing or invalid
    if (totalValue === null && pageItems.length < NINTENDO_WISHLIST_PAGE_SIZE) {
      break;
    }

    offset += NINTENDO_WISHLIST_PAGE_SIZE;
    page += 1;
  }

  return allItems;
}

async function fetchNintendoWishlistWithCurrentFrontendConfig(
  session: NintendoSessionResponse,
  reportProgress?: PaginationProgressReporter
): Promise<NintendoWishlistItem[]> {
  const { queryHash, savannaClientId, usesStoredValues } = await getNintendoWishlistFrontendConfig();
  try {
    return await fetchNintendoWishlistWithPagination(
      session,
      queryHash,
      savannaClientId,
      reportProgress
    );
  } catch (error) {
    // Stored values may be outdated in ways Nintendo does not report as a query hash error
    // (e.g. a rotated client ID), so give them one retry with freshly discovered values.
    const isQueryHashError = error instanceof NintendoWishlistQueryHashError;
    if (!isQueryHashError && !usesStoredValues) {
      throw error;
    }

    console.warn('[gg.deals-extension][background] Nintendo wishlist request failed, rediscovering frontend config:', error);

    await browser.storage.local.remove([
      NINTENDO_WISHLIST_QUERY_HASH_STORAGE_KEY,
      NINTENDO_SAVANNA_CLIENT_ID_STORAGE_KEY
    ]);
    let refreshedConfig: NintendoWishlistFrontendConfig;
    try {
      refreshedConfig = await discoverNintendoWishlistFrontendConfig(null, null);
    } catch (discoveryError) {
      // Keep the original error (e.g. NINTENDO_AUTH_REQUIRED) when the retry was only speculative.
      throw isQueryHashError ? discoveryError : error;
    }
    return fetchNintendoWishlistWithPagination(
      session,
      refreshedConfig.queryHash,
      refreshedConfig.savannaClientId,
      reportProgress
    );
  }
}

function getNintendoCollectionGraphqlErrorMessage(payload: NintendoCollectionGraphQLResponse, httpStatus: number): string {
  const firstError = Array.isArray(payload?.errors) ? payload.errors[0] : undefined;
  const firstMessage = typeof firstError?.message === 'string' ? firstError.message.trim() : '';
  return firstMessage.length > 0
    ? firstMessage
    : `Nintendo collection request failed (HTTP ${httpStatus})`;
}

function decodeNintendoCollectionIdTokenPayload(idToken: string): Record<string, unknown> {
  const payloadSegment = idToken.split('.')[1];
  if (!payloadSegment) {
    throw new Error('Nintendo collection bootstrap returned an invalid idToken');
  }

  try {
    const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as unknown;
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid payload');
    }
    return payload as Record<string, unknown>;
  } catch (error) {
    console.error('[gg.deals-extension][background] Nintendo collection idToken payload decode error:', error);
    throw error;
  }
}

function extractNintendoCollectionAccountId(idToken: string): string {
  const accountId = getNintendoTrimmedString(decodeNintendoCollectionIdTokenPayload(idToken).sub);
  if (!accountId) {
    throw new Error('Nintendo collection idToken is missing the sub claim');
  }
  return accountId;
}

function extractNintendoCollectionCountry(idToken: string): string {
  const country = getNintendoTrimmedString(decodeNintendoCollectionIdTokenPayload(idToken).country).toUpperCase();
  if (!country) {
    throw new Error('Nintendo collection idToken is missing the country claim');
  }
  return country;
}

async function fetchNintendoCollectionPage(
  bootstrap: NintendoCollectionBootstrap,
  offset: number,
  isHidden: boolean
): Promise<NintendoCollectionGraphQLResponse> {
  const response = await fetch(NINTENDO_GRAPHQL_URL, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Accept': 'application/graphql-response+json, application/graphql+json, application/json, text/event-stream, multipart/mixed',
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json',
      'Pragma': 'no-cache',
      'X-Nintendo-Savanna-Client-Id': bootstrap.savannaClientId
    },
    body: JSON.stringify({
      operationName: NINTENDO_COLLECTION_OPERATION,
      query: NINTENDO_COLLECTION_QUERY,
      variables: {
        idToken: bootstrap.idToken,
        isHidden,
        country: bootstrap.country,
        language: NINTENDO_GRAPHQL_LANGUAGE,
        shopId: NINTENDO_SHOP_ID,
        limit: NINTENDO_COLLECTION_PAGE_SIZE,
        nasLanguage: NINTENDO_GRAPHQL_NAS_LANGUAGE,
        offset,
        order: 'DESC',
        sortBy: 'ACTIVATED_DATE',
        vgcViewType: null,
        vgcViewStatus: null
      }
    })
  });

  console.log('[gg.deals-extension][background] FETCH_NINTENDO_COLLECTION page status:', {
    status: response.status,
    offset
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('NINTENDO_AUTH_REQUIRED');
  }

  let payload: NintendoCollectionGraphQLResponse | null = null;
  try {
    payload = await response.json() as NintendoCollectionGraphQLResponse;
  } catch (error) {
    console.error('[gg.deals-extension][background] FETCH_NINTENDO_COLLECTION failed to parse page JSON:', error);
    throw error;
  }
  if (!payload) {
    throw new Error(`Nintendo collection request returned invalid JSON (HTTP ${response.status})`);
  }
  if (isNintendoGraphqlAuthError(payload)) {
    throw new Error('NINTENDO_AUTH_REQUIRED');
  }
  if (!response.ok || (Array.isArray(payload.errors) && payload.errors.length > 0)) {
    throw new Error(getNintendoCollectionGraphqlErrorMessage(payload, response.status));
  }

  const vgcViews = payload.data?.account?.vgc?.vgcViews;
  if (!vgcViews || typeof vgcViews !== 'object' || !Array.isArray(vgcViews.views)) {
    throw new Error('Nintendo collection: data.account.vgc.vgcViews is missing in response');
  }
  return payload;
}

async function fetchNintendoCollectionWithPagination(
  bootstrap: NintendoCollectionBootstrap,
  isHidden: boolean,
  reportProgress?: PaginationProgressReporter
): Promise<NintendoCollectionView[]> {
  const allViews: NintendoCollectionView[] = [];
  let offset = 0;
  let page = 1;
  let fetchedViewsCount = 0;
  let expectedTotalPages: number | null = null;
  const maxPages = 200;

  while (true) {
    if (page > maxPages) {
      throw new Error(`Nintendo collection pagination exceeded the page limit (${maxPages} pages)`);
    }

    const payload = await fetchNintendoCollectionPage(bootstrap, offset, isHidden);
    const vgcViews = payload.data?.account?.vgc?.vgcViews;
    const pageViews = vgcViews?.views ?? [];
    for (const view of pageViews) {
      const id = getNintendoTrimmedString(view.id);
      if (!id) {
        throw new Error('Nintendo collection: a VGC view is missing id');
      }
      allViews.push(view);
    }

    fetchedViewsCount += pageViews.length;
    const offsetInfo = vgcViews?.offsetInfo && typeof vgcViews.offsetInfo === 'object'
      ? vgcViews.offsetInfo as NintendoCollectionOffsetInfo
      : null;
    const totalValue = getNintendoNonNegativeInteger(offsetInfo?.total);
    expectedTotalPages = totalValue !== null
      ? Math.max(1, Math.ceil(totalValue / NINTENDO_COLLECTION_PAGE_SIZE))
      : expectedTotalPages;

    console.log('[gg.deals-extension][background] FETCH_NINTENDO_COLLECTION page stats:', {
      page,
      offset,
      isHidden,
      pageViews: pageViews.length,
      fetchedViewsCount,
      total: totalValue ?? '<unknown>'
    });
    reportProgress?.({ sourceId: NINTENDO_SOURCE_ID, currentPage: page, totalPages: expectedTotalPages });

    if (pageViews.length === 0 || (totalValue !== null && fetchedViewsCount >= totalValue)) {
      break;
    }
    if (totalValue === null && pageViews.length < NINTENDO_COLLECTION_PAGE_SIZE) {
      break;
    }
    offset += NINTENDO_COLLECTION_PAGE_SIZE;
    page += 1;
  }

  return allViews;
}

// Views can repeat across pages and between the visible and hidden lists.
function dedupeNintendoCollectionViews(views: NintendoCollectionView[]): NintendoCollectionView[] {
  const seenIds = new Set<string>();
  return views.filter((view) => {
    const id = getNintendoTrimmedString(view.id);
    if (!id || seenIds.has(id)) {
      return false;
    }
    seenIds.add(id);
    return true;
  });
}

function excludeNintendoDlcOnlyViews(views: NintendoCollectionView[]): NintendoCollectionView[] {
  return views.filter((view) => !(
    view.hasReleasedApplication === false
    && view.hasReleasedAddOnContents === true
  ));
}

// A logged-out user is redirected away from the VGC portal page to the Nintendo Account login page.
async function isNintendoCollectionTabRedirectedAway(tabId: number | undefined): Promise<boolean> {
  if (typeof tabId !== 'number') {
    return false;
  }

  try {
    const tab = await browser.tabs.get(tabId);
    const tabUrl = new URL(tab.url ?? '');
    const discoveryUrl = new URL(NINTENDO_COLLECTION_DISCOVERY_URL);
    return tabUrl.protocol === 'https:'
      && (tabUrl.hostname !== discoveryUrl.hostname || tabUrl.pathname !== discoveryUrl.pathname);
  } catch {
    return false;
  }
}

async function getNintendoCollectionBootstrap(): Promise<NintendoCollectionBootstrap> {
  if (pendingNintendoCollectionBootstrap) {
    return pendingNintendoCollectionBootstrap;
  }

  const bootstrapPromise = (async (): Promise<NintendoCollectionBootstrap> => {
    let tabId: number | undefined;
    let nicknameWait: { promise: Promise<string>; cancel: () => void } | null = null;
    let bootstrapSettled = false;
    let resolveBootstrap!: (bootstrap: NintendoCollectionBootstrapPayload) => void;
    let rejectBootstrap!: (error: Error) => void;
    const bootstrapResultPromise = new Promise<NintendoCollectionBootstrapPayload>((resolve, reject) => {
      resolveBootstrap = resolve;
      rejectBootstrap = reject;
    });
    void bootstrapResultPromise.catch(() => undefined);
    const bootstrapTimeoutId = setTimeout(() => {
      if (bootstrapSettled) {
        return;
      }
      bootstrapSettled = true;
      if (typeof tabId === 'number') {
        pendingNintendoCollectionBootstrapResolvers.delete(tabId);
      }
      void isNintendoCollectionTabRedirectedAway(tabId).then((isRedirectedAway) => {
        rejectBootstrap(new Error(isRedirectedAway
          ? 'NINTENDO_AUTH_REQUIRED'
          : 'NINTENDO_COLLECTION_BOOTSTRAP_TIMEOUT'));
      });
    }, NINTENDO_SAVANNA_CLIENT_ID_TIMEOUT_MS);

    try {
      console.log('[gg.deals-extension][background] Nintendo collection bootstrap required');
      const tab = await browser.tabs.create({ url: 'about:blank', active: false });
      tabId = tab.id;
      if (typeof tabId !== 'number') {
        throw new Error('NINTENDO_COLLECTION_BOOTSTRAP_UNAVAILABLE');
      }
      console.log('[gg.deals-extension][background] Nintendo collection bootstrap tab created:', tabId);

      pendingNintendoCollectionBootstrapResolvers.set(tabId, (bootstrap) => {
        if (bootstrapSettled) {
          return;
        }
        bootstrapSettled = true;
        clearTimeout(bootstrapTimeoutId);
        pendingNintendoCollectionBootstrapResolvers.delete(tabId as number);
        resolveBootstrap(bootstrap);
      });
      nicknameWait = createNintendoTabValueWait(
        tabId,
        pendingNintendoNicknameResolvers,
        NINTENDO_NICKNAME_PAGE_TIMEOUT_MS,
        'NINTENDO_COLLECTION_NICKNAME_UNAVAILABLE'
      );
      await browser.tabs.update(tabId, { url: NINTENDO_COLLECTION_DISCOVERY_URL });
      const bootstrap = await bootstrapResultPromise;
      // The bootstrap message usually carries the nickname already. Otherwise give the nickname
      // content script a short grace period; the nickname is optional, so its timeout must not fail the bootstrap.
      const username = bootstrap.username || await Promise.race([
        nicknameWait.promise.catch(() => ''),
        new Promise<string>((resolve) => setTimeout(() => resolve(''), 250))
      ]);
      return {
        ...bootstrap,
        accountId: extractNintendoCollectionAccountId(bootstrap.idToken),
        country: extractNintendoCollectionCountry(bootstrap.idToken),
        username
      };
    } catch (error) {
      console.error('[gg.deals-extension][background] Nintendo collection bootstrap error:', error);
      throw error;
    } finally {
      clearTimeout(bootstrapTimeoutId);
      nicknameWait?.cancel();
      if (typeof tabId === 'number') {
        pendingNintendoCollectionBootstrapResolvers.delete(tabId);
        pendingNintendoNicknameResolvers.delete(tabId);
        try {
          await browser.tabs.remove(tabId);
        } catch (error) {
          console.warn('[gg.deals-extension][background] Failed to close Nintendo collection bootstrap tab:', error);
        }
      }
    }
  })();

  pendingNintendoCollectionBootstrap = bootstrapPromise;
  try {
    return await bootstrapPromise;
  } finally {
    if (pendingNintendoCollectionBootstrap === bootstrapPromise) {
      pendingNintendoCollectionBootstrap = null;
    }
  }
}

browser.runtime.onMessage.addListener(async (rawMessage: unknown, sender: { tab?: { id?: number } }): Promise<RuntimeMessageResponse | void> => {
  const message = rawMessage as BackgroundMessage;
  console.log('[gg.deals-extension][background] message received:', message?.type);

  if (message?.type === 'NINTENDO_ACCOUNT_NICKNAME_READY') {
    const tabId = sender.tab?.id;
    if (typeof tabId === 'number') {
      const nickname = typeof message.nickname === 'string'
        ? getNintendoTrimmedString(message.nickname)
        : '';
      pendingNintendoNicknameResolvers.get(tabId)?.(nickname);
    }
    return { ok: true };
  }

  if (message?.type === 'NINTENDO_WISHLIST_QUERY_HASH_DISCOVERED') {
    if (!isNintendoSha256Hex(message.hash)) {
      return { ok: false, error: 'Invalid Nintendo wishlist query hash' };
    }

    const normalizedHash = message.hash.toLowerCase();
    await saveNintendoWishlistQueryHash(normalizedHash);
    const tabId = sender.tab?.id;
    if (typeof tabId === 'number') {
      pendingNintendoQueryHashResolvers.get(tabId)?.(normalizedHash);
    }
    return { ok: true };
  }

  if (message?.type === 'NINTENDO_SAVANNA_CLIENT_ID_DISCOVERED') {
    if (!isNintendoSha256Hex(message.clientId)) {
      return { ok: false, error: 'Invalid Nintendo Savanna Client ID' };
    }

    const normalizedClientId = message.clientId.toLowerCase();
    await saveNintendoSavannaClientId(normalizedClientId);
    const tabId = sender.tab?.id;
    if (typeof tabId === 'number') {
      pendingNintendoSavannaClientIdResolvers.get(tabId)?.(normalizedClientId);
    }
    return { ok: true };
  }

  if (message?.type === 'NINTENDO_COLLECTION_BOOTSTRAP_READY') {
    const idToken = getNintendoTrimmedString(message.idToken);
    const savannaClientId = getNintendoTrimmedString(message.clientId).toLowerCase();
    const username = getNintendoTrimmedString(message.nickname);
    console.log('[gg.deals-extension][background] Nintendo collection bootstrap message received', {
      hasIdToken: Boolean(idToken),
      hasSavannaClientId: Boolean(savannaClientId),
      hasNickname: Boolean(username)
    });
    if (!idToken || !isNintendoSha256Hex(savannaClientId)) {
      return { ok: false, error: 'Invalid Nintendo collection bootstrap' };
    }

    const tabId = sender.tab?.id;
    if (typeof tabId === 'number') {
      const resolvePendingBootstrap = pendingNintendoCollectionBootstrapResolvers.get(tabId);
      if (resolvePendingBootstrap) {
        resolvePendingBootstrap({ savannaClientId, idToken, username });
        console.log('[gg.deals-extension][background] Nintendo collection bootstrap resolved');
      }
    }
    return { ok: true };
  }

  if (message?.type === SYNC_GG_USER_SETTINGS_MESSAGE) {
    try {
      const userSettings = await synchronizeGGUserSettings(message.options);
      return { ok: true, data: userSettings };
    } catch (error) {
      if (error instanceof GGInvalidApiKeyError) {
        return {
          ok: false,
          error: error.message,
          errorCode: 'INVALID_API_KEY',
        };
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[gg.deals-extension][background] SYNC_GG_USER_SETTINGS error:', error);
      return { ok: false, error: errorMessage };
    }
  }

  if (message?.type === 'FETCH_STEAM_USERDATA') {
    try {
      console.log('[gg.deals-extension][background] FETCH_STEAM_USERDATA start');
      const steamUrl = new URL(STEAM_URL);
      steamUrl.searchParams.set('_', Date.now().toString());

      const response = await fetch(steamUrl.toString(), {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://store.steampowered.com/'
        }
      });
      console.log('[gg.deals-extension][background] FETCH_STEAM_USERDATA status:', response.status);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const ownedAppsCount = Array.isArray((data as { rgOwnedApps?: unknown[] })?.rgOwnedApps)
        ? ((data as { rgOwnedApps?: unknown[] }).rgOwnedApps as unknown[]).length
        : -1;
      console.log('[gg.deals-extension][background] FETCH_STEAM_USERDATA owned apps count:', ownedAppsCount);
      console.log('[gg.deals-extension][background] FETCH_STEAM_USERDATA success');
      return { ok: true, data };
    } catch (error) {
      console.error('[gg.deals-extension][background] FETCH_STEAM_USERDATA error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { ok: false, error: errorMessage };
    }
  }

  if (message?.type === 'FETCH_STEAM_ACCOUNT_NAME') {
    try {
      console.log('[gg.deals-extension][background] FETCH_STEAM_ACCOUNT_NAME start');
      const response = await fetch('https://store.steampowered.com/', {
        method: 'GET',
        credentials: 'include'
      });

      console.log('[gg.deals-extension][background] FETCH_STEAM_ACCOUNT_NAME status:', response.status);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      console.log('[gg.deals-extension][background] FETCH_STEAM_ACCOUNT_NAME html length:', html.length);
      console.log('[gg.deals-extension][background] FETCH_STEAM_ACCOUNT_NAME has application_config:', /id=["']application_config["']/i.test(html));
      console.log('[gg.deals-extension][background] FETCH_STEAM_ACCOUNT_NAME html content start');
      console.log(html);
      console.log('[gg.deals-extension][background] FETCH_STEAM_ACCOUNT_NAME html content end');

      const accountInfo = extractSteamAccountName(html);
      if (!accountInfo) {
        throw new Error('Could not extract Steam account info from application_config[data-userinfo]');
      }

      console.log('[gg.deals-extension][background] FETCH_STEAM_ACCOUNT_NAME success');
      return { ok: true, data: accountInfo };
    } catch (error) {
      console.error('[gg.deals-extension][background] FETCH_STEAM_ACCOUNT_NAME error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { ok: false, error: errorMessage };
    }
  }

  // We may remove this later if we decide to send the import data directly from the content script, but for now let's keep it here to avoid CORS issues during development
  if (message?.type === 'POST_IMPORT_DATA') {
    try {
      console.log('[gg.deals-extension][background] POST_IMPORT_DATA start:', message.url);
      const apiKey = await readGGApiKeyFromStorage();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }

      const response = await fetch(message.url, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(message.payload)
      });

      console.log('[gg.deals-extension][background] POST_IMPORT_DATA status:', response.status);
      const data = await response.json().catch(() => ({}));
      try {
        await processExtensionResponse(response, data);
      } catch (error) {
        console.warn('[gg.deals-extension][background] Failed to process server messages:', error);
      }
      if (!response.ok) {
        return {
          ok: false,
          error: `HTTP ${response.status}`,
          status: response.status,
          data,
        };
      }

      console.log('[gg.deals-extension][background] POST_IMPORT_DATA success');
      return { ok: true, status: response.status, data };
    } catch (error) {
      console.error('[gg.deals-extension][background] POST_IMPORT_DATA error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { ok: false, error: errorMessage };
    }
  }

  if (message?.type === 'FETCH_EPIC_TOKEN') {
    try {
      console.log('[gg.deals-extension][background] FETCH_EPIC_TOKEN start');
      const storedToken = await readStoredEpicToken();
      if (message.forceFresh) {
        console.log('[gg.deals-extension][background] FETCH_EPIC_TOKEN checking current Epic web session');
        try {
          const freshToken = await fetchEpicTokenByAuthorizationCode();
          const persistedFreshToken = await saveEpicToken(preserveEpicRefreshToken(freshToken, storedToken));
          console.log('[gg.deals-extension][background] FETCH_EPIC_TOKEN current Epic web session verified');
          return { ok: true, data: persistedFreshToken };
        } catch (freshError) {
          const freshErrorMessage = freshError instanceof Error ? freshError.message : String(freshError);
          if (freshErrorMessage.includes('authorizationCode missing in Epic response') && storedToken && isEpicTokenStillValid(storedToken)) {
            console.warn('[gg.deals-extension][background] FETCH_EPIC_TOKEN Epic did not issue another authorization code; using the last verified valid token');
            return { ok: true, data: storedToken };
          }

          throw freshError;
        }
      }

      if (storedToken) {
        const hasRefreshToken = typeof storedToken.refresh_token === 'string' && storedToken.refresh_token.trim().length > 0;
        const expiresAt = resolveEpicTokenExpiryMs(storedToken);
        console.log('[gg.deals-extension][background] FETCH_EPIC_TOKEN found stored token. valid:', isEpicTokenStillValid(storedToken), 'expiresAt:', expiresAt ?? '<unknown>', 'hasRefreshToken:', hasRefreshToken);

        if (isEpicTokenStillValid(storedToken)) {
          return { ok: true, data: storedToken };
        }

        if (hasRefreshToken) {
          try {
            const refreshedToken = await refreshEpicTokenByRefreshToken(storedToken.refresh_token as string);
            const persistedRefreshedToken = await saveEpicToken(preserveEpicRefreshToken(refreshedToken, storedToken));
            console.log('[gg.deals-extension][background] FETCH_EPIC_TOKEN refreshed token from storage refresh_token');
            return { ok: true, data: persistedRefreshedToken };
          } catch (refreshError) {
            console.warn('[gg.deals-extension][background] FETCH_EPIC_TOKEN refresh from stored token failed, falling back to authorization_code flow:', refreshError);
          }
        }
      }

      const tokenData = await fetchEpicTokenByAuthorizationCode();
      const persistedToken = await saveEpicToken(preserveEpicRefreshToken(tokenData, storedToken));
      console.log('[gg.deals-extension][background] FETCH_EPIC_TOKEN success, sending response');
      return { ok: true, data: persistedToken };
    } catch (error) {
      console.error('[gg.deals-extension][background] FETCH_EPIC_TOKEN error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { ok: false, error: errorMessage };
    }
  }

  if (message?.type === 'REFRESH_EPIC_TOKEN') {
    try {
      console.log('[gg.deals-extension][background] REFRESH_EPIC_TOKEN start');
      if (!message.refreshToken) {
        throw new Error('Missing refresh token');
      }
      const tokenData = await refreshEpicTokenByRefreshToken(message.refreshToken);
      const persistedToken = await saveEpicToken(preserveEpicRefreshToken(tokenData, {
        refresh_token: message.refreshToken
      }));

      console.log('[gg.deals-extension][background] REFRESH_EPIC_TOKEN success, sending response');
      return { ok: true, data: persistedToken };
    } catch (error) {
      console.error('[gg.deals-extension][background] REFRESH_EPIC_TOKEN error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { ok: false, error: errorMessage };
    }
  }

  if (message?.type === 'FETCH_EPIC_LIBRARY_ITEMS') {
    try {
      console.log('[gg.deals-extension][background] FETCH_EPIC_LIBRARY_ITEMS start');
      if (!message.accessToken) {
        throw new Error('Missing access token');
      }

      if (message.isWishlist) {
        const wishlistData = await fetchEpicWishlistWithRetry(message.accessToken);
        console.log('[gg.deals-extension][background] FETCH_EPIC_LIBRARY_ITEMS wishlist success');
        return { ok: true, data: wishlistData };
      }

      const allRecords = await fetchEpicLibraryItemsWithPagination(message.accessToken, (progress) => {
        sendPaginationProgressToTab(sender.tab?.id, progress);
      });
      console.log('[gg.deals-extension][background] FETCH_EPIC_LIBRARY_ITEMS success, total records:', allRecords.length);
      return { ok: true, data: allRecords };
    } catch (error) {
      console.error('[gg.deals-extension][background] FETCH_EPIC_LIBRARY_ITEMS error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { ok: false, error: errorMessage };
    }
  }

  if (message?.type === 'FETCH_PLAYSTATION_WISHLIST') {
    try {
      console.log('[gg.deals-extension][background] FETCH_PLAYSTATION_WISHLIST start');
      const targetUrl = typeof message.url === 'string' && message.url.trim().length > 0
        ? message.url.trim()
        : PLAYSTATION_WISHLIST_URL;
      const html = await fetchPlaystationWishlistHtml(targetUrl);
      const nextDataPayload = extractPlaystationNextDataPayload(html);
      const apolloState = extractPlaystationApolloState(nextDataPayload);
      const accountId = extractPlaystationAccountId(nextDataPayload);
      const onlineId = extractPlaystationOnlineId(nextDataPayload);
      const playstationData = { apolloState, accountId, onlineId };

      console.log('[gg.deals-extension][background] FETCH_PLAYSTATION_WISHLIST accountId:', accountId ?? '<missing>');
      return { ok: true, data: playstationData };
    } catch (error) {
      console.error('[gg.deals-extension][background] FETCH_PLAYSTATION_WISHLIST error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { ok: false, error: errorMessage };
    }
  }

  if (message?.type === 'FETCH_PLAYSTATION_ACCOUNT') {
    try {
      console.log('[gg.deals-extension][background] FETCH_PLAYSTATION_ACCOUNT start');
      const targetUrl = typeof message.url === 'string' && message.url.trim().length > 0
        ? message.url.trim()
        : PLAYSTATION_COLLECTION_URL;
      const isWishlist = new URL(targetUrl).pathname.toLowerCase().includes('/wishlist');
      const html = isWishlist
        ? await fetchPlaystationWishlistHtml(targetUrl)
        : await fetchPlaystationCollectionHtml(targetUrl);
      const nextDataPayload = extractPlaystationNextDataPayload(html);
      const accountId = extractPlaystationAccountId(nextDataPayload);
      const onlineId = extractPlaystationOnlineId(nextDataPayload);

      console.log('[gg.deals-extension][background] FETCH_PLAYSTATION_ACCOUNT accountId:', accountId ?? '<missing>');
      return { ok: true, data: { accountId, onlineId } };
    } catch (error) {
      console.error('[gg.deals-extension][background] FETCH_PLAYSTATION_ACCOUNT error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { ok: false, error: errorMessage };
    }
  }

  if (message?.type === 'FETCH_PLAYSTATION_COLLECTION') {
    try {
      console.log('[gg.deals-extension][background] FETCH_PLAYSTATION_COLLECTION start');
      const targetUrl = typeof message.url === 'string' && message.url.trim().length > 0
        ? message.url.trim()
        : PLAYSTATION_COLLECTION_URL;

      const collectionData = await fetchPlaystationCollectionWithPagination(targetUrl, (progress) => {
        sendPaginationProgressToTab(sender.tab?.id, progress);
      });
      console.log('[gg.deals-extension][background] FETCH_PLAYSTATION_COLLECTION accountId:', collectionData.accountId ?? '<missing>');
      console.log('[gg.deals-extension][background] FETCH_PLAYSTATION_COLLECTION total games:', collectionData.games.length);
      return { ok: true, data: collectionData };
    } catch (error) {
      console.error('[gg.deals-extension][background] FETCH_PLAYSTATION_COLLECTION error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { ok: false, error: errorMessage };
    }
  }

  if (message?.type === 'FETCH_NINTENDO_ACCOUNT') {
    try {
      console.log('[gg.deals-extension][background] FETCH_NINTENDO_ACCOUNT start');
      const session = await getNintendoSession();
      console.log('[gg.deals-extension][background] FETCH_NINTENDO_ACCOUNT session:', {
        hasIdToken: Boolean(getNintendoTrimmedString(session.idToken)),
        isIdTokenExpired: session.isIdTokenExpired === true
      });
      const accountId = extractNintendoAccountId(session);
      if (!accountId) {
        throw new Error('Nintendo session is missing naId');
      }
      const username = await fetchNintendoNickname();

      // naId is the identity; the account page provides an optional display nickname.
      console.log('[gg.deals-extension][background] FETCH_NINTENDO_ACCOUNT accountId:', accountId || '<missing>');
      return { ok: true, data: { accountId, username } };
    } catch (error) {
      console.error('[gg.deals-extension][background] FETCH_NINTENDO_ACCOUNT error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { ok: false, error: errorMessage };
    }
  }

  if (message?.type === 'FETCH_NINTENDO_WISHLIST') {
    try {
      console.log('[gg.deals-extension][background] FETCH_NINTENDO_WISHLIST start');
      const session = await getNintendoSession();
      const items = await fetchNintendoWishlistWithCurrentFrontendConfig(session, (progress) => {
        sendPaginationProgressToTab(sender.tab?.id, progress);
      });
      const accountId = extractNintendoAccountId(session);
      if (!accountId) {
        throw new Error('Nintendo session is missing naId');
      }

      console.log('[gg.deals-extension][background] FETCH_NINTENDO_WISHLIST accountId:', accountId || '<missing>');
      console.log('[gg.deals-extension][background] FETCH_NINTENDO_WISHLIST total items:', items.length);
      return { ok: true, data: { accountId, username: '', items } };
    } catch (error) {
      console.error('[gg.deals-extension][background] FETCH_NINTENDO_WISHLIST error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { ok: false, error: errorMessage };
    }
  }

  if (message?.type === 'FETCH_NINTENDO_COLLECTION') {
    try {
      console.log('[gg.deals-extension][background] FETCH_NINTENDO_COLLECTION start');
      const bootstrap = await getNintendoCollectionBootstrap();
      console.log('[gg.deals-extension][background] FETCH_NINTENDO_COLLECTION bootstrap ready, fetching views');
      const visibleItems = await fetchNintendoCollectionWithPagination(
        bootstrap,
        false,
        (progress) => sendPaginationProgressToTab(sender.tab?.id, progress)
      );
      const hiddenItems = await fetchNintendoCollectionWithPagination(bootstrap, true);
      const deduplicatedItems = dedupeNintendoCollectionViews([...visibleItems, ...hiddenItems]);
      const items = excludeNintendoDlcOnlyViews(deduplicatedItems);
      console.log('[gg.deals-extension][background] FETCH_NINTENDO_COLLECTION DLC-only views excluded:', deduplicatedItems.length - items.length);

      console.log('[gg.deals-extension][background] FETCH_NINTENDO_COLLECTION accountId:', bootstrap.accountId || '<missing>');
      console.log('[gg.deals-extension][background] FETCH_NINTENDO_COLLECTION total views:', items.length);
      return { ok: true, data: { accountId: bootstrap.accountId, username: bootstrap.username, items } };
    } catch (error) {
      console.error('[gg.deals-extension][background] FETCH_NINTENDO_COLLECTION error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { ok: false, error: errorMessage };
    }
  }

  if (message?.type === 'OPEN_URL_IN_NEW_TAB') {
    try {
      if (!message.url) {
        throw new Error('Missing URL');
      }

      await browser.tabs.create({ url: message.url, active: message.active ?? true });
      return { ok: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { ok: false, error: errorMessage };
    }
  }

  if (message?.type === 'FETCH_TEST_GAME_DATA') {
    try {
      if (!message.url || message.url.trim().length === 0) {
        throw new Error('Missing URL');
      }

      const response = await fetch(message.url.trim(), {
        method: 'GET',
        credentials: 'include'
      });

      const data = await response.json().catch(() => ({}));
      try {
        await processExtensionResponse(response, data);
      } catch (error) {
        console.warn('[gg.deals-extension][background] Failed to process test game messages:', error);
      }

      if (!response.ok) {
        return {
          ok: false,
          error: `HTTP ${response.status}`,
          status: response.status,
          data,
        };
      }

      return { ok: true, status: response.status, data };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { ok: false, error: errorMessage };
    }
  }

  if (message?.type === 'UPDATE_BADGE') {
    try {
      const senderTabId = sender?.tab?.id;
      const isBlacklisted = message.isBlacklisted === true;

      console.log('[gg.deals-extension][background] UPDATE_BADGE request:', {
        senderTabId: typeof senderTabId === 'number' ? senderTabId : null,
        isBlacklisted
      });

      await loadTabGrayIconStates();
      if (typeof senderTabId === 'number') {
        tabGrayIconStates.set(senderTabId, isBlacklisted);
        await storeTabGrayIconStates();
      }

      if (isBlacklisted) {
        await setGrayIcon(senderTabId, serverMessageIconIndicatorEnabled === true);
      } else {
        await restoreOriginalIcon(senderTabId, serverMessageIconIndicatorEnabled === true);
      }

      console.log('[gg.deals-extension][background] UPDATE_BADGE icon updated');

      return { ok: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[gg.deals-extension][background] UPDATE_BADGE error:', error);
      return { ok: false, error: errorMessage };
    }

    // Old code for updating the badge text. Left just in case we want to show something to the user in the future, but currently we are only changing the icon for blacklisted sites
    // try {
    //   const senderTabId = sender?.tab?.id;
    //   console.log('[gg.deals-extension][background] UPDATE_BADGE start, text:', message.text, 'tabId:', senderTabId);
    //   const text = typeof message.text === 'string' ? message.text : '';
    //   const badgeText = text.length > 0 ? (text.length > 4 ? '...' : text) : '';

    //   const badgeTarget = typeof senderTabId === 'number' ? { tabId: senderTabId } : {};

    //   await browser.action.setBadgeText({ ...badgeTarget, text: badgeText });
    //   if (badgeText.length > 0) {
    //     await browser.action.setBadgeBackgroundColor({ ...badgeTarget, color: '#FF0000' });
    //   }
    //   return { ok: true };
    // } catch (error) {
    //   const errorMessage = error instanceof Error ? error.message : String(error);
    //   return { ok: false, error: errorMessage };
    // }
  }

  if (message?.type === 'OPEN_POPUP') {
    try {
      const payload: Record<string, unknown> = {
        [POPUP_INITIAL_TAB_STORAGE_KEY]: message?.tab,
      };

      if (message?.settingsScrollTarget === 'bottom') {
        payload[POPUP_SETTINGS_SCROLL_TARGET_STORAGE_KEY] = message.settingsScrollTarget;
      }

      await browser.storage.session.set({
        ...payload,
      });
      await browser.action.openPopup();
      return { ok: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { ok: false, error: errorMessage };
    }
  }

  const unknownMessage = message as { type?: string };
  console.warn('[gg.deals-extension][background] unhandled message type:', unknownMessage?.type);
  return;
});
