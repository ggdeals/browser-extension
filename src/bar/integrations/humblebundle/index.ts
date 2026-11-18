import type { DomainPageRule } from '../types';

export const resolveHumbleBundleTitle = (): string | null => {
    const heading = document.querySelector('h2');
    const title = heading?.textContent?.trim();
    return title && title.length > 0 ? title : null;
};

export const humbleBundlePageRule: DomainPageRule = {
    domain: 'humblebundle.com',
    resolveTitle: resolveHumbleBundleTitle,
    resolveRequestUrl: () => window.location.href,
    titleResolveRetryMs: 3000,
};
