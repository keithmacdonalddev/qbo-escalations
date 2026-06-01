'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildExactOutputComparison } = require('../src/lib/exact-output-check');

test('exact output checker ignores letter casing differences', () => {
  const comparison = buildExactOutputComparison({
    actual: [
      'COID/MID: 9341452918781988',
      'CASE: 15154488745',
      'ACTUAL OUTCOME:CPP was charged to all Active and 2 Terminated EE\'s',
      'TS STEPS: On screen he shows me the Paycheques',
    ].join('\n'),
    expected: [
      'COID/MID: 9341452918781988',
      'CASE: 15154488745',
      'ACTUAL OUTCOME:Cpp was charged to all Active and 2 Terminated EE\'s',
      'TS STEPS: On screen he shows me the paycheques',
    ].join('\n'),
  });

  assert.equal(comparison.passed, true);
  assert.equal(comparison.summary.caseSensitive, false);
  assert.equal(comparison.summary.failedCharacters, 0);
  assert.equal(comparison.summary.failedLines, 0);
});

test('exact output checker remains strict for digits, spacing, accents, and punctuation type', () => {
  const digitComparison = buildExactOutputComparison({
    actual: 'CASE: 151544888745',
    expected: 'CASE: 15154488745',
  });
  assert.equal(digitComparison.passed, false);
  assert.ok(digitComparison.summary.failedCharacters > 0);

  const spacingComparison = buildExactOutputComparison({
    actual: 'CASE:15154488745',
    expected: 'CASE: 15154488745',
  });
  assert.equal(spacingComparison.passed, false);
  assert.ok(spacingComparison.summary.failedCharacters > 0);

  const accentComparison = buildExactOutputComparison({
    actual: 'Depot',
    expected: 'Dépôt',
  });
  assert.equal(accentComparison.passed, false);
  assert.ok(accentComparison.summary.failedCharacters > 0);

  const punctuationComparison = buildExactOutputComparison({
    actual: 'EE’s',
    expected: 'EE\'s',
  });
  assert.equal(punctuationComparison.passed, false);
  assert.equal(punctuationComparison.summary.failedCharacters, 1);
});
