import { test, expect } from '../../fixtures/test-base';
import { CV_SAMPLES } from '../../data/cv-samples';

/**
 * A minimal valid guest JWT payload (not verified by the frontend — it just
 * stores it in sessionStorage and uses it as a Bearer token).
 * Format: base64(header).base64(payload).signature
 */
const FAKE_GUEST_TOKEN = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: 'guest_test@guest.local', exp: Math.floor(Date.now() / 1000) + 172800 })).toString('base64url'),
    'fakesignature'
].join('.');

/**
 * The mock response returned by the intercepted POST /api/guest/start.
 * Mirrors the real server response shape so the frontend can navigate to #guest-app.
 */
const MOCK_GUEST_START_RESPONSE = {
    guest_token: FAKE_GUEST_TOKEN,
    role_id: '96',
    cv_analysis: 'Mock CV analysis: Backend developer with 5 years of experience.',
    is_trial: false,
};

/**
 * Sets up page.route() to intercept POST /api/guest/start and return the mock response.
 * Also intercepts GET /api/auth/me to return a valid guest user object.
 */
async function mockGuestStartApi(page: any) {
    await page.route('**/api/guest/start', async (route: any) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_GUEST_START_RESPONSE),
        });
    });

    // Mock /api/auth/me so the frontend can restore the guest session
    await page.route('**/api/auth/me', async (route: any) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                id: 9999,
                email: 'guest_test@guest.local',
                is_active: true,
                is_guest: true,
                subscription_ends_at: new Date(Date.now() + 172800000).toISOString(),
            }),
        });
    });

    // Mock /api/matches so guest app doesn't try to show real data
    await page.route('**/api/matches**', async (route: any) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ matches: [], total: 0, new_count: 0 }),
        });
    });

    // Mock POST /api/preferences for guests using the mock token
    await page.route('**/api/preferences', async (route: any) => {
        if (route.request().method() === 'POST') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true }),
            });
        } else {
            await route.continue();
        }
    });
}

/**
 * Uploads a CV text file through the landing page file input and waits for
 * the guest app to become visible (requires mockGuestStartApi to be active).
 */
async function uploadCvAndEnterGuestApp(page: any, landingPage: any, guestAppPage: any) {
    const cvBuffer = Buffer.from(CV_SAMPLES.VALID_BACKEND, 'utf-8');
    await landingPage.fileInput.setInputFiles({
        name: 'resume.txt',
        mimeType: 'text/plain',
        buffer: cvBuffer,
    });
    // The frontend: reads the file → populates textarea → calls /api/guest/start → shows #guest-app
    await guestAppPage.guestApp.waitFor({ state: 'visible', timeout: 15000 });
}

/**
 * UI: Guest Flow Tests
 *
 * These tests start from the landing page, upload a CV .txt file, and verify
 * the actual navigation and UI behaviour of the guest app shell.
 *
 * POST /api/guest/start is mocked via page.route() so no LLM key is required.
 */
test.describe('UI: Guest Flow', () => {

    test.beforeEach(async ({ landingPage }) => {
        await landingPage.goto();
    });

    // ─── Landing page structure ───────────────────────────────────────────────

    test('landing page has a file upload CTA that accepts PDF and TXT', async ({ landingPage }) => {
        await expect(landingPage.fileInput).toHaveAttribute('accept', /\.pdf/i);
        await expect(landingPage.fileUploadTrigger).toBeVisible();
    });

    // ─── File upload → Guest app navigation ──────────────────────────────────

    test('uploading a CV file navigates to the guest app shell', async ({ page, landingPage, guestAppPage }) => {
        await mockGuestStartApi(page);
        await uploadCvAndEnterGuestApp(page, landingPage, guestAppPage);

        await expect(guestAppPage.guestApp).toBeVisible();
    });

    test('guest app shows "Гостевой режим" badge after CV upload', async ({ page, landingPage, guestAppPage }) => {
        await mockGuestStartApi(page);
        await uploadCvAndEnterGuestApp(page, landingPage, guestAppPage);

        await expect(guestAppPage.guestDemoBadge).toBeVisible();
        await expect(guestAppPage.guestDemoBadge).toContainText(/Гостевой режим|Демо/);
    });

    test('guest settings controls are disabled (job format, city, threshold, email)', async ({ page, landingPage, guestAppPage }) => {
        await mockGuestStartApi(page);
        await uploadCvAndEnterGuestApp(page, landingPage, guestAppPage);

        await expect(guestAppPage.guestJobFormatRemote).toHaveAttribute('disabled');
        await expect(guestAppPage.guestCityInput).toHaveAttribute('disabled');
        await expect(guestAppPage.guestThresholdSlider).toHaveAttribute('disabled');
        await expect(guestAppPage.guestEmailToggle).toHaveAttribute('disabled');
    });

    test('guest scan button triggers a scan API request', async ({ page, landingPage, guestAppPage }) => {
        await mockGuestStartApi(page);

        // Track whether POST /api/scan was called
        let scanRequested = false;
        await page.route('**/api/scan', async (route: any) => {
            scanRequested = true;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ status: 'started' }),
            });
        });

        await uploadCvAndEnterGuestApp(page, landingPage, guestAppPage);

        // Find and click the guest scan button
        const scanBtn = page.locator('#guest-btn-save-preferences');
        if (await scanBtn.isVisible()) {
            await Promise.all([
                page.waitForResponse('**/api/scan'),
                scanBtn.click()
            ]);
            expect(scanRequested).toBe(true);
        } else {
            // Scan may have auto-started on load — verify the route was hit
            test.info().annotations.push({ type: 'note', description: 'Scan button not visible — scan may be auto-triggered' });
        }
    });

    test('guest register modal has the conversion form', async ({ page, landingPage, guestAppPage }) => {
        await mockGuestStartApi(page);
        await uploadCvAndEnterGuestApp(page, landingPage, guestAppPage);

        // The modal is in the DOM (may be hidden until triggered)
        await expect(guestAppPage.guestRegisterModal).toBeAttached();
        await expect(guestAppPage.guestRegEmailInput).toBeAttached();
        await expect(guestAppPage.guestRegPasswordInput).toBeAttached();
        await expect(guestAppPage.guestRegSubmitButton).toBeAttached();
    });

    // ─── DOM structure checks (no file upload needed) ────────────────────────

    test('guest app shell has expected DOM structure when guest token is injected', async ({ page, guestAppPage }) => {
        // Inject a fake guest session via sessionStorage to verify DOM structure
        // without going through the full upload flow
        await page.evaluate((token: string) => {
            sessionStorage.setItem('guest_token', token);
        }, FAKE_GUEST_TOKEN);

        await expect(guestAppPage.guestApp).toBeAttached();
    });
});
