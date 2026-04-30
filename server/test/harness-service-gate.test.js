'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MissingServiceStubError,
  clearServiceStubs,
  getServiceStub,
  isStubbed,
  registerServiceStub,
} = require('../src/lib/harness-service-gate');

test('isStubbed reflects HARNESS_CONNECTED_SERVICES_STUBBED env', () => {
  const prior = process.env.HARNESS_CONNECTED_SERVICES_STUBBED;
  process.env.HARNESS_CONNECTED_SERVICES_STUBBED = '1';
  assert.equal(isStubbed(), true);
  process.env.HARNESS_CONNECTED_SERVICES_STUBBED = '0';
  assert.equal(isStubbed(), false);
  if (prior === undefined) {
    delete process.env.HARNESS_CONNECTED_SERVICES_STUBBED;
  } else {
    process.env.HARNESS_CONNECTED_SERVICES_STUBBED = prior;
  }
});

test('registerServiceStub stores and retrieves impls by service+kind', () => {
  clearServiceStubs();
  const impl = () => ({ ok: true });
  registerServiceStub('gmail', 'getAuthStatus', impl);
  assert.equal(getServiceStub('gmail', 'getAuthStatus'), impl);
});

test('registerServiceStub rejects non-function impls', () => {
  clearServiceStubs();
  assert.throws(
    () => registerServiceStub('gmail', 'getAuthStatus', null),
    /expects a function impl/
  );
});

test('MissingServiceStubError has code and service/kind fields', () => {
  const err = new MissingServiceStubError('calendar', 'listEvents');
  assert.equal(err.code, 'HARNESS_SERVICE_NOT_STUBBED');
  assert.equal(err.service, 'calendar');
  assert.equal(err.kind, 'listEvents');
  assert.match(err.message, /calendar\.listEvents/);
});

test('clearServiceStubs drops every registration', () => {
  registerServiceStub('gmail', 'listMessages', () => []);
  clearServiceStubs();
  assert.equal(getServiceStub('gmail', 'listMessages'), null);
});
