'use strict';

const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const {
  isStubbed: isProvidersStubbed,
  getProviderStub,
  MissingProviderStubError,
} = require('../lib/harness-provider-gate');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DEFAULT_API_URL = process.env.LM_STUDIO_API_URL || 'http://127.0.0.1:1234';
const DEFAULT_API_TOKEN = process.env.LM_STUDIO_API_TOKEN || process.env.LM_STUDIO_API_KEY || null;
const CHAT_TIMEOUT_MS = parsePositiveInt(process.env.LM_STUDIO_CHAT_TIMEOUT_MS, 180000);
const PARSE_TIMEOUT_MS = parsePositiveInt(process.env.LM_STUDIO_PARSE_TIMEOUT_MS, 120000);

// Cached model name — resolved lazily on first request
let _cachedModelName = null;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// Low-level HTTP helpers (no external deps)
// ---------------------------------------------------------------------------
function resolveTransport(baseUrl) {
  const url = new URL(baseUrl);
  return {
    transport: url.protocol === 'https:' ? https : http,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
  };
}

function buildDefaultHeaders(extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (DEFAULT_API_TOKEN && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${DEFAULT_API_TOKEN}`;
  }
  return headers;
}

function rawRequest(baseUrl, method, urlPath, body, timeoutMs, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const { transport, hostname, port } = resolveTransport(baseUrl);
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

    const options = {
      hostname,
      port,
      path: urlPath,
      method,
      headers: buildDefaultHeaders({
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...extraHeaders,
      }),
      timeout: timeoutMs || 30000,
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('LM Studio request timed out')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function rawGet(baseUrl, urlPath, timeoutMs, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const { transport, hostname, port } = resolveTransport(baseUrl);
    const options = {
      hostname,
      port,
      path: urlPath,
      headers: buildDefaultHeaders({
        'Accept': 'application/json',
        ...extraHeaders,
      }),
      timeout: timeoutMs || 30000,
    };

    const req = transport.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      const err = new Error('LM Studio request timed out');
      err.code = 'TIMEOUT';
      reject(err);
    });
  });
}

function jsonRequest(method, urlPath, body, timeoutMs, extraHeaders) {
  return rawRequest(DEFAULT_API_URL, method, urlPath, body, timeoutMs, extraHeaders);
}

function parseNativeModelsSnapshot(json) {
  if (!json || !Array.isArray(json.models)) return null;

  const llmModels = json.models.filter((model) => model && model.type !== 'embedding');
  const loadedEntry = llmModels.find((model) =>
    Array.isArray(model.loaded_instances) && model.loaded_instances.some((instance) => instance?.id)
  ) || null;

  const loadedModel = loadedEntry?.loaded_instances?.find((instance) => instance?.id)?.id || null;
  const firstModel = llmModels[0] || null;
  const availableModel = loadedModel
    || firstModel?.key
    || firstModel?.loaded_instances?.find((instance) => instance?.id)?.id
    || null;

  return {
    source: 'native',
    loadedModel,
    availableModel,
    downloadedModelCount: llmModels.length,
    totalModelCount: json.models.length,
    status: loadedModel ? 'ready' : availableModel ? 'no_model_loaded' : 'no_models_available',
  };
}

function parseCompatModelsSnapshot(json) {
  if (!json || !Array.isArray(json.data)) return null;

  const firstModel = json.data.find((entry) => entry && entry.id) || null;
  return {
    source: 'compat',
    loadedModel: firstModel?.id || null,
    availableModel: firstModel?.id || null,
    downloadedModelCount: firstModel ? Math.max(json.data.length, 1) : 0,
    totalModelCount: Array.isArray(json.data) ? json.data.length : 0,
    status: firstModel?.id ? 'ready' : 'no_models_available',
  };
}

function buildErrorSnapshot(status, reason, source = 'unknown') {
  return {
    source,
    loadedModel: null,
    availableModel: null,
    downloadedModelCount: 0,
    totalModelCount: 0,
    status,
    reason,
  };
}

function isLegacyModelsFallbackStatus(statusCode) {
  return statusCode === 404 || statusCode === 405 || statusCode === 501;
}

function formatModelEndpointError(baseUrl, err) {
  if (err?.code === 'TIMEOUT') {
    return buildErrorSnapshot('timeout', 'LM Studio connection timed out');
  }

  const errorText = `${err?.code || ''} ${err?.message || ''}`;
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND/i.test(errorText)) {
    return buildErrorSnapshot('offline', `Cannot reach LM Studio at ${baseUrl}`);
  }

  return buildErrorSnapshot('error', err?.message || 'LM Studio model discovery failed');
}

async function inspectModelsEndpoint(baseUrl, urlPath, source, timeoutMs) {
  try {
    const res = await rawGet(baseUrl, urlPath, timeoutMs);

    if (res.statusCode === 401 || res.statusCode === 403) {
      return {
        done: true,
        snapshot: buildErrorSnapshot(
          DEFAULT_API_TOKEN ? 'auth_rejected' : 'auth_required',
          DEFAULT_API_TOKEN ? 'LM Studio API token rejected' : 'LM Studio API token required',
          source
        ),
      };
    }

    if (res.statusCode >= 200 && res.statusCode < 300) {
      const parsed = safeJsonParse(res.body);
      const snapshot = parseNativeModelsSnapshot(parsed) || parseCompatModelsSnapshot(parsed);
      if (snapshot) {
        return {
          done: true,
          snapshot,
        };
      }

      return {
        done: !isLegacyModelsFallbackStatus(res.statusCode),
        snapshot: buildErrorSnapshot('error', 'Invalid response from LM Studio', source),
      };
    }

    if (isLegacyModelsFallbackStatus(res.statusCode)) {
      return { done: false, snapshot: null };
    }

    return {
      done: true,
      snapshot: buildErrorSnapshot('error', `LM Studio error (HTTP ${res.statusCode})`, source),
    };
  } catch (err) {
    return {
      done: false,
      snapshot: formatModelEndpointError(baseUrl, err),
    };
  }
}

async function getModelSnapshot(baseUrl = DEFAULT_API_URL, options = {}) {
  const timeoutMs = parsePositiveInt(options.timeoutMs, 5000);

  const native = await inspectModelsEndpoint(baseUrl, '/api/v1/models', 'native', timeoutMs);
  if (native.done && native.snapshot) return native.snapshot;

  const compat = await inspectModelsEndpoint(baseUrl, '/v1/models', 'compat', timeoutMs);
  if (compat.snapshot) return compat.snapshot;

  return native.snapshot || compat.snapshot || buildErrorSnapshot('offline', `Cannot reach LM Studio at ${baseUrl}`);
}

// ---------------------------------------------------------------------------
// Model auto-detection
// ---------------------------------------------------------------------------
async function getLoadedModel(baseUrl) {
  if (_cachedModelName) return _cachedModelName;
  const snapshot = await getModelSnapshot(baseUrl || DEFAULT_API_URL);
  _cachedModelName = snapshot.loadedModel || snapshot.availableModel || 'local';
  console.log('[lm-studio] Detected model:', _cachedModelName, `(${snapshot.source})`);
  return _cachedModelName;
}

function clearModelCache() {
  _cachedModelName = null;
}

// ---------------------------------------------------------------------------
// Image handling — base64 → OpenAI vision content parts
// ---------------------------------------------------------------------------
function base64ToImageUrl(base64Input) {
  const trimmed = (typeof base64Input === 'string' ? base64Input : '').trim();
  if (!trimmed) return null;

  const dataUrl = trimmed.startsWith('data:image/')
    ? trimmed
    : `data:image/png;base64,${trimmed}`;

  return { type: 'image_url', image_url: { url: dataUrl } };
}

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------
function buildOpenAIMessages(messages, systemPrompt, images) {
  const openaiMessages = [];

  if (systemPrompt) {
    openaiMessages.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    openaiMessages.push({ role, content: msg.content || '' });
  }

  // Attach images to the last user message as vision content parts
  if (Array.isArray(images) && images.length > 0) {
    const lastUserIdx = openaiMessages.findLastIndex((m) => m.role === 'user');
    if (lastUserIdx >= 0) {
      const textContent = openaiMessages[lastUserIdx].content || '';
      const parts = [];
      if (textContent) parts.push({ type: 'text', text: textContent });
      for (const img of images) {
        const imgPart = base64ToImageUrl(img);
        if (imgPart) parts.push(imgPart);
      }
      openaiMessages[lastUserIdx].content = parts;
    }
  }

  return openaiMessages;
}

function buildUsageObject(json, fallbackModel) {
  if (!json || !json.usage) return null;
  return {
    model: json.model || fallbackModel,
    inputTokens: json.usage.prompt_tokens || 0,
    outputTokens: json.usage.completion_tokens || 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

// ---------------------------------------------------------------------------
// chat() — streaming SSE, same callback contract as claude.js / codex.js
//
// Signature: chat({ messages, systemPrompt, images, model, reasoningEffort,
//                    timeoutMs, onChunk, onDone, onError })
// Returns:   cleanup()  →  { usage, partialResponse }
// ---------------------------------------------------------------------------
function chat({ messages, systemPrompt, images, model, reasoningEffort, timeoutMs, onChunk, onDone, onError }) {
  if (isProvidersStubbed()) {
    const stub = getProviderStub('lm-studio', 'chat');
    if (!stub) throw new MissingProviderStubError('lm-studio', 'chat');
    return stub({ messages, systemPrompt, images, model, reasoningEffort, timeoutMs, onChunk, onDone, onError });
  }
  const baseUrl = DEFAULT_API_URL;
  const effectiveTimeoutMs = parsePositiveInt(timeoutMs, CHAT_TIMEOUT_MS);
  let fullResponse = '';
  let killed = false;
  let settled = false;
  let capturedUsage = null;
  let req = null;

  function finishWithError(err) {
    if (settled || killed) return;
    settled = true;
    const error = err instanceof Error ? err : new Error(String(err));
    error._usage = capturedUsage || null;
    onError(error);
  }

  function finishWithSuccess(text) {
    if (settled || killed) return;
    settled = true;
    onDone(text, capturedUsage || null);
  }

  const timeout = setTimeout(() => {
    if (killed || settled) return;
    if (req) try { req.destroy(); } catch { /* ignore */ }
    const timeoutErr = new Error('LM Studio request timed out after ' + effectiveTimeoutMs + 'ms');
    timeoutErr.code = 'TIMEOUT';
    finishWithError(timeoutErr);
  }, effectiveTimeoutMs);

  // Auto-detect model then start streaming
  getLoadedModel(baseUrl).then((detectedModel) => {
    if (killed || settled) return;

    const effectiveModel = (model && model !== 'local') ? model : detectedModel;
    const openaiMessages = buildOpenAIMessages(messages, systemPrompt, images);

    const body = JSON.stringify({
      model: effectiveModel,
      messages: openaiMessages,
      stream: true,
      temperature: reasoningEffort === 'low' ? 0.3 : reasoningEffort === 'high' ? 0.8 : 0.5,
    });

    const url = new URL('/v1/chat/completions', baseUrl);
    const transport = url.protocol === 'https:' ? https : http;

    req = transport.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...buildDefaultHeaders(),
      },
      timeout: effectiveTimeoutMs,
    }, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', (chunk) => { errBody += chunk; });
        res.on('end', () => {
          clearTimeout(timeout);
          finishWithError(new Error(`LM Studio API error (HTTP ${res.statusCode}): ${errBody.slice(0, 500)}`));
        });
        return;
      }

      let sseBuffer = '';

      res.on('data', (chunk) => {
        if (settled || killed) return;
        sseBuffer += chunk.toString();
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed === 'data: [DONE]') {
            clearTimeout(timeout);
            finishWithSuccess(fullResponse);
            return;
          }

          if (trimmed.startsWith('data: ')) {
            try {
              const json = JSON.parse(trimmed.slice(6));
              const usage = buildUsageObject(json, effectiveModel);
              if (usage) capturedUsage = usage;

              // Qwen3 (and other reasoning models) stream thinking tokens
              // as delta.reasoning_content before the final answer arrives
              // in delta.content.  We only forward delta.content to the UI
              // but must not treat reasoning-only chunks as empty.
              const delta = json?.choices?.[0]?.delta?.content;
              if (delta) {
                fullResponse += delta;
                try { onChunk(delta); } catch { /* ignore callback errors */ }
              }
            } catch { /* skip malformed JSON */ }
          }
        }
      });

      res.on('end', () => {
        clearTimeout(timeout);
        if (!settled && !killed) finishWithSuccess(fullResponse);
      });

      res.on('error', (err) => {
        clearTimeout(timeout);
        finishWithError(err);
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      if (err.code === 'ECONNREFUSED') {
        finishWithError(new Error(
          `Cannot connect to LM Studio at ${baseUrl}. Is LM Studio running with the local server enabled?`
        ));
      } else {
        finishWithError(err);
      }
    });

    req.on('timeout', () => {
      req.destroy();
      const timeoutErr = new Error('LM Studio connection timed out');
      timeoutErr.code = 'TIMEOUT';
      finishWithError(timeoutErr);
    });

    req.write(body);
    req.end();
  }).catch((err) => {
    clearTimeout(timeout);
    finishWithError(err);
  });

  return function cleanup() {
    killed = true;
    clearTimeout(timeout);
    if (req) try { req.destroy(); } catch { /* ignore */ }
    return { usage: capturedUsage || null, partialResponse: fullResponse };
  };
}

// ---------------------------------------------------------------------------
// parseEscalation() — non-streaming JSON extraction from image or text
// ---------------------------------------------------------------------------
async function parseEscalation(imageBase64OrText, options = {}) {
  if (isProvidersStubbed()) {
    const stub = getProviderStub('lm-studio', 'parseEscalation');
    if (!stub) throw new MissingProviderStubError('lm-studio', 'parseEscalation');
    return stub(imageBase64OrText, options);
  }
  const input = typeof imageBase64OrText === 'string' ? imageBase64OrText : '';
  const isBase64Image = input.startsWith('data:image') || /^[A-Za-z0-9+/=]{100,}$/.test(input);
  const effectiveTimeoutMs = parsePositiveInt(options.timeoutMs, PARSE_TIMEOUT_MS);
  const effectiveModel = options.model || await getLoadedModel(DEFAULT_API_URL);

  const schemaExample = JSON.stringify({
    coid: '', mid: '', caseNumber: '', clientContact: '', agentName: '',
    attemptingTo: '', expectedOutcome: '', actualOutcome: '', tsSteps: '',
    triedTestAccount: 'unknown', category: 'unknown',
  }, null, 2);

  const instructions = [
    'Extract escalation fields and reply with JSON only.',
    'Use this exact shape and key names:',
    schemaExample,
    'Rules:',
    '- category must be one of: payroll, bank-feeds, reconciliation, permissions, billing, tax, invoicing, reporting, inventory, payments, integrations, general, technical, unknown',
    '- triedTestAccount must be one of: yes, no, unknown',
    '- use empty strings for missing text fields',
    '- do not guess unreadable names, identifiers, numbers, or labels',
    '- if a value is unclear, unreadable, or uncertain, leave it as an empty string',
    '- prefer exact transcription from the source over summarizing',
    '- do not include markdown fences',
  ].join('\n');

  const messages = [];
  if (isBase64Image) {
    const imgPart = base64ToImageUrl(input);
    messages.push({
      role: 'user',
      content: imgPart
        ? [{ type: 'text', text: instructions }, imgPart]
        : instructions,
    });
  } else {
    messages.push({ role: 'user', content: `${instructions}\n\nEscalation text:\n${input}` });
  }

  const res = await jsonRequest('POST', '/v1/chat/completions', {
    model: effectiveModel,
    messages,
    stream: false,
    temperature: 0.1,
    max_tokens: 2048,
    chat_template_kwargs: { enable_thinking: false },
  }, effectiveTimeoutMs);

  if (res.statusCode !== 200) {
    throw new Error(`LM Studio parse error ${res.statusCode}: ${(res.body || '').slice(0, 500)}`);
  }

  const parsed = JSON.parse(res.body);
  const usage = buildUsageObject(parsed, effectiveModel);
  // Reasoning models (Qwen3 etc.) may put all text in reasoning_content
  // with content empty — fall back to reasoning_content if needed
  const msg = parsed.choices?.[0]?.message || {};
  const rawContent = msg.content || msg.reasoning_content || '';
  const fields = extractJSONObject(rawContent);

  return {
    fields: fields || { category: 'unknown', attemptingTo: rawContent.slice(0, 800) },
    usage,
  };
}

// ---------------------------------------------------------------------------
// transcribeImage() — extract visible text from an image
// ---------------------------------------------------------------------------
async function transcribeImage(imageBase64OrPath, options = {}) {
  if (isProvidersStubbed()) {
    const stub = getProviderStub('lm-studio', 'transcribeImage');
    if (!stub) throw new MissingProviderStubError('lm-studio', 'transcribeImage');
    return stub(imageBase64OrPath, options);
  }
  const input = typeof imageBase64OrPath === 'string' ? imageBase64OrPath.trim() : '';
  if (!input) throw new Error('transcribeImage: image input is empty');

  const effectiveModel = options.model || await getLoadedModel(DEFAULT_API_URL);
  const effectiveTimeoutMs = parsePositiveInt(options.timeoutMs, PARSE_TIMEOUT_MS);

  const transcribePrompt = [
    'Transcribe ALL text visible in this image exactly as written.',
    'Preserve line breaks, section labels, spacing, and formatting as closely as possible.',
    'Do not summarize, interpret, or clean up the wording.',
    'Pay special attention to IDs, case numbers, and any numeric strings.',
    'Return only the transcribed text.',
  ].join('\n');

  // Handle file path input — read and encode to base64
  let base64Input = input;
  const isFilePath = !input.startsWith('data:image')
    && !/^[A-Za-z0-9+/=]{100,}$/.test(input)
    && (path.isAbsolute(input) || /^[a-zA-Z]:[/\\]/.test(input));

  if (isFilePath) {
    if (!fs.existsSync(input)) {
      throw new Error('transcribeImage: file not found: ' + input);
    }
    const buffer = fs.readFileSync(input);
    const ext = path.extname(input).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'webp' ? 'image/webp'
      : ext === 'gif' ? 'image/gif'
      : 'image/png';
    base64Input = `data:${mime};base64,${buffer.toString('base64')}`;
  }

  const imgPart = base64ToImageUrl(base64Input);
  const messages = [{
    role: 'user',
    content: imgPart
      ? [{ type: 'text', text: transcribePrompt }, imgPart]
      : transcribePrompt,
  }];

  const res = await jsonRequest('POST', '/v1/chat/completions', {
    model: effectiveModel,
    messages,
    stream: false,
    temperature: 0.1,
    max_tokens: 4096,
    chat_template_kwargs: { enable_thinking: false },
  }, effectiveTimeoutMs);

  if (res.statusCode !== 200) {
    throw new Error(`LM Studio transcribe error ${res.statusCode}: ${(res.body || '').slice(0, 500)}`);
  }

  const parsed = JSON.parse(res.body);
  const usage = buildUsageObject(parsed, effectiveModel);
  // Reasoning models may return empty content with reasoning_content
  const tmsg = parsed.choices?.[0]?.message || {};
  const text = tmsg.content || tmsg.reasoning_content || '';

  return { text: text.trim(), usage };
}

// ---------------------------------------------------------------------------
// warmUp() — verify LM Studio is reachable and cache model name
// ---------------------------------------------------------------------------
async function warmUp() {
  if (isProvidersStubbed()) {
    const stub = getProviderStub('lm-studio', 'warmUp');
    if (stub) return stub();
    return;
  }
  try {
    const snapshot = await getModelSnapshot(DEFAULT_API_URL);
    const model = snapshot.loadedModel || snapshot.availableModel || 'local';
    _cachedModelName = model;
    console.log('[lm-studio] Warm-up complete — model:', model, `status: ${snapshot.status}`);
  } catch (err) {
    console.warn('[lm-studio] Warm-up failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function extractJSONObject(text) {
  if (!text || !text.trim()) return null;
  const direct = safeJsonParse(text.trim());
  if (direct && typeof direct === 'object') return direct;

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;

  const candidate = text.slice(firstBrace, lastBrace + 1);
  const parsed = safeJsonParse(candidate);
  return (parsed && typeof parsed === 'object') ? parsed : null;
}

function safeJsonParse(value) {
  try { return JSON.parse(value); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Exports — same shape as claude.js / codex.js
// ---------------------------------------------------------------------------
module.exports = {
  chat,
  parseEscalation,
  transcribeImage,
  warmUp,
  getLoadedModel,
  getModelSnapshot,
  clearModelCache,
};
