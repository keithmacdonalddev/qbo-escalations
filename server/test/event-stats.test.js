'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const Conversation = require('../src/models/Conversation');
const { conversationsRouter } = require('../src/routes/chat');
const {
  getEventStats,
  sumCaseIntakeEvents,
} = require('../src/services/event-stats-service');
const { applyStageEventsToCaseIntake } = require('../src/lib/case-intake');

function makeRun(phase, status, eventCount) {
  return {
    id: `${phase}-${eventCount}`,
    agentId: phase,
    agentName: phase,
    phase,
    status,
    eventCount,
    events: [],
  };
}

function makeIntake(eventsByPhase) {
  return {
    status: 'analyst-complete',
    source: 'escalation-template-parser',
    runs: Object.entries(eventsByPhase).map(([phase, count]) => makeRun(phase, 'completed', count)),
    followUps: [],
  };
}

async function seed(eventsByPhase, updatedAtOffsetMs = 0) {
  const doc = new Conversation({
    title: 'test',
    provider: 'claude',
    messages: [],
    caseIntake: makeIntake(eventsByPhase),
  });
  await doc.save();
  // Force the desired updatedAt so sort ordering is deterministic.
  await Conversation.updateOne(
    { _id: doc._id },
    { $set: { updatedAt: new Date(Date.now() + updatedAtOffsetMs) } }
  );
  return doc;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationsRouter);
  return app;
}

test('event-stats: returns zeros when no conversations have runs', async () => {
  await connect();
  try {
    await Conversation.deleteMany({});
    const stats = await getEventStats();
    assert.equal(stats.totals.allTime, 0);
    assert.equal(stats.totals.perSession, 0);
    assert.equal(stats.totals.sessionCount, 0);
    assert.equal(stats.byStage.parser.avg, 0);
    assert.equal(stats.byStage.parser.samples, 0);
    assert.equal(stats.byStage.main.avg, 0);
  } finally {
    await disconnect();
  }
});

test('event-stats: averages per-stage event counts over recent completed runs', async () => {
  await connect();
  try {
    await Conversation.deleteMany({});
    await seed({ 'parse-template': 12, 'known-issue-search': 6, triage: 8, analyst: 30 }, -3000);
    await seed({ 'parse-template': 20, 'known-issue-search': 4, triage: 10, analyst: 40 }, -2000);
    await seed({ 'parse-template': 16, 'known-issue-search': 8, triage: 12, analyst: 50 }, -1000);

    const stats = await getEventStats();
    // (12 + 20 + 16) / 3 = 16
    assert.equal(stats.byStage.parser.avg, 16);
    assert.equal(stats.byStage.parser.samples, 3);
    // (6 + 4 + 8) / 3 = 6
    assert.equal(stats.byStage.inv.avg, 6);
    // (8 + 10 + 12) / 3 = 10
    assert.equal(stats.byStage.triage.avg, 10);
    // (30 + 40 + 50) / 3 = 40
    assert.equal(stats.byStage.main.avg, 40);
    // Per-session: (56 + 74 + 86) / 3 = 72
    assert.equal(stats.totals.sessionCount, 3);
    assert.equal(stats.totals.allTime, 56 + 74 + 86);
    assert.equal(stats.totals.perSession, 72);
  } finally {
    await disconnect();
  }
});

test('event-stats: GET /api/conversations/event-stats returns ok payload', async () => {
  await connect();
  try {
    await Conversation.deleteMany({});
    await seed({ 'parse-template': 10, 'known-issue-search': 5, triage: 7, analyst: 25 }, 0);

    const app = buildApp();
    const res = await supertest(app).get('/api/conversations/event-stats');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.byStage.parser.avg, 10);
    assert.equal(res.body.totals.allTime, 47);
    assert.equal(res.body.totals.sessionCount, 1);
  } finally {
    await disconnect();
  }
});

test('sumCaseIntakeEvents: tolerates legacy runs without eventCount and excludes ui-category events', async () => {
  const intake = {
    runs: [
      {
        phase: 'parse-template',
        status: 'completed',
        events: [
          { kind: 'llm.request', category: 'run' },
          { kind: 'parser.popup_opened', category: 'ui' },
          { kind: 'llm.response', category: 'run' },
        ],
      },
      { phase: 'analyst', status: 'completed', eventCount: 7 },
    ],
  };
  // 2 run events from parse-template (popup_opened excluded) + 7 from analyst = 9
  assert.equal(sumCaseIntakeEvents(intake), 9);
});

test('event-stats: ui-category events are excluded from moving average + totals', async () => {
  await connect();
  try {
    await Conversation.deleteMany({});
    // Three runs, each with the same eventCount=10 of mixed events. Of the
    // mixed events 4 are ui and 6 are run, so the legacy fallback path
    // should report 6 per stage (not 10).
    function mixedRun(phase) {
      const events = [
        { kind: 'llm.request', category: 'run', ts: 1, seq: 1 },
        { kind: 'parser.popup_opened', category: 'ui', ts: 2, seq: 2 },
        { kind: 'parser.popup_closed', category: 'ui', ts: 3, seq: 3 },
        { kind: 'llm.thinking', category: 'run', ts: 4, seq: 4 },
        { kind: 'parser.replay_skipped', category: 'ui', ts: 5, seq: 5 },
        { kind: 'llm.streaming', category: 'run', ts: 6, seq: 6 },
        { kind: 'chunk.first_token', category: 'run', ts: 7, seq: 7 },
        { kind: 'parser.popup_opened', category: 'ui', ts: 8, seq: 8 },
        { kind: 'llm.response', category: 'run', ts: 9, seq: 9 },
        { kind: 'stage.completed', category: 'run', ts: 10, seq: 10 },
      ];
      return {
        id: `${phase}-mixed`,
        agentId: phase,
        agentName: phase,
        phase,
        status: 'completed',
        events,
        // No eventCount set — exercises the legacy fallback path that must
        // filter UI events out.
      };
    }
    const phases = ['parse-template', 'known-issue-search', 'triage', 'analyst'];
    for (let i = 0; i < 3; i++) {
      const doc = new Conversation({
        title: 'mixed',
        provider: 'claude',
        messages: [],
        caseIntake: { status: 'analyst-complete', runs: phases.map(mixedRun), followUps: [] },
      });
      await doc.save();
      await Conversation.updateOne({ _id: doc._id }, { $set: { updatedAt: new Date(Date.now() - (3 - i) * 1000) } });
    }

    const stats = await getEventStats();
    // 6 run events per stage regardless of seeded eventCount.
    assert.equal(stats.byStage.parser.avg, 6);
    assert.equal(stats.byStage.inv.avg, 6);
    assert.equal(stats.byStage.triage.avg, 6);
    assert.equal(stats.byStage.main.avg, 6);
    // Each session: 4 phases x 6 run events = 24. Three sessions = 72.
    assert.equal(stats.totals.allTime, 72);
    assert.equal(stats.totals.perSession, 24);
    assert.equal(stats.totals.sessionCount, 3);
  } finally {
    await disconnect();
  }
});

test('applyStageEventsToCaseIntake: persists ui events but only increments eventCount for run events', () => {
  const initialIntake = {
    status: 'analyst-running',
    runs: [
      {
        id: 'parser-1',
        agentId: 'escalation-template-parser',
        phase: 'parse-template',
        status: 'completed',
        events: [],
        eventCount: 0,
      },
    ],
  };

  const result = applyStageEventsToCaseIntake(initialIntake, 'parser', [
    { kind: 'parser.popup_opened', category: 'ui', ts: 1, seq: 1, data: { via: 'card-click' } },
    { kind: 'llm.request', category: 'run', ts: 2, seq: 2, data: null },
    { kind: 'parser.popup_closed', category: 'ui', ts: 3, seq: 3, data: { via: 'tab-close' } },
    { kind: 'llm.response', category: 'run', ts: 4, seq: 4, data: null },
    { kind: 'stage.completed', category: 'run', ts: 5, seq: 5, data: { status: 'ok' } },
  ]);

  const run = result.runs.find((r) => r.phase === 'parse-template');
  // All 5 events stored for debugging.
  assert.equal(run.events.length, 5);
  // But only the 3 run-category events count toward the denominator.
  assert.equal(run.eventCount, 3);

  // Legacy events with no explicit category get auto-classified by kind.
  const next = applyStageEventsToCaseIntake(result, 'parser', [
    { kind: 'parser.popup_opened', ts: 6, seq: 6, data: null },
    { kind: 'llm.thinking', ts: 7, seq: 7, data: null },
  ]);
  const nextRun = next.runs.find((r) => r.phase === 'parse-template');
  assert.equal(nextRun.events.length, 7);
  // Previous count 3 + 1 new run event (llm.thinking) = 4. popup_opened
  // auto-classifies to 'ui' even without an explicit category.
  assert.equal(nextRun.eventCount, 4);
});
