'use strict';

// ---------------------------------------------------------------------------
// Pipeline KB-draft trigger tests
//
// Verifies the decoupled, status-INDEPENDENT auto-draft on-ramp:
//   1. Every pipeline-created escalation gets a KB draft regardless of status
//      (open / in-progress / resolved / escalated-further).
//   2. Draft creation is idempotent — re-triggering never duplicates (the
//      KnowledgeCandidate.escalationId unique index is the guarantee).
//   3. The status-gated finalized path (the "Finish this escalation" flow) is
//      unchanged: only resolved/escalated-further WITH a recorded outcome draft.
//   4. The fire-and-forget trigger wrapper creates a draft asynchronously.
//
// The KB-agent model pass is intentionally skipped in tests (NODE_ENV=test and
// KNOWLEDGEBASE_AGENT_MODEL_IN_TESTS unset), so these tests exercise the
// deterministic draft path with no CLI subprocess.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

const { connect, disconnect } = require('./_mongo-helper');
const Escalation = require('../src/models/Escalation');
const KnowledgeCandidate = require('../src/models/KnowledgeCandidate');
const EscalationAttentionItem = require('../src/models/EscalationAttentionItem');

const {
  ensureKnowledgeDraftForEscalation,
  ensureKnowledgeDraftForFinalizedEscalation,
} = require('../src/routes/escalations');
const {
  triggerKnowledgeDraftForEscalation,
} = require('../src/services/knowledgebase-draft-trigger');

process.env.NODE_ENV = 'test';

let counter = 0;
function makeEscalation(fields = {}) {
  counter += 1;
  return Escalation.create({
    category: 'payroll',
    status: 'open',
    caseNumber: `CASE-TRIG-${counter}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    coid: `COID-${counter}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    attemptingTo: 'Run a payroll adjustment for the client',
    actualOutcome: 'The adjustment did not post to the ledger',
    tsSteps: 'Checked the payroll settings; re-ran the adjustment',
    ...fields,
  });
}

test.before(async () => {
  await connect();
});

test.after(async () => {
  await disconnect();
});

test.beforeEach(async () => {
  process.env.NODE_ENV = 'test';
  delete process.env.KNOWLEDGEBASE_AGENT_MODEL_IN_TESTS;
  await Escalation.deleteMany({});
  await KnowledgeCandidate.deleteMany({});
  await EscalationAttentionItem.deleteMany({});
});

test('creates a KB draft for an OPEN pipeline escalation (no resolve-status gate)', async () => {
  const escalation = await makeEscalation({ status: 'open' });
  const result = await ensureKnowledgeDraftForEscalation(escalation, { enrich: false });

  assert.ok(result, 'expected a result');
  assert.equal(result.generated, true, 'a new draft should have been generated');

  const candidate = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  assert.ok(candidate, 'a KnowledgeCandidate should exist for the open escalation');
  assert.equal(candidate.reviewStatus, 'draft');
  // The draft is populated from the real case evidence, not left blank.
  assert.ok(candidate.title && candidate.title.length > 0, 'title should be filled from the case');
  assert.ok(
    candidate.reportedProblem || candidate.symptom,
    'reported problem should be filled from actualOutcome',
  );
  assert.equal(candidate.category, 'payroll', 'category should carry over from the case');
});

test('creates a KB draft for an IN-PROGRESS escalation', async () => {
  const escalation = await makeEscalation({ status: 'in-progress' });
  const result = await ensureKnowledgeDraftForEscalation(escalation, { enrich: false });
  assert.equal(result.generated, true);
  const count = await KnowledgeCandidate.countDocuments({ escalationId: escalation._id });
  assert.equal(count, 1);
});

test('creates a KB draft for an ESCALATED-FURTHER escalation', async () => {
  const escalation = await makeEscalation({
    status: 'escalated-further',
    resolution: 'Handed off to QBO payroll specialists with INV reference.',
  });
  const result = await ensureKnowledgeDraftForEscalation(escalation, { enrich: false });
  assert.equal(result.generated, true);
  const candidate = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  assert.ok(candidate);
});

test('is idempotent — re-triggering does not create a duplicate draft', async () => {
  const escalation = await makeEscalation({ status: 'open' });

  const first = await ensureKnowledgeDraftForEscalation(escalation, { enrich: false });
  assert.equal(first.generated, true, 'first call generates');

  const second = await ensureKnowledgeDraftForEscalation(escalation, { enrich: false });
  assert.equal(second.generated, false, 'second call must reuse the existing draft');

  const count = await KnowledgeCandidate.countDocuments({ escalationId: escalation._id });
  assert.equal(count, 1, 'exactly one draft should exist after two triggers');
});

test('does NOT regress the finalized (resolve-status) path: open case yields no finalized draft', async () => {
  const escalation = await makeEscalation({ status: 'open' });
  const result = await ensureKnowledgeDraftForFinalizedEscalation(escalation, {});
  assert.equal(result, null, 'finalized ensure should skip a non-final case');
  const count = await KnowledgeCandidate.countDocuments({ escalationId: escalation._id });
  assert.equal(count, 0, 'the finalized path must not draft an open case');
});

test('finalized path still drafts a resolved case with a recorded outcome (finish-form flow intact)', async () => {
  const escalation = await makeEscalation({
    status: 'resolved',
    resolution: 'Re-ran the payroll adjustment after clearing the cached settings.',
    resolutionNotes: 'Confirmed the ledger posted correctly.',
    resolvedAt: new Date(),
  });
  const result = await ensureKnowledgeDraftForFinalizedEscalation(escalation, {});
  assert.ok(result, 'finalized ensure should produce a draft for a resolved case');
  assert.equal(result.generated, true);
  const count = await KnowledgeCandidate.countDocuments({ escalationId: escalation._id });
  assert.equal(count, 1);
});

test('fire-and-forget trigger eventually creates a draft for a pipeline escalation', async () => {
  const escalation = await makeEscalation({ status: 'open' });

  triggerKnowledgeDraftForEscalation(escalation, { trigger: 'test.pipeline.auto-draft' });

  // The trigger is non-blocking; poll briefly for the background draft to land.
  let candidate = null;
  for (let i = 0; i < 50 && !candidate; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    candidate = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
    if (!candidate) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  assert.ok(candidate, 'the fire-and-forget trigger should have created a draft');
  assert.equal(candidate.reviewStatus, 'draft');
});
