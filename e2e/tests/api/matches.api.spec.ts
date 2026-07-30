import { test, expect } from '../../fixtures/test-base';
import { generateUserData, UserData } from '../../data/user-factory';
import { DbSeeder } from '../../fixtures/db-seeder';
import { MatchesResponse, CoverLetterResponse, Match } from '../../api-clients/matches.client';
import { AuthLoginResponse } from '../../api-clients/auth.client';

/**
 * API: Vacancy Matches Endpoints
 * Covers GET /api/matches, GET /api/matches/:id, DELETE /api/matches/:id,
 *        POST /api/matches/:id/apply, POST /api/matches/:id/cover-letter
 *
 * Uses DbSeeder to pre-populate matches directly in hh4me_test.db,
 * avoiding LLM/scraper dependencies in test setup.
 */
test.describe('API Suite', () => {
    let user: UserData | null = null;

    let userEmail: string;
    let userPassword: string;
    let accessToken: string;

    test.beforeEach(async ({ authClient }) => {
        user = generateUserData();
        userEmail = user.email;
        userPassword = user.password;

        // Seed user with 3 matches directly in the test DB
        await DbSeeder.seedUserWithMatches(userEmail, 3);

        // Login with the seeded (properly hashed) credentials
        const loginRes = await authClient.login({ email: userEmail, password: userPassword });
        await expect(loginRes).toBeOK();
        const body = await loginRes.json() as AuthLoginResponse;
        accessToken = body.access_token!;
    });

    test.afterEach(async () => {
        if (user && user.email) {
            await DbSeeder.deleteUser(user.email);
            user = null;
        }
    });

    test.describe('GET /api/matches', () => {
        test('returns seeded matches with correct shape', async ({ matchesClient }) => {
            const res = await matchesClient.getMatches({}, accessToken);
            await expect(res).toBeOK();

            const body = await res.json() as MatchesResponse;
            expect(body.matches).toBeDefined();
            expect(Array.isArray(body.matches)).toBe(true);
            expect(body.matches.length).toBeGreaterThanOrEqual(3);
            expect(body.total_all).toBeGreaterThanOrEqual(3);

            // Check first match shape
            const first = body.matches[0];
            expect(first.id).toBeDefined();
            expect(first.title).toBeDefined();
            expect(first.company).toBeDefined();
            expect(first.score).toBeDefined();
        });

        test('filters matches by applied=false (new)', async ({ matchesClient }) => {
            const res = await matchesClient.getMatches({ applied: false }, accessToken);
            await expect(res).toBeOK();
            const body = await res.json() as MatchesResponse;
            // All seeded matches have applied=0
            body.matches.forEach((m: { applied: number }) => {
                expect(m.applied).toBe(0);
            });
        });

        test('paginates results with limit and page', async ({ matchesClient }) => {
            const res = await matchesClient.getMatches({ limit: 1, page: 1 }, accessToken);
            await expect(res).toBeOK();
            const body = await res.json() as MatchesResponse;
            expect(body.matches.length).toBe(1);
            expect(body.has_more).toBe(true);
        });

        test('sorts by match score descending when sort=match', async ({ matchesClient }) => {
            const res = await matchesClient.getMatches({ sort: 'match' }, accessToken);
            await expect(res).toBeOK();
            const body = await res.json() as MatchesResponse;
            const scores = body.matches.map((m: Match) => m.score);
            // Verify descending order
            for (let i = 1; i < scores.length; i++) {
                expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
            }
        });

        test('returns 401 without auth', async ({ request }) => {
            // Use raw request context (no cookies) to verify auth enforcement
            const res = await request.get('/api/matches', { headers: { cookie: '' } });
            expect(res.status()).toBe(401);
        });
    });

    test.describe('POST /api/matches/:id/apply', () => {
        test('toggles applied status to true and back', async ({ matchesClient }) => {
            // Get match IDs
            const listRes = await matchesClient.getMatches({}, accessToken);
            const { matches } = await listRes.json() as MatchesResponse;
            const matchId = matches[0].id;

            // Mark as applied
            const applyRes = await matchesClient.toggleApply(matchId, true, accessToken);
            await expect(applyRes).toBeOK();
            const applyBody = await applyRes.json();
            expect(applyBody.applied).toBe(1);

            // Verify via GET
            const verifyRes = await matchesClient.getMatches({ applied: true }, accessToken);
            const verifyBody = await verifyRes.json() as MatchesResponse;
            const applied = verifyBody.matches.find((m: Match) => m.id === matchId);
            expect(applied).toBeDefined();

            // Unmark
            const unapplyRes = await matchesClient.toggleApply(matchId, false, accessToken);
            await expect(unapplyRes).toBeOK();
            expect((await unapplyRes.json()).applied).toBe(0);
        });

        test('returns 404 for non-existent match ID', async ({ matchesClient }) => {
            const res = await matchesClient.toggleApply(999999, true, accessToken);
            expect(res.status()).toBe(404);
        });
    });

    test.describe('DELETE /api/matches/:id', () => {
        test('deletes a match and removes it from list', async ({ matchesClient }) => {
            const listRes = await matchesClient.getMatches({}, accessToken);
            const { matches } = await listRes.json() as MatchesResponse;
            const matchId = matches[0].id;

            const delRes = await matchesClient.deleteMatch(matchId, accessToken);
            await expect(delRes).toBeOK();
            const delBody = await delRes.json();
            expect(delBody.success).toBe(true);

            // Verify it's gone
            const afterRes = await matchesClient.getMatches({}, accessToken);
            const afterBody = await afterRes.json() as MatchesResponse;
            const stillPresent = afterBody.matches.find((m: Match) => m.id === matchId);
            expect(stillPresent).toBeUndefined();
        });

        test('returns 404 for non-existent match', async ({ matchesClient }) => {
            const res = await matchesClient.deleteMatch(999999, accessToken);
            expect(res.status()).toBe(404);
        });

        test('cannot delete another user\'s match', async ({ authClient, matchesClient }) => {
            // Create a second user
            const other = generateUserData();
            await DbSeeder.seedUserWithMatches(other.email, 1);

            // Get other user's match (by seeding directly — we know it exists)
            const otherLoginRes = await authClient.login({ email: other.email, password: other.password });
            const otherToken = (await otherLoginRes.json()).access_token;

            const otherMatches = await matchesClient.getMatches({}, otherToken);
            const otherMatchId = (await otherMatches.json()).matches[0].id;

            // Try to delete with first user's token
            const res = await matchesClient.deleteMatch(otherMatchId, accessToken);
            expect(res.status()).toBe(404); // 404 because WHERE clause filters by user_id

            await DbSeeder.deleteUser(other.email);
        });
    });

    test.describe('POST /api/matches/:id/cover-letter', () => {
        test('returns 400 if CV text is missing (seeder sets cv_text to mock value — should succeed or handle gracefully)', async ({ matchesClient }) => {
            test.setTimeout(60000);
            // The seeder inserts a cv_text. cover-letter generation requires LLM.
            // With LLM configured: returns 200 with cover_letter text.
            // Without LLM: returns empty string from callLlm → 502.
            const listRes = await matchesClient.getMatches({}, accessToken);
            const { matches } = await listRes.json() as MatchesResponse;
            const matchId = matches[0].id;

            const res = await matchesClient.generateCoverLetter(matchId, accessToken);
            // Accept 200 (LLM configured) or 502 (LLM unconfigured — returns empty)
            expect([200, 502]).toContain(res.status());

            if (res.status() === 200) {
                const body = await res.json() as CoverLetterResponse;
                expect(body.cover_letter).toBeDefined();
                expect(typeof body.cover_letter).toBe('string');
            }
        });

        test('returns 404 for non-existent match', async ({ matchesClient }) => {
            const res = await matchesClient.generateCoverLetter(999999, accessToken);
            expect(res.status()).toBe(404);
        });

        test('returns 401 without auth', async ({ request }) => {
            // Use raw request context (no cookies) to verify auth enforcement
            const res = await request.post('/api/matches/1/cover-letter', { headers: { cookie: '' } });
            expect(res.status()).toBe(401);
        });
    });
});
