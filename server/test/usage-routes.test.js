'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const UsageLog = require('../src/models/UsageLog');

test("usage-routes suite", async (t) => {
let app;
let agent;

// Seed data: 4 logs across 2 providers, 2 services, 2 categories, 2 conversations
const CONV_ID_A = new mongoose.Types.ObjectId();
const CONV_ID_B = new mongoose.Types.ObjectId();

const SEED_LOGS = [
  {
    requestId: 'seed-1', attemptIndex: 0, service: 'chat', provider: 'claude',
    model: 'claude-sonnet-4-5-20250514', inputTokens: 1000, outputTokens: 500,
    totalTokens: 1500, usageAvailable: true, usageComplete: true,
    inputCostNanos: 3_000_000, outputCostNanos: 7_500_000, totalCostNanos: 10_500_000,
    inputCostMicros: 3000, outputCostMicros: 7500, totalCostMicros: 10500, rateFound: true,
    conversationId: CONV_ID_A, category: 'payroll', status: 'ok', mode: 'single', latencyMs: 1200,
    createdAt: new Date('2026-02-20T10:00:00Z'),
  },
  {
    requestId: 'seed-2', attemptIndex: 0, service: 'parse', provider: 'gpt-5.5',
    model: 'gpt-4o', inputTokens: 800, outputTokens: 200,
    totalTokens: 1000, usageAvailable: true, usageComplete: true,
    inputCostNanos: 2_000_000, outputCostNanos: 2_000_000, totalCostNanos: 4_000_000,
    inputCostMicros: 2000, outputCostMicros: 2000, totalCostMicros: 4000, rateFound: true,
    conversationId: CONV_ID_A, category: 'bank-feeds', status: 'ok', mode: 'single', latencyMs: 800,
    createdAt: new Date('2026-02-21T14:00:00Z'),
  },
  {
    requestId: 'seed-3', attemptIndex: 0, service: 'chat', provider: 'claude',
    model: 'claude-sonnet-4-5-20250514', inputTokens: 2000, outputTokens: 1000,
    totalTokens: 3000, usageAvailable: false, usageComplete: false,
    inputCostNanos: 6_000_000, outputCostNanos: 15_000_000, totalCostNanos: 21_000_000,
    inputCostMicros: 6000, outputCostMicros: 15000, totalCostMicros: 21000, rateFound: true,
    conversationId: CONV_ID_B, category: 'payroll', status: 'error', mode: 'fallback', latencyMs: 3000,
    createdAt: new Date('2026-02-22T09:00:00Z'),
  },
  {
    requestId: 'seed-4', attemptIndex: 0, service: 'copilot', provider: 'claude',
    model: 'claude-sonnet-4-5-20250514', inputTokens: 500, outputTokens: 100,
    totalTokens: 600, usageAvailable: true, usageComplete: true,
    inputCostNanos: 1_500_000, outputCostNanos: 1_500_000, totalCostNanos: 3_000_000,
    inputCostMicros: 1500, outputCostMicros: 1500, totalCostMicros: 3000, rateFound: true,
    conversationId: null, category: 'suggest-response', status: 'ok', mode: 'single', latencyMs: 600,
    createdAt: new Date('2026-02-23T16:00:00Z'),
  },
];

t.before(async () => {
  await connect();
  app = createApp();
  agent = request(app);
  await UsageLog.insertMany(SEED_LOGS);
});

t.after(async () => {
  await disconnect();
});

// ── /api/usage/summary ─────────────────────────────────────────────────

await t.test('summary returns aggregated totals with usageCoveragePercent and dataAvailableFrom', async () => {
  const res = await agent.get('/api/usage/summary').expect(200);
  assert.equal(res.body.ok, true);
  const s = res.body.summary;
  assert.equal(s.totalRequests, 4);
  assert.equal(s.totalInputTokens, 4300);
  assert.equal(s.totalOutputTokens, 1800);
  assert.equal(s.totalTokens, 6100);
  assert.equal(typeof s.totalCostMicros, 'number');
  assert.equal(typeof s.totalCostUsd, 'string');
  assert.ok(s.totalCostUsd.startsWith('$'));
  assert.equal(s.usageReportedCount, 3); // seed-3 has usageAvailable=false
  assert.equal(s.usageCoveragePercent, 75); // 3/4 = 75%
  assert.equal(s.usageCompleteCount, 3); // seed-3 has usageComplete=false
  assert.equal(s.usageCompleteCoveragePercent, 75); // 3/4 = 75%
  assert.ok(res.body.dataAvailableFrom);
});

await t.test('summary returns 400 for invalid dateFrom', async () => {
  const res = await agent.get('/api/usage/summary?dateFrom=bad').expect(400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_DATE');
  assert.match(res.body.error, /dateFrom/);
});

await t.test('summary returns 400 for invalid dateTo', async () => {
  const res = await agent.get('/api/usage/summary?dateTo=notadate').expect(400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_DATE');
  assert.match(res.body.error, /dateTo/);
});

await t.test('summary date filter narrows results', async () => {
  const res = await agent
    .get('/api/usage/summary?dateFrom=2026-02-21&dateTo=2026-02-22')
    .expect(200);
  assert.equal(res.body.summary.totalRequests, 2); // seed-2 and seed-3
});

await t.test('summary dateTo includes full end day (end-of-day correction R5)', async () => {
  // dateTo=2026-02-20 should include seed-1 at 10:00 UTC on that day
  const res = await agent
    .get('/api/usage/summary?dateTo=2026-02-20')
    .expect(200);
  assert.equal(res.body.summary.totalRequests, 1);
});

await t.test('summary returns zero when no data matches', async () => {
  const res = await agent
    .get('/api/usage/summary?dateFrom=2099-01-01')
    .expect(200);
  assert.equal(res.body.summary.totalRequests, 0);
  assert.equal(res.body.summary.totalTokens, 0);
  assert.equal(res.body.summary.usageCoveragePercent, 0);
  assert.equal(res.body.summary.usageCompleteCount, 0);
  assert.equal(res.body.summary.usageCompleteCoveragePercent, 0);
});

// ── /api/usage/by-provider ─────────────────────────────────────────────

await t.test('by-provider returns breakdown per provider with cost fields', async () => {
  const res = await agent.get('/api/usage/by-provider').expect(200);
  assert.equal(res.body.ok, true);
  assert.ok(Array.isArray(res.body.providers));
  assert.equal(res.body.providers.length, 2);
  assert.ok(res.body.dataAvailableFrom);

  const claudeRow = res.body.providers.find((p) => p.provider === 'claude');
  assert.ok(claudeRow);
  assert.equal(claudeRow.requests, 3);
  assert.equal(typeof claudeRow.totalCostMicros, 'number');
  assert.equal(typeof claudeRow.totalCostUsd, 'string');
});

await t.test('by-provider returns 400 for invalid date', async () => {
  const res = await agent.get('/api/usage/by-provider?dateFrom=xyz').expect(400);
  assert.equal(res.body.code, 'INVALID_DATE');
});

// ── /api/usage/by-service ──────────────────────────────────────────────

await t.test('by-service returns breakdown per service', async () => {
  const res = await agent.get('/api/usage/by-service').expect(200);
  assert.equal(res.body.ok, true);
  assert.ok(Array.isArray(res.body.services));
  // chat (2), parse (1), copilot (1)
  assert.equal(res.body.services.length, 3);
  assert.ok(res.body.dataAvailableFrom);

  const chatRow = res.body.services.find((s) => s.service === 'chat');
  assert.ok(chatRow);
  assert.equal(chatRow.requests, 2);
});

// ── /api/usage/trends ──────────────────────────────────────────────────

await t.test('trends returns daily time series by default', async () => {
  const res = await agent.get('/api/usage/trends').expect(200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.interval, 'daily');
  assert.ok(Array.isArray(res.body.trends));
  assert.equal(res.body.trends.length, 4); // 4 distinct days
  assert.ok(res.body.dataAvailableFrom);

  // Each trend entry has expected fields
  const first = res.body.trends[0];
  assert.ok(first.date);
  assert.equal(typeof first.requests, 'number');
  assert.equal(typeof first.totalCostMicros, 'number');
  assert.equal(typeof first.totalCostUsd, 'string');
});

await t.test('trends monthly groups correctly', async () => {
  const res = await agent.get('/api/usage/trends?interval=monthly').expect(200);
  assert.equal(res.body.interval, 'monthly');
  assert.equal(res.body.trends.length, 1); // all in 2026-02
  assert.equal(res.body.trends[0].date, '2026-02');
  assert.equal(res.body.trends[0].requests, 4);
});

await t.test('trends normalizes invalid interval to daily (finding #4)', async () => {
  const res = await agent.get('/api/usage/trends?interval=banana').expect(200);
  assert.equal(res.body.interval, 'daily');
  assert.equal(res.body.trends.length, 4);
});

// ── /api/usage/by-category ─────────────────────────────────────────────

await t.test('by-category groups include both service and category fields (R11)', async () => {
  const res = await agent.get('/api/usage/by-category').expect(200);
  assert.equal(res.body.ok, true);
  assert.ok(Array.isArray(res.body.categories));
  assert.ok(res.body.dataAvailableFrom);

  // Every group has both service and category
  for (const cat of res.body.categories) {
    assert.equal(typeof cat.service, 'string');
    assert.equal(typeof cat.category, 'string');
    assert.equal(typeof cat.totalCostMicros, 'number');
    assert.equal(typeof cat.totalCostUsd, 'string');
  }
});

await t.test('by-category ?service= filter narrows results', async () => {
  const res = await agent.get('/api/usage/by-category?service=copilot').expect(200);
  assert.equal(res.body.categories.length, 1);
  assert.equal(res.body.categories[0].service, 'copilot');
  assert.equal(res.body.categories[0].category, 'suggest-response');
});

// ── /api/usage/recent ──────────────────────────────────────────────────

await t.test('recent returns paginated results with default limit', async () => {
  const res = await agent.get('/api/usage/recent').expect(200);
  assert.equal(res.body.ok, true);
  assert.ok(Array.isArray(res.body.recent));
  assert.equal(res.body.recent.length, 4);
  assert.ok(res.body.dataAvailableFrom);

  // Check pagination shape
  assert.equal(res.body.pagination.page, 1);
  assert.equal(res.body.pagination.limit, 50);
  assert.equal(res.body.pagination.total, 4);
  assert.equal(res.body.pagination.totalPages, 1);

  // Check per-record fields
  const first = res.body.recent[0];
  assert.ok(first.id);
  assert.ok(first.requestId);
  assert.equal(typeof first.totalCostMicros, 'number');
  assert.equal(typeof first.totalCostUsd, 'string');
  // usageComplete exposed alongside usageAvailable
  assert.equal(typeof first.usageAvailable, 'boolean');
  assert.equal(typeof first.usageComplete, 'boolean');
});

await t.test('recent enforces limit cap at 200', async () => {
  const res = await agent.get('/api/usage/recent?limit=999').expect(200);
  assert.equal(res.body.pagination.limit, 200);
});

await t.test('recent paginates correctly', async () => {
  const res = await agent.get('/api/usage/recent?limit=2&page=2').expect(200);
  assert.equal(res.body.recent.length, 2);
  assert.equal(res.body.pagination.page, 2);
  assert.equal(res.body.pagination.totalPages, 2);
});

// ── /api/usage/conversation/:id ────────────────────────────────────────

await t.test('conversation/:id returns aggregate and request list for valid conversation', async () => {
  const res = await agent.get(`/api/usage/conversation/${CONV_ID_A}`).expect(200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.conversationId, CONV_ID_A.toString());
  assert.equal(res.body.aggregate.totalRequests, 2); // seed-1 and seed-2
  assert.equal(res.body.aggregate.inputTokens, 1800);
  assert.equal(typeof res.body.aggregate.totalCostMicros, 'number');
  assert.equal(typeof res.body.aggregate.totalCostUsd, 'string');
  assert.ok(Array.isArray(res.body.requests));
  assert.equal(res.body.requests.length, 2);
  assert.ok(res.body.dataAvailableFrom); // finding #3
});

await t.test('conversation/:id returns 400 INVALID_ID for malformed ID (R15)', async () => {
  const res = await agent.get('/api/usage/conversation/invalid').expect(400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_ID');
  assert.equal(res.body.error, 'Invalid conversation ID');
});

await t.test('conversation/:id returns 400 INVALID_DATE for bad dateFrom (finding #2)', async () => {
  const res = await agent
    .get(`/api/usage/conversation/${CONV_ID_A}?dateFrom=bad`)
    .expect(400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_DATE');
  assert.match(res.body.error, /dateFrom/);
});

await t.test('conversation/:id date filter narrows request list', async () => {
  // CONV_ID_A has seed-1 (Feb 20) and seed-2 (Feb 21)
  const res = await agent
    .get(`/api/usage/conversation/${CONV_ID_A}?dateFrom=2026-02-21`)
    .expect(200);
  assert.equal(res.body.aggregate.totalRequests, 1);
  assert.equal(res.body.requests.length, 1);
});

await t.test('conversation/:id returns empty for nonexistent conversation', async () => {
  const fakeId = new mongoose.Types.ObjectId();
  const res = await agent.get(`/api/usage/conversation/${fakeId}`).expect(200);
  assert.equal(res.body.aggregate.totalRequests, 0);
  assert.equal(res.body.requests.length, 0);
});

// ── /api/usage/models ──────────────────────────────────────────────────

await t.test('models returns breakdown per model with provider', async () => {
  const res = await agent.get('/api/usage/models').expect(200);
  assert.equal(res.body.ok, true);
  assert.ok(Array.isArray(res.body.models));
  assert.equal(res.body.models.length, 2); // claude-sonnet and gpt-4o
  assert.ok(res.body.dataAvailableFrom);

  for (const m of res.body.models) {
    assert.equal(typeof m.model, 'string');
    assert.equal(typeof m.provider, 'string');
    assert.equal(typeof m.totalCostMicros, 'number');
    assert.equal(typeof m.totalCostUsd, 'string');
  }
});

// ── Cross-cutting: cost format ─────────────────────────────────────────

await t.test('all aggregate endpoints return cost as integer micros and formatted USD string', async () => {
  const endpoints = [
    '/api/usage/summary',
    '/api/usage/by-provider',
    '/api/usage/by-service',
    '/api/usage/trends',
    '/api/usage/by-category',
    '/api/usage/models',
  ];

  for (const url of endpoints) {
    const res = await agent.get(url).expect(200);
    const body = JSON.stringify(res.body);
    assert.ok(body.includes('totalCostMicros'), `${url} missing totalCostMicros`);
    assert.ok(body.includes('totalCostUsd'), `${url} missing totalCostUsd`);
  }
});

// ── Cross-cutting: dataAvailableFrom ───────────────────────────────────

await t.test('all endpoints include dataAvailableFrom in response', async () => {
  const fakeId = CONV_ID_A.toString();
  const endpoints = [
    '/api/usage/summary',
    '/api/usage/by-provider',
    '/api/usage/by-service',
    '/api/usage/trends',
    '/api/usage/by-category',
    '/api/usage/recent',
    `/api/usage/conversation/${fakeId}`,
    '/api/usage/models',
  ];

  for (const url of endpoints) {
    const res = await agent.get(url).expect(200);
    assert.ok(
      'dataAvailableFrom' in res.body,
      `${url} missing dataAvailableFrom`,
    );
  }
});

// ── Finding #1: Strict date validation ─────────────────────────────────

await t.test('rejects impossible calendar date Feb 31', async () => {
  const res = await agent.get('/api/usage/summary?dateFrom=2026-02-31').expect(400);
  assert.equal(res.body.code, 'INVALID_DATE');
  assert.match(res.body.error, /dateFrom/);
});

await t.test('accepts valid Feb 29 in leap year', async () => {
  const res = await agent.get('/api/usage/summary?dateFrom=2028-02-29').expect(200);
  assert.equal(res.body.ok, true);
});

await t.test('rejects non-ISO format dates', async () => {
  const res = await agent.get('/api/usage/summary?dateFrom=Feb 20 2026').expect(400);
  assert.equal(res.body.code, 'INVALID_DATE');
});

// ── Finding #2: dateTo timestamp precision ─────────────────────────────

await t.test('dateTo date-only still applies end-of-day correction', async () => {
  // seed-1 is at 2026-02-20T10:00:00Z — dateTo=2026-02-20 should include it
  const res = await agent.get('/api/usage/summary?dateTo=2026-02-20').expect(200);
  assert.equal(res.body.summary.totalRequests, 1);
});

await t.test('dateTo full timestamp does NOT apply end-of-day correction', async () => {
  // seed-1 is at 2026-02-20T10:00:00Z — dateTo at noon should include it
  const noon = await agent.get('/api/usage/summary?dateTo=2026-02-20T12:00:00Z').expect(200);
  assert.equal(noon.body.summary.totalRequests, 1); // seed-1 at 10:00 included

  // dateTo before seed-1 should exclude it
  const early = await agent.get('/api/usage/summary?dateTo=2026-02-20T09:00:00Z').expect(200);
  assert.equal(early.body.summary.totalRequests, 0); // seed-1 at 10:00 excluded
});

// ── Finding #3: Pagination totalPages minimum ──────────────────────────

await t.test('recent pagination returns totalPages=1 on empty result (not 0)', async () => {
  const res = await agent.get('/api/usage/recent?dateFrom=2099-01-01').expect(200);
  assert.equal(res.body.recent.length, 0);
  assert.equal(res.body.pagination.total, 0);
  assert.equal(res.body.pagination.page, 1);
  assert.equal(res.body.pagination.totalPages, 1);
});

// ── Finding #4: Service filter validation ──────────────────────────────

await t.test('by-category rejects invalid service with 400 INVALID_SERVICE', async () => {
  const res = await agent.get('/api/usage/by-category?service=banana').expect(400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_SERVICE');
  assert.match(res.body.error, /chat/); // error lists valid services
});

await t.test('by-category accepts each valid service value', async () => {
  for (const svc of ['chat', 'parse', 'dev', 'copilot']) {
    const res = await agent.get(`/api/usage/by-category?service=${svc}`).expect(200);
    assert.equal(res.body.ok, true);
  }
});
});
