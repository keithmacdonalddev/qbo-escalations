'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { getLoadedModel } = require('./lm-studio');

// sharp is used to convert unsupported image formats (WebP) to PNG for
// providers that only accept PNG/JPEG (e.g. LM Studio / llama.cpp).
let sharp;
try {
  sharp = require('sharp');
} catch {
  // sharp not installed — WebP conversion will be unavailable
  sharp = null;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const LM_STUDIO_API_URL = process.env.LM_STUDIO_API_URL || 'http://127.0.0.1:1234';
const DEFAULT_TIMEOUT_MS = 60000;
const KEYS_FILE = path.join(__dirname, '..', '..', 'data', 'image-parser-keys.json');
const PROVIDER_AVAILABILITY_CACHE_TTL_MS = (() => {
  const raw = Number.parseInt(process.env.IMAGE_PARSER_STATUS_CACHE_TTL_MS, 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 60_000;
})();

let _providerAvailabilityCache = null;
let _providerAvailabilityCachedAt = 0;
let _providerAvailabilityInFlight = null;
let _providerAvailabilityVersion = 0;

// ---------------------------------------------------------------------------
// API Key helpers — stored file first, env var fallback
// ---------------------------------------------------------------------------
const ENV_KEY_MAP = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  kimi: 'MOONSHOT_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

function getStoredApiKey(provider) {
  try {
    const raw = fs.readFileSync(KEYS_FILE, 'utf8');
    const keys = JSON.parse(raw);
    return keys[provider] || null;
  } catch {
    return null;
  }
}

function getApiKey(provider) {
  const stored = getStoredApiKey(provider);
  if (stored) return stored;
  const envVar = ENV_KEY_MAP[provider];
  return envVar ? process.env[envVar] || null : null;
}

function cloneProviderAvailability(providers) {
  if (!providers || typeof providers !== 'object') return providers;
  return Object.fromEntries(
    Object.entries(providers).map(([name, info]) => [
      name,
      info && typeof info === 'object' ? { ...info } : info,
    ])
  );
}

function clearProviderAvailabilityCache() {
  _providerAvailabilityCache = null;
  _providerAvailabilityCachedAt = 0;
  _providerAvailabilityInFlight = null;
  _providerAvailabilityVersion += 1;
}

// ---------------------------------------------------------------------------
// System Prompt — dual-role auto-detection for escalation + INV parsing
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are an image parser for a QBO (QuickBooks Online) escalation support tool. You receive a single screenshot and must output structured text. You have exactly two roles, and you must auto-detect which one applies based on the image content.

## ROLE DETECTION

Look at the image content:
- If the image shows an escalation template from Intuit's internal chat system (contains fields like COID, MID, Case number, client info, troubleshooting steps, etc.), use **Role 1: Escalation Template Parse**.
- If the image shows a list of INV (investigation) entries from a Slack channel (contains INV-XXXXXX numbers with descriptions, often grouped by dates), use **Role 2: INV List Parse**.

Pick the correct role and follow its output format exactly. Do not mix roles. Do not add commentary, explanations, or markdown formatting.

---

## ROLE 1: ESCALATION TEMPLATE PARSE

Extract the escalation fields from the screenshot and output them in EXACTLY this format:

COID/MID: [value from image]
CASE: [value from image]
CLIENT/CONTACT: [value from image]
CX IS ATTEMPTING TO: [value from image]
EXPECTED OUTCOME: [value from image]
ACTUAL OUTCOME: [value from image]
KB/TOOLS USED: [value from image]
TRIED TEST ACCOUNT: [value from image]
TS STEPS: [value from image]

Rules for Role 1:
- Read every field exactly as written in the image. Do not summarize or rephrase.
- If a field is empty, missing, or not visible in the image, write the field label followed by nothing (leave the value blank).
- Do not guess unreadable names, identifiers, numbers, or labels. If uncertain, leave blank.
- Preserve the exact spelling, capitalization, and punctuation from the image.
- The COID and MID may appear as separate fields or combined. Include both values separated by a slash if both are present.
- TS STEPS may be multi-line. Include all steps, preserving line breaks with newlines.
- Do not include any text before or after the field list.

---

## ROLE 2: INV LIST PARSE

Extract all INV entries from the Slack screenshot and output them grouped by their date headers exactly as they appear in the image.

Output format:

[Date header as shown in image]:
- INV-XXXXXX [Full description from image]
- INV-XXXXXX [Full description from image]

[Next date header]:
- INV-XXXXXX [Full description from image]

Rules for Role 2:
- Preserve date headers exactly as they appear (e.g., "Friday, March 13th:", "Yesterday (Mar 16):", "Today (Mar 17):").
- Each INV entry starts with the full INV number (INV-XXXXXX) followed by the complete description.
- Use a dash-space prefix for each entry.
- Separate date groups with a blank line.
- Preserve the full description text — do not truncate or summarize.
- If an entry spans multiple lines in the image, combine it into a single line.
- Include ALL entries visible in the image, even partially visible ones at the edges.
- Do not add entries that are not in the image.
- Do not add any text before or after the grouped list.

---

## CRITICAL RULES (BOTH ROLES)

1. Output ONLY the structured text for the detected role. No commentary, no "Here is...", no explanations.
2. Read the image with extreme precision. Every character matters.
3. Do not hallucinate or fill in information that is not visible in the image.
4. If the image is unclear, blurry, or partially cut off, extract what you can see and skip what you cannot.
5. Do not wrap output in markdown code blocks or any other formatting.`;

// ---------------------------------------------------------------------------
// Low-level HTTP helper — same pattern as lm-studio.js:35-60
// ---------------------------------------------------------------------------
function resolveTransport(baseUrl) {
  const url = new URL(baseUrl);
  return {
    transport: url.protocol === 'https:' ? https : http,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
  };
}

function jsonRequest(method, baseUrl, urlPath, body, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const { transport, hostname, port } = resolveTransport(baseUrl);
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

    const options = {
      hostname,
      port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...headers },
      timeout: timeoutMs || 30000,
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      const err = new Error('Request timed out');
      err.code = 'TIMEOUT';
      reject(err);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Image handling — same pattern as lm-studio.js:98-107
// ---------------------------------------------------------------------------
function normalizeBase64(base64Input) {
  const trimmed = (typeof base64Input === 'string' ? base64Input : '').trim();
  if (!trimmed) return null;

  // Detect media type from data-URL prefix if present
  let mediaType = null;
  let rawBase64 = trimmed;

  if (trimmed.startsWith('data:')) {
    const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+_-]+);base64,(.+)$/);
    if (match) {
      mediaType = match[1];
      rawBase64 = match[2];
    }
  }

  // If no media type from prefix, detect from raw bytes (magic numbers).
  // This prevents Anthropic from rejecting JPEGs sent without the data-URL
  // prefix (the old code defaulted everything to image/png).
  if (!mediaType) {
    mediaType = detectMediaTypeFromBase64(rawBase64);
  }

  const dataUrl = `data:${mediaType};base64,${rawBase64}`;

  // --- DEBUG LOGGING (temporary) ---
  console.log('[image-parser-debug] normalizeBase64:', {
    inputLength: (base64Input || '').length,
    startsWithData: trimmed.startsWith('data:'),
    mediaType,
    rawBase64Length: rawBase64.length,
    rawBase64Prefix: rawBase64.slice(0, 80),
    dataUrlLength: dataUrl.length,
    dataUrlPrefix: dataUrl.slice(0, 100),
  });
  // --- END DEBUG ---

  return { rawBase64, mediaType, dataUrl };
}

/**
 * Detect image media type from the first few bytes of base64 data.
 * Falls back to image/png if detection fails.
 */
function detectMediaTypeFromBase64(b64) {
  try {
    // Decode just enough bytes for magic-number detection
    const head = Buffer.from(b64.slice(0, 32), 'base64');
    if (head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF) return 'image/jpeg';
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47) return 'image/png';
    if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return 'image/gif';
    if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
        head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return 'image/webp';
  } catch {
    // Corrupt base64 — fall through
  }
  return 'image/png'; // safe default
}

// ---------------------------------------------------------------------------
// Image format conversion — WebP -> PNG for providers that need it
// ---------------------------------------------------------------------------

/**
 * Convert a base64-encoded image from an unsupported format (WebP, GIF) to PNG.
 * Returns { rawBase64, mediaType } with the converted data, or the original
 * if conversion is not needed or sharp is unavailable.
 */
async function convertToPngIfNeeded(rawBase64, mediaType) {
  const originalSizeBytes = Buffer.byteLength(rawBase64, 'base64');

  // Only convert formats that llama.cpp / LM Studio reject
  const NEEDS_CONVERSION = ['image/webp', 'image/gif'];
  if (!NEEDS_CONVERSION.includes(mediaType)) {
    return { rawBase64, mediaType, wasConverted: false, originalSizeBytes, convertedSizeBytes: originalSizeBytes, conversionTimeMs: 0 };
  }

  if (!sharp) {
    console.warn('[image-parser] WebP/GIF image detected but sharp is not available — sending as-is (may fail)');
    return { rawBase64, mediaType, wasConverted: false, originalSizeBytes, convertedSizeBytes: originalSizeBytes, conversionTimeMs: 0 };
  }

  try {
    const conversionStart = Date.now();
    const inputBuffer = Buffer.from(rawBase64, 'base64');
    const pngBuffer = await sharp(inputBuffer).png().toBuffer();
    const conversionTimeMs = Date.now() - conversionStart;
    console.log(`[image-parser] Converted ${mediaType} to PNG (${inputBuffer.length} -> ${pngBuffer.length} bytes) in ${conversionTimeMs}ms`);
    const convertedBase64 = pngBuffer.toString('base64');
    return {
      rawBase64: convertedBase64,
      mediaType: 'image/png',
      wasConverted: true,
      originalSizeBytes,
      convertedSizeBytes: Buffer.byteLength(convertedBase64, 'base64'),
      conversionTimeMs,
    };
  } catch (err) {
    console.error('[image-parser] Failed to convert image to PNG:', err.message);
    // Fall through with original data — the provider will give a clearer error
    return { rawBase64, mediaType, wasConverted: false, originalSizeBytes, convertedSizeBytes: originalSizeBytes, conversionTimeMs: 0 };
  }
}

// ---------------------------------------------------------------------------
// Provider call helpers — each returns { text: string, usage: Object|null }
// ---------------------------------------------------------------------------

/**
 * LM Studio — reuses jsonRequest pattern, non-streaming POST to /v1/chat/completions
 * Note: llama.cpp only supports PNG and JPEG. WebP/GIF are auto-converted to PNG.
 */
async function callLmStudio(systemPrompt, imageBase64, mediaType, model, timeoutMs) {
  const effectiveModel = model || await getLoadedModel(LM_STUDIO_API_URL);

  // llama.cpp (LM Studio backend) only supports PNG and JPEG — convert others
  const converted = await convertToPngIfNeeded(imageBase64, mediaType);
  const conversionStats = {
    wasConverted: converted.wasConverted,
    originalSizeBytes: converted.originalSizeBytes,
    convertedSizeBytes: converted.convertedSizeBytes,
    conversionTimeMs: converted.conversionTimeMs,
  };
  imageBase64 = converted.rawBase64;
  mediaType = converted.mediaType;

  const dataUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:${mediaType};base64,${imageBase64}`;

  // --- DEBUG LOGGING (temporary) ---
  console.log('[lm-debug] url prefix:', dataUrl.substring(0, 100), 'mediaType:', mediaType, 'model:', effectiveModel);
  console.log('[lm-debug] rawBase64 length:', imageBase64.length, 'dataUrl length:', dataUrl.length);
  console.log('[lm-debug] imageBase64 starts with data:', imageBase64.startsWith('data:'), 'first 80 chars:', imageBase64.substring(0, 80));
  // --- END DEBUG ---

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Parse this image.' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ];

  const res = await jsonRequest('POST', LM_STUDIO_API_URL, '/v1/chat/completions', {
    model: effectiveModel,
    messages,
    stream: false,
    temperature: 0.1,
    max_tokens: 4096,
    chat_template_kwargs: { enable_thinking: false },
  }, {}, timeoutMs);

  if (res.statusCode !== 200) {
    const err = new Error(`LM Studio error (HTTP ${res.statusCode}): ${(res.body || '').slice(0, 500)}`);
    err.code = 'PROVIDER_ERROR';
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    const err = new Error(`LM Studio returned invalid JSON: ${(res.body || '').slice(0, 200)}`);
    err.code = 'PROVIDER_ERROR';
    throw err;
  }
  // Reasoning models (Qwen3 etc.) may return empty content with the actual
  // response in reasoning_content — fall back gracefully
  const msg = parsed.choices?.[0]?.message || {};
  const text = msg.content || msg.reasoning_content || '';
  const usage = parsed.usage
    ? { model: parsed.model || effectiveModel, inputTokens: parsed.usage.prompt_tokens || 0, outputTokens: parsed.usage.completion_tokens || 0 }
    : null;

  return { text: text.trim(), usage, conversionStats };
}

/**
 * Anthropic API — direct HTTPS POST to api.anthropic.com/v1/messages
 */
async function callAnthropic(systemPrompt, rawBase64, mediaType, model, timeoutMs) {
  const apiKey = getApiKey('anthropic');
  if (!apiKey) {
    const err = new Error('Anthropic API key not configured');
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }

  const effectiveModel = model || 'claude-sonnet-4-20250514';

  const body = {
    model: effectiveModel,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: rawBase64 } },
        { type: 'text', text: 'Parse this image.' },
      ],
    }],
  };

  const res = await jsonRequest('POST', 'https://api.anthropic.com', '/v1/messages', body, {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }, timeoutMs);

  if (res.statusCode !== 200) {
    const err = new Error(`Anthropic API error (HTTP ${res.statusCode}): ${(res.body || '').slice(0, 500)}`);
    err.code = 'PROVIDER_ERROR';
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    const err = new Error(`Anthropic returned invalid JSON: ${(res.body || '').slice(0, 200)}`);
    err.code = 'PROVIDER_ERROR';
    throw err;
  }
  const text = parsed.content?.[0]?.text || '';
  const usage = parsed.usage
    ? { model: parsed.model || effectiveModel, inputTokens: parsed.usage.input_tokens || 0, outputTokens: parsed.usage.output_tokens || 0 }
    : null;

  return { text: text.trim(), usage };
}

/**
 * OpenAI API — direct HTTPS POST to api.openai.com/v1/chat/completions
 */
async function callOpenAI(systemPrompt, imageDataUrl, model, timeoutMs) {
  const apiKey = getApiKey('openai');
  if (!apiKey) {
    const err = new Error('OpenAI API key not configured');
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }

  const effectiveModel = model || 'gpt-4o';

  const body = {
    model: effectiveModel,
    max_tokens: 4096,
    temperature: 0.1,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Parse this image.' },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
  };

  const res = await jsonRequest('POST', 'https://api.openai.com', '/v1/chat/completions', body, {
    'Authorization': `Bearer ${apiKey}`,
  }, timeoutMs);

  if (res.statusCode !== 200) {
    const err = new Error(`OpenAI API error (HTTP ${res.statusCode}): ${(res.body || '').slice(0, 500)}`);
    err.code = 'PROVIDER_ERROR';
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    const err = new Error(`OpenAI returned invalid JSON: ${(res.body || '').slice(0, 200)}`);
    err.code = 'PROVIDER_ERROR';
    throw err;
  }
  const text = parsed.choices?.[0]?.message?.content || '';
  const usage = parsed.usage
    ? { model: parsed.model || effectiveModel, inputTokens: parsed.usage.prompt_tokens || 0, outputTokens: parsed.usage.completion_tokens || 0 }
    : null;

  return { text: text.trim(), usage };
}

/**
 * Google Gemini API — direct HTTPS POST to generativelanguage.googleapis.com/v1beta/models/*:generateContent
 */
async function callGemini(systemPrompt, rawBase64, mediaType, model, timeoutMs) {
  const apiKey = getApiKey('gemini');
  if (!apiKey) {
    const err = new Error('Gemini API key not configured');
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }

  const effectiveModel = model || 'gemini-3-flash-preview';
  const body = {
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [{
      role: 'user',
      parts: [
        { text: 'Parse this image.' },
        {
          inline_data: {
            mime_type: mediaType,
            data: rawBase64,
          },
        },
      ],
    }],
    generationConfig: {
      maxOutputTokens: 4096,
      responseMimeType: 'text/plain',
    },
  };

  const res = await jsonRequest(
    'POST',
    'https://generativelanguage.googleapis.com',
    `/v1beta/models/${encodeURIComponent(effectiveModel)}:generateContent`,
    body,
    { 'x-goog-api-key': apiKey },
    timeoutMs
  );

  if (res.statusCode !== 200) {
    const err = new Error(`Gemini API error (HTTP ${res.statusCode}): ${(res.body || '').slice(0, 500)}`);
    err.code = 'PROVIDER_ERROR';
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    const err = new Error(`Gemini returned invalid JSON: ${(res.body || '').slice(0, 200)}`);
    err.code = 'PROVIDER_ERROR';
    throw err;
  }

  const text = (parsed.candidates?.[0]?.content?.parts || [])
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('\n');

  const usageMeta = parsed.usageMetadata;
  const usage = usageMeta
    ? {
        model: parsed.modelVersion || effectiveModel,
        inputTokens: usageMeta.promptTokenCount || 0,
        outputTokens: usageMeta.candidatesTokenCount != null
          ? usageMeta.candidatesTokenCount
          : Math.max((usageMeta.totalTokenCount || 0) - (usageMeta.promptTokenCount || 0), 0),
      }
    : null;

  return { text: text.trim(), usage };
}

/**
 * Kimi/Moonshot AI — OpenAI-compatible POST to api.moonshot.ai/v1/chat/completions
 */
async function callKimi(systemPrompt, imageDataUrl, model, timeoutMs) {
  const apiKey = getApiKey('kimi');
  if (!apiKey) {
    const err = new Error('Moonshot API key not configured');
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }

  const effectiveModel = model || 'kimi-k2.5';

  const body = {
    model: effectiveModel,
    max_tokens: 4096,
    temperature: 1,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Parse this image.' },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
  };

  // --- DEBUG LOGGING (temporary) ---
  console.log('[image-parser-debug] callKimi request:', {
    url: 'https://api.moonshot.ai/v1/chat/completions',
    model: effectiveModel,
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    systemPromptLength: systemPrompt.length,
    imageDataUrlLength: imageDataUrl.length,
    imageDataUrlPrefix: imageDataUrl.slice(0, 100),
    messageStructure: JSON.stringify(body.messages.map(m => ({
      role: m.role,
      contentType: typeof m.content,
      contentLength: typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length,
    }))),
    apiKeyPrefix: apiKey ? apiKey.slice(0, 8) + '...' : '(none)',
    timeoutMs,
  });
  const payloadSize = JSON.stringify(body).length;
  console.log('[image-parser-debug] callKimi payload size:', payloadSize, 'bytes');
  // --- END DEBUG ---

  const res = await jsonRequest('POST', 'https://api.moonshot.ai', '/v1/chat/completions', body, {
    'Authorization': `Bearer ${apiKey}`,
  }, timeoutMs);

  // --- DEBUG LOGGING (temporary) ---
  console.log('[image-parser-debug] callKimi response:', {
    statusCode: res.statusCode,
    bodyLength: (res.body || '').length,
    bodyPreview: (res.body || '').slice(0, 1000),
  });
  // --- END DEBUG ---

  if (res.statusCode !== 200) {
    console.error('[image-parser] Kimi API error:', res.statusCode, res.body?.slice(0, 1000));
    const err = new Error(`Kimi API error (HTTP ${res.statusCode}): ${(res.body || '').slice(0, 500)}`);
    err.code = 'PROVIDER_ERROR';
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    const err = new Error(`Kimi returned invalid JSON: ${(res.body || '').slice(0, 200)}`);
    err.code = 'PROVIDER_ERROR';
    throw err;
  }

  // --- DEBUG LOGGING (temporary) ---
  console.log('[image-parser-debug] callKimi parsed response:', {
    id: parsed.id,
    model: parsed.model,
    choicesCount: parsed.choices?.length,
    finishReason: parsed.choices?.[0]?.finish_reason,
    contentLength: (parsed.choices?.[0]?.message?.content || '').length,
    contentPreview: (parsed.choices?.[0]?.message?.content || '').slice(0, 200),
    reasoningContent: parsed.choices?.[0]?.message?.reasoning_content ? 'PRESENT (length: ' + parsed.choices[0].message.reasoning_content.length + ')' : 'absent',
    usage: parsed.usage,
  });
  // --- END DEBUG ---

  const text = parsed.choices?.[0]?.message?.content || '';
  const usage = parsed.usage
    ? { model: parsed.model || effectiveModel, inputTokens: parsed.usage.prompt_tokens || 0, outputTokens: parsed.usage.completion_tokens || 0 }
    : null;

  return { text: text.trim(), usage };
}

// ---------------------------------------------------------------------------
// Role auto-detection from response text
// ---------------------------------------------------------------------------
function detectRole(responseText) {
  if (/INV-\d{5,}/.test(responseText)) return 'inv-list';
  if (/COID\/MID:|CASE:|CX IS ATTEMPTING TO:/i.test(responseText)) return 'escalation';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Main entry — parseImage()
// ---------------------------------------------------------------------------

/**
 * @param {string} imageBase64 - Raw base64 or data-URI string
 * @param {Object} options
 * @param {string} options.provider - 'lm-studio' | 'anthropic' | 'openai' | 'kimi' | 'gemini'
 * @param {string} [options.model] - Model ID override
 * @param {number} [options.timeoutMs=60000] - Request timeout
 * @returns {Promise<{ text: string, role: 'escalation'|'inv-list'|'unknown', usage: Object|null }>}
 */
async function parseImage(imageBase64, options = {}) {
  const { provider, model, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  if (!imageBase64 || typeof imageBase64 !== 'string' || !imageBase64.trim()) {
    const err = new Error('Image data is required');
    err.code = 'MISSING_IMAGE';
    throw err;
  }

  const normalized = normalizeBase64(imageBase64);
  if (!normalized) {
    const err = new Error('Invalid image data');
    err.code = 'MISSING_IMAGE';
    throw err;
  }

  // Compute original image size for stats
  const originalSizeBytes = Buffer.byteLength(normalized.rawBase64, 'base64');

  let result;
  const providerStartTime = Date.now();
  switch (provider) {
    case 'lm-studio':
      result = await callLmStudio(SYSTEM_PROMPT, normalized.rawBase64, normalized.mediaType, model, timeoutMs);
      break;
    case 'anthropic':
      result = await callAnthropic(SYSTEM_PROMPT, normalized.rawBase64, normalized.mediaType, model, timeoutMs);
      break;
    case 'openai':
      result = await callOpenAI(SYSTEM_PROMPT, normalized.dataUrl, model, timeoutMs);
      break;
    case 'gemini':
      result = await callGemini(SYSTEM_PROMPT, normalized.rawBase64, normalized.mediaType, model, timeoutMs);
      break;
    case 'kimi':
      result = await callKimi(SYSTEM_PROMPT, normalized.dataUrl, model, timeoutMs);
      break;
    default: {
      const err = new Error(`Invalid provider: ${provider}. Must be one of: lm-studio, anthropic, openai, kimi, gemini`);
      err.code = 'INVALID_PROVIDER';
      throw err;
    }
  }
  const providerLatencyMs = Date.now() - providerStartTime;

  // Build image stats — LM Studio includes conversion stats from convertToPngIfNeeded
  const convStats = result.conversionStats || {};
  const imageStats = {
    originalFormat: normalized.mediaType || '',
    finalFormat: convStats.wasConverted ? 'image/png' : (normalized.mediaType || ''),
    wasConverted: convStats.wasConverted || false,
    originalSizeBytes: convStats.originalSizeBytes || originalSizeBytes,
    finalSizeBytes: convStats.convertedSizeBytes || originalSizeBytes,
    conversionTimeMs: convStats.conversionTimeMs || 0,
  };

  const role = detectRole(result.text);
  return {
    text: result.text,
    role,
    usage: result.usage,
    stats: {
      providerLatencyMs,
      image: imageStats,
    },
  };
}

// ---------------------------------------------------------------------------
// Availability checks
// ---------------------------------------------------------------------------

/**
 * Returns availability of each provider for the image parser.
 * @returns {Promise<Object>} { 'lm-studio': { available, reason }, anthropic: { ... }, openai: { ... } }
 */
async function resolveProviderAvailability() {
  const providers = {};

  // LM Studio — try to reach /v1/models with a 3s timeout
  providers['lm-studio'] = await new Promise((resolve) => {
    const url = new URL('/v1/models', LM_STUDIO_API_URL);
    const t = url.protocol === 'https:' ? https : http;

    const req = t.get(url, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          const modelId = json?.data?.[0]?.id;
          resolve({
            available: !!modelId,
            model: modelId || null,
            reason: modelId ? `Model loaded: ${modelId}` : 'No model loaded',
          });
        } catch {
          resolve({ available: false, model: null, reason: 'Invalid response from LM Studio' });
        }
      });
    });
    req.on('error', () => resolve({ available: false, model: null, reason: `Cannot reach LM Studio at ${LM_STUDIO_API_URL}` }));
    req.on('timeout', () => { req.destroy(); resolve({ available: false, model: null, reason: 'LM Studio connection timed out' }); });
  });

  // Anthropic — check stored key or env var
  const anthropicKey = getApiKey('anthropic');
  providers['anthropic'] = {
    available: !!(anthropicKey && anthropicKey.trim()),
    reason: anthropicKey && anthropicKey.trim() ? 'API key configured' : 'Anthropic API key not configured',
  };

  // OpenAI — check stored key or env var
  const openaiKey = getApiKey('openai');
  providers['openai'] = {
    available: !!(openaiKey && openaiKey.trim()),
    reason: openaiKey && openaiKey.trim() ? 'API key configured' : 'OpenAI API key not configured',
  };

  // Kimi/Moonshot — check stored key or env var
  const kimiKey = getApiKey('kimi');
  providers['kimi'] = {
    available: !!(kimiKey && kimiKey.trim()),
    reason: kimiKey && kimiKey.trim() ? 'API key configured' : 'Moonshot API key not configured',
  };

  // Gemini — check stored key or env var
  const geminiKey = getApiKey('gemini');
  providers['gemini'] = {
    available: !!(geminiKey && geminiKey.trim()),
    reason: geminiKey && geminiKey.trim() ? 'API key configured' : 'Gemini API key not configured',
  };

  return providers;
}

async function checkProviderAvailability(options = {}) {
  const forceRefresh = Boolean(options && options.forceRefresh);
  const ttlMs = Number.isFinite(options?.ttlMs) && options.ttlMs >= 0
    ? options.ttlMs
    : PROVIDER_AVAILABILITY_CACHE_TTL_MS;
  const now = Date.now();
  const cacheVersion = _providerAvailabilityVersion;

  if (!forceRefresh && _providerAvailabilityCache && (now - _providerAvailabilityCachedAt) < ttlMs) {
    return cloneProviderAvailability(_providerAvailabilityCache);
  }

  if (_providerAvailabilityInFlight) {
    const shared = await _providerAvailabilityInFlight;
    return cloneProviderAvailability(shared);
  }

  const availabilityPromise = resolveProviderAvailability()
    .then((providers) => {
      if (_providerAvailabilityVersion === cacheVersion) {
        _providerAvailabilityCache = providers;
        _providerAvailabilityCachedAt = Date.now();
      }
      return providers;
    })
    .finally(() => {
      if (_providerAvailabilityInFlight === availabilityPromise) {
        _providerAvailabilityInFlight = null;
      }
    });

  _providerAvailabilityInFlight = availabilityPromise;
  const providers = await availabilityPromise;
  return cloneProviderAvailability(providers);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  parseImage,
  checkProviderAvailability,
  clearProviderAvailabilityCache,
  normalizeBase64,
  detectMediaTypeFromBase64,
  detectRole,
  convertToPngIfNeeded,
  getStoredApiKey,
  getApiKey,
  KEYS_FILE,
  SYSTEM_PROMPT,
};
