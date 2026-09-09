import { useEffect, useState } from 'preact/hooks';
import type { SettingsData, SettingsTabProps } from '../helpers';
import {
    hasGGUserSettingsData,
    loadGGUserSettings,
    loadExcludedWebsitesFromChromeStorage,
    saveExcludedWebsites
} from '../helpers';
import { CustomDropdown } from '../components/custom-dropdown';
import { InfoBox } from '../components/info-box';
import { BottomPinnedLink } from '../components/bottom-pinned-link';
import * as Icons from '../icons';

import { ExcludedWebsitesManager } from '../components/excluded-websites-manager';
import { toWebsiteItems, type WebsiteItem } from '../excluded-websites';
import { t } from '../../utils/i18n';

export function SettingsTab(props: SettingsTabProps) {
    const [excludedItems, setExcludedItems] = useState<WebsiteItem[]>([]);

    useEffect(() => {
        void loadExcludedWebsitesFromChromeStorage().then((domains) => {
            if (!domains) {
                return;
            }

            setExcludedItems(toWebsiteItems(domains));
        });
    }, []);

    // Dropdown data definitions
    const platformOptions = [
        { value: 'all', label: t('platformAll') },
        { value: 'pc', label: t('platformPc') },
        { value: 'xbox', label: t('platformXbox') },
        { value: 'playstation', label: t('platformPlayStation') },
        { value: 'nintendo', label: t('platformSwitch') }
    ];

    const regionCurrencyOptions = [
        { value: 'aud-au', label: t('regionAustralia') },
        { value: 'eur-be', label: t('regionBelgium') },
        { value: 'brl-br', label: t('regionBrazil') },
        { value: 'cad-ca', label: t('regionCanada') },
        { value: 'dkk-dk', label: t('regionDenmark') },
        { value: 'eur-eu', label: t('regionEurope') },
        { value: 'eur-fi', label: t('regionFinland') },
        { value: 'eur-fr', label: t('regionFrance') },
        { value: 'eur-de', label: t('regionGermany') },
        { value: 'eur-ie', label: t('regionIreland') },
        { value: 'eur-it', label: t('regionItaly') },
        { value: 'eur-nl', label: t('regionNetherlands') },
        { value: 'nok-no', label: t('regionNorway') },
        { value: 'pln-pl', label: t('regionPoland') },
        { value: 'eur-es', label: t('regionSpain') },
        { value: 'sek-se', label: t('regionSweden') },
        { value: 'chf-ch', label: t('regionSwitzerland') },
        { value: 'gbp-gb', label: t('regionUnitedKingdom') },
        { value: 'usd-us', label: t('regionUnitedStates') }
    ];

    const isLoggedIn = hasGGUserSettingsData(loadGGUserSettings());

    return (
        <section className="gg-settings-pill-container with-pinned-link" aria-label={t('settingsTabAria')}>
            {!isLoggedIn && <InfoBox
                type="warning"
                heading={t('signInBetterHeading')}
                linkUrl="https://gg.deals/login"
                linkLabel={t('signIn')}
                onSignInClick={props.onSignInClick}
            >
                {t('signInBetterDescription')}
            </InfoBox>}

            <BottomPinnedLink
                url="https://gg.deals/settings"
                label={t('ggDealsUserSettings')}
            />

            <section className="gg-settings-pill active">
                <div className="gg-settings-pill-icon">
                    <Icons.ICON_PLATFORM />
                </div>
                <div className="gg-settings-pill-content">
                    <div className="gg-settings-pill-title">{t('settingsPlatformTitle')}</div>
                    <div className="gg-settings-pill-desc">{t('settingsPlatformDescription')}</div>

                    <CustomDropdown
                        id="settings-platform"
                        name="settings-platform"
                        currentValue={props.platform}
                        options={platformOptions}
                        onChange={(value) => props.onPlatformChange(value as SettingsData['platform'])}
                    />
                </div>
            </section>

            <section className="gg-settings-pill active">
                <div className="gg-settings-pill-icon">
                    <Icons.ICON_REGION />
                </div>

                <div className="gg-settings-pill-content">
                    <div className="gg-settings-pill-title">{t('settingsRegionCurrencyTitle')}</div>
                    <div className="gg-settings-pill-desc">{t('settingsRegionCurrencyDescription')}</div>

                    <CustomDropdown
                        id="settings-region-currency"
                        name="settings-region-currency"
                        currentValue={props.regionCurrency ?? ''}
                        options={regionCurrencyOptions}
                        onChange={(value) => props.onRegionCurrencyChange(value as NonNullable<SettingsData['regionCurrency']>)}
                    />
                </div>
            </section>

            <section className={`gg-settings-pill${props.keyshopsEnabled ? ' active' : ''}`}>
                <div className="gg-settings-pill-icon">
                    <Icons.ICON_KEYSHOPS />
                </div>

                <div className="gg-settings-pill-content">
                    <div className="gg-settings-pill-title">{t('settingsKeyshopsTitle')}</div>
                    <div className="gg-settings-pill-desc">{t('settingsKeyshopsDescription')}</div>
                </div>

                <div className="gg-settings-pill-switch">
                    <label htmlFor="gg-ext-switch--keyshops">
                        <input
                            id="gg-ext-switch--keyshops"
                            type="checkbox"
                            checked={props.keyshopsEnabled}
                            onChange={(event) => props.onKeyshopsEnabledChange((event.currentTarget as HTMLInputElement).checked)}
                        />
                        <span className="gg-ext-switch"></span>
                    </label>
                </div>
            </section>

            <section className={`gg-settings-pill${props.barEnabled ? ' active' : ''}`}>
                <div className="gg-settings-pill-icon">
                    <Icons.ICON_EXT_BAR />
                </div>

                <div className="gg-settings-pill-content">
                    <div className="gg-settings-pill-title">{t('settingsBarTitle')}</div>
                    <div className="gg-settings-pill-desc">{t('settingsBarDescription')}</div>
                </div>

                <div className="gg-settings-pill-switch">
                    <label htmlFor="gg-ext-switch--bar">
                        <input
                            id="gg-ext-switch--bar"
                            type="checkbox"
                            checked={props.barEnabled}
                            onChange={(event) => props.onBarEnabledChange((event.currentTarget as HTMLInputElement).checked)}
                        />
                        <span className="gg-ext-switch"></span>
                    </label>
                </div>
            </section>

            {excludedItems.length ? <section className="gg-settings-pill active">
                <div className="gg-settings-pill-icon">
                    <Icons.ICON_BLACKLIST />
                </div>

                <div className="gg-settings-pill-content">
                    {props.showBlacklistAlert && (
                        <InfoBox
                            type="warning"
                            heading={t('settingsWebsiteHiddenHeading')}
                            nonDismissible
                        >
                            {t('settingsWebsiteHiddenDescription')}
                        </InfoBox>
                    )}

                    <div className="gg-settings-pill-title">{t('settingsBlacklistTitle')}</div>
                    <div className="gg-settings-pill-desc">{t('settingsBlacklistDescription')}</div>

                    <ExcludedWebsitesManager
                        initialItems={excludedItems}
                        onItemsChange={(items) => {
                            setExcludedItems(items);
                            saveExcludedWebsites(items.map((item) => item.value));
                        }}
                    />
                </div>
            </section> : ''}
        </section>
    );
}
