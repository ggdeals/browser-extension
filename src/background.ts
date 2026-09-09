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

type BackgroundMessage = FetchSteamMessage | FetchSteamAccountNameMessage | PostImportDataMessage | FetchEpicTokenMessage | RefreshEpicTokenMessage | FetchEpicLibraryItemsMessage | FetchPlaystationWishlistMessage | FetchPlaystationAccountMessage | FetchPlaystationCollectionMessage | OpenUrlInNewTabMessage | FetchTestGameDataMessage | OpenPopupMessage | UpdateBadgeMessage | SyncGGUserSettingsMessage;

type RuntimeMessageResponse = {
  ok: boolean;
  data?: unknown;
  error?: string;
  errorCode?: 'INVALID_API_KEY';
  status?: number;
};

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

      // "auto" keeps a complete cached value and only fetches when there's no region yet
      if (mode === 'auto' && existingUserSettings?.region?.trim()) {
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

browser.runtime.onMessage.addListener(async (rawMessage: unknown, sender: { tab?: { id?: number } }): Promise<RuntimeMessageResponse | void> => {
  const message = rawMessage as BackgroundMessage;
  console.log('[gg.deals-extension][background] message received:', message?.type);

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
