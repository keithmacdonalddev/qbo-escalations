const test = require('node:test');
const assert = require('node:assert/strict');

const { isValidProvider, getProvider } = require('../src/services/providers/registry');
const remoteApiProviders = require('../src/services/remote-api-providers');

const {
  requestAnthropicChat,
  requestLlmGatewayChat,
  requestOpenAiChat,
  requestGeminiChat,
  requestKimiChat,
} = remoteApiProviders._internal;

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
    requestFn: (method, baseUrl, urlPath, body, headers) => {
      captured = { method, baseUrl, urlPath, body, headers };
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
    requestFn: (method, baseUrl, urlPath, body, headers, timeoutMs) => {
      captured = { method, baseUrl, urlPath, body, headers, timeoutMs };
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
    requestFn: (method, baseUrl, urlPath, body, headers) => {
      captured = { method, baseUrl, urlPath, body, headers };
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
    requestFn: (method, baseUrl, urlPath, body, headers) => {
      captured = { method, baseUrl, urlPath, body, headers };
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
    requestFn: (method, baseUrl, urlPath, body, headers) => {
      captured = { method, baseUrl, urlPath, body, headers };
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
  assert.equal(result.text, 'Hello from Kimi');
  assert.deepStrictEqual(result.usage, {
    model: 'kimi-k2.5',
    inputTokens: 5,
    outputTokens: 4,
  });
});
