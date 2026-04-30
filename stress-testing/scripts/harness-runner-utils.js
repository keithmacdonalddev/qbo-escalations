'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('node:util');

const { loadServerEnv, applyHarnessEnv, assertSafeMongoUri } = require('./harness-env');
const { installDefaultProviderStubs } = require('./harness-provider-stubs');
const { installDefaultConnectedServiceStubs } = require('./harness-service-stubs');
const { evaluateReportBaseline } = require('./report-baselines');
const { clearProviderStubs } = require('../../server/src/lib/harness-provider-gate');
const { clearServiceStubs } = require('../../server/src/lib/harness-service-gate');
const AiTrace = require('../../server/src/models/AiTrace');
const UsageLog = require('../../server/src/models/UsageLog');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const REPORTS_DIR = path.join(ROOT_DIR, 'stress-testing', 'reports');
const DEFAULT_HTTP_TIMEOUT_MS = 120_000;
const TERMINAL_SSE_EVENTS = new Set([
  'done',
  'error',
  'room_done',
  'agent_error',
]);

function getServerRuntime() {
  return require('../../server/src/index');
}

function toIsoCompact(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function sanitizeFileSegment(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'run';
}

function createSeed(sliceId) {
  return `${sanitizeFileSegment(sliceId)}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil(fn, {
  timeoutMs = 10_000,
  intervalMs = 250,
  description = 'condition',
} = {}) {
  const startedAt = Date.now();
  let lastValue = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await fn();
    if (lastValue) return lastValue;
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${description} after ${timeoutMs}ms`);
}

function resetHarnessStubs() {
  clearProviderStubs();
  clearServiceStubs();
  installDefaultProviderStubs();
  installDefaultConnectedServiceStubs();
}

function prepareHarnessEnvironment() {
  loadServerEnv(process.env);
  applyHarnessEnv(process.env);
  assertSafeMongoUri(process.env);
}

async function startHarnessServer() {
  prepareHarnessEnvironment();
  resetHarnessStubs();

  const { start, shutdown } = getServerRuntime();
  const started = await start({
    host: '127.0.0.1',
    port: 0,
    exitProcess: false,
    installSignalHandlers: false,
  });

  return {
    host: started.host,
    port: started.port,
    baseUrl: `http://${started.host}:${started.port}`,
    startupControls: started.startupControls,
    async stop() {
      await shutdown('slice-runner', { exitCode: 0 });
    },
  };
}

function withTimeoutSignal(timeoutMs = DEFAULT_HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
    },
  };
}

function appendQuery(url, query) {
  if (!query || typeof query !== 'object') return url;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function rawRequest(baseUrl, requestPath, {
  method = 'GET',
  json,
  body,
  headers = {},
  query,
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
} = {}) {
  const url = appendQuery(new URL(requestPath, baseUrl), query);
  const timeout = withTimeoutSignal(timeoutMs);
  const requestHeaders = { ...headers };
  const options = {
    method,
    headers: requestHeaders,
    signal: timeout.signal,
  };

  if (json !== undefined) {
    requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';
    options.body = JSON.stringify(json);
  } else if (body !== undefined) {
    options.body = body;
  }

  try {
    return await fetch(url, options);
  } finally {
    timeout.clear();
  }
}

async function requestJson(baseUrl, requestPath, options = {}) {
  const response = await rawRequest(baseUrl, requestPath, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error(`Failed to parse JSON from ${requestPath}: ${err.message}\nBody: ${text}`);
    }
  }

  if (options.expectStatus !== undefined) {
    assert.equal(response.status, options.expectStatus, `Expected ${requestPath} to return ${options.expectStatus}, got ${response.status}`);
  } else {
    assert.ok(response.ok, `Expected ${requestPath} to return 2xx, got ${response.status}: ${text}`);
  }

  return {
    status: response.status,
    headers: response.headers,
    data,
    text,
  };
}

function createSseParser(onEvent) {
  let buffer = '';
  let eventName = '';
  let dataLines = [];

  function reset() {
    eventName = '';
    dataLines = [];
  }

  function flush() {
    if (!eventName && dataLines.length === 0) return;
    const raw = dataLines.join('\n');
    if (!raw) {
      reset();
      return;
    }

    let payload = raw;
    try {
      payload = JSON.parse(raw);
    } catch {
      // Keep raw text when the event is not JSON.
    }

    onEvent({
      event: eventName || 'message',
      data: payload,
      raw,
    });
    reset();
  }

  function processLine(rawLine) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line) {
      flush();
      return;
    }
    if (line.startsWith(':')) return;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      return;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  return {
    push(chunk) {
      if (!chunk) return;
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) processLine(line);
    },
    finish() {
      if (buffer) processLine(buffer);
      flush();
    },
  };
}

async function requestSse(baseUrl, requestPath, options = {}) {
  const response = await rawRequest(baseUrl, requestPath, options);
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const body = await response.text();
    assert.fail(`Expected ${requestPath} to return 2xx, got ${response.status}: ${body}`);
  }
  assert.match(contentType, /text\/event-stream/i, `Expected ${requestPath} to return an SSE stream`);

  const reader = response.body?.getReader();
  assert.ok(reader, `Expected ${requestPath} SSE response to expose a readable stream`);

  const decoder = new TextDecoder();
  const events = [];
  const parser = createSseParser((event) => {
    events.push(event);
  });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }

  parser.finish();

  return {
    status: response.status,
    headers: response.headers,
    events,
  };
}

function requireEvent(events, eventName) {
  const found = events.find((entry) => entry.event === eventName);
  assert.ok(found, `Expected SSE event "${eventName}" to be present`);
  return found;
}

function requireTerminalEvent(events) {
  const found = events.find((entry) => TERMINAL_SSE_EVENTS.has(entry.event));
  assert.ok(found, 'Expected SSE stream to include a terminal event');
  return found;
}

async function summarizeTraces({ since, service, limit = 5 }) {
  const match = {
    createdAt: { $gte: since },
  };
  if (service) {
    match.service = service;
  }

  const [count, recent] = await Promise.all([
    AiTrace.countDocuments(match),
    AiTrace.find(match)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
  ]);

  return {
    count,
    recent: recent.map((trace) => ({
      id: trace._id.toString(),
      service: trace.service,
      route: trace.route,
      turnKind: trace.turnKind,
      status: trace.status,
      providerUsed: trace.outcome?.providerUsed || '',
      fallbackUsed: Boolean(trace.outcome?.fallbackUsed),
      totalMs: trace.outcome?.totalMs || 0,
      createdAt: trace.createdAt,
      conversationId: trace.conversationId ? trace.conversationId.toString() : null,
      escalationId: trace.escalationId ? trace.escalationId.toString() : null,
    })),
  };
}

async function summarizeUsage({ since, service, limit = 5 }) {
  const match = {
    createdAt: { $gte: since },
  };
  if (service) {
    match.service = service;
  }

  const [count, aggregates, recent] = await Promise.all([
    UsageLog.countDocuments(match),
    UsageLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalTokens: { $sum: '$totalTokens' },
          totalCostMicros: { $sum: '$totalCostMicros' },
        },
      },
    ]),
    UsageLog.find(match)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
  ]);

  const totals = aggregates[0] || { totalTokens: 0, totalCostMicros: 0 };

  return {
    count,
    totalTokens: totals.totalTokens,
    totalCostMicros: totals.totalCostMicros,
    recent: recent.map((entry) => ({
      id: entry._id.toString(),
      service: entry.service,
      provider: entry.provider,
      model: entry.model,
      totalTokens: entry.totalTokens,
      totalCostMicros: entry.totalCostMicros,
      status: entry.status,
      createdAt: entry.createdAt,
      conversationId: entry.conversationId ? entry.conversationId.toString() : null,
      escalationId: entry.escalationId ? entry.escalationId.toString() : null,
    })),
  };
}

function buildSliceReport(sliceId, {
  runId = createSeed(sliceId),
  description = '',
  startedAt = new Date().toISOString(),
  finishedAt = new Date().toISOString(),
  seed = createSeed(sliceId),
  baseUrl = '',
  fixtures = [],
  observability = {},
  notes = [],
  startupControls = null,
} = {}) {
  const ok = fixtures.every((fixture) => fixture.ok !== false);
  return {
    slice: sliceId,
    ok,
    runId,
    description,
    seed,
    startedAt,
    finishedAt,
    baseUrl,
    startupControls,
    fixtures,
    observability,
    notes,
  };
}

function writeReport(sliceId, report) {
  report.baselineComparison = evaluateReportBaseline(sliceId, report);
  if (report.baselineComparison.available && !report.baselineComparison.ok) {
    report.ok = false;
  }

  const dir = path.join(REPORTS_DIR, sliceId);
  fs.mkdirSync(dir, { recursive: true });

  const fileName = `${toIsoCompact(new Date(report.finishedAt || Date.now()))}-${sanitizeFileSegment(report.runId)}.json`;
  const reportPath = path.join(dir, fileName);
  const latestPath = path.join(dir, 'latest.json');
  const serialized = `${JSON.stringify(report, null, 2)}\n`;

  fs.writeFileSync(reportPath, serialized, 'utf8');
  fs.writeFileSync(latestPath, serialized, 'utf8');

  return {
    reportPath,
    latestPath,
  };
}

module.exports = {
  TERMINAL_SSE_EVENTS,
  buildSliceReport,
  createSeed,
  pollUntil,
  prepareHarnessEnvironment,
  requestJson,
  requestSse,
  requireEvent,
  requireTerminalEvent,
  resetHarnessStubs,
  sanitizeFileSegment,
  sleep,
  startHarnessServer,
  summarizeTraces,
  summarizeUsage,
  writeReport,
};
