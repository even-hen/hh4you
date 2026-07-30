import { Page, Locator } from '@playwright/test';

export abstract class BasePage {
    readonly page: Page;
    readonly toastAlert: Locator;
    readonly userEmailBadge: Locator;

    constructor(page: Page) {
        this.page = page;
        this.toastAlert = page.locator('.toast, [role="alert"]');
        this.userEmailBadge = page.getByTestId('user-email-display');
    }

    async goto(path = '/') {
        await this.page.goto(path);
    }
}