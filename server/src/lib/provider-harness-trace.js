'use strict';

const pc = require('picocolors');

const MAX_DEPTH = 5;
const MAX_KEYS = 40;
const MAX_ARRAY_ITEMS = 20;
const MAX_SAFE_STRING_CHARS = 240;

const FALSE_VALUES = new Set(['0', 'false', 'off', 'no']);
const JSON_TRACE_VALUES = new Set(['debug', 'json', 'verbose', 'full']);
const SECRET_KEY_RE = /(authorization|api[-_]?key|token|secret|credential|cookie|password|bearer)/i;
const LARGE_OR_SENSITIVE_TEXT_KEY_RE = /(body|payload|prompt|content|image|base64|raw|messages?|stdin|stdout|stderr|text)/i;
const TRACE_SAFE_TEXT_KEY_RE = /^(errorMessage|errorName|errorCode|statusMessage|reason)$/i;
const PROVIDER_HARNESS_TRACE_COLOR = pc.cyan;

function colorProviderHarnessLine(line) {
  return PROVIDER_HARNESS_TRACE_COLOR(String(line));
}

function getTraceMode() {
  const value = String(process.env.PROVIDER_HARNESS_CONSOLE_TRACE || '').trim().toLowerCase();
  if (!value && process.env.NODE_ENV === 'test') return false;
  if (FALSE_VALUES.has(value)) return false;
  if (JSON_TRACE_VALUES.has(value)) return 'json';
  return 'compact';
}

function summarizeString(value, key) {
  if (SECRET_KEY_RE.test(key)) return '[REDACTED]';
  if (TRACE_SAFE_TEXT_KEY_RE.test(key)) {
    return value.length <= MAX_SAFE_STRING_CHARS
      ? value
      : `${value.slice(0, MAX_SAFE_STRING_CHARS)}...[${value.length} chars]`;
  }
  if (LARGE_OR_SENSITIVE_TEXT_KEY_RE.test(key)) {
    return {
      type: 'string',
      length: value.length,
    };
  }
  if (value.length <= MAX_SAFE_STRING_CHARS) return value;
  return `${value.slice(0, MAX_SAFE_STRING_CHARS)}...[${value.length} chars]`;
}

function sanitizeForTrace(value, key = '', depth = 0, seen = new WeakSet()) {
  if (SECRET_KEY_RE.test(key)) return '[REDACTED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return summarizeString(value, key);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : String(value);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) {
    return {
      type: 'buffer',
      byteLength: value.length,
    };
  }
  if (value instanceof Error) {
    return {
      name: value.name || 'Error',
      code: value.code || '',
      message: value.message ? String(value.message).slice(0, MAX_SAFE_STRING_CHARS) : '',
    };
  }
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[MaxDepth]';

  seen.add(value);
  if (Array.isArray(value)) {
    const output = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((entry, index) => sanitizeForTrace(entry, `${key}[${index}]`, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) {
      output.push(`[${value.length - MAX_ARRAY_ITEMS} more items]`);
    }
    return output;
  }

  const output = {};
  const entries = Object.entries(value).slice(0, MAX_KEYS);
  for (const [nestedKey, nestedValue] of entries) {
    output[nestedKey] = sanitizeForTrace(nestedValue, nestedKey, depth + 1, seen);
  }
  const totalKeys = Object.keys(value).length;
  if (totalKeys > MAX_KEYS) {
    output.__truncatedKeys = totalKeys - MAX_KEYS;
  }
  return output;
}

function shortStage(stage) {
  return String(stage || '')
    .replace(/^image-parser\./, 'img.')
    .replace(/^provider-call-package\./, 'pkg.')
    .replace(/^remote-api-providers\./, 'remote.')
    .replace(/^lm-studio\./, 'lm.');
}

function shortId(value) {
  const text = String(value || '');
  if (!text) return '';
  return text.length > 12 ? text.slice(0, 8) : text;
}

function formatCompactValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') {
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}k`;
    return String(value);
  }
  if (typeof value === 'object') {
    if (Number.isFinite(value.byteLength)) return `${formatCompactValue(value.byteLength)}B`;
    if (Number.isFinite(value.length)) return `len:${formatCompactValue(value.length)}`;
    return '';
  }
  const text = String(value);
  if (!text || text === '[REDACTED]') return text;
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
}

function pick(payload, keys) {
  for (const key of keys) {
    const value = key.split('.').reduce((current, part) => (
      current && typeof current === 'object' ? current[part] : undefined
    ), payload);
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return '';
}

function buildCompactTraceLine(stage, payload) {
  const pairs = [
    ['run', shortId(payload.runId)],
    ['provider', pick(payload, ['providerId', 'provider'])],
    ['path', payload.providerPathType],
    ['site', payload.callSite],
    ['method', payload.method],
    ['url', payload.urlPath],
    ['status', pick(payload, ['statusCode', 'status'])],
    ['outcome', payload.outcome],
    ['model', pick(payload, ['model', 'effectiveModel', 'modelRequested'])],
    ['ms', pick(payload, ['elapsedMs', 'providerLatencyMs', 'durationMs', 'timeoutMs'])],
    ['img', pick(payload, ['imageChars', 'sourceImageChars', 'originalSizeBytes'])],
    ['body', pick(payload, ['bodyBytes', 'payloadBytes', 'responseBodyBytes', 'requestBodyBytes', 'requestBody.byteLength'])],
    ['chunk', pick(payload, ['seq', 'capturedChunks'])],
    ['text', payload.textLength],
    ['role', payload.role],
    ['id', shortId(payload.id)],
    ['skip', payload.reason],
    ['err', pick(payload, ['errorCode', 'errorName', 'errorMessage'])],
  ];

  const suffix = pairs
    .map(([key, value]) => [key, formatCompactValue(value)])
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');

  const time = String(payload.ts || new Date().toISOString()).slice(11, 23);
  return colorProviderHarnessLine(
    `[provider-harness] ${time} ${shortStage(stage)}${suffix ? ` ${suffix}` : ''}`
  );
}

function providerHarnessTrace(stage, detail = {}) {
  const mode = getTraceMode();
  if (!mode) return;
  try {
    const payload = sanitizeForTrace({
      ts: new Date().toISOString(),
      ...detail,
    });
    if (mode === 'json') {
      console.log(colorProviderHarnessLine(`[provider-harness] ${stage} ${JSON.stringify(payload)}`));
      return;
    }
    console.log(buildCompactTraceLine(stage, payload));
  } catch (err) {
    console.warn(colorProviderHarnessLine(`[provider-harness] trace_failed ${err.message}`));
  }
}

function summarizeHttpBody(body) {
  if (body === null || body === undefined) {
    return { kind: 'none', byteLength: 0 };
  }
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    kind: typeof body === 'string' ? 'text' : 'json',
    byteLength: Buffer.byteLength(text, 'utf8'),
  };
}

module.exports = {
  colorProviderHarnessLine,
  providerHarnessTrace,
  summarizeHttpBody,
};
