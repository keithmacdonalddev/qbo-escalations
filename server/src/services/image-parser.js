'use strict';

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const codex = require('./codex');
const { getLoadedModel, getModelSnapshot } = require('./lm-studio');
const {
  getCodexProviderIds,
  getProviderModelId,
} = require('./providers/catalog');
const {
  sendLlmGatewayChatCompletion,
} = require('./providers/llm-gateway-provider-harness');
const {
  sendGeminiGenerateContent,
} = require('./providers/gemini-api-provider-harness');
const {
  sendLmStudioChatCompletion,
} = require('./providers/lm-studio-provider-harness');
const ImageParserApiKey = require('../models/ImageParserApiKey');
const ProviderCallPackage = require('../models/ProviderCallPackage');
const { createThinkingCoalescer } = require('../lib/thinking-coalescer');
const { getRenderedAgentPrompt } = require('../lib/agent-prompt-store');
const { buildServerTriageCard } = require('../lib/chat-triage');
const {
  CANONICAL_ESCALATION_TEMPLATE_LABELS,
  validateCanonicalEscalationTemplateText,
} = require('../lib/escalation-template-contract');
const { parseEscalationText } = require('../lib/escalation-parser');
const { validateParsedEscalation } = require('../lib/parse-validation');
const { extractCodexUsage } = require('../lib/usage-extractor');
const {
  isStubbed: isProvidersStubbed,
  getProviderStub,
  MissingProviderStubError,
} = require('../lib/harness-provider-gate');
const {
  buildResponseChunk,
  isProviderCallPackageCaptureEnabled,
  recordHttpProviderCallPackage,
  recordGeminiApiProviderCallPackageInBackground,
  recordLlmGatewayProviderCallPackageInBackground,
  recordLmStudioProviderCallPackageInBackground,
} = require('./provider-call-package-recorder');

// Anthropic Agent SDK provider adapter. Loaded lazily so the ESM-only SDK is
// not imported at module load time, and so test fixtures can substitute the
// export via require.cache before the SDK path is exercised.
function loadSdkImageParse() {
  // eslint-disable-next-line global-require
  return require('./sdk-image-parse');
}

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
const LLM_GATEWAY_API_URL = process.env.LLM_GATEWAY_API_URL || 'http://127.0.0.1:4100';
const OPENAI_DEFAULT_IMAGE_MODEL = process.env.OPENAI_IMAGE_PARSE_MODEL || process.env.OPENAI_PARSE_MODEL || 'gpt-5.4-mini';
const OPENAI_PROVIDER_TEST_MAX_TOKENS = 64;
const DEFAULT_TIMEOUT_MS = 120000;
const KEYS_FILE = path.join(__dirname, '..', '..', 'data', 'image-parser-keys.json');
const IMAGE_PARSER_VERBOSE_LOGS = process.env.IMAGE_PARSER_VERBOSE_LOGS === '1';
const DEFAULT_IMAGE_PARSE_PROMPT_ID = 'escalation-template-parser';
const DIRECT_IMAGE_PARSER_PROVIDER_IDS = Object.freeze([
  'llm-gateway',
  'lm-studio',
  'anthropic',
  'openai',
  'kimi',
  'gemini',
]);
const CODEX_IMAGE_PARSER_PROVIDER_IDS = Object.freeze(getCodexProviderIds());
const CODEX_IMAGE_PARSER_PROVIDER_ID_SET = new Set(CODEX_IMAGE_PARSER_PROVIDER_IDS);
const CODEX_IMAGE_PARSER_PROVIDER_MODELS = Object.freeze(
  CODEX_IMAGE_PARSER_PROVIDER_IDS.reduce((acc, providerId) => {
    acc[providerId] = getProviderModelId(providerId) || providerId;
    return acc;
  }, {})
);
const VALID_IMAGE_PARSER_PROVIDERS = Object.freeze([
  ...DIRECT_IMAGE_PARSER_PROVIDER_IDS,
  ...CODEX_IMAGE_PARSER_PROVIDER_IDS,
]);
const OPENAI_REASONING_EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh']);
const IMAGE_PARSE_PROMPT_IDS = new Set([
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

function emitUserVisibleStatus(eventBus, kind, message, status, data = {}) {
  eventBus?.emit(kind, {
    ...data,
    status,
    displayMessage: `${message} - ${status}`,
    surfaceToUser: true,
  });
}

function normalizeImageParsePromptId(value) {
  const promptId = typeof value === 'string' ? value.trim() : '';
  return IMAGE_PARSE_PROMPT_IDS.has(promptId) ? promptId : DEFAULT_IMAGE_PARSE_PROMPT_ID;
}

function normalizeOpenAiReasoningEffort(value) {
  const requested = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return OPENAI_REASONING_EFFORTS.has(requested) ? requested : '';
}

function isOpenAiReasoningModel(model) {
  const normalized = String(model || '').trim().toLowerCase();
  return /^gpt-5(?:[.\-\w]*)?$/.test(normalized) || /^o\d/.test(normalized);
}

function applyOpenAiGenerationOptions(body, model, reasoningEffort, maxTokens = 4096) {
  if (!body || typeof body !== 'object') return body;
  if (isOpenAiReasoningModel(model)) {
    body.max_completion_tokens = maxTokens;
    const effort = normalizeOpenAiReasoningEffort(reasoningEffort);
    if (effort) body.reasoning_effort = effort;
  } else {
    body.max_tokens = maxTokens;
    body.temperature = 0.1;
  }
  return body;
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
    model: OPENAI_DEFAULT_IMAGE_MODEL,
    buildBody: (model) => JSON.stringify(applyOpenAiGenerationOptions({
      model,
      messages: [{ role: 'user', content: 'Reply with OK only.' }],
    }, model, 'low', OPENAI_PROVIDER_TEST_MAX_TOKENS)),
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
      // key is select:false on the model — opt it in explicitly for this read.
      const doc = await ImageParserApiKey.findOne({ provider }).select('+key').lean();
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
      // key is select:false on the model — opt it in explicitly for this read.
      const docs = await ImageParserApiKey.find({}).select('+key').lean();
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

function emitAvailabilityTrace(trace, step = {}) {
  if (typeof trace !== 'function') return;
  try {
    trace(step);
  } catch {
    // Availability tracing should never change provider health behavior.
  }
}

async function traceAvailabilityCall(trace, step, call) {
  const startedAt = new Date();
  try {
    const result = typeof call === 'function' ? await call() : undefined;
    emitAvailabilityTrace(trace, {
      ...step,
      status: step.status || 'success',
      startedAt,
      completedAt: new Date(),
    });
    return result;
  } catch (err) {
    emitAvailabilityTrace(trace, {
      ...step,
      status: 'error',
      summary: err.message || step.summary || `${step.functionName || step.name} failed`,
      detail: err.stack || err.message || '',
      startedAt,
      completedAt: new Date(),
    });
    throw err;
  }
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

function isCodexImageParserProvider(provider) {
  return CODEX_IMAGE_PARSER_PROVIDER_ID_SET.has(provider);
}

function getCodexImageParserModel(provider, model) {
  const requested = typeof model === 'string' ? model.trim() : '';
  if (requested) return requested;
  return CODEX_IMAGE_PARSER_PROVIDER_MODELS[provider] || provider || '';
}

function checkCodexCliAvailability(model) {
  if (isProvidersStubbed()) {
    return Promise.resolve({
      available: true,
      code: 'OK',
      reason: 'Codex CLI stubbed',
      model,
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    let errorOutput = '';

    function finish(payload) {
      if (settled) return;
      settled = true;
      resolve(payload);
    }

    const child = spawn('codex', ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env, CLAUDECODE: undefined },
    });

    const timeout = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      finish({
        available: false,
        code: 'TIMEOUT',
        reason: 'Codex CLI availability check timed out',
        model,
      });
    }, 3000);

    child.stdout.on('data', (chunk) => {
      if (output.length < 1000) output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      if (errorOutput.length < 1000) errorOutput += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      finish({
        available: false,
        code: 'CLI_UNAVAILABLE',
        reason: err.message || 'Codex CLI unavailable',
        model,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        const version = output.trim().split(/\r?\n/)[0] || 'Codex CLI ready';
        finish({
          available: true,
          code: 'OK',
          reason: version,
          model,
        });
        return;
      }

      finish({
        available: false,
        code: 'CLI_UNAVAILABLE',
        reason: (errorOutput || output || `Codex CLI exited with code ${code}`).trim().slice(0, 240),
        model,
      });
    });
  });
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

function buildProviderStatusCaptureContext(provider, modelRequested = '') {
  const isGateway = provider === 'llm-gateway';
  return {
    providerId: provider,
    providerResearchId: isGateway ? 'llm-gateway' : `${provider}-api`,
    providerPathType: isGateway ? 'gateway-http' : 'direct-http',
    callSite: `image-parser:validateRemoteProvider:${provider}`,
    operation: 'provider-status',
    source: {
      file: 'server/src/services/image-parser.js',
      functionName: 'validateRemoteProvider',
      helperName: 'testRemoteProviderKey',
    },
    modelRequested,
  };
}

function buildGatewayProviderStatusCaptureContext(modelRequested = '') {
  return buildProviderStatusCaptureContext('llm-gateway', modelRequested);
}

function testRemoteProviderKey(provider, apiKey, captureContext = null) {
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
    const captureEnabled = Boolean(captureContext) && isProviderCallPackageCaptureEnabled();
    const requestStartedAt = captureEnabled ? new Date().toISOString() : null;
    let requestWrittenAt = null;
    let responseHeadersAt = null;
    let responseChunks = [];
    let settled = false;
    const baseUrl = targetUrl
      ? `${targetUrl.protocol}//${targetUrl.host}`
      : `https://${hostname}`;
    const capture = ({ response = null, error = null, outcome = null }) => {
      if (!captureEnabled) return;
      void recordCapturedHttpPackage({
        method,
        baseUrl,
        urlPath: pathName,
        body: payload || null,
        headers,
        timeoutMs: 3_000,
        captureContext,
        requestStartedAt,
        requestWrittenAt,
        responseHeadersAt,
        responseCompletedAt: new Date().toISOString(),
        response,
        error,
        outcome,
      });
    };

    const req = requestLib.request({
      hostname,
      port,
      path: pathName,
      method,
      headers,
      timeout: 3_000,
    }, (res) => {
      let data = '';
      if (captureEnabled) {
        responseHeadersAt = new Date().toISOString();
      }
      res.on('data', (chunk) => {
        data += chunk;
        if (captureEnabled) {
          responseChunks.push(buildResponseChunk(responseChunks.length, chunk, new Date()));
        }
      });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        const response = {
          statusCode: res.statusCode || 0,
          statusMessage: res.statusMessage || '',
          httpVersion: res.httpVersion || '',
          headers: res.headers || {},
          rawHeaders: res.rawHeaders || [],
          trailers: res.trailers || {},
          rawTrailers: res.rawTrailers || [],
          bodyChunks: responseChunks,
          bodyText: data,
        };
        capture({ response });
        resolve({ statusCode: res.statusCode, body: data, model: cfg.model });
      });
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      capture({ error: err });
      reject(err);
    });
    req.on('timeout', () => {
      if (settled) return;
      settled = true;
      req.destroy();
      const err = new Error('Request timed out');
      err.code = 'TIMEOUT';
      capture({ error: err, outcome: 'timeout' });
      reject(err);
    });
    if (payload) req.write(payload);
    if (captureEnabled) {
      requestWrittenAt = new Date().toISOString();
    }
    req.end();
  });
}

async function validateRemoteProvider(provider, apiKey) {
  if (isProvidersStubbed()) {
    const stub = getProviderStub(provider, 'validateRemoteProvider');
    if (!stub) throw new MissingProviderStubError(provider, 'validateRemoteProvider');
    return stub({ provider, apiKey });
  }

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
      const result = await testRemoteProviderKey(
        provider,
        trimmedKey,
        provider === 'llm-gateway' || provider === 'gemini'
          ? buildProviderStatusCaptureContext(provider, REMOTE_PROVIDER_TEST_CONFIGS[provider]?.model || '')
          : null
      );
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

async function recordCapturedHttpPackage(captureInput) {
  if (captureInput?.captureContext?.providerId === 'lm-studio') {
    return recordLmStudioProviderCallPackageInBackground({
      ...captureInput,
      mode: 'non-stream',
    });
  }
  if (captureInput?.captureContext?.providerId === 'llm-gateway') {
    return recordLlmGatewayProviderCallPackageInBackground(captureInput);
  }
  if (captureInput?.captureContext?.providerId === 'gemini') {
    return recordGeminiApiProviderCallPackageInBackground(captureInput);
  }
  const result = await recordHttpProviderCallPackage(captureInput);
  return result;
}

function jsonRequest(method, baseUrl, urlPath, body, headers, timeoutMs, captureContext = null) {
  return new Promise((resolve, reject) => {
    const { transport, hostname, port } = resolveTransport(baseUrl);
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const captureEnabled = Boolean(captureContext) && isProviderCallPackageCaptureEnabled();
    const requestStartedAt = captureEnabled ? new Date().toISOString() : null;
    let requestWrittenAt = null;
    let responseHeadersAt = null;
    let responseChunks = [];
    let settled = false;

    const options = {
      hostname,
      port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...headers },
      timeout: timeoutMs || 30000,
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);

    const capture = async ({ response = null, error = null, outcome = null }) => {
      if (!captureEnabled) return;
      await recordCapturedHttpPackage({
        method,
        baseUrl,
        urlPath,
        body,
        headers: options.headers,
        timeoutMs: options.timeout,
        captureContext,
        requestStartedAt,
        requestWrittenAt,
        responseHeadersAt,
        responseCompletedAt: new Date().toISOString(),
        response,
        error,
        outcome,
      });
    };

    const req = transport.request(options, (res) => {
      let data = '';
      if (captureEnabled) {
        responseHeadersAt = new Date().toISOString();
      }
      res.on('data', (chunk) => {
        data += chunk;
        if (captureEnabled) {
          responseChunks.push(buildResponseChunk(responseChunks.length, chunk, new Date()));
        }
      });
      res.on('end', async () => {
        if (settled) return;
        settled = true;
        const response = {
          statusCode: res.statusCode || 0,
          statusMessage: res.statusMessage || '',
          httpVersion: res.httpVersion || '',
          headers: res.headers || {},
          rawHeaders: res.rawHeaders || [],
          trailers: res.trailers || {},
          rawTrailers: res.rawTrailers || [],
          bodyChunks: responseChunks,
          bodyText: data,
        };
        await capture({ response });
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on('error', async (err) => {
      if (settled) return;
      settled = true;
      await capture({ error: err });
      reject(err);
    });
    req.on('timeout', async () => {
      if (settled) return;
      settled = true;
      req.destroy();
      const err = new Error('Request timed out');
      err.code = 'TIMEOUT';
      await capture({ error: err, outcome: 'timeout' });
      reject(err);
    });
    if (payload) {
      req.write(payload);
    }
    if (captureEnabled) {
      requestWrittenAt = new Date().toISOString();
    }
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
    dataUrlLength: dataUrl.length,
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
async function callLmStudio(systemPrompt, imageBase64, mediaType, model, timeoutMs, eventBus) {
  const effectiveModel = model || await getLoadedModel(LM_STUDIO_API_URL);

  // llama.cpp (LM Studio backend) only supports PNG and JPEG — convert others
  const needsConversion = mediaType === 'image/webp' || mediaType === 'image/gif';
  if (needsConversion) {
    eventBus?.emit('parser.image_conversion_started', {
      from: mediaType,
      to: 'image/png',
    });
  }
  const converted = await convertToPngIfNeeded(imageBase64, mediaType);
  if (needsConversion) {
    eventBus?.emit('parser.image_conversion_completed', {
      from: mediaType,
      to: converted.mediaType,
      wasConverted: Boolean(converted.wasConverted),
      originalSizeBytes: converted.originalSizeBytes,
      convertedSizeBytes: converted.convertedSizeBytes,
      conversionTimeMs: converted.conversionTimeMs,
    });
  }
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

  verboseLog('[lm-debug] image payload resolved:', {
    mediaType,
    model: effectiveModel,
    dataUrlLength: dataUrl.length,
  });
  verboseLog('[lm-debug] rawBase64 length:', imageBase64.length, 'dataUrl length:', dataUrl.length);
  verboseLog('[lm-debug] imageBase64 starts with data:', imageBase64.startsWith('data:'));

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

  const requestBody = {
    model: effectiveModel,
    messages,
    stream: false,
    temperature: 0.1,
    max_tokens: 4096,
    chat_template_kwargs: { enable_thinking: false },
  };

  emitUserVisibleStatus(
    eventBus,
    'parser.agent_handoff_to_provider',
    'Escalation image parsing agent hand off payload to lm-studio Agent',
    'started',
    { provider: 'lm-studio', model: effectiveModel || '' }
  );
  emitUserVisibleStatus(
    eventBus,
    'provider.agent_payload_received',
    'lm-studio provider harness received payload',
    'received',
    {
      provider: 'lm-studio',
      operation: 'image-parse',
      model: effectiveModel,
    }
  );

  const result = await sendLmStudioChatCompletion({
    body: requestBody,
    model: effectiveModel,
    timeoutMs,
    captureContext: {
      callSite: 'image-parser:callLmStudio',
      operation: 'image-parse',
      functionName: 'callLmStudio',
      forceCapture: true,
      modelRequested: effectiveModel,
      metadata: {
        imageMediaType: mediaType,
        imageSizeBytes: Buffer.byteLength(imageBase64 || '', 'base64'),
      },
    },
    onProviderEvent: (eventType, payload) => eventBus?.emit(eventType, payload),
  });
  emitUserVisibleStatus(
    eventBus,
    'provider.agent_handoff_to_parser',
    'lm-studio agent hand off to Escalation image parsing agent',
    'complete',
    {
      provider: 'lm-studio',
      providerPackageId: result?.providerTrace?.providerPackageId || null,
    }
  );

  const payloadResult = await buildLmStudioImageParserResultFromProviderPackage(result.providerTrace, {
    eventBus,
    model: effectiveModel,
  });

  return {
    ...result,
    text: payloadResult.text,
    usage: payloadResult.usage || null,
    conversionStats,
    providerTrace: {
      ...(result.providerTrace || {}),
      providerPayload: payloadResult.providerPayloadTrace,
    },
  };
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
  }, timeoutMs, {
    providerId: 'anthropic',
    providerResearchId: 'anthropic-api',
    providerPathType: 'direct-http',
    callSite: 'image-parser:callAnthropic',
    operation: 'image-parse',
    source: {
      file: 'server/src/services/image-parser.js',
      functionName: 'callAnthropic',
      helperName: 'jsonRequest',
    },
    modelRequested: effectiveModel,
  });

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
 * Anthropic SDK path — delegates provider-specific response handling to the
 * Agent SDK adapter and returns the model's answer text. It does not decide
 * whether the answer is a good parser result; downstream validation owns that.
 */
async function callAnthropicSdk(rawBase64, mediaType, model, reasoningEffort, timeoutMs) {
  const apiKey = await resolveApiKey('anthropic');
  if (!apiKey) {
    const err = new Error('Anthropic API key not configured');
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }

  const { parseImageWithSDK } = loadSdkImageParse();

  // Rebuild a data-URI string for parseImageWithSDK; it accepts either raw
  // base64 or a data: URI but the URI form preserves the media type we
  // already detected upstream.
  const dataUri = `data:${mediaType || 'image/png'};base64,${rawBase64}`;

  const sdkResult = await parseImageWithSDK(dataUri, {
    model,
    reasoningEffort,
    timeoutMs,
  });

  if (!sdkResult || typeof sdkResult.text !== 'string') {
    const err = new Error('Anthropic SDK parse failed — SDK returned no answer text');
    err.code = 'PROVIDER_ERROR';
    throw err;
  }

  return { text: sdkResult.text, usage: sdkResult.usage || null };
}

/**
 * OpenAI API — direct HTTPS POST to api.openai.com/v1/chat/completions
 */
async function callOpenAI(systemPrompt, imageDataUrl, model, reasoningEffort, timeoutMs) {
  const apiKey = await resolveApiKey('openai');
  if (!apiKey) {
    const err = new Error('OpenAI API key not configured');
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }

  const effectiveModel = model || OPENAI_DEFAULT_IMAGE_MODEL;

  const body = applyOpenAiGenerationOptions({
    model: effectiveModel,
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
  }, effectiveModel, reasoningEffort);

  const res = await jsonRequest('POST', 'https://api.openai.com', '/v1/chat/completions', body, {
    'Authorization': `Bearer ${apiKey}`,
  }, timeoutMs, {
    providerId: 'openai',
    providerResearchId: 'openai-api',
    providerPathType: 'direct-http',
    callSite: 'image-parser:callOpenAI',
    operation: 'image-parse',
    source: {
      file: 'server/src/services/image-parser.js',
      functionName: 'callOpenAI',
      helperName: 'jsonRequest',
    },
    modelRequested: effectiveModel,
  });

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
async function callGemini(systemPrompt, rawBase64, mediaType, model, timeoutMs, eventBus = null) {
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

  const result = await sendGeminiGenerateContent({
    body,
    model: effectiveModel,
    timeoutMs,
    getApiKey: () => resolveApiKey('gemini'),
    captureContext: {
      callSite: 'image-parser:callGemini',
      operation: 'image-parse',
      functionName: 'callGemini',
      forceCapture: true,
      modelRequested: effectiveModel,
      metadata: {
        imageMediaType: mediaType,
        imageSizeBytes: Buffer.byteLength(rawBase64 || '', 'base64'),
      },
    },
    onProviderEvent: (eventType, payload) => eventBus?.emit(eventType, payload),
  });

  emitUserVisibleStatus(
    eventBus,
    'provider.agent_handoff_to_parser',
    'Gemini API provider harness handed off payload to Escalation image parsing agent',
    'complete',
    {
      provider: 'gemini',
      providerPackageId: result?.providerTrace?.providerPackageId || null,
    }
  );

  const payloadResult = await buildGeminiImageParserResultFromProviderPackage(result.providerTrace, {
    eventBus,
    model: effectiveModel,
  });

  return {
    ...result,
    text: payloadResult.text,
    usage: payloadResult.usage || null,
    providerTrace: {
      ...(result.providerTrace || {}),
      providerPayload: payloadResult.providerPayloadTrace,
    },
  };
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
    messageStructure: JSON.stringify(body.messages.map(m => ({
      role: m.role,
      contentType: typeof m.content,
      contentLength: typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length,
    }))),
    apiKeyConfigured: Boolean(apiKey),
    timeoutMs,
  });
  const payloadSize = JSON.stringify(body).length;
  verboseLog('[image-parser-debug] callKimi payload size:', payloadSize, 'bytes');

  const res = await jsonRequest('POST', 'https://api.moonshot.ai', '/v1/chat/completions', body, {
    'Authorization': `Bearer ${apiKey}`,
  }, timeoutMs, {
    providerId: 'kimi',
    providerResearchId: 'kimi-api',
    providerPathType: 'direct-http',
    callSite: 'image-parser:callKimi',
    operation: 'image-parse',
    source: {
      file: 'server/src/services/image-parser.js',
      functionName: 'callKimi',
      helperName: 'jsonRequest',
    },
    modelRequested: effectiveModel,
  });

  verboseLog('[image-parser-debug] callKimi response:', {
    statusCode: res.statusCode,
    bodyLength: (res.body || '').length,
  });

  if (res.statusCode !== 200) {
    verboseError('[image-parser] Kimi API error:', res.statusCode, 'bodyLength:', (res.body || '').length);
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
    reasoningContent: parsed.choices?.[0]?.message?.reasoning_content ? 'PRESENT (length: ' + parsed.choices[0].message.reasoning_content.length + ')' : 'absent',
    usage: parsed.usage,
  });

  const text = parsed.choices?.[0]?.message?.content || '';
  const usage = parsed.usage
    ? { model: parsed.model || effectiveModel, inputTokens: parsed.usage.prompt_tokens || 0, outputTokens: parsed.usage.completion_tokens || 0 }
    : null;

  return { text: text.trim(), usage };
}

async function callCodex(systemPrompt, imageDataUrl, provider, model, reasoningEffort, serviceTier, timeoutMs, eventBus) {
  const effectiveModel = getCodexImageParserModel(provider, model);

  return new Promise((resolve, reject) => {
    let streamedText = '';
    let settled = false;
    const coalescer = createThinkingCoalescer((delta) => {
      eventBus?.emit('llm.thinking', {
        provider,
        model: effectiveModel || '',
        delta,
      });
    });

    function finishOk(text, usage, providerTrace) {
      if (settled) return;
      settled = true;
      coalescer.flush();
      resolve({
        text: String(text || streamedText || '').trim(),
        usage: usage || (effectiveModel ? { model: effectiveModel } : null),
        providerTrace: providerTrace || null,
      });
    }

    function finishErr(err) {
      if (settled) return;
      settled = true;
      coalescer.flush();
      const error = err instanceof Error ? err : new Error(String(err));
      if (!error.code) error.code = 'PROVIDER_ERROR';
      reject(error);
    }

    try {
      codex.chat({
        messages: [
          {
            role: 'user',
            content: 'Read the image and output only the parser result required by the system instructions.',
          },
        ],
        systemPrompt,
        images: [imageDataUrl],
        model: effectiveModel,
        reasoningEffort: reasoningEffort || process.env.CODEX_PARSE_REASONING_EFFORT,
        serviceTier,
        timeoutMs,
        captureContext: {
          providerId: provider || 'codex',
          providerResearchId: 'openai-cli',
          providerPathType: 'cli',
          callSite: 'image-parser:callCodex',
          operation: 'image-parse',
          forceCapture: true,
          modelRequested: effectiveModel,
          reasoningEffort: reasoningEffort || process.env.CODEX_PARSE_REASONING_EFFORT,
          source: {
            file: 'server/src/services/image-parser.js',
            functionName: 'callCodex',
            helperName: 'codex.chat',
            spawnSite: 'codex.chat',
          },
        },
        onChunk: (chunk) => { streamedText += chunk || ''; },
        onThinkingChunk: (delta) => { coalescer.push(typeof delta === 'string' ? delta : ''); },
        onDone: finishOk,
        onError: finishErr,
      });
    } catch (err) {
      finishErr(err);
    }
  });
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

function providerPackageWaitMs() {
  const raw = Number.parseInt(process.env.IMAGE_PARSER_PROVIDER_PACKAGE_WAIT_MS, 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 60_000) : 30_000;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createProviderPackageError(message, code = 'PROVIDER_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

async function loadProviderCallPackagePayloadRef(ref) {
  if (!ref || typeof ref.ref !== 'string' || !ref.ref.trim()) {
    return null;
  }

  const fullPath = path.resolve(__dirname, '..', '..', '..', ref.ref);
  try {
    return await fs.promises.readFile(fullPath, 'utf8');
  } catch (err) {
    throw createProviderPackageError(`Failed to read provider package payload ref ${ref.ref}: ${err.message}`);
  }
}

async function loadLlmGatewayParsedJsonFromPackage(providerPackage) {
  const response = providerPackage?.llmGateway?.response || {};
  if (response.parsedJson && typeof response.parsedJson === 'object') {
    return response.parsedJson;
  }

  let bodyText = typeof response.bodyText === 'string' ? response.bodyText : '';
  if (!bodyText && response.bodyTextPayloadRef) {
    bodyText = await loadProviderCallPackagePayloadRef(response.bodyTextPayloadRef);
  }
  if (!bodyText && response.parsedJsonPayloadRef) {
    const payload = await loadProviderCallPackagePayloadRef(response.parsedJsonPayloadRef);
    if (payload) {
      return JSON.parse(payload);
    }
  }
  if (!bodyText) {
    throw createProviderPackageError('LLM Gateway provider package did not include a response body for the image parser to inspect');
  }

  try {
    return JSON.parse(bodyText);
  } catch (err) {
    throw createProviderPackageError(`LLM Gateway provider package response body is not valid JSON: ${err.message}`);
  }
}

async function loadLmStudioParsedJsonFromPackage(providerPackage) {
  const response = providerPackage?.lmStudio?.response || {};
  if (response.parsedJson && typeof response.parsedJson === 'object') {
    return response.parsedJson;
  }

  let bodyText = typeof response.bodyText === 'string' ? response.bodyText : '';
  if (!bodyText && response.bodyTextPayloadRef) {
    bodyText = await loadProviderCallPackagePayloadRef(response.bodyTextPayloadRef);
  }
  if (!bodyText && response.parsedJsonPayloadRef) {
    const payload = await loadProviderCallPackagePayloadRef(response.parsedJsonPayloadRef);
    if (payload) {
      return JSON.parse(payload);
    }
  }
  if (!bodyText) {
    throw createProviderPackageError('LM Studio provider package did not include a response body for the image parser to inspect');
  }

  try {
    return JSON.parse(bodyText);
  } catch (err) {
    throw createProviderPackageError(`LM Studio provider package response body is not valid JSON: ${err.message}`);
  }
}

async function loadGeminiParsedJsonFromPackage(providerPackage) {
  const response = providerPackage?.geminiApi?.response || {};
  if (response.parsedJson && typeof response.parsedJson === 'object') {
    return response.parsedJson;
  }

  let bodyText = typeof response.bodyText === 'string' ? response.bodyText : '';
  if (!bodyText && response.bodyTextPayloadRef) {
    bodyText = await loadProviderCallPackagePayloadRef(response.bodyTextPayloadRef);
  }
  if (!bodyText && response.parsedJsonPayloadRef) {
    const payload = await loadProviderCallPackagePayloadRef(response.parsedJsonPayloadRef);
    if (payload) {
      return JSON.parse(payload);
    }
  }
  if (!bodyText) {
    throw createProviderPackageError('Gemini provider package did not include a response body for the image parser to inspect');
  }

  try {
    return JSON.parse(bodyText);
  } catch (err) {
    throw createProviderPackageError(`Gemini provider package response body is not valid JSON: ${err.message}`);
  }
}

function buildUsageFromOpenAiCompatibleJson(parsed, modelFallback = '') {
  return parsed?.usage
    ? {
        model: parsed.model || modelFallback || '',
        inputTokens: parsed.usage.prompt_tokens || 0,
        outputTokens: parsed.usage.completion_tokens || 0,
        totalTokens: parsed.usage.total_tokens || 0,
      }
    : null;
}

function extractGeminiTextFromJson(parsed) {
  return (parsed?.candidates?.[0]?.content?.parts || [])
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function buildUsageFromGeminiJson(parsed, modelFallback = '') {
  const usageMeta = parsed?.usageMetadata;
  if (!usageMeta) return null;
  const inputTokens = usageMeta.promptTokenCount || 0;
  const outputTokens = usageMeta.candidatesTokenCount != null
    ? usageMeta.candidatesTokenCount
    : Math.max((usageMeta.totalTokenCount || 0) - inputTokens, 0);
  return {
    model: parsed?.modelVersion || modelFallback || '',
    inputTokens,
    outputTokens,
    totalTokens: usageMeta.totalTokenCount || inputTokens + outputTokens,
  };
}

async function loadCodexStdoutJsonlEventsFromPackage(providerPackage) {
  const stdout = providerPackage?.cli?.stdout || {};
  if (Array.isArray(stdout.jsonlEvents) && stdout.jsonlEvents.length) {
    return stdout.jsonlEvents;
  }

  if (stdout.jsonlEventsPayloadRef) {
    const payload = await loadProviderCallPackagePayloadRef(stdout.jsonlEventsPayloadRef);
    if (payload) {
      const parsed = JSON.parse(payload);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  }

  let lines = Array.isArray(stdout.lines) ? stdout.lines : [];
  if ((!lines || lines.length === 0) && stdout.linesPayloadRef) {
    const payload = await loadProviderCallPackagePayloadRef(stdout.linesPayloadRef);
    if (payload) {
      try {
        const parsed = JSON.parse(payload);
        lines = Array.isArray(parsed) ? parsed : String(payload).split(/\r?\n/);
      } catch {
        lines = String(payload).split(/\r?\n/);
      }
    }
  }

  if ((!lines || lines.length === 0) && typeof stdout.text === 'string' && stdout.text.trim()) {
    lines = stdout.text.split(/\r?\n/);
  }
  if ((!lines || lines.length === 0) && stdout.textPayloadRef) {
    const payload = await loadProviderCallPackagePayloadRef(stdout.textPayloadRef);
    if (payload) {
      lines = payload.split(/\r?\n/);
    }
  }

  return (lines || [])
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function extractCodexVisibleTextFromEvent(event, seenAgentTextByItem) {
  if (!event || typeof event !== 'object') return '';

  if (event.item && event.item.type === 'agent_message' && typeof event.item.text === 'string') {
    const id = event.item.id || '__default__';
    const prevText = seenAgentTextByItem.get(id) || '';
    const nextText = event.item.text;

    seenAgentTextByItem.set(id, nextText);
    if (nextText.startsWith(prevText)) {
      return nextText.slice(prevText.length);
    }
    return nextText;
  }

  if (typeof event.delta === 'string') {
    return event.delta;
  }
  if (event.delta && typeof event.delta.text === 'string') {
    return event.delta.text;
  }
  if (typeof event.text === 'string' && event.type && event.type.includes('delta')) {
    return event.text;
  }

  return '';
}

function buildCodexPayloadFromEvents(events, modelFallback = '') {
  const seenAgentTextByItem = new Map();
  let text = '';
  let usage = null;
  for (const event of events || []) {
    const nextUsage = extractCodexUsage(event, { fallbackModel: modelFallback });
    if (nextUsage) usage = nextUsage;
    text += extractCodexVisibleTextFromEvent(event, seenAgentTextByItem);
  }
  return { text: text.trim(), usage };
}

async function waitForProviderPackage(providerTrace, eventBus = null) {
  const providerPackageId = providerTrace?.providerPackageId;
  if (!providerPackageId) {
    throw createProviderPackageError(
      'Provider package id is required before the image parser can inspect provider output',
      'PROVIDER_PACKAGE_MISSING_ID'
    );
  }
  if (!ProviderCallPackage.db || ProviderCallPackage.db.readyState !== 1) {
    throw createProviderPackageError(
      'MongoDB must be connected before the image parser can inspect provider output',
      'PROVIDER_PACKAGE_MONGO_UNAVAILABLE'
    );
  }

  emitUserVisibleStatus(
    eventBus,
    'parser.provider_package_retrieval_started',
    `Escalation image parsing agent retrieving content from providerPackageId: ${providerPackageId}`,
    'started',
    { providerPackageId }
  );

  const timeoutMs = providerPackageWaitMs();
  const startedAt = Date.now();
  let attempt = 0;
  while (Date.now() - startedAt <= timeoutMs) {
    attempt += 1;
    const providerPackage = await ProviderCallPackage.findById(providerPackageId).lean();
    if (providerPackage) {
      emitUserVisibleStatus(
        eventBus,
        'provider.database_save_completed',
        'Saving payload to database complete',
        'complete',
        {
          providerId: providerPackage.providerId || '',
          providerPackageId,
        }
      );
      emitUserVisibleStatus(
        eventBus,
        'parser.provider_package_content_found',
        `providerPackageId: ${providerPackageId} content found`,
        'found',
        {
          providerId: providerPackage.providerId || '',
          providerPackageId,
          attempts: attempt,
        }
      );
      eventBus?.emit('parser.provider_package_loaded', {
        providerPackageId,
        providerId: providerPackage.providerId || '',
        providerPathType: providerPackage.providerPathType || '',
        outcome: providerPackage.outcome || '',
        attempts: attempt,
      });
      return providerPackage;
    }
    eventBus?.emit('parser.provider_package_load_retry', {
      providerPackageId,
      attempt,
      elapsedMs: Date.now() - startedAt,
      timeoutMs,
      status: 'retrying',
    });
    await delay(Math.min(25 + attempt * 10, 250));
  }

  emitUserVisibleStatus(
    eventBus,
    'parser.provider_package_load_failed',
    `Provider package ${providerPackageId} was not readable from MongoDB after ${timeoutMs}ms`,
    'error',
    { providerPackageId, attempts: attempt, timeoutMs }
  );
  throw createProviderPackageError(
    `Provider package ${providerPackageId} was not readable from MongoDB after ${timeoutMs}ms`,
    'PROVIDER_PACKAGE_LOAD_TIMEOUT'
  );
}

async function buildCodexImageParserResultFromProviderPackage(providerTrace, { eventBus = null, model = '' } = {}) {
  const providerPackage = await waitForProviderPackage(providerTrace, eventBus);
  if (providerPackage.providerResearchId !== 'openai-cli' && providerPackage.providerPathType !== 'cli') {
    throw createProviderPackageError(`Unsupported provider package for Codex image parser extraction: ${providerPackage.providerId || 'unknown'}`);
  }

  const events = await loadCodexStdoutJsonlEventsFromPackage(providerPackage);
  const payload = buildCodexPayloadFromEvents(events, providerTrace?.model || model);
  const providerPackageId = String(providerPackage._id || providerTrace.providerPackageId);

  eventBus?.emit('parser.provider_payload_selected', {
    providerPackageId,
    providerId: providerPackage.providerId || '',
    sourcePath: 'cli.stdout.jsonlEvents[item.type=agent_message]',
    textLength: payload.text.length,
    usagePresent: Boolean(payload.usage),
  });

  return {
    text: payload.text,
    usage: payload.usage,
    providerPackage,
    providerPayloadTrace: {
      providerPackageId,
      sourcePath: 'cli.stdout.jsonlEvents[item.type=agent_message]',
      eventCount: events.length,
    },
  };
}

async function buildImageParserResultFromProviderPackage(providerTrace, { eventBus = null, model = '' } = {}) {
  const providerPackage = await waitForProviderPackage(providerTrace, eventBus);
  if (providerPackage.providerId !== 'llm-gateway') {
    throw createProviderPackageError(`Unsupported provider package for image parser extraction: ${providerPackage.providerId || 'unknown'}`);
  }

  const parsed = await loadLlmGatewayParsedJsonFromPackage(providerPackage);
  const message = parsed?.choices?.[0]?.message || {};
  const content = typeof message.content === 'string' ? message.content : '';
  const reasoningContent = typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
  const text = (content || reasoningContent || '').trim();
  const usage = buildUsageFromOpenAiCompatibleJson(parsed, providerTrace?.model || model);
  const sourcePath = content
    ? 'llmGateway.response.parsedJson.choices[0].message.content'
    : 'llmGateway.response.parsedJson.choices[0].message.reasoning_content';

  eventBus?.emit('parser.provider_payload_selected', {
    providerPackageId: String(providerPackage._id || providerTrace.providerPackageId),
    providerId: providerPackage.providerId || '',
    sourcePath,
    textLength: text.length,
    usagePresent: Boolean(usage),
  });

  return {
    text,
    usage,
    providerPackage,
    providerPayloadTrace: {
      providerPackageId: String(providerPackage._id || providerTrace.providerPackageId),
      sourcePath,
      role: message.role || '',
      usedReasoningContent: !content && Boolean(reasoningContent),
    },
  };
}

async function buildLmStudioImageParserResultFromProviderPackage(providerTrace, { eventBus = null, model = '' } = {}) {
  const providerPackage = await waitForProviderPackage(providerTrace, eventBus);
  if (providerPackage.providerId !== 'lm-studio' && providerPackage.providerResearchId !== 'lm-studio-openai-compatible') {
    throw createProviderPackageError(`Unsupported provider package for LM Studio image parser extraction: ${providerPackage.providerId || 'unknown'}`);
  }

  const parsed = await loadLmStudioParsedJsonFromPackage(providerPackage);
  const message = parsed?.choices?.[0]?.message || {};
  const content = typeof message.content === 'string' ? message.content : '';
  const reasoningContent = typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
  const text = (content || reasoningContent || '').trim();
  const usage = buildUsageFromOpenAiCompatibleJson(parsed, providerTrace?.model || model);
  const sourcePath = content
    ? 'lmStudio.response.parsedJson.choices[0].message.content'
    : 'lmStudio.response.parsedJson.choices[0].message.reasoning_content';
  const providerPackageId = String(providerPackage._id || providerTrace.providerPackageId);

  eventBus?.emit('parser.provider_payload_selected', {
    providerPackageId,
    providerId: providerPackage.providerId || '',
    sourcePath,
    textLength: text.length,
    usagePresent: Boolean(usage),
  });

  return {
    text,
    usage,
    providerPackage,
    providerPayloadTrace: {
      providerPackageId,
      sourcePath,
      role: message.role || '',
      usedReasoningContent: !content && Boolean(reasoningContent),
    },
  };
}

async function buildGeminiImageParserResultFromProviderPackage(providerTrace, { eventBus = null, model = '' } = {}) {
  const providerPackage = await waitForProviderPackage(providerTrace, eventBus);
  if (providerPackage.providerId !== 'gemini' && providerPackage.providerResearchId !== 'gemini-api') {
    throw createProviderPackageError(`Unsupported provider package for Gemini image parser extraction: ${providerPackage.providerId || 'unknown'}`);
  }

  const parsed = await loadGeminiParsedJsonFromPackage(providerPackage);
  const text = extractGeminiTextFromJson(parsed);
  const usage = buildUsageFromGeminiJson(parsed, providerTrace?.model || model);
  const providerPackageId = String(providerPackage._id || providerTrace.providerPackageId);
  const sourcePath = 'geminiApi.response.parsedJson.candidates[0].content.parts[text]';

  eventBus?.emit('parser.provider_payload_selected', {
    providerPackageId,
    providerId: providerPackage.providerId || '',
    sourcePath,
    textLength: text.length,
    usagePresent: Boolean(usage),
  });

  return {
    text,
    usage,
    providerPackage,
    providerPayloadTrace: {
      providerPackageId,
      sourcePath,
      responseId: parsed?.responseId || '',
      modelVersion: parsed?.modelVersion || '',
    },
  };
}

// ---------------------------------------------------------------------------
// Main entry — parseImage()
// ---------------------------------------------------------------------------

/**
 * @param {string} imageBase64 - Raw base64 or data-URI string
 * @param {Object} options
 * @param {string} options.provider - image parser provider ID, including API/local providers and Codex CLI catalog IDs
 * @param {string} [options.model] - Model ID override
 * @param {string} [options.reasoningEffort] - Provider-specific reasoning effort override
 * @param {number} [options.timeoutMs=120000] - Request timeout
 * @param {boolean} [options.structured=true] - Legacy option name. When
 *   provider is 'anthropic', any value other than false uses the Anthropic SDK
 *   provider adapter; false uses the direct Anthropic HTTP path.
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
  const { provider, model, reasoningEffort, serviceTier, timeoutMs = DEFAULT_TIMEOUT_MS, eventBus } = options;
  // Legacy structured flag: false opts out of the Anthropic SDK adapter.
  // The SDK adapter now returns provider answer text only; downstream parser
  // validation owns all decisions about whether that text is useful.
  const useStructured = options.structured !== false;
  const promptId = normalizeImageParsePromptId(options.promptId || options.parserPromptId);
  const systemPrompt = getRenderedAgentPrompt(promptId);
  eventBus?.emit('parser.prompt_resolved', {
    promptId,
    promptLength: typeof systemPrompt === 'string' ? systemPrompt.length : 0,
  });

  if (!imageBase64 || typeof imageBase64 !== 'string' || !imageBase64.trim()) {
    const err = new Error('Image data is required');
    err.code = 'MISSING_IMAGE';
    throw err;
  }

  // Reject unsafe model overrides before they can reach a CLI spawn (Codex
  // path) or be persisted. Mirrors the chat orchestrator's INVALID_MODEL guard.
  // Lazily required to avoid load-time coupling with the chat orchestrator.
  // eslint-disable-next-line global-require
  require('./chat-orchestrator').assertModelAllowed(model, 'model');

  const normalized = normalizeBase64(imageBase64);
  if (!normalized) {
    const err = new Error('Invalid image data');
    err.code = 'MISSING_IMAGE';
    throw err;
  }

  // Compute original image size for stats
  const originalSizeBytes = Buffer.byteLength(normalized.rawBase64, 'base64');
  eventBus?.emit('parser.image_normalized', {
    sizeBytes: originalSizeBytes,
    mediaType: normalized.mediaType || '',
    isDataUrl: typeof imageBase64 === 'string' && imageBase64.startsWith('data:'),
  });
  eventBus?.emit('parser.media_type_detected', {
    mediaType: normalized.mediaType || '',
  });

  eventBus?.emit('parser.provider_selected', {
    provider,
    model: model || '',
    reasoningEffort: reasoningEffort || '',
    serviceTier: serviceTier || '',
    promptId,
    timeoutMs,
  });

  let result;
  const providerStartTime = Date.now();
  eventBus?.emit('parser.generation_started', {
    provider,
    model: model || '',
    reasoningEffort: reasoningEffort || '',
    serviceTier: serviceTier || '',
  });
  if (isProvidersStubbed()) {
    const stub = getProviderStub(provider, 'parseImage');
    if (!stub) throw new MissingProviderStubError(provider, 'parseImage');
    result = await stub({
      provider,
      imageBase64,
      normalized,
      systemPrompt,
      model,
      reasoningEffort,
      serviceTier,
      timeoutMs,
    });
  } else if (isCodexImageParserProvider(provider)) {
    result = await callCodex(systemPrompt, normalized.dataUrl, provider, model, reasoningEffort, serviceTier, timeoutMs, eventBus);
    const payloadResult = await buildCodexImageParserResultFromProviderPackage(result.providerTrace, {
      eventBus,
      model,
    });
    result = {
      ...result,
      text: payloadResult.text,
      usage: payloadResult.usage || result.usage || null,
      providerTrace: {
        ...(result.providerTrace || {}),
        providerPayload: payloadResult.providerPayloadTrace,
      },
    };
  } else {
    switch (provider) {
      case 'llm-gateway':
        {
          const gatewayBody = {
            model: model || process.env.LLM_GATEWAY_DEFAULT_MODEL || process.env.LLM_GATEWAY_MODEL || 'auto',
            max_tokens: 4096,
            temperature: 0.1,
            messages: [
              {
                role: 'system',
                content: systemPrompt,
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Parse this image.' },
                  {
                    type: 'image_url',
                    image_url: {
                      url: normalized.dataUrl,
                    },
                  },
                ],
              },
            ],
            chat_template_kwargs: {
              enable_thinking: false,
            },
          };
          const effectiveGatewayModel = gatewayBody.model;

          emitUserVisibleStatus(
            eventBus,
            'parser.agent_handoff_to_provider',
            `Escalation image parsing agent hand off payload to ${provider} Agent`,
            'started',
            { provider, model: effectiveGatewayModel || '' }
          );
          emitUserVisibleStatus(
            eventBus,
            'provider.agent_payload_received',
            'llm-gateway provider harness received payload',
            'received',
            {
              provider,
              operation: 'image-parse',
              model: effectiveGatewayModel,
              sourceAgent: promptId,
            }
          );
          result = await sendLlmGatewayChatCompletion({
            body: gatewayBody,
            model: effectiveGatewayModel,
            timeoutMs,
            getApiKey: () => resolveApiKey('llm-gateway'),
            captureContext: {
              callSite: 'image-parser:callLlmGateway',
              operation: 'image-parse',
              functionName: 'callLlmGateway',
              forceCapture: true,
              agent: promptId,
              modelRequested: effectiveGatewayModel,
              metadata: {
                sourceAgent: promptId,
                imageMediaType: normalized.mediaType,
                imageSizeBytes: originalSizeBytes,
              },
            },
            onProviderEvent: (eventType, payload) => eventBus?.emit(eventType, payload),
          });
          emitUserVisibleStatus(
            eventBus,
            'provider.agent_handoff_to_parser',
            `${provider} agent hand off to Escalation image parsing agent`,
            'complete',
            {
              provider,
              providerPackageId: result?.providerTrace?.providerPackageId || null,
            }
          );
          {
            const payloadResult = await buildImageParserResultFromProviderPackage(result.providerTrace, {
              eventBus,
              model,
            });
            result = {
              ...result,
              text: payloadResult.text,
              usage: payloadResult.usage || result.providerTrace?.usage || null,
              providerTrace: {
                ...(result.providerTrace || {}),
                providerPayload: payloadResult.providerPayloadTrace,
              },
            };
          }
        }
        break;
      case 'lm-studio':
        result = await callLmStudio(systemPrompt, normalized.rawBase64, normalized.mediaType, model, timeoutMs, eventBus);
        break;
      case 'anthropic':
        if (useStructured) {
          eventBus?.emit('parser.sdk_path_selected', {
            provider,
            engine: 'anthropic-agent-sdk',
          });
          result = await callAnthropicSdk(normalized.rawBase64, normalized.mediaType, model, reasoningEffort, timeoutMs);
        } else {
          eventBus?.emit('parser.sdk_path_skipped', {
            provider,
            reason: 'opt_out_legacy_structured_false',
          });
          result = await callAnthropic(systemPrompt, normalized.rawBase64, normalized.mediaType, model, timeoutMs);
        }
        break;
      case 'openai':
        result = await callOpenAI(systemPrompt, normalized.dataUrl, model, reasoningEffort, timeoutMs);
        break;
      case 'gemini':
        result = await callGemini(systemPrompt, normalized.rawBase64, normalized.mediaType, model, timeoutMs, eventBus);
        break;
      case 'kimi':
        result = await callKimi(systemPrompt, normalized.dataUrl, model, timeoutMs);
        break;
      default: {
        const err = new Error(`Invalid provider: ${provider}. Must be one of: ${VALID_IMAGE_PARSER_PROVIDERS.join(', ')}`);
        err.code = 'INVALID_PROVIDER';
        throw err;
      }
    }
  }
  const providerLatencyMs = Date.now() - providerStartTime;
  eventBus?.emit('parser.generation_completed', {
    provider,
    model: result?.usage?.model || model || '',
    providerLatencyMs,
    textLength: (result?.text || '').length,
    providerHarness: result?.providerTrace?.providerHarness || null,
    providerPackageId: result?.providerTrace?.providerPackageId || null,
    captureEnabled: result?.providerTrace?.captureEnabled ?? null,
    packageCaptureQueued: result?.providerTrace?.packageCaptureQueued ?? null,
  });
  if (result?.providerTrace) {
    eventBus?.emit('parser.provider_trace_received', {
      provider,
      providerHarness: result.providerTrace.providerHarness || null,
      providerPackageId: result.providerTrace.providerPackageId || null,
      callSite: result.providerTrace.callSite || null,
      outcome: result.providerTrace.outcome || null,
      statusCode: result.providerTrace.statusCode ?? null,
      durationMs: result.providerTrace.durationMs ?? null,
      captureEnabled: result.providerTrace.captureEnabled ?? null,
      packageCaptureQueued: result.providerTrace.packageCaptureQueued ?? null,
    });
  }
  if (result?.usage) {
    eventBus?.emit('parser.usage_recorded', {
      inputTokens: result.usage.inputTokens ?? null,
      outputTokens: result.usage.outputTokens ?? null,
      totalTokens: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
      model: result.usage.model || model || '',
    });
  }

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
  eventBus?.emit('parser.role_detected', {
    role,
    promptId,
  });
  if (role === 'escalation') {
    const canonicalCheck = validateCanonicalEscalationTemplateText(result.text || '');
    eventBus?.emit('parser.template_recovered', {
      ok: Boolean(canonicalCheck?.ok),
      labelCount: Array.isArray(canonicalCheck?.labels) ? canonicalCheck.labels.length : 0,
      issueCount: Array.isArray(canonicalCheck?.issues) ? canonicalCheck.issues.length : 0,
    });
  }
  const { parseFields, parseMeta } = buildStructuredParseResult(result.text, role);
  eventBus?.emit('parser.fields_extracted', {
    fieldCount: parseFields ? Object.keys(parseFields).length : 0,
    fields: parseFields ? Object.keys(parseFields) : [],
    role,
  });
  if (role === 'escalation' && parseMeta) {
    eventBus?.emit('parser.output_validated', {
      passed: Boolean(parseMeta.passed),
      score: parseMeta.score ?? null,
      confidence: parseMeta.confidence || '',
      fieldsFound: parseMeta.fieldsFound ?? 0,
      issueCount: Array.isArray(parseMeta.issues) ? parseMeta.issues.length : 0,
    });
  }

  return {
    text: result.text,
    role,
    promptId,
    usage: result.usage,
    providerTrace: result.providerTrace || null,
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
// Hard ceiling for the entire provider-availability batch. Individual probes
// declare their own (~3s) timeouts and correctly destroy their sockets, but
// downstream failure modes (slow DNS, half-open sockets, OS-level routing
// stalls) can still keep one of them pending past its declared budget. This
// outer race guarantees `resolveProviderAvailability` returns within
// PROVIDER_AVAILABILITY_BATCH_TIMEOUT_MS even when an individual probe
// silently exceeds its own timeout — every still-pending provider is marked
// `OUTER_TIMEOUT` so the agent-health endpoint never hangs.
const PROVIDER_AVAILABILITY_BATCH_TIMEOUT_MS = 5_000;

async function resolveProviderAvailability(trace = null) {
  const remoteProviderNames = ['anthropic', 'openai', 'kimi', 'gemini'];
  const codexProviderIds = [...CODEX_IMAGE_PARSER_PROVIDER_IDS];

  // Kick everything off concurrently. Each probe resolves to a tuple of
  // `[providerKey, providerStatusObject]` so we can assemble the final shape
  // without coordinating index positions across heterogeneous probe types.

  const llmGatewayProbe = (async () => {
    const gatewayKey = await traceAvailabilityCall(trace, {
      name: 'Resolve LLM Gateway API key',
      functionName: 'resolveApiKey',
      check: 'LLM Gateway key can be found in file, environment, or MongoDB key store',
      summary: 'Resolved LLM Gateway API key state.',
      metadata: { provider: 'llm-gateway' },
    }, () => resolveApiKey('llm-gateway'));
    emitAvailabilityTrace(trace, {
      name: 'Check LLM Gateway key presence',
      functionName: 'resolveProviderAvailability',
      check: 'Resolved key is present before remote validation',
      status: gatewayKey ? 'success' : 'warning',
      summary: gatewayKey ? 'LLM Gateway API key is configured.' : 'LLM Gateway API key is not configured.',
      metadata: { provider: 'llm-gateway', configured: Boolean(gatewayKey) },
    });
    const result = await traceAvailabilityCall(trace, {
      name: 'Validate LLM Gateway provider',
      functionName: 'validateRemoteProvider',
      check: 'LLM Gateway validation request completes with a provider status',
      summary: 'LLM Gateway validation completed.',
      metadata: { provider: 'llm-gateway' },
    }, () => validateRemoteProvider('llm-gateway', gatewayKey));
    emitAvailabilityTrace(trace, {
      name: 'Evaluate LLM Gateway availability result',
      functionName: 'resolveProviderAvailability',
      check: 'LLM Gateway validation result is available or has a known unavailable reason',
      status: result?.available ? 'success' : 'warning',
      summary: result?.reason || 'LLM Gateway availability evaluated.',
      metadata: {
        provider: 'llm-gateway',
        available: Boolean(result?.available),
        code: result?.code || '',
      },
    });
    return ['llm-gateway', result];
  })();

  const lmStudioProbe = (async () => {
    if (isProvidersStubbed()) {
      const stub = getProviderStub('lm-studio', 'providerAvailability');
      if (!stub) throw new MissingProviderStubError('lm-studio', 'providerAvailability');
      const stubResult = await traceAvailabilityCall(trace, {
        name: 'Read LM Studio provider stub',
        functionName: 'getProviderStub',
        check: 'Provider availability stub returns an LM Studio status',
        summary: 'LM Studio provider stub returned availability.',
        metadata: { provider: 'lm-studio' },
      }, () => stub({ apiUrl: LM_STUDIO_API_URL }));
      return ['lm-studio', stubResult];
    }
    const lmStudioSnapshot = await traceAvailabilityCall(trace, {
      name: 'Check LM Studio model snapshot',
      functionName: 'getModelSnapshot',
      check: 'LM Studio responds within the provider availability timeout',
      summary: 'LM Studio model snapshot check completed.',
      metadata: { provider: 'lm-studio', timeoutMs: 3000 },
    }, () => getModelSnapshot(LM_STUDIO_API_URL, { timeoutMs: 3000 }));
    const lmStudioModel = lmStudioSnapshot.loadedModel || lmStudioSnapshot.availableModel || null;
    const lmStudioReason = lmStudioSnapshot.loadedModel
      ? `Model loaded: ${lmStudioSnapshot.loadedModel}`
      : lmStudioSnapshot.availableModel
        ? `Model available: ${lmStudioSnapshot.availableModel}`
        : (lmStudioSnapshot.status === 'no_model_loaded' || lmStudioSnapshot.status === 'no_models_available')
          ? 'No model loaded in LM Studio'
          : lmStudioSnapshot.reason || 'LM Studio unavailable';
    emitAvailabilityTrace(trace, {
      name: 'Evaluate LM Studio model availability',
      functionName: 'resolveProviderAvailability',
      check: 'LM Studio has a loaded or available model',
      status: lmStudioModel ? 'success' : 'warning',
      summary: lmStudioReason,
      metadata: { provider: 'lm-studio', model: lmStudioModel || '', status: lmStudioSnapshot.status || '' },
    });
    return ['lm-studio', {
      available: !!lmStudioModel,
      model: lmStudioModel,
      reason: lmStudioReason,
    }];
  })();

  const remoteProbes = remoteProviderNames.map((provider) => (async () => {
    const providerKey = await traceAvailabilityCall(trace, {
      name: `Resolve ${getRemoteProviderLabel(provider)} API key`,
      functionName: 'resolveApiKey',
      check: `${getRemoteProviderLabel(provider)} key can be found in file, environment, or MongoDB key store`,
      summary: `Resolved ${getRemoteProviderLabel(provider)} API key state.`,
      metadata: { provider },
    }, () => resolveApiKey(provider));
    emitAvailabilityTrace(trace, {
      name: `Check ${getRemoteProviderLabel(provider)} key presence`,
      functionName: 'resolveProviderAvailability',
      check: 'Resolved key is present before remote validation',
      status: providerKey ? 'success' : 'warning',
      summary: providerKey
        ? `${getRemoteProviderLabel(provider)} API key is configured.`
        : `${getRemoteProviderLabel(provider)} API key is not configured.`,
      metadata: { provider, configured: Boolean(providerKey) },
    });
    const result = await traceAvailabilityCall(trace, {
      name: `Validate ${getRemoteProviderLabel(provider)} provider`,
      functionName: 'validateRemoteProvider',
      check: `${getRemoteProviderLabel(provider)} validation request completes with a provider status`,
      summary: `${getRemoteProviderLabel(provider)} validation completed.`,
      metadata: { provider },
    }, () => validateRemoteProvider(provider, providerKey));
    return [provider, result];
  })());

  // Codex CLI check is a single shared probe whose result is fanned out
  // across all configured codex image-parser provider ids. Run it once,
  // concurrently with everything else.
  const codexProbe = codexProviderIds.length
    ? (async () => {
      const codexAvailability = await traceAvailabilityCall(trace, {
        name: 'Check Codex image-provider CLI availability',
        functionName: 'checkCodexCliAvailability',
        check: 'codex --version completes before timeout',
        summary: 'Codex image-provider CLI availability check completed.',
        metadata: { providerCount: codexProviderIds.length },
      }, () => checkCodexCliAvailability(''));
      return ['__codex__', codexAvailability];
    })()
    : Promise.resolve(['__codex__', null]);

  const allProbes = [llmGatewayProbe, lmStudioProbe, ...remoteProbes, codexProbe];

  // Fix B: race the whole batch against an outer ceiling. Any probe that
  // hasn't settled by the deadline is reported as OUTER_TIMEOUT below.
  let outerTimeoutHandle = null;
  const outerTimeoutSymbol = Symbol('PROVIDER_AVAILABILITY_OUTER_TIMEOUT');
  const outerTimeoutPromise = new Promise((resolve) => {
    outerTimeoutHandle = setTimeout(() => resolve(outerTimeoutSymbol), PROVIDER_AVAILABILITY_BATCH_TIMEOUT_MS);
    outerTimeoutHandle.unref?.();
  });

  // Wrap each probe so it resolves with a discriminated tuple regardless of
  // success or failure — keeps the post-race assembly uniform.
  const guardedProbes = allProbes.map((probe) =>
    probe.then(
      ([key, value]) => ({ status: 'fulfilled', key, value }),
      (err) => ({ status: 'rejected', key: null, reason: err })
    )
  );

  // Snapshot the live settlement state so the timeout branch can still see
  // which probes finished before the deadline.
  const settled = new Array(guardedProbes.length).fill(null);
  guardedProbes.forEach((p, idx) => {
    p.then((outcome) => { settled[idx] = outcome; });
  });

  const allSettledPromise = Promise.all(guardedProbes);
  const raceResult = await Promise.race([allSettledPromise, outerTimeoutPromise]);
  if (outerTimeoutHandle) clearTimeout(outerTimeoutHandle);

  const timedOut = raceResult === outerTimeoutSymbol;
  const probeOutcomes = timedOut ? settled : raceResult;

  if (timedOut) {
    emitAvailabilityTrace(trace, {
      name: 'Provider availability outer ceiling reached',
      functionName: 'resolveProviderAvailability',
      check: `All provider probes complete within ${PROVIDER_AVAILABILITY_BATCH_TIMEOUT_MS}ms`,
      status: 'warning',
      summary: `Provider availability batch hit the ${PROVIDER_AVAILABILITY_BATCH_TIMEOUT_MS}ms outer ceiling; pending probes marked OUTER_TIMEOUT.`,
      metadata: { timeoutMs: PROVIDER_AVAILABILITY_BATCH_TIMEOUT_MS },
    });
  }

  const providers = {};

  // Helper to mark a provider that didn't settle in time.
  const markOuterTimeout = (providerKey) => ({
    available: false,
    reason: 'reachability probe timed out',
    code: 'OUTER_TIMEOUT',
  });

  // Assemble results. Iterate the original probe order so we know which
  // logical provider each slot corresponds to.
  const probeKeys = ['llm-gateway', 'lm-studio', ...remoteProviderNames, '__codex__'];
  probeKeys.forEach((logicalKey, idx) => {
    const outcome = probeOutcomes[idx];

    // Codex slot is special — its single result is fanned out across the
    // configured codex provider ids.
    if (logicalKey === '__codex__') {
      let codexAvailability = null;
      if (outcome && outcome.status === 'fulfilled') {
        codexAvailability = outcome.value;
      } else if (outcome && outcome.status === 'rejected') {
        const reason = outcome.reason?.message || 'Codex CLI availability check failed.';
        codexAvailability = { available: false, reason, code: 'PROVIDER_VALIDATION_THREW' };
      } else if (codexProviderIds.length) {
        codexAvailability = markOuterTimeout('codex');
      }
      for (const providerId of codexProviderIds) {
        providers[providerId] = {
          ...codexAvailability,
          model: CODEX_IMAGE_PARSER_PROVIDER_MODELS[providerId] || providerId,
        };
        emitAvailabilityTrace(trace, {
          name: `Map Codex availability to ${providerId}`,
          functionName: 'resolveProviderAvailability',
          check: 'Codex availability result is assigned to configured Codex image parser provider ids',
          status: codexAvailability?.available ? 'success' : 'warning',
          summary: `${providerId} availability mapped from Codex CLI check.`,
          metadata: { provider: providerId, available: Boolean(codexAvailability?.available) },
        });
      }
      return;
    }

    if (!outcome) {
      // Probe never settled before the outer ceiling.
      providers[logicalKey] = markOuterTimeout(logicalKey);
      emitAvailabilityTrace(trace, {
        name: `Evaluate ${getRemoteProviderLabel(logicalKey)} availability result`,
        functionName: 'resolveProviderAvailability',
        check: `${getRemoteProviderLabel(logicalKey)} validation result is available or has a known unavailable reason`,
        status: 'warning',
        summary: providers[logicalKey].reason,
        metadata: { provider: logicalKey, available: false, code: 'OUTER_TIMEOUT' },
      });
      return;
    }

    if (outcome.status === 'fulfilled') {
      providers[logicalKey] = outcome.value;
    } else {
      const reason = outcome.reason?.message || `${getRemoteProviderLabel(logicalKey)} validation threw an error.`;
      providers[logicalKey] = { available: false, reason, code: 'PROVIDER_VALIDATION_THREW' };
    }
    // LLM Gateway / LM Studio emit their own per-provider trace inside the
    // probe; only emit the standard remote-provider trace for the four
    // remote API providers so we don't double-log.
    if (remoteProviderNames.includes(logicalKey)) {
      emitAvailabilityTrace(trace, {
        name: `Evaluate ${getRemoteProviderLabel(logicalKey)} availability result`,
        functionName: 'resolveProviderAvailability',
        check: `${getRemoteProviderLabel(logicalKey)} validation result is available or has a known unavailable reason`,
        status: providers[logicalKey]?.available ? 'success' : 'warning',
        summary: providers[logicalKey]?.reason || `${getRemoteProviderLabel(logicalKey)} availability evaluated.`,
        metadata: {
          provider: logicalKey,
          available: Boolean(providers[logicalKey]?.available),
          code: providers[logicalKey]?.code || '',
        },
      });
    }
  });

  return providers;
}

async function checkProviderAvailability(options = {}) {
  const forceRefresh = Boolean(options && options.forceRefresh);
  const trace = typeof options?.trace === 'function' ? options.trace : null;
  const ttlMs = Number.isFinite(options?.ttlMs) && options.ttlMs >= 0
    ? options.ttlMs
    : PROVIDER_AVAILABILITY_CACHE_TTL_MS;
  const now = Date.now();
  const cacheVersion = _providerAvailabilityVersion;

  if (!forceRefresh && _providerAvailabilityCache && (now - _providerAvailabilityCachedAt) < ttlMs) {
    emitAvailabilityTrace(trace, {
      name: 'Read provider availability cache',
      functionName: 'checkProviderAvailability',
      check: 'Cached provider availability is fresh enough to reuse',
      status: 'success',
      summary: 'Provider availability cache reused.',
      metadata: { ttlMs, cacheAgeMs: now - _providerAvailabilityCachedAt },
    });
    return cloneProviderAvailability(_providerAvailabilityCache);
  }

  if (_providerAvailabilityInFlight) {
    emitAvailabilityTrace(trace, {
      name: 'Reuse in-flight provider availability check',
      functionName: 'checkProviderAvailability',
      check: 'Only one provider availability probe runs at a time',
      status: 'info',
      summary: 'Provider availability probe was already running, so this request reused it.',
    });
    const shared = await _providerAvailabilityInFlight;
    return cloneProviderAvailability(shared);
  }

  const availabilityPromise = resolveProviderAvailability(trace)
    .then((providers) => {
      if (_providerAvailabilityVersion === cacheVersion) {
        _providerAvailabilityCache = providers;
        _providerAvailabilityCachedAt = Date.now();
        emitAvailabilityTrace(trace, {
          name: 'Update provider availability cache',
          functionName: 'checkProviderAvailability',
          check: 'Provider availability result cache version still matches',
          status: 'success',
          summary: 'Provider availability cache updated.',
          metadata: { providerCount: Object.keys(providers || {}).length },
        });
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
  VALID_IMAGE_PARSER_PROVIDERS,
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
