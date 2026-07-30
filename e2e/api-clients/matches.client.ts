import { BaseApiClient } from './base.client';

export interface Match {
    id: number;
    title: string;
    company: string;
    url: string;
    score: number;
    reasoning: string;
    applied: boolean;
    created_at: string;
}

export interface MatchesResponse {
    matches: Match[];
    total_all?: number;
    has_more?: boolean;
}

export interface CoverLetterResponse {
    cover_letter: string;
}

export class MatchesApiClient extends BaseApiClient {
    async getMatches(params: { applied?: boolean; page?: number; limit?: number; sort?: string } = {}, token?: string) {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        return this.request.get('/api/matches', { params, headers });
    }

    async toggleApply(matchId: number, applied: boolean, token?: string) {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        return this.request.post(`/api/matches/${matchId}/apply`, { data: { applied }, headers });
    }

    async generateCoverLetter(matchId: number, token?: string) {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        return this.request.post(`/api/matches/${matchId}/cover-letter`, { headers });
    }

    async deleteMatch(matchId: number, token?: string) {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        return this.request.delete(`/api/matches/${matchId}`, { headers });
    }
}