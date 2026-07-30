const config = require('./config');
const isTestMode = process.env.NODE_ENV === 'test' || process.env.DB_TYPE === 'sqlite';

let dbQuery;
let initDb;
let db;

if (isTestMode) {
  // ─── SQLITE DRIVER (TEST MODE) ─────────────────────────────────────────────
  const sqlite3 = require('sqlite3').verbose();
  const path = require('path');
  const testDbPath = process.env.TEST_DB_PATH || path.resolve(__dirname, '../hh4me_test.db');

  db = new sqlite3.Database(testDbPath);
  db.configure("busyTimeout", 10000);

  dbQuery = {
    async run(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
          if (err) return reject(err);
          resolve({ id: this.lastID, changes: this.changes });
        });
      });
    },
    async get(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        });
      });
    },
    async all(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        });
      });
    }
  };

  initDb = async () => {
    // Enable Foreign Keys and WAL mode
    await dbQuery.run('PRAGMA foreign_keys = ON;');
    await dbQuery.run('PRAGMA journal_mode = WAL;');
    await dbQuery.run('PRAGMA synchronous = NORMAL;');

    // 1. Create Users Table
    await dbQuery.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        hashed_password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        subscription_ends_at DATETIME NULL,
        notified_sub_end INTEGER DEFAULT 0,
        is_guest INTEGER DEFAULT 0,
        guest_expires_at DATETIME NULL,
        last_scanned_at DATETIME NULL,
        reset_token TEXT NULL,
        reset_token_expires_at DATETIME NULL,
        pending_payment_id TEXT NULL,
        is_trial INTEGER DEFAULT 0
      )
    `);

    // 2. Create User Preferences Table
    await dbQuery.run(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        cv_text TEXT NULL,
        extracted_specialization TEXT NULL,
        job_format TEXT DEFAULT '',
        city TEXT NULL,
        match_threshold INTEGER DEFAULT 75,
        email_notifications_enabled INTEGER DEFAULT 1,
        cv_analysis TEXT NULL
      )
    `);

    // 3. Create Processed Vacancies Cache Table
    await dbQuery.run(`
      CREATE TABLE IF NOT EXISTS processed_vacancies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        external_id TEXT NOT NULL,
        status TEXT NOT NULL,
        scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reason TEXT NULL
      )
    `);

    await dbQuery.run(`CREATE INDEX IF NOT EXISTS idx_proc_vac ON processed_vacancies (user_id, platform, external_id)`);

    // 4. Create Vacancy Matches Table
    await dbQuery.run(`
      CREATE TABLE IF NOT EXISTS vacancy_matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        url TEXT NOT NULL,
        description TEXT NOT NULL,
        score INTEGER NOT NULL,
        reasoning TEXT NOT NULL,
        cover_letter TEXT NOT NULL,
        applied INTEGER DEFAULT 0,
        notified_email INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  };
} else {
  // ─── POSTGRESQL DRIVER (PRODUCTION & DEV MODE) ────────────────────────────
  const { Pool } = require('pg');

  const pool = new Pool({
    connectionString: config.databaseUrl,
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
  });

  db = pool;

  // Converts SQLite '?' placeholders to PostgreSQL '$1, $2, ...' placeholders
  // and translates SQLite datetime() functions to PostgreSQL CURRENT_TIMESTAMP equivalents
  function convertQuery(sql) {
    let paramIndex = 1;
    let pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
    
    // Convert SQLite datetime('now') to PostgreSQL CURRENT_TIMESTAMP
    pgSql = pgSql.replace(/datetime\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP');
    
    // Convert SQLite datetime('now', '+/- N days/hours/minutes/etc') to PostgreSQL CURRENT_TIMESTAMP +/- INTERVAL 'N days/hours/minutes/etc'
    pgSql = pgSql.replace(/datetime\(\s*'now'\s*,\s*'([+-])\s*(\d+)\s*(\w+?)s?'\s*\)/gi, "(CURRENT_TIMESTAMP $1 INTERVAL '$2 $3')");
    
    return pgSql;
  }

  dbQuery = {
    async run(sql, params = []) {
      let pgSql = convertQuery(sql);
      const trimmed = pgSql.trim();
      const isInsert = trimmed.match(/^insert\s+/i);
      const hasReturning = trimmed.match(/returning\s+/i);

      // Automatically return ID on insert queries to mirror SQLite's lastID behavior
      if (isInsert && !hasReturning) {
        if (trimmed.match(/into\s+user_preferences/i)) {
          pgSql += ' RETURNING user_id';
        } else {
          pgSql += ' RETURNING id';
        }
      }

      const result = await pool.query(pgSql, params);
      const id = (result.rows && result.rows[0]) ? (result.rows[0].id || result.rows[0].user_id) : null;
      return { id, changes: result.rowCount };
    },
    async get(sql, params = []) {
      const pgSql = convertQuery(sql);
      const result = await pool.query(pgSql, params);
      return result.rows[0] || null;
    },
    async all(sql, params = []) {
      const pgSql = convertQuery(sql);
      const result = await pool.query(pgSql, params);
      return result.rows;
    }
  };

  initDb = async () => {
    // 1. Create Users Table
    await dbQuery.run(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        hashed_password TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        subscription_ends_at TIMESTAMP NULL,
        notified_sub_end INTEGER DEFAULT 0,
        is_guest INTEGER DEFAULT 0,
        guest_expires_at TIMESTAMP NULL,
        last_scanned_at TIMESTAMP NULL,
        reset_token TEXT NULL,
        reset_token_expires_at TIMESTAMP NULL,
        pending_payment_id TEXT NULL,
        is_trial INTEGER DEFAULT 0
      )
    `);

    // 2. Create User Preferences Table
    await dbQuery.run(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        cv_text TEXT NULL,
        extracted_specialization TEXT NULL,
        job_format TEXT DEFAULT '',
        city TEXT NULL,
        match_threshold INTEGER DEFAULT 75,
        email_notifications_enabled INTEGER DEFAULT 1,
        cv_analysis TEXT NULL
      )
    `);

    // 3. Create Processed Vacancies Cache Table
    await dbQuery.run(`
      CREATE TABLE IF NOT EXISTS processed_vacancies (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        external_id TEXT NOT NULL,
        status TEXT NOT NULL,
        scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reason TEXT NULL
      )
    `);

    // Index
    await dbQuery.run(`CREATE INDEX IF NOT EXISTS idx_proc_vac ON processed_vacancies (user_id, platform, external_id)`);

    // 4. Create Vacancy Matches Table
    await dbQuery.run(`
      CREATE TABLE IF NOT EXISTS vacancy_matches (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        url TEXT NOT NULL,
        description TEXT NOT NULL,
        score INTEGER NOT NULL,
        reasoning TEXT NOT NULL,
        cover_letter TEXT NOT NULL,
        applied INTEGER DEFAULT 0,
        notified_email INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ---- Migrations (idempotent for existing DBs) ----
    try {
      const userPrefCols = (await dbQuery.all(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'user_preferences'`
      )).map(r => r.column_name);

      if (userPrefCols.includes('extracted_keywords') && !userPrefCols.includes('extracted_specialization')) {
        await dbQuery.run(`ALTER TABLE user_preferences RENAME COLUMN extracted_keywords TO extracted_specialization`);
        console.log('DB Migration: Renamed user_preferences.extracted_keywords to extracted_specialization');
      }
    } catch (err) {
      console.error('DB Migration failure (rename user_preferences.extracted_keywords):', err.message);
      throw err;
    }

    try {
      const userPrefCols = (await dbQuery.all(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'user_preferences'`
      )).map(r => r.column_name);
      if (!userPrefCols.includes('cv_analysis')) {
        await dbQuery.run(`ALTER TABLE user_preferences ADD COLUMN cv_analysis TEXT NULL`);
        console.log('DB Migration: Added cv_analysis column to user_preferences');
      }
    } catch (err) {
      console.error('DB Migration failure (cv_analysis):', err.message);
      throw err;
    }

    try {
      const procVacCols = (await dbQuery.all(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'processed_vacancies'`
      )).map(r => r.column_name);
      if (!procVacCols.includes('reason')) {
        await dbQuery.run(`ALTER TABLE processed_vacancies ADD COLUMN reason TEXT NULL`);
        console.log('DB Migration: Added reason column to processed_vacancies');
      }
    } catch (err) {
      console.error('DB Migration failure (processed_vacancies.reason):', err.message);
      throw err;
    }

    try {
      const userCols = (await dbQuery.all(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`
      )).map(r => r.column_name);

      if (!userCols.includes('is_guest')) {
        await dbQuery.run(`ALTER TABLE users ADD COLUMN is_guest INTEGER DEFAULT 0`);
      }
      if (!userCols.includes('guest_expires_at')) {
        await dbQuery.run(`ALTER TABLE users ADD COLUMN guest_expires_at TIMESTAMP NULL`);
      }
      if (!userCols.includes('notified_sub_end')) {
        await dbQuery.run(`ALTER TABLE users ADD COLUMN notified_sub_end INTEGER DEFAULT 0`);
      }
      if (!userCols.includes('reset_token')) {
        await dbQuery.run(`ALTER TABLE users ADD COLUMN reset_token TEXT NULL`);
      }
      if (!userCols.includes('reset_token_expires_at')) {
        await dbQuery.run(`ALTER TABLE users ADD COLUMN reset_token_expires_at TIMESTAMP NULL`);
      }
      if (!userCols.includes('last_scanned_at')) {
        await dbQuery.run(`ALTER TABLE users ADD COLUMN last_scanned_at TIMESTAMP NULL`);
      }
      if (!userCols.includes('pending_payment_id')) {
        await dbQuery.run(`ALTER TABLE users ADD COLUMN pending_payment_id TEXT NULL`);
      }
      if (!userCols.includes('is_trial')) {
        await dbQuery.run(`ALTER TABLE users ADD COLUMN is_trial INTEGER DEFAULT 0`);
        console.log('DB Migration: Added is_trial column to users');
      }
    } catch (err) {
      console.error('DB Migration failure (users table columns):', err.message);
      throw err;
    }

    try {
      await dbQuery.run(`ALTER TABLE user_preferences ALTER COLUMN email_notifications_enabled SET DEFAULT 1`);
      console.log('DB Migration: Set user_preferences.email_notifications_enabled default to 1');
    } catch (err) {
      console.error('DB Migration failure (email_notifications_enabled default):', err.message);
      throw err;
    }
  };
}

module.exports = {
  dbQuery,
  initDb,
  db
};
