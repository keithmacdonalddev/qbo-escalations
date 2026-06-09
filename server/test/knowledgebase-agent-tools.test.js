'use strict';

// Knowledge Base Agent write-tool tests.
//
// Covers the crown-jewel safety boundary and the undo contract for the KB
// agent's editing tools. These are high-risk: the agent now writes to governed
// knowledge, so the tests assert that (a) it can fill whitelisted fields and
// returns prior values, (b) it CANNOT approve/publish/change status, (c) the
// proactive overwrite guard protects reviewer-authored content, and (d) undo
// reverts via the existing PATCH route.

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const Escalation = require('../src/models/Escalation');
const EscalationAttentionItem = require('../src/models/EscalationAttentionItem');
const KnowledgeCandidate = require('../src/models/KnowledgeCandidate');
const {
  createKbAgentToolHandlers,
  KB_AGENT_ACTOR,
  KNOWLEDGEBASE_AGENT_ID,
  EDITABLE_FIELD_SET,
} = require('../src/services/knowledgebase-agent-tools');
const {
  assertKnowledgePermission,
  updateKnowledgeRecord,
} = require('../src/services/knowledgebase-management-service');

process.env.NODE_ENV = 'test';

function makeEscalation(fields = {}) {
  return Escalation.create({
    category: 'payroll',
    status: 'resolved',
    caseNumber: `CASE-KBT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    attemptingTo: 'Finish a QBO payroll workflow',
    actualOutcome: 'Payroll archive employer summary appears missing after filing',
    resolution: 'Open Archived Forms, choose the tax year, and confirm the employer summary.',
    resolutionNotes: 'Confirmed from a finalized support case.',
    resolvedAt: new Date('2026-05-01T12:00:00.000Z'),
    ...fields,
  });
}

async function makeCandidate(escalation, fields = {}) {
  return KnowledgeCandidate.create({
    escalationId: escalation._id,
    conversationId: null,
    reviewStatus: 'draft',
    publishTarget: 'case-history-only',
    reusableOutcome: 'case-history-only',
    title: 'Payroll archive summary draft',
    category: escalation.category || 'unknown',
    summary: 'Candidate summary',
    customerGoal: '',
    reportedProblem: '',
    symptom: escalation.actualOutcome || '',
    rootCause: '',
    exactFix: '',
    escalationPath: '',
    keySignals: [],
    confidence: 0.6,
    sourceSnapshot: {
      status: escalation.status,
      category: escalation.category,
      coid: escalation.coid || '',
      caseNumber: escalation.caseNumber || '',
      attemptingTo: escalation.attemptingTo || '',
      actualOutcome: escalation.actualOutcome || '',
      tsSteps: escalation.tsSteps || '',
      resolution: escalation.resolution || '',
      resolutionNotes: escalation.resolutionNotes || '',
      resolvedAt: escalation.resolvedAt || null,
    },
    generatedAt: new Date('2026-05-02T12:00:00.000Z'),
    ...fields,
  });
}

function handlersFor(candidate) {
  const recordId = `candidate:${candidate._id.toString()}`;
  return createKbAgentToolHandlers({ recordId, candidateId: candidate._id.toString() });
}

test.before(async () => {
  await connect();
});

test.after(async () => {
  await disconnect();
});

test.beforeEach(async () => {
  process.env.NODE_ENV = 'test';
  await Escalation.deleteMany({});
  await EscalationAttentionItem.deleteMany({});
  await KnowledgeCandidate.deleteMany({});
  delete process.env.KNOWLEDGE_DEFAULT_ROLE;
});

test('kb.updateDraft writes a whitelisted empty field and returns prior values', async () => {
  const escalation = await makeEscalation();
  const candidate = await makeCandidate(escalation);
  const handlers = handlersFor(candidate);

  const result = await handlers['kb.updateDraft']({
    fields: { customerGoal: 'Customer wanted to confirm the archived employer payroll summary.' },
    mode: 'proactive',
  });

  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  assert.equal(result.changedFields.length, 1);
  assert.equal(result.changedFields[0].field, 'customerGoal');
  assert.equal(result.changedFields[0].prior, ''); // captured prior value (was empty)
  assert.match(result.changedFields[0].next, /archived employer payroll summary/i);

  const fresh = await KnowledgeCandidate.findById(candidate._id).lean();
  assert.match(fresh.customerGoal, /archived employer payroll summary/i);
  assert.equal(fresh.reviewStatus, 'draft'); // status untouched
});

test('kb.updateDraft strips status/publish/trust fields and never changes review status', async () => {
  const escalation = await makeEscalation();
  const candidate = await makeCandidate(escalation);
  const handlers = handlersFor(candidate);

  const result = await handlers['kb.updateDraft']({
    fields: {
      reviewStatus: 'approved',
      publishTarget: 'category',
      reusableOutcome: 'canonical',
      trustStateOverride: 'trusted',
      summary: 'A safe edit that should go through.',
    },
    mode: 'explicit',
  });

  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  // Only the whitelisted summary should have changed.
  assert.deepEqual(result.changedFields.map((c) => c.field), ['summary']);
  // The forbidden keys are reported as stripped.
  assert.ok(result.strippedForbidden.includes('reviewStatus'));
  assert.ok(result.strippedForbidden.includes('publishTarget'));
  assert.ok(result.strippedForbidden.includes('reusableOutcome'));
  assert.ok(result.strippedForbidden.includes('trustStateOverride'));

  const fresh = await KnowledgeCandidate.findById(candidate._id).lean();
  assert.equal(fresh.reviewStatus, 'draft'); // NOT approved
  assert.equal(fresh.publishTarget, 'case-history-only'); // unchanged
  assert.equal(fresh.reusableOutcome, 'case-history-only'); // unchanged
  assert.equal(fresh.summary, 'A safe edit that should go through.');
});

test('the reviewer actor the agent uses cannot publish/deprecate/redact', () => {
  // Structural boundary: the role the agent writes as lacks the governance perms.
  assert.equal(KB_AGENT_ACTOR.role, 'reviewer');
  assert.doesNotThrow(() => assertKnowledgePermission(KB_AGENT_ACTOR, 'review'));
  assert.throws(() => assertKnowledgePermission(KB_AGENT_ACTOR, 'publish'), /permission is required/i);
  assert.throws(() => assertKnowledgePermission(KB_AGENT_ACTOR, 'deprecate'), /permission is required/i);
  assert.throws(() => assertKnowledgePermission(KB_AGENT_ACTOR, 'redact'), /permission is required/i);
});

test('kb.updateDraft proactive mode does not overwrite a non-empty reviewer field', async () => {
  const escalation = await makeEscalation();
  const candidate = await makeCandidate(escalation, {
    customerGoal: 'Reviewer-authored goal that must be preserved.',
  });
  const handlers = handlersFor(candidate);

  const result = await handlers['kb.updateDraft']({
    fields: { customerGoal: 'Agent tries to overwrite this.' },
    mode: 'proactive',
  });

  assert.equal(result.applied, false);
  assert.ok(result.skippedNonEmpty.includes('customerGoal'));

  const fresh = await KnowledgeCandidate.findById(candidate._id).lean();
  assert.equal(fresh.customerGoal, 'Reviewer-authored goal that must be preserved.');
});

test('kb.updateDraft explicit mode overwrites a non-empty field (reviewer command)', async () => {
  const escalation = await makeEscalation();
  const candidate = await makeCandidate(escalation, {
    customerGoal: 'Old goal.',
  });
  const handlers = handlersFor(candidate);

  const result = await handlers['kb.updateDraft']({
    fields: { customerGoal: 'New goal the reviewer asked for.' },
    mode: 'explicit',
  });

  assert.equal(result.applied, true);
  assert.equal(result.changedFields[0].prior, 'Old goal.');

  const fresh = await KnowledgeCandidate.findById(candidate._id).lean();
  assert.equal(fresh.customerGoal, 'New goal the reviewer asked for.');
});

test('kb.readDraft and kb.checkCompleteness are read-only and report state', async () => {
  const escalation = await makeEscalation();
  const candidate = await makeCandidate(escalation);
  const handlers = handlersFor(candidate);

  const read = await handlers['kb.readDraft']();
  assert.equal(read.ok, true);
  assert.equal(read.reviewStatus, 'draft');
  assert.ok('customerGoal' in read.fields);
  assert.ok(Array.isArray(read.qualityIssues));

  const completeness = await handlers['kb.checkCompleteness']();
  assert.equal(completeness.ok, true);
  assert.ok(Array.isArray(completeness.requiredMissing));
  assert.ok(Array.isArray(completeness.checks));
});

test('undo reverts an agent edit via the existing PATCH route using the prior value', async () => {
  const app = createApp();
  const escalation = await makeEscalation();
  const candidate = await makeCandidate(escalation);
  const handlers = handlersFor(candidate);

  // Agent edits the field.
  const edit = await handlers['kb.updateDraft']({
    fields: { summary: 'Agent-written summary.' },
    mode: 'explicit',
  });
  assert.equal(edit.applied, true);
  const change = edit.changedFields[0];
  assert.equal(change.prior, 'Candidate summary');

  let fresh = await KnowledgeCandidate.findById(candidate._id).lean();
  assert.equal(fresh.summary, 'Agent-written summary.');

  // Undo: PATCH the record with the prior value (what the client does).
  const recordId = `candidate:${candidate._id.toString()}`;
  const res = await request(app)
    .patch(`/api/knowledge/records/${encodeURIComponent(recordId)}`)
    .send({ [change.field]: change.prior });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);

  fresh = await KnowledgeCandidate.findById(candidate._id).lean();
  assert.equal(fresh.summary, 'Candidate summary'); // reverted
  assert.equal(fresh.reviewStatus, 'draft');
});

// CHANGE 2 (tripwire): the agent's primary draft fields must stay editable.
// These 7 KB draft fields are what kb.updateDraft writes; if a future revert
// drops them from EDITABLE_TEXT_FIELDS, kb.updateDraft silently no-ops on them.
// This assertion fails loudly so the regression is caught immediately.
test('all 7 KB draft fields stay in the editable set kb.updateDraft consults', () => {
  const requiredEditable = [
    'customerGoal',
    'reportedProblem',
    'evidenceFromCase',
    'troubleshootingTried',
    'confirmedCause',
    'finalOutcome',
    'invEscalationStatus',
  ];
  for (const field of requiredEditable) {
    assert.ok(
      EDITABLE_FIELD_SET.has(field),
      `KB draft field "${field}" must be editable — kb.updateDraft no-ops on it otherwise.`
    );
  }
});

// CHANGE 1 (defense-in-depth): updateKnowledgeRecord must strip governance/trust
// fields for an AGENT actor even when an unsanitized governance payload reaches
// the service directly (bypassing the tool's own stripping).
test('updateKnowledgeRecord strips governance fields when the AGENT actor calls it directly', async () => {
  const escalation = await makeEscalation();
  const candidate = await makeCandidate(escalation);
  const recordId = `candidate:${candidate._id.toString()}`;

  const result = await updateKnowledgeRecord(
    recordId,
    {
      reviewStatus: 'approved',
      publishTarget: 'category',
      reusableOutcome: 'canonical',
      trustStateOverride: '',
      summary: 'Agent edit that should still land.',
    },
    { actor: KNOWLEDGEBASE_AGENT_ID, role: 'reviewer' }
  );

  // The whitelisted text edit lands; governance is silently stripped.
  assert.equal(result.record.summary, 'Agent edit that should still land.');
  assert.equal(result.record.reviewStatus, 'draft'); // NOT approved
  assert.equal(result.record.publishTarget, 'case-history-only'); // unchanged
  assert.equal(result.record.reusableOutcome, 'case-history-only'); // unchanged

  // The strip is audit-logged for observability.
  const fresh = await KnowledgeCandidate.findById(candidate._id).lean();
  assert.equal(fresh.reviewStatus, 'draft');
  const lastAudit = fresh.auditEvents[fresh.auditEvents.length - 1];
  // All governance fields present in the sanitized patch are stripped — including
  // trustStateOverride, which sanitizeKnowledgePatch keeps even for an empty value.
  assert.deepEqual(
    [...lastAudit.metadata.agentStrippedGovernanceFields].sort(),
    ['publishTarget', 'reusableOutcome', 'reviewStatus', 'trustStateOverride'].sort()
  );
});

// CHANGE 1 (regression guard): a HUMAN reviewer actor must STILL be able to set
// reviewStatus:'approved' through the very same updateKnowledgeRecord. The guard
// keys on agent identity, NOT on the 'reviewer' role humans also use.
test('updateKnowledgeRecord still lets a HUMAN reviewer approve (guard is identity-keyed, not role-keyed)', async () => {
  const escalation = await makeEscalation();
  const candidate = await makeCandidate(escalation);
  const recordId = `candidate:${candidate._id.toString()}`;

  const result = await updateKnowledgeRecord(
    recordId,
    {
      reviewStatus: 'approved',
      publishTarget: 'category',
      reusableOutcome: 'canonical',
      summary: 'Human-approved edit.',
    },
    { actor: 'reviewer-human-a', role: 'reviewer' }
  );

  assert.equal(result.record.reviewStatus, 'approved'); // human approval works
  assert.equal(result.record.publishTarget, 'category');
  assert.equal(result.record.reusableOutcome, 'canonical');
  assert.equal(result.record.reviewedBy, 'reviewer-human-a');

  const fresh = await KnowledgeCandidate.findById(candidate._id).lean();
  assert.equal(fresh.reviewStatus, 'approved');
  // No agent-strip metadata for a human actor.
  const lastAudit = fresh.auditEvents[fresh.auditEvents.length - 1];
  assert.equal(lastAudit.metadata.agentStrippedGovernanceFields, undefined);
});
