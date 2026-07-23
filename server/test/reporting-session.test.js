'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  COOKIE_NAME,
  configuration,
  cookieOptions,
  createVisitor,
  deriveReportingKey,
  visitorFromToken,
} = require('../src/services/reporting-session');

const TEST_ENV = {
  NODE_ENV: 'test',
  QBO_REPORTING_SECRET: 'reporting-session-test-secret-at-least-32-characters',
  QBO_REPORTING_COOKIE_SECURE: '0',
  TICKET_SNITCH_PROJECT_ID: 'project-qbo',
};

test('reporting continuity requires a dedicated sufficiently long secret', () => {
  assert.equal(configuration({}).configured, false);
  assert.equal(configuration({ QBO_REPORTING_SECRET: 'too-short' }).configured, false);
  assert.equal(configuration(TEST_ENV).configured, true);
});

test('a signed anonymous visitor survives validation and rejects forgery', () => {
  const config = configuration(TEST_ENV);
  const now = Date.parse('2026-07-23T12:00:00.000Z');
  const visitor = createVisitor(config, now);
  assert.match(visitor.id, /^qbo-visitor:[0-9a-f-]{36}$/);
  assert.match(visitor.scope, /^qrv_[A-Za-z0-9_-]{32}$/);
  assert.deepEqual(visitorFromToken(visitor.token, config, now), { id: visitor.id, scope: visitor.scope });
  const [version, visitorId, issuedAt, signature] = visitor.token.split('.');
  const forged = `${version}.${visitorId}.${issuedAt}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;
  assert.equal(visitorFromToken(forged, config, now), null);
  assert.equal(visitorFromToken(visitor.token, config, now + config.ttlMs), null);
  assert.equal(visitorFromToken(visitor.token, config, now - 5 * 60 * 1000 - 1), null);
  assert.equal(visitorFromToken(visitor.token, configuration({ ...TEST_ENV, QBO_REPORTING_SECRET: `${TEST_ENV.QBO_REPORTING_SECRET}-different` }), now), null);
});

test('visitor cookie is browser-only, strict, path-limited, and secure by default in production', () => {
  assert.equal(COOKIE_NAME, 'qbo_reporting_visitor');
  assert.deepEqual(cookieOptions(configuration(TEST_ENV)), {
    httpOnly: true,
    sameSite: 'strict',
    secure: false,
    path: '/api/ticket-snitch/reporting',
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
  assert.equal(cookieOptions(configuration({ ...TEST_ENV, NODE_ENV: 'production', QBO_REPORTING_COOKIE_SECURE: '' })).secure, true);
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
