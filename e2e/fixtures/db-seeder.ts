import sqlite3 from 'sqlite3';
import path from 'path';
import bcrypt from 'bcryptjs';

// Must match the path used by the backend in NODE_ENV=test / DB_TYPE=sqlite mode
const DB_PATH = process.env.TEST_DB_PATH || path.resolve(__dirname, '../../hh4me_test.db');

interface MatchSpec {
    title: string;
    score: number;
    applied?: number; // 0 = unapplied (New), 1 = applied
}

export class DbSeeder {
    private static getDbConnection(): sqlite3.Database {
        const db = new sqlite3.Database(DB_PATH);
        db.configure("busyTimeout", 10000);
        db.run('PRAGMA foreign_keys = ON;');
        return db;
    }

    /**
     * Removes all qa_user_* test accounts and guest accounts,
     * plus their cascading records (preferences, matches, processed_vacancies).
     * Safe to call in beforeEach / afterEach hooks.
     */
    static async clearTestUsers(): Promise<void> {
        const db = this.getDbConnection();
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                // Cascade deletion via FK constraints (foreign_keys = ON set by initDb)
                db.run(`DELETE FROM users WHERE email LIKE 'qa_user_%' OR is_guest = 1`, (err) => {
                    db.close();
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    }

    /**
     * Removes a single test user by email.
     */
    static async deleteUser(email: string): Promise<void> {
        const db = this.getDbConnection();
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('DELETE FROM users WHERE email = ?', [email], (err) => {
                    db.close();
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    }

    /**
     * Clears ALL test data (use only in global setup/teardown).
     */
    static async clearAll(): Promise<void> {
        const db = this.getDbConnection();
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('DELETE FROM vacancy_matches');
                db.run('DELETE FROM processed_vacancies');
                db.run('DELETE FROM user_preferences');
                db.run(`DELETE FROM users WHERE email LIKE 'qa_user_%' OR is_guest = 1`, (err) => {
                    db.close();
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    }

    /**
     * Inserts a registered user with an active subscription (30 days from now)
     * plus a given number of seeded vacancy matches.
     * Returns the new user's database ID.
     *
     * NOTE: password is hashed so the user can log in with 'TestPassword123!'.
     */
    static async seedUserWithMatches(email: string, matchCount = 3): Promise<number> {
        const db = this.getDbConnection();
        const hashedPassword = bcrypt.hashSync('TestPassword123!', 10);

        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run(
                    `INSERT INTO users (email, hashed_password, subscription_ends_at, is_guest)
                     VALUES (?, ?, datetime('now', '+30 days'), 0)`,
                    [email, hashedPassword],
                    function (err) {
                        if (err) return reject(err);
                        const userId = this.lastID;

                        db.run(
                            `INSERT INTO user_preferences (user_id, cv_text, extracted_specialization, job_format, match_threshold)
                             VALUES (?, 'Mock CV Text — достаточно длинный текст для теста', '96', 'remote', 75)`,
                            [userId],
                            function(err2) {
                                if (err2) return reject(err2);

                                // Varied scores so sort order is observable
                                const scores = [90, 78, 82, 76, 88, 80];
                                let completed = 0;
                                if (matchCount === 0) {
                                    db.close();
                                    return resolve(userId);
                                }

                                for (let i = 1; i <= matchCount; i++) {
                                    const score = scores[(i - 1) % scores.length];
                                    db.run(
                                        `INSERT INTO vacancy_matches (user_id, title, company, url, description, score, reasoning, cover_letter, applied)
                                         VALUES (?, ?, 'Tech Corp', 'https://example.com/vac/${i}', 'Great job role description', ${score}, 'High match score', '', 0)`,
                                        [userId, `Developer Position #${i}`],
                                        (err3) => {
                                            if (err3) return reject(err3);
                                            completed++;
                                            if (completed === matchCount) {
                                                db.close();
                                                resolve(userId);
                                            }
                                        }
                                    );
                                }
                            }
                        );
                    }
                );
            });
        });
    }

    /**
     * Seeds a user with mixed vacancy matches:
     *   - 2 unapplied vacancies (scores 82, 78) visible under "New" filter
     *   - 1 applied vacancy (score 90) hidden under "New" filter
     * Useful for testing filter pills and sort order.
     */
    static async seedUserWithMixedMatches(email: string): Promise<number> {
        const specs: MatchSpec[] = [
            { title: 'Applied Senior Dev', score: 90, applied: 1 },
            { title: 'Unapplied Backend Dev', score: 82, applied: 0 },
            { title: 'Unapplied Frontend Dev', score: 78, applied: 0 },
        ];
        return this.seedUserWithSpecificMatches(email, specs);
    }

    /**
     * Seeds a user with a specific list of match specs.
     * Each spec defines title, score, and applied status.
     */
    static async seedUserWithSpecificMatches(email: string, specs: MatchSpec[]): Promise<number> {
        const db = this.getDbConnection();
        const hashedPassword = bcrypt.hashSync('TestPassword123!', 10);

        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run(
                    `INSERT INTO users (email, hashed_password, subscription_ends_at, is_guest)
                     VALUES (?, ?, datetime('now', '+30 days'), 0)`,
                    [email, hashedPassword],
                    function (err) {
                        if (err) return reject(err);
                        const userId = this.lastID;

                        db.run(
                            `INSERT INTO user_preferences (user_id, cv_text, extracted_specialization, job_format, match_threshold)
                             VALUES (?, 'Mock CV Text — достаточно длинный текст для теста', '96', 'remote', 75)`,
                            [userId],
                            function (err2) {
                                if (err2) return reject(err2);

                                if (specs.length === 0) {
                                    db.close();
                                    return resolve(userId);
                                }

                                let completed = 0;
                                for (let i = 0; i < specs.length; i++) {
                                    const { title, score, applied = 0 } = specs[i];
                                    db.run(
                                        `INSERT INTO vacancy_matches (user_id, title, company, url, description, score, reasoning, cover_letter, applied)
                                         VALUES (?, ?, 'Tech Corp', 'https://example.com/vac/${i + 1}', 'Great job role description', ?, 'High match score', '', ?)`,
                                        [userId, title, score, applied],
                                        (err3) => {
                                            if (err3) return reject(err3);
                                            completed++;
                                            if (completed === specs.length) {
                                                db.close();
                                                resolve(userId);
                                            }
                                        }
                                    );
                                }
                            }
                        );
                    }
                );
            });
        });
    }

    /**
     * Grants an active 30-day subscription to a user by email.
     * Call this after UI-driven registration (which creates users with no subscription)
     * to prevent the billing overlay from blocking further test assertions.
     */
    static async activateSubscription(email: string): Promise<void> {
        const db = this.getDbConnection();
        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE users SET subscription_ends_at = datetime('now', '+30 days') WHERE email = ?`,
                [email],
                (err) => {
                    db.close();
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    /**
     * Deactivates subscription/trial for a user by email.
     */
    static async deactivateSubscription(email: string): Promise<void> {
        const db = this.getDbConnection();
        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE users SET subscription_ends_at = NULL, is_trial = 0 WHERE email = ?`,
                [email],
                (err) => {
                    db.close();
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    /**
     * Reads the current match count for a user from the test DB.
     */
    static async getMatchCount(userId: number): Promise<number> {
        const db = this.getDbConnection();
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT COUNT(*) as count FROM vacancy_matches WHERE user_id = ?',
                [userId],
                (err, row: { count: number }) => {
                    db.close();
                    if (err) reject(err);
                    else resolve(row ? row.count : 0);
                }
            );
        });
    }
}