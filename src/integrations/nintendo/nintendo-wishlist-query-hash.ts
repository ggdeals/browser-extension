import browser from 'webextension-polyfill';
import { NINTENDO_NICKNAME_SELECTOR } from '../../utils/sync-constants';

const NINTENDO_GRAPHQL_HOST = 'wb.lp1.savanna.srv.nintendo.net';
const NINTENDO_GRAPHQL_PATH = '/graphql';
const NINTENDO_WISHLIST_OPERATION = 'InfiniteScrollWishlist';
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const SAVANNA_CLIENT_ID_PATTERN = /\\?["']X-Nintendo-Savanna-Client-Id\\?["']\s*:\s*\\?["']([a-f0-9]{64})\\?["']/i;
const COLLECTION_SAVANNA_CLIENT_ID_PATTERN = /(?:&quot;|["'])savannaClientId(?:&quot;|["'])\s*:\s*(?:&quot;|["'])([a-f0-9]{64})(?:&quot;|["'])/i;
const DOCUMENT_INSPECTION_INTERVAL_MS = 250;
// Covers the background discovery timeouts; afterwards nobody waits for these values anymore.
const DOCUMENT_INSPECTION_TIMEOUT_MS = 15000;

let resourceObserver: PerformanceObserver | null = null;
let documentObserver: MutationObserver | null = null;
let collectionClientIdPoll: number | null = null;
let scheduledDocumentInspection: number | null = null;
let documentInspectionTimeout: number | null = null;
let didReportHash = false;
let didReportClientId = false;
let lastCollectionBootstrapExtractionState = '';

function isNintendoCollectionDiscoveryPage(): boolean {
    return window.location.hostname === 'accounts.nintendo.com'
        && window.location.pathname === '/portal/vgcs';
}

// The wishlist client ID belongs to the eShop frontend; other Nintendo sites may embed a different one.
function isNintendoShopPage(): boolean {
    return window.location.hostname === 'ec.nintendo.com';
}

function extractNintendoSavannaClientId(): string | null {
    const html = document.documentElement?.innerHTML ?? '';
    const clientId = html.match(SAVANNA_CLIENT_ID_PATTERN)?.[1];
    return clientId && SHA256_HEX_PATTERN.test(clientId)
        ? clientId.toLowerCase()
        : null;
}

function extractNintendoCollectionSavannaClientId(): string | null {
    const html = document.documentElement?.innerHTML ?? '';
    const clientId = html.match(COLLECTION_SAVANNA_CLIENT_ID_PATTERN)?.[1];
    return clientId && SHA256_HEX_PATTERN.test(clientId)
        ? clientId.toLowerCase()
        : null;
}

function extractNintendoCollectionIdToken(): string | null {
    const html = document.documentElement?.innerHTML ?? '';
    const match = html.match(/(?:&quot;|["'])idToken(?:&quot;|["'])\s*:\s*(?:&quot;|["'])([^&"']+)(?:&quot;|["'])/i);
    const idToken = match?.[1]?.trim() ?? '';
    return idToken.split('.').length === 3 ? idToken : null;
}

function stopDocumentInspection(): void {
    documentObserver?.disconnect();
    documentObserver = null;
    if (collectionClientIdPoll !== null) {
        window.clearInterval(collectionClientIdPoll);
        collectionClientIdPoll = null;
    }
    if (scheduledDocumentInspection !== null) {
        window.clearTimeout(scheduledDocumentInspection);
        scheduledDocumentInspection = null;
    }
    if (documentInspectionTimeout !== null) {
        window.clearTimeout(documentInspectionTimeout);
        documentInspectionTimeout = null;
    }
}

// Serializing the whole document is expensive, so mutation bursts are coalesced into one inspection.
function scheduleDocumentInspection(): void {
    if (scheduledDocumentInspection !== null) {
        return;
    }

    scheduledDocumentInspection = window.setTimeout(() => {
        scheduledDocumentInspection = null;
        inspectDocument();
    }, DOCUMENT_INSPECTION_INTERVAL_MS);
}

function inspectDocument(): void {
    if (didReportClientId) {
        return;
    }

    if (isNintendoCollectionDiscoveryPage()) {
        const clientId = extractNintendoCollectionSavannaClientId();
        const idToken = extractNintendoCollectionIdToken();
        const nickname = document.querySelector(NINTENDO_NICKNAME_SELECTOR)?.textContent?.trim() ?? '';
        const extractionState = `${Boolean(idToken)}:${Boolean(clientId)}:${Boolean(nickname)}`;
        if (extractionState !== lastCollectionBootstrapExtractionState) {
            lastCollectionBootstrapExtractionState = extractionState;
            console.log('[gg.deals-extension] Nintendo collection bootstrap extracted', {
                hasIdToken: Boolean(idToken),
                hasSavannaClientId: Boolean(clientId),
                hasNickname: Boolean(nickname)
            });
        }
        if (!clientId || !idToken) {
            return;
        }

        didReportClientId = true;
        stopDocumentInspection();
        console.log('[gg.deals-extension] Nintendo collection bootstrap sent to background');
        void browser.runtime.sendMessage({
            type: 'NINTENDO_COLLECTION_BOOTSTRAP_READY',
            clientId,
            idToken,
            nickname
        }).then((response) => {
            console.log('[gg.deals-extension] Nintendo collection bootstrap message response:', response);
        }).catch((error: unknown) => {
            console.error('[gg.deals-extension] Nintendo collection bootstrap message error:', error);
        });
        return;
    }

    if (!isNintendoShopPage()) {
        return;
    }

    const clientId = extractNintendoSavannaClientId();
    if (!clientId) {
        return;
    }

    didReportClientId = true;
    stopDocumentInspection();
    void browser.runtime.sendMessage({
        type: 'NINTENDO_SAVANNA_CLIENT_ID_DISCOVERED',
        clientId
    }).catch(() => undefined);
}

function extractWishlistQueryHash(entry: PerformanceEntry): string | null {
    if (entry.entryType !== 'resource') {
        return null;
    }

    try {
        const requestUrl = new URL(entry.name);
        if (
            requestUrl.hostname !== NINTENDO_GRAPHQL_HOST
            || requestUrl.pathname !== NINTENDO_GRAPHQL_PATH
            || requestUrl.searchParams.get('operationName') !== NINTENDO_WISHLIST_OPERATION
        ) {
            return null;
        }

        const extensionsValue = requestUrl.searchParams.get('extensions');
        if (!extensionsValue) {
            return null;
        }

        const extensions = JSON.parse(extensionsValue) as {
            persistedQuery?: { sha256Hash?: unknown };
        };
        const hash = extensions.persistedQuery?.sha256Hash;
        return typeof hash === 'string' && SHA256_HEX_PATTERN.test(hash)
            ? hash.toLowerCase()
            : null;
    } catch {
        return null;
    }
}

function inspectEntries(entries: PerformanceEntryList): void {
    if (didReportHash) {
        return;
    }

    for (const entry of entries) {
        const hash = extractWishlistQueryHash(entry);
        if (!hash) {
            continue;
        }

        didReportHash = true;
        resourceObserver?.disconnect();
        void browser.runtime.sendMessage({
            type: 'NINTENDO_WISHLIST_QUERY_HASH_DISCOVERED',
            hash
        }).catch(() => undefined);
        return;
    }
}

inspectDocument();

if (!didReportClientId && (isNintendoCollectionDiscoveryPage() || isNintendoShopPage())) {
    documentObserver = new MutationObserver(scheduleDocumentInspection);
    documentObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    if (isNintendoCollectionDiscoveryPage()) {
        collectionClientIdPoll = window.setInterval(inspectDocument, DOCUMENT_INSPECTION_INTERVAL_MS);
    }

    documentInspectionTimeout = window.setTimeout(stopDocumentInspection, DOCUMENT_INSPECTION_TIMEOUT_MS);
}

inspectEntries(performance.getEntriesByType('resource'));

if (!didReportHash) {
    resourceObserver = new PerformanceObserver((entryList) => {
        inspectEntries(entryList.getEntries());
    });
    resourceObserver.observe({ type: 'resource', buffered: true });
}
