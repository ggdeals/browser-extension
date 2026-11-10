import browser from 'webextension-polyfill';
import { processExtensionResponse } from './extension-settings';

export function lookForElement(selector: string, timeout = 10000): Promise<Element> {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    const observer = new MutationObserver((_, obs) => {
      const el = document.querySelector(selector);
      if (el) {
        resolve(el);
        obs.disconnect();
      }
    });

    // document_start can run before body exists, so observe the root node
    const observerTarget: Node = document.documentElement ?? document;
    observer.observe(observerTarget, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error('Element not found: ' + selector));
    }, timeout);
  });
}

export type RuntimeMessageResponse = {
  ok: boolean;
  data?: unknown;
  error?: string;
  status?: number;
};

export type SyncElementSnapshot = {
  className: string;
  childNodes: Node[];
  pointerEvents: string;
  ariaDisabled: string | null;
};

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function readTrimmedAttribute(element: Element, attributeName: string): string {
  const value = element.getAttribute(attributeName);
  return typeof value === 'string' ? value.trim() : '';
}

export function persistTrimmedAttribute(element: Element, attributeName: string, value: string): void {
  const normalizedValue = value.trim();
  if (normalizedValue) {
    element.setAttribute(attributeName, normalizedValue);
  }
}

export function sendRuntimeMessage<T>(message: object, timeoutMs: number): Promise<T> {
  return Promise.race([
    browser.runtime.sendMessage(message) as Promise<T>,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`runtime.sendMessage timeout after ${timeoutMs}ms`)), timeoutMs);
    })
  ]);
}

export function snapshotSyncElement(element: Element): SyncElementSnapshot | null {
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  return {
    className: element.className,
    childNodes: Array.from(element.childNodes, (child) => child.cloneNode(true)),
    pointerEvents: element.style.pointerEvents,
    ariaDisabled: element.getAttribute('aria-disabled')
  };
}

export function restoreSyncElementSnapshot(element: Element, snapshot: SyncElementSnapshot | null): void {
  if (!(element instanceof HTMLElement) || !snapshot) {
    return;
  }

  element.className = snapshot.className;
  element.replaceChildren(...snapshot.childNodes.map((child) => child.cloneNode(true)));
  element.style.pointerEvents = snapshot.pointerEvents;
  if (snapshot.ariaDisabled === null) {
    element.removeAttribute('aria-disabled');
  } else {
    element.setAttribute('aria-disabled', snapshot.ariaDisabled);
  }
}

const SYNC_CLICK_LOCK_CLASSNAME = 'ggdeals-sync-click-lock';

export function isElementInSyncingState(element: Element): boolean {
  return element.classList.contains('queued')
    || element.classList.contains('syncing')
    || element.classList.contains('in-progress');
}

export function lockElementSyncClick(element: Element): void {
  const host = element as HTMLElement;
  if (host.classList.contains(SYNC_CLICK_LOCK_CLASSNAME)) {
    return;
  }

  host.classList.add(SYNC_CLICK_LOCK_CLASSNAME);
  host.style.pointerEvents = 'none';
  host.setAttribute('aria-disabled', 'true');
}

export function unlockElementSyncClick(element: Element): void {
  const host = element as HTMLElement;
  host.classList.remove(SYNC_CLICK_LOCK_CLASSNAME);
  host.style.pointerEvents = '';
  host.removeAttribute('aria-disabled');
}

const TOASTR_REQUEST_TYPE = 'GGDEALS_TOASTR_REQUEST';
const TOASTR_RESULT_TYPE = 'GGDEALS_TOASTR_RESULT';
const SWAL_REQUEST_TYPE = 'GGDEALS_SWAL_REQUEST';
const SWAL_RESULT_TYPE = 'GGDEALS_SWAL_RESULT';
const SYNC_WIDGET_REQUEST_TYPE = 'GGDEALS_SYNC_WIDGET_REQUEST';
const SYNC_WIDGET_RESULT_TYPE = 'GGDEALS_SYNC_WIDGET_RESULT';
const CSRF_POST_JSON_REQUEST_TYPE = 'GGDEALS_CSRF_POST_JSON_REQUEST';
const CSRF_POST_JSON_RESULT_TYPE = 'GGDEALS_CSRF_POST_JSON_RESULT';
const REFRESH_EXTENSION_SETTINGS_REQUEST_TYPE = 'GGDEALS_REFRESH_EXTENSION_SETTINGS_REQUEST';
const REFRESH_EXTENSION_SETTINGS_RESULT_TYPE = 'GGDEALS_REFRESH_EXTENSION_SETTINGS_RESULT';
export const SYNC_PAGINATION_PROGRESS_MESSAGE = 'GGDEALS_SYNC_PAGINATION_PROGRESS';

type RpcResultPayload = {
  requestId?: string;
  ok?: boolean;
  error?: string;
  confirmed?: boolean;
  responseOk?: boolean;
  status?: number;
  headers?: Record<string, string | null>;
  body?: string;
};

type SendRequestInput = {
  requestType: string;
  resultType: string;
  payload: Record<string, unknown>;
  timeoutMs: number | null;
};

type ServerErrorWithCode = Error & {
  serverCode?: string | number;
};

type SyncPaginationProgressMessage = {
  type?: string;
  sourceId?: number;
  currentPage?: number;
  totalPages?: number | null;
};

function isPositivePageNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function getElementText(element: HTMLElement): string {
  return element.textContent?.trim().replace(/\s+/g, ' ') ?? '';
}

function isSafeProgressTextTarget(element: Element, root: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element === root) {
    return false;
  }

  if (element.querySelector('button, a.sync-link, .sync-link')) {
    return false;
  }

  const text = getElementText(element);
  return text.length > 0 && text.length <= 200;
}

function getSyncProgressLabelElement(element: Element): HTMLElement | null {
  const selector = [
    '.sync-provider-description',
    '.sync-provider-status-description',
    '.extension-sync-popup-provider-status-description',
    '.extension-sync-description',
    '[class*="description"]',
    '.sync-provider-label',
    '.sync-provider-status-label',
    '.extension-sync-popup-provider-status-label',
    '.extension-sync-status'
  ].join(', ');

  if (element.matches(selector) && element instanceof HTMLElement) {
    return element;
  }

  const label = Array.from(element.querySelectorAll(selector))
    .find((candidate) => isSafeProgressTextTarget(candidate, element));
  if (label) {
    return label;
  }

  return null;
}

function formatPaginationProgress(currentPage: number, totalPages: number | null): string {
  return `${currentPage}/${totalPages ?? '?'}`;
}

export function bindSyncPaginationProgressDescription(element: Element, sourceId: number): () => void {
  const labelElement = getSyncProgressLabelElement(element);
  if (!labelElement) {
    return () => undefined;
  }

  const originalTitle = labelElement.getAttribute('title');
  const progressElement = document.createElement('span');
  progressElement.className = 'extension-sync-pagination-progress';

  const onMessage = (message: SyncPaginationProgressMessage): void => {
    if (message?.type !== SYNC_PAGINATION_PROGRESS_MESSAGE || message.sourceId !== sourceId) {
      return;
    }

    if (!isPositivePageNumber(message.currentPage)) {
      return;
    }

    const totalPages = isPositivePageNumber(message.totalPages) ? message.totalPages : null;
    progressElement.textContent = ` (${formatPaginationProgress(message.currentPage, totalPages)})`;
    if (!progressElement.isConnected) {
      labelElement.append(progressElement);
    }
    labelElement.setAttribute('title', `Sync progress: ${formatPaginationProgress(message.currentPage, totalPages)}`);
  };

  chrome.runtime.onMessage.addListener(onMessage);

  return () => {
    chrome.runtime.onMessage.removeListener(onMessage);
    progressElement.remove();
    if (originalTitle === null) {
      labelElement.removeAttribute('title');
    } else {
      labelElement.setAttribute('title', originalTitle);
    }
  };
}

function sendRequest(input: SendRequestInput): Promise<RpcResultPayload | null> {
  const requestId = `ggdeals-rpc-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value: RpcResultPayload | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (typeof timeoutId !== 'undefined') window.clearTimeout(timeoutId);
      window.removeEventListener('message', onResult);
      window.removeEventListener('pagehide', onPageHide);
      resolve(value);
    };

    const onResult = (event: MessageEvent): void => {
      if (event.source !== window) {
        return;
      }

      const data = event.data as RpcResultPayload | undefined;
      if (!data || (data as { type?: string }).type !== input.resultType || data.requestId !== requestId) {
        return;
      }

      finish(data);
    };

    const onPageHide = (): void => finish(null);
    const timeoutId = input.timeoutMs === null ? undefined : window.setTimeout(() => {
      finish(null);
    }, input.timeoutMs);

    if (!document.documentElement && !document.body) {
      finish(null);
      return;
    }

    window.addEventListener('message', onResult);
    if (input.timeoutMs === null) window.addEventListener('pagehide', onPageHide, { once: true });
    window.postMessage({
      type: input.requestType,
      requestId,
      ...input.payload
    }, '*');
  });
}

type CallSwalInput = {
  html: string;
  confirmButtonText?: string;
  confirmButtonClass?: string;
};

export async function callSwal(input: CallSwalInput): Promise<boolean> {
  const result = await sendRequest({
    requestType: SWAL_REQUEST_TYPE,
    resultType: SWAL_RESULT_TYPE,
    payload: {
      html: input.html,
      confirmButtonText: input.confirmButtonText ?? 'Continue',
      confirmButtonClass: input.confirmButtonClass ?? 'btn btn-blue'
    },
    // A visible confirmation waits for the user's decision, not a request timer.
    // Leaving the page cancels the pending prompt and removes its listener.
    timeoutMs: null
  });

  return Boolean(result?.confirmed);
}

export function requestUserIdConsentViaPageSwal(serviceName: string, userId: string): Promise<boolean> {
  const html = `Continue syncing ${serviceName} account <strong>${userId}</strong>?`;
  const confirmText = 'Continue';
  return callSwal({ html, confirmButtonText: confirmText });
}

export function isSyncCanceledError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Sync canceled:');
}

export async function refreshExtensionSettingsPopupViaPage(): Promise<void> {
  const result = await sendRequest({
    requestType: REFRESH_EXTENSION_SETTINGS_REQUEST_TYPE,
    resultType: REFRESH_EXTENSION_SETTINGS_RESULT_TYPE,
    payload: {},
    timeoutMs: 5000
  });
  if (!result?.ok) throw new Error(result?.error ?? 'Settings popup refresh timed out');
}

type SyncWidgetAction = 'markSourceNew' | 'markSourceQueued' | 'resetSourceState' | 'unmarkAsNew';

export async function callSyncWidget(sourceId: number, action: SyncWidgetAction): Promise<void> {
  const result = await sendRequest({
    requestType: SYNC_WIDGET_REQUEST_TYPE,
    resultType: SYNC_WIDGET_RESULT_TYPE,
    payload: {
      sourceId,
      action
    },
    timeoutMs: 3000
  });

  if (!result) {
    console.warn('[gg.deals-extension] SyncWidget RPC timed out while waiting for response');
    return;
  }

  if (!result.ok) {
    console.warn(`[gg.deals-extension] Failed to call SyncWidget.${action}:`, result.error ?? 'unknown error');
  }
}

export function markSourceNewViaPageSyncWidget(sourceId: number): Promise<void> {
  return callSyncWidget(sourceId, 'markSourceNew');
}

export function markSourceQueuedViaPageSyncWidget(sourceId: number): Promise<void> {
  return callSyncWidget(sourceId, 'markSourceQueued');
}

export function resetSourceStateViaPageSyncWidget(sourceId: number): Promise<void> {
  return callSyncWidget(sourceId, 'resetSourceState');
}

export function unmarkAsNewViaPageSyncWidget(sourceId: number): Promise<void> {
  return callSyncWidget(sourceId, 'unmarkAsNew');
}

export type ToastrMethod = 'success' | 'error' | 'warning' | 'info' | 'clear' | 'remove' | 'subscribe' | 'getContainer';

export type ToastrOptions = Record<string, unknown>;

type ToastrMessageMethod = 'success' | 'error' | 'warning' | 'info';

export async function callToastr(method: ToastrMethod, args: unknown[] = []): Promise<void> {
  const result = await sendRequest({
    requestType: TOASTR_REQUEST_TYPE,
    resultType: TOASTR_RESULT_TYPE,
    payload: {
      method,
      args
    },
    timeoutMs: 3000
  });

  if (!result) {
    console.warn('[gg.deals-extension] Toastr RPC timed out while waiting for response');
    return;
  }

  if (!result.ok) {
    console.warn('[gg.deals-extension] Failed to call toastr method:', result.error ?? 'unknown error');
  }
}

function showToastrMessage(
  method: ToastrMessageMethod,
  message: string,
  title?: string,
  options?: ToastrOptions
): Promise<void> {
  const normalizedTitle = typeof title === 'string' ? title : '';
  const mergedOptions: ToastrOptions = {
    positionClass: 'toast-bottom-center',
    ...(options ?? {})
  };

  return callToastr(method, [message, normalizedTitle, mergedOptions]);
}

export function showSuccessToast(message: string, title?: string, options?: ToastrOptions): Promise<void> {
  return showToastrMessage('success', message, title, options);
}

export function showErrorToast(message: string, title?: string, options?: ToastrOptions): Promise<void> {
  return showToastrMessage('error', message, title, options);
}

export function readServerErrorCode(error: unknown): string | number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const payload = error as { serverCode?: unknown; code?: unknown };
  const candidate = payload.serverCode ?? payload.code;
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }

  if (typeof candidate === 'number') {
    return candidate;
  }

  return null;
}

export function showWarningToast(message: string, title?: string, options?: ToastrOptions): Promise<void> {
  return showToastrMessage('warning', message, title, options);
}

export function showInfoToast(message: string, title?: string, options?: ToastrOptions): Promise<void> {
  return showToastrMessage('info', message, title, options);
}

export function clearToasts(toast?: unknown): Promise<void> {
  return callToastr('clear', [toast]);
}

export function removeToasts(toast?: unknown): Promise<void> {
  return callToastr('remove', [toast]);
}

function isSameOriginUrl(url: string): boolean {
  try {
    const targetUrl = new URL(url, window.location.origin);
    return targetUrl.origin === window.location.origin;
  } catch {
    return false;
  }
}

async function postJsonViaPageCsrf(url: string, payload: object): Promise<Response> {
  const result = await sendRequest({
    requestType: CSRF_POST_JSON_REQUEST_TYPE,
    resultType: CSRF_POST_JSON_RESULT_TYPE,
    payload: { url, payload },
    timeoutMs: 30000
  });

  if (!result) {
    throw new Error('Helpers.Csrf.postJson request timed out');
  }

  if (!result.ok) {
    throw new Error(result.error ?? 'Helpers.Csrf.postJson failed');
  }

  const body = result.body ?? '';
  const headers = new Headers();
  for (const [name, value] of Object.entries(result.headers ?? {})) {
    if (typeof value === 'string') {
      headers.set(name, value);
    }
  }

  return {
    ok: result.responseOk === true,
    status: result.status ?? 0,
    headers,
    text: async () => body,
    json: async () => JSON.parse(body) as unknown
  } as Response;
}

export async function sendMessageToServer(url: string, data: JSON): Promise<unknown> {
  const response = isSameOriginUrl(url)
    ? await postJsonViaPageCsrf(url, data)
    : await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

  const rawBody = await response.text().catch(() => '');
  let parsedBody: Record<string, unknown> = {};
  if (rawBody.trim().length > 0) {
    try {
      parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      console.warn(
        `[gg.deals-extension] Server returned a non-JSON response (HTTP ${response.status})`
      );
    }
  }

  try {
    await processExtensionResponse(response, parsedBody);
  } catch (error) {
    console.warn('[gg.deals-extension] Failed to process server messages:', toErrorMessage(error));
  }

  if (!response.ok) {

    const parsedData = parsedBody.data;
    const parsedDataObject = parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData)
      ? parsedData as Record<string, unknown>
      : null;

    const messageCandidates: unknown[] = [
      parsedDataObject?.message,
      parsedBody.message,
      parsedBody.error,
      parsedBody.detail
    ];

    const codeCandidate = parsedDataObject?.code;
    const serverCode = typeof codeCandidate === 'string' && codeCandidate.trim().length > 0
      ? codeCandidate.trim()
      : typeof codeCandidate === 'number'
        ? codeCandidate
        : undefined;

    const serverMessage = messageCandidates.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0) as string | undefined;
    const errorMessage = serverMessage?.trim() ?? `Request failed (HTTP ${response.status})`;

    const errorWithCode = new Error(errorMessage) as ServerErrorWithCode;
    if (typeof serverCode !== 'undefined') {
      errorWithCode.serverCode = serverCode;
    }

    throw errorWithCode;
  }

  console.log('Data successfully sent to server:', parsedBody);
  return parsedBody;
}

const NORMAL_ICON_PATHS: Record<number, string> = {
  16: chrome.runtime.getURL('src/assets/gg-ext-icon-16.png'),
  48: chrome.runtime.getURL('src/assets/gg-ext-icon-48.png'),
  128: chrome.runtime.getURL('src/assets/gg-ext-icon-128.png')
};

const GRAY_ICON_PATHS: Record<number, string> = {
  16: chrome.runtime.getURL('src/assets/gg-ext-icon-16_gray.png'),
  48: chrome.runtime.getURL('src/assets/gg-ext-icon-48_gray.png'),
  128: chrome.runtime.getURL('src/assets/gg-ext-icon-128_gray.png')
};

type IconTarget = {
  tabId?: number;
};

export const SERVER_MESSAGE_ICON_COLOR = '#ffc266';
const serverMessageIconCache = new Map<string, Record<number, ImageData>>();

async function getServerMessageIconData(paths: Record<number, string>): Promise<Record<number, ImageData>> {
  const cacheKey = Object.values(paths).join('|');
  const cached = serverMessageIconCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const iconDataEntries = await Promise.all(Object.entries(paths).map(async ([sizeValue, path]) => {
    const size = Number(sizeValue);
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load extension icon: HTTP ${response.status}`);
    }

    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      throw new Error('Failed to create extension icon canvas context.');
    }

    const iconSize = size * 0.93;
    context.drawImage(bitmap, 0, 0, iconSize, iconSize);
    bitmap.close();

    const radius = Math.max(1.5, iconSize * 0.28);
    const inset = Math.max(0.25, size * 0.02);
    context.beginPath();
    context.arc(size - radius - inset, size - radius - inset, radius, 0, Math.PI * 2);
    context.fillStyle = SERVER_MESSAGE_ICON_COLOR;
    context.fill();

    return [size, context.getImageData(0, 0, size, size)] as const;
  }));
  const iconData = Object.fromEntries(iconDataEntries) as Record<number, ImageData>;
  serverMessageIconCache.set(cacheKey, iconData);

  return iconData;
}

async function setActionIcon(paths: Record<number, string>, tabId?: number, showServerMessageIndicator = false): Promise<boolean> {
  const target: IconTarget = typeof tabId === 'number' ? { tabId } : {};
  if (!showServerMessageIndicator) {
    try {
      await chrome.action.setIcon({ ...target, path: paths });
      return true;
    } catch (error) {
      console.warn('[gg.deals-extension] Failed to restore extension icon:', error);
      return false;
    }
  }

  try {
    await chrome.action.setIcon({ ...target, imageData: await getServerMessageIconData(paths) });
    return true;
  } catch (error) {
    console.warn('[gg.deals-extension] Failed to render server message icon indicator:', error);
    await chrome.action.setIcon({ ...target, path: paths }).catch(() => undefined);
    return false;
  }
}

export function setGrayIcon(tabId?: number, showServerMessageIndicator = false): Promise<boolean> {
  return setActionIcon(GRAY_ICON_PATHS, tabId, showServerMessageIndicator);
}

export function restoreOriginalIcon(tabId?: number, showServerMessageIndicator = false): Promise<boolean> {
  return setActionIcon(NORMAL_ICON_PATHS, tabId, showServerMessageIndicator);
}
