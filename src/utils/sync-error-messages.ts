export const EPIC_SYNC_ERROR_MESSAGES = {
    emptyCollection: 'Your Epic Games collection is empty. There’s nothing to sync.',
    emptyWishlist: 'Your Epic Games wishlist is empty. There’s nothing to sync.',
    generic: 'We encountered problems during Epic sync. Please try again later.'
} as const;

export const STEAM_SYNC_ERROR_MESSAGES = {
    platformLogin: 'Failed to log in to the platform website.',
    emptyCollection: 'Your Steam collection is empty. There’s nothing to sync.',
    emptyWishlist: 'Your Steam wishlist is empty. There’s nothing to sync.',
    emptyIgnoreList: 'Your Steam ignore list is empty. There’s nothing to sync.',
    generic: 'We encountered problems during Steam sync. Please try again later.'
} as const;

export const PLAYSTATION_SYNC_ERROR_MESSAGES = {
    emptyCollection: 'Your PlayStation collection is empty. There’s nothing to sync.',
    emptyWishlist: 'Your PlayStation wishlist is empty. There’s nothing to sync.',
    generic: 'We encountered problems during PlayStation sync. Please try again later.'
} as const;

export const NINTENDO_SYNC_ERROR_MESSAGES = {
    emptyCollection: 'Your Nintendo collection is empty. There’s nothing to sync.',
    emptyWishlist: 'Your Nintendo wishlist is empty. There’s nothing to sync.',
    manualRefreshRequired: 'Your Nintendo session has expired. Refresh the opened Nintendo page and sign in if needed, then try syncing again.',
    generic: 'We encountered problems during Nintendo sync. Please try again later.'
} as const;

export const XBOX_SYNC_ERROR_MESSAGES = {
    disconnect: 'Could not remove Xbox credentials from the extension. Please try again.',
    tokenTransport: 'Could not complete Xbox authorization with Microsoft. Please try again.',
    browserAccountMismatch: 'Microsoft sign-in returned a different account than the one signed in on Xbox.com. Sign in with the Xbox.com account and try again.',
    incognito: 'Xbox sync is not available in private browsing. Open GG.deals in a regular browser window.',
    generic: 'We encountered problems during Xbox sync. Please try refreshing this page and Xbox.com, then try syncing again.'
} as const;
