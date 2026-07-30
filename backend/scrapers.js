const { scrapeHh, fetchHhDetail } = require('./scrapers/hh');
const { scrapeHabr, fetchHabrDetail } = require('./scrapers/habr');
const { scrapeSuperjob } = require('./scrapers/superjob');
const config = require('./config');

// Global in-memory cache for parsed vacancy descriptions
const vacancyCache = new Map();

async function fetchAllVacancies(roleId, jobFormat, city) {
  // Execute all three scrapers concurrently
  const results = await Promise.allSettled([
    scrapeHh(roleId, jobFormat, city),
    scrapeHabr(roleId, jobFormat, city),
    scrapeSuperjob(roleId, jobFormat, city)
  ]);

  const merged = [];
  results.forEach((res) => {
    if (res.status === 'fulfilled') {
      merged.push(...res.value);
    } else {
      console.error('Scraper task error:', res.reason);
    }
  });

  return merged;
}

/**
 * Fetches the full description for a single vacancy stub.
 * Dispatches to the correct per-platform fetcher.
 * SuperJob stubs already contain full descriptions from the list API.
 * Uses a global in-memory cache to prevent redundant HTTP requests for overlapping stubs.
 *
 * @param {object} stub - Vacancy stub from fetchAllVacancies.
 * @returns {Promise<object>} Enriched vacancy object.
 */
async function fetchVacancyDetail(stub) {
  const cacheKey = `${stub.platform}:${stub.external_id}`;
  const cached = vacancyCache.get(cacheKey);
  const ttlMs = (config.vacancyCacheTtlMinutes || 120) * 60 * 1000;

  if (cached && (Date.now() - cached.timestamp < ttlMs)) {
    console.log(`[Cache Hit] Using cached description for ${stub.platform}:${stub.external_id}`);
    return { ...stub, description: cached.description };
  }

  let enriched;
  if (stub.platform === 'hh') {
    enriched = await fetchHhDetail(stub);
  } else if (stub.platform === 'habr') {
    enriched = await fetchHabrDetail(stub);
  } else {
    enriched = stub; // superjob: full description already in stub
  }

  // Cache description if fetched successfully
  if (enriched && enriched.description) {
    vacancyCache.set(cacheKey, {
      description: enriched.description,
      timestamp: Date.now()
    });

    // Enforce max size limit (evicts oldest entries first)
    const maxEntries = config.vacancyCacheMaxSize || 1000;
    if (vacancyCache.size > maxEntries) {
      const oldestKey = vacancyCache.keys().next().value;
      vacancyCache.delete(oldestKey);
    }
  }

  return enriched;
}

module.exports = {
  fetchAllVacancies,
  fetchVacancyDetail
};

