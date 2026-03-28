'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { EventEmitter } = require('events');

// ---------------------------------------------------------------------------
// Save originals
// ---------------------------------------------------------------------------
const _origHttpRequest = http.request;
const _origHttpGet = http.get;
const _origHttpsRequest = https.request;
const _origReadFileSync = fs.readFileSync;

// ---------------------------------------------------------------------------
// HTTPS mock helpers — intercept https.request for cloud providers
// ---------------------------------------------------------------------------
let _httpsIntercept = null;
let _httpIntercept = null;
let _lastHttpsRequestOptions = null;
let _lastHttpsRequestBody = null;
let _lastHttpRequestOptions = null;
let _lastHttpRequestBody = null;

function mockHttpsRequest(statusCode, body, { delay = 0 } = {}) {
  _httpsIntercept = { statusCode, body, delay };
}

function mockHttpRequest(statusCode, body, { delay = 0 } = {}) {
  _httpIntercept = { statusCode, body, delay };
}

function clearAllMocks() {
  _httpsIntercept = null;
  _httpIntercept = null;
  _lastHttpsRequestOptions = null;
  _lastHttpsRequestBody = null;
  _lastHttpRequestOptions = null;
  _lastHttpRequestBody = null;
}

// Patch https.request to capture options and body
https.request = function patchedHttpsRequest(options, callback) {
  _lastHttpsRequestOptions = options;
  _lastHttpsRequestBody = '';

  if (!_httpsIntercept) return _origHttpsRequest.apply(https, arguments);

  const { statusCode, body, delay } = _httpsIntercept;
  const req = new EventEmitter();
  req.write = (data) => { _lastHttpsRequestBody += (typeof data === 'string' ? data : data.toString()); };
  req.end = () => {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    if (typeof callback === 'function') {
      const emit = () => {
        callback(res);
        process.nextTick(() => {
          res.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
          res.emit('end');
        });
      };
      if (delay > 0) setTimeout(emit, delay);
      else process.nextTick(emit);
    }
  };
  req.destroy = () => {};
  return req;
};

// Patch http.request to capture options and body
http.request = function patchedHttpRequest(...args) {
  let options = args[0];
  let callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;

  _lastHttpRequestOptions = options;
  _lastHttpRequestBody = '';

  if (!_httpIntercept) return _origHttpRequest.apply(http, args);

  const { statusCode, body, delay } = _httpIntercept;
  const req = new EventEmitter();
  req.write = (data) => { _lastHttpRequestBody += (typeof data === 'string' ? data : data.toString()); };
  req.end = () => {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    if (typeof callback === 'function') {
      const emit = () => {
        callback(res);
        process.nextTick(() => {
          res.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
          res.emit('end');
        });
      };
      if (delay > 0) setTimeout(emit, delay);
      else process.nextTick(emit);
    }
  };
  req.destroy = () => {};
  return req;
};

http.get = function patchedHttpGet(...args) {
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
} = require('../src/services/image-parser');

test.beforeEach(() => {
  clearProviderAvailabilityCache();
  clearAllMocks();
});

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ═══════════════════════════════════════════════════════════════════════════
// A. Provider Request Body Validation
// ═══════════════════════════════════════════════════════════════════════════

test('Provider request body: OpenAI', async (t) => {
  const origEnv = process.env.OPENAI_API_KEY;
  const origRead = fs.readFileSync;
  process.env.OPENAI_API_KEY = 'sk-test-openai-key';
  fs.readFileSync = function mockRead(filePath) {
    if (filePath === KEYS_FILE) throw new Error('ENOENT');
    return origRead.apply(this, arguments);
  };

  try {
    mockHttpsRequest(200, {
      choices: [{ message: { content: 'parsed text' } }],
      model: 'gpt-4o',
      usage: { prompt_tokens: 50, completion_tokens: 25 },
    });

    await parseImage(TINY_PNG_BASE64, { provider: 'openai' });

    await t.test('sends to api.openai.com hostname', () => {
      assert.equal(_lastHttpsRequestOptions.hostname, 'api.openai.com');
    });

    await t.test('sends to /v1/chat/completions path', () => {
      assert.equal(_lastHttpsRequestOptions.path, '/v1/chat/completions');
    });

    await t.test('uses POST method', () => {
      assert.equal(_lastHttpsRequestOptions.method, 'POST');
    });

    await t.test('sends Authorization Bearer header', () => {
      assert.equal(_lastHttpsRequestOptions.headers['Authorization'], 'Bearer sk-test-openai-key');
    });

    await t.test('sends Content-Type application/json', () => {
      assert.equal(_lastHttpsRequestOptions.headers['Content-Type'], 'application/json');
    });

    await t.test('body contains model gpt-4o by default', () => {
      const body = JSON.parse(_lastHttpsRequestBody);
      assert.equal(body.model, 'gpt-4o');
    });

    await t.test('body contains temperature 0.1', () => {
      const body = JSON.parse(_lastHttpsRequestBody);
      assert.equal(body.temperature, 0.1);
    });

    await t.test('body contains max_tokens 4096', () => {
      const body = JSON.parse(_lastHttpsRequestBody);
      assert.equal(body.max_tokens, 4096);
    });

    await t.test('body messages include system + user roles', () => {
      const body = JSON.parse(_lastHttpsRequestBody);
      assert.equal(body.messages.length, 2);
      assert.equal(body.messages[0].role, 'system');
      assert.equal(body.messages[1].role, 'user');
    });

    await t.test('user message includes image_url with data URL', () => {
      const body = JSON.parse(_lastHttpsRequestBody);
      const userContent = body.messages[1].content;
      assert.ok(Array.isArray(userContent));
      const imageBlock = userContent.find(c => c.type === 'image_url');
      assert.ok(imageBlock);
      assert.ok(imageBlock.image_url.url.startsWith('data:image/'));
    });

    await t.test('Content-Length header matches actual body', () => {
      const expectedLength = Buffer.byteLength(_lastHttpsRequestBody);
      assert.equal(Number(_lastHttpsRequestOptions.headers['Content-Length']), expectedLength);
    });
  } finally {
    clearAllMocks();
    fs.readFileSync = origRead;
    if (origEnv !== undefined) process.env.OPENAI_API_KEY = origEnv;
    else delete process.env.OPENAI_API_KEY;
  }
});

test('Provider request body: Anthropic', async (t) => {
  const origEnv = process.env.ANTHROPIC_API_KEY;
  const origRead = fs.readFileSync;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
  fs.readFileSync = function mockRead(filePath) {
    if (filePath === KEYS_FILE) throw new Error('ENOENT');
    return origRead.apply(this, arguments);
  };

  try {
    mockHttpsRequest(200, {
      content: [{ type: 'text', text: 'CASE: CS-001' }],
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 60, output_tokens: 30 },
    });

    await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });

    await t.test('sends to api.anthropic.com hostname', () => {
      assert.equal(_lastHttpsRequestOptions.hostname, 'api.anthropic.com');
    });

    await t.test('sends to /v1/messages path', () => {
      assert.equal(_lastHttpsRequestOptions.path, '/v1/messages');
    });

    await t.test('sends x-api-key header (not Authorization Bearer)', () => {
      assert.equal(_lastHttpsRequestOptions.headers['x-api-key'], 'sk-ant-test-key');
      assert.equal(_lastHttpsRequestOptions.headers['Authorization'], undefined);
    });

    await t.test('sends anthropic-version header', () => {
      assert.equal(_lastHttpsRequestOptions.headers['anthropic-version'], '2023-06-01');
    });

    await t.test('body uses Anthropic content block format for images', () => {
      const body = JSON.parse(_lastHttpsRequestBody);
      const userMsg = body.messages[0];
      assert.equal(userMsg.role, 'user');
      const imageBlock = userMsg.content.find(c => c.type === 'image');
      assert.ok(imageBlock, 'should have image type content block');
      assert.equal(imageBlock.source.type, 'base64');
      assert.equal(imageBlock.source.media_type, 'image/png');
      assert.ok(imageBlock.source.data.length > 0);
    });

    await t.test('body uses system field (not messages role system)', () => {
      const body = JSON.parse(_lastHttpsRequestBody);
      assert.equal(typeof body.system, 'string');
      assert.ok(body.system.length > 0);
      // Anthropic: system is a top-level field, not in messages array
      assert.equal(body.messages.length, 1);
    });

    await t.test('body contains model claude-sonnet-4-20250514 by default', () => {
      const body = JSON.parse(_lastHttpsRequestBody);
      assert.equal(body.model, 'claude-sonnet-4-20250514');
    });

    await t.test('body does NOT contain temperature (Anthropic default)', () => {
      const body = JSON.parse(_lastHttpsRequestBody);
      assert.equal(body.temperature, undefined);
    });

    await t.test('Content-Length matches payload', () => {
      const expectedLength = Buffer.byteLength(_lastHttpsRequestBody);
      assert.equal(Number(_lastHttpsRequestOptions.headers['Content-Length']), expectedLength);
    });

    await t.test('Anthropic usage maps input_tokens/output_tokens correctly', async () => {
      clearAllMocks();
      mockHttpsRequest(200, {
        content: [{ type: 'text', text: 'test' }],
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });
      assert.equal(result.usage.inputTokens, 100);
      assert.equal(result.usage.outputTokens, 50);
    });
  } finally {
    clearAllMocks();
    fs.readFileSync = origRead;
    if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});

test('Provider request body: Kimi', async (t) => {
  const origEnv = process.env.MOONSHOT_API_KEY;
  const origRead = fs.readFileSync;
  process.env.MOONSHOT_API_KEY = 'mk-test-kimi-key';
  fs.readFileSync = function mockRead(filePath) {
    if (filePath === KEYS_FILE) throw new Error('ENOENT');
    return origRead.apply(this, arguments);
  };

  try {
    mockHttpsRequest(200, {
      choices: [{ message: { content: 'CASE: CS-002' } }],
      model: 'kimi-k2.5',
      usage: { prompt_tokens: 40, completion_tokens: 20 },
    });

    await parseImage(TINY_PNG_BASE64, { provider: 'kimi' });

    await t.test('sends to api.moonshot.ai hostname', () => {
      assert.equal(_lastHttpsRequestOptions.hostname, 'api.moonshot.ai');
    });

    await t.test('sends to /v1/chat/completions path', () => {
      assert.equal(_lastHttpsRequestOptions.path, '/v1/chat/completions');
    });

    await t.test('sends Authorization Bearer header', () => {
      assert.equal(_lastHttpsRequestOptions.headers['Authorization'], 'Bearer mk-test-kimi-key');
    });

    await t.test('body contains temperature: 1 (CRITICAL — Kimi rejects other values)', () => {
      const body = JSON.parse(_lastHttpsRequestBody);
      assert.equal(body.temperature, 1, 'Kimi MUST have temperature exactly 1');
    });

    await t.test('body contains model kimi-k2.5 by default', () => {
      const body = JSON.parse(_lastHttpsRequestBody);
      assert.equal(body.model, 'kimi-k2.5');
    });

    await t.test('body uses image_url format (same as OpenAI)', () => {
      const body = JSON.parse(_lastHttpsRequestBody);
      const userContent = body.messages[1].content;
      const imageBlock = userContent.find(c => c.type === 'image_url');
      assert.ok(imageBlock, 'Kimi uses OpenAI-compatible image_url format');
      assert.ok(imageBlock.image_url.url.startsWith('data:image/'));
    });

    await t.test('Content-Length matches payload', () => {
      const expectedLength = Buffer.byteLength(_lastHttpsRequestBody);
      assert.equal(Number(_lastHttpsRequestOptions.headers['Content-Length']), expectedLength);
    });
  } finally {
    clearAllMocks();
    fs.readFileSync = origRead;
    if (origEnv !== undefined) process.env.MOONSHOT_API_KEY = origEnv;
    else delete process.env.MOONSHOT_API_KEY;
  }
});

test('Provider request body: LM Studio', async (t) => {
  try {
    mockHttpRequest(200, {
      choices: [{ message: { content: 'CASE: CS-003' } }],
      model: 'qwen2.5-vl-7b',
      usage: { prompt_tokens: 30, completion_tokens: 15 },
    });

    await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio', model: 'qwen2.5-vl-7b' });

    await t.test('sends via HTTP (not HTTPS)', () => {
      // LM Studio is local, uses http
      assert.ok(_lastHttpRequestOptions);
    });

    await t.test('sends to /v1/chat/completions path', () => {
      assert.equal(_lastHttpRequestOptions.path, '/v1/chat/completions');
    });

    await t.test('body contains temperature 0.1', () => {
      const body = JSON.parse(_lastHttpRequestBody);
      assert.equal(body.temperature, 0.1);
    });

    await t.test('body contains stream: false', () => {
      const body = JSON.parse(_lastHttpRequestBody);
      assert.equal(body.stream, false);
    });

    await t.test('body uses image_url format with data URL', () => {
      const body = JSON.parse(_lastHttpRequestBody);
      const userContent = body.messages[1].content;
      const imageBlock = userContent.find(c => c.type === 'image_url');
      assert.ok(imageBlock);
      assert.ok(imageBlock.image_url.url.startsWith('data:image/'));
    });

    await t.test('Content-Length matches payload', () => {
      const expectedLength = Buffer.byteLength(_lastHttpRequestBody);
      assert.equal(Number(_lastHttpRequestOptions.headers['Content-Length']), expectedLength);
    });
  } finally {
    clearAllMocks();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// A2. Custom model override for each provider
// ═══════════════════════════════════════════════════════════════════════════

test('Custom model override works for each provider', async (t) => {
  const origRead = fs.readFileSync;

  await t.test('OpenAI uses custom model when provided', async () => {
    const origEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, {
      choices: [{ message: { content: 'test' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    try {
      await parseImage(TINY_PNG_BASE64, { provider: 'openai', model: 'gpt-4o-mini' });
      const body = JSON.parse(_lastHttpsRequestBody);
      assert.equal(body.model, 'gpt-4o-mini');
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.OPENAI_API_KEY = origEnv;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  await t.test('Anthropic uses custom model when provided', async () => {
    const origEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, {
      content: [{ type: 'text', text: 'test' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    try {
      await parseImage(TINY_PNG_BASE64, { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' });
      const body = JSON.parse(_lastHttpsRequestBody);
      assert.equal(body.model, 'claude-haiku-4-5-20251001');
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  await t.test('Kimi uses custom model when provided', async () => {
    const origEnv = process.env.MOONSHOT_API_KEY;
    process.env.MOONSHOT_API_KEY = 'mk-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, {
      choices: [{ message: { content: 'test' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    try {
      await parseImage(TINY_PNG_BASE64, { provider: 'kimi', model: 'moonshot-v1-8k' });
      const body = JSON.parse(_lastHttpsRequestBody);
      assert.equal(body.model, 'moonshot-v1-8k');
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.MOONSHOT_API_KEY = origEnv;
      else delete process.env.MOONSHOT_API_KEY;
    }
  });

  await t.test('LM Studio uses custom model when provided', async () => {
    mockHttpRequest(200, {
      choices: [{ message: { content: 'test' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    try {
      await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio', model: 'my-custom-model' });
      const body = JSON.parse(_lastHttpRequestBody);
      assert.equal(body.model, 'my-custom-model');
    } finally {
      clearAllMocks();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. API Key Resolution Chain — deep edge cases
// ═══════════════════════════════════════════════════════════════════════════

test('API key resolution edge cases', async (t) => {
  await t.test('stored key file with corrupt JSON gracefully falls back to env var', () => {
    const origRead = fs.readFileSync;
    const origEnv = process.env.ANTHROPIC_API_KEY;
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) return '{ INVALID JSON !!!';
      return origRead.apply(this, arguments);
    };
    process.env.ANTHROPIC_API_KEY = 'sk-env-fallback';
    try {
      assert.equal(getApiKey('anthropic'), 'sk-env-fallback');
    } finally {
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  await t.test('stored key file is empty string → graceful fallback to env', () => {
    const origRead = fs.readFileSync;
    const origEnv = process.env.OPENAI_API_KEY;
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) return '';
      return origRead.apply(this, arguments);
    };
    process.env.OPENAI_API_KEY = 'sk-env-openai';
    try {
      assert.equal(getApiKey('openai'), 'sk-env-openai');
    } finally {
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.OPENAI_API_KEY = origEnv;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  await t.test('stored key with whitespace-only value treated as no key', () => {
    const origRead = fs.readFileSync;
    const origEnv = process.env.ANTHROPIC_API_KEY;
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) return JSON.stringify({ anthropic: '   ' });
      return origRead.apply(this, arguments);
    };
    delete process.env.ANTHROPIC_API_KEY;
    try {
      // getStoredApiKey returns '   ' (truthy but whitespace), getApiKey returns it
      // The calling code (callAnthropic etc.) should handle this,
      // but getStoredApiKey itself returns the raw value
      const stored = getStoredApiKey('anthropic');
      assert.equal(stored, '   ');
    } finally {
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
    }
  });

  await t.test('multiple providers stored — update one doesnt affect others', () => {
    const origRead = fs.readFileSync;
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) return JSON.stringify({
        anthropic: 'sk-ant-123',
        openai: 'sk-oai-456',
        kimi: 'mk-kimi-789',
      });
      return origRead.apply(this, arguments);
    };
    try {
      assert.equal(getStoredApiKey('anthropic'), 'sk-ant-123');
      assert.equal(getStoredApiKey('openai'), 'sk-oai-456');
      assert.equal(getStoredApiKey('kimi'), 'mk-kimi-789');
    } finally {
      fs.readFileSync = origRead;
    }
  });

  await t.test('no key at all returns null and provider throws PROVIDER_UNAVAILABLE', async () => {
    const origRead = fs.readFileSync;
    const origEnv = process.env.ANTHROPIC_API_KEY;
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    delete process.env.ANTHROPIC_API_KEY;
    try {
      assert.equal(getApiKey('anthropic'), null);
      await assert.rejects(
        () => parseImage(TINY_PNG_BASE64, { provider: 'anthropic' }),
        (err) => { assert.equal(err.code, 'PROVIDER_UNAVAILABLE'); return true; }
      );
    } finally {
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
    }
  });

  await t.test('env var with empty string treated as no key', () => {
    const origRead = fs.readFileSync;
    const origEnv = process.env.OPENAI_API_KEY;
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    process.env.OPENAI_API_KEY = '';
    try {
      // process.env.OPENAI_API_KEY is '' which is falsy in `|| null`
      assert.equal(getApiKey('openai'), null);
    } finally {
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.OPENAI_API_KEY = origEnv;
      else delete process.env.OPENAI_API_KEY;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. Image Payload Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

test('Image payload edge cases', async (t) => {
  await t.test('normalizeBase64 handles webp media type', () => {
    const result = normalizeBase64('data:image/webp;base64,UklGRhYA');
    assert.ok(result);
    assert.equal(result.mediaType, 'image/webp');
    assert.equal(result.rawBase64, 'UklGRhYA');
  });

  await t.test('normalizeBase64 handles gif media type', () => {
    const result = normalizeBase64('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
    assert.ok(result);
    assert.equal(result.mediaType, 'image/gif');
  });

  await t.test('normalizeBase64 strips whitespace around base64 data', () => {
    const result = normalizeBase64('  \t ' + TINY_PNG_BASE64 + '  \n ');
    assert.ok(result);
    assert.equal(result.rawBase64, TINY_PNG_BASE64);
  });

  await t.test('normalizeBase64 with double data URI prefix returns inner as rawBase64', () => {
    // Edge case: data:image/png;base64,data:image/png;base64,AAAA
    // The regex match will match the outer prefix, rawBase64 will contain the rest
    const doublePrefix = 'data:image/png;base64,data:image/png;base64,AAAA';
    const result = normalizeBase64(doublePrefix);
    assert.ok(result);
    // The regex captures everything after the first base64, prefix
    assert.equal(result.rawBase64, 'data:image/png;base64,AAAA');
  });

  await t.test('normalizeBase64 with only data: prefix but no image/* is handled', () => {
    const result = normalizeBase64('data:text/plain;base64,SGVsbG8=');
    assert.ok(result);
    // Does not match data:image/* pattern, so treated as raw base64
    assert.equal(result.mediaType, 'image/png'); // defaults to png
  });

  await t.test('1x1 pixel PNG produces valid result', async () => {
    mockHttpRequest(200, {
      choices: [{ message: { content: 'tiny image parsed' } }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio', model: 'test' });
      assert.equal(result.text, 'tiny image parsed');
    } finally {
      clearAllMocks();
    }
  });

  await t.test('large base64 image (~50KB) does not crash', async () => {
    const largeBase64 = 'A'.repeat(50000);
    mockHttpRequest(200, {
      choices: [{ message: { content: 'large image ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    try {
      const result = await parseImage(largeBase64, { provider: 'lm-studio', model: 'test' });
      assert.equal(result.text, 'large image ok');
      // Verify Content-Length was set correctly for large payload
      const bodyLength = Buffer.byteLength(_lastHttpRequestBody);
      assert.equal(Number(_lastHttpRequestOptions.headers['Content-Length']), bodyLength);
    } finally {
      clearAllMocks();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D. Error Response Chain — provider HTTP errors
// ═══════════════════════════════════════════════════════════════════════════

test('Error response chain: provider HTTP errors', async (t) => {
  const origRead = fs.readFileSync;

  await t.test('OpenAI 401 returns PROVIDER_ERROR with HTTP 401 in message', async () => {
    const origEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-invalid';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(401, JSON.stringify({ error: { message: 'Invalid API key' } }));
    try {
      await assert.rejects(
        () => parseImage(TINY_PNG_BASE64, { provider: 'openai' }),
        (err) => {
          assert.equal(err.code, 'PROVIDER_ERROR');
          assert.match(err.message, /HTTP 401/);
          return true;
        }
      );
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.OPENAI_API_KEY = origEnv;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  await t.test('Anthropic 403 returns PROVIDER_ERROR with HTTP 403 in message', async () => {
    const origEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-bad';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(403, JSON.stringify({ error: { type: 'forbidden' } }));
    try {
      await assert.rejects(
        () => parseImage(TINY_PNG_BASE64, { provider: 'anthropic' }),
        (err) => {
          assert.equal(err.code, 'PROVIDER_ERROR');
          assert.match(err.message, /HTTP 403/);
          return true;
        }
      );
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  await t.test('Kimi 429 (rate limit) returns PROVIDER_ERROR', async () => {
    const origEnv = process.env.MOONSHOT_API_KEY;
    process.env.MOONSHOT_API_KEY = 'mk-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(429, JSON.stringify({ error: { message: 'Rate limit exceeded' } }));
    try {
      await assert.rejects(
        () => parseImage(TINY_PNG_BASE64, { provider: 'kimi' }),
        (err) => {
          assert.equal(err.code, 'PROVIDER_ERROR');
          assert.match(err.message, /HTTP 429/);
          return true;
        }
      );
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.MOONSHOT_API_KEY = origEnv;
      else delete process.env.MOONSHOT_API_KEY;
    }
  });

  await t.test('LM Studio 500 returns PROVIDER_ERROR', async () => {
    mockHttpRequest(500, 'Internal Server Error');
    try {
      await assert.rejects(
        () => parseImage(TINY_PNG_BASE64, { provider: 'lm-studio', model: 'test' }),
        (err) => {
          assert.equal(err.code, 'PROVIDER_ERROR');
          assert.match(err.message, /HTTP 500/);
          return true;
        }
      );
    } finally {
      clearAllMocks();
    }
  });

  await t.test('LM Studio returns valid HTTP but invalid JSON → PROVIDER_ERROR', async () => {
    mockHttpRequest(200, 'this is not json at all <html>error</html>');
    try {
      await assert.rejects(
        () => parseImage(TINY_PNG_BASE64, { provider: 'lm-studio', model: 'test' }),
        (err) => {
          assert.equal(err.code, 'PROVIDER_ERROR');
          assert.match(err.message, /invalid JSON/i);
          return true;
        }
      );
    } finally {
      clearAllMocks();
    }
  });

  await t.test('OpenAI returns valid JSON but unexpected shape (no choices) → empty text', async () => {
    const origEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, { data: 'unexpected shape', model: 'gpt-4o' });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'openai' });
      // No choices → text defaults to ''
      assert.equal(result.text, '');
      assert.equal(result.role, 'unknown');
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.OPENAI_API_KEY = origEnv;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  await t.test('Anthropic returns valid JSON but no content array → empty text', async () => {
    const origEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, { id: 'msg_123', type: 'message', model: 'claude-sonnet-4-20250514' });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });
      assert.equal(result.text, '');
      assert.equal(result.role, 'unknown');
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  await t.test('provider connection error propagates', async () => {
    const origPatch = http.request;
    http.request = function errorSimulation() {
      const req = new EventEmitter();
      req.write = () => {};
      req.end = () => { process.nextTick(() => req.emit('error', new Error('connect ECONNREFUSED'))); };
      req.destroy = () => {};
      return req;
    };
    try {
      await assert.rejects(
        () => parseImage(TINY_PNG_BASE64, { provider: 'lm-studio', model: 'test' }),
        (err) => {
          assert.match(err.message, /ECONNREFUSED/);
          return true;
        }
      );
    } finally {
      http.request = origPatch;
    }
  });

  await t.test('provider timeout triggers TIMEOUT error code', async () => {
    const origPatch = http.request;
    http.request = function timeoutSimulation() {
      const req = new EventEmitter();
      req.write = () => {};
      req.end = () => { process.nextTick(() => req.emit('timeout')); };
      req.destroy = () => {};
      return req;
    };
    try {
      await assert.rejects(
        () => parseImage(TINY_PNG_BASE64, { provider: 'lm-studio', model: 'test', timeoutMs: 100 }),
        (err) => {
          assert.equal(err.code, 'TIMEOUT');
          assert.match(err.message, /timed out/i);
          return true;
        }
      );
    } finally {
      http.request = origPatch;
    }
  });

  await t.test('Anthropic invalid JSON response returns PROVIDER_ERROR', async () => {
    const origEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, 'not json {{{');
    try {
      await assert.rejects(
        () => parseImage(TINY_PNG_BASE64, { provider: 'anthropic' }),
        (err) => {
          assert.equal(err.code, 'PROVIDER_ERROR');
          assert.match(err.message, /invalid JSON/i);
          return true;
        }
      );
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  await t.test('Kimi invalid JSON response returns PROVIDER_ERROR', async () => {
    const origEnv = process.env.MOONSHOT_API_KEY;
    process.env.MOONSHOT_API_KEY = 'mk-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, '<html>bad response</html>');
    try {
      await assert.rejects(
        () => parseImage(TINY_PNG_BASE64, { provider: 'kimi' }),
        (err) => {
          assert.equal(err.code, 'PROVIDER_ERROR');
          assert.match(err.message, /invalid JSON/i);
          return true;
        }
      );
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.MOONSHOT_API_KEY = origEnv;
      else delete process.env.MOONSHOT_API_KEY;
    }
  });

  await t.test('OpenAI invalid JSON response returns PROVIDER_ERROR', async () => {
    const origEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, '<<<not json>>>');
    try {
      await assert.rejects(
        () => parseImage(TINY_PNG_BASE64, { provider: 'openai' }),
        (err) => {
          assert.equal(err.code, 'PROVIDER_ERROR');
          assert.match(err.message, /invalid JSON/i);
          return true;
        }
      );
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.OPENAI_API_KEY = origEnv;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  // Restore fs
  fs.readFileSync = origRead;
});

// ═══════════════════════════════════════════════════════════════════════════
// E. Usage Extraction Per Provider
// ═══════════════════════════════════════════════════════════════════════════

test('Usage extraction per provider', async (t) => {
  const origRead = fs.readFileSync;

  await t.test('OpenAI maps prompt_tokens/completion_tokens to inputTokens/outputTokens', async () => {
    const origEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, {
      choices: [{ message: { content: 'test' } }],
      model: 'gpt-4o',
      usage: { prompt_tokens: 200, completion_tokens: 100 },
    });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'openai' });
      assert.equal(result.usage.inputTokens, 200);
      assert.equal(result.usage.outputTokens, 100);
      assert.equal(result.usage.model, 'gpt-4o');
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.OPENAI_API_KEY = origEnv;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  await t.test('Kimi maps prompt_tokens/completion_tokens to inputTokens/outputTokens', async () => {
    const origEnv = process.env.MOONSHOT_API_KEY;
    process.env.MOONSHOT_API_KEY = 'mk-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, {
      choices: [{ message: { content: 'test' } }],
      model: 'kimi-k2.5',
      usage: { prompt_tokens: 150, completion_tokens: 75 },
    });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'kimi' });
      assert.equal(result.usage.inputTokens, 150);
      assert.equal(result.usage.outputTokens, 75);
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.MOONSHOT_API_KEY = origEnv;
      else delete process.env.MOONSHOT_API_KEY;
    }
  });

  await t.test('LM Studio maps prompt_tokens/completion_tokens to inputTokens/outputTokens', async () => {
    mockHttpRequest(200, {
      choices: [{ message: { content: 'test' } }],
      model: 'qwen2.5-vl',
      usage: { prompt_tokens: 300, completion_tokens: 50 },
    });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio', model: 'qwen2.5-vl' });
      assert.equal(result.usage.inputTokens, 300);
      assert.equal(result.usage.outputTokens, 50);
      assert.equal(result.usage.model, 'qwen2.5-vl');
    } finally {
      clearAllMocks();
    }
  });

  await t.test('no usage field returns null', async () => {
    mockHttpRequest(200, {
      choices: [{ message: { content: 'test' } }],
    });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio', model: 'test' });
      assert.equal(result.usage, null);
    } finally {
      clearAllMocks();
    }
  });

  fs.readFileSync = origRead;
});

// ═══════════════════════════════════════════════════════════════════════════
// F. checkProviderAvailability — deep edge cases
// ═══════════════════════════════════════════════════════════════════════════

test('checkProviderAvailability edge cases', async (t) => {
  await t.test('LM Studio no model loaded → available false', async () => {
    mockHttpRequest(200, JSON.stringify({ data: [] }));
    try {
      const result = await checkProviderAvailability();
      assert.equal(result['lm-studio'].available, false);
      assert.match(result['lm-studio'].reason, /[Nn]o model/);
    } finally {
      clearAllMocks();
    }
  });

  await t.test('LM Studio unreachable → available false with reason', async () => {
    const origPatch = http.get;
    http.get = function errorSimulation() {
      const req = new EventEmitter();
      req.end = () => {};
      process.nextTick(() => req.emit('error', new Error('ECONNREFUSED')));
      return req;
    };
    try {
      const origRead = fs.readFileSync;
      fs.readFileSync = function mockRead(f) {
        if (f === KEYS_FILE) throw new Error('ENOENT');
        return origRead.apply(this, arguments);
      };
      const origEnvs = {
        ant: process.env.ANTHROPIC_API_KEY,
        oai: process.env.OPENAI_API_KEY,
        kimi: process.env.MOONSHOT_API_KEY,
      };
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.MOONSHOT_API_KEY;

      const result = await checkProviderAvailability();
      assert.equal(result['lm-studio'].available, false);
      assert.match(result['lm-studio'].reason, /[Cc]annot reach/);

      // Restore
      fs.readFileSync = origRead;
      if (origEnvs.ant !== undefined) process.env.ANTHROPIC_API_KEY = origEnvs.ant;
      if (origEnvs.oai !== undefined) process.env.OPENAI_API_KEY = origEnvs.oai;
      if (origEnvs.kimi !== undefined) process.env.MOONSHOT_API_KEY = origEnvs.kimi;
    } finally {
      http.get = origPatch;
    }
  });

  await t.test('mix of available and unavailable providers', async () => {
    const origRead = fs.readFileSync;
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) return JSON.stringify({ anthropic: 'sk-ant-123' });
      return origRead.apply(this, arguments);
    };
    const origEnvs = {
      ant: process.env.ANTHROPIC_API_KEY,
      oai: process.env.OPENAI_API_KEY,
      kimi: process.env.MOONSHOT_API_KEY,
    };
    delete process.env.OPENAI_API_KEY;
    delete process.env.MOONSHOT_API_KEY;

    mockHttpRequest(200, JSON.stringify({ data: [{ id: 'test-model' }] }));
    try {
      const result = await checkProviderAvailability();
      assert.equal(result['lm-studio'].available, true);
      assert.equal(result.anthropic.available, true);
      assert.equal(result.openai.available, false);
      assert.equal(result.kimi.available, false);
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnvs.ant !== undefined) process.env.ANTHROPIC_API_KEY = origEnvs.ant;
      if (origEnvs.oai !== undefined) process.env.OPENAI_API_KEY = origEnvs.oai;
      if (origEnvs.kimi !== undefined) process.env.MOONSHOT_API_KEY = origEnvs.kimi;
    }
  });

  await t.test('LM Studio returns invalid JSON → available false', async () => {
    mockHttpRequest(200, 'not json');
    try {
      const origRead = fs.readFileSync;
      fs.readFileSync = function mockRead(f) {
        if (f === KEYS_FILE) throw new Error('ENOENT');
        return origRead.apply(this, arguments);
      };
      const origEnvs = {
        ant: process.env.ANTHROPIC_API_KEY,
        oai: process.env.OPENAI_API_KEY,
        kimi: process.env.MOONSHOT_API_KEY,
      };
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.MOONSHOT_API_KEY;

      const result = await checkProviderAvailability();
      assert.equal(result['lm-studio'].available, false);
      assert.match(result['lm-studio'].reason, /[Ii]nvalid/);

      fs.readFileSync = origRead;
      if (origEnvs.ant !== undefined) process.env.ANTHROPIC_API_KEY = origEnvs.ant;
      if (origEnvs.oai !== undefined) process.env.OPENAI_API_KEY = origEnvs.oai;
      if (origEnvs.kimi !== undefined) process.env.MOONSHOT_API_KEY = origEnvs.kimi;
    } finally {
      clearAllMocks();
    }
  });

  await t.test('whitespace-only key means not available', async () => {
    const origRead = fs.readFileSync;
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) return JSON.stringify({ anthropic: '   ' });
      return origRead.apply(this, arguments);
    };
    const origEnv = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    mockHttpRequest(200, JSON.stringify({ data: [{ id: 'model' }] }));
    try {
      const result = await checkProviderAvailability();
      // '   '.trim() is '', which is falsy
      assert.equal(result.anthropic.available, false);
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// G. Concurrent parseImage calls don't interfere
// ═══════════════════════════════════════════════════════════════════════════

test('Concurrent parseImage calls return independent results', async () => {
  // Make two concurrent calls to different providers (both via lm-studio for simplicity)
  let callCount = 0;
  const origPatch = http.request;

  http.request = function concurrentSimulation(options, callback) {
    const thisCall = ++callCount;
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
              choices: [{ message: { content: `result-${thisCall}` } }],
              usage: { prompt_tokens: thisCall * 10, completion_tokens: thisCall * 5 },
            }));
            res.emit('end');
          });
        });
      }
    };
    req.destroy = () => {};
    return req;
  };

  try {
    const [r1, r2] = await Promise.all([
      parseImage(TINY_PNG_BASE64, { provider: 'lm-studio', model: 'model-a' }),
      parseImage(TINY_PNG_BASE64, { provider: 'lm-studio', model: 'model-b' }),
    ]);

    // Each call should get its own result
    assert.ok(r1.text.startsWith('result-'));
    assert.ok(r2.text.startsWith('result-'));
    assert.notEqual(r1.text, r2.text);
  } finally {
    http.request = origPatch;
    callCount = 0;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// H. Challenger Gap #1 — Multi-chunk HTTP response reconstruction
// ═══════════════════════════════════════════════════════════════════════════

test('Multi-chunk HTTP response is correctly reconstructed', async (t) => {
  await t.test('LM Studio response split across multiple data chunks', async () => {
    const origPatch = http.request;
    http.request = function multiChunkSimulation(options, callback) {
      const req = new EventEmitter();
      req.write = () => {};
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = 200;
        if (typeof callback === 'function') {
          process.nextTick(() => {
            callback(res);
            // Send response as 3 separate chunks
            const fullJson = JSON.stringify({
              choices: [{ message: { content: 'COID/MID: 999\nCASE: CS-MULTI' } }],
              usage: { prompt_tokens: 50, completion_tokens: 25 },
            });
            const chunk1 = fullJson.slice(0, 30);
            const chunk2 = fullJson.slice(30, 80);
            const chunk3 = fullJson.slice(80);
            process.nextTick(() => {
              res.emit('data', chunk1);
              res.emit('data', chunk2);
              res.emit('data', chunk3);
              res.emit('end');
            });
          });
        }
      };
      req.destroy = () => {};
      return req;
    };

    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio', model: 'test' });
      assert.equal(result.text, 'COID/MID: 999\nCASE: CS-MULTI');
      assert.equal(result.role, 'escalation');
      assert.equal(result.usage.inputTokens, 50);
      assert.equal(result.usage.outputTokens, 25);
    } finally {
      http.request = origPatch;
    }
  });

  await t.test('Anthropic response split across multiple data chunks', async () => {
    const origEnv = process.env.ANTHROPIC_API_KEY;
    const origRead = fs.readFileSync;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-multi';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };

    const origPatch = https.request;
    https.request = function multiChunkHttps(options, callback) {
      const req = new EventEmitter();
      req.write = () => {};
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = 200;
        if (typeof callback === 'function') {
          process.nextTick(() => {
            callback(res);
            const fullJson = JSON.stringify({
              content: [{ type: 'text', text: 'INV-123456 multi chunk test' }],
              model: 'claude-sonnet-4-20250514',
              usage: { input_tokens: 30, output_tokens: 15 },
            });
            // Split into 4 chunks
            const chunkSize = Math.ceil(fullJson.length / 4);
            process.nextTick(() => {
              for (let i = 0; i < fullJson.length; i += chunkSize) {
                res.emit('data', fullJson.slice(i, i + chunkSize));
              }
              res.emit('end');
            });
          });
        }
      };
      req.destroy = () => {};
      return req;
    };

    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });
      assert.equal(result.text, 'INV-123456 multi chunk test');
      assert.equal(result.role, 'inv-list');
    } finally {
      https.request = origPatch;
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// H. Challenger Gap #2 — normalizeBase64 with embedded newlines
// ═══════════════════════════════════════════════════════════════════════════

test('normalizeBase64 with embedded newlines in base64', async (t) => {
  await t.test('raw base64 with embedded newlines preserves them (no stripping)', () => {
    // base64 data may contain embedded newlines from copy-paste
    const withNewlines = 'AAAA\nBBBB\nCCCC';
    const result = normalizeBase64(withNewlines);
    assert.ok(result);
    // normalizeBase64 only trims outer whitespace, internal newlines preserved
    assert.equal(result.rawBase64, 'AAAA\nBBBB\nCCCC');
  });

  await t.test('data URI with embedded newlines in base64 portion — regex does not match across newlines', () => {
    const dataUri = 'data:image/png;base64,AAAA\nBBBB';
    const result = normalizeBase64(dataUri);
    assert.ok(result);
    // The regex (.+)$ does NOT match across newlines, so the match fails.
    // Since the input starts with 'data:image/' the dataUrl path preserves it as-is,
    // but rawBase64 keeps the full string (no prefix stripping occurred).
    assert.equal(result.rawBase64, 'data:image/png;base64,AAAA\nBBBB');
    // mediaType defaults to 'image/png' since the regex match failed
    assert.equal(result.mediaType, 'image/png');
  });

  await t.test('base64 with carriage return and newline', () => {
    const withCRLF = 'AAAA\r\nBBBB';
    const result = normalizeBase64(withCRLF);
    assert.ok(result);
    assert.equal(result.rawBase64, 'AAAA\r\nBBBB');
  });

  await t.test('base64 with tab characters', () => {
    const withTabs = 'AAAA\tBBBB';
    const result = normalizeBase64(withTabs);
    assert.ok(result);
    assert.equal(result.rawBase64, 'AAAA\tBBBB');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// H. Challenger Gap #3 — HTTP 200 with HTML error page (non-JSON body)
// Already partially covered but adding explicit HTML page tests
// ═══════════════════════════════════════════════════════════════════════════

test('HTTP 200 with HTML error page body for each provider', async (t) => {
  const HTML_ERROR = '<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>';
  const origRead = fs.readFileSync;

  await t.test('LM Studio 200 + HTML → PROVIDER_ERROR with invalid JSON message', async () => {
    mockHttpRequest(200, HTML_ERROR);
    try {
      await assert.rejects(
        () => parseImage(TINY_PNG_BASE64, { provider: 'lm-studio', model: 'test' }),
        (err) => {
          assert.equal(err.code, 'PROVIDER_ERROR');
          assert.match(err.message, /invalid JSON/i);
          return true;
        }
      );
    } finally {
      clearAllMocks();
    }
  });

  await t.test('OpenAI 200 + HTML → PROVIDER_ERROR with invalid JSON message', async () => {
    const origEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, HTML_ERROR);
    try {
      await assert.rejects(
        () => parseImage(TINY_PNG_BASE64, { provider: 'openai' }),
        (err) => {
          assert.equal(err.code, 'PROVIDER_ERROR');
          assert.match(err.message, /invalid JSON/i);
          return true;
        }
      );
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.OPENAI_API_KEY = origEnv;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  await t.test('Anthropic 200 + HTML → PROVIDER_ERROR with invalid JSON message', async () => {
    const origEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, HTML_ERROR);
    try {
      await assert.rejects(
        () => parseImage(TINY_PNG_BASE64, { provider: 'anthropic' }),
        (err) => {
          assert.equal(err.code, 'PROVIDER_ERROR');
          assert.match(err.message, /invalid JSON/i);
          return true;
        }
      );
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  await t.test('Kimi 200 + HTML → PROVIDER_ERROR with invalid JSON message', async () => {
    const origEnv = process.env.MOONSHOT_API_KEY;
    process.env.MOONSHOT_API_KEY = 'mk-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, HTML_ERROR);
    try {
      await assert.rejects(
        () => parseImage(TINY_PNG_BASE64, { provider: 'kimi' }),
        (err) => {
          assert.equal(err.code, 'PROVIDER_ERROR');
          assert.match(err.message, /invalid JSON/i);
          return true;
        }
      );
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.MOONSHOT_API_KEY = origEnv;
      else delete process.env.MOONSHOT_API_KEY;
    }
  });

  fs.readFileSync = origRead;
});

// ═══════════════════════════════════════════════════════════════════════════
// H. Challenger Gap #4 — Empty/missing choices array behavior
// ═══════════════════════════════════════════════════════════════════════════

test('Empty or missing choices/content array returns empty text', async (t) => {
  const origRead = fs.readFileSync;

  await t.test('LM Studio: choices is empty array → empty text, unknown role', async () => {
    mockHttpRequest(200, {
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 0 },
    });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio', model: 'test' });
      assert.equal(result.text, '');
      assert.equal(result.role, 'unknown');
    } finally {
      clearAllMocks();
    }
  });

  await t.test('LM Studio: choices missing entirely → empty text', async () => {
    mockHttpRequest(200, { model: 'test', usage: { prompt_tokens: 5, completion_tokens: 0 } });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio', model: 'test' });
      assert.equal(result.text, '');
      assert.equal(result.role, 'unknown');
    } finally {
      clearAllMocks();
    }
  });

  await t.test('LM Studio: choices[0].message is null → empty text', async () => {
    mockHttpRequest(200, {
      choices: [{ message: null }],
      usage: { prompt_tokens: 5, completion_tokens: 0 },
    });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'lm-studio', model: 'test' });
      assert.equal(result.text, '');
    } finally {
      clearAllMocks();
    }
  });

  await t.test('OpenAI: choices is null → empty text', async () => {
    const origEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, { choices: null, model: 'gpt-4o' });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'openai' });
      assert.equal(result.text, '');
      assert.equal(result.role, 'unknown');
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.OPENAI_API_KEY = origEnv;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  await t.test('Anthropic: content is empty array → empty text', async () => {
    const origEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, { content: [], model: 'claude-sonnet-4-20250514' });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });
      assert.equal(result.text, '');
      assert.equal(result.role, 'unknown');
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  await t.test('Anthropic: content missing entirely → empty text', async () => {
    const origEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, { id: 'msg_123', model: 'claude-sonnet-4-20250514' });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });
      assert.equal(result.text, '');
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  await t.test('Kimi: choices[0].message.content is null → empty text', async () => {
    const origEnv = process.env.MOONSHOT_API_KEY;
    process.env.MOONSHOT_API_KEY = 'mk-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, {
      choices: [{ message: { content: null } }],
      usage: { prompt_tokens: 5, completion_tokens: 0 },
    });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'kimi' });
      assert.equal(result.text, '');
      assert.equal(result.role, 'unknown');
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.MOONSHOT_API_KEY = origEnv;
      else delete process.env.MOONSHOT_API_KEY;
    }
  });

  fs.readFileSync = origRead;
});

// ═══════════════════════════════════════════════════════════════════════════
// H. Challenger Gap #5 — INV-12345 boundary case (exactly 5 digits)
// ═══════════════════════════════════════════════════════════════════════════

test('detectRole INV boundary cases', async (t) => {
  await t.test('INV-12345 (exactly 5 digits) IS matched as inv-list', () => {
    assert.equal(detectRole('INV-12345 Some issue description'), 'inv-list');
  });

  await t.test('INV-1234 (4 digits) is NOT matched', () => {
    assert.equal(detectRole('INV-1234 Some issue'), 'unknown');
  });

  await t.test('INV-123456 (6 digits) IS matched', () => {
    assert.equal(detectRole('INV-123456 Some issue'), 'inv-list');
  });

  await t.test('INV-1234567 (7 digits) IS matched', () => {
    assert.equal(detectRole('INV-1234567 Some issue'), 'inv-list');
  });

  await t.test('INV-00001 (5 digits with leading zeros) IS matched', () => {
    assert.equal(detectRole('INV-00001 edge case'), 'inv-list');
  });

  await t.test('INV-99999 (max 5-digit) IS matched', () => {
    assert.equal(detectRole('INV-99999 boundary'), 'inv-list');
  });

  await t.test('Multiple INV entries with 5-digit numbers', () => {
    assert.equal(detectRole('Monday:\n- INV-10001 Issue A\n- INV-20002 Issue B'), 'inv-list');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// H. Challenger Gap #6 — Anthropic response format parsing with mocked HTTPS
// ═══════════════════════════════════════════════════════════════════════════

test('Anthropic full response parsing with HTTPS mock', async (t) => {
  const origRead = fs.readFileSync;

  await t.test('standard Anthropic response → correct text, role, usage', async () => {
    const origEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-parse-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, {
      id: 'msg_abc123',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'COID/MID: 555 / 666\nCASE: CS-2026-999\nCLIENT/CONTACT: Test User' }],
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 500, output_tokens: 100 },
    });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });
      assert.equal(result.text, 'COID/MID: 555 / 666\nCASE: CS-2026-999\nCLIENT/CONTACT: Test User');
      assert.equal(result.role, 'escalation');
      assert.ok(result.usage);
      assert.equal(result.usage.inputTokens, 500);
      assert.equal(result.usage.outputTokens, 100);
      assert.equal(result.usage.model, 'claude-sonnet-4-20250514');
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  await t.test('Anthropic response with multiple content blocks → uses first text block', async () => {
    const origEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-multi';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, {
      content: [
        { type: 'text', text: 'First block text' },
        { type: 'text', text: 'Second block text' },
      ],
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });
      // parsed.content?.[0]?.text gets the FIRST content block
      assert.equal(result.text, 'First block text');
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  await t.test('Anthropic INV list detection works through HTTPS', async () => {
    const origEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-inv';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, {
      content: [{ type: 'text', text: 'Friday:\n- INV-123456 Payroll sync\n- INV-789012 Bank feed' }],
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 20, output_tokens: 10 },
    });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });
      assert.equal(result.role, 'inv-list');
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.ANTHROPIC_API_KEY = origEnv;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  fs.readFileSync = origRead;
});

// ═══════════════════════════════════════════════════════════════════════════
// H. Challenger Gap #7 — OpenAI response format parsing with mocked HTTPS
// ═══════════════════════════════════════════════════════════════════════════

test('OpenAI full response parsing with HTTPS mock', async (t) => {
  const origRead = fs.readFileSync;

  await t.test('standard OpenAI response → correct text, role, usage', async () => {
    const origEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-oai-parse-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, {
      id: 'chatcmpl-abc123',
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'COID/MID: 111 / 222\nCASE: CS-2026-TEST' },
        finish_reason: 'stop',
      }],
      model: 'gpt-4o-2024-08-06',
      usage: { prompt_tokens: 400, completion_tokens: 80, total_tokens: 480 },
    });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'openai' });
      assert.equal(result.text, 'COID/MID: 111 / 222\nCASE: CS-2026-TEST');
      assert.equal(result.role, 'escalation');
      assert.ok(result.usage);
      assert.equal(result.usage.inputTokens, 400);
      assert.equal(result.usage.outputTokens, 80);
      assert.equal(result.usage.model, 'gpt-4o-2024-08-06');
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.OPENAI_API_KEY = origEnv;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  await t.test('OpenAI response trims whitespace from content', async () => {
    const origEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-oai-trim';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, {
      choices: [{ message: { content: '  \nCASE: CS-TRIMMED\n  ' } }],
      usage: { prompt_tokens: 5, completion_tokens: 5 },
    });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'openai' });
      assert.equal(result.text, 'CASE: CS-TRIMMED');
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.OPENAI_API_KEY = origEnv;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  await t.test('OpenAI INV list detection works through HTTPS', async () => {
    const origEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-oai-inv';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    mockHttpsRequest(200, {
      choices: [{ message: { content: 'Today:\n- INV-555555 Login issue\n- INV-666666 Payroll' } }],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    });
    try {
      const result = await parseImage(TINY_PNG_BASE64, { provider: 'openai' });
      assert.equal(result.role, 'inv-list');
    } finally {
      clearAllMocks();
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.OPENAI_API_KEY = origEnv;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  fs.readFileSync = origRead;
});

// ═══════════════════════════════════════════════════════════════════════════
// H. Challenger Gap #8 — req.destroy() called on timeout
// ═══════════════════════════════════════════════════════════════════════════

test('req.destroy() is called when timeout fires', async (t) => {
  await t.test('LM Studio: destroy called on timeout', async () => {
    let destroyCalled = false;
    const origPatch = http.request;
    http.request = function timeoutDestroyCheck(options, callback) {
      const req = new EventEmitter();
      req.write = () => {};
      req.end = () => { process.nextTick(() => req.emit('timeout')); };
      req.destroy = () => { destroyCalled = true; };
      return req;
    };
    try {
      await assert.rejects(
        () => parseImage(TINY_PNG_BASE64, { provider: 'lm-studio', model: 'test', timeoutMs: 100 }),
        (err) => { assert.equal(err.code, 'TIMEOUT'); return true; }
      );
      assert.equal(destroyCalled, true, 'req.destroy() must be called when timeout fires');
    } finally {
      http.request = origPatch;
    }
  });

  await t.test('OpenAI (HTTPS): destroy called on timeout', async () => {
    const origEnv = process.env.OPENAI_API_KEY;
    const origRead = fs.readFileSync;
    process.env.OPENAI_API_KEY = 'sk-test';
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };

    let destroyCalled = false;
    const origPatch = https.request;
    https.request = function timeoutDestroyCheck(options, callback) {
      const req = new EventEmitter();
      req.write = () => {};
      req.end = () => { process.nextTick(() => req.emit('timeout')); };
      req.destroy = () => { destroyCalled = true; };
      return req;
    };
    try {
      await assert.rejects(
        () => parseImage(TINY_PNG_BASE64, { provider: 'openai', timeoutMs: 100 }),
        (err) => { assert.equal(err.code, 'TIMEOUT'); return true; }
      );
      assert.equal(destroyCalled, true, 'req.destroy() must be called on HTTPS timeout');
    } finally {
      https.request = origPatch;
      fs.readFileSync = origRead;
      if (origEnv !== undefined) process.env.OPENAI_API_KEY = origEnv;
      else delete process.env.OPENAI_API_KEY;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// H. Challenger Gap #9 — LM Studio availability check timeout → available: false
// ═══════════════════════════════════════════════════════════════════════════

test('checkProviderAvailability LM Studio timeout', async (t) => {
  await t.test('LM Studio 3s timeout → available: false with timeout reason', async () => {
    let destroyCalled = false;
    const origPatch = http.get;
    http.get = function timeoutSimulation(url, options, callback) {
      const req = new EventEmitter();
      req.end = () => {};
      req.destroy = () => { destroyCalled = true; };
      // Simulate timeout
      process.nextTick(() => req.emit('timeout'));
      return req;
    };

    const origRead = fs.readFileSync;
    fs.readFileSync = function mockRead(f) {
      if (f === KEYS_FILE) throw new Error('ENOENT');
      return origRead.apply(this, arguments);
    };
    const origEnvs = {
      ant: process.env.ANTHROPIC_API_KEY,
      oai: process.env.OPENAI_API_KEY,
      kimi: process.env.MOONSHOT_API_KEY,
    };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.MOONSHOT_API_KEY;

    try {
      const result = await checkProviderAvailability();
      assert.equal(result['lm-studio'].available, false);
      assert.match(result['lm-studio'].reason, /timed out/i);
      assert.equal(result['lm-studio'].model, null);
      assert.equal(destroyCalled, true, 'req.destroy() must be called on availability timeout');
    } finally {
      http.get = origPatch;
      fs.readFileSync = origRead;
      if (origEnvs.ant !== undefined) process.env.ANTHROPIC_API_KEY = origEnvs.ant;
      if (origEnvs.oai !== undefined) process.env.OPENAI_API_KEY = origEnvs.oai;
      if (origEnvs.kimi !== undefined) process.env.MOONSHOT_API_KEY = origEnvs.kimi;
    }
  });
});

// ---------------------------------------------------------------------------
// Restore all mocks on teardown
// ---------------------------------------------------------------------------
test.after(() => {
  http.request = _origHttpRequest;
  http.get = _origHttpGet;
  https.request = _origHttpsRequest;
  fs.readFileSync = _origReadFileSync;
});
