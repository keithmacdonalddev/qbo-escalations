'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSoftValidatedTriageCardFromOutput,
  parseLabeledTriageOutput,
} = require('../src/lib/chat-triage');

test('soft triage validation flags invalid category and severity without silent coercion', () => {
  const built = buildSoftValidatedTriageCardFromOutput([
    'Category: spaceship',
    'Severity: emergency',
    'Fast read: The customer cannot complete a QBO workflow.',
    'Immediate next step: Capture the exact error and retry once.',
    'Missing info: exact error text',
    'Confidence: High',
    'Category check: Category is uncertain from the model output.',
  ].join('\n'), {
    attemptingTo: 'connect a bank account',
    actualOutcome: 'connection failed with an error',
    tsSteps: 'cleared cache',
  });

  assert.equal(built.card.category, 'technical');
  assert.equal(built.card.severity, 'P2');
  assert.equal(built.severity.raw, 'emergency');
  assert.equal(built.severity.validated, '');
  assert.equal(built.severity.displayed, 'P2');
  assert.equal(built.category.raw, 'spaceship');
  assert.equal(built.category.validated, '');
  assert.equal(built.category.displayed, 'technical');
  assert.equal(built.validation.passed, false);
  assert.ok(built.validation.issues.some((issue) => issue.code === 'TRIAGE_CATEGORY_INVALID'));
  assert.ok(built.validation.issues.some((issue) => issue.code === 'TRIAGE_SEVERITY_INVALID'));
});

test('parseLabeledTriageOutput tolerates bold labels with the colon inside or outside the marks', () => {
  const parsed = parseLabeledTriageOutput([
    '**Category:** billing',
    '**Severity**: P3',
    '__Fast read:__ Subscription renewal failed at checkout.',
    '*Immediate next step:* Retry the payment with an updated card.',
    '_Confidence_: High',
  ].join('\n'));

  assert.equal(parsed.category, 'billing');
  assert.equal(parsed.severity, 'P3');
  assert.equal(parsed.read, 'Subscription renewal failed at checkout.');
  assert.equal(parsed.action, 'Retry the payment with an updated card.');
  assert.equal(parsed.confidence, 'High');
});

test('parseLabeledTriageOutput tolerates heading, bullet, and blockquote labels', () => {
  const parsed = parseLabeledTriageOutput([
    '## Category: payroll',
    '- Severity: P3',
    '* Fast read: Pay run shows the wrong deduction amount.',
    '• Confidence: Medium',
    '> Category check: Payroll because the failing workflow is a pay run.',
  ].join('\n'));

  assert.equal(parsed.category, 'payroll');
  assert.equal(parsed.severity, 'P3');
  assert.equal(parsed.read, 'Pay run shows the wrong deduction amount.');
  assert.equal(parsed.confidence, 'Medium');
  assert.equal(parsed.categoryCheck, 'Payroll because the failing workflow is a pay run.');
});

test('parseLabeledTriageOutput strips emphasis wrapping the whole value but keeps inner emphasis', () => {
  const parsed = parseLabeledTriageOutput([
    'Severity: **P2**',
    'Confidence: _low_',
    'Fast read: The pay run is **blocked** until the bank token refreshes.',
    '**Category check: Billing because the failure happens at the renewal charge.**',
  ].join('\n'));

  assert.equal(parsed.severity, 'P2');
  assert.equal(parsed.confidence, 'low');
  assert.equal(parsed.read, 'The pay run is **blocked** until the bank token refreshes.');
  assert.equal(parsed.categoryCheck, 'Billing because the failure happens at the renewal charge.');
});

test('parseLabeledTriageOutput ignores code-fence marker lines wrapping the answer', () => {
  const parsed = parseLabeledTriageOutput([
    '```text',
    'Category: technical',
    'Severity: P3',
    'Category check: Technical because the page fails to render.',
    '```',
  ].join('\n'));

  assert.equal(parsed.category, 'technical');
  assert.equal(parsed.severity, 'P3');
  assert.equal(parsed.categoryCheck, 'Technical because the page fails to render.');
  // The closing fence must not be appended to the last field.
  assert.ok(!parsed.categoryCheck.includes('```'));
});

test('parseLabeledTriageOutput tolerance does not create false matches or change continuation handling', () => {
  const parsed = parseLabeledTriageOutput([
    'Fast read: The client said: nothing loads after sign-in.',
    'The agent added: it worked yesterday.',
    'Missing info:',
    '- exact error text',
    '- screenshot of the failing page',
    'Severity: P3',
    'Severity: P2',
  ].join('\n'));

  // Mid-sentence colons with unknown labels never become fields.
  assert.equal(parsed.read, 'The client said: nothing loads after sign-in.\nThe agent added: it worked yesterday.');
  // Continuation bullets keep their original text (markers included).
  assert.equal(parsed.missingInfo, '- exact error text\n- screenshot of the failing page');
  // Duplicate-label semantics are unchanged (last wins).
  assert.equal(parsed.severity, 'P2');
  assert.equal(parsed.category, undefined);
});

test('a fully markdown-formatted but valid answer passes soft validation without fallbacks', () => {
  const built = buildSoftValidatedTriageCardFromOutput([
    '## Triage',
    '**Category:** billing',
    '**Severity:** P3',
    '- **Fast read:** Subscription renewal fails at the payment step with a card error.',
    '- **Immediate next step:** Retry the charge with an updated card and capture the exact decline message.',
    '**Missing info:** exact decline code',
    '**Confidence:** **High**',
    '**Category check:** Billing because the failure happens during the subscription charge.',
  ].join('\n'), {
    attemptingTo: 'renew the QBO subscription',
    expectedOutcome: 'subscription renews',
    actualOutcome: 'payment declined error appears',
    tsSteps: 'retried the saved card once',
  });

  assert.equal(built.card.category, 'billing');
  assert.equal(built.card.severity, 'P3');
  assert.equal(built.card.confidence, 'high');
  assert.equal(built.card.read, 'Subscription renewal fails at the payment step with a card error.');
  assert.equal(built.validation.passed, true);
  assert.deepEqual(built.validation.issues, []);
  assert.equal(built.validation.fieldsFound, 7);
});

test('non-payroll P2 survives the payroll pay-date rule untouched', () => {
  const built = buildSoftValidatedTriageCardFromOutput([
    'Category: permissions',
    'Severity: P2',
    'Fast read: The admin user lost access to company settings after a role change.',
    'Immediate next step: Compare the affected role against a standard admin role and restore the missing access.',
    'Missing info: exact role name',
    'Confidence: High',
    'Category check: Permissions because the failure follows a role change and is access-scoped.',
  ].join('\n'), {
    attemptingTo: 'open company settings as an admin',
    expectedOutcome: 'settings page opens with full admin access',
    actualOutcome: 'access denied message appears',
    tsSteps: 'compared with another admin user who can open settings',
  });

  assert.equal(built.severity.raw, 'P2');
  assert.equal(built.severity.validated, 'P2');
  assert.equal(built.severity.displayed, 'P2');
  assert.equal(built.card.severity, 'P2');
  assert.ok(!built.validation.issues.some((issue) => issue.code === 'TRIAGE_PAYROLL_PAY_DATE_REQUIRED'));
});

test('payroll direct deposit P2 without pay date is displayed as P3 and flagged', () => {
  const built = buildSoftValidatedTriageCardFromOutput([
    'Category: payroll',
    'Severity: P2',
    'Fast read: Direct deposit payroll is blocked.',
    'Immediate next step: Confirm payroll subscription and direct deposit setup.',
    'Missing info: pay date',
    'Confidence: Medium',
    'Category check: Payroll because direct deposit is a payroll workflow.',
  ].join('\n'), {
    attemptingTo: 'run direct deposit payroll',
    expectedOutcome: 'employees are paid by direct deposit',
    actualOutcome: 'direct deposit payroll is blocked',
    tsSteps: 'retried payroll setup',
  });

  assert.equal(built.severity.raw, 'P2');
  assert.equal(built.severity.validated, 'P3');
  assert.equal(built.severity.displayed, 'P3');
  assert.equal(built.card.severity, 'P3');
  assert.equal(built.validation.passed, false);
  assert.ok(built.validation.issues.some((issue) => issue.code === 'TRIAGE_PAYROLL_PAY_DATE_REQUIRED'));
});
