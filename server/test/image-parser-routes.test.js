'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Set NODE_ENV=test so the rate limiter is bypassed
process.env.NODE_ENV = 'test';

// ---------------------------------------------------------------------------
// Resolve absolute paths for require.cache manipulation
// ---------------------------------------------------------------------------
const SERVICE_PATH = require.resolve('../src/services/image-parser');
const ROUTE_PATH = require.resolve('../src/routes/image-parser');

// ---------------------------------------------------------------------------
// Mockable service stubs — the route module's destructured imports will
// bind to these closures, so we can swap behavior per-test.
// ---------------------------------------------------------------------------
let _mockParseImage = null;
let _mockCheckProviderAvailability = null;

// Save originals for fs mocking
const _origReadFileSync = fs.readFileSync;
const _origWriteFileSync = fs.writeFileSync;
const _origMkdirSync = fs.mkdirSync;

// ---------------------------------------------------------------------------
// Clear cached modules, inject mock service, then require the route fresh.
// The route does `const { parseImage, ... } = require('../services/image-parser')`
// at require time, so the mock must be in place BEFORE the route loads.
// ---------------------------------------------------------------------------
function loadRouteWithMockedService() {
  // Clear both modules from cache
  delete require.cache[ROUTE_PATH];
  delete require.cache[SERVICE_PATH];

  // Load the real service so we get exports like KEYS_FILE, getApiKey, etc.
  const realService = require(SERVICE_PATH);

  // Replace the cached service module with a proxy that delegates to our stubs
  require.cache[SERVICE_PATH] = {
    id: SERVICE_PATH,
    filename: SERVICE_PATH,
    loaded: true,
    exports: {
      ...realService,
      parseImage: (...args) => {
        if (_mockParseImage) return _mockParseImage(...args);
        return realService.parseImage(...args);
      },
      checkProviderAvailability: (...args) => {
        if (_mockCheckProviderAvailability) return _mockCheckProviderAvailability(...args);
        return realService.checkProviderAvailability(...args);
      },
    },
  };

  // Now require the route — it will pick up our proxied service
  return require(ROUTE_PATH);
}

const routerModule = loadRouteWithMockedService();
const { KEYS_FILE } = require(SERVICE_PATH);

// ---------------------------------------------------------------------------
// Helpers — extract route handlers from the Express router stack
// ---------------------------------------------------------------------------
function findHandler(method, routePath) {
  const layer = routerModule.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method]
  );
  if (!layer) throw new Error(`No ${method.toUpperCase()} ${routePath} route found`);
  const handlers = layer.route.stack.map((s) => s.handle);
  return handlers[handlers.length - 1]; // last handler (after middleware)
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
// POST /parse — validation
// ═══════════════════════════════════════════════════════════════════════════
test('POST /parse validation', async (t) => {
  const handler = findHandler('post', '/parse');

  await t.test('returns 400 MISSING_IMAGE when no image in body', async () => {
    const res = makeRes();
    await handler(makeReq({ provider: 'lm-studio' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.ok, false);
    assert.equal(res.payload.code, 'MISSING_IMAGE');
    assert.equal(typeof res.payload.error, 'string');
  });

  await t.test('returns 400 MISSING_IMAGE when image is empty string', async () => {
    const res = makeRes();
    await handler(makeReq({ image: '', provider: 'lm-studio' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, 'MISSING_IMAGE');
  });

  await t.test('returns 400 INVALID_PROVIDER for invalid provider', async () => {
    const res = makeRes();
    await handler(makeReq({ image: 'AAAA', provider: 'bad-provider' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.ok, false);
    assert.equal(res.payload.code, 'INVALID_PROVIDER');
  });

  await t.test('returns 400 INVALID_PROVIDER when provider is missing', async () => {
    const res = makeRes();
    await handler(makeReq({ image: 'AAAA' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, 'INVALID_PROVIDER');
  });

  await t.test('accepts lm-studio as valid provider', async () => {
    _mockParseImage = async () => ({ text: 'ok', role: 'unknown', usage: null });
    const res = makeRes();
    try {
      await handler(makeReq({ image: 'AAAA', provider: 'lm-studio' }), res);
      assert.equal(res.payload.ok, true);
    } finally {
      _mockParseImage = null;
    }
  });

  await t.test('accepts anthropic as valid provider', async () => {
    _mockParseImage = async () => ({ text: 'ok', role: 'unknown', usage: null });
    const res = makeRes();
    try {
      await handler(makeReq({ image: 'AAAA', provider: 'anthropic' }), res);
      assert.equal(res.payload.ok, true);
    } finally {
      _mockParseImage = null;
    }
  });

  await t.test('accepts openai as valid provider', async () => {
    _mockParseImage = async () => ({ text: 'ok', role: 'unknown', usage: null });
    const res = makeRes();
    try {
      await handler(makeReq({ image: 'AAAA', provider: 'openai' }), res);
      assert.equal(res.payload.ok, true);
    } finally {
      _mockParseImage = null;
    }
  });

  await t.test('accepts kimi as valid provider', async () => {
    _mockParseImage = async () => ({ text: 'ok', role: 'unknown', usage: null });
    const res = makeRes();
    try {
      await handler(makeReq({ image: 'AAAA', provider: 'kimi' }), res);
      assert.equal(res.payload.ok, true);
    } finally {
      _mockParseImage = null;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /parse — error handling (status code mapping)
// ═══════════════════════════════════════════════════════════════════════════
test('POST /parse error handling', async (t) => {
  const handler = findHandler('post', '/parse');

  function makeParseError(code, message) {
    const err = new Error(message || code);
    err.code = code;
    return err;
  }

  await t.test('PROVIDER_UNAVAILABLE returns HTTP 503', async () => {
    _mockParseImage = async () => { throw makeParseError('PROVIDER_UNAVAILABLE', 'API key not configured'); };
    const res = makeRes();
    try {
      await handler(makeReq({ image: 'AAAA', provider: 'lm-studio' }), res);
      assert.equal(res.statusCode, 503);
      assert.equal(res.payload.ok, false);
      assert.equal(res.payload.code, 'PROVIDER_UNAVAILABLE');
    } finally {
      _mockParseImage = null;
    }
  });

  await t.test('TIMEOUT returns HTTP 504', async () => {
    _mockParseImage = async () => { throw makeParseError('TIMEOUT', 'Request timed out'); };
    const res = makeRes();
    try {
      await handler(makeReq({ image: 'AAAA', provider: 'lm-studio' }), res);
      assert.equal(res.statusCode, 504);
      assert.equal(res.payload.ok, false);
      assert.equal(res.payload.code, 'TIMEOUT');
    } finally {
      _mockParseImage = null;
    }
  });

  await t.test('PROVIDER_ERROR returns HTTP 422', async () => {
    _mockParseImage = async () => { throw makeParseError('PROVIDER_ERROR', 'LM Studio HTTP 500'); };
    const res = makeRes();
    try {
      await handler(makeReq({ image: 'AAAA', provider: 'lm-studio' }), res);
      assert.equal(res.statusCode, 422);
      assert.equal(res.payload.ok, false);
      assert.equal(res.payload.code, 'PROVIDER_ERROR');
    } finally {
      _mockParseImage = null;
    }
  });

  await t.test('unrecognized error code returns HTTP 422 (not 500)', async () => {
    _mockParseImage = async () => { throw makeParseError('SOME_UNKNOWN_CODE', 'Something went wrong'); };
    const res = makeRes();
    try {
      await handler(makeReq({ image: 'AAAA', provider: 'lm-studio' }), res);
      assert.equal(res.statusCode, 422, 'default error status should be 422, not 500');
      assert.equal(res.payload.ok, false);
      assert.equal(res.payload.code, 'SOME_UNKNOWN_CODE');
    } finally {
      _mockParseImage = null;
    }
  });

  await t.test('error without code returns 422 with PARSE_FAILED code', async () => {
    _mockParseImage = async () => { throw new Error('generic failure'); };
    const res = makeRes();
    try {
      await handler(makeReq({ image: 'AAAA', provider: 'lm-studio' }), res);
      assert.equal(res.statusCode, 422);
      assert.equal(res.payload.ok, false);
      assert.equal(res.payload.code, 'PARSE_FAILED');
      assert.equal(res.payload.error, 'generic failure');
    } finally {
      _mockParseImage = null;
    }
  });

  await t.test('all error responses include { ok, code, error } shape', async () => {
    _mockParseImage = async () => { throw makeParseError('TIMEOUT', 'timed out'); };
    const res = makeRes();
    try {
      await handler(makeReq({ image: 'AAAA', provider: 'lm-studio' }), res);
      assert.equal(res.payload.ok, false);
      assert.equal(typeof res.payload.code, 'string');
      assert.equal(typeof res.payload.error, 'string');
    } finally {
      _mockParseImage = null;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /parse — success response shape
// ═══════════════════════════════════════════════════════════════════════════
test('POST /parse success response includes ok, text, role, usage, elapsedMs', async () => {
  const handler = findHandler('post', '/parse');
  _mockParseImage = async () => ({
    text: 'COID/MID: 123',
    role: 'escalation',
    usage: { model: 'test', inputTokens: 10, outputTokens: 5 },
  });
  const res = makeRes();
  try {
    await handler(makeReq({ image: 'AAAA', provider: 'lm-studio' }), res);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.text, 'COID/MID: 123');
    assert.equal(res.payload.role, 'escalation');
    assert.ok(res.payload.usage);
    assert.equal(typeof res.payload.elapsedMs, 'number');
  } finally {
    _mockParseImage = null;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /status
// ═══════════════════════════════════════════════════════════════════════════
test('GET /status', async (t) => {
  const handler = findHandler('get', '/status');

  await t.test('returns ok with all providers', async () => {
    _mockCheckProviderAvailability = async () => ({
      'lm-studio': { available: true, model: 'test', reason: 'loaded' },
      anthropic: { available: false, reason: 'no key' },
      openai: { available: false, reason: 'no key' },
      kimi: { available: false, reason: 'no key' },
    });
    const res = makeRes();
    try {
      await handler(makeReq(), res);
      assert.equal(res.payload.ok, true);
      assert.ok('lm-studio' in res.payload.providers);
      assert.ok('anthropic' in res.payload.providers);
      assert.ok('openai' in res.payload.providers);
      assert.ok('kimi' in res.payload.providers);
    } finally {
      _mockCheckProviderAvailability = null;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /keys
// ═══════════════════════════════════════════════════════════════════════════
test('GET /keys', async (t) => {
  const handler = findHandler('get', '/keys');

  await t.test('returns { ok, keys } with boolean values for each provider', async () => {
    const orig = fs.readFileSync;
    fs.readFileSync = function mockRead(filePath) {
      if (String(filePath).includes('image-parser-keys')) {
        return JSON.stringify({ anthropic: 'sk-test', openai: '', kimi: 'mk-test' });
      }
      return orig.apply(this, arguments);
    };
    const res = makeRes();
    try {
      await handler(makeReq(), res);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.keys.anthropic, true);
      assert.equal(res.payload.keys.openai, false); // empty string is falsy
      assert.equal(res.payload.keys.kimi, true);
    } finally {
      fs.readFileSync = orig;
    }
  });

  await t.test('works when keys file does not exist (all false)', async () => {
    const orig = fs.readFileSync;
    fs.readFileSync = function mockRead(filePath) {
      if (String(filePath).includes('image-parser-keys')) throw new Error('ENOENT');
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
// PUT /keys
// ═══════════════════════════════════════════════════════════════════════════
test('PUT /keys', async (t) => {
  const handler = findHandler('put', '/keys');

  // Track what gets written to the filesystem
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
      if (String(filePath).includes('image-parser-keys')) {
        writtenData = data;
        return;
      }
      return _origWriteFileSync.apply(this, arguments);
    };
    fs.mkdirSync = function mockMkdir() { /* no-op */ };
  }

  function restoreFs() {
    fs.readFileSync = _origReadFileSync;
    fs.writeFileSync = _origWriteFileSync;
    fs.mkdirSync = _origMkdirSync;
    writtenData = null;
  }

  await t.test('returns 400 for invalid provider', async () => {
    const res = makeRes();
    await handler(makeReq({ provider: 'bad-provider', key: 'sk-test' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.ok, false);
    assert.equal(res.payload.code, 'INVALID_PROVIDER');
  });

  await t.test('saves key and can be read back', async () => {
    mockFs({});
    try {
      const res = makeRes();
      await handler(makeReq({ provider: 'anthropic', key: 'sk-new-key' }), res);
      assert.equal(res.payload.ok, true);

      // Verify the written data contains the key
      const saved = JSON.parse(writtenData);
      assert.equal(saved.anthropic, 'sk-new-key');
    } finally {
      restoreFs();
    }
  });

  await t.test('removes key when empty string provided', async () => {
    mockFs({ anthropic: 'sk-existing' });
    try {
      const res = makeRes();
      await handler(makeReq({ provider: 'anthropic', key: '' }), res);
      assert.equal(res.payload.ok, true);

      const saved = JSON.parse(writtenData);
      assert.equal(saved.anthropic, undefined);
    } finally {
      restoreFs();
    }
  });

  await t.test('removes key when null provided', async () => {
    mockFs({ openai: 'sk-existing' });
    try {
      const res = makeRes();
      await handler(makeReq({ provider: 'openai', key: null }), res);
      assert.equal(res.payload.ok, true);

      const saved = JSON.parse(writtenData);
      assert.equal(saved.openai, undefined);
    } finally {
      restoreFs();
    }
  });

  await t.test('preserves other providers keys when updating one', async () => {
    mockFs({ anthropic: 'sk-ant', openai: 'sk-oai' });
    try {
      const res = makeRes();
      await handler(makeReq({ provider: 'kimi', key: 'mk-new' }), res);
      assert.equal(res.payload.ok, true);

      const saved = JSON.parse(writtenData);
      assert.equal(saved.anthropic, 'sk-ant');
      assert.equal(saved.openai, 'sk-oai');
      assert.equal(saved.kimi, 'mk-new');
    } finally {
      restoreFs();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /keys/test
// ═══════════════════════════════════════════════════════════════════════════
test('POST /keys/test', async (t) => {
  const handler = findHandler('post', '/keys/test');

  await t.test('returns 400 for invalid provider', async () => {
    const res = makeRes();
    await handler(makeReq({ provider: 'bad-provider', key: 'sk-test' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.ok, false);
    assert.equal(res.payload.code, 'INVALID_PROVIDER');
  });

  await t.test('returns 400 NO_KEY when no key provided and none stored', async () => {
    const origRead = fs.readFileSync;
    const origEnv = process.env.ANTHROPIC_API_KEY;
    fs.readFileSync = function mockRead(filePath) {
      if (String(filePath).includes('image-parser-keys')) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    delete process.env.ANTHROPIC_API_KEY;
    const res = makeRes();
    try {
      await handler(makeReq({ provider: 'anthropic' }), res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.payload.ok, false);
      assert.equal(res.payload.code, 'NO_KEY');
    } finally {
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
    }
  });

  await t.test('accepts anthropic as valid provider', async () => {
    const res = makeRes();
    const origRead = fs.readFileSync;
    fs.readFileSync = function mockRead(filePath) {
      if (String(filePath).includes('image-parser-keys')) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    const origEnv = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await handler(makeReq({ provider: 'anthropic' }), res);
      assert.equal(res.payload.code, 'NO_KEY');
    } finally {
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
    }
  });

  await t.test('accepts openai as valid provider', async () => {
    const res = makeRes();
    const origRead = fs.readFileSync;
    fs.readFileSync = function mockRead(filePath) {
      if (String(filePath).includes('image-parser-keys')) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    const origEnv = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await handler(makeReq({ provider: 'openai' }), res);
      assert.equal(res.payload.code, 'NO_KEY');
    } finally {
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.OPENAI_API_KEY = origEnv;
    }
  });

  await t.test('accepts kimi as valid provider', async () => {
    const res = makeRes();
    const origRead = fs.readFileSync;
    fs.readFileSync = function mockRead(filePath) {
      if (String(filePath).includes('image-parser-keys')) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    const origEnv = process.env.MOONSHOT_API_KEY;
    delete process.env.MOONSHOT_API_KEY;
    try {
      await handler(makeReq({ provider: 'kimi' }), res);
      assert.equal(res.payload.code, 'NO_KEY');
    } finally {
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.MOONSHOT_API_KEY = origEnv;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Kimi test config — verify temperature: 1 in the test body
// ═══════════════════════════════════════════════════════════════════════════
test('Kimi test config includes temperature: 1', () => {
  const routeSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'image-parser.js'),
    'utf8'
  );

  // Verify the Kimi buildBody includes temperature: 1
  const kimiSection = routeSource.match(/kimi:\s*\{[\s\S]*?buildBody:[^}]+\}/);
  assert.ok(kimiSection, 'Kimi section exists in TEST_CONFIGS');
  assert.ok(
    kimiSection[0].includes('temperature: 1'),
    'Kimi test config buildBody includes temperature: 1'
  );

  // Also verify OpenAI and Anthropic do NOT include temperature
  const anthropicSection = routeSource.match(/anthropic:\s*\{[\s\S]*?buildBody:[^}]+\}/);
  assert.ok(anthropicSection, 'Anthropic section exists in TEST_CONFIGS');
  assert.ok(
    !anthropicSection[0].includes('temperature'),
    'Anthropic test config does not include temperature'
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /parse — timeout override via setResponseTimeout
// ═══════════════════════════════════════════════════════════════════════════
test('POST /parse timeout override', async (t) => {
  const handler = findHandler('post', '/parse');

  await t.test('calls setResponseTimeout with effectiveTimeout + 10000', async () => {
    let capturedTimeout = null;
    _mockParseImage = async () => ({ text: 'ok', role: 'unknown', usage: null });
    const req = makeReq({ image: 'AAAA', provider: 'lm-studio', timeoutMs: 30000 });
    req.setResponseTimeout = (ms) => { capturedTimeout = ms; };
    const res = makeRes();
    try {
      await handler(req, res);
      assert.equal(capturedTimeout, 40000); // 30000 + 10000
    } finally {
      _mockParseImage = null;
    }
  });

  await t.test('default timeout is 60s when timeoutMs not provided', async () => {
    let capturedTimeout = null;
    _mockParseImage = async () => ({ text: 'ok', role: 'unknown', usage: null });
    const req = makeReq({ image: 'AAAA', provider: 'lm-studio' });
    req.setResponseTimeout = (ms) => { capturedTimeout = ms; };
    const res = makeRes();
    try {
      await handler(req, res);
      assert.equal(capturedTimeout, 70000); // 60000 + 10000
    } finally {
      _mockParseImage = null;
    }
  });

  await t.test('timeoutMs capped at 120s max', async () => {
    let capturedTimeout = null;
    _mockParseImage = async () => ({ text: 'ok', role: 'unknown', usage: null });
    const req = makeReq({ image: 'AAAA', provider: 'lm-studio', timeoutMs: 999999 });
    req.setResponseTimeout = (ms) => { capturedTimeout = ms; };
    const res = makeRes();
    try {
      await handler(req, res);
      assert.equal(capturedTimeout, 130000); // 120000 + 10000
    } finally {
      _mockParseImage = null;
    }
  });

  await t.test('missing setResponseTimeout does not throw', async () => {
    _mockParseImage = async () => ({ text: 'ok', role: 'unknown', usage: null });
    const req = makeReq({ image: 'AAAA', provider: 'lm-studio' });
    delete req.setResponseTimeout;
    const res = makeRes();
    try {
      await handler(req, res);
      assert.equal(res.payload.ok, true);
    } finally {
      _mockParseImage = null;
    }
  });
});

// ---------------------------------------------------------------------------
// Restore on teardown
// ---------------------------------------------------------------------------
test.after(() => {
  fs.readFileSync = _origReadFileSync;
  fs.writeFileSync = _origWriteFileSync;
  fs.mkdirSync = _origMkdirSync;
  _mockParseImage = null;
  _mockCheckProviderAvailability = null;
});
