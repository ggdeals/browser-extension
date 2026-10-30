import type { DomainPageRule } from '../types';

export const resolveGamerAllTitle = (): string | null => {
    const heading = document.querySelector<HTMLHeadingElement>('h1.product-title');
    const title = heading?.textContent?.trim();

    return title && title.length > 0 ? title : null;
};

export const gamerAllPageRule: DomainPageRule = {
    domain: 'gamerall.com',
    resolveTitle: resolveGamerAllTitle,
    resolvePageStateKey: resolveGamerAllTitle,
    resolveRequestUrl: () => window.location.href,
    titleResolveRetryMs: 3000,
};
