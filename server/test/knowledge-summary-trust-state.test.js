'use strict';

// getKnowledgeSummary trust-state regression tests (2026-06-03 review, Medium).
//
// Contract under test: byTrustState is derived from deriveTrustState — the
// same single source of truth as every read path — so each record lands in
// exactly ONE trust bucket. Previously: TRUSTED was sourced from
// reviewStatus==='published' (counting published-but-unsafe records as
// trusted), RESTRICTED/DEPRECATED came from overlapping countDocuments calls
// (double-booking), and total summed only byReviewStatus.

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
    caseNumber: `CASE-SUM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    attemptingTo: 'Use a QBO workflow',
    actualOutcome: 'Outcome under review',
    resolution: 'Resolution text.',
    resolvedAt: new Date('2026-05-01T12:00:00.000Z'),
    ...fields,
  });
}

async function makeCandidate(fields = {}) {
  const escalation = await makeEscalation();
  return KnowledgeCandidate.create({
    escalationId: escalation._id,
    reviewStatus: 'draft',
    publishTarget: 'case-history-only',
    reusableOutcome: 'case-history-only',
    title: 'Summary count fixture',
    category: 'payroll',
    summary: 'Fixture summary',
    rootCause: 'Fixture root cause',
    exactFix: 'Fixture exact fix',
    confidence: 0.7,
    generatedAt: new Date('2026-05-02T12:00:00.000Z'),
    ...fields,
  });
}

function sumValues(map) {
  return Object.values(map).reduce((sum, count) => sum + count, 0);
}

test.before(async () => {
  await connect();
});

test.after(async () => {
  await disconnect();
});

test.beforeEach(async () => {
  await Escalation.deleteMany({});
  await KnowledgeCandidate.deleteMany({});
});

test('summary counts each record in exactly one trust bucket via deriveTrustState', async () => {
  const app = createApp();
  const agent = request(app);

  // 1. trusted: published + canonical
  await makeCandidate({
    reviewStatus: 'published',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
    publishedAt: new Date('2026-05-03T12:00:00.000Z'),
  });
  // 2. restricted: PUBLISHED but unsafe-to-reuse — the old code counted this
  //    as TRUSTED (the inflation bug) and also double-booked it via the
  //    separate restricted countDocuments.
  await makeCandidate({
    reviewStatus: 'published',
    publishTarget: 'category',
    reusableOutcome: 'unsafe-to-reuse',
    publishedAt: new Date('2026-05-03T12:00:00.000Z'),
  });
  // 3. restricted: draft + unsafe-to-reuse (old code double-booked as both
  //    candidate AND restricted).
  await makeCandidate({ reviewStatus: 'draft', reusableOutcome: 'unsafe-to-reuse' });
  // 4. reviewed: approved
  await makeCandidate({ reviewStatus: 'approved' });
  // 5. candidate: plain draft
  await makeCandidate({ reviewStatus: 'draft' });
  // 6. rejected
  await makeCandidate({ reviewStatus: 'rejected' });
  // 7. deprecated: published canonical that was later deprecated (old code
  //    counted it as trusted AND deprecated).
  await makeCandidate({
    reviewStatus: 'published',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
    publishedAt: new Date('2026-05-03T12:00:00.000Z'),
    deprecatedAt: new Date('2026-05-20T12:00:00.000Z'),
  });
  // 8. restricted via a restrictive trustStateOverride on a published record.
  await makeCandidate({
    reviewStatus: 'published',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
    publishedAt: new Date('2026-05-03T12:00:00.000Z'),
    trustStateOverride: 'restricted',
  });

  const res = await agent.get('/api/knowledge/summary');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const { candidates } = res.body.summary;

  // Mutually exclusive trust buckets — each of the 8 records in exactly one.
  assert.deepEqual(candidates.byTrustState, {
    candidate: 1,
    reviewed: 1,
    trusted: 1,
    rejected: 1,
    restricted: 3,
    deprecated: 1,
  });

  // The inflation bug: 4 records are published, but only 1 is TRUSTED.
  assert.equal(candidates.byReviewStatus.published, 4);
  assert.equal(candidates.byTrustState.trusted, 1);

  // Totals are consistent across every breakdown — no double counting.
  assert.equal(candidates.total, 8);
  assert.equal(sumValues(candidates.byTrustState), candidates.total);
  assert.equal(sumValues(candidates.byReviewStatus), candidates.total);
  assert.equal(sumValues(candidates.byReusableOutcome), candidates.total);
  assert.equal(sumValues(candidates.byPublishTarget), candidates.total);
});

test('summary trust buckets stay zeroed and consistent when the collection is empty', async () => {
  const app = createApp();
  const agent = request(app);

  const res = await agent.get('/api/knowledge/summary');
  assert.equal(res.status, 200);
  const { candidates } = res.body.summary;
  assert.equal(candidates.total, 0);
  assert.deepEqual(candidates.byTrustState, {
    candidate: 0,
    reviewed: 0,
    trusted: 0,
    rejected: 0,
    restricted: 0,
    deprecated: 0,
  });
  assert.equal(sumValues(candidates.byReviewStatus), 0);
});
