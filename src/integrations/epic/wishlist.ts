import browser from 'webextension-polyfill';
import {
    EPIC_STORE_AUTH_HEALTHCHECK_URL,
    EPIC_STORE_WARMUP_POLL_INTERVAL_MS,
    EPIC_STORE_WARMUP_TIMEOUT_MS,
    EPIC_STORE_WISHLIST_PAGE_URL,
    EPIC_STORE_WISHLIST_URL,
    EPIC_WISHLIST_AUTH_REQUIRED,
    EPIC_WISHLIST_PERSISTED_QUERY_HASH
} from '../../utils/sync-constants';

type EpicWishlistItems = { elements: unknown[] };
type EpicWishlistResponse = {
    errors?: Array<{ message?: string }>;
    data?: { Wishlist?: { wishlistItems?: EpicWishlistItems | null } };
};

const REQUEST_TIMEOUT_MS = 8000;
const AUTH_REFRESH_TIMEOUT_MS = 5000;

class EpicWishlistNotLoggedInError extends Error {}

async function fetchWishlist(accessToken: string, accountId: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<EpicWishlistItems> {
    const url = new URL(EPIC_STORE_WISHLIST_URL);
    url.searchParams.set('operationName', 'getWishlist');
    url.searchParams.set('variables', JSON.stringify({ accountId }));
    url.searchParams.set('extensions', JSON.stringify({
        persistedQuery: { version: 1, sha256Hash: EPIC_WISHLIST_PERSISTED_QUERY_HASH }
    }));
    const response = await fetch(url.toString(), {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json', Authorization: `bearer ${accessToken}` },
        signal: AbortSignal.timeout(timeoutMs)
    });
    const payload = await response.json() as EpicWishlistResponse;
    const errors = Array.isArray(payload?.errors) ? payload.errors : [];
    // Epic also returns this authentication error inside HTTP 200/500 GraphQL responses.
    if (errors.some(error => typeof error?.message === 'string' && error.message.includes('com.epicgames.wishlist.notLoggedIn'))) {
        throw new EpicWishlistNotLoggedInError();
    }
    if (!response.ok || errors.length > 0) {
        throw new Error(errors[0]?.message || `Epic wishlist request failed (HTTP ${response.status})`);
    }
    const items = payload?.data?.Wishlist?.wishlistItems;
    if (!items || !Array.isArray(items.elements)) {
        throw new Error('Epic wishlist response is missing wishlistItems.elements');
    }
    return items;
}

async function fetchWishlistAfterPageRefresh(accessToken: string, accountId: string): Promise<EpicWishlistItems> {
    const tab = await browser.tabs.create({ url: EPIC_STORE_WISHLIST_PAGE_URL, active: false });
    try {
        const deadline = Date.now() + EPIC_STORE_WARMUP_TIMEOUT_MS;
        // Loading the document or an arbitrary GraphQL HTTP 200 is not proof of authentication.
        // Keep the page alive until our own wishlist request succeeds.
        while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, Math.min(EPIC_STORE_WARMUP_POLL_INTERVAL_MS, deadline - Date.now())));
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) break;
            try {
                return await fetchWishlist(accessToken, accountId, Math.min(REQUEST_TIMEOUT_MS, remainingMs));
            } catch (error) {
                if (!(error instanceof EpicWishlistNotLoggedInError)) throw error;
            }
        }
        throw new Error(EPIC_WISHLIST_AUTH_REQUIRED);
    } finally {
        if (typeof tab.id === 'number') {
            await browser.tabs.remove(tab.id).catch((error: unknown) => {
                console.warn('[gg.deals-extension] Failed to close Epic wishlist refresh tab:', error);
            });
        }
    }
}

export async function fetchEpicWishlist(accessToken: string, accountId: string): Promise<EpicWishlistItems> {
    try {
        return await fetchWishlist(accessToken, accountId);
    } catch (error) {
        if (!(error instanceof EpicWishlistNotLoggedInError)) throw error;
    }

    // The store uses its own cookie session, separate from the launcher's OAuth token.
    // Epic's web client awaits this endpoint when storeTokenExpires approaches expiry.
    try {
        const response = await fetch(EPIC_STORE_AUTH_HEALTHCHECK_URL, {
            credentials: 'include',
            cache: 'no-store',
            signal: AbortSignal.timeout(AUTH_REFRESH_TIMEOUT_MS)
        });
        if (!response.ok) throw new Error(`Epic session refresh failed (HTTP ${response.status})`);
    } catch (error) {
        console.warn('[gg.deals-extension] Epic session refresh needs the wishlist page:', error);
        return fetchWishlistAfterPageRefresh(accessToken, accountId);
    }

    try {
        return await fetchWishlist(accessToken, accountId);
    } catch (error) {
        if (!(error instanceof EpicWishlistNotLoggedInError)) throw error;
        return fetchWishlistAfterPageRefresh(accessToken, accountId);
    }
}
