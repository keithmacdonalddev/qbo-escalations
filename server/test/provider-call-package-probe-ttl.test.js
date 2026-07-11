'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const mongo = require('./_mongo-helper');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const {
  buildHttpProviderCallPackage,
  recordProviderCallPackage,
} = require('../src/services/provider-call-package-recorder');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Allow generous slack for slow CI: the stamp is computed at record time.
const TOLERANCE_MS = 60 * 1000;

function buildProbeEnvelope() {
  // Mirrors buildProviderStatusCaptureContext in image-parser.js — the probe
  // discriminator is operation 'provider-status'.
  return buildHttpProviderCallPackage({
    method: 'POST',
    baseUrl: 'https://generativelanguage.googleapis.com',
    urlPath: '/v1beta/models/gemini-3-flash-preview:generateContent',
    body: { contents: [] },
    captureContext: {
      providerId: 'gemini',
      providerResearchId: 'gemini-api',
      providerPathType: 'direct-http',
      callSite: 'image-parser:validateRemoteProvider:gemini',
      operation: 'provider-status',
      source: {
        file: 'server/src/services/image-parser.js',
        functionName: 'validateRemoteProvider',
        helperName: 'testRemoteProviderKey',
      },
    },
    response: { statusCode: 200, bodyText: '{}' },
  });
}

function buildChatEnvelope() {
  return buildHttpProviderCallPackage({
    method: 'POST',
    baseUrl: 'https://api.moonshot.ai',
    urlPath: '/v1/chat/completions',
    body: { model: 'kimi-k2.6', messages: [{ role: 'user', content: 'hello' }] },
    captureContext: {
      providerId: 'kimi',
      providerResearchId: 'kimi-api',
      providerPathType: 'direct-http',
      callSite: 'remote-api-providers:requestKimiChat',
      operation: 'chat',
    },
    response: { statusCode: 200, bodyText: '{"choices":[]}' },
  });
}

function assertExpiresWithin(saved, expectedFromNowMs) {
  assert.ok(saved.expiresAt instanceof Date, 'expiresAt should be a Date');
  const delta = saved.expiresAt.getTime() - Date.now();
  assert.ok(
    Math.abs(delta - expectedFromNowMs) < TOLERANCE_MS,
    `expiresAt should be ~${expectedFromNowMs}ms from now, got ${delta}ms`
  );
}

test.before(async () => {
  await mongo.connect();
});

test.after(async () => {
  await mongo.disconnect();
});

test.beforeEach(async () => {
  // The test runner injects ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE='false' as
  // the suite baseline — these tests need capture explicitly ON.
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  delete process.env.PROVIDER_PACKAGE_PROBE_TTL_HOURS;
  await ProviderCallPackage.deleteMany({});
});

test('probe package (operation provider-status) is stamped with the short default TTL (~24h)', async () => {
  const result = await recordProviderCallPackage(buildProbeEnvelope());
  assert.equal(result.ok, true);

  const saved = await ProviderCallPackage.findById(result.id).lean();
  assert.equal(saved.operation, 'provider-status');
  assertExpiresWithin(saved, 24 * HOUR_MS);
});

test('normal package (operation chat) keeps the model default retention, not the probe TTL', async () => {
  const result = await recordProviderCallPackage(buildChatEnvelope());
  assert.equal(result.ok, true);

  const saved = await ProviderCallPackage.findById(result.id).lean();
  assert.equal(saved.operation, 'chat');
  // The schema stamps every package with a default expiresAt of
  // PROVIDER_CALL_PACKAGE_TTL_DAYS (30 days when unset). The probe override
  // must NOT apply here.
  assertExpiresWithin(saved, 30 * DAY_MS);
});

test('PROVIDER_PACKAGE_PROBE_TTL_HOURS overrides the probe TTL without touching normal packages', async () => {
  process.env.PROVIDER_PACKAGE_PROBE_TTL_HOURS = '2';

  const probeResult = await recordProviderCallPackage(buildProbeEnvelope());
  assert.equal(probeResult.ok, true);
  const probeSaved = await ProviderCallPackage.findById(probeResult.id).lean();
  assertExpiresWithin(probeSaved, 2 * HOUR_MS);

  const chatResult = await recordProviderCallPackage(buildChatEnvelope());
  assert.equal(chatResult.ok, true);
  const chatSaved = await ProviderCallPackage.findById(chatResult.id).lean();
  assertExpiresWithin(chatSaved, 30 * DAY_MS);
});

test('invalid PROVIDER_PACKAGE_PROBE_TTL_HOURS falls back to the 24h default', async () => {
  process.env.PROVIDER_PACKAGE_PROBE_TTL_HOURS = 'not-a-number';

  const result = await recordProviderCallPackage(buildProbeEnvelope());
  assert.equal(result.ok, true);
  const saved = await ProviderCallPackage.findById(result.id).lean();
  assertExpiresWithin(saved, 24 * HOUR_MS);
});
