'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

process.env.NODE_ENV = 'test';

// ---------------------------------------------------------------------------
// Module paths and mock harness. Mirror of image-parser-routes.test.js — swap
// the dependencies in require.cache BEFORE loading the route file so the
// route's destructured imports bind to our stubs.
// ---------------------------------------------------------------------------
const ROUTE_PATH = require.resolve('../src/routes/triage-tests');
const CHAT_SERVICE_PATH = require.resolve('../src/services/chat-request-service');
const HEALTH_SERVICE_PATH = require.resolve('../src/services/agent-health-service');
const TRIAGE_MODEL_PATH = require.resolve('../src/models/TriageTestResult');

let _mockRunTriageAgent = null;
let _mockGetAgentHealthSnapshot = null;
let _mockTriageStore = null; // null = simulate db unavailable
let _nextDocId = 1;

function loadRouteWithMocks() {
  delete require.cache[ROUTE_PATH];
  delete require.cache[CHAT_SERVICE_PATH];
  delete require.cache[HEALTH_SERVICE_PATH];
  delete require.cache[TRIAGE_MODEL_PATH];

  const realChat = require(CHAT_SERVICE_PATH);
  const realHealth = require(HEALTH_SERVICE_PATH);

  require.cache[CHAT_SERVICE_PATH] = {
    id: CHAT_SERVICE_PATH,
    filename: CHAT_SERVICE_PATH,
    loaded: true,
    exports: {
      ...realChat,
      runTriageAgent: (...args) => {
        if (_mockRunTriageAgent) return _mockRunTriageAgent(...args);
        return realChat.runTriageAgent(...args);
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

// ═══════════════════════════════════════════════════════════════════════════
// Fixture loading
// ═══════════════════════════════════════════════════════════════════════════
test('readRandomTriageFixture', async (t) => {
  const routerModule = loadRouteWithMocks();
  const { readRandomTriageFixture, listTriageFixtures } = routerModule.__internals;

  await t.test('reads real triage fixture folder and returns at least one fixture', async () => {
    const fixtures = await listTriageFixtures();
    assert.ok(fixtures.length >= 1, 'should find at least one starter fixture');
    for (const fix of fixtures) {
      assert.ok(fix.name, `fixture must have a name (got ${fix.fileName})`);
      assert.ok(typeof fix.parserText === 'string', 'parserText must be a string');
      assert.ok(typeof fix.parseFields === 'object', 'parseFields must be an object');
    }
  });

  await t.test('returns { fixture: null } when the folder is empty', async () => {
    const emptyDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'triage-fixtures-empty-'));
    try {
      const result = await readRandomTriageFixture(emptyDir);
      assert.equal(result.fixture, null);
      assert.equal(result.fixtureCount, 0);
    } finally {
      await fsp.rm(emptyDir, { recursive: true, force: true });
    }
  });

  await t.test('skips malformed JSON files with a warning instead of throwing', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'triage-fixtures-malformed-'));
    try {
      await fsp.writeFile(path.join(tmpDir, 'bad.json'), '{ this is not json', 'utf8');
      await fsp.writeFile(path.join(tmpDir, 'good.json'), JSON.stringify({
        name: 'good',
        description: 'valid fixture',
        tags: [],
        schemaVersion: 1,
        parserText: 'something',
        parseFields: { coid: '1' },
      }), 'utf8');
      const origWarn = console.warn;
      const warnings = [];
      console.warn = (...args) => { warnings.push(args.join(' ')); };
      try {
        const fixtures = await listTriageFixtures(tmpDir);
        assert.equal(fixtures.length, 1, 'malformed fixture should be skipped');
        assert.equal(fixtures[0].name, 'good');
        assert.ok(warnings.some((line) => line.includes('bad.json')), 'should warn about bad.json');
      } finally {
        console.warn = origWarn;
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('random fixture picker covers multiple distinct fixtures', async () => {
    const seen = new Set();
    for (let i = 0; i < 25; i++) {
      const result = await readRandomTriageFixture();
      if (result.fixture) seen.add(result.fixture.name);
    }
    assert.ok(seen.size >= 3, `expected at least 3 distinct fixtures over 25 iterations, got ${seen.size}: ${[...seen].join(', ')}`);
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
    _mockRunTriageAgent = async () => ({
      context: {
        triageCard: {
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
      },
      policy: { primaryProvider: 'anthropic', primaryModel: 'claude-sonnet-4-20250514' },
    });

    try {
      const res = makeRes();
      await handler(makeReq({ runtime: { 'triage-agent': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' } } }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.stage, 'triage');
      assert.equal(res.payload.testRun, true);
      assert.ok(res.payload.fixture, 'response must include the chosen fixture metadata');
      assert.ok(res.payload.fixture.name, 'fixture must have a name');
      assert.ok(res.payload.triageCard, 'response must include the triage card');
      assert.equal(res.payload.triageCard.severity, 'P2');
      assert.equal(typeof res.payload.savedTestResultId, 'string');
      assert.ok(res.payload.savedTestResultId.length > 0, 'savedTestResultId should be populated when the db is available');
      assert.equal(res.payload.providerUsed, 'anthropic');
      assert.equal(res.payload.modelUsed, 'claude-sonnet-4-20250514');
      assert.equal(typeof res.payload.elapsedMs, 'number');
      // The store should have one saved record with all the triage fields denormalized.
      assert.equal(_mockTriageStore.length, 1);
      const saved = _mockTriageStore[0];
      assert.equal(saved.severity, 'P2');
      assert.equal(saved.category, 'bank-feeds');
      assert.equal(saved.confidence, 'medium');
      assert.deepEqual(saved.missingInfo, ['connection-id', 'last-successful-pull-timestamp']);
      assert.equal(saved.cardSource, 'triage-agent');
      assert.equal(saved.fallbackUsed, false);
    } finally {
      _mockRunTriageAgent = null;
      _mockTriageStore = null;
    }
  });

  await t.test('still responds 200 with empty savedTestResultId when the database is offline', async () => {
    _mockTriageStore = null; // db unavailable
    _mockRunTriageAgent = async () => ({
      context: {
        triageCard: { severity: 'P3', category: 'reports', confidence: 'low', source: 'triage-agent', fallback: { used: false } },
        triageMeta: { providerUsed: 'openai', model: 'gpt-5.4-mini', latencyMs: 800 },
      },
      policy: { primaryProvider: 'openai', primaryModel: 'gpt-5.4-mini' },
    });
    try {
      const res = makeRes();
      await handler(makeReq({ runtime: { 'triage-agent': { provider: 'openai' } } }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.savedTestResultId, '');
    } finally {
      _mockRunTriageAgent = null;
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

  await t.test('returns 409 NO_TRIAGE_FIXTURES when the fixture folder is empty', async () => {
    // Swap the in-memory FIXTURE_DIR by replacing the loader for one call.
    // We accomplish this by mocking runTriageAgent and pointing readdir at an
    // empty directory through the internal loader. The cleanest way without
    // modifying the route is to override fs.readdir to claim ENOENT.
    const realReaddir = fs.promises.readdir;
    fs.promises.readdir = async (dir, ...rest) => {
      if (String(dir).includes(path.join('pipeline-tests', 'triage'))) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return realReaddir(dir, ...rest);
    };
    try {
      const res = makeRes();
      await handler(makeReq({}), res);
      assert.equal(res.statusCode, 409);
      assert.equal(res.payload.code, 'NO_TRIAGE_FIXTURES');
    } finally {
      fs.promises.readdir = realReaddir;
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
    _mockRunTriageAgent = async () => ({
      context: {
        triageCard: { severity: 'P3', category: 'reports', source: 'triage-agent', fallback: { used: false } },
        triageMeta: { providerUsed: 'anthropic', model: 'claude-sonnet-4-20250514', latencyMs: 950, providerPackageId: 'PKG-DEADBEEF' },
      },
      policy: { primaryProvider: 'anthropic', primaryModel: 'claude-sonnet-4-20250514' },
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
      _mockRunTriageAgent = null;
      _mockTriageStore = null;
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
  _mockRunTriageAgent = null;
  _mockGetAgentHealthSnapshot = null;
  _mockTriageStore = null;
});
