const test = require('node:test');
const assert = require('node:assert/strict');

const claude = require('../src/services/claude');
const codex = require('../src/services/codex');

test('claude timeout parser falls back for invalid values', () => {
  assert.equal(claude._internal.parsePositiveInt('180000', 120000), 180000);
  assert.equal(claude._internal.parsePositiveInt('0', 120000), 120000);
  assert.equal(claude._internal.parsePositiveInt('bad', 120000), 120000);
});

test('codex timeout parser falls back for invalid values', () => {
  assert.equal(codex._internal.parsePositiveInt('180000', 120000), 180000);
  assert.equal(codex._internal.parsePositiveInt('-1', 120000), 120000);
  assert.equal(codex._internal.parsePositiveInt('bad', 120000), 120000);
});

test('provider CLI exit guard treats non-zero as failure', () => {
  assert.equal(claude._internal.didCliExitSuccessfully(0), true);
  assert.equal(claude._internal.didCliExitSuccessfully(1), false);
  assert.equal(codex._internal.didCliExitSuccessfully(0), true);
  assert.equal(codex._internal.didCliExitSuccessfully(1), false);
});
