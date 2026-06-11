'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const mongo = require('./_mongo-helper');
const KnowledgeCandidate = require('../src/models/KnowledgeCandidate');
const {
  buildAgentKnowledgeContext,
  rankKnowledgeRecords,
  scoreRecordRelevance,
} = require('../src/services/knowledgebase-service');

// Terms after splitSearchTerms: attempting, fix, cpp, payroll, deduction,
// calculating, employee, actual, outcome, missing, paycheque.
const CPP_QUERY = [
  'CX IS ATTEMPTING TO: fix CPP payroll deduction not calculating for employee',
  'ACTUAL OUTCOME: CPP deduction missing from paycheque',
].join('\n');

function governedRecord(overrides = {}) {
  return {
    id: overrides.id || `candidate:${new mongoose.Types.ObjectId()}`,
    sourceType: 'knowledge-candidate',
    title: '',
    summary: '',
    symptom: '',
    rootCause: '',
    exactFix: '',
    escalationPath: '',
    customerGoal: '',
    reportedProblem: '',
    troubleshootingTried: '',
    confirmedCause: '',
    finalOutcome: '',
    category: '',
    keySignals: [],
    trustState: 'trusted',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function legacyRecord(score, overrides = {}) {
  return {
    id: overrides.id || `legacy-playbook:category:test:${score}`,
    sourceType: 'legacy-playbook',
    title: 'Legacy chunk',
    exactFix: 'payroll deduction guidance from the playbook',
    trustState: 'legacy-trusted',
    lineage: { score, chars: 100 },
    updatedAt: null,
    ...overrides,
  };
}

async function createCandidate(fields = {}) {
  return KnowledgeCandidate.create({
    escalationId: new mongoose.Types.ObjectId(),
    conversationId: null,
    reviewStatus: 'published',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
    title: 'Published case learning',
    category: 'payroll',
    confidence: 0.8,
    publishedAt: new Date('2026-05-03T12:00:00.000Z'),
    generatedAt: new Date('2026-05-02T12:00:00.000Z'),
    ...fields,
  });
}

// ---------------------------------------------------------------------------
// Pure scoring tests
// ---------------------------------------------------------------------------

test('scoreRecordRelevance weights heavy fields above light fields and applies boosts', () => {
  const terms = ['payroll', 'deduction'];
  const record = governedRecord({
    title: 'CPP payroll deduction missing', // payroll + deduction both heavy
    exactFix: 'Update the exemption setting', // claim content present
    trustState: 'trusted',
  });
  const relevance = scoreRecordRelevance(record, terms);
  // 2 heavy terms * 2 + claimBoost 1 + trustBoost 1
  assert.equal(relevance.score, 6);
  assert.equal(relevance.matchedTerms, 2);
  assert.equal(relevance.claimBoost, 1);
  assert.equal(relevance.trustBoost, 1);
  assert.equal(relevance.legacy, false);

  const lightOnly = governedRecord({
    summary: 'General payroll housekeeping notes', // payroll light only
    trustState: 'reviewed',
  });
  const lightRelevance = scoreRecordRelevance(lightOnly, terms);
  // 1 light term * 1, no claim fields, not trusted
  assert.equal(lightRelevance.score, 1);
  assert.equal(lightRelevance.matchedTerms, 1);
  assert.equal(lightRelevance.claimBoost, 0);
  assert.equal(lightRelevance.trustBoost, 0);
});

test('scoreRecordRelevance gives zero to records with no meaningful term match', () => {
  const record = governedRecord({
    title: 'Resolution Notes',
    summary: 'Standard wrap-up template',
  });
  const relevance = scoreRecordRelevance(record, ['payroll', 'deduction']);
  assert.equal(relevance.score, 0);
  assert.equal(relevance.matchedTerms, 0);
});

test('scoreRecordRelevance category hint boosts matches but never the unknown sentinel', () => {
  const terms = ['deduction'];
  const payrollRecord = governedRecord({ summary: 'deduction help', category: 'payroll', trustState: 'reviewed' });
  const boosted = scoreRecordRelevance(payrollRecord, terms, 'payroll');
  const unboosted = scoreRecordRelevance(payrollRecord, terms, 'reports');
  assert.equal(boosted.categoryBoost, 1);
  assert.equal(boosted.score, unboosted.score + 1);

  // 'unknown' is both the classifier sentinel and the record default —
  // unknown==unknown must never count as a category match.
  const unknownRecord = governedRecord({ summary: 'deduction help', category: 'unknown', trustState: 'reviewed' });
  const sentinel = scoreRecordRelevance(unknownRecord, terms, 'unknown');
  assert.equal(sentinel.categoryBoost, 0);
});

test('scoreRecordRelevance respects the playbook search score for legacy chunks', () => {
  const relevance = scoreRecordRelevance(legacyRecord(3.45), ['payroll', 'deduction']);
  assert.equal(relevance.score, 3.45);
  assert.equal(relevance.legacy, true);
  assert.equal(relevance.claimBoost, 0);
  assert.equal(relevance.trustBoost, 0);
  assert.ok(relevance.matchedTerms >= 1);
});

// ---------------------------------------------------------------------------
// Pure ranking / gate / cap tests
// ---------------------------------------------------------------------------

test('rankKnowledgeRecords gates zero-match records and weak legacy chunks instead of padding', () => {
  const terms = ['payroll', 'deduction'];
  const records = [
    governedRecord({ id: 'candidate:relevant', title: 'payroll deduction fix', exactFix: 'fix steps' }),
    governedRecord({ id: 'candidate:noise', title: 'Resolution Notes', summary: 'generic template' }),
    legacyRecord(1.15, { id: 'legacy:weak' }), // below RELEVANCE_LEGACY_MIN_SCORE (2)
  ];
  const ranked = rankKnowledgeRecords(records, { terms, limit: 5 });
  assert.deepEqual(ranked.map((record) => record.id), ['candidate:relevant']);
});

test('rankKnowledgeRecords caps legacy chunks at 2 and never displaces governed records on ties', () => {
  const terms = ['payroll'];
  // governedA: 1 heavy term (2) + claim (1) + trust (1) = 4 — ties legacy(4).
  const governedA = governedRecord({ id: 'candidate:a', title: 'payroll fix', exactFix: 'steps' });
  // governedB: 1 light term (1) + trust (1) = 2.
  const governedB = governedRecord({ id: 'candidate:b', summary: 'payroll notes' });
  const records = [
    legacyRecord(3, { id: 'legacy:3' }),
    legacyRecord(4, { id: 'legacy:4' }),
    governedB,
    legacyRecord(5, { id: 'legacy:5' }),
    governedA,
  ];
  const ranked = rankKnowledgeRecords(records, { terms, limit: 5 });
  // legacy:5 (5), governed a (4, ties legacy:4 but governed sorts first),
  // legacy:4 (cap slot 2), legacy:3 blocked by cap, governed b (2).
  assert.deepEqual(ranked.map((record) => record.id), ['legacy:5', 'candidate:a', 'legacy:4', 'candidate:b']);
  assert.equal(ranked.filter((record) => record.relevance.legacy).length, 2);
  // 4 records, not padded to the limit of 5.
  assert.equal(ranked.length, 4);
});

test('rankKnowledgeRecords breaks score ties between governed records by recency', () => {
  const terms = ['payroll'];
  const older = governedRecord({ id: 'candidate:older', summary: 'payroll notes', updatedAt: '2026-01-01T00:00:00.000Z' });
  const newer = governedRecord({ id: 'candidate:newer', summary: 'payroll notes', updatedAt: '2026-06-01T00:00:00.000Z' });
  const ranked = rankKnowledgeRecords([older, newer], { terms, limit: 5 });
  assert.deepEqual(ranked.map((record) => record.id), ['candidate:newer', 'candidate:older']);
});

// ---------------------------------------------------------------------------
// Database-backed retrieval tests (triage call shape)
// ---------------------------------------------------------------------------

test('relevance-ranked retrieval', async (t) => {
  t.before(async () => {
    await mongo.connect();
  });
  t.after(async () => {
    await mongo.disconnect();
  });
  t.beforeEach(async () => {
    await KnowledgeCandidate.deleteMany({});
  });

  const triageOptions = {
    query: CPP_QUERY,
    allowedUse: 'triage',
    limit: 5,
    includeLegacy: false, // pure DB ranking; legacy behavior is unit-tested above
    includeCandidates: false,
    rankByRelevance: true,
  };

  await t.test('ranks by match quality instead of recency', async () => {
    const strong = await createCandidate({
      title: 'CPP payroll deduction not calculating',
      symptom: 'CPP deduction missing from employee paycheque',
      exactFix: 'Update the employee CPP exemption setting in payroll',
    });
    // Created later, so it is the most recently updated record.
    const weak = await createCandidate({
      title: 'Quarterly reports walkthrough',
      category: 'reports',
      summary: 'General payroll housekeeping reminders',
    });

    const ranked = await buildAgentKnowledgeContext(triageOptions);
    assert.equal(ranked.records[0].id, `candidate:${strong._id}`);
    assert.ok(ranked.records[0].relevance.score > (ranked.records[1]?.relevance.score || 0));
    assert.ok(ranked.records[0].relevance.matchedTerms >= 4);

    // Control: without the flag the legacy recency order returns the newer,
    // weaker record first and exposes no relevance metadata.
    const unranked = await buildAgentKnowledgeContext({ ...triageOptions, rankByRelevance: false });
    assert.equal(unranked.records[0].id, `candidate:${weak._id}`);
    assert.ok(!('relevance' in unranked.records[0]));
  });

  await t.test('CPP regression: generic records matching only snapshot noise are excluded, not padded', async () => {
    const payroll = await createCandidate({
      title: 'CPP payroll deduction not calculating',
      symptom: 'CPP deduction missing from employee paycheque',
      exactFix: 'Update the employee CPP exemption setting in payroll',
    });
    // These mirror the real failure: generic "Resolution Notes" records from
    // other categories whose only query-term overlap lives in snapshot
    // fields the Mongo filter searches but that carry no diagnostic value.
    await createCandidate({
      title: 'Resolution Notes',
      category: 'reports',
      summary: 'Standard resolution wrap-up template',
      sourceSnapshot: { resolutionNotes: 'employee deduction question handled in chat' },
    });
    await createCandidate({
      title: 'Resolution Notes',
      category: 'permissions',
      summary: 'Access review wrap-up checklist',
      sourceSnapshot: { conversationPreview: 'agent asked about payroll access' },
    });

    const context = await buildAgentKnowledgeContext(triageOptions);
    assert.deepEqual(context.records.map((record) => record.id), [`candidate:${payroll._id}`]);
    assert.ok(context.records.length < 5, 'returns fewer than the limit instead of padding with junk');
  });

  await t.test('returns an empty packet when nothing relevant exists', async () => {
    await createCandidate({
      title: 'Banking feed duplicate transactions',
      category: 'banking',
      summary: 'Bank feed shows duplicated entries',
      exactFix: 'Exclude the duplicated rows from the feed',
    });

    const context = await buildAgentKnowledgeContext(triageOptions);
    assert.equal(context.records.length, 0);
  });

  await t.test('category hint boosts same-category records without filtering others out', async () => {
    // Both records match the term "deduction" identically; only the
    // category differs. The hint must reorder, not exclude.
    const payroll = await createCandidate({
      title: 'Employee deduction setup',
      category: 'payroll',
      exactFix: 'Open the deduction settings and re-save the employee profile',
    });
    const banking = await createCandidate({
      title: 'Employee deduction setup',
      category: 'banking',
      exactFix: 'Open the deduction settings and re-save the employee profile',
    });

    const context = await buildAgentKnowledgeContext({ ...triageOptions, categoryHint: 'payroll' });
    assert.equal(context.records.length, 2);
    assert.equal(context.records[0].id, `candidate:${payroll._id}`);
    assert.equal(context.records[0].relevance.categoryBoost, 1);
    const bankingRecord = context.records.find((record) => record.id === `candidate:${banking._id}`);
    assert.ok(bankingRecord, 'off-category record is still included');
    assert.equal(bankingRecord.relevance.categoryBoost, 0);
  });
});
