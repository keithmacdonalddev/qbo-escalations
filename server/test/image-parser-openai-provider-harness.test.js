'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');

const mongo = require('./_mongo-helper');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const {
  __waitForProviderPackageRecorderSettled,
} = require('../src/services/provider-call-package-recorder');
const {
  sendOpenAiChatCompletion,
} = require('../src/services/providers/openai-api-provider-harness');
const {
  parseImage,
} = require('../src/services/image-parser');

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test.before(async () => {
  await mongo.connect();
});

test.after(async () => {
  await mongo.disconnect();
});

test.beforeEach(async () => {
  delete process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
  delete process.env.OPENAI_API_KEY;
  await ProviderCallPackage.deleteMany({});
});

test.afterEach(async () => {
  await __waitForProviderPackageRecorderSettled();
  await ProviderCallPackage.deleteMany({}).catch(() => {});
});

async function withHttpServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

function openAiCaptureContext(overrides = {}) {
  return {
    callSite: overrides.callSite || 'test:openai-image-parser',
    operation: overrides.operation || 'image-parse',
    functionName: 'testOpenAiHarness',
    forceCapture: true,
    modelRequested: overrides.model || 'gpt-5.4-mini',
    metadata: {
      sourceAgent: 'test',
    },
  };
}

async function sendHarnessRequest({
  baseUrl,
  body = null,
  timeoutMs = 1000,
  callSite = 'test:openai-image-parser',
  events = [],
} = {}) {
  return sendOpenAiChatCompletion({
    baseUrl,
    body: body || {
      model: 'gpt-5.4-mini',
      messages: [{ role: 'user', content: 'Parse this image.' }],
      max_completion_tokens: 4096,
      reasoning_effort: 'low',
    },
    model: body?.model || 'gpt-5.4-mini',
    timeoutMs,
    getApiKey: () => 'sk-openai-test',
    captureContext: openAiCaptureContext({ callSite, model: body?.model || 'gpt-5.4-mini' }),
    onProviderEvent: (eventType, payload) => events.push({ eventType, payload }),
  });
}

test('OpenAI provider harness saves provider package before returning success trace', async () => {
  const events = [];
  await withHttpServer((req, res) => {
    req.resume();
    res.statusCode = 200;
    res.statusMessage = 'OK';
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      id: 'chatcmpl-openai-test',
      object: 'chat.completion',
      model: 'gpt-5.4-mini',
      choices: [{ message: { role: 'assistant', content: 'COID/MID: 123\nCASE: 456' } }],
      usage: { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20 },
    }));
  }, async (baseUrl) => {
    const result = await sendHarnessRequest({ baseUrl, events });
    const saved = await ProviderCallPackage.findOne({ callSite: 'test:openai-image-parser' }).lean();

    assert.ok(saved);
    assert.equal(result.providerTrace.providerPackageId, String(saved._id));
    assert.equal(result.providerTrace.providerHarness, 'openai-api');
    assert.equal(result.providerTrace.outcome, 'success');
    assert.equal(result.providerTrace.packageCaptureStatus, 'saved');
    assert.equal(result.providerTrace.packageCaptureQueued, true);
    assert.equal(saved.providerId, 'openai');
    assert.equal(saved.providerResearchId, 'openai-api');
    assert.equal(saved.providerPathType, 'direct-http');
    assert.equal(saved.outcome, 'success');
    assert.equal(saved.request.headers.Authorization, 'Bearer [REDACTED]');
    assert.equal(saved.response.parsedJson.choices[0].message.content, 'COID/MID: 123\nCASE: 456');
    assert.equal(events.some((event) => event.eventType === 'provider.package_capture_confirmed'), true);
    assert.equal(events.some((event) => event.eventType === 'provider.package_ready_for_agent'), true);
  });
});

test('OpenAI provider harness saves HTTP error package before throwing', async () => {
  await withHttpServer((req, res) => {
    req.resume();
    res.statusCode = 429;
    res.statusMessage = 'Too Many Requests';
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { message: 'Rate limited' } }));
  }, async (baseUrl) => {
    await assert.rejects(
      () => sendHarnessRequest({ baseUrl, callSite: 'test:openai-http-error' }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.equal(err.providerTrace.outcome, 'http_error');
        assert.equal(err.providerTrace.packageCaptureStatus, 'saved');
        assert.equal(err.providerTrace.statusCode, 429);
        return true;
      }
    );
    const saved = await ProviderCallPackage.findOne({ callSite: 'test:openai-http-error' }).lean();
    assert.ok(saved);
    assert.equal(saved.outcome, 'http_error');
    assert.equal(saved.response.statusCode, 429);
  });
});

test('OpenAI provider harness saves invalid JSON package before throwing', async () => {
  await withHttpServer((req, res) => {
    req.resume();
    res.statusCode = 200;
    res.statusMessage = 'OK';
    res.setHeader('content-type', 'text/html');
    res.end('<html>not json</html>');
  }, async (baseUrl) => {
    await assert.rejects(
      () => sendHarnessRequest({ baseUrl, callSite: 'test:openai-invalid-json' }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.equal(err.providerTrace.outcome, 'invalid_json');
        assert.equal(err.providerTrace.packageCaptureStatus, 'saved');
        assert.ok(err.providerTrace.responseParseError);
        return true;
      }
    );
    const saved = await ProviderCallPackage.findOne({ callSite: 'test:openai-invalid-json' }).lean();
    assert.ok(saved);
    assert.equal(saved.outcome, 'invalid_json');
    assert.ok(saved.response.jsonParseError);
  });
});

test('OpenAI provider harness saves network error package before throwing', async () => {
  await assert.rejects(
    () => sendHarnessRequest({
      baseUrl: 'http://127.0.0.1:1',
      callSite: 'test:openai-network-error',
      timeoutMs: 250,
    }),
    (err) => {
      assert.equal(err.providerTrace.outcome, 'network_error');
      assert.equal(err.providerTrace.packageCaptureStatus, 'saved');
      return true;
    }
  );
  const saved = await ProviderCallPackage.findOne({ callSite: 'test:openai-network-error' }).lean();
  assert.ok(saved);
  assert.equal(saved.outcome, 'network_error');
  assert.equal(saved.response.received, false);
});

test('OpenAI provider harness saves timeout package before throwing', async () => {
  await withHttpServer((req) => {
    req.resume();
  }, async (baseUrl) => {
    await assert.rejects(
      () => sendHarnessRequest({
        baseUrl,
        callSite: 'test:openai-timeout',
        timeoutMs: 25,
      }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_TIMEOUT');
        assert.equal(err.providerTrace.outcome, 'timeout');
        assert.equal(err.providerTrace.packageCaptureStatus, 'saved');
        return true;
      }
    );
    const saved = await ProviderCallPackage.findOne({ callSite: 'test:openai-timeout' }).lean();
    assert.ok(saved);
    assert.equal(saved.outcome, 'timeout');
    assert.equal(saved.error.code, 'PROVIDER_TIMEOUT');
  });
});

test('OpenAI provider harness surfaces Mongo capture failure before parser extraction', async () => {
  const originalCreate = ProviderCallPackage.create;
  ProviderCallPackage.create = async function failingCreate() {
    throw new Error('openai mongo insert failed');
  };

  try {
    await withHttpServer((req, res) => {
      req.resume();
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        model: 'gpt-5.4-mini',
        choices: [{ message: { content: 'would otherwise parse' } }],
      }));
    }, async (baseUrl) => {
      await assert.rejects(
        () => sendHarnessRequest({ baseUrl, callSite: 'test:openai-capture-failure' }),
        (err) => {
          assert.equal(err.code, 'PROVIDER_PACKAGE_CAPTURE_FAILED');
          assert.equal(err.providerTrace.outcome, 'package_capture_failed');
          assert.equal(err.providerTrace.packageCaptureStatus, 'failed');
          assert.ok(err.message.includes('openai mongo insert failed'));
          return true;
        }
      );
    });
  } finally {
    ProviderCallPackage.create = originalCreate;
  }
});

test('OpenAI provider harness fails when required package capture is not readable after save', async () => {
  const originalExists = ProviderCallPackage.exists;
  const previousAttempts = process.env.PROVIDER_PACKAGE_CAPTURE_READBACK_ATTEMPTS;
  const previousDelay = process.env.PROVIDER_PACKAGE_CAPTURE_READBACK_DELAY_MS;
  process.env.PROVIDER_PACKAGE_CAPTURE_READBACK_ATTEMPTS = '2';
  process.env.PROVIDER_PACKAGE_CAPTURE_READBACK_DELAY_MS = '1';
  ProviderCallPackage.exists = async function missingReadback() {
    return null;
  };

  try {
    await withHttpServer((req, res) => {
      req.resume();
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        model: 'gpt-5.4-mini',
        choices: [{ message: { content: 'would otherwise parse' } }],
      }));
    }, async (baseUrl) => {
      const events = [];
      await assert.rejects(
        () => sendHarnessRequest({ baseUrl, callSite: 'test:openai-readback-failure', events }),
        (err) => {
          assert.equal(err.code, 'PROVIDER_PACKAGE_CAPTURE_FAILED');
          assert.equal(err.captureMode, 'required');
          assert.equal(err.providerTrace.outcome, 'package_capture_failed');
          assert.equal(err.providerTrace.packageCaptureStatus, 'failed');
          assert.equal(err.providerTrace.packageReadbackStatus, 'failed');
          assert.equal(err.providerTrace.packageReadbackAttempts, 2);
          assert.match(err.message, /readback confirmation failed/i);
          return true;
        }
      );
      assert.ok(events.some((event) => event.eventType === 'provider.package_capture_read_retry'));
    });
  } finally {
    ProviderCallPackage.exists = originalExists;
    if (previousAttempts === undefined) delete process.env.PROVIDER_PACKAGE_CAPTURE_READBACK_ATTEMPTS;
    else process.env.PROVIDER_PACKAGE_CAPTURE_READBACK_ATTEMPTS = previousAttempts;
    if (previousDelay === undefined) delete process.env.PROVIDER_PACKAGE_CAPTURE_READBACK_DELAY_MS;
    else process.env.PROVIDER_PACKAGE_CAPTURE_READBACK_DELAY_MS = previousDelay;
  }
});

function installHttpsOpenAiMock(handler) {
  const originalRequest = https.request;
  https.request = function mockedHttpsRequest(...args) {
    const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
    const url = args[0] instanceof URL ? args[0] : new URL(String(args[0]));
    const options = args[1] && typeof args[1] === 'object' && !(args[1] instanceof Function) ? args[1] : {};
    if (url.hostname !== 'api.openai.com') {
      return originalRequest.apply(https, args);
    }

    const req = new EventEmitter();
    let bodyText = '';
    req.write = (chunk) => {
      bodyText += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    };
    req.end = () => {
      const response = handler({
        url,
        options,
        bodyText,
        body: bodyText ? JSON.parse(bodyText) : null,
      });
      const res = new EventEmitter();
      res.statusCode = response.statusCode || 200;
      res.statusMessage = response.statusMessage || 'OK';
      res.httpVersion = '1.1';
      res.headers = response.headers || { 'content-type': 'application/json' };
      res.rawHeaders = Object.entries(res.headers).flatMap(([key, value]) => [key, String(value)]);
      res.trailers = {};
      res.rawTrailers = [];
      process.nextTick(() => {
        callback(res);
        process.nextTick(() => {
          res.emit('data', response.bodyText || '');
          res.emit('end');
        });
      });
    };
    req.destroy = () => {};
    return req;
  };

  return () => {
    https.request = originalRequest;
  };
}

test('parseImage routes OpenAI through Mongo provider package handoff and preserves reasoning request shape', async () => {
  process.env.OPENAI_API_KEY = 'sk-openai-test';
  let capturedBody = null;
  const events = [];
  const restore = installHttpsOpenAiMock(({ body }) => {
    capturedBody = body;
    return {
      statusCode: 200,
      bodyText: JSON.stringify({
        id: 'chatcmpl-openai-parser',
        object: 'chat.completion',
        model: 'gpt-5.6-terra',
        choices: [{ message: { role: 'assistant', content: 'COID/MID: 789\nCASE: 101112' } }],
        usage: { prompt_tokens: 31, completion_tokens: 9, total_tokens: 40 },
      }),
    };
  });

  try {
    const eventBus = new EventEmitter();
    eventBus.on('parser.provider_trace_received', (payload) => events.push(payload));
    const result = await parseImage(TINY_PNG_BASE64, {
      provider: 'openai',
      reasoningEffort: 'low',
      eventBus,
    });
    const saved = await ProviderCallPackage.findOne({ callSite: 'image-parser:callOpenAI' }).lean();

    assert.equal(result.text, 'COID/MID: 789\nCASE: 101112');
    assert.equal(result.usage.model, 'gpt-5.6-terra');
    assert.equal(result.usage.inputTokens, 31);
    assert.equal(result.usage.outputTokens, 9);
    assert.equal(result.providerTrace.providerHarness, 'openai-api');
    assert.equal(result.providerTrace.packageCaptureStatus, 'saved');
    assert.ok(result.providerTrace.providerPayload);
    assert.ok(saved);
    assert.equal(result.providerTrace.providerPackageId, String(saved._id));
    assert.equal(capturedBody.model, 'gpt-5.6-terra');
    assert.equal(capturedBody.max_completion_tokens, 4096);
    assert.equal(capturedBody.reasoning_effort, 'low');
    assert.equal(Object.prototype.hasOwnProperty.call(capturedBody, 'max_tokens'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(capturedBody, 'temperature'), false);
    assert.equal(events[0].providerHarness, 'openai-api');
    assert.equal(events[0].providerPackageId, String(saved._id));
  } finally {
    restore();
  }
});
