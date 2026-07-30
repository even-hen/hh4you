import { BaseApiClient } from './base.client';

export interface BillingStatusResponse {
    is_active: boolean;
    ends_at?: string;
    is_guest: boolean;
    guest_expires_at?: string;
}

export interface BillingPayResponse {
    payment_url?: string;
    detail?: string;
}

export interface WebhookPayload {
    event: string;
    object: {
        id: string;
        status: string;
        metadata: {
            user_id: string;
        }
    }
}

export class BillingApiClient extends BaseApiClient {
    /** GET /api/billing/status — returns subscription status for authenticated user */
    async getStatus(token?: string) {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        return this.request.get('/api/billing/status', { headers });
    }

    /**
     * POST /api/billing/pay — initiates a YooKassa payment.
     * Returns 503 if payment system is not configured (expected in tests).
     */
    async pay(token?: string) {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        return this.request.post('/api/billing/pay', { headers });
    }

    /**
     * POST /api/billing/webhook — receives YooKassa payment.succeeded events.
     * Always returns 200 immediately.
     */
    async sendWebhook(payload: WebhookPayload) {
        return this.request.post('/api/billing/webhook', { data: payload });
    }
}
