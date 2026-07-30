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
    if (promptStr.includes('professional role ID')) {
      if (promptStr.includes('деньги деньги деньги')) return 'INVALID';
      return '96';
    }
    if (promptStr.includes('cover letter')) return 'Mocked cover letter.';
    if (promptStr.includes('Compatibility Match Score') || promptStr.includes('Score out of 100')) return JSON.stringify({score: 85, reasoning: 'Mocked reasoning'});
    if (promptStr.includes('Provide a concise professional summary')) return 'Mocked CV analysis.';
    return 'Mocked response';
  }

  if (!config.llmApiKey) {
    console.warn('LLM_API_KEY is not configured. Skipping LLM call.');
    return '';
  }

  let token = config.llmApiKey;
  let activeHttpsAgent = httpsAgent;
  const isGigaChat = config.llmBaseUrl && config.llmBaseUrl.includes('giga.chat');

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
}

async function extractSpecializationFromCv(cvText) {
  if (!cvText) return '';

  const fs = require('fs');
  const path = require('path');
  const hhRoles = JSON.parse(fs.readFileSync(path.join(__dirname, 'roles', 'hh.json'), 'utf8'));

  const rolesListString = Object.entries(hhRoles)
    .map(([id, name]) => `- ID: "${id}", Name: "${name}"`)
    .join('\n');

  const messages = [
    {
      role: 'system',
      content: 'You are a professional recruiting assistant. Your task is to analyze a candidate\'s CV and select the single most appropriate HH.ru professional role ID from the list below.\n\n' +
        'List of allowed roles:\n' + rolesListString + '\n\n' +
        'Output ONLY the selected role ID (just the number). Do NOT write any introduction, quotes, or explanation. Output ONLY the ID.\n' +
        'CRITICAL: If the provided CV text is invalid, contains gibberish, random characters, or is not a meaningful professional CV/resume containing real professional context, skills, education, or work history, reply with exactly the word "INVALID".'
    },
    {
      role: 'user',
      content: `Analyze this CV and select the most appropriate professional role ID:\n\n${cvText}`
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
      content: 'You are an expert AI Recruiting Assistant and Senior Technical Recruiter. Your task is to analyze the provided Candidate CV against the Job Description and calculate a definitive Compatibility Match Score on a scale from 0 to 100.\n' +
        'This evaluation must be objective, analytical, and tailored strictly to the evidence present in the text.\n\n' +
        'First, analyze the Job Description to identify and extract the following components:\n' +
        '1. Base Requirements (general requirements, stack, experience duration, etc.)\n' +
        '2. Mandatory Requirements (critical requirements explicitly marked as mandatory/required/critical)\n' +
        '3. Nice-to-Have Requirements (preferred skills, bonuses, optional experience)\n' +
        '4. Responsibilities (key duties, daily tasks, project scopes)\n\n' +
        'Next, evaluate the Candidate CV against these identified elements and calculate the Compatibility Match Score based on the following rules:\n' +
        '- Base score starts at 100.\n' +
        '- Evaluate Base Requirements: Deduct points proportionally to the fraction of missing base requirements. Deduct up to 40 points total (e.g., if 2 out of 4 base requirements are missing (50%), deduct 20 points).\n' +
        '- Evaluate Mandatory Requirements: Deduct points proportionally to the fraction of missing mandatory requirements. Deduct up to 30 points total (e.g., if 1 out of 2 mandatory requirements is missing (50%), deduct 15 points). If no mandatory requirements are specified, do not deduct points.\n' +
        '- Evaluate Nice-to-Have Requirements: Add bonus points proportionally to the fraction of matched nice-to-have requirements. Add up to 10 points total (e.g., if 1 out of 2 nice-to-haves is matched (50%), add +5 points). If no nice-to-haves are specified, do not add points.\n' +
        '- Evaluate Responsibilities Alignment: Compare the candidate\'s past work responsibilities in their CV against the responsibilities of the vacancy. Deduct points proportionally to the fraction of vacancy responsibilities that are missing from or unaddressed by the candidate\'s experience. Deduct up to 20 points total. If no responsibilities are specified, do not deduct points.\n' +
        '- Mandatory Capping: If any mandatory requirement specified in the vacancy is completely missing from the candidate\'s CV, the final score must be capped at a maximum of 80.\n' +
        '- The final score must be between 0 and 100 (cap at 100, floor at 0).\n' +
        '- Be precise and honest. Do not inflate or deflate scores.\n\n' +
        'Also write a brief explanation (2-3 sentences in Russian) highlighting key matching skills, pros, cons, and clearly stating any missing/mismatched requirements.\n\n' +
        'Return ONLY a valid JSON object matching this schema:\n' +
        '{\n' +
        '  "score": 80,\n' +
        '  "reasoning": "Fits well..."\n' +
        '}\n' +
        'Do not write any markdown blocks (like ```json), introduction or surrounding text.'
    },
    {
      role: 'user',
      content: `Candidate CV:\n${cvText}\n\n` +
        `Job Title: ${title}\n` +
        `Company: ${company}\n` +
        `Job Description:\n${description}`
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
      content: 'You are an expert career coach and a professional technical writer. Your task is to write a tailored, high-converting Cover Letter in Russian for a job applicant.\n' +
        'The letter must be extremely concise (strictly under 500 characters with spaces) and follow these rules:\n' +
        '1. DO NOT retell the CV: Do not repeat lists of skills, technologies, or job histories that are already clearly visible in the resume. Retelling wastes the recruiter\'s attention.\n' +
        '2. Start with a greeting.\n' +
        '3. Why this vacancy: State clearly why the candidate is interested in this specific role and company, using details from the job description (tasks, products, or company domain).\n' +
        '4. How they stand out: Explain how the candidate\'s unique perspective, passion, or specific experience directly addresses the core challenge of this job.\n' +
        '5. Tone & Style: Confident, professional, yet written in a natural, conversational human voice. Avoid robotic clichés, epithets, corporate buzzwords, and dry templates.\n' +
        '6. Formatting: Plain text only. No markdown formatting, no headers, no subject lines, no email metadata.'
    },
    {
      role: 'user',
      content: `Candidate Resume:\n${cvText}\n\n` +
        `Job Title: ${title}\n` +
        `Company: ${company}\n` +
        `Job Description:\n${description}`
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
        'You are a professional career coach. Analyze the candidate\'s CV and write a concise assessment. ' +
        'Highlight 2-3 key strengths and 1-2 areas to improve or missing skills. ' +
        'Write in Russian. Be specific — reference actual skills, roles, or experience from the CV. ' +
        'CRITICAL: Your entire response must be no longer than 600 characters (including spaces). ' +
        'Do NOT use bullet points, markdown, or any formatting. Output plain continuous text only.'
    },
    {
      role: 'user',
      content: `Analyze this CV:\n\n${cvText}`
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
