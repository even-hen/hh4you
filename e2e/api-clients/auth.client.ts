import { BaseApiClient } from './base.client';

export interface AuthRegisterPayload {
    email?: string;
    password?: string;
}

export interface AuthLoginPayload {
    email?: string;
    password?: string;
}

export interface AuthRegisterResponse {
    id: number;
    email: string;
    hashed_password?: never;
    detail?: string;
}

export interface AuthLoginResponse {
    access_token?: string;
    user?: {
        id: number;
        email: string;
    };
    detail?: string;
}

export interface AuthMeResponse {
    id: number;
    email: string;
    is_guest: boolean;
}

export class AuthApiClient extends BaseApiClient {
    async register(payload: AuthRegisterPayload) {
        return this.request.post('/api/auth/register', {
            data: payload,
        })
    }

    async login(payload: AuthLoginPayload) {
        return this.request.post('/api/auth/login', {
            data: payload
        })
    }

    async getMe(token?: string) {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        return this.request.get('/api/auth/me', { headers })
    }

    async logout() {
        return this.request.post('/api/auth/logout')
    }

    async forgotPassword(email: string) {
        return this.request.post('/api/auth/forgot-password', { data: { email } })
    }

    async resetPassword(payload: { token: string; new_password?: string }) {
        return this.request.post('/api/auth/reset-password', { data: payload })
    }
}