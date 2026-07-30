const axios = require('axios');
const config = require('../config');
const { cleanHtml, withRetry, logScraperRequest } = require('./helpers');

async function getSuperjobTownId(cityName) {
  try {
    const headers = { 'Accept': 'application/json' };
    if (config.superjobApiKey) {
      headers['X-Api-App-Id'] = config.superjobApiKey;
    }
    const url = `https://api.superjob.ru/2.0/towns/?keyword=${encodeURIComponent(cityName)}`;
    logScraperRequest(url, { cityName });
    const response = await withRetry(
      () => axios.get(url, { headers, timeout: 10000 }),
      { attempts: 2, label: `SJ town:${cityName}` }
    );
    const objects = response.data.objects || [];
    if (objects.length > 0) {
      return objects[0].id;
    }
  } catch (e) {
    console.error(`Error resolving SuperJob town for "${cityName}":`, e.message);
  }
  return null;
}

async function scrapeSuperjobSingle(roleId, jobFormat, city) {
  const vacancies = [];
  try {
    const mappings = require('../roles/role_mappings.json');
    const roleMapping = mappings[roleId] || {};
    const sjCatalogues = roleMapping.sj || [];

    if (sjCatalogues.length === 0) {
      console.log(`SuperJob API: Role ID "${roleId}" does not map to any SuperJob categories. Skipping.`);
      return [];
    }

    const headers = { 'Accept': 'application/json' };
    if (config.superjobApiKey) {
      headers['X-Api-App-Id'] = config.superjobApiKey;
    }

    const params = {
      period: 1,
      count: 30
    };

    params.catalogues = sjCatalogues;

    if (jobFormat === 'remote') {
      params.place_of_work = 2;
    } else if (jobFormat === 'onsite') {
      params.place_of_work = 1;
    } else if (jobFormat === 'hybrid') {
      params.place_of_work = 1;
    }

    if ((jobFormat === 'onsite' || jobFormat === 'hybrid') && city) {
      const townId = await getSuperjobTownId(city);
      if (townId) {
        params.town = townId;
      }
    }

    const url = 'https://api.superjob.ru/2.0/vacancies/';
    logScraperRequest(url, params);
    const response = await withRetry(
      () => axios.get(url, {
        params,
        headers,
        timeout: 15000
      }),
      { attempts: 3, label: `SJ API:${roleId}` }
    );

    const items = response.data.objects || [];
    const filteredItems = items.filter((item) => {
      const placeOfWorkId = item.place_of_work ? item.place_of_work.id : 0;
      if (jobFormat === 'remote') {
        // Remote: remote (2), doesn't matter (0), or traveling (3)
        return placeOfWorkId === 2 || placeOfWorkId === 0 || placeOfWorkId === 3;
      } else if (jobFormat === 'onsite') {
        // Onsite: office (1) only
        return placeOfWorkId === 1;
      } else if (jobFormat === 'hybrid') {
        // Hybrid: office (1), doesn't matter (0), or traveling (3)
        return placeOfWorkId === 1 || placeOfWorkId === 0 || placeOfWorkId === 3;
      }
      return true;
    });

    filteredItems.forEach((item) => {
      const external_id = String(item.id);
      const title = item.profession;
      const company = item.firm_name || 'Unknown Company';
      const url = item.link;

      const rawDesc = [item.work, item.candidat, item.compensation]
        .filter(Boolean)
        .join('\n\n');
      const description = cleanHtml(rawDesc) || 'No description available.';

      vacancies.push({
        external_id,
        platform: 'superjob',
        title,
        company,
        url,
        description
      });
    });

    console.log(`SuperJob API: fetched ${vacancies.length} vacancies for role ID "${roleId}" (format: ${jobFormat})`);
    return vacancies;
  } catch (e) {
    console.error(`Error scraping SuperJob API for role ID "${roleId}" (format: ${jobFormat}):`, e.message);
    return vacancies;
  }
}

async function scrapeSuperjob(roleId, jobFormat, city) {
  const formats = (jobFormat || 'remote,onsite,hybrid').split(',').map(f => f.trim().toLowerCase());
  const allVacancies = [];

  for (const fmt of formats) {
    const activeCity = fmt === 'remote' ? '' : city;
    try {
      const vacancies = await scrapeSuperjobSingle(roleId, fmt, activeCity);
      allVacancies.push(...vacancies);
    } catch (err) {
      console.error(`SuperJob scraper failed for format "${fmt}":`, err.message);
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
  scrapeSuperjob
};