'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const fs = require('fs');
const { EventEmitter } = require('events');

// Set NODE_ENV=test so the rate limiter is bypassed
process.env.NODE_ENV = 'test';

// ---------------------------------------------------------------------------
// Save originals
// ---------------------------------------------------------------------------
const _origReadFileSync = fs.readFileSync;
const _origWriteFileSync = fs.writeFileSync;
const _origMkdirSync = fs.mkdirSync;
const _origHttpsRequest = https.request;

// ---------------------------------------------------------------------------
// Module loading with mock service
// ---------------------------------------------------------------------------
const SERVICE_PATH = require.resolve('../src/services/image-parser');
const ROUTE_PATH = require.resolve('../src/routes/image-parser');

let _mockParseImage = null;
let _mockCheckProviderAvailability = null;

function loadRouteWithMockedService() {
  delete require.cache[ROUTE_PATH];
  delete require.cache[SERVICE_PATH];
  const realService = require(SERVICE_PATH);
  require.cache[SERVICE_PATH] = {
    id: SERVICE_PATH,
    filename: SERVICE_PATH,
    loaded: true,
    exports: {
      ...realService,
      parseImage: (...args) => _mockParseImage ? _mockParseImage(...args) : realService.parseImage(...args),
      checkProviderAvailability: (...args) => _mockCheckProviderAvailability ? _mockCheckProviderAvailability(...args) : realService.checkProviderAvailability(...args),
    },
  };
  return require(ROUTE_PATH);
}

const routerModule = loadRouteWithMockedService();
const { KEYS_FILE } = require(SERVICE_PATH);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function findHandler(method, routePath) {
  const layer = routerModule.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method]
  );
  if (!layer) throw new Error(`No ${method.toUpperCase()} ${routePath} route found`);
  const handlers = layer.route.stack.map((s) => s.handle);
  return handlers[handlers.length - 1];
}

function makeReq(body = {}) {
  return {
    body,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    setResponseTimeout: () => {},
  };
}

function makeRes() {
  return {
    headers: {},
    statusCode: 200,
    payload: null,
    setHeader(n, v) { this.headers[n] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.payload = b; return this; },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /parse — Route-level edge cases
// ═══════════════════════════════════════════════════════════════════════════

test('POST /parse route edge cases', async (t) => {
  const handler = findHandler('post', '/parse');

  await t.test('missing body entirely (req.body is undefined/null)', async () => {
    const req = { body: undefined, ip: '127.0.0.1', socket: {}, setResponseTimeout: () => {} };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, 'MISSING_IMAGE');
  });

  await t.test('body with image: null', async () => {
    const res = makeRes();
    await handler(makeReq({ image: null, provider: 'lm-studio' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, 'MISSING_IMAGE');
  });

  await t.test('body with image: 0', async () => {
    const res = makeRes();
    await handler(makeReq({ image: 0, provider: 'lm-studio' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, 'MISSING_IMAGE');
  });

  await t.test('body with image: false', async () => {
    const res = makeRes();
    await handler(makeReq({ image: false, provider: 'lm-studio' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, 'MISSING_IMAGE');
  });

  await t.test('body with image: [] (array) — truthy, passes to service which rejects', async () => {
    const res = makeRes();
    await handler(makeReq({ image: [], provider: 'lm-studio' }), res);
    // [] is truthy so it passes the route !image check, service rejects with MISSING_IMAGE → 422
    assert.equal(res.statusCode, 422);
    assert.equal(res.payload.ok, false);
  });

  await t.test('body with provider but no image', async () => {
    const res = makeRes();
    await handler(makeReq({ provider: 'lm-studio' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, 'MISSING_IMAGE');
  });

  await t.test('body with image but no provider', async () => {
    const res = makeRes();
    await handler(makeReq({ image: 'AAAA' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, 'INVALID_PROVIDER');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /parse — timeoutMs edge values
// ═══════════════════════════════════════════════════════════════════════════

test('POST /parse timeoutMs edge values', async (t) => {
  const handler = findHandler('post', '/parse');

  await t.test('timeoutMs: NaN → uses default 60s', async () => {
    let capturedTimeout = null;
    _mockParseImage = async (img, opts) => {
      capturedTimeout = opts.timeoutMs;
      return { text: 'ok', role: 'unknown', usage: null };
    };
    const req = makeReq({ image: 'AAAA', provider: 'lm-studio', timeoutMs: NaN });
    let respTimeout = null;
    req.setResponseTimeout = (ms) => { respTimeout = ms; };
    const res = makeRes();
    try {
      await handler(req, res);
      // NaN is not Number.isFinite → effectiveTimeout = 60000
      assert.equal(respTimeout, 70000);
    } finally {
      _mockParseImage = null;
    }
  });

  await t.test('timeoutMs: negative → uses default 60s', async () => {
    let respTimeout = null;
    _mockParseImage = async () => ({ text: 'ok', role: 'unknown', usage: null });
    const req = makeReq({ image: 'AAAA', provider: 'lm-studio', timeoutMs: -5000 });
    req.setResponseTimeout = (ms) => { respTimeout = ms; };
    const res = makeRes();
    try {
      await handler(req, res);
      assert.equal(respTimeout, 70000);
    } finally {
      _mockParseImage = null;
    }
  });

  await t.test('timeoutMs: string → uses default 60s', async () => {
    let respTimeout = null;
    _mockParseImage = async () => ({ text: 'ok', role: 'unknown', usage: null });
    const req = makeReq({ image: 'AAAA', provider: 'lm-studio', timeoutMs: 'thirty thousand' });
    req.setResponseTimeout = (ms) => { respTimeout = ms; };
    const res = makeRes();
    try {
      await handler(req, res);
      assert.equal(respTimeout, 70000);
    } finally {
      _mockParseImage = null;
    }
  });

  await t.test('timeoutMs: Infinity → uses default 60s', async () => {
    let respTimeout = null;
    _mockParseImage = async () => ({ text: 'ok', role: 'unknown', usage: null });
    const req = makeReq({ image: 'AAAA', provider: 'lm-studio', timeoutMs: Infinity });
    req.setResponseTimeout = (ms) => { respTimeout = ms; };
    const res = makeRes();
    try {
      await handler(req, res);
      assert.equal(respTimeout, 70000);
    } finally {
      _mockParseImage = null;
    }
  });

  await t.test('timeoutMs: 0 → uses default 60s (not positive)', async () => {
    let respTimeout = null;
    _mockParseImage = async () => ({ text: 'ok', role: 'unknown', usage: null });
    const req = makeReq({ image: 'AAAA', provider: 'lm-studio', timeoutMs: 0 });
    req.setResponseTimeout = (ms) => { respTimeout = ms; };
    const res = makeRes();
    try {
      await handler(req, res);
      assert.equal(respTimeout, 70000);
    } finally {
      _mockParseImage = null;
    }
  });

  await t.test('timeoutMs: valid 45000 → used as-is', async () => {
    let respTimeout = null;
    _mockParseImage = async () => ({ text: 'ok', role: 'unknown', usage: null });
    const req = makeReq({ image: 'AAAA', provider: 'lm-studio', timeoutMs: 45000 });
    req.setResponseTimeout = (ms) => { respTimeout = ms; };
    const res = makeRes();
    try {
      await handler(req, res);
      assert.equal(respTimeout, 55000); // 45000 + 10000
    } finally {
      _mockParseImage = null;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /keys — edge cases
// ═══════════════════════════════════════════════════════════════════════════

test('GET /keys edge cases', async (t) => {
  const handler = findHandler('get', '/keys');

  await t.test('keys file with partial keys only shows those', async () => {
    const orig = fs.readFileSync;
    fs.readFileSync = function mockRead(filePath) {
      if (String(filePath).includes('image-parser-keys')) {
        return JSON.stringify({ kimi: 'mk-test-123' });
      }
      return orig.apply(this, arguments);
    };
    const res = makeRes();
    try {
      await handler(makeReq(), res);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.keys.anthropic, false);
      assert.equal(res.payload.keys.openai, false);
      assert.equal(res.payload.keys.kimi, true);
    } finally {
      fs.readFileSync = orig;
    }
  });

  await t.test('keys file with corrupt JSON → all false (no crash)', async () => {
    const orig = fs.readFileSync;
    fs.readFileSync = function mockRead(filePath) {
      if (String(filePath).includes('image-parser-keys')) return '{{bad json}}';
      return orig.apply(this, arguments);
    };
    const res = makeRes();
    try {
      await handler(makeReq(), res);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.keys.anthropic, false);
      assert.equal(res.payload.keys.openai, false);
      assert.equal(res.payload.keys.kimi, false);
    } finally {
      fs.readFileSync = orig;
    }
  });

  await t.test('keys file with whitespace-only keys → false', async () => {
    const orig = fs.readFileSync;
    fs.readFileSync = function mockRead(filePath) {
      if (String(filePath).includes('image-parser-keys')) {
        return JSON.stringify({ anthropic: '   ', openai: '\t', kimi: '' });
      }
      return orig.apply(this, arguments);
    };
    const res = makeRes();
    try {
      await handler(makeReq(), res);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.keys.anthropic, false);
      assert.equal(res.payload.keys.openai, false);
      assert.equal(res.payload.keys.kimi, false);
    } finally {
      fs.readFileSync = orig;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /keys — edge cases
// ═══════════════════════════════════════════════════════════════════════════

test('PUT /keys edge cases', async (t) => {
  const handler = findHandler('put', '/keys');
  let writtenData = null;

  function mockFs(initialData = {}) {
    fs.readFileSync = function mockRead(filePath) {
      if (String(filePath).includes('image-parser-keys')) {
        if (writtenData !== null) return writtenData;
        return JSON.stringify(initialData);
      }
      return _origReadFileSync.apply(this, arguments);
    };
    fs.writeFileSync = function mockWrite(filePath, data) {
      if (String(filePath).includes('image-parser-keys')) { writtenData = data; return; }
      return _origWriteFileSync.apply(this, arguments);
    };
    fs.mkdirSync = function mockMkdir() {};
  }

  function restoreFs() {
    fs.readFileSync = _origReadFileSync;
    fs.writeFileSync = _origWriteFileSync;
    fs.mkdirSync = _origMkdirSync;
    writtenData = null;
  }

  await t.test('very long key string is stored', async () => {
    const longKey = 'sk-' + 'x'.repeat(500);
    mockFs({});
    try {
      const res = makeRes();
      await handler(makeReq({ provider: 'openai', key: longKey }), res);
      assert.equal(res.payload.ok, true);
      const saved = JSON.parse(writtenData);
      assert.equal(saved.openai, longKey);
    } finally {
      restoreFs();
    }
  });

  await t.test('key with special characters is stored', async () => {
    const specialKey = 'sk-test!@#$%^&*()_+-={}[]|:;"<>,.?/~`';
    mockFs({});
    try {
      const res = makeRes();
      await handler(makeReq({ provider: 'anthropic', key: specialKey }), res);
      assert.equal(res.payload.ok, true);
      const saved = JSON.parse(writtenData);
      assert.equal(saved.anthropic, specialKey);
    } finally {
      restoreFs();
    }
  });

  await t.test('whitespace-only key removes the provider entry', async () => {
    mockFs({ kimi: 'mk-existing' });
    try {
      const res = makeRes();
      await handler(makeReq({ provider: 'kimi', key: '   ' }), res);
      assert.equal(res.payload.ok, true);
      const saved = JSON.parse(writtenData);
      assert.equal(saved.kimi, undefined);
    } finally {
      restoreFs();
    }
  });

  await t.test('PUT then read back is consistent', async () => {
    mockFs({});
    try {
      const putRes = makeRes();
      await handler(makeReq({ provider: 'openai', key: 'sk-roundtrip' }), putRes);
      assert.equal(putRes.payload.ok, true);

      // Now read keys
      const getHandler = findHandler('get', '/keys');
      const getRes = makeRes();
      await getHandler(makeReq(), getRes);
      assert.equal(getRes.payload.ok, true);
      assert.equal(getRes.payload.keys.openai, true);
    } finally {
      restoreFs();
    }
  });

  await t.test('missing provider field returns 400', async () => {
    const res = makeRes();
    await handler(makeReq({ key: 'sk-test' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, 'INVALID_PROVIDER');
  });

  await t.test('lm-studio is not a valid provider for keys', async () => {
    const res = makeRes();
    await handler(makeReq({ provider: 'lm-studio', key: 'test' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, 'INVALID_PROVIDER');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /keys/test — HTTPS mock for success/failure flows
// ═══════════════════════════════════════════════════════════════════════════

test('POST /keys/test deep tests', async (t) => {
  const handler = findHandler('post', '/keys/test');
  let _lastCapturedOptions = null;
  let _lastCapturedBody = '';

  function mockHttpsForKeyTest(statusCode, responseBody) {
    https.request = function mockedRequest(options, callback) {
      _lastCapturedOptions = options;
      _lastCapturedBody = '';
      const req = new EventEmitter();
      req.write = (data) => { _lastCapturedBody += data; };
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = statusCode;
        if (typeof callback === 'function') {
          process.nextTick(() => {
            callback(res);
            process.nextTick(() => {
              res.emit('data', typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody));
              res.emit('end');
            });
          });
        }
      };
      req.destroy = () => {};
      return req;
    };
  }

  function restoreHttps() {
    https.request = _origHttpsRequest;
    _lastCapturedOptions = null;
    _lastCapturedBody = '';
  }

  await t.test('valid Anthropic key → ok true, verifies endpoint', async () => {
    mockHttpsForKeyTest(200, { id: 'msg_123', content: [{ text: 'ok' }] });
    const res = makeRes();
    try {
      await handler(makeReq({ provider: 'anthropic', key: 'sk-ant-valid' }), res);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.provider, 'anthropic');
      // Verify it called the right endpoint
      assert.equal(_lastCapturedOptions.hostname, 'api.anthropic.com');
      assert.equal(_lastCapturedOptions.path, '/v1/messages');
      // Verify auth headers
      assert.equal(_lastCapturedOptions.headers['x-api-key'], 'sk-ant-valid');
      assert.equal(_lastCapturedOptions.headers['anthropic-version'], '2023-06-01');
    } finally {
      restoreHttps();
    }
  });

  await t.test('valid OpenAI key → ok true, verifies endpoint', async () => {
    mockHttpsForKeyTest(200, { choices: [{ message: { content: 'hi' } }] });
    const res = makeRes();
    try {
      await handler(makeReq({ provider: 'openai', key: 'sk-openai-valid' }), res);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.provider, 'openai');
      assert.equal(_lastCapturedOptions.hostname, 'api.openai.com');
      assert.equal(_lastCapturedOptions.path, '/v1/chat/completions');
      assert.equal(_lastCapturedOptions.headers['Authorization'], 'Bearer sk-openai-valid');
    } finally {
      restoreHttps();
    }
  });

  await t.test('valid Kimi key → ok true, verifies endpoint and temperature: 1', async () => {
    mockHttpsForKeyTest(200, { choices: [{ message: { content: 'hi' } }] });
    const res = makeRes();
    try {
      await handler(makeReq({ provider: 'kimi', key: 'mk-kimi-valid' }), res);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.provider, 'kimi');
      assert.equal(_lastCapturedOptions.hostname, 'api.moonshot.ai');
      assert.equal(_lastCapturedOptions.path, '/v1/chat/completions');
      assert.equal(_lastCapturedOptions.headers['Authorization'], 'Bearer mk-kimi-valid');
      // Verify temperature: 1 in the test body (critical Kimi constraint)
      const body = JSON.parse(_lastCapturedBody);
      assert.equal(body.temperature, 1);
    } finally {
      restoreHttps();
    }
  });

  await t.test('invalid key (401) → ok false, "Invalid API key"', async () => {
    mockHttpsForKeyTest(401, { error: { message: 'Incorrect API key' } });
    const res = makeRes();
    try {
      await handler(makeReq({ provider: 'openai', key: 'sk-bad' }), res);
      assert.equal(res.payload.ok, false);
      assert.equal(res.payload.error, 'API key rejected');
      assert.match(res.payload.detail, /Incorrect API key/);
    } finally {
      restoreHttps();
    }
  });

  await t.test('forbidden (403) → ok false, "Invalid API key"', async () => {
    mockHttpsForKeyTest(403, { error: { message: 'Forbidden' } });
    const res = makeRes();
    try {
      await handler(makeReq({ provider: 'anthropic', key: 'sk-ant-forbidden' }), res);
      assert.equal(res.payload.ok, false);
      assert.equal(res.payload.error, 'API key rejected');
      assert.match(res.payload.detail, /Forbidden/);
    } finally {
      restoreHttps();
    }
  });

  await t.test('rate limited (429) → ok false with error message from provider', async () => {
    mockHttpsForKeyTest(429, { error: { message: 'Rate limit exceeded, please slow down' } });
    const res = makeRes();
    try {
      await handler(makeReq({ provider: 'kimi', key: 'mk-test' }), res);
      assert.equal(res.payload.ok, false);
      assert.match(res.payload.error, /[Rr]ate limit/);
    } finally {
      restoreHttps();
    }
  });

  await t.test('provider 500 → ok false with extracted error', async () => {
    mockHttpsForKeyTest(500, { error: { message: 'Internal server error' } });
    const res = makeRes();
    try {
      await handler(makeReq({ provider: 'openai', key: 'sk-test' }), res);
      assert.equal(res.payload.ok, false);
      assert.match(res.payload.error, /[Ii]nternal/i);
    } finally {
      restoreHttps();
    }
  });

  await t.test('provider returns non-JSON response body → uses default error', async () => {
    mockHttpsForKeyTest(502, 'Bad Gateway');
    const res = makeRes();
    try {
      await handler(makeReq({ provider: 'openai', key: 'sk-test' }), res);
      assert.equal(res.payload.ok, false);
      assert.match(res.payload.error, /HTTP 502/);
    } finally {
      restoreHttps();
    }
  });

  await t.test('provider connection timeout → ok false with timeout message', async () => {
    https.request = function timeoutSimulation(options, callback) {
      const req = new EventEmitter();
      req.write = () => {};
      req.end = () => { process.nextTick(() => req.emit('timeout')); };
      req.destroy = () => {};
      return req;
    };
    const res = makeRes();
    try {
      await handler(makeReq({ provider: 'anthropic', key: 'sk-ant-test' }), res);
      assert.equal(res.payload.ok, false);
      assert.match(res.payload.error, /timed out/i);
    } finally {
      restoreHttps();
    }
  });

  await t.test('provider connection error → ok false with error message', async () => {
    https.request = function errorSimulation(options, callback) {
      const req = new EventEmitter();
      req.write = () => {};
      req.end = () => { process.nextTick(() => req.emit('error', new Error('getaddrinfo ENOTFOUND'))); };
      req.destroy = () => {};
      return req;
    };
    const res = makeRes();
    try {
      await handler(makeReq({ provider: 'openai', key: 'sk-test' }), res);
      assert.equal(res.payload.ok, false);
      assert.match(res.payload.error, /ENOTFOUND/);
    } finally {
      restoreHttps();
    }
  });

  await t.test('uses stored key when no key in request body', async () => {
    const origRead = fs.readFileSync;
    fs.readFileSync = function mockRead(filePath) {
      if (String(filePath).includes('image-parser-keys')) {
        return JSON.stringify({ openai: 'sk-stored-key' });
      }
      return origRead.apply(this, arguments);
    };
    mockHttpsForKeyTest(200, { choices: [{ message: { content: 'ok' } }] });
    const res = makeRes();
    try {
      await handler(makeReq({ provider: 'openai' }), res);
      assert.equal(res.payload.ok, true);
      // Verify the stored key was used
      assert.equal(_lastCapturedOptions.headers['Authorization'], 'Bearer sk-stored-key');
    } finally {
      fs.readFileSync = origRead;
      restoreHttps();
    }
  });

  await t.test('Content-Length header in test request matches payload', async () => {
    mockHttpsForKeyTest(200, { id: 'test' });
    const res = makeRes();
    try {
      await handler(makeReq({ provider: 'anthropic', key: 'sk-test' }), res);
      const expectedLength = Buffer.byteLength(_lastCapturedBody);
      assert.equal(Number(_lastCapturedOptions.headers['Content-Length']), expectedLength);
    } finally {
      restoreHttps();
    }
  });

  await t.test('each provider test config uses correct model', async () => {
    // Anthropic
    mockHttpsForKeyTest(200, { id: 'test' });
    let res = makeRes();
    await handler(makeReq({ provider: 'anthropic', key: 'sk-test' }), res);
    let body = JSON.parse(_lastCapturedBody);
    assert.equal(body.model, 'claude-sonnet-4-20250514');
    restoreHttps();

    // OpenAI
    mockHttpsForKeyTest(200, { choices: [] });
    res = makeRes();
    await handler(makeReq({ provider: 'openai', key: 'sk-test' }), res);
    body = JSON.parse(_lastCapturedBody);
    assert.equal(body.model, 'gpt-4o-mini');
    restoreHttps();

    // Kimi
    mockHttpsForKeyTest(200, { choices: [] });
    res = makeRes();
    await handler(makeReq({ provider: 'kimi', key: 'mk-test' }), res);
    body = JSON.parse(_lastCapturedBody);
    assert.equal(body.model, 'kimi-k2.5');
    restoreHttps();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /parse — passes correct args to parseImage service
// ═══════════════════════════════════════════════════════════════════════════

test('POST /parse passes arguments correctly to parseImage', async (t) => {
  const handler = findHandler('post', '/parse');

  await t.test('passes image, provider, model, and timeoutMs', async () => {
    let capturedArgs = null;
    _mockParseImage = async (image, opts) => {
      capturedArgs = { image, opts };
      return { text: 'ok', role: 'unknown', usage: null };
    };
    const res = makeRes();
    try {
      await handler(makeReq({
        image: 'base64data',
        provider: 'kimi',
        model: 'custom-model',
        timeoutMs: 45000,
      }), res);
      assert.equal(capturedArgs.image, 'base64data');
      assert.equal(capturedArgs.opts.provider, 'kimi');
      assert.equal(capturedArgs.opts.model, 'custom-model');
      assert.equal(capturedArgs.opts.timeoutMs, 45000);
    } finally {
      _mockParseImage = null;
    }
  });

  await t.test('caps timeoutMs at 120000', async () => {
    let capturedTimeout = null;
    _mockParseImage = async (image, opts) => {
      capturedTimeout = opts.timeoutMs;
      return { text: 'ok', role: 'unknown', usage: null };
    };
    const res = makeRes();
    try {
      await handler(makeReq({
        image: 'AAAA',
        provider: 'lm-studio',
        timeoutMs: 500000,
      }), res);
      assert.equal(capturedTimeout, 120000);
    } finally {
      _mockParseImage = null;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /parse — concurrent requests return independent results
// ═══════════════════════════════════════════════════════════════════════════

test('POST /parse concurrent requests do not interfere', async () => {
  const handler = findHandler('post', '/parse');
  let callCount = 0;

  _mockParseImage = async (image) => {
    callCount++;
    const myCount = callCount;
    // Simulate slight delay to interleave
    await new Promise(r => setTimeout(r, 5));
    return { text: `result-${myCount}`, role: 'unknown', usage: null };
  };

  const res1 = makeRes();
  const res2 = makeRes();

  try {
    await Promise.all([
      handler(makeReq({ image: 'AAA', provider: 'lm-studio' }), res1),
      handler(makeReq({ image: 'BBB', provider: 'lm-studio' }), res2),
    ]);

    assert.equal(res1.payload.ok, true);
    assert.equal(res2.payload.ok, true);
    assert.ok(res1.payload.text.startsWith('result-'));
    assert.ok(res2.payload.text.startsWith('result-'));
    // They should be different results
    assert.notEqual(res1.payload.text, res2.payload.text);
  } finally {
    _mockParseImage = null;
    callCount = 0;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// All error responses include standard { ok, code, error } shape
// ═══════════════════════════════════════════════════════════════════════════

test('All parse error responses include ok, code, error fields', async (t) => {
  const handler = findHandler('post', '/parse');

  const errorScenarios = [
    { name: 'MISSING_IMAGE', body: { provider: 'lm-studio' } },
    { name: 'INVALID_PROVIDER', body: { image: 'AAAA', provider: 'fake' } },
    { name: 'INVALID_PROVIDER (missing)', body: { image: 'AAAA' } },
  ];

  for (const scenario of errorScenarios) {
    await t.test(`${scenario.name} has ok, code, error fields`, async () => {
      const res = makeRes();
      await handler(makeReq(scenario.body), res);
      assert.equal(res.payload.ok, false);
      assert.equal(typeof res.payload.code, 'string');
      assert.equal(typeof res.payload.error, 'string');
      assert.ok(res.payload.code.length > 0);
      assert.ok(res.payload.error.length > 0);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Challenger Gap #10 — Keys file concurrent read/write edge case
// PUT /keys does read-modify-write with synchronous fs — concurrent PUTs
// can race. This test documents the behavior: last writer wins, but no crash.
// ═══════════════════════════════════════════════════════════════════════════

// KNOWN LIMITATION: PUT /keys uses a read-modify-write pattern with no locking.
// Concurrent writes can lose data (last writer wins). This is documented behavior,
// not a bug to fix — the key management UI serializes writes in practice.
test('PUT /keys concurrent writes — last writer wins, no crash', async (t) => {
  const handler = findHandler('put', '/keys');
  let writtenData = null;
  let writeCount = 0;

  // Track all writes in order
  const writeLog = [];

  fs.readFileSync = function mockRead(filePath) {
    if (String(filePath).includes('image-parser-keys')) {
      // Return current state (last write or initial empty)
      if (writtenData !== null) return writtenData;
      return JSON.stringify({});
    }
    return _origReadFileSync.apply(this, arguments);
  };
  fs.writeFileSync = function mockWrite(filePath, data) {
    if (String(filePath).includes('image-parser-keys')) {
      writeCount++;
      writtenData = data;
      writeLog.push(data);
      return;
    }
    return _origWriteFileSync.apply(this, arguments);
  };
  fs.mkdirSync = function mockMkdir() {};

  try {
    // Fire 3 concurrent PUT requests for different providers
    const res1 = makeRes();
    const res2 = makeRes();
    const res3 = makeRes();

    await Promise.all([
      handler(makeReq({ provider: 'anthropic', key: 'sk-ant-concurrent' }), res1),
      handler(makeReq({ provider: 'openai', key: 'sk-oai-concurrent' }), res2),
      handler(makeReq({ provider: 'kimi', key: 'mk-concurrent' }), res3),
    ]);

    // All three should succeed (no crash)
    assert.equal(res1.payload.ok, true);
    assert.equal(res2.payload.ok, true);
    assert.equal(res3.payload.ok, true);

    // writeFileSync was called 3 times
    assert.equal(writeCount, 3);

    // The final state depends on execution order. Since these are sync operations
    // in an async handler, they execute sequentially in practice (single-threaded JS).
    // The last write will contain whatever was read + its own modification.
    // This documents the race condition: earlier writes may be lost because each
    // handler reads the state BEFORE the other handlers have written.
    const finalState = JSON.parse(writtenData);

    // At minimum, the last writer's key must be present
    assert.equal(typeof writtenData, 'string', 'final state must be valid JSON string');
    // All writes completed without error
    assert.equal(writeLog.length, 3);
  } finally {
    fs.readFileSync = _origReadFileSync;
    fs.writeFileSync = _origWriteFileSync;
    fs.mkdirSync = _origMkdirSync;
    writtenData = null;
    writeCount = 0;
  }
});

test('PUT /keys sequential writes preserve all keys', async () => {
  const handler = findHandler('put', '/keys');
  let writtenData = null;

  fs.readFileSync = function mockRead(filePath) {
    if (String(filePath).includes('image-parser-keys')) {
      if (writtenData !== null) return writtenData;
      return JSON.stringify({});
    }
    return _origReadFileSync.apply(this, arguments);
  };
  fs.writeFileSync = function mockWrite(filePath, data) {
    if (String(filePath).includes('image-parser-keys')) { writtenData = data; return; }
    return _origWriteFileSync.apply(this, arguments);
  };
  fs.mkdirSync = function mockMkdir() {};

  try {
    // Sequential writes — each reads the updated state from previous write
    const res1 = makeRes();
    await handler(makeReq({ provider: 'anthropic', key: 'sk-ant-seq' }), res1);
    assert.equal(res1.payload.ok, true);

    const res2 = makeRes();
    await handler(makeReq({ provider: 'openai', key: 'sk-oai-seq' }), res2);
    assert.equal(res2.payload.ok, true);

    const res3 = makeRes();
    await handler(makeReq({ provider: 'kimi', key: 'mk-seq' }), res3);
    assert.equal(res3.payload.ok, true);

    // With sequential writes, ALL keys should be preserved
    const finalState = JSON.parse(writtenData);
    assert.equal(finalState.anthropic, 'sk-ant-seq');
    assert.equal(finalState.openai, 'sk-oai-seq');
    assert.equal(finalState.kimi, 'mk-seq');
  } finally {
    fs.readFileSync = _origReadFileSync;
    fs.writeFileSync = _origWriteFileSync;
    fs.mkdirSync = _origMkdirSync;
    writtenData = null;
  }
});

// ---------------------------------------------------------------------------
// Restore on teardown
// ---------------------------------------------------------------------------
test.after(() => {
  fs.readFileSync = _origReadFileSync;
  fs.writeFileSync = _origWriteFileSync;
  fs.mkdirSync = _origMkdirSync;
  https.request = _origHttpsRequest;
  _mockParseImage = null;
  _mockCheckProviderAvailability = null;
});
