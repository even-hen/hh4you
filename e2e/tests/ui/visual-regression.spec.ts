import { test, expect } from '../../fixtures/test-base';
import { generateUserData } from '../../data/user-factory';
import { DbSeeder } from '../../fixtures/db-seeder';

/**
 * UI: Visual Regression & Responsive Layout Tests
 * Verifies that key UI elements are visible and correctly rendered
 * across desktop (Chromium) and mobile (Pixel 7) viewports.
 *
 * These tests run in both the 'chromium' and 'mobile-chrome' projects
 * as configured in playwright.config.ts.
 */
test.describe('UI: Visual & Responsive', () => {
    let user: ReturnType<typeof generateUserData> | null = null;

    test.afterEach(async () => {
        if (user) {
            await DbSeeder.deleteUser(user.email);
            user = null;
        }
    });

    // ─── Landing page tests (shared beforeEach) ───────────────────────────────
    test.describe('Landing page', () => {
        test.beforeEach(async ({ landingPage }) => {
            await landingPage.goto();
        });

        test('landing page is fully rendered at current viewport', async ({ page }) => {
            if (process.env.CI) {
                await expect(page.locator('body')).toBeVisible();
                return;
            }
            await expect(page).toHaveScreenshot('landing-full.png', {
                fullPage: true,
                maxDiffPixelRatio: 0.05, // Allow 5% pixel difference for fonts/rendering
                timeout: 30000,
            });
        });

        test('no horizontal scrollbar on landing page (responsive layout check)', async ({ page }) => {
            const hasHorizontalScrollbar = await page.evaluate(() => {
                return document.documentElement.scrollWidth > document.documentElement.clientWidth;
            });

            expect(hasHorizontalScrollbar).toBe(false);
        });
    });

    // ─── Auth screen ──────────────────────────────────────────────────────────

    test('auth screen is rendered correctly', async ({ landingPage, authModalPage, page }) => {
        await landingPage.goto();
        await landingPage.openLoginScreen();
        await authModalPage.waitForVisible();

        if (process.env.CI) {
            await expect(authModalPage.authScreen).toBeVisible();
            return;
        }
        await expect(page).toHaveScreenshot('auth-screen.png', {
            maxDiffPixelRatio: 0.05,
            timeout: 30000,
        });
    });

    // ─── Authenticated views (each sets up its own user) ─────────────────────

    test('dashboard is rendered correctly with 3 seeded match cards', async ({ authClient, dashboardPage, page }) => {
        user = generateUserData();
        await DbSeeder.seedUserWithMatches(user.email, 3);

        const loginRes = await authClient.login({ email: user.email, password: user.password });
        await expect(loginRes).toBeOK();
        const { access_token } = await loginRes.json();
        await page.context().addCookies([{ name: 'access_token', value: access_token, url: 'http://127.0.0.1:8000' }]);

        await dashboardPage.goto();
        await expect(dashboardPage.vacancyCards).toHaveCount(3, { timeout: 8000 });

        if (process.env.CI) {
            await expect(dashboardPage.mainApp).toBeVisible();
            return;
        }
        await expect(page).toHaveScreenshot('dashboard-3-cards.png', {
            maxDiffPixelRatio: 0.05,
            timeout: 30000,
        });
    });

    test('settings panel is rendered correctly', async ({ authClient, dashboardPage, settingsPage, page }) => {
        user = generateUserData();
        await DbSeeder.seedUserWithMatches(user.email, 0);

        const loginRes = await authClient.login({ email: user.email, password: user.password });
        await expect(loginRes).toBeOK();
        const { access_token } = await loginRes.json();
        await page.context().addCookies([{ name: 'access_token', value: access_token, url: 'http://127.0.0.1:8000' }]);

        await dashboardPage.goto();
        await settingsPage.openViaNavbar();

        if (process.env.CI) {
            await expect(settingsPage.settingsPanel).toBeVisible();
            return;
        }
        await expect(page).toHaveScreenshot('settings-panel.png', {
            maxDiffPixelRatio: 0.05,
            timeout: 30000,
        });
    });

    test('no horizontal scrollbar on main app (responsive layout check)', async ({ authClient, dashboardPage, page }) => {
        user = generateUserData();
        await DbSeeder.seedUserWithMatches(user.email, 3);

        const loginRes = await authClient.login({ email: user.email, password: user.password });
        await expect(loginRes).toBeOK();
        const { access_token } = await loginRes.json();
        await page.context().addCookies([{ name: 'access_token', value: access_token, url: 'http://127.0.0.1:8000' }]);

        await dashboardPage.goto();

        const hasHorizontalScrollbar = await page.evaluate(() => {
            return document.documentElement.scrollWidth > document.documentElement.clientWidth;
        });
        expect(hasHorizontalScrollbar).toBe(false);
    });
});
