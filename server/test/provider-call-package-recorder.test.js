'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const mongo = require('./_mongo-helper');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const {
  buildHttpProviderCallPackage,
  isProviderCallPackageCaptureEnabled,
  recordProviderCallPackage,
} = require('../src/services/provider-call-package-recorder');

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

test('isProviderCallPackageCaptureEnabled defaults to false', () => {
  assert.equal(isProviderCallPackageCaptureEnabled(), false);
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  assert.equal(isProviderCallPackageCaptureEnabled(), true);
});

test('buildHttpProviderCallPackage builds request, response, timing, and outcome envelope', () => {
  const envelope = buildHttpProviderCallPackage({
    method: 'POST',
    baseUrl: 'https://api.moonshot.ai',
    urlPath: '/v1/chat/completions',
    body: { model: 'kimi-k2.5', messages: [{ role: 'user', content: 'hello' }] },
    headers: { Authorization: 'Bearer sk-test' },
    timeoutMs: 1234,
    requestStartedAt: '2026-05-20T12:00:00.000Z',
    responseCompletedAt: '2026-05-20T12:00:01.250Z',
    captureContext: {
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
    },
    response: {
      statusCode: 200,
      statusMessage: 'OK',
      httpVersion: '1.1',
      headers: { 'content-type': 'application/json' },
      rawHeaders: ['content-type', 'application/json'],
      bodyText: '{"model":"kimi-k2.5","choices":[]}',
    },
  });

  assert.equal(envelope.providerId, 'kimi');
  assert.equal(envelope.providerResearchId, 'kimi-api');
  assert.equal(envelope.providerPathType, 'direct-http');
  assert.equal(envelope.callSite, 'remote-api-providers:requestKimiChat');
  assert.equal(envelope.operation, 'chat');
  assert.equal(envelope.request.url, 'https://api.moonshot.ai/v1/chat/completions');
  assert.equal(envelope.request.bodyKind, 'json');
  assert.equal(envelope.request.bodyJson.model, 'kimi-k2.5');
  assert.equal(envelope.request.modelRequested, 'kimi-k2.5');
  assert.equal(envelope.response.statusCode, 200);
  assert.equal(envelope.response.parsedJson.model, 'kimi-k2.5');
  assert.equal(envelope.timing.durationMs, 1250);
  assert.equal(envelope.outcome, 'success');
});

test('recordProviderCallPackage skips when feature flag is disabled', async () => {
  const envelope = buildHttpProviderCallPackage({
    captureContext: {
      providerId: 'kimi',
      providerPathType: 'direct-http',
      callSite: 'test',
      operation: 'chat',
    },
    response: { statusCode: 200, bodyText: '{}' },
  });

  const result = await recordProviderCallPackage(envelope, { log: false });

  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'disabled');
  assert.equal(await ProviderCallPackage.countDocuments({}), 0);
});

test('recordProviderCallPackage saves redacted package when enabled', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const envelope = buildHttpProviderCallPackage({
    method: 'POST',
    baseUrl: 'https://api.moonshot.ai',
    urlPath: '/v1/chat/completions',
    body: { model: 'kimi-k2.5', accessToken: 'secret-token' },
    headers: { Authorization: 'Bearer sk-test' },
    captureContext: {
      providerId: 'kimi',
      providerResearchId: 'kimi-api',
      providerPathType: 'direct-http',
      callSite: 'test:kimi',
      operation: 'chat',
    },
    response: {
      statusCode: 401,
      statusMessage: 'Unauthorized',
      headers: { 'set-cookie': 'sid=secret' },
      rawHeaders: ['set-cookie', 'sid=secret'],
      bodyText: '{"error":"bad key"}',
    },
  });

  const result = await recordProviderCallPackage(envelope, { log: false });
  const saved = await ProviderCallPackage.findById(result.id).lean();

  assert.equal(result.ok, true);
  assert.equal(saved.providerId, 'kimi');
  assert.equal(saved.outcome, 'http_error');
  assert.equal(saved.request.headers.Authorization, 'Bearer [REDACTED]');
  assert.equal(saved.request.bodyJson.accessToken, '[REDACTED]');
  assert.equal(saved.request.bodyText.includes('secret-token'), false);
  assert.equal(saved.response.headers['set-cookie'], '[REDACTED]');
  assert.equal(saved.response.rawHeaders[1], '[REDACTED]');
  assert.equal(saved.storage.inline, true);
});
