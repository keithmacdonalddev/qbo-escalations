const assert = require('node:assert/strict');
const test = require('node:test');
const {
  attachEvidence,
  buildReport,
  callTicketSnitch,
  commentOnWork,
  getConnectorConfig,
  getWork,
  transitionWork,
  updateWork,
} = require('../src/services/ticket-snitch-client');
const { requireReportProxySecret } = require('../src/routes/ticket-snitch');

function withEnvironment(values, work) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  return Promise.resolve().then(work).finally(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

test('Ticket Snitch connector is disabled until all three secrets are configured', () => {
  const original = process.env.TICKET_SNITCH_API_KEY;
  delete process.env.TICKET_SNITCH_API_KEY;
  assert.equal(getConnectorConfig().configured, false);
  if (original !== undefined) process.env.TICKET_SNITCH_API_KEY = original;
});

test('caller identity is not trusted and report enrichment is allow-listed', async () => withEnvironment({ TICKET_SNITCH_API_URL: 'https://tickets.example.test/api/v1/', TICKET_SNITCH_API_KEY: 'ts_key.secret', TICKET_SNITCH_PROJECT_ID: 'project-1', NODE_ENV: 'test' }, () => {
  const report = buildReport({ type: 'problem_report', title: 'Save failed', originalReport: 'I clicked Save and nothing changed.' }, { pageUrl: 'https://qbo.example.test/invoice/42', reportingUserId: 'user-42', reportingUserName: 'Taylor', password: 'must-not-leak' });
  assert.equal(report.projectId, 'project-1');
  assert.equal(report.source.url, 'https://qbo.example.test/invoice/42');
  assert.equal(report.reporter.actorId, '');
  assert.equal(report.reporter.displayName, '');
  assert.equal(report.reporter.email, '');
  assert.equal(report.details.password, undefined);
  assert.equal(report.details.captureEnvironment, 'test');
}));

test('trusted server identity can be attached without accepting caller spoofing', async () => withEnvironment({ TICKET_SNITCH_API_URL: 'https://tickets.example.test/api/v1/', TICKET_SNITCH_API_KEY: 'ts_key.secret', TICKET_SNITCH_PROJECT_ID: 'project-1' }, () => {
  const report = buildReport({ type: 'problem_report', title: 'Save failed', originalReport: 'Save did not work.' }, { reportingUserId: 'spoofed' }, { actorId: 'user-42', displayName: 'Taylor' });
  assert.equal(report.reporter.actorId, 'user-42');
  assert.equal(report.reporter.displayName, 'Taylor');
  assert.equal(report.details.reportingUserId, undefined);
}));

test('connector sends project scope, trace, SDK, and idempotency headers', async () => withEnvironment({ TICKET_SNITCH_API_URL: 'https://tickets.example.test/api/v1', TICKET_SNITCH_API_KEY: 'ts_key.secret', TICKET_SNITCH_PROJECT_ID: 'project-1' }, async () => {
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (url, options) => { captured = { url, options }; return { ok: true, status: 201, headers: new Headers(), json: async () => ({ ok: true, data: { id: 'work-1' } }) }; };
  try {
    const result = await callTicketSnitch('/work-items', { method: 'POST', body: { title: 'Test' }, requestId: 'request-1234', idempotencyKey: 'source-42' });
    assert.equal(result.data.id, 'work-1');
    assert.equal(captured.url, 'https://tickets.example.test/api/v1/work-items');
    assert.equal(captured.options.headers.Authorization, 'Bearer ts_key.secret');
    assert.equal(captured.options.headers['X-Ticket-Snitch-Project'], 'project-1');
    assert.equal(captured.options.headers['Idempotency-Key'], 'source-42');
    assert.match(captured.options.headers['X-Ticket-Snitch-SDK'], /^qbo-escalations\//);
  } finally { global.fetch = originalFetch; }
}));

test('agent connector supports read, update, comment, transition, and evidence journeys', async () => withEnvironment({ TICKET_SNITCH_API_URL: 'https://tickets.example.test/api/v1', TICKET_SNITCH_API_KEY: 'ts_key.secret', TICKET_SNITCH_PROJECT_ID: 'project-1' }, async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined });
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, data: { id: 'work-1' } }) };
  };
  try {
    await getWork('QBO-42', 'read-1');
    await updateWork('QBO-42', { version: 2, description: 'Diagnostics', reason: 'Added evidence' }, 'update-1');
    await commentOnWork('QBO-42', { body: 'Reproduced', visibility: 'internal' }, 'comment-1');
    await transitionWork('QBO-42', { version: 3, toStatus: 'verification', reason: 'Ready' }, 'transition-1');
    await attachEvidence('QBO-42', { filename: 'proof.txt', contentType: 'text/plain', base64: 'cGFzc2Vk' }, 'evidence-1');
    assert.deepEqual(calls.map((call) => [call.options.method, call.url]), [
      ['GET', 'https://tickets.example.test/api/v1/work-items/QBO-42'],
      ['PATCH', 'https://tickets.example.test/api/v1/work-items/QBO-42'],
      ['POST', 'https://tickets.example.test/api/v1/work-items/QBO-42/comments'],
      ['POST', 'https://tickets.example.test/api/v1/work-items/QBO-42/transitions'],
      ['POST', 'https://tickets.example.test/api/v1/work-items/QBO-42/evidence/base64'],
    ]);
    assert.equal(calls[4].body.filename, 'proof.txt');
  } finally { global.fetch = originalFetch; }
}));

test('report proxy is disabled until a separate server secret is configured', async () => withEnvironment({ TICKET_SNITCH_REPORT_PROXY_SECRET: '' }, () => {
  const response = { statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  requireReportProxySecret({ headers: {} }, response, () => {});
  assert.equal(response.statusCode, 503);
}));

test('report proxy requires its separate server secret', async () => withEnvironment({ TICKET_SNITCH_REPORT_PROXY_SECRET: 'a-secure-proxy-secret-with-at-least-32-characters' }, () => {
  const response = { statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  let continued = false;
  requireReportProxySecret({ headers: {} }, response, () => { continued = true; });
  assert.equal(response.statusCode, 401);
  assert.equal(continued, false);
  requireReportProxySecret({ headers: { 'x-ticket-snitch-proxy-secret': process.env.TICKET_SNITCH_REPORT_PROXY_SECRET } }, response, () => { continued = true; });
  assert.equal(continued, true);
}));
