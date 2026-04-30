'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { getLoadedModel, getModelSnapshot } = require('./lm-studio');
const ImageParserApiKey = require('../models/ImageParserApiKey');
const { getRenderedAgentPrompt } = require('../lib/agent-prompt-store');
const { buildServerTriageCard } = require('../lib/chat-triage');
const { validateCanonicalEscalationTemplateText } = require('../lib/escalation-template-contract');
const { parseEscalationText } = require('../lib/escalation-parser');
const { validateParsedEscalation } = require('../lib/parse-validation');

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
const LM_STUDIO_API_TOKEN = process.env.LM_STUDIO_API_TOKEN || process.env.LM_STUDIO_API_KEY || null;
const LLM_GATEWAY_API_URL = process.env.LLM_GATEWAY_API_URL || 'http://127.0.0.1:4100';
const LLM_GATEWAY_DEFAULT_MODEL = process.env.LLM_GATEWAY_DEFAULT_MODEL || 'auto';
const DEFAULT_TIMEOUT_MS = 60000;
const KEYS_FILE = path.join(__dirname, '..', '..', 'data', 'image-parser-keys.json');
const IMAGE_PARSER_VERBOSE_LOGS = process.env.IMAGE_PARSER_VERBOSE_LOGS === '1';
const DEFAULT_IMAGE_PARSE_PROMPT_ID = 'image-parser';
const IMAGE_PARSE_PROMPT_IDS = new Set([
  DEFAULT_IMAGE_PARSE_PROMPT_ID,
  'escalation-template-parser',
  'follow-up-chat-parser',
]);
const PROVIDER_AVAILABILITY_CACHE_TTL_MS = (() => {
  const raw = Number.parseInt(process.env.IMAGE_PARSER_STATUS_CACHE_TTL_MS, 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 60_000;
})();

let _providerAvailabilityCache = null;
let _providerAvailabilityCachedAt = 0;
let _providerAvailabilityInFlight = null;
let _providerAvailabilityVersion = 0;

function verboseLog(...args) {
  if (IMAGE_PARSER_VERBOSE_LOGS) {
    console.log(...args);
  }
}

function verboseWarn(...args) {
  if (IMAGE_PARSER_VERBOSE_LOGS) {
    console.warn(...args);
  }
}

function verboseError(...args) {
  if (IMAGE_PARSER_VERBOSE_LOGS) {
    console.error(...args);
  }
}

function normalizeImageParsePromptId(value) {
  const promptId = typeof value === 'string' ? value.trim() : '';
  return IMAGE_PARSE_PROMPT_IDS.has(promptId) ? promptId : DEFAULT_IMAGE_PARSE_PROMPT_ID;
}

function isMongoKeyStoreReady() {
  return !!(ImageParserApiKey && ImageParserApiKey.db && ImageParserApiKey.db.readyState === 1);
}

function readStoredKeysFile() {
  try {
    const raw = fs.readFileSync(KEYS_FILE, 'utf8');
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredKeysFile(keys) {
  fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// API Key helpers — stored file first, env var fallback
// ---------------------------------------------------------------------------
const ENV_KEY_MAP = {
  'llm-gateway': 'LLM_GATEWAY_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  kimi: 'MOONSHOT_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

const REMOTE_PROVIDER_TEST_CONFIGS = {
  'llm-gateway': {
    baseUrl: LLM_GATEWAY_API_URL,
    path: '/v1/provider-status',
    method: 'GET',
    model: null,
    buildBody: () => null,
    buildHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
      'Accept': 'application/json',
    }),
  },
  anthropic: {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    model: 'claude-sonnet-4-20250514',
    buildBody: (model) => JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    buildHeaders: (key) => ({
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    }),
  },
  openai: {
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    model: 'gpt-4o-mini',
    buildBody: (model) => JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    buildHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    }),
  },
  kimi: {
    hostname: 'api.moonshot.ai',
    path: '/v1/chat/completions',
    model: 'kimi-k2.5',
    buildBody: (model) => JSON.stringify({ model, max_tokens: 1, temperature: 1, messages: [{ role: 'user', content: 'hi' }] }),
    buildHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    }),
  },
  gemini: {
    hostname: 'generativelanguage.googleapis.com',
    path: '/v1beta/models/gemini-3-flash-preview:generateContent',
    model: 'gemini-3-flash-preview',
    buildBody: () => JSON.stringify({
      contents: [{ parts: [{ text: 'hi' }] }],
      generationConfig: { maxOutputTokens: 1, responseMimeType: 'text/plain' },
    }),
    buildHeaders: (key) => ({
      'x-goog-api-key': key,
      'Content-Type': 'application/json',
    }),
  },
};

function getStoredApiKey(provider) {
  const keys = readStoredKeysFile();
  return keys && typeof keys[provider] === 'string' ? keys[provider] : null;
}

function getApiKey(provider) {
  const stored = getStoredApiKey(provider);
  if (typeof stored === 'string' && stored.trim()) {
    return stored.trim();
  }

  const envVar = ENV_KEY_MAP[provider];
  const envKey = envVar ? process.env[envVar] || null : null;
  return typeof envKey === 'string' && envKey.trim() ? envKey.trim() : null;
}

async function resolveApiKey(provider) {
  const resolved = getApiKey(provider);
  if (resolved) return resolved;

  if (isMongoKeyStoreReady()) {
    try {
      const doc = await ImageParserApiKey.findOne({ provider }).lean();
      if (doc && typeof doc.key === 'string' && doc.key.trim()) {
        return doc.key.trim();
      }
    } catch {
      // Fall through to env var lookup.
    }
  }

  return null;
}

async function getAllStoredKeys() {
  const fileKeys = readStoredKeysFile();
  const result = { ...fileKeys };

  if (isMongoKeyStoreReady()) {
    try {
      const docs = await ImageParserApiKey.find({}).lean();
      for (const doc of docs) {
        const hasFileKey = typeof result[doc.provider] === 'string' && result[doc.provider].trim();
        if (!hasFileKey && typeof doc.key === 'string' && doc.key.trim()) {
          result[doc.provider] = doc.key.trim();
        }
      }
    } catch {
      // Fall back to file-backed keys only.
    }
  }

  return result;
}

async function setStoredApiKey(provider, key) {
  const keys = readStoredKeysFile();
  if (key && typeof key === 'string' && key.trim()) {
    keys[provider] = key.trim();
  } else {
    delete keys[provider];
  }
  writeStoredKeysFile(keys);

  if (!isMongoKeyStoreReady()) return;

  try {
    if (key && typeof key === 'string' && key.trim()) {
      await ImageParserApiKey.findOneAndUpdate(
        { provider },
        { provider, key: key.trim() },
        { upsert: true, returnDocument: 'after' }
      );
    } else {
      await ImageParserApiKey.deleteOne({ provider });
    }
  } catch {
    // File-backed storage remains the source of truth when Mongo is unavailable.
  }
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

function getRemoteProviderLabel(provider) {
  switch (provider) {
    case 'llm-gateway':
      return 'LLM Gateway';
    case 'anthropic':
      return 'Anthropic';
    case 'openai':
      return 'OpenAI';
    case 'kimi':
      return 'Moonshot';
    case 'gemini':
      return 'Gemini';
    default:
      return provider;
  }
}

function extractProviderErrorMessage(body, fallback) {
  try {
    const parsed = JSON.parse(body);
    return parsed.error?.message
      || parsed.error?.status
      || parsed.message
      || fallback;
  } catch {
    return fallback;
  }
}

function parseProviderJson(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function getGatewayProviderStatusModel(parsed) {
  return parsed?.upstream?.availableModel
    || parsed?.upstream?.loadedModel
    || null;
}

function getGatewayUnavailableReason(errorCode, detail) {
  if (errorCode === 'UPSTREAM_NOT_READY') {
    return 'Gateway reachable, model unavailable';
  }
  if (errorCode === 'UPSTREAM_UNAVAILABLE') {
    return 'Gateway authenticated, upstream unavailable';
  }
  if (errorCode === 'PROVIDER_UNAVAILABLE') {
    return 'Gateway authenticated, unavailable';
  }
  if (/model is ready|model unavailable|no upstream model/i.test(detail || '')) {
    return 'Gateway reachable, model unavailable';
  }
  return 'Gateway authenticated, upstream unavailable';
}

function testRemoteProviderKey(provider, apiKey) {
  const cfg = REMOTE_PROVIDER_TEST_CONFIGS[provider];
  if (!cfg) {
    const err = new Error(`Unsupported provider: ${provider}`);
    err.code = 'INVALID_PROVIDER';
    throw err;
  }

  const payload = cfg.buildBody(cfg.model);
  const headers = cfg.buildHeaders(apiKey);
  if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
  const targetUrl = cfg.baseUrl ? new URL(cfg.path, cfg.baseUrl) : null;
  const isHttps = targetUrl ? targetUrl.protocol === 'https:' : true;
  const requestLib = isHttps ? https : http;
  const hostname = targetUrl ? targetUrl.hostname : cfg.hostname;
  const port = targetUrl
    ? (targetUrl.port || (isHttps ? 443 : 80))
    : 443;
  const pathName = targetUrl ? `${targetUrl.pathname}${targetUrl.search}` : cfg.path;
  const method = cfg.method || 'POST';

  return new Promise((resolve, reject) => {
    const req = requestLib.request({
      hostname,
      port,
      path: pathName,
      method,
      headers,
      timeout: 10_000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data, model: cfg.model }));
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

async function validateRemoteProvider(provider, apiKey) {
  const label = getRemoteProviderLabel(provider);
  const trimmedKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!trimmedKey) {
    return {
      ok: false,
      configured: false,
      available: false,
      code: 'NO_KEY',
      reason: `${label} API key not configured`,
      detail: '',
      model: null,
      };
    }

    try {
      const result = await testRemoteProviderKey(provider, trimmedKey);
      const parsedBody = parseProviderJson(result.body);
      if (provider === 'llm-gateway') {
        if (result.statusCode >= 200 && result.statusCode < 300) {
          return {
            ok: true,
            configured: true,
            available: true,
            code: 'OK',
            reason: 'Authenticated',
            detail: '',
            model: getGatewayProviderStatusModel(parsedBody),
          };
        }

        const detail = extractProviderErrorMessage(
          result.body,
          result.statusCode === 504
            ? 'Gateway validation timed out'
            : `LLM Gateway returned HTTP ${result.statusCode}`
        );
        const gatewayCode = String(parsedBody?.error?.code || '').trim().toUpperCase();

        if (result.statusCode === 401 || result.statusCode === 403) {
          return {
            ok: false,
            configured: true,
            available: false,
            code: 'INVALID_KEY',
            reason: 'API key rejected',
            detail,
            model: null,
          };
        }

        if (result.statusCode === 504) {
          return {
            ok: false,
            configured: true,
            available: false,
            code: 'TIMEOUT',
            reason: 'Gateway validation timed out',
            detail,
            model: null,
          };
        }

        if (result.statusCode === 503) {
          return {
            ok: false,
            configured: true,
            available: false,
            code: 'PROVIDER_UNAVAILABLE',
            reason: getGatewayUnavailableReason(gatewayCode, detail),
            detail,
            model: null,
          };
        }

        return {
          ok: false,
          configured: true,
          available: false,
          code: 'PROVIDER_TEST_FAILED',
          reason: detail,
          detail,
          model: null,
        };
      }

      if (result.statusCode >= 200 && result.statusCode < 300) {
        return {
          ok: true,
          configured: true,
          available: true,
        code: 'OK',
        reason: result.model ? `Authenticated (${result.model})` : 'Authenticated',
        detail: '',
        model: result.model || null,
      };
    }

    const isAuthError = result.statusCode === 401 || result.statusCode === 403;
    const fallback = isAuthError
      ? 'Invalid API key'
      : `Provider returned HTTP ${result.statusCode}`;
    const detail = extractProviderErrorMessage(result.body, fallback);
    return {
      ok: false,
      configured: true,
      available: false,
      code: isAuthError ? 'INVALID_KEY' : 'PROVIDER_TEST_FAILED',
      reason: isAuthError ? 'API key rejected' : detail,
      detail,
      model: null,
    };
    } catch (err) {
      if (err.code === 'TIMEOUT') {
        return {
          ok: false,
          configured: true,
          available: false,
          code: 'TIMEOUT',
          reason: provider === 'llm-gateway'
            ? 'Gateway validation timed out'
            : 'Connection to provider timed out',
          detail: '',
          model: null,
        };
      }

    return {
      ok: false,
      configured: true,
      available: false,
      code: 'PROVIDER_TEST_FAILED',
      reason: err.message || 'Connection failed',
      detail: '',
      model: null,
    };
  }
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

  verboseLog('[image-parser-debug] normalizeBase64:', {
    inputLength: (base64Input || '').length,
    startsWithData: trimmed.startsWith('data:'),
    mediaType,
    rawBase64Length: rawBase64.length,
    rawBase64Prefix: rawBase64.slice(0, 80),
    dataUrlLength: dataUrl.length,
    dataUrlPrefix: dataUrl.slice(0, 100),
  });

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
    verboseWarn('[image-parser] WebP/GIF image detected but sharp is not available — sending as-is (may fail)');
    return { rawBase64, mediaType, wasConverted: false, originalSizeBytes, convertedSizeBytes: originalSizeBytes, conversionTimeMs: 0 };
  }

  try {
    const conversionStart = Date.now();
    const inputBuffer = Buffer.from(rawBase64, 'base64');
    const pngBuffer = await sharp(inputBuffer).png().toBuffer();
    const conversionTimeMs = Date.now() - conversionStart;
    verboseLog(`[image-parser] Converted ${mediaType} to PNG (${inputBuffer.length} -> ${pngBuffer.length} bytes) in ${conversionTimeMs}ms`);
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
    verboseError('[image-parser] Failed to convert image to PNG:', err.message);
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

  verboseLog('[lm-debug] url prefix:', dataUrl.substring(0, 100), 'mediaType:', mediaType, 'model:', effectiveModel);
  verboseLog('[lm-debug] rawBase64 length:', imageBase64.length, 'dataUrl length:', dataUrl.length);
  verboseLog('[lm-debug] imageBase64 starts with data:', imageBase64.startsWith('data:'), 'first 80 chars:', imageBase64.substring(0, 80));

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
  }, LM_STUDIO_API_TOKEN ? { Authorization: `Bearer ${LM_STUDIO_API_TOKEN}` } : {}, timeoutMs);

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
  const apiKey = await resolveApiKey('anthropic');
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
  const apiKey = await resolveApiKey('openai');
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
 * LLM Gateway API — OpenAI-compatible POST to your local/custom gateway.
 */
async function callLlmGateway(systemPrompt, imageDataUrl, model, timeoutMs) {
  const apiKey = await resolveApiKey('llm-gateway');

  const effectiveModel = model || LLM_GATEWAY_DEFAULT_MODEL;

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
    chat_template_kwargs: { enable_thinking: false },
  };

  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const res = await jsonRequest('POST', LLM_GATEWAY_API_URL, '/v1/chat/completions', body, headers, timeoutMs);

  if (res.statusCode !== 200) {
    if ((res.statusCode === 401 || res.statusCode === 403) && !apiKey) {
      const err = new Error('LLM Gateway requires an API key');
      err.code = 'PROVIDER_UNAVAILABLE';
      throw err;
    }
    const err = new Error(`LLM Gateway API error (HTTP ${res.statusCode}): ${(res.body || '').slice(0, 500)}`);
    err.code = 'PROVIDER_ERROR';
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    const err = new Error(`LLM Gateway returned invalid JSON: ${(res.body || '').slice(0, 200)}`);
    err.code = 'PROVIDER_ERROR';
    throw err;
  }

  const msg = parsed.choices?.[0]?.message || {};
  const text = msg.content || msg.reasoning_content || '';
  const usage = parsed.usage
    ? { model: parsed.model || effectiveModel, inputTokens: parsed.usage.prompt_tokens || 0, outputTokens: parsed.usage.completion_tokens || 0 }
    : null;

  return { text: text.trim(), usage };
}

/**
 * Google Gemini API — direct HTTPS POST to generativelanguage.googleapis.com/v1beta/models/*:generateContent
 */
async function callGemini(systemPrompt, rawBase64, mediaType, model, timeoutMs) {
  const apiKey = await resolveApiKey('gemini');
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
  const apiKey = await resolveApiKey('kimi');
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

  verboseLog('[image-parser-debug] callKimi request:', {
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
  verboseLog('[image-parser-debug] callKimi payload size:', payloadSize, 'bytes');

  const res = await jsonRequest('POST', 'https://api.moonshot.ai', '/v1/chat/completions', body, {
    'Authorization': `Bearer ${apiKey}`,
  }, timeoutMs);

  verboseLog('[image-parser-debug] callKimi response:', {
    statusCode: res.statusCode,
    bodyLength: (res.body || '').length,
    bodyPreview: (res.body || '').slice(0, 1000),
  });

  if (res.statusCode !== 200) {
    verboseError('[image-parser] Kimi API error:', res.statusCode, res.body?.slice(0, 1000));
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

  verboseLog('[image-parser-debug] callKimi parsed response:', {
    id: parsed.id,
    model: parsed.model,
    choicesCount: parsed.choices?.length,
    finishReason: parsed.choices?.[0]?.finish_reason,
    contentLength: (parsed.choices?.[0]?.message?.content || '').length,
    contentPreview: (parsed.choices?.[0]?.message?.content || '').slice(0, 200),
    reasoningContent: parsed.choices?.[0]?.message?.reasoning_content ? 'PRESENT (length: ' + parsed.choices[0].message.reasoning_content.length + ')' : 'absent',
    usage: parsed.usage,
  });

  const text = parsed.choices?.[0]?.message?.content || '';
  const usage = parsed.usage
    ? { model: parsed.model || effectiveModel, inputTokens: parsed.usage.prompt_tokens || 0, outputTokens: parsed.usage.completion_tokens || 0 }
    : null;

  return { text: text.trim(), usage };
}

// ---------------------------------------------------------------------------
// Role auto-detection from response text
// ---------------------------------------------------------------------------
function detectRole(responseText, options = {}) {
  const promptId = normalizeImageParsePromptId(options.promptId || options.parserPromptId);
  if (promptId === 'follow-up-chat-parser') return 'follow-up-chat';
  if (/^Context type:\s*phone-agent-follow-up/im.test(responseText)) return 'follow-up-chat';
  if (promptId === 'escalation-template-parser') return 'escalation';
  if (/INV-\d{5,}/.test(responseText)) return 'inv-list';
  if (/COID\/MID:|CASE:|CX IS ATTEMPTING TO:/i.test(responseText)) return 'escalation';
  return 'unknown';
}

function hasStructuredParseValue(field, value) {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'string') return true;

  const trimmed = value.trim();
  if (!trimmed) return false;
  if ((field === 'category' || field === 'triedTestAccount') && trimmed.toLowerCase() === 'unknown') {
    return false;
  }
  return true;
}

function buildFollowUpParseMeta(text) {
  const clean = typeof text === 'string' ? text.trim() : '';
  const issues = [];
  const hasContextType = /^Context type:\s*phone-agent-follow-up/im.test(clean);
  const hasTranscriptHeading = /^Verbatim transcript:/im.test(clean);
  const hasParserNote = /^Parser note:/im.test(clean);
  const transcriptMatch = clean.match(/Verbatim transcript:\s*([\s\S]*?)(?:\nParser note:|$)/i);
  const transcript = transcriptMatch ? transcriptMatch[1].trim() : '';

  if (!hasContextType) issues.push('missing_context_type');
  if (!hasTranscriptHeading) issues.push('missing_verbatim_transcript');
  if (!transcript) issues.push('empty_transcript');
  if (!hasParserNote) issues.push('missing_parser_note');

  return {
    type: 'follow-up-chat',
    passed: issues.length === 0,
    score: issues.length === 0 ? 1 : Math.max(0, 1 - (issues.length * 0.25)),
    confidence: issues.length === 0 ? 'high' : 'low',
    issues,
  };
}
function buildStructuredParseResult(text, role) {
  if (role === 'follow-up-chat') {
    return {
      parseFields: {},
      parseMeta: buildFollowUpParseMeta(text),
    };
  }

  if (role !== 'escalation') {
    return {
      parseFields: {},
      parseMeta: null,
    };
  }

  const canonicalTemplate = validateCanonicalEscalationTemplateText(text);
  const parsed = parseEscalationText(text);
  const validation = validateParsedEscalation(parsed, { sourceText: text });
  const parseFields = {};

  for (const [field, value] of Object.entries(validation.normalizedFields || {})) {
    if (hasStructuredParseValue(field, value)) {
      parseFields[field] = value;
    }
  }

  if (Object.keys(parseFields).length > 0) {
    const triageCard = buildServerTriageCard(validation.normalizedFields);
    if (triageCard?.severity) {
      parseFields.severity = triageCard.severity;
    }
  }

  return {
    parseFields,
    parseMeta: {
      passed: validation.passed && canonicalTemplate.ok,
      score: validation.score,
      confidence: validation.confidence,
      issues: [
        ...validation.issues,
        ...canonicalTemplate.issues.map((issue) => `canonical_${issue.code}`),
      ],
      fieldsFound: validation.fieldsFound,
      semanticPassed: validation.passed,
      canonicalTemplate: {
        passed: canonicalTemplate.ok,
        issues: canonicalTemplate.issues,
        labels: canonicalTemplate.labels,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Main entry — parseImage()
// ---------------------------------------------------------------------------

/**
 * @param {string} imageBase64 - Raw base64 or data-URI string
 * @param {Object} options
 * @param {string} options.provider - 'llm-gateway' | 'lm-studio' | 'anthropic' | 'openai' | 'kimi' | 'gemini'
 * @param {string} [options.model] - Model ID override
 * @param {number} [options.timeoutMs=60000] - Request timeout
 * @returns {Promise<{
 *   text: string,
 *   role: 'escalation'|'inv-list'|'unknown',
 *   usage: Object|null,
 *   parseFields: Object,
 *   parseMeta: Object|null,
 *   stats: Object,
 * }>}
 */
async function parseImage(imageBase64, options = {}) {
  const { provider, model, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const promptId = normalizeImageParsePromptId(options.promptId || options.parserPromptId);
  const systemPrompt = getRenderedAgentPrompt(promptId);

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
    case 'llm-gateway':
      result = await callLlmGateway(systemPrompt, normalized.dataUrl, model, timeoutMs);
      break;
    case 'lm-studio':
      result = await callLmStudio(systemPrompt, normalized.rawBase64, normalized.mediaType, model, timeoutMs);
      break;
    case 'anthropic':
      result = await callAnthropic(systemPrompt, normalized.rawBase64, normalized.mediaType, model, timeoutMs);
      break;
    case 'openai':
      result = await callOpenAI(systemPrompt, normalized.dataUrl, model, timeoutMs);
      break;
    case 'gemini':
      result = await callGemini(systemPrompt, normalized.rawBase64, normalized.mediaType, model, timeoutMs);
      break;
    case 'kimi':
      result = await callKimi(systemPrompt, normalized.dataUrl, model, timeoutMs);
      break;
    default: {
      const err = new Error(`Invalid provider: ${provider}. Must be one of: llm-gateway, lm-studio, anthropic, openai, kimi, gemini`);
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

  const role = detectRole(result.text, { promptId });
  const { parseFields, parseMeta } = buildStructuredParseResult(result.text, role);

  return {
    text: result.text,
    role,
    promptId,
    usage: result.usage,
    parseFields,
    parseMeta,
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
 * @returns {Promise<Object>} { 'llm-gateway': { available, reason }, 'lm-studio': { ... }, anthropic: { ... }, openai: { ... } }
 */
async function resolveProviderAvailability() {
  const providers = {};

  const gatewayKey = await resolveApiKey('llm-gateway');
  providers['llm-gateway'] = await validateRemoteProvider('llm-gateway', gatewayKey);

  const lmStudioSnapshot = await getModelSnapshot(LM_STUDIO_API_URL, { timeoutMs: 3000 });
  const lmStudioModel = lmStudioSnapshot.loadedModel || lmStudioSnapshot.availableModel || null;
  const lmStudioReason = lmStudioSnapshot.loadedModel
    ? `Model loaded: ${lmStudioSnapshot.loadedModel}`
    : lmStudioSnapshot.availableModel
      ? `Model available: ${lmStudioSnapshot.availableModel}`
      : (lmStudioSnapshot.status === 'no_model_loaded' || lmStudioSnapshot.status === 'no_models_available')
        ? 'No model loaded in LM Studio'
        : lmStudioSnapshot.reason || 'LM Studio unavailable';
  providers['lm-studio'] = {
    available: !!lmStudioModel,
    model: lmStudioModel,
    reason: lmStudioReason,
  };

  const anthropicKey = await resolveApiKey('anthropic');
  providers['anthropic'] = await validateRemoteProvider('anthropic', anthropicKey);

  const openaiKey = await resolveApiKey('openai');
  providers['openai'] = await validateRemoteProvider('openai', openaiKey);

  const kimiKey = await resolveApiKey('kimi');
  providers['kimi'] = await validateRemoteProvider('kimi', kimiKey);

  const geminiKey = await resolveApiKey('gemini');
  providers['gemini'] = await validateRemoteProvider('gemini', geminiKey);

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
  normalizeImageParsePromptId,
  detectMediaTypeFromBase64,
  detectRole,
  convertToPngIfNeeded,
  getStoredApiKey,
  getApiKey,
  resolveApiKey,
  getAllStoredKeys,
  setStoredApiKey,
  extractProviderErrorMessage,
  testRemoteProviderKey,
  validateRemoteProvider,
  KEYS_FILE,
  SYSTEM_PROMPT,
};
