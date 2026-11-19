import type { DomainPageRule } from '../types';

export const resolveBitcodesTitle = (): string | null => {
    const heading = document.querySelector('h1.product_title');
    const title = heading?.textContent?.trim();
    return title && title.length > 0 ? title : null;
};

export const bitcodesPageRule: DomainPageRule = {
    domain: 'bitcodes.co',
    resolveTitle: resolveBitcodesTitle,
    resolveRequestUrl: () => window.location.href,
    titleResolveRetryMs: 3000,
};
