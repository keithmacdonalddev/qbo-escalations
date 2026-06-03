'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

// ---------------------------------------------------------------------------
// Module paths and mock harness. Mirror of image-parser-routes.test.js — swap
// the dependencies in require.cache BEFORE loading the route file so the
// route's destructured imports bind to our stubs.
// ---------------------------------------------------------------------------
const ROUTE_PATH = require.resolve('../src/routes/triage-tests');
const PIPELINE_ROUTE_PATH = require.resolve('../src/routes/pipeline-tests');
const APPROVED_CASES_LIB_PATH = require.resolve('../src/lib/approved-triage-cases');
const TRIAGE_SERVICE_PATH = require.resolve('../src/services/triage');
const HEALTH_SERVICE_PATH = require.resolve('../src/services/agent-health-service');
const IMAGE_SERVICE_PATH = require.resolve('../src/services/image-parser');
const TRIAGE_MODEL_PATH = require.resolve('../src/models/TriageTestResult');
const BASELINE_MODEL_PATH = require.resolve('../src/models/ImageParserFixtureBaseline');
const CONFIRMED_SEED_PATH = require.resolve('../src/lib/image-parser-confirmed-outputs');
const IMAGE_FIXTURE_DIR = path.resolve(__dirname, '..', 'fixtures', 'pipeline-tests', 'image-parser');

// First real on-disk image fixture name — the approved-case loader reads the
// actual image-parser fixture directory, so we attach mock approved templates
// to a name that exists there. Falls back gracefully if the dir is empty.
function firstRealImageFixtureName() {
  try {
    return fs.readdirSync(IMAGE_FIXTURE_DIR).find((entry) => /\.(png|jpe?g|webp)$/i.test(entry)) || '';
  } catch {
    return '';
  }
}

let _mockRunTriage = null;
let _mockGetAgentHealthSnapshot = null;
let _mockTriageStore = null; // null = simulate db unavailable
let _mockBaselineStore = null; // null = simulate parser-baseline db unavailable
let _nextDocId = 1;
let _nextBaselineId = 1;

// Mongo stand-in for ImageParserFixtureBaseline. The approved-case loader (via
// the shared lib) only uses readyState + findOne.
function makeMockBaselineModel() {
  function store() { return _mockBaselineStore; }
  return {
    db: {
      get readyState() { return store() ? 1 : 0; },
    },
    findOne(filter = {}) {
      const apply = () => {
        const rows = store() || [];
        const found = rows.find((row) => row.fixtureName === filter.fixtureName);
        return found ? { ...found } : null;
      };
      return { lean() { return Promise.resolve(apply()); } };
    },
    findOneAndUpdate(filter = {}, update = {}) {
      const apply = () => {
        const rows = store();
        if (!rows) return null;
        const set = update.$set || update;
        let index = rows.findIndex((row) => row.fixtureName === filter.fixtureName);
        if (index < 0) {
          rows.push({ _id: `baseline-${_nextBaselineId++}`, ...set, updatedAt: new Date() });
          index = rows.length - 1;
        } else {
          rows[index] = { ...rows[index], ...set, updatedAt: new Date() };
        }
        return { ...rows[index] };
      };
      return { lean() { return Promise.resolve(apply()); } };
    },
  };
}

function loadRouteWithMocks() {
  delete require.cache[ROUTE_PATH];
  delete require.cache[PIPELINE_ROUTE_PATH];
  delete require.cache[APPROVED_CASES_LIB_PATH];
  delete require.cache[TRIAGE_SERVICE_PATH];
  delete require.cache[HEALTH_SERVICE_PATH];
  delete require.cache[IMAGE_SERVICE_PATH];
  delete require.cache[TRIAGE_MODEL_PATH];
  delete require.cache[BASELINE_MODEL_PATH];
  delete require.cache[CONFIRMED_SEED_PATH];

  const realTriage = require(TRIAGE_SERVICE_PATH);
  const realHealth = require(HEALTH_SERVICE_PATH);
  const realImageService = require(IMAGE_SERVICE_PATH);

  // The pipeline-tests route (required transitively by the triage route to
  // reuse the approved-asset pipeline) imports the image-parser service; stub
  // parseImage so requiring it never tries to spawn a real provider call.
  require.cache[IMAGE_SERVICE_PATH] = {
    id: IMAGE_SERVICE_PATH,
    filename: IMAGE_SERVICE_PATH,
    loaded: true,
    exports: {
      ...realImageService,
      parseImage: async () => ({ text: '', parseFields: {}, parseMeta: {} }),
    },
  };

  // Shared baseline model — one override covers BOTH pipeline-tests.js and the
  // approved-triage-cases lib (they require the same module path).
  require.cache[BASELINE_MODEL_PATH] = {
    id: BASELINE_MODEL_PATH,
    filename: BASELINE_MODEL_PATH,
    loaded: true,
    exports: makeMockBaselineModel(),
  };

  // Neutralize the built-in confirmed-output SEED so the approved pool is fully
  // controlled by _mockBaselineStore in each test. (In production this seed is a
  // legitimate read-time fallback for one fixture; here it would leak an
  // uncontrolled extra case and make the empty-pool assertions flaky.)
  require.cache[CONFIRMED_SEED_PATH] = {
    id: CONFIRMED_SEED_PATH,
    filename: CONFIRMED_SEED_PATH,
    loaded: true,
    exports: { getBuiltInConfirmedOutput: () => null },
  };

  require.cache[TRIAGE_SERVICE_PATH] = {
    id: TRIAGE_SERVICE_PATH,
    filename: TRIAGE_SERVICE_PATH,
    loaded: true,
    exports: {
      ...realTriage,
      runTriage: (...args) => {
        if (_mockRunTriage) return _mockRunTriage(...args);
        return realTriage.runTriage(...args);
      },
    },
  };
  require.cache[HEALTH_SERVICE_PATH] = {
    id: HEALTH_SERVICE_PATH,
    filename: HEALTH_SERVICE_PATH,
    loaded: true,
    exports: {
      ...realHealth,
      getAgentHealthSnapshot: (...args) => {
        if (_mockGetAgentHealthSnapshot) return _mockGetAgentHealthSnapshot(...args);
        // Default: agent enabled and healthy.
        return Promise.resolve({
          agents: {
            'triage-agent': { enabled: true, status: 'unknown', label: 'Triage Agent' },
          },
          checkedAt: new Date().toISOString(),
        });
      },
    },
  };

  // In-memory Mongo stand-in. The route only uses readyState, find, create,
  // findByIdAndUpdate, aggregate.
  require.cache[TRIAGE_MODEL_PATH] = {
    id: TRIAGE_MODEL_PATH,
    filename: TRIAGE_MODEL_PATH,
    loaded: true,
    exports: makeMockModel(),
  };

  return require(ROUTE_PATH);
}

function makeMockModel() {
  function getStore() {
    return _mockTriageStore;
  }
  const model = {
    db: {
      get readyState() {
        return _mockTriageStore ? 1 : 0;
      },
    },
    async create(doc) {
      if (!getStore()) throw new Error('DB unavailable');
      const _id = `triage-test-${_nextDocId++}`;
      const record = {
        ...doc,
        _id,
        toObject() { return { ...this }; },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      getStore().push(record);
      return record;
    },
    find() {
      const store = getStore() || [];
      let cursor = store.slice();
      const chain = {
        sort() { return chain; },
        limit(n) { cursor = cursor.slice(0, n); return chain; },
        lean() { return Promise.resolve(cursor.map((doc) => ({ ...doc }))); },
      };
      return chain;
    },
    findByIdAndUpdate(id, update) {
      // Mongoose query chain stand-in: support both `.lean()` and direct
      // awaiting. The route uses the .lean() form.
      const apply = () => {
        const store = getStore();
        if (!store) return null;
        const idx = store.findIndex((doc) => doc._id === id);
        if (idx < 0) return null;
        store[idx] = { ...store[idx], ...update, updatedAt: new Date() };
        return { ...store[idx] };
      };
      const chain = {
        lean() {
          return Promise.resolve(apply());
        },
        then(onFulfilled, onRejected) {
          return Promise.resolve(apply()).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
    async aggregate() {
      // Stats path is exercised separately; return empty so the listing
      // endpoint test only validates serialization.
      return [];
    },
  };
  return model;
}

function findHandler(routerModule, method, routePath) {
  const layer = routerModule.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method]
  );
  if (!layer) throw new Error(`No ${method.toUpperCase()} ${routePath} route found`);
  const handlers = layer.route.stack.map((s) => s.handle);
  return handlers[handlers.length - 1];
}

function makeReq(body = {}, extras = {}) {
  return {
    body,
    query: extras.query || {},
    params: extras.params || {},
    headers: extras.headers || {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    setResponseTimeout: () => {},
    ...extras,
  };
}

function makeRes() {
  return {
    headers: {},
    statusCode: 200,
    payload: null,
    headersSent: false,
    setHeader(n, v) { this.headers[n] = v; },
    writeHead(code, headers) { this.statusCode = code; this.headers = { ...this.headers, ...headers }; this.headersSent = true; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.payload = b; return this; },
    write(_chunk) { /* noop for non-SSE tests */ },
    end() {},
  };
}

// A baseline doc shape the approved-case loader understands. Each acceptable
// output becomes one triage case (`${fixtureName}#${outputIndex}`).
function seedBaselineWithOutputs(fixtureName, expectedTexts, extra = {}) {
  return {
    _id: `baseline-seed-${fixtureName}`,
    fixtureName,
    expectedText: expectedTexts[0] || '',
    acceptableOutputs: expectedTexts.map((expectedText, index) => ({
      expectedText,
      sourceProvider: extra.sourceProvider || (index === 0 ? 'gemini' : 'openai'),
      sourceModel: extra.sourceModel || 'test-model',
      confirmedBy: 'operator',
      source: 'saved',
      createdAt: new Date('2026-05-31T00:00:00.000Z'),
      updatedAt: new Date('2026-05-31T00:00:00.000Z'),
    })),
    updatedAt: new Date('2026-05-31T00:00:00.000Z'),
  };
}

const CASE_TEXT_A = [
  'COID/MID: 9130357569572816',
  'CASE: 15154530935',
  'CLIENT/CONTACT: Gayathri Manickavelu',
  'CX IS ATTEMPTING TO: Reset a permission',
].join('\n');
const CASE_TEXT_B = [
  'COID/MID: 9341452918781988',
  'CASE: 15154480000',
  'CLIENT/CONTACT: Bassam Ibrahim',
  'CX IS ATTEMPTING TO: Fix bank feed',
].join('\n');

// ═══════════════════════════════════════════════════════════════════════════
// Approved-case loader (replaces the retired synthetic-fixture loader)
// ═══════════════════════════════════════════════════════════════════════════
test('approved-case loader', async (t) => {
  const routerModule = loadRouteWithMocks();
  const { listApprovedCases, getApprovedCaseById } = routerModule.__internals;
  const realFixture = firstRealImageFixtureName();
  assert.ok(realFixture, 'expected at least one real image-parser fixture on disk');

  await t.test('flattens approved parser outputs into runnable triage cases', async () => {
    _mockBaselineStore = [seedBaselineWithOutputs(realFixture, [CASE_TEXT_A, CASE_TEXT_B])];
    try {
      const cases = await listApprovedCases();
      const mine = cases.filter((entry) => entry.sourceFixtureName === realFixture);
      assert.equal(mine.length, 2, 'two approved outputs -> two cases');
      // Stable id format.
      assert.equal(mine[0].id, `${realFixture}#0`);
      assert.equal(mine[1].id, `${realFixture}#1`);
      // parserText is the approved expectedText, dropped in unchanged.
      assert.equal(mine[0].parserText, CASE_TEXT_A);
      assert.equal(mine[1].parserText, CASE_TEXT_B);
      // Human label derives from CLIENT/CONTACT.
      assert.equal(mine[0].label, 'Gayathri Manickavelu');
      assert.equal(mine[1].label, 'Bassam Ibrahim');
      // Provenance carried through.
      assert.equal(mine[0].provider, 'gemini');
      assert.equal(mine[0].confirmedBy, 'operator');
    } finally {
      _mockBaselineStore = null;
    }
  });

  await t.test('returns an empty list when no outputs are approved', async () => {
    _mockBaselineStore = [];
    try {
      const cases = await listApprovedCases();
      assert.deepEqual(cases, []);
    } finally {
      _mockBaselineStore = null;
    }
  });

  await t.test('covers multiple distinct cases across the pool', async () => {
    _mockBaselineStore = [seedBaselineWithOutputs(realFixture, [CASE_TEXT_A, CASE_TEXT_B])];
    try {
      const cases = await listApprovedCases();
      const ids = new Set(cases.map((entry) => entry.id));
      assert.ok(ids.size >= 2, `expected >= 2 distinct case ids, got ${ids.size}`);
    } finally {
      _mockBaselineStore = null;
    }
  });

  await t.test('getApprovedCaseById resolves a specific case and null otherwise', async () => {
    _mockBaselineStore = [seedBaselineWithOutputs(realFixture, [CASE_TEXT_A, CASE_TEXT_B])];
    try {
      const found = await getApprovedCaseById(`${realFixture}#1`);
      assert.ok(found, 'should resolve the #1 case');
      assert.equal(found.parserText, CASE_TEXT_B);
      const missing = await getApprovedCaseById(`${realFixture}#999`);
      assert.equal(missing, null);
      const blank = await getApprovedCaseById('');
      assert.equal(blank, null);
    } finally {
      _mockBaselineStore = null;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /cases
// ═══════════════════════════════════════════════════════════════════════════
test('GET /cases', async (t) => {
  const routerModule = loadRouteWithMocks();
  const handler = findHandler(routerModule, 'get', '/cases');
  const realFixture = firstRealImageFixtureName();

  await t.test('returns the approved cases with labels and provenance, no full parserText', async () => {
    _mockBaselineStore = [seedBaselineWithOutputs(realFixture, [CASE_TEXT_A, CASE_TEXT_B])];
    try {
      const res = makeRes();
      await handler(makeReq({}), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.ok, true);
      const mine = res.payload.cases.filter((entry) => entry.sourceFixtureName === realFixture);
      assert.equal(mine.length, 2);
      assert.equal(mine[0].id, `${realFixture}#0`);
      assert.equal(mine[0].label, 'Gayathri Manickavelu');
      assert.equal(mine[0].provider, 'gemini');
      // The list endpoint intentionally omits the full parserText.
      assert.equal(Object.prototype.hasOwnProperty.call(mine[0], 'parserText'), false);
      assert.ok(res.payload.stats.caseCount >= 2);
    } finally {
      _mockBaselineStore = null;
    }
  });

  await t.test('returns an empty list when nothing is approved', async () => {
    _mockBaselineStore = [];
    try {
      const res = makeRes();
      await handler(makeReq({}), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.ok, true);
      assert.deepEqual(res.payload.cases, []);
      assert.equal(res.payload.stats.caseCount, 0);
    } finally {
      _mockBaselineStore = null;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /run — JSON response shape
// ═══════════════════════════════════════════════════════════════════════════
test('POST /run JSON response shape', async (t) => {
  const routerModule = loadRouteWithMocks();
  const handler = findHandler(routerModule, 'post', '/run');

  await t.test('returns { ok, stage: triage, testRun: true, fixture, triageCard, savedTestResultId, ... }', async () => {
    _mockTriageStore = [];
    // No-body run = random from the real approved pool. Seed a baseline so the
    // pool is non-empty and deterministic.
    _mockBaselineStore = [seedBaselineWithOutputs(firstRealImageFixtureName(), [CASE_TEXT_A])];
    let capturedTriageText = '';
    let capturedTriageOptions = null;
    _mockRunTriage = async (text, options) => {
      capturedTriageText = text;
      capturedTriageOptions = options;
      return {
      card: {
        severity: 'P2',
        category: 'bank-feeds',
        confidence: 'medium',
        read: 'Bank feed has not refreshed in 9 days.',
        action: 'Open a bank-feeds backend ticket with the connection ID.',
        missingInfo: ['connection-id', 'last-successful-pull-timestamp'],
        categoryCheck: 'bank-feeds is the correct category — the symptom is connector lag, not a reconciliation question.',
        source: 'triage-agent',
        fallback: { used: false },
        generation: { source: 'agent', label: 'Agent generated', latencyMs: 1200, provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      },
      triageMeta: {
        mode: 'single',
        providerUsed: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        latencyMs: 1200,
      },
      providerUsed: 'anthropic',
      modelUsed: 'claude-sonnet-4-20250514',
      elapsedMs: 1200,
      status: 'success',
      };
    };

    try {
      const res = makeRes();
      await handler(makeReq({ runtime: { 'triage-agent': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' } } }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.stage, 'triage');
      assert.equal(res.payload.testRun, true);
      assert.ok(res.payload.fixture, 'response must include the chosen fixture metadata');
      assert.ok(res.payload.fixture.name, 'fixture must have a name');
      // fixture.name is the stable approved-case id (sourceFixtureName#index)
      // so historical stats grouping holds; selectionMode marks the random pick.
      assert.match(res.payload.fixture.name, /#\d+$/);
      assert.equal(res.payload.fixture.selectionMode, 'random');
      assert.equal(res.payload.fixture.label, 'Gayathri Manickavelu');
      assert.ok(res.payload.triageCard, 'response must include the triage card');
      assert.equal(res.payload.triageCard.severity, 'P2');
      assert.equal(typeof res.payload.savedTestResultId, 'string');
      assert.ok(res.payload.savedTestResultId.length > 0, 'savedTestResultId should be populated when the db is available');
      assert.equal(res.payload.providerUsed, 'anthropic');
      assert.equal(res.payload.modelUsed, 'claude-sonnet-4-20250514');
      assert.equal(typeof res.payload.elapsedMs, 'number');
      assert.match(capturedTriageText, /COID\/MID:/);
      assert.equal(Object.prototype.hasOwnProperty.call(capturedTriageOptions, 'parseFields'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(res.payload, 'parseFields'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(res.payload.savedTestResult, 'parseFields'), false);
      // The store should have one saved record with all the triage fields denormalized.
      assert.equal(_mockTriageStore.length, 1);
      const saved = _mockTriageStore[0];
      assert.equal(saved.severity, 'P2');
      assert.equal(saved.category, 'bank-feeds');
      assert.equal(saved.confidence, 'medium');
      assert.deepEqual(saved.missingInfo, ['connection-id', 'last-successful-pull-timestamp']);
      assert.equal(saved.cardSource, 'triage-agent');
      assert.equal(saved.fallbackUsed, false);
      assert.equal(saved.parseFields.clientContact.length > 0, true);
    } finally {
      _mockRunTriage = null;
      _mockTriageStore = null;
      _mockBaselineStore = null;
    }
  });

  await t.test('runs a SPECIFIC approved case when caseId is supplied', async () => {
    _mockTriageStore = [];
    const realFixture = firstRealImageFixtureName();
    _mockBaselineStore = [seedBaselineWithOutputs(realFixture, [CASE_TEXT_A, CASE_TEXT_B])];
    let capturedText = '';
    _mockRunTriage = async (text) => {
      capturedText = text;
      return {
        card: { severity: 'P3', category: 'bank-feeds', source: 'triage-agent', fallback: { used: false } },
        triageMeta: { providerUsed: 'anthropic', model: 'claude-sonnet-4-20250514', latencyMs: 500 },
        providerUsed: 'anthropic',
        modelUsed: 'claude-sonnet-4-20250514',
        elapsedMs: 500,
        status: 'success',
      };
    };
    try {
      const res = makeRes();
      await handler(makeReq({ caseId: `${realFixture}#1`, runtime: { 'triage-agent': { provider: 'anthropic' } } }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.fixture.name, `${realFixture}#1`);
      assert.equal(res.payload.fixture.selectionMode, 'specific');
      assert.equal(res.payload.fixture.label, 'Bassam Ibrahim');
      // The exact approved text for case #1 was sent to the triage runtime.
      assert.equal(capturedText, CASE_TEXT_B);
      assert.equal(res.payload.parserText, CASE_TEXT_B);
    } finally {
      _mockRunTriage = null;
      _mockTriageStore = null;
      _mockBaselineStore = null;
    }
  });

  await t.test('returns 404 APPROVED_CASE_NOT_FOUND for an unknown caseId', async () => {
    _mockTriageStore = [];
    _mockBaselineStore = [seedBaselineWithOutputs(firstRealImageFixtureName(), [CASE_TEXT_A])];
    try {
      const res = makeRes();
      await handler(makeReq({ caseId: 'no-such-image.JPEG#7' }), res);
      assert.equal(res.statusCode, 404);
      assert.equal(res.payload.ok, false);
      assert.equal(res.payload.code, 'APPROVED_CASE_NOT_FOUND');
    } finally {
      _mockTriageStore = null;
      _mockBaselineStore = null;
    }
  });

  await t.test('still responds 200 with empty savedTestResultId when the database is offline', async () => {
    _mockTriageStore = null; // db unavailable
    _mockBaselineStore = [seedBaselineWithOutputs(firstRealImageFixtureName(), [CASE_TEXT_A])];
    _mockRunTriage = async () => ({
      card: { severity: 'P3', category: 'reports', confidence: 'low', source: 'triage-agent', fallback: { used: false } },
      triageMeta: { providerUsed: 'openai', model: 'gpt-5.4-mini', latencyMs: 800 },
      providerUsed: 'openai',
      modelUsed: 'gpt-5.4-mini',
      elapsedMs: 800,
      status: 'success',
    });
    try {
      const res = makeRes();
      await handler(makeReq({ runtime: { 'triage-agent': { provider: 'openai' } } }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.savedTestResultId, '');
    } finally {
      _mockRunTriage = null;
      _mockBaselineStore = null;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /run — guard rails
// ═══════════════════════════════════════════════════════════════════════════
test('POST /run guard rails', async (t) => {
  const routerModule = loadRouteWithMocks();
  const handler = findHandler(routerModule, 'post', '/run');

  await t.test('returns 409 AGENT_DISABLED when the triage agent is disabled', async () => {
    _mockGetAgentHealthSnapshot = async () => ({
      agents: { 'triage-agent': { enabled: false, status: 'disabled', label: 'Triage Agent' } },
      checkedAt: new Date().toISOString(),
    });
    try {
      const res = makeRes();
      await handler(makeReq({}), res);
      assert.equal(res.statusCode, 409);
      assert.equal(res.payload.ok, false);
      assert.equal(res.payload.code, 'AGENT_DISABLED');
      assert.equal(res.payload.stage, 'triage');
    } finally {
      _mockGetAgentHealthSnapshot = null;
    }
  });

  await t.test('returns 409 NO_APPROVED_CASES when no parser outputs are approved', async () => {
    // Empty approved pool (baseline db reachable but holds nothing). A random
    // run has no real case to pick, so the route refuses with a clean 409
    // rather than ever fabricating synthetic input.
    _mockBaselineStore = [];
    try {
      const res = makeRes();
      await handler(makeReq({}), res);
      assert.equal(res.statusCode, 409);
      assert.equal(res.payload.ok, false);
      assert.equal(res.payload.code, 'NO_APPROVED_CASES');
      assert.equal(res.payload.stage, 'triage');
    } finally {
      _mockBaselineStore = null;
    }
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// POST /run — SSE event vocabulary
// ═══════════════════════════════════════════════════════════════════════════
test('POST /run SSE event vocabulary', async (t) => {
  const routerModule = loadRouteWithMocks();
  const handler = findHandler(routerModule, 'post', '/run');

  await t.test('emits server_request_received and response_sent events when client wants SSE', async () => {
    _mockTriageStore = [];
    _mockBaselineStore = [seedBaselineWithOutputs(firstRealImageFixtureName(), [CASE_TEXT_A])];
    _mockRunTriage = async () => ({
      card: { severity: 'P3', category: 'reports', source: 'triage-agent', fallback: { used: false } },
      triageMeta: {
        source: 'agent',
        providerUsed: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        latencyMs: 950,
        providerPackageId: 'PKG-DEADBEEF',
      },
      providerUsed: 'anthropic',
      modelUsed: 'claude-sonnet-4-20250514',
      elapsedMs: 950,
      status: 'success',
    });
    try {
      const res = makeRes();
      const captured = [];
      // Intercept SSE writes so we can assert which event names were emitted.
      res.write = (chunk) => { captured.push(chunk); };
      const req = makeReq(
        { runtime: { 'triage-agent': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' } } },
        { headers: { accept: 'text/event-stream' } }
      );
      await handler(req, res);
      const joined = captured.join('');
      assert.ok(joined.includes('event: stage_event'), 'should emit stage_event frames via the bus');
      assert.ok(joined.includes('triage.server_request_received'), 'should announce the run starting');
      assert.ok(joined.includes('triage.provider_content_sending_to_client'), 'should announce package handoff when providerPackageId is present');
      assert.ok(joined.includes('triage.response_sent'), 'should mark the run complete');
      assert.ok(joined.includes('event: test_complete'), 'should emit a terminal test_complete frame');
    } finally {
      _mockRunTriage = null;
      _mockTriageStore = null;
      _mockBaselineStore = null;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /results/:id lifecycle
// ═══════════════════════════════════════════════════════════════════════════
test('PATCH /results/:id', async (t) => {
  const routerModule = loadRouteWithMocks();
  const handler = findHandler(routerModule, 'patch', '/results/:id');

  await t.test('returns 503 when db is offline', async () => {
    _mockTriageStore = null;
    const res = makeRes();
    await handler(makeReq({ status: 'pass' }, { params: { id: 'abc' } }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.code, 'DB_UNAVAILABLE');
  });

  await t.test('returns 400 INVALID_STATUS for unknown status values', async () => {
    _mockTriageStore = [];
    try {
      const res = makeRes();
      await handler(makeReq({ status: 'wat' }, { params: { id: 'abc' } }), res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.payload.code, 'INVALID_STATUS');
    } finally {
      _mockTriageStore = null;
    }
  });

  await t.test('returns 404 NOT_FOUND when the document does not exist', async () => {
    _mockTriageStore = [];
    try {
      const res = makeRes();
      await handler(makeReq({ status: 'pass' }, { params: { id: 'missing-id' } }), res);
      assert.equal(res.statusCode, 404);
      assert.equal(res.payload.code, 'NOT_FOUND');
    } finally {
      _mockTriageStore = null;
    }
  });

  await t.test('marks pending-review -> pass with reviewedAt set', async () => {
    _mockTriageStore = [{
      _id: 'doc-1',
      status: 'pending-review',
      reviewedAt: null,
      reviewer: 'operator',
      operatorNote: '',
      toObject() { return { ...this }; },
    }];
    try {
      const res = makeRes();
      await handler(makeReq({ status: 'pass', operatorNote: 'Looks good.' }, { params: { id: 'doc-1' } }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.result.status, 'pass');
      assert.ok(res.payload.result.reviewedAt instanceof Date || typeof res.payload.result.reviewedAt === 'string');
      assert.equal(res.payload.result.operatorNote, 'Looks good.');
    } finally {
      _mockTriageStore = null;
    }
  });

  await t.test('marks pending-review -> fail and back to pending-review (reviewedAt cleared)', async () => {
    _mockTriageStore = [{
      _id: 'doc-2',
      status: 'pending-review',
      reviewedAt: null,
      reviewer: 'operator',
      operatorNote: '',
      toObject() { return { ...this }; },
    }];
    try {
      const failRes = makeRes();
      await handler(makeReq({ status: 'fail' }, { params: { id: 'doc-2' } }), failRes);
      assert.equal(failRes.payload.result.status, 'fail');
      assert.ok(failRes.payload.result.reviewedAt, 'reviewedAt should be set on fail');

      const undoRes = makeRes();
      await handler(makeReq({ status: 'pending-review' }, { params: { id: 'doc-2' } }), undoRes);
      assert.equal(undoRes.payload.result.status, 'pending-review');
      assert.equal(undoRes.payload.result.reviewedAt, null);
    } finally {
      _mockTriageStore = null;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /results
// ═══════════════════════════════════════════════════════════════════════════
test('GET /results', async (t) => {
  const routerModule = loadRouteWithMocks();
  const handler = findHandler(routerModule, 'get', '/results');

  await t.test('returns empty list with dbAvailable: false when db is offline', async () => {
    _mockTriageStore = null;
    const res = makeRes();
    await handler(makeReq({}), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.dbAvailable, false);
    assert.deepEqual(res.payload.results, []);
    assert.equal(res.payload.stats.total, 0);
    assert.equal(res.payload.stats.pass, 0);
    assert.equal(res.payload.stats.fail, 0);
  });

  await t.test('returns serialized results when the store has records', async () => {
    _mockTriageStore = [
      { _id: 'doc-a', status: 'pass', severity: 'P1', toObject() { return { ...this }; } },
      { _id: 'doc-b', status: 'fail', severity: 'P3', toObject() { return { ...this }; } },
    ];
    try {
      const res = makeRes();
      await handler(makeReq({}), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.dbAvailable, true);
      assert.equal(res.payload.results.length, 2);
      assert.equal(res.payload.results[0].id, 'doc-a');
      assert.equal(res.payload.results[1].id, 'doc-b');
    } finally {
      _mockTriageStore = null;
    }
  });
});

// ---------------------------------------------------------------------------
// Teardown.
// ---------------------------------------------------------------------------
test.after(() => {
  _mockRunTriage = null;
  _mockGetAgentHealthSnapshot = null;
  _mockTriageStore = null;
  _mockBaselineStore = null;
});
