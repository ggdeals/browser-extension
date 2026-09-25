import browser from 'webextension-polyfill';
import { NINTENDO_NICKNAME_SELECTOR } from '../../utils/sync-constants';

let observer: MutationObserver | null = null;
let didReportNickname = false;

function inspectDocument(): void {
    if (didReportNickname) {
        return;
    }

    const nickname = document.querySelector(NINTENDO_NICKNAME_SELECTOR)?.textContent?.trim() ?? '';
    if (!nickname) {
        return;
    }

    didReportNickname = true;
    observer?.disconnect();
    void browser.runtime.sendMessage({
        type: 'NINTENDO_ACCOUNT_NICKNAME_READY',
        nickname
    }).catch(() => undefined);
}

inspectDocument();

if (!didReportNickname) {
    observer = new MutationObserver(inspectDocument);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });
}
