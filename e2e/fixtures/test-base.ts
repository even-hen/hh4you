import { test as base, expect } from '@playwright/test';
import { AuthApiClient } from '../api-clients/auth.client';
import { BillingApiClient } from '../api-clients/billing.client';
import { GuestApiClient } from '../api-clients/guest.client';
import { MatchesApiClient } from '../api-clients/matches.client';
import { PreferencesApiClient } from '../api-clients/preferences.client';

import { LandingPage } from '../pages/landing.page';
import { AuthModalPage } from '../pages/auth-modal.page';
import { DashboardPage } from '../pages/dashboard.page';
import { SettingsPage } from '../pages/settings.page';
import { GuestAppPage } from '../pages/guest-app.page';

type CustomFixtures = {
    // API Clients
    authClient: AuthApiClient;
    billingClient: BillingApiClient;
    guestClient: GuestApiClient;
    matchesClient: MatchesApiClient;
    preferencesClient: PreferencesApiClient;

    // Page Objects
    landingPage: LandingPage;
    authModalPage: AuthModalPage;
    dashboardPage: DashboardPage;
    settingsPage: SettingsPage;
    guestAppPage: GuestAppPage;
};

export const test = base.extend<CustomFixtures>({
    // API Clients
    authClient: async ({ request }, use) => { await use(new AuthApiClient(request)); },
    billingClient: async ({ request }, use) => { await use(new BillingApiClient(request)); },
    guestClient: async ({ request }, use) => { await use(new GuestApiClient(request)); },
    matchesClient: async ({ request }, use) => { await use(new MatchesApiClient(request)); },
    preferencesClient: async ({ request }, use) => { await use(new PreferencesApiClient(request)); },

    // Page Objects
    landingPage: async ({ page }, use) => { await use(new LandingPage(page)); },
    authModalPage: async ({ page }, use) => { await use(new AuthModalPage(page)); },
    dashboardPage: async ({ page }, use) => { await use(new DashboardPage(page)); },
    settingsPage: async ({ page }, use) => { await use(new SettingsPage(page)); },
    guestAppPage: async ({ page }, use) => { await use(new GuestAppPage(page)); },
});

export { expect };