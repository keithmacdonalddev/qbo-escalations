'use strict';

// Deferred triage persistence — closes the harness-rebuild gap where the
// standalone /api/triage result was never written to the conversation, so
// resumed sessions showed an eternally "Waiting" triage stage.
//
// The client POSTs the settled triage result to
// POST /api/conversations/:id/triage-result after both the triage stream and
// the analyst chat leg settle. These tests pin the route + merge contract:
// caseIntake.triageCard set, a phase:'triage' run with honest status and
// duration, stage events (incl. llm.thinking) appended with truthful
// eventCount, existing runs untouched, and re-posting replacing rather than
// duplicating the run. The phase string and card location must keep matching
// the client resume hydration (SAVED_RUN_PHASE_BY_STAGE_KEY.triage ===
// 'triage'; resolveTriageCard reads caseIntake.triageCard).

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const mongoose = require('mongoose');

const { connect, disconnect } = require('./_mongo-helper');
const Conversation = require('../src/models/Conversation');
const { conversationsRouter } = require('../src/routes/chat');

const TRIAGE_CARD = {
  severity: 'P2',
  category: 'payroll',
  confidence: 'high',
  read: 'Federal payroll tax overpayment is stuck in the payment center.',
  action: 'Verify the credit, then escalate to Payroll Support.',
  missingInfo: ['Exact tax period'],
  source: 'triage-agent',
  runtime: { provider: 'codex', model: 'gpt-5.5' },
};

const TRIAGE_META = {
  providerUsed: 'codex',
  model: 'gpt-5.5',
  providerPackageId: 'pkg-triage-123',
  elapsedMs: 8400,
};

const TRIAGE_EVENTS = [
  { kind: 'stage.started', category: 'run', ts: 1, seq: 1, data: { agentName: 'Triage Agent' } },
  { kind: 'llm.thinking', category: 'run', ts: 2, seq: 2, data: { delta: 'Weighing severity against the parsed template.' } },
  { kind: 'stage.completed', category: 'run', ts: 3, seq: 3, data: { status: 'success' } },
];

// Mirrors the shape recent pipeline sessions actually persist: parser + INV +
// analyst runs, no triage run, no triageCard (the gap under test).
function makePipelineIntake() {
  return {
    status: 'analyst-complete',
    source: 'escalation-template-parser',
    canonicalTemplate: 'CASE: 12345',
    parseFields: { caseNumber: '12345', coid: '999' },
    triageCard: null,
    followUps: [],
    runs: [
      { id: 'r1', agentId: 'escalation-template-parser', agentName: 'Image Parser', phase: 'parse-template', status: 'completed', durationMs: 11500, events: [], eventCount: 4 },
      { id: 'r2', agentId: 'known-issue-search-agent', agentName: 'INV Search Agent', phase: 'known-issue-search', status: 'completed', durationMs: 27500, events: [], eventCount: 6 },
      { id: 'r3', agentId: 'chat', agentName: 'QBO Assistant', phase: 'analyst', status: 'completed', durationMs: 50000, events: [], eventCount: 25 },
    ],
  };
}

async function seedConversation() {
  return Conversation.create({
    title: 'pipeline session',
    provider: 'claude',
    messages: [{ role: 'user', content: 'Escalation captured via screenshot.' }],
    caseIntake: makePipelineIntake(),
  });
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationsRouter);
  return app;
}

test('triage-result: persists card, run, duration, and events onto caseIntake', async () => {
  await connect();
  try {
    await Conversation.deleteMany({});
    const conversation = await seedConversation();
    const app = buildApp();

    const res = await supertest(app)
      .post(`/api/conversations/${conversation._id}/triage-result`)
      .send({
        triageCard: TRIAGE_CARD,
        triageMeta: TRIAGE_META,
        events: TRIAGE_EVENTS,
        durationMs: 8400,
        startedAt: Date.now() - 8400,
        completedAt: Date.now(),
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);

    const saved = await Conversation.findById(conversation._id).lean();
    const intake = saved.caseIntake;

    // Card lands where resolveTriageCard + resume hydration read it.
    assert.equal(intake.triageCard.severity, 'P2');
    assert.equal(intake.triageCard.category, 'payroll');

    // Run shape matches the other persisted stages and the client's
    // SAVED_RUN_PHASE_BY_STAGE_KEY.triage phase key.
    const triageRun = intake.runs.find((r) => r.phase === 'triage');
    assert.ok(triageRun, 'triage run was persisted');
    assert.equal(triageRun.status, 'completed');
    assert.equal(triageRun.agentId, 'triage-agent');
    assert.equal(triageRun.durationMs, 8400);
    assert.equal(triageRun.provider, 'codex');
    assert.equal(triageRun.model, 'gpt-5.5');
    assert.equal(triageRun.detail.providerPackageId, 'pkg-triage-123');
    assert.ok(triageRun.summary.includes('P2'), 'summary derives from the card');

    // Stage events (incl. llm.thinking for the resume reasoning chip) are
    // appended with a truthful run-category eventCount.
    assert.equal(triageRun.events.length, 3);
    assert.ok(triageRun.events.some((ev) => ev.kind === 'llm.thinking'));
    assert.equal(triageRun.eventCount, 3);

    // Existing runs and intake status are untouched.
    assert.equal(intake.runs.length, 4);
    assert.equal(intake.status, 'analyst-complete');
    assert.equal(intake.runs.find((r) => r.phase === 'parse-template').durationMs, 11500);
    assert.equal(intake.parseFields.caseNumber, '12345');
  } finally {
    await disconnect();
  }
});

test('triage-result: persists failures honestly (status failed + summary)', async () => {
  await connect();
  try {
    await Conversation.deleteMany({});
    const conversation = await seedConversation();
    const app = buildApp();

    const res = await supertest(app)
      .post(`/api/conversations/${conversation._id}/triage-result`)
      .send({
        error: { code: 'TRIAGE_TIMEOUT', message: 'Triage timed out after 120s' },
        events: [TRIAGE_EVENTS[0]],
        durationMs: 120000,
      });

    assert.equal(res.status, 200);
    const saved = await Conversation.findById(conversation._id).lean();
    const triageRun = saved.caseIntake.runs.find((r) => r.phase === 'triage');
    assert.ok(triageRun);
    assert.equal(triageRun.status, 'failed');
    assert.equal(triageRun.summary, 'Triage timed out after 120s');
    assert.equal(triageRun.durationMs, 120000);
    // No card was produced, so none is faked.
    assert.equal(saved.caseIntake.triageCard, null);
  } finally {
    await disconnect();
  }
});

test('triage-result: re-posting replaces the triage run instead of duplicating it', async () => {
  await connect();
  try {
    await Conversation.deleteMany({});
    const conversation = await seedConversation();
    const app = buildApp();

    await supertest(app)
      .post(`/api/conversations/${conversation._id}/triage-result`)
      .send({ error: { code: 'TRIAGE_FAILED', message: 'first attempt failed' } });
    await supertest(app)
      .post(`/api/conversations/${conversation._id}/triage-result`)
      .send({ triageCard: TRIAGE_CARD, triageMeta: TRIAGE_META, durationMs: 8400 });

    const saved = await Conversation.findById(conversation._id).lean();
    const triageRuns = saved.caseIntake.runs.filter((r) => r.phase === 'triage');
    assert.equal(triageRuns.length, 1);
    assert.equal(triageRuns[0].status, 'completed');
    assert.equal(saved.caseIntake.triageCard.severity, 'P2');
    // The other runs are still intact.
    assert.equal(saved.caseIntake.runs.length, 4);
  } finally {
    await disconnect();
  }
});

test('triage-result: fallback card persists with fallback flags intact', async () => {
  await connect();
  try {
    await Conversation.deleteMany({});
    const conversation = await seedConversation();
    const app = buildApp();

    const fallbackCard = {
      ...TRIAGE_CARD,
      fallback: { used: true, reason: 'Primary provider failed; rule fallback shown.', from: 'codex' },
    };
    await supertest(app)
      .post(`/api/conversations/${conversation._id}/triage-result`)
      .send({ triageCard: fallbackCard, durationMs: 5000 });

    const saved = await Conversation.findById(conversation._id).lean();
    const triageRun = saved.caseIntake.runs.find((r) => r.phase === 'triage');
    assert.equal(triageRun.status, 'completed');
    assert.equal(triageRun.fallbackUsed, true);
    assert.equal(triageRun.fallback.used, true);
    assert.equal(triageRun.fallback.reason, 'Primary provider failed; rule fallback shown.');
    assert.equal(saved.caseIntake.triageCard.fallback.used, true);
  } finally {
    await disconnect();
  }
});

test('triage-result: rejects empty payloads and unknown/invalid ids', async () => {
  await connect();
  try {
    await Conversation.deleteMany({});
    const conversation = await seedConversation();
    const app = buildApp();

    const empty = await supertest(app)
      .post(`/api/conversations/${conversation._id}/triage-result`)
      .send({});
    assert.equal(empty.status, 400);
    assert.equal(empty.body.ok, false);
    assert.equal(empty.body.code, 'TRIAGE_RESULT_EMPTY');

    const missing = await supertest(app)
      .post(`/api/conversations/${new mongoose.Types.ObjectId()}/triage-result`)
      .send({ triageCard: TRIAGE_CARD });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'NOT_FOUND');

    const invalid = await supertest(app)
      .post('/api/conversations/not-an-id/triage-result')
      .send({ triageCard: TRIAGE_CARD });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, 'INVALID_CONVERSATION_ID');

    // Nothing was written by the rejected requests.
    const saved = await Conversation.findById(conversation._id).lean();
    assert.equal(saved.caseIntake.runs.some((r) => r.phase === 'triage'), false);
  } finally {
    await disconnect();
  }
});
