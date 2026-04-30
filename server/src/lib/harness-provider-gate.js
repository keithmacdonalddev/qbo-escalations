'use strict';

const registry = new Map();

function isStubbed() {
  return process.env.HARNESS_PROVIDERS_STUBBED === '1';
}

function stubKey(provider, kind) {
  return `${provider}:${kind}`;
}

function registerProviderStub(provider, kind, impl) {
  if (typeof impl !== 'function') {
    throw new TypeError(`registerProviderStub(${provider}, ${kind}) expects a function impl`);
  }
  registry.set(stubKey(provider, kind), impl);
}

function unregisterProviderStub(provider, kind) {
  registry.delete(stubKey(provider, kind));
}

function clearProviderStubs() {
  registry.clear();
}

function getProviderStub(provider, kind) {
  return registry.get(stubKey(provider, kind)) || null;
}

class MissingProviderStubError extends Error {
  constructor(provider, kind) {
    super(
      `[harness] Real ${provider}.${kind} call blocked because HARNESS_PROVIDERS_STUBBED=1 `
      + `and no stub is registered. Use registerProviderStub('${provider}', '${kind}', impl) `
      + `in your harness setup, or unset HARNESS_PROVIDERS_STUBBED to allow real calls.`
    );
    this.name = 'MissingProviderStubError';
    this.code = 'HARNESS_PROVIDER_NOT_STUBBED';
    this.provider = provider;
    this.kind = kind;
  }
}

function runIfStubbed(provider, kind, args) {
  if (!isStubbed()) return { handled: false, value: undefined };
  const stub = getProviderStub(provider, kind);
  if (!stub) throw new MissingProviderStubError(provider, kind);
  return { handled: true, value: stub(args) };
}

module.exports = {
  MissingProviderStubError,
  clearProviderStubs,
  getProviderStub,
  isStubbed,
  registerProviderStub,
  runIfStubbed,
  unregisterProviderStub,
};
