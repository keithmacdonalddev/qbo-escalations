'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clearServiceStubs,
  getServiceStub,
} = require('../../../server/src/lib/harness-service-gate');
const {
  HARNESS_ACCOUNT_EMAIL,
  HARNESS_AUTH_URL,
  installDefaultConnectedServiceStubs,
} = require('../harness-service-stubs');

test('installDefaultConnectedServiceStubs registers Gmail and Calendar defaults', async () => {
  clearServiceStubs();
  installDefaultConnectedServiceStubs();

  const gmailStatusStub = getServiceStub('gmail', 'getAuthStatus');
  const calendarEventsStub = getServiceStub('calendar', 'listEvents');

  assert.equal(typeof gmailStatusStub, 'function');
  assert.equal(typeof calendarEventsStub, 'function');

  const status = await gmailStatusStub();
  assert.equal(status.ok, true);
  assert.equal(status.email, HARNESS_ACCOUNT_EMAIL);

  const events = await calendarEventsStub({ maxResults: 1 });
  assert.equal(events.ok, true);
  assert.equal(events.events.length, 1);
});

test('default Gmail auth URL stub returns a deterministic URL', () => {
  clearServiceStubs();
  installDefaultConnectedServiceStubs();

  const stub = getServiceStub('gmail', 'getAuthUrl');
  assert.equal(stub(), HARNESS_AUTH_URL);
});
