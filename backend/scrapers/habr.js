const axios = require('axios');
const cheerio = require('cheerio');
const { HEADERS, cleanHtml, withRetry, logScraperRequest } = require('./helpers');

const habrLocationCache = {};

async function resolveHabrLocationId(cityName) {
  if (!cityName) return null;
  const cleanCity = cityName.trim();
  if (!cleanCity) return null;

  const cacheKey = cleanCity.toLowerCase();
  if (habrLocationCache[cacheKey] !== undefined) {
    return habrLocationCache[cacheKey];
  }

  try {
    const url = 'https://career.habr.com/api/frontend/suggestions/locations';
    logScraperRequest(url, { term: cleanCity });
    const response = await axios.get(url, {
      params: { term: cleanCity },
      headers: HEADERS,
      timeout: 5000
    });
    
    if (response.data && response.data.list && response.data.list.length > 0) {
      const match = response.data.list.find(
        item => item.title.toLowerCase() === cacheKey
      );
      const val = match ? match.value : response.data.list[0].value;
      habrLocationCache[cacheKey] = val;
      return val;
    }
  } catch (err) {
    console.error(`Failed to resolve Habr location ID for "${cleanCity}":`, err.message);
  }

  habrLocationCache[cacheKey] = null;
  return null;
}

async function scrapeHabrHtml(roleId, jobFormat, city) {
  const stubs = [];
  try {
    const mappings = require('../roles/role_mappings.json');
    const roleMapping = mappings[roleId] || {};
    const habrSpecs = roleMapping.habr || [];

    if (habrSpecs.length === 0) {
      console.log(`Habr Career HTML: Role ID "${roleId}" does not map to any Habr specializations. Skipping.`);
      return [];
    }

    const params = new URLSearchParams();
    params.append('sort', 'date');
    if (jobFormat === 'remote') {
      params.append('remote', 'true');
    }
    habrSpecs.forEach(specId => {
      params.append('s[]', specId);
    });

    if (city) {
      const locationId = await resolveHabrLocationId(city);
      if (locationId) {
        params.append('locations[]', locationId);
      }
    }

    const habrUrl = 'https://career.habr.com/vacancies';
    logScraperRequest(habrUrl, Object.fromEntries(params));
    const response = await withRetry(
      () => axios.get(habrUrl, {
        params,
        headers: HEADERS,
        timeout: 15000
      }),
      { attempts: 3, label: `Habr HTML:${roleId}` }
    );

    const $ = cheerio.load(response.data);
    const cards = $('.vacancy-card');

    cards.each((i, card) => {
      if (stubs.length >= 30) return;

      const titleLink = $(card).find('.vacancy-card__title-link');
      if (titleLink.length === 0) return;

      const title = titleLink.text().trim();
      const href = titleLink.attr('href');
      const url = `https://career.habr.com${href}`;

      const idMatch = href.match(/\/vacancies\/(\d+)/);
      const external_id = idMatch ? idMatch[1] : url;

      const company = $(card).find('.vacancy-card__company a.link-comp').first().text().trim() || 'Unknown Company';
      const meta = $(card).find('.vacancy-card__meta').text().trim();

      if ((jobFormat === 'onsite' || jobFormat === 'hybrid') && city) {
        if (!meta.toLowerCase().includes(city.toLowerCase())) {
          return;
        }
      }

      stubs.push({
        external_id,
        platform: 'habr',
        title,
        company,
        url,
        description: meta  // card meta snippet; full description fetched on demand
      });
    });

    return stubs;
  } catch (e) {
    console.error(`Error scraping Habr Career HTML for role ID "${roleId}":`, e.message);
    return stubs;
  }
}

async function scrapeHabrRss(roleId, jobFormat, city) {
  const stubs = [];
  try {
    const mappings = require('../roles/role_mappings.json');
    const roleMapping = mappings[roleId] || {};
    const habrSpecs = roleMapping.habr || [];

    if (habrSpecs.length === 0) {
      console.log(`Habr Career RSS: Role ID "${roleId}" does not map to any Habr specializations. Skipping.`);
      return [];
    }

    const params = new URLSearchParams();
    params.append('sort', 'date');
    params.append('currency', 'RUR');
    if (jobFormat === 'remote') {
      params.append('remote', 'true');
    }
    habrSpecs.forEach(specId => {
      params.append('s[]', specId);
    });

    if (city) {
      const locationId = await resolveHabrLocationId(city);
      if (locationId) {
        params.append('locations[]', locationId);
      }
    }

    const habrRssUrl = 'https://career.habr.com/vacancies/rss';
    logScraperRequest(habrRssUrl, Object.fromEntries(params));
    const response = await withRetry(
      () => axios.get(habrRssUrl, {
        params,
        headers: HEADERS,
        timeout: 15000
      }),
      { attempts: 3, label: `Habr RSS:${roleId}` }
    );

    const $ = cheerio.load(response.data, { xmlMode: true });
    const items = $('item');

    items.each((i, el) => {
      if (stubs.length >= 30) return;

      const rawTitle = $(el).find('title').text().trim();
      const url = $(el).find('link').text().trim() || $(el).find('guid').text().trim();
      const external_id = $(el).find('guid').text().trim() || url;
      const company = $(el).find('author').text().trim() || 'Unknown Company';
      const rssDesc = cleanHtml($(el).find('description').text());

      let title = rawTitle;
      const titleMatch = rawTitle.match(/Требуется «(.+?)»/);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }

      const lowerDesc = rssDesc.toLowerCase();
      if (jobFormat === 'remote') {
        const isRemote =
          lowerDesc.includes('удалённо') ||
          lowerDesc.includes('удаленно') ||
          lowerDesc.includes('remote');
        if (!isRemote) return;
      }

      if ((jobFormat === 'onsite' || jobFormat === 'hybrid') && city) {
        const hasCity =
          lowerDesc.includes(city.toLowerCase()) ||
          title.toLowerCase().includes(city.toLowerCase());
        if (!hasCity) return;
      }

      stubs.push({
        external_id,
        platform: 'habr',
        title,
        company,
        url,
        description: rssDesc  // RSS snippet; full description fetched on demand
      });
    });

    console.log(`Habr Career RSS: found ${stubs.length} vacancy stubs for role ID "${roleId}" (format: ${jobFormat})`);
    return stubs;
  } catch (e) {
    console.error(`Error scraping Habr Career RSS for role ID "${roleId}":`, e.message);
    throw e;
  }
}

/**
 * Fetches the full vacancy description from the Habr Career detail page.
 * Works for both HTML-scraped and RSS-sourced stubs.
 * Falls back to the snippet already in the stub if the request fails.
 *
 * @param {object} stub - Vacancy stub returned by scrapeHabrHtml or scrapeHabrRss.
 * @returns {Promise<object>} Vacancy object with enriched description.
 */
async function fetchHabrDetail(stub) {
  try {
    logScraperRequest(stub.url);
    const detailResp = await withRetry(
      () => axios.get(stub.url, { headers: HEADERS, timeout: 10000 }),
      { attempts: 2, label: `Habr detail:${stub.external_id}` }
    );
    const $d = cheerio.load(detailResp.data);
    let descBlock = $d('.style-ugc');
    if (descBlock.length === 0) {
      descBlock = $d('.vacancy-description__text');
    }
    if (descBlock.length === 0) {
      descBlock = $d('.style-html');
    }
    if (descBlock.length > 0) {
      return { ...stub, description: cleanHtml(descBlock.html()) };
    }
  } catch (ex) {
    // Use snippet already in stub as fallback
  }
  return stub;
}

async function scrapeHabr(roleId, jobFormat, city) {
  const formats = (jobFormat || 'remote,onsite,hybrid').split(',').map(f => f.trim().toLowerCase());
  const allVacancies = [];

  for (const fmt of formats) {
    const activeCity = fmt === 'remote' ? '' : city;
    let vacancies = [];
    let rssSuccess = false;

    try {
      console.log(`Habr Career: Attempting RSS scraping for role ID "${roleId}" (format: ${fmt})...`);
      vacancies = await scrapeHabrRss(roleId, fmt, activeCity);
      rssSuccess = true;
    } catch (err) {
      console.warn(`Habr Career RSS scraping failed for format "${fmt}":`, err.message);
    }

    if (!rssSuccess || vacancies.length === 0) {
      console.log(`Habr Career RSS failed or returned 0 vacancies for format "${fmt}". Falling back to HTML...`);
      try {
        vacancies = await scrapeHabrHtml(roleId, fmt, activeCity);
      } catch (htmlErr) {
        console.error(`Habr Career HTML fallback failed for format "${fmt}":`, htmlErr.message);
      }
    }

    allVacancies.push(...vacancies);
  }

  // Deduplicate by external_id
  const seen = new Set();
  return allVacancies.filter(v => {
    if (seen.has(v.external_id)) return false;
    seen.add(v.external_id);
    return true;
  });
}

module.exports = {
  scrapeHabr,
  fetchHabrDetail
};

