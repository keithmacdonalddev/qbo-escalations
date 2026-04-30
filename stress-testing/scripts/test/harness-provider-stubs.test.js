'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  clearProviderStubs,
  getProviderStub,
} = require('../../../server/src/lib/harness-provider-gate');
const { validateParsedEscalation } = require('../../../server/src/lib/parse-validation');
const {
  DEFAULT_PARSE_FIELDS,
  DEFAULT_PARSE_TEXT,
  installDefaultProviderStubs,
  parseEscalationStub,
} = require('../harness-provider-stubs');

test('parseEscalationStub returns a fields wrapper that passes validation', async () => {
  const stub = parseEscalationStub('claude');
  const result = await stub();

  assert.deepEqual(result.fields, DEFAULT_PARSE_FIELDS);
  assert.equal(result.usage.provider, 'claude');
  assert.equal(result.usage.kind, 'parseEscalation');

  const validation = validateParsedEscalation(result.fields, { sourceText: DEFAULT_PARSE_TEXT });
  assert.equal(validation.passed, true);
});

test('installDefaultProviderStubs registers image parser and availability defaults', () => {
  clearProviderStubs();
  installDefaultProviderStubs();

  assert.equal(typeof getProviderStub('openai', 'parseImage'), 'function');
  assert.equal(typeof getProviderStub('openai', 'validateRemoteProvider'), 'function');
  assert.equal(typeof getProviderStub('lm-studio', 'providerAvailability'), 'function');
});
