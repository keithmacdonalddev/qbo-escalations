'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const AgentIdentity = require('../src/models/AgentIdentity');
const Escalation = require('../src/models/Escalation');
const EscalationAttentionItem = require('../src/models/EscalationAttentionItem');
const KnowledgeCandidate = require('../src/models/KnowledgeCandidate');

process.env.NODE_ENV = 'test';

function makeEscalation(fields = {}) {
  return Escalation.create({
    category: 'payroll',
    status: 'resolved',
    caseNumber: `CASE-KB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
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

test.before(async () => {
  await connect();
});

test.after(async () => {
  await disconnect();
});

test.beforeEach(async () => {
  await AgentIdentity.deleteMany({});
  await Escalation.deleteMany({});
  await EscalationAttentionItem.deleteMany({});
  await KnowledgeCandidate.deleteMany({});
});

test('knowledgebase agent status exposes monitor boundaries', async () => {
  const app = createApp();
  const res = await request(app).get('/api/knowledge/agent/status');

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.status.agentId, 'knowledgebase-agent');
  assert.equal(res.body.status.dbReady, true);
  assert.equal(res.body.status.capabilities.attentionItems, true);
  assert.equal(res.body.status.capabilities.approvesKnowledge, false);
  assert.equal(res.body.status.capabilities.publishesKnowledge, false);
  assert.equal(res.body.status.profileRoute, '/api/agent-identities/knowledgebase-agent');
});

test('knowledgebase agent scan opens review attention for finalized cases without drafts', async () => {
  const app = createApp();
  const agent = request(app);
  const escalation = await makeEscalation({
    caseNumber: 'CASE-KB-MISSING-DRAFT',
    actualOutcome: 'Payroll archive employer summary is missing after forms were filed',
  });

  const res = await agent
    .post('/api/knowledge/agent/scan')
    .send({ limit: 20 });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.scan.agentId, 'knowledgebase-agent');
  assert.equal(res.body.scan.dbReady, true);
  assert.equal(res.body.scan.dryRun, false);
  assert.equal(res.body.scan.counts.missingDraft, 1);
  assert.equal(res.body.scan.counts.proposals, 1);
  assert.equal(res.body.scan.attention.opened, 1);

  const proposal = res.body.scan.proposals[0];
  assert.equal(proposal.type, 'missing-knowledge-draft');
  assert.equal(proposal.suggestedDraft.category, 'payroll');
  assert.match(proposal.suggestedDraft.exactFix, /Archived Forms/);
  assert.equal(proposal.sourceEvidence[0].id, String(escalation._id));

  const item = await EscalationAttentionItem.findOne({
    fingerprint: `knowledge-review:${escalation._id}`,
  }).lean();
  assert.ok(item);
  assert.equal(item.kind, 'knowledge-review');
  assert.equal(item.status, 'open');
  assert.equal(item.sourceType, 'agent');
  assert.equal(String(item.sourceEscalationId), String(escalation._id));
  assert.equal(item.metadata.agentId, 'knowledgebase-agent');
  assert.equal(item.metadata.proposalType, 'missing-knowledge-draft');
  assert.equal(item.metadata.suggestedDraft.category, 'payroll');

  const identity = await AgentIdentity.findOne({ agentId: 'knowledgebase-agent' }).lean();
  assert.ok(identity);
  assert.equal(identity.activity.entries[0].type, 'knowledgebase-scan');
  assert.equal(identity.activity.entries[0].status, 'review-needed');
});

test('knowledgebase agent dry run reports quality, duplicate, and stale proposals without writes', async () => {
  const app = createApp();
  const agent = request(app);

  const qualityEscalation = await makeEscalation({ caseNumber: 'CASE-KB-QUALITY' });
  await makeCandidate(qualityEscalation, {
    title: 'Low confidence payroll draft',
    rootCause: '',
    exactFix: '',
    confidence: 0.4,
  });

  const duplicateA = await makeEscalation({ caseNumber: 'CASE-KB-DUP-A' });
  const duplicateB = await makeEscalation({ caseNumber: 'CASE-KB-DUP-B' });
  await makeCandidate(duplicateA, {
    reviewStatus: 'approved',
    title: 'Payroll archive employer summary duplicate A',
    symptom: 'Payroll archive employer summary missing after filing',
    rootCause: 'The user is checking the active forms area instead of archived forms.',
    exactFix: 'Open Archived Forms and select the filed year.',
    confidence: 0.8,
  });
  await makeCandidate(duplicateB, {
    reviewStatus: 'approved',
    title: 'Payroll archive employer summary duplicate B',
    symptom: 'Payroll archive employer summary missing after filing',
    rootCause: 'The user is checking the active forms area instead of archived forms.',
    exactFix: 'Open Archived Forms and select the filed year.',
    confidence: 0.82,
  });

  const staleEscalation = await makeEscalation({
    caseNumber: 'CASE-KB-STALE',
    actualOutcome: 'Payroll liability adjustment old trusted guidance',
  });
  await makeCandidate(staleEscalation, {
    reviewStatus: 'published',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
    title: 'Old payroll liability adjustment guidance',
    symptom: 'Payroll liability adjustment old trusted guidance',
    rootCause: 'Historical QBO workflow behavior.',
    exactFix: 'Use the older liability adjustment workflow.',
    confidence: 0.9,
    publishedAt: new Date('2025-01-01T12:00:00.000Z'),
  });

  const res = await agent
    .post('/api/knowledge/agent/scan')
    .send({ limit: 50, dryRun: true, staleTrustedDays: 30 });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.scan.dryRun, true);
  assert.equal(res.body.scan.attention.opened, 0);
  assert.equal(res.body.scan.activity.recorded, false);

  const types = new Set(res.body.scan.proposals.map((proposal) => proposal.type));
  assert.ok(types.has('candidate-quality-review'));
  assert.ok(types.has('duplicate-candidate-review'));
  assert.ok(types.has('stale-trusted-review'));

  const quality = res.body.scan.proposals.find((proposal) => proposal.type === 'candidate-quality-review');
  assert.ok(quality.qualityIssues.includes('missing_root_cause'));
  assert.ok(quality.qualityIssues.includes('missing_fix_or_escalation_path'));
  assert.ok(quality.qualityIssues.includes('low_confidence'));

  const duplicate = res.body.scan.proposals.find((proposal) => proposal.type === 'duplicate-candidate-review');
  assert.equal(duplicate.candidateIds.length, 2);

  const stale = res.body.scan.proposals.find((proposal) => proposal.type === 'stale-trusted-review');
  assert.equal(stale.staleTrustedDays, 30);
  assert.ok(stale.staleDays >= 30);

  assert.equal(await EscalationAttentionItem.countDocuments({}), 0);
  assert.equal(await AgentIdentity.countDocuments({ agentId: 'knowledgebase-agent' }), 0);
});
