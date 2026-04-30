'use strict';

const assert = require('node:assert/strict');

const { registerProviderStub } = require('../../../../server/src/lib/harness-provider-gate');
const ImageParseResult = require('../../../../server/src/models/ImageParseResult');
const { clearProviderAvailabilityCache } = require('../../../../server/src/services/image-parser');
const {
  DEFAULT_PARSE_TEXT,
  DEFAULT_PARSE_FIELDS,
} = require('../../../scripts/harness-provider-stubs');
const {
  buildSliceReport,
  createSeed,
  pollUntil,
  requestJson,
  resetHarnessStubs,
  summarizeTraces,
  summarizeUsage,
  writeReport,
} = require('../../../scripts/harness-runner-utils');
const {
  SAMPLE_IMAGE_DATA_URL,
  runWithHarness,
} = require('../../../scripts/fixtures/common');

const SLICE_ID = 'image-intake-and-parse';

async function runSlice(context = {}) {
  return runWithHarness(context, async (harness) => {
    const startedAt = new Date();
    const seed = createSeed(SLICE_ID);

    resetHarnessStubs();
    clearProviderAvailabilityCache();

    const statusRes = await requestJson(harness.baseUrl, '/api/image-parser/status', {
      query: { refresh: '1' },
    });
    assert.equal(statusRes.data.ok, true);
    assert.equal(statusRes.data.providers.openai.available, true);

    const beforeCount = await ImageParseResult.countDocuments({
      createdAt: { $gte: startedAt },
    });

    const parseRes = await requestJson(harness.baseUrl, '/api/image-parser/parse', {
      method: 'POST',
      json: {
        image: SAMPLE_IMAGE_DATA_URL,
        provider: 'openai',
        model: 'harness-stub-model',
      },
    });

    assert.equal(parseRes.data.ok, true);
    assert.equal(parseRes.data.text, DEFAULT_PARSE_TEXT);
    assert.equal(parseRes.data.parseFields.category, DEFAULT_PARSE_FIELDS.category);

    const savedRecord = await pollUntil(
      async () => ImageParseResult.findOne({
        createdAt: { $gte: startedAt },
        parsedText: DEFAULT_PARSE_TEXT,
        source: 'panel',
      }).sort({ createdAt: -1 }).lean(),
      {
        timeoutMs: 10_000,
        description: 'saved image parse result',
      }
    );

    const historyRes = await requestJson(harness.baseUrl, '/api/image-parser/history', {
      query: { limit: 5 },
    });
    assert.equal(historyRes.data.ok, true);
    assert.ok(historyRes.data.results.some((result) => String(result._id) === String(savedRecord._id)));

    const detailRes = await requestJson(harness.baseUrl, `/api/image-parser/history/${savedRecord._id}`);
    assert.equal(detailRes.data.ok, true);
    assert.equal(detailRes.data.result.parsedText, DEFAULT_PARSE_TEXT);

    const imageRes = await fetch(new URL(`/api/image-parser/history/${savedRecord._id}/image`, harness.baseUrl));
    assert.equal(imageRes.status, 200);
    assert.match(imageRes.headers.get('content-type') || '', /^image\//i);

    const missingImageRes = await requestJson(harness.baseUrl, '/api/image-parser/parse', {
      method: 'POST',
      expectStatus: 400,
      json: {
        provider: 'openai',
      },
    });
    assert.equal(missingImageRes.data.ok, false);
    assert.equal(missingImageRes.data.code, 'MISSING_IMAGE');

    registerProviderStub('openai', 'validateRemoteProvider', async () => ({
      ok: false,
      configured: true,
      available: false,
      code: 'PROVIDER_UNAVAILABLE',
      reason: `Forced provider outage for ${seed}`,
      detail: 'Harness forced provider outage',
      model: '',
      provider: 'openai',
      stub: true,
    }));
    clearProviderAvailabilityCache();

    const unavailableStatusRes = await requestJson(harness.baseUrl, '/api/image-parser/status', {
      query: { refresh: '1' },
    });
    assert.equal(unavailableStatusRes.data.ok, true);
    assert.equal(unavailableStatusRes.data.providers.openai.available, false);

    resetHarnessStubs();
    clearProviderAvailabilityCache();
    registerProviderStub('openai', 'parseImage', async () => {
      const err = new Error(`Forced image parse timeout for ${seed}`);
      err.code = 'TIMEOUT';
      throw err;
    });

    const timeoutRes = await requestJson(harness.baseUrl, '/api/image-parser/parse', {
      method: 'POST',
      expectStatus: 504,
      json: {
        image: SAMPLE_IMAGE_DATA_URL,
        provider: 'openai',
        model: 'harness-timeout-model',
      },
    });
    assert.equal(timeoutRes.data.ok, false);
    assert.equal(timeoutRes.data.code, 'TIMEOUT');

    const timeoutRecord = await pollUntil(
      async () => ImageParseResult.findOne({
        createdAt: { $gte: startedAt },
        errorCode: 'TIMEOUT',
      }).sort({ createdAt: -1 }).lean(),
      {
        timeoutMs: 10_000,
        description: 'saved image parse timeout result',
      }
    );

    const statsRes = await requestJson(harness.baseUrl, '/api/image-parser/stats');
    assert.equal(statsRes.data.ok, true);
    assert.ok(
      Array.isArray(statsRes.data.stats.recentErrors)
      && statsRes.data.stats.recentErrors.some((entry) => (
        String(entry._id) === String(timeoutRecord._id) || entry.errorCode === 'TIMEOUT'
      )),
      'expected image parser stats to include the forced timeout record'
    );

    const afterCount = await ImageParseResult.countDocuments({
      createdAt: { $gte: startedAt },
    });
    assert.ok(afterCount >= beforeCount + 2, 'expected image parse history count to increase for success + timeout runs');

    const finishedAt = new Date();
    const report = buildSliceReport(SLICE_ID, {
      description: 'Exercises success, validation, provider-availability, and timeout scenarios for the real image parser HTTP surface.',
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      seed,
      baseUrl: harness.baseUrl,
      startupControls: harness.startupControls || null,
      fixtures: [
        {
          id: 'panel-parse-history-roundtrip',
          kind: 'workflow',
          description: 'POST /api/image-parser/parse then verify DB persistence, /history, /history/:id, and archived image retrieval.',
          ok: true,
          createdRecordId: savedRecord._id.toString(),
          assertions: {
            providerAvailable: statusRes.data.providers.openai.available,
            parseCategory: parseRes.data.parseFields.category,
            archivedImageStatus: imageRes.status,
          },
        },
        {
          id: 'panel-parse-missing-image-validation',
          kind: 'validation',
          description: 'POST /api/image-parser/parse without an image should reject before touching persistence.',
          ok: true,
          assertions: {
            status: missingImageRes.status,
            code: missingImageRes.data.code,
          },
        },
        {
          id: 'panel-provider-status-refresh-unavailable',
          kind: 'status',
          description: 'GET /api/image-parser/status with a forced unavailable provider should surface openai as unavailable.',
          ok: true,
          assertions: {
            openaiAvailable: unavailableStatusRes.data.providers.openai.available,
            openaiReason: unavailableStatusRes.data.providers.openai.reason || '',
          },
        },
        {
          id: 'panel-parse-timeout-persists-error',
          kind: 'failure',
          description: 'POST /api/image-parser/parse with a forced timeout should return 504, persist an error record, and appear in /stats recentErrors.',
          ok: true,
          createdRecordId: timeoutRecord._id.toString(),
          assertions: {
            timeoutStatus: timeoutRes.status,
            timeoutCode: timeoutRes.data.code,
            statsRecentErrorCount: Array.isArray(statsRes.data.stats.recentErrors) ? statsRes.data.stats.recentErrors.length : 0,
          },
        },
      ],
      observability: {
        traces: await summarizeTraces({ since: startedAt, service: 'parse' }),
        usage: await summarizeUsage({ since: startedAt, service: 'parse' }),
      },
      notes: [
        `Saved parse record ${savedRecord._id.toString()} in the stress database.`,
        `Saved timeout record ${timeoutRecord._id.toString()} after forcing a provider timeout.`,
      ],
    });
    const paths = writeReport(SLICE_ID, report);
    report.paths = paths;
    return report;
  });
}

if (require.main === module) {
  runSlice().then((report) => {
    console.log(JSON.stringify({
      slice: report.slice,
      ok: report.ok,
      reportPath: report.paths.reportPath,
    }, null, 2));
    process.exit(report.ok ? 0 : 1);
  }).catch((err) => {
    console.error(err.stack || err);
    process.exit(1);
  });
}

module.exports = {
  SLICE_ID,
  runSlice,
};
