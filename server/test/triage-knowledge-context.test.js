'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const mongo = require('./_mongo-helper');
const KnowledgeCandidate = require('../src/models/KnowledgeCandidate');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const TriageResult = require('../src/models/TriageResult');
const { runTriage } = require('../src/services/triage');

const PARSER_TEXT = [
  'COID/MID: 12345 / 67890',
  'CASE: CS-2026-002001',
  'CLIENT/CONTACT: Example Client',
  'CX IS ATTEMPTING TO: review payroll archive employer summary',
  'EXPECTED OUTCOME: employer summary appears in archived forms',
  'ACTUAL OUTCOME: payroll archive employer summary is missing',
  'KB/TOOLS USED: Help panel',
  'TRIED TEST ACCOUNT: yes',
  'TS STEPS: checked payroll forms and retried archive view',
].join('\n');

const TRIAGE_OUTPUT = [
  'Category: payroll',
  'Severity: P3',
  'Fast read: Payroll archived forms are missing the expected employer summary.',
  'Immediate next step: Check Archived Forms for the filed year and confirm whether the employer summary is available there.',
  'Missing info: filed tax year',
  'Confidence: High',
  'Category check: Payroll because this is a tax form archive workflow.',
].join('\n');

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
    symptom: 'Payroll archive employer summary missing',
    rootCause: '',
    exactFix: '',
    confidence: 0.6,
    sourceSnapshot: {
      status: 'resolved',
      category: 'payroll',
      caseNumber: 'CASE-TRIAGE-KB',
      actualOutcome: 'Payroll archive employer summary missing',
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
  await Promise.all([
    KnowledgeCandidate.deleteMany({}),
    ProviderCallPackage.deleteMany({}),
    TriageResult.deleteMany({}),
  ]);
});

test('runTriage injects trusted KB context and records KB trace metadata', async () => {
  const trusted = await createCandidate({
    reviewStatus: 'published',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
    title: 'Payroll archived employer summary fix',
    summary: 'Use Archived Forms when the employer summary appears missing after filing.',
    symptom: 'Employer summary appears missing during payroll tax form archive review.',
    rootCause: 'The summary is available from Archived Forms after the filed year is selected.',
    exactFix: 'Open Archived Forms, select the filed tax year, and verify the employer summary.',
    keySignals: ['payroll archive', 'employer summary missing'],
    confidence: 0.9,
    publishedAt: new Date('2026-05-03T12:00:00.000Z'),
  });
  const draft = await createCandidate({
    reviewStatus: 'draft',
    reusableOutcome: 'canonical',
    title: 'Draft payroll archive triage advice',
    summary: 'This draft must not be sent to the triage provider as trusted context.',
    rootCause: 'Unknown',
    exactFix: 'Draft-only fix',
  });

  const packageId = new mongoose.Types.ObjectId();
  let capturedSystemPrompt = '';
  const events = [];

  const result = await runTriage(PARSER_TEXT, {
    runId: 'triage-knowledge-context',
    provider: 'lm-studio',
    model: 'local-triage-model',
    eventBus: {
      emit(kind, data) {
        events.push({ kind, data });
      },
    },
    preflightProvider: async () => ({ ok: true, code: 'OK', reason: 'stub reachable' }),
    runDirectTriageProviderCall: async ({ systemPrompt }) => {
      capturedSystemPrompt = systemPrompt;
      await ProviderCallPackage.collection.insertOne({
        _id: packageId,
        providerId: 'lm-studio',
        providerResearchId: 'lm-studio-openai-compatible',
        providerPathType: 'lm-studio-http-nonstream',
        outcome: 'success',
        lmStudio: {
          response: {
            parsedJson: {
              choices: [{ message: { role: 'assistant', content: TRIAGE_OUTPUT } }],
            },
          },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      return {
        providerTrace: {
          providerId: 'lm-studio',
          providerPackageId: String(packageId),
          model: 'local-triage-model',
          captureEnabled: true,
        },
        fullResponse: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'success');
  assert.match(capturedSystemPrompt, /Trusted QBO Knowledgebase Context/);
  assert.match(capturedSystemPrompt, /Payroll archived employer summary fix/);
  assert.doesNotMatch(capturedSystemPrompt, /Draft payroll archive triage advice/);

  const recordIds = result.triageMeta.knowledgeContext.records.map((record) => record.id);
  assert.ok(recordIds.includes(`candidate:${trusted._id}`));
  assert.ok(!recordIds.includes(`candidate:${draft._id}`));
  assert.equal(result.triageMeta.knowledgeContext.allowedUse, 'triage');
  assert.ok(events.some((event) => event.kind === 'triage.knowledge_context_built'));

  // The trace must explain WHY each record was chosen (relevance ranking).
  const tracedTrusted = result.triageMeta.knowledgeContext.records
    .find((record) => record.id === `candidate:${trusted._id}`);
  assert.ok(tracedTrusted.relevance, 'trace records carry relevance metadata');
  assert.ok(tracedTrusted.relevance.score > 0);
  assert.ok(tracedTrusted.relevance.matchedTerms > 0);
  assert.equal(tracedTrusted.relevance.legacy, false);
  // Legacy playbook chunks may ride along, but never more than 2.
  const legacyTraceCount = result.triageMeta.knowledgeContext.records
    .filter((record) => record.relevance?.legacy).length;
  assert.ok(legacyTraceCount <= 2, `legacy records capped at 2, saw ${legacyTraceCount}`);

  const saved = await TriageResult.findOne({ runId: 'triage-knowledge-context' }).lean();
  assert.ok(saved);
  assert.equal(saved.triageMeta.knowledgeContext.allowedUse, 'triage');
  assert.ok(saved.triageMeta.knowledgeContext.records.some((record) => record.id === `candidate:${trusted._id}`));
});
