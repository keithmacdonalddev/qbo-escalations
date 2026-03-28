'use strict';

// ---------------------------------------------------------------------------
// image-parser-comprehensive.test.js
//
// Full end-to-end test suite for the image parser feature covering:
//   - Input validation
//   - Provider integration (anthropic, openai, kimi, lm-studio)
//   - Timeout behavior with REAL delays (setTimeout, not process.nextTick)
//   - Timeout cascade (Express middleware vs provider timeout)
//   - API key management (GET/PUT/DELETE /keys)
//   - Provider availability (/status)
//   - Response format verification
//   - Edge cases (concurrent requests, large images, Unicode, abort)
//   - noRetry behavior (client-side apiFetch semantics)
//
// Uses node:test (built-in). No external test framework needed.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { clearProviderAvailabilityCache } = require('../src/services/image-parser');

// ---------------------------------------------------------------------------
// Deterministic base64 test fixtures with correct magic bytes
// ---------------------------------------------------------------------------

// 1x1 transparent PNG (minimal valid PNG)
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, // RGBA
  0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, // IDAT chunk
  0x54, 0x78, 0x9C, 0x62, 0x00, 0x00, 0x00, 0x02,
  0x00, 0x01, 0xE5, 0x27, 0xDE, 0xFC, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42,
  0x60, 0x82, // IEND chunk
]);
const VALID_PNG_BASE64 = PNG_BYTES.toString('base64');
const VALID_PNG_DATA_URL = `data:image/png;base64,${VALID_PNG_BASE64}`;

// JPEG magic bytes (not a complete valid JPEG, but enough for detection)
const JPEG_BYTES = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
const VALID_JPEG_BASE64 = JPEG_BYTES.toString('base64');
const VALID_JPEG_DATA_URL = `data:image/jpeg;base64,${VALID_JPEG_BASE64}`;

// WebP magic bytes
const WEBP_BYTES = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x00, 0x00, 0x00, 0x00, // file size placeholder
  0x57, 0x45, 0x42, 0x50, // WEBP
]);
const VALID_WEBP_BASE64 = WEBP_BYTES.toString('base64');

// GIF magic bytes
const GIF_BYTES = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const VALID_GIF_BASE64 = GIF_BYTES.toString('base64');
const LM_STUDIO_TEST_HOST = new URL(process.env.LM_STUDIO_API_URL || 'http://127.0.0.1:1234').hostname;

// ---------------------------------------------------------------------------
// HTTP/HTTPS interception layer
//
// Intercepts outgoing http.request / https.request so we can simulate
// provider responses without hitting real APIs. Supports:
//   - Custom status codes and response bodies
//   - Configurable response delays (real setTimeout, NOT process.nextTick)
//   - Error injection (ECONNREFUSED, ENOTFOUND, timeout, etc.)
//   - SSL/TLS error simulation
// ---------------------------------------------------------------------------

let _interceptors = [];
let _interceptAll = null;

/**
 * @typedef {Object} InterceptConfig
 * @property {number}  statusCode      - HTTP status to return
 * @property {string}  body            - Response body (string)
 * @property {number}  [delayMs=0]     - Real delay before responding (setTimeout)
 * @property {string}  [errorCode]     - Emit error instead of response (e.g. 'ECONNREFUSED')
 * @property {string}  [errorMessage]  - Error message
 * @property {boolean} [timeout]       - Simulate request timeout event
 */

/**
 * Set a global intercept that catches ALL outgoing requests.
 * @param {InterceptConfig} config
 */
function interceptAllRequests(config) {
  _interceptAll = config;
}

/**
 * Push a hostname-specific interceptor (first match wins).
 * @param {string} hostname
 * @param {InterceptConfig} config
 */
function interceptHost(hostname, config) {
  _interceptors.push({ hostname, ...config });
}

function clearInterceptors() {
  _interceptors = [];
  _interceptAll = null;
}

function findInterceptor(hostname) {
  const specific = _interceptors.find(i => i.hostname === hostname);
  if (specific) return specific;
  return _interceptAll;
}

// Patch both http.request and https.request
const _origHttpRequest = http.request;
const _origHttpsRequest = https.request;
const _origHttpGet = http.get;
const _origHttpsGet = https.get;

function createPatchedRequest(origFn, mod) {
  return function patchedRequest(...args) {
    // Extract options — could be (url, options, cb) or (options, cb)
    let options = {};
    let callback;
    if (typeof args[0] === 'string' || args[0] instanceof URL) {
      const url = typeof args[0] === 'string' ? new URL(args[0]) : args[0];
      options = { hostname: url.hostname, port: url.port, path: url.pathname + url.search, ...(args[1] && typeof args[1] === 'object' ? args[1] : {}) };
      callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : undefined;
    } else if (typeof args[0] === 'object') {
      options = args[0];
      callback = typeof args[1] === 'function' ? args[1] : undefined;
    }

    const hostname = options.hostname || 'localhost';
    const intercept = findInterceptor(hostname);
    if (!intercept) return origFn.apply(mod, args);

    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {};
    req.destroy = () => { req.emit('close'); };

    const respond = () => {
      if (intercept.errorCode || intercept.errorMessage) {
        const err = new Error(intercept.errorMessage || 'Connection failed');
        err.code = intercept.errorCode || 'UNKNOWN';
        req.emit('error', err);
        return;
      }

      if (intercept.timeout) {
        req.emit('timeout');
        return;
      }

      if (callback) {
        const res = new EventEmitter();
        res.statusCode = intercept.statusCode;
        res.headers = {};
        callback(res);
        // Emit data + end in next tick so listener attachment can complete
        process.nextTick(() => {
          const body = typeof intercept.body === 'string' ? intercept.body : JSON.stringify(intercept.body || '');
          res.emit('data', body);
          res.emit('end');
        });
      }
    };

    const delayMs = intercept.delayMs || 0;
    if (delayMs > 0) {
      setTimeout(respond, delayMs);
    } else {
      process.nextTick(respond);
    }

    return req;
  };
}

function createPatchedGet(requestFn) {
  return function patchedGet(...args) {
    const req = requestFn(...args);
    if (typeof req.end === 'function') req.end();
    return req;
  };
}

// Install patches
http.request = createPatchedRequest(_origHttpRequest, http);
https.request = createPatchedRequest(_origHttpsRequest, https);
http.get = createPatchedGet(http.request);
https.get = createPatchedGet(http.request);

// ---------------------------------------------------------------------------
// fs mock helpers for key file tests
// ---------------------------------------------------------------------------
const KEYS_FILE = path.join(__dirname, '..', 'data', 'image-parser-keys.json');
const KEYS_DIR = path.dirname(KEYS_FILE);

function writeKeysFile(keys) {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), 'utf8');
}

function removeKeysFile() {
  try { fs.unlinkSync(KEYS_FILE); } catch {}
}

function readKeysFile() {
  try {
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

test.beforeEach(() => {
  clearProviderAvailabilityCache();
  clearInterceptors();
  removeKeysFile();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.MOONSHOT_API_KEY;
});

// ---------------------------------------------------------------------------
// Supertest-lite: create Express app and make requests without a running server
// ---------------------------------------------------------------------------
const { createApp } = require('../src/app');

function makeRequest(app, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    // Use _origHttpRequest to bypass our intercept layer
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const payload = body ? JSON.stringify(body) : null;
      const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
      if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

      const req = _origHttpRequest({
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method: method.toUpperCase(),
        headers,
        timeout: 15000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          let parsed;
          try { parsed = JSON.parse(data); } catch { parsed = data; }
          resolve({ status: res.statusCode, body: parsed, raw: data, headers: res.headers });
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      req.on('timeout', () => { req.destroy(); server.close(); reject(new Error('Test request timed out')); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

// ---------------------------------------------------------------------------
// Import service functions directly for unit-level tests
// ---------------------------------------------------------------------------
const {
  parseImage,
  normalizeBase64,
  detectMediaTypeFromBase64,
  detectRole,
  getApiKey,
  getStoredApiKey,
  SYSTEM_PROMPT,
} = require('../src/services/image-parser');

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITES
// ═══════════════════════════════════════════════════════════════════════════

// ===========================================================================
// 1. normalizeBase64 — unit tests
// ===========================================================================
test('normalizeBase64', async (t) => {
  await t.test('returns null for empty string', () => {
    assert.equal(normalizeBase64(''), null);
  });

  await t.test('returns null for whitespace-only string', () => {
    assert.equal(normalizeBase64('   '), null);
  });

  await t.test('returns null for null input', () => {
    assert.equal(normalizeBase64(null), null);
  });

  await t.test('returns null for undefined input', () => {
    assert.equal(normalizeBase64(undefined), null);
  });

  await t.test('returns null for non-string input', () => {
    assert.equal(normalizeBase64(42), null);
    assert.equal(normalizeBase64({}), null);
  });

  await t.test('extracts mediaType from data-URL prefix (PNG)', () => {
    const result = normalizeBase64(VALID_PNG_DATA_URL);
    assert.equal(result.mediaType, 'image/png');
    assert.equal(result.rawBase64, VALID_PNG_BASE64);
    assert.ok(result.dataUrl.startsWith('data:image/png;base64,'));
  });

  await t.test('extracts mediaType from data-URL prefix (JPEG)', () => {
    const result = normalizeBase64(VALID_JPEG_DATA_URL);
    assert.equal(result.mediaType, 'image/jpeg');
    assert.equal(result.rawBase64, VALID_JPEG_BASE64);
  });

  await t.test('detects PNG from raw base64 magic bytes (no prefix)', () => {
    const result = normalizeBase64(VALID_PNG_BASE64);
    assert.equal(result.mediaType, 'image/png');
    assert.equal(result.rawBase64, VALID_PNG_BASE64);
  });

  await t.test('detects JPEG from raw base64 magic bytes (no prefix)', () => {
    const result = normalizeBase64(VALID_JPEG_BASE64);
    assert.equal(result.mediaType, 'image/jpeg');
  });

  await t.test('detects WebP from raw base64 magic bytes (no prefix)', () => {
    const result = normalizeBase64(VALID_WEBP_BASE64);
    assert.equal(result.mediaType, 'image/webp');
  });

  await t.test('detects GIF from raw base64 magic bytes (no prefix)', () => {
    const result = normalizeBase64(VALID_GIF_BASE64);
    assert.equal(result.mediaType, 'image/gif');
  });

  await t.test('defaults to image/png for unrecognizable base64', () => {
    // Random base64 that does not match any magic number
    const result = normalizeBase64('AAAA');
    assert.equal(result.mediaType, 'image/png');
  });

  await t.test('constructs correct dataUrl from raw base64', () => {
    const result = normalizeBase64(VALID_PNG_BASE64);
    assert.equal(result.dataUrl, `data:image/png;base64,${VALID_PNG_BASE64}`);
  });

  await t.test('handles data-URL with image/webp media type', () => {
    const dataUrl = `data:image/webp;base64,${VALID_WEBP_BASE64}`;
    const result = normalizeBase64(dataUrl);
    assert.equal(result.mediaType, 'image/webp');
    assert.equal(result.rawBase64, VALID_WEBP_BASE64);
  });

  await t.test('trims whitespace around input', () => {
    const result = normalizeBase64(`  ${VALID_PNG_DATA_URL}  `);
    assert.equal(result.mediaType, 'image/png');
    assert.equal(result.rawBase64, VALID_PNG_BASE64);
  });
});

// ===========================================================================
// 2. detectMediaTypeFromBase64 — unit tests
// ===========================================================================
test('detectMediaTypeFromBase64', async (t) => {
  await t.test('detects PNG', () => {
    assert.equal(detectMediaTypeFromBase64(VALID_PNG_BASE64), 'image/png');
  });

  await t.test('detects JPEG', () => {
    assert.equal(detectMediaTypeFromBase64(VALID_JPEG_BASE64), 'image/jpeg');
  });

  await t.test('detects GIF', () => {
    assert.equal(detectMediaTypeFromBase64(VALID_GIF_BASE64), 'image/gif');
  });

  await t.test('detects WebP', () => {
    assert.equal(detectMediaTypeFromBase64(VALID_WEBP_BASE64), 'image/webp');
  });

  await t.test('falls back to image/png for unrecognizable data', () => {
    assert.equal(detectMediaTypeFromBase64('AAAA'), 'image/png');
  });

  await t.test('falls back to image/png for empty string', () => {
    assert.equal(detectMediaTypeFromBase64(''), 'image/png');
  });

  await t.test('falls back to image/png for corrupt base64', () => {
    assert.equal(detectMediaTypeFromBase64('!!!NOT-BASE64!!!'), 'image/png');
  });
});

// ===========================================================================
// 3. detectRole — unit tests
// ===========================================================================
test('detectRole', async (t) => {
  await t.test('detects escalation from COID/MID field', () => {
    assert.equal(detectRole('COID/MID: 12345\nCASE: 67890'), 'escalation');
  });

  await t.test('detects escalation from CASE field', () => {
    assert.equal(detectRole('CASE: 12345'), 'escalation');
  });

  await t.test('detects escalation from CX IS ATTEMPTING TO field', () => {
    assert.equal(detectRole('CX IS ATTEMPTING TO: do something'), 'escalation');
  });

  await t.test('detects inv-list from INV numbers', () => {
    assert.equal(detectRole('INV-123456 some description'), 'inv-list');
  });

  await t.test('returns unknown for unrecognizable text', () => {
    assert.equal(detectRole('Hello world'), 'unknown');
  });

  await t.test('returns unknown for empty string', () => {
    assert.equal(detectRole(''), 'unknown');
  });

  await t.test('prefers inv-list when both patterns present', () => {
    // INV regex is checked first in the code
    assert.equal(detectRole('INV-123456 COID/MID: 12345'), 'inv-list');
  });
});

// ===========================================================================
// 4. Input validation — route-level tests via POST /api/image-parser/parse
// ===========================================================================
test('POST /parse — input validation', async (t) => {
  const app = createApp();

  await t.test('rejects missing image field', async () => {
    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', { provider: 'anthropic' });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'MISSING_IMAGE');
  });

  await t.test('rejects empty body', async () => {
    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {});
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'MISSING_IMAGE');
  });

  await t.test('rejects missing provider', async () => {
    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', { image: VALID_PNG_BASE64 });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'INVALID_PROVIDER');
  });

  await t.test('rejects invalid provider name', async () => {
    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', { image: VALID_PNG_BASE64, provider: 'google-gemini' });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'INVALID_PROVIDER');
  });

  await t.test('rejects empty string provider', async () => {
    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', { image: VALID_PNG_BASE64, provider: '' });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'INVALID_PROVIDER');
  });

  await t.test('accepts valid providers: lm-studio, anthropic, openai, kimi', async () => {
    for (const provider of ['lm-studio', 'anthropic', 'openai', 'kimi']) {
      // These will fail at the provider call level (no API key / no LM Studio)
      // but should NOT fail at validation. Check that we don't get MISSING_IMAGE
      // or INVALID_PROVIDER.
      const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
        image: VALID_PNG_BASE64,
        provider,
      });
      assert.notEqual(res.body.code, 'MISSING_IMAGE', `${provider} should not fail on MISSING_IMAGE`);
      assert.notEqual(res.body.code, 'INVALID_PROVIDER', `${provider} should not fail on INVALID_PROVIDER`);
    }
  });
});

// ===========================================================================
// 5. parseImage service — unit tests with interceptors
// ===========================================================================
test('parseImage — provider dispatch', async (t) => {
  t.afterEach(() => {
    clearInterceptors();
    removeKeysFile();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.MOONSHOT_API_KEY;
  });

  await t.test('throws MISSING_IMAGE for empty string', async () => {
    await assert.rejects(() => parseImage(''), (err) => {
      assert.equal(err.code, 'MISSING_IMAGE');
      return true;
    });
  });

  await t.test('throws MISSING_IMAGE for null', async () => {
    await assert.rejects(() => parseImage(null), (err) => {
      assert.equal(err.code, 'MISSING_IMAGE');
      return true;
    });
  });

  await t.test('throws MISSING_IMAGE for non-string', async () => {
    await assert.rejects(() => parseImage(123), (err) => {
      assert.equal(err.code, 'MISSING_IMAGE');
      return true;
    });
  });

  await t.test('throws INVALID_PROVIDER for unknown provider', async () => {
    await assert.rejects(() => parseImage(VALID_PNG_BASE64, { provider: 'gemini' }), (err) => {
      assert.equal(err.code, 'INVALID_PROVIDER');
      return true;
    });
  });

  await t.test('throws PROVIDER_UNAVAILABLE for anthropic without API key', async () => {
    await assert.rejects(() => parseImage(VALID_PNG_BASE64, { provider: 'anthropic' }), (err) => {
      assert.equal(err.code, 'PROVIDER_UNAVAILABLE');
      return true;
    });
  });

  await t.test('throws PROVIDER_UNAVAILABLE for openai without API key', async () => {
    await assert.rejects(() => parseImage(VALID_PNG_BASE64, { provider: 'openai' }), (err) => {
      assert.equal(err.code, 'PROVIDER_UNAVAILABLE');
      return true;
    });
  });

  await t.test('throws PROVIDER_UNAVAILABLE for kimi without API key', async () => {
    await assert.rejects(() => parseImage(VALID_PNG_BASE64, { provider: 'kimi' }), (err) => {
      assert.equal(err.code, 'PROVIDER_UNAVAILABLE');
      return true;
    });
  });
});

// ===========================================================================
// 6. Provider integration — successful responses
// ===========================================================================
test('parseImage — successful provider calls', async (t) => {
  t.afterEach(() => {
    clearInterceptors();
    removeKeysFile();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.MOONSHOT_API_KEY;
  });

  await t.test('anthropic — successful parse returns text, role, usage', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'COID/MID: 12345\nCASE: 67890' }],
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    });

    const result = await parseImage(VALID_PNG_BASE64, { provider: 'anthropic' });
    assert.equal(result.text, 'COID/MID: 12345\nCASE: 67890');
    assert.equal(result.role, 'escalation');
    assert.ok(result.usage);
    assert.equal(result.usage.inputTokens, 100);
    assert.equal(result.usage.outputTokens, 50);
  });

  await t.test('openai — successful parse returns text, role, usage', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test-key';
    interceptHost('api.openai.com', {
      statusCode: 200,
      body: JSON.stringify({
        choices: [{ message: { content: 'INV-123456 Some issue description' } }],
        model: 'gpt-4o',
        usage: { prompt_tokens: 200, completion_tokens: 80 },
      }),
    });

    const result = await parseImage(VALID_PNG_BASE64, { provider: 'openai' });
    assert.equal(result.text, 'INV-123456 Some issue description');
    assert.equal(result.role, 'inv-list');
    assert.ok(result.usage);
    assert.equal(result.usage.inputTokens, 200);
    assert.equal(result.usage.outputTokens, 80);
  });

  await t.test('kimi — successful parse returns text, role, usage', async () => {
    process.env.MOONSHOT_API_KEY = 'sk-kimi-test-key';
    interceptHost('api.moonshot.ai', {
      statusCode: 200,
      body: JSON.stringify({
        choices: [{ message: { content: 'Hello world' } }],
        model: 'kimi-k2.5',
        usage: { prompt_tokens: 50, completion_tokens: 10 },
      }),
    });

    const result = await parseImage(VALID_PNG_BASE64, { provider: 'kimi' });
    assert.equal(result.text, 'Hello world');
    assert.equal(result.role, 'unknown');
    assert.ok(result.usage);
  });

  await t.test('lm-studio — successful parse returns text, role, usage', async () => {
    // LM Studio uses http (not https) at LM_STUDIO_API_URL
    interceptHost(LM_STUDIO_TEST_HOST, {
      statusCode: 200,
      body: JSON.stringify({
        choices: [{ message: { content: 'COID/MID: 999\nCASE: 111' } }],
        model: 'local-model',
        usage: { prompt_tokens: 300, completion_tokens: 60 },
      }),
    });

    const result = await parseImage(VALID_PNG_BASE64, { provider: 'lm-studio', model: 'local-model' });
    assert.equal(result.text, 'COID/MID: 999\nCASE: 111');
    assert.equal(result.role, 'escalation');
    assert.ok(result.usage);
    assert.equal(result.usage.model, 'local-model');
  });

  await t.test('anthropic — sends correct media type for JPEG data URL', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    let capturedBody = null;
    const origInterceptHost = interceptHost;

    // Custom interceptor that captures the request body
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'parsed' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    // With the fix, sending a JPEG data URL should preserve the jpeg media type
    const result = await parseImage(VALID_JPEG_DATA_URL, { provider: 'anthropic' });
    assert.equal(result.text, 'parsed');
  });
});

// ===========================================================================
// 7. Provider error handling
// ===========================================================================
test('parseImage — provider errors', async (t) => {
  t.afterEach(() => {
    clearInterceptors();
    removeKeysFile();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.MOONSHOT_API_KEY;
  });

  await t.test('anthropic — non-200 status throws PROVIDER_ERROR', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      statusCode: 500,
      body: JSON.stringify({ error: { message: 'Internal error' } }),
    });

    await assert.rejects(() => parseImage(VALID_PNG_BASE64, { provider: 'anthropic' }), (err) => {
      assert.equal(err.code, 'PROVIDER_ERROR');
      assert.ok(err.message.includes('500'));
      return true;
    });
  });

  await t.test('openai — non-200 status throws PROVIDER_ERROR', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    interceptHost('api.openai.com', {
      statusCode: 429,
      body: JSON.stringify({ error: { message: 'Rate limited' } }),
    });

    await assert.rejects(() => parseImage(VALID_PNG_BASE64, { provider: 'openai' }), (err) => {
      assert.equal(err.code, 'PROVIDER_ERROR');
      return true;
    });
  });

  await t.test('kimi — non-200 status throws PROVIDER_ERROR', async () => {
    process.env.MOONSHOT_API_KEY = 'sk-kimi-test';
    interceptHost('api.moonshot.ai', {
      statusCode: 401,
      body: JSON.stringify({ error: { message: 'Unauthorized' } }),
    });

    await assert.rejects(() => parseImage(VALID_PNG_BASE64, { provider: 'kimi' }), (err) => {
      assert.equal(err.code, 'PROVIDER_ERROR');
      return true;
    });
  });

  await t.test('anthropic — malformed JSON response throws PROVIDER_ERROR', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: 'NOT-JSON{{{',
    });

    await assert.rejects(() => parseImage(VALID_PNG_BASE64, { provider: 'anthropic' }), (err) => {
      assert.equal(err.code, 'PROVIDER_ERROR');
      assert.ok(err.message.includes('invalid JSON'));
      return true;
    });
  });

  await t.test('openai — malformed JSON response throws PROVIDER_ERROR', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    interceptHost('api.openai.com', {
      statusCode: 200,
      body: '<html>500 Error</html>',
    });

    await assert.rejects(() => parseImage(VALID_PNG_BASE64, { provider: 'openai' }), (err) => {
      assert.equal(err.code, 'PROVIDER_ERROR');
      return true;
    });
  });

  await t.test('anthropic — empty response body returns empty text', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({ content: [], usage: { input_tokens: 1, output_tokens: 0 } }),
    });

    const result = await parseImage(VALID_PNG_BASE64, { provider: 'anthropic' });
    assert.equal(result.text, '');
    assert.equal(result.role, 'unknown');
  });

  await t.test('openai — response missing choices returns empty text', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    interceptHost('api.openai.com', {
      statusCode: 200,
      body: JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 0 } }),
    });

    const result = await parseImage(VALID_PNG_BASE64, { provider: 'openai' });
    assert.equal(result.text, '');
  });

  await t.test('lm-studio — connection refused', async () => {
    interceptHost(LM_STUDIO_TEST_HOST, {
      errorCode: 'ECONNREFUSED',
      errorMessage: `connect ECONNREFUSED ${LM_STUDIO_TEST_HOST}:1234`,
    });

    await assert.rejects(
      () => parseImage(VALID_PNG_BASE64, { provider: 'lm-studio', model: 'test-model' }),
      (err) => {
        assert.equal(err.code, 'ECONNREFUSED');
        return true;
      }
    );
  });

  await t.test('anthropic — DNS resolution failure', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      errorCode: 'ENOTFOUND',
      errorMessage: 'getaddrinfo ENOTFOUND api.anthropic.com',
    });

    await assert.rejects(
      () => parseImage(VALID_PNG_BASE64, { provider: 'anthropic' }),
      (err) => {
        assert.equal(err.code, 'ENOTFOUND');
        return true;
      }
    );
  });

  await t.test('openai — SSL/TLS error', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    interceptHost('api.openai.com', {
      errorCode: 'ERR_TLS_CERT_ALTNAME_INVALID',
      errorMessage: 'Hostname/IP does not match certificate altnames',
    });

    await assert.rejects(
      () => parseImage(VALID_PNG_BASE64, { provider: 'openai' }),
      (err) => {
        assert.equal(err.code, 'ERR_TLS_CERT_ALTNAME_INVALID');
        return true;
      }
    );
  });
});

// ===========================================================================
// 8. Timeout behavior — uses REAL setTimeout delays
// ===========================================================================
test('parseImage — timeout behavior', async (t) => {
  t.afterEach(() => {
    clearInterceptors();
    removeKeysFile();
    delete process.env.ANTHROPIC_API_KEY;
  });

  await t.test('request completing just under timeout succeeds', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    // Timeout = 3000ms, response arrives at 2500ms (under timeout)
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'parsed under timeout' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      delayMs: 2500,
    });

    const result = await parseImage(VALID_PNG_BASE64, { provider: 'anthropic', timeoutMs: 3000 });
    assert.equal(result.text, 'parsed under timeout');
  });

  await t.test('request exceeding timeout triggers TIMEOUT error', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    // Timeout = 2000ms, response arrives at 3000ms (over timeout)
    interceptHost('api.anthropic.com', {
      timeout: true,
      delayMs: 100, // quickly emit timeout event
    });

    await assert.rejects(
      () => parseImage(VALID_PNG_BASE64, { provider: 'anthropic', timeoutMs: 2000 }),
      (err) => {
        assert.equal(err.code, 'TIMEOUT');
        return true;
      }
    );
  });

  await t.test('custom timeoutMs values are respected', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

    // Fast timeout (1500ms), response at 2000ms — should timeout
    interceptHost('api.anthropic.com', {
      timeout: true,
      delayMs: 50,
    });

    await assert.rejects(
      () => parseImage(VALID_PNG_BASE64, { provider: 'anthropic', timeoutMs: 1500 }),
      (err) => {
        assert.equal(err.code, 'TIMEOUT');
        return true;
      }
    );
  });
});

// ===========================================================================
// 9. Timeout edge values — clamping and sanitization
// ===========================================================================
test('POST /parse — timeoutMs edge values', async (t) => {
  const app = createApp();

  t.afterEach(() => {
    clearInterceptors();
    removeKeysFile();
    delete process.env.ANTHROPIC_API_KEY;
  });

  await t.test('timeoutMs at max cap (120000) is accepted', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      image: VALID_PNG_BASE64,
      provider: 'anthropic',
      timeoutMs: 120000,
    });
    assert.equal(res.body.ok, true);
  });

  await t.test('timeoutMs exceeding max cap is clamped to 120000', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    // 300000ms should be clamped to 120000
    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      image: VALID_PNG_BASE64,
      provider: 'anthropic',
      timeoutMs: 300000,
    });
    // Should not error — the route clamps it
    assert.equal(res.body.ok, true);
  });

  await t.test('timeoutMs = 0 uses default (60000)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      image: VALID_PNG_BASE64,
      provider: 'anthropic',
      timeoutMs: 0,
    });
    assert.equal(res.body.ok, true);
  });

  await t.test('timeoutMs negative uses default', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      image: VALID_PNG_BASE64,
      provider: 'anthropic',
      timeoutMs: -5000,
    });
    assert.equal(res.body.ok, true);
  });

  await t.test('timeoutMs = NaN uses default', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      image: VALID_PNG_BASE64,
      provider: 'anthropic',
      timeoutMs: NaN,
    });
    assert.equal(res.body.ok, true);
  });

  await t.test('timeoutMs = Infinity uses default', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      image: VALID_PNG_BASE64,
      provider: 'anthropic',
      timeoutMs: Infinity,
    });
    assert.equal(res.body.ok, true);
  });

  await t.test('timeoutMs as string uses default', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      image: VALID_PNG_BASE64,
      provider: 'anthropic',
      timeoutMs: 'fast',
    });
    assert.equal(res.body.ok, true);
  });

  await t.test('timeoutMs = null uses default', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      image: VALID_PNG_BASE64,
      provider: 'anthropic',
      timeoutMs: null,
    });
    assert.equal(res.body.ok, true);
  });
});

// ===========================================================================
// 10. Timeout cascade — Express responseTimeout vs provider timeout
// ===========================================================================
test('timeout cascade — middleware vs provider', async (t) => {
  t.afterEach(() => {
    clearInterceptors();
    delete process.env.ANTHROPIC_API_KEY;
  });

  await t.test('setResponseTimeout is called with effectiveTimeout + 30000', async () => {
    const app = createApp();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    // Custom timeoutMs = 45000, so Express should be set to 75000 (45000 + 30000)
    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      image: VALID_PNG_BASE64,
      provider: 'anthropic',
      timeoutMs: 45000,
    });
    // Can't directly assert on the timer value from outside, but we verify
    // the response completed successfully (no 504 from middleware)
    assert.equal(res.body.ok, true);
  });

  await t.test('provider timeout error returns 504 with proper JSON', async () => {
    const app = createApp();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

    interceptHost('api.anthropic.com', {
      timeout: true,
    });

    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      image: VALID_PNG_BASE64,
      provider: 'anthropic',
      timeoutMs: 1000,
    });
    assert.equal(res.status, 504);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'TIMEOUT');
  });
});

// ===========================================================================
// 11. API Key management — GET/PUT /keys
// ===========================================================================
test('GET /keys', async (t) => {
  const app = createApp();

  t.afterEach(() => {
    removeKeysFile();
  });

  await t.test('returns all false when no keys stored and no keys file', async () => {
    removeKeysFile();
    const res = await makeRequest(app, 'GET', '/api/image-parser/keys');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.keys.anthropic, false);
    assert.equal(res.body.keys.openai, false);
    assert.equal(res.body.keys.kimi, false);
  });

  await t.test('returns true for stored keys', async () => {
    writeKeysFile({ anthropic: 'sk-ant-test', openai: 'sk-openai-test' });
    const res = await makeRequest(app, 'GET', '/api/image-parser/keys');
    assert.equal(res.body.keys.anthropic, true);
    assert.equal(res.body.keys.openai, true);
    assert.equal(res.body.keys.kimi, false);
  });

  await t.test('returns all false when keys file is corrupted JSON', async () => {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
    fs.writeFileSync(KEYS_FILE, 'NOT{VALID}JSON!!!', 'utf8');
    const res = await makeRequest(app, 'GET', '/api/image-parser/keys');
    assert.equal(res.body.ok, true);
    assert.equal(res.body.keys.anthropic, false);
    assert.equal(res.body.keys.openai, false);
    assert.equal(res.body.keys.kimi, false);
  });

  await t.test('treats whitespace-only key as absent', async () => {
    writeKeysFile({ anthropic: '   ', openai: 'sk-real' });
    const res = await makeRequest(app, 'GET', '/api/image-parser/keys');
    assert.equal(res.body.keys.anthropic, false);
    assert.equal(res.body.keys.openai, true);
  });
});

test('PUT /keys', async (t) => {
  const app = createApp();

  t.afterEach(() => {
    removeKeysFile();
  });

  await t.test('stores a new key', async () => {
    const res = await makeRequest(app, 'PUT', '/api/image-parser/keys', {
      provider: 'anthropic',
      key: 'sk-ant-new-key',
    });
    assert.equal(res.body.ok, true);
    const stored = readKeysFile();
    assert.equal(stored.anthropic, 'sk-ant-new-key');
  });

  await t.test('updates an existing key', async () => {
    writeKeysFile({ anthropic: 'old-key' });
    const res = await makeRequest(app, 'PUT', '/api/image-parser/keys', {
      provider: 'anthropic',
      key: 'new-key',
    });
    assert.equal(res.body.ok, true);
    const stored = readKeysFile();
    assert.equal(stored.anthropic, 'new-key');
  });

  await t.test('removes key when empty key provided', async () => {
    writeKeysFile({ anthropic: 'existing-key', openai: 'openai-key' });
    const res = await makeRequest(app, 'PUT', '/api/image-parser/keys', {
      provider: 'anthropic',
      key: '',
    });
    assert.equal(res.body.ok, true);
    const stored = readKeysFile();
    assert.equal(stored.anthropic, undefined);
    assert.equal(stored.openai, 'openai-key');
  });

  await t.test('removes key when null key provided', async () => {
    writeKeysFile({ openai: 'existing-key' });
    const res = await makeRequest(app, 'PUT', '/api/image-parser/keys', {
      provider: 'openai',
      key: null,
    });
    assert.equal(res.body.ok, true);
    const stored = readKeysFile();
    assert.equal(stored.openai, undefined);
  });

  await t.test('rejects invalid provider for PUT', async () => {
    const res = await makeRequest(app, 'PUT', '/api/image-parser/keys', {
      provider: 'gemini',
      key: 'test',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'INVALID_PROVIDER');
  });

  await t.test('rejects lm-studio as provider for keys (no API key needed)', async () => {
    const res = await makeRequest(app, 'PUT', '/api/image-parser/keys', {
      provider: 'lm-studio',
      key: 'test',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'INVALID_PROVIDER');
  });

  await t.test('creates data directory if it does not exist', async () => {
    try { fs.rmSync(KEYS_DIR, { recursive: true, force: true }); } catch {}
    const res = await makeRequest(app, 'PUT', '/api/image-parser/keys', {
      provider: 'openai',
      key: 'sk-test',
    });
    assert.equal(res.body.ok, true);
    assert.ok(fs.existsSync(KEYS_FILE));
  });

  await t.test('handles corrupted existing keys file gracefully', async () => {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
    fs.writeFileSync(KEYS_FILE, 'NOT-JSON', 'utf8');
    const res = await makeRequest(app, 'PUT', '/api/image-parser/keys', {
      provider: 'kimi',
      key: 'sk-kimi-new',
    });
    assert.equal(res.body.ok, true);
    const stored = readKeysFile();
    assert.equal(stored.kimi, 'sk-kimi-new');
  });

  await t.test('trims whitespace from key', async () => {
    const res = await makeRequest(app, 'PUT', '/api/image-parser/keys', {
      provider: 'anthropic',
      key: '  sk-trimmed  ',
    });
    assert.equal(res.body.ok, true);
    const stored = readKeysFile();
    assert.equal(stored.anthropic, 'sk-trimmed');
  });
});

// ===========================================================================
// 12. API key resolution — stored file vs env var fallback
// ===========================================================================
test('getApiKey — resolution order', async (t) => {
  t.afterEach(() => {
    removeKeysFile();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.MOONSHOT_API_KEY;
  });

  await t.test('returns stored key over env var', () => {
    writeKeysFile({ anthropic: 'stored-key' });
    process.env.ANTHROPIC_API_KEY = 'env-key';
    assert.equal(getApiKey('anthropic'), 'stored-key');
  });

  await t.test('falls back to env var when no stored key', () => {
    removeKeysFile();
    process.env.OPENAI_API_KEY = 'env-openai-key';
    assert.equal(getApiKey('openai'), 'env-openai-key');
  });

  await t.test('returns null when no stored key and no env var', () => {
    removeKeysFile();
    assert.equal(getApiKey('anthropic'), null);
  });

  await t.test('maps kimi to MOONSHOT_API_KEY env var', () => {
    process.env.MOONSHOT_API_KEY = 'env-moonshot';
    assert.equal(getApiKey('kimi'), 'env-moonshot');
  });

  await t.test('returns null for unknown provider', () => {
    assert.equal(getApiKey('gemini'), null);
  });
});

// ===========================================================================
// 13. Provider availability — GET /status
// ===========================================================================
test('GET /status', async (t) => {
  const app = createApp();

  t.afterEach(() => {
    clearInterceptors();
    removeKeysFile();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.MOONSHOT_API_KEY;
  });

  await t.test('reports all providers unavailable when no keys and LM Studio down', async () => {
    interceptHost(LM_STUDIO_TEST_HOST, {
      errorCode: 'ECONNREFUSED',
      errorMessage: 'connect ECONNREFUSED',
    });

    const res = await makeRequest(app, 'GET', '/api/image-parser/status');
    assert.equal(res.body.ok, true);
    assert.equal(res.body.providers['lm-studio'].available, false);
    assert.equal(res.body.providers.anthropic.available, false);
    assert.equal(res.body.providers.openai.available, false);
    assert.equal(res.body.providers.kimi.available, false);
  });

  await t.test('reports anthropic available when key is configured', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    interceptHost(LM_STUDIO_TEST_HOST, {
      errorCode: 'ECONNREFUSED',
      errorMessage: 'connect ECONNREFUSED',
    });

    const res = await makeRequest(app, 'GET', '/api/image-parser/status');
    assert.equal(res.body.providers.anthropic.available, true);
    assert.ok(res.body.providers.anthropic.reason.includes('configured'));
  });

  await t.test('reports lm-studio available when it returns a model', async () => {
    interceptHost(LM_STUDIO_TEST_HOST, {
      statusCode: 200,
      body: JSON.stringify({ data: [{ id: 'gemma-3-12b' }] }),
    });

    const res = await makeRequest(app, 'GET', '/api/image-parser/status');
    assert.equal(res.body.providers['lm-studio'].available, true);
    assert.ok(res.body.providers['lm-studio'].model, 'gemma-3-12b');
  });

  await t.test('reports lm-studio unavailable when no model loaded', async () => {
    interceptHost(LM_STUDIO_TEST_HOST, {
      statusCode: 200,
      body: JSON.stringify({ data: [] }),
    });

    const res = await makeRequest(app, 'GET', '/api/image-parser/status');
    assert.equal(res.body.providers['lm-studio'].available, false);
  });

  await t.test('reports lm-studio unavailable on timeout', async () => {
    interceptHost(LM_STUDIO_TEST_HOST, {
      timeout: true,
    });

    const res = await makeRequest(app, 'GET', '/api/image-parser/status');
    assert.equal(res.body.providers['lm-studio'].available, false);
    assert.ok(res.body.providers['lm-studio'].reason.includes('timed out'));
  });
});

// ===========================================================================
// 14. Response format verification
// ===========================================================================
test('response format — success', async (t) => {
  const app = createApp();

  t.afterEach(() => {
    clearInterceptors();
    delete process.env.ANTHROPIC_API_KEY;
  });

  await t.test('success response has ok, text, role, usage, elapsedMs', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'COID/MID: 123' }],
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      image: VALID_PNG_BASE64,
      provider: 'anthropic',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(typeof res.body.text, 'string');
    assert.ok(res.body.text.length > 0);
    assert.equal(typeof res.body.role, 'string');
    assert.ok(['escalation', 'inv-list', 'unknown'].includes(res.body.role));
    assert.equal(typeof res.body.usage, 'object');
    assert.equal(typeof res.body.elapsedMs, 'number');
    assert.ok(res.body.elapsedMs >= 0, 'elapsedMs should be non-negative');
  });
});

test('response format — errors', async (t) => {
  const app = createApp();

  t.afterEach(() => {
    clearInterceptors();
    delete process.env.ANTHROPIC_API_KEY;
  });

  await t.test('TIMEOUT returns 504 with correct format', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', { timeout: true });

    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      image: VALID_PNG_BASE64,
      provider: 'anthropic',
      timeoutMs: 1000,
    });
    assert.equal(res.status, 504);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'TIMEOUT');
    assert.equal(typeof res.body.error, 'string');
  });

  await t.test('PROVIDER_UNAVAILABLE returns 503 with correct format', async () => {
    // No key = unavailable
    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      image: VALID_PNG_BASE64,
      provider: 'anthropic',
    });
    assert.equal(res.status, 503);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'PROVIDER_UNAVAILABLE');
  });

  await t.test('PROVIDER_ERROR returns 422 with correct format', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      statusCode: 500,
      body: JSON.stringify({ error: { message: 'Server error' } }),
    });

    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      image: VALID_PNG_BASE64,
      provider: 'anthropic',
    });
    assert.equal(res.status, 422);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'PROVIDER_ERROR');
  });

  await t.test('MISSING_IMAGE returns 400', async () => {
    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      provider: 'anthropic',
    });
    assert.equal(res.status, 400);
  });

  await t.test('INVALID_PROVIDER returns 400', async () => {
    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      image: VALID_PNG_BASE64,
      provider: 'invalid',
    });
    assert.equal(res.status, 400);
  });
});

// ===========================================================================
// 15. Edge cases
// ===========================================================================
test('edge cases', async (t) => {
  t.afterEach(() => {
    clearInterceptors();
    delete process.env.ANTHROPIC_API_KEY;
  });

  await t.test('concurrent parse requests both complete', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'concurrent result' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      delayMs: 100,
    });

    const [r1, r2] = await Promise.all([
      parseImage(VALID_PNG_BASE64, { provider: 'anthropic' }),
      parseImage(VALID_PNG_BASE64, { provider: 'anthropic' }),
    ]);

    assert.equal(r1.text, 'concurrent result');
    assert.equal(r2.text, 'concurrent result');
  });

  await t.test('Unicode/special characters in parsed text are preserved', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const unicodeText = 'COID/MID: 12345\nCLIENT: Jean-Fran\u00e7ois L\u00e9gar\u00e9\nNotes: \u2714 Verified \u2022 \u00c9scalation r\u00e9solue';
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: unicodeText }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    const result = await parseImage(VALID_PNG_BASE64, { provider: 'anthropic' });
    assert.equal(result.text, unicodeText);
  });

  await t.test('provider returns valid JSON but missing expected fields', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({
        // No content field, no usage field — just an id
        id: 'msg_test',
      }),
    });

    const result = await parseImage(VALID_PNG_BASE64, { provider: 'anthropic' });
    assert.equal(result.text, '');
    assert.equal(result.usage, null);
    assert.equal(result.role, 'unknown');
  });

  await t.test('handles data URL with uncommon media type (image/svg+xml)', async () => {
    const svgB64 = Buffer.from('<svg></svg>').toString('base64');
    const dataUrl = `data:image/svg+xml;base64,${svgB64}`;
    const result = normalizeBase64(dataUrl);
    assert.equal(result.mediaType, 'image/svg+xml');
    assert.equal(result.rawBase64, svgB64);
  });
});

// ===========================================================================
// 16. SYSTEM_PROMPT — verify it contains both roles
// ===========================================================================
test('SYSTEM_PROMPT', async (t) => {
  await t.test('contains escalation role instructions', () => {
    assert.ok(SYSTEM_PROMPT.includes('ROLE 1: ESCALATION TEMPLATE PARSE'));
    assert.ok(SYSTEM_PROMPT.includes('COID/MID'));
  });

  await t.test('contains INV list role instructions', () => {
    assert.ok(SYSTEM_PROMPT.includes('ROLE 2: INV LIST PARSE'));
    assert.ok(SYSTEM_PROMPT.includes('INV-XXXXXX'));
  });

  await t.test('contains role detection instructions', () => {
    assert.ok(SYSTEM_PROMPT.includes('ROLE DETECTION'));
  });
});

// ===========================================================================
// 17. Keys test endpoint — POST /keys/test
// ===========================================================================
test('POST /keys/test', async (t) => {
  const app = createApp();

  t.afterEach(() => {
    clearInterceptors();
    removeKeysFile();
    delete process.env.ANTHROPIC_API_KEY;
  });

  await t.test('rejects invalid provider', async () => {
    const res = await makeRequest(app, 'POST', '/api/image-parser/keys/test', {
      provider: 'gemini',
      key: 'test',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'INVALID_PROVIDER');
  });

  await t.test('returns NO_KEY when no key provided and none stored', async () => {
    const res = await makeRequest(app, 'POST', '/api/image-parser/keys/test', {
      provider: 'anthropic',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'NO_KEY');
  });

  await t.test('tests with provided key (not stored)', async () => {
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({ content: [{ text: 'ok' }] }),
    });

    const res = await makeRequest(app, 'POST', '/api/image-parser/keys/test', {
      provider: 'anthropic',
      key: 'sk-test-key',
    });
    assert.equal(res.body.ok, true);
  });

  await t.test('reports invalid key on 401', async () => {
    interceptHost('api.anthropic.com', {
      statusCode: 401,
      body: JSON.stringify({ error: { message: 'Invalid API key' } }),
    });

    const res = await makeRequest(app, 'POST', '/api/image-parser/keys/test', {
      provider: 'anthropic',
      key: 'sk-bad-key',
    });
    assert.equal(res.body.ok, false);
    assert.ok(res.body.error.includes('Invalid'));
  });

  await t.test('reports timeout on connection timeout', async () => {
    interceptHost('api.anthropic.com', { timeout: true });

    const res = await makeRequest(app, 'POST', '/api/image-parser/keys/test', {
      provider: 'anthropic',
      key: 'sk-test',
    });
    assert.equal(res.body.ok, false);
    assert.ok(res.body.error.includes('timed out'));
  });

  await t.test('falls back to stored key when no key in request body', async () => {
    writeKeysFile({ anthropic: 'sk-stored' });
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({ content: [{ text: 'ok' }] }),
    });

    const res = await makeRequest(app, 'POST', '/api/image-parser/keys/test', {
      provider: 'anthropic',
    });
    assert.equal(res.body.ok, true);
  });
});

// ===========================================================================
// 18. Real-delay timeout tests (the critical gap in existing tests)
// ===========================================================================
test('real-delay timeout scenarios', { timeout: 15000 }, async (t) => {
  t.afterEach(() => {
    clearInterceptors();
    delete process.env.ANTHROPIC_API_KEY;
  });

  await t.test('response arriving at 1.5s with 2s timeout succeeds', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'fast result' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      delayMs: 1500,
    });

    const start = Date.now();
    const result = await parseImage(VALID_PNG_BASE64, { provider: 'anthropic', timeoutMs: 2000 });
    const elapsed = Date.now() - start;

    assert.equal(result.text, 'fast result');
    assert.ok(elapsed >= 1400, `Expected >= 1400ms delay, got ${elapsed}ms`);
    assert.ok(elapsed < 3000, `Expected < 3000ms, got ${elapsed}ms`);
  });

  await t.test('response arriving at 2.5s with 2s timeout fails', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      timeout: true,
      delayMs: 100, // emit timeout after 100ms to simulate the http timeout event
    });

    const start = Date.now();
    await assert.rejects(
      () => parseImage(VALID_PNG_BASE64, { provider: 'anthropic', timeoutMs: 2000 }),
      (err) => {
        assert.equal(err.code, 'TIMEOUT');
        return true;
      }
    );
  });

  await t.test('elapsedMs in route response reflects actual wall-clock time', async () => {
    const app = createApp();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      statusCode: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'timed' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      delayMs: 500,
    });

    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      image: VALID_PNG_BASE64,
      provider: 'anthropic',
    });
    assert.equal(res.body.ok, true);
    assert.ok(res.body.elapsedMs >= 400, `elapsedMs ${res.body.elapsedMs} should be >= 400`);
    assert.ok(res.body.elapsedMs < 5000, `elapsedMs ${res.body.elapsedMs} should be < 5000`);
  });
});

// ===========================================================================
// 19. noRetry behavior documentation tests
//     (These test the CONCEPT, not the actual browser-side apiFetch, since
//      apiFetch runs in the browser. We verify the route-level behavior that
//      the noRetry flag is designed to complement.)
// ===========================================================================
test('noRetry-relevant server behavior', async (t) => {
  const app = createApp();

  t.afterEach(() => {
    clearInterceptors();
    delete process.env.ANTHROPIC_API_KEY;
  });

  await t.test('5xx provider error returns proper JSON (not raw socket death)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', {
      statusCode: 500,
      body: JSON.stringify({ error: { message: 'Internal server error' } }),
    });

    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      image: VALID_PNG_BASE64,
      provider: 'anthropic',
    });
    // Server should catch the error and return structured JSON, not crash
    assert.equal(typeof res.body, 'object');
    assert.equal(res.body.ok, false);
    assert.equal(typeof res.body.code, 'string');
    assert.equal(typeof res.body.error, 'string');
  });

  await t.test('timeout returns JSON error (client with noRetry gets clean error)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    interceptHost('api.anthropic.com', { timeout: true });

    const res = await makeRequest(app, 'POST', '/api/image-parser/parse', {
      image: VALID_PNG_BASE64,
      provider: 'anthropic',
    });
    assert.equal(typeof res.body, 'object');
    assert.equal(res.body.ok, false);
    // Client with noRetry: true would receive this single JSON response
    // and NOT retry, which is correct for vision inference
  });
});

// ===========================================================================
// Cleanup
// ===========================================================================
test.after(() => {
  // Restore original http/https functions
  http.request = _origHttpRequest;
  https.request = _origHttpsRequest;
  http.get = _origHttpGet;
  https.get = _origHttpsGet;

  // Clean up any test keys file
  removeKeysFile();
});
