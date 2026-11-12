import { readXboxAuthorization, writeXboxAuthorization } from './storage';

// The public Xbox web client used by XboxCollectionClient in the PHP integration.
// It has no client secret. Microsoft can restrict this client's Collections access.
export const PUBLIC_XBOX_WEB_CLIENT_ID = '1f907974-e22b-4810-a9de-d9647380c97e';
const DEVICE_CODE_URL = 'https://login.live.com/oauth20_connect.srf';
const TOKEN_URL = 'https://login.live.com/oauth20_token.srf';
const USER_AUTH_URL = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const COLLECTIONS_URL = 'https://collections.mp.microsoft.com/v7.0/collections/query';
const SCOPE = 'XboxLive.signin offline_access';
const REQUEST_OPERATIONS: Record<string, string> = {
    [DEVICE_CODE_URL]: 'device-code', [TOKEN_URL]: 'token', [USER_AUTH_URL]: 'user-auth',
    [XSTS_URL]: 'xsts', [COLLECTIONS_URL]: 'collection'
};
const RETENTION_MS = 90 * 86400000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

type DeviceAuthorization = {
    kind: 'device';
    clientId: string;
    tokenEndpoint: typeof TOKEN_URL;
    authorizationId: string;
    deviceCode: string;
    userCode: string;
    verificationUrl: string;
    expiresAt: number;
    interval: number;
    nextPollAt: number;
    requestIds?: string[];
};
type AuthorizationRequests = { authorizationId: string; requestIds: string[]; expiresAt: number };
type TokenAuthorization = {
    kind: 'token';
    clientId: string;
    accessToken: string;
    refreshToken?: string;
    accessExpiresAt: number;
    retainedUntil: number;
    xuid?: string;
    authorization?: AuthorizationRequests;
};
type Authorization = DeviceAuthorization | TokenAuthorization;
type Credentials = { token: string; uhs: string; xuid: string | null; gamertag: string | null };
export type XboxAccount = { accountId: string; username: string };
export type XboxItem = {
    productId: string;
    productKind: string;
    status: string;
    skuId: string;
    skuType?: string | null;
    licensingRequired?: boolean | null;
    orderId?: string | null;
    transactionId?: string | null;
    quantity?: number | null;
};
export type XboxCollectionPage = XboxAccount & { items: XboxItem[]; continuationToken: string | null };
export type XboxPendingAuthorization = {
    authorizationId: string;
    requestId: string;
    userCode: string;
    verificationUrl: string;
    expiresAt: number;
    retryAfter: number;
};

class XboxRequestError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, operation: string) {
        super((code === 'origin_not_allowed'
            ? 'Microsoft rejected the Xbox token request origin (AADSTS90023).'
            : `Xbox request failed (HTTP ${status})`) + ` [${operation}]`);
        this.status = status;
        this.code = code;
    }
}

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}
function positive(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function requestIds(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(nonEmpty);
}

function collectionItem(value: unknown): XboxItem {
    if (!object(value) || !nonEmpty(value.productId) || !nonEmpty(value.skuId)
        || !nonEmpty(value.productKind) || !nonEmpty(value.status)) {
        throw new Error('Xbox returned an invalid collection item');
    }
    const item: XboxItem = { productId: value.productId, productKind: value.productKind, status: value.status, skuId: value.skuId };
    // Copy only the import contract; keep missing values distinct from false or zero.
    for (const field of ['skuType', 'orderId', 'transactionId'] as const) {
        if (!Object.hasOwn(value, field)) continue;
        const fieldValue = value[field];
        if (fieldValue !== null && typeof fieldValue !== 'string') throw new Error('Xbox returned invalid collection metadata');
        item[field] = fieldValue;
    }
    if (Object.hasOwn(value, 'licensingRequired')) {
        const licensingRequired = value.licensingRequired;
        if (licensingRequired !== null && typeof licensingRequired !== 'boolean') {
            throw new Error('Xbox returned invalid collection metadata');
        }
        item.licensingRequired = licensingRequired;
    }
    if (Object.hasOwn(value, 'quantity')) {
        const quantity = value.quantity;
        if (quantity !== null && (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 0)) {
            throw new Error('Xbox returned invalid collection metadata');
        }
        item.quantity = quantity;
    }
    return item;
}

// Requests finish within one worker event. Device polling and collection pages
// are separate messages, so a service-worker restart can reload the local grant.
export class XboxCollectionClient {
    private cachedCredentials: { account: XboxAccount; marketplace: Credentials; expiresAt: number } | null = null;
    private readonly dependencies: {
        read: () => Promise<unknown>;
        write: (value: unknown) => Promise<void>;
        fetch: typeof globalThis.fetch;
        now: () => number;
        randomUUID: () => string;
    };

    constructor(dependencies = {
        read: readXboxAuthorization,
        write: writeXboxAuthorization,
        fetch: globalThis.fetch.bind(globalThis),
        now: Date.now,
        randomUUID: () => crypto.randomUUID()
    }) { this.dependencies = dependencies; }

    private async read(): Promise<Authorization | null> {
        const state = await this.dependencies.read();
        if (!object(state) || state.clientId !== PUBLIC_XBOX_WEB_CLIENT_ID) return null;
        // Device codes are specific to their authority. An unfinished grant from
        // the previous Entra endpoint must be replaced, not redeemed at MSA.
        if (state.kind === 'device' && state.tokenEndpoint === TOKEN_URL
            && nonEmpty(state.authorizationId) && nonEmpty(state.deviceCode)
            && nonEmpty(state.userCode) && nonEmpty(state.verificationUrl) && positive(state.expiresAt)
            && positive(state.interval) && positive(state.nextPollAt)
            && (state.requestIds === undefined || requestIds(state.requestIds))) {
            return state as DeviceAuthorization;
        }
        if (state.kind === 'token' && typeof state.accessToken === 'string'
            && typeof state.accessExpiresAt === 'number' && positive(state.retainedUntil)
            && (state.refreshToken === undefined || nonEmpty(state.refreshToken))
            && (state.xuid === undefined || (typeof state.xuid === 'string' && /^\d+$/.test(state.xuid)))
            && (state.authorization === undefined || (object(state.authorization)
                && nonEmpty(state.authorization.authorizationId) && requestIds(state.authorization.requestIds)
                && positive(state.authorization.expiresAt)))) {
            if (this.dependencies.now() < state.retainedUntil) return state as TokenAuthorization;
            await this.disconnect();
        }
        return null;
    }

    private async request(url: string, body: URLSearchParams | Record<string, unknown>, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const operation = REQUEST_OPERATIONS[url] ?? 'unknown';
        let responseStatus: number | undefined;
        try {
            const response = await this.dependencies.fetch(url, {
                method: 'POST', credentials: 'omit', redirect: 'error', signal: controller.signal,
                headers: { Accept: 'application/json',
                    'Content-Type': body instanceof URLSearchParams ? 'application/x-www-form-urlencoded' : 'application/json',
                    ...headers },
                body: body instanceof URLSearchParams ? body.toString() : JSON.stringify(body)
            });
            responseStatus = response.status;
            // Read with a limit before parsing; never expose provider bodies or tokens in errors.
            if (!response.body) throw new Error('Xbox returned an empty response');
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let size = 0;
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                size += chunk.value.byteLength;
                if (size > MAX_RESPONSE_BYTES) {
                    await reader.cancel();
                    throw new Error('Xbox response exceeded the size limit');
                }
                chunks.push(chunk.value);
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            let data: unknown;
            try { data = JSON.parse(new TextDecoder().decode(bytes)); }
            catch { throw new Error('Xbox returned invalid JSON'); }
            if (!object(data)) throw new Error('Xbox returned an invalid response');
            if (!response.ok || data.error !== undefined || data.XErr !== undefined) {
                const originRejected = (Array.isArray(data.error_codes) && data.error_codes.includes(90023))
                    || (typeof data.error_description === 'string'
                        && /\bAADSTS90023\b|Cross-origin token redemption is permitted only/i.test(data.error_description));
                if (url === TOKEN_URL && originRejected) {
                    // Microsoft can reject the extension Origin on refresh even
                    // though the stored grant is valid. With existing host access,
                    // current Chromium permits an explicit Origin in background
                    // fetches. Retry once without a web origin; never spoof Xbox.com,
                    // discard the grant, add permissions or open a transport page.
                    // If the browser ignores this header, preserve the grant and
                    // report the same sanitized error rather than looping.
                    if (!Object.hasOwn(headers, 'Origin')) {
                        return this.request(url, body, { ...headers, Origin: '' });
                    }
                    throw new XboxRequestError(response.status, 'origin_not_allowed', operation);
                }
                const knownCodes = ['authorization_pending', 'slow_down', 'authorization_declined', 'access_denied',
                    'expired_token', 'bad_verification_code', 'invalid_grant', 'interaction_required', 'login_required',
                    'consent_required', 'invalid_client', 'unauthorized_client'];
                const code = typeof data.error === 'string' && knownCodes.includes(data.error) ? data.error : 'request_failed';
                throw new XboxRequestError(response.status, code, operation);
            }
            return data;
        } catch (error) {
            if (error instanceof XboxRequestError) throw error;
            if (responseStatus !== undefined && responseStatus >= 400) {
                throw new XboxRequestError(responseStatus, 'request_failed', operation);
            }
            // Fetch exceptions can contain URLs, request details or response fragments.
            throw new Error(`Xbox request failed or returned an invalid response [${operation}]`);
        } finally {
            clearTimeout(timeout);
        }
    }

    private pending(state: DeviceAuthorization, requestId: string): XboxPendingAuthorization {
        return { authorizationId: state.authorizationId, requestId, userCode: state.userCode,
            verificationUrl: state.verificationUrl, expiresAt: state.expiresAt,
            retryAfter: Math.max(0, state.nextPollAt - this.dependencies.now()) };
    }

    async startAuthorization(): Promise<XboxPendingAuthorization> {
        const existing = await this.read();
        // Each caller owns a subscription to the shared device grant. Persist it
        // so another tab can finish or cancel independently after a worker restart.
        const requestId = this.dependencies.randomUUID();
        if (existing?.kind === 'device' && existing.expiresAt > this.dependencies.now()) {
            existing.requestIds = [...(existing.requestIds ?? []), requestId];
            await this.dependencies.write(existing);
            return this.pending(existing, requestId);
        }
        const requestedAt = this.dependencies.now();
        const data = await this.request(DEVICE_CODE_URL, new URLSearchParams({
            client_id: PUBLIC_XBOX_WEB_CLIENT_ID, scope: SCOPE, response_type: 'device_code'
        }));
        if (!nonEmpty(data.device_code) || !nonEmpty(data.user_code) || !nonEmpty(data.verification_uri)
            || !positive(data.expires_in) || (data.interval !== undefined && !positive(data.interval))) {
            throw new Error('Xbox returned an invalid device authorization');
        }
        let verificationUrl: URL;
        try { verificationUrl = new URL(data.verification_uri); }
        catch { throw new Error('Xbox returned an invalid verification URL'); }
        if (verificationUrl.protocol !== 'https:' || !['microsoft.com', 'www.microsoft.com', 'login.microsoftonline.com'].includes(verificationUrl.hostname)
            || verificationUrl.username || verificationUrl.password || verificationUrl.port) {
            throw new Error('Xbox returned an invalid verification URL');
        }
        verificationUrl.searchParams.set('otc', data.user_code);
        const interval = (data.interval as number | undefined ?? 5) * 1000;
        const state: DeviceAuthorization = { kind: 'device', clientId: PUBLIC_XBOX_WEB_CLIENT_ID, tokenEndpoint: TOKEN_URL,
            authorizationId: this.dependencies.randomUUID(), deviceCode: data.device_code, userCode: data.user_code,
            verificationUrl: verificationUrl.toString(), expiresAt: requestedAt + data.expires_in * 1000,
            interval, nextPollAt: this.dependencies.now() + interval, requestIds: [requestId] };
        this.cachedCredentials = null;
        await this.dependencies.write(state);
        return this.pending(state, requestId);
    }

    async pollAuthorization(authorizationId: string, requestId: string): Promise<XboxPendingAuthorization | XboxAccount> {
        const state = await this.read();
        // The first successful poll replaces the device grant with a token. Other
        // subscribers must receive that result rather than redeeming the code again.
        if (state?.kind === 'token' && state.authorization?.authorizationId === authorizationId
            && state.authorization.requestIds.includes(requestId) && this.dependencies.now() < state.authorization.expiresAt) {
            return this.getAccount();
        }
        if (state?.kind !== 'device' || state.authorizationId !== authorizationId
            || !state.requestIds?.includes(requestId)) throw new Error('XBOX_AUTH_REQUIRED');
        if (this.dependencies.now() >= state.expiresAt) {
            await this.disconnect();
            throw new Error('Xbox authorization expired. Please connect again.');
        }
        if (this.dependencies.now() < state.nextPollAt) return this.pending(state, requestId);
        const requestedAt = this.dependencies.now();
        try {
            const data = await this.request(TOKEN_URL, new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                client_id: PUBLIC_XBOX_WEB_CLIENT_ID, device_code: state.deviceCode
            }));
            await this.acceptToken(data, requestedAt, undefined, {
                authorizationId, requestIds: state.requestIds, expiresAt: state.expiresAt
            });
        } catch (error) {
            if (error instanceof XboxRequestError) {
                // A transport/configuration error does not invalidate the grant.
                if (error.code === 'origin_not_allowed') throw error;
                if (['authorization_pending', 'slow_down'].includes(error.code)) {
                    if (error.code === 'slow_down') state.interval += 5000;
                } else if (error.status < 500 && error.status !== 429) {
                    await this.disconnect();
                    throw new Error('Xbox authorization was refused or expired. Please connect again.');
                } else {
                    throw error;
                }
            } else { throw error; }
            state.nextPollAt = this.dependencies.now() + state.interval;
            await this.dependencies.write(state);
            return this.pending(state, requestId);
        }
        return this.getAccount();
    }

    private async acceptToken(data: Record<string, unknown>, requestedAt: number, previous?: TokenAuthorization,
        authorization = previous?.authorization): Promise<TokenAuthorization> {
        if (!nonEmpty(data.access_token) || !positive(data.expires_in)
            || (data.refresh_token !== undefined && !nonEmpty(data.refresh_token))
            || (data.token_type !== undefined && (typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer'))) {
            throw new Error('Xbox returned an invalid OAuth token');
        }
        const state: TokenAuthorization = { kind: 'token', clientId: PUBLIC_XBOX_WEB_CLIENT_ID,
            accessToken: data.access_token, accessExpiresAt: requestedAt + Math.max(0, data.expires_in - 60) * 1000,
            retainedUntil: requestedAt + RETENTION_MS,
            ...(authorization ? { authorization } : {}),
            ...(previous?.xuid ? { xuid: previous.xuid } : {}),
            ...(data.refresh_token || previous?.refreshToken ? { refreshToken: (data.refresh_token as string | undefined) ?? previous?.refreshToken } : {}) };
        // Save a rotated refresh token before subsequent Xbox requests can fail.
        await this.dependencies.write(state);
        this.cachedCredentials = null;
        return state;
    }

    private async accessAuthorization(): Promise<TokenAuthorization> {
        const state = await this.read();
        if (state?.kind !== 'token') throw new Error('XBOX_AUTH_REQUIRED');
        if (state.accessToken && this.dependencies.now() < state.accessExpiresAt) return state;
        if (!state.refreshToken) { await this.disconnect(); throw new Error('XBOX_AUTH_REQUIRED'); }
        const requestedAt = this.dependencies.now();
        try {
            const data = await this.request(TOKEN_URL, new URLSearchParams({ grant_type: 'refresh_token',
                client_id: PUBLIC_XBOX_WEB_CLIENT_ID, refresh_token: state.refreshToken, scope: SCOPE }));
            return await this.acceptToken(data, requestedAt, state);
        } catch (error) {
            if (error instanceof XboxRequestError && error.status < 500 && error.status !== 429
                && ['invalid_grant', 'interaction_required', 'login_required', 'consent_required'].includes(error.code)) {
                await this.disconnect();
                throw new Error('XBOX_AUTH_REQUIRED');
            }
            throw error;
        }
    }

    private credentials(data: Record<string, unknown>): Credentials {
        const xui = object(data.DisplayClaims) ? data.DisplayClaims.xui : null;
        const claims = Array.isArray(xui) ? xui[0] : null;
        if (!nonEmpty(data.Token) || !object(claims) || !nonEmpty(claims.uhs)
            || (claims.xid !== undefined && (typeof claims.xid !== 'string' || !/^\d+$/.test(claims.xid)))) {
            throw new Error('Xbox returned invalid credentials');
        }
        return { token: data.Token, uhs: claims.uhs, xuid: claims.xid as string | undefined ?? null,
            gamertag: nonEmpty(claims.gtg) ? claims.gtg : null };
    }

    private async authorize() {
        const state = await this.accessAuthorization();
        if (this.cachedCredentials && this.cachedCredentials.expiresAt > this.dependencies.now()
            && this.cachedCredentials.account.accountId === state.xuid) return this.cachedCredentials;
        let userData: Record<string, unknown>;
        try {
            userData = await this.request(USER_AUTH_URL, { Properties: { AuthMethod: 'RPS',
                SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${state.accessToken}` },
                RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' }, { 'x-xbl-contract-version': '1' });
        } catch (error) {
            if (error instanceof XboxRequestError && error.status === 401) {
                await this.dependencies.write({ ...state, accessToken: '', accessExpiresAt: 0 });
                this.cachedCredentials = null;
            }
            throw error;
        }
        const user = this.credentials(userData);
        const getXsts = (relyingParty: string) => this.request(XSTS_URL, {
            Properties: { SandboxId: 'RETAIL', UserTokens: [user.token] },
            RelyingParty: relyingParty, TokenType: 'JWT'
        }, { 'x-xbl-contract-version': '1' });
        const liveData = await getXsts('http://xboxlive.com');
        const live = this.credentials(liveData);
        if (!live.xuid) throw new Error('Xbox Live returned no account ID');
        const marketplaceData = await getXsts('http://mp.microsoft.com/');
        const marketplace = this.credentials(marketplaceData);
        if (user.uhs !== live.uhs || user.uhs !== marketplace.uhs
            || (state.xuid && state.xuid !== live.xuid)
            || (marketplace.xuid && marketplace.xuid !== live.xuid)) {
            await this.disconnect();
            throw new Error('Xbox account changed. Please connect again.');
        }
        await this.dependencies.write({ ...state, xuid: live.xuid });
        const account = { accountId: live.xuid, username: live.gamertag ?? live.xuid };
        const expiries = [userData.NotAfter, liveData.NotAfter, marketplaceData.NotAfter]
            .map((value) => typeof value === 'string' ? Date.parse(value) - 60000 : 0);
        this.cachedCredentials = { account, marketplace,
            expiresAt: Math.min(state.accessExpiresAt, ...expiries, this.dependencies.now() + 300000) };
        return this.cachedCredentials;
    }

    async getAccount(): Promise<XboxAccount> { return (await this.authorize()).account; }

    async fetchCollectionPage(accountId: string, continuationToken?: string): Promise<XboxCollectionPage> {
        if (!/^\d+$/.test(accountId) || (continuationToken !== undefined && !nonEmpty(continuationToken))) {
            throw new Error('Invalid Xbox collection request');
        }
        const { account, marketplace } = await this.authorize();
        if (accountId !== account.accountId) throw new Error('Xbox account changed during collection sync');
        const data = await this.request(COLLECTIONS_URL, {
            maxPageSize: 100, excludeDuplicates: false, market: 'US', validityType: 'All',
            beneficiaries: [{ identityType: 'xuid', identityValue: accountId, localTicketReference: 'Xbox Web' }],
            ...(continuationToken ? { continuationToken } : {})
        }, { Authorization: `XBL3.0 x=${marketplace.uhs};${marketplace.token}`,
            'MS-CV': `${this.dependencies.randomUUID().replaceAll('-', '').toUpperCase()}.0` });
        if (!Array.isArray(data.items)
            || (data.continuationToken !== undefined && data.continuationToken !== null && typeof data.continuationToken !== 'string')) {
            throw new Error('Xbox returned an invalid collection page');
        }
        // Only allowlisted license fields cross into the page, never identities
        // or authorization data embedded in other parts of the response.
        const items = data.items.map(collectionItem);
        return { ...account, items, continuationToken: data.continuationToken as string | null | undefined || null };
    }

    async cancelAuthorization(authorizationId: string, requestId: string): Promise<void> {
        const state = await this.read();
        if (state?.kind === 'device' && state.authorizationId === authorizationId && state.requestIds?.includes(requestId)) {
            const remaining = state.requestIds.filter((id) => id !== requestId);
            if (remaining.length) await this.dependencies.write({ ...state, requestIds: remaining });
            else await this.disconnect();
        } else if (state?.kind === 'token' && state.authorization?.authorizationId === authorizationId
            && state.authorization.requestIds.includes(requestId)) {
            const remaining = state.authorization.requestIds.filter((id) => id !== requestId);
            const { authorization, ...token } = state;
            await this.dependencies.write(remaining.length
                ? { ...token, authorization: { ...authorization, requestIds: remaining } }
                : token);
        }
    }

    async disconnect(keepPendingAuthorization = false): Promise<void> {
        this.cachedCredentials = null;
        // Preparing a Connect clears old tokens without canceling a fresh
        // sign-in already shared by other GG.deals tabs.
        // An actual Disconnect always removes the entire authorization.
        if (keepPendingAuthorization && (await this.read())?.kind === 'device') return;
        await this.dependencies.write(null);
    }
}
