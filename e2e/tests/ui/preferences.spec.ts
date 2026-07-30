import { test, expect } from '../../fixtures/test-base';
import { generateUserData } from '../../data/user-factory';
import { DbSeeder } from '../../fixtures/db-seeder';

/**
 * UI: Search Settings Screen Tests
 * Tests the #view-search-settings panel within #main-app.
 */
test.describe('UI: Search Settings', () => {
    let user: ReturnType<typeof generateUserData>;

    test.beforeEach(async ({ authClient, dashboardPage, settingsPage, page }) => {
        user = generateUserData();
        await DbSeeder.seedUserWithMatches(user.email, 0);

        const loginRes = await authClient.login({ email: user.email, password: user.password });
        await expect(loginRes).toBeOK();
        const { access_token } = await loginRes.json();
        await page.context().addCookies([{ name: 'access_token', value: access_token, url: 'http://127.0.0.1:8000' }]);

        await dashboardPage.goto();
        // Open settings via sidebar
        await settingsPage.openViaNavbar();
    });

    test.afterEach(async () => {
        await DbSeeder.deleteUser(user.email);
    });

    test('settings panel is visible with all expected controls', async ({ settingsPage }) => {
        await expect(settingsPage.settingsPanel).toBeVisible();
        await expect(settingsPage.roleSelect).toBeVisible();
        await expect(settingsPage.thresholdSlider).toBeVisible();
        await expect(settingsPage.saveButton).toBeVisible();
    });

    test('professional role dropdown is populated with roles', async ({ settingsPage }) => {
        // The dropdown should have more than just the placeholder option
        const optionCount = await settingsPage.roleSelect.locator('option').count();
        expect(optionCount).toBeGreaterThan(1);

        // Collect option texts and confirm recognizable role names are present
        const optionTexts = await settingsPage.roleSelect.locator('option').allTextContents();
        const hasRoleNames = optionTexts.some(text =>
            /разработчик|developer|аналитик|engineer|менеджер|designer|qa|тестировщик/i.test(text)
        );
        expect(hasRoleNames).toBe(true);
    });

    test('job format checkboxes are present and correct defaults are set', async ({ settingsPage }) => {
        // Seeded user has 'remote' format
        await expect(settingsPage.formatRemote).toBeChecked();
        await expect(settingsPage.formatHybrid).not.toBeChecked();
        await expect(settingsPage.formatOnsite).not.toBeChecked();
    });

    test('threshold slider shows the current value', async ({ settingsPage }) => {
        // Default threshold is 75
        await expect(settingsPage.thresholdValueDisplay).toContainText('75');
    });

    test('changing threshold slider updates the displayed value', async ({ settingsPage }) => {
        await settingsPage.setThreshold(80);
        await expect(settingsPage.thresholdValueDisplay).toContainText('80');
    });

    test('city input visibility toggles based on job format', async ({ settingsPage }) => {
        // Seeded user is 'remote', so city input should be hidden
        await expect(settingsPage.cityInput).toBeHidden();

        // Checking hybrid should show the city input
        await settingsPage.toggleJobFormat('Гибрид');
        await expect(settingsPage.cityInput).toBeVisible();
    });
});
