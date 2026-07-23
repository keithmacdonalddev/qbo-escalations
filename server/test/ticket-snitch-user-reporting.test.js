'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const { createApp } = require('../src/app');

const REPORT_ENV = {
  NODE_ENV: 'test',
  TICKET_SNITCH_API_URL: 'https://tickets.example.test/api/v1',
  TICKET_SNITCH_API_KEY: 'ts_test.secret',
  TICKET_SNITCH_PROJECT_ID: 'project-qbo',
  TICKET_SNITCH_REPORTER_ID: 'qbo-local-user',
  TICKET_SNITCH_REPORTER_NAME: 'QBO local user',
  TICKET_SNITCH_REPORTER_EMAIL: '',
  TICKET_SNITCH_REPORT_ALLOWED_ORIGINS: 'http://qbo.example.test',
  TICKET_SNITCH_REPORT_PROXY_SECRET: '',
  RATE_LIMIT_DISABLED: '1',
};

function withEnvironment(values, work) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  return Promise.resolve().then(work).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function ticketResponse(body, status = 201) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'x-request-id': 'ticket-request-1' }),
    json: async () => body,
  };
}

test('browser reporting denies requests without an approved exact origin', async () => withEnvironment(REPORT_ENV, async () => {
  const response = await request(createApp()).get('/api/ticket-snitch/reporting/bootstrap');
  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'TICKET_SNITCH_REPORT_ORIGIN_DENIED');
  assert.ok(response.body.requestId);
}));

test('browser report uses server authority, filters context, and safely replays one case', async () => withEnvironment(REPORT_ENV, async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    const replay = calls.length > 1;
    return ticketResponse({
      ok: true,
      data: { id: 'work-qbo-1', key: 'QBO-41', projectId: 'project-qbo' },
      ...(replay ? { idempotentReplay: true } : {}),
    }, replay ? 200 : 201);
  };
  try {
    const app = createApp();
    const bootstrap = await request(app)
      .get('/api/ticket-snitch/reporting/bootstrap')
      .set('Origin', 'http://qbo.example.test')
      .expect(200);
    assert.equal(bootstrap.body.available, true);
    assert.ok(bootstrap.body.reportToken);

    const payload = {
      submissionId: 'submission-user-report-001',
      observedAt: '2026-07-23T03:00:00.000Z',
      kind: 'problem',
      title: 'Escalation notes do not save',
      explanation: 'I saved the escalation notes but the previous text remained.',
      includeDiagnostics: false,
      reporter: { actorId: 'spoofed-owner', displayName: 'Spoofed owner' },
      projectId: 'another-project',
      priority: 'urgent',
      context: {
        pageUrl: 'http://qbo.example.test/escalations?token=secret#private',
        routeName: '#/escalations?customer=secret',
        appVersion: '1.0.0',
        browser: 'Should not be included without consent',
        password: 'must-not-leak',
      },
    };
    const first = await request(app)
      .post('/api/ticket-snitch/reporting/reports')
      .set('Origin', 'http://qbo.example.test')
      .set('X-QBO-Report-Token', bootstrap.body.reportToken)
      .send(payload)
      .expect(201);
    const replay = await request(app)
      .post('/api/ticket-snitch/reporting/reports')
      .set('Origin', 'http://qbo.example.test')
      .set('X-QBO-Report-Token', bootstrap.body.reportToken)
      .send(payload)
      .expect(200);

    assert.equal(first.body.ticket.key, 'QBO-41');
    assert.equal(replay.body.idempotentReplay, true);
    assert.equal(calls[0].body.projectId, 'project-qbo');
    assert.equal(calls[0].body.type, 'problem_report');
    assert.equal(calls[0].body.priority, 'none');
    assert.equal(calls[0].body.severity, 'none');
    assert.equal(calls[0].body.reporter.actorId, 'qbo-local-user');
    assert.equal(calls[0].body.reporter.displayName, 'QBO local user');
    assert.equal(calls[0].body.source.url, 'http://qbo.example.test/escalations');
    assert.equal(calls[0].body.details.routeName, '#/escalations');
    assert.equal(calls[0].body.details.environment.appVersion, '1.0.0');
    assert.equal(calls[0].body.details.environment.browser, undefined);
    assert.equal(calls[0].body.details.password, undefined);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer ts_test.secret');
    assert.equal(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
    assert.notEqual(first.body.requestId, '');
  } finally { global.fetch = originalFetch; }
}));

test('feedback maps to improvement and diagnostics require explicit approval', async () => withEnvironment(REPORT_ENV, async () => {
  const originalFetch = global.fetch;
  let body;
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return ticketResponse({ ok: true, data: { id: 'work-qbo-2', key: 'QBO-42' } });
  };
  try {
    const app = createApp();
    const bootstrap = await request(app)
      .get('/api/ticket-snitch/reporting/bootstrap')
      .set('Origin', 'http://qbo.example.test')
      .expect(200);
    await request(app)
      .post('/api/ticket-snitch/reporting/reports')
      .set('Origin', 'http://qbo.example.test')
      .set('X-QBO-Report-Token', bootstrap.body.reportToken)
      .send({
        submissionId: 'submission-user-report-002',
        observedAt: '2026-07-23T03:05:00.000Z',
        kind: 'feedback',
        title: 'Make filters easier to scan',
        explanation: 'The filters work, but grouping them would make review faster.',
        includeDiagnostics: true,
        context: {
          pageUrl: 'http://qbo.example.test/escalations',
          routeName: '#/escalations',
          browser: 'Test Browser 1',
          viewport: '390x844',
          locale: 'en-CA',
          errorCode: 'SAFE_CODE',
        },
      })
      .expect(201);
    assert.equal(body.type, 'improvement');
    assert.equal(body.details.consent.diagnostics, true);
    assert.equal(body.details.environment.browser, 'Test Browser 1');
    assert.equal(body.details.environment.viewport, '390x844');
    assert.equal(body.details.environment.locale, 'en-CA');
    assert.equal(body.details.environment.errorCode, 'SAFE_CODE');
  } finally { global.fetch = originalFetch; }
}));

test('browser reporting rejects an invalid anti-forgery token before forwarding', async () => withEnvironment(REPORT_ENV, async () => {
  const originalFetch = global.fetch;
  let forwarded = false;
  global.fetch = async () => { forwarded = true; return ticketResponse({ ok: true, data: {} }); };
  try {
    const response = await request(createApp())
      .post('/api/ticket-snitch/reporting/reports')
      .set('Origin', 'http://qbo.example.test')
      .set('X-QBO-Report-Token', 'invalid')
      .send({});
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'TICKET_SNITCH_REPORT_TOKEN_INVALID');
    assert.equal(forwarded, false);
  } finally { global.fetch = originalFetch; }
}));
