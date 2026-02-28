const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeParsedEscalationFields,
  validateParsedEscalation,
} = require('../src/lib/parse-validation');

test('normalizeParsedEscalationFields coerces enums and trims text', () => {
  const out = normalizeParsedEscalationFields({
    category: 'BANK_FEEDS',
    triedTestAccount: true,
    attemptingTo: '  Connect bank   account  ',
  }, 'Customer cannot connect bank feed');

  assert.equal(out.category, 'bank-feeds');
  assert.equal(out.triedTestAccount, 'yes');
  assert.equal(out.attemptingTo, 'Connect bank account');
});

test('normalizeParsedEscalationFields accepts common category aliases', () => {
  const out = normalizeParsedEscalationFields({
    category: 'bank feeds',
    attemptingTo: 'Connect bank feed',
    actualOutcome: 'Error shown',
    tsSteps: 'Retried once',
  }, '');

  assert.equal(out.category, 'bank-feeds');
});

test('validateParsedEscalation returns high confidence for complete payload', () => {
  const validation = validateParsedEscalation({
    coid: '12345',
    mid: '67890',
    caseNumber: 'CS-2026-000123',
    clientContact: 'Jane Client',
    agentName: 'John Agent',
    attemptingTo: 'Connect Chase bank feed and import transactions',
    expectedOutcome: 'Bank feed should connect and import the latest 90 days',
    actualOutcome: 'Connection fails with invalid credentials error',
    tsSteps: 'Cleared cache, relinked account, and tried incognito',
    triedTestAccount: 'no',
    category: 'bank-feeds',
  });

  assert.equal(validation.passed, true);
  assert.equal(validation.confidence, 'high');
  assert.ok(validation.score >= 0.8);
  assert.equal(validation.issues.includes('unknown_category'), false);
});

test('validateParsedEscalation fails when narrative fields are missing', () => {
  const validation = validateParsedEscalation({
    coid: '12345',
    category: 'unknown',
    triedTestAccount: 'unknown',
  });

  assert.equal(validation.passed, false);
  assert.ok(validation.issues.includes('missing_attemptingTo'));
  assert.ok(validation.issues.includes('missing_actualOutcome'));
  assert.ok(validation.issues.includes('unknown_category'));
});
