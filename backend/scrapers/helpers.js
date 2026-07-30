const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
};

// Transient error codes that are safe to retry
const RETRYABLE_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND',
  'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'EAI_AGAIN'
]);

/**
 * Runs an async function with exponential-backoff retry on transient network errors.
 *
 * @param {() => Promise<any>} fn         - The async function to run.
 * @param {object}             [opts]
 * @param {number}             [opts.attempts=3]    - Total attempts (including the first one).
 * @param {number}             [opts.baseDelayMs=1000] - Base delay in ms (doubles each retry).
 * @param {string}             [opts.label='']      - Label for log messages.
 * @returns {Promise<any>}
 */
async function withRetry(fn, { attempts = 3, baseDelayMs = 1000, label = '' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const code = err.code;
      const status = err.response?.status;
      const isRetryable =
        RETRYABLE_CODES.has(code) ||
        status === 429 ||
        (status >= 500 && status < 600);

      if (!isRetryable || attempt === attempts) {
        throw err;
      }

      // Honour Retry-After header for 429s, otherwise use exponential backoff
      let delayMs;
      if (status === 429 && err.response?.headers?.['retry-after']) {
        delayMs = parseInt(err.response.headers['retry-after'], 10) * 1000 || baseDelayMs;
      } else {
        delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      }

      const tag = label ? `[${label}] ` : '';
      console.warn(
        `${tag}Attempt ${attempt}/${attempts} failed (${code || status || err.message}). ` +
        `Retrying in ${delayMs}ms...`
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function cleanHtml(htmlText) {
  if (!htmlText) return '';
  const $ = cheerio.load(htmlText);
  $('p, li, br, div, h1, h2, h3, h4').each((_, el) => {
    $(el).after('\n');
  });
  let text = $.text();
  return text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
}

async function limitConcurrency(tasks, limit) {
  const results = [];
  const executing = new Set();
  for (const task of tasks) {
    const p = Promise.resolve()
      .then(() => task())
      .catch(err => {
        console.error('Concurrency task failure in scraper:', err.message);
        return null;
      });
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  const resolved = await Promise.all(results);
  return resolved.filter(Boolean);
}

/**
 * Logs a scraper request with timestamp, URL, and parameters.
 * 
 * @param {string} url - The request URL.
 * @param {object} [params] - The request parameters.
 */
function logScraperRequest(url, params = {}) {
  const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const paramsString = Object.keys(params).length > 0 
    ? ` | Params: ${JSON.stringify(params)}` 
    : '';
  console.log(`[${timestamp}] [SCRAPER_REQUEST] URL: ${url}${paramsString}`);
}

module.exports = {
  HEADERS,
  cleanHtml,
  limitConcurrency,
  withRetry,
  logScraperRequest
};
