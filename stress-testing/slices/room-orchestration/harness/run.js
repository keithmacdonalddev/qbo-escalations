'use strict';

const assert = require('node:assert/strict');

const {
  buildSliceReport,
  createSeed,
  requestJson,
  resetHarnessStubs,
  writeReport,
} = require('../../../scripts/harness-runner-utils');
const { runWithHarness } = require('../../../scripts/fixtures/common');
const {
  createRoom,
  sendRoomTurn,
  waitForRoomAssistantCount,
} = require('../../../scripts/fixtures/rooms');

const SLICE_ID = 'room-orchestration';

async function runSlice(context = {}) {
  return runWithHarness(context, async (harness) => {
    const startedAt = new Date();
    const seed = createSeed(SLICE_ID);

    resetHarnessStubs();

    const createRes = await createRoom(harness.baseUrl, {
      title: `Room runner ${seed}`,
      activeAgents: ['chat', 'workspace'],
      settings: {
        orchestrationMode: 'all',
        maxRoundsPerTurn: 1,
      },
    });

    const roomId = createRes.roomId;
    assert.ok(roomId, 'expected room creation to return an id');

    const firstTurn = await sendRoomTurn(harness.baseUrl, roomId, {
        message: `Room runner seed ${seed}. Give a QBO issue take and include any inbox or calendar context that matters.`,
    });
    const roomRes = await waitForRoomAssistantCount(harness.baseUrl, roomId, 2, {
      timeoutMs: 10_000,
      description: 'persisted room messages',
    });
    const persistedAssistantCount = roomRes.assistantCount;

    const secondTurn = await sendRoomTurn(harness.baseUrl, roomId, {
      message: `Second room runner seed ${seed}. Keep the answer short but still let both agents speak.`,
    });
    const secondRoomRes = await waitForRoomAssistantCount(harness.baseUrl, roomId, 4, {
      timeoutMs: 10_000,
      description: 'second room turn persistence',
    });
    const secondPersistedAssistantCount = secondRoomRes.assistantCount;

    const missingContentRes = await requestJson(harness.baseUrl, `/api/rooms/${roomId}/send`, {
      method: 'POST',
      expectStatus: 400,
      json: {},
    });
    assert.equal(missingContentRes.data.code, 'MISSING_CONTENT');

    const invalidImageContextRes = await requestJson(harness.baseUrl, `/api/rooms/${roomId}/send`, {
      method: 'POST',
      expectStatus: 400,
      json: {
        parsedImageContext: {
          invalid: true,
        },
      },
    });
    assert.equal(invalidImageContextRes.data.code, 'INVALID_IMAGE_CONTEXT');

    const finishedAt = new Date();
    const report = buildSliceReport(SLICE_ID, {
      description: 'Exercises multi-agent room orchestration across two turns plus request-shape validation for missing content and invalid image context.',
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      seed,
      baseUrl: harness.baseUrl,
      startupControls: harness.startupControls || null,
      fixtures: [
        {
          id: 'room-send-all-agents',
          kind: 'sse',
          description: 'POST /api/rooms then POST /api/rooms/:id/send with orchestrationMode=all and verify multi-agent SSE + persistence.',
          ok: true,
          roomId,
          assertions: {
            roomDoneMessage: firstTurn.roomDoneEvent.data.message || '',
            uniqueAgentStartCount: firstTurn.uniqueAgentStartIds.size,
            uniqueAgentDoneCount: firstTurn.uniqueAgentDoneIds.size,
            agentDoneEventCount: firstTurn.agentDoneEvents.length,
            persistedAssistantCount,
            persistedMessageCount: roomRes.messageCount,
          },
        },
        {
          id: 'room-send-second-turn-load',
          kind: 'load',
          description: 'POST /api/rooms/:id/send a second time on the same room to verify another all-agent turn and persistence growth.',
          ok: true,
          roomId,
          assertions: {
            roomDoneMessage: secondTurn.roomDoneEvent.data.message || '',
            uniqueAgentStartCount: secondTurn.uniqueAgentStartIds.size,
            uniqueAgentDoneCount: secondTurn.uniqueAgentDoneIds.size,
            agentDoneEventCount: secondTurn.agentDoneEvents.length,
            persistedAssistantCount: secondPersistedAssistantCount,
            persistedMessageCount: secondRoomRes.messageCount,
          },
        },
        {
          id: 'room-send-missing-content-validation',
          kind: 'validation',
          description: 'POST /api/rooms/:id/send without a message, parsedImageContext, or systemInitiated should reject with MISSING_CONTENT.',
          ok: true,
          roomId,
          assertions: {
            status: missingContentRes.status,
            code: missingContentRes.data.code,
          },
        },
        {
          id: 'room-send-invalid-image-context-validation',
          kind: 'validation',
          description: 'POST /api/rooms/:id/send with a malformed parsedImageContext should reject with INVALID_IMAGE_CONTEXT.',
          ok: true,
          roomId,
          assertions: {
            status: invalidImageContextRes.status,
            code: invalidImageContextRes.data.code,
          },
        },
      ],
      notes: [
        `Room ${roomId} stored ${roomRes.messageCount} messages for the runner seed ${seed}.`,
        `Observed ${firstTurn.uniqueAgentDoneIds.size} unique agent_done event(s) and ${persistedAssistantCount} persisted assistant message(s).`,
        `Second turn pushed room ${roomId} to ${secondRoomRes.messageCount} total persisted message(s).`,
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
