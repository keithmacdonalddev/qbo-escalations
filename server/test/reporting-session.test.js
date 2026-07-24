'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  configuration,
  deriveReportingKey,
  reportingScopeForUser,
} = require('../src/services/reporting-session');

const TEST_ENV = {
  QBO_REPORTING_SECRET: 'reporting-session-test-secret-at-least-32-characters',
  TICKET_SNITCH_PROJECT_ID: 'project-qbo',
};

test('reporting continuity requires a dedicated sufficiently long secret', () => {
  assert.equal(configuration({}).configured, false);
  assert.equal(configuration({ QBO_REPORTING_SECRET: 'too-short' }).configured, false);
  assert.equal(configuration(TEST_ENV).configured, true);
});

test('receipt encryption key is stable for one installation and separated by purpose and project', () => {
  const first = deriveReportingKey('ticket-receipt-handle', TEST_ENV);
  const again = deriveReportingKey('ticket-receipt-handle', TEST_ENV);
  const otherPurpose = deriveReportingKey('another-purpose', TEST_ENV);
  const otherProject = deriveReportingKey('ticket-receipt-handle', { ...TEST_ENV, TICKET_SNITCH_PROJECT_ID: 'another-project' });
  assert.equal(first.length, 32);
  assert.equal(first.equals(again), true);
  assert.equal(first.equals(otherPurpose), false);
  assert.equal(first.equals(otherProject), false);
  assert.equal(deriveReportingKey('ticket-receipt-handle', { ...TEST_ENV, QBO_REPORTING_SECRET: '' }), null);
});

test('browser receipt storage scope is stable for one signed-in user and separated across users and projects', () => {
  const first = reportingScopeForUser('qbo-user-1', TEST_ENV);
  const again = reportingScopeForUser('qbo-user-1', TEST_ENV);
  const otherUser = reportingScopeForUser('qbo-user-2', TEST_ENV);
  const otherProject = reportingScopeForUser('qbo-user-1', { ...TEST_ENV, TICKET_SNITCH_PROJECT_ID: 'another-project' });
  assert.match(first, /^qru_[A-Za-z0-9_-]{32}$/);
  assert.equal(first, again);
  assert.notEqual(first, otherUser);
  assert.notEqual(first, otherProject);
  assert.equal(reportingScopeForUser('', TEST_ENV), '');
  assert.equal(reportingScopeForUser('qbo-user-1', { ...TEST_ENV, QBO_REPORTING_SECRET: '' }), '');
});
