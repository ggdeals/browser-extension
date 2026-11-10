import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = new Map();
function compile(path) {
    if (!compiled.has(path)) compiled.set(path, ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText);
    return compiled.get(path);
}
function load(path, require, globals = {}) {
    const module = { exports: {} };
    vm.runInNewContext(compile(path), { module, exports: module.exports, require,
        URL, URLSearchParams, Response, TextDecoder, Uint8Array, AbortController, Error, setTimeout, clearTimeout, ...globals });
    return module.exports;
}
const { XboxCollectionClient, PUBLIC_XBOX_WEB_CLIENT_ID } = load('../src/integrations/xbox/client.ts', () => ({}));
const accountId = '2533274790000001';
const initialTime = 1793600000000;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const clone = (value) => JSON.parse(JSON.stringify(value));
function tokenState(overrides = {}) {
    return { kind: 'token', clientId: PUBLIC_XBOX_WEB_CLIENT_ID, accessToken: 'SECRET_ACCESS', refreshToken: 'SECRET_REFRESH',
        accessExpiresAt: initialTime + 3600000, retainedUntil: initialTime + 86400000, xuid: accountId, ...overrides };
}
function fixture(options = {}) {
    let state = options.state ?? null;
    let now = initialTime;
    let uuid = 0;
    const events = [];
    const credentials = (token, claims = {}) => ({ Token: token, NotAfter: new Date(now + 3600000).toISOString(),
        DisplayClaims: { xui: [{ uhs: 'SECRET_USER_HASH', xid: accountId, gtg: 'Player', ...claims }] } });
    const defaults = ({ url, body }) => {
        if (url.href === 'https://login.live.com/oauth20_connect.srf') return json({ device_code: 'SECRET_DEVICE', user_code: 'ABCD-EFGH',
            verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5 });
        if (url.href === 'https://login.live.com/oauth20_token.srf') return json({ access_token: 'SECRET_ACCESS_ROTATED', refresh_token: 'SECRET_REFRESH_ROTATED', expires_in: 3600, token_type: 'Bearer' });
        if (url.hostname === 'user.auth.xboxlive.com') return json(credentials('SECRET_USER_TOKEN'));
        if (url.hostname === 'xsts.auth.xboxlive.com') return json(credentials(body.RelyingParty.includes('mp.microsoft') ? 'SECRET_MARKETPLACE' : 'SECRET_LIVE'));
        if (url.hostname === 'collections.mp.microsoft.com') return json({ items: [item] });
        throw new Error(`Unexpected request ${url}`);
    };
    const dependencies = {
        read: async () => state && clone(state),
        write: async (value) => { state = value && clone(value); events.push({ type: 'save', state }); },
        now: () => now, randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`,
        fetch: async (url, config) => {
            const form = config.headers['Content-Type'].includes('form');
            const event = { type: 'fetch', url: new URL(url), config,
                body: form ? Object.fromEntries(new URLSearchParams(config.body)) : JSON.parse(config.body) };
            events.push(event);
            return await options.handle?.(event, { credentials, state, events }) ?? defaults(event);
        }
    };
    return { client: new XboxCollectionClient(dependencies), dependencies, restart: () => new XboxCollectionClient(dependencies),
        events, advance: (ms) => { now += ms; }, state: () => state };
}
const item = { productId: '9NBLGGH4R315', skuId: '0010', productKind: 'Game', status: 'Active' };
function assertNoCredentials(value) {
    assert.doesNotMatch(JSON.stringify(value), /SECRET_|accessToken|refreshToken|deviceCode|RpsTicket|XBL3\.0/);
}

test('Xbox: the default client authorizes, refreshes and fetches the collection through background HTTP without browser pages', async () => {
    const f = fixture();
    const { XboxCollectionClient: DefaultClient } = load('../src/integrations/xbox/client.ts', (name) => {
        assert.equal(name, './storage');
        return { readXboxAuthorization: f.dependencies.read, writeXboxAuthorization: f.dependencies.write };
    }, { backgroundFetchContext: true,
        fetch: function (...args) {
            assert.equal(this.backgroundFetchContext, true, 'native fetch requires its background global context');
            return f.dependencies.fetch(...args);
        }, Date: class extends Date { static now() { return f.dependencies.now(); } },
        crypto: { randomUUID: f.dependencies.randomUUID } });
    // No browser, chrome, window or document is available in this context.
    const client = new DefaultClient();
    const pending = await client.startAuthorization();
    const start = f.events.find((event) => event.type === 'fetch');
    assert.equal(start.url.href, 'https://login.live.com/oauth20_connect.srf');
    assert.equal(start.body.response_type, 'device_code');
    assert.equal(start.body.scope, 'XboxLive.signin offline_access');
    f.advance(5000);
    assert.equal((await client.pollAuthorization(pending.authorizationId, pending.requestId)).accountId, accountId);
    f.advance(3600000);
    const page = await client.fetchCollectionPage(accountId);
    assert.deepEqual(clone(page.items), [item]);
    const grants = f.events.filter((event) => event.url?.href === 'https://login.live.com/oauth20_token.srf');
    assert.deepEqual(grants.map((event) => event.body.grant_type), ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token']);
    assert.equal(f.state().refreshToken, 'SECRET_REFRESH_ROTATED');
    for (const request of f.events.filter((event) => event.type === 'fetch')) {
        assert.equal(request.url.protocol, 'https:');
        assert.equal(request.url.search, '');
        assert.equal(request.config.method, 'POST');
        assert.equal(request.config.credentials, 'omit');
        assert.equal(request.config.redirect, 'error');
        assert.equal(Object.keys(request.config.headers).some((name) => name.toLowerCase() === 'origin'), false);
    }
    assertNoCredentials(page);
});

test('Xbox: an unfinished Entra device grant is replaced instead of sent to the MSA endpoint', async () => {
    const f = fixture({ state: { kind: 'device', clientId: PUBLIC_XBOX_WEB_CLIENT_ID,
        authorizationId: 'old-flow', deviceCode: 'SECRET_OLD_DEVICE', userCode: 'OLD-CODE',
        verificationUrl: 'https://microsoft.com/devicelogin', expiresAt: initialTime + 900000,
        interval: 5000, nextPollAt: initialTime } });
    const pending = await f.client.startAuthorization();
    assert.notEqual(pending.authorizationId, 'old-flow');
    assert.equal(f.state().tokenEndpoint, 'https://login.live.com/oauth20_token.srf');
    assert.equal(f.events.filter((event) => event.type === 'fetch').length, 1);
    assert.equal(f.events.some((event) => event.body?.device_code === 'SECRET_OLD_DEVICE'), false);
});

const { fetchXboxBrowserAccount } = load('../src/integrations/xbox/session.ts', () => ({}));
function profileResponse(state, { status = 200, url = 'https://www.xbox.com/en-us/home_alt/dark/home', html } = {}) {
    const response = new Response(html ?? `<html><script>
        window.__PRELOADED_STATE__ = ${JSON.stringify(state)};
        throw new Error('SECRET_SCRIPT_MUST_NOT_EXECUTE');
        </script></html>`, { status });
    Object.defineProperty(response, 'url', { value: url });
    return response;
}

test('Xbox browser session: reads only the signed-in XUID/gamertag using fresh Xbox.com cookies', async () => {
    const calls = [];
    const result = await fetchXboxBrowserAccount(async (url, init) => {
        calls.push({ url, init });
        return profileResponse({ user: { isSignedIn: true, userInfo: { xuid: accountId, gamerTag: 'Player {"nickname"}',
            accessToken: 'SECRET_WEB_TOKEN', email: 'SECRET_EMAIL' } },
        profile: { xuid: '999', gamerTag: 'Someone else' } });
    });
    assert.deepEqual(clone(result), { accountId, username: 'Player {"nickname"}' });
    assertNoCredentials(result);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://www.xbox.com/en-us/home_alt/dark/home');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.credentials, 'include');
    assert.equal(calls[0].init.cache, 'no-store');
    assert.deepEqual(clone(calls[0].init.headers), { Accept: 'text/html' });
});

test('Xbox browser session: a signed-out page is distinct from an unreadable or invalid response', async () => {
    for (const user of [{ isSignedIn: false }, { isSignedIn: false, userInfo: null },
        { isSignedIn: false, userInfo: { xuid: accountId, gamerTag: 'Stale player' } }]) {
        assert.equal(await fetchXboxBrowserAccount(async () => profileResponse({ user })), null);
    }
    for (const [state, options] of [
        [{}, {}], [{ user: {} }, {}], [{ user: { isSignedIn: true, userInfo: {} } }, {}],
        [{ user: { isSignedIn: true } }, {}], [{ user: { isSignedIn: true, userInfo: null } }, {}],
        ...[undefined, null, 'false', 'true', 0, 1].map(isSignedIn =>
            [{ user: { isSignedIn, userInfo: { xuid: accountId, gamerTag: 'Player' } } }, {}]),
        [{ user: { isSignedIn: true, userInfo: { xuid: 123 } } }, {}],
        [{ user: {} }, { status: 503 }], [{ user: {} }, { url: 'https://login.live.com/' }],
        [{ user: {} }, { url: 'https://www.xbox.com.evil.example/en-US/play/user/' }],
        [{ user: {} }, { html: '<script>window.__PRELOADED_STATE__ = {"SECRET_TRUNCATED":</script>' }],
        [{ user: {} }, { html: '<h1>SECRET_UNKNOWN_RESPONSE</h1>' }]
    ]) {
        await assert.rejects(fetchXboxBrowserAccount(async () => profileResponse(state, options)), (error) => {
            assert.equal(error.message, 'XBOX_BROWSER_SESSION_UNAVAILABLE');
            assertNoCredentials(error.message);
            return true;
        });
    }
    await assert.rejects(fetchXboxBrowserAccount(async () => { throw new Error('SECRET_NETWORK_DETAILS'); }),
        { message: 'XBOX_BROWSER_SESSION_UNAVAILABLE' });
});

test('Xbox browser session: the signed-out home shape needs no userInfo and ignores subsequent script assignments', async () => {
    const state = { user: { isSignedIn: false, userAgeGatingInfo: { type: 0 },
        userPrivacyConsentInfo: { userPrivacyConsent: { type: 0 } }, contactPreferences: { type: 0 },
        familyInfo: { type: 0 }, isDefaultUserAgeGatingInfo: false },
    core2: { wishlist: { wishlists: {} } } };
    const html = `<script>
        window.__PRELOADED_STATE__ = ${JSON.stringify(state)};
        window.env = { BUILD_VERSION: 'test' };
        window.xbcUser = { isSignedIn: false };
        throw new Error('SECRET_SCRIPT_MUST_NOT_EXECUTE');
    </script>`;
    assert.equal(await fetchXboxBrowserAccount(async () => profileResponse(null, { html })), null);
});

test('Xbox browser session: only official session-home routes are trusted after redirects', async () => {
    const state = { user: { isSignedIn: true, userInfo: { xuid: accountId, gamerTag: 'Player' } } };
    for (const url of ['https://www.xbox.com/en-US/home_alt/dark/home/', 'https://www.xbox.com/pl-PL/home_alt/dark/home']) {
        assert.deepEqual(clone(await fetchXboxBrowserAccount(async () => profileResponse(state, { url }))),
            { accountId, username: 'Player' });
    }
    for (const url of ['https://www.xbox.com.evil.example/en-us/home_alt/dark/home', 'https://www.xbox.com/other',
        'http://www.xbox.com/en-us/home_alt/dark/home', 'https://www.xbox.com/en-us/play/user/Player',
        'https://play.xbox.com/user/Player']) {
        await assert.rejects(fetchXboxBrowserAccount(async () => profileResponse(state, { url })),
            { message: 'XBOX_BROWSER_SESSION_UNAVAILABLE' });
    }
});

test('Xbox browser session: the modern anonymous SSR payload cannot identify the signed-in account from a viewed profile', async () => {
    const payload = { json: { queries: [{ state: { data: { activeUserXuid: null,
        route: { params: { gamertag: 'Some other public profile' } } } } }] },
        meta: { values: { 'queries.0.state.data.activeUserXuid': ['undefined'] } } };
    const response = profileResponse({}, {
        html: `<html><script id="__SSR_LOADER_DATA__" type="application/json">${JSON.stringify(payload)}</script></html>` });
    await assert.rejects(fetchXboxBrowserAccount(async () => response), { message: 'XBOX_BROWSER_SESSION_UNAVAILABLE' });
});

test('Xbox browser session: oversized responses are canceled instead of read or forwarded', async () => {
    const oversized = new Response('x'.repeat(16 * 1024 * 1024 + 1));
    Object.defineProperty(oversized, 'url', { value: 'https://www.xbox.com/en-us/home_alt/dark/home' });
    await assert.rejects(fetchXboxBrowserAccount(async () => oversized), { message: 'XBOX_BROWSER_SESSION_UNAVAILABLE' });
});

test('Xbox: device code stays local, survives restart, and honors pending / slow_down intervals', async () => {
    let polls = 0;
    const f = fixture({ handle: ({ url }) => {
        if (url.href !== 'https://login.live.com/oauth20_token.srf') return;
        polls++;
        if (polls < 3) return json({ error: polls === 1 ? 'authorization_pending' : 'slow_down' }, 400);
    } });
    const pending = await f.client.startAuthorization();
    assert.equal(f.state().deviceCode, 'SECRET_DEVICE');
    assert.equal(new URL(pending.verificationUrl).searchParams.get('otc'), 'ABCD-EFGH');
    assertNoCredentials(pending);
    let client = f.restart();
    await client.pollAuthorization(pending.authorizationId, pending.requestId);
    assert.equal(polls, 0);
    f.advance(5000);
    assert.equal((await client.pollAuthorization(pending.authorizationId, pending.requestId)).retryAfter, 5000);
    f.advance(5000);
    assert.equal((await client.pollAuthorization(pending.authorizationId, pending.requestId)).retryAfter, 10000);
    f.advance(5000);
    await client.pollAuthorization(pending.authorizationId, pending.requestId);
    assert.equal(polls, 2);
    f.advance(5000);
    const account = await client.pollAuthorization(pending.authorizationId, pending.requestId);
    assert.deepEqual(clone(account), { accountId, username: 'Player' });
    assertNoCredentials(account);
    assert.equal(f.state().refreshToken, 'SECRET_REFRESH_ROTATED');
    assert.equal(f.state().deviceCode, undefined);
    const userRequest = f.events.findIndex((event) => event.url?.hostname === 'user.auth.xboxlive.com');
    assert.ok(f.events.findIndex((event) => event.state?.refreshToken === 'SECRET_REFRESH_ROTATED') < userRequest);
});

test('Xbox: declined and expired device grants are deleted', async () => {
    const f = fixture({ handle: ({ url }) => url.href === 'https://login.live.com/oauth20_token.srf' ? json({ error: 'authorization_declined' }, 400) : undefined });
    const pending = await f.client.startAuthorization();
    f.advance(5000);
    await assert.rejects(f.client.pollAuthorization(pending.authorizationId, pending.requestId), /refused or expired/);
    assert.equal(f.state(), null);
    const next = await f.client.startAuthorization();
    f.advance(901000);
    await assert.rejects(f.client.pollAuthorization(next.authorizationId, next.requestId), /expired/);
    assert.equal(f.state(), null);
});

test('Xbox: cancel only removes the matching pending grant and disconnect deletes local tokens', async () => {
    const f = fixture();
    const pending = await f.client.startAuthorization();
    await f.client.cancelAuthorization('different-flow', pending.requestId);
    assert.ok(f.state());
    await f.client.cancelAuthorization(pending.authorizationId, pending.requestId);
    assert.equal(f.state(), null);
    const tokenFixture = fixture({ state: tokenState() });
    await tokenFixture.client.cancelAuthorization(pending.authorizationId, pending.requestId);
    assert.equal(tokenFixture.state().accessToken, 'SECRET_ACCESS');
    await tokenFixture.client.disconnect();
    await assert.rejects(tokenFixture.client.getAccount(), /XBOX_AUTH_REQUIRED/);
    assert.equal(tokenFixture.state(), null);
});

test('Xbox: rotated refresh token is saved before an Xbox outage, without leaking provider errors', async () => {
    const f = fixture({ state: tokenState({ accessExpiresAt: 1 }), handle: ({ url }) => {
        if (url.hostname === 'user.auth.xboxlive.com') throw new Error('SECRET_ACCESS_ROTATED SECRET_REFRESH_ROTATED');
    } });
    await assert.rejects(f.client.getAccount(), (error) => { assertNoCredentials(error.message); return true; });
    assert.equal(f.state().refreshToken, 'SECRET_REFRESH_ROTATED');
    const refresh = f.events.find((event) => event.url?.href === 'https://login.live.com/oauth20_token.srf');
    assert.equal(refresh.body.grant_type, 'refresh_token');
    assert.equal(refresh.body.refresh_token, 'SECRET_REFRESH');
    assert.equal(refresh.body.client_id, PUBLIC_XBOX_WEB_CLIENT_ID);
});

for (const [code, status, cleared] of [['invalid_grant', 400, true], ['server_error', 503, false]]) {
    test(`Xbox: refresh ${code} ${cleared ? 'clears' : 'preserves'} the grant`, async () => {
        const f = fixture({ state: tokenState({ accessExpiresAt: 1 }), handle: ({ url }) =>
            url.href === 'https://login.live.com/oauth20_token.srf' ? json({ error: code, error_description: 'SECRET_REFRESH' }, status) : undefined });
        await assert.rejects(f.client.getAccount(), (error) => { assertNoCredentials(error.message); return true; });
        assert.equal(f.state() === null, cleared);
    });
}

test('Xbox: AADSTS90023 identifies the transport error without discarding a refresh token', async () => {
    const f = fixture({ state: tokenState({ accessExpiresAt: 1 }), handle: ({ url }) => url.href === 'https://login.live.com/oauth20_token.srf'
        ? json({ error: 'invalid_request', error_codes: [90023], error_description: 'SECRET_REFRESH provider details' }, 400) : undefined });
    await assert.rejects(f.client.getAccount(), (error) => {
        assert.match(error.message, /AADSTS90023/);
        assertNoCredentials(error.message);
        return true;
    });
    assert.equal(f.state().refreshToken, 'SECRET_REFRESH');
    assert.equal(f.events.some((event) => event.type === 'save'), false);
    assert.equal(f.events.filter(event => event.url?.href === 'https://login.live.com/oauth20_token.srf').length, 2);
});

const originRejection = () => json({ error: 'invalid_request',
    error_description: "Cross-origin token redemption is permitted only for the 'Single-Page Application' client-type or 'Native' client-type with origin registered in AllowedOriginForNativeAppCorsRequestInOAuthToken allow list. SECRET_PROVIDER_DETAILS",
    correlation_id: 'SECRET_CORRELATION_ID' }, 400);

test('Xbox: the MSA refresh origin error without error_codes retries once and retains the rotated token', async () => {
    const f = fixture({ state: tokenState({ accessExpiresAt: 1 }), handle: ({ url, config }) => {
        if (url.href === 'https://login.live.com/oauth20_token.srf' && config.headers.Origin !== '') return originRejection();
    } });
    const account = await f.client.getAccount();
    assert.equal(account.accountId, accountId);
    const requests = f.events.filter(event => event.url?.href === 'https://login.live.com/oauth20_token.srf');
    assert.equal(requests.length, 2);
    assert.equal(requests[0].config.headers.Origin, undefined);
    assert.equal(requests[1].config.headers.Origin, '');
    assert.deepEqual(requests[1].body, requests[0].body);
    assert.equal(requests[1].body.grant_type, 'refresh_token');
    assert.equal(f.state().refreshToken, 'SECRET_REFRESH_ROTATED');
    const saved = f.events.findIndex(event => event.state?.refreshToken === 'SECRET_REFRESH_ROTATED');
    const xboxAuth = f.events.findIndex(event => event.url?.hostname === 'user.auth.xboxlive.com');
    assert.ok(saved < xboxAuth);
    assert.equal(f.events.filter(event => event.url?.hostname.endsWith('xboxlive.com')).every(event => !Object.hasOwn(event.config.headers, 'Origin')), true);
    assertNoCredentials(account);
});

test('Xbox: a browser that ignores the Origin override stops after two attempts and keeps the refresh grant', async () => {
    const f = fixture({ state: tokenState({ accessExpiresAt: 1 }), handle: ({ url }) =>
        url.href === 'https://login.live.com/oauth20_token.srf' ? originRejection() : undefined });
    await assert.rejects(f.client.getAccount(), error => {
        assert.match(error.message, /AADSTS90023/);
        assertNoCredentials(error.message);
        return true;
    });
    assert.equal(f.events.filter(event => event.url?.href === 'https://login.live.com/oauth20_token.srf').length, 2);
    assert.equal(f.events.some(event => event.type === 'save'), false);
    assert.equal(f.state().refreshToken, 'SECRET_REFRESH');
});

test('Xbox: a device token origin rejection uses the same bounded transport retry', async () => {
    const f = fixture({ handle: ({ url, config }) => {
        if (url.href === 'https://login.live.com/oauth20_token.srf' && config.headers.Origin !== '') return originRejection();
    } });
    const pending = await f.client.startAuthorization();
    f.advance(5000);
    assert.equal((await f.client.pollAuthorization(pending.authorizationId, pending.requestId)).accountId, accountId);
    const requests = f.events.filter(event => event.url?.href === 'https://login.live.com/oauth20_token.srf');
    assert.equal(requests.length, 2);
    assert.equal(requests[1].body.grant_type, 'urn:ietf:params:oauth:grant-type:device_code');
});

test('Xbox: unrelated invalid_request responses do not trigger an Origin retry or delete credentials', async () => {
    const f = fixture({ state: tokenState({ accessExpiresAt: 1 }), handle: ({ url }) =>
        url.href === 'https://login.live.com/oauth20_token.srf'
            ? json({ error: 'invalid_request', error_description: 'SECRET_UNRELATED_REASON' }, 400) : undefined });
    await assert.rejects(f.client.getAccount(), /HTTP 400/);
    assert.equal(f.events.filter(event => event.type === 'fetch').length, 1);
    assert.equal(f.state().refreshToken, 'SECRET_REFRESH');
});

test('Xbox: origin rejection wording on an Xbox API cannot enable token transport behavior there', async () => {
    const f = fixture({ state: tokenState(), handle: ({ url }) =>
        url.hostname === 'user.auth.xboxlive.com' ? originRejection() : undefined });
    await assert.rejects(f.client.getAccount(), /HTTP 400/);
    assert.equal(f.events.filter(event => event.type === 'fetch').length, 1);
    assert.equal(f.events.some(event => Object.hasOwn(event.config?.headers ?? {}, 'Origin')), false);
});

test('Xbox: AADSTS90023 preserves an authorized device grant for retry after a transport update', async () => {
    const f = fixture({ handle: ({ url }) => url.href === 'https://login.live.com/oauth20_token.srf'
        ? json({ error: 'invalid_request', error_codes: [90023], error_description: 'SECRET_DEVICE provider details' }, 400) : undefined });
    const pending = await f.client.startAuthorization();
    f.advance(5000);
    await assert.rejects(f.client.pollAuthorization(pending.authorizationId, pending.requestId), /AADSTS90023/);
    assert.equal(f.state().deviceCode, 'SECRET_DEVICE');
});

test('Xbox: retention expiry requires new authorization', async () => {
    const f = fixture({ state: tokenState({ retainedUntil: initialTime - 1 }) });
    await assert.rejects(f.client.getAccount(), /XBOX_AUTH_REQUIRED/);
    assert.equal(f.state(), null);
    assert.equal(f.events.filter((event) => event.type === 'fetch').length, 0);
});

for (const mismatch of ['xuid', 'uhs']) {
    test(`Xbox: an XSTS ${mismatch} mismatch clears credentials and prevents collection reads`, async () => {
        const f = fixture({ state: tokenState(), handle: ({ url, body }, { credentials }) => {
            if (url.hostname === 'xsts.auth.xboxlive.com' && body.RelyingParty.includes('mp.microsoft')) {
                return json(credentials('SECRET_WRONG_TOKEN', mismatch === 'xuid' ? { xid: '999' } : { uhs: 'other' }));
            }
        } });
        await assert.rejects(f.client.fetchCollectionPage(accountId), /account changed/);
        assert.equal(f.state(), null);
        assert.equal(f.events.some((event) => event.url?.hostname === 'collections.mp.microsoft.com'), false);
    });
}

test('Xbox: correct relying parties, collection headers/cursor, durable entitlements, and no credentials returned', async () => {
    const f = fixture({ state: tokenState(), handle: ({ url }) => url.hostname === 'collections.mp.microsoft.com'
        ? json({ items: [item, { ...item, productKind: 'Durable', skuId: '0001', access_token: 'SECRET_UNEXPECTED_FIELD' }], continuationToken: 'next-page' }) : undefined });
    const page = await f.client.fetchCollectionPage(accountId, 'previous-page');
    assertNoCredentials(page);
    assert.equal(page.items.length, 2);
    assert.equal(page.items[1].productKind, 'Durable');
    assert.equal(page.continuationToken, 'next-page');
    const parties = f.events.filter((event) => event.url?.hostname === 'xsts.auth.xboxlive.com').map((event) => event.body.RelyingParty);
    assert.deepEqual(parties, ['http://xboxlive.com', 'http://mp.microsoft.com/']);
    const request = f.events.find((event) => event.url?.hostname === 'collections.mp.microsoft.com');
    assert.equal(request.config.headers.Authorization, 'XBL3.0 x=SECRET_USER_HASH;SECRET_MARKETPLACE');
    assert.equal(request.body.continuationToken, 'previous-page');
    assert.equal(request.body.excludeDuplicates, false);
    assert.equal(request.body.validityType, 'All');
    assert.deepEqual(request.body.beneficiaries, [{ identityType: 'xuid', identityValue: accountId, localTicketReference: 'Xbox Web' }]);
    for (const event of f.events.filter((event) => event.type === 'fetch')) {
        assert.equal(event.config.credentials, 'omit');
        assert.equal(event.config.redirect, 'error');
        assert.equal(event.url.protocol, 'https:');
    }
});

const purchasedLicense = {
    ...item, skuType: 'Full', licensingRequired: false, orderId: 'order-1', transactionId: 'order-1', quantity: 1
};
const discLicense = {
    ...item, skuType: 'Full', licensingRequired: false, quantity: 0
};
const excludedItemMetadata = {
    itemId: 'purchase-license', inAppOfferToken: 'Example game', ownershipType: 'OwnedByBeneficiary',
    sharingSource: 'None', acquisitionType: 'Single', orderLineItemId: 'line-1', purchasedCountry: 'TR',
    productTitleId: '-129071', acquiredDate: '2023-08-22T08:29:19.140825+00:00',
    startDate: '2023-08-22T08:14:19.140825+00:00', endDate: '9999-12-31T23:59:59.9999999+00:00',
    modifiedDate: '2023-08-22T08:29:19.1298445+00:00', tags: ['tag-1', 'tag-2'], satisfiedByProductIds: []
};

test('Xbox: collection items forward exactly the nine allowed fields and discard all other metadata', async () => {
    const f = fixture({ state: tokenState(), handle: ({ url }) => url.hostname === 'collections.mp.microsoft.com'
        ? json({ items: [{ ...purchasedLicense, ...excludedItemMetadata, beneficiary: { identityValue: 'SECRET_MSA_ID' },
            purchaser: { identityValue: 'SECRET_PURCHASER' }, localTicketReference: 'SECRET_TICKET',
            accessToken: 'SECRET_ACCESS', arbitraryMetadata: { value: 'SECRET_UNKNOWN' } }] }) : undefined });
    const page = await f.client.fetchCollectionPage(accountId);
    assert.deepEqual(clone(page.items), [purchasedLicense]);
    assert.deepEqual(Object.keys(page.items[0]).sort(), ['productId', 'productKind', 'status', 'skuId', 'skuType',
        'licensingRequired', 'orderId', 'transactionId', 'quantity'].sort());
    assertNoCredentials(page);
});

test('Xbox: zero quantity and false licensingRequired survive without inventing missing purchase fields', async () => {
    const f = fixture({ state: tokenState(), handle: ({ url }) => url.hostname === 'collections.mp.microsoft.com'
        ? json({ items: [discLicense] }) : undefined });
    const page = await f.client.fetchCollectionPage(accountId);
    assert.deepEqual(clone(page.items), [discLicense]);
    for (const field of ['orderId', 'transactionId']) {
        assert.equal(Object.hasOwn(page.items[0], field), false, field);
    }
});

test('Xbox: explicitly null license fields stay distinguishable from omitted fields', async () => {
    const license = { ...item, skuType: null, licensingRequired: null, orderId: '', transactionId: null, quantity: null };
    const f = fixture({ state: tokenState(), handle: ({ url }) => url.hostname === 'collections.mp.microsoft.com'
        ? json({ items: [license] }) : undefined });
    const page = await f.client.fetchCollectionPage(accountId);
    assert.deepEqual(clone(page.items), [license]);
});

test('Xbox: malformed license metadata fails instead of becoming a false Disc2Digital candidate', async () => {
    for (const metadata of [{ quantity: '0' }, { quantity: -1 }, { licensingRequired: 'false' },
        { licensingRequired: 0 }, { skuType: {} }, { orderId: {} }, { transactionId: [] }]) {
        const f = fixture({ state: tokenState(), handle: ({ url }) => url.hostname === 'collections.mp.microsoft.com'
            ? json({ items: [{ ...item, ...metadata }] }) : undefined });
        await assert.rejects(f.client.fetchCollectionPage(accountId), /invalid collection/);
    }
});

test('Xbox: another account cannot use the collection grant', async () => {
    const f = fixture({ state: tokenState() });
    await assert.rejects(f.client.fetchCollectionPage('999'), /account changed/);
    assert.equal(f.events.some((event) => event.url?.hostname === 'collections.mp.microsoft.com'), false);
});

test('Xbox: diagnostics identify the failed provider operation without returning its body', async () => {
    for (const [hostname, operation, response] of [
        ['user.auth.xboxlive.com', 'user-auth', () => json({ error: 'SECRET_PROVIDER_BODY' }, 401)],
        ['xsts.auth.xboxlive.com', 'xsts', () => json({ XErr: 123, Message: 'SECRET_PROVIDER_BODY' }, 400)],
        ['collections.mp.microsoft.com', 'collection', () => new Response('SECRET_HTML_ERROR', { status: 503 })]
    ]) {
        const f = fixture({ state: tokenState(), handle: ({ url }) => url.hostname === hostname ? response() : undefined });
        await assert.rejects(f.client.fetchCollectionPage(accountId), error => {
            assert.match(error.message, new RegExp(`\\[${operation}\\]$`));
            assert.match(error.message, /HTTP (401|400|503)/);
            assertNoCredentials(error.message);
            return true;
        });
    }
});

test('Xbox: malformed pages and credentials are rejected', async () => {
    for (const payload of [{ items: null }, { items: [null] }, { items: [item], continuationToken: 123 }]) {
        const f = fixture({ state: tokenState(), handle: ({ url }) => url.hostname === 'collections.mp.microsoft.com' ? json(payload) : undefined });
        await assert.rejects(f.client.fetchCollectionPage(accountId), /invalid collection/);
    }
});

function backgroundFixture(options = {}) {
    const f = fixture(options);
    const tabs = [];
    const openTabs = new Map();
    const focusedTabs = [];
    const focusedWindows = [];
    const progress = [];
    const browserChecks = [];
    class StoredClient extends XboxCollectionClient { constructor() { super(f.dependencies); } }
    const background = load('../src/integrations/xbox/background.ts', (name) => {
        if (name === './client') return { XboxCollectionClient: StoredClient };
        if (name === './session') return { fetchXboxBrowserAccount: async () => {
            browserChecks.push('check');
            if (options.browserError) throw new Error(options.browserError);
            // Default to an Xbox.com session of the token's account; `null` means signed out.
            if (options.browserAccount === undefined) return { accountId, username: 'Player' };
            return typeof options.browserAccount === 'function' ? options.browserAccount() : options.browserAccount;
        } };
        if (name.endsWith('gg-api-constants')) return { USER_SETTINGS_URL: 'https://gg.deals/extensionData/user/' };
        if (name === 'webextension-polyfill') return { default: { windows: {
            update: async (id, properties) => {
                if (options.focusError) throw new Error('Cannot focus window');
                focusedWindows.push({ id, ...properties });
            }
        }, tabs: {
            create: async (tab) => {
                if (options.createTabError) throw new Error('Cannot open Microsoft tab');
                tabs.push(tab); const id = tabs.length; openTabs.set(id, { id, url: tab.url }); return { id, ...tab };
            },
            get: async (id) => { if (!openTabs.has(id)) throw new Error('No tab with id'); return openTabs.get(id); },
            update: async (id, properties) => { if (!openTabs.has(id)) throw new Error('No tab with id'); focusedTabs.push({ id, ...properties }); }
        } } };
        throw new Error(`Unexpected dependency ${name}`);
    });
    return { ...f, tabs, openTabs, focusedTabs, focusedWindows, progress, browserChecks,
        send: (message, sender = 'https://gg.deals/collection/', incognito = false) =>
            background.handleXboxMessage(message, sender,
                (currentPage, totalPages) => progress.push({ currentPage, totalPages }), incognito) };
}

test('Xbox: a joined pending authorization focuses its Microsoft tab instead of opening another one', async () => {
    const f = backgroundFixture();
    const first = await f.send({ type: 'START_XBOX_AUTHORIZATION' });
    const second = await f.send({ type: 'START_XBOX_AUTHORIZATION' });
    assert.equal(second.data.authorizationId, first.data.authorizationId);
    assert.equal(f.tabs.length, 1);
    assert.deepEqual(f.focusedTabs, [{ id: 1, active: true }]);

    // The user navigated away from Microsoft sign-in: open a new tab.
    f.openTabs.get(1).url = 'https://gg.deals/';
    await f.send({ type: 'START_XBOX_AUTHORIZATION' });
    assert.equal(f.tabs.length, 2);

    // The user closed the tab: open a new one.
    f.openTabs.delete(2);
    await f.send({ type: 'START_XBOX_AUTHORIZATION' });
    assert.equal(f.tabs.length, 3);
    assert.equal(f.focusedTabs.length, 1);
});

test('Xbox: a Microsoft navigation that has not committed is reused and its window is focused', async () => {
    const f = backgroundFixture();
    const first = await f.send({ type: 'START_XBOX_AUTHORIZATION' });
    const tab = f.openTabs.get(1);
    tab.pendingUrl = tab.url;
    tab.url = '';
    tab.windowId = 7;
    const second = await f.send({ type: 'START_XBOX_AUTHORIZATION' });
    assert.equal(second.data.authorizationId, first.data.authorizationId);
    assert.notEqual(second.data.requestId, first.data.requestId);
    assert.equal(f.tabs.length, 1);
    assert.deepEqual(f.focusedTabs, [{ id: 1, active: true }]);
    assert.deepEqual(f.focusedWindows, [{ id: 7, focused: true }]);

    // A pending navigation away takes precedence over the previous Microsoft URL.
    tab.url = tab.pendingUrl;
    tab.pendingUrl = 'https://gg.deals/';
    await f.send({ type: 'START_XBOX_AUTHORIZATION' });
    assert.equal(f.tabs.length, 2);
});

test('Xbox: joined sign-ins both receive the account after one redemption, including across a worker restart', async () => {
    const f = backgroundFixture();
    const first = (await f.send({ type: 'START_XBOX_AUTHORIZATION' })).data;
    const second = (await f.send({ type: 'START_XBOX_AUTHORIZATION' })).data;
    f.advance(5000);
    const firstAccount = await f.send({ type: 'POLL_XBOX_AUTHORIZATION',
        authorizationId: first.authorizationId, requestId: first.requestId });
    await f.send({ type: 'CANCEL_XBOX_AUTHORIZATION', authorizationId: first.authorizationId, requestId: first.requestId });
    const secondAccount = await f.restart().pollAuthorization(second.authorizationId, second.requestId);
    assert.equal(firstAccount.ok, true);
    assert.deepEqual(clone(firstAccount.data), clone(secondAccount));
    assert.equal(secondAccount.accountId, accountId);
    assert.equal(f.events.filter(event => event.url?.href === 'https://login.live.com/oauth20_token.srf').length, 1);
    await f.restart().cancelAuthorization(second.authorizationId, second.requestId);
    assert.equal(f.state().authorization, undefined);
    assert.equal(f.state().kind, 'token');
    assertNoCredentials([firstAccount, secondAccount]);
});

test('Xbox: failure to focus a window does not open another Microsoft tab', async () => {
    const f = backgroundFixture({ focusError: true });
    await f.send({ type: 'START_XBOX_AUTHORIZATION' });
    f.openTabs.get(1).windowId = 7;
    const second = await f.send({ type: 'START_XBOX_AUTHORIZATION' });
    assert.equal(second.ok, true);
    assert.equal(f.tabs.length, 1);
    assert.deepEqual(f.focusedTabs, [{ id: 1, active: true }]);
});

test('Xbox: failure to open Microsoft releases the unreturned subscription', async () => {
    const f = backgroundFixture({ createTabError: true });
    assert.equal((await f.send({ type: 'START_XBOX_AUTHORIZATION' })).ok, false);
    assert.equal(f.state(), null);
});

test('Xbox: an unfinished grant from before subscription support can be joined without another Microsoft code', async () => {
    const f = fixture();
    const first = await f.client.startAuthorization();
    const legacyState = clone(f.state());
    delete legacyState.requestIds;
    await f.dependencies.write(legacyState);
    const next = await f.restart().startAuthorization();
    assert.equal(next.authorizationId, first.authorizationId);
    assert.equal(f.events.filter(event => event.url?.href === 'https://login.live.com/oauth20_connect.srf').length, 1);
    f.advance(5000);
    assert.equal((await f.restart().pollAuthorization(next.authorizationId, next.requestId)).accountId, accountId);
});

test('Xbox: cancelling one pending sign-in leaves the other subscriber able to finish after restart', async () => {
    const f = fixture();
    const first = await f.client.startAuthorization();
    const second = await f.client.startAuthorization();
    await f.client.cancelAuthorization(first.authorizationId, first.requestId);
    assert.equal(f.state().kind, 'device');
    await assert.rejects(f.restart().pollAuthorization(first.authorizationId, first.requestId), /XBOX_AUTH_REQUIRED/);
    f.advance(5000);
    const account = await f.restart().pollAuthorization(second.authorizationId, second.requestId);
    assert.equal(account.accountId, accountId);
});

test('Xbox: only the last pending subscriber cancels the device grant', async () => {
    const f = fixture();
    const first = await f.client.startAuthorization();
    const second = await f.client.startAuthorization();
    await f.client.cancelAuthorization(first.authorizationId, 'unregistered-request');
    await f.client.cancelAuthorization(first.authorizationId, first.requestId);
    assert.equal(f.state().kind, 'device');
    await f.restart().cancelAuthorization(second.authorizationId, second.requestId);
    assert.equal(f.state(), null);
});

test('Xbox: a token refresh retains the authorization result for another pending subscriber', async () => {
    const f = fixture();
    const first = await f.client.startAuthorization();
    const second = await f.client.startAuthorization();
    f.advance(5000);
    await f.client.pollAuthorization(first.authorizationId, first.requestId);
    await f.client.cancelAuthorization(first.authorizationId, first.requestId);
    await f.dependencies.write({ ...f.state(), accessExpiresAt: 1 });
    const account = await f.restart().pollAuthorization(second.authorizationId, second.requestId);
    assert.equal(account.accountId, accountId);
    assert.equal(f.events.filter(event => event.body?.grant_type === 'refresh_token').length, 1);
    assert.equal(f.state().refreshToken, 'SECRET_REFRESH_ROTATED');
});

test('Xbox: completed authorization subscriptions cannot outlive their expiry or survive Disconnect', async () => {
    const f = fixture();
    const first = await f.client.startAuthorization();
    const second = await f.client.startAuthorization();
    f.advance(5000);
    await f.client.pollAuthorization(first.authorizationId, first.requestId);
    await assert.rejects(f.client.pollAuthorization(first.authorizationId, 'unregistered-request'), /XBOX_AUTH_REQUIRED/);
    f.advance(900000);
    await assert.rejects(f.restart().pollAuthorization(second.authorizationId, second.requestId), /XBOX_AUTH_REQUIRED/);
    assert.equal((await f.client.getAccount()).accountId, accountId);
    await f.client.disconnect();
    await assert.rejects(f.restart().pollAuthorization(second.authorizationId, second.requestId), /XBOX_AUTH_REQUIRED/);
    assert.equal(f.state(), null);
});

test('Xbox: preparing another Connect preserves pending sign-in, but Disconnect cancels every subscriber', async () => {
    const f = backgroundFixture();
    const first = (await f.send({ type: 'START_XBOX_AUTHORIZATION' })).data;
    await f.send({ type: 'DISCONNECT_XBOX', keepPendingAuthorization: true });
    const second = (await f.send({ type: 'START_XBOX_AUTHORIZATION' })).data;
    assert.equal(first.authorizationId, second.authorizationId);
    assert.equal(f.tabs.length, 1);
    await f.send({ type: 'DISCONNECT_XBOX' });
    assert.equal(f.state(), null);
    for (const participant of [first, second]) {
        const response = await f.send({ type: 'POLL_XBOX_AUTHORIZATION',
            authorizationId: participant.authorizationId, requestId: participant.requestId });
        assert.equal(response.error, 'XBOX_AUTH_REQUIRED');
    }
    const next = (await f.send({ type: 'START_XBOX_AUTHORIZATION' })).data;
    assert.notEqual(next.authorizationId, first.authorizationId);
    assert.equal(f.tabs.length, 2);
});

test('Xbox: preparing a connection clears saved tokens and cached credentials', async () => {
    const f = backgroundFixture({ state: tokenState() });
    await f.send({ type: 'FETCH_XBOX_ACCOUNT' });
    await f.send({ type: 'DISCONNECT_XBOX', keepPendingAuthorization: true });
    assert.equal(f.state(), null);
    assert.equal((await f.send({ type: 'FETCH_XBOX_ACCOUNT' })).error, 'XBOX_AUTH_REQUIRED');
});

test('Xbox: private tabs cannot read, authorize, import or delete the normal profile grant', async () => {
    const f = backgroundFixture({ state: tokenState() });
    for (const message of [
        { type: 'FETCH_XBOX_ACCOUNT' }, { type: 'START_XBOX_AUTHORIZATION' },
        { type: 'FETCH_XBOX_COLLECTION_PAGE', accountId, currentPage: 1 }, { type: 'DISCONNECT_XBOX' }
    ]) {
        const response = await f.send(message, 'https://gg.deals/collection/', true);
        assert.deepEqual(clone(response), { ok: false, error: 'XBOX_INCOGNITO_UNSUPPORTED' });
    }
    assert.equal(f.events.length, 0);
    assert.equal(f.browserChecks.length, 0);
    assert.equal(f.tabs.length, 0);
    assert.equal(f.state().refreshToken, 'SECRET_REFRESH');
    assert.equal((await f.send({ type: 'FETCH_XBOX_ACCOUNT' })).ok, true);
});

test('Xbox: a different server link cannot obtain the previous stored account from the background', async () => {
    const f = backgroundFixture({ state: tokenState() });
    const response = await f.send({ type: 'FETCH_XBOX_ACCOUNT', expectedAccountId: '2533274790000002' });
    assert.deepEqual(clone(response), { ok: false, error: 'XBOX_AUTH_REQUIRED' });
    assert.equal((await f.send({ type: 'FETCH_XBOX_ACCOUNT', expectedAccountId: accountId })).ok, true);
    for (const expectedAccountId of ['', 'bad', 123]) {
        assert.equal((await f.send({ type: 'FETCH_XBOX_ACCOUNT', expectedAccountId })).error, 'Invalid expected Xbox account ID');
    }
});

test('Xbox: an unreadable home session cannot release cached account data even for a matching server link', async () => {
    const f = backgroundFixture({ state: tokenState(), browserError: 'XBOX_BROWSER_SESSION_UNAVAILABLE' });
    for (const message of [
        { type: 'FETCH_XBOX_ACCOUNT' },
        { type: 'FETCH_XBOX_ACCOUNT', expectedAccountId: '2533274790000002' },
        { type: 'FETCH_XBOX_ACCOUNT', expectedAccountId: accountId }
    ]) {
        const response = await f.send(message);
        assert.deepEqual(clone(response), { ok: false, error: 'XBOX_BROWSER_SESSION_UNAVAILABLE' });
        assertNoCredentials(response);
    }
});

test('Xbox: background rejects store content scripts and forged GG.deals origins before reading credentials', async () => {
    const f = backgroundFixture({ state: tokenState() });
    for (const sender of ['https://store.steampowered.com/', 'https://gg.deals.evil.example/', 'http://gg.deals/', 'invalid']) {
        const response = await f.send({ type: 'FETCH_XBOX_ACCOUNT' }, sender);
        assert.equal(response.ok, false);
        assertNoCredentials(response);
    }
    assert.equal(f.events.length, 0);
    assert.equal(f.browserChecks.length, 0);
});

test('Xbox: a browser account switch is detected even while the extension token and Xbox credentials are cached', async () => {
    let browserAccount = { accountId, username: 'Player' };
    const f = backgroundFixture({ state: tokenState(), browserAccount: () => browserAccount });
    const first = await f.send({ type: 'FETCH_XBOX_ACCOUNT' });
    browserAccount = { accountId: '2533274790000002', username: 'Other player' };
    const second = await f.send({ type: 'FETCH_XBOX_ACCOUNT' });
    assert.equal(first.data.accountId, accountId);
    assert.equal(second.data.accountId, accountId);
    assert.deepEqual(clone(second.data.browserAccount), browserAccount);
    assert.equal(f.browserChecks.length, 2);
    assert.equal(f.events.filter((event) => event.url?.hostname === 'user.auth.xboxlive.com').length, 1);
    assert.equal(f.state().accessToken, 'SECRET_ACCESS');
    assert.equal(f.state().xuid, accountId);
    assert.equal(Object.hasOwn(f.state(), 'browserAccount'), false);
    assertNoCredentials(second);
});

test('Xbox: a failed browser-session check cannot release the credential queue while Xbox authorization is still running', async () => {
    const gate = deferred();
    const authorizing = deferred();
    const f = backgroundFixture({ state: tokenState(), browserError: 'XBOX_BROWSER_SESSION_UNAVAILABLE',
        handle: async ({ url }) => {
            if (url.hostname === 'user.auth.xboxlive.com') { authorizing.resolve(); await gate.promise; }
        } });
    const account = f.send({ type: 'FETCH_XBOX_ACCOUNT' });
    await authorizing.promise;
    let disconnected = false;
    const disconnect = f.send({ type: 'DISCONNECT_XBOX' }).then((result) => { disconnected = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const completedBeforeAuthorization = disconnected;
    gate.resolve();
    const accountResult = await account;
    assert.equal(accountResult.ok, false);
    assert.equal(accountResult.error, 'XBOX_BROWSER_SESSION_UNAVAILABLE');
    assert.equal(Object.hasOwn(accountResult, 'data'), false);
    assertNoCredentials(accountResult);
    assert.equal((await disconnect).ok, true);
    assert.equal(completedBeforeAuthorization, false);
    assert.equal(f.state(), null);
});

test('Xbox: runtime responses never contain tokens and authorization only opens a Microsoft tab', async () => {
    const f = backgroundFixture();
    assert.equal((await f.send({ type: 'FETCH_XBOX_ACCOUNT' })).error, 'XBOX_AUTH_REQUIRED');
    const start = await f.send({ type: 'START_XBOX_AUTHORIZATION' });
    assertNoCredentials(start);
    assert.equal(f.tabs.length, 1);
    assert.equal(new URL(f.tabs[0].url).hostname, 'microsoft.com');
    f.advance(5000);
    const account = await f.send({ type: 'POLL_XBOX_AUTHORIZATION', authorizationId: start.data.authorizationId, requestId: start.data.requestId });
    assertNoCredentials(account);
    const page = await f.send({ type: 'FETCH_XBOX_COLLECTION_PAGE', accountId, currentPage: 1 });
    assertNoCredentials(page);
    assert.equal(page.data.items.length, 1);
    assert.deepEqual(f.progress, [{ currentPage: 1, totalPages: 1 }]);
    f.advance(3600000);
    assert.equal((await f.send({ type: 'FETCH_XBOX_ACCOUNT' })).ok, true);
    assert.deepEqual(clone(f.tabs), [{ url: start.data.verificationUrl, active: true }]);
});

test('Xbox: background reports an unknown page count until the final collection page', async () => {
    let page = 0;
    const f = backgroundFixture({ state: tokenState(), handle: ({ url }) => url.hostname === 'collections.mp.microsoft.com'
        ? json({ items: [item], ...(page++ === 0 ? { continuationToken: 'next' } : {}) }) : undefined });
    await f.send({ type: 'FETCH_XBOX_COLLECTION_PAGE', accountId, currentPage: 1 });
    await f.send({ type: 'FETCH_XBOX_COLLECTION_PAGE', accountId, currentPage: 2, continuationToken: 'next' });
    assert.deepEqual(f.progress, [{ currentPage: 1, totalPages: null }, { currentPage: 2, totalPages: 2 }]);
});

test('Xbox: concurrent tabs share a serialized token refresh', async () => {
    const f = backgroundFixture({ state: tokenState({ accessExpiresAt: 1 }) });
    const accounts = await Promise.all([f.send({ type: 'FETCH_XBOX_ACCOUNT' }), f.send({ type: 'FETCH_XBOX_ACCOUNT' })]);
    assert.equal(accounts.every((reply) => reply.ok), true);
    assertNoCredentials(accounts);
    assert.equal(f.events.filter((event) => event.url?.href === 'https://login.live.com/oauth20_token.srf').length, 1);
    assert.equal(f.tabs.length, 0);
    await f.send({ type: 'DISCONNECT_XBOX' });
    assert.equal(f.state(), null);
});

function contentFixture(options = {}) {
    const events = [];
    const prompts = [];
    const consentPrompts = [];
    const statusRequests = [];
    const openedUrls = [];
    let connection;
    let page = 0;
    let now = initialTime;
    let importAttempts = 0;
    let authorizedAccount = { accountId, username: 'Player' };
    const helpers = {
        toErrorMessage: (error) => error.message,
        isSyncCanceledError: (error) => error.message.includes('Sync canceled:'),
        readServerErrorCode: (error) => error?.serverCode ?? error?.code ?? null,
        callSwal: async (input) => { events.push('login'); prompts.push(input); return options.loginConfirmed !== false; },
        requestUserIdConsentViaPageSwal: async (serviceName, accountLabel) => {
            events.push('consent');
            consentPrompts.push({ serviceName, accountLabel });
            return options.consent !== false;
        },
        sendMessageToServer: async (url, payload) => {
            if (url.endsWith('/xboxConnection/')) {
                statusRequests.push({ url, payload: clone(payload) });
                if (options.statusError) throw options.statusError;
                return options.statusResponse ?? { success: true, data: connection };
            }
            events.push({ url, payload: clone(payload) });
            if (url.endsWith('/connect') && options.connectError) throw new Error(options.connectError);
            if (!url.endsWith('/connect') && (importAttempts++ === 0 || options.repeatImportError) && options.importError) {
                throw options.importError instanceof Error ? options.importError : new Error(options.importError);
            }
            await options.onPost?.(url, clone(payload));
        },
        sendRuntimeMessage: async (message) => {
            events.push(message.type);
            if (message.type === 'OPEN_URL_IN_NEW_TAB') { openedUrls.push(message.url); return { ok: true }; }
            if (options.runtime) return options.runtime(message);
            if (message.type === 'DISCONNECT_XBOX') { authorizedAccount = null; return { ok: true }; }
            if (message.type === 'FETCH_XBOX_ACCOUNT') return authorizedAccount
                ? { ok: true, data: { ...authorizedAccount, browserAccount: options.browserAccount ? clone(options.browserAccount) : null } }
                : { ok: false, error: 'XBOX_AUTH_REQUIRED' };
            if (message.type === 'START_XBOX_AUTHORIZATION') return { ok: true, data: {
                authorizationId: 'test-switch', requestId: 'test-switch-request', retryAfter: 1000, expiresAt: now + 60000
            } };
            if (message.type === 'POLL_XBOX_AUTHORIZATION') {
                authorizedAccount = options.authorizedAccount ?? { accountId, username: 'Player' };
                return { ok: true, data: authorizedAccount };
            }
            if (message.type === 'CANCEL_XBOX_AUTHORIZATION') return { ok: true };
            assert.equal(message.type, 'FETCH_XBOX_COLLECTION_PAGE');
            if (!message.continuationToken) page = 0;
            if (options.pageError && page > 0) return { ok: false, error: 'HTTP 503' };
            if (options.advance) now += options.advance;
            const pageIndex = page++;
            const pages = options.collections?.[message.accountId] ?? options.pages;
            return { ok: true, data: { accountId: options.mismatch && pageIndex > 0 ? '999' : message.accountId,
                username: 'Player', items: pages ? pages[pageIndex] : options.empty ? [] : [{ ...item, skuId: String(pageIndex) }],
                continuationToken: options.repeat ? 'loop' : page < (pages?.length ?? 2) ? `page-${page}` : null } };
        }
    };
    const constants = { EXTENSION_VERSION: 'test', XBOX_COLLECTION_TIMEOUT_MS: 600000, XBOX_SIGNIN_URL: 'https://www.xbox.com/' };
    const location = { origin: 'https://gg.deals', href: 'https://gg.deals/collection/' };
    const sync = load('../src/integrations/xbox/index.ts', (name) => {
        if (name.endsWith('sync-constants')) return constants;
        if (name.endsWith('sync-helpers')) return helpers;
        if (name.endsWith('sync-error-messages')) return load('../src/utils/sync-error-messages.ts', () => ({}));
        if (name.endsWith('sync-account')) return load('../src/utils/sync-account.ts', (dependency) =>
            dependency.endsWith('sync-constants') ? constants : helpers);
        throw new Error(`Unexpected import ${name}`);
    }, { window: { location }, Date: { now: () => now }, setTimeout: (callback) => setTimeout(callback, 0) });
    return { events, prompts, consentPrompts, statusRequests, openedUrls,
        run: (name = '', id = '', connectUrl = null, syncOptions = {}) => {
            connection = options.connection ?? { connected: true, accountId: id || '999', username: name || 'Configured player' };
            return sync.syncCollectionByImportUrl('/extensionImport/xboxCollection/', name, connectUrl, id,
                { connectionStatusUrl: '/extensionImport/xboxConnection/', ...syncOptions });
        },
        connect: (url = '/connect', name = '', id = '', syncOptions = {}) =>
            sync.connectAccountByUrl(url, name, id, syncOptions)
    };
}

test('Xbox: two disconnected collection views finish through one shared sign-in and each send a complete import', async () => {
    const background = backgroundFixture();
    const firstStarted = deferred();
    const bothStarted = deferred();
    const starts = [];
    const runtime = async message => {
        if (message.type === 'POLL_XBOX_AUTHORIZATION') {
            await bothStarted.promise;
            background.advance(5000);
        }
        const response = await background.send(message);
        if (message.type === 'START_XBOX_AUTHORIZATION') {
            starts.push(response.data);
            firstStarted.resolve();
            if (starts.length === 2) bothStarted.resolve();
        }
        return response;
    };
    const first = contentFixture({ connection: { connected: false }, runtime });
    const second = contentFixture({ connection: { connected: false }, runtime });
    const firstSync = first.run('Player', accountId, '/connect');
    await firstStarted.promise;
    const results = await Promise.all([firstSync, second.run('Player', accountId, '/connect')]);
    assert.equal(background.tabs.length, 1);
    assert.equal(starts[0].authorizationId, starts[1].authorizationId);
    assert.notEqual(starts[0].requestId, starts[1].requestId);
    assert.equal(results.every(account => account.accountId === accountId), true);
    for (const f of [first, second]) {
        const imports = f.events.filter(event => typeof event === 'object' && event.payload.complete);
        assert.equal(imports.length, 1);
        assert.equal(imports[0].payload.accountId, accountId);
        assert.equal(imports[0].payload.totalItems, 1);
    }
    assert.equal(background.state().kind, 'token');
    assert.equal(background.state().authorization, undefined);
});

test('Xbox: cancelling one content-script sync does not cancel a second tab sharing Microsoft sign-in', async () => {
    const background = backgroundFixture();
    const controller = new AbortController();
    const bothStarted = deferred();
    let starts = 0;
    const runtime = async message => {
        if (message.type === 'POLL_XBOX_AUTHORIZATION') {
            await bothStarted.promise;
            background.advance(5000);
        }
        const response = await background.send(message);
        if (message.type === 'START_XBOX_AUTHORIZATION' && ++starts === 2) {
            controller.abort();
            bothStarted.resolve();
        }
        return response;
    };
    const first = contentFixture({ runtime });
    const second = contentFixture({ runtime });
    const results = await Promise.allSettled([
        first.run('Player', accountId, '/connect', { signal: controller.signal }),
        second.run('Player', accountId, '/connect')
    ]);
    assert.equal(results[0].status, 'rejected');
    assert.match(results[0].reason.message, /Sync canceled:/);
    assert.equal(results[1].status, 'fulfilled');
    assert.equal(results[1].value.accountId, accountId);
    assert.equal(first.events.some(event => typeof event === 'object'), false);
    assert.equal(second.events.filter(event => typeof event === 'object' && event.payload.complete).length, 1);
    assert.equal(background.state().kind, 'token');
    assert.equal(background.tabs.length, 1);
});

test('Xbox: changing the GG.deals link requires fresh Microsoft authorization even if Xbox.com stayed signed in', async () => {
    const secondAccount = { accountId: '2533274790000002', username: 'Second player' };
    let approved = false;
    const background = backgroundFixture({ state: tokenState(), handle: ({ url }, { credentials }) => {
        if (approved && ['user.auth.xboxlive.com', 'xsts.auth.xboxlive.com'].includes(url.hostname)) {
            return json(credentials('SECRET_NEW_ACCOUNT', { xid: secondAccount.accountId, gtg: secondAccount.username }));
        }
    } });
    const f = contentFixture({ runtime: message => {
        if (message.type === 'POLL_XBOX_AUTHORIZATION') {
            assert.equal(f.events.some(event => typeof event === 'object'), false);
            approved = true;
            background.advance(5000);
        }
        return background.send(message);
    } });
    await f.run(secondAccount.username, secondAccount.accountId, '/connect');
    assert.equal(f.prompts.length, 1);
    assert.equal(f.prompts[0].confirmButtonText, 'Sign in to Xbox');
    assert.equal(f.consentPrompts.length, 0);
    const posts = f.events.filter(event => typeof event === 'object');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].payload.accountId, secondAccount.accountId);
    assert.equal(background.state().xuid, secondAccount.accountId);
});

test('Xbox: refreshing through the Origin retry finishes sync without prompting for another Microsoft sign-in', async () => {
    const background = backgroundFixture({ state: tokenState({ accessExpiresAt: 1 }), handle: ({ url, config }) => {
        if (url.href === 'https://login.live.com/oauth20_token.srf' && config.headers.Origin !== '') return originRejection();
    } });
    const f = contentFixture({ runtime: message => background.send(message) });
    await f.run('Player', accountId, '/connect');
    assert.equal(f.prompts.length, 0);
    assert.equal(f.consentPrompts.length, 0);
    assert.equal(background.tabs.length, 0);
    const imports = f.events.filter(event => typeof event === 'object' && event.payload.complete);
    assert.equal(imports.length, 1);
    assert.equal(imports[0].payload.accountId, accountId);
    assert.equal(background.state().refreshToken, 'SECRET_REFRESH_ROTATED');
});

test('Xbox: declining reauthorization after a GG.deals account change exposes no stored account and imports nothing', async () => {
    const background = backgroundFixture({ state: tokenState() });
    const f = contentFixture({ runtime: message => background.send(message), loginConfirmed: false });
    await assert.rejects(f.run('Second player', '2533274790000002', '/connect'), /Sync canceled:/);
    assert.deepEqual(f.events, ['FETCH_XBOX_ACCOUNT', 'login']);
    assert.equal(f.consentPrompts.length, 0);
    assert.equal(JSON.stringify(f.prompts).includes(accountId), false);
    assert.equal(background.tabs.length, 0);
});

test('Xbox: a browser-account switch confirms the account and the Microsoft sign-in before saving, authorization and fetching', async () => {
    const otherAccount = { accountId: '2533274790000002', username: '<Other player>' };
    const f = contentFixture({ browserAccount: otherAccount, authorizedAccount: otherAccount });
    await f.run('Player', accountId, '/connect');
    assert.deepEqual(f.events.slice(0, 7), ['FETCH_XBOX_ACCOUNT', 'consent', 'login', {
            url: 'https://gg.deals/connect', payload: { version: 'test', ...otherAccount, overwrite: true }
        }, 'START_XBOX_AUTHORIZATION', 'POLL_XBOX_AUTHORIZATION', 'CANCEL_XBOX_AUTHORIZATION']);
    assert.deepEqual(clone(f.consentPrompts), [{ serviceName: 'Xbox',
        accountLabel: `&lt;Other player&gt; (ID: ${otherAccount.accountId})` }]);
    assert.equal(f.prompts.length, 1);
    assert.equal(f.prompts[0].confirmButtonText, 'Sign in to Xbox');
    const posts = f.events.filter((event) => typeof event === 'object');
    assert.equal(posts.length, 2);
    assert.equal(posts[1].payload.accountId, otherAccount.accountId);
    assert.equal(Object.hasOwn(posts[1].payload, 'browserAccount'), false);
    assertNoCredentials(posts);
});

test('Xbox: home session switches A to B and back to A replace the grant/cache and import only the confirmed account', async () => {
    const first = { accountId, username: 'Player A' };
    const second = { accountId: '2533274790000002', username: 'Player B' };
    let browserAccount = first;
    const background = backgroundFixture({
        state: tokenState({ accessToken: `SECRET_ACCESS_${first.accountId}` }),
        browserAccount: () => fetchXboxBrowserAccount(async () => profileResponse({ user: { isSignedIn: true,
            userInfo: { xuid: browserAccount.accountId, gamerTag: browserAccount.username } } })),
        handle: ({ url, body }, { credentials }) => {
            if (url.href === 'https://login.live.com/oauth20_token.srf') return json({
                access_token: `SECRET_ACCESS_${browserAccount.accountId}`,
                refresh_token: `SECRET_REFRESH_${browserAccount.accountId}`, expires_in: 3600
            });
            if (url.hostname === 'user.auth.xboxlive.com') {
                assert.equal(body.Properties.RpsTicket, `d=SECRET_ACCESS_${browserAccount.accountId}`);
                return json(credentials('SECRET_USER', { xid: browserAccount.accountId, gtg: browserAccount.username }));
            }
            if (url.hostname === 'xsts.auth.xboxlive.com') return json(credentials('SECRET_XSTS', {
                xid: browserAccount.accountId, gtg: browserAccount.username
            }));
        }
    });
    let uuid = 0;
    background.dependencies.randomUUID = () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`;
    const f = contentFixture({ runtime: (message) => {
        if (message.type === 'POLL_XBOX_AUTHORIZATION') background.advance(5000);
        return background.send(message);
    } });

    await f.run(first.username, first.accountId, '/connect');
    browserAccount = second;
    await f.run(first.username, first.accountId, '/connect');
    assert.equal(background.state().xuid, second.accountId);
    assert.equal(background.state().refreshToken, `SECRET_REFRESH_${second.accountId}`);
    browserAccount = first;
    await f.run(second.username, second.accountId, '/connect');
    assert.equal(background.state().xuid, first.accountId);
    assert.equal(background.state().refreshToken, `SECRET_REFRESH_${first.accountId}`);

    assert.deepEqual(f.consentPrompts.map(({ accountLabel }) => accountLabel), [
        `${second.username} (ID: ${second.accountId})`, `${first.username} (ID: ${first.accountId})`
    ]);
    const posts = f.events.filter((event) => typeof event === 'object');
    assert.deepEqual(posts.filter(({ url }) => url.endsWith('/connect')).map(({ payload }) => payload.accountId),
        [second.accountId, first.accountId]);
    assert.deepEqual(posts.filter(({ url }) => url.includes('/extensionImport/')).map(({ payload }) => payload.accountId),
        [first.accountId, second.accountId, first.accountId]);
    assert.deepEqual(background.events.filter((event) => event.url?.hostname === 'collections.mp.microsoft.com')
        .map(({ body }) => body.beneficiaries[0].identityValue), [first.accountId, second.accountId, first.accountId]);
    assert.equal(background.tabs.length, 2);
    assert.equal(background.tabs.every(({ url, active }) => new URL(url).hostname === 'microsoft.com' && active), true);
    assertNoCredentials(posts);
});

test('Xbox: rejecting the browser-account switch leaves the existing grant alone and sends no account or collection data', async () => {
    const background = backgroundFixture({ state: tokenState(),
        browserAccount: { accountId: '2533274790000002', username: 'Other player' } });
    const f = contentFixture({ runtime: (message) => background.send(message), consent: false });
    await assert.rejects(f.run('Player', accountId, '/connect'), /Sync canceled:/);
    assert.deepEqual(f.events, ['FETCH_XBOX_ACCOUNT', 'consent']);
    assert.equal(background.state().accessToken, 'SECRET_ACCESS');
    assert.equal(background.state().xuid, accountId);
});

test('Xbox: browser and token accounts are compared by XUID rather than gamertag', async () => {
    const sameId = contentFixture({ browserAccount: { accountId, username: 'Renamed player' } });
    await sameId.run('Player', accountId);
    assert.equal(sameId.events.includes('login'), false);
    assert.equal(sameId.events.includes('consent'), false);
    const otherId = contentFixture({ browserAccount: { accountId: '2533274790000002', username: 'Player' }, consent: false });
    await assert.rejects(otherId.run('Player', accountId), /Sync canceled:/);
    assert.deepEqual(otherId.events, ['FETCH_XBOX_ACCOUNT', 'consent']);
});

test('Xbox: authenticating a different account than the detected Xbox.com session cannot import the old collection', async () => {
    const f = contentFixture({ browserAccount: { accountId: '2533274790000002', username: 'Other player' } });
    await assert.rejects(f.run('Player', accountId, '/connect'), { message: 'XBOX_BROWSER_ACCOUNT_MISMATCH' });
    assert.deepEqual(f.events, ['FETCH_XBOX_ACCOUNT', 'consent', 'login', { url: 'https://gg.deals/connect',
        payload: { version: 'test', accountId: '2533274790000002', username: 'Other player', overwrite: true } }, 'START_XBOX_AUTHORIZATION',
        'POLL_XBOX_AUTHORIZATION', 'CANCEL_XBOX_AUTHORIZATION']);
});

test('Xbox: a matching tile account renews a grant for the browser XUID without account consent or reconnect', async () => {
    const otherAccount = { accountId: '2533274790000002', username: 'Other player' };
    const f = contentFixture({ browserAccount: otherAccount, authorizedAccount: otherAccount });
    await f.run(otherAccount.username, otherAccount.accountId, '/connect');
    assert.deepEqual(f.events.slice(0, 5), ['FETCH_XBOX_ACCOUNT', 'login', 'START_XBOX_AUTHORIZATION',
        'POLL_XBOX_AUTHORIZATION', 'CANCEL_XBOX_AUTHORIZATION']);
    assert.equal(f.consentPrompts.length, 0);
    assert.equal(f.prompts.length, 1);
    const posts = f.events.filter((event) => typeof event === 'object');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].payload.accountId, otherAccount.accountId);
});

test('Xbox: authorization can refresh a confirmed gamertag without confirming the same XUID again', async () => {
    const browserAccount = { accountId: '2533274790000002', username: 'Other player' };
    const authorizedAccount = { ...browserAccount, username: 'Renamed player' };
    const f = contentFixture({ browserAccount, authorizedAccount });
    await f.run('Player', accountId, '/connect');
    assert.equal(f.consentPrompts.length, 1);
    assert.equal(f.prompts.length, 1);
    const posts = f.events.filter((event) => typeof event === 'object');
    assert.equal(posts.length, 2);
    assert.equal(posts[0].payload.username, browserAccount.username);
    assert.equal(posts[1].payload.username, authorizedAccount.username);
});

test('Xbox: the accepted account is saved for settings while Microsoft sign-in is still pending', async () => {
    const otherAccount = { accountId: '2533274790000002', username: 'Other player' };
    let savedAccount = { accountId, username: 'Player' };
    const authorizing = deferred();
    const signedIn = deferred();
    const f = contentFixture({ onPost: async (url, payload) => {
        if (url.endsWith('/connect')) savedAccount = { accountId: payload.accountId, username: payload.username };
    }, runtime: async ({ type }) => {
        if (type === 'FETCH_XBOX_ACCOUNT') return { ok: true, data: { accountId, username: 'Player', browserAccount: otherAccount } };
        if (type === 'START_XBOX_AUTHORIZATION') return { ok: true, data: {
            authorizationId: 'pending-switch', requestId: 'pending-switch-request', retryAfter: 1000, expiresAt: initialTime + 60000
        } };
        if (type === 'POLL_XBOX_AUTHORIZATION') {
            authorizing.resolve();
            await signedIn.promise;
            return { ok: true, data: otherAccount };
        }
        if (type === 'CANCEL_XBOX_AUTHORIZATION') return { ok: true };
        if (type === 'FETCH_XBOX_COLLECTION_PAGE') return { ok: true, data: { ...otherAccount, items: [item], continuationToken: null } };
        throw new Error(`Unexpected request: ${type}`);
    } });
    const sync = f.run('Player', accountId, '/connect');
    await authorizing.promise;
    const settingsWhileSigningIn = clone(savedAccount);
    const fetchedBeforeSignIn = f.events.includes('FETCH_XBOX_COLLECTION_PAGE');
    signedIn.resolve();
    await sync;
    assert.deepEqual(settingsWhileSigningIn, otherAccount);
    assert.equal(fetchedBeforeSignIn, false);
    assert.equal(f.events.filter((event) => typeof event === 'object' && event.url.endsWith('/connect')).length, 1);
    assert.equal(f.consentPrompts.length, 1);
});

test('Xbox: declining the Microsoft sign-in after an account switch saves nothing', async () => {
    const otherAccount = { accountId: '2533274790000002', username: 'Other player' };
    const f = contentFixture({ browserAccount: otherAccount, authorizedAccount: otherAccount, loginConfirmed: false });
    await assert.rejects(f.run('Player', accountId, '/connect'), /Sync canceled:/);
    assert.deepEqual(f.events, ['FETCH_XBOX_ACCOUNT', 'consent', 'login']);
});

test('Xbox: a failed account save stops Microsoft authorization and collection fetching', async () => {
    const otherAccount = { accountId: '2533274790000002', username: 'Other player' };
    const f = contentFixture({ browserAccount: otherAccount, authorizedAccount: otherAccount, connectError: 'HTTP 500' });
    await assert.rejects(f.run('Player', accountId, '/connect'), /HTTP 500/);
    assert.deepEqual(f.events, ['FETCH_XBOX_ACCOUNT', 'consent', 'login', { url: 'https://gg.deals/connect',
        payload: { version: 'test', ...otherAccount, overwrite: true } }]);
});

test('Xbox: the home sign-in/logout/sign-in cycle blocks collection requests only while signed out', async () => {
    let user = { isSignedIn: true, userInfo: { xuid: accountId, gamerTag: 'Player' } };
    const background = backgroundFixture({ state: tokenState(), browserAccount: () =>
        fetchXboxBrowserAccount(async () => profileResponse({ user })) });
    const f = contentFixture({ runtime: message => background.send(message) });
    await f.run('Player', accountId);
    const requestsBeforeLogout = background.events.filter(event => event.url?.hostname === 'collections.mp.microsoft.com').length;
    assert.equal(requestsBeforeLogout, 1);
    f.events.length = 0;
    user = { isSignedIn: false, userAgeGatingInfo: { type: 0 }, contactPreferences: { type: 0 },
        familyInfo: { type: 0 }, isDefaultUserAgeGatingInfo: false };
    await assert.rejects(f.run('Player', accountId), /Sync canceled: Xbox\.com sign-in required/);
    assert.deepEqual(f.events, ['FETCH_XBOX_ACCOUNT', 'login', 'OPEN_URL_IN_NEW_TAB']);
    assert.equal(f.prompts[0].confirmButtonText, 'Open Xbox.com');
    assert.deepEqual(f.openedUrls, ['https://www.xbox.com/']);
    assert.equal(f.consentPrompts.length, 0);
    assert.equal(background.tabs.length, 0);
    assert.equal(background.events.filter(event => event.url?.hostname === 'collections.mp.microsoft.com').length, requestsBeforeLogout);
    assert.equal(background.state().refreshToken, 'SECRET_REFRESH');
    user = { isSignedIn: true, userInfo: { xuid: accountId, gamerTag: 'Player' } };
    await f.run('Player', accountId);
    assert.equal(f.events.includes('START_XBOX_AUTHORIZATION'), false);
    const posts = f.events.filter(event => typeof event === 'object');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].payload.accountId, accountId);
    assert.equal(background.browserChecks.length, 3);
    assert.equal(background.events.filter(event => event.url?.hostname === 'collections.mp.microsoft.com').length, requestsBeforeLogout + 1);
    assertNoCredentials(posts);
});

for (const signedInAfterOpening of [false, true]) {
    test(`Xbox: after Microsoft authorization, opening Xbox.com ${signedInAfterOpening ? 'allows reuse only after the home session signs in' : 'cannot bypass a signed-out home session on repeated clicks'}`, async () => {
        let signedIn = false;
        const background = backgroundFixture({ browserAccount: () => fetchXboxBrowserAccount(async () =>
            profileResponse({ user: signedIn ? { isSignedIn: true, userInfo: { xuid: accountId, gamerTag: 'Player' } }
                : { isSignedIn: false } })) });
        const f = contentFixture({ runtime: message => {
            if (message.type === 'POLL_XBOX_AUTHORIZATION') background.advance(5000);
            return background.send(message);
        } });
        const imported = () => f.events.filter(event => typeof event === 'object' && event.payload.complete).length;
        // A fresh Microsoft sign-in can authorize this sync independently of
        // Xbox.com's cookies. It does not make later session checks optional.
        await f.run('Player', accountId, '/connect');
        assert.equal(imported(), 1);
        assert.equal(background.state().refreshToken, 'SECRET_REFRESH_ROTATED');
        await assert.rejects(f.run('Player', accountId, '/connect'), /Sync canceled: Xbox\.com sign-in required/);
        assert.deepEqual(f.openedUrls, ['https://www.xbox.com/']);
        signedIn = signedInAfterOpening;
        for (let attempt = 0; attempt < 3; attempt++) {
            const sync = f.run('Player', accountId, '/connect');
            if (signedInAfterOpening) await sync;
            else await assert.rejects(sync, /Sync canceled: Xbox\.com sign-in required/);
            assert.equal(imported(), signedInAfterOpening ? attempt + 2 : 1);
        }
        assert.equal(background.browserChecks.length, 5);
        assert.equal(f.events.filter(event => event === 'START_XBOX_AUTHORIZATION').length, 1);
        assert.equal(background.events.filter(event => event.url?.hostname === 'collections.mp.microsoft.com').length, imported());
        assert.equal(background.state().refreshToken, 'SECRET_REFRESH_ROTATED');
        assertNoCredentials(f.events);
    });
}

test('Xbox: an unreadable session keeps a usable grant and stops before authorization or collection fetching', async () => {
    const background = backgroundFixture({ state: tokenState(), browserError: 'XBOX_BROWSER_SESSION_UNAVAILABLE' });
    const f = contentFixture({ runtime: message => background.send(message) });
    await assert.rejects(f.run('Player', accountId, '/connect'), /Sync canceled: Xbox.com session could not be verified/);
    assert.deepEqual(f.events, ['FETCH_XBOX_ACCOUNT', 'login', 'OPEN_URL_IN_NEW_TAB']);
    assert.equal(f.prompts.length, 1);
    assert.equal(f.prompts[0].confirmButtonText, 'Open Xbox.com');
    assert.match(f.prompts[0].html, /Could not verify your Xbox.com session/);
    assert.equal(f.consentPrompts.length, 0);
    assert.deepEqual(f.openedUrls, ['https://www.xbox.com/']);
    assert.equal(background.tabs.length, 0);
    assert.equal(background.events.some(event => event.url?.hostname === 'collections.mp.microsoft.com'), false);
    assert.equal(background.state().refreshToken, 'SECRET_REFRESH');
});

for (const expectedAccountId of [accountId, '2533274790000002']) {
    test(`Xbox: declining session recovery imports nothing (${expectedAccountId === accountId ? 'matching' : 'different'} server link)`, async () => {
        const background = backgroundFixture({ state: tokenState(), browserError: 'XBOX_BROWSER_SESSION_UNAVAILABLE' });
        const f = contentFixture({ runtime: message => background.send(message), loginConfirmed: false });
        await assert.rejects(f.run('Server account', expectedAccountId, '/connect'), /Sync canceled:/);
        assert.deepEqual(f.events, ['FETCH_XBOX_ACCOUNT', 'login']);
        assert.equal(f.prompts[0].confirmButtonText, 'Open Xbox.com');
        assert.equal(f.consentPrompts.length, 0);
        assert.equal(JSON.stringify(f.prompts).includes(accountId), false);
        assert.equal(background.tabs.length, 0);
        assert.equal(background.state().refreshToken, 'SECRET_REFRESH');
        assert.equal(background.events.some(event => event.url?.hostname === 'collections.mp.microsoft.com'), false);
    });
}

test('Xbox: repeated syncs with a readable matching home session do not request Microsoft sign-in', async () => {
    const background = backgroundFixture({ state: tokenState(), browserAccount: () => fetchXboxBrowserAccount(async () =>
        profileResponse({ user: { isSignedIn: true, userInfo: { xuid: accountId, gamerTag: 'Player' } } })) });
    const f = contentFixture({ runtime: message => background.send(message) });
    await f.run('Player', accountId, '/connect');
    await f.run('Player', accountId, '/connect');
    assert.equal(f.statusRequests.length, 2);
    assert.equal(f.events.filter(event => event === 'FETCH_XBOX_ACCOUNT').length, 2);
    assert.equal(f.events.includes('START_XBOX_AUTHORIZATION'), false);
    assert.equal(f.prompts.length, 0);
    assert.equal(f.consentPrompts.length, 0);
    assert.equal(f.events.filter(event => typeof event === 'object' && event.payload.complete).length, 2);
    assert.equal(f.openedUrls.length, 0);
});

test('Xbox: signing in once restores a readable home session and subsequent matching syncs need no prompt', async () => {
    let signedIn = false;
    const background = backgroundFixture({ browserAccount: () => fetchXboxBrowserAccount(async () =>
        profileResponse({ user: { isSignedIn: signedIn, ...(signedIn ? { userInfo: { xuid: accountId, gamerTag: 'Player' } } : {}) } })) });
    const f = contentFixture({ runtime: message => {
        if (message.type === 'POLL_XBOX_AUTHORIZATION') { signedIn = true; background.advance(5000); }
        return background.send(message);
    } });
    await f.run('Player', accountId, '/connect');
    await f.run('Player', accountId, '/connect');
    assert.equal(f.prompts.length, 1);
    assert.equal(f.events.filter(event => event === 'START_XBOX_AUTHORIZATION').length, 1);
    assert.equal(f.events.filter(event => event === 'POLL_XBOX_AUTHORIZATION').length, 1);
    assert.equal(f.statusRequests.length, 2);
    assert.equal(f.events.filter(event => typeof event === 'object' && event.payload.complete).length, 2);
    assert.equal(background.tabs.length, 1);
});

test('Xbox: successful Microsoft authorization with an unreadable home session does not start another authorization on retry', async () => {
    const background = backgroundFixture({ browserError: 'XBOX_BROWSER_SESSION_UNAVAILABLE' });
    const f = contentFixture({ runtime: message => {
        if (message.type === 'POLL_XBOX_AUTHORIZATION') background.advance(5000);
        return background.send(message);
    } });
    // No initial grant: Microsoft signs in to the already-linked account.
    await f.run('Player', accountId, '/connect');
    assert.equal(background.state().xuid, accountId);
    assert.equal(f.consentPrompts.length, 0);
    assert.equal(f.events.filter(event => typeof event === 'object' && event.payload.complete).length, 1);
    // The same HTML failure persists after success. Do not discard or replace
    // the new grant with another device code, or import without a session check.
    const retryError = await f.run('Player', accountId, '/connect').then(() => null, error => error);
    assert.equal(f.events.filter(event => event === 'START_XBOX_AUTHORIZATION').length, 1);
    assert.match(retryError?.message ?? '', /Sync canceled: Xbox.com session could not be verified/);
    assert.deepEqual(f.prompts.map(prompt => prompt.confirmButtonText), ['Sign in to Xbox', 'Open Xbox.com']);
    assert.equal(f.events.filter(event => typeof event === 'object' && event.payload.complete).length, 1);
    assert.equal(background.tabs.length, 1);
    assert.equal(background.state().refreshToken, 'SECRET_REFRESH_ROTATED');
});

test('Xbox: recovering an unreadable home session reuses the saved grant without Microsoft authorization', async () => {
    let readable = false;
    const background = backgroundFixture({ state: tokenState(), browserAccount: () => fetchXboxBrowserAccount(async () =>
        profileResponse({ user: readable ? { isSignedIn: true, userInfo: { xuid: accountId, gamerTag: 'Player' } } : {} })) });
    const f = contentFixture({ runtime: message => background.send(message) });
    await assert.rejects(f.run('Player', accountId, '/connect'), /Sync canceled: Xbox.com session could not be verified/);
    readable = true;
    await f.run('Player', accountId, '/connect');
    assert.deepEqual(f.prompts.map(prompt => prompt.confirmButtonText), ['Open Xbox.com']);
    assert.equal(f.events.includes('START_XBOX_AUTHORIZATION'), false);
    assert.equal(f.events.filter(event => typeof event === 'object' && event.payload.complete).length, 1);
    assert.equal(background.state().refreshToken, 'SECRET_REFRESH');
});

test('Xbox: a readable session uses the current server XUID rather than stale account attributes on the tile', async () => {
    const background = backgroundFixture({ state: tokenState() });
    const f = contentFixture({ connection: { connected: true, accountId, username: 'Player' },
        runtime: message => background.send(message) });
    await f.run('Stale tile account', '2533274790000002', '/connect');
    assert.equal(f.statusRequests.length, 1);
    assert.equal(f.prompts.length, 0);
    const posts = f.events.filter(event => typeof event === 'object');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].payload.accountId, accountId);
    assert.equal(posts[0].payload.complete, true);
});

test('Xbox: a changed server XUID cannot reuse the tile account when Xbox.com is unreadable', async () => {
    const background = backgroundFixture({ state: tokenState(), browserError: 'XBOX_BROWSER_SESSION_UNAVAILABLE' });
    const f = contentFixture({ connection: { connected: true, accountId: '2533274790000002', username: 'Other account' },
        runtime: message => background.send(message), loginConfirmed: false });
    await assert.rejects(f.run('Player', accountId, '/connect'), /Sync canceled:/);
    assert.deepEqual(f.events, ['FETCH_XBOX_ACCOUNT', 'login']);
    assert.equal(f.consentPrompts.length, 0);
    assert.equal(background.events.some(event => event.url?.hostname === 'collections.mp.microsoft.com'), false);
});

test('Xbox: a remote disconnect clears the token even when the Xbox.com profile is unreadable', async () => {
    const background = backgroundFixture({ state: tokenState(), browserError: 'XBOX_BROWSER_SESSION_UNAVAILABLE' });
    const f = contentFixture({ connection: { connected: false }, runtime: message => background.send(message), loginConfirmed: false });
    await assert.rejects(f.run('Player', accountId, '/connect'), /Sync canceled:/);
    assert.equal(background.state(), null);
    assert.equal(f.prompts[0].confirmButtonText, 'Sign in to Xbox');
    assert.equal(f.events.some(event => typeof event === 'object'), false);
    assert.equal(background.events.some(event => event.url?.hostname === 'collections.mp.microsoft.com'), false);
});

test('Xbox: a failed server link check cannot fall back to the cached token when Xbox.com is unreadable', async () => {
    const background = backgroundFixture({ state: tokenState(), browserError: 'XBOX_BROWSER_SESSION_UNAVAILABLE' });
    const f = contentFixture({ statusError: new Error('HTTP 503'), runtime: message => background.send(message) });
    await assert.rejects(f.run('Player', accountId, '/connect'), /HTTP 503/);
    assert.deepEqual(f.events, []);
    assert.equal(background.events.length, 0);
    assert.equal(background.state().refreshToken, 'SECRET_REFRESH');
});

for (const consent of [true, false]) {
    test(`Xbox: an unreadable session authorizing a different account ${consent ? 'imports only the confirmed account' : 'does not relink without consent'}`, async () => {
        const other = { accountId: '2533274790000002', username: 'Other player' };
        let approved = false;
        const background = backgroundFixture({ browserError: 'XBOX_BROWSER_SESSION_UNAVAILABLE',
            handle: ({ url }, { credentials }) => {
                if (approved && ['user.auth.xboxlive.com', 'xsts.auth.xboxlive.com'].includes(url.hostname)) {
                    return json(credentials('SECRET_NEW_ACCOUNT', { xid: other.accountId, gtg: other.username }));
                }
            } });
        const f = contentFixture({ consent, runtime: message => {
            if (message.type === 'POLL_XBOX_AUTHORIZATION') { approved = true; background.advance(5000); }
            return background.send(message);
        } });
        const run = f.run('Player', accountId, '/connect');
        if (consent) await run;
        else await assert.rejects(run, /Sync canceled:/);
        assert.equal(f.consentPrompts.length, 1);
        assert.deepEqual(clone(f.consentPrompts[0]), { serviceName: 'Xbox', accountLabel: `${other.username} (ID: ${other.accountId})` });
        const posts = f.events.filter(event => typeof event === 'object');
        assert.equal(posts.length, consent ? 2 : 0);
        assert.equal(posts.every(event => event.payload.accountId === other.accountId), true);
        assert.equal(background.events.filter(event => event.url?.hostname === 'collections.mp.microsoft.com').length, consent ? 1 : 0);
    });
}

test('Xbox: signing out of Xbox.com stops the stored grant before its account is shown to another GG.deals link', async () => {
    const background = backgroundFixture({ state: tokenState(), browserAccount: null });
    const f = contentFixture({ runtime: (message) => background.send(message), loginConfirmed: false });
    await assert.rejects(f.run('Other player', '2533274790000002', '/connect'), /Sync canceled:/);
    // A declined prompt opens nothing; no consent shows the grant's gamertag or XUID.
    assert.deepEqual(f.events, ['FETCH_XBOX_ACCOUNT', 'login']);
    assert.equal(f.consentPrompts.length, 0);
    assert.equal(JSON.stringify(f.prompts).includes(accountId), false);
    assert.equal(f.events.some((event) => typeof event === 'object'), false);
    assert.equal(background.state().xuid, accountId);
    assert.equal(background.events.some((event) => event.url?.hostname === 'collections.mp.microsoft.com'), false);
});

test('Xbox: a token refresh with a signed-out Xbox.com session retains the rotated grant without syncing', async () => {
    const background = backgroundFixture({ state: tokenState({ accessExpiresAt: 1 }), browserAccount: null });
    const f = contentFixture({ runtime: (message) => background.send(message), loginConfirmed: false });
    await assert.rejects(f.run('Player', accountId), /Sync canceled: Xbox\.com sign-in required/);
    const refreshes = background.events.filter((event) => event.url?.href === 'https://login.live.com/oauth20_token.srf');
    assert.equal(refreshes.length, 1);
    assert.equal(refreshes[0].body.grant_type, 'refresh_token');
    assert.equal(background.state().refreshToken, 'SECRET_REFRESH_ROTATED');
    assert.equal(f.events.some((event) => typeof event === 'object'), false);
    assert.equal(background.tabs.length, 0);
});

test('Xbox: an invalid grant still requires sign-in when the Xbox.com session check also fails', async () => {
    const background = backgroundFixture({ state: tokenState({ accessExpiresAt: 1 }), browserError: 'XBOX_BROWSER_SESSION_UNAVAILABLE',
        handle: ({ url }) => url.href === 'https://login.live.com/oauth20_token.srf' ? json({ error: 'invalid_grant' }, 400) : undefined });
    const f = contentFixture({ runtime: (message) => background.send(message), loginConfirmed: false });
    await assert.rejects(f.run('Player', accountId), /Sync canceled:/);
    assert.deepEqual(f.events, ['FETCH_XBOX_ACCOUNT', 'login']);
    assert.equal(background.state(), null);
    assert.equal(background.tabs.length, 0);
    assert.equal(background.events.some((event) => event.url?.hostname === 'collections.mp.microsoft.com'), false);
});

test('Xbox: a missing grant still requires Microsoft authorization even when the Xbox.com page is unreadable', async () => {
    const recoveredAccount = { accountId: '2533274790000002', username: 'Recovered player' };
    let approved = false;
    const background = backgroundFixture({ browserError: 'XBOX_BROWSER_SESSION_UNAVAILABLE',
        handle: ({ url }, { credentials }) => {
            if (approved && ['user.auth.xboxlive.com', 'xsts.auth.xboxlive.com'].includes(url.hostname)) {
                return json(credentials('SECRET_FRESH_XBOX_TOKEN', { xid: recoveredAccount.accountId, gtg: recoveredAccount.username }));
            }
        } });
    const f = contentFixture({ runtime: (message) => {
        if (message.type === 'POLL_XBOX_AUTHORIZATION') { approved = true; background.advance(5000); }
        return background.send(message);
    } });
    await f.run('Player', accountId, '/connect');
    assert.deepEqual(f.events.slice(0, 6), ['FETCH_XBOX_ACCOUNT', 'login', 'START_XBOX_AUTHORIZATION',
        'POLL_XBOX_AUTHORIZATION', 'CANCEL_XBOX_AUTHORIZATION', 'consent']);
    assert.equal(background.tabs.length, 1);
    assert.equal(background.browserChecks.length, 1);
    assert.equal(background.state().xuid, recoveredAccount.accountId);
    assert.equal(f.consentPrompts.length, 1);
    const posts = f.events.filter((event) => typeof event === 'object');
    assert.equal(posts.length, 2);
    assert.equal(posts.every((post) => post.payload.accountId === recoveredAccount.accountId), true);
    assertNoCredentials(posts);
});

test('Xbox: unrelated provider failures do not start sign-in recovery', async () => {
    const f = contentFixture({ runtime: async () => ({ ok: false, error: 'Xbox request failed (HTTP 503)' }) });
    await assert.rejects(f.run('Player', accountId), /HTTP 503/);
    assert.deepEqual(f.events, ['FETCH_XBOX_ACCOUNT']);
});

test('Xbox: account-only connection uses shared consent and overwrite rules without fetching a collection', async () => {
    const f = contentFixture();
    await f.connect('/connect', 'Other player', '999');
    assert.deepEqual(f.events.slice(0, 7), ['DISCONNECT_XBOX', 'FETCH_XBOX_ACCOUNT', 'login', 'START_XBOX_AUTHORIZATION',
        'POLL_XBOX_AUTHORIZATION', 'CANCEL_XBOX_AUTHORIZATION', 'consent']);
    assert.deepEqual(f.events[7], { url: 'https://gg.deals/connect',
        payload: { version: 'test', accountId, username: 'Player', overwrite: true } });
    assert.equal(f.events.length, 8);
    assertNoCredentials(f.events[7].payload);
});

test('Xbox: an account-only connection to another origin is rejected before authorization or posting', async () => {
    const f = contentFixture();
    await assert.rejects(f.connect('https://other.example/connect'), /must belong to GG.deals/);
    assert.deepEqual(f.events, []);
});

test('Xbox: all pages are collected before one import, with account metadata and no credentials', async () => {
    const f = contentFixture();
    await f.run();
    assert.deepEqual(f.events.slice(0, 4), ['FETCH_XBOX_ACCOUNT', 'consent', 'FETCH_XBOX_COLLECTION_PAGE', 'FETCH_XBOX_COLLECTION_PAGE']);
    const posts = f.events.filter((event) => typeof event === 'object');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, 'https://gg.deals/extensionImport/xboxCollection/');
    assert.deepEqual(posts[0].payload, { version: 'test', accountId, username: 'Player', complete: true,
        pagesCount: 2, totalItems: 2, data: [{ items: [{ ...item, skuId: '0' }] }, { items: [{ ...item, skuId: '1' }] }] });
    assertNoCredentials(posts[0].payload);
    assert.equal('continuationToken' in posts[0].payload, false);
});

test('Xbox: distinct purchase, Disc2Digital and Games with Gold licenses cross the real background and all pages into one complete POST', async () => {
    const goldLicense = { ...purchasedLicense, skuId: '0018', licensingRequired: true };
    let page = 0;
    const background = backgroundFixture({ state: tokenState(), handle: ({ url, body }) => {
        if (url.hostname !== 'collections.mp.microsoft.com') return;
        assert.equal(body.excludeDuplicates, false);
        return page++ === 0
            ? json({ items: [{ ...discLicense, ...excludedItemMetadata }], continuationToken: 'next-page' })
            : json({ items: [purchasedLicense, goldLicense].map((license) => ({ ...license, ...excludedItemMetadata })) });
    } });
    const f = contentFixture({ runtime: (message) => background.send(message) });
    await f.run('Player', accountId);
    const posts = f.events.filter((event) => typeof event === 'object');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].payload.pagesCount, 2);
    assert.equal(posts[0].payload.totalItems, 3);
    assert.equal(posts[0].payload.complete, true);
    assert.deepEqual(posts[0].payload.data, [{ items: [discLicense] }, { items: [purchasedLicense, goldLicense] }]);
    assertNoCredentials(posts[0].payload);
});

test('Xbox: malformed metadata on a later page discards the entire snapshot without a partial POST', async () => {
    let page = 0;
    const background = backgroundFixture({ state: tokenState(), handle: ({ url }) => {
        if (url.hostname !== 'collections.mp.microsoft.com') return;
        return page++ === 0 ? json({ items: [purchasedLicense], continuationToken: 'next-page' })
            : json({ items: [{ ...discLicense, quantity: '0' }] });
    } });
    const f = contentFixture({ runtime: (message) => background.send(message) });
    await assert.rejects(f.run('Player', accountId), /invalid collection metadata/);
    assert.equal(f.events.filter((event) => typeof event === 'object').length, 0);
});

test('Xbox: a large collection preserves every page in one POST and satisfies backend counts', async () => {
    const pages = Array.from({ length: 24 }, (_, page) => Array.from({ length: page === 23 ? 75 : 100 }, (_, index) => ({
        ...item, productId: `9N${String(page * 100 + index).padStart(10, '0')}`
    })));
    const f = contentFixture({ pages });
    await f.run();
    const posts = f.events.filter((event) => typeof event === 'object');
    assert.equal(posts.length, 1);
    const payload = posts[0].payload;
    assert.equal(payload.pagesCount, 24);
    assert.equal(payload.pagesCount, payload.data.length);
    assert.equal(payload.totalItems, 2375);
    assert.equal(payload.totalItems, payload.data.reduce((count, page) => count + page.items.length, 0));
    assert.deepEqual(payload.data.flatMap((page) => page.items), pages.flat());
    assert.equal(f.events.filter((event) => event === 'FETCH_XBOX_COLLECTION_PAGE').length, 24);
    assertNoCredentials(payload);
});

test('Xbox: more than 1000 pages are collected completely and sent in one POST', async () => {
    const pages = Array.from({ length: 1001 }, (_, index) => [{
        ...item, productId: `9N${String(index).padStart(10, '0')}`
    }]);
    const f = contentFixture({ pages });
    await f.run();
    const posts = f.events.filter((event) => typeof event === 'object');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].payload.pagesCount, 1001);
    assert.equal(posts[0].payload.totalItems, 1001);
    assert.deepEqual(posts[0].payload.data, pages.map((items) => ({ items })));
    assert.equal(f.events.filter((event) => event === 'FETCH_XBOX_COLLECTION_PAGE').length, 1001);
});

test('Xbox: an empty intermediate page counts as a page and does not end pagination', async () => {
    const f = contentFixture({ pages: [[item], [], [{ ...item, skuId: '0001' }]] });
    await f.run();
    const post = f.events.find((event) => typeof event === 'object');
    assert.equal(post.payload.pagesCount, 3);
    assert.deepEqual(post.payload.data.map((page) => page.items.length), [1, 0, 1]);
    assert.equal(post.payload.totalItems, 2);
});

test('Xbox: cancellation prevents collection reads and posts', async () => {
    const f = contentFixture({ consent: false });
    await assert.rejects(f.run(), /Sync canceled:/);
    assert.deepEqual(f.events, ['FETCH_XBOX_ACCOUNT', 'consent']);
});

test('Xbox: matching XUID skips confirmation even after a gamertag rename', async () => {
    const f = contentFixture();
    await f.run('Old gamertag', accountId);
    assert.equal(f.events.includes('consent'), false);
});

test('Xbox: a different XUID prompts even when the configured gamertag matches, then connects in the single import', async () => {
    const f = contentFixture();
    await f.run('Player', '999');
    assert.deepEqual(f.events.slice(0, 2), ['FETCH_XBOX_ACCOUNT', 'consent']);
    assert.equal(f.events.filter((event) => typeof event === 'object').length, 1);
});

test('Xbox: an optional separate connect endpoint follows the shared confirm/connect/fetch/import order', async () => {
    const f = contentFixture();
    await f.run('Other player', '999', '/connect');
    assert.equal(f.events[0], 'FETCH_XBOX_ACCOUNT');
    assert.equal(f.events[1], 'consent');
    assert.equal(f.events[2].url, 'https://gg.deals/connect');
    assert.deepEqual(f.events[2].payload, { version: 'test', accountId, username: 'Player', overwrite: true });
    assert.equal(f.events[3], 'FETCH_XBOX_COLLECTION_PAGE');
    assert.equal(f.events.at(-1).payload.complete, true);
});

test('Xbox: failure of a separate account connection prevents collection fetching', async () => {
    const f = contentFixture({ connectError: 'connection failed' });
    await assert.rejects(f.run('', '', '/connect'), /connection failed/);
    assert.equal(f.events.includes('FETCH_XBOX_COLLECTION_PAGE'), false);
});

test('Xbox: a server account mismatch uses shared consent and reconnect recovery when a connect URL is supplied', async () => {
    const f = contentFixture({ importError: 'Invalid accountId: old-id' });
    await f.run('Player', accountId, '/connect');
    const posts = f.events.filter((event) => typeof event === 'object');
    assert.equal(f.events.filter((event) => event === 'consent').length, 1);
    assert.deepEqual(posts.map((post) => post.url), [
        'https://gg.deals/extensionImport/xboxCollection/', 'https://gg.deals/connect', 'https://gg.deals/extensionImport/xboxCollection/'
    ]);
    assert.equal(posts[1].payload.overwrite, true);
    assert.deepEqual(posts[0].payload, posts[2].payload);
});

test('Xbox: import-connected accounts preserve the original error without attempting a missing connect endpoint', async () => {
    const f = contentFixture({ importError: 'Invalid accountId: old-id' });
    await assert.rejects(f.run('Player', accountId), /Invalid accountId:/);
    assert.equal(f.events.includes('consent'), false);
    assert.equal(f.events.filter((event) => typeof event === 'object').length, 1);
});

for (const [name, options, error] of [
    ['repeated cursor', { repeat: true }, /continuation token/],
    ['failed later page', { pageError: true }, /503/],
    ['changed account', { mismatch: true }, /account changed/],
    ['time limit', { advance: 600001 }, /pagination.*limit/]
]) {
    test(`Xbox: ${name} discards partial results without posting an import`, async () => {
        const f = contentFixture(options);
        await assert.rejects(f.run(), error);
        assert.equal(f.events.some((event) => typeof event === 'object'), false);
    });
}

test('Xbox: an abort after the last page still prevents import', async () => {
    const f = contentFixture();
    const controller = new AbortController();
    await assert.rejects(f.run('', '', null, { signal: controller.signal, onProgress: () => controller.abort() }), /Sync canceled:/);
    assert.equal(f.events.some((event) => typeof event === 'object'), false);
});

test('Xbox: an explicitly complete empty collection is sent for backend reconciliation', async () => {
    const f = contentFixture({ pages: [[]] });
    await f.run();
    const post = f.events.find((event) => typeof event === 'object');
    assert.equal(post.payload.complete, true);
    assert.equal(post.payload.totalItems, 0);
    assert.equal(post.payload.pagesCount, 1);
    assert.deepEqual(post.payload.data, [{ items: [] }]);
});

// Minimal DOM for the standard ExtensionSyncWidget rendered by the website.
// Exercise the real snapshot/lock helpers and the actual click handler together.
class TileElement {
    constructor(tagName = 'div', className = '', text = '') {
        this.tagName = tagName;
        this.className = className;
        this.text = text;
        this.childNodes = [];
        this.attributes = {};
        this.dataset = {};
        this.style = { pointerEvents: '' };
        this.classList = {
            contains: (name) => this.className.split(/\s+/).includes(name),
            add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
            remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(' '); }
        };
    }
    get textContent() { return this.text + this.childNodes.map((node) => node.textContent).join(''); }
    set textContent(text) { this.text = text; this.childNodes = []; }
    get isConnected() { return this.attached || this.parentElement?.isConnected || false; }
    append(...nodes) { nodes.forEach((node) => { node.parentElement = this; this.childNodes.push(node); }); }
    replaceChildren(...nodes) { this.text = ''; this.childNodes = []; this.append(...nodes); }
    remove() {
        if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter((node) => node !== this);
        this.parentElement = null;
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    matches(selector) {
        if (selector.includes(',')) return selector.split(',').some((part) => this.matches(part.trim()));
        if (selector === '[class*="description"]') return this.className.includes('description');
        if (selector.startsWith('[')) return this.getAttribute(selector.slice(1, -1)) !== null;
        const [tag, ...classes] = selector.split('.');
        return (!tag || this.tagName === tag) && classes.every((name) => this.classList.contains(name));
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
    querySelectorAll(selector) {
        if (selector.includes(',')) return [...new Set(selector.split(',').flatMap((part) => this.querySelectorAll(part.trim())))];
        const tokens = selector.split(/\s+/);
        const result = [];
        const visit = (node) => {
            if (node.matches(tokens.at(-1))) {
                let parent = node.parentElement;
                let token = tokens.length - 2;
                while (parent && token >= 0) {
                    if (parent.matches(tokens[token])) token--;
                    parent = parent.parentElement;
                }
                if (token < 0) result.push(node);
            }
            node.childNodes.forEach(visit);
        };
        this.childNodes.forEach(visit);
        return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    contains(node) { return this === node || this.childNodes.some((child) => child.contains(node)); }
    addEventListener(name, callback, options) {
        if (name === 'click') {
            this.clickHandler = callback;
            this.clickOptions = options;
            this.clickListenerCount = (this.clickListenerCount ?? 0) + 1;
        }
    }
    cloneNode(deep) {
        const node = new TileElement(this.tagName, this.className, this.text);
        node.attributes = { ...this.attributes };
        if (deep) node.append(...this.childNodes.map((child) => child.cloneNode(true)));
        return node;
    }
}
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

async function tileFixture({ needsLogin = false, accountError, pages = [[item]], pageError, importGate,
    browserAccount, configuredAccountId = '', configuredUsername = '', connectUrl = null, connection } = {}) {
    const events = [];
    const errors = [];
    let page = 0;
    let authorizedAccount = needsLogin ? null : { accountId, username: 'Player' };
    const host = new TileElement('div', 'sync-box sync-32 connected extension-sync-btn action-box');
    host.attached = true;
    host.setAttribute('data-link-to-import', '/extensionImport/xboxCollection/');
    host.setAttribute('data-connection-status-url', '/extensionImport/xboxConnection/');
    if (connectUrl) host.setAttribute('data-connect-url', connectUrl);
    host.setAttribute('data-account-id', configuredAccountId);
    host.setAttribute('data-username', configuredUsername);
    const content = new TileElement('div', 'content-wrapper');
    const description = new TileElement('div', 'description');
    const installed = new TileElement('span', 'extension-state-installed');
    const lastSync = new TileElement('span', 'last-sync-time');
    const synced = new TileElement('span', 'last-sync');
    const lighten = new TileElement('span', 'lighten');
    const lastText = new TileElement('span', 'last-text', 'Synced ');
    lastText.append(new TileElement('time', 'timeago-short', 'yesterday'));
    const lockedText = new TileElement('span', 'locked-text', 'Available again ');
    lockedText.append(new TileElement('time', 'timeago-short'));
    lighten.append(lastText, lockedText);
    synced.append(lighten);
    lastSync.append(synced, new TileElement('span', 'connection-info', 'Connected'));
    installed.append(lastSync, new TileElement('span', 'sync-text', 'Syncing...'), new TileElement('span', 'action-bottom-text', 'Sync'));
    description.append(installed);
    const progressBar = new TileElement('ul', 'progressBar');
    for (const state of ['queued', 'in-progress', 'done']) progressBar.append(new TileElement('li', state));
    content.append(description, progressBar);
    const syncLink = new TileElement('a', 'sync-link');
    host.append(content, syncLink);
    const bridge = deferred();
    const prompt = deferred();
    const shown = deferred();
    const authorization = deferred();
    const polling = deferred();
    const posting = deferred();
    const progressListeners = new Set();
    const pageListeners = new Map();
    const prompts = [];
    const realHelpers = load('../src/utils/sync-helpers.ts', () => ({ default: {} }), {
        HTMLElement: TileElement, document: { createElement: (tag) => new TileElement(tag) },
        chrome: { runtime: { getURL: (path) => `extension://${path}`, onMessage: {
            addListener: (listener) => progressListeners.add(listener), removeListener: (listener) => progressListeners.delete(listener)
        } } }
    });
    const ask = (input) => { events.push('prompt'); prompts.push(input); shown.resolve(); return prompt.promise; };
    const constants = { EXTENSION_VERSION: 'test', XBOX_SOURCE_ID: 32, XBOX_COLLECTION_TIMEOUT_MS: 600000,
        XBOX_COLLECTION_SYNC_BUTTON_ID: 'xbox-collection-sync-btn', XBOX_SIGNIN_URL: 'https://www.xbox.com/' };
    const helpers = { ...realHelpers,
        lookForElement: async () => host,
        markSourceNewViaPageSyncWidget: () => { events.push('bridge'); return bridge.promise; },
        markSourceQueuedViaPageSyncWidget: async () => { events.push('queued'); host.classList.remove('new'); host.classList.add('queued'); },
        resetSourceStateViaPageSyncWidget: async () => { events.push('reset'); },
        unmarkAsNewViaPageSyncWidget: async () => { events.push('unmark'); },
        showErrorToast: async (message) => { events.push('error'); errors.push(message); },
        callSwal: ask,
        requestUserIdConsentViaPageSwal: (serviceName, accountLabel) => ask({ serviceName, accountLabel }),
        sendMessageToServer: async (url) => {
            if (url.endsWith('/xboxConnection/')) return { success: true, data: connection ?? {
                connected: true, accountId: configuredAccountId || '999', username: configuredUsername || 'Configured player'
            } };
            events.push('post'); posting.resolve(); await importGate?.promise;
        },
        sendRuntimeMessage: async ({ type, currentPage, accountId: requestedAccountId }) => {
            events.push(type);
            if (type === 'DISCONNECT_XBOX') { authorizedAccount = null; return { ok: true }; }
            if (type === 'FETCH_XBOX_ACCOUNT' && accountError) return { ok: false, error: accountError };
            if (type === 'FETCH_XBOX_ACCOUNT') return authorizedAccount ? { ok: true, data: { ...authorizedAccount, browserAccount } }
                : { ok: false, error: 'XBOX_AUTH_REQUIRED' };
            if (type === 'START_XBOX_AUTHORIZATION') return { ok: true, data: {
                authorizationId: 'test-authorization', requestId: 'test-authorization-request', userCode: 'ABCD-EFGH', retryAfter: 1000, expiresAt: Date.now() + 60000
            } };
            if (type === 'POLL_XBOX_AUTHORIZATION') {
                polling.resolve();
                authorizedAccount = await authorization.promise;
                return { ok: true, data: authorizedAccount };
            }
            if (type === 'CANCEL_XBOX_AUTHORIZATION') return { ok: true };
            if (type === 'OPEN_URL_IN_NEW_TAB') return { ok: true };
            if (type === 'FETCH_XBOX_COLLECTION_PAGE') {
                if (currentPage === 1) page = 0;
                if (pageError && page > 0) return { ok: false, error: 'HTTP 503' };
                const items = pages[page++];
                progressListeners.forEach((listener) => listener({ type: 'GGDEALS_SYNC_PAGINATION_PROGRESS', sourceId: 32,
                    currentPage, totalPages: page < pages.length ? null : page }));
                return { ok: true, data: { accountId: requestedAccountId, items, continuationToken: page < pages.length ? `page-${page}` : null } };
            }
            throw new Error(`Unexpected runtime request ${type}`);
        }
    };
    const integration = load('../src/integrations/xbox/index.ts', (name) => {
        if (name.endsWith('sync-helpers')) return helpers;
        if (name.endsWith('sync-constants')) return constants;
        if (name.endsWith('sync-error-messages')) return load('../src/utils/sync-error-messages.ts', () => ({}));
        if (name.endsWith('sync-account')) return load('../src/utils/sync-account.ts', (dependency) =>
            dependency.endsWith('sync-constants') ? constants : helpers);
        throw new Error(`Unexpected dependency ${name}`);
    }, { setTimeout: (callback) => setTimeout(callback, 0), document: { createElement: (tag) => new TileElement(tag) }, window: {
        location: { origin: 'https://gg.deals', href: 'https://gg.deals/collection/' },
        addEventListener: (type, listener) => pageListeners.set(type, listener),
        removeEventListener: (type) => pageListeners.delete(type)
    } });
    integration.default();
    await Promise.resolve();
    return { host, events, errors, prompts, bridge, prompt, authorization, shown: shown.promise, polling: polling.promise, posting: posting.promise,
        bindProgress: (sourceId) => realHelpers.bindSyncPaginationProgressDescription(host, sourceId),
        progressListeners,
        emitProgress: (message) => progressListeners.forEach((listener) => listener(message)),
        hide: () => pageListeners.get('pagehide')?.(),
        click: (isTrusted = true) => host.clickHandler({ target: host, isTrusted,
            preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }) };
}

test('Shared sync progress: runtime updates retain filtering, markup and cleanup for other integrations', async () => {
    const f = await tileFixture();
    const description = f.host.querySelector('.description');
    const installed = f.host.querySelector('.extension-state-installed');
    description.setAttribute('title', 'Original status');
    const stop = f.bindProgress(256);
    const progress = { type: 'GGDEALS_SYNC_PAGINATION_PROGRESS', sourceId: 256, currentPage: 1, totalPages: 3 };
    f.emitProgress({ ...progress, sourceId: 512 });
    f.emitProgress({ ...progress, type: 'OTHER_MESSAGE' });
    f.emitProgress({ ...progress, currentPage: 0 });
    assert.equal(f.host.querySelector('.extension-sync-pagination-progress'), null);
    f.emitProgress(progress);
    f.emitProgress({ ...progress, currentPage: 2 });
    assert.deepEqual(f.host.querySelectorAll('.extension-sync-pagination-progress').map((node) => node.textContent), [' (2/3)']);
    assert.equal(description.getAttribute('title'), 'Sync progress: 2/3');
    assert.equal(f.host.querySelector('.extension-state-installed'), installed);
    stop();
    assert.equal(f.host.querySelector('.extension-sync-pagination-progress'), null);
    assert.equal(description.getAttribute('title'), 'Original status');
    assert.equal(f.progressListeners.size, 0);
});

for (const needsLogin of [true, false]) {
    test(`Xbox tile: progress appears synchronously before a delayed bridge and ${needsLogin ? 'login' : 'account'} prompt`, async () => {
        const f = await tileFixture({ needsLogin });
        // These are the elements that SyncWidget.Source and its completion code require.
        assert.equal(f.host.classList.contains('sync-32'), true);
        assert.ok(f.host.querySelector('.progressBar .queued'));
        assert.ok(f.host.querySelector('.progressBar .in-progress'));
        assert.ok(f.host.querySelector('.progressBar .done'));
        assert.ok(f.host.querySelector('.last-text .timeago-short'));
        assert.ok(f.host.querySelector('.locked-text .timeago-short'));
        const sync = f.click();
        // No promise or page acknowledgement has resolved at this point.
        assert.equal(f.host.classList.contains('new'), true);
        assert.equal(f.host.querySelector('.sync-text').textContent, 'Syncing...');
        assert.deepEqual(f.events, ['bridge']);
        f.bridge.resolve();
        await f.shown;
        assert.equal(f.host.classList.contains('new'), true);
        f.prompt.resolve(false);
        await sync;
        assert.equal(f.host.classList.contains('new'), false);
        assert.equal(f.host.style.pointerEvents, '');
        assert.equal(f.host.getAttribute('aria-disabled'), null);
        assert.equal(f.events.includes('post'), false);
        assert.equal(f.events.includes('error'), false);
        assert.ok(f.host.querySelector('.progressBar'));
    });
}

test('Xbox tile: a failed page bridge restores the tile instead of leaving progress active', async () => {
    const f = await tileFixture();
    const sync = f.click();
    assert.equal(f.host.classList.contains('new'), true);
    f.bridge.reject(new Error('Page bridge unavailable'));
    await sync;
    assert.equal(f.host.classList.contains('new'), false);
    assert.equal(f.host.style.pointerEvents, '');
    assert.deepEqual(f.events, ['bridge', 'reset', 'error']);
});

test('Xbox tile: a complete POST transitions from initial progress to the import queue', async () => {
    const f = await tileFixture();
    const sync = f.click();
    f.bridge.resolve();
    await f.shown;
    f.prompt.resolve(true);
    await sync;
    assert.deepEqual(f.events.slice(-2), ['post', 'queued']);
    assert.equal(f.host.classList.contains('new'), false);
    assert.equal(f.host.classList.contains('queued'), true);
    assert.ok(f.host.querySelector('.last-text .timeago-short'));
});

test('Xbox tile: initialization removes the standard sync link and success preserves server-rendered status markup', async () => {
    const f = await tileFixture();
    assert.equal(f.host.querySelector('a.sync-link'), null);
    const description = f.host.querySelector('.description');
    const initialText = description.textContent;
    const sync = f.click();
    f.bridge.resolve();
    await f.shown;
    f.prompt.resolve(true);
    await sync;
    assert.equal(f.host.querySelector('.description'), description);
    assert.equal(description.textContent, initialText);
    assert.equal(f.progressListeners.size, 0);
});

test('Xbox tile: an invalidated extension context restores the tile without a misleading sync error toast', async () => {
    const f = await tileFixture({ accountError: 'Extension context invalidated.' });
    const sync = f.click();
    f.bridge.resolve();
    await sync;
    assert.equal(f.host.classList.contains('new'), false);
    assert.equal(f.errors.length, 0);
    assert.equal(f.progressListeners.size, 0);
});

test('Xbox tile: leaving the page cancels through the shared handler without fetching, importing or showing an error toast', async () => {
    const f = await tileFixture();
    const sync = f.click();
    f.bridge.resolve();
    await f.shown;
    f.hide();
    f.prompt.resolve(true);
    await sync;
    assert.equal(f.events.includes('FETCH_XBOX_COLLECTION_PAGE'), false);
    assert.equal(f.events.includes('post'), false);
    assert.equal(f.events.includes('unmark'), true);
    assert.equal(f.host.classList.contains('new'), false);
    assert.equal(f.errors.length, 0);
    assert.equal(f.progressListeners.size, 0);
});

test('Xbox tile: device sign-in preserves the status markup and does not replace it with Microsoft instructions', async () => {
    const f = await tileFixture({ needsLogin: true });
    const installed = f.host.querySelector('.extension-state-installed');
    const syncText = f.host.querySelector('.sync-text');
    const sync = f.click();
    f.bridge.resolve();
    await f.shown;
    f.prompt.resolve(true);
    await f.polling;
    const duringAuthorization = {
        installed: f.host.querySelector('.extension-state-installed'),
        syncText: f.host.querySelector('.sync-text'),
        description: f.host.querySelector('.description').textContent
    };
    f.authorization.resolve({ accountId, username: 'Player' });
    await sync;
    assert.equal(duringAuthorization.installed, installed);
    assert.equal(duringAuthorization.syncText, syncText);
    assert.doesNotMatch(duringAuthorization.description, /Microsoft|ABCD-EFGH/);
    assert.equal(f.host.classList.contains('queued'), true);
});

test('Xbox tile: pagination uses the shared counter without removing status elements and cleans it after import', async () => {
    const importGate = deferred();
    const f = await tileFixture({ pages: [[item], [item]], importGate });
    const installed = f.host.querySelector('.extension-state-installed');
    const syncText = f.host.querySelector('.sync-text');
    const sync = f.click();
    f.bridge.resolve();
    await f.shown;
    f.prompt.resolve(true);
    await f.posting;
    const duringImport = {
        installed: f.host.querySelector('.extension-state-installed'),
        syncText: f.host.querySelector('.sync-text'),
        counters: f.host.querySelectorAll('.extension-sync-pagination-progress').map((node) => node.textContent),
        title: f.host.querySelector('.description').getAttribute('title')
    };
    importGate.resolve();
    await sync;
    assert.equal(duringImport.installed, installed);
    assert.equal(duringImport.syncText, syncText);
    assert.deepEqual(duringImport.counters, [' (2/2)']);
    assert.equal(duringImport.title, 'Sync progress: 2/2');
    assert.equal(f.host.querySelector('.extension-sync-pagination-progress'), null);
    assert.ok(f.host.querySelector('.last-text .timeago-short'));
});

test('Xbox tile: a failed later page restores the description and removes the pagination counter', async () => {
    const f = await tileFixture({ pages: [[item], [item]], pageError: true });
    const initialDescription = f.host.querySelector('.description').textContent;
    const sync = f.click();
    f.bridge.resolve();
    await f.shown;
    f.prompt.resolve(true);
    await sync;
    assert.equal(f.host.querySelector('.description').textContent, initialDescription);
    assert.equal(f.host.querySelector('.extension-sync-pagination-progress'), null);
    assert.equal(f.host.querySelector('.description').getAttribute('title'), null);
    assert.equal(f.host.classList.contains('new'), false);
    assert.equal(f.events.includes('post'), false);
    assert.equal(f.errors.length, 1);
});

test('Xbox tile: a token transport error reports an authorization failure', async () => {
    const f = await tileFixture({ accountError: 'Microsoft rejected the Xbox token request origin (AADSTS90023).' });
    const sync = f.click();
    f.bridge.resolve();
    await sync;
    assert.equal(f.host.classList.contains('new'), false);
    assert.match(f.errors[0], /Could not complete Xbox authorization/);
    assert.equal(f.events.includes('post'), false);
});

test('Xbox tile: a browser switch confirms the target account and the Microsoft sign-in before authorization and updates the tile', async () => {
    const otherAccount = { accountId: '2533274790000002', username: 'Other player' };
    const f = await tileFixture({ browserAccount: otherAccount, configuredAccountId: accountId, configuredUsername: 'Player',
        connectUrl: '/settings/connectExtension?source=32' });
    const sync = f.click();
    assert.equal(f.host.classList.contains('new'), true);
    f.bridge.resolve();
    await f.shown;
    assert.deepEqual(f.prompts[0], { serviceName: 'Xbox', accountLabel: `Other player (ID: ${otherAccount.accountId})` });
    assert.equal(f.events.includes('FETCH_XBOX_COLLECTION_PAGE'), false);
    f.prompt.resolve(true);
    await f.polling;
    f.authorization.resolve(otherAccount);
    await sync;
    assert.equal(f.events.filter((event) => event === 'prompt').length, 2);
    assert.equal(f.prompts[1].confirmButtonText, 'Sign in to Xbox');
    assert.ok(f.events.lastIndexOf('prompt') < f.events.indexOf('START_XBOX_AUTHORIZATION'));
    assert.ok(f.events.lastIndexOf('prompt') < f.events.indexOf('FETCH_XBOX_COLLECTION_PAGE'));
    assert.equal(f.host.getAttribute('data-account-id'), otherAccount.accountId);
    assert.equal(f.host.getAttribute('data-username'), otherAccount.username);
    assert.equal(f.errors.length, 0);
});

test('Xbox tile: a synthetic click from a page script cannot start a sync with the stored grant', async () => {
    const f = await tileFixture({ configuredAccountId: accountId, configuredUsername: 'Player' });
    await f.click(false);
    assert.deepEqual(f.events, []);
    assert.equal(f.host.classList.contains('new'), false);
    assert.equal(f.host.dataset.ggdealsSyncBusy, undefined);
});

test('Xbox tile: a missing Xbox.com session asks to sign in there without Microsoft authorization or an error toast', async () => {
    const f = await tileFixture({ accountError: 'XBOX_BROWSER_SESSION_REQUIRED', configuredAccountId: accountId, configuredUsername: 'Player' });
    const sync = f.click();
    f.bridge.resolve();
    await f.shown;
    f.prompt.resolve(true);
    await sync;
    assert.equal(f.prompts[0].confirmButtonText, 'Open Xbox.com');
    assert.equal(f.events.includes('OPEN_URL_IN_NEW_TAB'), true);
    assert.equal(f.events.includes('START_XBOX_AUTHORIZATION'), false);
    assert.equal(f.events.includes('post'), false);
    assert.equal(f.events.includes('unmark'), true);
    assert.equal(f.errors.length, 0);
    assert.equal(f.host.classList.contains('queued'), false);
    assert.equal(f.host.getAttribute('data-account-id'), accountId);
});

test('Xbox tile: an unreadable Xbox.com session offers session recovery without reauthorization or an error toast', async () => {
    const f = await tileFixture({ accountError: 'XBOX_BROWSER_SESSION_UNAVAILABLE', configuredAccountId: accountId, configuredUsername: 'Player' });
    const sync = f.click();
    f.bridge.resolve();
    await f.shown;
    assert.equal(f.prompts[0].confirmButtonText, 'Open Xbox.com');
    assert.match(f.prompts[0].html, /Could not verify your Xbox.com session/);
    f.prompt.resolve(true);
    await sync;
    assert.equal(f.events.includes('OPEN_URL_IN_NEW_TAB'), true);
    assert.equal(f.events.includes('START_XBOX_AUTHORIZATION'), false);
    assert.equal(f.events.includes('FETCH_XBOX_COLLECTION_PAGE'), false);
    assert.equal(f.events.includes('post'), false);
    assert.equal(f.events.includes('unmark'), true);
    assert.equal(f.errors.length, 0);
    assert.equal(f.host.classList.contains('queued'), false);
    assert.equal(f.host.getAttribute('aria-disabled'), null);
    assert.equal(f.host.getAttribute('data-account-id'), accountId);
});

for (const [accountError, message] of [
    ['XBOX_INCOGNITO_UNSUPPORTED', 'Xbox sync is not available in private browsing. Open GG.deals in a regular browser window.']
]) {
    test(`Xbox tile: ${accountError} stops with actionable feedback and never asks for another sign-in`, async () => {
        const f = await tileFixture({ accountError, configuredAccountId: accountId, configuredUsername: 'Player' });
        const sync = f.click();
        f.bridge.resolve();
        await sync;
        assert.deepEqual(f.errors, [message]);
        assert.equal(f.prompts.length, 0);
        assert.equal(f.events.includes('START_XBOX_AUTHORIZATION'), false);
        assert.equal(f.events.includes('OPEN_URL_IN_NEW_TAB'), false);
        assert.equal(f.events.includes('post'), false);
        assert.equal(f.host.classList.contains('new'), false);
        assert.equal(f.host.classList.contains('queued'), false);
        assert.equal(f.host.getAttribute('data-account-id'), accountId);
    });
}

for (const accountError of ['XBOX_AUTH_REQUIRED']) {
    test(`Xbox tile: ${accountError} can finish sign-in and import in the same click`, async () => {
        const f = await tileFixture({ accountError, configuredAccountId: accountId,
            configuredUsername: 'Player' });
        const sync = f.click();
        f.bridge.resolve();
        await f.shown;
        assert.equal(f.host.classList.contains('new'), true);
        assert.equal(f.events.includes('FETCH_XBOX_COLLECTION_PAGE'), false);
        f.prompt.resolve(true);
        await f.polling;
        assert.equal(f.events.includes('post'), false);
        f.authorization.resolve({ accountId, username: 'Player' });
        await sync;
        assert.equal(f.events.filter((event) => event === 'START_XBOX_AUTHORIZATION').length, 1);
        assert.equal(f.events.filter((event) => event === 'post').length, 1);
        assert.equal(f.host.classList.contains('queued'), true);
        assert.equal(f.errors.length, 0);
    });
}

function settingsPopupFixture({ label = 'Xbox sync', confirmed = true, needsLogin = false, connectError,
    providerAttribute, importUrl, connected = false, disconnectRequest, sourceId = 32,
    pageClass = 'user-settings-page', popupInitiallyPresent = true, browserAccount, authorizedAccount, refreshError, accountError } = {}) {
    const events = [];
    const posts = [];
    const warnings = [];
    const errors = [];
    let hasAuthorization = !needsLogin;
    const row = new TileElement('div', 'sync-provider-item');
    if (connected) row.classList.add('connected');
    row.append(new TileElement('div', 'sync-provider-name', label));
    const status = new TileElement('div', 'sync-provider-status');
    if (!connected) status.setAttribute('data-connect-url', '/settings/connectExtension?source=32');
    if (providerAttribute) status.setAttribute('data-extension-provider', providerAttribute);
    if (importUrl) status.setAttribute('data-link-to-import', importUrl);
    const disconnectLink = new TileElement('a', 'sync-provider-link sync-provider-disconnect', 'Disconnect');
    disconnectLink.setAttribute('href', `/settings/disconnectExtension?source=${sourceId}`);
    if (connected) status.append(new TileElement('span', 'connected-username', 'Player'), disconnectLink);
    else status.append(new TileElement('span', 'sync-provider-status-info extension-state-not-installed', 'Extension required'),
        new TileElement('span', 'sync-provider-link extension-state-installed', 'Connect'));
    row.append(status);
    const container = new TileElement();
    container.id = 'user-extension-settings';
    const otherRows = Array.from({ length: 4 }, () => new TileElement('div', 'sync-provider-item connected'));
    container.append(row, ...otherRows);
    container.querySelectorAll = (selector) => selector === '.sync-provider-item, .extension-sync-popup-provider-item'
        ? [row, ...otherRows] : connected ? [] : [status];
    const counter = new TileElement('span', 'active-label', connected ? '5/5' : '4/5');
    const body = new TileElement('body', pageClass);
    let popupPresent = popupInitiallyPresent;
    const document = { body, documentElement: new TileElement('html'), querySelector: (selector) =>
        selector === '#ggdeals-sync-btn .active-label' ? counter : popupPresent ? container : null };
    const constants = {
        EXTENSION_VERSION: 'test', EXTENSION_INSTALLED_CLASSNAME: 'extension-installed', USER_SETTINGS_PAGE_CLASSNAME: 'user-settings-page',
        STEAM_SOURCE_ID: 64, EPIC_SOURCE_ID: 128, PLAYSTATION_SOURCE_ID: 256, NINTENDO_SOURCE_ID: 512, XBOX_SOURCE_ID: 32,
        XBOX_COLLECTION_TIMEOUT_MS: 600000
    };
    const helpers = {
        toErrorMessage: (error) => error.message,
        readServerErrorCode: (error) => error?.serverCode ?? error?.code ?? null,
        readTrimmedAttribute: (element, name) => element.getAttribute(name)?.trim() ?? '',
        lookForElement: () => new Promise(() => {}),
        isSyncCanceledError: (error) => error.message.includes('Sync canceled:'),
        bindSyncPaginationProgressDescription: () => () => {},
        markSourceNewViaPageSyncWidget: async () => { events.push('new'); },
        markSourceQueuedViaPageSyncWidget: async () => { events.push('queued'); },
        unmarkAsNewViaPageSyncWidget: async () => { events.push('unmark'); },
        resetSourceStateViaPageSyncWidget: async () => { events.push('reset'); },
        showErrorToast: async (message) => { errors.push(message); },
        refreshExtensionSettingsPopupViaPage: async () => {
            events.push('refresh-settings');
            if (refreshError) throw new Error(refreshError);
            // A fresh server render supplies the badge, Disconnect link and row state.
            const username = status.getAttribute('data-username') ?? 'Player';
            row.classList.add('connected');
            status.setAttribute('data-connected-username', username);
            status.replaceChildren(new TileElement('span', 'connected-username', username), disconnectLink);
            onMutation?.([{ addedNodes: [container] }]);
        },
        callSwal: async () => { events.push('login'); return true; },
        requestUserIdConsentViaPageSwal: async () => { events.push('consent'); return confirmed; },
        sendMessageToServer: async (url, payload) => {
            const isImport = url.includes('/extensionImport/');
            events.push(isImport ? 'import' : 'connect');
            posts.push({ url, payload: clone(payload) });
            if (!isImport && connectError) throw new Error(connectError);
        },
        sendRuntimeMessage: async ({ type }) => {
            events.push(type);
            if (type === 'DISCONNECT_XBOX') {
                const response = await disconnectRequest?.() ?? { ok: true };
                if (response.ok) { hasAuthorization = false; events.push('credentials-deleted'); }
                return response;
            }
            if (type === 'FETCH_XBOX_ACCOUNT' && accountError) return { ok: false, error: accountError };
            if (type === 'FETCH_XBOX_ACCOUNT') return hasAuthorization ? { ok: true, data: { accountId, username: 'Player', browserAccount } }
                : { ok: false, error: 'XBOX_AUTH_REQUIRED' };
            if (type === 'START_XBOX_AUTHORIZATION') return { ok: true, data: {
                authorizationId: 'popup-authorization', requestId: 'popup-authorization-request', retryAfter: 1000, expiresAt: Date.now() + 60000
            } };
            if (type === 'POLL_XBOX_AUTHORIZATION') {
                hasAuthorization = true;
                return { ok: true, data: authorizedAccount ?? { accountId, username: 'Player' } };
            }
            if (type === 'CANCEL_XBOX_AUTHORIZATION') return { ok: true };
            throw new Error(`Unexpected request in account-only settings popup: ${type}`);
        }
    };
    const window = { location: { origin: 'https://gg.deals', href: 'https://gg.deals/settings/', hostname: 'gg.deals', pathname: '/settings/' },
        setTimeout: (callback) => callback() };
    const require = (name) => {
        if (name.endsWith('sync-constants')) return constants;
        if (name.endsWith('sync-helpers')) return helpers;
        if (name.endsWith('sync-error-messages')) return load('../src/utils/sync-error-messages.ts', () => ({}));
        if (name.endsWith('sync-account')) return load('../src/utils/sync-account.ts', require);
        if (name === './integrations/xbox') return load('../src/integrations/xbox/index.ts', require, { window,
            setTimeout: (callback) => setTimeout(callback, 0) });
        if (name.startsWith('./integrations/')) return { default: () => {} };
        throw new Error(`Unexpected dependency ${name}`);
    };
    let onMutation;
    load('../src/content-settings.ts', require, { document, window, Element: TileElement,
        MutationObserver: class { constructor(callback) { onMutation = callback; } observe() {} },
        console: { log() {}, warn: (...args) => warnings.push(args) } });
    const clickEvent = (target) => ({ target, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, stopImmediatePropagation() {} });
    // Reproduce capture-phase extension handling followed by the website's normal submit handler.
    disconnectLink.click = () => {
        const event = clickEvent(disconnectLink);
        void container.clickHandler?.(event);
        if (!event.defaultPrevented) events.push('server-disconnect');
    };
    return { status, container, row, counter, disconnectLink, events, posts, warnings, errors,
        openPopup: () => { popupPresent = true; onMutation?.([{ addedNodes: [container] }]); },
        reprocess: () => onMutation([{ addedNodes: [container] }]),
        disconnect: async (target = disconnectLink) => {
            const event = clickEvent(target);
            await container.clickHandler?.(event);
            if (!event.defaultPrevented) events.push('server-disconnect');
            return event;
        },
        click: (isTrusted = true) => status.clickHandler({ target: status, isTrusted, preventDefault() {}, stopPropagation() {} }) };
}

const settingsAuthorizationEvents = ['DISCONNECT_XBOX', 'credentials-deleted', 'FETCH_XBOX_ACCOUNT', 'login',
    'START_XBOX_AUTHORIZATION', 'POLL_XBOX_AUTHORIZATION', 'CANCEL_XBOX_AUTHORIZATION'];

test('Xbox settings popup: a synthetic Connect click from a page script starts nothing', async () => {
    const f = settingsPopupFixture();
    await f.click(false);
    assert.deepEqual(f.events, []);
    assert.equal(f.posts.length, 0);
    assert.equal(f.status.dataset.ggdealsSyncBusy, undefined);
    assert.equal(f.status.classList.contains('syncing'), false);
});

test('Xbox settings popup: the server-rendered label connects through the supplied URL without a collection import or queue changes', async () => {
    const f = settingsPopupFixture();
    assert.equal(f.status.getAttribute('data-extension-provider'), null);
    await f.click();
    assert.deepEqual(f.warnings, []);
    assert.deepEqual(f.events, [...settingsAuthorizationEvents, 'consent', 'connect', 'refresh-settings']);
    assert.equal(f.posts.length, 1);
    assert.equal(f.posts[0].url, 'https://gg.deals/settings/connectExtension?source=32');
    assert.deepEqual(f.posts[0].payload, { version: 'test', accountId, username: 'Player' });
    assertNoCredentials(f.posts);
    assert.equal(f.status.classList.contains('connected'), true);
    assert.equal(f.status.dataset.ggdealsSyncBusy, '0');
    assert.equal(f.status.getAttribute('data-account-id'), accountId);
    assert.equal(f.status.querySelector('.connected-username').textContent, 'Player');
    assert.equal(f.status.querySelector('.sync-provider-disconnect'), f.disconnectLink);
    assert.equal(f.status.getAttribute('data-connect-url'), null);
    assert.equal(f.row.classList.contains('connected'), true);
    assert.equal(f.counter.textContent, '5/5');
    await f.click();
    assert.equal(f.posts.length, 1);
});

test('Xbox settings popup: cancellation restores Connect without fetching, posting or queuing', async () => {
    const f = settingsPopupFixture({ confirmed: false });
    await f.click();
    assert.deepEqual(f.events, [...settingsAuthorizationEvents, 'consent']);
    assert.equal(f.posts.length, 0);
    assert.equal(f.status.classList.contains('syncing'), false);
    assert.equal(f.status.dataset.ggdealsSyncBusy, '0');
    assert.match(f.status.textContent, /Connect/);
});

test('Xbox settings popup: expired authorization signs in locally before an account-only connection', async () => {
    const f = settingsPopupFixture({ needsLogin: true });
    await f.click();
    assert.deepEqual(f.events.slice(0, 7), settingsAuthorizationEvents);
    assert.deepEqual(f.events.slice(-3), ['consent', 'connect', 'refresh-settings']);
    assert.equal(f.posts.length, 1);
    assert.equal(f.events.includes('FETCH_XBOX_COLLECTION_PAGE'), false);
    assertNoCredentials(f.posts);
});

test('Xbox settings popup: an account lookup failure does not start another Microsoft authorization', async () => {
    const f = settingsPopupFixture({ accountError: 'Xbox request failed (HTTP 503)' });
    await f.click();
    assert.deepEqual(f.events, ['DISCONNECT_XBOX', 'credentials-deleted', 'FETCH_XBOX_ACCOUNT']);
    assert.equal(f.posts.length, 0);
    assert.equal(f.errors.length, 1);
    assert.equal(f.status.dataset.ggdealsSyncBusy, '0');
    assert.match(f.status.textContent, /Connect/);
});

test('Xbox settings popup: switching accounts clears the grant, authorizes and confirms the new account before connecting', async () => {
    const otherAccount = { accountId: '2533274790000002', username: 'Other player' };
    const f = settingsPopupFixture({ browserAccount: otherAccount, authorizedAccount: otherAccount });
    await f.click();
    assert.deepEqual(f.events, [...settingsAuthorizationEvents, 'consent', 'connect', 'refresh-settings']);
    assert.equal(f.posts.length, 1);
    assert.equal(f.posts[0].payload.accountId, otherAccount.accountId);
    assert.equal(f.status.getAttribute('data-account-id'), otherAccount.accountId);
    assertNoCredentials(f.posts);
});

test('Xbox settings popup: an explicit provider marker still works and an import URL does not trigger a sync on Connect', async () => {
    const f = settingsPopupFixture({ label: '', providerAttribute: 'xbox', importUrl: '/custom/extensionImport/xbox' });
    await f.click();
    assert.deepEqual(f.warnings, []);
    assert.equal(f.posts.length, 1);
    assert.equal(f.posts[0].url, 'https://gg.deals/settings/connectExtension?source=32');
    assert.equal(f.posts[0].payload.data, undefined);
    assert.equal(f.events.includes('FETCH_XBOX_COLLECTION_PAGE'), false);
});

test('Xbox settings popup: a failed account connection restores Connect without changing queue state', async () => {
    const f = settingsPopupFixture({ connectError: 'HTTP 503' });
    await f.click();
    assert.deepEqual(f.events, [...settingsAuthorizationEvents, 'consent', 'connect']);
    assert.equal(f.events.includes('queued'), false);
    assert.equal(f.status.classList.contains('connected'), false);
    assert.equal(f.status.dataset.ggdealsSyncBusy, '0');
    assert.match(f.status.textContent, /Connect/);
    assert.equal(f.events.includes('refresh-settings'), false);
    assert.equal(f.counter.textContent, '4/5');
});

test('Xbox settings popup: a display refresh failure cannot offer a second Connect for an already saved account', async () => {
    const f = settingsPopupFixture({ refreshError: 'Refresh unavailable' });
    await f.click();
    assert.equal(f.posts.length, 1);
    assert.equal(f.row.classList.contains('connected'), true);
    assert.equal(f.counter.textContent, '5/5');
    assert.equal(f.status.getAttribute('data-connect-url'), null);
    assert.equal(f.errors.length, 0);
    assert.equal(f.warnings.length, 1);
    await f.click();
    assert.equal(f.posts.length, 1);
});

test('Xbox settings popup: the first connection immediately exposes the normal Disconnect handling', async () => {
    const f = settingsPopupFixture();
    await f.click();
    await f.disconnect();
    assert.deepEqual(f.events.slice(-3), ['DISCONNECT_XBOX', 'credentials-deleted', 'server-disconnect']);
});

test('Xbox settings disconnect: a connected row without connect/provider attributes deletes actual credentials before the website submits', async () => {
    const background = backgroundFixture({ state: tokenState() });
    const f = settingsPopupFixture({ connected: true, disconnectRequest: () => background.send({ type: 'DISCONNECT_XBOX' }) });
    assert.equal(f.status.getAttribute('data-connect-url'), null);
    assert.equal(f.status.getAttribute('data-extension-provider'), null);
    await f.disconnect();
    assert.equal(background.state(), null);
    assert.deepEqual(f.events, ['DISCONNECT_XBOX', 'credentials-deleted', 'server-disconnect']);
    assert.equal(f.posts.length, 0);
    assert.equal(f.errors.length, 0);
    assert.equal(f.disconnectLink.getAttribute('aria-disabled'), null);
});

for (const pageClass of ['user-collection-page', 'user-wishlist-page', 'user-ignorelist-page', 'user-profile-page']) {
    test(`Xbox disconnect: a popup opened dynamically on ${pageClass} clears stored and cached credentials before submission`, async () => {
        const background = backgroundFixture({ state: tokenState() });
        assert.equal((await background.send({ type: 'FETCH_XBOX_ACCOUNT' })).ok, true);
        const f = settingsPopupFixture({ connected: true, pageClass, popupInitiallyPresent: false,
            disconnectRequest: () => background.send({ type: 'DISCONNECT_XBOX' }) });
        f.openPopup();
        await f.disconnect();
        assert.deepEqual(f.events, ['DISCONNECT_XBOX', 'credentials-deleted', 'server-disconnect']);
        assert.equal(background.state(), null);
        const requestsBeforeRetry = background.events.filter((event) => event.type === 'fetch').length;
        const nextAccount = await background.send({ type: 'FETCH_XBOX_ACCOUNT' });
        assert.equal(nextAccount.ok, false);
        assert.match(nextAccount.error, /XBOX_AUTH_REQUIRED/);
        assert.equal(background.events.filter((event) => event.type === 'fetch').length, requestsBeforeRetry);
    });
}

test('Xbox settings disconnect: the website cannot submit while credential deletion is still pending', async () => {
    const gate = deferred();
    const f = settingsPopupFixture({ connected: true, disconnectRequest: () => gate.promise });
    const click = f.disconnect();
    assert.deepEqual(f.events, ['DISCONNECT_XBOX']);
    assert.equal(f.disconnectLink.getAttribute('aria-disabled'), 'true');
    gate.resolve({ ok: true });
    await click;
    assert.deepEqual(f.events, ['DISCONNECT_XBOX', 'credentials-deleted', 'server-disconnect']);
});

test('Xbox settings disconnect: storage failure prevents website submission, hides provider details and allows a retry', async () => {
    let attempts = 0;
    const f = settingsPopupFixture({ connected: true, disconnectRequest: async () => ++attempts === 1
        ? { ok: false, error: 'SECRET_STORAGE_ERROR' } : { ok: true } });
    await f.disconnect();
    assert.equal(f.events.includes('server-disconnect'), false);
    assert.equal(f.errors.length, 1);
    assertNoCredentials(f.errors);
    assert.equal(f.disconnectLink.getAttribute('aria-disabled'), null);
    await f.disconnect();
    assert.equal(f.events.filter((event) => event === 'server-disconnect').length, 1);
    assert.equal(attempts, 2);
});

test('Xbox settings disconnect: repeated clicks and a replay produce one credential deletion and one website submission', async () => {
    const gate = deferred();
    const f = settingsPopupFixture({ connected: true, disconnectRequest: () => gate.promise });
    const first = f.disconnect();
    const second = f.disconnect();
    assert.deepEqual(f.events, ['DISCONNECT_XBOX']);
    gate.resolve({ ok: true });
    await Promise.all([first, second]);
    assert.deepEqual(f.events, ['DISCONNECT_XBOX', 'credentials-deleted', 'server-disconnect']);
});

test('Xbox settings disconnect: the delegated handler covers nested targets and is bound once when the popup is processed again', async () => {
    const f = settingsPopupFixture({ connected: true });
    f.reprocess();
    const icon = new TileElement('span', 'icon');
    f.disconnectLink.append(icon);
    await f.disconnect(icon);
    assert.equal(f.container.clickOptions.capture, true);
    assert.equal(f.container.clickListenerCount, 1);
    assert.deepEqual(f.events, ['DISCONNECT_XBOX', 'credentials-deleted', 'server-disconnect']);
});

test('Xbox settings disconnect: Steam, Epic, PlayStation and Nintendo links retain their normal website handling', async () => {
    for (const [label, sourceId] of [['Steam + DLCs sync', 64], ['Epic Games sync', 128], ['PlayStation sync', 256], ['Nintendo sync', 512]]) {
        const f = settingsPopupFixture({ label, sourceId, connected: true });
        const event = await f.disconnect();
        assert.equal(event.defaultPrevented, false);
        assert.deepEqual(f.events, ['server-disconnect']);
        assert.equal(f.errors.length, 0);
    }
});


test('Xbox: a link disconnected in another profile deletes its grant before fresh authorization, consent and collection fetching', async () => {
    const f = contentFixture({ connection: { connected: false, accountId: null, username: null } });
    await f.run('Player', accountId, '/connect');
    assert.deepEqual(f.statusRequests, [{ url: 'https://gg.deals/extensionImport/xboxConnection/', payload: {} }]);
    assert.deepEqual(f.events.slice(0, 8), ['DISCONNECT_XBOX', 'FETCH_XBOX_ACCOUNT', 'login', 'START_XBOX_AUTHORIZATION',
        'POLL_XBOX_AUTHORIZATION', 'CANCEL_XBOX_AUTHORIZATION', 'consent', {
        url: 'https://gg.deals/connect', payload: { version: 'test', accountId, username: 'Player' }
    }]);
    assert.equal(f.events.filter((event) => event === 'consent').length, 1);
    assert.equal(f.events.filter((event) => event === 'DISCONNECT_XBOX').length, 1);
    assert.equal(f.events.at(-1).payload.complete, true);
});

test('Xbox: a disconnected link confirms the current browser account rather than the stale tile account', async () => {
    const otherAccount = { accountId: '2533274790000002', username: 'Other player' };
    const f = contentFixture({ connection: { connected: false, accountId: null, username: null },
        browserAccount: otherAccount, authorizedAccount: otherAccount });
    await f.run('Player', accountId, '/connect');
    assert.deepEqual(clone(f.consentPrompts), [{ serviceName: 'Xbox',
        accountLabel: `Other player (ID: ${otherAccount.accountId})` }]);
    const posts = f.events.filter((event) => typeof event === 'object');
    assert.equal(posts.length, 2);
    assert.equal(posts.every((post) => post.payload.accountId === otherAccount.accountId), true);
    assert.equal(f.events.indexOf('DISCONNECT_XBOX') < f.events.indexOf('START_XBOX_AUTHORIZATION'), true);
    assert.equal(f.events.indexOf('START_XBOX_AUTHORIZATION') < f.events.indexOf('consent'), true);
});

test('Xbox: declining a disconnected account sends no connection or collection and removes the stale grant', async () => {
    const f = contentFixture({ connection: { connected: false, accountId: null, username: null }, consent: false });
    await assert.rejects(f.run('Player', accountId, '/connect'), { message: 'Sync canceled: account not confirmed', serverCode: 5 });
    assert.deepEqual(f.events, ['DISCONNECT_XBOX', 'FETCH_XBOX_ACCOUNT', 'login', 'START_XBOX_AUTHORIZATION',
        'POLL_XBOX_AUTHORIZATION', 'CANCEL_XBOX_AUTHORIZATION', 'consent', 'DISCONNECT_XBOX']);
});

test('Xbox: a disconnected server link deletes the grant even when a reloaded tile has no old account metadata', async () => {
    const f = contentFixture({ connection: { connected: false, accountId: null, username: null }, loginConfirmed: false });
    await assert.rejects(f.run('', '', '/connect'), /Sync canceled:/);
    assert.deepEqual(f.events, ['DISCONNECT_XBOX', 'FETCH_XBOX_ACCOUNT', 'login']);
});

test('Xbox: a credential deletion failure stops remote reconnection before any authorization or import', async () => {
    const f = contentFixture({ connection: { connected: false, accountId: null, username: null }, runtime: async () =>
        ({ ok: false, error: 'Xbox credential storage failed' }) });
    await assert.rejects(f.run('Player', accountId, '/connect'), /credential storage failed/);
    assert.deepEqual(f.events, ['DISCONNECT_XBOX']);
});

test('Xbox: a failed reconnection after a remote disconnect stops before collection fetching', async () => {
    const f = contentFixture({ connection: { connected: false, accountId: null, username: null }, connectError: 'HTTP 503' });
    await assert.rejects(f.run('Player', accountId, '/connect'), /HTTP 503/);
    assert.equal(f.events.includes('consent'), true);
    assert.equal(f.events.includes('FETCH_XBOX_COLLECTION_PAGE'), false);
    assert.equal(f.events.filter((event) => typeof event === 'object').length, 1);
});

test('Xbox: fresh server account metadata replaces a stale tile before account confirmation', async () => {
    const f = contentFixture({ connection: { connected: true, accountId, username: 'Player' } });
    await f.run('Stale player', '999', '/connect');
    assert.equal(f.statusRequests.length, 1);
    assert.equal(f.events.includes('consent'), false);
    assert.equal(f.events.filter((event) => typeof event === 'object' && event.url.endsWith('/connect')).length, 0);
    assert.equal(f.events.at(-1).payload.accountId, accountId);
});

for (const [name, options] of [
    ['failed status request', { statusError: new Error('HTTP 503') }],
    ['malformed status response', { statusResponse: {} }],
    ['invalid saved XUID', { statusResponse: { success: true, data: { connected: true, accountId: 123, username: 'Player' } } }]
]) {
    test(`Xbox: ${name} stops before Microsoft requests and retains the local grant`, async () => {
        const f = contentFixture(options);
        await assert.rejects(f.run('Player', accountId, '/connect'));
        assert.equal(f.statusRequests.length, 1);
        assert.deepEqual(f.events, []);
    });
}

for (const serverCode of [5, '5']) {
    test(`Xbox: import error code ${JSON.stringify(serverCode)} after pagination clears the grant, authorizes and fetches a fresh complete snapshot once`, async () => {
        const importError = Object.assign(new Error('Invalid accountId: disconnected'), { serverCode });
        const f = contentFixture({ importError });
        await f.run('Player', accountId, '/connect');
        assert.deepEqual(f.events.map((event) => typeof event === 'object' ? event.url : event), [
            'FETCH_XBOX_ACCOUNT', 'FETCH_XBOX_COLLECTION_PAGE', 'FETCH_XBOX_COLLECTION_PAGE',
            'https://gg.deals/extensionImport/xboxCollection/', 'DISCONNECT_XBOX', 'FETCH_XBOX_ACCOUNT', 'login',
            'START_XBOX_AUTHORIZATION', 'POLL_XBOX_AUTHORIZATION', 'CANCEL_XBOX_AUTHORIZATION', 'consent',
            'https://gg.deals/connect', 'FETCH_XBOX_COLLECTION_PAGE', 'FETCH_XBOX_COLLECTION_PAGE',
            'https://gg.deals/extensionImport/xboxCollection/'
        ]);
        const posts = f.events.filter((event) => typeof event === 'object');
        assert.equal(posts[0].payload.complete, true);
        assert.deepEqual(posts[0].payload, posts[2].payload);
        assert.deepEqual(posts[1].payload, { version: 'test', accountId, username: 'Player' });
    });
}

test('Xbox: declining reconnection after pagination sends no connection or import retry', async () => {
    const f = contentFixture({ consent: false, importError: Object.assign(new Error('Disconnected'), { serverCode: 5 }) });
    await assert.rejects(f.run('Player', accountId, '/connect'), { message: 'Sync canceled: account not confirmed', serverCode: 5 });
    assert.equal(f.events.filter((event) => event === 'consent').length, 1);
    assert.equal(f.events.filter((event) => typeof event === 'object').length, 1);
    assert.equal(f.events.at(-1), 'DISCONNECT_XBOX');
});

test('Xbox: choosing another account after revocation discards the old snapshot and imports only the newly authorized collection', async () => {
    const otherAccount = { accountId: '2533274790000002', username: 'Other player' };
    const otherItem = { ...item, productId: '9N0QWXC09MPT' };
    const f = contentFixture({ authorizedAccount: otherAccount,
        importError: Object.assign(new Error('Disconnected'), { serverCode: 5 }),
        collections: { [accountId]: [[item], [item]], [otherAccount.accountId]: [[otherItem]] } });
    const result = await f.run('Player', accountId, '/connect');
    assert.deepEqual(clone(result), otherAccount);
    const posts = f.events.filter((event) => typeof event === 'object');
    assert.equal(posts[0].payload.accountId, accountId);
    assert.deepEqual(posts[1].payload, { version: 'test', ...otherAccount });
    assert.equal(posts[2].payload.accountId, otherAccount.accountId);
    assert.equal(posts[2].payload.pagesCount, 1);
    assert.equal(posts[2].payload.totalItems, 1);
    assert.deepEqual(posts[2].payload.data, [{ items: [otherItem] }]);
    assertNoCredentials(posts);
});

test('Xbox: repeated revocation stops after one explicit reconnection and one import retry', async () => {
    const f = contentFixture({ importError: Object.assign(new Error('Disconnected'), { serverCode: 5 }), repeatImportError: true });
    await assert.rejects(f.run('Player', accountId, '/connect'), { serverCode: 5 });
    const posts = f.events.filter((event) => typeof event === 'object');
    assert.equal(posts.length, 3);
    assert.equal(f.events.filter((event) => event === 'consent').length, 1);
    assert.equal(f.events.at(-1), 'DISCONNECT_XBOX');
});

test('Xbox: a disconnected import without a connect URL does not retry or bypass the server link', async () => {
    const f = contentFixture({ importError: Object.assign(new Error('Disconnected'), { serverCode: 5 }) });
    await assert.rejects(f.run('Player', accountId), { serverCode: 5 });
    assert.equal(f.events.includes('consent'), false);
    assert.equal(f.events.filter((event) => typeof event === 'object').length, 1);
    assert.equal(f.events.at(-1), 'DISCONNECT_XBOX');
});

test('Xbox: declining remote reconnection deletes real credentials without fetching a collection', async () => {
    const background = backgroundFixture({ state: tokenState() });
    const f = contentFixture({ connection: { connected: false, accountId: null, username: null }, consent: false,
        runtime: (message) => {
            if (message.type === 'POLL_XBOX_AUTHORIZATION') background.advance(5000);
            return background.send(message);
        } });
    await assert.rejects(f.run('Player', accountId, '/connect'), { message: 'Sync canceled: account not confirmed', serverCode: 5 });
    assert.equal(background.state(), null);
    assert.equal(background.events.some((event) => event.url?.hostname === 'collections.mp.microsoft.com'), false);
    assert.deepEqual(f.events, ['DISCONNECT_XBOX', 'FETCH_XBOX_ACCOUNT', 'login', 'START_XBOX_AUTHORIZATION',
        'POLL_XBOX_AUTHORIZATION', 'CANCEL_XBOX_AUTHORIZATION', 'consent', 'DISCONNECT_XBOX']);
});

test('Xbox: remote disconnect clears real stored and cached credentials before offering Microsoft authorization', async () => {
    const background = backgroundFixture({ state: tokenState() });
    await background.send({ type: 'FETCH_XBOX_ACCOUNT' });
    assert.equal(background.state().xuid, accountId);
    background.events.length = 0;
    const f = contentFixture({ connection: { connected: false, accountId: null, username: null }, loginConfirmed: false,
        runtime: (message) => background.send(message) });
    await assert.rejects(f.run('Player', accountId, '/connect'), /Sync canceled:/);
    assert.equal(background.state(), null);
    assert.equal(background.events.some((event) => event.type === 'fetch'), false);
    assert.equal(background.tabs.length, 0);
    assert.deepEqual(f.events, ['DISCONNECT_XBOX', 'FETCH_XBOX_ACCOUNT', 'login', 'DISCONNECT_XBOX']);
});

for (const connectionStatusUrl of [undefined, 'https://other.example/status']) {
    test(`Xbox: ${connectionStatusUrl ? 'cross-origin' : 'missing'} status URL stops before Microsoft or server traffic`, async () => {
        const f = contentFixture();
        await assert.rejects(f.run('Player', accountId, '/connect', { connectionStatusUrl }));
        assert.deepEqual(f.events, []);
        assert.deepEqual(f.statusRequests, []);
    });
}


test('Xbox tile: declining remote reconnection restores Connect and clears stale metadata without an error toast', async () => {
    const f = await tileFixture({ configuredAccountId: accountId, configuredUsername: 'Player', connectUrl: '/connect',
        connection: { connected: false, accountId: null, username: null } });
    const syncing = f.click();
    f.bridge.resolve();
    await f.shown;
    assert.deepEqual(f.events, ['bridge', 'DISCONNECT_XBOX', 'FETCH_XBOX_ACCOUNT', 'prompt']);
    f.prompt.resolve(false);
    await syncing;
    assert.deepEqual(f.events, ['bridge', 'DISCONNECT_XBOX', 'FETCH_XBOX_ACCOUNT', 'prompt', 'DISCONNECT_XBOX', 'unmark']);
    assert.deepEqual(f.errors, []);
    assert.equal(f.host.getAttribute('data-account-id'), null);
    assert.equal(f.host.getAttribute('data-username'), null);
    assert.equal(f.host.querySelector('.action-bottom-text').textContent, 'Connect');
    assert.equal(f.host.classList.contains('connected'), false);
    assert.equal(f.host.classList.contains('new'), false);
    assert.equal(f.host.style.pointerEvents, '');
    assert.equal(f.progressListeners.size, 0);
});

test('Xbox tile: accepting remote reconnection connects and queues the collection in the same click without an error toast', async () => {
    const f = await tileFixture({ configuredAccountId: accountId, configuredUsername: 'Player', connectUrl: '/connect',
        connection: { connected: false, accountId: null, username: null } });
    const syncing = f.click();
    f.bridge.resolve();
    await f.shown;
    assert.equal(f.prompts[0].confirmButtonText, 'Sign in to Xbox');
    assert.match(f.prompts[0].html, /"Xbox" app/);
    assert.match(f.prompts[0].html, /only to read your game collection/);
    assert.match(f.prompts[0].html, /never sent to GG\.deals/);
    assert.equal(f.events.includes('post'), false);
    assert.equal(f.events.includes('FETCH_XBOX_COLLECTION_PAGE'), false);
    f.prompt.resolve(true);
    await f.polling;
    f.authorization.resolve({ accountId, username: 'Player' });
    await syncing;
    assert.deepEqual(f.prompts[1], { serviceName: 'Xbox', accountLabel: `Player (ID: ${accountId})` });
    assert.deepEqual(f.events, ['bridge', 'DISCONNECT_XBOX', 'FETCH_XBOX_ACCOUNT', 'prompt', 'START_XBOX_AUTHORIZATION',
        'POLL_XBOX_AUTHORIZATION', 'CANCEL_XBOX_AUTHORIZATION', 'prompt', 'post', 'FETCH_XBOX_COLLECTION_PAGE', 'post', 'queued']);
    assert.equal(f.host.classList.contains('queued'), true);
    assert.equal(f.host.getAttribute('data-account-id'), accountId);
    assert.equal(f.host.getAttribute('data-username'), 'Player');
    assert.equal(f.errors.length, 0);
});
