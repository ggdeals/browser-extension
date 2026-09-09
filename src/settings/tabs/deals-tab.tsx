import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { DEALS_URL } from "../../utils/gg-api-constants";
import { DealsTabSingleDeal } from './deals-tab-single-deal';
import { InfoBox } from '../components/info-box';
import * as Icons from '../icons';
import { SHOULD_FETCH_USER_SETTINGS_AFTER_SIGN_IN_KEY, PLATFORM_STEAM, PLATFORM_PC, PLATFORM_ALL, PLATFORM_SWITCH, PLATFORM_NINTENDO } from '../constants';
import browser from 'webextension-polyfill';
import { type GGUserSettingsData, hasGGUserSettingsData, isInvalidApiKeyResponse, md5, signOutFromExtensionMemory, withGGApiKeyHeader } from '../helpers';
import { getEmailUnverifiedMessage, isEmailUnverifiedResponse, processExtensionResponse } from '../../utils/extension-settings';
import { t } from '../../utils/i18n';

export type DealItem = {
    deal: {
        discount: number;
        isHistoricalLow: boolean;
        price: string;
    };
    game: {
        images: {
            "1x": string;
            "2x": string;
        };
        ribbon?: 'nintendo' | 'xbox' | 'playstation';
        title: string;
        url: string;
    };
};

export type DealGroup = {
    title: string;
    url: string;
    items: DealItem[];
};

type DealsTabProps = {
    userSettings: GGUserSettingsData | null;
    platform: string;
    keyshopsEnabled: boolean;
    isSyncingUserSettings: boolean;
    onSignInClick?: () => void;
    onApiKeyInvalid?: () => void;
    onEmailUnverified?: (message: string) => void;
};

function mapSettingsPlatformToDealsPlatform(platform: string): string {
    const normalizedPlatform = platform.trim().toLowerCase();

    if (normalizedPlatform === PLATFORM_STEAM) {
        return PLATFORM_PC;
    }

    if (normalizedPlatform === PLATFORM_ALL) {
        return PLATFORM_PC;
    }

    if (normalizedPlatform === PLATFORM_SWITCH) {
        return PLATFORM_NINTENDO;
    }

    return normalizedPlatform;
}

export function DealsTab({ userSettings, platform, keyshopsEnabled, isSyncingUserSettings, onSignInClick, onApiKeyInvalid, onEmailUnverified }: DealsTabProps) {
    const [deals, setDeals] = useState<DealGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const isLoggedIn = hasGGUserSettingsData(userSettings);

    // Use only the region from extensionData/user
    const dealsRegion = userSettings?.region?.trim().toLowerCase() || null;
    const dealsPlatform = userSettings?.platform?.trim().toLowerCase() || mapSettingsPlatformToDealsPlatform(platform);
    const showKeyshops = typeof userSettings?.showKeyshops === 'boolean' ? userSettings.showKeyshops : keyshopsEnabled;
    const dealsUrl = useMemo(() => (
        dealsRegion
            ? DEALS_URL
            .replace('{region}', dealsRegion)
            .replace('{platform}', dealsPlatform)
            .replace('{showKeyshops}', showKeyshops ? '1' : '0')
            : null
    ), [dealsRegion, dealsPlatform, showKeyshops]);
    const latestRequestId = useRef(0);

    useEffect(() => {
        setLoading(true);

        if (!dealsUrl) {
            return;
        }

        let isCancelled = false;
        const requestId = latestRequestId.current + 1;
        latestRequestId.current = requestId;

        const isCurrentRequest = () => !isCancelled && latestRequestId.current === requestId;

        const handleInvalidApiKey = () => {
            signOutFromExtensionMemory();
            void browser.storage.session.remove(SHOULD_FETCH_USER_SETTINGS_AFTER_SIGN_IN_KEY);
            onApiKeyInvalid?.();
        };

        const fetchDeals = async () => {
            try {
                const authenticatedDealsUrl = new URL(dealsUrl);

                if (isLoggedIn && typeof userSettings.apiKey === 'string') {
                    authenticatedDealsUrl.searchParams.set('k', md5(userSettings.apiKey).slice(0, 8));
                }

                const response = await fetch(authenticatedDealsUrl, {
                    headers: withGGApiKeyHeader({
                        Accept: 'application/json',
                    }, userSettings),
                });
                const data = await response.json().catch(() => ({}));
                try {
                    await processExtensionResponse(response, data);
                } catch (error) {
                    console.warn('[gg.deals-extension] Failed to process deals messages:', error);
                }
                if (!response.ok) {
                    if (response.status === 429) {
                        if (isCurrentRequest()) {
                            setLoading(false);
                        }
                        return;
                    }
                    throw new Error(`Failed to fetch deals. HTTP ${response.status}`);
                }

                if (isInvalidApiKeyResponse(data)) {
                    handleInvalidApiKey();

                    // Retry as logged-out user so public deals are still displayed.
                    const fallbackResponse = await fetch(dealsUrl, {
                        headers: {
                            Accept: 'application/json',
                        },
                    });
                    const fallbackData = await fallbackResponse.json().catch(() => ({}));
                    try {
                        await processExtensionResponse(fallbackResponse, fallbackData);
                    } catch (error) {
                        console.warn('[gg.deals-extension] Failed to process fallback deals messages:', error);
                    }
                    if (!fallbackResponse.ok) {
                        if (isCurrentRequest()) {
                            setLoading(false);
                        }
                        return;
                    }

                    if (isCurrentRequest()) {
                        setDeals(Array.isArray(fallbackData?.data) ? fallbackData.data : []);
                        setLoading(false);
                    }
                    return;
                }

                if (isEmailUnverifiedResponse(data)) {
                    const message = getEmailUnverifiedMessage(data);
                    if (message) {
                        onEmailUnverified?.(message);
                    }
                }

                if (isCurrentRequest()) {
                    setDeals(Array.isArray(data?.data) ? data.data : []);
                    setLoading(false);
                }
            } catch (error) {
                console.error('Error fetching deals:', error);

                if (isCurrentRequest()) {
                    setLoading(false);
                }
            }
        };

        void fetchDeals();

        return () => {
            isCancelled = true;
        };
    }, [dealsUrl, userSettings?.apiKey]);

    useEffect(() => {
        console.log('Fetched deals:', deals);
    }, [deals]);

    return <>
        <div className={`loading-state${loading || isSyncingUserSettings ? '' : ' hidden'}`}>
            <Icons.ICON_LOADING />
        </div>
        <div className="gg-deals-container">
            {!isLoggedIn && <InfoBox
                type="warning"
                heading={t('signInBetterHeading')}
                linkUrl="https://gg.deals/login"
                linkLabel={t('signIn')}
                onSignInClick={onSignInClick}
            >
                {t('signInBetterDescription')}
            </InfoBox>}

            {deals.map(deal => <div className="gg-deals-section-wrapper" key={deal.url}>
                <DealsTabSingleDeal deal={deal} />
            </div>)}
        </div>
    </>;
}
