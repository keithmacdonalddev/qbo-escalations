'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const mongo = require('./_mongo-helper');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const {
  __waitForProviderPackageRecorderSettled,
} = require('../src/services/provider-call-package-recorder');
const {
  sendAnthropicMessages,
} = require('../src/services/providers/anthropic-provider-harness');
const {
  parseImage,
} = require('../src/services/image-parser');

const STARTER_IMAGE = 'data:image/png;base64,QUJD';
const PARSE_TEXT = [
  'COID/MID: 987654/321098',
  'COMPANY NAME: Acme Co',
  'QBO CAN: 123456',
  'CBID: 7890',
  'CASE NUMBER: CS-12345',
  'ISSUE: payroll sync failure',
  'WHAT IS THE CUSTOMER TRYING TO ACCOMPLISH? run payroll',
  'WHAT ERROR IS THE CUSTOMER ENCOUNTERING? sync failed',
  'WHAT TROUBLESHOOTING STEPS HAVE BEEN TAKEN? cleared cache',
  'WHAT IS THE NEXT STEP? retry sync',
  'EXPECTED OUTCOME: payroll sync completes',
  'TEAM: payroll',
  'TAGS: payroll, sync',
  'TRIED TEST ACCOUNT: no',
  'TS STEPS: cleared cache',
].join('\n');

function anthropicResponse(overrides = {}) {
  return {
    id: overrides.id || 'msg_anthropic_test',
    type: 'message',
    role: 'assistant',
    model: overrides.model || 'claude-sonnet-4-20250514',
    content: [{ type: 'text', text: overrides.text || PARSE_TEXT }],
    usage: {
      input_tokens: overrides.inputTokens || 42,
      output_tokens: overrides.outputTokens || 17,
    },
  };
}

function makeRequestBody(model = 'claude-sonnet-4-20250514') {
  return {
    model,
    max_tokens: 4096,
    system: 'Parse the image.',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
        { type: 'text', text: 'Parse this image.' },
      ],
    }],
  };
}

function makeCaptureContext(overrides = {}) {
  return {
    callSite: 'test:anthropic',
    operation: 'image-parse',
    functionName: 'testAnthropic',
    forceCapture: true,
    modelRequested: 'claude-sonnet-4-20250514',
    ...overrides,
  };
}

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
      });
    });
  });
}

async function withAnthropicServer(handler, fn) {
  const priorUrl = process.env.ANTHROPIC_API_URL;
  const server = await startServer(handler);
  process.env.ANTHROPIC_API_URL = server.baseUrl;
  try {
    return await fn(server);
  } finally {
    if (priorUrl === undefined) delete process.env.ANTHROPIC_API_URL;
    else process.env.ANTHROPIC_API_URL = priorUrl;
    await server.close();
  }
}

async function callHarness(options = {}) {
  return sendAnthropicMessages({
    body: makeRequestBody(options.model),
    model: options.model || 'claude-sonnet-4-20250514',
    timeoutMs: options.timeoutMs || 500,
    getApiKey: () => 'sk-ant-test',
    captureContext: makeCaptureContext(options.captureContext),
    onProviderEvent: options.onProviderEvent,
  });
}

test.before(async () => {
  await mongo.connect();
});

test.after(async () => {
  await mongo.disconnect();
});

test.beforeEach(async () => {
  await ProviderCallPackage.deleteMany({});
  delete process.env.ANTHROPIC_API_URL;
  delete process.env.ANTHROPIC_API_KEY;
});

test.afterEach(async () => {
  await __waitForProviderPackageRecorderSettled();
  await ProviderCallPackage.deleteMany({}).catch(() => {});
  delete process.env.ANTHROPIC_API_URL;
  delete process.env.ANTHROPIC_API_KEY;
});

test('Anthropic harness saves provider package before success handoff', async () => {
  const events = [];
  await withAnthropicServer((req, res) => {
    assert.equal(req.url, '/v1/messages');
    assert.equal(req.headers['x-api-key'], 'sk-ant-test');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(anthropicResponse()));
  }, async () => {
    const result = await callHarness({
      onProviderEvent: (type, payload) => events.push({ type, payload }),
    });

    assert.equal(result.providerTrace.outcome, 'success');
    assert.equal(result.providerTrace.packageCaptureStatus, 'saved');
    assert.ok(result.providerTrace.providerPackageId);
    assert.ok(events.some((event) => event.type === 'provider.package_capture_confirmed'));

    const saved = await ProviderCallPackage.findById(result.providerTrace.providerPackageId).lean();
    assert.equal(saved.providerId, 'anthropic');
    assert.equal(saved.providerResearchId, 'anthropic-api');
    assert.equal(saved.outcome, 'success');
    assert.equal(saved.request.headers['x-api-key'], '[REDACTED]');
    assert.equal(saved.response.parsedJson.content[0].text, PARSE_TEXT);
  });
});

test('Anthropic harness surfaces HTTP errors after package capture', async () => {
  await withAnthropicServer((req, res) => {
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } }));
  }, async () => {
    await assert.rejects(
      () => callHarness(),
      (err) => {
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.equal(err.statusCode, 429);
        assert.equal(err.providerTrace.outcome, 'http_error');
        assert.equal(err.providerTrace.packageCaptureStatus, 'saved');
        assert.ok(err.providerTrace.providerPackageId);
        return true;
      }
    );

    const saved = await ProviderCallPackage.findOne({ providerId: 'anthropic' }).lean();
    assert.equal(saved.outcome, 'http_error');
    assert.equal(saved.response.statusCode, 429);
  });
});

test('Anthropic harness surfaces invalid JSON after package capture', async () => {
  await withAnthropicServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('not-json');
  }, async () => {
    await assert.rejects(
      () => callHarness(),
      (err) => {
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.equal(err.providerTrace.outcome, 'invalid_json');
        assert.equal(err.providerTrace.packageCaptureStatus, 'saved');
        return true;
      }
    );

    const saved = await ProviderCallPackage.findOne({ providerId: 'anthropic' }).lean();
    assert.equal(saved.outcome, 'invalid_json');
    assert.equal(saved.response.bodyText, 'not-json');
    assert.match(saved.response.jsonParseError.message, /Unexpected token/);
  });
});

test('Anthropic harness surfaces timeout after package capture', async () => {
  await withAnthropicServer((req, res) => {
    setTimeout(() => {
      if (!res.destroyed) res.end(JSON.stringify(anthropicResponse()));
    }, 250);
  }, async () => {
    await assert.rejects(
      () => callHarness({ timeoutMs: 25 }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_TIMEOUT');
        assert.equal(err.providerTrace.outcome, 'timeout');
        assert.equal(err.providerTrace.packageCaptureStatus, 'saved');
        return true;
      }
    );

    const saved = await ProviderCallPackage.findOne({ providerId: 'anthropic' }).lean();
    assert.equal(saved.outcome, 'timeout');
    assert.equal(saved.response.received, false);
  });
});

test('Anthropic harness surfaces network errors after package capture', async () => {
  const server = await startServer((req, res) => res.end('{}'));
  const baseUrl = server.baseUrl;
  await server.close();
  process.env.ANTHROPIC_API_URL = baseUrl;

  await assert.rejects(
    () => callHarness({ timeoutMs: 100 }),
    (err) => {
      assert.equal(err.providerTrace.outcome, 'network_error');
      assert.equal(err.providerTrace.packageCaptureStatus, 'saved');
      assert.ok(err.providerTrace.providerPackageId);
      return true;
    }
  );

  const saved = await ProviderCallPackage.findOne({ providerId: 'anthropic' }).lean();
  assert.equal(saved.outcome, 'network_error');
  assert.equal(saved.response.received, false);
});

test('Anthropic harness blocks handoff when provider package capture fails', async () => {
  const originalCreate = ProviderCallPackage.create;
  ProviderCallPackage.create = async function failingCreate() {
    throw new Error('anthropic mongo insert failed');
  };

  try {
    await withAnthropicServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(anthropicResponse()));
    }, async () => {
      await assert.rejects(
        () => callHarness(),
        (err) => {
          assert.equal(err.code, 'PROVIDER_PACKAGE_CAPTURE_FAILED');
          assert.equal(err.providerTrace.outcome, 'package_capture_failed');
          assert.equal(err.providerTrace.packageCaptureStatus, 'failed');
          assert.match(err.message, /failed to save to MongoDB/);
          return true;
        }
      );
    });
  } finally {
    ProviderCallPackage.create = originalCreate;
  }
});

test('parseImage Anthropic direct path extracts only after captured package is readable', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-parse-test';

  await withAnthropicServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(anthropicResponse()));
  }, async () => {
    const result = await parseImage(STARTER_IMAGE, {
      provider: 'anthropic',
      structured: false,
      timeoutMs: 500,
    });

    assert.equal(result.text, PARSE_TEXT);
    assert.equal(result.usage.inputTokens, 42);
    assert.equal(result.usage.outputTokens, 17);
    assert.equal(result.providerTrace.outcome, 'success');
    assert.equal(result.providerTrace.packageCaptureStatus, 'saved');
    assert.equal(result.providerTrace.providerPayload.sourcePath, 'response.parsedJson.content[0].text');

    const saved = await ProviderCallPackage.findById(result.providerTrace.providerPackageId).lean();
    assert.ok(saved, 'provider package must be readable before parseImage extracts provider content');
  });
});
