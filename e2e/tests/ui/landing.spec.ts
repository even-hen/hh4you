import { test, expect } from '../../fixtures/test-base';

/**
 * UI: Landing Screen Tests
 * Tests the #landing-screen section — the very first page users see.
 * No auth required. No LLM calls.
 */
test.describe('UI: Landing Screen', () => {

    test.beforeEach(async ({ landingPage }) => {
        await landingPage.goto();
    });

    test('landing screen loads and shows the hero title', async ({ landingPage }) => {
        await expect(landingPage.heroTitle).toBeVisible();
        await expect(landingPage.heroTitle).toContainText('Загрузите резюме');
    });

    test('platform trust badges are visible (HH, Habr, SuperJob)', async ({ landingPage }) => {
        await expect(landingPage.platformHH).toBeVisible();
        await expect(landingPage.platformHabr).toBeVisible();
        await expect(landingPage.platformSJ).toBeVisible();
    });

    test('"How it works" steps section is visible', async ({ landingPage }) => {
        await expect(landingPage.stepsSection).toBeVisible();
    });

    test('FAQ section has expandable items', async ({ landingPage }) => {
        const faqItems = landingPage.faqItems;
        await expect(faqItems).toHaveCount(4);

        // Expand first FAQ item
        await landingPage.expandFaq(0);
        // After expanding, the <details> element has the "open" attribute
        await expect(faqItems.first()).toHaveAttribute('open');
    });

    test('login button opens the auth screen', async ({ landingPage, authModalPage }) => {
        await landingPage.openLoginScreen();
        await expect(authModalPage.authScreen).toBeVisible();
    });

    test('footer is visible with contact email', async ({ landingPage }) => {
        await expect(landingPage.footer).toBeVisible();
        await expect(landingPage.footer).toContainText('hh4you@internet.ru');
    });

    test('file upload CTA label is visible', async ({ landingPage }) => {
        await expect(landingPage.fileUploadTrigger).toBeVisible();
    });

    test('page has correct <title> tag', async ({ page }) => {
        await expect(page).toHaveTitle(/HH4YOU|ИИ-помощник/i);
    });
});
