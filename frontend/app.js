// ==========================================================================
// HH4YOU FRONTEND STATE MANAGEMENT & CORE SETTINGS
// ==========================================================================

const API_BASE = window.location.origin;
let currentUser = null;
let currentMatches = [];
let selectedMatch = null;

// Pagination / lazy loading states
let matchesPage = 1;
const matchesLimit = 25;
let matchesHasMore = false;
let isLoadingMatches = false;
let matchesTotalCount = 0;
let matchesNewCount = 0;
let matchesAppliedCount = 0;

// Local CV & Role states
let localCvText = null;
let allRolesLoaded = {};
let pendingFile = null;
let currentSettings = null;
let pendingSettingsBody = null;

// Guest session state
let guestToken = null;
let guestCvText = '';
let guestScanInterval = null;
let guestRealMatches = [];
let guestScanComplete = false;
let guestPendingCvText = ''; // text in editor before LLM save
let activeGuestScenario = 'paywall';
let guestTrialDays = 7;
let subscriptionReminderInterval = null;
let dashboardRefreshInterval = null;
let refreshCountdownSecs = 180;

// HTML escape helper to prevent XSS from scraped data
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// ==========================================================================
// TOAST NOTIFICATION SYSTEM
// ==========================================================================

/**
 * Display a non-blocking toast notification.
 * @param {string} message   - Text to display.
 * @param {'success'|'error'|'info'} type - Visual variant. Default: 'info'.
 * @param {number} duration  - Auto-dismiss delay in ms. Default: 4000.
 */
function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = {
        success: 'bx-check-circle',
        error: 'bx-error-circle',
        info: 'bx-info-circle',
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.innerHTML = `
        <i class="bx ${icons[type] || icons.info} toast-icon"></i>
        <div class="toast-body">${escapeHtml(message)}</div>
        <button class="toast-close" aria-label="Dismiss notification">&times;</button>
    `;

    toast.querySelector('.toast-close').addEventListener('click', () => dismissToast(toast));
    container.appendChild(toast);

    const timer = setTimeout(() => dismissToast(toast), duration);
    toast.addEventListener('mouseenter', () => clearTimeout(timer));
    toast.addEventListener('mouseleave', () => { setTimeout(() => dismissToast(toast), 1500); });
}

function dismissToast(toast) {
    if (!toast || toast.classList.contains('toast-hiding')) return;
    toast.classList.add('toast-hiding');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
}

// ==========================================================================
// GUEST SCENARIO CONFIGURATION
// ==========================================================================
async function fetchGuestConfig() {
    try {
        const response = await fetch(`${API_BASE}/api/guest/config`);
        if (response.ok) {
            const data = await response.json();
            activeGuestScenario = data.guestFlowScenario || 'paywall';
            guestTrialDays = data.guestTrialDays || 7;
            updateRegisterModalScenarioUI();
            updateLandingStatsUI();
        }
    } catch (e) {
        console.error('Failed to fetch guest scenario config:', e);
    }
}

function updateLandingStatsUI() {
    const numEl = document.getElementById('landing-stat-platforms-num');
    const labelEl = document.getElementById('landing-stat-platforms-label');
    if (!numEl || !labelEl) return;

    if (activeGuestScenario === 'trial') {
        numEl.innerText = `${guestTrialDays} дней`;
        labelEl.innerText = 'пробный период';
    } else {
        numEl.innerText = '3';
        labelEl.innerText = 'платформы поиска';
    }
}

function updateRegisterModalScenarioUI() {
    const currencyEl = document.getElementById('guest-register-price-currency');
    const valEl = document.getElementById('guest-register-price-val');
    const periodEl = document.getElementById('guest-register-price-period');
    const submitBtn = document.getElementById('btn-guest-reg-submit');
    const blockEl = document.getElementById('guest-register-price-block');

    if (!currencyEl || !valEl || !periodEl || !submitBtn) return;

    if (activeGuestScenario === 'trial') {
        currencyEl.innerText = '₽';
        valEl.innerText = '0';
        periodEl.innerText = `/ ${guestTrialDays} дней (триал)`;

        // Add subtext for subscription after trial if it doesn't exist
        let subtextEl = document.getElementById('guest-register-trial-subtext');
        if (!subtextEl && blockEl) {
            subtextEl = document.createElement('div');
            subtextEl.id = 'guest-register-trial-subtext';
            subtextEl.style.fontSize = '12px';
            subtextEl.style.color = 'var(--text-muted)';
            subtextEl.style.marginTop = '4px';
            subtextEl.innerText = 'полный доступ ко всем функциям';
            blockEl.appendChild(subtextEl);
            blockEl.style.height = '110px'; // Increase height to fit subtext
        }

        submitBtn.innerHTML = `<i class='bx bx-gift'></i> Начать бесплатный ${guestTrialDays}-дневный пробный период`;
    } else {
        currencyEl.innerText = '₽';
        valEl.innerText = '300';
        periodEl.innerText = 'в месяц';

        const subtextEl = document.getElementById('guest-register-trial-subtext');
        if (subtextEl) {
            subtextEl.remove();
        }
        if (blockEl) {
            blockEl.style.height = '90px'; // Restore height
        }

        submitBtn.innerHTML = "<i class='bx bx-lock-open-alt'></i> Зарегистрироваться и активировать доступ";
    }
}

// ==========================================================================
// INITIALISATION
// ==========================================================================

document.addEventListener("DOMContentLoaded", () => {
    fetchGuestConfig();
    checkSession();
    fetchAndPopulateRoles();
    setupScrollPagination();
    initGuestLandingUpload();
    initCvDropzone();
    initSettingsChangeListeners();
});

// ==========================================================================
// SCREEN ROUTING
// ==========================================================================

function showScreen(screenId) {
    const screens = ['landing-screen', 'auth-screen', 'main-app', 'guest-app'];
    screens.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.add('hidden');
        el.classList.remove('active');
    });

    const target = document.getElementById(screenId);
    if (!target) return;
    target.classList.remove('hidden');
    if (screenId === 'auth-screen' || screenId === 'landing-screen') {
        target.classList.add('active');
    }
}

function showLandingScreen() {
    showScreen('landing-screen');
}

function showAuthScreen() {
    showScreen('auth-screen');
}

// ==========================================================================
// SESSION CHECK
// ==========================================================================

async function checkSession() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('resetToken')) {
        const token = params.get('resetToken');
        // Clean URL query param
        params.delete('resetToken');
        const newQuery = params.toString();
        const newUrl = window.location.pathname + (newQuery ? `?${newQuery}` : '');
        window.history.replaceState({}, document.title, newUrl);

        // Pre-fill hidden token input
        const tokenInput = document.getElementById('reset-token-input');
        if (tokenInput) tokenInput.value = token;

        // Show Auth Screen and activate Reset Password form
        showScreen('auth-screen');
        switchAuthTab('reset');
        return;
    }

    // Try to restore guest session from sessionStorage
    const storedGuestToken = sessionStorage.getItem('guest_token');
    if (storedGuestToken) {
        guestToken = storedGuestToken;
        // Validate by calling /api/auth/me with the guest token
        const { data } = await apiRequestWithToken('api/auth/me', {}, storedGuestToken);
        if (data && data.is_guest) {
            currentUser = data;
            showScreen('guest-app');
            await loadSettings();
            // If guest already had matches, go to matches view
            const { data: mData } = await apiRequestWithToken(`api/matches?limit=3`, {}, guestToken);
            if (mData && mData.matches && mData.matches.length > 0) {
                guestRealMatches = mData.matches;
                guestSwitchView('dashboard');
                renderGuestMatches();
                if (guestRealMatches.length >= 2) appendPaywallCards();
            } else {
                guestSwitchView('search-settings');
            }
            return;
        } else {
            // Guest session expired
            sessionStorage.removeItem('guest_token');
            guestToken = null;
        }
    }

    // Try regular auth
    const { data, error } = await apiRequest('api/auth/me');
    if (data && !error) {
        currentUser = data;
        document.getElementById('user-email-display').innerText = data.email;
        showScreen('main-app');
        switchView('dashboard');
        await refreshDashboard();
        handleDeepLink();
    } else {
        showScreen('landing-screen');
    }
}

// ==========================================================================
// PROFESSIONAL ROLES
// ==========================================================================

async function fetchAndPopulateRoles() {
    const { data, error } = await apiRequest('api/professional-roles');
    if (error || !data) {
        console.error('Failed to load professional roles:', error);
        return;
    }
    allRolesLoaded = data;
    populateRoleSelect('role-select', data);
    populateRoleSelect('guest-role-select', data);
}

function populateRoleSelect(selectId, data) {
    const roleSelect = document.getElementById(selectId);
    if (!roleSelect) return;

    const categories = {
        'Информационные технологии': ['25', '36', '96', '104', '112', '113', '114', '116', '121', '124', '125', '126', '148', '150', '156', '160', '165'],
        'Маркетинг, реклама, PR': ['1', '2', '3', '37', '55', '68', '163', '170', '176', '182'],
        'Управление и менеджмент': ['26', '53', '73', '87', '107', '157', '161', '164'],
        'Кадры и HR': ['38', '69', '117', '118', '153', '171', '181'],
        'Финансы и бухгалтерия': ['11', '16', '18', '50', '51', '57', '91', '134', '135', '136', '137', '142', '154', '188'],
        'Продажи и обслуживание': ['6', '8', '9', '35', '54', '70', '71', '77', '83', '84', '97', '105', '106', '129', '180', '190'],
        'Дизайн и творчество': ['12', '20', '34', '98', '103', '139'],
        'Производство, сервис, инженерия': ['5', '7', '14', '27', '28', '30', '44', '45', '46', '47', '48', '49', '59', '62', '63', '76', '78', '80', '81', '82', '85', '86', '100', '108', '109', '111', '115', '128', '143', '144', '149', '151', '152', '162', '169', '173', '174', '175', '177', '178', '179', '185', '189', '192', '193'],
        'Медицина, красота, спорт': ['15', '19', '24', '29', '42', '43', '56', '60', '61', '64', '65', '92', '94', '133', '168', '184', '194'],
        'Транспорт, логистика, склад': ['21', '52', '58', '67', '131', '159', '187'],
        'Юриспруденция': ['145', '146', '147', '155', '158', '166'],
    };

    const assignedIds = new Set();
    const defaultLabel = selectId === 'guest-role-select' ? 'Выберите роль...' : 'Выберите специализацию...';
    roleSelect.innerHTML = `<option value="" disabled selected>${defaultLabel}</option>`;

    Object.entries(categories).forEach(([catName, ids]) => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = catName;
        let hasOptions = false;
        ids.forEach(id => {
            if (data[id]) {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = data[id];
                optgroup.appendChild(opt);
                assignedIds.add(id);
                hasOptions = true;
            }
        });
        if (hasOptions) roleSelect.appendChild(optgroup);
    });

    const remainingOptgroup = document.createElement('optgroup');
    remainingOptgroup.label = 'Другие специальности';
    let hasRemaining = false;
    Object.entries(data).forEach(([id, name]) => {
        if (!assignedIds.has(id)) {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = name;
            remainingOptgroup.appendChild(opt);
            hasRemaining = true;
        }
    });
    if (hasRemaining) roleSelect.appendChild(remainingOptgroup);
}

// ==========================================================================
// API REQUEST HELPERS
// ==========================================================================

async function apiRequest(endpoint, options = {}) {
    return apiRequestWithToken(endpoint, options, localStorage.getItem('access_token'));
}

async function apiRequestWithToken(endpoint, options = {}, token = null) {
    const url = `${API_BASE}/${endpoint.replace(/^\//, '')}`;
    options.headers = options.headers || {};
    if (token) {
        options.headers['Authorization'] = `Bearer ${token}`;
    }
    if (options.body && !(options.body instanceof FormData) && !options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
    }

    try {
        const response = await fetch(url, options);
        if (response.status === 401 && !endpoint.includes('auth/login') && !endpoint.includes('auth/register') && !endpoint.includes('guest/')) {
            localStorage.removeItem('access_token');
            currentUser = null;
            showScreen('landing-screen');
            return { error: 'Сессия истекла. Вернитесь на главную.' };
        }
        const data = await response.json();
        if (!response.ok) {
            return { error: data.detail || 'Ошибка запроса' };
        }
        return { data };
    } catch (e) {
        console.error('API Request Error: ', e);
        return { error: 'Ошибка сети. Проверьте соединение.' };
    }
}

// Guest API request (uses guestToken)
async function guestApiRequest(endpoint, options = {}) {
    return apiRequestWithToken(endpoint, options, guestToken);
}

// Deep linking handler
async function handleDeepLink() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('matchId')) {
        const matchId = parseInt(params.get('matchId'), 10);
        if (matchId) {
            params.delete('matchId');
            const newQuery = params.toString();
            const newUrl = window.location.pathname + (newQuery ? `?${newQuery}` : '');
            window.history.replaceState({}, document.title, newUrl);
            let match = currentMatches.find(m => m.id === matchId);
            if (!match) {
                const { data, error } = await apiRequest(`api/matches/${matchId}`);
                if (!error && data) {
                    match = data;
                    currentMatches.push(match);
                    loadMatchesListUI();
                }
            }
            if (match) openDetailModal(matchId);
        }
    }
}

// ==========================================================================
// SWITCH VIEW (registered app)
// ==========================================================================

function switchView(viewName) {
    document.querySelectorAll('.content-view').forEach(view => view.classList.remove('active'));
    document.querySelectorAll('.profile-sub-view').forEach(view => view.classList.remove('active'));
    document.querySelectorAll('#main-app .nav-item').forEach(item => item.classList.remove('active'));
    document.querySelectorAll('.mobile-nav-item').forEach(item => item.classList.remove('active'));

    if (viewName === 'dashboard') {
        const el = document.getElementById('view-dashboard');
        if (el) el.classList.add('active');
        const nav = document.getElementById('nav-dashboard');
        if (nav) nav.classList.add('active');
        const mobileNav = document.getElementById('mobile-nav-dashboard');
        if (mobileNav) mobileNav.classList.add('active');
        loadMatches(false);
    } else {

        if (viewName === 'profile') {
            const el = document.getElementById('view-profile');
            if (el) el.classList.add('active');
            const mobileNav = document.getElementById('mobile-nav-profile');
            if (mobileNav) mobileNav.classList.add('active');
            loadSettings();
        } else if (viewName === 'search-settings') {
            const el = document.getElementById('view-profile');
            if (el) el.classList.add('active');
            const sub = document.getElementById('view-search-settings');
            if (sub) sub.classList.add('active');
            const nav = document.getElementById('nav-search-settings');
            if (nav) nav.classList.add('active');
            loadSettings();
        }
    }
}

async function refreshDashboard() {
    await checkBillingStatus();
    await loadSettings();
    await loadMatches();
}
// ==========================================================================

// ==========================================================================
// USER AUTHENTICATION HANDLERS
// ==========================================================================

function switchAuthTab(type) {
    document.getElementById('tab-login').classList.remove('active');
    document.getElementById('tab-register').classList.remove('active');
    document.getElementById('login-form').classList.remove('active');
    document.getElementById('register-form').classList.remove('active');

    const forgotForm = document.getElementById('forgot-form');
    const forgotInputs = document.querySelector('#forgot-form .forgot-inputs-wrapper');
    const forgotSuccess = document.querySelector('#forgot-form .forgot-success-wrapper');
    if (forgotInputs) forgotInputs.classList.remove('hidden');
    if (forgotSuccess) forgotSuccess.classList.add('hidden');

    const resetForm = document.getElementById('reset-password-form');
    if (forgotForm) forgotForm.classList.remove('active');
    if (resetForm) resetForm.classList.remove('active');

    const tabs = document.getElementById('auth-tabs-container');

    if (type === 'login') {
        if (tabs) tabs.classList.remove('hidden');
        document.getElementById('tab-login').classList.add('active');
        document.getElementById('login-form').classList.add('active');
    } else if (type === 'register') {
        if (tabs) tabs.classList.remove('hidden');
        document.getElementById('tab-register').classList.add('active');
        document.getElementById('register-form').classList.add('active');
    } else if (type === 'forgot') {
        if (tabs) tabs.classList.add('hidden');
        if (forgotForm) forgotForm.classList.add('active');
    } else if (type === 'reset') {
        if (tabs) tabs.classList.add('hidden');
        if (resetForm) resetForm.classList.add('active');
    }
}

async function handleForgotPassword(event) {
    event.preventDefault();
    const email = document.getElementById('forgot-email').value;
    const submitBtn = document.getElementById('btn-forgot-submit');
    const originalText = submitBtn.innerText;

    submitBtn.disabled = true;
    submitBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Отправка...";

    const { data, error } = await apiRequest('api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email })
    });

    submitBtn.disabled = false;
    submitBtn.innerText = originalText;

    if (error) {
        showToast(error, 'error');
    } else {
        const forgotInputs = document.querySelector('#forgot-form .forgot-inputs-wrapper');
        const forgotSuccess = document.querySelector('#forgot-form .forgot-success-wrapper');
        if (forgotInputs) forgotInputs.classList.add('hidden');
        if (forgotSuccess) forgotSuccess.classList.remove('hidden');
        document.getElementById('forgot-email').value = '';
    }
}

async function handleResetPassword(event) {
    event.preventDefault();
    const token = document.getElementById('reset-token-input').value;
    const new_password = document.getElementById('reset-new-password').value;
    const submitBtn = document.getElementById('btn-reset-submit');
    const originalText = submitBtn.innerText;

    if (new_password.length < 6) {
        showToast('Пароль должен содержать минимум 6 символов.', 'error');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Сохранение...";

    const { data, error } = await apiRequest('api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, new_password })
    });

    submitBtn.disabled = false;
    submitBtn.innerText = originalText;

    if (error) {
        showToast(error, 'error');
    } else {
        localStorage.setItem('access_token', data.access_token);
        currentUser = data.user;
        document.getElementById('user-email-display').innerText = data.user.email;
        document.getElementById('reset-new-password').value = '';
        document.getElementById('reset-token-input').value = '';

        showToast('Пароль успешно изменен! Выполнен вход в аккаунт.', 'success', 3000);
        showScreen('main-app');
        switchView('dashboard');
        await refreshDashboard();
        handleDeepLink();
    }
}

async function handleAuth(event, type) {
    event.preventDefault();
    let email, password;
    if (type === 'login') {
        email = document.getElementById('login-email').value;
        password = document.getElementById('login-password').value;
    } else {
        email = document.getElementById('register-email').value;
        password = document.getElementById('register-password').value;
    }

    const endpoint = type === 'login' ? 'api/auth/login' : 'api/auth/register';
    const { data, error } = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify({ email, password })
    });

    if (error) { showToast(error, 'error'); return; }

    if (type === 'login') {
        localStorage.setItem('access_token', data.access_token);
        currentUser = data.user;
        document.getElementById('user-email-display').innerText = email;
        showScreen('main-app');
        switchView('dashboard');
        await refreshDashboard();
        handleDeepLink();
    } else {
        sessionStorage.setItem('just_registered', 'true');
        switchAuthTab('login');
        document.getElementById('login-email').value = email;
        document.getElementById('login-password').value = password;
        showToast('Регистрация успешна! Выполняем вход...', 'success', 2000);
        setTimeout(() => { handleAuth(new Event('submit'), 'login'); }, 1200);
    }
}

async function handleLogout() {
    try {
        await apiRequest('api/auth/logout', { method: 'POST' });
    } catch (e) { }
    localStorage.removeItem('access_token');

    // Clear guest session states
    sessionStorage.removeItem('guest_token');
    sessionStorage.removeItem('guest_scan_started');
    guestToken = null;
    guestCvText = '';
    if (guestScanInterval) {
        clearInterval(guestScanInterval);
        guestScanInterval = null;
    }
    guestRealMatches = [];
    guestScanComplete = false;
    guestPendingCvText = '';

    currentUser = null;
    currentMatches = [];
    matchesTotalCount = 0;
    matchesNewCount = 0;
    matchesAppliedCount = 0;

    if (subscriptionReminderInterval) {
        clearInterval(subscriptionReminderInterval);
        subscriptionReminderInterval = null;
    }
    const container = document.getElementById('sub-reminder-banner-container');
    if (container) container.innerHTML = '';

    const billingOverlay = document.getElementById('billing-overlay');
    if (billingOverlay) billingOverlay.classList.add('hidden');
    const paymentModal = document.getElementById('payment-modal');
    if (paymentModal) paymentModal.classList.add('hidden');

    showScreen('landing-screen');
}

// ==========================================================================
// PREFERENCES & CV SECTION (registered users)
// ==========================================================================

function getActiveSettingElement(baseId) {
    const isGuest = !currentUser || currentUser.is_guest;
    return document.getElementById(isGuest ? `guest-${baseId}` : baseId);
}

function getActiveJobFormats() {
    const isGuest = !currentUser || currentUser.is_guest;
    const name = isGuest ? 'guest-job-format' : 'job-format';
    return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(cb => cb.value);
}

function updateThresholdDisplay(value) {
    const valEl = getActiveSettingElement('threshold-val');
    if (valEl) valEl.innerText = `${value}%`;
    const slider = getActiveSettingElement('input-threshold');
    if (slider) {
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        const pct = ((value - min) / (max - min)) * 100;
        slider.style.setProperty('--range-fill', pct + '%');
    }
}

function toggleSettingsCityRequirement() {
    const isGuest = !currentUser || currentUser.is_guest;
    const name = isGuest ? 'guest-job-format' : 'job-format';
    const checkedBoxes = Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(cb => cb.value);
    const isCityRequired = checkedBoxes.includes('onsite') || checkedBoxes.includes('hybrid');
    const marker = getActiveSettingElement('city-required-marker');
    const cityInput = getActiveSettingElement('input-city');
    const cityGroup = getActiveSettingElement('city-input-group');
    if (isGuest) {
        if (cityGroup) cityGroup.classList.remove('hidden');
    } else {
        if (isCityRequired) {
            if (cityGroup) cityGroup.classList.remove('hidden');
        } else {
            if (cityGroup) cityGroup.classList.add('hidden');
        }
    }
    if (marker) marker.classList.add('hidden');
    if (cityInput) cityInput.removeAttribute('required');
}

async function loadSettings() {
    const isGuest = !currentUser || currentUser.is_guest;
    const endpoint = 'api/preferences';
    const { data, error } = isGuest ? await guestApiRequest(endpoint) : await apiRequest(endpoint);
    if (error || !data) return;

    if (!isGuest) {
        currentSettings = {
            cv_text: data.cv_text || '',
            role_id: data.role_id || '',
            city: data.city || '',
            match_threshold: data.match_threshold || 75,
            job_format: data.job_format || '',
            email_notifications_enabled: !!data.email_notifications_enabled
        };
        localCvText = data.cv_text || '';
        const cvMsg = document.getElementById('cv-status-message');
        if (cvMsg) {
            if (localCvText.trim().length > 0) {
                cvMsg.className = 'cv-status-text text-center text-success';
                cvMsg.innerText = 'Резюме загружено, специализация определена';
                cvMsg.classList.remove('hidden');
            } else {
                cvMsg.className = 'cv-status-text text-center text-danger';
                cvMsg.innerText = 'Пожалуйста, загрузите резюме перед началом поиска';
                cvMsg.classList.remove('hidden');
            }
        }
    } else {
        guestCvText = data.cv_text || '';
    }

    const roleSelect = getActiveSettingElement('role-select');
    if (roleSelect) roleSelect.value = data.role_id || '';

    const cityInput = getActiveSettingElement('input-city');
    if (cityInput) cityInput.value = data.city || '';

    const thresholdSlider = getActiveSettingElement('input-threshold');
    const thresholdVal = getActiveSettingElement('threshold-val');
    const activeThreshold = data.match_threshold || 75;
    if (thresholdSlider) thresholdSlider.value = activeThreshold;
    if (thresholdVal) thresholdVal.innerText = `${activeThreshold}%`;
    if (thresholdSlider) updateThresholdDisplay(activeThreshold);

    const emailEnabled = getActiveSettingElement('input-email-enabled');
    if (emailEnabled) {
        emailEnabled.checked = !!data.email_notifications_enabled;
        emailEnabled.disabled = isGuest;
    }

    const name = isGuest ? 'guest-job-format' : 'job-format';
    const formats = data.job_format ? data.job_format.split(',') : [];
    document.querySelectorAll(`input[name="${name}"]`).forEach(cb => {
        cb.checked = formats.includes(cb.value);
    });

    toggleSettingsCityRequirement();

    const cvAnalysisSection = getActiveSettingElement('cv-analysis-section');
    const cvAnalysisText = getActiveSettingElement('cv-analysis-text');
    if (cvAnalysisSection && cvAnalysisText) {
        if (data.cv_analysis && data.cv_analysis.trim().length > 0) {
            cvAnalysisText.innerText = data.cv_analysis;
            cvAnalysisSection.classList.remove('hidden');
        } else {
            cvAnalysisSection.classList.add('hidden');
        }
    }

    if (isGuest) {
        const guestScanStarted = sessionStorage.getItem('guest_scan_started') === 'true';
        const guestSaveBtn = document.getElementById('guest-btn-save-preferences');
        if (guestSaveBtn) {
            if (guestScanStarted) {
                guestSaveBtn.disabled = true;
                guestSaveBtn.innerHTML = "<i class='bx bx-lock-alt'></i> Поиск уже запущен";
            } else {
                guestSaveBtn.disabled = false;
                guestSaveBtn.innerHTML = "Применить и начать поиск";
            }
        }
    }
    if (!isGuest) {
        checkPreferencesChanged();
    }
}

function checkPreferencesChanged() {
    const isGuest = !currentUser || currentUser.is_guest;
    if (isGuest) return;

    const saveBtn = document.getElementById('btn-save-preferences');
    if (!saveBtn) return;

    if (!currentSettings) {
        saveBtn.disabled = true;
        return;
    }

    const roleSelect = document.getElementById('role-select');
    const roleId = roleSelect ? roleSelect.value : '';

    const checkedFormats = getActiveJobFormats();
    const jobFormat = checkedFormats.join(',');

    const cityInput = document.getElementById('input-city');
    const city = cityInput ? cityInput.value.trim() : '';

    const thresholdSlider = document.getElementById('input-threshold');
    const threshold = thresholdSlider ? parseInt(thresholdSlider.value) : 75;

    const emailEnabled = document.getElementById('input-email-enabled');
    const emailNotifications = emailEnabled ? emailEnabled.checked : false;

    const changed =
        roleId !== currentSettings.role_id ||
        jobFormat !== currentSettings.job_format ||
        (city || '') !== (currentSettings.city || '') ||
        threshold !== currentSettings.match_threshold ||
        emailNotifications !== !!currentSettings.email_notifications_enabled;

    saveBtn.disabled = !changed;
}

function initSettingsChangeListeners() {
    const roleSelect = document.getElementById('role-select');
    if (roleSelect) {
        roleSelect.addEventListener('change', checkPreferencesChanged);
    }

    document.querySelectorAll('input[name="job-format"]').forEach(cb => {
        cb.addEventListener('change', () => {
            toggleSettingsCityRequirement();
            checkPreferencesChanged();
        });
    });

    const cityInput = document.getElementById('input-city');
    if (cityInput) {
        cityInput.addEventListener('input', checkPreferencesChanged);
        cityInput.addEventListener('change', checkPreferencesChanged);
    }

    const thresholdSlider = document.getElementById('input-threshold');
    if (thresholdSlider) {
        thresholdSlider.addEventListener('input', checkPreferencesChanged);
        thresholdSlider.addEventListener('change', checkPreferencesChanged);
    }

    const emailEnabled = document.getElementById('input-email-enabled');
    if (emailEnabled) {
        emailEnabled.addEventListener('change', checkPreferencesChanged);
    }
}

function closeSettingsConfirmModal() {
    const modal = document.getElementById('settings-confirm-modal');
    if (modal) modal.classList.add('hidden');
    pendingSettingsBody = null;
}

async function executeSettingsSave() {
    if (!pendingSettingsBody) return;
    const body = pendingSettingsBody;
    closeSettingsConfirmModal();
    await performSaveSettings(body);
}

async function saveSettings(event) {
    if (event) event.preventDefault();
    const isGuest = !currentUser || currentUser.is_guest;

    const checkedFormats = getActiveJobFormats();
    const jobFormat = checkedFormats.join(',');
    const cityInput = getActiveSettingElement('input-city');
    const city = cityInput ? cityInput.value.trim() : '';
    const roleSelect = getActiveSettingElement('role-select');
    const roleId = roleSelect ? roleSelect.value : '';

    if (!roleId) {
        showToast('Пожалуйста, выберите специализацию', 'error');
        return;
    }

    let threshold = 75;
    let emailNotifications = false;

    if (!isGuest) {
        const thresholdSlider = getActiveSettingElement('input-threshold');
        threshold = thresholdSlider ? parseInt(thresholdSlider.value) : 75;
        const emailEnabled = getActiveSettingElement('input-email-enabled');
        emailNotifications = emailEnabled ? emailEnabled.checked : false;

        if (!localCvText) {
            showToast('Пожалуйста, загрузите или вставьте текст резюме перед сохранением', 'error');
            return;
        }
    }

    const body = {
        cv_text: isGuest ? guestCvText : localCvText,
        job_format: jobFormat,
        city: city || null,
        match_threshold: threshold,
        email_notifications_enabled: emailNotifications,
        role_id: roleId
    };

    const cvChanged = currentSettings && body.cv_text !== currentSettings.cv_text;
    const roleChanged = currentSettings && body.role_id !== currentSettings.role_id;
    const formatChanged = currentSettings && body.job_format !== currentSettings.job_format;
    const cityChanged = currentSettings && (body.city || '') !== (currentSettings.city || '');
    const thresholdChanged = currentSettings && body.match_threshold !== currentSettings.match_threshold;

    const shouldKeepMatches = cvChanged || (!roleChanged && !formatChanged && !cityChanged);
    const willDeleteMatches = !isGuest && !shouldKeepMatches && (cvChanged || roleChanged || formatChanged || cityChanged || thresholdChanged);

    if (willDeleteMatches) {
        pendingSettingsBody = body;
        const modal = document.getElementById('settings-confirm-modal');
        if (modal) modal.classList.remove('hidden');
    } else {
        await performSaveSettings(body);
    }
}

async function performSaveSettings(body) {
    const isGuest = !currentUser || currentUser.is_guest;
    const saveBtn = getActiveSettingElement('btn-save-preferences');
    const originalHtml = saveBtn ? saveBtn.innerHTML : '';

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Сохранение настроек...";
    }

    const endpoint = 'api/preferences';
    const { data, error } = isGuest
        ? await guestApiRequest(endpoint, { method: 'POST', body: JSON.stringify(body) })
        : await apiRequest(endpoint, { method: 'POST', body: JSON.stringify(body) });

    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalHtml;
    }

    if (error) {
        showToast(error, 'error');
        return;
    }

    showToast('Настройки успешно сохранены!', 'success');

    if (isGuest) {
        sessionStorage.setItem('guest_scan_started', 'true');
        const guestSaveBtn = document.getElementById('guest-btn-save-preferences');
        if (guestSaveBtn) {
            guestSaveBtn.disabled = true;
            guestSaveBtn.innerHTML = "<i class='bx bx-lock-alt'></i> Поиск уже запущен";
        }
        // Go to matches view and start scan
        guestSwitchView('dashboard');
        await startGuestScan();
    } else {
        const cvChanged = currentSettings && body.cv_text !== currentSettings.cv_text;
        const roleChanged = currentSettings && body.role_id !== currentSettings.role_id;
        const formatChanged = currentSettings && body.job_format !== currentSettings.job_format;
        const cityChanged = currentSettings && (body.city || '') !== (currentSettings.city || '');
        const thresholdChanged = currentSettings && body.match_threshold !== currentSettings.match_threshold;

        const shouldKeepMatches = cvChanged || (!roleChanged && !formatChanged && !cityChanged);
        const shouldClearMatches = !shouldKeepMatches && (cvChanged || roleChanged || formatChanged || cityChanged || thresholdChanged);

        if (shouldClearMatches) {
            currentMatches = [];
            const matchesGrid = document.getElementById('matches-grid');
            if (matchesGrid) matchesGrid.innerHTML = '';
            renderMatches();
        }
        await loadSettings();
        await checkBillingStatus();
    }
}

function openCvModal() {
    const modal = document.getElementById('cv-upload-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    const closeBtn = document.getElementById('cv-close-btn');
    if (closeBtn) {
        if (currentUser && !currentUser.is_guest) {
            closeBtn.classList.remove('hidden');
        } else {
            closeBtn.classList.add('hidden');
        }
    }

    // Set textarea value to current CV text
    const textarea = document.getElementById('guest-cv-textarea');
    if (textarea) {
        textarea.value = localCvText || '';
    }

    // Hide file status details (since we opened the text editor directly without an active file parse)
    const fileStatus = document.getElementById('guest-file-status');
    if (fileStatus) {
        fileStatus.classList.add('hidden');
    }

    showGuestCvPhase('editor');
}

function closeCvModal() {
    const modal = document.getElementById('cv-upload-modal');
    if (modal) modal.classList.add('hidden');
}

async function parsePdfFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const arrayBuffer = e.target.result;
                const pdfjsLib = window['pdfjs-dist/build/pdf'];
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                let text = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    text += content.items.map(item => item.str).join(' ') + '\n';
                }
                resolve(text);
            } catch (err) {
                reject(new Error('Could not parse PDF file. Ensure it is not password-protected and contains copyable text.'));
            }
        };
        reader.onerror = () => reject(new Error('File read error.'));
        reader.readAsArrayBuffer(file);
    });
}

async function parseTxtFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('File read error.'));
        reader.readAsText(file);
    });
}

// ==========================================================================
// MATCHES FEED (registered users)
// ==========================================================================

let currentFilter = 'new';


async function loadMatches(isAppend = false) {
    if (isLoadingMatches) return;
    isLoadingMatches = true;

    if (!isAppend) {
        matchesPage = 1;
        currentMatches = [];
        const grid = document.getElementById('matches-grid');
        if (grid) {
            grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">
                <i class='bx bx-loader-alt bx-spin' style="font-size:24px;"></i><br>Загрузка вакансий...
            </div>`;
        }
        const emptyState = document.getElementById('matches-empty-state');
        if (emptyState) {
            emptyState.classList.add('hidden');
        }
    }

    const sort = sessionStorage.getItem('matches_sort') || 'new';
    let url = `api/matches?limit=${matchesLimit}&page=${matchesPage}&sort=${sort}`;
    if (currentFilter === 'new') {
        url += '&applied=0';
    } else if (currentFilter === 'applied') {
        url += '&applied=1';
    }

    const { data, error } = await apiRequest(url);
    isLoadingMatches = false;
    if (error || !data) return;

    const matchesList = data.matches || [];
    matchesHasMore = !!data.has_more;
    matchesTotalCount = data.total_all || 0;
    matchesNewCount = data.new_count || 0;
    matchesAppliedCount = data.applied_count || 0;

    if (isAppend) currentMatches = currentMatches.concat(matchesList);
    else currentMatches = matchesList;



    loadMatchesListUI();
}

function toggleSortDropdown(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('sort-dropdown-menu');
    const arrow = document.querySelector('#matches-sort-dropdown .trigger-arrow');
    if (menu) {
        const isHidden = menu.classList.toggle('hidden');
        if (arrow) arrow.classList.toggle('rotate-180', !isHidden);
    }
}

async function selectSortOption(val) {
    sessionStorage.setItem('matches_sort', val);
    const menu = document.getElementById('sort-dropdown-menu');
    const arrow = document.querySelector('#matches-sort-dropdown .trigger-arrow');
    if (menu) menu.classList.add('hidden');
    if (arrow) arrow.classList.remove('rotate-180');
    await loadMatches(false);
}

document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('matches-sort-dropdown');
    const menu = document.getElementById('sort-dropdown-menu');
    const arrow = document.querySelector('#matches-sort-dropdown .trigger-arrow');
    if (dropdown && !dropdown.contains(e.target) && menu && !menu.classList.contains('hidden')) {
        menu.classList.add('hidden');
        if (arrow) arrow.classList.remove('rotate-180');
    }
});

function setFeedFilter(filterType) {
    currentFilter = filterType;
    document.querySelectorAll('.filter-pill').forEach(pill => {
        pill.classList.toggle('active', pill.getAttribute('data-filter') === filterType);
    });
    loadMatches(false);
}

function getEmptyStateHtml(filter, cvText, allMatchesCount) {
    if (cvText === null) {
        return `<div class="empty-icon"><i class='bx bx-loader-alt bx-spin'></i></div>
            <h4>Загрузка...</h4>
            <p>Получаем настройки вашего профиля</p>`;
    }
    const hasCv = cvText && cvText.trim().length > 0;
    if (!hasCv) {
        return `<div class="empty-icon"><i class='bx bx-file-blank'></i></div>
            <h4>Загрузите резюме, чтобы начать</h4>
            <p>ИИ-помощнику нужно ваше резюме, чтобы находить и оценивать вакансии, соответствующие вашим навыкам</p>
            <button class="btn btn-primary btn-glow" onclick="openCvModal()"><i class='bx bx-upload'></i> Настроить резюме</button>`;
    }
    if (filter === 'new' && allMatchesCount > 0) {
        return `<div class="empty-icon icon-success"><i class='bx bx-check-circle'></i></div>
            <h4>Все вакансии просмотрены!</h4>
            <p class="empty-state-hint">Поиск выполняется автоматически в фоновом режиме. Новые совпадения скоро появятся здесь.</p>`;
    }
    if (filter === 'new') {
        return `<div class="empty-icon icon-primary"><i class='bx bx-radar'></i></div>
            <h4>Ваше резюме настроено</h4>
            <p class="empty-state-hint">Поиск выполняется автоматически в фоновом режиме. Новые совпадения скоро появятся здесь.</p>`;
    }
    return `<div class="empty-icon icon-primary"><i class='bx bx-radar'></i></div>
        <h4>Совпадений пока не найдено</h4>
        <p>Ни одна вакансия пока не прошла фильтр минимальной совместимости с вашим резюме</p>
        <button class="btn btn-secondary" onclick="switchView('profile')"><i class='bx bx-slider-alt'></i> Изменить порог</button>`;
}

function loadMatchesListUI() {
    const grid = document.getElementById('matches-grid');
    const sort = sessionStorage.getItem('matches_sort') || 'new';
    const label = sort === 'match' ? 'Match' : 'Новые';
    const currentValEl = document.getElementById('sort-current-val');
    if (currentValEl) currentValEl.innerText = label;

    document.querySelectorAll('#sort-dropdown-menu .dropdown-item').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-value') === sort);
    });
    const emptyState = document.getElementById('matches-empty-state');

    const allCount = matchesTotalCount;
    const newCount = matchesNewCount;
    const appliedCount = matchesAppliedCount;

    const badgeAll = document.getElementById('badge-count-all');
    const badgeNew = document.getElementById('badge-count-new');
    const badgeApplied = document.getElementById('badge-count-applied');
    if (badgeAll) badgeAll.innerText = allCount;
    if (badgeNew) badgeNew.innerText = newCount;
    if (badgeApplied) badgeApplied.innerText = appliedCount;

    const statTotal = document.getElementById('stat-total-matches');
    const statAvg = document.getElementById('stat-avg-score');
    if (statTotal) statTotal.innerText = allCount;
    if (statAvg) {
        if (currentMatches.length > 0) {
            const avg = Math.round(currentMatches.reduce((s, m) => s + m.score, 0) / currentMatches.length);
            statAvg.innerText = `${avg}%`;
        } else {
            statAvg.innerText = '0%';
        }
    }

    let filteredMatches = currentMatches;
    if (currentFilter === 'new') filteredMatches = currentMatches.filter(m => !m.applied);
    else if (currentFilter === 'applied') filteredMatches = currentMatches.filter(m => m.applied);

    if (filteredMatches.length === 0) {
        grid.innerHTML = '';
        emptyState.innerHTML = getEmptyStateHtml(currentFilter, localCvText, matchesTotalCount);
        emptyState.classList.remove('hidden');
        return;
    }
    emptyState.classList.add('hidden');

    // Clear loader if it exists
    if (grid.querySelector('.bx-loader-alt')) {
        grid.innerHTML = '';
    }

    // 1. Remove cards that are no longer in filteredMatches
    const filteredIds = new Set(filteredMatches.map(m => m.id));
    const existingCards = grid.querySelectorAll('.social-feed-card');
    existingCards.forEach(card => {
        const idAttr = card.id;
        if (idAttr) {
            const matchId = parseInt(idAttr.replace('match-card-', ''));
            if (!filteredIds.has(matchId)) {
                card.remove();
            }
        }
    });

    // 2. Add or update remaining matches
    filteredMatches.forEach(match => {
        let card = document.getElementById(`match-card-${match.id}`);
        if (!card) {
            card = document.createElement('div');
            card.id = `match-card-${match.id}`;
            card.className = `social-feed-card ${match.applied ? 'applied-border' : ''}`;
            const safeTitle = escapeHtml(match.title);
            const safeCompany = escapeHtml(match.company);
            const platformClass = match.url.includes('habr.com') ? 'habr' : (match.url.includes('superjob') ? 'superjob' : 'hh');
            const platformLabel = match.url.includes('habr.com') ? 'Habr' : (match.url.includes('superjob') ? 'SuperJob' : 'HH');

            card.innerHTML = `
                <div class="card-row-top">
                    <div class="vacancy-logo-col">
                        <div class="platform-${platformClass} compact-logo" title="${platformLabel} Vacancy">
                            ${platformLabel === 'SuperJob' ? 'SJ' : platformLabel[0]}
                        </div>
                    </div>
                    <div class="vacancy-details-col">
                        <span class="company-name-row">${safeCompany}</span>
                        <h4 class="job-title-link compact-title" onclick="openDetailModal(${match.id})">${safeTitle}</h4>
                    </div>
                </div>
                <div class="card-row-bottom">
                    <div class="vacancy-score-col">
                        <span class="match-score-pill compact-score ${match.score >= 85 ? 'high-match' : ''}">
                            🎯 Match ${match.score}%
                        </span>
                        <button class="vacancy-info-btn" onclick="toggleReasoningTooltip(${match.id}, event)" title="Обоснование совпадения">
                            <i class='bx bx-info-circle'></i>
                        </button>
                    </div>
                    <div class="vacancy-actions-col">
                        <button class="compact-applied-btn ${match.applied ? 'applied' : ''}" onclick="toggleAppliedStatus(${match.id}, event)" title="${match.applied ? 'Отметить как непросмотренное' : 'Отметить как просмотренное'}">
                            <i class='bx ${match.applied ? 'bxs-check-circle' : 'bx-circle'}'></i>
                            <span>Просмотрено</span>
                        </button>
                        <button id="more-btn-${match.id}" class="compact-more-btn" onclick="openDetailModal(${match.id})">
                            Ещё...
                        </button>
                        <a href="${match.url}" target="_blank" class="vacancy-external-link" title="Открыть вакансию в новой вкладке">
                            <i class='bx bx-link-external'></i>
                        </a>
                    </div>
                </div>
                <div id="reasoning-tray-${match.id}" class="reasoning-tray hidden" onclick="event.stopPropagation()">
                    ${escapeHtml(match.reasoning)}
                </div>
            `;
            grid.appendChild(card);
        } else {
            // Update existing card classes and buttons if status changed
            if (match.applied) {
                card.classList.add('applied-border');
            } else {
                card.classList.remove('applied-border');
            }
            const appliedBtn = card.querySelector('.compact-applied-btn');
            if (appliedBtn) {
                appliedBtn.className = `compact-applied-btn ${match.applied ? 'applied' : ''}`;
                appliedBtn.title = match.applied ? 'Отметить как непросмотренное' : 'Отметить как просмотренное';
                const icon = appliedBtn.querySelector('i');
                if (icon) {
                    icon.className = `bx ${match.applied ? 'bxs-check-circle' : 'bx-circle'}`;
                }
            }
        }
    });

    // Handle auto-scan info banner when 1, 2 or 3 matches are displayed on the New tab and total matches < 4
    const existingBanner = grid.querySelector('.auto-scan-info-box');
    if (existingBanner) existingBanner.remove();

    if (currentFilter === 'new' && filteredMatches.length >= 1 && filteredMatches.length <= 3 && matchesTotalCount < 4) {
        const banner = document.createElement('div');
        banner.className = 'auto-scan-info-box';
        banner.innerHTML = `<i class='bx bx-info-circle'></i><span>Поиск выполняется автоматически в фоновом режиме. Новые совпадения скоро появятся здесь.</span>`;
        grid.appendChild(banner);
    }
}

async function toggleAppliedStatus(matchId, event) {
    if (event) event.stopPropagation();
    const match = currentMatches.find(m => m.id === matchId);
    if (!match) return;

    const newApplied = !match.applied;
    const card = document.getElementById(`match-card-${matchId}`);

    if (currentFilter === 'new' && newApplied && card) {
        card.classList.add('disappear-animation');
        await new Promise(resolve => setTimeout(resolve, 350));
    }

    match.applied = newApplied ? 1 : 0;
    if (newApplied) {
        matchesNewCount = Math.max(0, matchesNewCount - 1);
        matchesAppliedCount++;
    } else {
        matchesNewCount++;
        matchesAppliedCount = Math.max(0, matchesAppliedCount - 1);
    }
    loadMatchesListUI();

    const { data, error } = await apiRequest(`api/matches/${matchId}/apply`, {
        method: 'POST',
        body: JSON.stringify({ applied: newApplied })
    });

    if (error) {
        match.applied = newApplied ? 0 : 1;
        if (newApplied) {
            matchesNewCount++;
            matchesAppliedCount = Math.max(0, matchesAppliedCount - 1);
        } else {
            matchesNewCount = Math.max(0, matchesNewCount - 1);
            matchesAppliedCount++;
        }
        loadMatchesListUI();
        showToast(`Не удалось обновить: ${error}`, 'error');
    }
}

function toggleReasoningTooltip(matchId, event) {
    if (event) event.stopPropagation();

    // Dismiss the (i) onboarding hint on first use
    if (!sessionStorage.getItem('guest_info_hint_shown')) {
        sessionStorage.setItem('guest_info_hint_shown', 'true');
        document.querySelectorAll('.info-btn-pulse').forEach(btn => btn.classList.remove('info-btn-pulse'));
        document.querySelectorAll('.info-hint-bubble').forEach(el => el.remove());
    }

    const tray = document.getElementById(`reasoning-tray-${matchId}`);
    if (tray) {
        const isHidden = tray.classList.contains('hidden');
        document.querySelectorAll('.reasoning-tray').forEach(t => {
            if (t.id !== `reasoning-tray-${matchId}`) t.classList.add('hidden');
        });
        tray.classList.toggle('hidden', !isHidden);
    }
}

function setupScrollPagination() {
    const sentinel = document.getElementById('matches-sentinel');
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && matchesHasMore && !isLoadingMatches) {
            matchesPage++;
            loadMatches(true);
        }
    }, { root: null, rootMargin: '150px', threshold: 0.1 });
    observer.observe(sentinel);
}

// ==========================================================================
// DETAIL MODAL
// ==========================================================================

function updateModalAppliedButtonState() {
    const btn = document.getElementById('modal-btn-applied');
    if (btn && selectedMatch) {
        if (selectedMatch.applied) {
            btn.classList.add('applied');
            btn.innerHTML = `<i class='bx bxs-check-circle'></i> <span>Просмотрено</span>`;
        } else {
            btn.classList.remove('applied');
            btn.innerHTML = `<i class='bx bx-circle'></i> <span>Просмотрено</span>`;
        }
    }
}

async function toggleAppliedFromModal(event) {
    if (!selectedMatch) return;
    await toggleAppliedStatus(selectedMatch.id, event);
    updateModalAppliedButtonState();
}

function loadCoverLetter(matchId) {
    const match = currentMatches.find(m => m.id === matchId) || guestRealMatches.find(m => m.id === matchId);
    if (!match) return;
    const copyBtn = document.getElementById('btn-copy-letter');
    const letterBox = document.getElementById('modal-cover-letter');

    if (match.cover_letter && match.cover_letter.trim() !== '') {
        letterBox.innerText = match.cover_letter;
        if (copyBtn) { copyBtn.disabled = false; copyBtn.classList.remove('disabled'); }
    } else {
        if (copyBtn) { copyBtn.disabled = true; copyBtn.classList.add('disabled'); }
        letterBox.innerHTML = `<div class="loader-overlay-content">
            <i class='bx bx-loader-alt bx-spin loader-spinner'></i>
            <span>ИИ составляет персональное сопроводительное письмо...</span>
        </div>`;
        if (!match.isGeneratingCoverLetter) {
            match.isGeneratingCoverLetter = true;
            const requestFn = (currentUser && currentUser.is_guest) ? guestApiRequest : apiRequest;
            requestFn(`api/matches/${matchId}/cover-letter`, { method: 'POST' }).then(({ data, error }) => {
                match.isGeneratingCoverLetter = false;
                if (!error && data) match.cover_letter = data.cover_letter;
                if (selectedMatch && selectedMatch.id === matchId) {
                    if (error) {
                        letterBox.innerHTML = `<div class="cover-letter-error-container">
                            <p class="error-friendly-msg">Не удалось составить сопроводительное письмо. Попробуйте еще раз!</p>
                            <button type="button" class="btn btn-secondary btn-sm retry-btn" onclick="retryCoverLetter(${matchId})">
                                <i class='bx bx-refresh'></i> Попробовать ещё раз
                            </button>
                        </div>`;
                    } else if (data) {
                        letterBox.innerText = data.cover_letter;
                        if (copyBtn) { copyBtn.disabled = false; copyBtn.classList.remove('disabled'); }
                    }
                }
            });
        }
    }
}

async function retryCoverLetter(matchId) {
    const match = currentMatches.find(m => m.id === matchId) || guestRealMatches.find(m => m.id === matchId);
    if (!match) return;
    match.isGeneratingCoverLetter = false;
    loadCoverLetter(matchId);
}

async function openDetailModal(matchId) {
    const match = currentMatches.find(m => m.id === matchId);
    if (!match) return;
    selectedMatch = match;
    document.getElementById('modal-vacancy-title').innerText = match.title;
    document.getElementById('modal-vacancy-company').innerText = match.company;
    const urlLink = document.getElementById('modal-vacancy-url');
    if (urlLink) urlLink.href = match.url;

    // Reset buttons state to prevent guest settings from bleeding into regular user view
    const appliedBtn = document.getElementById('modal-btn-applied');
    if (appliedBtn) {
        appliedBtn.disabled = false;
        appliedBtn.style.opacity = '';
        appliedBtn.classList.remove('hidden');
    }
    const copyBtn = document.getElementById('btn-copy-letter');
    if (copyBtn) { copyBtn.style.opacity = ''; }

    updateModalAppliedButtonState();
    document.getElementById('detail-modal').classList.remove('hidden');
    loadCoverLetter(matchId);
}

function closeDetailModal() {
    document.getElementById('detail-modal').classList.add('hidden');
    selectedMatch = null;
}

function copyCoverLetter() {
    if (!selectedMatch) return;
    navigator.clipboard.writeText(selectedMatch.cover_letter).then(() => {
        const copyBtn = document.getElementById('btn-copy-letter');
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = "<i class='bx bx-check'></i> Скопировано!";
        copyBtn.style.background = 'var(--success-glow)';
        copyBtn.style.color = 'var(--success)';
        setTimeout(() => {
            copyBtn.innerHTML = originalText;
            copyBtn.style.background = '';
            copyBtn.style.color = '';
        }, 2000);
    });
}

// ==========================================================================
// BILLING STATUS (registered users)
// ==========================================================================

async function checkBillingStatus() {
    const { data, error } = await apiRequest('api/billing/status');
    if (error || !data) return;

    const billingOverlay = document.getElementById('billing-overlay');
    const tierBadge = document.getElementById('user-tier-badge');

    if (!data.is_active) {
        billingOverlay.classList.remove('hidden');
    } else {
        billingOverlay.classList.add('hidden');
    }

    if (tierBadge) {
        if (data.status === 'active') {
            if (data.is_trial) {
                tierBadge.innerText = 'Пробный период';
                tierBadge.className = 'tier-badge trial-badge';
            } else {
                tierBadge.innerText = 'Active';
                tierBadge.className = 'tier-badge green-glow';
            }
        } else {
            tierBadge.innerText = 'Expired';
            tierBadge.className = 'tier-badge expired-badge';
        }
    }

    const subBadge = document.getElementById('sub-status-badge');
    const subDays = document.getElementById('sub-status-days');
    const subBtn = document.getElementById('btn-sub-action');

    if (data.status === 'active') {
        if (data.is_trial) {
            if (subBadge) { subBadge.innerText = 'Пробный период'; subBadge.className = 'tier-badge trial-badge'; }
            if (subDays) subDays.innerText = `Ваш пробный период заканчивается через ${data.subscription_days_left} дней`;
            if (subBtn) subBtn.innerText = 'Активировать подписку';
        } else {
            if (subBadge) { subBadge.innerText = 'Active'; subBadge.className = 'tier-badge green-glow'; }
            if (subDays) subDays.innerText = `Ваша подписка заканчивается через ${data.subscription_days_left} дней`;
            if (subBtn) subBtn.innerText = 'Продлить подписку';
        }
    } else {
        if (subBadge) { subBadge.innerText = 'Expired'; subBadge.className = 'tier-badge expired-badge'; }
        if (subDays) subDays.innerText = 'Срок действия вашего доступа истек. Пожалуйста, оформите подписку, чтобы продолжить.';
        if (subBtn) subBtn.innerText = 'Активировать подписку';
    }

    updateSubscriptionReminder(data.subscription_ends_at, data.is_trial);
}

function updateSubscriptionReminder(endsAt, isTrial = false) {
    const container = document.getElementById('sub-reminder-banner-container');
    if (!container) return;

    if (subscriptionReminderInterval) {
        clearInterval(subscriptionReminderInterval);
        subscriptionReminderInterval = null;
    }

    if (!endsAt) {
        container.innerHTML = '';
        return;
    }

    const endTime = new Date(endsAt).getTime();

    function tick() {
        const now = Date.now();
        const diffMs = endTime - now;

        // If expired or more than 3 days left, hide the banner
        if (diffMs <= 0 || diffMs > 3 * 24 * 60 * 60 * 1000) {
            container.innerHTML = '';
            if (subscriptionReminderInterval) {
                clearInterval(subscriptionReminderInterval);
                subscriptionReminderInterval = null;
            }
            return;
        }

        // Calculate hours and minutes countdown
        const diffSecs = Math.max(0, Math.floor(diffMs / 1000));
        const diffMins = Math.max(0, Math.floor(diffSecs / 60));
        const diffHours = Math.max(0, Math.floor(diffMins / 60));

        let countdownText = '';
        if (diffMs > 24 * 60 * 60 * 1000) {
            const daysLeft = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
            countdownText = `${daysLeft} дня`;
        } else {
            const hoursLeft = diffHours;
            const minsLeft = diffMins % 60;
            countdownText = `${hoursLeft} ч. ${minsLeft} мин.`;
        }

        const bannerText = isTrial
            ? `До окончания вашего пробного периода осталось <strong>${countdownText}</strong>. Оформите подписку сейчас, чтобы сохранить доступ к автопоиску вакансий! Стоимость: 300 рублей в месяц.`
            : `До окончания вашей подписки осталось <strong>${countdownText}</strong>. Продлите её сейчас, чтобы не потерять доступ к автопоиску вакансий! Стоимость: 300 рублей в месяц.`;

        const btnText = isTrial ? 'Оформить подписку' : 'Продлить подписку';

        container.innerHTML = `
            <div class="reminder-banner">
                <div class="reminder-content">
                    <i class='bx bx-time-five reminder-icon'></i>
                    <span class="reminder-text">
                        ${bannerText}
                    </span>
                </div>
                <div class="reminder-action-btn">
                    <button class="btn btn-secondary btn-sm" onclick="openPaymentModal()">
                        <i class='bx bx-credit-card-front'></i> ${btnText}
                    </button>
                </div>
            </div>
        `;
    }

    tick();
    subscriptionReminderInterval = setInterval(tick, 30000);
}


let activeCheckoutWidget = null;

/**
 * Opens the payment modal and initialises the real YooKassa Checkout Widget.
 * Flow:
 *   1. Call POST /api/billing/pay  →  backend creates a YooKassa payment and returns confirmation_token
 *   2. Render the real YooMoneyCheckoutWidget iframe inside #yookassa-widget-container
 *   3. On 'success' event (fired by YooKassa after payment) → refresh dashboard
 */
async function openPaymentModal() {
    const modal = document.getElementById('payment-modal');
    modal.classList.remove('hidden');

    // Destroy any previously active widget
    if (activeCheckoutWidget) {
        activeCheckoutWidget.destroy();
        activeCheckoutWidget = null;
    }

    // Show a loading state in the widget container while we fetch the token
    const container = document.getElementById('yookassa-widget-container');
    if (container) {
        container.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;gap:12px;color:var(--text-muted,#aaa)">
                <i class='bx bx-loader-alt bx-spin' style="font-size:2rem"></i>
                <span>Подготовка платёжной формы...</span>
            </div>`;
    }

    // Step 1: ask backend to create a payment and get the confirmation_token
    const { data, error } = await apiRequest('api/billing/pay', { method: 'POST', body: '{}' });

    if (error || !data || !data.confirmation_token) {
        if (container) {
            container.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;gap:12px;color:#f87171">
                    <i class='bx bx-error-circle' style="font-size:2rem"></i>
                    <span>${error || 'Не удалось инициализировать платёж. Попробуйте позже.'}</span>
                </div>`;
        }
        return;
    }

    // Step 2: check that the real YooKassa SDK loaded
    if (typeof window.YooMoneyCheckoutWidget === 'undefined') {
        if (container) {
            container.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;gap:12px;color:#f87171">
                    <i class='bx bx-error-circle' style="font-size:2rem"></i>
                    <span>Не удалось загрузить виджет ЮKassa. Проверьте интернет-соединение и перезагрузите страницу.</span>
                </div>`;
        }
        return;
    }

    // Step 3: render the real widget
    activeCheckoutWidget = new window.YooMoneyCheckoutWidget({
        confirmation_token: data.confirmation_token,
        return_url: window.location.href,
        customization: {
            colors: {
                control_primary: '#7B2CBF',
            }
        },
        error_callback: (err) => {
            console.error('[YooKassa Widget] error:', err);
            showToast('Ошибка виджета оплаты: ' + (err.error || err), 'error');
        }
    });

    activeCheckoutWidget.on('success', async () => {
        closePaymentModal();
        showToast('Платеж подтвержден! Активируем подписку...', 'info');

        let attempts = 0;
        const maxAttempts = 5;
        const poll = async () => {
            attempts++;
            await refreshDashboard();
            const billingOverlay = document.getElementById('billing-overlay');
            const isHidden = billingOverlay && billingOverlay.classList.contains('hidden');
            if (isHidden) {
                showToast('Подписка успешно активирована!', 'success');
                if (sessionStorage.getItem('just_registered') === 'true') {
                    sessionStorage.removeItem('just_registered');

                    const welcomeEmail = document.getElementById('welcome-email-hint');
                    if (welcomeEmail) welcomeEmail.innerText = `Подходящие вакансии придут на ${currentUser.email}`;

                    const welcomeScreen = document.getElementById('welcome-screen');
                    if (welcomeScreen) {
                        welcomeScreen.classList.remove('hidden');
                        welcomeScreen.classList.add('active');
                    }
                }
            } else if (attempts < maxAttempts) {
                setTimeout(poll, 1500);
            } else {
                showToast('Подписка активируется. Пожалуйста, обновите страницу через минуту.', 'warning');
            }
        };
        setTimeout(poll, 500);
    });

    activeCheckoutWidget.on('fail', (errObj) => {
        const msg = (errObj && errObj.error) ? errObj.error : 'Оплата не прошла. Попробуйте ещё раз.';
        showToast(msg, 'error');
    });

    if (container) container.innerHTML = ''; // clear spinner before widget renders
    activeCheckoutWidget.render('yookassa-widget-container');
}

function closePaymentModal() {
    document.getElementById('payment-modal').classList.add('hidden');
    if (activeCheckoutWidget) {
        activeCheckoutWidget.destroy();
        activeCheckoutWidget = null;
    }
}

// ==========================================================================
// LANDING PAGE — GUEST FILE UPLOAD
// ==========================================================================

function initGuestLandingUpload() {
    const landingInput = document.getElementById('landing-file-input');
    if (!landingInput) return;

    landingInput.addEventListener('change', async (e) => {
        if (landingInput.files.length > 0) {
            await handleLandingFileSelected(landingInput.files[0]);
            landingInput.value = ''; // Reset so same file can be re-selected
        }
    });
}

function initCvDropzone() {
    const dropzone = document.getElementById('guest-file-dropzone');
    if (!dropzone) return;

    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('dragover');
        }, false);
    });

    dropzone.addEventListener('drop', async (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            await handleLandingFileSelected(files[0]);
        }
    }, false);
}

function clearSelectedFile(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    const textarea = document.getElementById('guest-cv-textarea');
    if (textarea) textarea.value = '';
    const fileStatus = document.getElementById('guest-file-status');
    if (fileStatus) fileStatus.classList.add('hidden');
    const reuploadInput = document.getElementById('guest-reupload-input');
    if (reuploadInput) reuploadInput.value = '';
}

async function handleLandingFileSelected(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'pdf' && ext !== 'txt') {
        showToast('Поддерживаемые форматы: PDF и TXT', 'error');
        return;
    }

    // Open the CV modal, show file-parsing loader
    openGuestCvModal();
    showGuestCvPhase('loader');

    try {
        let text = '';
        if (ext === 'pdf') {
            text = await parsePdfFile(file);
        } else {
            text = await parseTxtFile(file);
        }

        // Silently populate textarea (editor phase is skipped for guests)
        const textarea = document.getElementById('guest-cv-textarea');
        if (textarea) textarea.value = text;

        // Jump straight to LLM analysis — no editor review step
        await handleGuestCvSave();
    } catch (err) {
        // Inform user via toast then fall back to retry mode inside the modal
        showToast('Не удалось прочитать файл: ' + err.message, 'error');
        document.getElementById('guest-cv-error-msg').innerText = err.message;
        showGuestCvPhase('parse-error');
    }
}

function openGuestCvModal() {
    const modal = document.getElementById('cv-upload-modal');
    if (modal) modal.classList.remove('hidden');

    const closeBtn = document.getElementById('cv-close-btn');
    if (closeBtn) {
        if (currentUser && !currentUser.is_guest) {
            closeBtn.classList.remove('hidden');
        } else {
            closeBtn.classList.add('hidden');
        }
    }
}

function showGuestCvPhase(phase) {
    // Hide all phases
    const loaderEl = document.getElementById('guest-cv-loader');
    if (loaderEl) loaderEl.classList.add('hidden');

    const errorEl = document.getElementById('guest-cv-error');
    if (errorEl) errorEl.classList.add('hidden');

    const editorEl = document.getElementById('guest-cv-editor');
    if (editorEl) editorEl.classList.add('hidden');

    const llmLoaderEl = document.getElementById('guest-cv-llm-loader');
    if (llmLoaderEl) llmLoaderEl.classList.add('hidden');

    const llmErrorEl = document.getElementById('guest-cv-llm-error');
    if (llmErrorEl) llmErrorEl.classList.add('hidden');

    const footerEl = document.getElementById('guest-cv-footer');
    if (footerEl) footerEl.style.display = 'none';

    if (phase === 'loader') {
        if (loaderEl) loaderEl.classList.remove('hidden');
    } else if (phase === 'parse-error') {
        if (errorEl) errorEl.classList.remove('hidden');
        // Setup retry handler (valid re-upload skips editor, goes to LLM)
        const retryInput = document.getElementById('guest-file-retry-input');
        if (retryInput) {
            retryInput.onchange = async (e) => {
                if (retryInput.files.length > 0) {
                    await handleLandingFileSelected(retryInput.files[0]);
                    retryInput.value = '';
                }
            };
        }
    } else if (phase === 'editor') {
        if (editorEl) editorEl.classList.remove('hidden');
        if (footerEl) footerEl.style.display = 'flex';
        // Setup re-upload handler (skip editor, go straight to LLM)
        const reuploadInput = document.getElementById('guest-reupload-input');
        if (reuploadInput) {
            reuploadInput.onchange = async (e) => {
                if (reuploadInput.files.length > 0) {
                    await handleLandingFileSelected(reuploadInput.files[0]);
                    reuploadInput.value = '';
                }
            };
        }
    } else if (phase === 'llm-loader') {
        if (llmLoaderEl) llmLoaderEl.classList.remove('hidden');
        // Animate steps
        animateLlmSteps();
    } else if (phase === 'llm-error') {
        if (llmErrorEl) llmErrorEl.classList.remove('hidden');
    }
}

function showGuestCvEditor() {
    showGuestCvPhase('editor');
}

function animateLlmSteps() {
    const steps = ['llm-step-1', 'llm-step-2', 'llm-step-3'];
    steps.forEach((id, i) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('active', 'done');
        if (i === 0) {
            el.classList.add('done');
            el.innerHTML = `<i class='bx bxs-check-circle'></i> Читаем текст`;
        } else {
            el.innerHTML = i === 1
                ? `<i class='bx bx-loader-alt bx-spin'></i> Определяем специализацию`
                : `<i class='bx bx-time'></i> Анализируем опыт`;
        }
    });

    // Advance steps over time
    setTimeout(() => {
        const step2 = document.getElementById('llm-step-2');
        if (step2) { step2.classList.add('done'); step2.innerHTML = `<i class='bx bxs-check-circle'></i> Определяем специализацию`; }
        const step3 = document.getElementById('llm-step-3');
        if (step3) { step3.classList.add('active'); step3.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Анализируем опыт`; }
    }, 8000);
}

async function handleGuestCvSave() {
    const cvText = document.getElementById('guest-cv-textarea').value.trim();
    if (!cvText) { showToast('Введите текст резюме.', 'error'); return; }
    if (cvText.length < 200) { showToast('Резюме должно содержать не менее 200 символов.', 'error'); return; }
    if (cvText.length > 8000) { showToast('Резюме слишком длинное (максимум 8000 символов).', 'error'); return; }

    guestPendingCvText = cvText;
    showGuestCvPhase('llm-loader');

    const isGuest = !currentUser || currentUser.is_guest;

    if (isGuest) {
        const { data, error } = await apiRequest('api/guest/start', {
            method: 'POST',
            body: JSON.stringify({ cv_text: cvText })
        });

        if (error) {
            document.getElementById('guest-llm-error-msg').innerText = error;
            showGuestCvPhase('llm-error');
            return;
        }

        // Store guest session
        guestToken = data.guest_token;
        guestCvText = cvText;
        sessionStorage.setItem('guest_token', guestToken);
        currentUser = { is_guest: true };

        // Fetch full guest user details in background
        apiRequestWithToken('api/auth/me', {}, guestToken).then(({ data: meData }) => {
            if (meData) currentUser = meData;
        }).catch(() => { });

        // Close modal, show guest app
        closeCvModal();
        showScreen('guest-app');

        // Populate guest search settings from LLM result
        const guestRoleSelect = document.getElementById('guest-role-select');
        if (guestRoleSelect && data.role_id) {
            guestRoleSelect.value = data.role_id;
        }

        // Show CV analysis
        if (data.cv_analysis) {
            const analysisSection = document.getElementById('guest-cv-analysis-section');
            const analysisText = document.getElementById('guest-cv-analysis-text');
            if (analysisSection && analysisText) {
                analysisText.innerText = data.cv_analysis;
                analysisSection.classList.remove('hidden');
            }
        }

        // Navigate to Search Settings for the guest to confirm
        guestSwitchView('search-settings');
    } else {
        const { data, error } = await apiRequest('api/preferences', {
            method: 'POST',
            body: JSON.stringify({ cv_text: cvText })
        });

        if (error) {
            document.getElementById('guest-llm-error-msg').innerText = error;
            showGuestCvPhase('llm-error');
            return;
        }

        localCvText = cvText;
        showToast('Резюме успешно обновлено и проанализировано!', 'success');

        closeCvModal();
        await loadSettings();
        await checkBillingStatus();
        switchView('search-settings');
    }
}

function retryGuestLlm() {
    if (!guestPendingCvText) {
        showGuestCvPhase('editor');
        return;
    }
    handleGuestCvSave();
}

// ==========================================================================
// GUEST APP — VIEW SWITCHING & PREFERENCES
// ==========================================================================

function guestSwitchView(viewName) {
    document.querySelectorAll('#guest-app .content-view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('#guest-app .nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('#guest-app .mobile-nav-item').forEach(n => n.classList.remove('active'));

    if (viewName === 'dashboard') {
        const el = document.getElementById('guest-view-dashboard');
        if (el) el.classList.add('active');
        const nav = document.getElementById('guest-nav-dashboard');
        if (nav) nav.classList.add('active');
        const mobileNav = document.getElementById('guest-mobile-nav-dashboard');
        if (mobileNav) mobileNav.classList.add('active');
        renderGuestMatches();
    } else if (viewName === 'search-settings') {
        const el = document.getElementById('guest-view-search-settings');
        if (el) el.classList.add('active');
        const nav = document.getElementById('guest-nav-search-settings');
        if (nav) nav.classList.add('active');
        const mobileNav = document.getElementById('guest-mobile-nav-search-settings');
        if (mobileNav) mobileNav.classList.add('active');
    }
}



// ==========================================================================
// GUEST SCAN — Real matches + Onboarding Tips
// ==========================================================================

async function resumeGuestScan() {
    if (guestScanInterval) return;
    guestScanComplete = false;

    // Trigger scan (fire and forget)
    guestApiRequest('api/scan', { method: 'POST' }).catch(() => { });

    // Poll for matches every 5 seconds, up to 3 minutes
    const maxWait = 3 * 60 * 1000;
    const startTime = Date.now();
    const knownMatchIds = new Set(guestRealMatches.map(m => m.id));

    guestScanInterval = setInterval(async () => {
        if (guestScanComplete) { clearInterval(guestScanInterval); return; }
        const grid = document.getElementById('guest-matches-grid');
        if (!grid) { clearInterval(guestScanInterval); return; }

        if (Date.now() - startTime > maxWait) {
            clearInterval(guestScanInterval);
            guestScanComplete = true;
            if (guestRealMatches.length === 0) {
                grid.innerHTML = `<div class="guest-scan-state">
                    <div class="empty-icon icon-primary"><i class='bx bx-radar'></i></div>
                    <p class="guest-scan-title">Поиск занял больше времени</p>
                    <p class="guest-scan-sub">Иногда подбор вакансий занимает дольше. Попробуйте позже или зарегистрируйтесь и результаты придут к вам на почту!</p>
                    <button class="btn btn-primary btn-glow mt-20" onclick="openGuestRegisterModal()">
                        <i class='bx bx-user-plus'></i> Зарегистрироваться и получить результаты
                    </button>
                </div>`;
            } else if (guestRealMatches.length < 2) {
                appendPaywallCards();
            }
            return;
        }

        const { data } = await guestApiRequest('api/matches?limit=3');
        if (!data || !data.matches) return;

        // Add newly appeared matches
        let newAdded = false;
        data.matches.forEach(m => {
            if (!knownMatchIds.has(m.id)) {
                knownMatchIds.add(m.id);
                guestRealMatches.push(m);
                newAdded = true;
            }
        });

        if (newAdded) renderGuestMatches();

        if (guestRealMatches.length >= 3) {
            clearInterval(guestScanInterval);
            guestScanComplete = true;
            appendPaywallCards();
        } else if (guestRealMatches.length >= 2) {
            appendPaywallCards();
        }
    }, 5000);
}

async function startGuestScan() {
    guestRealMatches = [];
    guestScanComplete = false;

    const grid = document.getElementById('guest-matches-grid');
    if (!grid) return;

    // Show scanning state with onboarding tips
    grid.innerHTML = `
        <div class="guest-scan-state">
            <div class="guest-scan-spinner">
                <i class='bx bx-radar bx-spin'></i>
            </div>
            <p class="guest-scan-title">Ищем подходящие вакансии...</p>
            <p class="guest-scan-sub">ИИ анализирует сотни вакансий с трёх платформ</p>
            <div class="onboarding-tips">
                <div class="onboarding-tip">
                    <i class='bx bx-target-lock tip-icon'></i>
                    <div class="tip-text">
                        <strong>Рейтинг совпадения</strong>
                        <span>Чем выше процент, тем точнее вакансия соответствует вашему опыту. Вы сами устанавливаете минимальный порог после регистрации.</span>
                    </div>
                </div>
                <div class="onboarding-tip">
                    <i class='bx bx-envelope tip-icon'></i>
                    <div class="tip-text">
                        <strong>Автоматические уведомления</strong>
                        <span>После регистрации HH4YOU будет присылать вам подходящие вакансии на почту — вы будете среди первых, кто откликнулся.</span>
                    </div>
                </div>
                <div class="onboarding-tip">
                    <i class='bx bx-pencil tip-icon'></i>
                    <div class="tip-text">
                        <strong>Сопроводительное письмо</strong>
                        <span>Для каждой вакансии ИИ напишет персональное письмо — нажмите «Ещё...» на карточке, чтобы увидеть его.</span>
                    </div>
                </div>
            </div>
        </div>
    `;

    await resumeGuestScan();
}

function renderGuestMatches() {
    const guestScanStarted = sessionStorage.getItem('guest_scan_started') === 'true';
    if (guestScanStarted && !guestScanComplete && !guestScanInterval) {
        resumeGuestScan();
    }

    const grid = document.getElementById('guest-matches-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const badgeNew = document.getElementById('guest-badge-count-new');
    if (badgeNew) badgeNew.innerText = guestRealMatches.length;

    if (guestRealMatches.length === 0) {
        if (guestScanStarted && !guestScanComplete) {
            // Show scanning state with onboarding tips
            grid.innerHTML = `
                <div class="guest-scan-state">
                    <div class="guest-scan-spinner">
                        <i class='bx bx-radar bx-spin'></i>
                    </div>
                    <p class="guest-scan-title">Ищем подходящие вакансии...</p>
                    <p class="guest-scan-sub">ИИ анализирует сотни вакансий с трёх платформ</p>
                    <div class="onboarding-tips">
                        <div class="onboarding-tip">
                            <i class='bx bx-target-lock tip-icon'></i>
                            <div class="tip-text">
                                <strong>Рейтинг совпадения</strong>
                                <span>Чем выше процент, тем точнее вакансия соответствует вашему опыту. Вы сами устанавливаете минимальный порог после регистрации.</span>
                            </div>
                        </div>
                        <div class="onboarding-tip">
                            <i class='bx bx-envelope tip-icon'></i>
                            <div class="tip-text">
                                <strong>Автоматические уведомления</strong>
                                <span>После регистрации HH4YOU будет присылать вам подходящие вакансии на почту — вы будете среди первых, кто откликнулся.</span>
                            </div>
                        </div>
                        <div class="onboarding-tip">
                            <i class='bx bx-pencil tip-icon'></i>
                            <div class="tip-text">
                                <strong>Сопроводительное письмо</strong>
                                <span>Для каждой вакансии ИИ напишет персональное письмо — нажмите «Ещё...» на карточке, чтобы увидеть его.</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
                <div class="empty-icon" style="font-size: 48px; margin-bottom: 20px; color: var(--primary);"><i class='bx bx-radar'></i></div>
                <h4>Совпадений пока не найдено</h4>
                <p style="margin: 10px 0 20px 0; color: var(--text-muted);">Пожалуйста, укажите специализацию и запустите поиск в настройках, чтобы ИИ подобрал вакансии.</p>
                <button class="btn btn-secondary" onclick="guestSwitchView('search-settings')">
                    <i class='bx bx-slider-alt'></i> Перейти в настройки
                </button>
            </div>
        `;
        return;
    }

    // Feature 3: Urgency banner — always visible while guest has matches
    const urgencyBanner = document.createElement('div');
    urgencyBanner.className = 'guest-urgency-banner';
    urgencyBanner.innerHTML = `
        <div class="urgency-banner-icon"><i class='bx bx-time-five'></i></div>
        <div class="urgency-banner-text">Уведомления для зарегистрированных пользователей приходят в течение 3 минут с момента публикации вакансии. Успейте откликнуться в числе первых!</div>
    `;
    grid.appendChild(urgencyBanner);

    // Feature 2: Show (i) hint bubble on first card if not yet dismissed
    const infoHintShown = sessionStorage.getItem('guest_info_hint_shown');
    let isFirstCard = true;

    guestRealMatches.forEach(match => {
        const card = document.createElement('div');
        card.className = 'social-feed-card';
        const safeTitle = escapeHtml(match.title);
        const safeCompany = escapeHtml(match.company);
        const platformClass = match.url.includes('habr.com') ? 'habr' : (match.url.includes('superjob') ? 'superjob' : 'hh');
        const platformLabel = match.url.includes('habr.com') ? 'Habr' : (match.url.includes('superjob') ? 'SuperJob' : 'HH');

        card.innerHTML = `
            <div class="card-row-top">
                <div class="vacancy-logo-col">
                    <div class="platform-${platformClass} compact-logo">${platformLabel === 'SuperJob' ? 'SJ' : platformLabel[0]}</div>
                </div>
                <div class="vacancy-details-col">
                    <span class="company-name-row">${safeCompany}</span>
                    <h4 class="job-title-link compact-title" onclick="openGuestDetailModal(${match.id})">${safeTitle}</h4>
                </div>
            </div>
            <div class="card-row-bottom">
                <div class="vacancy-score-col">
                    <span class="match-score-pill compact-score ${match.score >= 85 ? 'high-match' : ''}">
                        🎯 ${match.score}% Match
                    </span>
                    <button class="vacancy-info-btn ${isFirstCard && !infoHintShown ? 'info-btn-pulse' : ''}" onclick="toggleReasoningTooltip(${match.id}, event)" title="Объяснение ИИ">
                        <i class='bx bx-info-circle'></i>
                        ${isFirstCard && !infoHintShown ? '<div class="info-hint-bubble">Нажмите, чтобы увидеть объяснение ИИ</div>' : ''}
                    </button>
                </div>
                <div class="vacancy-actions-col">
                    <button class="compact-more-btn" onclick="openGuestDetailModal(${match.id})">Ещё...</button>
                    <a href="${match.url}" target="_blank" class="vacancy-external-link">
                        <i class='bx bx-link-external'></i>
                    </a>
                </div>
            </div>
            <div id="reasoning-tray-${match.id}" class="reasoning-tray hidden" onclick="event.stopPropagation()">
                ${escapeHtml(match.reasoning)}
            </div>
        `;
        grid.appendChild(card);
        isFirstCard = false;
    });

    if (guestRealMatches.length >= 2) {
        appendPaywallCards();
    }

    if (guestRealMatches.length >= 1 && guestRealMatches.length < 3) {
        const banner = document.createElement('div');
        banner.className = 'auto-scan-info-box';
        banner.innerHTML = `<i class='bx bx-info-circle'></i><span>Поиск выполняется автоматически в фоновом режиме. Новые совпадения скоро появятся здесь.</span>`;
        grid.appendChild(banner);
    }
}

// ==========================================================================
// FAKE PAYWALL CARDS
// ==========================================================================

const FAKE_VACANCY_POOL = {
    // IT
    it: [
        { title: 'Senior Backend Developer', company: 'Яндекс', score: 94 },
        { title: 'Lead Software Engineer', company: 'VK', score: 91 },
        { title: 'Middle Frontend Developer', company: 'Авито', score: 88 },
        { title: 'DevOps Engineer', company: 'СберТех', score: 87 },
        { title: 'Python Developer', company: 'Тинькофф', score: 86 },
        { title: 'QA Automation Engineer', company: 'Альфа-Банк', score: 85 },
        { title: 'Data Scientist', company: 'Ozon', score: 84 },
        { title: 'Systems Analyst', company: 'МТС', score: 82 },
        { title: 'Mobile Dev (iOS/Android)', company: 'Касперский', score: 81 },
        { title: 'UI/UX Designer', company: 'ВКонтакте', score: 80 },
        { title: 'Site Reliability Engineer', company: 'Яндекс.Облако', score: 79 },
    ],
    // Default / other
    default: [
        { title: 'Ведущий специалист', company: 'Газпром', score: 93 },
        { title: 'Старший аналитик', company: 'Сбербанк', score: 89 },
        { title: 'Project Manager', company: 'Mail.ru Group', score: 86 },
        { title: 'Бизнес-аналитик', company: 'ВТБ', score: 85 },
        { title: 'Менеджер по продукту', company: 'Ростелеком', score: 84 },
        { title: 'Специалист по маркетингу', company: 'Яндекс.Маркет', score: 82 },
        { title: 'Финансовый аналитик', company: 'Тинькофф Бизнес', score: 81 },
        { title: 'Контент-менеджер', company: 'СберМаркет', score: 80 },
        { title: 'HR-специалист', company: 'Авито Работа', score: 78 },
        { title: 'Координатор проектов', company: 'СИБУР', score: 77 },
        { title: 'Руководитель направления', company: 'Северсталь', score: 76 },
    ]
};

function getFakePool(roleId) {
    const itRoles = ['25', '36', '96', '104', '112', '113', '114', '116', '121', '124', '125', '126', '148', '150', '156', '160', '165'];
    return itRoles.includes(String(roleId)) ? FAKE_VACANCY_POOL.it : FAKE_VACANCY_POOL.default;
}

function createBlurredCard(fake) {
    const card = document.createElement('div');
    card.className = 'social-feed-card paywall-card';

    const platformClass = 'hh';
    const platformLabel = 'HH';

    card.innerHTML = `
        <div class="card-row-top blur-content">
            <div class="vacancy-logo-col">
                <div class="platform-${platformClass} compact-logo">${platformLabel[0]}</div>
            </div>
            <div class="vacancy-details-col">
                <span class="company-name-row">${escapeHtml(fake.company)}</span>
                <h4 class="job-title-link compact-title">${escapeHtml(fake.title)}</h4>
            </div>
        </div>
        <div class="card-row-bottom">
            <div class="vacancy-score-col">
                <span class="match-score-pill compact-score high-match">
                    🎯 Match ${fake.score}%
                </span>
                <button class="vacancy-info-btn blur-content" disabled title="Match reasoning">
                    <i class='bx bx-info-circle blur-content'></i>
                </button>
            </div>
            <div class="vacancy-actions-col blur-content">
                <button class="compact-more-btn" disabled>Ещё...</button>
                <span class="vacancy-external-link">
                    <i class='bx bx-link-external'></i>
                </span>
            </div>
        </div>
        <div class="paywall-lock-overlay">
            <i class='bx bx-lock-alt'></i>
        </div>
    `;
    return card;
}

function appendPaywallCards() {
    const grid = document.getElementById('guest-matches-grid');
    if (!grid) return;

    // Remove existing paywall items to avoid duplicates
    grid.querySelectorAll('.paywall-card').forEach(c => c.remove());
    grid.querySelector('.paywall-cta-banner')?.remove();

    const roleSelect = document.getElementById('guest-role-select');
    const roleId = roleSelect ? roleSelect.value : '';
    const pool = getFakePool(roleId);

    // Show 1st blurred card
    if (pool.length > 0) {
        const fake = pool[0];
        const card = createBlurredCard(fake);
        grid.appendChild(card);
    }

    // Paywall CTA banner after 1st blurred card
    const banner = document.createElement('div');
    banner.className = 'paywall-cta-banner';
    const ctaText = activeGuestScenario === 'trial'
        ? `Зарегистрируйтесь и начните бесплатный ${guestTrialDays}-дневный пробный период с полным доступом!`
        : 'Зарегистрируйтесь и получите полный доступ к вакансиям, автоматическому поиску и сопроводительным письмам.';
    const priceText = activeGuestScenario === 'trial'
        ? `<strong>${guestTrialDays} дней бесплатно</strong>`
        : 'Всего <strong>₽300</strong> в месяц';

    banner.innerHTML = `
        <h3>🔓 Остальные подходящие вакансии скрыты</h3>
        <p>${escapeHtml(ctaText)}</p>
        <button class="btn btn-primary btn-glow btn-lg" onclick="openGuestRegisterModal()">
            <i class='bx bx-user-plus'></i> Зарегистрироваться
        </button>
        <p class="paywall-cta-price">${priceText}</p>
    `;
    grid.appendChild(banner);

    // Show 10 more blurred cards after the CTA banner
    for (let i = 1; i < 11; i++) {
        const fake = pool[i % pool.length];
        const card = createBlurredCard(fake);
        grid.appendChild(card);
    }
}

// ==========================================================================
// GUEST DETAIL MODAL (simplified — cover letter requires registration)
// ==========================================================================

function openGuestDetailModal(matchId) {
    const match = guestRealMatches.find(m => m.id === matchId);
    if (!match) return;
    selectedMatch = match;

    document.getElementById('modal-vacancy-title').innerText = match.title;
    document.getElementById('modal-vacancy-company').innerText = match.company;
    const urlLink = document.getElementById('modal-vacancy-url');
    if (urlLink) urlLink.href = match.url;

    // Cover letter section — load the cover letter for guest users
    loadCoverLetter(matchId);

    // Hide applied button for guests
    const appliedBtn = document.getElementById('modal-btn-applied');
    if (appliedBtn) {
        appliedBtn.classList.add('hidden');
    }

    // Enable copy button styling (disabled state is managed by loadCoverLetter)
    const copyBtn = document.getElementById('btn-copy-letter');
    if (copyBtn) { copyBtn.style.opacity = ''; }

    document.getElementById('detail-modal').classList.remove('hidden');
}

// ==========================================================================
// GUEST REGISTER + PAY MODAL
// ==========================================================================

function openGuestRegisterModal() {
    document.getElementById('guest-register-modal').classList.remove('hidden');
}

function closeGuestRegisterModal() {
    document.getElementById('guest-register-modal').classList.add('hidden');
}

async function handleGuestRegisterAndPay(event) {
    event.preventDefault();

    const email = document.getElementById('guest-reg-email').value.trim();
    const password = document.getElementById('guest-reg-password').value;

    const errorEl = document.getElementById('guest-reg-error');
    errorEl.classList.add('hidden');

    const submitBtn = document.getElementById('btn-guest-reg-submit');
    submitBtn.disabled = true;
    submitBtn.innerHTML = activeGuestScenario === 'trial'
        ? "<i class='bx bx-loader-alt bx-spin'></i> Создаем аккаунт и активируем триал..."
        : "<i class='bx bx-loader-alt bx-spin'></i> Создаем аккаунт и активируем доступ...";

    const { data, error } = await guestApiRequest('api/guest/register', {
        method: 'POST',
        body: JSON.stringify({
            email,
            password
        })
    });

    submitBtn.disabled = false;
    if (activeGuestScenario === 'trial') {
        submitBtn.innerHTML = `<i class='bx bx-gift'></i> Начать бесплатный ${guestTrialDays}-дневный пробный период`;
    } else {
        submitBtn.innerHTML = "<i class='bx bx-lock-open-alt'></i> Зарегистрироваться и активировать доступ";
    }

    if (error) {
        errorEl.textContent = error;
        errorEl.classList.remove('hidden');
        return;
    }

    // Store the new token
    localStorage.setItem('access_token', data.access_token);
    currentUser = data.user;
    guestToken = null;
    sessionStorage.removeItem('guest_token');

    // Close modals
    closeGuestRegisterModal();

    if (data.user && data.user.is_active) {
        const welcomeEmail = document.getElementById('welcome-email-hint');
        if (welcomeEmail) welcomeEmail.innerText = `Подходящие вакансии придут на ${currentUser.email}`;

        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) {
            welcomeScreen.classList.remove('hidden');
            welcomeScreen.classList.add('active');
        }
    } else {
        // Set registration onboarding flag and open payment modal
        sessionStorage.setItem('just_registered', 'true');
        openPaymentModal();
    }
}

async function completeGuestOnboarding() {
    const welcomeScreen = document.getElementById('welcome-screen');
    if (welcomeScreen) {
        welcomeScreen.classList.add('hidden');
        welcomeScreen.classList.remove('active');
    }

    // Switch to main app
    document.getElementById('user-email-display').innerText = currentUser.email;
    showScreen('main-app');
    switchView('dashboard');
    await refreshDashboard();
}
