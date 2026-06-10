'use strict';

// Redaction masking regression tests (2026-06-03 review, Blocker 2).
//
// Contract under test: when a knowledge record is redacted
// (redaction.customerIdentifiersRedacted), every read path returns MASKED
// body/free-text content while the ORIGINAL text stays intact in MongoDB.
// Covered read paths: GET /records/:id, GET /records (list), GET /search,
// GET /export (json + markdown incl. the redactionAppliedByRecord claim),
// GET /agent-context (incl. persisted operational-intelligence claims), and
// the KB-agent tools kb.readDraft / kb.searchKnowledgeBase. Also covers the
// unredact path (customerIdentifiersRedacted: false restores the original)
// and the publish-time markdown-export guard for redacted records.

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const Escalation = require('../src/models/Escalation');
const EscalationAttentionItem = require('../src/models/EscalationAttentionItem');
const KnowledgeCandidate = require('../src/models/KnowledgeCandidate');
const OperationalClaim = require('../src/models/OperationalClaim');
const OperationalEvidence = require('../src/models/OperationalEvidence');
const { createKbAgentToolHandlers } = require('../src/services/knowledgebase-agent-tools');

process.env.NODE_ENV = 'test';

// Distinctive tokens that must NEVER appear in any masked read response.
const T = {
  title: 'ZTOK-TITLE-77041',
  summary: 'ZTOK-SUMMARY-77042',
  symptom: 'ZTOK-SYMPTOM-77043',
  rootCause: 'ZTOK-ROOTCAUSE-77044',
  exactFix: 'ZTOK-EXACTFIX-77045',
  customerGoal: 'ZTOK-GOAL-77046',
  reportedProblem: 'ZTOK-PROBLEM-77047',
  finalOutcome: 'ZTOK-FINAL-77048',
  evidenceFromCase: 'ZTOK-EVIDENCE-77049',
  troubleshootingTried: 'ZTOK-TRIED-77050',
  invEscalationStatus: 'ZTOK-INV-77051',
  escalationPath: 'ZTOK-PATH-77052',
  keySignal: 'ZTOK-SIGNAL-77053',
  boundary: 'ZTOK-BOUNDARY-77054',
  scopeApplies: 'ZTOK-SCOPE-77055',
  scopeNotes: 'ZTOK-SCOPENOTES-77056',
  resolution: 'ZTOK-RESOLUTION-77057',
  conversationTitle: 'ZTOK-CONVTITLE-77058',
  conversationPreview: 'ZTOK-CONVPREVIEW-77059',
  refLabel: 'ZTOK-REFLABEL-77060',
  refSummary: 'ZTOK-REFSUMMARY-77061',
  caseNumber: 'CASE-ZTOK-77062',
  coid: 'COID-ZTOK-77063',
};
const TOKEN_PATTERN = /ZTOK-|CASE-ZTOK|COID-ZTOK/;

function makeEscalation(fields = {}) {
  return Escalation.create({
    category: 'payroll',
    status: 'resolved',
    caseNumber: T.caseNumber,
    coid: T.coid,
    attemptingTo: 'Use a QBO workflow',
    actualOutcome: 'The customer needs a reusable support pattern',
    resolution: T.resolution,
    resolutionNotes: 'Confirmed in a finalized case.',
    resolvedAt: new Date('2026-05-01T12:00:00.000Z'),
    ...fields,
  });
}

async function makeCandidate(escalation, fields = {}) {
  return KnowledgeCandidate.create({
    escalationId: escalation._id,
    conversationId: new mongoose.Types.ObjectId(),
    reviewStatus: 'draft',
    publishTarget: 'case-history-only',
    reusableOutcome: 'case-history-only',
    title: `Fix ${T.title}`,
    category: 'payroll',
    summary: `Summary ${T.summary}`,
    symptom: `Symptom ${T.symptom}`,
    rootCause: `Root cause ${T.rootCause}`,
    exactFix: `Exact fix ${T.exactFix}`,
    customerGoal: `Goal ${T.customerGoal}`,
    reportedProblem: `Problem ${T.reportedProblem}`,
    finalOutcome: `Final ${T.finalOutcome}`,
    evidenceFromCase: `Evidence ${T.evidenceFromCase}`,
    troubleshootingTried: `Tried ${T.troubleshootingTried}`,
    invEscalationStatus: `INV ${T.invEscalationStatus}`,
    escalationPath: `Path ${T.escalationPath}`,
    keySignals: [T.keySignal],
    importantBoundaries: [T.boundary],
    scope: {
      appliesTo: [T.scopeApplies],
      excludes: [],
      versionNotes: T.scopeNotes,
      customerScope: '',
      lastValidatedAt: null,
    },
    evidenceRefs: [{
      type: 'note',
      id: 'ref-1',
      label: T.refLabel,
      summary: T.refSummary,
      url: 'https://internal.example/ZTOK-URL-77064',
      strength: 0.7,
    }],
    confidence: 0.8,
    sourceSnapshot: {
      status: escalation.status,
      category: escalation.category,
      coid: escalation.coid || '',
      caseNumber: escalation.caseNumber || '',
      attemptingTo: escalation.attemptingTo || '',
      actualOutcome: escalation.actualOutcome || '',
      tsSteps: '',
      resolution: escalation.resolution || '',
      resolutionNotes: escalation.resolutionNotes || '',
      conversationTitle: T.conversationTitle,
      conversationPreview: T.conversationPreview,
      conversationMessageCount: 3,
      resolvedAt: escalation.resolvedAt || null,
    },
    generatedAt: new Date('2026-05-02T12:00:00.000Z'),
    ...fields,
  });
}

function redactRecord(agent, candidate, body = {}) {
  return agent
    .post(`/api/knowledge/records/candidate:${candidate._id}/redact`)
    .set('x-knowledge-role', 'admin')
    .set('x-knowledge-actor', 'privacy-admin')
    .send({ customerIdentifiersRedacted: true, fields: ['caseNumber', 'coid'], ...body });
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
  await OperationalClaim.deleteMany({});
  await OperationalEvidence.deleteMany({});
  delete process.env.KNOWLEDGE_DEFAULT_ROLE;
  delete process.env.KNOWLEDGE_MARKDOWN_PUBLISH_DISABLED;
});

test('redacting a record masks every body field on the records route, preserves the original in MongoDB, and unredact restores it', async () => {
  const app = createApp();
  const agent = request(app);
  const escalation = await makeEscalation();
  const candidate = await makeCandidate(escalation, {
    reviewStatus: 'published',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
    publishedAt: new Date('2026-05-04T12:00:00.000Z'),
    publishedDocType: 'database',
  });

  // Sanity: before redaction the body is readable.
  const before = await agent.get(`/api/knowledge/records/candidate:${candidate._id}`);
  assert.equal(before.status, 200);
  assert.match(JSON.stringify(before.body), TOKEN_PATTERN);

  const redacted = await redactRecord(agent, candidate, { notes: 'Customer identifiers and body content masked.' });
  assert.equal(redacted.status, 200);
  assert.equal(redacted.body.ok, true);

  const after = await agent.get(`/api/knowledge/records/candidate:${candidate._id}`);
  assert.equal(after.status, 200);
  const record = after.body.record;
  // Flat body fields are all masked.
  for (const field of [
    'title', 'summary', 'symptom', 'rootCause', 'exactFix', 'customerGoal',
    'reportedProblem', 'finalOutcome', 'evidenceFromCase', 'troubleshootingTried',
    'invEscalationStatus', 'escalationPath',
  ]) {
    assert.equal(record[field], '[redacted]', `${field} must be masked`);
  }
  assert.deepEqual(record.keySignals, ['[redacted]']);
  assert.deepEqual(record.importantBoundaries, ['[redacted]']);
  assert.deepEqual(record.scope.appliesTo, ['[redacted]']);
  assert.equal(record.scope.versionNotes, '[redacted]');
  // Evidence entries are masked (case/coid, conversation, resolution, refs).
  const caseEvidence = record.evidence.find((item) => item.type === 'escalation');
  assert.equal(caseEvidence.label, 'Case [redacted]');
  assert.equal(caseEvidence.coid, '[redacted]');
  const conversationEvidence = record.evidence.find((item) => item.type === 'conversation');
  assert.equal(conversationEvidence.label, 'Linked conversation');
  assert.equal(conversationEvidence.preview, '[redacted]');
  const resolutionEvidence = record.evidence.find((item) => item.type === 'resolution');
  assert.equal(resolutionEvidence.text, '[redacted]');
  const refEvidence = record.evidence.find((item) => item.type === 'note');
  assert.equal(refEvidence.label, '[redacted]');
  assert.equal(refEvidence.summary, '[redacted]');
  assert.equal(refEvidence.url, '[redacted]');
  // Governance metadata stays honest and readable.
  assert.equal(record.redaction.customerIdentifiersRedacted, true);
  assert.equal(record.trustState, 'trusted');
  assert.equal(record.category, 'payroll');
  // Nothing in the whole response leaks a token.
  assert.doesNotMatch(JSON.stringify(after.body), TOKEN_PATTERN);

  // NON-DESTRUCTIVE: the original text is intact in MongoDB.
  const raw = await KnowledgeCandidate.findById(candidate._id).lean();
  assert.match(raw.summary, new RegExp(T.summary));
  assert.match(raw.title, new RegExp(T.title));
  assert.match(raw.exactFix, new RegExp(T.exactFix));
  assert.equal(raw.sourceSnapshot.caseNumber, T.caseNumber);

  // Unredact restores full read access.
  const unredact = await agent
    .post(`/api/knowledge/records/candidate:${candidate._id}/redact`)
    .set('x-knowledge-role', 'admin')
    .send({ customerIdentifiersRedacted: false });
  assert.equal(unredact.status, 200);
  const restored = await agent.get(`/api/knowledge/records/candidate:${candidate._id}`);
  assert.equal(restored.status, 200);
  assert.match(restored.body.record.summary, new RegExp(T.summary));
  assert.match(restored.body.record.title, new RegExp(T.title));
});

test('free-text search cannot probe redacted content; the record stays listed (masked) and reachable by id', async () => {
  const app = createApp();
  const agent = request(app);
  const escalation = await makeEscalation();
  const candidate = await makeCandidate(escalation);

  // Sanity: the secret content is findable before redaction.
  const probeBefore = await agent
    .get('/api/knowledge/search')
    .query({ query: T.summary, includeLegacy: 'false', includeCandidates: 'true' });
  assert.equal(probeBefore.status, 200);
  assert.ok(probeBefore.body.records.some((r) => r.id === `candidate:${candidate._id}`));

  await redactRecord(agent, candidate);

  // Probing the hidden content (or identifiers) must return nothing.
  for (const probe of [T.summary, T.exactFix, T.caseNumber]) {
    const res = await agent
      .get('/api/knowledge/search')
      .query({ query: probe, includeLegacy: 'false', includeCandidates: 'true' });
    assert.equal(res.status, 200);
    assert.equal(
      res.body.records.some((r) => r.id === `candidate:${candidate._id}`),
      false,
      `search probe "${probe}" must not match the redacted record`
    );
    // (The response echoes the caller's own query string back; only the
    // returned records must be leak-free.)
    assert.doesNotMatch(JSON.stringify(res.body.records), TOKEN_PATTERN);
  }

  // The record is still governed/visible in unqueried lists — masked.
  const list = await agent.get('/api/knowledge/records');
  assert.equal(list.status, 200);
  const listed = list.body.records.find((r) => r.id === `candidate:${candidate._id}`);
  assert.ok(listed, 'redacted record must remain listed');
  assert.equal(listed.title, '[redacted]');
  assert.doesNotMatch(JSON.stringify(list.body), TOKEN_PATTERN);
});

test('export masks redacted records in both formats and the redactionAppliedByRecord claim is accurate', async () => {
  const app = createApp();
  const agent = request(app);
  const escalation = await makeEscalation();
  const candidate = await makeCandidate(escalation, {
    reviewStatus: 'published',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
    publishedAt: new Date('2026-05-04T12:00:00.000Z'),
    publishedDocType: 'database',
  });
  await redactRecord(agent, candidate);

  const json = await agent
    .get('/api/knowledge/export')
    .set('x-knowledge-role', 'reviewer')
    .query({ format: 'json', includeCandidates: 'true', includeLegacy: 'false' });
  assert.equal(json.status, 200);
  assert.equal(json.body.export.count, 1);
  assert.doesNotMatch(json.body.export.content, TOKEN_PATTERN);
  const payload = JSON.parse(json.body.export.content);
  assert.equal(payload.policy.redactionAppliedByRecord, true);
  // The claim is TRUE: the exported record really is masked.
  assert.equal(payload.records[0].title, '[redacted]');
  assert.equal(payload.records[0].summary, '[redacted]');
  assert.equal(payload.records[0].exactFix, '[redacted]');
  assert.equal(payload.records[0].redaction.customerIdentifiersRedacted, true);

  const markdown = await agent
    .get('/api/knowledge/export')
    .set('x-knowledge-role', 'reviewer')
    .query({ format: 'markdown', includeCandidates: 'true', includeLegacy: 'false' });
  assert.equal(markdown.status, 200);
  assert.doesNotMatch(markdown.body.export.content, TOKEN_PATTERN);
  assert.match(markdown.body.export.content, /# \[redacted\]/);
});

test('agent context and persisted operational claims are masked in place on redact and restored on unredact', async () => {
  const app = createApp();
  const agent = request(app);
  const escalation = await makeEscalation();
  const candidate = await makeCandidate(escalation, {
    reviewStatus: 'approved',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
  });
  const sourceRecordId = `candidate:${candidate._id}`;

  // Trigger an operational-intelligence sync BEFORE redaction (raw text lands
  // in the claims collection, keyed by a hash of the raw text).
  const patch = await agent
    .patch(`/api/knowledge/records/candidate:${candidate._id}`)
    .set('x-knowledge-role', 'admin')
    .send({ reviewNotes: 'Reviewed for accuracy.' });
  assert.equal(patch.status, 200);
  const rawClaims = await OperationalClaim.find({ sourceRecordId }).lean();
  assert.ok(rawClaims.length > 0, 'OI sync must create claims');
  const summaryClaimBefore = rawClaims.find((c) => c.claimType === 'summary');
  assert.match(summaryClaimBefore.text, new RegExp(T.summary));

  // Redact → the SAME persisted claim docs are overwritten with the mask
  // (claim keys hash the raw text, so this is an in-place overwrite, not a
  // new doc next to a stale raw one).
  await redactRecord(agent, candidate);
  const maskedClaims = await OperationalClaim.find({ sourceRecordId }).lean();
  assert.equal(maskedClaims.length, rawClaims.length, 'no duplicate claims after redact');
  const summaryClaimAfter = maskedClaims.find((c) => c.claimKey === summaryClaimBefore.claimKey);
  assert.equal(summaryClaimAfter.text, '[redacted]');
  assert.doesNotMatch(JSON.stringify(maskedClaims), TOKEN_PATTERN);
  const maskedEvidence = await OperationalEvidence.find({ sourceRecordId }).lean();
  assert.doesNotMatch(JSON.stringify(maskedEvidence), TOKEN_PATTERN);

  // Unredact → same docs restored from the untouched candidate.
  await agent
    .post(`/api/knowledge/records/candidate:${candidate._id}/redact`)
    .set('x-knowledge-role', 'admin')
    .send({ customerIdentifiersRedacted: false });
  const restoredClaims = await OperationalClaim.find({ sourceRecordId }).lean();
  const summaryClaimRestored = restoredClaims.find((c) => c.claimKey === summaryClaimBefore.claimKey);
  assert.match(summaryClaimRestored.text, new RegExp(T.summary));

  // Redact again, publish database-only, and confirm the AGENT-facing context
  // (the path chat/triage consume) returns the record fully masked.
  await redactRecord(agent, candidate);
  const publish = await agent
    .post(`/api/knowledge/records/candidate:${candidate._id}/publish`)
    .set('x-knowledge-role', 'admin')
    .send({});
  assert.equal(publish.status, 200);
  assert.equal(publish.body.published, true);

  const context = await agent
    .get('/api/knowledge/agent-context')
    .query({ allowedUse: 'agent-response', includeLegacy: 'false' });
  assert.equal(context.status, 200);
  const ids = context.body.context.records.map((r) => r.id);
  assert.ok(ids.includes(sourceRecordId), 'published canonical record reaches agent context');
  const contextRecord = context.body.context.records.find((r) => r.id === sourceRecordId);
  assert.equal(contextRecord.summary, '[redacted]');
  assert.equal(contextRecord.exactFix, '[redacted]');
  assert.doesNotMatch(JSON.stringify(context.body), TOKEN_PATTERN);
});

test('KB-agent tools mask redacted drafts: kb.readDraft, kb.searchKnowledgeBase, and undo prior values', async () => {
  const app = createApp();
  const agent = request(app);
  const escalation = await makeEscalation();
  const candidate = await makeCandidate(escalation);
  await redactRecord(agent, candidate);

  const handlers = createKbAgentToolHandlers({
    recordId: `candidate:${candidate._id}`,
    candidateId: candidate._id.toString(),
  });

  const draft = await handlers['kb.readDraft']({});
  assert.equal(draft.ok, true);
  assert.equal(draft.redacted, true);
  assert.equal(draft.fields.summary, '[redacted]');
  assert.equal(draft.fields.title, '[redacted]');
  assert.deepEqual(draft.fields.keySignals, ['[redacted]']);
  // Taxonomy metadata stays readable.
  assert.equal(draft.fields.category, 'payroll');
  assert.doesNotMatch(JSON.stringify(draft), TOKEN_PATTERN);

  const search = await handlers['kb.searchKnowledgeBase']({ query: T.summary });
  assert.equal(search.ok, true);
  assert.equal(search.count, 0, 'agent search must not probe redacted content');
  // (The result echoes the agent's own query string; the records must be
  // leak-free.)
  assert.doesNotMatch(JSON.stringify(search.records), TOKEN_PATTERN);

  // The undo payload (prior values) must not leak the hidden original either.
  const update = await handlers['kb.updateDraft']({
    fields: { summary: 'Reviewer-approved replacement summary.' },
    mode: 'explicit',
  });
  assert.equal(update.ok, true);
  assert.equal(update.changedFields[0].prior, '[redacted]');
  assert.doesNotMatch(JSON.stringify(update), TOKEN_PATTERN);
});

test('a redacted record never exports markdown on publish — forced database-only', async () => {
  const app = createApp();
  const agent = request(app);
  const escalation = await makeEscalation();
  const candidate = await makeCandidate(escalation, {
    reviewStatus: 'approved',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
  });
  await redactRecord(agent, candidate);

  const publish = await agent
    .post(`/api/knowledge/records/candidate:${candidate._id}/publish`)
    .set('x-knowledge-role', 'admin')
    .send({ exportMarkdown: true });
  assert.equal(publish.status, 200);
  assert.equal(publish.body.published, true);
  assert.equal(publish.body.export, null, 'markdown export must be suppressed for redacted records');
  assert.equal(publish.body.record.lineage.publishedDocType, 'database');
});
