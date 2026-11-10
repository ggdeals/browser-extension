import type { XboxAccount } from './client';

// This home page still exposes the session's own user in PRELOADED_STATE.
// /play/user redirects to the new app, whose SSR state omits that identity.
const SESSION_URL = 'https://www.xbox.com/en-us/home_alt/dark/home';
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const SESSION_ERROR = 'XBOX_BROWSER_SESSION_UNAVAILABLE';

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function profileAccount(html: string): XboxAccount | null {
    for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
        const assignment = /(?:^|[;\r\n])\s*window\.__PRELOADED_STATE__\s*=\s*\{/.exec(script);
        if (!assignment) continue;
        const start = assignment.index + assignment[0].length - 1;
        let depth = 0;
        let quoted = false;
        let escaped = false;
        for (let index = start; index < script.length; index++) {
            const char = script[index];
            if (quoted) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') quoted = false;
            } else if (char === '"') quoted = true;
            else if (char === '{') depth++;
            else if (char === '}' && --depth === 0) {
                // Parse the server's JSON only; never execute Xbox page scripts.
                const state: unknown = JSON.parse(script.slice(start, index + 1));
                if (!object(state) || !object(state.user)) throw new Error(SESSION_ERROR);
                if (typeof state.user.isSignedIn !== 'boolean') throw new Error(SESSION_ERROR);
                // A signed-out response can retain stale profile metadata.
                // The explicit session flag takes precedence over any XUID.
                if (!state.user.isSignedIn) return null;
                const info = state.user.userInfo;
                if (!object(info) || typeof info.xuid !== 'string' || !/^\d+$/.test(info.xuid)) {
                    throw new Error(SESSION_ERROR);
                }
                return { accountId: info.xuid,
                    username: typeof info.gamerTag === 'string' && info.gamerTag.trim() ? info.gamerTag : info.xuid };
            }
        }
        throw new Error(SESSION_ERROR);
    }
    throw new Error(SESSION_ERROR);
}

function isXboxSessionUrl(url: URL): boolean {
    return url.origin === 'https://www.xbox.com'
        && /^\/[a-z]{2}-[a-z]{2}\/home_alt\/dark\/home\/?$/i.test(url.pathname);
}

export async function fetchXboxBrowserAccount(request: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<XboxAccount | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        // This identity comes from Xbox.com's cookies, independently of our OAuth grant.
        const response = await request(SESSION_URL, { method: 'GET', credentials: 'include', cache: 'no-store',
            redirect: 'follow', headers: { Accept: 'text/html' }, signal: controller.signal });
        const finalUrl = new URL(response.url);
        if (!response.ok || !isXboxSessionUrl(finalUrl) || !response.body) {
            throw new Error(SESSION_ERROR);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let size = 0;
        let html = '';
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > MAX_RESPONSE_BYTES) {
                await reader.cancel();
                throw new Error(SESSION_ERROR);
            }
            html += decoder.decode(chunk.value, { stream: true });
        }
        html += decoder.decode();
        return profileAccount(html);
    } catch {
        // HTML can contain Microsoft credentials; return no body or provider error details.
        throw new Error(SESSION_ERROR);
    } finally {
        clearTimeout(timeout);
    }
}
