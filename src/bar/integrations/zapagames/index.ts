import type { DomainPageRule } from '../types';

export const resolveZapaGamesTitle = (): string | null => {
    const heading = document.querySelector('h1.product__name');
    const title = heading?.textContent?.trim();
    return title && title.length > 0 ? title : null;
};

export const zapaGamesPageRule: DomainPageRule = {
    domain: 'zapagames.com',
    resolveTitle: resolveZapaGamesTitle,
    resolveRequestUrl: () => window.location.href,
    titleResolveRetryMs: 3000,
};
