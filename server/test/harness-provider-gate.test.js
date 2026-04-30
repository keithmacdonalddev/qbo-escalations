const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isStubbed,
  registerProviderStub,
  unregisterProviderStub,
  clearProviderStubs,
  getProviderStub,
  MissingProviderStubError,
} = require('../src/lib/harness-provider-gate');

function withEnv(value, fn) {
  const prior = process.env.HARNESS_PROVIDERS_STUBBED;
  if (value === null) {
    delete process.env.HARNESS_PROVIDERS_STUBBED;
  } else {
    process.env.HARNESS_PROVIDERS_STUBBED = value;
  }
  try {
    return fn();
  } finally {
    if (prior === undefined) {
      delete process.env.HARNESS_PROVIDERS_STUBBED;
    } else {
      process.env.HARNESS_PROVIDERS_STUBBED = prior;
    }
  }
}

test('isStubbed reflects HARNESS_PROVIDERS_STUBBED env', () => {
  withEnv('1', () => assert.equal(isStubbed(), true));
  withEnv('0', () => assert.equal(isStubbed(), false));
  withEnv(null, () => assert.equal(isStubbed(), false));
});

test('registerProviderStub stores and retrieves impls by provider+kind', () => {
  clearProviderStubs();
  const impl = () => 'ok';
  registerProviderStub('claude', 'chat', impl);
  assert.equal(getProviderStub('claude', 'chat'), impl);
  assert.equal(getProviderStub('claude', 'parseEscalation'), null);
  unregisterProviderStub('claude', 'chat');
  assert.equal(getProviderStub('claude', 'chat'), null);
});

test('registerProviderStub rejects non-function impls', () => {
  clearProviderStubs();
  assert.throws(() => registerProviderStub('claude', 'chat', 42), TypeError);
});

test('MissingProviderStubError has code and provider/kind fields', () => {
  const err = new MissingProviderStubError('codex', 'chat');
  assert.equal(err.code, 'HARNESS_PROVIDER_NOT_STUBBED');
  assert.equal(err.provider, 'codex');
  assert.equal(err.kind, 'chat');
  assert.match(err.message, /codex\.chat/);
});

test('clearProviderStubs drops every registration', () => {
  registerProviderStub('claude', 'chat', () => null);
  registerProviderStub('codex', 'parseEscalation', () => null);
  clearProviderStubs();
  assert.equal(getProviderStub('claude', 'chat'), null);
  assert.equal(getProviderStub('codex', 'parseEscalation'), null);
});
