'use strict';

// ---------------------------------------------------------------------------
// Finish-time deterministic resolution refresh (KB draft staleness fix)
//
// Drafts auto-create at pipeline intake with open-stage content. When the case
// is later finished with a resolution, refreshKnowledgeDraftWithResolution
// (wired into ensureKnowledgeDraftForFinalizedEscalation and the pipeline
// ensure path) folds the recorded resolution into the existing draft —
// deterministically, with NO model/provider calls — without ever clobbering
// human-reviewer or KB-agent edits (provenance via 'record.update' audit
// events) and without touching governance fields.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const Escalation = require('../src/models/Escalation');
const KnowledgeCandidate = require('../src/models/KnowledgeCandidate');
const EscalationAttentionItem = require('../src/models/EscalationAttentionItem');

const {
  ensureKnowledgeDraftForEscalation,
  ensureKnowledgeDraftForFinalizedEscalation,
  refreshKnowledgeDraftWithResolution,
} = require('../src/routes/escalations');
const { updateKnowledgeRecord } = require('../src/services/knowledgebase-management-service');

process.env.NODE_ENV = 'test';

const RESOLUTION_TEXT = 'Cleared the cached payroll settings and re-ran the adjustment; ledger posted correctly.';
const RESOLUTION_NOTES = 'Verified with the client on a follow-up call.';

let counter = 0;
function makeOpenEscalation(fields = {}) {
  counter += 1;
  return Escalation.create({
    category: 'payroll',
    status: 'open',
    caseNumber: `CASE-REFRESH-${counter}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    coid: `COID-${counter}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    attemptingTo: 'Run a payroll adjustment for the client',
    actualOutcome: 'The adjustment did not post to the ledger',
    tsSteps: 'Checked the payroll settings; re-ran the adjustment',
    ...fields,
  });
}

async function intakeDraftFor(escalation) {
  const result = await ensureKnowledgeDraftForEscalation(escalation, { enrich: false });
  assert.equal(result.generated, true, 'intake draft should generate');
  return KnowledgeCandidate.findOne({ escalationId: escalation._id });
}

async function finishEscalation(escalation, fields = {}) {
  escalation.status = 'resolved';
  escalation.resolution = RESOLUTION_TEXT;
  escalation.resolutionNotes = RESOLUTION_NOTES;
  escalation.resolvedAt = new Date();
  Object.assign(escalation, fields);
  await escalation.save();
  return escalation;
}

function governanceSnapshot(doc) {
  return {
    reviewStatus: doc.reviewStatus,
    publishTarget: doc.publishTarget,
    reusableOutcome: doc.reusableOutcome,
    trustStateOverride: doc.trustStateOverride,
    allowedUsesOverride: [...(doc.allowedUsesOverride || [])],
  };
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

// (a) Intake draft exists -> case finished with resolution -> previously-empty
// resolution-type fields are populated, and an audit entry records the refresh.
test('finish populates empty resolution fields on an existing intake draft', async () => {
  const escalation = await makeOpenEscalation();
  const draftBefore = await intakeDraftFor(escalation);
  assert.equal(draftBefore.finalOutcome, '', 'intake draft of an open case has no final outcome');
  assert.equal(draftBefore.exactFix, '', 'intake draft of an open case has no exact fix');
  assert.equal(draftBefore.sourceSnapshot.resolution, '', 'intake snapshot has no resolution');

  await finishEscalation(escalation);
  const result = await ensureKnowledgeDraftForFinalizedEscalation(escalation, { enrich: false });

  assert.ok(result, 'finalized ensure should return a result');
  assert.equal(result.generated, false, 'no new draft — the existing one is reused');
  assert.ok(result.resolutionRefresh, 'the refresh outcome is reported to the caller');
  assert.equal(result.resolutionRefresh.refreshed, true);
  assert.equal(result.resolutionRefresh.strategy, 'provenance');
  assert.ok(result.resolutionRefresh.updatedFields.includes('finalOutcome'));
  assert.ok(result.resolutionRefresh.updatedFields.includes('exactFix'));
  assert.deepEqual(result.resolutionRefresh.preservedFields, []);

  const draft = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  assert.equal(draft.finalOutcome, RESOLUTION_TEXT, 'finalOutcome now carries the recorded resolution');
  assert.equal(draft.exactFix, RESOLUTION_TEXT, 'exactFix mirrors the final outcome');
  assert.ok(draft.summary.includes('Final outcome:'), 'machine-owned summary refreshed with the outcome');
  assert.equal(draft.sourceSnapshot.status, 'resolved', 'source snapshot tracks the finished status');
  assert.equal(draft.sourceSnapshot.resolution, RESOLUTION_TEXT);
  assert.equal(draft.sourceSnapshot.resolutionNotes, RESOLUTION_NOTES);
  assert.ok(draft.sourceSnapshot.resolvedAt, 'source snapshot records resolvedAt');

  const refreshEvents = (draft.auditEvents || []).filter((e) => e.action === 'record.resolution-refresh');
  assert.equal(refreshEvents.length, 1, 'exactly one refresh audit event');
  assert.equal(refreshEvents[0].actor, 'knowledge-resolution-refresh');
  assert.equal(refreshEvents[0].role, 'system');
  assert.deepEqual(refreshEvents[0].metadata.preservedFields, []);
  assert.ok(refreshEvents[0].metadata.updatedFields.includes('finalOutcome'));

  const count = await KnowledgeCandidate.countDocuments({ escalationId: escalation._id });
  assert.equal(count, 1, 'still exactly one draft');
});

// (b) A human-edited field is NOT overwritten; the conflict is flagged via the
// attention-item pattern instead.
test('finish preserves human-edited fields and opens a reconcile attention item', async () => {
  const escalation = await makeOpenEscalation();
  const draft = await intakeDraftFor(escalation);

  const HUMAN_TEXT = 'Human-authored final outcome the reviewer wrote by hand.';
  await updateKnowledgeRecord(
    `candidate:${draft._id}`,
    { finalOutcome: HUMAN_TEXT },
    { actor: 'reviewer-jane', role: 'reviewer' }
  );

  await finishEscalation(escalation);
  const result = await ensureKnowledgeDraftForFinalizedEscalation(escalation, { enrich: false });

  assert.ok(result.resolutionRefresh, 'refresh ran');
  // sanitizeKnowledgePatch mirrors finalOutcome -> exactFix, so both are editor-owned.
  assert.ok(result.resolutionRefresh.preservedFields.includes('finalOutcome'));
  assert.ok(result.resolutionRefresh.preservedFields.includes('exactFix'));

  const after = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  assert.equal(after.finalOutcome, HUMAN_TEXT, 'human-edited finalOutcome is untouched');
  assert.equal(after.exactFix, HUMAN_TEXT, 'mirrored editor-owned exactFix is untouched');
  // Machine-owned fields still refresh, and the snapshot tracks reality.
  assert.ok(after.summary.includes('Final outcome:'), 'machine-owned summary still refreshed');
  assert.equal(after.sourceSnapshot.resolution, RESOLUTION_TEXT);

  const item = await EscalationAttentionItem.findOne({
    fingerprint: `knowledge-resolution-reconcile:${escalation._id}`,
  }).lean();
  assert.ok(item, 'a reconcile attention item exists');
  assert.equal(item.kind, 'knowledge-review');
  assert.equal(item.status, 'open');
  assert.equal(item.severity, 'warning');
  assert.ok(item.signals.includes('knowledge_resolution_reconcile'));
  assert.ok(item.metadata.preservedFields.includes('finalOutcome'));
});

// (b2) Lifecycle: once the reviewer reconciles, the attention item auto-closes.
test('reconcile attention item closes after the reviewer aligns the draft with the resolution', async () => {
  const escalation = await makeOpenEscalation();
  const draft = await intakeDraftFor(escalation);
  await updateKnowledgeRecord(
    `candidate:${draft._id}`,
    { finalOutcome: 'Hand-written outcome' },
    { actor: 'reviewer-jane', role: 'reviewer' }
  );
  await finishEscalation(escalation);
  await ensureKnowledgeDraftForFinalizedEscalation(escalation, { enrich: false });

  let item = await EscalationAttentionItem.findOne({
    fingerprint: `knowledge-resolution-reconcile:${escalation._id}`,
  }).lean();
  assert.equal(item.status, 'open', 'conflict flagged');

  // Reviewer reconciles by adopting the recorded resolution text.
  await updateKnowledgeRecord(
    `candidate:${draft._id}`,
    { finalOutcome: RESOLUTION_TEXT, exactFix: RESOLUTION_TEXT },
    { actor: 'reviewer-jane', role: 'reviewer' }
  );
  await ensureKnowledgeDraftForFinalizedEscalation(escalation, { enrich: false });

  item = await EscalationAttentionItem.findOne({
    fingerprint: `knowledge-resolution-reconcile:${escalation._id}`,
  }).lean();
  assert.equal(item.status, 'resolved', 'reconcile flag auto-closes once no conflict remains');
});

// (c) A case with NO draft finished -> draft still created exactly as today.
test('finish with no existing draft still creates one (existing behavior intact)', async () => {
  const escalation = await makeOpenEscalation({
    status: 'resolved',
    resolution: RESOLUTION_TEXT,
    resolutionNotes: RESOLUTION_NOTES,
    resolvedAt: new Date(),
  });

  const result = await ensureKnowledgeDraftForFinalizedEscalation(escalation, { enrich: false });
  assert.ok(result, 'a result is returned');
  assert.equal(result.generated, true, 'a fresh draft is generated');
  assert.equal(result.resolutionRefresh, undefined, 'no refresh when there was nothing to refresh');

  const draft = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  assert.ok(draft, 'draft exists');
  assert.equal(draft.finalOutcome, RESOLUTION_TEXT, 'generation itself folds the resolution in');
  const count = await KnowledgeCandidate.countDocuments({ escalationId: escalation._id });
  assert.equal(count, 1);
});

// (d) Governance fields are never written by the refresh.
test('refresh never touches governance fields', async () => {
  const escalation = await makeOpenEscalation();
  const draftBefore = await intakeDraftFor(escalation);
  const governanceBefore = governanceSnapshot(draftBefore);
  assert.equal(governanceBefore.reviewStatus, 'draft');
  assert.equal(governanceBefore.publishTarget, 'case-history-only', 'open-case intake draft is case-history-only');

  await finishEscalation(escalation);
  const result = await ensureKnowledgeDraftForFinalizedEscalation(escalation, { enrich: false });
  assert.equal(result.resolutionRefresh.refreshed, true, 'refresh applied content updates');

  const draftAfter = await KnowledgeCandidate.findOne({ escalationId: escalation._id });
  assert.deepEqual(
    governanceSnapshot(draftAfter),
    governanceBefore,
    'reviewStatus/publishTarget/reusableOutcome/trustStateOverride/allowedUsesOverride all unchanged'
  );
});

// Idempotency: re-finishing with identical data changes nothing and adds no audit noise.
test('refresh is idempotent — a second finish with the same data is a no-op', async () => {
  const escalation = await makeOpenEscalation();
  await intakeDraftFor(escalation);
  await finishEscalation(escalation);

  const first = await ensureKnowledgeDraftForFinalizedEscalation(escalation, { enrich: false });
  assert.equal(first.resolutionRefresh.refreshed, true);

  const second = await ensureKnowledgeDraftForFinalizedEscalation(escalation, { enrich: false });
  assert.equal(second.resolutionRefresh, undefined, 'second pass has nothing to refresh');

  const draft = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  const refreshEvents = (draft.auditEvents || []).filter((e) => e.action === 'record.resolution-refresh');
  assert.equal(refreshEvents.length, 1, 'still exactly one refresh audit event');
});

// Published drafts are locked — the refresh must not touch them.
test('refresh skips published drafts entirely', async () => {
  const escalation = await makeOpenEscalation();
  const draft = await intakeDraftFor(escalation);
  draft.reviewStatus = 'published';
  draft.publishedAt = new Date();
  await draft.save();
  const finalOutcomeBefore = draft.finalOutcome;

  await finishEscalation(escalation);
  const refresh = await refreshKnowledgeDraftWithResolution(escalation, { trigger: 'test.refresh' });
  assert.equal(refresh, null, 'published draft is never refreshed');

  const after = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  assert.equal(after.finalOutcome, finalOutcomeBefore, 'published content untouched');
  assert.equal(after.reviewStatus, 'published');
});

// Trigger-point wiring: the real finish routes fold the resolution in.
test('PATCH /api/escalations/:id finish flow refreshes the intake draft', async () => {
  const app = createApp();
  const escalation = await makeOpenEscalation();
  await intakeDraftFor(escalation);

  const res = await request(app)
    .patch(`/api/escalations/${escalation._id}`)
    .send({ status: 'resolved', resolution: RESOLUTION_TEXT, resolutionNotes: RESOLUTION_NOTES });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.knowledgeDraft, 'finish response still carries the knowledge draft');
  assert.equal(res.body.knowledgeDraft.resolutionRefresh.refreshed, true);

  const draft = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  assert.equal(draft.finalOutcome, RESOLUTION_TEXT);
  assert.equal(draft.sourceSnapshot.status, 'resolved');
});

test('POST /api/escalations/:id/transition refreshes the intake draft', async () => {
  const app = createApp();
  const escalation = await makeOpenEscalation();
  await intakeDraftFor(escalation);

  const res = await request(app)
    .post(`/api/escalations/${escalation._id}/transition`)
    .send({ status: 'resolved', resolution: RESOLUTION_TEXT });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.knowledgeDraftCreated, false, 'no duplicate draft created');
  assert.equal(res.body.knowledgeDraft.resolutionRefresh.refreshed, true);

  const draft = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  assert.equal(draft.finalOutcome, RESOLUTION_TEXT);
  assert.equal(draft.sourceSnapshot.resolution, RESOLUTION_TEXT);
});
