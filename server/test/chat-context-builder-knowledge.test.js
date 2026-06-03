'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const mongo = require('./_mongo-helper');
const KnowledgeCandidate = require('../src/models/KnowledgeCandidate');
const { buildChatModelContext } = require('../src/lib/chat-context-builder');
const { DEFAULT_CHAT_RUNTIME_SETTINGS } = require('../src/lib/chat-settings');

function makeSettings() {
  return {
    ...DEFAULT_CHAT_RUNTIME_SETTINGS,
    context: {
      ...DEFAULT_CHAT_RUNTIME_SETTINGS.context,
      maxInputTokens: 6000,
    },
    knowledge: {
      ...DEFAULT_CHAT_RUNTIME_SETTINGS.knowledge,
      mode: 'retrieval-only',
      retrievalTopK: 5,
      includeCitations: true,
    },
  };
}

async function createCandidate(fields = {}) {
  return KnowledgeCandidate.create({
    escalationId: new mongoose.Types.ObjectId(),
    conversationId: null,
    reviewStatus: 'draft',
    publishTarget: 'case-history-only',
    reusableOutcome: 'case-history-only',
    title: 'Draft case learning',
    category: 'payroll',
    summary: 'Draft summary',
    symptom: 'Payroll archive summary missing',
    rootCause: '',
    exactFix: '',
    confidence: 0.6,
    sourceSnapshot: {
      status: 'resolved',
      category: 'payroll',
      caseNumber: 'CASE-KB-CONTEXT',
      actualOutcome: 'Payroll archive summary missing',
      resolution: 'Reviewed resolution text',
      resolvedAt: new Date('2026-05-01T12:00:00.000Z'),
    },
    generatedAt: new Date('2026-05-02T12:00:00.000Z'),
    ...fields,
  });
}

test.before(async () => {
  process.env.NODE_ENV = 'test';
  await mongo.connect();
});

test.after(async () => {
  await mongo.disconnect();
});

test.beforeEach(async () => {
  await KnowledgeCandidate.deleteMany({});
});

test('chat context builder uses trusted KB records and excludes draft guidance', async () => {
  const trusted = await createCandidate({
    reviewStatus: 'published',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
    title: 'Payroll archive summary fix',
    summary: 'Use Archived Forms when the employer summary appears missing.',
    symptom: 'Employer summary appears missing during payroll tax form review.',
    rootCause: 'The summary is available from the archived form workflow after filing.',
    exactFix: 'Open Archived Forms, select the correct year, and verify the employer summary.',
    keySignals: ['tax form archive', 'missing employer summary'],
    confidence: 0.9,
    publishedAt: new Date('2026-05-03T12:00:00.000Z'),
  });
  const draft = await createCandidate({
    reviewStatus: 'draft',
    reusableOutcome: 'canonical',
    title: 'Draft payroll archive advice',
    summary: 'This draft should not be trusted by the chat agent.',
    rootCause: 'Unknown',
    exactFix: 'Draft-only fix',
  });

  const result = await buildChatModelContext({
    normalizedMessages: [{
      role: 'user',
      content: 'Customer says the payroll archive employer summary is missing.',
    }],
    settings: makeSettings(),
  });

  assert.match(result.systemPrompt, /Retrieved Knowledgebase Context/);
  assert.match(result.systemPrompt, /Payroll archive summary fix/);
  assert.doesNotMatch(result.systemPrompt, /Draft payroll archive advice/);
  assert.equal(result.contextDebug.knowledgebase.source, 'knowledgebase');
  assert.equal(result.contextDebug.knowledgebase.fallbackUsed, false);

  const recordIds = result.contextDebug.knowledgebase.records.map((record) => record.id);
  assert.ok(recordIds.includes(`candidate:${trusted._id}`));
  assert.ok(!recordIds.includes(`candidate:${draft._id}`));

  const citation = result.citations.find((item) => item.id === `candidate:${trusted._id}`);
  assert.ok(citation);
  assert.equal(citation.trustState, 'trusted');
});
