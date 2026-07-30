import { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Auth screen POM — the app uses a full-screen section (#auth-screen),
 * not a modal overlay. Two tabs: Login and Register.
 * Forgot password is a third tab triggered by a link.
 */
export class AuthModalPage extends BasePage {
    readonly authScreen: Locator;
    readonly closeButton: Locator;

    // Tab buttons
    readonly loginTab: Locator;
    readonly registerTab: Locator;

    // Login form
    readonly loginEmailInput: Locator;
    readonly loginPasswordInput: Locator;
    readonly loginSubmitButton: Locator;
    readonly forgotPasswordLink: Locator;

    // Register form
    readonly registerEmailInput: Locator;
    readonly registerPasswordInput: Locator;
    readonly registerSubmitButton: Locator;

    // Forgot password form
    readonly forgotEmailInput: Locator;
    readonly forgotSubmitButton: Locator;

    constructor(page: Page) {
        super(page);
        this.authScreen = page.locator('#auth-screen'); // Unavoidable layout wrapper
        this.closeButton = page.locator('#auth-screen').getByRole('button', { name: '×' });

        this.loginTab = page.locator('#auth-tabs-container').getByRole('button', { name: 'Войти', exact: true });
        this.registerTab = page.getByRole('button', { name: 'Регистрация' });

        this.loginEmailInput = page.locator('#login-form').getByLabel('Email');
        this.loginPasswordInput = page.locator('#login-form').getByLabel('Пароль');
        this.loginSubmitButton = page.locator('#login-form').getByRole('button', { name: 'Войти', exact: true });
        this.forgotPasswordLink = page.getByRole('link', { name: 'Забыли пароль?' });

        this.registerEmailInput = page.locator('#register-form').getByLabel('Email');
        this.registerPasswordInput = page.locator('#register-form').getByLabel('Пароль');
        this.registerSubmitButton = page.getByRole('button', { name: 'Создать аккаунт' });

        this.forgotEmailInput = page.locator('#forgot-form').getByLabel('Email');
        this.forgotSubmitButton = page.getByRole('button', { name: 'Восстановить пароль' });
    }

    /** Wait for the auth screen to be visible */
    async waitForVisible() {
        await this.authScreen.waitFor({ state: 'visible' });
    }

    /** Switch to the Register tab and fill + submit the form */
    async register(email: string, password: string) {
        await this.registerTab.click();
        await this.registerEmailInput.fill(email);
        await this.registerPasswordInput.fill(password);
        await this.registerSubmitButton.click();
    }

    /** Fill + submit the Login form (default active tab) */
    async login(email: string, password: string) {
        await this.loginTab.click();
        await this.loginEmailInput.fill(email);
        await this.loginPasswordInput.fill(password);
        await this.loginSubmitButton.click();
    }

    /** Open the Forgot Password tab */
    async openForgotPassword() {
        await this.forgotPasswordLink.click();
    }
}
