import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const compiledModules = new Map();
function compile(path) {
    if (!compiledModules.has(path)) {
        compiledModules.set(path, ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
        }).outputText);
    }
    return compiledModules.get(path);
}

const providers = {
    nintendo: { account: 'FETCH_NINTENDO_ACCOUNT', collection: 'FETCH_NINTENDO_COLLECTION', wishlist: 'FETCH_NINTENDO_WISHLIST' },
    playstation: { account: 'FETCH_PLAYSTATION_ACCOUNT', collection: 'FETCH_PLAYSTATION_COLLECTION', wishlist: 'FETCH_PLAYSTATION_WISHLIST' },
    epic: { account: 'FETCH_EPIC_TOKEN', collection: 'FETCH_EPIC_LIBRARY_ITEMS', wishlist: 'FETCH_EPIC_LIBRARY_ITEMS' },
    steam: { account: 'FETCH_STEAM_ACCOUNT_NAME', collection: 'FETCH_STEAM_USERDATA', wishlist: 'FETCH_STEAM_USERDATA', ignorelist: 'FETCH_STEAM_USERDATA' }
};
const constants = {
    EXTENSION_VERSION: 'test',
    STEAM_SOURCE_ID: 64, EPIC_SOURCE_ID: 128, PLAYSTATION_SOURCE_ID: 256, NINTENDO_SOURCE_ID: 512,
    STEAM_COLLECTION_SYNC_BUTTON_ID: 'steam-collection', STEAM_WISHLIST_BUTTON_ID: 'steam-wishlist', STEAM_IGNORELIST_BUTTON_ID: 'steam-ignorelist',
    EPIC_GAMES_COLLECTION_SYNC_BUTTON_ID: 'epic-collection', EPIC_GAMES_WISHLIST_SYNC_BUTTON_ID: 'epic-wishlist',
    PLAYSTATION_COLLECTION_SYNC_BUTTON_ID: 'playstation-collection', PLAYSTATION_WISHLIST_SYNC_BUTTON_ID: 'playstation-wishlist',
    NINTENDO_COLLECTION_SYNC_BUTTON_ID: 'nintendo-collection', NINTENDO_WISHLIST_SYNC_BUTTON_ID: 'nintendo-wishlist',
    USER_SETTINGS_PAGE_CLASSNAME: 'user-settings-page', EXTENSION_INSTALLED_CLASSNAME: 'installed'
};

class FakeElement {
    constructor(id = '', attributes = {}) {
        this.id = id;
        this.attributes = attributes;
        this.dataset = {};
        this.style = {};
        this.childNodes = [];
        const classes = new Set();
        this.classList = { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) };
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    matches() { return false; }
    closest() { return null; }
    querySelector() { return null; }
    replaceChildren() {}
    addEventListener(_name, callback) { this.click = callback; }
}

function loadSync(provider, target, options = {}) {
    const { confirmed = true, accountConnected = true, username = 'player', libraryAccountId = 'account-1',
        libraryUsername = username, importError, connectError, configuredUsername = '', configuredAccountId = '' } = options;
    const events = [];
    const posts = [];
    let importAttempts = 0;
    const providerConnectUrl = `/connect/${provider === 'playstation' ? 'pswishlist' : provider}`;
    const element = new FakeElement(`${provider}-${target}`, {
        'data-link-to-import': '/import', 'data-connect-url': providerConnectUrl,
        'data-username': configuredUsername, 'data-account-id': configuredAccountId
    });
    const settings = new FakeElement();
    settings.querySelectorAll = () => [element];
    const body = new FakeElement();
    if (options.settings) body.classList.add('user-settings-page');
    const document = {
        body, documentElement: new FakeElement(),
        querySelector: () => settings,
        getElementById: (id) => id === element.id ? element : null
    };
    const sendRuntimeMessage = async (message) => {
        events.push(['fetch', message.type]);
        if (message.type === providers[provider].account) {
            if (!accountConnected) return { ok: false, error: 'AUTH_REQUIRED' };
            return { ok: true, data: {
                accountId: 'account-1', username, onlineId: username,
                displayName: username, access_token: 'token', account_id: 'account-1',
                account_name: username, steamid: 'account-1'
            } };
        }
        assert.equal(message.type, providers[provider][target]);
        if (provider === 'epic') assert.equal(message.isWishlist, target === 'wishlist');
        return { ok: true, data: {
            accountId: libraryAccountId, username: libraryUsername, onlineId: libraryUsername,
            items: ['game'], games: ['game'], apolloState: ['wish'], rgOwnedApps: ['game']
        } };
    };
    const helpers = {
        requestUserIdConsentViaPageSwal: async () => { events.push(['confirm']); return confirmed; },
        sendRuntimeMessage,
        sendMessageToServer: async (url, payload) => {
            const action = url.includes('/connect/') ? 'connect' : 'import';
            events.push([action]);
            posts.push({ action, payload });
            if (action === 'connect' && connectError) throw new Error(connectError);
            if (action === 'import' && importAttempts++ === 0 && importError) throw new Error(importError);
        },
        markSourceNewViaPageSyncWidget: async () => { events.push(['sync-start']); },
        markSourceQueuedViaPageSyncWidget: async () => { events.push(['queued']); },
        resetSourceStateViaPageSyncWidget: async () => { events.push(['reset']); },
        unmarkAsNewViaPageSyncWidget: async () => { events.push(['unmark']); },
        toErrorMessage: (error) => error.message ?? String(error),
        bindSyncPaginationProgressDescription: () => () => {},
        isElementInSyncingState: () => false,
        isSyncCanceledError: (error) => error.message.includes('Sync canceled:'),
        lockElementSyncClick: () => {}, unlockElementSyncClick: () => {},
        lookForElement: async () => element,
        persistTrimmedAttribute: (el, name, value) => el.setAttribute(name, value.trim()),
        readTrimmedAttribute: (el, name) => el.getAttribute(name)?.trim() ?? '',
        restoreSyncElementSnapshot: () => {}, snapshotSyncElement: () => null,
        callSwal: async () => true, showErrorToast: async () => {}, showWarningToast: async () => {}
    };
    const modules = new Map();
    function load(path) {
        if (modules.has(path)) return modules.get(path);
        const module = { exports: {} };
        modules.set(path, module.exports);
        const require = (name) => {
            if (name.endsWith('sync-constants')) return constants;
            if (name.endsWith('sync-error-messages')) return Object.fromEntries(['NINTENDO', 'PLAYSTATION', 'EPIC', 'STEAM'].map((p) => [`${p}_SYNC_ERROR_MESSAGES`, {}]));
            if (name.endsWith('sync-helpers')) return helpers;
            if (name.endsWith('sync-account')) return load('../src/utils/sync-account.ts');
            if (name === 'webextension-polyfill') return { default: { runtime: { sendMessage: sendRuntimeMessage } } };
            if (name.startsWith('./integrations/')) return load(`../src/${name.slice(2)}/index.ts`);
            throw new Error(`Unexpected dependency: ${name}`);
        };
        vm.runInNewContext(compile(path), {
            module, exports: module.exports, require, document, Element: FakeElement,
            MutationObserver: class { observe() {} },
            window: { location: { origin: 'https://gg.deals', hostname: 'gg.deals', pathname: '/' } },
            URL, console: { log() {}, warn() {}, error() {} }
        });
        modules.set(path, module.exports);
        return module.exports;
    }
    const sync = load(`../src/integrations/${provider}/index.ts`);
    return {
        events, posts, element,
        run: (name = configuredUsername, id = configuredAccountId, connectUrl = providerConnectUrl) => provider === 'playstation'
            ? sync[`sync${target[0].toUpperCase()}${target.slice(1)}ByImportUrl`]('/import', name, undefined, connectUrl, id)
            : sync[`sync${target[0].toUpperCase()}${target.slice(1)}ByImportUrl`]('/import', name, connectUrl, id),
        click: async () => {
            if (options.settings) load('../src/content-settings.ts');
            else {
                sync.default([element.id]);
                await Promise.resolve();
            }
            await element.click({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, target: element });
        }
    };
}

for (const [provider, targets] of Object.entries(providers)) {
    for (const target of Object.keys(targets).filter((t) => t !== 'account')) {
        const accountFetch = ['fetch', targets.account];
        const libraryFetch = ['fetch', targets[target]];
        test(`${provider} ${target}: confirm before library fetch, preserving connect/import payloads`, async () => {
            const { run, events, posts } = loadSync(provider, target);
            await run();
            assert.deepEqual(events, provider === 'steam'
                ? [accountFetch, ['confirm'], libraryFetch, ['connect'], ['import']]
                : [accountFetch, ['confirm'], ['connect'], libraryFetch, ['import']]);
            assert.equal(posts[0].payload.accountId, 'account-1');
            assert.equal(posts[0].payload.username, 'player');
            assert.equal(posts[0].payload.version, 'test');
            assert.equal(posts[0].payload.overwrite, undefined);
            if (provider === 'steam') assert.deepEqual(posts[0].payload.data, posts[1].payload.data);
            const imported = posts[1].payload.data;
            if (provider === 'nintendo' || provider === 'playstation') {
                assert.deepEqual(JSON.parse(JSON.stringify(imported)), target === 'collection' ? [{ games: ['game'] }] : [provider === 'nintendo' ? 'game' : 'wish']);
            }
        });
        test(`${provider} ${target}: matching connected account needs no new confirmation`, async () => {
            const { run, events } = loadSync(provider, target);
            await run('player', 'account-1');
            assert.deepEqual(events, [accountFetch, libraryFetch, ['import']]);
        });
        test(`${provider} ${target}: cancellation prevents library fetch and POST`, async () => {
            const { run, events } = loadSync(provider, target, { confirmed: false });
            await assert.rejects(run(), /Sync canceled: account not confirmed/);
            assert.deepEqual(events, [accountFetch, ['confirm']]);
        });
        test(`${provider} ${target}: authentication failure prevents library fetch`, async () => {
            const { run, events } = loadSync(provider, target, { accountConnected: false });
            await assert.rejects(run(), /AUTH_REQUIRED/);
            assert.deepEqual(events, [accountFetch]);
        });
        test(`${provider} ${target}: different legacy username prompts before fetching and overwrites`, async () => {
            const { run, events, posts } = loadSync(provider, target);
            await run('old-player');
            assert.ok(events.findIndex(([a]) => a === 'confirm') < events.findIndex(([a, t]) => a === 'fetch' && t === targets[target]));
            assert.equal(posts[0].payload.overwrite, true);
        });
        test(`${provider} ${target}: server mismatch reconnects with consent and retries once`, async () => {
            const { run, events, posts } = loadSync(provider, target, { importError: 'Invalid accountId: old-id' });
            await run('player', 'account-1');
            assert.deepEqual(events, [accountFetch, libraryFetch, ['import'], ['confirm'], ['connect'], ['import']]);
            assert.equal(posts[1].payload.overwrite, true);
        });
        test(`${provider} ${target}: canceled mismatch recovery does not overwrite`, async () => {
            const { run, events } = loadSync(provider, target, { importError: 'Invalid accountId: old-id', confirmed: false });
            await assert.rejects(run('player', 'account-1'), /Sync canceled:/);
            assert.deepEqual(events, [accountFetch, libraryFetch, ['import'], ['confirm']]);
        });
        test(`${provider} ${target}: unrelated import errors never reconnect`, async () => {
            const { run, events } = loadSync(provider, target, { importError: 'server unavailable' });
            await assert.rejects(run('player', 'account-1'), /server unavailable/);
            assert.deepEqual(events, [accountFetch, libraryFetch, ['import']]);
        });
        test(`${provider} ${target}: mismatch after a new connection is not retried`, async () => {
            const { run, events } = loadSync(provider, target, { importError: 'Invalid accountId: old-id' });
            await assert.rejects(run(), /Invalid accountId:/);
            assert.equal(events.filter(([a]) => a === 'confirm').length, 1);
            assert.equal(events.filter(([a]) => a === 'connect').length, 1);
            assert.equal(events.filter(([a]) => a === 'import').length, 1);
        });
        test(`${provider} ${target}: missing connect URL prevents library fetch`, async () => {
            const { run, events } = loadSync(provider, target);
            await assert.rejects(run('', '', null), /Missing connect URL/);
            assert.deepEqual(events, [accountFetch, ['confirm']]);
        });
        test(`${provider} ${target}: tile cancellation restores widget without queuing or fetching`, async () => {
            const { click, events } = loadSync(provider, target, { confirmed: false });
            await click();
            assert.deepEqual(events, [['sync-start'], accountFetch, ['confirm'], ['unmark']]);
        });
        test(`${provider} ${target}: tile queues only after importing`, async () => {
            const { click, events, element } = loadSync(provider, target);
            await click();
            assert.equal(events[0][0], 'sync-start');
            assert.deepEqual(events.slice(-2), [['import'], ['queued']]);
            assert.equal(element.getAttribute('data-username'), 'player');
            if (provider !== 'steam') assert.equal(element.getAttribute('data-account-id'), 'account-1');
        });
        if (provider !== 'steam') {
            test(`${provider} ${target}: changed account ID prompts even with the same username`, async () => {
                const { run, posts, events } = loadSync(provider, target);
                await run('player', 'account-2');
                assert.equal(posts[0].payload.overwrite, true);
                assert.deepEqual(events, [accountFetch, ['confirm'], ['connect'], libraryFetch, ['import']]);
            });
            test(`${provider} ${target}: ID alone identifies a connected account`, async () => {
                const { run, events } = loadSync(provider, target);
                await run('', 'account-1');
                assert.deepEqual(events, [accountFetch, libraryFetch, ['import']]);
            });
            test(`${provider} ${target}: failed connection prevents library fetch`, async () => {
                const { run, events } = loadSync(provider, target, { connectError: 'connection failed' });
                await assert.rejects(run(), /connection failed/);
                assert.deepEqual(events, [accountFetch, ['confirm'], ['connect']]);
            });
        }
        if (provider === 'nintendo' || provider === 'playstation') {
            test(`${provider} ${target}: account switch during fetch prevents import`, async () => {
                const { run, events } = loadSync(provider, target, { libraryAccountId: 'account-2' });
                await assert.rejects(run('player', 'account-1'), /account changed during/);
                assert.deepEqual(events, [accountFetch, libraryFetch]);
            });
        }
    }
    test(`${provider}: settings cancellation restores UI without queuing or fetching`, async () => {
        const target = provider === 'playstation' ? 'wishlist' : 'collection';
        const { click, events, element } = loadSync(provider, target, { confirmed: false, settings: true });
        await click();
        assert.deepEqual(events, provider === 'epic'
            ? [['fetch', targets.account], ['confirm']]
            : [['sync-start'], ['fetch', targets.account], ['confirm'], ['unmark']]);
        assert.equal(element.dataset.ggdealsSyncBusy, '0');
        assert.equal(element.classList.contains('syncing'), false);
    });
    test(`${provider}: settings queue after importing and mark the account connected`, async () => {
        const target = provider === 'playstation' ? 'wishlist' : 'collection';
        const { click, events, posts, element } = loadSync(provider, target, { settings: true });
        await click();
        // Settings use the connect URL for both the account POST and the data import.
        assert.deepEqual(events.slice(-2), [['connect'], ['queued']]);
        assert.equal(posts.length, 2);
        assert.ok(posts[1].payload.data);
        assert.equal(element.dataset.ggdealsSyncBusy, '0');
        assert.equal(element.classList.contains('syncing'), false);
        assert.equal(element.classList.contains('connected'), true);
    });
}

test('Nintendo: missing nickname still confirms by account ID and imports', async () => {
    const { run, events, posts } = loadSync('nintendo', 'collection', { username: '', libraryUsername: 'nickname' });
    await run();
    assert.equal(events[1][0], 'confirm');
    assert.equal(posts[1].payload.accountId, 'account-1');
});

test('Nintendo: configured username is never attached to a different account ID', async () => {
    const { run, posts } = loadSync('nintendo', 'collection', { username: '', libraryUsername: '' });
    await run('old-player', 'account-2');
    assert.equal(posts[0].payload.username, '');
    assert.equal(posts[0].payload.overwrite, true);
});
