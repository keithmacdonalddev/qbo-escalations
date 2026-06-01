'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const mongo = require('./_mongo-helper');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');

const STARTED_AT = '2026-05-21T12:00:00.000Z';
const COMPLETED_AT = '2026-05-21T12:00:01.000Z';

function buildGatewayPackage(overrides = {}) {
  const parsedJson = overrides.parsedJson || {
    id: 'chatcmpl-gateway-test',
    object: 'chat.completion',
    created: 1779241765,
    model: 'google/gemma-4-e4b',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'COID/MID: 123',
          reasoning_content: 'provider reasoning preserved',
          provider_extra_message_field: { keep: true },
        },
        finish_reason: 'stop',
        provider_extra_choice_field: 'kept',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
    gateway: {
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
      cost: {
        currency: 'USD',
        total_cost_usd: 0.000013,
        pricing_source: 'default',
      },
      provider_extra_gateway_field: { keep: true },
    },
    provider_extra_top_level: { keep: true },
  };
  const bodyText = JSON.stringify(parsedJson);
  const requestBody = {
    model: 'auto',
    max_tokens: 4096,
    temperature: 0.1,
    messages: [
      { role: 'system', content: 'Parse image.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Parse this image.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
        ],
      },
    ],
    chat_template_kwargs: { enable_thinking: false },
  };
  const requestBodyText = JSON.stringify(requestBody);

  return {
    request: {
      method: 'POST',
      baseUrl: 'http://127.0.0.1:4100',
      url: 'http://127.0.0.1:4100/v1/chat/completions',
      protocol: 'http:',
      hostname: '127.0.0.1',
      port: 4100,
      path: '/v1/chat/completions',
      urlPath: '/v1/chat/completions',
      headers: { Authorization: 'Bearer test-key', Accept: 'application/json' },
      redactedHeaderNames: [],
      bodyKind: 'json',
      bodyText: requestBodyText,
      bodyJson: requestBody,
      bodyByteLength: Buffer.byteLength(requestBodyText, 'utf8'),
      bodySha256: 'request-sha',
      modelRequested: 'auto',
      stream: false,
      timeoutMs: 5000,
      hasImages: true,
      images: [
        {
          seq: 0,
          mediaType: 'image/png',
          source: 'data-url',
          dataUrlSha256: 'image-sha',
          decodedByteLength: 5,
        },
      ],
    },
    response: {
      received: true,
      statusCode: 200,
      statusMessage: 'OK',
      httpVersion: '1.1',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'gateway-request-id',
      },
      redactedHeaderNames: [],
      rawHeaders: ['content-type', 'application/json', 'x-request-id', 'gateway-request-id'],
      trailers: {},
      rawTrailers: [],
      gatewayRequestId: 'gateway-request-id',
      bodyChunks: [
        {
          seq: 0,
          receivedAt: STARTED_AT,
          byteLength: Buffer.byteLength(bodyText, 'utf8'),
          sha256: 'response-chunk-sha',
          text: bodyText,
        },
      ],
      bodyText,
      bodyByteLength: Buffer.byteLength(bodyText, 'utf8'),
      bodySha256: 'response-sha',
      parsedJson,
      jsonParseError: null,
    },
    gateway: {
      requestId: 'gateway-request-id',
      metadata: parsedJson.gateway,
      usage: parsedJson.gateway.usage,
      cost: parsedJson.gateway.cost,
      credits: null,
    },
    providerStatus: overrides.providerStatus || null,
    error: overrides.error || null,
  };
}

function buildEnvelope(llmGateway, overrides = {}) {
  return {
    schemaVersion: '0.1',
    captureVersion: 'provider-harness-llm-gateway-v0.1',
    providerId: 'llm-gateway',
    providerResearchId: 'llm-gateway',
    providerPathType: 'gateway-http',
    callSite: 'image-parser:callLlmGateway',
    operation: 'image-parse',
    source: {
      file: 'server/src/services/image-parser.js',
      functionName: 'callLlmGateway',
      helperName: 'jsonRequest',
    },
    request: null,
    response: null,
    cli: null,
    lmStudio: null,
    llmGateway,
    timing: {
      requestStartedAt: STARTED_AT,
      requestWrittenAt: STARTED_AT,
      responseHeadersAt: STARTED_AT,
      responseCompletedAt: COMPLETED_AT,
      durationMs: 1000,
    },
    outcome: 'success',
    error: null,
    redaction: {
      applied: false,
      redactedHeaderNames: [],
      redactedBodyPaths: [],
      notes: [],
    },
    storage: {
      inline: true,
      externalPayloads: [],
      notes: [],
      truncated: false,
      truncationReason: null,
    },
    ...overrides,
  };
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
  await ProviderCallPackage.deleteMany({}).catch(() => {});
});

test('ProviderCallPackage accepts a strict LLM Gateway chat-completion package', async () => {
  const doc = await ProviderCallPackage.create(buildEnvelope(buildGatewayPackage()));
  const saved = await ProviderCallPackage.findById(doc._id).lean();

  assert.equal(saved.providerId, 'llm-gateway');
  assert.equal(saved.providerResearchId, 'llm-gateway');
  assert.equal(saved.providerPathType, 'gateway-http');
  assert.equal(saved.llmGateway.request.hasImages, true);
  assert.equal(saved.llmGateway.request.images[0].mediaType, 'image/png');
  assert.equal(saved.llmGateway.response.gatewayRequestId, 'gateway-request-id');
  assert.equal(saved.llmGateway.response.parsedJson.provider_extra_top_level.keep, true);
  assert.equal(saved.llmGateway.response.parsedJson.choices[0].message.provider_extra_message_field.keep, true);
  assert.equal(saved.llmGateway.gateway.metadata.provider_extra_gateway_field.keep, true);
  assert.equal(saved.llmGateway.gateway.credits, null);
});

test('ProviderCallPackage accepts a strict LLM Gateway provider-status package', async () => {
  const parsedJson = {
    ok: true,
    provider: 'llm-gateway',
    authenticated: true,
    gateway: { requestId: 'status-gateway' },
    upstream: { availableModel: 'google/gemma-4-e4b' },
  };
  const llmGateway = buildGatewayPackage({
    parsedJson,
    providerStatus: {
      ok: true,
      provider: 'llm-gateway',
      authenticated: true,
      gateway: parsedJson.gateway,
      upstream: parsedJson.upstream,
      error: null,
    },
  });

  const doc = await ProviderCallPackage.create(buildEnvelope(llmGateway, {
    callSite: 'image-parser:validateRemoteProvider:llm-gateway',
    operation: 'provider-status',
  }));
  const saved = await ProviderCallPackage.findById(doc._id).lean();

  assert.equal(saved.operation, 'provider-status');
  assert.equal(saved.llmGateway.providerStatus.ok, true);
  assert.equal(saved.llmGateway.providerStatus.upstream.availableModel, 'google/gemma-4-e4b');
});

test('ProviderCallPackage rejects unknown fields inside strict LLM Gateway request schema', async () => {
  const llmGateway = buildGatewayPackage();
  llmGateway.request.unexpectedRequestField = 'must not save';

  await assert.rejects(
    ProviderCallPackage.create(buildEnvelope(llmGateway)),
    /unexpectedRequestField/
  );
});

test('ProviderCallPackage rejects unknown fields inside strict LLM Gateway response schema', async () => {
  const llmGateway = buildGatewayPackage();
  llmGateway.response.unexpectedResponseField = 'must not save';

  await assert.rejects(
    ProviderCallPackage.create(buildEnvelope(llmGateway)),
    /unexpectedResponseField/
  );
});
