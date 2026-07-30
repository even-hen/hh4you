import { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';

export class LandingPage extends BasePage {
    // Hero section
    readonly heroTitle: Locator;
    readonly fileUploadTrigger: Locator;
    readonly fileInput: Locator;
    readonly loginButton: Locator;

    // Platforms
    readonly platformHH: Locator;
    readonly platformHabr: Locator;
    readonly platformSJ: Locator;

    // How it works steps
    readonly stepsSection: Locator;

    // FAQ
    readonly faqItems: Locator;

    // Footer
    readonly footer: Locator;

    constructor(page: Page) {
        super(page);
        this.heroTitle = page.getByRole('heading', { level: 1 });
        this.fileUploadTrigger = page.getByText('Загрузить резюме и начать поиск');
        this.fileInput = page.locator('#landing-file-input'); // Structural file input
        this.loginButton = page.getByRole('button', { name: 'Войти', exact: true });

        this.platformHH = page.locator('.platform-logo.hh');
        this.platformHabr = page.locator('.platform-logo.habr');
        this.platformSJ = page.locator('.platform-logo.superjob');

        this.stepsSection = page.locator('.landing-steps'); // Structural
        this.faqItems = page.locator('.faq-item'); // Structural for expanding
        this.footer = page.locator('footer.landing-footer'); // Structural
    }

    /** Navigate to the root landing screen and wait for it to be visible */
    async goto(path = '/') {
        await this.page.goto(path);
        await this.page.locator('#landing-screen').waitFor({ state: 'visible' });
    }

    /** Click the Login button to navigate to the auth screen */
    async openLoginScreen() {
        await this.loginButton.click();
    }

    /** Expand the nth FAQ item (0-indexed) */
    async expandFaq(index: number) {
        await this.faqItems.nth(index).locator('summary').click();
    }
}
