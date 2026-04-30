'use strict';

const assert = require('node:assert/strict');

const {
  buildSliceReport,
  createSeed,
  requestJson,
  requestSse,
  requireEvent,
  requireTerminalEvent,
  resetHarnessStubs,
  writeReport,
} = require('../../../scripts/harness-runner-utils');
const { runWithHarness } = require('../../../scripts/fixtures/common');
const {
  createWorkspaceSession,
  waitForWorkspaceSessionStatus,
} = require('../../../scripts/fixtures/workspace');

const SLICE_ID = 'workspace-assistant';

async function runSlice(context = {}) {
  return runWithHarness(context, async (harness) => {
    const startedAt = new Date();
    const seed = createSeed(SLICE_ID);

    resetHarnessStubs();

    const createRes = await createWorkspaceSession(harness.baseUrl, {
      agentType: 'workspace',
      title: `Workspace runner ${seed}`,
      input: {
        prompt: `Summarize the current inbox and calendar context for runner ${seed} in one short paragraph.`,
        context: {
          view: 'stress-runner',
        },
      },
    });

    const sessionId = createRes.sessionId;
    assert.ok(sessionId, 'expected workspace session creation to return an id');

    const streamRes = await requestSse(harness.baseUrl, `/api/agents/sessions/${sessionId}/stream`, {
      query: { since: 0 },
      timeoutMs: 180_000,
    });

    const sessionEvent = requireEvent(streamRes.events, 'session');
    const startEvent = requireEvent(streamRes.events, 'start');
    const doneEvent = requireEvent(streamRes.events, 'done');
    requireTerminalEvent(streamRes.events);

    assert.equal(sessionEvent.data.id, sessionId);
    assert.ok(startEvent.data.conversationSessionId, 'expected workspace start event to include conversationSessionId');

    const finalSession = await waitForWorkspaceSessionStatus(harness.baseUrl, sessionId, 'done', {
      timeoutMs: 10_000,
      description: 'workspace agent session completion',
    });

    const historyRes = await requestJson(
      harness.baseUrl,
      `/api/workspace/conversation/${startEvent.data.conversationSessionId}`
    );
    assert.equal(historyRes.data.ok, true);
    assert.ok(Array.isArray(historyRes.data.messages));
    assert.ok(historyRes.data.messages.length >= 2, 'expected saved workspace conversation history');

    const unsupportedTypeRes = await requestJson(harness.baseUrl, '/api/agents/sessions', {
      method: 'POST',
      expectStatus: 400,
      json: {
        agentType: 'chat',
        title: `Unsupported runner ${seed}`,
        input: {
          prompt: 'This should be rejected.',
        },
      },
    });
    assert.equal(unsupportedTypeRes.data.code, 'UNSUPPORTED_AGENT_TYPE');

    const missingPromptRes = await requestJson(harness.baseUrl, '/api/agents/sessions', {
      method: 'POST',
      expectStatus: 400,
      json: {
        agentType: 'workspace',
        title: `Missing prompt ${seed}`,
        input: {},
      },
    });
    assert.equal(missingPromptRes.data.code, 'MISSING_PROMPT');

    const replayRes = await requestSse(harness.baseUrl, `/api/agents/sessions/${sessionId}/stream`, {
      query: { since: 1 },
      timeoutMs: 30_000,
    });
    const replaySessionEvent = requireEvent(replayRes.events, 'session');
    const replayDoneEvent = requireEvent(replayRes.events, 'done');
    assert.equal(replaySessionEvent.data.id, sessionId);
    assert.ok(
      !replayRes.events.some((event) => event.event === 'created'),
      'expected replay stream with since=1 to omit the created event'
    );

    const invalidProviderCreateRes = await createWorkspaceSession(harness.baseUrl, {
      agentType: 'workspace',
      title: `Invalid provider ${seed}`,
      input: {
        prompt: `Run invalid provider probe for ${seed}.`,
        provider: 'bad-provider',
      },
    });
    const invalidProviderSessionId = invalidProviderCreateRes.sessionId;
    assert.ok(invalidProviderSessionId, 'expected invalid-provider workspace session to be created');

    const invalidProviderFinal = await waitForWorkspaceSessionStatus(
      harness.baseUrl,
      invalidProviderSessionId,
      'error',
      {
        timeoutMs: 10_000,
        description: 'workspace invalid provider session failure',
      },
    );

    const invalidProviderStreamRes = await requestSse(
      harness.baseUrl,
      `/api/agents/sessions/${invalidProviderSessionId}/stream`,
      {
        query: { since: 0 },
        timeoutMs: 30_000,
      }
    );
    const invalidProviderErrorEvent = requireEvent(invalidProviderStreamRes.events, 'error');
    assert.equal(invalidProviderErrorEvent.data.code, 'INVALID_PROVIDER');

    const finishedAt = new Date();
    const report = buildSliceReport(SLICE_ID, {
      description: 'Exercises success, create-time validation, replay, and downstream workspace-route error propagation for shared workspace sessions.',
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      seed,
      baseUrl: harness.baseUrl,
      startupControls: harness.startupControls || null,
      fixtures: [
        {
          id: 'workspace-agent-session-stream',
          kind: 'sse',
          description: 'POST /api/agents/sessions, stream /api/agents/sessions/:id/stream, then verify /api/workspace/conversation/:sessionId history.',
          ok: true,
          sessionId,
          conversationSessionId: startEvent.data.conversationSessionId,
          assertions: {
            finalStatus: finalSession.session.status,
            eventCount: streamRes.events.length,
            historyMessageCount: historyRes.data.messages.length,
            responsePreview: String(doneEvent.data.fullResponse || '').slice(0, 120),
          },
        },
        {
          id: 'workspace-agent-session-create-validation',
          kind: 'validation',
          description: 'POST /api/agents/sessions should reject unsupported agent types and missing prompts.',
          ok: true,
          assertions: {
            unsupportedAgentTypeCode: unsupportedTypeRes.data.code,
            missingPromptCode: missingPromptRes.data.code,
          },
        },
        {
          id: 'workspace-agent-session-replay-since-seq',
          kind: 'replay',
          description: 'GET /api/agents/sessions/:id/stream?since=1 should replay later events without re-sending the created event.',
          ok: true,
          sessionId,
          assertions: {
            replayEventCount: replayRes.events.length,
            replayDonePreview: String(replayDoneEvent.data.fullResponse || '').slice(0, 120),
            replayOmittedCreated: !replayRes.events.some((event) => event.event === 'created'),
          },
        },
        {
          id: 'workspace-agent-session-invalid-provider-error',
          kind: 'failure',
          description: 'A workspace session with an invalid provider should transition to error and replay an INVALID_PROVIDER event.',
          ok: true,
          sessionId: invalidProviderSessionId,
          assertions: {
            finalStatus: invalidProviderFinal.session.status,
            errorCode: invalidProviderErrorEvent.data.code,
            lastError: invalidProviderFinal.session.lastError,
          },
        },
      ],
      notes: [
        `Workspace session ${sessionId} completed with conversation session ${startEvent.data.conversationSessionId}.`,
        `Workspace invalid-provider session ${invalidProviderSessionId} failed with ${invalidProviderErrorEvent.data.code}.`,
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
