require('dotenv').config();

module.exports = {
  baseUrl: process.env.BASE_URL,
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://hh4you:your-password@localhost:5432/hh4you',
  secretKey: (() => {
    const key = process.env.SECRET_KEY;
    if (!key || key === 'generate-a-secure-secret-key-for-jwt-tokens-here') {
      console.warn('WARNING: SECRET_KEY is not configured or uses the default placeholder. Set a secure SECRET_KEY in your .env file.');
    }
    return key || 'dev-only-insecure-key-' + Math.random().toString(36);
  })(),
  tokenExpireMinutes: parseInt(process.env.ACCESS_TOKEN_EXPIRE_MINUTES) || 60 * 24 * 7, // 7 days

  // Admin LLM settings
  llmBaseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
  llmApiKey: process.env.LLM_API_KEY || '',
  llmModelName: process.env.LLM_MODEL_NAME || 'gpt-4o-mini',


  // SuperJob API (register at https://api.superjob.ru/)
  superjobApiKey: process.env.SUPERJOB_API_KEY || '',

  // YooKassa Payment Gateway (https://yookassa.ru/developers)
  yookassaShopId: process.env.YOOKASSA_SHOP_ID || '',
  yookassaSecretKey: process.env.YOOKASSA_SECRET_KEY || '',
  yookassaAmount: process.env.YOOKASSA_AMOUNT || '300.00',
  yookassaCurrency: process.env.YOOKASSA_CURRENCY || 'RUB',

  // Admin SMTP settings
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: parseInt(process.env.SMTP_PORT) || 587,
  smtpUser: process.env.SMTP_USER || '',
  smtpPassword: process.env.SMTP_PASSWORD || '',
  smtpFromEmail: process.env.SMTP_FROM_EMAIL || '',

  // Scanning settings
  scanIntervalMinutes: parseInt(process.env.SCAN_INTERVAL_MINUTES) || 5,
  port: parseInt(process.env.PORT) || 8000,

  // Cache settings
  vacancyCacheMaxSize: parseInt(process.env.VACANCY_CACHE_MAX_SIZE) || 1000,
  vacancyCacheTtlMinutes: parseInt(process.env.VACANCY_CACHE_TTL_MINUTES) || 120,

  // Guest scenario settings
  guestFlowScenario: process.env.GUEST_FLOW_SCENARIO || 'paywall',
  guestTrialDays: parseInt(process.env.GUEST_TRIAL_DAYS) || 7
};
