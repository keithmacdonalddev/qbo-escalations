'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { EventEmitter } = require('events');
const mongo = require('./_mongo-helper');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const {
  __waitForProviderPackageRecorderSettled,
} = require('../src/services/provider-call-package-recorder');

const SERVICE_PATH = require.resolve('../src/services/lm-studio');
const origRequest = http.request;
const origGet = http.get;

let queuedResponses = [];
let seenRequests = [];

function queueHttpResponses(responses) {
  queuedResponses = Array.isArray(responses) ? responses.slice() : [];
  seenRequests = [];
}

function restoreHttp() {
  http.request = origRequest;
  http.get = origGet;
}

function normalizeRawHeaders(headers = {}) {
  return Object.entries(headers).flatMap(([name, value]) => [name, String(value)]);
}

function installHttpMock() {
  http.request = function mockedRequest(options, callback) {
    const normalizedOptions = typeof options === 'string' ? new URL(options) : options;
    const path = normalizedOptions.pathname || normalizedOptions.path;
    const headers = normalizedOptions.headers || {};
    const nextResponse = queuedResponses.find((entry) => entry.path === path) || queuedResponses[0];

    if (!nextResponse) {
      return origRequest.apply(http, arguments);
    }

    const seenRequest = { path, headers, writtenBody: '' };
    seenRequests.push(seenRequest);

    const req = new EventEmitter();
    req.write = (chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      req.writtenBody = `${req.writtenBody || ''}${text}`;
      seenRequest.writtenBody += text;
    };
    req.destroy = () => {
      req.destroyed = true;
    };
    req.end = () => {
      if (nextResponse.error) {
        process.nextTick(() => req.emit('error', nextResponse.error));
        return;
      }
      if (nextResponse.timeout) {
        process.nextTick(() => req.emit('timeout'));
        return;
      }
      const res = new EventEmitter();
      res.statusCode = nextResponse.statusCode;
      res.statusMessage = nextResponse.statusMessage || (nextResponse.statusCode === 200 ? 'OK' : 'Error');
      res.httpVersion = nextResponse.httpVersion || '1.1';
      res.headers = nextResponse.headers || { 'content-type': 'application/json' };
      res.rawHeaders = nextResponse.rawHeaders || normalizeRawHeaders(res.headers);
      res.trailers = nextResponse.trailers || {};
      res.rawTrailers = nextResponse.rawTrailers || [];

      process.nextTick(() => {
        if (typeof callback === 'function') {
          callback(res);
        }

        process.nextTick(() => {
          const body = typeof nextResponse.body === 'string'
            ? nextResponse.body
            : JSON.stringify(nextResponse.body);
          const chunks = Array.isArray(nextResponse.chunks)
            ? nextResponse.chunks
            : (body ? [body] : []);
          for (const chunk of chunks) {
            res.emit('data', chunk);
          }
          if (nextResponse.responseError) {
            res.emit('error', nextResponse.responseError);
            return;
          }
          res.emit('end');
        });
      });
    };

    return req;
  };

  http.get = function mockedGet(url, options, callback) {
    const requestOptions = typeof options === 'function' || options == null ? url : options;
    const cb = typeof options === 'function' ? options : callback;
    const req = http.request(requestOptions, cb);
    req.end();
    return req;
  };
}

function loadService() {
  delete require.cache[SERVICE_PATH];
  return require(SERVICE_PATH);
}

function sseData(value) {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function sseDone() {
  return 'data: [DONE]\n\n';
}

function runChat(chat, overrides = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const cleanup = chat({
      messages: [{ role: 'user', content: 'hello' }],
      systemPrompt: 'system',
      timeoutMs: 5000,
      onChunk: (chunk) => chunks.push(chunk),
      onDone: (text, usage) => resolve({ text, usage, chunks, cleanup }),
      onError: reject,
      ...overrides,
    });
  });
}

test.before(async () => {
  await mongo.connect();
});

test.beforeEach(async () => {
  restoreHttp();
  installHttpMock();
  delete process.env.LM_STUDIO_API_TOKEN;
  delete process.env.LM_STUDIO_API_KEY;
  delete process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
  await __waitForProviderPackageRecorderSettled();
  await ProviderCallPackage.deleteMany({});
});

test.afterEach(async () => {
  await __waitForProviderPackageRecorderSettled();
  await ProviderCallPackage.deleteMany({}).catch(() => {});
});

test.after(async () => {
  restoreHttp();
  delete process.env.LM_STUDIO_API_TOKEN;
  delete process.env.LM_STUDIO_API_KEY;
  delete process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
  await mongo.disconnect();
});

test('getModelSnapshot prefers native /api/v1/models and exposes available unloaded models', async () => {
  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [
          {
            type: 'llm',
            key: 'google/gemma-4-26b-a4b',
            display_name: 'Gemma 4 26B A4B',
            loaded_instances: []
          }
        ]
      }
    }
  ]);

  const { getModelSnapshot, getLoadedModel, clearModelCache } = loadService();
  clearModelCache();

  const snapshot = await getModelSnapshot('http://127.0.0.1:1234');
  const detectedModel = await getLoadedModel('http://127.0.0.1:1234');

  assert.equal(snapshot.source, 'native');
  assert.equal(snapshot.status, 'no_model_loaded');
  assert.equal(snapshot.loadedModel, null);
  assert.equal(snapshot.availableModel, 'google/gemma-4-26b-a4b');
  assert.equal(detectedModel, 'google/gemma-4-26b-a4b');
  assert.deepEqual(seenRequests.map((entry) => entry.path), ['/api/v1/models', '/api/v1/models']);
});

test('getModelSnapshot falls back to legacy /v1/models when the native endpoint is unavailable', async () => {
  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 404,
      body: 'Not Found'
    },
    {
      path: '/v1/models',
      statusCode: 200,
      body: {
        object: 'list',
        data: [
          { id: 'qwen/qwen3.5-9b', object: 'model', owned_by: 'lm-studio' }
        ]
      }
    }
  ]);

  const { getModelSnapshot, clearModelCache } = loadService();
  clearModelCache();

  const snapshot = await getModelSnapshot('http://127.0.0.1:1234');

  assert.equal(snapshot.source, 'compat');
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.loadedModel, 'qwen/qwen3.5-9b');
  assert.equal(snapshot.availableModel, 'qwen/qwen3.5-9b');
  assert.deepEqual(seenRequests.map((entry) => entry.path), ['/api/v1/models', '/v1/models']);
});

test('LM Studio requests include Authorization when LM_STUDIO_API_TOKEN is configured', async () => {
  process.env.LM_STUDIO_API_TOKEN = 'lm-token-test';

  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [
          {
            type: 'llm',
            key: 'google/gemma-4-26b-a4b',
            loaded_instances: []
          }
        ]
      }
    }
  ]);

  const { getModelSnapshot } = loadService();
  await getModelSnapshot('http://127.0.0.1:1234');

  assert.equal(seenRequests[0]?.headers?.Authorization, 'Bearer lm-token-test');
});

test('parseEscalation captures non-streaming LM Studio provider package when enabled', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';

  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [
          {
            type: 'llm',
            key: 'google/gemma-4-26b-a4b',
            loaded_instances: []
          }
        ]
      }
    },
    {
      path: '/v1/chat/completions',
      statusCode: 200,
      body: {
        model: 'google/gemma-4-26b-a4b',
        choices: [{ message: { content: '{"caseNumber":"CS-123","category":"technical"}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 6 },
      }
    }
  ]);

  const { parseEscalation, clearModelCache } = loadService();
  clearModelCache();

  const result = await parseEscalation('CASE: CS-123', { timeoutMs: 5000 });
  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'lm-studio:parseEscalation' }).lean();

  assert.equal(result.fields.caseNumber, 'CS-123');
  assert.ok(saved);
  assert.equal(saved.providerId, 'lm-studio');
  assert.equal(saved.providerResearchId, 'lm-studio-openai-compatible');
  assert.equal(saved.providerPathType, 'lm-studio-http-nonstream');
  assert.equal(saved.operation, 'parse-escalation');
  assert.equal(saved.request, null);
  assert.equal(saved.response, null);
  assert.equal(saved.lmStudio.mode, 'non-stream');
  assert.equal(saved.lmStudio.request.modelRequested, 'google/gemma-4-26b-a4b');
  assert.equal(saved.lmStudio.request.stream, false);
  assert.equal(saved.lmStudio.response.statusCode, 200);
  assert.equal(saved.lmStudio.response.parsedJson.model, 'google/gemma-4-26b-a4b');
  assert.equal(saved.outcome, 'success');
});

test('transcribeImage captures non-streaming LM Studio provider package when enabled', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';

  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [
          {
            type: 'llm',
            key: 'google/gemma-4-26b-a4b',
            loaded_instances: []
          }
        ]
      }
    },
    {
      path: '/v1/chat/completions',
      statusCode: 200,
      body: {
        model: 'google/gemma-4-26b-a4b',
        choices: [{ message: { content: 'VISIBLE TEXT' } }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      }
    }
  ]);

  const { transcribeImage, clearModelCache } = loadService();
  clearModelCache();

  const result = await transcribeImage('data:image/png;base64,aGVsbG8=', { timeoutMs: 5000 });
  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'lm-studio:transcribeImage' }).lean();

  assert.equal(result.text, 'VISIBLE TEXT');
  assert.ok(saved);
  assert.equal(saved.providerPathType, 'lm-studio-http-nonstream');
  assert.equal(saved.operation, 'transcribe-image');
  assert.equal(saved.lmStudio.request.stream, false);
  assert.equal(saved.lmStudio.response.statusCode, 200);
  assert.equal(saved.lmStudio.response.parsedJson.choices[0].message.content, 'VISIBLE TEXT');
});

test('parseEscalation writes no LM Studio package when capture is disabled', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'false';
  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [
          {
            type: 'llm',
            key: 'google/gemma-4-26b-a4b',
            loaded_instances: []
          }
        ]
      }
    },
    {
      path: '/v1/chat/completions',
      statusCode: 200,
      body: {
        model: 'google/gemma-4-26b-a4b',
        choices: [{ message: { content: '{"caseNumber":"DISABLED","category":"technical"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      }
    }
  ]);

  const { parseEscalation, clearModelCache } = loadService();
  clearModelCache();

  const result = await parseEscalation('CASE: DISABLED', { timeoutMs: 5000 });
  await __waitForProviderPackageRecorderSettled();

  assert.equal(result.fields.caseNumber, 'DISABLED');
  assert.equal(await ProviderCallPackage.countDocuments({ providerId: 'lm-studio' }), 0);
});

test('parseEscalation preserves non-200 LM Studio response body in provider package', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const fullErrorBody = JSON.stringify({
    error: {
      message: `model failed ${'x'.repeat(700)}`,
      type: 'server_error',
    },
  });

  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [{ type: 'llm', key: 'google/gemma-4-26b-a4b', loaded_instances: [] }]
      }
    },
    {
      path: '/v1/chat/completions',
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      body: fullErrorBody,
    }
  ]);

  const { parseEscalation, clearModelCache } = loadService();
  clearModelCache();

  await assert.rejects(parseEscalation('CASE: CS-500', { timeoutMs: 5000 }), /LM Studio parse error 500/);
  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'lm-studio:parseEscalation' }).lean();

  assert.equal(saved.outcome, 'http_error');
  assert.equal(saved.lmStudio.response.statusCode, 500);
  assert.equal(saved.lmStudio.response.bodyText, fullErrorBody);
  assert.equal(saved.lmStudio.response.parsedJson.error.type, 'server_error');
});

test('parseEscalation preserves invalid JSON body and parse error in provider package', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';

  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [{ type: 'llm', key: 'google/gemma-4-26b-a4b', loaded_instances: [] }]
      }
    },
    {
      path: '/v1/chat/completions',
      statusCode: 200,
      body: 'not-json',
    }
  ]);

  const { parseEscalation, clearModelCache } = loadService();
  clearModelCache();

  await assert.rejects(parseEscalation('CASE: BADJSON', { timeoutMs: 5000 }), SyntaxError);
  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'lm-studio:parseEscalation' }).lean();

  assert.equal(saved.outcome, 'invalid_json');
  assert.equal(saved.lmStudio.response.bodyText, 'not-json');
  assert.equal(saved.lmStudio.response.jsonParseError.name, 'SyntaxError');
});

test('parseEscalation preserves network error facts in provider package', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';

  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [{ type: 'llm', key: 'google/gemma-4-26b-a4b', loaded_instances: [] }]
      }
    },
    {
      path: '/v1/chat/completions',
      error: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
    }
  ]);

  const { parseEscalation, clearModelCache } = loadService();
  clearModelCache();

  await assert.rejects(parseEscalation('CASE: NETERR', { timeoutMs: 5000 }), /socket hang up/);
  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'lm-studio:parseEscalation' }).lean();

  assert.equal(saved.outcome, 'network_error');
  assert.equal(saved.lmStudio.response.received, false);
  assert.equal(saved.lmStudio.error.code, 'ECONNRESET');
});

test('parseEscalation preserves timeout facts in provider package', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';

  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [{ type: 'llm', key: 'google/gemma-4-26b-a4b', loaded_instances: [] }]
      }
    },
    {
      path: '/v1/chat/completions',
      timeout: true,
    }
  ]);

  const { parseEscalation, clearModelCache } = loadService();
  clearModelCache();

  await assert.rejects(parseEscalation('CASE: TIMEOUT', { timeoutMs: 5 }), /timed out/);
  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'lm-studio:parseEscalation' }).lean();

  assert.equal(saved.outcome, 'timeout');
  assert.equal(saved.lmStudio.response.received, false);
  assert.equal(saved.lmStudio.error.code, 'TIMEOUT');
});

test('parseEscalation does not wait for background LM Studio package insert', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const originalCreate = ProviderCallPackage.create;
  let releaseCreate;
  ProviderCallPackage.create = async function delayedCreate(...args) {
    await new Promise((resolve) => { releaseCreate = resolve; });
    return originalCreate.apply(this, args);
  };

  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [{ type: 'llm', key: 'google/gemma-4-26b-a4b', loaded_instances: [] }]
      }
    },
    {
      path: '/v1/chat/completions',
      statusCode: 200,
      body: {
        model: 'google/gemma-4-26b-a4b',
        choices: [{ message: { content: '{"caseNumber":"FAST","category":"technical"}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }
    }
  ]);

  try {
    const { parseEscalation, clearModelCache } = loadService();
    clearModelCache();

    const result = await Promise.race([
      parseEscalation('CASE: FAST', { timeoutMs: 5000 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('parseEscalation waited for recorder')), 250)),
    ]);
    assert.equal(result.fields.caseNumber, 'FAST');

    while (!releaseCreate) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    releaseCreate();
    await __waitForProviderPackageRecorderSettled();
    assert.equal(await ProviderCallPackage.countDocuments({ callSite: 'lm-studio:parseEscalation' }), 1);
  } finally {
    ProviderCallPackage.create = originalCreate;
  }
});

test('parseEscalation still returns when background LM Studio recorder insert fails', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const originalCreate = ProviderCallPackage.create;
  ProviderCallPackage.create = async function failingCreate() {
    throw new Error('lm studio insert failed');
  };

  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [{ type: 'llm', key: 'google/gemma-4-26b-a4b', loaded_instances: [] }]
      }
    },
    {
      path: '/v1/chat/completions',
      statusCode: 200,
      body: {
        model: 'google/gemma-4-26b-a4b',
        choices: [{ message: { content: '{"caseNumber":"NOFAIL","category":"technical"}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }
    }
  ]);

  try {
    const { parseEscalation, clearModelCache } = loadService();
    clearModelCache();

    const result = await parseEscalation('CASE: NOFAIL', { timeoutMs: 5000 });
    await __waitForProviderPackageRecorderSettled();

    assert.equal(result.fields.caseNumber, 'NOFAIL');
    assert.equal(await ProviderCallPackage.countDocuments({ callSite: 'lm-studio:parseEscalation' }), 0);
  } finally {
    ProviderCallPackage.create = originalCreate;
  }
});

test('chat captures streaming LM Studio provider package with ordered raw chunks and SSE frames', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';

  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [{ type: 'llm', key: 'google/gemma-4-e4b', loaded_instances: [] }]
      }
    },
    {
      path: '/v1/chat/completions',
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream' },
      chunks: [
        sseData({
          model: 'google/gemma-4-e4b',
          choices: [{ delta: { reasoning_content: 'thinking token preserved' } }],
          provider_extra: { keep: true },
        }),
        sseData({
          model: 'google/gemma-4-e4b',
          choices: [{ delta: { content: 'Hello ' } }],
        }),
        sseData({
          model: 'google/gemma-4-e4b',
          choices: [{ delta: { content: 'world' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
        sseDone(),
      ],
    }
  ]);

  const { chat, clearModelCache } = loadService();
  clearModelCache();

  const result = await runChat(chat);
  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'lm-studio:chat' }).lean();

  assert.equal(result.text, 'Hello world');
  assert.deepEqual(result.chunks, ['Hello ', 'world']);
  assert.equal(result.usage.model, 'google/gemma-4-e4b');
  assert.ok(saved);
  assert.equal(saved.providerPathType, 'lm-studio-http-stream');
  assert.equal(saved.operation, 'chat');
  assert.equal(saved.outcome, 'success');
  assert.equal(saved.request, null);
  assert.equal(saved.response, null);
  assert.equal(saved.lmStudio.mode, 'stream');
  assert.equal(saved.lmStudio.request.stream, true);
  assert.equal(saved.lmStudio.request.modelRequested, 'google/gemma-4-e4b');
  assert.equal(saved.lmStudio.response.statusCode, 200);
  assert.equal(saved.lmStudio.response.bodyText.includes('data: [DONE]'), true);
  assert.equal(saved.lmStudio.stream.rawChunks.length, 4);
  assert.equal(saved.lmStudio.stream.frames.length, 4);
  assert.equal(saved.lmStudio.stream.parsedChunks.length, 3);
  assert.equal(saved.lmStudio.stream.parsedChunks[0].choices[0].delta.reasoning_content, 'thinking token preserved');
  assert.equal(saved.lmStudio.stream.frames[3].eventType, 'done');
  assert.equal(saved.lmStudio.stream.doneSeen, true);
  assert.equal(saved.lmStudio.stream.terminator, 'done_sentinel');
  assert.equal(saved.lmStudio.stream.fullResponse, 'Hello world');
});

test('chat captures end without DONE as a stream terminator without changing callback behavior', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';

  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [{ type: 'llm', key: 'google/gemma-4-e4b', loaded_instances: [] }]
      }
    },
    {
      path: '/v1/chat/completions',
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream' },
      chunks: [
        sseData({
          model: 'google/gemma-4-e4b',
          choices: [{ delta: { content: 'partial answer' } }],
        }),
      ],
    }
  ]);

  const { chat, clearModelCache } = loadService();
  clearModelCache();

  const result = await runChat(chat);
  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'lm-studio:chat' }).lean();

  assert.equal(result.text, 'partial answer');
  assert.equal(saved.outcome, 'stream_end_without_done');
  assert.equal(saved.lmStudio.stream.doneSeen, false);
  assert.equal(saved.lmStudio.stream.terminator, 'end_without_done');
  assert.equal(saved.lmStudio.stream.fullResponse, 'partial answer');
});

test('chat captures non-200 streaming LM Studio error body in full', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const fullErrorBody = JSON.stringify({
    error: {
      message: `stream failed ${'x'.repeat(700)}`,
      type: 'server_error',
    },
  });

  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [{ type: 'llm', key: 'google/gemma-4-e4b', loaded_instances: [] }]
      }
    },
    {
      path: '/v1/chat/completions',
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      body: fullErrorBody,
    }
  ]);

  const { chat, clearModelCache } = loadService();
  clearModelCache();

  await assert.rejects(runChat(chat), /LM Studio API error \(HTTP 502\)/);
  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'lm-studio:chat' }).lean();

  assert.equal(saved.outcome, 'http_error');
  assert.equal(saved.lmStudio.response.statusCode, 502);
  assert.equal(saved.lmStudio.response.bodyText, fullErrorBody);
  assert.equal(saved.lmStudio.response.parsedJson.error.type, 'server_error');
  assert.equal(saved.lmStudio.error.rawBody, fullErrorBody);
  assert.equal(saved.lmStudio.error.object.error.type, 'server_error');
});

test('chat preserves malformed SSE JSON frame with parse error', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';

  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [{ type: 'llm', key: 'google/gemma-4-e4b', loaded_instances: [] }]
      }
    },
    {
      path: '/v1/chat/completions',
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream' },
      chunks: [
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        'data: {bad-json}\n\n',
        sseDone(),
      ],
    }
  ]);

  const { chat, clearModelCache } = loadService();
  clearModelCache();

  const result = await runChat(chat);
  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'lm-studio:chat' }).lean();

  assert.equal(result.text, 'ok');
  assert.equal(saved.lmStudio.stream.frames.length, 3);
  assert.equal(saved.lmStudio.stream.frames[1].rawLine, 'data: {bad-json}');
  assert.equal(saved.lmStudio.stream.frames[1].eventType, 'malformed_json');
  assert.equal(saved.lmStudio.stream.frames[1].parseError.name, 'SyntaxError');
});

test('chat captures timeout facts for LM Studio streaming provider package', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';

  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [{ type: 'llm', key: 'google/gemma-4-e4b', loaded_instances: [] }]
      }
    },
    {
      path: '/v1/chat/completions',
      timeout: true,
    }
  ]);

  const { chat, clearModelCache } = loadService();
  clearModelCache();

  await assert.rejects(runChat(chat, { timeoutMs: 5 }), /timed out/);
  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'lm-studio:chat' }).lean();

  assert.equal(saved.outcome, 'timeout');
  assert.equal(saved.lmStudio.response.received, false);
  assert.equal(saved.lmStudio.error.code, 'TIMEOUT');
  assert.equal(saved.lmStudio.stream.terminator, 'timeout');
});

test('chat captures network error facts for LM Studio streaming provider package', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';

  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [{ type: 'llm', key: 'google/gemma-4-e4b', loaded_instances: [] }]
      }
    },
    {
      path: '/v1/chat/completions',
      error: Object.assign(new Error('stream socket reset'), { code: 'ECONNRESET' }),
    }
  ]);

  const { chat, clearModelCache } = loadService();
  clearModelCache();

  await assert.rejects(runChat(chat), /stream socket reset/);
  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'lm-studio:chat' }).lean();

  assert.equal(saved.outcome, 'network_error');
  assert.equal(saved.lmStudio.response.received, false);
  assert.equal(saved.lmStudio.error.code, 'ECONNRESET');
  assert.equal(saved.lmStudio.stream.terminator, 'network_error');
});

test('chat does not wait for background LM Studio stream package insert', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const originalCreate = ProviderCallPackage.create;
  let releaseCreate;
  ProviderCallPackage.create = async function delayedCreate(...args) {
    await new Promise((resolve) => { releaseCreate = resolve; });
    return originalCreate.apply(this, args);
  };

  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [{ type: 'llm', key: 'google/gemma-4-e4b', loaded_instances: [] }]
      }
    },
    {
      path: '/v1/chat/completions',
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream' },
      chunks: [
        sseData({
          model: 'google/gemma-4-e4b',
          choices: [{ delta: { content: 'fast stream' } }],
        }),
        sseDone(),
      ],
    }
  ]);

  try {
    const { chat, clearModelCache } = loadService();
    clearModelCache();

    const result = await Promise.race([
      runChat(chat),
      new Promise((_, reject) => setTimeout(() => reject(new Error('chat waited for recorder')), 250)),
    ]);
    assert.equal(result.text, 'fast stream');

    while (!releaseCreate) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    releaseCreate();
    await __waitForProviderPackageRecorderSettled();
    assert.equal(await ProviderCallPackage.countDocuments({ callSite: 'lm-studio:chat' }), 1);
  } finally {
    ProviderCallPackage.create = originalCreate;
  }
});

test('chat still returns when background LM Studio stream recorder insert fails', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const originalCreate = ProviderCallPackage.create;
  ProviderCallPackage.create = async function failingCreate() {
    throw new Error('lm studio stream insert failed');
  };

  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [{ type: 'llm', key: 'google/gemma-4-e4b', loaded_instances: [] }]
      }
    },
    {
      path: '/v1/chat/completions',
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream' },
      chunks: [
        sseData({
          model: 'google/gemma-4-e4b',
          choices: [{ delta: { content: 'recorder failure safe' } }],
        }),
        sseDone(),
      ],
    }
  ]);

  try {
    const { chat, clearModelCache } = loadService();
    clearModelCache();

    const result = await runChat(chat);
    await __waitForProviderPackageRecorderSettled();

    assert.equal(result.text, 'recorder failure safe');
    assert.equal(await ProviderCallPackage.countDocuments({ callSite: 'lm-studio:chat' }), 0);
  } finally {
    ProviderCallPackage.create = originalCreate;
  }
});

test('chat writes no LM Studio stream package when capture is disabled', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'false';
  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [{ type: 'llm', key: 'google/gemma-4-e4b', loaded_instances: [] }]
      }
    },
    {
      path: '/v1/chat/completions',
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream' },
      chunks: [
        sseData({
          model: 'google/gemma-4-e4b',
          choices: [{ delta: { content: 'disabled capture' } }],
        }),
        sseDone(),
      ],
    }
  ]);

  const { chat, clearModelCache } = loadService();
  clearModelCache();

  const result = await runChat(chat);
  await __waitForProviderPackageRecorderSettled();

  assert.equal(result.text, 'disabled capture');
  assert.equal(await ProviderCallPackage.countDocuments({ providerId: 'lm-studio' }), 0);
});
