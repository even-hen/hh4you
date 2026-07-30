import { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';

export class SettingsPage extends BasePage {
    readonly settingsPanel: Locator;

    // Professional role
    readonly roleSelect: Locator;

    // Job format checkboxes
    readonly formatRemote: Locator;
    readonly formatHybrid: Locator;
    readonly formatOnsite: Locator;

    // City input
    readonly cityInput: Locator;
    readonly cityRequiredMarker: Locator;

    // Match threshold slider
    readonly thresholdSlider: Locator;
    readonly thresholdValueDisplay: Locator;

    // Email notifications toggle
    readonly emailNotificationsToggle: Locator;

    // Save button
    readonly saveButton: Locator;

    // CV Analysis section
    readonly cvAnalysisSection: Locator;
    readonly cvAnalysisText: Locator;

    constructor(page: Page) {
        super(page);
        this.settingsPanel = page.locator('#view-search-settings');

        this.roleSelect = page.locator('#preferences-form').getByLabel('Профессиональная роль');

        this.formatRemote = page.locator('#preferences-form').getByLabel('Удалённо');
        this.formatHybrid = page.locator('#preferences-form').getByLabel('Гибрид');
        this.formatOnsite = page.locator('#preferences-form').getByLabel('Офис');

        this.cityInput = page.locator('#preferences-form').getByLabel(/Город/i);
        this.cityRequiredMarker = page.locator('#city-required-marker');

        this.thresholdSlider = page.locator('#preferences-form').getByLabel(/Минимальный рейтинг совпадения/i);
        this.thresholdValueDisplay = page.locator('#threshold-val');

        this.emailNotificationsToggle = page.locator('#preferences-form').getByLabel('Email-уведомления', { exact: false });

        this.saveButton = page.locator('#preferences-form').getByRole('button', { name: 'Применить настройки' });

        this.cvAnalysisSection = page.locator('#cv-analysis-section');
        this.cvAnalysisText = page.locator('#cv-analysis-text');
    }

    /** Navigate to settings via sidebar nav (assumes user is already on the dashboard) */
    async openViaNavbar() {
        const viewport = this.page.viewportSize();
        const isMobile = viewport && viewport.width <= 768;
        if (isMobile) {
            await this.page.locator('#mobile-nav-profile').click();
        } else {
            await this.page.locator('#nav-search-settings').click();
        }
        await this.settingsPanel.waitFor({ state: 'visible' });
    }

    /** Set match threshold slider to a percentage value (50-95) */
    async setThreshold(value: number) {
        await this.thresholdSlider.fill(String(value));
        // Trigger the oninput handler
        await this.thresholdSlider.dispatchEvent('input');
    }

    /** Toggle a job format checkbox by its label text */
    async toggleJobFormat(formatLabel: 'Удалённо' | 'Гибрид' | 'Офис') {
        await this.settingsPanel.locator('span.toggle-card').filter({ hasText: formatLabel }).click();
    }

    /** Fill city and submit settings */
    async saveSettings() {
        await this.saveButton.click();
    }
}
