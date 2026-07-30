import { test, expect } from '../../fixtures/test-base';
import { generateUserData } from '../../data/user-factory';
import { DbSeeder } from '../../fixtures/db-seeder';

/**
 * UI: Dashboard & Matches Feed Tests
 * Uses DbSeeder to quickly pre-populate matches without running the scraper.
 * Authenticates via the API login endpoint (cookie is shared with browser page).
 */
test.describe('UI: Dashboard & Matches Feed', () => {
    let user: ReturnType<typeof generateUserData>;

    test.beforeEach(async ({ authClient, dashboardPage, page }) => {
        user = generateUserData();
        // Seed user with 3 matches + active subscription
        await DbSeeder.seedUserWithMatches(user.email, 3);

        // Log in via API to obtain the session cookie
        const loginRes = await authClient.login({ email: user.email, password: user.password });
        await expect(loginRes).toBeOK();
        const { access_token } = await loginRes.json();

        // Inject cookie into the browser context so the UI is logged in
        await page.context().addCookies([{ name: 'access_token', value: access_token, url: 'http://127.0.0.1:8000' }]);

        // Navigate to the app root
        await dashboardPage.goto();
    });

    test.afterEach(async () => {
        await DbSeeder.deleteUser(user.email);
    });

    test('dashboard is visible and user email is displayed', async ({ dashboardPage }) => {
        await expect(dashboardPage.mainApp).toBeVisible();
        await expect(dashboardPage.userEmailDisplay).toContainText(user.email);
    });

    test('3 seeded vacancy cards are displayed in the matches grid', async ({ dashboardPage }) => {
        await expect(dashboardPage.vacancyCards).toHaveCount(3, { timeout: 8000 });
    });

    test('"New" and "All" filter pills are visible and functional', async ({ authClient, dashboardPage, page }) => {
        // Re-seed with mixed matches: 1 applied (score 90) + 2 unapplied (82, 78)
        await DbSeeder.deleteUser(user.email);
        user = generateUserData();
        await DbSeeder.seedUserWithMixedMatches(user.email);

        const loginRes = await authClient.login({ email: user.email, password: user.password });
        await expect(loginRes).toBeOK();
        const { access_token } = await loginRes.json();
        await page.context().addCookies([{ name: 'access_token', value: access_token, url: 'http://127.0.0.1:8000' }]);
        await dashboardPage.goto();

        // "All" pill is visible
        await expect(dashboardPage.filterAllPill).toBeVisible();
        await expect(dashboardPage.filterNewPill).toBeVisible();

        // "All" shows all 3 vacancies
        await dashboardPage.filterAll();
        await expect(dashboardPage.vacancyCards).toHaveCount(3, { timeout: 8000 });

        // "New" hides the applied vacancy — only 2 unapplied cards remain
        await dashboardPage.filterNew();
        await expect(dashboardPage.vacancyCards).toHaveCount(2, { timeout: 8000 });

        // Back to "All" restores all 3
        await dashboardPage.filterAll();
        await expect(dashboardPage.vacancyCards).toHaveCount(3, { timeout: 8000 });
    });

    test('sort dropdown changes sort label and orders by score descending', async ({ authClient, dashboardPage, page }) => {
        // Re-seed with varied scores: 90, 78, 82 — so sort order is observable
        await DbSeeder.deleteUser(user.email);
        user = generateUserData();
        await DbSeeder.seedUserWithMixedMatches(user.email); // scores: 90 (applied), 82, 78

        const loginRes = await authClient.login({ email: user.email, password: user.password });
        await expect(loginRes).toBeOK();
        const { access_token } = await loginRes.json();
        await page.context().addCookies([{ name: 'access_token', value: access_token, url: 'http://127.0.0.1:8000' }]);
        await dashboardPage.goto();

        // Switch to "All" so every card is visible regardless of applied status
        await dashboardPage.filterAll();
        await expect(dashboardPage.vacancyCards).toHaveCount(3, { timeout: 8000 });

        // Sort by Match score — label should update
        await dashboardPage.sortByMatchScore();
        await expect(dashboardPage.sortCurrentVal).toContainText('Match');

        // After sorting by Match, the first card should show the highest score (90%)
        await expect(dashboardPage.scoreLabel(0)).toContainText('90');
    });

    test('clicking a vacancy card opens the detail modal', async ({ dashboardPage }) => {
        await dashboardPage.openFirstCard();
        await expect(dashboardPage.detailModal).toBeVisible();
        await expect(dashboardPage.modalVacancyTitle).not.toBeEmpty();
    });

    test('closing the detail modal hides it', async ({ dashboardPage }) => {
        await dashboardPage.openFirstCard();
        await dashboardPage.closeDetailModal();
        await expect(dashboardPage.detailModal).toBeHidden();
    });

    test('sidebar navigation links are present', async ({ dashboardPage, isMobile }) => {
        test.skip(isMobile, 'Sidebar is not shown on mobile — use bottom nav test instead');
        await expect(dashboardPage.navDashboard).toBeVisible();
        await expect(dashboardPage.navSettings).toBeVisible();
        await expect(dashboardPage.navResume).toBeVisible();
        await expect(dashboardPage.navLogout).toBeVisible();
    });

    test('mobile bottom navigation bar links are present', async ({ dashboardPage, isMobile }) => {
        test.skip(!isMobile, 'Bottom nav bar is only present on mobile viewports');
        await expect(dashboardPage.mobileNavDashboard).toBeVisible();
        await expect(dashboardPage.mobileNavProfile).toBeVisible();
        await expect(dashboardPage.mobileNavCv).toBeVisible();
    });
});
