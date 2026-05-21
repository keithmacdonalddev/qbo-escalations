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
  buildLmStudioProviderCallPackage,
  recordLmStudioProviderCallPackage,
  recordLmStudioProviderCallPackageInBackground,
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

function buildNonStreamInput(overrides = {}) {
  const responseObject = overrides.responseObject || {
    id: 'chatcmpl-lmstudio-nonstream',
    object: 'chat.completion',
    created: 1779241765,
    model: 'google/gemma-4-e4b',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: '{"caseNumber":"CS-123","category":"technical"}',
          reasoning_content: 'provider reasoning field preserved',
          provider_extra_message_field: { keep: true },
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 6,
      total_tokens: 18,
    },
    provider_extra_top_level: { keep: true },
  };
  const responseBodyText = overrides.responseBodyText !== undefined
    ? overrides.responseBodyText
    : JSON.stringify(responseObject);
  const body = overrides.body || {
    model: 'google/gemma-4-e4b',
    messages: [{ role: 'user', content: 'CASE: CS-123' }],
    stream: false,
    temperature: 0.1,
    max_tokens: 2048,
    chat_template_kwargs: { enable_thinking: false },
  };

  return {
    mode: 'non-stream',
    method: 'POST',
    baseUrl: 'http://127.0.0.1:1234',
    urlPath: '/v1/chat/completions',
    body,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(overrides.headers || {}),
    },
    timeoutMs: 5000,
    requestStartedAt: STARTED_AT,
    requestWrittenAt: STARTED_AT,
    responseHeadersAt: HEADERS_AT,
    responseCompletedAt: COMPLETED_AT,
    captureContext: {
      providerId: 'lm-studio',
      providerResearchId: 'lm-studio-openai-compatible',
      providerPathType: 'lm-studio-http-nonstream',
      callSite: 'lm-studio:parseEscalation',
      operation: 'parse-escalation',
      source: {
        file: 'server/src/services/lm-studio.js',
        functionName: 'parseEscalation',
        helperName: 'jsonRequest',
      },
      modelRequested: 'google/gemma-4-e4b',
    },
    response: {
      statusCode: overrides.statusCode || 200,
      statusMessage: overrides.statusMessage || 'OK',
      httpVersion: '1.1',
      headers: {
        'content-type': 'application/json',
        ...(overrides.responseHeaders || {}),
      },
      rawHeaders: ['content-type', 'application/json'],
      trailers: {},
      rawTrailers: [],
      bodyChunks: [buildChunk(0, responseBodyText)],
      bodyText: responseBodyText,
    },
    error: overrides.error,
    outcome: overrides.outcome,
  };
}

function buildStreamInput(overrides = {}) {
  const firstChunk = {
    id: 'chatcmpl-lmstudio-stream',
    object: 'chat.completion.chunk',
    model: 'google/gemma-4-e4b',
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          reasoning_content: 'thinking token preserved',
          content: '',
        },
        finish_reason: null,
      },
    ],
  };
  const secondChunk = {
    id: 'chatcmpl-lmstudio-stream',
    object: 'chat.completion.chunk',
    model: 'google/gemma-4-e4b',
    choices: [
      {
        index: 0,
        delta: { content: 'Visible answer' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 8,
      completion_tokens: 3,
      total_tokens: 11,
    },
  };
  const doneLine = 'data: [DONE]';
  const rawStreamText = `data: ${JSON.stringify(firstChunk)}\n\ndata: ${JSON.stringify(secondChunk)}\n\n${doneLine}\n\n`;

  return {
    mode: 'stream',
    method: 'POST',
    baseUrl: 'http://127.0.0.1:1234',
    urlPath: '/v1/chat/completions',
    body: {
      model: 'google/gemma-4-e4b',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
      temperature: 0.5,
    },
    headers: {
      'Content-Type': 'application/json',
      ...(overrides.headers || {}),
    },
    timeoutMs: 5000,
    requestStartedAt: STARTED_AT,
    requestWrittenAt: STARTED_AT,
    responseHeadersAt: HEADERS_AT,
    responseCompletedAt: COMPLETED_AT,
    captureContext: {
      providerId: 'lm-studio',
      providerResearchId: 'lm-studio-openai-compatible',
      providerPathType: 'lm-studio-http-stream',
      callSite: 'lm-studio:chat',
      operation: 'chat',
      source: {
        file: 'server/src/services/lm-studio.js',
        functionName: 'chat',
        helperName: 'http.request',
      },
      modelRequested: 'google/gemma-4-e4b',
    },
    response: {
      statusCode: 200,
      statusMessage: 'OK',
      httpVersion: '1.1',
      headers: { 'content-type': 'text/event-stream' },
      rawHeaders: ['content-type', 'text/event-stream'],
      trailers: {},
      rawTrailers: [],
      bodyChunks: [buildChunk(0, rawStreamText)],
      bodyText: rawStreamText,
    },
    stream: {
      rawChunks: [buildChunk(0, rawStreamText)],
      frames: [
        {
          seq: 0,
          receivedAt: STARTED_AT,
          rawLine: `data: ${JSON.stringify(firstChunk)}`,
          data: JSON.stringify(firstChunk),
          eventType: 'data',
          parsedJson: firstChunk,
        },
        {
          seq: 1,
          receivedAt: STARTED_AT,
          rawLine: `data: ${JSON.stringify(secondChunk)}`,
          data: JSON.stringify(secondChunk),
          eventType: 'data',
          parsedJson: secondChunk,
        },
        {
          seq: 2,
          receivedAt: COMPLETED_AT,
          rawLine: doneLine,
          data: '[DONE]',
          eventType: 'done',
          parsedJson: null,
        },
      ],
      parsedChunks: [firstChunk, secondChunk],
      doneSeen: true,
      terminator: overrides.terminator || 'done_sentinel',
      finalBuffer: '',
      fullResponse: 'Visible answer',
      usage: secondChunk.usage,
    },
    error: overrides.error,
    outcome: overrides.outcome,
  };
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

test('buildLmStudioProviderCallPackage builds a complete non-stream package', () => {
  const envelope = buildLmStudioProviderCallPackage(buildNonStreamInput());

  assert.equal(envelope.captureVersion, 'provider-harness-lm-studio-v0.1');
  assert.equal(envelope.providerId, 'lm-studio');
  assert.equal(envelope.providerResearchId, 'lm-studio-openai-compatible');
  assert.equal(envelope.providerPathType, 'lm-studio-http-nonstream');
  assert.equal(envelope.callSite, 'lm-studio:parseEscalation');
  assert.equal(envelope.operation, 'parse-escalation');
  assert.equal(envelope.request, null);
  assert.equal(envelope.response, null);
  assert.equal(envelope.cli, null);
  assert.equal(envelope.lmStudio.mode, 'non-stream');
  assert.equal(envelope.lmStudio.request.modelRequested, 'google/gemma-4-e4b');
  assert.equal(envelope.lmStudio.request.stream, false);
  assert.equal(envelope.lmStudio.response.statusCode, 200);
  assert.equal(envelope.lmStudio.response.parsedJson.provider_extra_top_level.keep, true);
  assert.equal(envelope.outcome, 'success');
});

test('buildLmStudioProviderCallPackage builds a complete stream package', () => {
  const envelope = buildLmStudioProviderCallPackage(buildStreamInput());

  assert.equal(envelope.providerPathType, 'lm-studio-http-stream');
  assert.equal(envelope.callSite, 'lm-studio:chat');
  assert.equal(envelope.operation, 'chat');
  assert.equal(envelope.lmStudio.mode, 'stream');
  assert.equal(envelope.lmStudio.request.stream, true);
  assert.equal(envelope.lmStudio.response.statusCode, 200);
  assert.equal(envelope.lmStudio.response.parsedJson, null);
  assert.equal(envelope.lmStudio.stream.rawChunks.length, 1);
  assert.equal(envelope.lmStudio.stream.frames.length, 3);
  assert.equal(envelope.lmStudio.stream.parsedChunks.length, 2);
  assert.equal(envelope.lmStudio.stream.parsedChunks[0].choices[0].delta.reasoning_content, 'thinking token preserved');
  assert.equal(envelope.lmStudio.stream.doneSeen, true);
  assert.equal(envelope.lmStudio.stream.terminator, 'done_sentinel');
  assert.equal(envelope.outcome, 'success');
});

test('buildLmStudioProviderCallPackage classifies key outcomes', () => {
  const httpError = buildLmStudioProviderCallPackage(buildNonStreamInput({
    statusCode: 500,
    statusMessage: 'Internal Server Error',
    responseBodyText: '{"error":{"message":"model failed"}}',
  }));
  const invalidJson = buildLmStudioProviderCallPackage(buildNonStreamInput({
    responseBodyText: 'not-json',
  }));
  const networkError = buildLmStudioProviderCallPackage(buildNonStreamInput({
    error: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
  }));
  const timeout = buildLmStudioProviderCallPackage(buildNonStreamInput({
    error: Object.assign(new Error('request timed out'), { code: 'TIMEOUT' }),
  }));
  const aborted = buildLmStudioProviderCallPackage(buildNonStreamInput({
    error: Object.assign(new Error('request aborted'), { code: 'ABORT_ERR' }),
  }));
  const endWithoutDone = buildLmStudioProviderCallPackage(buildStreamInput({
    terminator: 'end_without_done',
  }));
  const malformedInput = buildStreamInput();
  malformedInput.stream.doneSeen = false;
  malformedInput.stream.terminator = '';
  malformedInput.stream.frames = [
    {
      seq: 0,
      receivedAt: STARTED_AT,
      rawLine: 'data: {"broken"',
      data: '{"broken"',
      eventType: 'data',
      parseError: new SyntaxError('Unexpected end of JSON input'),
    },
  ];
  malformedInput.stream.parsedChunks = [];
  const malformedSse = buildLmStudioProviderCallPackage(malformedInput);

  assert.equal(httpError.outcome, 'http_error');
  assert.equal(invalidJson.outcome, 'invalid_json');
  assert.equal(networkError.outcome, 'network_error');
  assert.equal(timeout.outcome, 'timeout');
  assert.equal(aborted.outcome, 'aborted');
  assert.equal(malformedSse.outcome, 'malformed_sse');
  assert.equal(endWithoutDone.outcome, 'stream_end_without_done');
});

test('recordLmStudioProviderCallPackage persists and redacts LM Studio packages', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const result = await recordLmStudioProviderCallPackage(buildNonStreamInput({
    headers: {
      Authorization: 'Bearer local-secret',
      'Proxy-Authorization': 'Basic proxy-secret',
      Cookie: 'sid=request-cookie',
    },
    body: {
      model: 'google/gemma-4-e4b',
      messages: [{ role: 'user', content: 'CASE: CS-123' }],
      stream: false,
      apiKey: 'request-secret',
    },
    responseHeaders: { 'set-cookie': 'sid=response-secret' },
  }), { log: false });

  assert.equal(result.ok, true);
  const saved = await ProviderCallPackage.findById(result.id).lean();
  assert.equal(saved.providerId, 'lm-studio');
  assert.equal(saved.lmStudio.request.headers.Authorization, 'Bearer [REDACTED]');
  assert.equal(saved.lmStudio.request.headers['Proxy-Authorization'], 'Basic [REDACTED]');
  assert.equal(saved.lmStudio.request.headers.Cookie, '[REDACTED]');
  assert.equal(saved.lmStudio.request.bodyJson.apiKey, '[REDACTED]');
  assert.equal(saved.lmStudio.request.bodyText.includes('request-secret'), false);
  assert.equal(saved.lmStudio.response.headers['set-cookie'], '[REDACTED]');
  assert.equal(saved.redaction.redactedHeaderNames.includes('authorization'), true);
  assert.equal(saved.redaction.redactedHeaderNames.includes('proxy-authorization'), true);
  assert.equal(saved.redaction.redactedHeaderNames.includes('cookie'), true);
  assert.equal(saved.redaction.redactedBodyPaths.includes('lmStudio.request.bodyJson.apiKey'), true);
});

test('recordLmStudioProviderCallPackage externalizes large LM Studio payloads without truncation', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const payloadRoot = path.join(os.tmpdir(), `qbo-lmstudio-payload-${Date.now()}`);
  const largeText = 'x'.repeat(256);
  const result = await recordLmStudioProviderCallPackage(buildStreamInput({
    terminator: 'done_sentinel',
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
    assert.equal(saved.lmStudio.request.bodyText, null);
    assert.ok(saved.lmStudio.request.bodyTextPayloadRef);
    assert.equal(saved.lmStudio.request.bodyJson, null);
    assert.equal(saved.lmStudio.request.bodyJsonPayloadRef.derivedFrom, 'lmStudio.request.bodyText');
    assert.equal(saved.lmStudio.response.bodyText, null);
    assert.ok(saved.lmStudio.response.bodyTextPayloadRef);
    assert.equal(saved.lmStudio.stream.parsedChunks, null);
    assert.ok(saved.lmStudio.stream.parsedChunksPayloadRef);

    const directRecord = buildLmStudioProviderCallPackage(buildNonStreamInput({
      body: {
        model: 'google/gemma-4-e4b',
        messages: [{ role: 'user', content: largeText }],
        stream: false,
      },
    }));
    assert.ok(directRecord.lmStudio.request.bodyText.includes(largeText));
  } finally {
    await fs.rm(payloadRoot, { recursive: true, force: true });
  }
});

test('recordLmStudioProviderCallPackageInBackground does not synchronously block on Mongo insert', async () => {
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
    const queued = recordLmStudioProviderCallPackageInBackground(buildNonStreamInput(), { log: false });
    assert.equal(queued.queued, true);
    assert.equal(createStarted, false);

    while (!createStarted) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    releaseCreate();
    await __waitForProviderPackageRecorderSettled();
    assert.equal(await ProviderCallPackage.countDocuments({ providerId: 'lm-studio' }), 1);
  } finally {
    ProviderCallPackage.create = originalCreate;
  }
});

test('recordLmStudioProviderCallPackage reports recorder failure without throwing', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const originalCreate = ProviderCallPackage.create;
  ProviderCallPackage.create = async function failingCreate() {
    throw new Error('lm studio mongo insert failed');
  };

  try {
    const result = await recordLmStudioProviderCallPackage(buildNonStreamInput(), { log: false });
    assert.equal(result.ok, false);
    assert.equal(result.error.message, 'lm studio mongo insert failed');
    assert.equal(await ProviderCallPackage.countDocuments({ providerId: 'lm-studio' }), 0);
  } finally {
    ProviderCallPackage.create = originalCreate;
  }
});
