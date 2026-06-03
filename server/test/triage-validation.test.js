'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSoftValidatedTriageCardFromOutput,
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
