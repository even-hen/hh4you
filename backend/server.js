const express = require('express');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { rateLimit } = require('express-rate-limit');
const config = require('./config');
const { initDb, dbQuery } = require('./db');
const { hashPassword, comparePassword, generateToken, generateGuestToken, authenticateToken } = require('./auth');
const { extractSpecializationFromCv, generateCoverLetter, analyzeCv } = require('./matcher');
const { startWorker, checkUserVacancies, isUserScanning } = require('./worker');
const { createPayment, getPayment } = require('./yookassa');
const { getHhAreaId } = require('./scrapers/hh');
const { sendWelcomeEmail, sendPasswordResetEmail } = require('./notifications');

const app = express();

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.set('trust proxy', 1);

// CORS headers (optional for local testing if running frontend separately)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = config.allowedOrigins || [];
  if (origin) {
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }
  } else {
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Rate limiters — completely bypassed in test mode to prevent 429 errors in parallel E2E tests
const isTestMode = process.env.NODE_ENV === 'test' || process.env.DB_TYPE === 'sqlite';
const rateLimitSkip = () => isTestMode;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  skip: rateLimitSkip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: 'Too many login attempts. Please try again in 15 minutes.' }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  skip: rateLimitSkip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: 'Too many accounts created from this IP. Please try again in an hour.' }
});

const guestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  skip: rateLimitSkip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: 'Too many guest sessions from this IP. Please try again in an hour.' }
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  skip: rateLimitSkip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: 'Too many password reset requests. Please try again in 15 minutes.' }
});


// ==========================================================================
// AUTH ROUTER API
// ==========================================================================

app.post('/api/auth/register', registerLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ detail: 'Email and password (min 6 chars) are required.' });
  }

  try {
    const existing = await dbQuery.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(400).json({ detail: 'User with this email already registered.' });
    }

    const hashed = hashPassword(password);

    const { id } = await dbQuery.run(
      'INSERT INTO users (email, hashed_password) VALUES (?, ?)',
      [email, hashed]
    );

    // Create default preferences
    await dbQuery.run(
      `INSERT INTO user_preferences (user_id, cv_text, extracted_specialization, job_format, city, match_threshold, email_notifications_enabled) 
       VALUES (?, '', '', '', '', 75, 1)`,
      [id]
    );

    const user = await dbQuery.get('SELECT id, email FROM users WHERE id = ?', [id]);
    res.json(user);
  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ detail: 'Server database failure' });
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ detail: 'Email and password are required.' });
  }

  try {
    const user = await dbQuery.get('SELECT * FROM users WHERE email = ? AND is_guest = 0', [email]);
    if (!user || !comparePassword(password, user.hashed_password)) {
      return res.status(401).json({ detail: 'Incorrect email or password.' });
    }

    const token = generateToken(user.email);

    // Set cookie
    res.cookie('access_token', token, {
      httpOnly: true,
      maxAge: config.tokenExpireMinutes * 60 * 1000,
      sameSite: 'lax',
      secure: false // Set true in production (HTTPS)
    });

    res.json({
      access_token: token,
      token_type: 'bearer',
      user: {
        id: user.id,
        email: user.email,
        is_active: !!(user.subscription_ends_at && new Date(user.subscription_ends_at).getTime() > new Date().getTime())
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ detail: 'Server database failure' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }
  if (!token && req.cookies) {
    token = req.cookies['access_token'];
  }

  if (token) {
    try {
      const jwt = require('jsonwebtoken');
      const payload = jwt.verify(token, config.secretKey);
      const email = payload.sub;
      dbQuery.run('DELETE FROM users WHERE email = ? AND is_guest = 1', [email]).catch(err => {
        console.error('Failed to delete guest user on logout:', err.message);
      });
    } catch (err) {
      // Ignore token verification error
    }
  }

  res.clearCookie('access_token');
  res.json({ success: true, message: 'Logged out successfully' });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  const user = req.user;
  res.json({
    id: user.id,
    email: user.email,
    is_active: user.isActive(),
    is_guest: user.is_guest,
    subscription_ends_at: user.subscription_ends_at
  });
});

app.post('/api/auth/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ detail: 'Email is required.' });
  }

  try {
    const user = await dbQuery.get('SELECT id FROM users WHERE email = ? AND is_guest = 0', [email]);
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await dbQuery.run('UPDATE users SET reset_token = ?, reset_token_expires_at = ? WHERE id = ?', [token, expires, user.id]);

      const resetLink = `${config.baseUrl || 'http://localhost:8000'}/?resetToken=${token}`;
      await sendPasswordResetEmail(email, resetLink);
    }

    // Always return 200 to prevent user enumeration
    res.json({ success: true, message: 'If the email matches an account, a password reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ detail: 'Server database failure' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password) {
    return res.status(400).json({ detail: 'Token and new password are required.' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ detail: 'Password must be at least 6 characters long.' });
  }

  try {
    const user = await dbQuery.get(
      `SELECT * FROM users 
       WHERE reset_token = ? 
         AND reset_token_expires_at > datetime('now')`,
      [token]
    );

    if (!user) {
      return res.status(400).json({ detail: 'Invalid or expired password reset link.' });
    }

    const hashed = hashPassword(new_password);
    await dbQuery.run('UPDATE users SET hashed_password = ? WHERE id = ?', [hashed, user.id]);

    // Note: Do not clear reset_token or reset_token_expires_at to allow reuse within the 15-minute window!

    // Automatic login: generate token, set cookie, and return same response structure as /api/auth/login
    const loginToken = generateToken(user.email);
    res.cookie('access_token', loginToken, {
      httpOnly: true,
      maxAge: config.tokenExpireMinutes * 60 * 1000,
      sameSite: 'lax',
      secure: false // Set true in production (HTTPS)
    });

    res.json({
      access_token: loginToken,
      token_type: 'bearer',
      user: {
        id: user.id,
        email: user.email,
        is_active: !!(user.subscription_ends_at && new Date(user.subscription_ends_at).getTime() > new Date().getTime())
      }
    });
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ detail: 'Server database failure' });
  }
});

// ==========================================================================
// GUEST SESSION API
// ==========================================================================

/**
 * POST /api/guest/start
 * Creates a temporary guest user, extracts CV keywords + analysis via LLM,
 * and returns a short-lived JWT for the guest session.
 */
app.post('/api/guest/start', guestLimiter, async (req, res) => {
  const { cv_text } = req.body;

  if (!cv_text || typeof cv_text !== 'string') {
    return res.status(400).json({ detail: 'CV text is required.' });
  }
  if (cv_text.length < 200) {
    return res.status(400).json({ detail: 'CV text must be at least 200 characters long.' });
  }
  if (cv_text.length > 8000) {
    return res.status(400).json({ detail: 'CV text is too long (maximum 8000 characters).' });
  }

  try {
    const fs = require('fs');
    const hhRoles = JSON.parse(fs.readFileSync(path.join(__dirname, 'roles', 'hh.json'), 'utf8'));

    // Run both LLM calls in parallel
    let specialization = '';
    let cvAnalysis = '';
    try {
      const [extractedSpec, analysis] = await Promise.all([
        extractSpecializationFromCv(cv_text),
        analyzeCv(cv_text)
      ]);
      specialization = extractedSpec.trim();
      cvAnalysis = analysis ? analysis.substring(0, 600) : '';
      console.log(`Guest CV processed. Extracted role ID: '${specialization}'`);
    } catch (llmErr) {
      console.error('Guest LLM error:', llmErr.message);
      if (llmErr.message === 'INVALID_CV') {
        return res.status(400).json({ detail: 'Содержание текста не похоже на резюме. Пожалуйста, используйте реальное резюме.' });
      }
      return res.status(500).json({ detail: 'Не удалось проанализировать ваше резюме. Пожалуйста, попробуйте позже...' });
    }

    // Create guest user — subscription_ends_at = now+48h so isActive() returns true
    const guestEmail = `guest_${uuidv4()}@guest.local`;
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    const { id: guestId } = await dbQuery.run(
      `INSERT INTO users (email, hashed_password, subscription_ends_at, is_guest, guest_expires_at)
       VALUES (?, '', ?, 1, ?)`,
      [guestEmail, expiresAt, expiresAt]
    );

    // Create preferences with CV + analysis
    await dbQuery.run(
      `INSERT INTO user_preferences (user_id, cv_text, extracted_specialization, cv_analysis, job_format, city, match_threshold, email_notifications_enabled)
       VALUES (?, ?, ?, ?, '', '', 75, 0)`,
      [guestId, cv_text, specialization, cvAnalysis]
    );

    const guestToken = generateGuestToken(guestEmail);
    const roleName = hhRoles[specialization] || '';

    res.json({
      guest_token: guestToken,
      cv_analysis: cvAnalysis,
      role_id: specialization,
      role_name: roleName
    });
  } catch (err) {
    console.error('Guest start error:', err.message);
    res.status(500).json({ detail: 'Server error creating guest session.' });
  }
});

/**
 * POST /api/guest/register
 * Converts a guest account into a real user account with a paid subscription.
 * Requires a valid guest JWT in the Authorization header.
 * Atomically: creates real user, copies guest data, deletes guest record.
 */
app.post('/api/guest/register', registerLimiter, authenticateToken, async (req, res) => {
  if (!req.user.is_guest) {
    return res.status(400).json({ detail: 'This endpoint is only for guest sessions.' });
  }

  const { email, password } = req.body;

  if (!email || !password || password.length < 6) {
    return res.status(400).json({ detail: 'Email and password (min 6 chars) are required.' });
  }

  try {
    // Check email not already taken by a real user
    const existing = await dbQuery.get('SELECT id FROM users WHERE email = ? AND is_guest = 0', [email]);
    if (existing) {
      return res.status(400).json({ detail: 'This email address is already registered.' });
    }

    const guestId = req.user.id;

    // Fetch guest preferences to transfer
    const guestPref = await dbQuery.get('SELECT * FROM user_preferences WHERE user_id = ?', [guestId]);
    if (!guestPref) {
      return res.status(400).json({ detail: 'Guest session data not found. Please start over.' });
    }

    // Create the real user
    const hashed = hashPassword(password);
    let subEnd = null;
    let isTrial = 0;

    if (config.guestFlowScenario === 'trial') {
      subEnd = new Date(Date.now() + config.guestTrialDays * 24 * 60 * 60 * 1000).toISOString();
      isTrial = 1;
    }

    const { id: newUserId } = await dbQuery.run(
      `INSERT INTO users (email, hashed_password, subscription_ends_at, is_guest, is_trial)
       VALUES (?, ?, ?, 0, ?)`,
      [email, hashed, subEnd, isTrial]
    );

    // Copy preferences from guest — email notifications ON by default for registered users
    await dbQuery.run(
      `INSERT INTO user_preferences
         (user_id, cv_text, extracted_specialization, cv_analysis, job_format, city, match_threshold, email_notifications_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        newUserId,
        guestPref.cv_text || '',
        guestPref.extracted_specialization || guestPref.extracted_keywords || '',
        guestPref.cv_analysis || '',
        guestPref.job_format !== undefined && guestPref.job_format !== null ? guestPref.job_format : '',
        guestPref.city || '',
        guestPref.match_threshold !== undefined && guestPref.match_threshold !== null ? guestPref.match_threshold : 75
      ]
    );

    // Transfer vacancy matches from guest to new user
    await dbQuery.run(
      'UPDATE vacancy_matches SET user_id = ? WHERE user_id = ?',
      [newUserId, guestId]
    );

    // Transfer only matched vacancies from processed_vacancies cache to the new user.
    await dbQuery.run(
      "UPDATE processed_vacancies SET user_id = ? WHERE user_id = ? AND status = 'matched'",
      [newUserId, guestId]
    );

    // Delete guest record (cascades preferences)
    await dbQuery.run('DELETE FROM users WHERE id = ?', [guestId]);

    // Auto-login: generate token, set cookie
    const token = generateToken(email);
    res.cookie('access_token', token, {
      httpOnly: true,
      maxAge: config.tokenExpireMinutes * 60 * 1000,
      sameSite: 'lax',
      secure: false
    });

    if (config.guestFlowScenario === 'trial') {
      // Send welcome email immediately for trial users
      sendWelcomeEmail(email).catch(err => {
        console.error(`Failed to send welcome email to ${email}:`, err.message);
      });

      // Trigger background scan if user has CV
      if (guestPref.cv_text) {
        const userObj = {
          id: newUserId,
          email,
          subscription_ends_at: subEnd,
          is_guest: false,
          isActive: () => true
        };
        checkUserVacancies(userObj).catch(err => {
          console.error(`Post-registration trial scan failed for ${email}:`, err.message);
        });
      }
      console.log(`Guest ${guestId} converted to real user ${newUserId} (${email}) with active ${config.guestTrialDays} days trial.`);
    } else {
      console.log(`Guest ${guestId} converted to real user ${newUserId} (${email}). Inactive pending payment.`);
    }

    res.json({
      success: true,
      access_token: token,
      user: {
        id: newUserId,
        email,
        is_active: subEnd !== null,
        is_guest: false,
        subscription_ends_at: subEnd,
        is_trial: isTrial === 1
      }
    });
  } catch (err) {
    console.error('Guest register error:', err.message);
    res.status(500).json({ detail: 'Server error during registration. Please try again.' });
  }
});

// ==========================================================================
// PREFERENCES ROUTER API
// ==========================================================================

app.get('/api/professional-roles', (req, res) => {
  try {
    const fs = require('fs');
    const hhRoles = JSON.parse(fs.readFileSync(path.join(__dirname, 'roles', 'hh.json'), 'utf8'));
    res.json(hhRoles);
  } catch (err) {
    res.status(500).json({ detail: 'Failed to load professional roles: ' + err.message });
  }
});

app.get('/api/guest/config', (req, res) => {
  res.json({
    guestFlowScenario: config.guestFlowScenario,
    guestTrialDays: config.guestTrialDays
  });
});

app.get('/api/preferences', authenticateToken, async (req, res) => {
  try {
    const pref = await dbQuery.get('SELECT * FROM user_preferences WHERE user_id = ?', [req.user.id]);
    if (!pref) {
      return res.status(404).json({ detail: 'Preferences not found' });
    }
    const fs = require('fs');
    const hhRoles = JSON.parse(fs.readFileSync(path.join(__dirname, 'roles', 'hh.json'), 'utf8'));
    const roleId = pref.extracted_specialization || pref.extracted_keywords || '';
    const roleName = hhRoles[roleId] || '';

    res.json({
      cv_text: pref.cv_text,
      extracted_specialization: pref.extracted_specialization || pref.extracted_keywords || '',
      extracted_keywords: pref.extracted_specialization || pref.extracted_keywords || '',
      role_id: roleId,
      role_name: roleName,
      job_format: pref.job_format,
      city: pref.city,
      match_threshold: pref.match_threshold,
      email_notifications_enabled: !!pref.email_notifications_enabled,
      cv_analysis: pref.cv_analysis || ''
    });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/preferences', authenticateToken, async (req, res) => {
  const { cv_text, job_format, city, match_threshold, email_notifications_enabled, extracted_keywords, extracted_specialization, role_id } = req.body;

  const isCvOnly = cv_text !== undefined && job_format === undefined;

  if (!isCvOnly && (cv_text === undefined || job_format === undefined)) {
    return res.status(400).json({ detail: 'CV Text and Job Format are required.' });
  }

  let serializedFormats;
  let activeCity;
  let activeMatchThreshold;
  let activeEmailNotifications;

  if (!isCvOnly) {
    let formats = [];
    if (Array.isArray(job_format)) {
      formats = job_format.map(f => f.trim().toLowerCase());
    } else if (typeof job_format === 'string' && job_format.trim() !== '') {
      formats = job_format.split(',').map(f => f.trim().toLowerCase());
    }
    formats = formats.filter(f => ['remote', 'onsite', 'hybrid', 'any'].includes(f));

    const hasOnsiteOrHybrid = formats.includes('onsite') || formats.includes('hybrid');
    if (city && hasOnsiteOrHybrid) {
      try {
        const areaId = await getHhAreaId(city);
        if (!areaId) {
          return res.status(400).json({ detail: `The city "${city}" could not be recognized. Please check your spelling.` });
        }
      } catch (err) {
        console.error('City validation error:', err.message);
        return res.status(503).json({ detail: 'City validation service is temporarily down. Please try again later.' });
      }
    }

    serializedFormats = formats.join(',');
    activeCity = city || '';
    activeMatchThreshold = match_threshold !== undefined ? match_threshold : 75;
    // Guests cannot enable email notifications
    activeEmailNotifications = req.user.is_guest ? 0 : (email_notifications_enabled ? 1 : 0);
  }

  try {
    if (cv_text && cv_text.length > 8000) {
      return res.status(400).json({ detail: 'Текст резюме слишком длинный (максимум 8000 символов)' });
    }

    const pref = await dbQuery.get('SELECT * FROM user_preferences WHERE user_id = ?', [req.user.id]);

    let finalJobFormat = serializedFormats;
    let finalCity = activeCity;
    let finalMatchThreshold = activeMatchThreshold;
    let finalEmailNotifications = req.user.is_guest ? 0 : (email_notifications_enabled !== undefined ? (email_notifications_enabled ? 1 : 0) : (pref ? (pref.email_notifications_enabled ? 1 : 0) : 1));

    if (isCvOnly) {
      finalJobFormat = pref ? pref.job_format : '';
      finalCity = pref ? pref.city : '';
      finalMatchThreshold = pref ? pref.match_threshold : 75;
      finalEmailNotifications = req.user.is_guest ? 0 : (pref ? (pref.email_notifications_enabled ? 1 : 0) : 1);
    }

    if (req.user.is_guest) {
      // Force guest preferences invariants
      finalJobFormat = '';
      finalCity = '';
      finalEmailNotifications = 0;
    }

    const oldCv = pref ? pref.cv_text : '';
    const cvChanged = cv_text && cv_text !== oldCv;
    const oldSpecialization = pref ? (pref.extracted_specialization || pref.extracted_keywords || '') : '';
    const hasFallbackSpecialization = !oldSpecialization || oldSpecialization === 'Python Developer' || oldSpecialization === 'Developer';

    let specialization = '';
    let cvAnalysis = pref ? (pref.cv_analysis || '') : '';

    const fs = require('fs');
    const hhRoles = JSON.parse(fs.readFileSync(path.join(__dirname, 'roles', 'hh.json'), 'utf8'));

    if (cvChanged || (cv_text && hasFallbackSpecialization)) {
      console.log(`CV updated for ${req.user.email}. Extracting specialization + running CV analysis via LLM...`);
      try {
        // Run both LLM calls in parallel to save time
        const [extractedSpec, analysis] = await Promise.all([
          extractSpecializationFromCv(cv_text),
          analyzeCv(cv_text)
        ]);
        specialization = extractedSpec.trim();
        cvAnalysis = analysis;
        console.log(`Extracted role ID: '${specialization}'`);
      } catch (llmErr) {
        console.error('Specialization extraction error:', llmErr.message);
        if (llmErr.message === 'INVALID_CV') {
          return res.status(400).json({ detail: 'Содержание текста не похоже на резюме. Пожалуйста, используйте реальное резюме.' });
        }
        return res.status(500).json({ detail: 'Не удалось определить вашу специализацию по резюме. Попробуйте ещё раз.' });
      }
    } else {
      const inputSpecialization = role_id !== undefined ? role_id : (extracted_specialization !== undefined ? extracted_specialization : (extracted_keywords !== undefined ? extracted_keywords : (pref ? (pref.extracted_specialization || pref.extracted_keywords) : '')));
      const cleanSpec = String(inputSpecialization).trim();
      if (cleanSpec && !hhRoles[cleanSpec]) {
        return res.status(400).json({ detail: 'Invalid professional role ID.' });
      }
      specialization = cleanSpec;
    }

    // Save preferences (including successfully extracted specialization and CV analysis)
    await dbQuery.run(
      `INSERT INTO user_preferences 
       (user_id, cv_text, extracted_specialization, job_format, city, match_threshold, email_notifications_enabled, cv_analysis) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         cv_text = EXCLUDED.cv_text,
         extracted_specialization = EXCLUDED.extracted_specialization,
         job_format = EXCLUDED.job_format,
         city = EXCLUDED.city,
         match_threshold = EXCLUDED.match_threshold,
         email_notifications_enabled = EXCLUDED.email_notifications_enabled,
         cv_analysis = EXCLUDED.cv_analysis`,
      [
        req.user.id,
        cv_text,
        specialization,
        finalJobFormat,
        finalCity,
        finalMatchThreshold,
        finalEmailNotifications,
        cvAnalysis
      ]
    );

    const oldThreshold = pref ? pref.match_threshold : 75;
    const oldJobFormat = pref ? (pref.job_format || '') : '';
    const oldCity = pref ? (pref.city || '') : '';

    const specChanged = specialization !== oldSpecialization;
    const formatChanged = finalJobFormat !== oldJobFormat;
    const cityChanged = finalCity !== oldCity;
    const thresholdChanged = finalMatchThreshold !== oldThreshold;
    const roleChanged = role_id !== undefined && String(role_id).trim() !== oldSpecialization;

    const searchSettingsChanged =
      cvChanged ||
      specChanged ||
      formatChanged ||
      cityChanged ||
      thresholdChanged;

    if (searchSettingsChanged) {
      console.log(`Search settings changed for ${req.user.email}. Clearing processed cache...`);

      const shouldKeepMatches = cvChanged || (!specChanged && !roleChanged && !formatChanged && !cityChanged);

      if (shouldKeepMatches) {
        await dbQuery.run(
          "DELETE FROM processed_vacancies WHERE user_id = ? AND status != 'matched'",
          [req.user.id]
        );
      } else {
        await dbQuery.run(
          "DELETE FROM processed_vacancies WHERE user_id = ?",
          [req.user.id]
        );
      }

      if (!shouldKeepMatches) {
        console.log(`Clearing vacancy matches for ${req.user.email}...`);
        await dbQuery.run(
          "DELETE FROM vacancy_matches WHERE user_id = ?",
          [req.user.id]
        );
      }
    }

    // Trigger scanning for active registered user in background if CV changed (fire and forget)
    if (cvChanged && !req.user.is_guest && req.user.isActive()) {
      checkUserVacancies(req.user).catch(err => {
        console.error(`Post-preferences background scan failed for ${req.user.email}:`, err.message);
      });
    }

    const updated = await dbQuery.get('SELECT * FROM user_preferences WHERE user_id = ?', [req.user.id]);
    const roleId = updated.extracted_specialization || updated.extracted_keywords || '';
    const roleName = hhRoles[roleId] || '';

    res.json({
      cv_text: updated.cv_text,
      extracted_specialization: roleId,
      extracted_keywords: roleId,
      role_id: roleId,
      role_name: roleName,
      job_format: updated.job_format,
      city: updated.city,
      match_threshold: updated.match_threshold,
      email_notifications_enabled: !!updated.email_notifications_enabled,
      cv_analysis: updated.cv_analysis || ''
    });
  } catch (err) {
    console.error('Update preferences error:', err.message);
    res.status(500).json({ detail: 'Database save error' });
  }
});

// ==========================================================================
// MATCHES ROUTER API
// ==========================================================================

app.get('/api/matches', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit);
    const page = parseInt(req.query.page) || 1;
    const applied = req.query.applied;
    const sort = req.query.sort || 'new';
    let orderBy = 'ORDER BY vm.created_at DESC';
    if (sort === 'match') {
      orderBy = 'ORDER BY vm.score DESC, vm.created_at DESC';
    }
    const selectFields = 'vm.id, vm.user_id, vm.title, vm.company, vm.url, vm.score, vm.reasoning, vm.cover_letter, vm.applied, vm.notified_email, vm.created_at';

    const userRow = await dbQuery.get(
      'SELECT last_scanned_at FROM users WHERE id = ?',
      [req.user.id]
    );

    let whereClause = 'WHERE vm.user_id = ? AND vm.score >= up.match_threshold';
    let queryParams = [req.user.id];

    if (applied !== undefined && applied !== '') {
      const isApplied = (applied === 'true' || applied === '1');
      whereClause += ' AND vm.applied = ?';
      queryParams.push(isApplied ? 1 : 0);
    }

    const countsRow = await dbQuery.get(
      `SELECT 
         COUNT(*) as total_all,
         SUM(CASE WHEN vm.applied = 0 THEN 1 ELSE 0 END) as total_new,
         SUM(CASE WHEN vm.applied = 1 THEN 1 ELSE 0 END) as total_applied
       FROM vacancy_matches vm
       JOIN user_preferences up ON vm.user_id = up.user_id
       WHERE vm.user_id = ? AND vm.score >= up.match_threshold`,
      [req.user.id]
    );
    const totalAll = countsRow ? countsRow.total_all : 0;
    const totalNew = countsRow ? (countsRow.total_new || 0) : 0;
    const totalApplied = countsRow ? (countsRow.total_applied || 0) : 0;

    let total = totalAll;
    if (applied !== undefined && applied !== '') {
      total = (applied === 'true' || applied === '1') ? totalApplied : totalNew;
    }

    let matches;
    let hasMore = false;
    let activeLimit = limit;

    if (limit && limit > 0) {
      const offset = (page - 1) * limit;
      matches = await dbQuery.all(
        `SELECT ${selectFields} FROM vacancy_matches vm JOIN user_preferences up ON vm.user_id = up.user_id ${whereClause} ${orderBy} LIMIT ? OFFSET ?`,
        [...queryParams, limit, offset]
      );
      hasMore = offset + matches.length < total;
    } else {
      matches = await dbQuery.all(
        `SELECT ${selectFields} FROM vacancy_matches vm JOIN user_preferences up ON vm.user_id = up.user_id ${whereClause} ${orderBy}`,
        queryParams
      );
      activeLimit = total;
      hasMore = false;
    }

    res.json({
      matches,
      total,
      total_all: totalAll,
      new_count: totalNew,
      applied_count: totalApplied,
      page,
      limit: activeLimit,
      has_more: hasMore,
      last_scan: userRow ? userRow.last_scanned_at : null
    });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.get('/api/matches/:id', authenticateToken, async (req, res) => {
  try {
    const selectFields = 'vm.id, vm.user_id, vm.title, vm.company, vm.url, vm.score, vm.reasoning, vm.cover_letter, vm.applied, vm.notified_email, vm.created_at';
    const match = await dbQuery.get(
      `SELECT ${selectFields} FROM vacancy_matches vm
       JOIN user_preferences up ON vm.user_id = up.user_id
       WHERE vm.id = ? AND vm.user_id = ? AND vm.score >= up.match_threshold`,
      [req.params.id, req.user.id]
    );
    if (!match) {
      return res.status(404).json({ detail: 'Match not found' });
    }
    res.json(match);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.delete('/api/matches/:id', authenticateToken, async (req, res) => {
  try {
    const match = await dbQuery.get(
      `SELECT vm.id FROM vacancy_matches vm 
       JOIN user_preferences up ON vm.user_id = up.user_id 
       WHERE vm.id = ? AND vm.user_id = ? AND vm.score >= up.match_threshold`,
      [req.params.id, req.user.id]
    );
    if (!match) {
      return res.status(404).json({ detail: 'Match not found' });
    }
    await dbQuery.run('DELETE FROM vacancy_matches WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Match deleted successfully' });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/matches/:id/apply', authenticateToken, async (req, res) => {
  const { applied } = req.body;
  try {
    const match = await dbQuery.get(
      `SELECT vm.id FROM vacancy_matches vm 
       JOIN user_preferences up ON vm.user_id = up.user_id 
       WHERE vm.id = ? AND vm.user_id = ? AND vm.score >= up.match_threshold`,
      [req.params.id, req.user.id]
    );
    if (!match) {
      return res.status(404).json({ detail: 'Match not found' });
    }
    const appliedVal = applied ? 1 : 0;
    await dbQuery.run('UPDATE vacancy_matches SET applied = ? WHERE id = ?', [appliedVal, req.params.id]);
    res.json({ success: true, applied: appliedVal });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/matches/:id/cover-letter', authenticateToken, async (req, res) => {
  try {
    const match = await dbQuery.get(
      `SELECT vm.* FROM vacancy_matches vm 
       JOIN user_preferences up ON vm.user_id = up.user_id 
       WHERE vm.id = ? AND vm.user_id = ? AND vm.score >= up.match_threshold`,
      [req.params.id, req.user.id]
    );
    if (!match) {
      return res.status(404).json({ detail: 'Match not found' });
    }

    if (match.cover_letter && match.cover_letter.trim() !== '') {
      return res.json({ cover_letter: match.cover_letter });
    }

    const pref = await dbQuery.get('SELECT cv_text FROM user_preferences WHERE user_id = ?', [req.user.id]);
    if (!pref || !pref.cv_text) {
      return res.status(400).json({ detail: 'Отсутствует резюме. Пожалуйста, загрузите его....' });
    }

    console.log(`Generating lazy cover letter for match ${match.id} (user: ${req.user.email})...`);
    const coverLetter = await generateCoverLetter(pref.cv_text, {
      title: match.title,
      company: match.company,
      description: match.description
    });

    if (!coverLetter) {
      return res.status(502).json({ detail: 'Failed to communicate with LLM API' });
    }

    await dbQuery.run('UPDATE vacancy_matches SET cover_letter = ? WHERE id = ?', [coverLetter, match.id]);

    res.json({ cover_letter: coverLetter });
  } catch (err) {
    console.error('Error generating lazy cover letter:', err.message);
    res.status(500).json({ detail: err.message });
  }
});

// ==========================================================================
// BILLING ROUTER API
// ==========================================================================

app.get('/api/billing/status', authenticateToken, async (req, res) => {
  const user = req.user;
  let isActive = user.isActive();

  if (!isActive) {
    try {
      const dbUser = await dbQuery.get('SELECT pending_payment_id FROM users WHERE id = ?', [user.id]);
      if (dbUser && dbUser.pending_payment_id) {
        const payment = await getPayment(dbUser.pending_payment_id);
        if (payment && payment.status === 'succeeded') {
          const now = new Date();
          let newEnd = new Date();
          if (user.subscription_ends_at && new Date(user.subscription_ends_at).getTime() > now.getTime()) {
            newEnd = new Date(user.subscription_ends_at);
          }
          newEnd.setDate(newEnd.getDate() + 30);
          const endStr = newEnd.toISOString();

          await dbQuery.run(
            'UPDATE users SET subscription_ends_at = ?, notified_sub_end = 0, pending_payment_id = NULL, is_trial = 0 WHERE id = ?',
            [endStr, user.id]
          );
          console.log(`[Billing Status Fallback] Subscription activated for user ${user.id} (${user.email}) until ${endStr}`);

          // Send welcome email (non-blocking)
          sendWelcomeEmail(user.email).catch(err => {
            console.error(`[Billing Status Fallback] Failed to send welcome email to ${user.email}:`, err.message);
          });

          // Trigger background scan if user has CV
          const pref = await dbQuery.get('SELECT cv_text FROM user_preferences WHERE user_id = ?', [user.id]);
          if (pref && pref.cv_text) {
            user.subscription_ends_at = endStr;
            checkUserVacancies(user).catch(err => {
              console.error(`[Billing Status Fallback] Post-payment scan failed for ${user.email}:`, err.message);
            });
          }

          user.subscription_ends_at = endStr;
          isActive = true;
        }
      }
    } catch (err) {
      console.error('Error during pending payment status fallback check:', err.message);
    }
  }

  const now = new Date().getTime();
  let subscriptionDaysLeft = null;

  if (user.subscription_ends_at) {
    const diff = new Date(user.subscription_ends_at).getTime() - now;
    subscriptionDaysLeft = diff > 0 ? Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000))) : 0;
  }

  const status = isActive ? 'active' : 'expired';

  res.json({
    status,
    is_active: isActive,
    is_trial: !!user.is_trial && isActive,
    subscription_days_left: subscriptionDaysLeft,
    subscription_ends_at: user.subscription_ends_at
  });
});

/**
 * POST /api/billing/pay
 * Initiates a YooKassa payment by creating a payment object and returning
 * the confirmation_token for the frontend Checkout Widget.
 * Subscription is NOT activated here — only after the webhook confirms payment.succeeded.
 */
app.post('/api/billing/pay', authenticateToken, async (req, res) => {
  if (req.user.is_guest) {
    return res.status(400).json({ detail: 'Please use /api/guest/register to subscribe.' });
  }

  if (!config.yookassaShopId || !config.yookassaSecretKey) {
    return res.status(503).json({ detail: 'Payment system is not configured. Please contact support.' });
  }

  try {
    const user = req.user;

    const { paymentId, confirmationToken } = await createPayment(user.id, user.email);

    // Store the pending payment ID so webhook can match it back to this user
    await dbQuery.run(
      'UPDATE users SET pending_payment_id = ? WHERE id = ?',
      [paymentId, user.id]
    );

    res.json({
      confirmation_token: confirmationToken,
      payment_id: paymentId,
      amount: config.yookassaAmount,
      currency: config.yookassaCurrency,
    });
  } catch (err) {
    console.error('Payment creation error:', err.message);
    res.status(502).json({ detail: `Не удалось создать платёж: ${err.message}` });
  }
});

/**
 * POST /api/billing/webhook
 * Receives payment status notifications from YooKassa.
 * Security: always re-fetches payment from YooKassa API to verify — never trusts payload alone.
 *
 * Set this URL in your YooKassa merchant dashboard:
 *   Интеграция → HTTP-уведомления → https://hh4you.ru/api/billing/webhook
 */
app.post('/api/billing/webhook', async (req, res) => {
  // Respond 200 immediately so YooKassa doesn't retry during our async processing
  res.sendStatus(200);

  try {
    const event = req.body;

    if (!event || !event.object || !event.object.id) {
      console.warn('[YooKassa Webhook] Received invalid payload:', JSON.stringify(event));
      return;
    }

    const paymentId = event.object.id;
    console.log(`[YooKassa Webhook] Received event: ${event.event}, payment: ${paymentId}`);

    if (event.event !== 'payment.succeeded') {
      // We only care about successful payments; ignore others
      return;
    }

    // Security: verify by fetching from YooKassa directly
    let payment;
    try {
      payment = await getPayment(paymentId);
    } catch (fetchErr) {
      console.error(`[YooKassa Webhook] Failed to verify payment ${paymentId}:`, fetchErr.message);
      return;
    }

    if (payment.status !== 'succeeded') {
      console.warn(`[YooKassa Webhook] Payment ${paymentId} is not succeeded (status: ${payment.status}). Ignoring.`);
      return;
    }

    // Match payment to user via metadata.userId (set during createPayment)
    const userIdStr = payment.metadata && payment.metadata.userId;
    if (!userIdStr) {
      console.error(`[YooKassa Webhook] Payment ${paymentId} has no userId in metadata. Cannot activate.`);
      return;
    }
    const userId = parseInt(userIdStr);

    const user = await dbQuery.get('SELECT * FROM users WHERE id = ? AND is_guest = 0', [userId]);
    if (!user) {
      console.error(`[YooKassa Webhook] User ${userId} not found or is a guest. Payment: ${paymentId}`);
      return;
    }

    // Extend subscription by 30 days
    const now = new Date();
    let newEnd = new Date();
    if (user.subscription_ends_at && new Date(user.subscription_ends_at).getTime() > now.getTime()) {
      newEnd = new Date(user.subscription_ends_at);
    }
    newEnd.setDate(newEnd.getDate() + 30);
    const endStr = newEnd.toISOString();

    await dbQuery.run(
      'UPDATE users SET subscription_ends_at = ?, notified_sub_end = 0, pending_payment_id = NULL, is_trial = 0 WHERE id = ?',
      [endStr, userId]
    );

    console.log(`[YooKassa Webhook] Subscription activated for user ${userId} (${user.email}) until ${endStr}`);

    // Send welcome email now that payment is confirmed (non-blocking)
    sendWelcomeEmail(user.email).catch(err => {
      console.error(`[YooKassa Webhook] Failed to send welcome email to ${user.email}:`, err.message);
    });

    // Trigger background scan if user has CV
    const pref = await dbQuery.get('SELECT cv_text FROM user_preferences WHERE user_id = ?', [userId]);
    if (pref && pref.cv_text) {
      // Augment user object with new subscription end for isActive() check
      user.subscription_ends_at = endStr;
      checkUserVacancies(user).catch(err => {
        console.error(`[YooKassa Webhook] Post-payment scan failed for ${user.email}:`, err.message);
      });
    }
  } catch (err) {
    console.error('[YooKassa Webhook] Unhandled error:', err.message);
  }
});

// ==========================================================================
// VACANCY SCANNING API
// ==========================================================================

app.post('/api/scan', authenticateToken, async (req, res) => {
  if (!req.user.isActive()) {
    return res.status(402).json({ detail: 'Your subscription has expired. Please subscribe.' });
  }

  if (isUserScanning(req.user.id)) {
    return res.status(409).json({ detail: 'A vacancy scan is already in progress for your account. Please wait.' });
  }

  try {
    const pref = await dbQuery.get('SELECT * FROM user_preferences WHERE user_id = ?', [req.user.id]);
    if (!pref || !pref.cv_text) {
      return res.status(400).json({ detail: 'Please upload your CV before scanning.' });
    }

    // Trigger scanning in background
    checkUserVacancies(req.user).catch(err => {
      console.error(`Background scan failed for ${req.user.email}:`, err.message);
    });

    res.json({ success: true, message: 'Scanning triggered. Matches will appear shortly.' });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// ==========================================================================
// FRONTEND STATIC FILE ROUTING
// ==========================================================================
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// Boot app
const start = async () => {
  try {
    await initDb();
    app.listen(config.port, () => {
      console.log(`HH4YOU Web App running on http://localhost:${config.port}`);

      // Start background scans worker
      if (process.env.NODE_ENV !== 'test') { startWorker(); } else { console.log('Background worker disabled in test mode.'); }
    });
  } catch (err) {
    console.error('Server startup failure:', err);
    process.exit(1);
  }
};

start();
