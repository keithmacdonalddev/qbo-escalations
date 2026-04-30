'use strict';

const assert = require('node:assert/strict');

const Conversation = require('../../../../server/src/models/Conversation');
const { registerProviderStub } = require('../../../../server/src/lib/harness-provider-gate');
const { resetProviderHealth } = require('../../../../server/src/services/provider-health');
const {
  buildSliceReport,
  createSeed,
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
const {
  CODEX_FALLBACK_PROVIDER_ID,
  makeFailingChatStub,
  makeFallbackChatStub,
  retryChatTurn,
  sendChatTurn,
  waitForConversationMessage,
  waitForConversationMessageCount,
} = require('../../../scripts/fixtures/chat');

const SLICE_ID = 'main-chat';
const MISSING_CONVERSATION_ID = '507f1f77bcf86cd799439011';

async function runSlice(context = {}) {
  return runWithHarness(context, async (harness) => {
    const startedAt = new Date();
    const seed = createSeed(SLICE_ID);
    const fallbackText = `Fallback response for ${seed}`;

    resetHarnessStubs();
    resetProviderHealth();

    const sendTurn = await sendChatTurn(harness.baseUrl, {
        message: `Main chat runner seed ${seed}`,
        primaryProvider: 'claude',
        mode: 'single',
    });
    const conversationId = sendTurn.conversationId;

    assert.ok(conversationId, 'expected chat start event to include conversationId');
    assert.equal(sendTurn.doneEvent.data.fallbackUsed, false);

    registerProviderStub('claude', 'chat', makeFailingChatStub(`Primary provider failed for ${seed}`));
    registerProviderStub('codex', 'chat', makeFallbackChatStub(fallbackText));
    resetProviderHealth();

    const retryTurn = await retryChatTurn(harness.baseUrl, {
      conversationId,
      mode: 'fallback',
      primaryProvider: 'claude',
      fallbackProvider: CODEX_FALLBACK_PROVIDER_ID,
    });

    const providerError = retryTurn.events.find((event) => event.event === 'provider_error') || null;
    const fallbackEvent = retryTurn.events.find((event) => event.event === 'fallback') || null;

    assert.ok(providerError, 'expected retry to emit provider_error');
    assert.ok(fallbackEvent, 'expected retry to emit fallback');
    assert.equal(retryTurn.doneEvent.data.providerUsed, CODEX_FALLBACK_PROVIDER_ID);
    assert.equal(retryTurn.doneEvent.data.fallbackUsed, true);
    assert.equal(retryTurn.doneEvent.data.fallbackFrom, 'claude');
    assert.equal(retryTurn.doneEvent.data.fullResponse, fallbackText);

    const conversation = await waitForConversationMessage(conversationId, fallbackText, {
      timeoutMs: 10_000,
      description: 'saved fallback chat response',
    });

    const convoRes = await requestJson(harness.baseUrl, `/api/conversations/${conversationId}`);
    assert.equal(convoRes.data.ok, true);
    assert.ok(Array.isArray(convoRes.data.conversation.messages));
    assert.ok(
      convoRes.data.conversation.messages.some((message) => message.content === fallbackText),
      'expected conversation fetch route to include the retry response'
    );

    const beforeRejectedConversationCount = await Conversation.countDocuments({
      createdAt: { $gte: startedAt },
    });
    const imageRejectRes = await requestJson(harness.baseUrl, '/api/chat', {
      method: 'POST',
      expectStatus: 400,
      json: {
        images: [SAMPLE_IMAGE_DATA_URL],
      },
    });
    assert.equal(imageRejectRes.data.code, 'CHAT_IMAGES_DISABLED');

    const afterRejectedConversationCount = await Conversation.countDocuments({
      createdAt: { $gte: startedAt },
    });
    assert.equal(
      afterRejectedConversationCount,
      beforeRejectedConversationCount,
      'expected image-only chat rejection to avoid creating a conversation'
    );

    const missingConversationRes = await requestJson(harness.baseUrl, '/api/chat', {
      method: 'POST',
      expectStatus: 404,
      json: {
        conversationId: MISSING_CONVERSATION_ID,
        message: `Missing conversation probe ${seed}`,
      },
    });
    assert.equal(missingConversationRes.data.code, 'NOT_FOUND');

    resetHarnessStubs();
    resetProviderHealth();

    const loadTurnOne = await sendChatTurn(harness.baseUrl, {
      message: `Load turn 1 for ${seed}`,
      provider: 'claude',
      mode: 'single',
    });
    const loadConversationId = loadTurnOne.conversationId;
    assert.ok(loadConversationId, 'expected load scenario to create a conversation id');

    const loadTurnTwo = await sendChatTurn(harness.baseUrl, {
      conversationId: loadConversationId,
      message: `Load turn 2 for ${seed}`,
      provider: 'claude',
      mode: 'single',
    });

    const loadTurnThree = await sendChatTurn(harness.baseUrl, {
      conversationId: loadConversationId,
      message: `Load turn 3 for ${seed}`,
      provider: 'claude',
      mode: 'single',
    });
    const loadConversation = await waitForConversationMessageCount(loadConversationId, 6, {
      timeoutMs: 10_000,
      description: 'multi-turn chat conversation persistence',
    });

    resetHarnessStubs();
    resetProviderHealth();

    const burstTurns = await Promise.all([
      sendChatTurn(harness.baseUrl, {
        message: `Concurrent burst A for ${seed}`,
        provider: 'claude',
        mode: 'single',
      }),
      sendChatTurn(harness.baseUrl, {
        message: `Concurrent burst B for ${seed}`,
        provider: 'claude',
        mode: 'single',
      }),
    ]);

    assert.ok(burstTurns[0].conversationId, 'expected concurrent burst turn A to create a conversation');
    assert.ok(burstTurns[1].conversationId, 'expected concurrent burst turn B to create a conversation');
    assert.notEqual(
      burstTurns[0].conversationId,
      burstTurns[1].conversationId,
      'expected concurrent burst turns to create distinct conversations'
    );

    const [burstConversationOne, burstConversationTwo] = await Promise.all([
      waitForConversationMessageCount(burstTurns[0].conversationId, 2, {
        timeoutMs: 10_000,
        description: 'concurrent burst conversation A persistence',
      }),
      waitForConversationMessageCount(burstTurns[1].conversationId, 2, {
        timeoutMs: 10_000,
        description: 'concurrent burst conversation B persistence',
      }),
    ]);

    const finishedAt = new Date();
    const report = buildSliceReport(SLICE_ID, {
      description: 'Exercises fallback, validation, missing-conversation, sequential load, and concurrent burst scenarios for the main chat surface.',
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      seed,
      baseUrl: harness.baseUrl,
      startupControls: harness.startupControls || null,
      fixtures: [
        {
          id: 'chat-send-then-retry-fallback',
          kind: 'workflow',
          description: 'POST /api/chat, then POST /api/chat/retry with a forced primary failure to verify provider_error + fallback SSE and conversation persistence.',
          ok: true,
          conversationId,
          assertions: {
            initialMode: sendTurn.startEvent.data.mode,
            retryFallbackFrom: retryTurn.doneEvent.data.fallbackFrom,
            retryProviderUsed: retryTurn.doneEvent.data.providerUsed,
            retryFallbackUsed: retryTurn.doneEvent.data.fallbackUsed,
            retryAttemptCount: Array.isArray(retryTurn.doneEvent.data.attempts) ? retryTurn.doneEvent.data.attempts.length : 0,
            providerErrorEventSeen: Boolean(providerError),
            fallbackEventSeen: Boolean(fallbackEvent),
            messageCount: conversation.messages.length,
          },
        },
        {
          id: 'chat-image-only-rejected',
          kind: 'validation',
          description: 'POST /api/chat with only images should reject and avoid creating a new conversation.',
          ok: true,
          assertions: {
            status: imageRejectRes.status,
            code: imageRejectRes.data.code,
            conversationCountStable: afterRejectedConversationCount === beforeRejectedConversationCount,
          },
        },
        {
          id: 'chat-existing-conversation-not-found',
          kind: 'failure',
          description: 'POST /api/chat with a valid but missing conversationId should return 404 NOT_FOUND.',
          ok: true,
          assertions: {
            status: missingConversationRes.status,
            code: missingConversationRes.data.code,
          },
        },
        {
          id: 'chat-sequential-three-turn-load',
          kind: 'load',
          description: 'POST /api/chat three times on one conversation to verify small sequential load and persistence growth.',
          ok: true,
          conversationId: loadConversationId,
          assertions: {
            firstProviderUsed: loadTurnOne.doneEvent.data.providerUsed,
            secondProviderUsed: loadTurnTwo.doneEvent.data.providerUsed,
            thirdProviderUsed: loadTurnThree.doneEvent.data.providerUsed,
            persistedMessageCount: loadConversation.messages.length,
          },
        },
        {
          id: 'chat-concurrent-two-conversation-burst',
          kind: 'load',
          description: 'POST /api/chat twice in parallel to verify concurrent conversation creation, distinct ids, and persistence.',
          ok: true,
          conversationIds: burstTurns.map((turn) => turn.conversationId),
          assertions: {
            distinctConversationIds: burstTurns[0].conversationId !== burstTurns[1].conversationId,
            firstProviderUsed: burstTurns[0].doneEvent.data.providerUsed,
            secondProviderUsed: burstTurns[1].doneEvent.data.providerUsed,
            firstConversationMessageCount: burstConversationOne.messages.length,
            secondConversationMessageCount: burstConversationTwo.messages.length,
          },
        },
      ],
      observability: {
        traces: await summarizeTraces({ since: startedAt, service: 'chat' }),
        usage: await summarizeUsage({ since: startedAt, service: 'chat' }),
      },
      notes: [
        `Conversation ${conversationId} contains the retry response "${fallbackText}".`,
        'Retry emitted provider_error and fallback SSE events before finishing on the codex fallback provider.',
        `Load conversation ${loadConversationId} persisted ${loadConversation.messages.length} messages across three turns.`,
        `Concurrent burst created ${burstTurns[0].conversationId} and ${burstTurns[1].conversationId} with persisted assistant replies in both conversations.`,
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
