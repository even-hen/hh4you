import { test, expect } from '../../fixtures/test-base';
import { generateUserData } from '../../data/user-factory';
import { DbSeeder } from '../../fixtures/db-seeder';

/**
 * UI: Authentication Flow Tests
 * Tests the #auth-screen section — login, registration, forgot password tabs.
 */
test.describe('UI: Authentication', () => {

    test.beforeEach(async ({ landingPage, authModalPage }) => {
        await landingPage.goto();
        await landingPage.openLoginScreen();
        await authModalPage.waitForVisible();
    });

    test('auth screen shows Login and Register tabs', async ({ authModalPage }) => {
        await expect(authModalPage.loginTab).toBeVisible();
        await expect(authModalPage.registerTab).toBeVisible();
    });

    test('login form fields are present', async ({ authModalPage }) => {
        await expect(authModalPage.loginEmailInput).toBeVisible();
        await expect(authModalPage.loginPasswordInput).toBeVisible();
        await expect(authModalPage.loginSubmitButton).toBeVisible();
    });

    test('switching to Register tab shows the register form', async ({ authModalPage }) => {
        await authModalPage.registerTab.click();
        await expect(authModalPage.registerEmailInput).toBeVisible();
        await expect(authModalPage.registerPasswordInput).toBeVisible();
        await expect(authModalPage.registerSubmitButton).toBeVisible();
    });

    test('successful registration navigates to the main app or CV upload flow', async ({ authModalPage, dashboardPage }) => {
        const user = generateUserData();

        await authModalPage.registerTab.click();
        await authModalPage.registerEmailInput.fill(user.email);
        await authModalPage.registerPasswordInput.fill(user.password);
        await authModalPage.registerSubmitButton.click();

        // The frontend auto-logs in after registration. Activate subscription so
        // checkBillingStatus() won't show the billing overlay over #main-app.
        await DbSeeder.activateSubscription(user.email);

        // After registration the frontend navigates to main-app or cv-upload-modal
        await expect(dashboardPage.mainApp).toBeVisible({ timeout: 10000 });

        // Cleanup
        await DbSeeder.deleteUser(user.email);
    });

    test('successful login navigates to the main app', async ({ authModalPage, dashboardPage, authClient }) => {
        const user = generateUserData();
        // Register via API first, then immediately grant an active subscription
        // so the billing overlay doesn't block #main-app after login.
        await authClient.register(user);
        await DbSeeder.activateSubscription(user.email);

        await authModalPage.login(user.email, user.password);

        // Main app should become visible after login
        await expect(dashboardPage.mainApp).toBeVisible({ timeout: 10000 });

        // Cleanup
        await DbSeeder.deleteUser(user.email);
    });

    test('incorrect login credentials show an error toast or message', async ({ authModalPage, page }) => {
        await authModalPage.login('wrong@email.com', 'WrongPassword123!');

        // Error should be displayed (either as toast or inline error)
        const errorLocator = page.locator(
            '.toast, [role="alert"], .form-error:not(.hidden), #login-form .error, .auth-error'
        );
        await expect(errorLocator.first()).toBeVisible({ timeout: 5000 });
    });

    test('closing the auth screen returns to the landing page', async ({ authModalPage, page }) => {
        await authModalPage.closeButton.click();
        await expect(page.locator('#landing-screen')).toBeVisible();
    });

    test('forgot password link opens the forgot password form', async ({ authModalPage }) => {
        await authModalPage.openForgotPassword();
        await expect(authModalPage.forgotEmailInput).toBeVisible();
        await expect(authModalPage.forgotSubmitButton).toBeVisible();
    });
});
