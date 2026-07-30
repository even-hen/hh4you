import { test, expect } from '../../fixtures/test-base';
import { generateUserData } from '../../data/user-factory';
import { CV_SAMPLES } from '../../data/cv-samples';
import { DbSeeder } from '../../fixtures/db-seeder';
import { AuthLoginResponse } from '../../api-clients/auth.client';

/**
 * API: Guest Session Endpoints
 * Covers POST /api/guest/start and POST /api/guest/register
 *
 * NOTE: /api/guest/start calls the LLM (extractSpecializationFromCv + analyzeCv).
 * In test mode (NODE_ENV=test), if LLM_API_KEY is not configured, callLlm() returns
 * an empty string and extractSpecializationFromCv throws a generic error (not INVALID_CV).
 * Tests that depend on LLM returning a valid result are annotated accordingly.
 */
test.describe('API: Guest Session', () => {
    const createdEmails: string[] = [];

    test.afterEach(async () => {
        for (const email of createdEmails) {
            await DbSeeder.deleteUser(email);
        }
        createdEmails.length = 0;
    });

    const getTrackedUser = () => {
        const u = generateUserData();
        createdEmails.push(u.email);
        return u;
    };

    test.describe('POST /api/guest/start — input validation (no LLM needed)', () => {
        test('rejects CV text shorter than 200 chars', async ({ guestClient }) => {
            const res = await guestClient.startGuestSession(CV_SAMPLES.TOO_SHORT);
            expect(res.status()).toBe(400);
            const body = await res.json();
            expect(body.detail).toMatch(/200/); // mentions the 200-char minimum
        });

        test('rejects CV text longer than 8000 chars', async ({ guestClient }) => {
            const res = await guestClient.startGuestSession(CV_SAMPLES.TOO_LONG);
            expect(res.status()).toBe(400);
            const body = await res.json();
            expect(body.detail).toMatch(/8000/); // mentions the 8000-char max
        });

        test('rejects empty/missing cv_text body', async ({ guestClient }) => {
            const res = await guestClient.startGuestSession('');
            expect(res.status()).toBe(400);
            const body = await res.json();
            expect(body.detail).toBeDefined();
        });
    });

    test.describe('POST /api/guest/start — with LLM', () => {
        test('valid CV returns guest_token, role_id, cv_analysis (or 500 if LLM unconfigured)', async ({ guestClient }) => {
            test.setTimeout(60000);
            const res = await guestClient.startGuestSession(CV_SAMPLES.VALID_BACKEND);
            // Accept 200 (LLM configured) or 500 (LLM not configured in this test env)
            expect([200, 500]).toContain(res.status());

            if (res.status() === 200) {
                const body = await res.json();
                expect(body.guest_token).toBeDefined();
                expect(body.role_id).toBeDefined();
            }
        });

        test('gibberish CV (≥200 chars) returns 400 INVALID_CV (if LLM configured) or 500', async ({ guestClient }) => {
            const res = await guestClient.startGuestSession(CV_SAMPLES.INVALID_GIBBERISH);
            // LLM configured → 400 INVALID_CV; LLM unconfigured → 500
            expect([400, 500]).toContain(res.status());

            if (res.status() === 400) {
                const body = await res.json();
                // The Russian INVALID_CV message
                expect(body.detail).toContain('резюме');
            }
        });
    });

    test.describe('POST /api/guest/register — account conversion', () => {
        test('returns 401 without a valid guest JWT', async ({ guestClient }) => {
            const user = getTrackedUser();
            const res = await guestClient.registerGuest(user, 'invalid-token');
            expect(res.status()).toBe(401);
        });

        test('returns 400 when called with a non-guest JWT (regular user)', async ({ authClient, guestClient }) => {
            // Register and login a regular user
            const user = getTrackedUser();
            await authClient.register(user);
            const loginRes = await authClient.login(user);
            const { access_token } = await loginRes.json() as AuthLoginResponse;

            // Try to use their token on the guest-only endpoint
            const convertUser = getTrackedUser();
            const res = await guestClient.registerGuest(convertUser, access_token);
            expect(res.status()).toBe(400);
            const body = await res.json();
            expect(body.detail).toMatch(/guest/i);
        });
    });
});
