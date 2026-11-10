(() => {
  const REQUEST_TYPE = 'GGDEALS_CSRF_POST_JSON_REQUEST';
  const RESULT_TYPE = 'GGDEALS_CSRF_POST_JSON_RESULT';
  const REFRESH_REQUEST_TYPE = 'GGDEALS_REFRESH_EXTENSION_SETTINGS_REQUEST';
  const REFRESH_RESULT_TYPE = 'GGDEALS_REFRESH_EXTENSION_SETTINGS_RESULT';

  window.addEventListener('message', async (event) => {
    if (event.source !== window) {
      return;
    }

    const message = event.data;
    if (!message || typeof message.requestId !== 'string') {
      return;
    }

    if (message.type === REFRESH_REQUEST_TYPE) {
      try {
        const modal = document.getElementById('user-extension-settings')?.closest('.modal');
        if (modal?.classList.contains('in')) {
          const popups = globalThis.Component?.Popups;
          const jquery = globalThis.jQuery;
          if (!modal.id || !/^[a-z][\w-]*$/i.test(modal.id)
            || typeof popups?.getAjaxModal !== 'function' || typeof jquery !== 'function') {
            throw new Error('Settings popup refresh is not available on the page');
          }
          // Reuse the modal's remembered URL, AJAX loading and server-side widget initialization.
          popups.getAjaxModal(`#${modal.id}`);
          jquery(modal).trigger('show.bs.modal');
        }
        window.postMessage({ type: REFRESH_RESULT_TYPE, requestId: message.requestId, ok: true }, '*');
      } catch (error) {
        window.postMessage({ type: REFRESH_RESULT_TYPE, requestId: message.requestId, ok: false,
          error: error instanceof Error ? error.message : String(error) }, '*');
      }
      return;
    }

    if (message.type !== REQUEST_TYPE) return;

    try {
      const csrf = globalThis.Helpers?.Csrf;
      if (!csrf || typeof csrf.postJson !== 'function') {
        throw new Error('Helpers.Csrf.postJson is not available on the page');
      }

      if (typeof message.url !== 'string' || !message.payload || typeof message.payload !== 'object') {
        throw new Error('Invalid CSRF POST request');
      }

      const targetUrl = new URL(message.url, window.location.origin);
      if (targetUrl.origin !== window.location.origin) {
        throw new Error('Cross-origin CSRF POST requests are not allowed');
      }

      const response = await csrf.postJson(message.url, message.payload);
      const body = await response.text();

      window.postMessage({
        type: RESULT_TYPE,
        requestId: message.requestId,
        ok: true,
        responseOk: response.ok,
        status: response.status,
        headers: {
          'retry-after': response.headers.get('Retry-After'),
          'x-ratelimit-reset': response.headers.get('X-RateLimit-Reset')
        },
        body
      }, '*');
    } catch (error) {
      window.postMessage({
        type: RESULT_TYPE,
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }, '*');
    }
  });
})();
