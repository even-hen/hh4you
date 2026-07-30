const axios = require('axios');
const cheerio = require('cheerio');
const { HEADERS, cleanHtml, withRetry, logScraperRequest } = require('./helpers');

const HH_BASE_URL = 'https://hh.ru';
const HH_API_URL = 'https://api.hh.ru';

/**
 * Resolve a city name to an HH.ru area ID using the public suggests API.
 * No authentication required.
 */
async function getHhAreaId(cityName) {
  try {
    const url = `${HH_API_URL}/suggests/areas?text=${encodeURIComponent(cityName)}`;
    logScraperRequest(url, { cityName });
    const response = await withRetry(
      () => axios.get(url, { headers: HEADERS, timeout: 10000 }),
      { attempts: 2, label: `HH area:${cityName}` }
    );
    const items = response.data.items || [];
    if (items.length > 0) {
      return items[0].id;
    }
  } catch (e) {
    console.error(`Error resolving HH area for "${cityName}":`, e.message);
  }
  return null;
}

async function scrapeHhRss(roleId, jobFormat, city) {
  const stubs = [];
  try {
    const params = {
      search_period: 1,
      order_by: 'publication_time',
      professional_role: roleId
    };

    if ((jobFormat === 'onsite' || jobFormat === 'hybrid') && city) {
      const areaId = await getHhAreaId(city);
      if (areaId) {
        params.area = areaId;
      }
    }

    if (jobFormat === 'remote') {
      params.work_format = 'REMOTE';
    } else if (jobFormat === 'onsite') {
      params.work_format = 'OFFICE';
    } else if (jobFormat === 'hybrid') {
      params.work_format = 'HYBRID';
    }

    const rssUrl = `${HH_BASE_URL}/search/vacancy/rss`;
    logScraperRequest(rssUrl, params);
    const response = await withRetry(
      () => axios.get(rssUrl, {
        params,
        headers: HEADERS,
        timeout: 15000
      }),
      { attempts: 3, label: `HH RSS:${roleId}` }
    );

    const $ = cheerio.load(response.data, { xmlMode: true });
    const items = $('item');

    items.each((i, el) => {
      if (stubs.length >= 30) return;

      const title = $(el).find('title').text().trim();
      const url = $(el).find('link').text().trim() || $(el).find('guid').text().trim();
      if (!title || !url) return;

      const idMatch = url.match(/\/vacancy\/(\d+)/);
      const external_id = idMatch ? idMatch[1] : url;

      const rssDesc = cleanHtml($(el).find('description').text());

      // Extract company name from the structured RSS description text
      const companyMatch = rssDesc.match(/Вакансия компании:\s*(.+?)(?=\s+Создана:|$)/);
      const company = companyMatch ? companyMatch[1].trim() : 'Unknown Company';

      if ((jobFormat === 'onsite' || jobFormat === 'hybrid') && city) {
        if (!rssDesc.toLowerCase().includes(city.toLowerCase())) return;
      }

      stubs.push({
        external_id,
        platform: 'hh',
        title,
        company,
        url,
        description: rssDesc  // RSS snippet; full description fetched on demand
      });
    });

    console.log(`HH.ru RSS: found ${stubs.length} vacancy stubs for role ID "${roleId}" (format: ${jobFormat})`);
    return stubs;
  } catch (e) {
    console.error(`Error scraping HH RSS for role ID "${roleId}" (format: ${jobFormat}):`, e.message);
    return stubs;
  }
}

/**
 * Fetches the full vacancy description from the HH.ru detail page.
 * Falls back to the RSS snippet already in the stub if the request fails.
 *
 * @param {object} stub - Vacancy stub returned by scrapeHhRss.
 * @returns {Promise<object>} Vacancy object with enriched description.
 */
async function fetchHhDetail(stub) {
  try {
    logScraperRequest(stub.url);
    const detailResp = await withRetry(
      () => axios.get(stub.url, { headers: HEADERS, timeout: 10000 }),
      { attempts: 2, label: `HH detail:${stub.external_id}` }
    );
    const $d = cheerio.load(detailResp.data);
    const descBlock = $d('[data-qa="vacancy-description"]');
    if (descBlock.length > 0) {
      return { ...stub, description: cleanHtml(descBlock.html()) };
    }
  } catch (ex) {
    // Use RSS snippet already in stub as fallback
  }
  return stub;
}

async function scrapeHh(roleId, jobFormat, city) {
  const formats = (jobFormat || 'remote,onsite,hybrid').split(',').map(f => f.trim().toLowerCase());
  const allVacancies = [];

  for (const fmt of formats) {
    const activeCity = fmt === 'remote' ? '' : city;
    try {
      const vacancies = await scrapeHhRss(roleId, fmt, activeCity);
      allVacancies.push(...vacancies);
    } catch (err) {
      console.error(`HH RSS scraper failed for format "${fmt}":`, err.message);
    }
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
  scrapeHh,
  fetchHhDetail,
  getHhAreaId
};
