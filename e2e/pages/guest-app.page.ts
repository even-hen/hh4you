import { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';

export class GuestAppPage extends BasePage {
    readonly guestApp: Locator;
    readonly guestDemoBadge: Locator;

    // Guest matches feed
    readonly guestMatchesGrid: Locator;
    readonly guestVacancyCards: Locator;
    readonly guestEmptyState: Locator;

    // Guest settings view controls (all disabled)
    readonly guestJobFormatRemote: Locator;
    readonly guestJobFormatHybrid: Locator;
    readonly guestJobFormatOnsite: Locator;
    readonly guestCityInput: Locator;
    readonly guestThresholdSlider: Locator;
    readonly guestEmailToggle: Locator;

    // Guest register modal
    readonly guestRegisterModal: Locator;
    readonly guestRegEmailInput: Locator;
    readonly guestRegPasswordInput: Locator;
    readonly guestRegSubmitButton: Locator;
    readonly guestRegErrorBox: Locator;

    // Nav
    readonly navDashboard: Locator;
    readonly navSettings: Locator;
    readonly navLogout: Locator;

    constructor(page: Page) {
        super(page);
        this.guestApp = page.locator('#guest-app');
        this.guestDemoBadge = page.locator('#guest-app .guest-demo-badge').filter({ visible: true }).first();

        this.guestMatchesGrid = page.locator('#guest-matches-grid');
        this.guestVacancyCards = page.locator('.vacancy-card, .match-card');
        this.guestEmptyState = page.locator('#guest-matches-empty');

        this.guestJobFormatRemote = page.locator('#guest-preferences-form input[name="guest-job-format"][value="remote"]');
        this.guestJobFormatHybrid = page.locator('#guest-preferences-form input[name="guest-job-format"][value="hybrid"]');
        this.guestJobFormatOnsite = page.locator('#guest-preferences-form input[name="guest-job-format"][value="onsite"]');
        this.guestCityInput = page.locator('#guest-input-city');
        this.guestThresholdSlider = page.locator('#guest-input-threshold');
        this.guestEmailToggle = page.locator('#guest-input-email-enabled');

        this.guestRegisterModal = page.locator('#guest-register-modal');
        this.guestRegEmailInput = page.locator('#guest-register-form').getByLabel('Email');
        this.guestRegPasswordInput = page.locator('#guest-register-form').getByLabel('Пароль');
        this.guestRegSubmitButton = page.locator('#btn-guest-reg-submit');
        this.guestRegErrorBox = page.locator('#guest-reg-error');

        this.navDashboard = page.getByRole('button', { name: 'Вакансии' });
        this.navSettings = page.getByRole('button', { name: 'Настройки' });
        this.navLogout = page.locator('.sidebar-nav').getByRole('button', { name: 'Выйти' });
    }

    async waitForVisible() {
        await this.guestApp.waitFor({ state: 'visible' });
    }

    /** Open the guest register/convert modal */
    async openRegisterModal() {
        await this.guestRegisterModal.waitFor({ state: 'visible' });
    }

    /** Fill and submit the guest registration form to convert to a real account */
    async convertToRealUser(email: string, password: string) {
        await this.guestRegEmailInput.fill(email);
        await this.guestRegPasswordInput.fill(password);
        await this.guestRegSubmitButton.click();
    }
}
