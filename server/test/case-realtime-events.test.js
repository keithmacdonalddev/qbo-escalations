'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { connect, disconnect } = require('./_mongo-helper');
const Escalation = require('../src/models/Escalation');
const KnowledgeCandidate = require('../src/models/KnowledgeCandidate');
const {
  EVENT_LIMIT,
  getCaseEventWindow,
  getCaseRealtimeStatus,
  publishCaseEvent,
  resetCaseRealtimeEvents,
  subscribeCaseEvents,
} = require('../src/services/case-realtime-events');

test.before(async () => {
  await connect();
});

test.after(async () => {
  resetCaseRealtimeEvents();
  await disconnect();
});

test.beforeEach(async () => {
  await Promise.all([
    Escalation.deleteMany({}),
    KnowledgeCandidate.deleteMany({}),
  ]);
  resetCaseRealtimeEvents();
});

test('successful escalation and knowledge writes publish semantic post-write events', async () => {
  const events = [];
  const unsubscribe = subscribeCaseEvents((event) => events.push(event));

  const escalation = new Escalation({
    caseNumber: 'CASE-RT-1',
    category: 'payroll',
    attemptingTo: 'Correct a payroll filing',
  });
  await escalation.save();
  assert.equal(events.at(-1).type, 'escalation.created');
  assert.equal(events.at(-1).escalationId, escalation.id);

  await Escalation.findByIdAndUpdate(escalation._id, {
    $set: {
      status: 'resolved',
      resolution: 'Corrected the filing and confirmed the result.',
      resolvedAt: new Date(),
    },
  }, { returnDocument: 'after', runValidators: true });
  assert.equal(events.at(-1).type, 'escalation.status-changed');
  assert.ok(events.at(-1).changedFields.includes('status'));

  const knowledge = new KnowledgeCandidate({
    escalationId: escalation._id,
    title: 'Correct a payroll filing',
  });
  await knowledge.save();
  assert.equal(events.at(-1).type, 'knowledge.created');
  assert.equal(events.at(-1).escalationId, escalation.id);

  knowledge.reviewStatus = 'approved';
  await knowledge.save();
  assert.equal(events.at(-1).type, 'knowledge.approved');

  knowledge.reviewStatus = 'published';
  knowledge.publishedAt = new Date();
  await knowledge.save();
  assert.equal(events.at(-1).type, 'knowledge.published');

  knowledge.generation.model = 'realtime-regression-test';
  await knowledge.save();
  assert.equal(events.at(-1).type, 'knowledge.generated');

  await Escalation.findByIdAndDelete(escalation._id);
  assert.equal(events.at(-1).type, 'escalation.deleted');
  unsubscribe();
  assert.equal(getCaseRealtimeStatus().listenerCount, 0);
});

test('failed validation does not publish a success event', async () => {
  const before = getCaseRealtimeStatus().currentSeq;
  const invalid = new Escalation({ status: 'not-a-real-status' });
  await assert.rejects(() => invalid.save(), /valid enum value/i);
  assert.equal(getCaseRealtimeStatus().currentSeq, before);
});

test('event retention is bounded and stale cursors require a resync', () => {
  const escalationId = '507f1f77bcf86cd799439041';
  for (let index = 0; index < EVENT_LIMIT + 2; index += 1) {
    publishCaseEvent({
      entityType: 'escalation',
      entityId: escalationId,
      escalationId,
      action: 'updated',
    });
  }

  const status = getCaseRealtimeStatus();
  assert.equal(status.retainedEventCount, EVENT_LIMIT);
  assert.equal(getCaseEventWindow(1).replayAvailable, false);

  const available = getCaseEventWindow(status.oldestSeq - 1, { escalationId });
  assert.equal(available.replayAvailable, true);
  assert.equal(available.events.length, EVENT_LIMIT);
  assert.equal(new Set(available.events.map((event) => event.eventId)).size, EVENT_LIMIT);
});
