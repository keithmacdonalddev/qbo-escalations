'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const mongo = require('./_mongo-helper');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const {
  __waitForProviderPackageRecorderSettled,
  buildGeminiApiProviderCallPackage,
  recordGeminiApiProviderCallPackage,
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

function buildGeminiInput(overrides = {}) {
  const responseObject = overrides.responseObject || {
    responseId: 'gemini-response-id',
    modelVersion: 'gemini-3-flash-preview',
    candidates: [
      {
        content: {
          parts: [{ text: 'COID/MID: 321\nCASE: CS-GEM-001' }],
        },
        finishReason: 'STOP',
        safetyRatings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'NEGLIGIBLE' }],
      },
    ],
    promptFeedback: { safetyRatings: [] },
    usageMetadata: {
      promptTokenCount: 33,
      candidatesTokenCount: 11,
      totalTokenCount: 44,
    },
  };
  const responseBodyText = overrides.responseBodyText !== undefined
    ? overrides.responseBodyText
    : JSON.stringify(responseObject);
  const body = overrides.body !== undefined
    ? overrides.body
    : {
        system_instruction: { parts: [{ text: 'Parse the screenshot.' }] },
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'Parse this image.' },
              {
                inline_data: {
                  mime_type: 'image/png',
                  data: 'aGVsbG8=',
                },
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 4096,
          responseMimeType: 'text/plain',
        },
      };

  return {
    method: 'POST',
    baseUrl: 'https://generativelanguage.googleapis.com',
    urlPath: '/v1beta/models/gemini-3-flash-preview:generateContent',
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
      providerId: 'gemini',
      providerResearchId: 'gemini-api',
      providerPathType: 'direct-http',
      callSite: overrides.callSite || 'image-parser:callGemini',
      operation: overrides.operation || 'image-parse',
      source: {
        file: 'server/src/services/image-parser.js',
        functionName: 'callGemini',
        helperName: 'sendGeminiGenerateContent',
      },
      modelRequested: 'gemini-3-flash-preview',
    },
    response: overrides.noResponse ? null : {
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

test('buildGeminiApiProviderCallPackage builds the Gemini API package shape', () => {
  const envelope = buildGeminiApiProviderCallPackage(buildGeminiInput());

  assert.equal(envelope.captureVersion, 'provider-harness-gemini-api-v0.1');
  assert.equal(envelope.providerId, 'gemini');
  assert.equal(envelope.providerResearchId, 'gemini-api');
  assert.equal(envelope.providerPathType, 'direct-http');
  assert.equal(envelope.callSite, 'image-parser:callGemini');
  assert.equal(envelope.operation, 'image-parse');
  assert.equal(envelope.request, null);
  assert.equal(envelope.response, null);
  assert.equal(envelope.cli, null);
  assert.equal(envelope.lmStudio, null);
  assert.equal(envelope.llmGateway, null);
  assert.equal(envelope.geminiApi.request.modelRequested, 'gemini-3-flash-preview');
  assert.equal(envelope.geminiApi.request.hasImages, true);
  assert.equal(envelope.geminiApi.request.images[0].mediaType, 'image/png');
  assert.equal(envelope.geminiApi.request.images[0].decodedByteLength, 5);
  assert.equal(envelope.geminiApi.response.responseId, 'gemini-response-id');
  assert.equal(envelope.geminiApi.response.modelVersion, 'gemini-3-flash-preview');
  assert.equal(envelope.geminiApi.response.usageMetadata.totalTokenCount, 44);
  assert.equal(envelope.outcome, 'success');
});

test('buildGeminiApiProviderCallPackage builds a provider-status package', () => {
  const envelope = buildGeminiApiProviderCallPackage(buildGeminiInput({
    callSite: 'image-parser:validateRemoteProvider:gemini',
    operation: 'provider-status',
  }));

  assert.equal(envelope.operation, 'provider-status');
  assert.equal(envelope.geminiApi.providerStatus.ok, true);
  assert.equal(envelope.geminiApi.providerStatus.authenticated, true);
  assert.equal(envelope.geminiApi.providerStatus.model, 'gemini-3-flash-preview');
});

test('buildGeminiApiProviderCallPackage classifies Gemini outcomes and Google errors', () => {
  const httpError = buildGeminiApiProviderCallPackage(buildGeminiInput({
    statusCode: 400,
    statusMessage: 'Bad Request',
    responseObject: {
      error: {
        code: 400,
        status: 'INVALID_ARGUMENT',
        message: 'Invalid request body',
        details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest' }],
      },
    },
  }));
  const invalidJson = buildGeminiApiProviderCallPackage(buildGeminiInput({
    responseBodyText: 'not-json',
  }));
  const networkError = buildGeminiApiProviderCallPackage(buildGeminiInput({
    noResponse: true,
    error: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
  }));
  const timeout = buildGeminiApiProviderCallPackage(buildGeminiInput({
    noResponse: true,
    error: Object.assign(new Error('request timed out'), { code: 'TIMEOUT' }),
  }));
  const aborted = buildGeminiApiProviderCallPackage(buildGeminiInput({
    noResponse: true,
    error: Object.assign(new Error('request aborted'), { code: 'ABORT_ERR' }),
  }));

  assert.equal(httpError.outcome, 'http_error');
  assert.equal(httpError.geminiApi.error.googleErrorCode, 400);
  assert.equal(httpError.geminiApi.error.googleErrorStatus, 'INVALID_ARGUMENT');
  assert.equal(httpError.geminiApi.error.googleErrorMessage, 'Invalid request body');
  assert.equal(invalidJson.outcome, 'invalid_json');
  assert.equal(networkError.outcome, 'network_error');
  assert.equal(timeout.outcome, 'timeout');
  assert.equal(aborted.outcome, 'aborted');
});

test('recordGeminiApiProviderCallPackage persists and redacts Gemini packages', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const result = await recordGeminiApiProviderCallPackage(buildGeminiInput({
    headers: {
      'x-goog-api-key': 'AIza-secret',
    },
    body: {
      apiKey: 'request-secret',
      contents: [{ parts: [{ text: 'keep prompt text' }] }],
    },
  }));

  assert.equal(result.ok, true);
  const saved = await ProviderCallPackage.findById(result.id).lean();

  assert.ok(saved);
  assert.equal(saved.request, null);
  assert.equal(saved.response, null);
  assert.equal(saved.llmGateway, null);
  assert.equal(saved.geminiApi.request.headers['x-goog-api-key'], '[REDACTED]');
  assert.equal(saved.geminiApi.request.bodyJson.apiKey, '[REDACTED]');
  assert.equal(saved.geminiApi.request.bodyText.includes('request-secret'), false);
  assert.equal(saved.geminiApi.response.responseId, 'gemini-response-id');
  assert.equal(saved.geminiApi.response.parsedJson.candidates[0].finishReason, 'STOP');
  assert.equal(saved.geminiApi.response.promptFeedback.safetyRatings.length, 0);
  assert.equal(saved.redaction.applied, true);
  assert.ok(saved.redaction.redactedHeaderNames.includes('x-goog-api-key'));
  assert.equal(saved.outcome, 'success');
});
