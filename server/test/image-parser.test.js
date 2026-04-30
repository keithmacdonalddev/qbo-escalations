'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { EventEmitter } = require('events');

// ---------------------------------------------------------------------------
// HTTP mock helpers — intercept http.request to avoid real network calls
// ---------------------------------------------------------------------------
let _httpIntercept = null;

function mockHttpRequest(responseStatusCode, responseBody) {
  _httpIntercept = { statusCode: responseStatusCode, body: responseBody };
}

function clearHttpMock() {
  _httpIntercept = null;
}

const _origRequest = http.request;
http.request = function patchedRequest(...args) {
  let callback;
  if (typeof args[args.length - 1] === 'function') {
    callback = args[args.length - 1];
  } else if (typeof args[1] === 'function') {
    callback = args[1];
  }

  if (!_httpIntercept) return _origRequest.apply(http, args);

  const { statusCode, body } = _httpIntercept;
  const res = new EventEmitter();
  res.statusCode = statusCode;

  if (typeof callback === 'function') {
    process.nextTick(() => {
      callback(res);
      process.nextTick(() => {
        res.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
        res.emit('end');
      });
    });
  }

  const req = new EventEmitter();
  req.write = () => {};
  req.end = () => {};
  req.destroy = () => {};
  return req;
};

const _origGet = http.get;
http.get = function patchedGet(...args) {
  const req = http.request(...args);
  req.end();
  return req;
};

const {
  parseImage,
  checkProviderAvailability,
  clearProviderAvailabilityCache,
  normalizeBase64,
  detectRole,
  getStoredApiKey,
  getApiKey,
  KEYS_FILE,
  validateRemoteProvider,
} = require('../src/services/image-parser');

test.beforeEach(() => {
  clearProviderAvailabilityCache();
  clearHttpMock();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const TINY_PNG_DATA_URI = `data:image/png;base64,${TINY_PNG_BASE64}`;
const TINY_JPEG_DATA_URI = `data:image/jpeg;base64,/9j/4AAQSkZJRg==`;

// ═══════════════════════════════════════════════════════════════════════════
// normalizeBase64
// ═══════════════════════════════════════════════════════════════════════════
test('normalizeBase64', async (t) => {
  // --- null / empty / invalid inputs ---
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

  await t.test('returns null for non-string input (number)', () => {
    assert.equal(normalizeBase64(12345), null);
  });

  await t.test('returns null for non-string input (object)', () => {
    assert.equal(normalizeBase64({}), null);
  });

  // --- raw base64 (no data: prefix) ---
  await t.test('raw base64 defaults to image/png mediaType', () => {
    const result = normalizeBase64('AAAABBBBCCCC');
    assert.ok(result);
    assert.equal(result.rawBase64, 'AAAABBBBCCCC');
    assert.equal(result.mediaType, 'image/png');
  });

  await t.test('raw base64 reconstructs dataUrl correctly', () => {
    const result = normalizeBase64('AAAABBBB');
    assert.ok(result);
    assert.equal(result.dataUrl, 'data:image/png;base64,AAAABBBB');
  });

  // --- data:image/png;base64,... ---
  await t.test('strips data:image/png prefix and extracts mediaType', () => {
    const result = normalizeBase64('data:image/png;base64,iVBORw0KGgoAAAA');
    assert.ok(result);
    assert.equal(result.mediaType, 'image/png');
    assert.equal(result.rawBase64, 'iVBORw0KGgoAAAA');
    assert.equal(result.dataUrl, 'data:image/png;base64,iVBORw0KGgoAAAA');
  });

  // --- data:image/jpeg;base64,... ---
  await t.test('strips data:image/jpeg prefix and extracts mediaType', () => {
    const result = normalizeBase64('data:image/jpeg;base64,/9j/4AAQSkZJRg');
    assert.ok(result);
    assert.equal(result.mediaType, 'image/jpeg');
    assert.equal(result.rawBase64, '/9j/4AAQSkZJRg');
  });

  // --- data:image/webp;base64,... ---
  await t.test('extracts webp mediaType', () => {
    const result = normalizeBase64('data:image/webp;base64,UklGRhYA');
    assert.ok(result);
    assert.equal(result.mediaType, 'image/webp');
    assert.equal(result.rawBase64, 'UklGRhYA');
  });

  // --- all three fields always present ---
  await t.test('returns rawBase64, mediaType, and dataUrl fields for raw input', () => {
    const result = normalizeBase64('TESTDATA');
    assert.ok(result);
    assert.ok('rawBase64' in result);
    assert.ok('mediaType' in result);
    assert.ok('dataUrl' in result);
  });

  await t.test('returns rawBase64, mediaType, and dataUrl fields for data URI input', () => {
    const result = normalizeBase64('data:image/png;base64,TESTDATA');
    assert.ok(result);
    assert.ok('rawBase64' in result);
    assert.ok('mediaType' in result);
    assert.ok('dataUrl' in result);
  });

  // --- whitespace trimming ---
  await t.test('trims leading/trailing whitespace from raw base64', () => {
    const result = normalizeBase64('  AAAA  ');
    assert.ok(result);
    assert.equal(result.rawBase64, 'AAAA');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// detectRole
// ═══════════════════════════════════════════════════════════════════════════
test('detectRole', async (t) => {
  // --- escalation patterns ---
  await t.test('returns escalation for COID/MID field', () => {
    assert.equal(detectRole('COID/MID: 123456 / 789012\nCASE: CS-2026-001'), 'escalation');
  });

  await t.test('returns escalation for CASE field only', () => {
    assert.equal(detectRole('CASE: CS-2026-001234\nSome other text'), 'escalation');
  });

  await t.test('returns escalation for CX IS ATTEMPTING TO field', () => {
    assert.equal(detectRole('CX IS ATTEMPTING TO: submit payroll'), 'escalation');
  });

  await t.test('case-insensitive matching for escalation fields', () => {
    assert.equal(detectRole('coid/mid: 123456'), 'escalation');
  });

  // --- inv-list patterns ---
  await t.test('returns inv-list for INV entries with 6 digits', () => {
    assert.equal(detectRole('Friday:\n- INV-123456 issue\n- INV-234567 error'), 'inv-list');
  });

  await t.test('returns inv-list for single INV entry with 5+ digits', () => {
    assert.equal(detectRole('INV-10001 QBO login loop'), 'inv-list');
  });

  // --- unknown ---
  await t.test('returns unknown for unrecognized text', () => {
    assert.equal(detectRole('Hello, random text about QuickBooks.'), 'unknown');
  });

  await t.test('returns unknown for empty string', () => {
    assert.equal(detectRole(''), 'unknown');
  });

  await t.test('does not match short INV numbers (fewer than 5 digits)', () => {
    assert.equal(detectRole('INV-1234 something'), 'unknown');
  });

  // --- precedence ---
  await t.test('INV takes priority over escalation fields when both present', () => {
    assert.equal(detectRole('INV-999999 COID/MID: 123456'), 'inv-list');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseImage — input validation
// ═══════════════════════════════════════════════════════════════════════════
test('parseImage validation', async (t) => {
  await t.test('throws MISSING_IMAGE for empty string', async () => {
    await assert.rejects(
      () => parseImage('', { provider: 'lm-studio' }),
      (err) => { assert.equal(err.code, 'MISSING_IMAGE'); return true; }
    );
  });

  await t.test('throws MISSING_IMAGE for whitespace-only string', async () => {
    await assert.rejects(
      () => parseImage('   ', { provider: 'lm-studio' }),
      (err) => { assert.equal(err.code, 'MISSING_IMAGE'); return true; }
    );
  });

  await t.test('throws MISSING_IMAGE for null input', async () => {
    await assert.rejects(
      () => parseImage(null, { provider: 'lm-studio' }),
      (err) => { assert.equal(err.code, 'MISSING_IMAGE'); return true; }
    );
  });

  await t.test('throws MISSING_IMAGE for undefined input', async () => {
    await assert.rejects(
      () => parseImage(undefined, { provider: 'lm-studio' }),
      (err) => { assert.equal(err.code, 'MISSING_IMAGE'); return true; }
    );
  });

  await t.test('throws MISSING_IMAGE for non-string input (number)', async () => {
    await assert.rejects(
      () => parseImage(12345, { provider: 'lm-studio' }),
      (err) => { assert.equal(err.code, 'MISSING_IMAGE'); return true; }
    );
  });

  await t.test('throws INVALID_PROVIDER for unknown provider string', async () => {
    await assert.rejects(
      () => parseImage(TINY_PNG_BASE64, { provider: 'fake-provider' }),
      (err) => {
        assert.equal(err.code, 'INVALID_PROVIDER');
        assert.match(err.message, /fake-provider/);
        return true;
      }
    );
  });

  await t.test('throws INVALID_PROVIDER when provider is omitted', async () => {
    await assert.rejects(
      () => parseImage(TINY_PNG_BASE64, {}),
      (err) => { assert.equal(err.code, 'INVALID_PROVIDER'); return true; }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseImage — provider dispatch (lm-studio via HTTP mock)
// ═══════════════════════════════════════════════════════════════════════════
test('parseImage routes to lm-studio and returns parsed result', async () => {
  mockHttpRequest(200, {
    choices: [{ message: { content: 'COID/MID: 123\nCASE: CS-001' } }],
    model: 'test-vision-model',
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio' });
    assert.equal(result.text, 'COID/MID: 123\nCASE: CS-001');
    assert.equal(result.role, 'escalation');
    assert.ok(result.usage);
    assert.equal(result.usage.inputTokens, 100);
    assert.equal(result.usage.outputTokens, 50);
    assert.equal(result.parseFields.coid, '123');
    assert.equal(result.parseFields.caseNumber, 'CS-001');
    assert.equal(result.parseMeta?.fieldsFound, 2);
  } finally {
    clearHttpMock();
  }
});

test('parseImage derives structured escalation fields and parse confidence', async () => {
  mockHttpRequest(200, {
    choices: [{
      message: {
        content: [
          'COID/MID: 12345 / 67890',
          'CASE: CS-2026-001',
          'CLIENT/CONTACT: Jane Smith',
          'CX IS ATTEMPTING TO: submit payroll',
          'EXPECTED OUTCOME: payroll should submit successfully',
          'ACTUAL OUTCOME: QBO shows a payroll tax calculation error',
          'KB/TOOLS USED: payroll help article',
          'TRIED TEST ACCOUNT: yes',
          'TS STEPS: cleared cache and retried in incognito',
        ].join('\n'),
      },
    }],
    model: 'test-vision-model',
    usage: { prompt_tokens: 120, completion_tokens: 80 },
  });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio' });
    assert.equal(result.role, 'escalation');
    assert.equal(result.parseFields.coid, '12345');
    assert.equal(result.parseFields.mid, '67890');
    assert.equal(result.parseFields.caseNumber, 'CS-2026-001');
    assert.equal(result.parseFields.clientContact, 'Jane Smith');
    assert.equal(result.parseFields.category, 'payroll');
    assert.equal(result.parseMeta?.passed, true);
    assert.equal(result.parseMeta?.confidence, 'high');
    assert.equal(result.parseMeta?.canonicalTemplate?.passed, true);
    assert.ok(Array.isArray(result.parseMeta?.issues));
  } finally {
    clearHttpMock();
  }
});

test('parseImage auto-detects inv-list role from INV pattern', async () => {
  mockHttpRequest(200, {
    choices: [{ message: { content: 'Friday:\n- INV-123456 Payroll sync issue\n- INV-789012 Bank feed timeout' } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio' });
    assert.equal(result.role, 'inv-list');
    assert.deepEqual(result.parseFields, {});
    assert.equal(result.parseMeta, null);
  } finally {
    clearHttpMock();
  }
});

test('parseImage returns unknown role for unrecognized text', async () => {
  mockHttpRequest(200, {
    choices: [{ message: { content: 'Random screenshot with no structured data.' } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio' });
    assert.equal(result.role, 'unknown');
  } finally {
    clearHttpMock();
  }
});

test('parseImage throws PROVIDER_ERROR when lm-studio returns non-200', async () => {
  mockHttpRequest(500, 'Internal Server Error');

  try {
    await assert.rejects(
      () => parseImage(TINY_PNG_BASE64, { provider: 'lm-studio' }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.match(err.message, /HTTP 500/);
        return true;
      }
    );
  } finally {
    clearHttpMock();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// parseImage — accepts all 4 valid providers
// ═══════════════════════════════════════════════════════════════════════════
test('parseImage accepts lm-studio provider', async () => {
  mockHttpRequest(200, {
    choices: [{ message: { content: 'test' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });
  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio' });
    assert.equal(typeof result.text, 'string');
  } finally {
    clearHttpMock();
  }
});

test('parseImage accepts anthropic provider (throws PROVIDER_UNAVAILABLE not INVALID_PROVIDER)', async () => {
  const origKey = process.env.ANTHROPIC_API_KEY;
  const origRead = fs.readFileSync;
  try {
    delete process.env.ANTHROPIC_API_KEY;
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    await assert.rejects(
      () => parseImage(TINY_PNG_BASE64, { provider: 'anthropic' }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_UNAVAILABLE');
        assert.match(err.message, /Anthropic.*not configured/);
        return true;
      }
    );
  } finally {
    fs.readFileSync = origRead;
    if (origKey !== undefined) process.env.ANTHROPIC_API_KEY = origKey;
  }
});

test('parseImage accepts openai provider (throws PROVIDER_UNAVAILABLE not INVALID_PROVIDER)', async () => {
  const origKey = process.env.OPENAI_API_KEY;
  const origRead = fs.readFileSync;
  try {
    delete process.env.OPENAI_API_KEY;
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    await assert.rejects(
      () => parseImage(TINY_PNG_BASE64, { provider: 'openai' }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_UNAVAILABLE');
        assert.match(err.message, /OpenAI.*not configured/);
        return true;
      }
    );
  } finally {
    fs.readFileSync = origRead;
    if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
  }
});

test('parseImage accepts kimi provider (throws PROVIDER_UNAVAILABLE not INVALID_PROVIDER)', async () => {
  const origKey = process.env.MOONSHOT_API_KEY;
  const origRead = fs.readFileSync;
  try {
    delete process.env.MOONSHOT_API_KEY;
    // Also mock the keys file so getApiKey finds neither stored key nor env var
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    await assert.rejects(
      () => parseImage(TINY_PNG_BASE64, { provider: 'kimi' }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_UNAVAILABLE');
        assert.match(err.message, /Moonshot.*not configured/);
        return true;
      }
    );
  } finally {
    fs.readFileSync = origRead;
    if (origKey !== undefined) process.env.MOONSHOT_API_KEY = origKey;
  }
});

test('parseImage accepts gemini provider (throws PROVIDER_UNAVAILABLE not INVALID_PROVIDER)', async () => {
  const origKey = process.env.GEMINI_API_KEY;
  const origRead = fs.readFileSync;
  try {
    delete process.env.GEMINI_API_KEY;
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    await assert.rejects(
      () => parseImage(TINY_PNG_BASE64, { provider: 'gemini' }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_UNAVAILABLE');
        assert.match(err.message, /Gemini.*not configured/i);
        return true;
      }
    );
  } finally {
    fs.readFileSync = origRead;
    if (origKey !== undefined) process.env.GEMINI_API_KEY = origKey;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// parseImage — base64 format acceptance
// ═══════════════════════════════════════════════════════════════════════════
test('parseImage accepts raw base64 without data URI prefix', async () => {
  mockHttpRequest(200, {
    choices: [{ message: { content: 'CASE: CS-001' } }],
    usage: { prompt_tokens: 5, completion_tokens: 5 },
  });
  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio' });
    assert.equal(typeof result.text, 'string');
    assert.ok(result.text.length > 0);
  } finally {
    clearHttpMock();
  }
});

test('parseImage accepts data URI with image/png prefix', async () => {
  mockHttpRequest(200, {
    choices: [{ message: { content: 'CASE: CS-002' } }],
    usage: { prompt_tokens: 5, completion_tokens: 5 },
  });
  try {
    const result = await parseImage(TINY_PNG_DATA_URI, { provider: 'lm-studio' });
    assert.equal(typeof result.text, 'string');
  } finally {
    clearHttpMock();
  }
});

test('parseImage accepts data URI with image/jpeg prefix', async () => {
  mockHttpRequest(200, {
    choices: [{ message: { content: 'CASE: CS-003' } }],
    usage: { prompt_tokens: 5, completion_tokens: 5 },
  });
  try {
    const result = await parseImage(TINY_JPEG_DATA_URI, { provider: 'lm-studio' });
    assert.equal(typeof result.text, 'string');
  } finally {
    clearHttpMock();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// parseImage — Kimi provider specific tests
// ═══════════════════════════════════════════════════════════════════════════
test('parseImage routes to kimi and returns parsed result', async () => {
  const origKey = process.env.MOONSHOT_API_KEY;
  const origRead = fs.readFileSync;
  process.env.MOONSHOT_API_KEY = 'mk-test-key';
  // Mock keys file so getApiKey uses env var
  fs.readFileSync = function mockRead(filePath) {
    if (filePath === KEYS_FILE) throw new Error('ENOENT');
    return origRead.apply(this, arguments);
  };

  // callKimi calls jsonRequest with https://api.moonshot.ai, which uses https.request
  let capturedBody = null;
  const origHttps = https.request;
  https.request = function captureRequest(options, callback) {
    const req = new EventEmitter();
    req.write = (data) => { capturedBody = data; };
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      if (typeof callback === 'function') {
        process.nextTick(() => {
          callback(res);
          process.nextTick(() => {
            res.emit('data', JSON.stringify({
              choices: [{ message: { content: 'COID/MID: 456\nCASE: CS-002' } }],
              model: 'kimi-k2.5',
              usage: { prompt_tokens: 80, completion_tokens: 40 },
            }));
            res.emit('end');
          });
        });
      }
      return req;
    };
    req.destroy = () => {};
    return req;
  };

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'kimi' });
    assert.equal(result.text, 'COID/MID: 456\nCASE: CS-002');
    assert.equal(result.role, 'escalation');
    assert.ok(result.usage);
    assert.equal(result.usage.inputTokens, 80);
    assert.equal(result.usage.outputTokens, 40);

    // Verify callKimi sends temperature: 1 in the request body
    assert.ok(capturedBody, 'HTTP request body should have been captured');
    const parsed = JSON.parse(capturedBody);
    assert.equal(parsed.temperature, 1, 'Kimi request must include temperature: 1');
  } finally {
    https.request = origHttps;
    fs.readFileSync = origRead;
    if (origKey !== undefined) process.env.MOONSHOT_API_KEY = origKey;
    else delete process.env.MOONSHOT_API_KEY;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// parseImage — Anthropic provider dispatch (HTTPS mock)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Helper: mock https.request for cloud providers (Anthropic, OpenAI, Kimi).
 * Returns { restore(), getCapturedBody() }.
 */
function mockHttpsRequest(statusCode, responseBody) {
  const origHttps = https.request;
  let capturedBody = null;
  https.request = function mockedRequest(options, callback) {
    const req = new EventEmitter();
    req.write = (data) => { capturedBody = data; };
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = statusCode;
      if (typeof callback === 'function') {
        process.nextTick(() => {
          callback(res);
          process.nextTick(() => {
            const payload = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
            res.emit('data', payload);
            res.emit('end');
          });
        });
      }
      return req;
    };
    req.destroy = () => {};
    return req;
  };
  return {
    restore() { https.request = origHttps; },
    getCapturedBody() { return capturedBody ? JSON.parse(capturedBody) : null; },
  };
}

/**
 * Helper: set up env + fs mocks for a cloud provider key, returning a cleanup function.
 */
function setupProviderKey(envVar, testKey) {
  const origKey = process.env[envVar];
  const origRead = fs.readFileSync;
  process.env[envVar] = testKey;
  fs.readFileSync = function mockRead(filePath) {
    if (filePath === KEYS_FILE) throw new Error('ENOENT');
    return origRead.apply(this, arguments);
  };
  return function cleanup() {
    fs.readFileSync = origRead;
    if (origKey !== undefined) process.env[envVar] = origKey;
    else delete process.env[envVar];
  };
}

test('parseImage routes to anthropic and returns parsed result', async () => {
  const cleanupKey = setupProviderKey('ANTHROPIC_API_KEY', 'sk-ant-test-key');
  const httpsMock = mockHttpsRequest(200, {
    content: [{ type: 'text', text: 'COID/MID: 789\nCASE: CS-003' }],
    model: 'claude-sonnet-4-20250514',
    usage: { input_tokens: 200, output_tokens: 60 },
  });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });
    assert.equal(result.text, 'COID/MID: 789\nCASE: CS-003');
    assert.equal(result.role, 'escalation');
    assert.ok(result.usage);
    assert.equal(result.usage.inputTokens, 200);
    assert.equal(result.usage.outputTokens, 60);
    assert.equal(result.usage.model, 'claude-sonnet-4-20250514');

    // Verify Anthropic request body shape (uses base64 source, not data URL)
    const body = httpsMock.getCapturedBody();
    assert.ok(body);
    assert.equal(body.messages[0].content[0].type, 'image');
    assert.equal(body.messages[0].content[0].source.type, 'base64');
    assert.equal(body.messages[0].content[0].source.media_type, 'image/png');
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

test('parseImage with anthropic throws PROVIDER_ERROR on non-200', async () => {
  const cleanupKey = setupProviderKey('ANTHROPIC_API_KEY', 'sk-ant-test');
  const httpsMock = mockHttpsRequest(401, '{"error":{"message":"Invalid API key"}}');

  try {
    await assert.rejects(
      () => parseImage(TINY_PNG_BASE64, { provider: 'anthropic' }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.match(err.message, /HTTP 401/);
        return true;
      }
    );
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

test('parseImage with anthropic throws PROVIDER_ERROR on invalid JSON', async () => {
  const cleanupKey = setupProviderKey('ANTHROPIC_API_KEY', 'sk-ant-test');
  const httpsMock = mockHttpsRequest(200, 'NOT VALID JSON {{{');

  try {
    await assert.rejects(
      () => parseImage(TINY_PNG_BASE64, { provider: 'anthropic' }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.match(err.message, /invalid JSON/);
        return true;
      }
    );
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

test('parseImage with anthropic uses model override', async () => {
  const cleanupKey = setupProviderKey('ANTHROPIC_API_KEY', 'sk-ant-test');
  const httpsMock = mockHttpsRequest(200, {
    content: [{ type: 'text', text: 'test' }],
    model: 'claude-opus-4-20250514',
    usage: { input_tokens: 10, output_tokens: 5 },
  });

  try {
    await parseImage(TINY_PNG_BASE64, { provider: 'anthropic', model: 'claude-opus-4-20250514' });
    const body = httpsMock.getCapturedBody();
    assert.equal(body.model, 'claude-opus-4-20250514');
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

test('parseImage with anthropic returns empty text when content is empty', async () => {
  const cleanupKey = setupProviderKey('ANTHROPIC_API_KEY', 'sk-ant-test');
  const httpsMock = mockHttpsRequest(200, {
    content: [],
    usage: { input_tokens: 10, output_tokens: 0 },
  });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });
    assert.equal(result.text, '');
    assert.equal(result.role, 'unknown');
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

test('parseImage with anthropic returns null usage when usage field missing', async () => {
  const cleanupKey = setupProviderKey('ANTHROPIC_API_KEY', 'sk-ant-test');
  const httpsMock = mockHttpsRequest(200, {
    content: [{ type: 'text', text: 'some text' }],
  });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });
    assert.equal(result.text, 'some text');
    assert.equal(result.usage, null);
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// parseImage — OpenAI provider dispatch (HTTPS mock)
// ═══════════════════════════════════════════════════════════════════════════
test('parseImage routes to openai and returns parsed result', async () => {
  const cleanupKey = setupProviderKey('OPENAI_API_KEY', 'sk-openai-test-key');
  const httpsMock = mockHttpsRequest(200, {
    choices: [{ message: { content: 'COID/MID: 999\nCASE: CS-004' } }],
    model: 'gpt-4o',
    usage: { prompt_tokens: 150, completion_tokens: 30 },
  });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'openai' });
    assert.equal(result.text, 'COID/MID: 999\nCASE: CS-004');
    assert.equal(result.role, 'escalation');
    assert.ok(result.usage);
    assert.equal(result.usage.inputTokens, 150);
    assert.equal(result.usage.outputTokens, 30);
    assert.equal(result.usage.model, 'gpt-4o');

    // Verify OpenAI request body uses data URL (not raw base64)
    const body = httpsMock.getCapturedBody();
    assert.ok(body);
    assert.equal(body.messages[1].content[1].type, 'image_url');
    assert.ok(body.messages[1].content[1].image_url.url.startsWith('data:image/'));
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

test('parseImage with openai throws PROVIDER_ERROR on non-200', async () => {
  const cleanupKey = setupProviderKey('OPENAI_API_KEY', 'sk-openai-test');
  const httpsMock = mockHttpsRequest(429, '{"error":{"message":"Rate limit exceeded"}}');

  try {
    await assert.rejects(
      () => parseImage(TINY_PNG_BASE64, { provider: 'openai' }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.match(err.message, /HTTP 429/);
        return true;
      }
    );
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

test('parseImage with openai throws PROVIDER_ERROR on invalid JSON', async () => {
  const cleanupKey = setupProviderKey('OPENAI_API_KEY', 'sk-openai-test');
  const httpsMock = mockHttpsRequest(200, '<html>Gateway Error</html>');

  try {
    await assert.rejects(
      () => parseImage(TINY_PNG_BASE64, { provider: 'openai' }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.match(err.message, /invalid JSON/);
        return true;
      }
    );
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

test('parseImage with openai uses model override', async () => {
  const cleanupKey = setupProviderKey('OPENAI_API_KEY', 'sk-openai-test');
  const httpsMock = mockHttpsRequest(200, {
    choices: [{ message: { content: 'test' } }],
    model: 'gpt-4o-mini',
    usage: { prompt_tokens: 5, completion_tokens: 5 },
  });

  try {
    await parseImage(TINY_PNG_BASE64, { provider: 'openai', model: 'gpt-4o-mini' });
    const body = httpsMock.getCapturedBody();
    assert.equal(body.model, 'gpt-4o-mini');
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

test('parseImage with openai sends Authorization Bearer header', async () => {
  const cleanupKey = setupProviderKey('OPENAI_API_KEY', 'sk-openai-test-header');
  const origHttps = https.request;
  let capturedOptions = null;
  https.request = function captureOptions(options, callback) {
    capturedOptions = options;
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      if (typeof callback === 'function') {
        process.nextTick(() => {
          callback(res);
          process.nextTick(() => {
            res.emit('data', JSON.stringify({
              choices: [{ message: { content: 'test' } }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            }));
            res.emit('end');
          });
        });
      }
      return req;
    };
    req.destroy = () => {};
    return req;
  };

  try {
    await parseImage(TINY_PNG_BASE64, { provider: 'openai' });
    assert.ok(capturedOptions);
    assert.equal(capturedOptions.headers['Authorization'], 'Bearer sk-openai-test-header');
  } finally {
    https.request = origHttps;
    cleanupKey();
  }
});

test('parseImage with openai returns empty text when choices empty', async () => {
  const cleanupKey = setupProviderKey('OPENAI_API_KEY', 'sk-openai-test');
  const httpsMock = mockHttpsRequest(200, {
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 0 },
  });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'openai' });
    assert.equal(result.text, '');
    assert.equal(result.role, 'unknown');
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

test('parseImage with openai returns null usage when usage field missing', async () => {
  const cleanupKey = setupProviderKey('OPENAI_API_KEY', 'sk-openai-test');
  const httpsMock = mockHttpsRequest(200, {
    choices: [{ message: { content: 'some text' } }],
  });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'openai' });
    assert.equal(result.usage, null);
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// parseImage — Kimi provider error handling (HTTPS mock)
// ═══════════════════════════════════════════════════════════════════════════
test('parseImage with kimi throws PROVIDER_ERROR on non-200', async () => {
  const cleanupKey = setupProviderKey('MOONSHOT_API_KEY', 'mk-test');
  const httpsMock = mockHttpsRequest(503, '{"error":"Service unavailable"}');

  try {
    await assert.rejects(
      () => parseImage(TINY_PNG_BASE64, { provider: 'kimi' }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.match(err.message, /HTTP 503/);
        return true;
      }
    );
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

test('parseImage with kimi throws PROVIDER_ERROR on invalid JSON', async () => {
  const cleanupKey = setupProviderKey('MOONSHOT_API_KEY', 'mk-test');
  const httpsMock = mockHttpsRequest(200, 'broken json {{{{');

  try {
    await assert.rejects(
      () => parseImage(TINY_PNG_BASE64, { provider: 'kimi' }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.match(err.message, /invalid JSON/);
        return true;
      }
    );
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

test('parseImage with kimi uses model override', async () => {
  const cleanupKey = setupProviderKey('MOONSHOT_API_KEY', 'mk-test');
  const httpsMock = mockHttpsRequest(200, {
    choices: [{ message: { content: 'test' } }],
    model: 'kimi-latest',
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });

  try {
    await parseImage(TINY_PNG_BASE64, { provider: 'kimi', model: 'kimi-latest' });
    const body = httpsMock.getCapturedBody();
    assert.equal(body.model, 'kimi-latest');
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

test('parseImage with kimi detects inv-list role', async () => {
  const cleanupKey = setupProviderKey('MOONSHOT_API_KEY', 'mk-test');
  const httpsMock = mockHttpsRequest(200, {
    choices: [{ message: { content: 'Monday:\n- INV-555555 Payroll issue\n- INV-666666 Login problem' } }],
    usage: { prompt_tokens: 50, completion_tokens: 30 },
  });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'kimi' });
    assert.equal(result.role, 'inv-list');
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

test('parseImage with kimi returns null usage when usage field missing', async () => {
  const cleanupKey = setupProviderKey('MOONSHOT_API_KEY', 'mk-test');
  const httpsMock = mockHttpsRequest(200, {
    choices: [{ message: { content: 'some text' } }],
  });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'kimi' });
    assert.equal(result.usage, null);
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// parseImage — LM Studio additional error handling
// ═══════════════════════════════════════════════════════════════════════════
test('parseImage with lm-studio throws PROVIDER_ERROR on invalid JSON', async () => {
  mockHttpRequest(200, 'this is not json');

  try {
    await assert.rejects(
      () => parseImage(TINY_PNG_BASE64, { provider: 'lm-studio' }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.match(err.message, /invalid JSON/);
        return true;
      }
    );
  } finally {
    clearHttpMock();
  }
});

test('parseImage with lm-studio returns empty text when choices empty', async () => {
  mockHttpRequest(200, {
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 0 },
  });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio' });
    assert.equal(result.text, '');
    assert.equal(result.role, 'unknown');
  } finally {
    clearHttpMock();
  }
});

test('parseImage with lm-studio returns null usage when usage field missing', async () => {
  mockHttpRequest(200, {
    choices: [{ message: { content: 'some text' } }],
  });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio' });
    assert.equal(result.usage, null);
  } finally {
    clearHttpMock();
  }
});

test('parseImage with lm-studio trims whitespace from response text', async () => {
  mockHttpRequest(200, {
    choices: [{ message: { content: '  CASE: CS-007  \n  ' } }],
    usage: { prompt_tokens: 5, completion_tokens: 5 },
  });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio' });
    assert.equal(result.text, 'CASE: CS-007');
  } finally {
    clearHttpMock();
  }
});

test('parseImage with lm-studio HTTP 400 error', async () => {
  mockHttpRequest(400, '{"error":"Bad request: model not loaded"}');

  try {
    await assert.rejects(
      () => parseImage(TINY_PNG_BASE64, { provider: 'lm-studio' }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.match(err.message, /HTTP 400/);
        return true;
      }
    );
  } finally {
    clearHttpMock();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// checkProviderAvailability — additional coverage
// ═══════════════════════════════════════════════════════════════════════════
test('checkProviderAvailability reports lm-studio unavailable when no model loaded', async () => {
  mockHttpRequest(200, JSON.stringify({ data: [] }));
  try {
    const result = await checkProviderAvailability();
    assert.equal(result['lm-studio'].available, false);
    assert.equal(result['lm-studio'].model, null);
    assert.match(result['lm-studio'].reason, /[Nn]o model/);
  } finally {
    clearHttpMock();
  }
});

test('checkProviderAvailability reports llm-gateway authenticated only when provider-status succeeds', async () => {
  const origGatewayKey = process.env.LLM_GATEWAY_API_KEY;
  try {
    process.env.LLM_GATEWAY_API_KEY = 'lgwk_test_key';
    mockHttpRequest(200, {
      ok: true,
      provider: 'llm-gateway',
      authenticated: true,
      upstream: {
        loadedModel: null,
        availableModel: 'google/gemma-4-26b-a4b',
      },
    });
    const result = await checkProviderAvailability({ forceRefresh: true });
    assert.equal(result['llm-gateway'].available, true);
    assert.equal(result['llm-gateway'].model, 'google/gemma-4-26b-a4b');
    assert.equal(result['llm-gateway'].code, 'OK');
    assert.equal(result['llm-gateway'].reason, 'Authenticated');
  } finally {
    if (origGatewayKey !== undefined) process.env.LLM_GATEWAY_API_KEY = origGatewayKey;
    else delete process.env.LLM_GATEWAY_API_KEY;
    clearHttpMock();
  }
});

test('validateRemoteProvider maps llm-gateway invalid API keys to INVALID_KEY', async () => {
  mockHttpRequest(401, {
    error: {
      message: 'Invalid API key.',
      code: 'INVALID_API_KEY',
    },
  });

  try {
    const result = await validateRemoteProvider('llm-gateway', 'lgwk_bad_key');
    assert.equal(result.ok, false);
    assert.equal(result.configured, true);
    assert.equal(result.available, false);
    assert.equal(result.code, 'INVALID_KEY');
    assert.equal(result.reason, 'API key rejected');
    assert.match(result.detail, /invalid api key/i);
  } finally {
    clearHttpMock();
  }
});

test('validateRemoteProvider maps llm-gateway upstream-not-ready responses to PROVIDER_UNAVAILABLE', async () => {
  mockHttpRequest(503, {
    error: {
      message: 'Gateway authenticated, but no upstream model is ready.',
      code: 'UPSTREAM_NOT_READY',
    },
  });

  try {
    const result = await validateRemoteProvider('llm-gateway', 'lgwk_test_key');
    assert.equal(result.ok, false);
    assert.equal(result.configured, true);
    assert.equal(result.available, false);
    assert.equal(result.code, 'PROVIDER_UNAVAILABLE');
    assert.equal(result.reason, 'Gateway reachable, model unavailable');
    assert.match(result.detail, /no upstream model is ready/i);
  } finally {
    clearHttpMock();
  }
});

test('checkProviderAvailability reports openai available when key is set', async () => {
  const origKey = process.env.OPENAI_API_KEY;
  const httpsMock = mockHttpsRequest(200, { choices: [{ message: { content: 'ok' } }] });
  try {
    process.env.OPENAI_API_KEY = 'sk-openai-avail-test';
    mockHttpRequest(200, JSON.stringify({ data: [{ id: 'test-model' }] }));
    const result = await checkProviderAvailability();
    assert.equal(result.openai.available, true);
    assert.equal(result.openai.configured, true);
    assert.match(result.openai.reason, /Authenticated/);
  } finally {
    if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
    else delete process.env.OPENAI_API_KEY;
    clearHttpMock();
    httpsMock.restore();
  }
});

test('checkProviderAvailability caches recent results until forced to refresh', async () => {
  mockHttpRequest(200, JSON.stringify({ data: [{ id: 'cached-model' }] }));
  const first = await checkProviderAvailability();
  clearHttpMock();

  const second = await checkProviderAvailability();

  assert.equal(first['lm-studio'].model, 'cached-model');
  assert.equal(second['lm-studio'].model, 'cached-model');
  assert.equal(second['lm-studio'].available, true);
});

test('checkProviderAvailability forceRefresh bypasses cached results', async () => {
  mockHttpRequest(200, JSON.stringify({ data: [{ id: 'cached-model' }] }));
  await checkProviderAvailability();

  mockHttpRequest(200, JSON.stringify({ data: [{ id: 'fresh-model' }] }));
  const refreshed = await checkProviderAvailability({ forceRefresh: true });

  assert.equal(refreshed['lm-studio'].model, 'fresh-model');
});

test('clearProviderAvailabilityCache prevents stale in-flight refresh from overwriting fresh status', async () => {
  const origGet = http.get;
  let callCount = 0;

  http.get = function patchedGet(url, options, callback) {
    const cb = typeof options === 'function' ? options : callback;
    const req = new EventEmitter();
    req.destroy = () => {};

    callCount += 1;
    const modelId = callCount === 1 ? 'stale-model' : 'fresh-model';
    const delayMs = callCount === 1 ? 40 : 0;

    setTimeout(() => {
      const res = new EventEmitter();
      res.statusCode = 200;
      cb(res);
      process.nextTick(() => {
        res.emit('data', JSON.stringify({ data: [{ id: modelId }] }));
        res.emit('end');
      });
    }, delayMs);

    return req;
  };

  try {
    const staleRefresh = checkProviderAvailability({ forceRefresh: true });
    clearProviderAvailabilityCache();
    const freshRefresh = await checkProviderAvailability({ forceRefresh: true });
    const staleResult = await staleRefresh;
    const cachedResult = await checkProviderAvailability();

    assert.equal(staleResult['lm-studio'].model, 'stale-model');
    assert.equal(freshRefresh['lm-studio'].model, 'fresh-model');
    assert.equal(cachedResult['lm-studio'].model, 'fresh-model');
    assert.equal(callCount, 2);
  } finally {
    http.get = origGet;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// parseImage — timeout handling
// ═══════════════════════════════════════════════════════════════════════════
test('parseImage rejects with TIMEOUT code when request times out', async () => {
  const origPatched = http.request;
  http.request = function timeoutSimulation() {
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => { process.nextTick(() => req.emit('timeout')); };
    req.destroy = () => {};
    return req;
  };

  try {
    await assert.rejects(
      () => parseImage(TINY_PNG_BASE64, { provider: 'lm-studio', timeoutMs: 100 }),
      (err) => {
        assert.equal(err.code, 'TIMEOUT');
        assert.match(err.message, /timed out/i);
        return true;
      }
    );
  } finally {
    http.request = origPatched;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// checkProviderAvailability
// ═══════════════════════════════════════════════════════════════════════════
test('checkProviderAvailability', async (t) => {
  await t.test('returns all four providers', async () => {
    mockHttpRequest(200, JSON.stringify({ data: [{ id: 'test-model' }] }));
    try {
      const result = await checkProviderAvailability();
      assert.ok('lm-studio' in result);
      assert.ok('anthropic' in result);
      assert.ok('openai' in result);
      assert.ok('kimi' in result);
    } finally {
      clearHttpMock();
    }
  });

  await t.test('reports anthropic unavailable when key not set', async () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    const origRead = fs.readFileSync;
    try {
      delete process.env.ANTHROPIC_API_KEY;
      fs.readFileSync = function mockRead(filePath) {
        if (filePath === KEYS_FILE) throw new Error('ENOENT');
        return origRead.apply(this, arguments);
      };
      mockHttpRequest(200, JSON.stringify({ data: [{ id: 'test-model' }] }));
      const result = await checkProviderAvailability();
      assert.equal(result.anthropic.available, false);
      assert.match(result.anthropic.reason, /not configured/);
    } finally {
      fs.readFileSync = origRead;
      if (origKey !== undefined) process.env.ANTHROPIC_API_KEY = origKey;
      clearHttpMock();
    }
  });

  await t.test('reports anthropic available when key is set', async () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    const httpsMock = mockHttpsRequest(200, { content: [{ text: 'ok' }] });
    try {
      process.env.ANTHROPIC_API_KEY = 'sk-test-key';
      mockHttpRequest(200, JSON.stringify({ data: [{ id: 'test-model' }] }));
      const result = await checkProviderAvailability();
      assert.equal(result.anthropic.available, true);
      assert.equal(result.anthropic.configured, true);
      assert.match(result.anthropic.reason, /Authenticated/);
    } finally {
      if (origKey !== undefined) process.env.ANTHROPIC_API_KEY = origKey;
      else delete process.env.ANTHROPIC_API_KEY;
      clearHttpMock();
      httpsMock.restore();
    }
  });

  await t.test('reports openai unavailable when key not set', async () => {
    const origKey = process.env.OPENAI_API_KEY;
    const origRead = fs.readFileSync;
    try {
      delete process.env.OPENAI_API_KEY;
      fs.readFileSync = function mockRead(filePath) {
        if (filePath === KEYS_FILE) throw new Error('ENOENT');
        return origRead.apply(this, arguments);
      };
      mockHttpRequest(200, JSON.stringify({ data: [{ id: 'test-model' }] }));
      const result = await checkProviderAvailability();
      assert.equal(result.openai.available, false);
      assert.match(result.openai.reason, /not configured/);
    } finally {
      fs.readFileSync = origRead;
      if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
      clearHttpMock();
    }
  });

  await t.test('reports kimi unavailable when key not set', async () => {
    const origKey = process.env.MOONSHOT_API_KEY;
    const origRead = fs.readFileSync;
    try {
      delete process.env.MOONSHOT_API_KEY;
      // Mock keys file so getApiKey finds neither stored key nor env var
      fs.readFileSync = function mockRead(filePath) {
        if (filePath === KEYS_FILE) throw new Error('ENOENT');
        return origRead.apply(this, arguments);
      };
      mockHttpRequest(200, JSON.stringify({ data: [{ id: 'test-model' }] }));
      const result = await checkProviderAvailability();
      assert.equal(result.kimi.available, false);
      assert.match(result.kimi.reason, /not configured/);
    } finally {
      fs.readFileSync = origRead;
      if (origKey !== undefined) process.env.MOONSHOT_API_KEY = origKey;
      clearHttpMock();
    }
  });

  await t.test('reports kimi available when key is set', async () => {
    const origKey = process.env.MOONSHOT_API_KEY;
    const httpsMock = mockHttpsRequest(200, { choices: [{ message: { content: 'ok' } }] });
    try {
      process.env.MOONSHOT_API_KEY = 'mk-test-key';
      mockHttpRequest(200, JSON.stringify({ data: [{ id: 'test-model' }] }));
      const result = await checkProviderAvailability();
      assert.equal(result.kimi.available, true);
      assert.equal(result.kimi.configured, true);
      assert.match(result.kimi.reason, /Authenticated/);
    } finally {
      if (origKey !== undefined) process.env.MOONSHOT_API_KEY = origKey;
      else delete process.env.MOONSHOT_API_KEY;
      clearHttpMock();
      httpsMock.restore();
    }
  });

  await t.test('reports lm-studio with loaded model name', async () => {
    mockHttpRequest(200, JSON.stringify({ data: [{ id: 'qwen2.5-vl-7b' }] }));
    try {
      const result = await checkProviderAvailability();
      assert.equal(result['lm-studio'].available, true);
      assert.equal(result['lm-studio'].model, 'qwen2.5-vl-7b');
    } finally {
      clearHttpMock();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getStoredApiKey / getApiKey — file-based key storage
// ═══════════════════════════════════════════════════════════════════════════
test('getStoredApiKey / getApiKey', async (t) => {
  await t.test('getStoredApiKey returns null when keys file does not exist', () => {
    const orig = fs.readFileSync;
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return orig.apply(this, arguments);
    };
    try {
      assert.equal(getStoredApiKey('anthropic'), null);
    } finally {
      fs.readFileSync = orig;
    }
  });

  await t.test('getStoredApiKey returns null for provider not in file', () => {
    const orig = fs.readFileSync;
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) return JSON.stringify({ openai: 'sk-test-openai' });
      return orig.apply(this, arguments);
    };
    try {
      assert.equal(getStoredApiKey('anthropic'), null);
    } finally {
      fs.readFileSync = orig;
    }
  });

  await t.test('getStoredApiKey returns stored key when file has the provider', () => {
    const orig = fs.readFileSync;
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) return JSON.stringify({ anthropic: 'sk-ant-stored' });
      return orig.apply(this, arguments);
    };
    try {
      assert.equal(getStoredApiKey('anthropic'), 'sk-ant-stored');
    } finally {
      fs.readFileSync = orig;
    }
  });

  await t.test('getApiKey returns stored key over env var', () => {
    const orig = fs.readFileSync;
    const origEnv = process.env.ANTHROPIC_API_KEY;
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) return JSON.stringify({ anthropic: 'sk-stored-wins' });
      return orig.apply(this, arguments);
    };
    process.env.ANTHROPIC_API_KEY = 'sk-env-loses';
    try {
      assert.equal(getApiKey('anthropic'), 'sk-stored-wins');
    } finally {
      fs.readFileSync = orig;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  await t.test('getApiKey falls back to env var when no stored key', () => {
    const orig = fs.readFileSync;
    const origEnv = process.env.ANTHROPIC_API_KEY;
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return orig.apply(this, arguments);
    };
    process.env.ANTHROPIC_API_KEY = 'sk-env-fallback';
    try {
      assert.equal(getApiKey('anthropic'), 'sk-env-fallback');
    } finally {
      fs.readFileSync = orig;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  await t.test('getApiKey returns null when no stored key and no env var', () => {
    const orig = fs.readFileSync;
    const origEnv = process.env.ANTHROPIC_API_KEY;
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return orig.apply(this, arguments);
    };
    delete process.env.ANTHROPIC_API_KEY;
    try {
      assert.equal(getApiKey('anthropic'), null);
    } finally {
      fs.readFileSync = orig;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
    }
  });

  await t.test('getApiKey returns null for provider with no ENV_KEY_MAP entry and no stored key', () => {
    const orig = fs.readFileSync;
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return orig.apply(this, arguments);
    };
    try {
      assert.equal(getApiKey('lm-studio'), null);
    } finally {
      fs.readFileSync = orig;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Provider request body validation — catches bugs like the Kimi temperature
// incident where temperature: 0.1 was sent but Kimi only accepts 1
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Helper: mock https.request to capture the outgoing request options + body,
 * then respond with a valid 200 JSON response. Returns a ref object whose
 * .options and .body fields are populated after parseImage resolves.
 */
function mockHttpsCapture(responseBody) {
  const captured = { options: null, body: null, rawPayload: null };
  const origHttps = https.request;

  https.request = function captureHttps(options, callback) {
    captured.options = options;
    const req = new EventEmitter();
    const chunks = [];
    req.write = (data) => { chunks.push(data); };
    req.end = () => {
      captured.rawPayload = chunks.join('');
      try { captured.body = JSON.parse(captured.rawPayload); } catch { captured.body = captured.rawPayload; }
      const res = new EventEmitter();
      res.statusCode = 200;
      if (typeof callback === 'function') {
        process.nextTick(() => {
          callback(res);
          process.nextTick(() => {
            res.emit('data', JSON.stringify(responseBody));
            res.emit('end');
          });
        });
      }
    };
    req.destroy = () => {};
    return req;
  };

  captured._restore = () => { https.request = origHttps; };
  return captured;
}

/**
 * Helper: mock http.request (non-TLS) to capture outgoing request options + body.
 */
function mockHttpCapture(responseBody) {
  const captured = { options: null, body: null, rawPayload: null };
  const origHttp = http.request;

  http.request = function captureHttp(options, callback) {
    captured.options = options;
    const req = new EventEmitter();
    const chunks = [];
    req.write = (data) => { chunks.push(data); };
    req.end = () => {
      captured.rawPayload = chunks.join('');
      try { captured.body = JSON.parse(captured.rawPayload); } catch { captured.body = captured.rawPayload; }
      const res = new EventEmitter();
      res.statusCode = 200;
      if (typeof callback === 'function') {
        process.nextTick(() => {
          callback(res);
          process.nextTick(() => {
            res.emit('data', JSON.stringify(responseBody));
            res.emit('end');
          });
        });
      }
    };
    req.destroy = () => {};
    return req;
  };

  captured._restore = () => { http.request = origHttp; };
  return captured;
}

/** Standard minimal response for OpenAI-compatible providers */
const MINIMAL_OPENAI_RESPONSE = {
  choices: [{ message: { content: 'COID/MID: 123\nCASE: CS-001' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
};

/** Standard minimal response for Anthropic */
const MINIMAL_ANTHROPIC_RESPONSE = {
  content: [{ type: 'text', text: 'COID/MID: 123\nCASE: CS-001' }],
  model: 'claude-sonnet-4-20250514',
  usage: { input_tokens: 10, output_tokens: 5 },
};

test('provider request body validation', async (t) => {

  // ---------------------------------------------------------------------------
  // 1. Kimi request body shape
  // ---------------------------------------------------------------------------
  await t.test('kimi: sends correct request body shape (temperature 1, model, image format, auth)', async () => {
    const origKey = process.env.MOONSHOT_API_KEY;
    const origRead = fs.readFileSync;
    process.env.MOONSHOT_API_KEY = 'mk-test-body-check';
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };

    const captured = mockHttpsCapture(MINIMAL_OPENAI_RESPONSE);
    try {
      await parseImage(TINY_PNG_BASE64, { provider: 'kimi' });

      // Request options
      assert.equal(captured.options.hostname, 'api.moonshot.ai', 'hostname must be api.moonshot.ai');
      assert.equal(captured.options.path, '/v1/chat/completions', 'path must be /v1/chat/completions');
      assert.equal(captured.options.method, 'POST');
      assert.equal(captured.options.headers['Authorization'], 'Bearer mk-test-body-check', 'must send Bearer auth');

      // Body shape
      const body = captured.body;
      assert.equal(body.temperature, 1, 'Kimi MUST send temperature: 1 (not 0.1 — Kimi rejects other values)');
      assert.equal(body.model, 'kimi-k2.5', 'default model must be kimi-k2.5');
      assert.equal(body.max_tokens, 4096);

      // Messages structure
      assert.equal(body.messages[0].role, 'system');
      assert.equal(typeof body.messages[0].content, 'string');
      assert.equal(body.messages[1].role, 'user');
      assert.ok(Array.isArray(body.messages[1].content), 'user content must be array of parts');
      assert.equal(body.messages[1].content[0].type, 'text');
      assert.equal(body.messages[1].content[1].type, 'image_url');
      assert.ok(
        body.messages[1].content[1].image_url.url.startsWith('data:image/'),
        'image_url.url must be a data URI starting with data:image/'
      );
    } finally {
      captured._restore();
      fs.readFileSync = origRead;
      if (origKey !== undefined) process.env.MOONSHOT_API_KEY = origKey;
      else delete process.env.MOONSHOT_API_KEY;
    }
  });

  // ---------------------------------------------------------------------------
  // 2. OpenAI request body shape
  // ---------------------------------------------------------------------------
  await t.test('openai: sends correct request body shape (temperature 0.1, model, image format, auth)', async () => {
    const origKey = process.env.OPENAI_API_KEY;
    const origRead = fs.readFileSync;
    process.env.OPENAI_API_KEY = 'sk-test-body-check';
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };

    const captured = mockHttpsCapture(MINIMAL_OPENAI_RESPONSE);
    try {
      await parseImage(TINY_PNG_BASE64, { provider: 'openai' });

      // Request options
      assert.equal(captured.options.hostname, 'api.openai.com', 'hostname must be api.openai.com');
      assert.equal(captured.options.path, '/v1/chat/completions');
      assert.equal(captured.options.method, 'POST');
      assert.equal(captured.options.headers['Authorization'], 'Bearer sk-test-body-check');

      // Body shape
      const body = captured.body;
      assert.equal(body.temperature, 0.1, 'OpenAI uses temperature: 0.1');
      assert.equal(body.model, 'gpt-4o', 'default model must be gpt-4o');
      assert.equal(body.max_tokens, 4096);

      // Messages structure
      assert.equal(body.messages[0].role, 'system');
      assert.equal(body.messages[1].role, 'user');
      assert.ok(Array.isArray(body.messages[1].content));
      assert.equal(body.messages[1].content[0].type, 'text');
      assert.equal(body.messages[1].content[1].type, 'image_url');
      assert.ok(body.messages[1].content[1].image_url.url.startsWith('data:image/'));
    } finally {
      captured._restore();
      fs.readFileSync = origRead;
      if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Anthropic request body shape
  // ---------------------------------------------------------------------------
  await t.test('anthropic: sends correct request body shape (x-api-key, anthropic-version, base64 image block)', async () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    const origRead = fs.readFileSync;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-body-check';
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };

    const captured = mockHttpsCapture(MINIMAL_ANTHROPIC_RESPONSE);
    try {
      await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });

      // Request options — Anthropic uses x-api-key, NOT Authorization Bearer
      assert.equal(captured.options.hostname, 'api.anthropic.com');
      assert.equal(captured.options.path, '/v1/messages');
      assert.equal(captured.options.method, 'POST');
      assert.equal(captured.options.headers['x-api-key'], 'sk-ant-test-body-check', 'must use x-api-key header');
      assert.equal(captured.options.headers['anthropic-version'], '2023-06-01', 'must include anthropic-version header');
      assert.equal(captured.options.headers['Authorization'], undefined, 'Anthropic must NOT use Authorization header');

      // Body shape — Anthropic uses system as top-level field, not in messages
      const body = captured.body;
      assert.equal(body.model, 'claude-sonnet-4-20250514', 'default model must be claude-sonnet-4-20250514');
      assert.equal(body.max_tokens, 4096);
      assert.equal(typeof body.system, 'string', 'Anthropic uses top-level system field');
      assert.ok(body.system.length > 0);

      // Messages — Anthropic image format: { type: 'image', source: { type: 'base64', ... } }
      assert.equal(body.messages.length, 1, 'Anthropic sends single user message (no system in messages)');
      assert.equal(body.messages[0].role, 'user');
      const content = body.messages[0].content;
      assert.ok(Array.isArray(content));

      const imageBlock = content.find(c => c.type === 'image');
      assert.ok(imageBlock, 'must have an image content block');
      assert.equal(imageBlock.source.type, 'base64');
      assert.equal(imageBlock.source.media_type, 'image/png');
      assert.equal(typeof imageBlock.source.data, 'string');
      assert.ok(imageBlock.source.data.length > 0, 'base64 data must not be empty');

      const textBlock = content.find(c => c.type === 'text');
      assert.ok(textBlock, 'must have a text content block');
    } finally {
      captured._restore();
      fs.readFileSync = origRead;
      if (origKey !== undefined) process.env.ANTHROPIC_API_KEY = origKey;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  // ---------------------------------------------------------------------------
  // 4. LM Studio request body shape (http, not https)
  // ---------------------------------------------------------------------------
  await t.test('lm-studio: sends correct request body shape via HTTP (not HTTPS)', async () => {
    const captured = mockHttpCapture(MINIMAL_OPENAI_RESPONSE);
    try {
      await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio' });

      // Request options — LM Studio uses plain HTTP
      assert.ok(captured.options, 'HTTP request should have been captured');
      assert.equal(captured.options.method, 'POST');
      assert.equal(captured.options.path, '/v1/chat/completions');

      // Body shape
      const body = captured.body;
      assert.equal(body.temperature, 0.1);
      assert.equal(body.max_tokens, 4096);
      assert.equal(body.stream, false, 'LM Studio requests must be non-streaming');

      // Image format — uses image_url content block with data URL
      assert.equal(body.messages[0].role, 'system');
      assert.equal(body.messages[1].role, 'user');
      const userContent = body.messages[1].content;
      assert.ok(Array.isArray(userContent));
      const imgPart = userContent.find(c => c.type === 'image_url');
      assert.ok(imgPart, 'must have image_url content part');
      assert.ok(imgPart.image_url.url.startsWith('data:image/'), 'url must be a data URI');
    } finally {
      captured._restore();
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Custom model override
  // ---------------------------------------------------------------------------
  await t.test('kimi: custom model override replaces default model in request body', async () => {
    const origKey = process.env.MOONSHOT_API_KEY;
    const origRead = fs.readFileSync;
    process.env.MOONSHOT_API_KEY = 'mk-test-model-override';
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };

    const captured = mockHttpsCapture(MINIMAL_OPENAI_RESPONSE);
    try {
      await parseImage(TINY_PNG_BASE64, { provider: 'kimi', model: 'my-custom-model' });
      assert.equal(captured.body.model, 'my-custom-model', 'custom model must override default kimi-k2.5');
    } finally {
      captured._restore();
      fs.readFileSync = origRead;
      if (origKey !== undefined) process.env.MOONSHOT_API_KEY = origKey;
      else delete process.env.MOONSHOT_API_KEY;
    }
  });

  await t.test('openai: custom model override replaces default model in request body', async () => {
    const origKey = process.env.OPENAI_API_KEY;
    const origRead = fs.readFileSync;
    process.env.OPENAI_API_KEY = 'sk-test-model-override';
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };

    const captured = mockHttpsCapture(MINIMAL_OPENAI_RESPONSE);
    try {
      await parseImage(TINY_PNG_BASE64, { provider: 'openai', model: 'gpt-4-turbo-custom' });
      assert.equal(captured.body.model, 'gpt-4-turbo-custom', 'custom model must override default gpt-4o');
    } finally {
      captured._restore();
      fs.readFileSync = origRead;
      if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  await t.test('anthropic: custom model override replaces default model in request body', async () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    const origRead = fs.readFileSync;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-model-override';
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };

    const captured = mockHttpsCapture(MINIMAL_ANTHROPIC_RESPONSE);
    try {
      await parseImage(TINY_PNG_BASE64, { provider: 'anthropic', model: 'claude-opus-custom' });
      assert.equal(captured.body.model, 'claude-opus-custom', 'custom model must override default');
    } finally {
      captured._restore();
      fs.readFileSync = origRead;
      if (origKey !== undefined) process.env.ANTHROPIC_API_KEY = origKey;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  // ---------------------------------------------------------------------------
  // 6. Large image payload — Content-Length header matches actual payload size
  // ---------------------------------------------------------------------------
  await t.test('large image payload: Content-Length header matches actual serialized payload size', async () => {
    const origKey = process.env.MOONSHOT_API_KEY;
    const origRead = fs.readFileSync;
    process.env.MOONSHOT_API_KEY = 'mk-test-large-payload';
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };

    // Generate ~5MB of fake base64 data
    const largeBase64 = 'A'.repeat(5 * 1024 * 1024);

    const captured = mockHttpsCapture(MINIMAL_OPENAI_RESPONSE);
    try {
      await parseImage(largeBase64, { provider: 'kimi' });

      // The Content-Length header must match the byte length of the serialized payload
      const actualByteLength = Buffer.byteLength(captured.rawPayload);
      const headerLength = parseInt(captured.options.headers['Content-Length'], 10);
      assert.equal(headerLength, actualByteLength,
        `Content-Length header (${headerLength}) must match actual payload byte length (${actualByteLength})`);
      assert.ok(actualByteLength > 5 * 1024 * 1024, 'payload must be > 5MB for this test to be meaningful');
    } finally {
      captured._restore();
      fs.readFileSync = origRead;
      if (origKey !== undefined) process.env.MOONSHOT_API_KEY = origKey;
      else delete process.env.MOONSHOT_API_KEY;
    }
  });

  // ---------------------------------------------------------------------------
  // 7. Request timeout propagation
  // ---------------------------------------------------------------------------
  await t.test('timeout propagation: timeoutMs is forwarded to HTTP request options', async () => {
    const origKey = process.env.OPENAI_API_KEY;
    const origRead = fs.readFileSync;
    process.env.OPENAI_API_KEY = 'sk-test-timeout-prop';
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };

    const captured = mockHttpsCapture(MINIMAL_OPENAI_RESPONSE);
    try {
      await parseImage(TINY_PNG_BASE64, { provider: 'openai', timeoutMs: 12345 });
      assert.equal(captured.options.timeout, 12345, 'timeout option must propagate from timeoutMs');
    } finally {
      captured._restore();
      fs.readFileSync = origRead;
      if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  await t.test('timeout propagation: default timeout is used when timeoutMs not specified', async () => {
    const origKey = process.env.MOONSHOT_API_KEY;
    const origRead = fs.readFileSync;
    process.env.MOONSHOT_API_KEY = 'mk-test-default-timeout';
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };

    const captured = mockHttpsCapture(MINIMAL_OPENAI_RESPONSE);
    try {
      await parseImage(TINY_PNG_BASE64, { provider: 'kimi' });
      assert.equal(captured.options.timeout, 60000, 'default timeout should be 60000ms');
    } finally {
      captured._restore();
      fs.readFileSync = origRead;
      if (origKey !== undefined) process.env.MOONSHOT_API_KEY = origKey;
      else delete process.env.MOONSHOT_API_KEY;
    }
  });

  // ---------------------------------------------------------------------------
  // 8. Kimi temperature regression guard — explicit check that temp is NOT 0.1
  // ---------------------------------------------------------------------------
  await t.test('kimi: temperature must NOT be 0.1 (regression guard for production incident)', async () => {
    const origKey = process.env.MOONSHOT_API_KEY;
    const origRead = fs.readFileSync;
    process.env.MOONSHOT_API_KEY = 'mk-test-temp-regression';
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };

    const captured = mockHttpsCapture(MINIMAL_OPENAI_RESPONSE);
    try {
      await parseImage(TINY_PNG_BASE64, { provider: 'kimi' });
      assert.notEqual(captured.body.temperature, 0.1,
        'REGRESSION: Kimi rejects temperature !== 1. This was the actual production bug.');
      assert.equal(captured.body.temperature, 1);
    } finally {
      captured._restore();
      fs.readFileSync = origRead;
      if (origKey !== undefined) process.env.MOONSHOT_API_KEY = origKey;
      else delete process.env.MOONSHOT_API_KEY;
    }
  });

  // ---------------------------------------------------------------------------
  // 9. Content-Type header is always application/json for all providers
  // ---------------------------------------------------------------------------
  await t.test('all providers send Content-Type: application/json', async () => {
    const origRead = fs.readFileSync;
    const origMoonshot = process.env.MOONSHOT_API_KEY;
    const origOpenai = process.env.OPENAI_API_KEY;
    const origAnthropic = process.env.ANTHROPIC_API_KEY;

    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };

    try {
      // Kimi
      process.env.MOONSHOT_API_KEY = 'mk-ct-test';
      let cap = mockHttpsCapture(MINIMAL_OPENAI_RESPONSE);
      await parseImage(TINY_PNG_BASE64, { provider: 'kimi' });
      assert.equal(cap.options.headers['Content-Type'], 'application/json', 'kimi Content-Type');
      cap._restore();

      // OpenAI
      process.env.OPENAI_API_KEY = 'sk-ct-test';
      cap = mockHttpsCapture(MINIMAL_OPENAI_RESPONSE);
      await parseImage(TINY_PNG_BASE64, { provider: 'openai' });
      assert.equal(cap.options.headers['Content-Type'], 'application/json', 'openai Content-Type');
      cap._restore();

      // Anthropic
      process.env.ANTHROPIC_API_KEY = 'sk-ant-ct-test';
      cap = mockHttpsCapture(MINIMAL_ANTHROPIC_RESPONSE);
      await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });
      assert.equal(cap.options.headers['Content-Type'], 'application/json', 'anthropic Content-Type');
      cap._restore();

      // LM Studio
      cap = mockHttpCapture(MINIMAL_OPENAI_RESPONSE);
      await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio' });
      assert.equal(cap.options.headers['Content-Type'], 'application/json', 'lm-studio Content-Type');
      cap._restore();
    } finally {
      fs.readFileSync = origRead;
      if (origMoonshot !== undefined) process.env.MOONSHOT_API_KEY = origMoonshot;
      else delete process.env.MOONSHOT_API_KEY;
      if (origOpenai !== undefined) process.env.OPENAI_API_KEY = origOpenai;
      else delete process.env.OPENAI_API_KEY;
      if (origAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = origAnthropic;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  // ---------------------------------------------------------------------------
  // 10. Anthropic image format differs from OpenAI/Kimi (would catch copy-paste bugs)
  // ---------------------------------------------------------------------------
  await t.test('anthropic: does NOT use image_url format (guards against OpenAI format copy-paste)', async () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    const origRead = fs.readFileSync;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-format-guard';
    fs.readFileSync = function mockRead(filePath) {
      if (filePath === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };

    const captured = mockHttpsCapture(MINIMAL_ANTHROPIC_RESPONSE);
    try {
      await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });
      const content = captured.body.messages[0].content;
      const hasImageUrl = content.some(c => c.type === 'image_url');
      assert.equal(hasImageUrl, false,
        'Anthropic must NOT use image_url blocks — it uses { type: "image", source: { type: "base64" } }');
    } finally {
      captured._restore();
      fs.readFileSync = origRead;
      if (origKey !== undefined) process.env.ANTHROPIC_API_KEY = origKey;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });
});

// ---------------------------------------------------------------------------
// Restore http.request on module teardown
// ---------------------------------------------------------------------------
test.after(() => {
  http.request = _origRequest;
  http.get = _origGet;
});
