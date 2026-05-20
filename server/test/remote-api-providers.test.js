const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { EventEmitter } = require('events');

const mongo = require('./_mongo-helper');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const { isValidProvider, getProvider } = require('../src/services/providers/registry');
const remoteApiProviders = require('../src/services/remote-api-providers');

const {
  requestAnthropicChat,
  requestLlmGatewayChat,
  requestOpenAiChat,
  requestGeminiChat,
  requestKimiChat,
} = remoteApiProviders._internal;

function testCaptureContext(callSite) {
  return {
    providerId: 'kimi',
    providerResearchId: 'kimi-api',
    providerPathType: 'direct-http',
    callSite,
    operation: 'chat',
    source: {
      file: 'server/src/services/remote-api-providers.js',
      functionName: 'jsonRequestCancelable',
      helperName: 'jsonRequestCancelable',
    },
    modelRequested: 'kimi-k2.5',
  };
}

async function withCaptureEnabled(fn) {
  const previousFlag = process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
  await mongo.connect();
  await ProviderCallPackage.deleteMany({});
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  try {
    return await fn();
  } finally {
    if (previousFlag === undefined) {
      delete process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
    } else {
      process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = previousFlag;
    }
    await ProviderCallPackage.deleteMany({}).catch(() => {});
    await mongo.disconnect();
  }
}

test('registry exposes API-backed agent providers', () => {
  for (const providerId of ['llm-gateway', 'anthropic', 'openai', 'gemini', 'kimi']) {
    assert.equal(isValidProvider(providerId), true, `${providerId} should be a valid provider`);
    const provider = getProvider(providerId);
    assert.equal(typeof provider.chat, 'function', `${providerId} should expose chat()`);
    assert.equal(provider.parseEscalation, null, `${providerId} should not claim parseEscalation support`);
    assert.equal(provider.transcribeImage, null, `${providerId} should not claim transcribeImage support`);
  }
});

test('LLM Gateway request builder uses OpenAI-compatible payload and optional auth', async () => {
  let captured = null;
  const request = requestLlmGatewayChat({
    messages: [{ role: 'user', content: 'Use the gateway' }],
    systemPrompt: 'Be brief.',
    model: 'auto',
    getApiKeyFn: async () => '',
    requestFn: (method, baseUrl, urlPath, body, headers, timeoutMs, captureContext) => {
      captured = { method, baseUrl, urlPath, body, headers, timeoutMs, captureContext };
      return {
        promise: Promise.resolve({
          statusCode: 200,
          body: JSON.stringify({
            model: 'gateway-model',
            choices: [{ message: { content: 'Gateway reply' } }],
            usage: { prompt_tokens: 9, completion_tokens: 3 },
          }),
        }),
        cancel: () => true,
      };
    },
  });

  const result = await request.promise;

  assert.equal(captured.method, 'POST');
  assert.equal(captured.baseUrl, process.env.LLM_GATEWAY_API_URL || 'http://127.0.0.1:4100');
  assert.equal(captured.urlPath, '/v1/chat/completions');
  assert.equal(captured.body.model, 'auto');
  assert.equal(captured.body.messages[0].role, 'system');
  assert.equal(captured.body.messages[1].role, 'user');
  assert.deepStrictEqual(captured.headers, {});
  assert.equal(captured.captureContext.providerId, 'llm-gateway');
  assert.equal(captured.captureContext.providerResearchId, 'llm-gateway');
  assert.equal(captured.captureContext.providerPathType, 'gateway-http');
  assert.equal(captured.captureContext.callSite, 'remote-api-providers:requestLlmGatewayChat');
  assert.equal(result.text, 'Gateway reply');
  assert.deepStrictEqual(result.usage, {
    model: 'gateway-model',
    inputTokens: 9,
    outputTokens: 3,
  });
});

test('OpenAI request builder uses chat completions payload and parses usage', async () => {
  let captured = null;
  const request = requestOpenAiChat({
    messages: [{ role: 'user', content: 'Summarize this' }],
    systemPrompt: 'You are concise.',
    model: 'gpt-4o-mini',
    timeoutMs: 12345,
    getApiKeyFn: async () => 'sk-test',
    requestFn: (method, baseUrl, urlPath, body, headers, timeoutMs, captureContext) => {
      captured = { method, baseUrl, urlPath, body, headers, timeoutMs, captureContext };
      return {
        promise: Promise.resolve({
          statusCode: 200,
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            choices: [{ message: { content: 'Done.' } }],
            usage: { prompt_tokens: 11, completion_tokens: 7 },
          }),
        }),
        cancel: () => true,
      };
    },
  });

  const result = await request.promise;

  assert.equal(captured.method, 'POST');
  assert.equal(captured.baseUrl, 'https://api.openai.com');
  assert.equal(captured.urlPath, '/v1/chat/completions');
  assert.equal(captured.timeoutMs, 12345);
  assert.equal(captured.headers.Authorization, 'Bearer sk-test');
  assert.equal(captured.body.model, 'gpt-4o-mini');
  assert.equal(captured.body.messages[0].role, 'system');
  assert.equal(captured.body.messages[0].content, 'You are concise.');
  assert.equal(captured.body.messages[1].role, 'user');
  assert.equal(captured.body.messages[1].content, 'Summarize this');
  assert.equal(captured.captureContext.providerId, 'openai');
  assert.equal(captured.captureContext.providerResearchId, 'openai-api');
  assert.equal(captured.captureContext.providerPathType, 'direct-http');
  assert.equal(captured.captureContext.callSite, 'remote-api-providers:requestOpenAiChat');
  assert.equal(result.text, 'Done.');
  assert.deepStrictEqual(result.usage, {
    model: 'gpt-4o-mini',
    inputTokens: 11,
    outputTokens: 7,
  });
});

test('Anthropic request builder sends system separately and parses usage', async () => {
  let captured = null;
  const request = requestAnthropicChat({
    messages: [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Second question' },
    ],
    systemPrompt: 'Act like an analyst.',
    getApiKeyFn: async () => 'sk-ant-test',
    requestFn: (method, baseUrl, urlPath, body, headers, timeoutMs, captureContext) => {
      captured = { method, baseUrl, urlPath, body, headers, timeoutMs, captureContext };
      return {
        promise: Promise.resolve({
          statusCode: 200,
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            content: [{ type: 'text', text: 'Here is the answer.' }],
            usage: { input_tokens: 21, output_tokens: 9 },
          }),
        }),
        cancel: () => true,
      };
    },
  });

  const result = await request.promise;

  assert.equal(captured.method, 'POST');
  assert.equal(captured.baseUrl, 'https://api.anthropic.com');
  assert.equal(captured.urlPath, '/v1/messages');
  assert.equal(captured.headers['x-api-key'], 'sk-ant-test');
  assert.equal(captured.body.system, 'Act like an analyst.');
  assert.deepStrictEqual(captured.body.messages, [
    { role: 'user', content: 'First question' },
    { role: 'assistant', content: 'First answer' },
    { role: 'user', content: 'Second question' },
  ]);
  assert.equal(captured.captureContext.providerId, 'anthropic');
  assert.equal(captured.captureContext.providerResearchId, 'anthropic-api');
  assert.equal(captured.captureContext.providerPathType, 'direct-http');
  assert.equal(captured.captureContext.callSite, 'remote-api-providers:requestAnthropicChat');
  assert.equal(result.text, 'Here is the answer.');
  assert.deepStrictEqual(result.usage, {
    model: 'claude-sonnet-4-20250514',
    inputTokens: 21,
    outputTokens: 9,
  });
});

test('Gemini request builder uses native generateContent payload and parses usage', async () => {
  let captured = null;
  const request = requestGeminiChat({
    messages: [
      { role: 'user', content: 'What happened?' },
      { role: 'assistant', content: 'Here is the draft answer.' },
    ],
    systemPrompt: 'Be precise.',
    model: 'gemini-3-flash-preview',
    getApiKeyFn: async () => 'AIza-test',
    requestFn: (method, baseUrl, urlPath, body, headers, timeoutMs, captureContext) => {
      captured = { method, baseUrl, urlPath, body, headers, timeoutMs, captureContext };
      return {
        promise: Promise.resolve({
          statusCode: 200,
          body: JSON.stringify({
            modelVersion: 'gemini-3-flash-preview',
            candidates: [{ content: { parts: [{ text: 'Gemini reply' }] } }],
            usageMetadata: { promptTokenCount: 19, candidatesTokenCount: 6, totalTokenCount: 25 },
          }),
        }),
        cancel: () => true,
      };
    },
  });

  const result = await request.promise;

  assert.equal(captured.method, 'POST');
  assert.equal(captured.baseUrl, 'https://generativelanguage.googleapis.com');
  assert.match(captured.urlPath, /\/v1beta\/models\/gemini-3-flash-preview:generateContent$/);
  assert.equal(captured.headers['x-goog-api-key'], 'AIza-test');
  assert.equal(captured.body.system_instruction.parts[0].text, 'Be precise.');
  assert.equal(captured.body.contents[0].role, 'user');
  assert.equal(captured.body.contents[0].parts[0].text, 'What happened?');
  assert.equal(captured.body.contents[1].role, 'model');
  assert.equal(captured.body.contents[1].parts[0].text, 'Here is the draft answer.');
  assert.equal(captured.captureContext.providerId, 'gemini');
  assert.equal(captured.captureContext.providerResearchId, 'gemini-api');
  assert.equal(captured.captureContext.providerPathType, 'direct-http');
  assert.equal(captured.captureContext.callSite, 'remote-api-providers:requestGeminiChat');
  assert.equal(result.text, 'Gemini reply');
  assert.deepStrictEqual(result.usage, {
    model: 'gemini-3-flash-preview',
    inputTokens: 19,
    outputTokens: 6,
  });
});

test('Kimi request builder targets Moonshot OpenAI-compatible endpoint', async () => {
  let captured = null;
  const request = requestKimiChat({
    messages: [{ role: 'user', content: 'Say hello' }],
    model: 'kimi-k2.5',
    getApiKeyFn: async () => 'sk-moonshot',
    requestFn: (method, baseUrl, urlPath, body, headers, timeoutMs, captureContext) => {
      captured = { method, baseUrl, urlPath, body, headers, timeoutMs, captureContext };
      return {
        promise: Promise.resolve({
          statusCode: 200,
          body: JSON.stringify({
            model: 'kimi-k2.5',
            choices: [{ message: { content: 'Hello from Kimi' } }],
            usage: { prompt_tokens: 5, completion_tokens: 4 },
          }),
        }),
        cancel: () => true,
      };
    },
  });

  const result = await request.promise;

  assert.equal(captured.baseUrl, 'https://api.moonshot.ai');
  assert.equal(captured.urlPath, '/v1/chat/completions');
  assert.equal(captured.headers.Authorization, 'Bearer sk-moonshot');
  assert.equal(captured.body.model, 'kimi-k2.5');
  assert.deepEqual(captured.captureContext, {
    providerId: 'kimi',
    providerResearchId: 'kimi-api',
    providerPathType: 'direct-http',
    callSite: 'remote-api-providers:requestKimiChat',
    operation: 'chat',
    source: {
      file: 'server/src/services/remote-api-providers.js',
      functionName: 'requestKimiChat',
      helperName: 'jsonRequestCancelable',
    },
    modelRequested: 'kimi-k2.5',
  });
  assert.equal(result.text, 'Hello from Kimi');
  assert.deepStrictEqual(result.usage, {
    model: 'kimi-k2.5',
    inputTokens: 5,
    outputTokens: 4,
  });
});

test('jsonRequestCancelable captures HTTP package when enabled', async () => {
  const previousFlag = process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
  let server = null;

  await mongo.connect();
  await ProviderCallPackage.deleteMany({});
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';

  try {
    server = http.createServer((req, res) => {
      req.resume();
      res.statusCode = 200;
      res.statusMessage = 'OK';
      res.setHeader('content-type', 'application/json');
      res.setHeader('x-request-id', 'req-kimi-test');
      res.end(JSON.stringify({
        model: 'kimi-k2.5',
        choices: [{ message: { content: 'captured' } }],
      }));
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const request = remoteApiProviders._internal.jsonRequestCancelable(
      'POST',
      `http://127.0.0.1:${port}`,
      '/v1/chat/completions',
      { model: 'kimi-k2.5', accessToken: 'secret-token' },
      { Authorization: 'Bearer sk-test' },
      5000,
      {
        providerId: 'kimi',
        providerResearchId: 'kimi-api',
        providerPathType: 'direct-http',
        callSite: 'remote-api-providers:requestKimiChat',
        operation: 'chat',
        source: {
          file: 'server/src/services/remote-api-providers.js',
          functionName: 'requestKimiChat',
          helperName: 'jsonRequestCancelable',
        },
        modelRequested: 'kimi-k2.5',
      }
    );

    const response = await request.promise;
    const saved = await ProviderCallPackage.findOne({
      callSite: 'remote-api-providers:requestKimiChat',
    }).lean();

    assert.equal(response.statusCode, 200);
    assert.ok(saved);
    assert.equal(saved.providerId, 'kimi');
    assert.equal(saved.providerResearchId, 'kimi-api');
    assert.equal(saved.providerPathType, 'direct-http');
    assert.equal(saved.operation, 'chat');
    assert.equal(saved.outcome, 'success');
    assert.equal(saved.request.headers.Authorization, 'Bearer [REDACTED]');
    assert.equal(saved.request.bodyJson.accessToken, '[REDACTED]');
    assert.equal(saved.request.bodyText.includes('secret-token'), false);
    assert.equal(saved.response.statusCode, 200);
    assert.equal(saved.response.parsedJson.model, 'kimi-k2.5');
    assert.equal(saved.response.bodyChunks.length, 1);
    assert.equal(saved.storage.inline, true);
  } finally {
    if (previousFlag === undefined) {
      delete process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
    } else {
      process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = previousFlag;
    }
    await ProviderCallPackage.deleteMany({}).catch(() => {});
    await new Promise((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
    await mongo.disconnect();
  }
});

function installRequestErrorMock(mode) {
  const originalRequest = http.request;
  http.request = function mockedRequest(options, callback) {
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {
      if (mode === 'network_error') {
        process.nextTick(() => {
          const err = new Error('socket hang up');
          err.code = 'ECONNRESET';
          req.emit('error', err);
        });
      } else if (mode === 'timeout') {
        process.nextTick(() => req.emit('timeout'));
      }
    };
    req.destroy = (err) => {
      if (mode === 'aborted' && err) {
        process.nextTick(() => req.emit('error', err));
      }
    };
    return req;
  };
  return () => {
    http.request = originalRequest;
  };
}

test('jsonRequestCancelable captures network_error outcome when enabled', async () => {
  await withCaptureEnabled(async () => {
    const restore = installRequestErrorMock('network_error');
    try {
      const request = remoteApiProviders._internal.jsonRequestCancelable(
        'POST',
        'http://127.0.0.1:65530',
        '/v1/chat/completions',
        { model: 'kimi-k2.5' },
        {},
        5000,
        testCaptureContext('remote-api-providers:network-error-test')
      );

      await assert.rejects(request.promise, /socket hang up/);
      const saved = await ProviderCallPackage.findOne({
        callSite: 'remote-api-providers:network-error-test',
      }).lean();

      assert.ok(saved);
      assert.equal(saved.outcome, 'network_error');
      assert.equal(saved.response.received, false);
      assert.equal(saved.response.statusCode, 0);
      assert.equal(saved.response.bodyText, '');
      assert.equal(saved.error.code, 'ECONNRESET');
    } finally {
      restore();
    }
  });
});

test('jsonRequestCancelable captures timeout outcome when enabled', async () => {
  await withCaptureEnabled(async () => {
    const restore = installRequestErrorMock('timeout');
    try {
      const request = remoteApiProviders._internal.jsonRequestCancelable(
        'POST',
        'http://127.0.0.1:65530',
        '/v1/chat/completions',
        { model: 'kimi-k2.5' },
        {},
        25,
        testCaptureContext('remote-api-providers:timeout-test')
      );

      await assert.rejects(request.promise, /Request timed out/);
      const saved = await ProviderCallPackage.findOne({
        callSite: 'remote-api-providers:timeout-test',
      }).lean();

      assert.ok(saved);
      assert.equal(saved.outcome, 'timeout');
      assert.equal(saved.response.received, false);
      assert.equal(saved.response.statusCode, 0);
      assert.equal(saved.error.code, 'TIMEOUT');
    } finally {
      restore();
    }
  });
});

test('jsonRequestCancelable captures aborted outcome when enabled', async () => {
  await withCaptureEnabled(async () => {
    const restore = installRequestErrorMock('aborted');
    try {
      const request = remoteApiProviders._internal.jsonRequestCancelable(
        'POST',
        'http://127.0.0.1:65530',
        '/v1/chat/completions',
        { model: 'kimi-k2.5' },
        {},
        5000,
        testCaptureContext('remote-api-providers:aborted-test')
      );

      assert.equal(request.cancel('manual abort'), true);
      await assert.rejects(request.promise, /manual abort/);
      const saved = await ProviderCallPackage.findOne({
        callSite: 'remote-api-providers:aborted-test',
      }).lean();

      assert.ok(saved);
      assert.equal(saved.outcome, 'aborted');
      assert.equal(saved.response.received, false);
      assert.equal(saved.response.statusCode, 0);
      assert.equal(saved.error.message, 'manual abort');
    } finally {
      restore();
    }
  });
});
