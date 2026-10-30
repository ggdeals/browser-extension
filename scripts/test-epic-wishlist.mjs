import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function compile(path) {
    return ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
}

const constantsModule = { exports: {} };
vm.runInNewContext(compile('../src/utils/sync-constants.ts'), {
    module: constantsModule, exports: constantsModule.exports,
    chrome: { runtime: { getManifest: () => ({ version: 'test' }) } }
});
const constants = constantsModule.exports;
const wishlistCode = compile('../src/integrations/epic/wishlist.ts');

function response(payload, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
}
const items = { elements: [{ id: 'wish-1', offerId: 'offer-1', namespace: 'game' }] };
const success = () => response({ data: { Wishlist: { wishlistItems: items } } });
const notLoggedIn = (status = 200) => response({
    errors: [{
        message: 'Unexpected error value: { success: false, message: "WishlistQuery/wishlistItems: WishlistQuery/wishlistToast: com.epicgames.wishlist.notLoggedIn" }',
        status: 500
    }],
    data: { Wishlist: { wishlistItems: null } }
}, status);

function loadWishlist(handleRequest, options = {}) {
    let now = 0;
    const events = [];
    const timeouts = new WeakMap();
    const module = { exports: {} };
    const browser = {
        tabs: {
            create: async (config) => {
                events.push({ type: 'open', ...config });
                if (options.createError) throw options.createError;
                return { id: 42 };
            },
            remove: async (id) => {
                events.push({ type: 'close', id });
                if (options.closeError) throw options.closeError;
            }
        }
    };
    vm.runInNewContext(wishlistCode, {
        module, exports: module.exports,
        require: (name) => {
            if (name === 'webextension-polyfill') return { default: browser };
            if (name.endsWith('sync-constants')) return constants;
            throw new Error(`Unexpected dependency: ${name}`);
        },
        URL,
        Date: { now: () => now },
        setTimeout: (callback, ms) => { now += ms; queueMicrotask(callback); },
        AbortSignal: { timeout: (ms) => {
            const signal = new AbortController().signal;
            timeouts.set(signal, ms);
            return signal;
        } },
        fetch: async (url, config) => {
            const event = { type: 'fetch', url: new URL(url), config, now, timeout: timeouts.get(config.signal) };
            events.push(event);
            return handleRequest(event, {
                events,
                advance: (ms) => { now += ms; }
            });
        },
        console: { warn() {} }
    });
    return { run: () => module.exports.fetchEpicWishlist('launcher-token', 'account-1'), events };
}

function assertWishlistRequest(event) {
    assert.equal(event.url.origin + event.url.pathname, constants.EPIC_STORE_WISHLIST_URL);
    assert.equal(event.url.searchParams.get('operationName'), 'getWishlist');
    assert.deepEqual(JSON.parse(event.url.searchParams.get('variables')), { accountId: 'account-1' });
    assert.equal(JSON.parse(event.url.searchParams.get('extensions')).persistedQuery.sha256Hash, constants.EPIC_WISHLIST_PERSISTED_QUERY_HASH);
    assert.equal(event.config.credentials, 'include');
    assert.equal(event.config.cache, 'no-store');
    assert.equal(event.config.headers.Authorization, 'bearer launcher-token');
    assert.ok(event.timeout > 0);
}

test('a working session returns the wishlist without refreshing or opening tabs', async () => {
    const harness = loadWishlist((event) => { assertWishlistRequest(event); return success(); });
    assert.deepEqual(await harness.run(), items);
    assert.equal(harness.events.length, 1);
});

for (const status of [200, 500]) {
    test(`GraphQL notLoggedIn (HTTP ${status}) awaits cookie refresh before retrying`, async () => {
        let finishRefresh;
        const refresh = new Promise(resolve => { finishRefresh = resolve; });
        let wishlistRequests = 0;
        const harness = loadWishlist((event) => {
            if (event.url.pathname === '/auth-healthcheck') {
                assert.equal(event.config.credentials, 'include');
                assert.equal(event.config.cache, 'no-store');
                assert.equal(event.config.headers, undefined);
                return refresh;
            }
            assertWishlistRequest(event);
            return ++wishlistRequests === 1 ? notLoggedIn(status) : success();
        });
        const result = harness.run();
        // Let the initial fetch and response parsing reach the refresh request.
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(wishlistRequests, 1);
        assert.equal(harness.events.at(-1).url.pathname, '/auth-healthcheck');
        finishRefresh(response({}));
        assert.deepEqual(await result, items);
        assert.equal(wishlistRequests, 2);
        assert.equal(harness.events.some(event => event.type === 'open'), false);
    });
}

test('fallback keeps the wishlist page open beyond three seconds until authenticated data is available', async () => {
    const harness = loadWishlist((event, { events }) => {
        if (event.url.pathname === '/auth-healthcheck') return response({});
        assertWishlistRequest(event);
        assert.equal(events.some(event => event.type === 'close'), false);
        return event.now >= 4500 ? success() : notLoggedIn();
    });
    assert.deepEqual(await harness.run(), items);
    const open = harness.events.find(event => event.type === 'open');
    assert.equal(open.url, constants.EPIC_STORE_WISHLIST_PAGE_URL);
    assert.equal(open.active, false);
    assert.equal(harness.events.at(-2).now, 4500);
    assert.deepEqual(harness.events.at(-1), { type: 'close', id: 42 });
});

for (const refreshFailure of ['HTTP error', 'network error']) {
    test(`a refresh ${refreshFailure} can recover through the wishlist page`, async () => {
        const harness = loadWishlist((event, { events }) => {
            if (event.url.pathname === '/auth-healthcheck') {
                if (refreshFailure === 'network error') throw new TypeError('Failed to fetch');
                return response({}, 401);
            }
            return events.some(event => event.type === 'open') ? success() : notLoggedIn();
        });
        assert.deepEqual(await harness.run(), items);
        assert.deepEqual(harness.events.at(-1), { type: 'close', id: 42 });
    });
}

test('a genuinely expired session stops at the deadline, closes its tab and requests login', async () => {
    const harness = loadWishlist(event => event.url.pathname === '/auth-healthcheck' ? response({}) : notLoggedIn());
    await assert.rejects(harness.run(), { message: constants.EPIC_WISHLIST_AUTH_REQUIRED });
    assert.deepEqual(harness.events.at(-1), { type: 'close', id: 42 });
    const polls = harness.events.filter(event => event.type === 'fetch' && event.now > 0);
    assert.ok(polls.length > 1);
    assert.ok(polls.length <= constants.EPIC_STORE_WARMUP_TIMEOUT_MS / constants.EPIC_STORE_WARMUP_POLL_INTERVAL_MS);
    assert.ok(polls.every(event => event.now + event.timeout <= constants.EPIC_STORE_WARMUP_TIMEOUT_MS));
});

test('a failed page request closes the temporary tab and preserves the error', async () => {
    const harness = loadWishlist((event, { events }) => {
        if (event.url.pathname === '/auth-healthcheck') return response({});
        if (events.some(event => event.type === 'open')) throw new TypeError('Network failed');
        return notLoggedIn();
    });
    await assert.rejects(harness.run(), /Network failed/);
    assert.deepEqual(harness.events.at(-1), { type: 'close', id: 42 });
});

test('unrelated GraphQL errors are propagated without authentication recovery', async () => {
    const harness = loadWishlist(() => response({ errors: [{ message: 'Service unavailable' }] }, 500));
    await assert.rejects(harness.run(), /Service unavailable/);
    assert.equal(harness.events.length, 1);
});

test('null wishlist data is not treated as a successful or empty import', async () => {
    const harness = loadWishlist(() => response({ data: { Wishlist: { wishlistItems: null } } }));
    await assert.rejects(harness.run(), /missing wishlistItems/);
    assert.equal(harness.events.length, 1);
});

test('an empty authenticated wishlist is returned normally', async () => {
    const emptyItems = { elements: [] };
    const harness = loadWishlist(() => response({ data: { Wishlist: { wishlistItems: emptyItems } } }));
    assert.deepEqual(await harness.run(), emptyItems);
});

test('tab cleanup failure does not discard a successfully recovered wishlist', async () => {
    const harness = loadWishlist((event, { events }) => {
        if (event.url.pathname === '/auth-healthcheck') return response({}, 503);
        return events.some(event => event.type === 'open') ? success() : notLoggedIn();
    }, { closeError: new Error('Tab already closed') });
    assert.deepEqual(await harness.run(), items);
});
