const axios = require('axios');
const config = require('./config');

let httpsAgent = null;
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrl) {
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    httpsAgent = new HttpsProxyAgent(proxyUrl);
    console.log(`[LLM_PROXY] Configured HttpsProxyAgent with proxy: ${proxyUrl}`);
  } catch (e) {
    console.warn(`[LLM_PROXY] Found proxy env var (${proxyUrl}) but 'https-proxy-agent' package is not installed. Outbound requests will not use proxy.`);
  }
}

let gigaChatToken = null;
let gigaChatTokenExpiresAt = 0;
let gigaChatTokenPromise = null;
let gigaChatQueue = Promise.resolve();

async function getGigaChatToken() {
  if (gigaChatToken && Date.now() < gigaChatTokenExpiresAt - 60000) {
    return gigaChatToken;
  }
  if (gigaChatTokenPromise) {
    return gigaChatTokenPromise;
  }

  const https = require('https');
  const { v4: uuidv4 } = require('uuid');
  const agent = new https.Agent({ rejectUnauthorized: false });

  gigaChatTokenPromise = (async () => {
    try {
      console.log('[GigaChat] Fetching access token...');
      const response = await axios.post(
        'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
        'scope=GIGACHAT_API_PERS',
        {
          headers: {
            'Authorization': `Basic ${config.llmApiKey}`,
            'RqUID': uuidv4(),
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          httpsAgent: agent
        }
      );
      gigaChatToken = response.data.access_token;
      gigaChatTokenExpiresAt = response.data.expires_at;
      console.log('[GigaChat] Access token refreshed successfully.');
      return gigaChatToken;
    } catch (err) {
      console.error('[GigaChat] Failed to fetch access token:', err.response ? err.response.data : err.message);
      throw err;
    } finally {
      gigaChatTokenPromise = null;
    }
  })();

  return gigaChatTokenPromise;
}

async function callLlm(messages, responseFormat = null) {
  if (process.env.NODE_ENV === 'test') {
    const promptStr = JSON.stringify(messages);
    if (promptStr.includes('professional role ID') || promptStr.includes('ID профессиональной роли')) {
      if (promptStr.includes('деньги деньги деньги')) return 'INVALID';
      return '96';
    }
    if (promptStr.includes('cover letter') || promptStr.includes('сопроводительное письмо')) return 'Mocked cover letter.';
    if (promptStr.includes('Compatibility Match Score') || promptStr.includes('Score out of 100') || promptStr.includes('совместимости')) return JSON.stringify({score: 85, reasoning: 'Mocked reasoning'});
    if (promptStr.includes('Provide a concise professional summary') || promptStr.includes('карьерный консультант')) return 'Mocked CV analysis.';
    return 'Mocked response';
  }

  if (!config.llmApiKey) {
    console.warn('LLM_API_KEY is not configured. Skipping LLM call.');
    return '';
  }

  const isGigaChat = config.llmBaseUrl && config.llmBaseUrl.includes('giga.chat');

  const executeCall = async () => {
    let token = config.llmApiKey;
    let activeHttpsAgent = httpsAgent;

    if (isGigaChat) {
      try {
        token = await getGigaChatToken();
      } catch (tokenErr) {
        console.error(`Failed to get GigaChat OAuth token: ${tokenErr.message}`);
        return '';
      }
      const https = require('https');
      activeHttpsAgent = new https.Agent({ rejectUnauthorized: false });
    }

    const url = `${config.llmBaseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': config.baseUrl || 'http://localhost:8000',
      'X-Title': 'HH4YOU'
    };

    const payload = {
      model: config.llmModelName,
      messages: messages,
      temperature: 0.2
    };

    if (responseFormat) {
      payload.response_format = responseFormat;
    }

    const axiosConfig = { headers, timeout: 35000 };
    if (activeHttpsAgent) {
      axiosConfig.httpsAgent = activeHttpsAgent;
      axiosConfig.proxy = false;
    }

    let attempts = 0;
    const maxAttempts = 5;
    let delayMs = 2000;

    while (attempts < maxAttempts) {
      try {
        const response = await axios.post(url, payload, axiosConfig);
        if (response.status === 200) {
          return response.data.choices[0].message.content.trim();
        } else {
          console.error(`LLM completion failed with status ${response.status}:`, response.data);
          return '';
        }
      } catch (e) {
        const isRateLimit = e.response && (e.response.status === 429 || (e.response.data && e.response.data.status === 429));
        if (isRateLimit && attempts < maxAttempts - 1) {
          attempts++;
          console.warn(`[LLM_RATE_LIMIT] Received 429 from LLM API. Retrying in ${delayMs}ms (Attempt ${attempts}/${maxAttempts})...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          delayMs *= 2; // exponential backoff
          continue;
        }

        let errorDetails = '';
        if (e.response && e.response.data) {
          errorDetails = ` | Response: ${JSON.stringify(e.response.data)}`;
        } else if (e.code) {
          errorDetails = ` | Code: ${e.code}`;
        }
        console.error(`Failed to communicate with LLM API: ${e.message}${errorDetails}`);
        break;
      }
    }
    return '';
  };

  if (isGigaChat) {
    const promise = gigaChatQueue.then(() => executeCall());
    gigaChatQueue = promise.catch(() => {});
    return promise;
  }

  return executeCall();
}

async function extractSpecializationFromCv(cvText) {
  if (!cvText) return '';

  const fs = require('fs');
  const path = require('path');
  const hhRoles = JSON.parse(fs.readFileSync(path.join(__dirname, 'roles', 'hh.json'), 'utf8'));

  const rolesListString = Object.entries(hhRoles)
    .map(([id, name]) => `- ID: "${id}", Название: "${name}"`)
    .join('\n');

  const messages = [
    {
      role: 'system',
      content: 'Ты — профессиональный ассистент по подбору персонала. Твоя задача — проанализировать резюме кандидата и выбрать один наиболее подходящий ID профессиональной роли с сайта HH.ru из списка ниже.\n\n' +
        'Список доступных ролей:\n' + rolesListString + '\n\n' +
        'Выведи ТОЛЬКО выбранный ID роли (просто число). Не пиши никакого вступления, кавычек или объяснений. Выведи ТОЛЬКО числовой ID.\n' +
        'КРИТИЧЕСКИ ВАЖНО: Если предоставленный текст резюме некорректен, содержит бессмысленный набор символов, случайный текст или не является содержательным профессиональным резюме (в котором должны быть реальный профессиональный опыт, навыки, образование или история работы), ответь ровно одним словом «INVALID».'
    },
    {
      role: 'user',
      content: `Проанализируй это резюме и выбери наиболее подходящий ID профессиональной роли:\n\n${cvText}`
    }
  ];

  const result = await module.exports.callLlm(messages);
  if (result) {
    const cleanResult = result.replace(/['"]/g, '').trim();
    if (cleanResult.toUpperCase() === 'INVALID') {
      throw new Error('INVALID_CV');
    }
    // Verify that the ID is valid
    if (hhRoles[cleanResult]) {
      return cleanResult;
    }
    // Fallback search by ID or name
    const foundId = Object.keys(hhRoles).find(id => id === cleanResult || hhRoles[id].toLowerCase() === cleanResult.toLowerCase());
    if (foundId) {
      return foundId;
    }
  }
  throw new Error('LLM did not return a valid professional role ID');
}

async function evaluateMatch(cvText, vacancy) {
  const title = vacancy.title || '';
  const company = vacancy.company || '';
  const description = vacancy.description || '';

  const messages = [
    {
      role: 'system',
      content: 'Ты — эксперт-ассистент по подбору персонала и ведущий технический рекрутер. Твоя задача — проанализировать предоставленное резюме кандидата на соответствие описанию вакансии и рассчитать окончательный показатель совместимости (Compatibility Match Score) по шкале от 0 до 100.\n' +
        'Эта оценка должна быть объективной, аналитической и основываться строго на фактах из предоставленного текста.\n\n' +
        'Сначала проанализируй описание вакансии, чтобы выявить и извлечь следующие компоненты:\n' +
        '1. Базовые требования (общие требования, стек технологий, продолжительность опыта работы и т.д.)\n' +
        '2. Обязательные требования (критические требования, явно обозначенные как обязательные/требуемые/необходимые)\n' +
        '3. Желательные требования (предпочтительные навыки, бонусы, дополнительный опыт)\n' +
        '4. Обязанности (ключевые задачи, ежедневная работа, сфера ответственности)\n\n' +
        'Затем сопоставь резюме кандидата с этими выявленными элементами и рассчитать оценку совместимости по следующим правилам:\n' +
        '- Базовая оценка начинается со 100 баллов.\n' +
        '- Оценка базовых требований: вычти баллы пропорционально доле отсутствующих базовых требований. Максимальный вычет — до 40 баллов (например, если отсутствуют 2 из 4 базовых требований (50%), вычти 20 баллов).\n' +
        '- Оценка обязательных требований: вычти баллы пропорционально доле отсутствующих обязательных требований. Максимальный вычет — до 30 баллов (например, если отсутствует 1 из 2 обязательных требований (50%), вычти 15 баллов). Если обязательные требования не указаны, баллы не вычитаются.\n' +
        '- Оценка желательных требований: добавь бонусные баллы пропорционально доле соответствующих желательных требований. Максимальная прибавка — до 10 баллов (например, если соответствует 1 из 2 желательных требований (50%), добавь +5 баллов). Если желательные требования не указаны, баллы не добавляются.\n' +
        '- Оценка соответствия обязанностей: сравни прошлые обязанности кандидата в его резюме с обязанностями вакансии. Вычти баллы пропорционально доле обязанностей вакансии, которые отсутствуют в опыте кандидата или не отражены в его резюме. Максимальный вычет — до 20 баллов. Если обязанности не указаны, баллы не вычитаются.\n' +
        '- Ограничение по обязательным требованиям: если какое-либо обязательное требование, указанное в вакансии, полностью отсутствует в резюме кандидата, итоговая оценка не может превышать 80 баллов.\n' +
        '- Итоговая оценка должна быть строго от 0 до 100 (максимум 100, минимум 0).\n' +
        '- Будь точен и честен. Не завышай и не занижай оценки.\n\n' +
        'Также напиши краткое объяснение (2-3 предложения на русском языке), выделяя ключевые совпадающие навыки, плюсы, минусы кандидата и четко указывая любые отсутствующие или несоответствующие требования.\n\n' +
        'Верни ТОЛЬКО валидный JSON-объект, соответствующий этой схеме:\n' +
        '{\n' +
        '  "score": 80,\n' +
        '  "reasoning": "Объяснение..."\n' +
        '}\n' +
        'Не пиши никаких блоков разметки markdown (таких как ```json), вступлений или пояснений вне JSON-объекта.'
    },
    {
      role: 'user',
      content: `Резюме кандидата:\n${cvText}\n\n` +
        `Название вакансии: ${title}\n` +
        `Компания: ${company}\n` +
        `Описание вакансии:\n${description}`
    }
  ];

  const responseFormat = config.llmModelName.toLowerCase().includes('gpt') ? { type: 'json_object' } : null;
  const responseText = await module.exports.callLlm(messages, responseFormat);

  if (!responseText) {
    throw new Error('LLM API connection failed during match evaluation');
  }

  let score = 0;
  let reasoning = 'LLM matching failed or was not configured.';

  try {
    let cleanText = responseText.trim();
    // Strip markdown wrapper if present
    if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```(?:json)?\n/, '');
      cleanText = cleanText.replace(/\n```$/, '');
    }

    const data = JSON.parse(cleanText);
    score = parseInt(data.score) || 0;
    reasoning = data.reasoning || 'No details provided.';
  } catch (e) {
    console.error(`Error parsing LLM response '${responseText}':`, e.message);
    reasoning = 'Failed to parse matching score response.';
  }

  return { score, reasoning };
}

async function generateCoverLetter(cvText, vacancy) {
  const title = vacancy.title || '';
  const company = vacancy.company || '';
  const description = vacancy.description || '';

  const messages = [
    {
      role: 'system',
      content: 'Ты — профессиональный карьерный консультант и опытный технический писатель. Твоя задача — написать сопроводительное письмо на русском языке с высокой конверсией для кандидата.\n' +
        'Письмо должно быть кратким, не больше 500 символов и соответствовать следующим правилам:\n' +
        '1. НЕ пересказывай резюме: не перечисляй навыки, технологии или опыт работы, которые уже явно видны в резюме. Пересказ тратит внимание рекрутера.\n' +
        '2. Начни с приветствия.\n' +
        '3. В чем уникальность: объясни, как уникальный взгляд кандидата, его увлеченность делом или конкретный опыт помогут решить главную задачу на этой позиции.\n' +
        '4. Тон и стиль: уверенный, профессиональный, но написанный живым, естественным языком. Избегай шаблонных фраз, канцеляризмов, избитых корпоративных штампов и сухих шаблонов.\n' +
        '5. Форматирование: только простой текст. Никакой разметки markdown, заголовков или метаданных.'
    },
    {
      role: 'user',
      content: `Резюме кандидата:\n${cvText}\n\n` +
        `Название вакансии: ${title}\n` +
        `Компания: ${company}\n` +
        `Описание вакансии:\n${description}`
    }
  ];

  const letter = await module.exports.callLlm(messages);
  return letter || null;
}

/**
 * Produce a short (≤500 chars) CV analysis: key strengths and gaps.
 * Returns an empty string if the LLM is not configured or fails.
 */
async function analyzeCv(cvText) {
  if (!cvText) return '';

  const messages = [
    {
      role: 'system',
      content:
        'Ты — профессиональный карьерный консультант. Проанализируй резюме кандидата и напиши краткую оценку.\n' +
        'Выдели 2-3 ключевые сильные стороны и 1-2 области для развития или недостающие навыки.\n' +
        'Пиши на русском языке. Будь конкретен — ссылайся на реальные навыки, роли или опыт из резюме.\n' +
        'КРИТИЧЕСКИ ВАЖНО: Твой ответ должен быть длиной не более 600 символов (включая пробелы).\n' +
        'НЕ используй списки, маркеры (bullet points), разметку markdown или любое другое форматирование. Выводи только сплошной простой текст.'
    },
    {
      role: 'user',
      content: `Проанализируй это резюме:\n\n${cvText}`
    }
  ];

  const result = await module.exports.callLlm(messages);
  if (!result) return '';

  // Hard-cap at 600 chars server-side (safety net in case LLM ignores the limit)
  const MAX_CHARS = 700;
  if (result.length > MAX_CHARS) {
    return result.slice(0, MAX_CHARS - 1).trimEnd() + '…';
  }
  return result;
}

module.exports = {
  extractSpecializationFromCv,
  evaluateMatch,
  generateCoverLetter,
  analyzeCv,
  callLlm
};
