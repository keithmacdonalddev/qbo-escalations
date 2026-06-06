'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const Escalation = require('../src/models/Escalation');
const KnowledgeCandidate = require('../src/models/KnowledgeCandidate');
const OperationalClaim = require('../src/models/OperationalClaim');
const OperationalEvidence = require('../src/models/OperationalEvidence');

process.env.NODE_ENV = 'test';

function makeEscalation(fields = {}) {
  return Escalation.create({
    category: 'payroll',
    status: 'resolved',
    caseNumber: `CASE-OI-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    coid: `COID-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    attemptingTo: 'Review payroll archived forms',
    actualOutcome: 'Employer summary appears missing after filing',
    resolution: 'Open Archived Forms, select the filed year, and verify the employer summary.',
    resolutionNotes: 'Confirmed in a finalized payroll case.',
    resolvedAt: new Date('2026-05-04T12:00:00.000Z'),
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
    title: 'Payroll archive draft',
    category: escalation.category,
    summary: 'Use Archived Forms when the employer summary appears missing after filing.',
    symptom: 'Employer summary appears missing after payroll filing.',
    rootCause: 'The summary is available from Archived Forms after the filed year is selected.',
    exactFix: 'Open Archived Forms, select the filed tax year, and verify the employer summary.',
    escalationPath: '',
    keySignals: ['archived forms', 'employer summary missing'],
    confidence: 0.86,
    sourceSnapshot: {
      status: escalation.status,
      category: escalation.category,
      coid: escalation.coid || '',
      caseNumber: escalation.caseNumber || '',
      attemptingTo: escalation.attemptingTo || '',
      actualOutcome: escalation.actualOutcome || '',
      resolution: escalation.resolution || '',
      resolutionNotes: escalation.resolutionNotes || '',
      resolvedAt: escalation.resolvedAt || null,
    },
    generatedAt: new Date('2026-05-04T13:00:00.000Z'),
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
  await Promise.all([
    Escalation.deleteMany({}),
    KnowledgeCandidate.deleteMany({}),
    OperationalClaim.deleteMany({}),
    OperationalEvidence.deleteMany({}),
  ]);
  delete process.env.KNOWLEDGE_DEFAULT_ROLE;
});

test('knowledge review and publish synchronize operational claims and evidence', async () => {
  const app = createApp();
  const agent = request(app);
  const escalation = await makeEscalation({ caseNumber: 'CASE-OI-PUBLISH' });
  const candidate = await makeCandidate(escalation);

  const update = await agent
    .patch(`/api/knowledge/records/candidate:${candidate._id}`)
    .set('x-knowledge-role', 'admin')
    .set('x-knowledge-actor', 'reviewer-a')
    .send({
      reviewStatus: 'approved',
      publishTarget: 'category',
      reusableOutcome: 'canonical',
      scope: {
        appliesTo: ['QBO payroll archived forms'],
        excludes: ['unfiled tax forms'],
      },
    });

  assert.equal(update.status, 200);
  assert.equal(update.body.operationalIntelligence.synced, true);
  assert.equal(update.body.operationalIntelligence.policy.validationStatus, 'reviewed');
  assert.ok(update.body.operationalIntelligence.claims.some((claim) => claim.claimType === 'fix'));

  const reviewedDetail = await agent.get(`/api/operational-intelligence/records/candidate:${candidate._id}`);
  assert.equal(reviewedDetail.status, 200);
  assert.ok(reviewedDetail.body.intelligence.claims.some((claim) => claim.validationStatus === 'reviewed'));
  assert.ok(reviewedDetail.body.intelligence.evidence.some((item) => item.sourceType === 'escalation'));
  assert.ok(reviewedDetail.body.intelligence.evidence.some((item) => item.sourceType === 'resolution'));

  const reviewedFinalContext = await agent
    .get('/api/operational-intelligence/context')
    .query({ query: 'Archived Forms employer summary', allowedUse: 'agent-response', includeLegacy: 'false' });
  assert.equal(reviewedFinalContext.status, 200);
  assert.equal(reviewedFinalContext.body.context.claims.length, 0);

  const publish = await agent
    .post(`/api/knowledge/records/candidate:${candidate._id}/publish`)
    .set('x-knowledge-role', 'publisher')
    .set('x-knowledge-actor', 'publisher-a')
    .send({ exportMarkdown: false });

  assert.equal(publish.status, 200);
  assert.equal(publish.body.operationalIntelligence.policy.validationStatus, 'trusted');
  assert.ok(publish.body.operationalIntelligence.policy.allowedUses.includes('agent-response'));

  const trustedContext = await agent
    .get('/api/operational-intelligence/context')
    .query({ query: 'Archived Forms employer summary', allowedUse: 'agent-response', includeLegacy: 'false' });
  assert.equal(trustedContext.status, 200);
  assert.ok(trustedContext.body.context.records.some((record) => record.id === `candidate:${candidate._id}`));
  assert.ok(trustedContext.body.context.claims.some((claim) => claim.claimType === 'fix' && claim.agentSafe));
  assert.ok(trustedContext.body.context.records[0].operationalClaims.length > 0);

  const legacyEndpointContext = await agent
    .get('/api/knowledge/agent-context')
    .query({ query: 'Archived Forms employer summary', allowedUse: 'agent-response', includeLegacy: 'false' });
  assert.equal(legacyEndpointContext.status, 200);
  assert.ok(legacyEndpointContext.body.context.claims.some((claim) => claim.validationStatus === 'trusted'));
});

test('deprecating trusted knowledge removes operational claims from final agent context', async () => {
  const app = createApp();
  const agent = request(app);
  const escalation = await makeEscalation({ caseNumber: 'CASE-OI-DEPRECATE' });
  const candidate = await makeCandidate(escalation, {
    reviewStatus: 'published',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
    publishedAt: new Date('2026-05-05T12:00:00.000Z'),
    publishedDocType: 'database',
  });

  const detail = await agent.get(`/api/operational-intelligence/records/candidate:${candidate._id}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.body.intelligence.claims.some((claim) => claim.validationStatus === 'trusted'));

  const deprecated = await agent
    .post(`/api/knowledge/records/candidate:${candidate._id}/deprecate`)
    .set('x-knowledge-role', 'publisher')
    .send({ reason: 'QBO workflow changed.' });
  assert.equal(deprecated.status, 200);
  assert.equal(deprecated.body.operationalIntelligence.policy.validationStatus, 'deprecated');

  const context = await agent
    .get('/api/operational-intelligence/context')
    .query({ query: 'Archived Forms employer summary', allowedUse: 'agent-response', includeLegacy: 'false' });
  assert.equal(context.status, 200);
  assert.equal(context.body.context.claims.length, 0);
});
