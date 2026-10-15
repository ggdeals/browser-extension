import { useEffect, useState } from 'preact/hooks';
import type { Platform, Region, SettingsTabProps } from '../helpers';
import {
    PLATFORMS,
    REGIONS,
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

// Every supported value needs a label, so the dropdowns cannot drift from what we accept
const PLATFORM_MESSAGE_NAMES: Record<Platform, string> = {
    all: 'platformAll',
    pc: 'platformPc',
    xbox: 'platformXbox',
    playstation: 'platformPlayStation',
    nintendo: 'platformSwitch',
};

const REGION_MESSAGE_NAMES: Record<Region, string> = {
    au: 'regionAustralia',
    be: 'regionBelgium',
    br: 'regionBrazil',
    ca: 'regionCanada',
    dk: 'regionDenmark',
    eu: 'regionEurope',
    fi: 'regionFinland',
    fr: 'regionFrance',
    de: 'regionGermany',
    ie: 'regionIreland',
    it: 'regionItaly',
    nl: 'regionNetherlands',
    no: 'regionNorway',
    pl: 'regionPoland',
    es: 'regionSpain',
    se: 'regionSweden',
    ch: 'regionSwitzerland',
    gb: 'regionUnitedKingdom',
    us: 'regionUnitedStates',
};

export function SettingsTab(props: SettingsTabProps) {
    const [excludedItems, setExcludedItems] = useState<WebsiteItem[]>([]);
    const platformOptions = PLATFORMS.map((value) => ({ value, label: t(PLATFORM_MESSAGE_NAMES[value]) }));
    const regionOptions = REGIONS.map((value) => ({ value, label: t(REGION_MESSAGE_NAMES[value]) }));

    useEffect(() => {
        void loadExcludedWebsitesFromChromeStorage().then((domains) => {
            if (!domains) {
                return;
            }

            setExcludedItems(toWebsiteItems(domains));
        });
    }, []);

    return (
        <section className="gg-settings-pill-container with-pinned-link" aria-label={t('settingsTabAria')}>
            {!props.isLoggedIn && <InfoBox
                type="warning"
                heading={t('signInBetterHeading')}
                linkUrl="https://gg.deals/login/"
                linkLabel={t('signIn')}
                onSignInClick={props.onSignInClick}
            >
                {t('signInBetterDescription')}
            </InfoBox>}

            <BottomPinnedLink
                url="https://gg.deals/settings/"
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
                        onChange={(value) => props.onPlatformChange(value as Platform)}
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
                        currentValue={props.region}
                        options={regionOptions}
                        onChange={(value) => props.onRegionChange(value as Region)}
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

            <section className={`gg-settings-pill${props.subscriptionsEnabled ? ' active' : ''}`}>
                <div className="gg-settings-pill-icon">
                    <Icons.ICON_SUBSCRIPTIONS />
                </div>

                <div className="gg-settings-pill-content">
                    <div className="gg-settings-pill-title">{t('settingsSubscriptionsTitle')}</div>
                    <div className="gg-settings-pill-desc">{t('settingsSubscriptionsDescription')}</div>
                </div>

                <div className="gg-settings-pill-switch">
                    <label htmlFor="gg-ext-switch--subscriptions">
                        <input
                            id="gg-ext-switch--subscriptions"
                            type="checkbox"
                            aria-label={t('settingsSubscriptionsTitle')}
                            checked={props.subscriptionsEnabled ?? true}
                            disabled={props.subscriptionsEnabled === null || props.isSavingSubscriptions}
                            onChange={(event) => props.onSubscriptionsEnabledChange((event.currentTarget as HTMLInputElement).checked)}
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
