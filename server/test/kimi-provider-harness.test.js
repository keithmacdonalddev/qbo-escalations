'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const mongo = require('./_mongo-helper');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const {
  __waitForProviderPackageRecorderSettled,
} = require('../src/services/provider-call-package-recorder');

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function loadImageParserFresh() {
  delete require.cache[require.resolve('../src/services/providers/kimi-api-provider-harness')];
  delete require.cache[require.resolve('../src/services/image-parser')];
  return require('../src/services/image-parser');
}

function createEventBus() {
  const events = [];
  return {
    events,
    eventBus: {
      emit(type, payload) {
        events.push({ type, payload });
      },
    },
  };
}

function kimiResponse(overrides = {}) {
  return {
    id: overrides.id || 'chatcmpl-kimi-test',
    object: 'chat.completion',
    model: overrides.model || 'kimi-k2.6',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: overrides.content || 'COID/MID: 123\nCompany Name: Test Co\nIssue: Kimi package handoff verified',
        },
        finish_reason: 'stop',
      },
    ],
    usage: overrides.usage || {
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18,
    },
  };
}

async function startProviderServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      requests.push({ req, body });
      handler({ req, res, body });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    requests,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function parseWithServer(server, options = {}) {
  process.env.MOONSHOT_API_KEY = 'mk-test-kimi-key';
  process.env.KIMI_API_URL = server.baseUrl;
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  process.env.IMAGE_PARSER_PROVIDER_PACKAGE_WAIT_MS = '2000';
  const { parseImage } = loadImageParserFresh();
  return parseImage(TINY_PNG_BASE64, {
    provider: 'kimi',
    timeoutMs: 300,
    ...options,
  });
}

async function captureReject(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new assert.AssertionError({
    message: 'Expected function to reject',
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
});

test.afterEach(async () => {
  await __waitForProviderPackageRecorderSettled();
  await ProviderCallPackage.deleteMany({}).catch(() => {});
  delete process.env.MOONSHOT_API_KEY;
  delete process.env.KIMI_API_URL;
  delete process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
  delete process.env.IMAGE_PARSER_PROVIDER_PACKAGE_WAIT_MS;
});

test('Kimi image-parser path captures Mongo package before parser extraction', async () => {
  const { events, eventBus } = createEventBus();
  const server = await startProviderServer(({ res }) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(kimiResponse({ model: 'moonshot-v1-8k' })));
  });

  try {
    const result = await parseWithServer(server, {
      model: 'moonshot-v1-8k',
      eventBus,
    });

    assert.match(result.text, /Kimi package handoff verified/);
    assert.equal(result.usage.model, 'moonshot-v1-8k');
    assert.equal(result.usage.inputTokens, 11);
    assert.equal(result.usage.outputTokens, 7);
    assert.equal(result.providerTrace.providerHarness, 'kimi-api');
    assert.equal(result.providerTrace.outcome, 'success');
    assert.equal(result.providerTrace.packageCaptureStatus, 'saved');
    assert.equal(result.providerTrace.providerPayload.sourcePath, 'response.parsedJson.choices[0].message.content');

    const saved = await ProviderCallPackage.findById(result.providerTrace.providerPackageId).lean();
    assert.equal(saved.providerId, 'kimi');
    assert.equal(saved.providerResearchId, 'kimi-api');
    assert.equal(saved.outcome, 'success');
    assert.equal(saved.request.bodyJson.model, 'moonshot-v1-8k');
    assert.equal(saved.request.bodyJson.temperature, 1);
    assert.deepEqual(saved.request.bodyJson.thinking, { type: 'disabled' });
    assert.equal(saved.request.headers.Authorization, 'Bearer [REDACTED]');
    assert.equal(saved.response.parsedJson.usage.prompt_tokens, 11);

    const requestBody = JSON.parse(server.requests[0].body);
    assert.equal(requestBody.temperature, 1);
    assert.deepEqual(requestBody.thinking, { type: 'disabled' });
    assert.equal(server.requests[0].req.headers.authorization, 'Bearer mk-test-kimi-key');
    assert.ok(events.some((event) => event.type === 'provider.package_capture_confirmed'));
    assert.ok(events.some((event) => event.type === 'parser.provider_payload_selected'));
  } finally {
    await server.close();
  }
});

test('Kimi image-parser path ignores reasoning_content as parser output', async () => {
  const server = await startProviderServer(({ res }) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ...kimiResponse({
        content: '',
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        id: 'chatcmpl-kimi-reasoning-only',
        model: 'kimi-k2.6',
      }),
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: '',
          reasoning_content: 'internal reasoning that must not become parser output',
        },
        finish_reason: 'length',
      }],
    }));
  });

  try {
    const result = await parseWithServer(server);
    assert.equal(result.text, '');
    assert.equal(result.providerTrace.providerPayload.sourcePath, 'response.parsedJson.choices[0].message.content');
    assert.equal(result.providerTrace.providerPayload.usedReasoningContent, false);
    assert.equal(result.providerTrace.providerPayload.reasoningContentPresent, true);
  } finally {
    await server.close();
  }
});
test('Kimi HTTP errors save package and surface http_error trace', async () => {
  const server = await startProviderServer(({ res }) => {
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'rate limited' } }));
  });

  try {
    const err = await captureReject(() => parseWithServer(server));
    assert.equal(err.code, 'PROVIDER_ERROR');
    assert.equal(err.statusCode, 429);
    assert.equal(err.providerTrace.outcome, 'http_error');
    assert.equal(err.providerTrace.packageCaptureStatus, 'saved');
    const saved = await ProviderCallPackage.findById(err.providerTrace.providerPackageId).lean();
    assert.equal(saved.outcome, 'http_error');
    assert.equal(saved.response.statusCode, 429);
  } finally {
    await server.close();
  }
});

test('Kimi invalid JSON saves package and surfaces invalid_json trace', async () => {
  const server = await startProviderServer(({ res }) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>not json</html>');
  });

  try {
    const err = await captureReject(() => parseWithServer(server));
    assert.equal(err.code, 'PROVIDER_ERROR');
    assert.equal(err.providerTrace.outcome, 'invalid_json');
    assert.equal(err.providerTrace.packageCaptureStatus, 'saved');
    const saved = await ProviderCallPackage.findById(err.providerTrace.providerPackageId).lean();
    assert.equal(saved.outcome, 'invalid_json');
    assert.ok(saved.response.jsonParseError);
  } finally {
    await server.close();
  }
});

test('Kimi network and timeout failures save package outcomes before surfacing errors', async (t) => {
  await t.test('network_error', async () => {
    const closed = await startProviderServer(({ res }) => {
      res.writeHead(200).end('{}');
    });
    const baseUrl = closed.baseUrl;
    await closed.close();

    process.env.MOONSHOT_API_KEY = 'mk-test-kimi-key';
    process.env.KIMI_API_URL = baseUrl;
    process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
    process.env.IMAGE_PARSER_PROVIDER_PACKAGE_WAIT_MS = '2000';
    const { parseImage } = loadImageParserFresh();

    const err = await captureReject(() => parseImage(TINY_PNG_BASE64, { provider: 'kimi', timeoutMs: 200 }));
    assert.equal(err.providerTrace.outcome, 'network_error');
    assert.equal(err.providerTrace.packageCaptureStatus, 'saved');
    const saved = await ProviderCallPackage.findById(err.providerTrace.providerPackageId).lean();
    assert.equal(saved.outcome, 'network_error');
  });

  await t.test('timeout', async () => {
    const server = await startProviderServer(() => {
      // Hold the request open until the client timeout fires.
    });
    try {
      process.env.MOONSHOT_API_KEY = 'mk-test-kimi-key';
      process.env.KIMI_API_URL = server.baseUrl;
      process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
      process.env.IMAGE_PARSER_PROVIDER_PACKAGE_WAIT_MS = '2000';
      const { parseImage } = loadImageParserFresh();

      const err = await captureReject(() => parseImage(TINY_PNG_BASE64, { provider: 'kimi', timeoutMs: 50 }));
      assert.equal(err.providerTrace.outcome, 'timeout');
      assert.equal(err.providerTrace.packageCaptureStatus, 'saved');
      const saved = await ProviderCallPackage.findById(err.providerTrace.providerPackageId).lean();
      assert.equal(saved.outcome, 'timeout');
    } finally {
      await server.close();
    }
  });
});

test('Kimi capture failure blocks parser extraction and surfaces package status', async () => {
  const { events, eventBus } = createEventBus();
  const server = await startProviderServer(({ res }) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(kimiResponse()));
  });
  const originalCreate = ProviderCallPackage.create;
  ProviderCallPackage.create = async function failingCreate() {
    throw new Error('kimi mongo insert failed');
  };

  try {
    await assert.rejects(
      () => parseWithServer(server, { eventBus }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_PACKAGE_CAPTURE_FAILED');
        assert.equal(err.providerTrace.outcome, 'package_capture_failed');
        assert.equal(err.providerTrace.packageCaptureStatus, 'failed');
        assert.ok(events.some((event) => event.type === 'provider.package_capture_failed'));
        return true;
      }
    );
  } finally {
    ProviderCallPackage.create = originalCreate;
    await server.close();
  }
});
