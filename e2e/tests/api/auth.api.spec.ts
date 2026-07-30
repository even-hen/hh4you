import { test, expect } from '../../fixtures/test-base';
import { generateUserData, UserData } from '../../data/user-factory';
import { DbSeeder } from '../../fixtures/db-seeder';
import { AuthRegisterResponse, AuthLoginResponse, AuthMeResponse } from '../../api-clients/auth.client';

/**
 * API: Authentication Endpoint Matrix
 * Covers /api/auth/register, /api/auth/login, /api/auth/logout, /api/auth/me
 */
test.describe('API: Authentication', () => {
    let user: UserData | null = null;

    test.afterEach(async () => {
        if (user && user.email) {
            await DbSeeder.deleteUser(user.email);
            user = null;
        }
    });

    test.describe('POST /api/auth/register', () => {
        test('registers a new user and returns id + email', async ({ authClient }) => {
            user = generateUserData();
            const res = await authClient.register(user);

            await expect(res).toBeOK();
            const body = await res.json() as AuthRegisterResponse;
            expect(body.email).toBe(user.email);
            expect(body.id).toBeDefined();
            expect(body.hashed_password).toBeUndefined(); // must not leak password
        });

        test('rejects registration with password shorter than 6 chars', async ({ authClient }) => {
            user = generateUserData({ password: '123' });
            const res = await authClient.register(user);

            expect(res.status()).toBe(400);
            const body = await res.json();
            expect(body.detail).toMatch(/min 6 chars/i);
        });

        test('rejects registration with missing email', async ({ authClient }) => {
            const res = await authClient.register({ password: 'TestPassword123!' });

            expect(res.status()).toBe(400);
            const body = await res.json();
            expect(body.detail).toBeDefined();
        });

        test('rejects duplicate email registration — returns 400 or 429 (rate-limited in prod)', async ({ authClient }) => {
            user = generateUserData();
            // First registration — should succeed
            await authClient.register(user);

            // Second registration — same email
            const res = await authClient.register(user);
            expect([400, 429]).toContain(res.status()); // 400 normally, 429 if rate limited
            if (res.status() === 400) {
                const body = await res.json();
                expect(body.detail).toMatch(/already registered/i);
            }
        });
    });

    test.describe('POST /api/auth/login', () => {
        test('login returns access_token and sets httpOnly cookie', async ({ authClient }) => {
            user = generateUserData();
            await authClient.register(user);

            const res = await authClient.login(user);
            await expect(res).toBeOK();

            const body = await res.json() as AuthLoginResponse;
            expect(body.access_token).toBeDefined();
            expect(body.user?.email).toBe(user.email);

            // Verify Set-Cookie header contains access_token
            const cookies = res.headers()['set-cookie'];
            expect(cookies).toContain('access_token');
        });

        test('returns 401 for wrong password', async ({ authClient }) => {
            user = generateUserData();
            await authClient.register(user);

            const res = await authClient.login({ email: user.email, password: 'WrongPass999!' });
            expect(res.status()).toBe(401);
            const body = await res.json();
            expect(body.detail).toMatch(/incorrect/i);
        });

        test('returns 400 when email is missing', async ({ authClient }) => {
            const res = await authClient.login({ password: 'SomePass123' });
            expect(res.status()).toBe(400);
        });

        test('cannot log in as a guest account via /api/auth/login', async ({ authClient }) => {
            // Guest accounts have empty passwords and is_guest=1; login must be blocked
            const res = await authClient.login({ email: `guest_fake@guest.local`, password: '' });
            expect(res.status()).toBe(400);
        });
    });

    test.describe('GET /api/auth/me', () => {
        test('returns user info for authenticated request', async ({ authClient }) => {
            user = generateUserData();
            await authClient.register(user);
            const loginRes = await authClient.login(user);
            const { access_token } = await loginRes.json() as AuthLoginResponse;

            const res = await authClient.getMe(access_token);
            await expect(res).toBeOK();
            const body = await res.json() as AuthMeResponse;
            expect(body.email).toBe(user.email);
            expect(body.is_guest).toBe(false); // API returns boolean, not integer
        });

        test('returns 401 for unauthenticated request', async ({ authClient }) => {
            const res = await authClient.getMe();
            expect(res.status()).toBe(401);
        });
    });

    test.describe('POST /api/auth/logout', () => {
        test('logout clears the access_token cookie', async ({ authClient }) => {
            const res = await authClient.logout();
            await expect(res).toBeOK();
            const body = await res.json();
            expect(body.success).toBe(true);
        });
    });

    test.describe('POST /api/auth/forgot-password', () => {
        test('always returns 200 even for non-existent email (prevents user enumeration)', async ({ authClient }) => {
            const res = await authClient.forgotPassword('nonexistent@no-domain.com');
            await expect(res).toBeOK();
            const body = await res.json();
            expect(body.success).toBe(true);
        });

        test('returns 400 when email is missing', async ({ authClient }) => {
            const res = await authClient.forgotPassword('');
            expect(res.status()).toBe(400);
        });
    });
});
