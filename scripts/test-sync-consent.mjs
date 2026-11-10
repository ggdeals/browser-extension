import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function compile(file) {
    return ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
}

const helpersSource = compile('../src/utils/sync-helpers.ts');
const accountSource = compile('../src/utils/sync-account.ts');
const bridgeSource = readFileSync(new URL('../src/csrf-page-bridge.js', import.meta.url), 'utf8');

function consentFixture({ pendingPost = false } = {}) {
    let now = 0;
    let nextTimer = 0;
    const timers = new Map();
    const listeners = new Map();
    const dialogs = [];
    const posts = [];
    const window = {
        location: { origin: 'https://gg.deals' },
        setTimeout: (callback, delay) => {
            const id = ++nextTimer;
            timers.set(id, { at: now + delay, callback });
            return id;
        },
        clearTimeout: (id) => timers.delete(id),
        addEventListener: (type, callback) => {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(callback);
        },
        removeEventListener: (type, callback) => listeners.get(type)?.delete(callback),
        postMessage: (data) => {
            if (data.type === 'GGDEALS_SWAL_REQUEST') dialogs.push(data);
            for (const callback of [...listeners.get('message') ?? []]) void callback({ source: window, data });
        }
    };
    const document = { documentElement: {}, body: {} };
    vm.runInNewContext(bridgeSource, { window, document, URL, Error,
        Helpers: { Csrf: { postJson: async (url, payload) => {
            posts.push({ url, payload: JSON.parse(JSON.stringify(payload)) });
            if (pendingPost) return new Promise(() => {});
            return new Response(JSON.stringify({ code: 0 }), { status: 200 });
        } } }
    });
    const helpersModule = { exports: {} };
    vm.runInNewContext(helpersSource, { module: helpersModule, exports: helpersModule.exports,
        window, document, URL, Headers, Error,
        chrome: { runtime: { getURL: (file) => `extension://${file}` } },
        require: (name) => name.endsWith('extension-settings')
            ? { processExtensionResponse: async () => {} } : { default: {} },
        console: { log() {}, warn() {} }
    });
    const accountModule = { exports: {} };
    vm.runInNewContext(accountSource, { module: accountModule, exports: accountModule.exports, Error,
        require: (name) => name.endsWith('sync-helpers') ? helpersModule.exports : { EXTENSION_VERSION: 'test' }
    });
    const account = { accountId: '2533274790000001', username: 'Player' };
    const sync = accountModule.exports.createAccountSync({
        serviceName: 'Xbox', account, accountLabel: 'Player (ID: 2533274790000001)',
        configuredUsername: '', connectUrl: '/settings/connectExtension/?source=32',
        postData: helpersModule.exports.sendMessageToServer
    });
    return { posts, dialogs, listeners, timers,
        connect: async () => {
            await sync.confirmAccountBeforeLibraryFetch();
            await sync.connectAccount();
        },
        answer: (confirmed, requestId = dialogs.at(-1)?.requestId) =>
            window.postMessage({ type: 'GGDEALS_SWAL_RESULT', requestId, confirmed }),
        hide: () => { for (const callback of [...listeners.get('pagehide') ?? []]) callback(); },
        advance: async (milliseconds) => {
            now += milliseconds;
            for (const [id, timer] of [...timers]) {
                if (timer.at <= now) { timers.delete(id); timer.callback(); }
            }
            await Promise.resolve();
        }
    };
}

test('Sync consent: Continue after more than 20 seconds still saves the account on the first attempt', async () => {
    const f = consentFixture();
    let settled = false;
    const result = f.connect().then(() => { settled = true; return null; }, (error) => { settled = true; return error; });
    await f.advance(21000);
    assert.equal(settled, false);
    assert.equal(f.posts.length, 0);
    f.answer(true);
    assert.equal(await result, null);
    assert.deepEqual(f.posts, [{ url: '/settings/connectExtension/?source=32',
        payload: { version: 'test', accountId: '2533274790000001', username: 'Player' } }]);
    assert.equal(f.listeners.get('message').size, 1);
    assert.equal(f.listeners.get('pagehide')?.size ?? 0, 0);
    assert.equal(f.timers.size, 0);
});

test('Sync consent: Cancel after a long wait sends no account POST and releases the listener', async () => {
    const f = consentFixture();
    const result = f.connect().catch((error) => error);
    await f.advance(300000);
    f.answer(false);
    assert.match((await result).message, /Sync canceled:/);
    assert.equal(f.posts.length, 0);
    assert.equal(f.listeners.get('message').size, 1);
    assert.equal(f.listeners.get('pagehide')?.size ?? 0, 0);
    assert.equal(f.timers.size, 0);
});

test('Sync consent: leaving the page cancels a pending prompt and ignores a later confirmation', async () => {
    const f = consentFixture();
    const result = f.connect().catch((error) => error);
    f.hide();
    assert.match((await result).message, /Sync canceled:/);
    f.answer(true);
    assert.equal(f.posts.length, 0);
    assert.equal(f.listeners.get('message').size, 1);
    assert.equal(f.listeners.get('pagehide').size, 0);
});

test('Sync consent: another prompt cannot confirm this account', async () => {
    const f = consentFixture();
    let settled = false;
    const result = f.connect().then(() => { settled = true; });
    f.answer(true, 'another-request');
    await f.advance(21000);
    assert.equal(settled, false);
    assert.equal(f.posts.length, 0);
    f.answer(true);
    await result;
    assert.equal(f.posts.length, 1);
});

test('Sync consent: the account POST still times out after confirmation when the server does not answer', async () => {
    const f = consentFixture({ pendingPost: true });
    const result = f.connect().catch((error) => error);
    f.answer(true);
    // Let the confirmation finish and start the separate CSRF request.
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(f.posts.length, 1);
    await f.advance(30000);
    assert.match((await result).message, /postJson request timed out/);
    assert.equal(f.listeners.get('message').size, 1);
});
