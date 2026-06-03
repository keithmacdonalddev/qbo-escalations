'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const ROUTE_PATH = require.resolve('../src/routes/triage');
const SERVICE_PATH = require.resolve('../src/services/triage');

let mockRunTriage = null;

function loadRouteWithMocks() {
  delete require.cache[ROUTE_PATH];
  delete require.cache[SERVICE_PATH];
  const realService = require(SERVICE_PATH);
  require.cache[SERVICE_PATH] = {
    id: SERVICE_PATH,
    filename: SERVICE_PATH,
    loaded: true,
    exports: {
      ...realService,
      runTriage: (...args) => {
        if (mockRunTriage) return mockRunTriage(...args);
        return realService.runTriage(...args);
      },
    },
  };
  return require(ROUTE_PATH);
}

function findHandler(routerModule, method, routePath) {
  const layer = routerModule.stack.find((entry) => (
    entry.route && entry.route.path === routePath && entry.route.methods[method]
  ));
  if (!layer) throw new Error(`No ${method.toUpperCase()} ${routePath} route found`);
  const handlers = layer.route.stack.map((stackEntry) => stackEntry.handle);
  return handlers[handlers.length - 1];
}

function makeReq(body = {}, extras = {}) {
  return {
    body,
    query: extras.query || {},
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
    chunks: [],
    ended: false,
    headersSent: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      this.headersSent = true;
      for (const [key, value] of Object.entries(headers || {})) {
        this.headers[key.toLowerCase()] = value;
      }
      return this;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      this.payload = payload;
      this.ended = true;
      return this;
    },
    write(chunk) {
      this.chunks.push(String(chunk));
      return true;
    },
    end() {
      this.ended = true;
    },
  };
}

function parseSseEvents(text) {
  return String(text || '')
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const eventLine = lines.find((line) => line.startsWith('event:'));
      const dataLines = lines.filter((line) => line.startsWith('data:'));
      return {
        event: eventLine ? eventLine.slice(6).trim() : 'message',
        data: dataLines.map((line) => line.slice(5).trimStart()).join('\n'),
      };
    });
}

test.afterEach(() => {
  mockRunTriage = null;
});

test('POST /api/triage JSON returns 200 with a degraded fallback card', async () => {
  const routerModule = loadRouteWithMocks();
  const handler = findHandler(routerModule, 'post', '/');
  let capturedOptions = null;
  mockRunTriage = async (_text, options) => {
    capturedOptions = options;
    options.eventBus.emit('error', { code: 'PROVIDER_UNAVAILABLE', message: 'provider offline' });
    return {
      ok: true,
      status: 'degraded',
      card: {
        severity: 'P3',
        category: 'technical',
        read: 'Fallback read',
        action: 'Fallback action',
        missingInfo: ['Exact error text'],
        confidence: 'low',
        categoryCheck: 'Fallback category',
        fallback: { used: true, reason: 'provider offline' },
      },
      triageMeta: {
        source: 'fallback',
        providerUsed: 'lm-studio',
        model: 'local',
        fallbackUsed: true,
        fallbackReason: 'provider offline',
        failureStage: 'preflight',
        errorCode: 'PROVIDER_UNAVAILABLE',
      },
      providerUsed: 'lm-studio',
      modelUsed: 'local',
      elapsedMs: 12,
      savedResult: { id: 'triage-result-1' },
    };
  };

  const res = makeRes();
  await handler(makeReq({
    text: 'CASE: CS-1',
    provider: 'lm-studio',
    parseFields: { clientContact: 'Should not be forwarded' },
  }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.status, 'degraded');
  assert.equal(res.payload.card.fallback.used, true);
  assert.equal(res.payload.triageMeta.source, 'fallback');
  assert.equal(res.payload.savedResultId, 'triage-result-1');
  assert.equal(Object.prototype.hasOwnProperty.call(capturedOptions, 'parseFields'), false);
});

test('POST /api/triage SSE emits stage_event frames and exactly one triage_complete terminal', async () => {
  const routerModule = loadRouteWithMocks();
  const handler = findHandler(routerModule, 'post', '/');
  mockRunTriage = async (_text, options) => {
    options.eventBus.emit('triage.prompt_resolved', { promptId: 'triage-agent', promptVersion: 'triage-agent-v1' });
    options.eventBus.emit('triage.provider_selected', { provider: 'lm-studio', model: 'local' });
    return {
      ok: true,
      status: 'success',
      card: {
        severity: 'P3',
        category: 'reports',
        read: 'Reports read',
        action: 'Reports action',
        missingInfo: ['Report name'],
        confidence: 'high',
        categoryCheck: 'Reports category',
        fallback: { used: false },
      },
      triageMeta: {
        source: 'agent',
        providerUsed: 'lm-studio',
        model: 'local',
        providerPackageId: 'PKG-1',
        fallbackUsed: false,
      },
      providerUsed: 'lm-studio',
      modelUsed: 'local',
      elapsedMs: 34,
      savedResult: { id: 'triage-result-2' },
    };
  };

  const res = makeRes();
  await handler(makeReq(
    { text: 'CASE: CS-1', provider: 'lm-studio' },
    { headers: { accept: 'text/event-stream' } }
  ), res);

  const events = parseSseEvents(res.chunks.join(''));
  assert.ok(events.some((event) => event.event === 'stage_event' && event.data.includes('triage.server_request_received')));
  assert.ok(events.some((event) => event.event === 'stage_event' && event.data.includes('triage.prompt_resolved')));
  assert.ok(events.some((event) => event.event === 'stage_event' && event.data.includes('triage.response_sent')));
  assert.equal(events.filter((event) => event.event === 'triage_complete').length, 1);
  const terminal = JSON.parse(events.find((event) => event.event === 'triage_complete').data);
  assert.equal(terminal.ok, true);
  assert.equal(terminal.triageCard.category, 'reports');
});

test('POST /api/triage missing text returns hard error with fallbackCard', async () => {
  const routerModule = loadRouteWithMocks();
  const handler = findHandler(routerModule, 'post', '/');

  const res = makeRes();
  await handler(makeReq({ text: '' }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.ok, false);
  assert.equal(res.payload.code, 'MISSING_TEXT');
  assert.ok(res.payload.fallbackCard);
});
