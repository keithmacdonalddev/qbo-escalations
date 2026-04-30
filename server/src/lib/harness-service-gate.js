'use strict';

const registry = new Map();

function isStubbed() {
  return process.env.HARNESS_CONNECTED_SERVICES_STUBBED === '1';
}

function stubKey(service, kind) {
  return `${service}:${kind}`;
}

function registerServiceStub(service, kind, impl) {
  if (typeof impl !== 'function') {
    throw new TypeError(`registerServiceStub(${service}, ${kind}) expects a function impl`);
  }
  registry.set(stubKey(service, kind), impl);
}

function unregisterServiceStub(service, kind) {
  registry.delete(stubKey(service, kind));
}

function clearServiceStubs() {
  registry.clear();
}

function getServiceStub(service, kind) {
  return registry.get(stubKey(service, kind)) || null;
}

class MissingServiceStubError extends Error {
  constructor(service, kind) {
    super(
      `[harness] Real ${service}.${kind} call blocked because HARNESS_CONNECTED_SERVICES_STUBBED=1 `
      + `and no stub is registered. Use registerServiceStub('${service}', '${kind}', impl) `
      + `in your harness setup, or unset HARNESS_CONNECTED_SERVICES_STUBBED to allow real calls.`
    );
    this.name = 'MissingServiceStubError';
    this.code = 'HARNESS_SERVICE_NOT_STUBBED';
    this.service = service;
    this.kind = kind;
  }
}

function runIfStubbed(service, kind, args) {
  if (!isStubbed()) return { handled: false, value: undefined };
  const stub = getServiceStub(service, kind);
  if (!stub) throw new MissingServiceStubError(service, kind);
  return { handled: true, value: stub(...args) };
}

module.exports = {
  MissingServiceStubError,
  clearServiceStubs,
  getServiceStub,
  isStubbed,
  registerServiceStub,
  runIfStubbed,
  unregisterServiceStub,
};
