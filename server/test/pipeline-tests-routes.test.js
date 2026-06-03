'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

process.env.NODE_ENV = 'test';

const ROUTE_PATH = require.resolve('../src/routes/pipeline-tests');
const IMAGE_SERVICE_PATH = require.resolve('../src/services/image-parser');
const HEALTH_SERVICE_PATH = require.resolve('../src/services/agent-health-service');
const MODEL_PATH = require.resolve('../src/models/ImageParserTestResult');
const BASELINE_MODEL_PATH = require.resolve('../src/models/ImageParserFixtureBaseline');
const FIXTURE_DIR = path.resolve(__dirname, '..', 'fixtures', 'pipeline-tests');
const CASE_FIXTURE_PATH = path.join(FIXTURE_DIR, 'escalation-case.json');
const IMAGE_FIXTURE_DIR = path.join(FIXTURE_DIR, 'image-parser');

let mockParseImage = null;
let mockStore = [];
let mockBaselineStore = [];
let nextId = 1;
let nextBaselineId = 1;

function makeMockModel() {
  function currentStore() {
    return mockStore;
  }
  return {
    db: {
      get readyState() {
        return currentStore() ? 1 : 0;
      },
    },
    async create(doc) {
      if (!currentStore()) throw new Error('DB unavailable');
      const _id = `parser-test-${nextId++}`;
      const record = {
        ...doc,
        _id,
        createdAt: new Date(),
        updatedAt: new Date(),
        toObject() {
          return { ...this };
        },
      };
      currentStore().push(record);
      return record;
    },
    find() {
      const rows = currentStore() || [];
      const chain = {
        sort() { return chain; },
        limit() { return chain; },
        lean() { return Promise.resolve(rows.map((row) => ({ ...row }))); },
      };
      return chain;
    },
    findById(id) {
      const apply = () => {
        const rows = currentStore() || [];
        const found = rows.find((row) => row._id === id);
        return found ? { ...found } : null;
      };
      return {
        lean() {
          return Promise.resolve(apply());
        },
      };
    },
    findByIdAndUpdate(id, update) {
      const apply = () => {
        const rows = currentStore();
        if (!rows) return null;
        const index = rows.findIndex((row) => row._id === id);
        if (index < 0) return null;
        rows[index] = { ...rows[index], ...update, updatedAt: new Date() };
        return { ...rows[index] };
      };
      return {
        lean() {
          return Promise.resolve(apply());
        },
      };
    },
    findByIdAndDelete(id) {
      const apply = () => {
        const rows = currentStore();
        if (!rows) return null;
        const index = rows.findIndex((row) => row._id === id);
        if (index < 0) return null;
        const [removed] = rows.splice(index, 1);
        return { ...removed };
      };
      return {
        lean() {
          return Promise.resolve(apply());
        },
      };
    },
    async aggregate() {
      return [];
    },
  };
}

function makeMockBaselineModel() {
  function currentStore() {
    return mockBaselineStore;
  }
  return {
    db: {
      get readyState() {
        return currentStore() ? 1 : 0;
      },
    },
    findOne(filter = {}) {
      const apply = () => {
        const rows = currentStore() || [];
        const fixtureName = filter.fixtureName;
        const found = rows.find((row) => row.fixtureName === fixtureName);
        return found ? { ...found } : null;
      };
      return {
        lean() {
          return Promise.resolve(apply());
        },
      };
    },
    findOneAndUpdate(filter = {}, update = {}) {
      const apply = () => {
        const rows = currentStore();
        if (!rows) return null;
        const fixtureName = filter.fixtureName;
        let index = rows.findIndex((row) => row.fixtureName === fixtureName);
        const set = update.$set || update;
        if (index < 0) {
          rows.push({
            _id: `parser-baseline-${nextBaselineId++}`,
            ...set,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          index = rows.length - 1;
        } else {
          rows[index] = { ...rows[index], ...set, updatedAt: new Date() };
        }
        return { ...rows[index] };
      };
      return {
        lean() {
          return Promise.resolve(apply());
        },
      };
    },
  };
}

function loadRouteWithMocks() {
  delete require.cache[ROUTE_PATH];
  delete require.cache[IMAGE_SERVICE_PATH];
  delete require.cache[HEALTH_SERVICE_PATH];
  delete require.cache[MODEL_PATH];
  delete require.cache[BASELINE_MODEL_PATH];

  const realImageService = require(IMAGE_SERVICE_PATH);
  const realHealthService = require(HEALTH_SERVICE_PATH);

  require.cache[IMAGE_SERVICE_PATH] = {
    id: IMAGE_SERVICE_PATH,
    filename: IMAGE_SERVICE_PATH,
    loaded: true,
    exports: {
      ...realImageService,
      parseImage: (...args) => {
        if (mockParseImage) return mockParseImage(...args);
        return realImageService.parseImage(...args);
      },
    },
  };

  require.cache[HEALTH_SERVICE_PATH] = {
    id: HEALTH_SERVICE_PATH,
    filename: HEALTH_SERVICE_PATH,
    loaded: true,
    exports: {
      ...realHealthService,
      getAgentHealthSnapshot: async () => ({
        checkedAt: new Date().toISOString(),
        agents: {
          'escalation-template-parser': {
            enabled: true,
            status: 'online',
            label: 'Escalation Image Parser',
          },
        },
      }),
      refreshAgentHealth: async () => ({
        checkedAt: new Date().toISOString(),
        agents: {},
      }),
    },
  };

  require.cache[MODEL_PATH] = {
    id: MODEL_PATH,
    filename: MODEL_PATH,
    loaded: true,
    exports: makeMockModel(),
  };

  require.cache[BASELINE_MODEL_PATH] = {
    id: BASELINE_MODEL_PATH,
    filename: BASELINE_MODEL_PATH,
    loaded: true,
    exports: makeMockBaselineModel(),
  };

  return require(ROUTE_PATH);
}

function findHandler(router, method, routePath) {
  const layer = router.stack.find((entry) =>
    entry.route && entry.route.path === routePath && entry.route.methods[method]
  );
  if (!layer) throw new Error(`No ${method.toUpperCase()} ${routePath} route found`);
  const handlers = layer.route.stack.map((entry) => entry.handle);
  return handlers[handlers.length - 1];
}

function makeReq(body = {}, extras = {}) {
  return {
    body,
    query: extras.query || {},
    params: extras.params || {},
    headers: extras.headers || {},
    setResponseTimeout: () => {},
    on: () => {},
    ...extras,
  };
}

function makeRes() {
  const listeners = new Map();
  return {
    headers: {},
    statusCode: 200,
    payload: null,
    writes: [],
    headersSent: false,
    writableEnded: false,
    on(event, handler) {
      listeners.set(event, handler);
      return this;
    },
    emit(event) {
      const handler = listeners.get(event);
      if (handler) handler();
    },
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = { ...this.headers, ...headers };
      this.headersSent = true;
      return this;
    },
    status(status) { this.statusCode = status; return this; },
    json(payload) { this.payload = payload; this.writableEnded = true; return this; },
    send(payload) { this.payload = payload; this.writableEnded = true; return this; },
    write(chunk) { this.writes.push(String(chunk)); },
    end() { this.writableEnded = true; },
  };
}

function readSseMessages(res) {
  return res.writes.join('').split('\n\n').filter(Boolean).map((frame) => {
    const lines = frame.split('\n');
    const event = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length) || '';
    const data = lines.find((line) => line.startsWith('data: '))?.slice('data: '.length) || 'null';
    return { event, data: JSON.parse(data) };
  });
}

function assertOrderedSubsequence(actual, expected) {
  let cursor = -1;
  for (const item of expected) {
    const next = actual.indexOf(item, cursor + 1);
    assert.ok(next > cursor, `expected ${item} after index ${cursor}; got ${actual.join(', ')}`);
    cursor = next;
  }
}

function parserBody(provider = 'lm-studio') {
  return {
    stage: 'parser',
    runtime: {
      imageParser: {
        provider,
        model: 'local-test-model',
        reasoningEffort: 'low',
        serviceTier: 'fast',
      },
    },
  };
}

function parserResult() {
  return {
    text: 'COID/MID: 12345\nCASE: 67890',
    sourceText: 'COID/MID: 12345\nCASE: 67890',
    parseFields: {
      coid: '12345',
      caseNumber: '67890',
    },
    parseMeta: {
      canonicalTemplate: {
        passed: true,
        issues: [],
      },
      semanticPassed: true,
      fieldsFound: 2,
      issues: [],
    },
    usage: {
      model: 'local-test-model',
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    },
    promptId: 'escalation-template-parser',
    promptVersion: 'P25',
    promptSha256: 'abc123',
    promptLength: 2048,
    providerTrace: {
      providerPackageId: 'pkg-parser-test',
      providerHarness: 'mock',
    },
  };
}

function confirmedA48Output() {
  return [
    'COID/MID:9341455743597823',
    'CASE: 15154491216',
    'CLIENT/CONTACT: Dharmika Mithaiwala',
    'CX IS ATTEMPTING TO: Payroll suspended',
    'EXPECTED OUTCOME: vbd reset',
    'ACTUAL OUTCOME: IDV - 15149615753 case completed , uploaded the supported documents',
    'KB/TOOLS USED: n\\a',
    'TRIED TEST ACCOUNT: n\\a',
    'TS STEPS: checked Bank Account Setup : SUSPENDED',
  ].join('\n');
}

test('POST /run parser reports truthful saved state and skips case fixture', async () => {
  const router = loadRouteWithMocks();
  const handler = findHandler(router, 'post', '/run');
  const originalReadFile = fsp.readFile;

  mockStore = [];
  let parseOptions = null;
  mockParseImage = async (_image, options) => {
    parseOptions = options;
    return parserResult();
  };
  fsp.readFile = async (filePath, ...args) => {
    if (path.resolve(String(filePath)) === CASE_FIXTURE_PATH) {
      throw new Error('Parser test must not read escalation-case.json');
    }
    return originalReadFile.call(fsp, filePath, ...args);
  };

  try {
    const res = makeRes();
    await handler(makeReq(parserBody()), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.stage, 'parser');
    assert.equal(res.payload.saveStatus, 'saved');
    assert.equal(res.payload.saveReason, '');
    assert.match(res.payload.alert, /saved/i);
    assert.ok(res.payload.savedTestResultId);
    assert.equal(res.payload.savedTestResult.status, 'pending-review');
    assert.equal(res.payload.promptVersion, 'P25');
    assert.equal(res.payload.promptSha256, 'abc123');
    assert.equal(res.payload.savedTestResult.promptVersion, 'P25');
    assert.equal(res.payload.savedTestResult.promptSha256, 'abc123');
    assert.equal(parseOptions.reasoningEffort, 'low');
    assert.equal(parseOptions.serviceTier, 'fast');
    assert.equal(res.payload.savedTestResult.reasoningEffort, 'low');
    assert.equal(res.payload.savedTestResult.serviceTier, 'fast');
    assert.equal(res.payload.savedTestResult.providerPackageId, 'pkg-parser-test');
    assert.equal(res.payload.savedTestResult.providerHarness, 'mock');
    assert.equal(res.payload.savedTestResult.providerTrace.providerPackageId, 'pkg-parser-test');
    assert.equal(mockStore.length, 1);
  } finally {
    fsp.readFile = originalReadFile;
    mockParseImage = null;
  }
});

test('POST /run parser streams provider package events before completion', async () => {
  const router = loadRouteWithMocks();
  const handler = findHandler(router, 'post', '/run');

  mockStore = [];
  mockParseImage = async (_image, options) => {
    options.eventBus.emit('provider.package_capture_started', {
      providerPackageId: 'pkg-parser-test',
      status: 'started',
    });
    options.eventBus.emit('provider.package_capture_wait_started', {
      providerPackageId: 'pkg-parser-test',
      status: 'started',
    });
    options.eventBus.emit('provider.package_capture_read_confirmed', {
      providerPackageId: 'pkg-parser-test',
      status: 'complete',
    });
    options.eventBus.emit('provider.package_capture_confirmed', {
      providerPackageId: 'pkg-parser-test',
      status: 'complete',
    });
    options.eventBus.emit('provider.package_ready_for_agent', {
      providerPackageId: 'pkg-parser-test',
      outcome: 'success',
    });
    options.eventBus.emit('parser.provider_package_retrieval_started', {
      providerPackageId: 'pkg-parser-test',
      status: 'started',
    });
    options.eventBus.emit('parser.provider_package_loaded', {
      providerPackageId: 'pkg-parser-test',
      status: 'loaded',
    });
    options.eventBus.emit('parser.provider_payload_selected', {
      providerPackageId: 'pkg-parser-test',
      source: 'mock',
    });
    return parserResult();
  };

  try {
    const res = makeRes();
    await handler(makeReq(parserBody('codex'), {
      headers: { accept: 'text/event-stream' },
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'text/event-stream');
    assert.equal(res.writableEnded, true);
    const messages = readSseMessages(res);
    const stageKinds = messages
      .filter((message) => message.event === 'stage_event')
      .map((message) => message.data.kind);

    assertOrderedSubsequence(stageKinds, [
      'parser.server_request_received',
      'provider.package_capture_started',
      'provider.package_capture_wait_started',
      'provider.package_capture_read_confirmed',
      'provider.package_capture_confirmed',
      'provider.package_ready_for_agent',
      'parser.provider_package_retrieval_started',
      'parser.provider_package_loaded',
      'parser.provider_payload_selected',
      'parser.provider_content_sending_to_client',
      'parser.response_sent',
    ]);
    assert.equal(stageKinds.includes('parser.provider_package_load_retry'), false);
    const complete = messages.find((message) => message.event === 'test_complete');
    assert.ok(complete);
    assert.equal(complete.data.ok, true);
    assert.equal(complete.data.providerTrace.providerPackageId, 'pkg-parser-test');
  } finally {
    mockParseImage = null;
  }
});

test('POST /run parser can retest a specific image fixture', async () => {
  const router = loadRouteWithMocks();
  const handler = findHandler(router, 'post', '/run');
  const fileName = fs.readdirSync(IMAGE_FIXTURE_DIR).find((entry) => /\.(png|jpe?g|webp)$/i.test(entry));
  assert.ok(fileName, 'expected at least one image parser fixture');

  mockStore = [];
  mockParseImage = async () => parserResult();

  try {
    const res = makeRes();
    await handler(makeReq({
      ...parserBody('gemini'),
      fixtureName: fileName,
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.imageFixture.name, fileName);
    assert.equal(res.payload.imageFixture.requested, true);
    assert.equal(res.payload.savedTestResult.fixture.name, fileName);
    assert.equal(res.payload.providerUsed, 'gemini');
  } finally {
    mockParseImage = null;
  }
});

test('POST /run parser retest excludes the previous image when choosing randomly', async () => {
  const router = loadRouteWithMocks();
  const handler = findHandler(router, 'post', '/run');
  const fileNames = fs.readdirSync(IMAGE_FIXTURE_DIR).filter((entry) => /\.(png|jpe?g|webp)$/i.test(entry));
  assert.ok(fileNames.length >= 2, 'expected at least two image parser fixtures');
  const previousFixture = fileNames[0];

  mockStore = [];
  mockParseImage = async () => parserResult();

  try {
    const res = makeRes();
    await handler(makeReq({
      ...parserBody('gemini'),
      retest: true,
      excludeFixtureName: previousFixture,
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.notEqual(res.payload.imageFixture.name, previousFixture);
    assert.equal(res.payload.imageFixture.requested, false);
    assert.notEqual(res.payload.savedTestResult.fixture.name, previousFixture);
  } finally {
    mockParseImage = null;
  }
});

test('POST /run parser reports not-saved when result database is unavailable', async () => {
  const router = loadRouteWithMocks();
  const handler = findHandler(router, 'post', '/run');

  mockStore = null;
  mockParseImage = async () => parserResult();

  try {
    const res = makeRes();
    await handler(makeReq(parserBody()), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.saveStatus, 'not-saved');
    assert.match(res.payload.saveReason, /database is unavailable/i);
    assert.equal(res.payload.savedTestResultId, '');
    assert.equal(res.payload.savedTestResult, null);
  } finally {
    mockParseImage = null;
    mockStore = [];
  }
});

test('GET /image-fixtures/:name serves parser fixture images', async () => {
  const router = loadRouteWithMocks();
  const handler = findHandler(router, 'get', '/image-fixtures/:name');
  const fileName = fs.readdirSync(IMAGE_FIXTURE_DIR).find((entry) => /\.(png|jpe?g|webp)$/i.test(entry));
  assert.ok(fileName, 'expected at least one image parser fixture');

  const res = makeRes();
  await handler(makeReq({}, { params: { name: fileName } }), res);

  assert.equal(res.statusCode, 200);
  assert.ok(Buffer.isBuffer(res.payload));
  assert.ok(res.payload.length > 0);
  assert.match(res.headers['Content-Type'], /^image\//);
});

test('GET /test-assets/:agentId lists parser image fixtures with official templates', async () => {
  const router = loadRouteWithMocks();
  const handler = findHandler(router, 'get', '/test-assets/:agentId');
  const fileName = fs.readdirSync(IMAGE_FIXTURE_DIR).find((entry) => /\.(png|jpe?g|webp)$/i.test(entry));
  assert.ok(fileName, 'expected at least one image parser fixture');

  mockBaselineStore = [{
    _id: 'parser-baseline-assets',
    fixtureName: fileName,
    expectedText: 'OFFICIAL OUTPUT ONE',
    acceptableOutputs: [{ expectedText: 'OFFICIAL OUTPUT TWO', sourceProvider: 'gemini' }],
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }];

  const res = makeRes();
  await handler(makeReq({}, { params: { agentId: 'escalation-template-parser' } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.assetType, 'image-fixtures');
  assert.equal(res.payload.supportsUpload, true);
  assert.ok(res.payload.stats.imageCount >= 1);
  assert.ok(res.payload.stats.approvedTemplateCount >= 2);

  const asset = res.payload.assets.find((entry) => entry.name === fileName);
  assert.ok(asset, `expected ${fileName} asset`);
  assert.equal(asset.hasApprovedTemplates, true);
  assert.equal(asset.approvedTemplateCount, 2);
  assert.match(asset.url, /^\/api\/pipeline-tests\/image-fixtures\//);
  assert.deepEqual(
    asset.approvedTemplates.map((output) => output.expectedText),
    ['OFFICIAL OUTPUT TWO', 'OFFICIAL OUTPUT ONE']
  );
});

test('GET /test-assets/:agentId mirrors parser approved templates for triage', async () => {
  const router = loadRouteWithMocks();
  const handler = findHandler(router, 'get', '/test-assets/:agentId');
  const fileName = fs.readdirSync(IMAGE_FIXTURE_DIR).find((entry) => /\.(png|jpe?g|webp)$/i.test(entry));
  assert.ok(fileName, 'expected at least one image parser fixture');

  mockBaselineStore = [{
    _id: 'parser-baseline-triage-assets',
    fixtureName: fileName,
    expectedText: 'TRIAGE CANONICAL OUTPUT ONE',
    acceptableOutputs: [{ expectedText: 'TRIAGE CANONICAL OUTPUT TWO', sourceProvider: 'openai' }],
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  }];

  const res = makeRes();
  await handler(makeReq({}, { params: { agentId: 'triage-agent' } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.assetType, 'approved-parser-templates');
  assert.equal(res.payload.supportsUpload, false);
  assert.equal(res.payload.sourceAgentId, 'escalation-template-parser');

  const mirrored = res.payload.assets.filter((entry) => entry.sourceFixtureName === fileName);
  assert.equal(mirrored.length, 2);
  assert.deepEqual(
    mirrored.map((entry) => entry.expectedText),
    ['TRIAGE CANONICAL OUTPUT TWO', 'TRIAGE CANONICAL OUTPUT ONE']
  );
  assert.ok(mirrored.every((entry) => entry.imageUrl.includes('/api/pipeline-tests/image-fixtures/')));
});

test('POST /image-fixtures saves uploaded parser image assets', async () => {
  const router = loadRouteWithMocks();
  const handler = findHandler(router, 'post', '/image-fixtures');
  const fileName = `codex-upload-test-${Date.now()}.png`;
  const filePath = path.join(IMAGE_FIXTURE_DIR, fileName);
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  try {
    const res = makeRes();
    await handler(makeReq({ fileName, dataUrl }), res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.fixture.name, fileName);
    assert.equal(res.payload.fixture.mimeType, 'image/png');
    assert.equal(res.payload.fixture.randomizedForTests, true);
    assert.equal(fs.existsSync(filePath), true);
  } finally {
    await fsp.unlink(filePath).catch((err) => {
      if (err?.code !== 'ENOENT') throw err;
    });
  }
});

test('POST /parser-results/:id/programmatic-check uses built-in confirmed output and records pass', async () => {
  const router = loadRouteWithMocks();
  const handler = findHandler(router, 'post', '/parser-results/:id/programmatic-check');

  mockBaselineStore = [];
  mockStore = [{
    _id: 'parser-test-seeded',
    fixture: { name: 'IMG_A48EF4ED-74C1-4CFF-B077-E0977FA38187.JPEG' },
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    parsedText: confirmedA48Output(),
    status: 'pending-review',
    createdAt: new Date(),
    updatedAt: new Date(),
  }];

  const res = makeRes();
  await handler(makeReq({}, { params: { id: 'parser-test-seeded' } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.passed, true);
  assert.equal(res.payload.status, 'pass');
  assert.equal(res.payload.baseline.source, 'built-in-seed');
  assert.equal(res.payload.comparison.summary.failedCharacters, 0);
  assert.equal(mockStore[0].status, 'pass');
  assert.equal(mockStore[0].exactMatchPassed, true);
});

test('GET /parser-results annotates whether a confirmed output exists', async () => {
  const router = loadRouteWithMocks();
  const handler = findHandler(router, 'get', '/parser-results');

  mockBaselineStore = [];
  mockStore = [
    {
      _id: 'parser-test-built-in',
      fixture: { name: 'IMG_A48EF4ED-74C1-4CFF-B077-E0977FA38187.JPEG' },
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      parsedText: confirmedA48Output(),
      status: 'pending-review',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      _id: 'parser-test-needs-review',
      fixture: { name: 'CUSTOM-NEEDS-REVIEW.JPEG' },
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      parsedText: 'COID/MID: 123',
      status: 'pending-review',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const res = makeRes();
  await handler(makeReq({}, { query: { limit: '10' } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.results[0].hasConfirmedOutput, true);
  assert.equal(res.payload.results[0].confirmedOutputSource, 'built-in-seed');
  assert.equal(res.payload.results[1].hasConfirmedOutput, false);
});

test('POST /parser-results/:id/confirmed-output saves a fixture baseline used by future checks', async () => {
  const router = loadRouteWithMocks();
  const saveHandler = findHandler(router, 'post', '/parser-results/:id/confirmed-output');
  const checkHandler = findHandler(router, 'post', '/parser-results/:id/programmatic-check');

  mockBaselineStore = [];
  mockStore = [{
    _id: 'parser-test-source',
    fixture: { name: 'CUSTOM-FIXTURE.JPEG' },
    provider: 'openai',
    model: 'gpt-test',
    promptId: 'escalation-template-parser',
    parsedText: 'LINE ONE\nLINE TWO',
    status: 'pending-review',
    createdAt: new Date(),
    updatedAt: new Date(),
  }];

  const saveRes = makeRes();
  await saveHandler(makeReq({}, { params: { id: 'parser-test-source' } }), saveRes);

  assert.equal(saveRes.statusCode, 200);
  assert.equal(saveRes.payload.ok, true);
  assert.equal(saveRes.payload.baseline.fixtureName, 'CUSTOM-FIXTURE.JPEG');
  assert.equal(saveRes.payload.baseline.expectedText, 'LINE ONE\nLINE TWO');

  mockStore.push({
    _id: 'parser-test-next',
    fixture: { name: 'CUSTOM-FIXTURE.JPEG' },
    provider: 'openai',
    model: 'gpt-test',
    parsedText: 'LINE ONE\nLINE TOO',
    status: 'pending-review',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const checkRes = makeRes();
  await checkHandler(makeReq({}, { params: { id: 'parser-test-next' } }), checkRes);

  assert.equal(checkRes.statusCode, 200);
  assert.equal(checkRes.payload.ok, true);
  assert.equal(checkRes.payload.passed, false);
  assert.equal(checkRes.payload.status, 'fail');
  assert.equal(checkRes.payload.baseline.source, 'saved');
  assert.equal(checkRes.payload.comparison.lines[1].passed, false);
  assert.equal(mockStore[1].status, 'fail');
  assert.equal(mockStore[1].exactMatchPassed, false);
});

test('POST /parser-results/:id/confirmed-output appends multiple acceptable outputs for one fixture', async () => {
  const router = loadRouteWithMocks();
  const saveHandler = findHandler(router, 'post', '/parser-results/:id/confirmed-output');
  const checkHandler = findHandler(router, 'post', '/parser-results/:id/programmatic-check');

  mockBaselineStore = [];
  mockStore = [
    {
      _id: 'parser-test-source-one',
      fixture: { name: 'MULTI-FIXTURE.JPEG' },
      provider: 'openai',
      model: 'gpt-test',
      promptId: 'escalation-template-parser',
      parsedText: 'OFFICIAL OUTPUT ONE',
      status: 'pending-review',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      _id: 'parser-test-source-two',
      fixture: { name: 'MULTI-FIXTURE.JPEG' },
      provider: 'codex',
      model: 'gpt-5.5',
      promptId: 'escalation-template-parser',
      parsedText: 'OFFICIAL OUTPUT TWO',
      status: 'pending-review',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const firstSave = makeRes();
  await saveHandler(makeReq({}, { params: { id: 'parser-test-source-one' } }), firstSave);
  assert.equal(firstSave.statusCode, 200);
  assert.equal(firstSave.payload.outputCount, 1);

  const secondSave = makeRes();
  await saveHandler(makeReq({}, { params: { id: 'parser-test-source-two' } }), secondSave);
  assert.equal(secondSave.statusCode, 200);
  assert.equal(secondSave.payload.outputCount, 2);
  assert.deepEqual(
    secondSave.payload.baseline.outputs.map((output) => output.expectedText),
    ['OFFICIAL OUTPUT ONE', 'OFFICIAL OUTPUT TWO']
  );

  mockStore.push({
    _id: 'parser-test-match-two',
    fixture: { name: 'MULTI-FIXTURE.JPEG' },
    provider: 'codex',
    model: 'gpt-5.5',
    parsedText: 'OFFICIAL OUTPUT TWO',
    status: 'pending-review',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const checkRes = makeRes();
  await checkHandler(makeReq({}, { params: { id: 'parser-test-match-two' } }), checkRes);

  assert.equal(checkRes.statusCode, 200);
  assert.equal(checkRes.payload.ok, true);
  assert.equal(checkRes.payload.passed, true);
  assert.equal(checkRes.payload.status, 'pass');
  assert.equal(checkRes.payload.baseline.outputCount, 2);
  assert.equal(checkRes.payload.baseline.outputIndex, 1);
  assert.equal(checkRes.payload.checks.length, 2);
  assert.equal(checkRes.payload.checks[0].passed, false);
  assert.equal(checkRes.payload.checks[1].passed, true);
  assert.equal(mockStore[2].status, 'pass');
  assert.equal(mockStore[2].exactMatchPassed, true);
  assert.equal(mockStore[2].exactMatchSummary.checkedOutputCount, 2);
});

test('POST /parser-results/:id/programmatic-check defers failed result when manual review is requested', async () => {
  const router = loadRouteWithMocks();
  const saveHandler = findHandler(router, 'post', '/parser-results/:id/confirmed-output');
  const checkHandler = findHandler(router, 'post', '/parser-results/:id/programmatic-check');

  mockBaselineStore = [];
  mockStore = [
    {
      _id: 'parser-test-official',
      fixture: { name: 'MANUAL-FIXTURE.JPEG' },
      provider: 'openai',
      model: 'gpt-test',
      promptId: 'escalation-template-parser',
      parsedText: 'EXPECTED OFFICIAL TEXT',
      status: 'pending-review',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      _id: 'parser-test-manual-review',
      fixture: { name: 'MANUAL-FIXTURE.JPEG' },
      provider: 'codex',
      model: 'gpt-5.5',
      parsedText: 'DIFFERENT ACTUAL TEXT',
      status: 'pending-review',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const saveRes = makeRes();
  await saveHandler(makeReq({}, { params: { id: 'parser-test-official' } }), saveRes);
  assert.equal(saveRes.statusCode, 200);

  const checkRes = makeRes();
  await checkHandler(makeReq({
    manualReviewAfterCheck: true,
  }, { params: { id: 'parser-test-manual-review' } }), checkRes);

  assert.equal(checkRes.statusCode, 200);
  assert.equal(checkRes.payload.ok, true);
  assert.equal(checkRes.payload.passed, false);
  assert.equal(checkRes.payload.programmaticStatus, 'fail');
  assert.equal(checkRes.payload.status, 'pending-review');
  assert.equal(checkRes.payload.requiresManualReview, true);
  assert.equal(mockStore[1].status, 'pending-review');
  assert.equal(mockStore[1].exactMatchPassed, false);
  assert.equal(mockStore[1].reviewedAt, undefined);
  assert.match(mockStore[1].operatorNote, /manual review is required/i);
});

test('DELETE /parser-results/:id removes one saved parser test result', async () => {
  const router = loadRouteWithMocks();
  const handler = findHandler(router, 'delete', '/parser-results/:id');

  mockStore = [
    {
      _id: 'parser-test-delete',
      fixture: { name: 'DELETE-ME.JPEG' },
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      parsedText: 'COID/MID: 123',
      status: 'pending-review',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const res = makeRes();
  await handler(makeReq({}, { params: { id: 'parser-test-delete' } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.deletedId, 'parser-test-delete');
  assert.equal(mockStore.length, 0);
});

test('POST /run parser aborts in-flight parser call when client closes', async () => {
  const router = loadRouteWithMocks();
  const handler = findHandler(router, 'post', '/run');
  let startParse;
  let observedAbort = false;
  const parseStarted = new Promise((resolve) => { startParse = resolve; });

  mockStore = [];
  mockParseImage = async (_image, options = {}) => {
    assert.ok(options.signal, 'parseImage should receive an AbortSignal');
    startParse();
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        observedAbort = true;
        const err = new Error('Parser test aborted');
        err.name = 'AbortError';
        err.code = 'ABORT_ERR';
        err.statusCode = 499;
        reject(err);
      }, { once: true });
    });
  };

  try {
    const res = makeRes();
    const running = handler(makeReq(parserBody()), res);
    await parseStarted;
    res.emit('close');
    await running;

    assert.equal(observedAbort, true);

    mockParseImage = async () => parserResult();
    const secondRes = makeRes();
    await handler(makeReq(parserBody()), secondRes);
    assert.equal(secondRes.statusCode, 200);
    assert.equal(secondRes.payload.ok, true);
    assert.notEqual(secondRes.payload.code, 'IMAGE_PARSER_TEST_ALREADY_RUNNING');
  } finally {
    mockParseImage = null;
  }
});
