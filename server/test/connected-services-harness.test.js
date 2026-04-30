'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');
const { clearServiceStubs } = require('../src/lib/harness-service-gate');
const { installDefaultConnectedServiceStubs } = require('../../stress-testing/scripts/harness-service-stubs');

function withHarnessConnectedServices(fn) {
  const priorStubbed = process.env.HARNESS_CONNECTED_SERVICES_STUBBED;
  const priorNoDefaults = process.env.HARNESS_CONNECTED_SERVICES_NO_DEFAULT_STUBS;

  process.env.HARNESS_CONNECTED_SERVICES_STUBBED = '1';
  delete process.env.HARNESS_CONNECTED_SERVICES_NO_DEFAULT_STUBS;
  clearServiceStubs();
  installDefaultConnectedServiceStubs();

  return Promise.resolve()
    .then(() => fn(request(createApp())))
    .finally(() => {
      clearServiceStubs();
      if (priorStubbed === undefined) {
        delete process.env.HARNESS_CONNECTED_SERVICES_STUBBED;
      } else {
        process.env.HARNESS_CONNECTED_SERVICES_STUBBED = priorStubbed;
      }
      if (priorNoDefaults === undefined) {
        delete process.env.HARNESS_CONNECTED_SERVICES_NO_DEFAULT_STUBS;
      } else {
        process.env.HARNESS_CONNECTED_SERVICES_NO_DEFAULT_STUBS = priorNoDefaults;
      }
    });
}

test('Gmail routes use connected-service stubs in harness mode', async () => {
  await withHarnessConnectedServices(async (agent) => {
    const statusRes = await agent.get('/api/gmail/auth/status');
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.body.ok, true);
    assert.equal(statusRes.body.connected, true);
    assert.equal(statusRes.body.email, 'harness@example.com');

    const messagesRes = await agent.get('/api/gmail/messages?maxResults=1');
    assert.equal(messagesRes.status, 200);
    assert.equal(messagesRes.body.ok, true);
    assert.equal(messagesRes.body.messages.length, 1);
    assert.equal(messagesRes.body.messages[0].id, 'gmail-msg-1-1');
  });
});

test('Calendar routes use connected-service stubs in harness mode', async () => {
  await withHarnessConnectedServices(async (agent) => {
    const calendarsRes = await agent.get('/api/calendar/calendars');
    assert.equal(calendarsRes.status, 200);
    assert.equal(calendarsRes.body.ok, true);
    assert.equal(calendarsRes.body.calendars.length, 1);
    assert.equal(calendarsRes.body.calendars[0].id, 'primary');

    const eventsRes = await agent.get('/api/calendar/events?maxResults=1');
    assert.equal(eventsRes.status, 200);
    assert.equal(eventsRes.body.ok, true);
    assert.equal(eventsRes.body.events.length, 1);
    assert.equal(eventsRes.body.events[0].id, 'calendar-event-1-1');
  });
});
