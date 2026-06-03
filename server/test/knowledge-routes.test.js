const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const Escalation = require('../src/models/Escalation');
const KnowledgeCandidate = require('../src/models/KnowledgeCandidate');

process.env.NODE_ENV = 'test';

function makeEscalation(fields = {}) {
  return Escalation.create({
    category: 'payroll',
    status: 'resolved',
    attemptingTo: 'Generate year-end tax forms',
    actualOutcome: 'Tax form archive is missing an expected summary',
    resolution: 'Use the archived forms workflow and confirm the employer summary.',
    resolutionNotes: 'Confirmed after reviewing the resolved case.',
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
    title: 'Draft case learning',
    category: escalation.category || 'unknown',
    summary: 'Draft summary',
    symptom: escalation.actualOutcome || '',
    rootCause: '',
    exactFix: '',
    confidence: 0.6,
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
    generatedAt: new Date('2026-05-02T12:00:00.000Z'),
    ...fields,
  });
}

test('knowledge routes expose governed records and agent-safe context', async (t) => {
  await connect();
  const app = createApp();
  const agent = request(app);

  t.after(async () => {
    await Escalation.deleteMany({});
    await KnowledgeCandidate.deleteMany({});
    await disconnect();
  });

  t.beforeEach(async () => {
    await Escalation.deleteMany({});
    await KnowledgeCandidate.deleteMany({});
  });

  await t.test('summary returns candidate counts and playbook metadata', async () => {
    const trustedEscalation = await makeEscalation({ caseNumber: 'CASE-TRUSTED-1' });
    const draftEscalation = await makeEscalation({
      caseNumber: 'CASE-DRAFT-1',
      actualOutcome: 'Bank feed duplicate transaction pattern is unresolved',
      category: 'bank-feeds',
    });

    await makeCandidate(trustedEscalation, {
      reviewStatus: 'published',
      publishTarget: 'category',
      reusableOutcome: 'canonical',
      title: 'Payroll archive summary fix',
      rootCause: 'The user was looking in the wrong archived form area.',
      exactFix: 'Open Archived Forms, choose the year, and confirm the employer summary.',
      publishedAt: new Date('2026-05-03T12:00:00.000Z'),
    });
    await makeCandidate(draftEscalation, {
      reviewStatus: 'draft',
      title: 'Bank feed duplicate transaction draft',
      category: 'bank-feeds',
    });

    const res = await agent.get('/api/knowledge/summary');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.summary.candidates.total, 2);
    assert.equal(res.body.summary.candidates.byReviewStatus.published, 1);
    assert.equal(res.body.summary.candidates.byReviewStatus.draft, 1);
    assert.equal(res.body.summary.candidates.byTrustState.trusted, 1);
    assert.ok(res.body.summary.legacyPlaybook.sourceCount >= 0);
  });

  await t.test('agent context includes trusted records and excludes drafts by default', async () => {
    const trustedEscalation = await makeEscalation({ caseNumber: 'CASE-TRIAGE-1' });
    const draftEscalation = await makeEscalation({
      caseNumber: 'CASE-TRIAGE-2',
      actualOutcome: 'Payroll archive summary draft issue',
    });

    const trusted = await makeCandidate(trustedEscalation, {
      reviewStatus: 'published',
      publishTarget: 'category',
      reusableOutcome: 'canonical',
      title: 'Payroll archive summary fix',
      summary: 'Use Archived Forms when the employer summary is missing.',
      symptom: 'Employer summary appears missing during tax form review.',
      rootCause: 'The summary exists in Archived Forms after filing.',
      exactFix: 'Open Archived Forms, select the correct year, and verify the summary.',
      keySignals: ['year-end tax form', 'archived forms', 'missing employer summary'],
      confidence: 0.9,
      publishedAt: new Date('2026-05-03T12:00:00.000Z'),
    });
    const draft = await makeCandidate(draftEscalation, {
      reviewStatus: 'draft',
      title: 'Payroll archive summary draft',
      summary: 'This draft should not be used by triage yet.',
      symptom: 'Payroll archive summary draft issue',
      rootCause: 'Unknown',
      exactFix: 'Draft fix',
      reusableOutcome: 'canonical',
    });

    const res = await agent
      .get('/api/knowledge/agent-context')
      .query({
        query: 'payroll archive summary',
        allowedUse: 'triage',
        includeLegacy: 'false',
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const ids = res.body.context.records.map((record) => record.id);
    assert.ok(ids.includes(`candidate:${trusted._id}`));
    assert.ok(!ids.includes(`candidate:${draft._id}`));
    assert.equal(res.body.context.records[0].trustState, 'trusted');
    assert.ok(res.body.context.records[0].allowedUses.includes('triage'));
  });

  await t.test('unsafe published candidates are excluded from final agent response context', async () => {
    const unsafeEscalation = await makeEscalation({
      caseNumber: 'CASE-UNSAFE-1',
      actualOutcome: 'Billing workaround that should not be reused',
      category: 'billing',
    });

    const unsafe = await makeCandidate(unsafeEscalation, {
      reviewStatus: 'published',
      publishTarget: 'category',
      reusableOutcome: 'unsafe-to-reuse',
      title: 'Unsafe billing workaround',
      category: 'billing',
      summary: 'This was a one-off workaround that should not become guidance.',
      symptom: 'Billing workaround unsafe test case',
      rootCause: 'One-off account state.',
      exactFix: 'Do not reuse.',
      publishedAt: new Date('2026-05-04T12:00:00.000Z'),
    });

    const res = await agent
      .get('/api/knowledge/agent-context')
      .query({
        query: 'unsafe billing workaround',
        allowedUse: 'agent-response',
        includeLegacy: 'false',
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const ids = res.body.context.records.map((record) => record.id);
    assert.ok(!ids.includes(`candidate:${unsafe._id}`));
    assert.equal(res.body.context.records.length, 0);
  });

  await t.test('search can include candidate records for review workflows', async () => {
    const draftEscalation = await makeEscalation({
      caseNumber: 'CASE-SEARCH-1',
      actualOutcome: 'Bank feed duplicate transaction pattern needs review',
      category: 'bank-feeds',
    });
    const draft = await makeCandidate(draftEscalation, {
      reviewStatus: 'draft',
      reusableOutcome: 'case-history-only',
      title: 'Bank feed duplicate transaction draft',
      category: 'bank-feeds',
      summary: 'Candidate only, useful for reviewer search.',
      symptom: 'Bank feed duplicate transaction pattern',
      exactFix: 'Needs review.',
    });

    const res = await agent
      .get('/api/knowledge/search')
      .query({
        query: 'bank feed duplicate transaction',
        includeLegacy: 'false',
        includeCandidates: 'true',
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const found = res.body.records.find((record) => record.id === `candidate:${draft._id}`);
    assert.ok(found);
    assert.equal(found.trustState, 'candidate');
    assert.ok(found.warnings.includes('candidate_needs_review'));
  });
});
