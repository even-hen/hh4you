export interface UserData {
    email: string;
    password: string;
}

/**
 * Generates a collision-free user payload for test worker isolation.
 * Uses timestamp + random suffix to guarantee uniqueness across parallel workers.
 */
export function generateUserData(overrides: Partial<UserData> = {}): UserData {
    const uniqueTag = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return {
        email: `qa_user_${uniqueTag}@example.com`,
        password: 'TestPassword123!',
        ...overrides,
    };
}