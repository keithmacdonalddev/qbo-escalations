'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { connect, disconnect } = require('./_mongo-helper');
const EscalationAttentionItem = require('../src/models/EscalationAttentionItem');
const {
  appendAgentSessionEvent,
  createAgentSession,
  updateAgentSession,
} = require('../src/services/agent-session-runtime');
const {
  EVENT_LIMIT,
  getWorkCenterEventWindow,
  getWorkCenterStatus,
  getWorkItems,
  publishAiOperation,
  publishAttentionChange,
  removeWorkItem,
  resetWorkCenterEvents,
  subscribeWorkCenterEvents,
} = require('../src/services/work-center-events');

test.before(async () => {
  await connect();
});

test.after(async () => {
  resetWorkCenterEvents();
  await disconnect();
});

test.beforeEach(async () => {
  await EscalationAttentionItem.deleteMany({});
  resetWorkCenterEvents();
});

test('AI work snapshots expose safe progress without prompts, responses, or raw errors', () => {
  const events = [];
  const unsubscribe = subscribeWorkCenterEvents((event) => events.push(event));
  publishAiOperation({
    id: 'secret-test',
    kind: 'chat',
    action: 'chat-send',
    phase: 'streaming',
    provider: 'claude',
    conversationId: '507f1f77bcf86cd799439011',
    promptPreview: 'customer secret account number 1234',
    lastError: { message: 'private provider response' },
    stats: { fallbacks: 1 },
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, { reason: 'streaming' });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'work.changed');
  assert.equal(events[0].workItem.status, 'running');
  assert.equal(events[0].workItem.hasFallback, true);
  assert.equal(events[0].workItem.conversationId, '507f1f77bcf86cd799439011');
  const serialized = JSON.stringify(events[0]);
  assert.doesNotMatch(serialized, /account number|private provider response|1234/i);

  publishAiOperation({
    id: 'secret-test',
    kind: 'chat',
    phase: 'completed',
    provider: 'claude',
    stats: { fallbacks: 1 },
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, { reason: 'completed' });
  assert.equal(getWorkItems()[0].status, 'completed');
  assert.equal(removeWorkItem('ai:secret-test', { preserveTerminal: true }), null);
  assert.equal(getWorkItems().length, 1);
  unsubscribe();
  assert.equal(getWorkCenterStatus().listenerCount, 0);
});

test('successful Attention writes publish only after MongoDB confirms the saved change', async () => {
  const events = [];
  const unsubscribeFailingListener = subscribeWorkCenterEvents(() => {
    throw new Error('simulated publication listener failure');
  });
  const unsubscribe = subscribeWorkCenterEvents((event) => events.push(event));
  const item = await EscalationAttentionItem.create({
    kind: 'missing-resolution',
    fingerprint: 'work-center-attention-test',
    severity: 'warning',
    title: 'Resolution needs a final note',
  });

  assert.equal(events.at(-1).type, 'attention.changed');
  assert.equal(events.at(-1).action, 'created');
  assert.equal(events.at(-1).attention.id, item.id);
  assert.equal(events.at(-1).attention.status, 'open');

  await EscalationAttentionItem.findByIdAndUpdate(item._id, {
    $set: { status: 'resolved', resolvedAt: new Date() },
  }, { returnDocument: 'after', runValidators: true });
  assert.equal(events.at(-1).attention.status, 'resolved');
  assert.ok(events.at(-1).changedFields.includes('status'));

  const before = getWorkCenterStatus().currentSeq;
  await assert.rejects(() => EscalationAttentionItem.create({
    kind: 'not-a-real-kind',
    fingerprint: 'invalid-work-center-attention',
  }), /valid enum value/i);
  assert.equal(getWorkCenterStatus().currentSeq, before);

  await EscalationAttentionItem.findByIdAndDelete(item._id);
  assert.equal(events.at(-1).action, 'deleted');
  assert.equal(events.at(-1).attention.id, item.id);
  unsubscribeFailingListener();
  unsubscribe();
});

test('event history stays bounded and identifies replay gaps', () => {
  for (let index = 0; index < EVENT_LIMIT + 2; index += 1) {
    publishAttentionChange({ attentionItemId: `attention-${index}` }, { action: 'updated' });
  }
  const status = getWorkCenterStatus();
  assert.equal(status.retainedEventCount, EVENT_LIMIT);
  assert.equal(getWorkCenterEventWindow(1).replayAvailable, false);
  const available = getWorkCenterEventWindow(status.oldestSeq - 1);
  assert.equal(available.replayAvailable, true);
  assert.equal(available.events.length, EVENT_LIMIT);
  assert.equal(new Set(available.events.map((event) => event.eventId)).size, EVENT_LIMIT);
});

test('agent activity publishes meaningful phase changes without broadcasting streamed text chunks', () => {
  const session = createAgentSession({ agentType: 'workspace', title: 'Workspace Agent' });
  updateAgentSession(session.id, { status: 'running', metadata: { phase: 'planning', currentProvider: 'codex' } });
  const beforeChunk = getWorkCenterStatus().currentSeq;
  appendAgentSessionEvent(session.id, 'chunk', { text: 'private streamed response text' });
  assert.equal(getWorkCenterStatus().currentSeq, beforeChunk);
  assert.doesNotMatch(JSON.stringify(getWorkItems()), /private streamed response text/);

  appendAgentSessionEvent(session.id, 'done', { fullResponse: 'private final response' });
  const item = getWorkItems().find((entry) => entry.id === `agent:${session.id}`);
  assert.equal(item.status, 'completed');
  assert.doesNotMatch(JSON.stringify(item), /private final response/);
});
