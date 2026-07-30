import { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';

export class DashboardPage extends BasePage {
    readonly mainApp: Locator;
    readonly userEmailDisplay: Locator;

    // Sidebar navigation
    readonly navDashboard: Locator;
    readonly navSettings: Locator;
    readonly navResume: Locator;
    readonly navLogout: Locator;

    // Mobile bottom navigation
    readonly mobileNavDashboard: Locator;
    readonly mobileNavProfile: Locator;
    readonly mobileNavCv: Locator;

    // Filter pills
    readonly filterNewPill: Locator;
    readonly filterAllPill: Locator;
    readonly badgeCountNew: Locator;
    readonly badgeCountAll: Locator;

    // Sort dropdown
    readonly sortDropdownTrigger: Locator;
    readonly sortCurrentVal: Locator;
    readonly sortOptionNew: Locator;
    readonly sortOptionMatch: Locator;

    // Matches grid
    readonly matchesGrid: Locator;
    readonly vacancyCards: Locator;
    readonly emptyState: Locator;

    // Detail modal (cover letter)
    readonly detailModal: Locator;
    readonly modalVacancyTitle: Locator;
    readonly modalCoverLetter: Locator;
    readonly modalCopyButton: Locator;
    readonly modalAppliedButton: Locator;
    readonly modalCloseButton: Locator;
    readonly modalVacancyUrl: Locator;

    constructor(page: Page) {
        super(page);
        this.mainApp = page.locator('#main-app');
        this.userEmailDisplay = page.locator('#user-email-display');

        this.navDashboard = page.getByRole('button', { name: 'Вакансии' });
        this.navSettings = page.getByRole('button', { name: 'Настройки' });
        this.navResume = page.locator('.sidebar-nav').getByRole('button', { name: 'Резюме' });
        this.navLogout = page.locator('.sidebar-nav').getByRole('button', { name: 'Выйти' });

        this.mobileNavDashboard = page.locator('#mobile-nav-dashboard');
        this.mobileNavProfile = page.locator('#mobile-nav-profile');
        this.mobileNavCv = page.locator('#mobile-nav-cv');

        this.filterNewPill = page.locator('.filter-pills-container').getByRole('button', { name: /Новые/ });
        this.filterAllPill = page.locator('.filter-pills-container').getByRole('button', { name: /Все/ });

        this.badgeCountNew = page.locator('#badge-count-new');
        this.badgeCountAll = page.locator('#badge-count-all');

        this.sortDropdownTrigger = page.locator('#matches-sort-dropdown').getByRole('button');
        this.sortCurrentVal = page.locator('#sort-current-val');
        this.sortOptionNew = page.getByText('Новые', { exact: true });
        this.sortOptionMatch = page.getByText('Match', { exact: true });

        this.matchesGrid = page.locator('#matches-grid');
        this.vacancyCards = page.locator('.social-feed-card');
        this.emptyState = page.locator('#matches-empty-state');

        this.detailModal = page.locator('#detail-modal');
        this.modalVacancyTitle = page.locator('#modal-vacancy-title');
        this.modalCoverLetter = page.locator('#modal-cover-letter');
        this.modalCopyButton = page.locator('#btn-copy-letter');
        this.modalAppliedButton = page.locator('#modal-btn-applied');
        this.modalCloseButton = page.locator('#detail-modal .modal-close-btn');
        this.modalVacancyUrl = page.locator('#modal-vacancy-url');
    }

    async goto(path = '/') {
        await this.page.goto(path);
        await this.mainApp.waitFor({ state: 'visible' });
    }

    /** Click the first vacancy card to open the detail modal */
    async openFirstCard() {
        await this.vacancyCards.first().click();
        await this.detailModal.waitFor({ state: 'visible' });
    }

    /** Close the detail modal */
    async closeDetailModal() {
        await this.modalCloseButton.click();
        await this.detailModal.waitFor({ state: 'hidden' });
    }

    /** Switch sort to "Match score" */
    async sortByMatchScore() {
        await this.sortDropdownTrigger.click();
        await this.sortOptionMatch.click();
    }

    /** Apply "new" filter (unapplied vacancies) */
    async filterNew() {
        await this.filterNewPill.click();
    }

    /** Apply "all" filter */
    async filterAll() {
        await this.filterAllPill.click();
    }

    /** Returns the score pill locator for the nth card (0-indexed) */
    scoreLabel(index: number): Locator {
        return this.vacancyCards.nth(index).locator('.match-score-pill');
    }
}
