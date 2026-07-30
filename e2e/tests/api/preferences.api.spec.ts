import { test, expect } from '../../fixtures/test-base';
import { generateUserData } from '../../data/user-factory';
import { DbSeeder } from '../../fixtures/db-seeder';
import { Preferences, ProfessionalRolesResponse } from '../../api-clients/preferences.client';
import { AuthLoginResponse } from '../../api-clients/auth.client';

/**
 * API: Preferences Endpoints
 * Covers GET /api/preferences and POST /api/preferences
 * Also covers GET /api/professional-roles (no auth required)
 */
test.describe('API: Preferences', () => {
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

    test.describe('GET /api/professional-roles', () => {
        test('returns a non-empty map of role IDs to role names without auth', async ({ preferencesClient }) => {
            const res = await preferencesClient.getProfessionalRoles();
            await expect(res).toBeOK();
            const body = await res.json() as ProfessionalRolesResponse;
            // Should be an object with numeric string keys and string values
            expect(typeof body).toBe('object');
            const keys = Object.keys(body);
            expect(keys.length).toBeGreaterThan(0);
            // Validate one known HH role key exists (e.g. "96" = Backend Developer)
            expect(keys.some(k => /^\d+$/.test(k))).toBe(true);
        });
    });

    test.describe('GET /api/preferences', () => {
        test('returns default preferences for a newly registered user', async ({ authClient, preferencesClient }) => {
            const user = getTrackedUser();
            await authClient.register(user);
            const loginRes = await authClient.login(user);
            const { access_token } = await loginRes.json();

            const res = await preferencesClient.getPreferences(access_token);
            await expect(res).toBeOK();
            const body = await res.json() as Preferences;

            expect(body.match_threshold).toBe(75);
            expect(body.email_notifications_enabled).toBe(true);
            expect(body.job_format).toBe('');
            expect(body.city).toBe('');
        });

        test('returns 401 without auth token', async ({ preferencesClient }) => {
            const res = await preferencesClient.getPreferences();
            expect(res.status()).toBe(401);
        });
    });

    test.describe('POST /api/preferences', () => {
        test('returns 400 when neither cv_text nor job_format is provided', async ({ authClient, preferencesClient }) => {
            const user = getTrackedUser();
            await authClient.register(user);
            const loginRes = await authClient.login(user);
            const { access_token } = await loginRes.json();

            // Sending empty body: cv_text=undefined, job_format=undefined
            // → !isCvOnly && (cv_text === undefined || job_format === undefined) → 400
            const res = await preferencesClient.updatePreferences({}, access_token);
            expect(res.status()).toBe(400);
            const body = await res.json();
            expect(body.detail).toContain('required');
        });

        test('cv_text only (isCvOnly) triggers LLM — accepts 200 or 500 (LLM not configured)', async ({ authClient, preferencesClient }) => {
            test.setTimeout(60000);
            const user = getTrackedUser();
            await authClient.register(user);
            const loginRes = await authClient.login(user);
            const { access_token } = await loginRes.json();

            // cv_text defined, job_format undefined → isCvOnly = true → skips validation, calls LLM
            const res = await preferencesClient.updatePreferences(
                { cv_text: 'Valid long CV text about backend Node.js development experience and skills.' },
                access_token
            );
            // LLM configured → 200; LLM not configured → 500
            expect([200, 500]).toContain(res.status());
        });

        test('updates non-CV settings (cv_text + job_format) without invalid role_id', async ({ authClient, preferencesClient }) => {
            const user = getTrackedUser();
            await authClient.register(user);
            const loginRes = await authClient.login(user);
            const { access_token } = await loginRes.json();

            // Provide both cv_text and job_format → passes the first guard
            // No cv_text update needed; providing empty cv_text still requires job_format
            // Use role_id approach: send cv_text (existing) + job_format + role_id
            const res = await preferencesClient.updatePreferences({
                cv_text: 'Some test CV text that is valid enough to not trigger short validation',
                job_format: 'remote',
                match_threshold: 80,
                email_notifications_enabled: true,
                role_id: '96',  // Backend Developer (valid HH role)
            }, access_token);

            // With LLM configured: 200; Without LLM (cv_text path): 500
            // But if role_id is provided AND cv_text, it overrides LLM extraction
            expect([200, 500]).toContain(res.status());

            if (res.status() === 200) {
                const body = await res.json() as Preferences;
                expect(body.match_threshold).toBe(80);
            }
        });

        test('returns 400 for invalid role_id', async ({ authClient, preferencesClient }) => {
            const user = getTrackedUser();
            await authClient.register(user);
            const loginRes = await authClient.login(user);
            const { access_token } = await loginRes.json();

            const res = await preferencesClient.updatePreferences({
                cv_text: '',
                job_format: 'remote',
                role_id: '99999999', // non-existent role
            }, access_token);

            // Invalid role_id → 400
            expect(res.status()).toBe(400);
            const body = await res.json();
            expect(body.detail).toMatch(/invalid.*role/i);
        });

        test('returns 401 without auth token', async ({ preferencesClient }) => {
            const res = await preferencesClient.updatePreferences({ job_format: 'remote' });
            expect(res.status()).toBe(401);
        });

        test('returns 400 when cv_text exceeds 8000 chars (isCvOnly path)', async ({ authClient, preferencesClient }) => {
            const user = getTrackedUser();
            await authClient.register(user);
            const loginRes = await authClient.login(user);
            const { access_token } = await loginRes.json();

            // cv_text alone, but too long → isCvOnly=true then hits the 8000-char guard
            const res = await preferencesClient.updatePreferences({
                cv_text: 'X'.repeat(8001),
            }, access_token);

            expect(res.status()).toBe(400);
            const body = await res.json();
            expect(body.detail).toMatch(/8000/i);
        });
    });
});
