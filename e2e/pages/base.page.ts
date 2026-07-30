import { Page, Locator } from '@playwright/test';

export abstract class BasePage {
    readonly page: Page;
    readonly toastAlert: Locator;
    readonly userEmailBadge: Locator;

    constructor(page: Page) {
        this.page = page;
        this.toastAlert = page.locator('.toast, [role="alert"]');
        this.userEmailBadge = page.locator('#user-email-display');
    }

    async goto(path = '/') {
        await this.page.goto(path);
    }

    /** Wait for a toast/alert message containing the given text */
    async waitForToast(text: string | RegExp) {
        await this.toastAlert.filter({ hasText: text }).first().waitFor({ state: 'visible' });
    }
}
