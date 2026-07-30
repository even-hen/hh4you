import { BaseApiClient } from './base.client';

export interface Preferences {
    cv_text: string;
    extracted_specialization: string;
    job_format: string;
    city: string;
    match_threshold: number;
    email_notifications_enabled: boolean;
    cv_analysis: string;
}

export interface PreferencesPayload {
    cv_text?: string;
    job_format?: string;
    city?: string;
    match_threshold?: number;
    email_notifications_enabled?: boolean;
    role_id?: string;
}

export type ProfessionalRolesResponse = Record<string, string>;

export class PreferencesApiClient extends BaseApiClient {
    async getPreferences(token?: string) {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        return this.request.get('/api/preferences', { headers });
    }

    async updatePreferences(payload: PreferencesPayload, token?: string) {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        return this.request.post('/api/preferences', { data: payload, headers });
    }

    async getProfessionalRoles() {
        return this.request.get('/api/professional-roles');
    }
}