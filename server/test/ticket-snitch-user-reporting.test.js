'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { reportWork } = require('../src/services/ticket-snitch-client');

function reportEnvironment() {
  return {
    NODE_ENV: 'test',
    QBO_REPORTING_SECRET: 'reporting-test-secret-at-least-32-characters-long',
    QBO_REPORTING_COOKIE_SECURE: '0',
    TICKET_SNITCH_API_URL: 'https://tickets.example.test/api/v1',
    TICKET_SNITCH_API_KEY: 'ts_test.secret',
    TICKET_SNITCH_EVIDENCE_API_KEY: 'ts_evidence.secret',
    TICKET_SNITCH_PROJECT_ID: 'project-qbo',
    TICKET_SNITCH_REPORT_ALLOWED_ORIGINS: 'http://qbo.example.test',
    TICKET_SNITCH_REPORT_PROXY_SECRET: '',
    RATE_LIMIT_DISABLED: '1',
  };
}

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

test('browser reporting denies requests without an approved exact origin', async () => withEnvironment(reportEnvironment(), async () => {
  const response = await request(createApp()).get('/api/ticket-snitch/reporting/bootstrap');
  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'TICKET_SNITCH_REPORT_ORIGIN_DENIED');
  assert.ok(response.body.requestId);
}));

test('browser reporting requires a stable server-side continuity secret', async () => withEnvironment({
  ...reportEnvironment(),
  QBO_REPORTING_SECRET: '',
}, async () => {
  const response = await request(createApp())
    .get('/api/ticket-snitch/reporting/bootstrap')
    .set('Origin', 'http://qbo.example.test');
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'QBO_REPORTING_SECRET_NOT_CONFIGURED');
  assert.ok(response.body.requestId);
}));

test('browser report derives anonymous identity from a signed cookie, filters context, and safely replays one case', async () => withEnvironment(reportEnvironment(), async () => {
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
    const agent = request.agent(app);
    const bootstrap = await agent
      .get('/api/ticket-snitch/reporting/bootstrap')
      .set('Origin', 'http://qbo.example.test')
      .expect(200);
    assert.equal(bootstrap.body.available, true);
    assert.ok(bootstrap.body.reportToken);
    assert.equal(bootstrap.body.dataUseUrl, 'https://tickets.example.test/api/v1/data-use');
    assert.match(bootstrap.body.reporterScope, /^qrv_[A-Za-z0-9_-]{32}$/);
    assert.match(bootstrap.headers['set-cookie']?.[0] || '', /qbo_reporting_visitor=/);
    assert.match(bootstrap.headers['set-cookie']?.[0] || '', /HttpOnly/);
    assert.match(bootstrap.headers['set-cookie']?.[0] || '', /SameSite=Strict/);

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
        browser: 'Mandatory Test Browser',
        password: 'must-not-leak',
      },
    };
    const first = await agent
      .post('/api/ticket-snitch/reporting/reports')
      .set('Origin', 'http://qbo.example.test')
      .set('X-Forwarded-For', '198.51.100.25')
      .set('X-QBO-Report-Token', bootstrap.body.reportToken)
      .send(payload)
      .expect(201);
    const replay = await agent
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
    assert.match(calls[0].body.reporter.actorId, /^qbo-visitor:[0-9a-f-]{36}$/);
    assert.equal(calls[0].body.reporter.displayName, 'Anonymous QBO reporter');
    assert.equal(calls[0].body.reporter.email, '');
    assert.equal(calls[0].body.reporter.wantsReply, true);
    assert.equal(calls[0].body.details.consent.reply, true);
    assert.equal(calls[0].body.source.url, 'http://qbo.example.test/escalations');
    assert.equal(calls[0].body.details.routeName, '#/escalations');
    assert.equal(calls[0].body.details.environment.appVersion, '1.0.0');
    assert.equal(calls[0].body.details.environment.browser, 'Mandatory Test Browser');
    assert.equal(calls[0].body.details.environment.ipAddress, '127.0.0.1');
    assert.equal(calls[0].body.details.diagnosticsRequired, true);
    assert.equal(calls[0].body.details.consent.diagnostics, false);
    assert.equal(calls[0].body.details.password, undefined);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer ts_test.secret');
    assert.equal(calls[0].options.headers['X-Ticket-Snitch-Issue-Receipt'], 'true');
    assert.equal(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
    assert.notEqual(first.body.requestId, '');
  } finally { global.fetch = originalFetch; }
}));

test('optional self-reported contact is normalized while invalid contact is rejected before forwarding', async () => withEnvironment(reportEnvironment(), async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return ticketResponse({ ok: true, data: { id: 'work-contact-1', key: 'QBO-44' } });
  };
  try {
    const agent = request.agent(createApp());
    const bootstrap = await agent
      .get('/api/ticket-snitch/reporting/bootstrap')
      .set('Origin', 'http://qbo.example.test')
      .expect(200);
    await agent
      .post('/api/ticket-snitch/reporting/reports')
      .set('Origin', 'http://qbo.example.test')
      .set('X-QBO-Report-Token', bootstrap.body.reportToken)
      .send({
        submissionId: 'submission-contact-report-001',
        observedAt: '2026-07-23T03:02:00.000Z',
        kind: 'feature',
        title: 'Add a clearer report tracker',
        explanation: 'I would like to receive a follow-up about this reporting idea.',
        contact: { name: '  Ada Lovelace  ', email: ' ADA@Example.TEST ' },
      })
      .expect(201);
    assert.equal(calls.length, 1);
    assert.match(calls[0].reporter.actorId, /^qbo-visitor:[0-9a-f-]{36}$/);
    assert.equal(calls[0].reporter.displayName, 'Ada Lovelace');
    assert.equal(calls[0].reporter.email, 'ada@example.test');

    const invalid = await agent
      .post('/api/ticket-snitch/reporting/reports')
      .set('Origin', 'http://qbo.example.test')
      .set('X-QBO-Report-Token', bootstrap.body.reportToken)
      .send({
        submissionId: 'submission-contact-report-002',
        observedAt: '2026-07-23T03:03:00.000Z',
        kind: 'feedback',
        title: 'Invalid contact fixture',
        explanation: 'The invalid email must be rejected before any report is forwarded.',
        contact: { email: 'not-an-email' },
      });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, 'INVALID_REPORTER_EMAIL');
    assert.equal(calls.length, 1);

    const nonText = await agent
      .post('/api/ticket-snitch/reporting/reports')
      .set('Origin', 'http://qbo.example.test')
      .set('X-QBO-Report-Token', bootstrap.body.reportToken)
      .send({
        submissionId: 'submission-contact-report-003',
        observedAt: '2026-07-23T03:04:00.000Z',
        kind: 'feedback',
        title: 'Non-text contact fixture',
        explanation: 'Object contact values must not become misleading display names.',
        contact: { name: { role: 'owner' } },
      });
    assert.equal(nonText.status, 400);
    assert.equal(nonText.body.code, 'INVALID_REPORTER_CONTACT');
    assert.equal(calls.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
}));

test('trusted automation reports remain compatible and do not request customer receipts', async () => withEnvironment(reportEnvironment(), async () => {
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (_url, options) => {
    captured = { options, body: JSON.parse(options.body) };
    return ticketResponse({ ok: true, data: { id: 'work-agent-1', key: 'QBO-43' } });
  };
  try {
    await reportWork({
      type: 'agent_discovered_problem',
      title: 'Agent-only report',
      originalReport: 'A trusted server integration reported this without a customer identity.',
    }, { sourceRequestId: 'agent-report-001' }, 'agent-request-001');
    assert.equal(captured.options.headers['X-Ticket-Snitch-Issue-Receipt'], undefined);
    assert.equal(captured.body.reporter.actorId, '');
    assert.equal(captured.body.reporter.wantsReply, false);
    assert.equal(captured.body.details.consent.reply, false);
  } finally {
    global.fetch = originalFetch;
  }
}));

test('feedback maps to improvement and mandatory diagnostics cannot be disabled by the browser', async () => withEnvironment(reportEnvironment(), async () => {
  const originalFetch = global.fetch;
  let body;
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return ticketResponse({ ok: true, data: { id: 'work-qbo-2', key: 'QBO-42' } });
  };
  try {
    const app = createApp();
    const agent = request.agent(app);
    const bootstrap = await agent
      .get('/api/ticket-snitch/reporting/bootstrap')
      .set('Origin', 'http://qbo.example.test')
      .expect(200);
    await agent
      .post('/api/ticket-snitch/reporting/reports')
      .set('Origin', 'http://qbo.example.test')
      .set('X-QBO-Report-Token', bootstrap.body.reportToken)
      .send({
        submissionId: 'submission-user-report-002',
        observedAt: '2026-07-23T03:05:00.000Z',
        kind: 'feedback',
        title: 'Make filters easier to scan',
        explanation: 'The filters work, but grouping them would make review faster.',
        includeDiagnostics: false,
        context: {
          pageUrl: 'http://qbo.example.test/escalations',
          routeName: '#/escalations',
          browser: 'Test Browser 1',
          viewport: '390x844',
          locale: 'en-CA',
          timezone: 'America/Halifax',
          errorCode: 'SAFE_CODE',
          ipAddress: '203.0.113.99',
        },
      })
      .expect(201);
    assert.equal(body.type, 'improvement');
    assert.equal(body.details.consent.diagnostics, false);
    assert.equal(body.details.diagnosticsRequired, true);
    assert.equal(body.details.environment.browser, 'Test Browser 1');
    assert.equal(body.details.environment.viewport, '390x844');
    assert.equal(body.details.environment.locale, 'en-CA');
    assert.equal(body.details.environment.errorCode, 'SAFE_CODE');
    assert.equal(body.details.environment.ipAddress, '127.0.0.1');
    assert.equal(body.details.timezone, 'America/Halifax');
  } finally { global.fetch = originalFetch; }
}));

test('an approved screenshot is normalized and attached with a separate retry-safe evidence credential', async () => withEnvironment(reportEnvironment(), async () => {
  const originalFetch = global.fetch;
  const calls = [];
  const source = await sharp({ create: { width: 120, height: 60, channels: 3, background: '#1f6feb' } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  global.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    if (String(url).endsWith('/work-items')) {
      return ticketResponse({ ok: true, data: { id: 'work-shot-1', key: 'QBO-61' } });
    }
    return ticketResponse({ ok: true, data: { id: 'evidence-shot-1' }, idempotentReplay: false });
  };
  try {
    const app = createApp();
    const agent = request.agent(app);
    const bootstrap = await agent.get('/api/ticket-snitch/reporting/bootstrap').set('Origin', 'http://qbo.example.test').expect(200);
    assert.equal(bootstrap.body.screenshotAvailable, true);
    const response = await agent
      .post('/api/ticket-snitch/reporting/reports')
      .set('Origin', 'http://qbo.example.test')
      .set('X-QBO-Report-Token', bootstrap.body.reportToken)
      .send({
        submissionId: 'submission-screenshot-001',
        observedAt: '2026-07-23T03:12:00.000Z',
        kind: 'problem',
        title: 'Page alignment is difficult to review',
        explanation: 'The attached image shows the alignment problem on the main page.',
        screenshot: { filename: '../private-view.png', contentType: 'image/png', base64: source.toString('base64') },
      })
      .expect(201);
    assert.equal(response.body.ticket.key, 'QBO-61');
    assert.equal(response.body.evidence.status, 'attached');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer ts_test.secret');
    assert.equal(calls[0].body.details.consent.screenshot, true);
    assert.equal(calls[1].options.headers.Authorization, 'Bearer ts_evidence.secret');
    assert.match(calls[1].options.headers['Idempotency-Key'], /^[a-f0-9]{64}$/);
    assert.equal(calls[1].body.filename, 'private-view.jpg');
    assert.equal(calls[1].body.contentType, 'image/jpeg');
    assert.equal(calls[1].body.kind, 'screenshot');
    const metadata = await sharp(Buffer.from(calls[1].body.base64, 'base64')).metadata();
    assert.equal(metadata.orientation, undefined);
    assert.equal(metadata.exif, undefined);
  } finally { global.fetch = originalFetch; }
}));

test('a failed screenshot attachment preserves the case and retries without duplicating case or evidence identity', async () => withEnvironment(reportEnvironment(), async () => {
  const originalFetch = global.fetch;
  const calls = [];
  let evidenceAttempts = 0;
  const source = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#fff' } }).png().toBuffer();
  global.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    if (String(url).endsWith('/work-items')) {
      const replay = calls.filter((call) => String(call.url).endsWith('/work-items')).length > 1;
      return ticketResponse({ ok: true, data: { id: 'work-shot-retry', key: 'QBO-62' }, ...(replay ? { idempotentReplay: true } : {}) }, replay ? 200 : 201);
    }
    evidenceAttempts += 1;
    if (evidenceAttempts === 1) {
      return ticketResponse({ ok: false, error: { code: 'EVIDENCE_UNAVAILABLE', message: 'Evidence storage is temporarily unavailable.' }, requestId: 'evidence-failed-1' }, 503);
    }
    return ticketResponse({ ok: true, data: { id: 'evidence-shot-retry' } }, 201);
  };
  try {
    const app = createApp();
    const agent = request.agent(app);
    const bootstrap = await agent.get('/api/ticket-snitch/reporting/bootstrap').set('Origin', 'http://qbo.example.test').expect(200);
    const payload = {
      submissionId: 'submission-screenshot-retry-001',
      observedAt: '2026-07-23T03:13:00.000Z',
      kind: 'problem',
      title: 'Screenshot retry proof',
      explanation: 'The report must survive a temporary screenshot storage failure.',
      screenshot: { filename: 'retry.png', contentType: 'image/png', base64: source.toString('base64') },
    };
    const first = await agent.post('/api/ticket-snitch/reporting/reports').set('Origin', 'http://qbo.example.test').set('X-QBO-Report-Token', bootstrap.body.reportToken).send(payload).expect(201);
    const retry = await agent.post('/api/ticket-snitch/reporting/reports').set('Origin', 'http://qbo.example.test').set('X-QBO-Report-Token', bootstrap.body.reportToken).send(payload).expect(200);
    assert.equal(first.body.ticket.key, 'QBO-62');
    assert.equal(first.body.evidence.status, 'failed');
    assert.equal(first.body.evidence.retryable, true);
    assert.equal(retry.body.ticket.key, 'QBO-62');
    assert.equal(retry.body.idempotentReplay, true);
    assert.equal(retry.body.evidence.status, 'attached');
    const caseCalls = calls.filter((call) => String(call.url).endsWith('/work-items'));
    const evidenceCalls = calls.filter((call) => String(call.url).includes('/evidence/base64'));
    assert.equal(caseCalls[0].options.headers['Idempotency-Key'], caseCalls[1].options.headers['Idempotency-Key']);
    assert.equal(evidenceCalls[0].options.headers['Idempotency-Key'], evidenceCalls[1].options.headers['Idempotency-Key']);
  } finally { global.fetch = originalFetch; }
}));

test('invalid screenshot bytes are rejected before a case is created', async () => withEnvironment(reportEnvironment(), async () => {
  const originalFetch = global.fetch;
  let forwarded = false;
  global.fetch = async () => { forwarded = true; return ticketResponse({ ok: true, data: {} }); };
  try {
    const app = createApp();
    const agent = request.agent(app);
    const bootstrap = await agent.get('/api/ticket-snitch/reporting/bootstrap').set('Origin', 'http://qbo.example.test').expect(200);
    const response = await agent
      .post('/api/ticket-snitch/reporting/reports')
      .set('Origin', 'http://qbo.example.test')
      .set('X-QBO-Report-Token', bootstrap.body.reportToken)
      .send({
        submissionId: 'submission-invalid-shot-001',
        observedAt: '2026-07-23T03:14:00.000Z',
        kind: 'problem',
        title: 'Invalid screenshot fixture',
        explanation: 'This malformed image must not create a Ticket Snitch case.',
        screenshot: { filename: 'bad.png', contentType: 'image/png', base64: Buffer.from('not an image').toString('base64') },
      });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'SCREENSHOT_INVALID');
    assert.equal(forwarded, false);
  } finally { global.fetch = originalFetch; }
}));

test('browser reporting rejects an invalid anti-forgery token before forwarding', async () => withEnvironment(reportEnvironment(), async () => {
  const originalFetch = global.fetch;
  let forwarded = false;
  global.fetch = async () => { forwarded = true; return ticketResponse({ ok: true, data: {} }); };
  try {
    const agent = request.agent(createApp());
    const response = await agent
      .post('/api/ticket-snitch/reporting/reports')
      .set('Origin', 'http://qbo.example.test')
      .set('X-QBO-Report-Token', 'invalid')
      .send({});
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'TICKET_SNITCH_REPORT_TOKEN_INVALID');
    assert.equal(forwarded, false);
  } finally { global.fetch = originalFetch; }
}));

test('customer follow-up keeps the raw Ticket Snitch receipt server-side behind an anonymous-browser-bound encrypted handle', async () => withEnvironment(reportEnvironment(), async () => {
  const originalFetch = global.fetch;
  const rawReceipt = `tsr_11111111-1111-4111-8111-111111111111.${'a'.repeat(43)}`;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/work-items')) {
      return ticketResponse({
        ok: true,
        data: { id: 'work-receipt-1', key: 'QBO-71' },
        customerReceipt: {
          token: rawReceipt,
          expiresAt: '2027-07-23T03:00:00.000Z',
        },
      });
    }
    return ticketResponse({
      ok: true,
      data: {
        key: 'QBO-71',
        title: 'Receipt security',
        status: 'new',
        statusLabel: 'New',
        updates: [],
        version: 1,
      },
    }, 200);
  };
  try {
    const app = createApp();
    const agent = request.agent(app);
    const bootstrap = await agent
      .get('/api/ticket-snitch/reporting/bootstrap')
      .set('Origin', 'http://qbo.example.test')
      .expect(200);
    const report = await agent
      .post('/api/ticket-snitch/reporting/reports')
      .set('Origin', 'http://qbo.example.test')
      .set('X-QBO-Report-Token', bootstrap.body.reportToken)
      .send({
        submissionId: 'submission-receipt-security-001',
        observedAt: '2026-07-23T03:20:00.000Z',
        kind: 'problem',
        title: 'Receipt security path',
        explanation: 'The browser must receive only an opaque QBO receipt handle.',
      })
      .expect(201);
    assert.match(report.body.customerReceipt.handle, /^qtr_/);
    assert.doesNotMatch(JSON.stringify(report.body), /tsr_/);
    const status = await agent
      .get('/api/ticket-snitch/reporting/receipt')
      .set('Origin', 'http://qbo.example.test')
      .set('X-QBO-Report-Token', bootstrap.body.reportToken)
      .set('X-QBO-Ticket-Receipt', report.body.customerReceipt.handle)
      .expect(200);
    assert.equal(status.body.data.key, 'QBO-71');
    assert.equal(calls[1].options.headers['X-Ticket-Snitch-Receipt'], rawReceipt);
    assert.equal(calls[1].options.headers.Authorization, undefined);

    const forwardedBeforeTamper = calls.length;
    await agent
      .get('/api/ticket-snitch/reporting/receipt')
      .set('Origin', 'http://qbo.example.test')
      .set('X-QBO-Report-Token', bootstrap.body.reportToken)
      .set('X-QBO-Ticket-Receipt', `${report.body.customerReceipt.handle.slice(0, -1)}x`)
      .expect(401);
    assert.equal(calls.length, forwardedBeforeTamper);

    const otherBrowser = request.agent(app);
    const otherBootstrap = await otherBrowser
      .get('/api/ticket-snitch/reporting/bootstrap')
      .set('Origin', 'http://qbo.example.test')
      .expect(200);
    await otherBrowser
      .get('/api/ticket-snitch/reporting/receipt')
      .set('Origin', 'http://qbo.example.test')
      .set('X-QBO-Report-Token', otherBootstrap.body.reportToken)
      .set('X-QBO-Ticket-Receipt', report.body.customerReceipt.handle)
      .expect(401);
    assert.equal(calls.length, forwardedBeforeTamper);
  } finally {
    global.fetch = originalFetch;
  }
}));

test('a reporting token cannot be replayed from a different anonymous browser identity', async () => withEnvironment(reportEnvironment(), async () => {
  const originalFetch = global.fetch;
  let forwarded = false;
  global.fetch = async () => { forwarded = true; return ticketResponse({ ok: true, data: {} }); };
  try {
    const app = createApp();
    const firstAgent = request.agent(app);
    const secondAgent = request.agent(app);
    const bootstrap = await firstAgent
      .get('/api/ticket-snitch/reporting/bootstrap')
      .set('Origin', 'http://qbo.example.test')
      .expect(200);
    const response = await secondAgent
      .post('/api/ticket-snitch/reporting/reports')
      .set('Origin', 'http://qbo.example.test')
      .set('X-QBO-Report-Token', bootstrap.body.reportToken)
      .send({
        submissionId: 'cross-session-report-001',
        observedAt: '2026-07-23T03:10:00.000Z',
        kind: 'problem',
        title: 'Cross-session token attempt',
        explanation: 'This request must be rejected before it reaches Ticket Snitch.',
      });
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'TICKET_SNITCH_REPORT_TOKEN_INVALID');
    assert.equal(forwarded, false);
  } finally { global.fetch = originalFetch; }
}));
