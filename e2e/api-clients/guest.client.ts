import { BaseApiClient } from './base.client';

export interface GuestStartResponse {
    access_token: string;
}

export interface GuestRegisterPayload {
    email: string;
    password?: string;
}

export class GuestApiClient extends BaseApiClient {
    async startGuestSession(cvText: string) {
        return this.request.post('/api/guest/start', { data: { cv_text: cvText } })
    }
    async registerGuest(payload: GuestRegisterPayload, token: string) {
        return this.request.post('/api/guest/register', {
            data: payload,
            headers: { Authorization: `Bearer ${token}` },
        });
    }
}