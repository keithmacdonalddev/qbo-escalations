'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const mongo = require('./_mongo-helper');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const {
  __waitForProviderPackageRecorderSettled,
  buildLlmGatewayProviderCallPackage,
  recordLlmGatewayProviderCallPackage,
  recordLlmGatewayProviderCallPackageInBackground,
} = require('../src/services/provider-call-package-recorder');

const STARTED_AT = '2026-05-21T12:00:00.000Z';
const HEADERS_AT = '2026-05-21T12:00:00.100Z';
const COMPLETED_AT = '2026-05-21T12:00:01.250Z';

function buildChunk(seq, text) {
  return {
    seq,
    receivedAt: STARTED_AT,
    byteLength: Buffer.byteLength(text, 'utf8'),
    sha256: `chunk-${seq}-sha`,
    text,
  };
}

function buildGatewayInput(overrides = {}) {
  const responseObject = overrides.responseObject || {
    id: 'chatcmpl-gateway-test',
    object: 'chat.completion',
    created: 1779241765,
    model: 'google/gemma-4-e4b',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'COID/MID: 123\nCASE: CS-GW-001',
          reasoning_content: 'gateway-carried reasoning',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 6,
      total_tokens: 18,
    },
    gateway: {
      usage: {
        prompt_tokens: 12,
        completion_tokens: 6,
        total_tokens: 18,
      },
      cost: {
        currency: 'USD',
        total_cost_usd: 0.000013,
        pricing_source: 'default',
      },
      ...(overrides.credits === false ? {} : {
        credits: {
          balance_usd: 49.99,
          total_granted_usd: 50,
          total_charged_usd: 0.01,
        },
      }),
    },
  };
  const responseBodyText = overrides.responseBodyText !== undefined
    ? overrides.responseBodyText
    : JSON.stringify(responseObject);
  const body = overrides.body !== undefined
    ? overrides.body
    : {
        model: 'auto',
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
        max_tokens: 4096,
        temperature: 0.1,
        chat_template_kwargs: { enable_thinking: false },
      };

  return {
    method: 'POST',
    baseUrl: 'http://127.0.0.1:4100',
    urlPath: '/v1/chat/completions',
    body,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(overrides.headers || {}),
    },
    timeoutMs: 5000,
    requestStartedAt: STARTED_AT,
    requestWrittenAt: STARTED_AT,
    responseHeadersAt: HEADERS_AT,
    responseCompletedAt: COMPLETED_AT,
    captureContext: {
      providerId: 'llm-gateway',
      providerResearchId: 'llm-gateway',
      providerPathType: 'gateway-http',
      callSite: overrides.callSite || 'image-parser:callLlmGateway',
      operation: overrides.operation || 'image-parse',
      source: {
        file: 'server/src/services/image-parser.js',
        functionName: 'callLlmGateway',
        helperName: 'jsonRequest',
      },
      modelRequested: body?.model || '',
    },
    response: overrides.noResponse ? null : {
      statusCode: overrides.statusCode || 200,
      statusMessage: overrides.statusMessage || 'OK',
      httpVersion: '1.1',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'gateway-request-id',
        ...(overrides.responseHeaders || {}),
      },
      rawHeaders: ['content-type', 'application/json', 'x-request-id', 'gateway-request-id'],
      trailers: {},
      rawTrailers: [],
      bodyChunks: [buildChunk(0, responseBodyText)],
      bodyText: responseBodyText,
    },
    error: overrides.error,
    outcome: overrides.outcome,
  };
}

function buildProviderStatusInput(overrides = {}) {
  const responseObject = overrides.responseObject || {
    ok: true,
    provider: 'llm-gateway',
    authenticated: true,
    gateway: { requestId: 'status-request-id' },
    upstream: { availableModel: 'google/gemma-4-e4b' },
  };
  const responseBodyText = JSON.stringify(responseObject);
  return buildGatewayInput({
    ...overrides,
    body: null,
    callSite: 'image-parser:validateRemoteProvider:llm-gateway',
    operation: 'provider-status',
    responseBodyText,
    responseObject,
  });
}

test.before(async () => {
  await mongo.connect();
});

test.after(async () => {
  await mongo.disconnect();
});

test.beforeEach(async () => {
  delete process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
  await ProviderCallPackage.deleteMany({});
});

test.afterEach(async () => {
  await __waitForProviderPackageRecorderSettled();
  await ProviderCallPackage.deleteMany({}).catch(() => {});
});

test('buildLlmGatewayProviderCallPackage builds a complete image-parser package', () => {
  const envelope = buildLlmGatewayProviderCallPackage(buildGatewayInput({ credits: false }));

  assert.equal(envelope.captureVersion, 'provider-harness-llm-gateway-v0.1');
  assert.equal(envelope.providerId, 'llm-gateway');
  assert.equal(envelope.providerResearchId, 'llm-gateway');
  assert.equal(envelope.providerPathType, 'gateway-http');
  assert.equal(envelope.callSite, 'image-parser:callLlmGateway');
  assert.equal(envelope.operation, 'image-parse');
  assert.equal(envelope.request, null);
  assert.equal(envelope.response, null);
  assert.equal(envelope.cli, null);
  assert.equal(envelope.lmStudio, null);
  assert.equal(envelope.llmGateway.request.hasImages, true);
  assert.equal(envelope.llmGateway.request.images[0].mediaType, 'image/png');
  assert.equal(envelope.llmGateway.response.gatewayRequestId, 'gateway-request-id');
  assert.equal(envelope.llmGateway.gateway.requestId, 'gateway-request-id');
  assert.equal(envelope.llmGateway.gateway.cost.pricing_source, 'default');
  assert.equal(envelope.llmGateway.gateway.credits, null);
  assert.equal(envelope.outcome, 'success');
});

test('buildLlmGatewayProviderCallPackage builds a complete provider-status package', () => {
  const envelope = buildLlmGatewayProviderCallPackage(buildProviderStatusInput());

  assert.equal(envelope.operation, 'provider-status');
  assert.equal(envelope.llmGateway.request.bodyKind, 'none');
  assert.equal(envelope.llmGateway.providerStatus.ok, true);
  assert.equal(envelope.llmGateway.providerStatus.authenticated, true);
  assert.equal(envelope.llmGateway.providerStatus.upstream.availableModel, 'google/gemma-4-e4b');
});

test('buildLlmGatewayProviderCallPackage classifies key outcomes', () => {
  const httpError = buildLlmGatewayProviderCallPackage(buildGatewayInput({
    statusCode: 503,
    statusMessage: 'Service Unavailable',
    responseBodyText: JSON.stringify({
      error: {
        type: 'upstream_error',
        code: 'UPSTREAM_NOT_READY',
        message: 'No model loaded',
      },
    }),
  }));
  const invalidJson = buildLlmGatewayProviderCallPackage(buildGatewayInput({
    responseBodyText: 'not-json',
  }));
  const networkError = buildLlmGatewayProviderCallPackage(buildGatewayInput({
    noResponse: true,
    error: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
  }));
  const timeout = buildLlmGatewayProviderCallPackage(buildGatewayInput({
    noResponse: true,
    error: Object.assign(new Error('request timed out'), { code: 'TIMEOUT' }),
  }));
  const aborted = buildLlmGatewayProviderCallPackage(buildGatewayInput({
    noResponse: true,
    error: Object.assign(new Error('request aborted'), { code: 'ABORT_ERR' }),
  }));

  assert.equal(httpError.outcome, 'http_error');
  assert.equal(httpError.llmGateway.error.gatewayErrorCode, 'UPSTREAM_NOT_READY');
  assert.equal(invalidJson.outcome, 'invalid_json');
  assert.equal(networkError.outcome, 'network_error');
  assert.equal(timeout.outcome, 'timeout');
  assert.equal(aborted.outcome, 'aborted');
});

test('recordLlmGatewayProviderCallPackage persists and redacts gateway packages', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const result = await recordLlmGatewayProviderCallPackage(buildGatewayInput({
    headers: {
      Authorization: 'Bearer gateway-secret',
      'Proxy-Authorization': 'Basic proxy-secret',
      Cookie: 'sid=request-cookie',
    },
    body: {
      model: 'auto',
      messages: [{ role: 'user', content: 'keep prompt' }],
      apiKey: 'request-secret',
    },
    responseHeaders: { 'set-cookie': 'sid=response-secret' },
  }), { log: false });

  assert.equal(result.ok, true);
  const saved = await ProviderCallPackage.findById(result.id).lean();
  assert.equal(saved.providerId, 'llm-gateway');
  assert.equal(saved.llmGateway.request.headers.Authorization, 'Bearer [REDACTED]');
  assert.equal(saved.llmGateway.request.headers['Proxy-Authorization'], 'Basic [REDACTED]');
  assert.equal(saved.llmGateway.request.headers.Cookie, '[REDACTED]');
  assert.equal(saved.llmGateway.request.bodyJson.apiKey, '[REDACTED]');
  assert.equal(saved.llmGateway.request.bodyText.includes('request-secret'), false);
  assert.equal(saved.llmGateway.response.headers['set-cookie'], '[REDACTED]');
  assert.equal(saved.llmGateway.response.gatewayRequestId, 'gateway-request-id');
  assert.equal(saved.redaction.redactedHeaderNames.includes('authorization'), true);
  assert.equal(saved.redaction.redactedBodyPaths.includes('llmGateway.request.bodyJson.apiKey'), true);
});

test('recordLlmGatewayProviderCallPackage externalizes large gateway payloads without truncation', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const payloadRoot = path.join(os.tmpdir(), `qbo-llmgateway-payload-${Date.now()}`);
  const largeContent = 'x'.repeat(256);
  const result = await recordLlmGatewayProviderCallPackage(buildGatewayInput({
    body: {
      model: 'auto',
      messages: [{ role: 'user', content: largeContent }],
    },
  }), {
    log: false,
    maxInlineBytes: 64,
    payloadRoot,
    now: new Date('2026-05-21T12:00:00.000Z'),
  });

  try {
    assert.equal(result.ok, true);
    const saved = await ProviderCallPackage.findById(result.id).lean();
    assert.equal(saved.storage.truncated, false);
    assert.ok(saved.storage.externalPayloads.length > 0);
    assert.equal(saved.llmGateway.request.bodyText, null);
    assert.ok(saved.llmGateway.request.bodyTextPayloadRef);
    assert.equal(saved.llmGateway.request.bodyJson, null);
    assert.equal(saved.llmGateway.request.bodyJsonPayloadRef.derivedFrom, 'llmGateway.request.bodyText');
    assert.equal(saved.llmGateway.response.bodyText, null);
    assert.ok(saved.llmGateway.response.bodyTextPayloadRef);
  } finally {
    await fs.rm(payloadRoot, { recursive: true, force: true });
  }
});

test('recordLlmGatewayProviderCallPackageInBackground does not synchronously block on Mongo insert', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const originalCreate = ProviderCallPackage.create;
  let createStarted = false;
  let releaseCreate;
  ProviderCallPackage.create = async function delayedCreate(...args) {
    createStarted = true;
    await new Promise((resolve) => { releaseCreate = resolve; });
    return originalCreate.apply(this, args);
  };

  try {
    const queued = recordLlmGatewayProviderCallPackageInBackground(buildGatewayInput(), { log: false });
    assert.equal(queued.queued, true);
    assert.equal(createStarted, false);

    while (!createStarted) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    releaseCreate();
    await __waitForProviderPackageRecorderSettled();
    assert.equal(await ProviderCallPackage.countDocuments({ providerId: 'llm-gateway' }), 1);
  } finally {
    ProviderCallPackage.create = originalCreate;
  }
});

test('recordLlmGatewayProviderCallPackage reports recorder failure without throwing', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const originalCreate = ProviderCallPackage.create;
  ProviderCallPackage.create = async function failingCreate() {
    throw new Error('llm gateway mongo insert failed');
  };

  try {
    const result = await recordLlmGatewayProviderCallPackage(buildGatewayInput(), { log: false });
    assert.equal(result.ok, false);
    assert.equal(result.error.message, 'llm gateway mongo insert failed');
    assert.equal(await ProviderCallPackage.countDocuments({ providerId: 'llm-gateway' }), 0);
  } finally {
    ProviderCallPackage.create = originalCreate;
  }
});
