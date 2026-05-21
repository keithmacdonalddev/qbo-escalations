'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const mongo = require('./_mongo-helper');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');

const STARTED_AT = '2026-05-21T12:00:00.000Z';
const COMPLETED_AT = '2026-05-21T12:00:01.000Z';

function buildBaseEnvelope(lmStudio, overrides = {}) {
  return {
    schemaVersion: '0.1',
    captureVersion: 'provider-harness-lm-studio-v0.1',
    providerId: 'lm-studio',
    providerResearchId: 'lm-studio-openai-compatible',
    providerPathType: lmStudio.mode === 'stream' ? 'lm-studio-http-stream' : 'lm-studio-http-nonstream',
    callSite: lmStudio.mode === 'stream' ? 'lm-studio:chat' : 'lm-studio:parseEscalation',
    operation: lmStudio.mode === 'stream' ? 'chat' : 'parse-escalation',
    source: {
      file: 'server/src/services/lm-studio.js',
      functionName: lmStudio.mode === 'stream' ? 'chat' : 'parseEscalation',
      helperName: lmStudio.mode === 'stream' ? 'http.request' : 'jsonRequest',
    },
    request: null,
    response: null,
    cli: null,
    lmStudio,
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

function buildRequest({ stream }) {
  const bodyJson = {
    model: 'google/gemma-4-e4b',
    messages: [
      {
        role: 'user',
        content: 'CASE: 123',
      },
    ],
    stream,
    temperature: stream ? 0.5 : 0.1,
    chat_template_kwargs: stream ? undefined : { enable_thinking: false },
  };
  const bodyText = JSON.stringify(bodyJson);
  return {
    method: 'POST',
    baseUrl: 'http://127.0.0.1:1234',
    url: 'http://127.0.0.1:1234/v1/chat/completions',
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: 1234,
    path: '/v1/chat/completions',
    urlPath: '/v1/chat/completions',
    headers: {
      'Content-Type': 'application/json',
      Accept: stream ? undefined : 'application/json',
    },
    redactedHeaderNames: [],
    bodyKind: 'json',
    bodyText,
    bodyJson,
    bodyByteLength: Buffer.byteLength(bodyText, 'utf8'),
    bodySha256: 'request-sha',
    modelRequested: 'google/gemma-4-e4b',
    stream,
    timeoutMs: 5000,
  };
}

function buildResponse(parsedJson, bodyText = JSON.stringify(parsedJson)) {
  return {
    received: true,
    statusCode: 200,
    statusMessage: 'OK',
    httpVersion: '1.1',
    headers: {
      'content-type': 'application/json',
      'x-lmstudio-runtime': 'llama.cpp',
    },
    redactedHeaderNames: [],
    rawHeaders: ['content-type', 'application/json', 'x-lmstudio-runtime', 'llama.cpp'],
    trailers: {},
    rawTrailers: [],
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
  };
}

function buildNonStreamLmStudioPackage() {
  const parsedJson = {
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
          reasoning_content: 'internal reasoning preserved as provider output',
          provider_extra_message_field: {
            keep: true,
          },
        },
        finish_reason: 'stop',
        provider_extra_choice_field: 'kept',
      },
    ],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 6,
      total_tokens: 18,
      prompt_tokens_details: {
        cached_tokens: 4,
      },
    },
    provider_extra_top_level: {
      nested: ['kept'],
    },
  };

  return {
    mode: 'non-stream',
    request: buildRequest({ stream: false }),
    response: buildResponse(parsedJson),
    stream: null,
    error: null,
  };
}

function buildStreamLmStudioPackage() {
  const firstChunk = {
    id: 'chatcmpl-lmstudio-stream',
    object: 'chat.completion.chunk',
    created: 1779241765,
    model: 'google/gemma-4-e4b',
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          reasoning_content: 'thinking token that is not forwarded to UI',
          content: '',
        },
        finish_reason: null,
        provider_extra_delta_field: 'kept',
      },
    ],
  };
  const secondChunk = {
    id: 'chatcmpl-lmstudio-stream',
    object: 'chat.completion.chunk',
    created: 1779241766,
    model: 'google/gemma-4-e4b',
    choices: [
      {
        index: 0,
        delta: {
          content: 'Visible answer',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 7,
      completion_tokens: 3,
      total_tokens: 10,
    },
  };
  const rawChunkText = `data: ${JSON.stringify(firstChunk)}\n\ndata: ${JSON.stringify(secondChunk)}\n\ndata: [DONE]\n\n`;

  return {
    mode: 'stream',
    request: buildRequest({ stream: true }),
    response: {
      ...buildResponse(null, rawChunkText),
      headers: {
        'content-type': 'text/event-stream',
      },
      rawHeaders: ['content-type', 'text/event-stream'],
      parsedJson: null,
      jsonParseError: null,
    },
    stream: {
      rawChunks: [
        {
          seq: 0,
          receivedAt: STARTED_AT,
          byteLength: Buffer.byteLength(rawChunkText, 'utf8'),
          sha256: 'stream-raw-chunk-sha',
          text: rawChunkText,
        },
      ],
      frames: [
        {
          seq: 0,
          receivedAt: STARTED_AT,
          rawLine: `data: ${JSON.stringify(firstChunk)}`,
          data: JSON.stringify(firstChunk),
          eventType: 'data',
          parsedJson: firstChunk,
          parseError: null,
        },
        {
          seq: 1,
          receivedAt: STARTED_AT,
          rawLine: `data: ${JSON.stringify(secondChunk)}`,
          data: JSON.stringify(secondChunk),
          eventType: 'data',
          parsedJson: secondChunk,
          parseError: null,
        },
        {
          seq: 2,
          receivedAt: COMPLETED_AT,
          rawLine: 'data: [DONE]',
          data: '[DONE]',
          eventType: 'done',
          parsedJson: null,
          parseError: null,
        },
      ],
      parsedChunks: [firstChunk, secondChunk],
      doneSeen: true,
      terminator: 'done_sentinel',
      finalBuffer: '',
      fullResponse: 'Visible answer',
      fullResponseByteLength: Buffer.byteLength('Visible answer', 'utf8'),
      fullResponseSha256: 'full-response-sha',
      usage: secondChunk.usage,
    },
    error: null,
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

test('ProviderCallPackage accepts a strict LM Studio non-stream package', async () => {
  const doc = await ProviderCallPackage.create(buildBaseEnvelope(buildNonStreamLmStudioPackage()));
  const saved = await ProviderCallPackage.findById(doc._id).lean();

  assert.equal(saved.providerId, 'lm-studio');
  assert.equal(saved.providerResearchId, 'lm-studio-openai-compatible');
  assert.equal(saved.providerPathType, 'lm-studio-http-nonstream');
  assert.equal(saved.callSite, 'lm-studio:parseEscalation');
  assert.equal(saved.lmStudio.mode, 'non-stream');
  assert.equal(saved.lmStudio.request.stream, false);
  assert.equal(saved.lmStudio.response.statusCode, 200);
  assert.equal(saved.lmStudio.response.parsedJson.provider_extra_top_level.nested[0], 'kept');
  assert.equal(saved.lmStudio.response.parsedJson.choices[0].message.provider_extra_message_field.keep, true);
});

test('ProviderCallPackage accepts a strict LM Studio stream package', async () => {
  const doc = await ProviderCallPackage.create(buildBaseEnvelope(buildStreamLmStudioPackage()));
  const saved = await ProviderCallPackage.findById(doc._id).lean();

  assert.equal(saved.providerPathType, 'lm-studio-http-stream');
  assert.equal(saved.callSite, 'lm-studio:chat');
  assert.equal(saved.lmStudio.mode, 'stream');
  assert.equal(saved.lmStudio.request.stream, true);
  assert.equal(saved.lmStudio.stream.rawChunks.length, 1);
  assert.equal(saved.lmStudio.stream.frames.length, 3);
  assert.equal(saved.lmStudio.stream.parsedChunks.length, 2);
  assert.equal(saved.lmStudio.stream.parsedChunks[0].choices[0].delta.reasoning_content, 'thinking token that is not forwarded to UI');
  assert.equal(saved.lmStudio.stream.frames[2].eventType, 'done');
  assert.equal(saved.lmStudio.stream.doneSeen, true);
  assert.equal(saved.lmStudio.stream.terminator, 'done_sentinel');
});

test('ProviderCallPackage rejects unknown fields inside strict LM Studio request schema', async () => {
  const lmStudio = buildNonStreamLmStudioPackage();
  lmStudio.request.unexpectedRequestField = 'must not save';

  await assert.rejects(
    ProviderCallPackage.create(buildBaseEnvelope(lmStudio)),
    /unexpectedRequestField/
  );
});

test('ProviderCallPackage rejects unknown fields inside strict LM Studio response schema', async () => {
  const lmStudio = buildNonStreamLmStudioPackage();
  lmStudio.response.unexpectedResponseField = 'must not save';

  await assert.rejects(
    ProviderCallPackage.create(buildBaseEnvelope(lmStudio)),
    /unexpectedResponseField/
  );
});

test('ProviderCallPackage rejects unknown fields inside strict LM Studio stream schema', async () => {
  const lmStudio = buildStreamLmStudioPackage();
  lmStudio.stream.unexpectedStreamField = 'must not save';

  await assert.rejects(
    ProviderCallPackage.create(buildBaseEnvelope(lmStudio)),
    /unexpectedStreamField/
  );
});
