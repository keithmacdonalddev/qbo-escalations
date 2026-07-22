'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const mongoose = require('mongoose');

const { connect, disconnect } = require('./_mongo-helper');
const AiTrace = require('../src/models/AiTrace');
const Conversation = require('../src/models/Conversation');
const ImageParseResult = require('../src/models/ImageParseResult');
const TriageResult = require('../src/models/TriageResult');
const { createApp } = require('../src/app');
const claude = require('../src/services/claude');
const codex = require('../src/services/codex');
const {
  EVIDENCE_CONTRACT_VERSION,
  evaluateEvidenceCompleteness,
} = require('../src/lib/evidence-completeness');
const { stampCaseIntakeEvidence } = require('../src/lib/case-intake');
const { conversationsRouter } = require('../src/routes/chat');

const NOW = new Date('2026-07-20T12:00:00.000Z');
const COMPLETED_AT = new Date('2026-07-20T11:50:00.000Z');

function makeRun(phase, provider, overrides = {}) {
  return {
    id: `${phase}-run`,
    phase,
    status: 'completed',
    provider,
    model: 'test-model',
    traceId: '000000000000000000000001',
    startedAt: new Date('2026-07-20T11:45:00.000Z'),
    completedAt: COMPLETED_AT,
    events: [{ kind: 'llm.thinking', data: { delta: 'Saved reasoning.' } }],
    eventCount: 1,
    detail: {},
    ...overrides,
  };
}

function makeCompleteFixture({ now = NOW } = {}) {
  const parseResultId = new mongoose.Types.ObjectId().toString();
  const triageResultId = new mongoose.Types.ObjectId().toString();
  const traceId = new mongoose.Types.ObjectId().toString();
  const requestId = `request-${new mongoose.Types.ObjectId()}`;
  const recordedAt = new Date(now.getTime() - 60_000);
  const runs = [
    makeRun('parse-template', 'openai', { traceId }),
    makeRun('known-issue-search', 'claude', { traceId }),
    makeRun('triage', 'claude', {
      traceId,
      detail: { providerPackageId: 'triage-package-1' },
    }),
    makeRun('analyst', 'claude', { traceId }),
  ];
  const conversation = {
    _id: new mongoose.Types.ObjectId(),
    createdAt: recordedAt,
    messages: [
      { role: 'user', content: 'Escalation input', traceRequestId: requestId },
      { role: 'assistant', content: 'Analyst answer', thinking: 'Analyst reasoning', traceRequestId: requestId },
    ],
    caseIntake: {
      status: 'analyst-complete',
      updatedAt: COMPLETED_AT,
      canonicalTemplate: 'COID/MID: 123\nCASE: 456',
      parseFields: { coid: '123', caseNumber: '456' },
      knownIssueSearchResult: { ok: true, status: 'no_reasonable_match' },
      triageCard: { severity: 'P3', category: 'payroll', read: 'Payroll issue' },
      runs,
      evidence: {
        contractVersion: EVIDENCE_CONTRACT_VERSION,
        updatedAt: recordedAt,
        receipts: {
          parser: {
            attempted: true,
            completed: true,
            contentProduced: true,
            canonicalTemplateSaved: true,
            parsedFieldsSaved: true,
            historySaveOk: true,
            resultId: parseResultId,
            providerPackageId: 'parser-package-1',
            provider: 'openai',
            recordedAt,
          },
          inv: {
            attempted: true,
            completed: true,
            resultSaved: true,
            provider: 'claude',
            packageCaptureEnabled: true,
            recordedAt,
          },
          triage: {
            planned: true,
            attempted: true,
            completed: true,
            cardSaved: true,
            resultSaveOk: true,
            savedResultId: triageResultId,
            standaloneRunId: 'standalone-triage-1',
            providerPackageId: 'triage-package-1',
            provider: 'claude',
            recordedAt,
          },
          analyst: {
            attempted: true,
            completed: true,
            messageSaved: true,
            thinkingCaptured: true,
            traceId,
            requestId,
            provider: 'claude',
            packageCaptureEnabled: true,
            completedAt: COMPLETED_AT,
            recordedAt,
          },
        },
      },
    },
  };
  return {
    conversation,
    imageParseResult: { _id: parseResultId, status: 'ok' },
    triageResult: { _id: triageResultId, runId: 'standalone-triage-1', status: 'success' },
    traces: [{ _id: traceId, requestId, status: 'ok' }],
  };
}

test('omitted or null evaluation time uses the current clock instead of the Unix epoch', () => {
  const before = Date.now();
  const results = [
    evaluateEvidenceCompleteness({ conversation: null }),
    evaluateEvidenceCompleteness({ conversation: null, now: null }),
  ];
  const after = Date.now();

  for (const result of results) {
    const checkedAt = new Date(result.checkedAt).getTime();
    assert.ok(checkedAt >= before);
    assert.ok(checkedAt <= after);
  }
});

function evaluate(fixture, now = NOW) {
  return evaluateEvidenceCompleteness({ ...fixture, now });
}

function artifactByCode(result, code) {
  return result.artifacts.find((item) => item.code === code);
}

test('complete successful pipeline reports complete with correct saved and expected counts', () => {
  const result = evaluate(makeCompleteFixture());

  assert.equal(result.status, 'complete');
  assert.equal(result.settled, true);
  assert.equal(result.contractVersion, 1);
  assert.deepEqual(result.summary.userResults, { savedCount: 5, expectedCount: 5 });
  assert.equal(result.summary.headline, 'Workflow complete — 5 of 5 expected results safely saved.');
  assert.equal(result.summary.supportingNote, '2 supporting records could not be verified.');
  assert.equal(result.summary.trusted.length, 5);
  assert.deepEqual(result.summary.trusted.filter((label) => result.summary.noRepeatNeeded.includes(label)), []);
  assert.deepEqual(result.missing, []);
  assert.equal(artifactByCode(result, 'INV_PROVIDER_PACKAGE').state, 'unverifiable');
  assert.equal(artifactByCode(result, 'ANALYST_PROVIDER_PACKAGE').state, 'unverifiable');
});

test('planned completed triage without a saved card is incomplete', () => {
  const fixture = makeCompleteFixture();
  fixture.conversation.caseIntake.triageCard = null;
  fixture.conversation.caseIntake.runs = fixture.conversation.caseIntake.runs
    .filter((run) => run.phase !== 'triage');
  fixture.conversation.caseIntake.evidence.receipts.triage.cardSaved = false;

  const result = evaluate(fixture);

  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.summary.userResults, { savedCount: 4, expectedCount: 5 });
  assert.equal(artifactByCode(result, 'TRIAGE_CARD').state, 'missing');
  assert.ok(result.missing.some((item) => item.code === 'TRIAGE_CARD'));
});

test('deferred triage inside the settling window remains unknown with pending artifacts', () => {
  const fixture = makeCompleteFixture();
  fixture.conversation.caseIntake.triageCard = null;
  fixture.conversation.caseIntake.runs = fixture.conversation.caseIntake.runs
    .filter((run) => run.phase !== 'triage');
  fixture.conversation.caseIntake.evidence.receipts.triage = {
    planned: true,
    recordedAt: new Date(NOW.getTime() - 30_000),
  };
  fixture.conversation.caseIntake.evidence.receipts.analyst.completedAt = new Date(NOW.getTime() - 30_000);
  fixture.triageResult = null;

  const result = evaluate(fixture);

  assert.equal(result.status, 'unknown');
  assert.equal(result.settled, false);
  assert.equal(result.settlingUntil, new Date(NOW.getTime() + 90_000).toISOString());
  assert.equal(artifactByCode(result, 'TRIAGE_CARD').state, 'pending');
  assert.equal(artifactByCode(result, 'TRIAGE_RUN').state, 'pending');
  assert.equal(artifactByCode(result, 'TRIAGE_RESULT').state, 'pending');
  assert.equal(artifactByCode(result, 'TRIAGE_PROVIDER_PACKAGE').state, 'pending');
  assert.equal(artifactByCode(result, 'TRIAGE_REASONING').state, 'pending');
});

test('parser history save failure is proven produced-not-saved evidence', () => {
  const fixture = makeCompleteFixture();
  fixture.conversation.caseIntake.evidence.receipts.parser.historySaveOk = false;
  fixture.conversation.caseIntake.evidence.receipts.parser.resultId = '';

  const result = evaluate(fixture);
  const parserHistory = artifactByCode(result, 'IMAGE_PARSE_RESULT');

  assert.equal(result.status, 'incomplete');
  assert.equal(parserHistory.state, 'missing');
  assert.equal(parserHistory.reason, 'produced-not-saved');
});

test('deliberately skipped triage and INV are not missing', () => {
  const fixture = makeCompleteFixture();
  fixture.conversation.caseIntake.knownIssueSearchResult = null;
  fixture.conversation.caseIntake.triageCard = null;
  fixture.conversation.caseIntake.runs = fixture.conversation.caseIntake.runs
    .filter((run) => !['known-issue-search', 'triage'].includes(run.phase));
  fixture.conversation.caseIntake.evidence.receipts.inv = {
    attempted: false,
    skipped: true,
    skipReason: 'PARSE_VALIDATION_FAILED',
  };
  fixture.conversation.caseIntake.evidence.receipts.triage = {
    planned: false,
    attempted: false,
    skipped: true,
    skipReason: 'Validation did not pass.',
  };
  fixture.triageResult = null;

  const result = evaluate(fixture);

  assert.equal(result.status, 'complete');
  assert.equal(artifactByCode(result, 'TRIAGE_CARD').state, 'not-applicable');
  assert.equal(artifactByCode(result, 'INV_SEARCH_RESULT').state, 'not-applicable');
  assert.equal(result.missing.some((item) => item.stage === 'triage'), false);
});

test('provider-mid-failure records honest failure without faking an answer artifact', () => {
  const fixture = makeCompleteFixture();
  fixture.conversation.caseIntake.status = 'failed';
  fixture.conversation.messages = fixture.conversation.messages.filter((message) => message.role !== 'assistant');
  const analystRun = fixture.conversation.caseIntake.runs.find((run) => run.phase === 'analyst');
  analystRun.status = 'failed';
  analystRun.detail = { code: 'PROVIDER_TIMEOUT', message: 'Provider timed out' };
  fixture.conversation.caseIntake.evidence.receipts.analyst = {
    attempted: true,
    completed: false,
    failed: true,
    messageSaved: false,
    thinkingCaptured: false,
    traceId: fixture.traces[0]._id,
    requestId: fixture.traces[0].requestId,
    provider: 'claude',
    errorCode: 'PROVIDER_TIMEOUT',
    completedAt: COMPLETED_AT,
  };

  const result = evaluate(fixture);
  const message = artifactByCode(result, 'ANALYST_MESSAGE');

  assert.equal(result.status, 'complete');
  assert.equal(message.state, 'not-applicable');
  assert.equal(message.reason, 'not-produced');
  assert.equal(artifactByCode(result, 'ANALYST_RUN').state, 'confirmed');
});

test('produced analyst answer whose final save failed is incomplete', () => {
  const fixture = makeCompleteFixture();
  fixture.conversation.caseIntake.status = 'failed';
  fixture.conversation.messages = fixture.conversation.messages.filter((message) => message.role !== 'assistant');
  const analystRun = fixture.conversation.caseIntake.runs.find((run) => run.phase === 'analyst');
  analystRun.status = 'failed';
  analystRun.detail = { code: 'ONDONE_SAVE_FAILED', message: 'Final save failed' };
  fixture.conversation.caseIntake.evidence.receipts.analyst = {
    attempted: true,
    completed: false,
    failed: true,
    contentProduced: true,
    messageSaved: false,
    traceId: fixture.traces[0]._id,
    requestId: fixture.traces[0].requestId,
    provider: 'claude',
    errorCode: 'ONDONE_SAVE_FAILED',
    completedAt: COMPLETED_AT,
  };

  const result = evaluate(fixture);
  const message = artifactByCode(result, 'ANALYST_MESSAGE');

  assert.equal(result.status, 'incomplete');
  assert.equal(message.state, 'missing');
  assert.equal(message.reason, 'produced-not-saved');
  assert.ok(result.missing.some((item) => item.code === 'ANALYST_MESSAGE'));
});

test('only a trace matching the current analyst receipt confirms AI trace evidence', () => {
  const fixture = makeCompleteFixture();
  fixture.traces = [{
    _id: new mongoose.Types.ObjectId().toString(),
    requestId: 'an-old-request',
    status: 'ok',
  }];

  const unmatched = evaluate(fixture);
  assert.equal(artifactByCode(unmatched, 'AI_TRACE').state, 'unverifiable');

  fixture.traces.push({
    _id: fixture.conversation.caseIntake.evidence.receipts.analyst.traceId,
    requestId: fixture.conversation.caseIntake.evidence.receipts.analyst.requestId,
    status: 'ok',
  });
  const matched = evaluate(fixture);
  assert.equal(artifactByCode(matched, 'AI_TRACE').state, 'confirmed');
});

test('acknowledgement applies only to the matching current finding fingerprint', () => {
  const fixture = makeCompleteFixture();
  fixture.conversation.caseIntake.triageCard = null;
  fixture.conversation.caseIntake.runs = fixture.conversation.caseIntake.runs
    .filter((run) => run.phase !== 'triage');
  fixture.conversation.caseIntake.evidence.receipts.triage.cardSaved = false;

  const beforeAck = evaluate(fixture);
  assert.equal(beforeAck.status, 'incomplete');
  assert.equal(beforeAck.acknowledged, false);

  fixture.conversation.caseIntake.evidence.acknowledgedAt = NOW;
  fixture.conversation.caseIntake.evidence.acknowledgedNote = 'Reviewed.';
  fixture.conversation.caseIntake.evidence.acknowledgedFingerprint = beforeAck.acknowledgementFingerprint;
  assert.equal(evaluate(fixture).acknowledged, true);

  fixture.conversation.caseIntake = stampCaseIntakeEvidence(
    fixture.conversation.caseIntake,
    {
      analyst: {
        attempted: true,
        completed: false,
        failed: true,
        contentProduced: true,
        messageSaved: false,
        errorCode: 'ONDONE_SAVE_FAILED',
        completedAt: new Date(NOW.getTime() + 60_000),
      },
    },
    { updatedAt: new Date(NOW.getTime() + 60_000) }
  );
  fixture.conversation.caseIntake.status = 'failed';
  fixture.conversation.messages = fixture.conversation.messages.filter((message) => message.role !== 'assistant');
  fixture.conversation.caseIntake.runs.find((run) => run.phase === 'analyst').status = 'failed';

  assert.deepEqual(
    fixture.conversation.caseIntake.evidence.acknowledgedFingerprint,
    beforeAck.acknowledgementFingerprint
  );
  const afterRetry = evaluate(fixture, new Date(NOW.getTime() + 5 * 60_000));
  assert.equal(afterRetry.status, 'incomplete');
  assert.equal(afterRetry.acknowledged, false);
  assert.ok(afterRetry.missing.some((item) => item.code === 'ANALYST_MESSAGE'));
});

test('reasoning capture unsupported by the actual provider is unverifiable, not incomplete', () => {
  const fixture = makeCompleteFixture();
  const analystRun = fixture.conversation.caseIntake.runs.find((run) => run.phase === 'analyst');
  analystRun.provider = 'llm-gateway';
  analystRun.events = [];
  fixture.conversation.messages.find((message) => message.role === 'assistant').thinking = '';
  fixture.conversation.caseIntake.evidence.receipts.analyst.provider = 'llm-gateway';
  fixture.conversation.caseIntake.evidence.receipts.analyst.thinkingCaptured = false;

  const result = evaluate(fixture);
  const reasoning = artifactByCode(result, 'ANALYST_REASONING');

  assert.equal(result.status, 'complete');
  assert.equal(reasoning.state, 'unverifiable');
  assert.equal(reasoning.reason, 'capture-unsupported');
});

test('receipt-proven provider package past retention is expired-likely, not incomplete', () => {
  const fixture = makeCompleteFixture();
  const oldDate = new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000);
  fixture.conversation.caseIntake.evidence.receipts.parser.recordedAt = oldDate;
  fixture.conversation.caseIntake.runs.find((run) => run.phase === 'parse-template').completedAt = oldDate;

  const result = evaluate(fixture);
  const providerPackage = artifactByCode(result, 'PARSER_PROVIDER_PACKAGE');

  assert.equal(result.status, 'complete');
  assert.equal(providerPackage.state, 'unverifiable');
  assert.equal(providerPackage.reason, 'evidence-expired-likely');
});

test('record expiresAt takes precedence over inferred retention', () => {
  const fixture = makeCompleteFixture();
  fixture.imageParseResult.expiresAt = new Date(NOW.getTime() - 1_000);

  const result = evaluate(fixture);
  const parserHistory = artifactByCode(result, 'IMAGE_PARSE_RESULT');

  assert.equal(parserHistory.state, 'unverifiable');
  assert.equal(parserHistory.reason, 'evidence-expired-likely');
});

test('missing history expiry uses the shared env-configured retention', () => {
  const originalTtl = process.env.IMAGE_PARSE_RESULT_TTL_DAYS;
  try {
    process.env.IMAGE_PARSE_RESULT_TTL_DAYS = '10';
    const fixture = makeCompleteFixture();
    const oldDate = new Date(NOW.getTime() - 11 * 24 * 60 * 60 * 1000);
    fixture.imageParseResult = null;
    fixture.conversation.caseIntake.evidence.receipts.parser.recordedAt = oldDate;
    fixture.conversation.caseIntake.runs.find((run) => run.phase === 'parse-template').completedAt = oldDate;

    const result = evaluate(fixture);
    const parserHistory = artifactByCode(result, 'IMAGE_PARSE_RESULT');
    assert.equal(parserHistory.state, 'unverifiable');
    assert.equal(parserHistory.reason, 'evidence-expired-likely');
  } finally {
    if (originalTtl === undefined) delete process.env.IMAGE_PARSE_RESULT_TTL_DAYS;
    else process.env.IMAGE_PARSE_RESULT_TTL_DAYS = originalTtl;
  }
});

test('legacy conversation without evidence receipts remains unknown', () => {
  const result = evaluateEvidenceCompleteness({
    conversation: {
      _id: new mongoose.Types.ObjectId(),
      caseIntake: {
        status: 'analyst-complete',
        runs: [makeRun('analyst', 'claude')],
      },
    },
    now: NOW,
  });

  assert.equal(result.status, 'unknown');
  assert.equal(result.settled, false);
  assert.deepEqual(result.missing, []);
  assert.equal(result.artifacts[0].reason, 'legacy-unknowable');
});

test('empty evidence receipts remain unknown', () => {
  const result = evaluateEvidenceCompleteness({
    conversation: {
      _id: new mongoose.Types.ObjectId(),
      caseIntake: {
        status: 'analyst-complete',
        runs: [makeRun('analyst', 'claude')],
        evidence: { contractVersion: EVIDENCE_CONTRACT_VERSION, receipts: {} },
      },
    },
    now: NOW,
  });

  assert.equal(result.status, 'unknown');
  assert.equal(result.artifacts[0].reason, 'legacy-unknowable');
});

test('analyst-only receipt with pipeline runs is unknown, while plain chat remains complete', () => {
  const fixture = makeCompleteFixture();
  const analystReceipt = fixture.conversation.caseIntake.evidence.receipts.analyst;
  fixture.conversation.caseIntake.evidence.receipts = { analyst: analystReceipt };

  const pipelineResult = evaluate(fixture);
  assert.equal(pipelineResult.status, 'unknown');
  assert.equal(artifactByCode(pipelineResult, 'PARSED_FIELDS').reason, 'legacy-unknowable');
  assert.equal(artifactByCode(pipelineResult, 'INV_SEARCH_RESULT').reason, 'legacy-unknowable');
  assert.equal(artifactByCode(pipelineResult, 'TRIAGE_CARD').reason, 'legacy-unknowable');

  const plainChat = makeCompleteFixture();
  plainChat.conversation.caseIntake.runs = plainChat.conversation.caseIntake.runs
    .filter((run) => run.phase === 'analyst');
  plainChat.conversation.caseIntake.canonicalTemplate = '';
  plainChat.conversation.caseIntake.parseFields = {};
  plainChat.conversation.caseIntake.knownIssueSearchResult = null;
  plainChat.conversation.caseIntake.triageCard = null;
  plainChat.conversation.caseIntake.evidence.receipts = {
    analyst: plainChat.conversation.caseIntake.evidence.receipts.analyst,
  };
  plainChat.imageParseResult = null;
  plainChat.triageResult = null;

  assert.equal(evaluate(plainChat).status, 'complete');
});

test('receipts that claim completed stages without runs are incomplete', () => {
  const fixture = makeCompleteFixture();
  fixture.conversation.caseIntake.runs = [];

  const result = evaluate(fixture);
  assert.equal(result.status, 'incomplete');
  assert.equal(artifactByCode(result, 'PARSER_RUN').state, 'missing');
  assert.equal(artifactByCode(result, 'ANALYST_RUN').state, 'missing');
});

test('failed standalone triage does not make a triage card look missing', () => {
  const fixture = makeCompleteFixture();
  fixture.conversation.caseIntake.triageCard = null;
  const triageRun = fixture.conversation.caseIntake.runs.find((run) => run.phase === 'triage');
  triageRun.status = 'failed';
  triageRun.detail = { code: 'TRIAGE_FAILED', message: 'Standalone triage failed.' };
  fixture.conversation.caseIntake.evidence.receipts.triage = {
    planned: true,
    attempted: true,
    completed: false,
    failed: true,
    cardSaved: false,
    standaloneRunId: 'failed-standalone-triage',
    errorCode: 'TRIAGE_FAILED',
    completedAt: COMPLETED_AT,
  };
  fixture.triageResult = null;

  const result = evaluate(fixture);
  assert.equal(artifactByCode(result, 'TRIAGE_CARD').state, 'not-applicable');
  assert.equal(result.missing.some((item) => item.code === 'TRIAGE_CARD'), false);
});

test('client-reported parser result id is not confirmed when no history row exists', () => {
  const fixture = makeCompleteFixture();
  fixture.imageParseResult = null;

  const result = evaluate(fixture);
  const parserHistory = artifactByCode(result, 'IMAGE_PARSE_RESULT');
  assert.equal(parserHistory.state, 'unverifiable');
  assert.match(parserHistory.explanation, /reported by the workflow, not independently confirmed/i);
});

test('re-evaluation is pure and identical for the same inputs and now', () => {
  const fixture = makeCompleteFixture();
  const before = JSON.stringify(fixture);
  const first = evaluate(fixture);
  const second = evaluate(fixture);

  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(fixture), before);
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationsRouter);
  return app;
}

function parseSseEvent(text, name) {
  const match = text.match(new RegExp(`event: ${name}\\s+data: (.+)`));
  return match ? JSON.parse(match[1]) : null;
}

async function seedCompleteConversation() {
  const fixture = makeCompleteFixture({ now: new Date() });
  const conversation = await Conversation.create({
    title: 'Evidence route session',
    provider: 'claude',
    messages: fixture.conversation.messages,
    caseIntake: fixture.conversation.caseIntake,
  });
  await ImageParseResult.create({
    _id: fixture.imageParseResult._id,
    provider: 'openai',
    model: 'test-model',
    status: 'ok',
    role: 'escalation',
    parsedText: 'COID/MID: 123\nCASE: 456',
  });
  await TriageResult.create({
    _id: fixture.triageResult._id,
    runId: fixture.triageResult.runId,
    status: 'success',
    provider: 'claude',
    model: 'test-model',
    card: fixture.conversation.caseIntake.triageCard,
  });
  await AiTrace.create({
    _id: fixture.traces[0]._id,
    requestId: fixture.traces[0].requestId,
    service: 'chat',
    route: '/api/chat',
    status: 'ok',
    conversationId: conversation._id,
  });
  return conversation;
}

test('evidence routes enrich without writes, acknowledge without falsifying, and list status', async () => {
  await connect();
  try {
    await Promise.all([
      AiTrace.deleteMany({}),
      Conversation.deleteMany({}),
      ImageParseResult.deleteMany({}),
      TriageResult.deleteMany({}),
    ]);
    const conversation = await seedCompleteConversation();
    const app = buildApp();
    const countsBefore = {
      traces: await AiTrace.countDocuments({}),
      conversations: await Conversation.countDocuments({}),
      parses: await ImageParseResult.countDocuments({}),
      triages: await TriageResult.countDocuments({}),
    };

    const first = await supertest(app).get(`/api/conversations/${conversation._id}/evidence`);
    const second = await supertest(app).get(`/api/conversations/${conversation._id}/evidence`);

    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.evidence.status, 'complete');
    assert.equal(second.body.evidence.status, 'complete');
    assert.deepEqual({
      traces: await AiTrace.countDocuments({}),
      conversations: await Conversation.countDocuments({}),
      parses: await ImageParseResult.countDocuments({}),
      triages: await TriageResult.countDocuments({}),
    }, countsBefore);

    const beforeAck = await Conversation.findById(conversation._id).lean();
    const ack = await supertest(app)
      .post(`/api/conversations/${conversation._id}/evidence/ack`)
      .send({ acknowledged: true, acknowledgedNote: 'Reviewed by the operator.' });
    const afterAck = await Conversation.findById(conversation._id).lean();

    assert.equal(ack.status, 200);
    assert.equal(ack.body.ok, true);
    assert.ok(ack.body.acknowledgement.acknowledgedAt);
    assert.equal(ack.body.acknowledgement.acknowledgedNote, 'Reviewed by the operator.');
    assert.deepEqual(
      ack.body.acknowledgement.fingerprint,
      afterAck.caseIntake.evidence.acknowledgedFingerprint
    );
    assert.deepEqual(afterAck.caseIntake.evidence.receipts, beforeAck.caseIntake.evidence.receipts);
    assert.equal(afterAck.caseIntake.status, beforeAck.caseIntake.status);

    const listed = await supertest(app).get('/api/conversations?includeTotal=0');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.conversations[0].evidenceStatus, 'complete');
  } finally {
    await disconnect();
  }
});

test('GET evidence treats a missing client-reported parser row as unverifiable', async () => {
  await connect();
  try {
    await Promise.all([
      AiTrace.deleteMany({}),
      Conversation.deleteMany({}),
      ImageParseResult.deleteMany({}),
      TriageResult.deleteMany({}),
    ]);
    const fixture = makeCompleteFixture({ now: new Date() });
    const conversation = await Conversation.create({
      title: 'Unverified parser receipt',
      provider: 'claude',
      messages: fixture.conversation.messages,
      caseIntake: fixture.conversation.caseIntake,
    });

    const response = await supertest(buildApp())
      .get(`/api/conversations/${conversation._id}/evidence`);
    const parserHistory = response.body.evidence.artifacts
      .find((item) => item.code === 'IMAGE_PARSE_RESULT');

    assert.equal(response.status, 200);
    assert.equal(parserHistory.state, 'unverifiable');
    assert.equal(parserHistory.reason, 'client-reported');
    assert.match(parserHistory.explanation, /reported by the workflow, not independently confirmed/i);
  } finally {
    await disconnect();
  }
});

test('POST /api/chat accepts bounded pipeline receipts and stamps server-owned INV and analyst receipts', async () => {
  const originalClaudeChat = claude.chat;
  const originalCodexChat = codex.chat;
  const originalCaptureFlag = process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
  await connect();
  try {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'false';
    await Promise.all([AiTrace.deleteMany({}), Conversation.deleteMany({})]);
    claude.chat = ({ onChunk, onDone }) => {
      onChunk?.('Analyst answer');
      onDone?.('Analyst answer');
      return () => {};
    };
    codex.chat = ({ onChunk, onDone }) => {
      onChunk?.('Codex answer');
      onDone?.('Codex answer');
      return () => {};
    };
    const canonicalTemplate = [
      'COID/MID: 9341452197744835',
      'CASE: 15154531492',
      'CLIENT/CONTACT: Doug Mckensie',
      'CX IS ATTEMPTING TO: Download a payroll XML file.',
      'EXPECTED OUTCOME: The full file downloads.',
      'ACTUAL OUTCOME: The summary is missing.',
      'KB/TOOLS USED: HELP PANEL, KB ARTICLES, GOOGLE, SCREEN SHARE.',
      'TRIED TEST ACCOUNT: n/a',
      'TS STEPS: Reproduced the missing summary.',
    ].join('\n');

    const response = await supertest(createApp())
      .post('/api/chat')
      .send({
        message: 'Review this escalation.',
        provider: 'claude',
        parsedEscalationText: canonicalTemplate,
        parsedEscalationSource: 'image-parser',
        parsedEscalationProvider: 'openai',
        parsedEscalationModel: 'test-parser-model',
        pipelineReceipts: {
          parser: {
            runId: `parser-${'x'.repeat(300)}`,
            historySaveOk: false,
            providerPackageId: 'parser-package-from-client',
            ignored: 'not stored',
          },
          triage: {
            planned: false,
            skipReason: 'Triage was deliberately disabled for this test.',
          },
          ignored: { value: true },
        },
      });

    assert.equal(response.status, 200);
    const done = parseSseEvent(response.text, 'done');
    assert.ok(done?.conversationId);
    const saved = await Conversation.findById(done.conversationId).lean();
    const receipts = saved.caseIntake.evidence.receipts;

    assert.equal(receipts.parser.runId.length, 160);
    assert.equal(receipts.parser.historySaveOk, false);
    assert.equal(receipts.parser.providerPackageId, 'parser-package-from-client');
    assert.equal(receipts.parser.ignored, undefined);
    assert.ok(receipts.inv);
    assert.equal(typeof receipts.inv.attempted, 'boolean');
    assert.equal(receipts.triage.planned, false);
    assert.equal(receipts.triage.skipped, true);
    assert.equal(receipts.analyst.messageSaved, true);
    assert.equal(receipts.analyst.requestId.length > 0, true);
    assert.equal(receipts.analyst.packageCaptureEnabled, false);
  } finally {
    claude.chat = originalClaudeChat;
    codex.chat = originalCodexChat;
    if (originalCaptureFlag === undefined) delete process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
    else process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = originalCaptureFlag;
    await disconnect();
  }
});
