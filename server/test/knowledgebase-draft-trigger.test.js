'use strict';

// ---------------------------------------------------------------------------
// Pipeline KB-draft trigger tests
//
// Verifies the decoupled, status-INDEPENDENT auto-draft on-ramp:
//   1. Every pipeline-created escalation gets a KB draft regardless of status
//      (open / in-progress / resolved / escalated-further).
//   2. Draft creation is idempotent — re-triggering never duplicates (the
//      KnowledgeCandidate.escalationId unique index is the guarantee).
//   3. The status-gated finalized path (the "Finish this escalation" flow) is
//      unchanged: only resolved/escalated-further WITH a recorded outcome draft.
//   4. The fire-and-forget trigger wrapper creates a draft asynchronously.
//
// The KB-agent model pass is intentionally skipped in tests (NODE_ENV=test and
// KNOWLEDGEBASE_AGENT_MODEL_IN_TESTS unset), so these tests exercise the
// deterministic draft path with no CLI subprocess.
//
// Exception: the "model-generated title" tests at the bottom opt IN to the
// model pass (KNOWLEDGEBASE_AGENT_MODEL_IN_TESTS=true) with the extraction
// stubbed below, to pin the title merge rules: the model's rule-following
// title supersedes the deterministic string-slice title; blank/omitted/trivial
// model titles fall back; over-long titles are word-boundary capped; and an
// editor-owned title (proven by 'record.update' audit events) is never
// overwritten on force regenerate.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

const { connect, disconnect } = require('./_mongo-helper');
const Escalation = require('../src/models/Escalation');
const KnowledgeCandidate = require('../src/models/KnowledgeCandidate');
const EscalationAttentionItem = require('../src/models/EscalationAttentionItem');

// Swappable extraction stub. routes/escalations.js destructures
// runKnowledgeBaseAgentDraftExtraction from the context service at require
// time, so the export is patched BEFORE the route module loads. Tests that
// leave the stub null get the real function (which never runs here anyway —
// the model pass is env-gated off by default).
const kbContextService = require('../src/services/knowledgebase-agent-context-service');
const realDraftExtraction = kbContextService.runKnowledgeBaseAgentDraftExtraction;
let draftExtractionStub = null;
kbContextService.runKnowledgeBaseAgentDraftExtraction = (...args) =>
  (draftExtractionStub || realDraftExtraction)(...args);

const {
  createKnowledgeDraftForEscalation,
  ensureKnowledgeDraftForEscalation,
  ensureKnowledgeDraftForFinalizedEscalation,
} = require('../src/routes/escalations');
const {
  triggerKnowledgeDraftForEscalation,
} = require('../src/services/knowledgebase-draft-trigger');

process.env.NODE_ENV = 'test';

let counter = 0;
function makeEscalation(fields = {}) {
  counter += 1;
  return Escalation.create({
    category: 'payroll',
    status: 'open',
    caseNumber: `CASE-TRIG-${counter}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    coid: `COID-${counter}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    attemptingTo: 'Run a payroll adjustment for the client',
    actualOutcome: 'The adjustment did not post to the ledger',
    tsSteps: 'Checked the payroll settings; re-ran the adjustment',
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
  delete process.env.KNOWLEDGEBASE_AGENT_MODEL_IN_TESTS;
  draftExtractionStub = null;
  await Escalation.deleteMany({});
  await KnowledgeCandidate.deleteMany({});
  await EscalationAttentionItem.deleteMany({});
});

test('creates a KB draft for an OPEN pipeline escalation (no resolve-status gate)', async () => {
  const escalation = await makeEscalation({ status: 'open' });
  const result = await ensureKnowledgeDraftForEscalation(escalation, { enrich: false });

  assert.ok(result, 'expected a result');
  assert.equal(result.generated, true, 'a new draft should have been generated');

  const candidate = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  assert.ok(candidate, 'a KnowledgeCandidate should exist for the open escalation');
  assert.equal(candidate.reviewStatus, 'draft');
  // The draft is populated from the real case evidence, not left blank.
  assert.ok(candidate.title && candidate.title.length > 0, 'title should be filled from the case');
  assert.ok(
    candidate.reportedProblem || candidate.symptom,
    'reported problem should be filled from actualOutcome',
  );
  assert.equal(candidate.category, 'payroll', 'category should carry over from the case');
});

test('creates a KB draft for an IN-PROGRESS escalation', async () => {
  const escalation = await makeEscalation({ status: 'in-progress' });
  const result = await ensureKnowledgeDraftForEscalation(escalation, { enrich: false });
  assert.equal(result.generated, true);
  const count = await KnowledgeCandidate.countDocuments({ escalationId: escalation._id });
  assert.equal(count, 1);
});

test('creates a KB draft for an ESCALATED-FURTHER escalation', async () => {
  const escalation = await makeEscalation({
    status: 'escalated-further',
    resolution: 'Handed off to QBO payroll specialists with INV reference.',
  });
  const result = await ensureKnowledgeDraftForEscalation(escalation, { enrich: false });
  assert.equal(result.generated, true);
  const candidate = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  assert.ok(candidate);
});

test('is idempotent — re-triggering does not create a duplicate draft', async () => {
  const escalation = await makeEscalation({ status: 'open' });

  const first = await ensureKnowledgeDraftForEscalation(escalation, { enrich: false });
  assert.equal(first.generated, true, 'first call generates');

  const second = await ensureKnowledgeDraftForEscalation(escalation, { enrich: false });
  assert.equal(second.generated, false, 'second call must reuse the existing draft');

  const count = await KnowledgeCandidate.countDocuments({ escalationId: escalation._id });
  assert.equal(count, 1, 'exactly one draft should exist after two triggers');
});

test('does NOT regress the finalized (resolve-status) path: open case yields no finalized draft', async () => {
  const escalation = await makeEscalation({ status: 'open' });
  const result = await ensureKnowledgeDraftForFinalizedEscalation(escalation, {});
  assert.equal(result, null, 'finalized ensure should skip a non-final case');
  const count = await KnowledgeCandidate.countDocuments({ escalationId: escalation._id });
  assert.equal(count, 0, 'the finalized path must not draft an open case');
});

test('finalized path still drafts a resolved case with a recorded outcome (finish-form flow intact)', async () => {
  const escalation = await makeEscalation({
    status: 'resolved',
    resolution: 'Re-ran the payroll adjustment after clearing the cached settings.',
    resolutionNotes: 'Confirmed the ledger posted correctly.',
    resolvedAt: new Date(),
  });
  const result = await ensureKnowledgeDraftForFinalizedEscalation(escalation, {});
  assert.ok(result, 'finalized ensure should produce a draft for a resolved case');
  assert.equal(result.generated, true);
  const count = await KnowledgeCandidate.countDocuments({ escalationId: escalation._id });
  assert.equal(count, 1);
});

test('fire-and-forget trigger eventually creates a draft for a pipeline escalation', async () => {
  const escalation = await makeEscalation({ status: 'open' });

  triggerKnowledgeDraftForEscalation(escalation, { trigger: 'test.pipeline.auto-draft' });

  // The trigger is non-blocking; poll briefly for the background draft to land.
  let candidate = null;
  for (let i = 0; i < 50 && !candidate; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    candidate = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
    if (!candidate) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  assert.ok(candidate, 'the fire-and-forget trigger should have created a draft');
  assert.equal(candidate.reviewStatus, 'draft');
});

// ---------------------------------------------------------------------------
// Model-generated KB draft titles (extraction merge rules)
// ---------------------------------------------------------------------------

// The deterministic fallback title for makeEscalation()'s case data — the
// inferDraftTitle string-slice of actualOutcome (capitalized, verbatim).
const DETERMINISTIC_TITLE = 'The adjustment did not post to the ledger';
const MODEL_TITLE = 'Payroll adjustment does not post to the ledger after submitting (QBO Payroll)';

function stubExtraction(fields) {
  draftExtractionStub = async () => ({
    text: JSON.stringify(fields),
    usage: null,
    contextBundle: null,
    providerUsed: 'stub-provider',
    modelUsed: 'stub-model',
    reasoningEffort: 'medium',
    providerPackageId: '',
    payloadSourcePath: '',
    fallbackUsed: false,
    fallbackFrom: '',
  });
}

test('model-extracted title supersedes the deterministic string-slice title', async () => {
  process.env.KNOWLEDGEBASE_AGENT_MODEL_IN_TESTS = 'true';
  stubExtraction({
    title: MODEL_TITLE,
    customerGoal: 'Post a payroll adjustment to the ledger.',
  });

  const escalation = await makeEscalation({ status: 'open' });
  const result = await createKnowledgeDraftForEscalation(escalation, { enrich: true });
  assert.equal(result.generated, true);
  assert.equal(result.enriched, true);

  const candidate = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  assert.equal(candidate.title, MODEL_TITLE, 'the model title should replace the string-slice');
  assert.equal(candidate.customerGoal, 'Post a payroll adjustment to the ledger.');
});

test('falls back to the deterministic title when the model omits the title', async () => {
  process.env.KNOWLEDGEBASE_AGENT_MODEL_IN_TESTS = 'true';
  stubExtraction({ customerGoal: 'Post a payroll adjustment to the ledger.' });

  const escalation = await makeEscalation({ status: 'open' });
  const result = await createKnowledgeDraftForEscalation(escalation, { enrich: true });
  assert.equal(result.enriched, true, 'the other model fields still enrich the draft');

  const candidate = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  assert.equal(candidate.title, DETERMINISTIC_TITLE);
});

test('falls back to the deterministic title when the model title is blank or trivial', async () => {
  process.env.KNOWLEDGEBASE_AGENT_MODEL_IN_TESTS = 'true';

  // Whitespace-only title.
  stubExtraction({ title: '   ', customerGoal: 'Post a payroll adjustment.' });
  const blankCase = await makeEscalation({ status: 'open' });
  await createKnowledgeDraftForEscalation(blankCase, { enrich: true });
  const blankCandidate = await KnowledgeCandidate.findOne({ escalationId: blankCase._id }).lean();
  assert.equal(blankCandidate.title, DETERMINISTIC_TITLE, 'whitespace title is treated as omitted');

  // Too-trivial title (under the 8-char floor after normalization).
  stubExtraction({ title: '"Payroll."', customerGoal: 'Post a payroll adjustment.' });
  const trivialCase = await makeEscalation({ status: 'open' });
  await createKnowledgeDraftForEscalation(trivialCase, { enrich: true });
  const trivialCandidate = await KnowledgeCandidate.findOne({ escalationId: trivialCase._id }).lean();
  assert.equal(trivialCandidate.title, DETERMINISTIC_TITLE, 'trivial title is treated as omitted');
});

test('normalizes a decorated model title: strips wrapping quotes and the trailing period', async () => {
  process.env.KNOWLEDGEBASE_AGENT_MODEL_IN_TESTS = 'true';
  stubExtraction({ title: `**"${MODEL_TITLE}."**` });

  const escalation = await makeEscalation({ status: 'open' });
  await createKnowledgeDraftForEscalation(escalation, { enrich: true });

  const candidate = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  assert.equal(candidate.title, MODEL_TITLE, 'markdown/quote wrapping and trailing period are stripped');
});

test('caps an over-long model title at the 200-char word boundary', async () => {
  process.env.KNOWLEDGEBASE_AGENT_MODEL_IN_TESTS = 'true';
  const longTitle = `Payroll adjustment does not post to the ledger ${'because the submitted totals keep recalculating '.repeat(6)}(QBO Payroll)`;
  assert.ok(longTitle.length > 200, 'fixture must exceed the cap');
  stubExtraction({ title: longTitle });

  const escalation = await makeEscalation({ status: 'open' });
  await createKnowledgeDraftForEscalation(escalation, { enrich: true });

  const candidate = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  assert.ok(candidate.title.length <= 200, 'stored title respects the 200-char ceiling');
  assert.ok(longTitle.startsWith(candidate.title), 'capped title is a prefix of the model title');
  assert.equal(longTitle[candidate.title.length], ' ', 'cap lands on a word boundary, not mid-word');
});

test('force regenerate adopts a fresher model title when no editor has touched it', async () => {
  process.env.KNOWLEDGEBASE_AGENT_MODEL_IN_TESTS = 'true';
  const escalation = await makeEscalation({ status: 'open' });
  // Machine-only draft first (deterministic title, no audit edit events).
  await createKnowledgeDraftForEscalation(escalation, { enrich: false });

  stubExtraction({ title: MODEL_TITLE });
  await createKnowledgeDraftForEscalation(escalation, { force: true, enrich: true });

  const candidate = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  assert.equal(candidate.title, MODEL_TITLE, 'machine-owned title is upgraded to the model title');
});

test('force regenerate NEVER overwrites an editor-owned title', async () => {
  process.env.KNOWLEDGEBASE_AGENT_MODEL_IN_TESTS = 'true';
  const escalation = await makeEscalation({ status: 'open' });
  await createKnowledgeDraftForEscalation(escalation, { enrich: false });

  // A human reviewer (or the KB agent on their behalf) edits the title via
  // updateKnowledgeRecord, which records a 'record.update' audit event naming
  // the fields written — the provenance proof the merge consults.
  const humanTitle = 'Reviewer-curated payroll ledger posting failure title';
  const candidate = await KnowledgeCandidate.findOne({ escalationId: escalation._id });
  candidate.title = humanTitle;
  candidate.auditEvents.push({
    eventId: 'evt-test-title-edit',
    action: 'record.update',
    actor: 'reviewer',
    role: 'reviewer',
    summary: 'Edited the title.',
    metadata: { fields: ['title'] },
    createdAt: new Date(),
  });
  await candidate.save();

  stubExtraction({ title: MODEL_TITLE, customerGoal: 'Post a payroll adjustment.' });
  await createKnowledgeDraftForEscalation(escalation, { force: true, enrich: true });

  const after = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  assert.equal(after.title, humanTitle, 'editor-owned title survives the model pass');
  assert.equal(after.customerGoal, 'Post a payroll adjustment.', 'non-title model fields still apply');
});
