'use strict';

const assert = require('node:assert/strict');

const { registerProviderStub } = require('../../../../server/src/lib/harness-provider-gate');
const { resetProviderHealth } = require('../../../../server/src/services/provider-health');
const {
  buildSliceReport,
  createSeed,
  requestJson,
  requestSse,
  requireEvent,
  resetHarnessStubs,
  sleep,
  summarizeTraces,
  summarizeUsage,
  writeReport,
} = require('../../../scripts/harness-runner-utils');
const { runWithHarness } = require('../../../scripts/fixtures/common');
const {
  CODEX_FALLBACK_PROVIDER_ID,
  makeDelayedChatStub,
  makeFailingChatStub,
  makeFallbackChatStub,
  retryChatTurn,
  sendChatTurn,
} = require('../../../scripts/fixtures/chat');

const SLICE_ID = 'runtime-and-observability';

async function runSlice(context = {}) {
  return runWithHarness(context, async (harness) => {
    const startedAt = new Date();
    const seed = createSeed(SLICE_ID);
    const startedAtIso = startedAt.toISOString();

    resetHarnessStubs();
    resetProviderHealth();

    const delayedText = `Delayed runtime probe for ${seed}`;
    registerProviderStub('claude', 'chat', makeDelayedChatStub(delayedText));

    const delayedSsePromise = requestSse(harness.baseUrl, '/api/chat', {
      method: 'POST',
      json: {
        message: `Runtime health probe ${seed}`,
        primaryProvider: 'claude',
        mode: 'single',
      },
    });

    await sleep(250);

    const healthRes = await requestJson(harness.baseUrl, '/api/health');
    const runtimeDuringRes = await requestJson(harness.baseUrl, '/api/runtime/health');
    const providerCatalogRes = await requestJson(harness.baseUrl, '/api/health/providers');
    const activeChatRequestVisible = Array.isArray(runtimeDuringRes.data.requests?.requests)
      && runtimeDuringRes.data.requests.requests.some((request) => String(request.path || '').includes('/api/chat'));

    assert.equal(healthRes.data.ok, true);
    assert.ok(typeof healthRes.data.uptime === 'number');
    assert.equal(runtimeDuringRes.data.ok, true);
    assert.ok(activeChatRequestVisible, 'expected runtime health to expose the active /api/chat request');
    assert.ok(Array.isArray(providerCatalogRes.data.providers));
    assert.ok(providerCatalogRes.data.providers.some((provider) => provider.provider === 'claude'));

    const delayedResponse = await delayedSsePromise;
    const delayedStart = requireEvent(delayedResponse.events, 'start');
    const delayedDone = requireEvent(delayedResponse.events, 'done');

    assert.ok(delayedStart, 'expected delayed runtime probe to emit start');
    assert.ok(delayedDone, 'expected delayed runtime probe to emit done');
    assert.equal(delayedDone.data.providerUsed, 'claude');

    const runtimeAfterRes = await requestJson(harness.baseUrl, '/api/runtime/health');
    const activeChatRequestAfterCompletion = Array.isArray(runtimeAfterRes.data.requests?.requests)
      && runtimeAfterRes.data.requests.requests.some((request) => String(request.path || '').includes('/api/chat'));
    assert.equal(runtimeAfterRes.data.ok, true);
    assert.equal(activeChatRequestAfterCompletion, false);
    assert.equal(runtimeAfterRes.data.ai.totalActiveOperations, 0);

    resetHarnessStubs();
    resetProviderHealth();

    const chatSendRes = await sendChatTurn(harness.baseUrl, {
      message: `Runtime observability seed ${seed}`,
      primaryProvider: 'claude',
      mode: 'single',
    });
    const conversationId = chatSendRes.conversationId;
    assert.ok(conversationId, 'expected observability chat scenario to return a conversation id');

    registerProviderStub('claude', 'chat', makeFailingChatStub(`Runtime fallback failure for ${seed}`));
    registerProviderStub('codex', 'chat', makeFallbackChatStub(`Runtime fallback success for ${seed}`));
    resetProviderHealth();

    const retryRes = await retryChatTurn(harness.baseUrl, {
      conversationId,
      mode: 'fallback',
      primaryProvider: 'claude',
      fallbackProvider: CODEX_FALLBACK_PROVIDER_ID,
    });
    assert.equal(retryRes.doneEvent.data.fallbackUsed, true);
    assert.equal(retryRes.doneEvent.data.providerUsed, CODEX_FALLBACK_PROVIDER_ID);

    const usageSummaryRes = await requestJson(harness.baseUrl, '/api/usage/summary', {
      query: { dateFrom: startedAtIso },
    });
    const usageByServiceRes = await requestJson(harness.baseUrl, '/api/usage/by-service', {
      query: { dateFrom: startedAtIso },
    });
    const usageRecentRes = await requestJson(harness.baseUrl, '/api/usage/recent', {
      query: { dateFrom: startedAtIso, limit: 10 },
    });
    const usageConversationRes = await requestJson(harness.baseUrl, `/api/usage/conversation/${conversationId}`, {
      query: { dateFrom: startedAtIso },
    });
    const usageModelsRes = await requestJson(harness.baseUrl, '/api/usage/models', {
      query: { dateFrom: startedAtIso },
    });

    const tracesSummaryRes = await requestJson(harness.baseUrl, '/api/traces/summary', {
      query: { service: 'chat', dateFrom: startedAtIso },
    });
    const tracesRecentRes = await requestJson(harness.baseUrl, '/api/traces/recent', {
      query: { service: 'chat', dateFrom: startedAtIso, limit: 10 },
    });
    const firstTraceId = tracesRecentRes.data.recent[0].id;
    const traceDetailRes = await requestJson(harness.baseUrl, `/api/traces/${firstTraceId}`);
    const tracesConversationRes = await requestJson(harness.baseUrl, `/api/traces/conversation/${conversationId}`);
    const providerHealthRes = await requestJson(harness.baseUrl, '/api/health/providers');

    const chatServiceRow = usageByServiceRes.data.services.find((row) => row.service === 'chat') || null;
    const claudeHealth = providerHealthRes.data.providers.find((provider) => provider.provider === 'claude') || null;

    assert.equal(usageSummaryRes.data.ok, true);
    assert.ok(usageSummaryRes.data.summary.totalRequests >= 3);
    assert.ok(chatServiceRow && chatServiceRow.requests >= 3, 'expected chat service usage row');
    assert.ok(Array.isArray(usageRecentRes.data.recent) && usageRecentRes.data.recent.length >= 3);
    assert.ok(usageConversationRes.data.aggregate.totalRequests >= 2);
    assert.ok(Array.isArray(usageModelsRes.data.models) && usageModelsRes.data.models.length >= 1);

    assert.equal(tracesSummaryRes.data.ok, true);
    assert.ok(tracesSummaryRes.data.summary.totalTraces >= 2);
    assert.ok(tracesSummaryRes.data.summary.fallbackCount >= 1);
    assert.ok(Array.isArray(tracesRecentRes.data.recent) && tracesRecentRes.data.recent.length >= 2);
    assert.equal(traceDetailRes.data.ok, true);
    assert.equal(traceDetailRes.data.trace._id, firstTraceId);
    assert.ok(Array.isArray(tracesConversationRes.data.traces) && tracesConversationRes.data.traces.length >= 2);

    assert.ok(claudeHealth, 'expected provider health to include claude');
    assert.ok(claudeHealth.consecutiveFailures >= 1, 'expected claude provider health failure to be recorded');

    const usageInvalidDateRes = await requestJson(harness.baseUrl, '/api/usage/summary', {
      query: { dateFrom: 'not-a-date' },
      expectStatus: 400,
    });
    const tracesInvalidServiceRes = await requestJson(harness.baseUrl, '/api/traces/summary', {
      query: { service: 'workspace' },
      expectStatus: 400,
    });
    const usageInvalidIdRes = await requestJson(harness.baseUrl, '/api/usage/conversation/not-an-id', {
      expectStatus: 400,
    });
    const traceInvalidIdRes = await requestJson(harness.baseUrl, '/api/traces/not-an-id', {
      expectStatus: 400,
    });

    assert.equal(usageInvalidDateRes.data.code, 'INVALID_DATE');
    assert.equal(tracesInvalidServiceRes.data.code, 'INVALID_FILTER');
    assert.equal(usageInvalidIdRes.data.code, 'INVALID_ID');
    assert.equal(traceInvalidIdRes.data.code, 'INVALID_ID');

    const groupsRes = await requestJson(harness.baseUrl, '/api/test-runner/groups');
    const providerTestsRes = await requestJson(harness.baseUrl, '/api/test-runner/groups/provider/tests');
    const unknownGroupRes = await requestJson(harness.baseUrl, '/api/test-runner/groups/not-a-real-group/tests', {
      expectStatus: 404,
    });
    const providerGroup = groupsRes.data.groups.find((group) => group.id === 'provider') || null;
    const testRunRes = await requestSse(harness.baseUrl, '/api/test-runner/run', {
      method: 'POST',
      json: { group: 'provider' },
      timeoutMs: 600_000,
    });
    const runStart = requireEvent(testRunRes.events, 'run-start');
    const testPlan = requireEvent(testRunRes.events, 'test-plan');
    const testResult = requireEvent(testRunRes.events, 'test-result');
    const suiteComplete = requireEvent(testRunRes.events, 'suite-complete');
    const testResultEvents = testRunRes.events.filter((event) => event.event === 'test-result');

    assert.ok(providerGroup, 'expected provider group to exist in catalog');
    assert.ok(Array.isArray(providerTestsRes.data.files) && providerTestsRes.data.files.length >= 1);
    assert.equal(unknownGroupRes.data.code, 'UNKNOWN_GROUP');
    assert.equal(runStart.data.group, 'provider');
    assert.ok(testPlan.data.total > 0);
    assert.ok(typeof testResult.data.name === 'string' && testResult.data.name.length > 0);
    assert.equal(testPlan.data.total, providerGroup.testCount);
    assert.equal(testResultEvents.length, suiteComplete.data.total);
    assert.equal(suiteComplete.data.total, providerGroup.testCount);
    assert.equal(suiteComplete.data.passed + suiteComplete.data.failed + suiteComplete.data.skipped, suiteComplete.data.total);
    assert.ok(suiteComplete.data.durationMs >= 0);
    assert.ok([0, 1].includes(suiteComplete.data.exitCode));

    const finishedAt = new Date();
    const report = buildSliceReport(SLICE_ID, {
      description: 'Exercises runtime health, provider health, usage, traces, and test-runner endpoints through the real harnessed server surface.',
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      seed,
      baseUrl: harness.baseUrl,
      startupControls: harness.startupControls || null,
      fixtures: [
        {
          id: 'runtime-health-active-chat-probe',
          kind: 'health',
          description: 'Hold one delayed chat request open, then verify /api/health, /api/runtime/health, and /api/health/providers while the AI operation is active.',
          ok: true,
          assertions: {
            uptimeSeconds: healthRes.data.uptime,
            activeChatRequestVisible,
            totalActiveOperationsDuringRequest: runtimeDuringRes.data.ai.totalActiveOperations,
            activeChatRequestAfterCompletion,
            totalActiveOperationsAfterRequest: runtimeAfterRes.data.ai.totalActiveOperations,
            claudeProviderPresent: providerCatalogRes.data.providers.some((provider) => provider.provider === 'claude'),
          },
        },
        {
          id: 'usage-and-traces-route-roundtrip',
          kind: 'workflow',
          description: 'Generate chat usage + trace data, then verify usage summary/by-service/recent/conversation/models and traces summary/recent/conversation/detail plus provider health.',
          ok: true,
          conversationId,
          traceId: firstTraceId,
          assertions: {
            usageTotalRequests: usageSummaryRes.data.summary.totalRequests,
            chatServiceRequests: chatServiceRow ? chatServiceRow.requests : 0,
            usageConversationRequests: usageConversationRes.data.aggregate.totalRequests,
            tracesTotal: tracesSummaryRes.data.summary.totalTraces,
            tracesFallbackCount: tracesSummaryRes.data.summary.fallbackCount,
            claudeConsecutiveFailures: claudeHealth ? claudeHealth.consecutiveFailures : 0,
          },
        },
        {
          id: 'usage-and-traces-validation-failures',
          kind: 'validation',
          description: 'Verify invalid date, invalid trace filter, and malformed id handling on usage/traces routes.',
          ok: true,
          assertions: {
            usageInvalidDateCode: usageInvalidDateRes.data.code,
            tracesInvalidServiceCode: tracesInvalidServiceRes.data.code,
            usageInvalidIdCode: usageInvalidIdRes.data.code,
            traceInvalidIdCode: traceInvalidIdRes.data.code,
          },
        },
        {
          id: 'test-runner-catalog-and-provider-run',
          kind: 'sse',
          description: 'Verify test-runner catalog, provider group listing, unknown-group handling, and the provider group SSE lifecycle contract.',
          ok: true,
          assertions: {
            providerGroupTestCount: providerGroup ? providerGroup.testCount : 0,
            providerFileCount: providerTestsRes.data.files.length,
            unknownGroupCode: unknownGroupRes.data.code,
            plannedTestCount: testPlan.data.total,
            observedTestResultCount: testResultEvents.length,
            suitePassedCount: suiteComplete.data.passed,
            suiteFailedCount: suiteComplete.data.failed,
            suiteSkippedCount: suiteComplete.data.skipped,
            suiteTotal: suiteComplete.data.total,
            suiteExitCode: suiteComplete.data.exitCode,
          },
        },
      ],
      observability: {
        traces: await summarizeTraces({ since: startedAt, service: 'chat' }),
        usage: await summarizeUsage({ since: startedAt, service: 'chat' }),
      },
      notes: [
        `Runtime observability verified chat conversation ${conversationId} and trace ${firstTraceId}.`,
        `Focused provider test-runner SSE run completed with ${suiteComplete.data.total} result event(s) and exit code ${suiteComplete.data.exitCode}.`,
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
