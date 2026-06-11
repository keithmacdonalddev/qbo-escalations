'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const mongo = require('./_mongo-helper');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const TriageResult = require('../src/models/TriageResult');
const { runTriage } = require('../src/services/triage');
const {
  buildCategoryPlausibilityIssue,
  buildTriageRepairPromptInput,
  listRepairableTriageFields,
  mergeTriageRepairOutput,
} = require('../src/lib/chat-triage');

const PARSER_TEXT = [
  'COID/MID: 12345 / 67890',
  'CASE: CS-2026-002001',
  'CLIENT/CONTACT: Example Client',
  'CX IS ATTEMPTING TO: connect a bank account',
  'EXPECTED OUTCOME: bank feed connects',
  'ACTUAL OUTCOME: bank feed connection error appears',
  'KB/TOOLS USED: Help panel',
  'TRIED TEST ACCOUNT: yes',
  'TS STEPS: cleared cache and retried in incognito',
].join('\n');

// Payroll-evidence template: classifies as payroll on keyword rules and avoids
// every permissions/sign-in keyword so the deterministic evidence is clean.
const PAYROLL_PARSER_TEXT = [
  'COID/MID: 22345 / 77890',
  'CASE: CS-2026-002002',
  'CLIENT/CONTACT: Payroll Client',
  'CX IS ATTEMPTING TO: fix a CPP deduction on an employee paycheque in payroll',
  'EXPECTED OUTCOME: payroll deducts the correct CPP amount on the pay run',
  'ACTUAL OUTCOME: the paycheque shows the wrong CPP deduction amount',
  'KB/TOOLS USED: Help panel',
  'TRIED TEST ACCOUNT: yes',
  'TS STEPS: reran the pay run in a test company and the same wrong deduction appeared',
].join('\n');

// No category keywords at all -> escalation parser classifies 'unknown' ->
// deterministic evidence stays at the generic technical default.
const WEAK_EVIDENCE_PARSER_TEXT = [
  'COID/MID: 32345 / 87890',
  'CASE: CS-2026-002003',
  'CLIENT/CONTACT: Vague Client',
  'CX IS ATTEMPTING TO: change the colour theme of the company dashboard',
  'EXPECTED OUTCOME: the new colour theme is applied',
  'ACTUAL OUTCOME: the page shows the old layout',
  'KB/TOOLS USED: Help panel',
  'TRIED TEST ACCOUNT: yes',
  'TS STEPS: signed the customer out and back in once',
].join('\n');

const FULL_TRIAGE_OUTPUT = [
  'Category: bank feeds',
  'Severity: P3',
  'Fast read: Bank feed connection is failing after basic browser troubleshooting.',
  'Immediate next step: Capture the bank name and exact connector error, then retry once in incognito.',
  'Missing info: bank name; exact connector error',
  'Confidence: High',
  'Category check: Bank feeds because the failure is in the bank connection workflow.',
].join('\n');

// Same answer with the "Category check:" line omitted (the real-world failure
// this feature addresses).
const TRIAGE_OUTPUT_MISSING_CATEGORY_CHECK = FULL_TRIAGE_OUTPUT
  .split('\n')
  .slice(0, 6)
  .join('\n');

const REPAIR_REPLY = 'Category check: Bank feeds because the failure is in the bank connection workflow.';

function makeLmStudioDirectCallStub(replies, capture) {
  return async ({ userPrompt }) => {
    const index = capture.userPrompts.length;
    capture.userPrompts.push(userPrompt);
    const packageId = new mongoose.Types.ObjectId();
    capture.packageIds.push(String(packageId));
    await ProviderCallPackage.collection.insertOne({
      _id: packageId,
      providerId: 'lm-studio',
      providerResearchId: 'lm-studio-openai-compatible',
      providerPathType: 'lm-studio-http-nonstream',
      outcome: 'success',
      lmStudio: {
        response: {
          parsedJson: {
            choices: [{ message: { role: 'assistant', content: replies[index] } }],
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
  };
}

function makeEventRecorder() {
  const events = [];
  return {
    events,
    eventBus: {
      emit(kind, data) {
        events.push({ kind, data });
      },
    },
  };
}

test.before(async () => {
  process.env.NODE_ENV = 'test';
  await mongo.connect();
});

test.after(async () => {
  await mongo.disconnect();
});

test.beforeEach(async () => {
  await ProviderCallPackage.deleteMany({});
  await TriageResult.deleteMany({});
});

test('missing Category check triggers one repair call, merges, and ends success with no issues', async () => {
  const capture = { userPrompts: [], packageIds: [] };
  const { events, eventBus } = makeEventRecorder();

  const result = await runTriage(PARSER_TEXT, {
    runId: 'triage-repair-merge',
    provider: 'lm-studio',
    model: 'local-triage-model',
    eventBus,
    preflightProvider: async () => ({ ok: true, code: 'OK', reason: 'stub reachable' }),
    runDirectTriageProviderCall: makeLmStudioDirectCallStub(
      [TRIAGE_OUTPUT_MISSING_CATEGORY_CHECK, REPAIR_REPLY],
      capture
    ),
  });

  assert.equal(capture.userPrompts.length, 2, 'exactly one repair call after the first pass');
  // Repair prompt is built from the fixed template with the right fields.
  const repairPrompt = capture.userPrompts[1];
  assert.match(repairPrompt, /Category check: was missing entirely/);
  assert.match(repairPrompt, /Your previous answer:/);
  assert.match(repairPrompt, /Bank feed connection is failing/);
  assert.match(repairPrompt, /CX Attempting: connect a bank account/);
  assert.match(repairPrompt, /ONLY the missing or corrected labeled lines/);

  assert.equal(result.ok, true);
  assert.equal(result.status, 'success');
  assert.equal(result.card.validationIssues, undefined, 'clean card has no per-field icons');
  assert.match(result.card.categoryCheck, /Bank feeds because/);
  assert.match(result.rawOutput, /Category check: Bank feeds because/);

  const started = events.find((event) => event.kind === 'triage.repair_started');
  assert.ok(started);
  assert.deepEqual(started.data.fields, ['categoryCheck']);
  const completed = events.find((event) => event.kind === 'triage.repair_completed');
  assert.ok(completed);
  assert.equal(completed.data.passed, true);
  assert.equal(completed.data.remainingIssueCount, 0);
  assert.equal(completed.data.providerPackageId, capture.packageIds[1]);
  assert.equal(events.some((event) => event.kind === 'triage.repair_failed'), false);

  assert.equal(result.triageMeta.repair.attempted, true);
  assert.deepEqual(result.triageMeta.repair.repairedFields, ['categoryCheck']);
  assert.equal(result.triageMeta.repair.packageId, capture.packageIds[1]);
  // First-pass package remains the primary provenance.
  assert.equal(result.triageMeta.providerPackageId, capture.packageIds[0]);

  const saved = await TriageResult.findOne({ runId: 'triage-repair-merge' }).lean();
  assert.ok(saved);
  assert.equal(saved.status, 'success');
  assert.deepEqual(saved.validationIssues, []);
  assert.equal(saved.triageMeta.repair.packageId, capture.packageIds[1]);
});

test('garbage repair reply degrades with deterministic patch and repair_failed, run survives', async () => {
  const capture = { userPrompts: [], packageIds: [] };
  const { events, eventBus } = makeEventRecorder();

  const result = await runTriage(PARSER_TEXT, {
    runId: 'triage-repair-garbage',
    provider: 'lm-studio',
    model: 'local-triage-model',
    eventBus,
    preflightProvider: async () => ({ ok: true, code: 'OK', reason: 'stub reachable' }),
    runDirectTriageProviderCall: makeLmStudioDirectCallStub(
      [TRIAGE_OUTPUT_MISSING_CATEGORY_CHECK, 'I am sorry, I cannot help with that request.'],
      capture
    ),
  });

  assert.equal(capture.userPrompts.length, 2);
  assert.equal(result.ok, true, 'a failed repair never kills a run with a usable first answer');
  assert.equal(result.status, 'degraded');
  // Deterministic patch text still fills the missing field.
  assert.ok(result.card.categoryCheck.length > 0);
  assert.ok(Array.isArray(result.card.validationIssues));
  assert.ok(result.card.validationIssues.some(
    (issue) => issue.code === 'TRIAGE_FIELD_MISSING' && issue.field === 'categoryCheck'
  ));

  const failed = events.find((event) => event.kind === 'triage.repair_failed');
  assert.ok(failed);
  assert.equal(failed.data.code, 'TRIAGE_REPAIR_UNUSABLE');
  assert.equal(failed.data.providerPackageId, capture.packageIds[1]);
  assert.equal(events.some((event) => event.kind === 'triage.repair_completed'), false);

  assert.equal(result.triageMeta.repair.attempted, true);
  assert.equal(result.triageMeta.repair.failed, true);
  assert.deepEqual(result.triageMeta.repair.repairedFields, []);

  const saved = await TriageResult.findOne({ runId: 'triage-repair-garbage' }).lean();
  assert.ok(saved);
  assert.equal(saved.status, 'degraded');
});

test('valid first pass never makes a repair call', async () => {
  const capture = { userPrompts: [], packageIds: [] };
  const { events, eventBus } = makeEventRecorder();

  const result = await runTriage(PARSER_TEXT, {
    runId: 'triage-repair-not-needed',
    provider: 'lm-studio',
    model: 'local-triage-model',
    eventBus,
    preflightProvider: async () => ({ ok: true, code: 'OK', reason: 'stub reachable' }),
    runDirectTriageProviderCall: makeLmStudioDirectCallStub([FULL_TRIAGE_OUTPUT], capture),
  });

  assert.equal(capture.userPrompts.length, 1, 'no second provider call');
  assert.equal(result.ok, true);
  assert.equal(result.status, 'success');
  assert.equal(result.card.validationIssues, undefined);
  assert.equal(events.some((event) => event.kind.startsWith('triage.repair_')), false);
  assert.equal(result.triageMeta.repair, undefined);
});

test('plausibility flags permissions answer on payroll-evidence text without overriding it', async () => {
  const capture = { userPrompts: [], packageIds: [] };
  const { events, eventBus } = makeEventRecorder();

  const modelOutput = [
    'Category: permissions',
    'Severity: P3',
    'Fast read: The employee paycheque shows a wrong CPP deduction amount.',
    'Immediate next step: Confirm the exact deduction settings and reproduce once in the test company.',
    'Missing info: exact CPP amount expected; pay date',
    'Confidence: Medium',
    'Category check: Permissions because the deduction settings depend on who can edit them.',
  ].join('\n');

  const result = await runTriage(PAYROLL_PARSER_TEXT, {
    runId: 'triage-plausibility-flag',
    provider: 'lm-studio',
    model: 'local-triage-model',
    eventBus,
    preflightProvider: async () => ({ ok: true, code: 'OK', reason: 'stub reachable' }),
    runDirectTriageProviderCall: makeLmStudioDirectCallStub([modelOutput], capture),
  });

  assert.equal(capture.userPrompts.length, 1, 'plausibility never triggers a repair re-ask');
  assert.equal(result.ok, true);
  assert.equal(result.status, 'degraded');
  assert.equal(result.card.category, 'permissions', 'model category is flagged, never overridden');

  assert.ok(Array.isArray(result.card.validationIssues));
  const issue = result.card.validationIssues.find((item) => item.code === 'TRIAGE_CATEGORY_PLAUSIBILITY');
  assert.ok(issue, 'advisory plausibility issue attached to the card');
  assert.equal(issue.field, 'category');
  assert.equal(issue.advisory, true);
  assert.equal(issue.ruleCategory, 'payroll');
  assert.equal(issue.modelCategory, 'permissions');
  assert.match(issue.message, /Category may be wrong/);
  assert.match(issue.message, /payroll/);
  assert.match(issue.message, /permissions/);

  const flagged = events.find((event) => event.kind === 'triage.category_plausibility_flagged');
  assert.ok(flagged);
  assert.equal(flagged.data.ruleCategory, 'payroll');
  assert.equal(flagged.data.modelCategory, 'permissions');

  const saved = await TriageResult.findOne({ runId: 'triage-plausibility-flag' }).lean();
  assert.ok(saved);
  assert.equal(saved.status, 'degraded');
  assert.ok(saved.validationIssues.some((item) => item.code === 'TRIAGE_CATEGORY_PLAUSIBILITY'));
});

test('plausibility stays silent when the deterministic evidence is weak', async () => {
  const capture = { userPrompts: [], packageIds: [] };
  const { events, eventBus } = makeEventRecorder();

  const modelOutput = [
    'Category: billing',
    'Severity: P4',
    'Fast read: The company dashboard keeps showing the old layout after a theme change.',
    'Immediate next step: Confirm the exact theme selected and retry the change once.',
    'Missing info: exact theme selected',
    'Confidence: Medium',
    'Category check: Billing because theme availability depends on the subscription plan.',
  ].join('\n');

  const result = await runTriage(WEAK_EVIDENCE_PARSER_TEXT, {
    runId: 'triage-plausibility-silent',
    provider: 'lm-studio',
    model: 'local-triage-model',
    eventBus,
    preflightProvider: async () => ({ ok: true, code: 'OK', reason: 'stub reachable' }),
    runDirectTriageProviderCall: makeLmStudioDirectCallStub([modelOutput], capture),
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'success');
  assert.equal(result.card.validationIssues, undefined);
  assert.equal(events.some((event) => event.kind === 'triage.category_plausibility_flagged'), false);
});

test('plausibility stays silent when the rules agree with the model', async () => {
  const capture = { userPrompts: [], packageIds: [] };
  const { events, eventBus } = makeEventRecorder();

  const result = await runTriage(PARSER_TEXT, {
    runId: 'triage-plausibility-agrees',
    provider: 'lm-studio',
    model: 'local-triage-model',
    eventBus,
    preflightProvider: async () => ({ ok: true, code: 'OK', reason: 'stub reachable' }),
    runDirectTriageProviderCall: makeLmStudioDirectCallStub([FULL_TRIAGE_OUTPUT], capture),
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'success');
  assert.equal(events.some((event) => event.kind === 'triage.category_plausibility_flagged'), false);
});

// ---------------------------------------------------------------------------
// Pure helper units (no provider plumbing)
// ---------------------------------------------------------------------------

test('listRepairableTriageFields includes only repairable field codes', () => {
  const fields = listRepairableTriageFields([
    { code: 'TRIAGE_FIELD_MISSING', field: 'categoryCheck' },
    { code: 'TRIAGE_CATEGORY_INVALID', field: 'category' },
    { code: 'TRIAGE_PAYROLL_PAY_DATE_REQUIRED', field: 'severity' },
    { code: 'TRIAGE_CATEGORY_PLAUSIBILITY', field: 'category' },
    { code: 'TRIAGE_FIELD_MISSING', field: 'not-a-field' },
  ]);
  assert.deepEqual(fields, ['categoryCheck', 'category']);
});

test('mergeTriageRepairOutput fills only previously-broken fields and never overwrites valid ones', () => {
  const original = [
    'Category: payroll',
    'Severity: P3',
    'Fast read: original read',
    'Immediate next step: original action',
    'Missing info: pay date',
    'Confidence: High',
  ].join('\n');
  // Model disobeys and re-emits Category too — it must be ignored.
  const repair = [
    'Category: permissions',
    'Category check: Payroll because the deduction lives in the pay run.',
  ].join('\n');

  const merged = mergeTriageRepairOutput(original, repair, ['categoryCheck']);
  assert.deepEqual(merged.repairedFields, ['categoryCheck']);
  assert.match(merged.mergedOutput, /^Category: payroll$/m);
  assert.match(merged.mergedOutput, /^Category check: Payroll because/m);
  assert.doesNotMatch(merged.mergedOutput, /Category: permissions/);
});

test('buildTriageRepairPromptInput fills the template tokens', () => {
  const template = 'ISSUES\n{{ISSUE_LINES}}\nPREV\n{{PREVIOUS_ANSWER}}\nCTX\n{{ESCALATION_CONTEXT}}';
  const prompt = buildTriageRepairPromptInput({
    template,
    issues: [
      { code: 'TRIAGE_FIELD_MISSING', field: 'categoryCheck', message: 'missing' },
      { code: 'TRIAGE_SEVERITY_INVALID', field: 'severity', message: 'invalid', raw: 'urgent-ish' },
      { code: 'TRIAGE_PAYROLL_PAY_DATE_REQUIRED', field: 'severity', message: 'rule' },
    ],
    previousOutput: 'Category: payroll',
    parserText: 'raw template text',
    parseFields: { attemptingTo: 'run payroll', category: 'payroll' },
  });
  assert.match(prompt, /- Category check: was missing entirely/);
  assert.match(prompt, /- Severity: value "urgent-ish" was invalid/);
  assert.doesNotMatch(prompt, /PAY_DATE/);
  assert.match(prompt, /Category: payroll/);
  assert.match(prompt, /CX Attempting: run payroll/);
});

test('buildCategoryPlausibilityIssue stays silent when the model justified the divergence', () => {
  const parseFields = {
    attemptingTo: 'fix a CPP deduction on an employee paycheque',
    actualOutcome: 'wrong CPP deduction amount',
    category: 'payroll',
  };
  const flagged = buildCategoryPlausibilityIssue(parseFields, 'permissions', {
    categoryCheck: 'Permissions because the deduction settings depend on who can edit them.',
  });
  assert.ok(flagged, 'flags when the Category check does not address payroll');

  const acknowledged = buildCategoryPlausibilityIssue(parseFields, 'permissions', {
    categoryCheck: 'Permissions rather than payroll because only the affected user is blocked from the setting.',
  });
  assert.equal(acknowledged, null, 'silent when the model already named the rule category');

  assert.equal(buildCategoryPlausibilityIssue(parseFields, '', {}), null, 'silent on missing/invalid model category');
  assert.equal(buildCategoryPlausibilityIssue(parseFields, 'payroll', {}), null, 'silent on agreement');
});
