const { dbQuery } = require('./db');
const { fetchAllVacancies, fetchVacancyDetail } = require('./scrapers');
const { evaluateMatch } = require('./matcher');
const { sendMatchNotification, sendBillingWarning } = require('./notifications');
const { limitConcurrency } = require('./scrapers/helpers');
const config = require('./config');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const activeScans = new Set();

function isUserScanning(userId) {
  return activeScans.has(userId);
}

async function checkUserVacancies(user) {
  if (activeScans.has(user.id)) {
    console.log(`Scan already in progress for user ${user.email}. Skipping.`);
    return;
  }
  activeScans.add(user.id);
  try {
    let matchesCount = 0;
    if (user.is_guest) {
      const matchCount = await dbQuery.get('SELECT COUNT(*) as count FROM vacancy_matches WHERE user_id = ?', [user.id]);
      matchesCount = matchCount ? matchCount.count : 0;
      if (matchesCount >= 3) {
        console.log(`Skipping guest user ${user.email}: Already found 3 matches.`);
        return;
      }
    }

    const pref = await dbQuery.get('SELECT * FROM user_preferences WHERE user_id = ?', [user.id]);
    if (!pref || !pref.cv_text || !pref.extracted_specialization) {
      console.log(`Skipping user ${user.email}: CV or role ID not configured.`);
      return;
    }
    const roleId = pref.extracted_specialization.trim();
    if (!roleId) {
      console.log(`Skipping user ${user.email}: Empty search role ID.`);
      return;
    }

    console.log(`Scanning vacancies for ${user.email} with role ID: '${roleId}'...`);
    
    try {
      const vacancies = await fetchAllVacancies(roleId, pref.job_format, pref.city);
      console.log(`Found ${vacancies.length} raw vacancies for ${user.email} using role ID '${roleId}'`);

      if (vacancies.length > 0) {
        // Batch Duplicate Check
        const extIds = vacancies.map(v => v.external_id).filter(Boolean);
        const processedKeys = new Set();
        if (extIds.length > 0) {
          const placeholders = extIds.map(() => '?').join(',');
          const rows = await dbQuery.all(
            `SELECT platform, external_id FROM processed_vacancies WHERE user_id = ? AND external_id IN (${placeholders})`,
            [user.id, ...extIds]
          );
          rows.forEach(r => {
            processedKeys.add(`${r.platform}:${r.external_id}`);
          });
        }

        const unprocessedStubs = vacancies.filter(v => !processedKeys.has(`${v.platform}:${v.external_id}`));
        console.log(`Of which ${unprocessedStubs.length} are new/unprocessed for ${user.email}`);

        if (unprocessedStubs.length > 0) {
          // Phase 2: Fetch full descriptions only for unprocessed vacancies
          console.log(`Fetching full descriptions for ${unprocessedStubs.length} new vacancies...`);
          const detailTasks = unprocessedStubs.map(stub => () => fetchVacancyDetail(stub));
          const enrichedVacancies = await limitConcurrency(detailTasks, 3);

          // Define match evaluation tasks
          const tasks = enrichedVacancies.map(vacancy => async () => {
            if (user.is_guest && matchesCount >= 3) {
              return;
            }

            const extId = vacancy.external_id;
            const platform = vacancy.platform;

            console.log(`Processing new vacancy: '${vacancy.title}' at '${vacancy.company}' (${platform})`);

            try {
              if (user.is_guest && matchesCount >= 3) {
                return;
              }

              // LLM Match Evaluation (concurrently run)
              const { score, reasoning } = await evaluateMatch(pref.cv_text, vacancy);

              let statusLog = 'rejected';
              if (score >= pref.match_threshold) {
                if (user.is_guest && matchesCount >= 3) {
                  console.log(`Guest user ${user.email} match count reached 3. Skipping saving match.`);
                  return;
                }
                if (user.is_guest) {
                  matchesCount++;
                }

                console.log(`🎯 Match found for ${user.email}! Score: ${score}%. Saving...`);
                
                // Save match (empty cover letter initially, generated on-demand)
                const insertResult = await dbQuery.run(
                  `INSERT INTO vacancy_matches (user_id, title, company, url, description, score, reasoning, cover_letter) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, '')`,
                  [user.id, vacancy.title, vacancy.company, vacancy.url, vacancy.description, score, reasoning]
                );

                const matchId = insertResult.id;

                // Send Email if enabled (non-blocking) — skip for guests
                if (pref.email_notifications_enabled && !user.is_guest) {
                  sendMatchNotification(user.email, user.id, {
                    id: matchId,
                    title: vacancy.title,
                    company: vacancy.company,
                    url: vacancy.url,
                    score,
                    reasoning
                  }).catch(emailErr => {
                    console.error(`Failed to send email notification for match ${matchId} to ${user.email}:`, emailErr.message);
                  });
                }

                statusLog = 'matched';
              } else {
                console.log(`Vacancy '${vacancy.title}' score ${score}% did not meet threshold ${pref.match_threshold}%`);
              }

              // Save to cache
              await dbQuery.run(
                'INSERT INTO processed_vacancies (user_id, platform, external_id, status, reason) VALUES (?, ?, ?, ?, ?)',
                [user.id, platform, extId, statusLog, statusLog === 'matched' ? null : (reasoning || null)]
              );

            } catch (matchErr) {
              console.error(`Failed matching vacancy ${extId} for ${user.email}:`, matchErr.message);
            }
          });

          // Run batch matching tasks with concurrency limit of 3
          await limitConcurrency(tasks, 3);
        }
      }
    } catch (scrapeErr) {
      console.error(`Scrape failure for ${user.email} role ID '${roleId}':`, scrapeErr.message);
    }
  } finally {
    activeScans.delete(user.id);
    try {
      await dbQuery.run(
        'UPDATE users SET last_scanned_at = CURRENT_TIMESTAMP WHERE id = ?',
        [user.id]
      );
    } catch (err) {
      console.error(`Failed to update last_scanned_at for ${user.email}:`, err.message);
    }
  }
}

async function checkBillingExpirations() {
  // Subscription Warning: 24h before subscription expiration (real users only)
  const subUsers = await dbQuery.all(
    `SELECT id, email, subscription_ends_at, is_trial FROM users 
     WHERE is_guest = 0
       AND subscription_ends_at IS NOT NULL 
       AND notified_sub_end = 0 
       AND subscription_ends_at > datetime('now') 
       AND subscription_ends_at <= datetime('now', '+1 day')`
  );

  for (const user of subUsers) {
    const warningType = user.is_trial ? 'trial' : 'subscription';
    console.log(`Sending ${warningType} warning to ${user.email}...`);
    const sent = await sendBillingWarning(user.email, warningType, 1);
    if (sent) {
      await dbQuery.run('UPDATE users SET notified_sub_end = 1 WHERE id = ?', [user.id]);
    }
  }
}

async function cleanupExpiredGuests() {
  const result = await dbQuery.run(
    `DELETE FROM users WHERE is_guest = 1 AND guest_expires_at IS NOT NULL AND guest_expires_at < datetime('now')`
  );
  if (result.changes > 0) {
    console.log(`Cleaned up ${result.changes} expired guest account(s).`);
  }
}

let isRunning = false;
async function runWorkerCycle() {
  if (isRunning) return;
  isRunning = true;
  console.log('Background job scanning cycle started...');

  try {
    // Filter active users (subscription active, real users only)
    const activeUsers = await dbQuery.all(
      `SELECT id, email, created_at, subscription_ends_at, notified_sub_end, is_guest FROM users 
       WHERE subscription_ends_at IS NOT NULL AND subscription_ends_at > datetime('now') AND is_guest = 0`
    );

    console.log(`Scanning vacancies for ${activeUsers.length} active users...`);
    for (const user of activeUsers) {
      try {
        await checkUserVacancies(user);
      } catch (userErr) {
        console.error(`Failed job scanning for ${user.email}:`, userErr.message);
      }
    }

    // Run expiration checks
    try {
      await checkBillingExpirations();
    } catch (billErr) {
      console.error('Failed checking billing expirations:', billErr.message);
    }

    // Clean up expired guest accounts
    try {
      await cleanupExpiredGuests();
    } catch (guestErr) {
      console.error('Failed cleaning up guest accounts:', guestErr.message);
    }

  } catch (cycleErr) {
    console.error('Error in worker cycle main logic:', cycleErr.message);
  } finally {
    isRunning = false;
    console.log(`Worker cycle complete. Next run in ${config.scanIntervalMinutes} minutes.`);
  }
}

function startWorker() {
  console.log('HH4YOU periodic background worker initialized.');
  // Run once immediately on start
  runWorkerCycle();
  // Set interval
  setInterval(runWorkerCycle, config.scanIntervalMinutes * 60 * 1000);
}

module.exports = {
  startWorker,
  checkUserVacancies,
  isUserScanning
};
