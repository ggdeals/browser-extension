const COMPACT_HISTORICAL = 'compact-historical';
const COMPACT_LINK = 'compact-game-link';
const COMPACT_SPACING = 'compact-spacing';
const HIDDEN_LINK = 'game-link-hidden';
const OVERFLOW_TOLERANCE = 1;

/** Shorten secondary labels before allowing the title to lose space. */
export function updateBarResponsiveLayout(bar: HTMLElement): void {
    if (!bar.isConnected || bar.classList.contains('minimized')) {
        return;
    }

    bar.classList.remove(COMPACT_HISTORICAL, COMPACT_LINK, COMPACT_SPACING, HIDDEN_LINK);
    const content = bar.querySelector<HTMLElement>('.gg-bar-content');
    if (!content) {
        return;
    }

    const inline = getComputedStyle(bar).getPropertyValue('--gg-bar-inline-layout').trim() === '1';
    const isCrowded = (): boolean => {
        const right = content.getBoundingClientRect().right;
        // Check only inline content, so opening an absolutely positioned menu
        // does not change the compact labels.
        const elements = content.querySelectorAll<HTMLElement>(
            '.gg-game-price-value, .gg-bar-subs-label, .gg-bar-game-actions',
        );
        for (const element of elements) {
            if (element.getClientRects().length > 0 && element.getBoundingClientRect().right > right + OVERFLOW_TOLERANCE) {
                return true;
            }
        }

        if (inline) {
            const title = content.querySelector<HTMLElement>('.title-label');
            return Boolean(title && title.scrollWidth > title.clientWidth + OVERFLOW_TOLERANCE);
        }

        return false;
    };

    if (isCrowded()) {
        bar.classList.add(COMPACT_HISTORICAL);
    }
    if (inline && isCrowded()) {
        bar.classList.add(COMPACT_LINK);
    }
    if (inline && isCrowded()) {
        bar.classList.add(COMPACT_SPACING);
    }
    if (inline) {
        const title = content.querySelector<HTMLElement>('.title-label');
        if (title && title.scrollWidth > title.clientWidth + OVERFLOW_TOLERANCE && title.clientWidth <= 64) {
            bar.classList.add(HIDDEN_LINK);
        }
    }
}

let disconnectPreviousBar: (() => void) | undefined;

export function observeBarResponsiveLayout(bar: HTMLElement): void {
    disconnectPreviousBar?.();
    let frame = 0;
    let disconnected = false;
    const disconnect = (): void => {
        disconnected = true;
        cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        mutationObserver.disconnect();
        document.fonts.removeEventListener('loadingdone', schedule);
    };
    const schedule = (): void => {
        if (frame || disconnected) {
            return;
        }
        frame = requestAnimationFrame(() => {
            frame = 0;
            if (!bar.isConnected) {
                disconnect();
                return;
            }
            updateBarResponsiveLayout(bar);
        });
    };

    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(bar);
    const content = bar.querySelector<HTMLElement>('.gg-bar-content');
    if (content) {
        resizeObserver.observe(content);
    }
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(bar, { childList: true, characterData: true, subtree: true });
    document.fonts.addEventListener('loadingdone', schedule);
    void document.fonts.ready.then(schedule);
    disconnectPreviousBar = disconnect;
    schedule();
}
