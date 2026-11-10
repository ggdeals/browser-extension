import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const helpersSource = ts.transpileModule(readFileSync(new URL('../src/utils/sync-helpers.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const bridgeSource = readFileSync(new URL('../src/csrf-page-bridge.js', import.meta.url), 'utf8');

function popupBridgeFixture({ open = true, present = true, available = true } = {}) {
    const calls = [];
    const posts = [];
    const listeners = new Set();
    const modal = { id: 'ajax-collection-modal', classList: { contains: () => open } };
    const popup = { closest: () => modal };
    const document = { documentElement: {}, body: {}, getElementById: (id) => present && id === 'user-extension-settings' ? popup : null };
    const window = {
        location: { origin: 'https://gg.deals' }, setTimeout, clearTimeout,
        addEventListener: (_name, callback) => listeners.add(callback),
        removeEventListener: (_name, callback) => listeners.delete(callback),
        postMessage: (data) => {
            for (const listener of [...listeners]) void listener({ source: window, data });
        }
    };
    vm.runInNewContext(bridgeSource, { window, document, URL, Error,
        Component: available ? { Popups: { getAjaxModal: (selector) => { calls.push(['modal', selector]); } } } : undefined,
        jQuery: (element) => ({ trigger: (event) => {
            assert.equal(element, modal);
            calls.push(['reload', event]);
        } }),
        Helpers: { Csrf: { postJson: async (url, payload) => {
            posts.push({ url, payload });
            return new Response(JSON.stringify({ code: 0 }), { status: 200 });
        } } }
    });
    const module = { exports: {} };
    vm.runInNewContext(helpersSource, { module, exports: module.exports, window, document, URL, Headers, Error,
        chrome: { runtime: { getURL: (path) => `extension://${path}` } },
        require: (name) => name.endsWith('extension-settings')
            ? { processExtensionResponse: async () => {} } : { default: {} },
        console: { log() {}, warn() {} }
    });
    return { calls, posts, listeners, refresh: module.exports.refreshExtensionSettingsPopupViaPage,
        post: module.exports.sendMessageToServer,
        foreignRequest: () => {
            for (const listener of [...listeners]) void listener({ source: {},
                data: { type: 'GGDEALS_REFRESH_EXTENSION_SETTINGS_REQUEST', requestId: 'foreign' } });
        }
    };
}

test('Settings popup: the real RPC bridge reloads the existing modal without another account POST', async () => {
    const f = popupBridgeFixture();
    await f.refresh();
    assert.deepEqual(f.calls, [['modal', '#ajax-collection-modal'], ['reload', 'show.bs.modal']]);
    assert.equal(f.posts.length, 0);
    assert.equal(f.listeners.size, 1);
});

test('Settings popup: closing the popup before a connection finishes does not reopen it', async () => {
    for (const options of [{ open: false }, { present: false }]) {
        const f = popupBridgeFixture(options);
        await f.refresh();
        assert.deepEqual(f.calls, []);
        assert.equal(f.posts.length, 0);
    }
});

test('Settings popup: an unavailable page component reports a refresh failure without repeating the connection', async () => {
    const f = popupBridgeFixture({ available: false });
    await assert.rejects(f.refresh(), /Settings popup refresh is not available/);
    assert.deepEqual(f.calls, []);
    assert.equal(f.posts.length, 0);
    assert.equal(f.listeners.size, 1);
});

test('Settings popup: messages from another window cannot trigger a refresh', () => {
    const f = popupBridgeFixture();
    f.foreignRequest();
    assert.deepEqual(f.calls, []);
});

test('Settings popup: extending the bridge preserves the existing CSRF account save', async () => {
    const f = popupBridgeFixture();
    const payload = { version: 'test', accountId: '2533274790000001', username: 'Player', overwrite: true };
    const response = await f.post('/settings/connectExtension/?source=32', payload);
    assert.equal(response.code, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(f.posts)), [{ url: '/settings/connectExtension/?source=32', payload }]);
    assert.deepEqual(f.calls, []);
});
