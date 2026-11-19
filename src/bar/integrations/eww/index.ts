import type { DomainPageRule } from '../types';

export const resolveEwwTitle = (): string | null => {
    const heading = document.querySelector('h1');
    const title = heading?.textContent?.trim();
    return title && title.length > 0 ? title : null;
};

export const ewwPageRule: DomainPageRule = {
    domain: 'eww.gg',
    resolveTitle: resolveEwwTitle,
    resolveRequestUrl: () => window.location.href,
    titleResolveRetryMs: 3000,
};
