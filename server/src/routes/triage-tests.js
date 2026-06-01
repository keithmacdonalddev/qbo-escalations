'use strict';

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('node:crypto');
const { getAgentHealthSnapshot } = require('../services/agent-health-service');
const { runTriageAgent } = require('../services/chat-request-service');
const {
  resolvePolicy,
} = require('../services/chat-orchestrator');
const {
  getAlternateProvider,
  getDefaultProvider,
  normalizeProvider,
} = require('../services/providers/registry');
const { getProviderModelId, getProviderShortLabel } = require('../services/providers/catalog');
const { createStageEventBus } = require('../lib/stage-events');
const TriageTestResult = require('../models/TriageTestResult');

const router = express.Router();

const FIXTURE_DIR = path.resolve(__dirname, '..', '..', 'fixtures', 'pipeline-tests', 'triage');
const TEST_TIMEOUT_MS = 150_000;
const TRIAGE_AGENT_ID = 'triage-agent';
// Single-flight guard. Operator can only have one triage test in motion at a
// time; concurrent runs would scribble over each other's SSE bus and confuse
// the dashboard.
let triageTestInFlight = false;

// ---------------------------------------------------------------------------
// Shared helpers copied from routes/pipeline-tests.js so the new route stays
// self-contained. Per the plan, we intentionally do NOT extract a shared
// module for these — the duplication keeps each test route file independent
// and easy to read.
// ---------------------------------------------------------------------------
function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clientWantsSse(req) {
  const accept = safeString(req.headers?.accept, '').toLowerCase();
  if (accept.includes('text/event-stream')) return true;
  const streamQ = safeString(req.query?.stream, '').toLowerCase();
  return streamQ === '1' || streamQ === 'true' || streamQ === 'yes';
}

function readRuntimeMap(body = {}) {
  return isPlainObject(body.runtime) ? body.runtime : {};
}

function getAgentRuntime(runtimeMap, agentId) {
  const source = runtimeMap[agentId] || {};
  return isPlainObject(source) ? source : {};
}

function getChatRuntime(runtimeMap) {
  return getAgentRuntime(runtimeMap, 'chat');
}

function buildFallbackPolicy(runtimeMap) {
  const chat = getChatRuntime(runtimeMap);
  const provider = normalizeProvider(chat.provider || getDefaultProvider());
  return resolvePolicy({
    mode: chat.mode || 'single',
    primaryProvider: provider,
    primaryModel: safeString(chat.model, ''),
    fallbackProvider: chat.fallbackProvider || getAlternateProvider(provider),
    fallbackModel: safeString(chat.fallbackModel, ''),
  });
}

function getReasoningEffort(runtimeMap) {
  return safeString(getChatRuntime(runtimeMap).reasoningEffort, 'high') || 'high';
}

function buildAgentRuntimeMap(runtimeMap, agentId, runtime) {
  return {
    ...runtimeMap,
    [agentId]: {
      ...(isPlainObject(runtime) ? runtime : {}),
      configured: runtime?.configured !== false && Boolean(runtime?.provider),
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture loader. Reads every *.json file in the triage fixture folder at
// request time (no caching) so adding a new fixture does not require a
// server restart. Malformed JSON files are skipped with a warning, never
// crash the request — operators may be mid-edit on a new fixture.
// ---------------------------------------------------------------------------
async function listTriageFixtures(dir = FIXTURE_DIR) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  const fixtures = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (path.extname(entry.name).toLowerCase() !== '.json') continue;
    const filePath = path.join(dir, entry.name);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const payload = JSON.parse(raw);
      if (!isPlainObject(payload)) {
        console.warn(`[triage-tests] Skipped fixture ${entry.name}: not a JSON object.`);
        continue;
      }
      const name = safeString(payload.name, '').trim() || path.basename(entry.name, '.json');
      const description = safeString(payload.description, '');
      const tags = Array.isArray(payload.tags) ? payload.tags.map((tag) => safeString(tag)).filter(Boolean) : [];
      const schemaVersion = safeNumber(payload.schemaVersion, 1);
      const parserText = safeString(payload.parserText, '');
      const parseFields = isPlainObject(payload.parseFields) ? payload.parseFields : {};
      if (!parserText && Object.keys(parseFields).length === 0) {
        console.warn(`[triage-tests] Skipped fixture ${entry.name}: parserText and parseFields are both empty.`);
        continue;
      }
      fixtures.push({
        name,
        description,
        tags,
        schemaVersion,
        parserText,
        parseFields,
        fileName: entry.name,
      });
    } catch (err) {
      console.warn(`[triage-tests] Skipped fixture ${entry.name}: ${err.message}`);
    }
  }
  return fixtures.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

function chooseRandomFixture(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) return null;
  return fixtures[Math.floor(Math.random() * fixtures.length)];
}

// readRandomTriageFixture is split out so tests can swap the directory and
// call the loader with a tmp folder.
async function readRandomTriageFixture(dir = FIXTURE_DIR) {
  const fixtures = await listTriageFixtures(dir);
  if (!fixtures.length) return { fixture: null, fixtureCount: 0 };
  const picked = chooseRandomFixture(fixtures);
  return {
    fixture: {
      name: picked.name,
      description: picked.description,
      tags: picked.tags,
      schemaVersion: picked.schemaVersion,
      fileName: picked.fileName,
      fixtureCount: fixtures.length,
    },
    payload: { parserText: picked.parserText, parseFields: picked.parseFields },
    fixtureCount: fixtures.length,
  };
}

// ---------------------------------------------------------------------------
// Persistence + serialization.
// ---------------------------------------------------------------------------
function dbAvailable() {
  return Boolean(TriageTestResult.db && TriageTestResult.db.readyState === 1);
}

function pickCardSource(card) {
  if (!card || typeof card !== 'object') return '';
  const explicit = safeString(card.source, '').trim();
  if (explicit) return explicit;
  const generationSource = safeString(card.generation?.source, '').trim();
  if (generationSource) return generationSource;
  return '';
}

async function createTriageTestResultRecord({
  fixture,
  runtime,
  provider,
  context,
  policy,
  elapsedMs,
  parserText,
  parseFields,
}) {
  if (!dbAvailable()) return null;
  const triageCard = context?.triageCard || null;
  const triageMeta = context?.triageMeta || null;
  const fallbackInfo = triageCard?.fallback || {};
  const model = safeString(triageMeta?.model || policy?.primaryModel || '', '')
    || getProviderModelId(provider)
    || '';
  try {
    return await TriageTestResult.create({
      fixture,
      provider,
      providerLabel: provider ? getProviderShortLabel(provider) : '',
      model,
      modelRequested: safeString(runtime?.model, ''),
      reasoningEffort: safeString(runtime?.reasoningEffort, '') || safeString(policy?.reasoningEffort, ''),
      runtime,
      elapsedMs: safeNumber(elapsedMs, 0),
      status: 'pending-review',
      severity: safeString(triageCard?.severity, ''),
      category: safeString(triageCard?.category, ''),
      confidence: safeString(triageCard?.confidence, ''),
      read: safeString(triageCard?.read, ''),
      action: safeString(triageCard?.action, ''),
      missingInfo: Array.isArray(triageCard?.missingInfo)
        ? triageCard.missingInfo.map((value) => safeString(value)).filter(Boolean)
        : [],
      categoryCheck: triageCard?.categoryCheck ?? null,
      fallbackUsed: Boolean(fallbackInfo.used),
      fallbackReason: safeString(fallbackInfo.reason, ''),
      cardSource: pickCardSource(triageCard),
      triageCard,
      triageMeta,
      parserText: safeString(parserText, ''),
      parseFields: isPlainObject(parseFields) ? parseFields : {},
      providerPackageId: safeString(triageMeta?.providerPackageId, ''),
    });
  } catch (err) {
    console.warn('[triage-tests] Failed to save triage test result:', err.message);
    return null;
  }
}

function serializeTriageTestResult(doc) {
  if (!doc) return null;
  const result = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    ...result,
    id: String(result._id || result.id || ''),
  };
}

function buildEmptyTriageTestStats() {
  return {
    total: 0,
    pass: 0,
    fail: 0,
    pending: 0,
    passRate: 0,
    avgElapsedMs: 0,
    byProvider: [],
    byModel: [],
    byFixture: [],
  };
}

async function buildTriageTestStats() {
  const [overallAgg, byProvider, byModel, byFixture] = await Promise.all([
    TriageTestResult.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pass: { $sum: { $cond: [{ $eq: ['$status', 'pass'] }, 1, 0] } },
          fail: { $sum: { $cond: [{ $eq: ['$status', 'fail'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending-review'] }, 1, 0] } },
          avgElapsedMs: { $avg: '$elapsedMs' },
        },
      },
    ]),
    TriageTestResult.aggregate([
      {
        $group: {
          _id: '$provider',
          total: { $sum: 1 },
          pass: { $sum: { $cond: [{ $eq: ['$status', 'pass'] }, 1, 0] } },
          fail: { $sum: { $cond: [{ $eq: ['$status', 'fail'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending-review'] }, 1, 0] } },
          avgElapsedMs: { $avg: '$elapsedMs' },
        },
      },
      { $sort: { total: -1 } },
      { $limit: 20 },
    ]),
    TriageTestResult.aggregate([
      {
        $group: {
          _id: { provider: '$provider', model: '$model' },
          total: { $sum: 1 },
          pass: { $sum: { $cond: [{ $eq: ['$status', 'pass'] }, 1, 0] } },
          fail: { $sum: { $cond: [{ $eq: ['$status', 'fail'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending-review'] }, 1, 0] } },
          avgElapsedMs: { $avg: '$elapsedMs' },
        },
      },
      { $sort: { total: -1 } },
      { $limit: 30 },
    ]),
    TriageTestResult.aggregate([
      {
        $group: {
          _id: '$fixture.name',
          fixture: { $first: '$fixture' },
          total: { $sum: 1 },
          pass: { $sum: { $cond: [{ $eq: ['$status', 'pass'] }, 1, 0] } },
          fail: { $sum: { $cond: [{ $eq: ['$status', 'fail'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending-review'] }, 1, 0] } },
          avgElapsedMs: { $avg: '$elapsedMs' },
        },
      },
      { $sort: { fail: -1, total: -1 } },
      { $limit: 30 },
    ]),
  ]);

  const overall = overallAgg[0] || buildEmptyTriageTestStats();
  const passRate = overall.pass + overall.fail > 0 ? overall.pass / (overall.pass + overall.fail) : 0;
  const normalize = (entry) => ({
    ...entry,
    id: typeof entry._id === 'object' ? undefined : entry._id,
    provider: entry._id?.provider || entry.provider || entry._id || '',
    model: entry._id?.model || entry.model || '',
    passRate: entry.pass + entry.fail > 0 ? Math.round((entry.pass / (entry.pass + entry.fail)) * 10000) / 10000 : 0,
    avgElapsedMs: Math.round(entry.avgElapsedMs || 0),
  });

  return {
    total: overall.total || 0,
    pass: overall.pass || 0,
    fail: overall.fail || 0,
    pending: overall.pending || 0,
    passRate: Math.round(passRate * 10000) / 10000,
    avgElapsedMs: Math.round(overall.avgElapsedMs || 0),
    byProvider: byProvider.map(normalize),
    byModel: byModel.map(normalize),
    byFixture: byFixture.map((entry) => ({
      ...normalize(entry),
      fixtureName: entry._id || '',
      fixture: entry.fixture || null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
router.post('/status', async (req, res) => {
  if (typeof req.setResponseTimeout === 'function') {
    req.setResponseTimeout(60_000);
  }
  const runtimeMap = readRuntimeMap(req.body);
  const snapshot = await getAgentHealthSnapshot({
    agentIds: [TRIAGE_AGENT_ID],
    runtimeOverrides: { [TRIAGE_AGENT_ID]: getAgentRuntime(runtimeMap, TRIAGE_AGENT_ID) },
  });
  const triageHealth = snapshot.agents?.[TRIAGE_AGENT_ID] || {};
  return res.json({
    ok: true,
    checkedAt: snapshot.checkedAt || new Date().toISOString(),
    triage: {
      provider: triageHealth.provider || '',
      providerLabel: triageHealth.providerLabel || '',
      model: triageHealth.model || '',
      status: triageHealth.enabled === false ? 'disabled' : (triageHealth.status || 'unknown'),
      checked: Boolean(triageHealth.checkedAt),
      message: triageHealth.message || 'Health not checked yet.',
      enabled: triageHealth.enabled !== false,
      active: Boolean(triageHealth.active),
      lastCheckedAt: triageHealth.checkedAt || snapshot.checkedAt || new Date().toISOString(),
    },
  });
});

router.get('/results', async (req, res) => {
  if (!dbAvailable()) {
    return res.json({
      ok: true,
      results: [],
      stats: buildEmptyTriageTestStats(),
      dbAvailable: false,
    });
  }

  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const filter = {};
  if (req.query.provider) filter.provider = safeString(req.query.provider);
  if (req.query.model) filter.model = safeString(req.query.model);
  if (req.query.fixture) filter['fixture.name'] = safeString(req.query.fixture);
  if (req.query.status) filter.status = safeString(req.query.status);

  const [results, stats] = await Promise.all([
    TriageTestResult.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
    buildTriageTestStats(),
  ]);

  return res.json({
    ok: true,
    results: results.map(serializeTriageTestResult),
    stats,
    dbAvailable: true,
  });
});

router.patch('/results/:id', async (req, res) => {
  if (!dbAvailable()) {
    return res.status(503).json({ ok: false, code: 'DB_UNAVAILABLE', error: 'Triage test result database is unavailable.' });
  }

  const status = safeString(req.body?.status, '').trim();
  if (!['pass', 'fail', 'pending-review'].includes(status)) {
    return res.status(400).json({ ok: false, code: 'INVALID_STATUS', error: 'Status must be pass, fail, or pending-review.' });
  }

  const update = {
    status,
    reviewedAt: status === 'pending-review' ? null : new Date(),
    reviewer: safeString(req.body?.reviewer, 'operator') || 'operator',
    operatorNote: safeString(req.body?.operatorNote, ''),
  };

  const result = await TriageTestResult.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
  if (!result) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Triage test result not found.' });
  }

  return res.json({ ok: true, result: serializeTriageTestResult(result) });
});

router.post('/run', async (req, res) => {
  const runtimeMap = readRuntimeMap(req.body);
  const streamMode = clientWantsSse(req);

  if (typeof req.setResponseTimeout === 'function') {
    req.setResponseTimeout(TEST_TIMEOUT_MS + 30_000);
  }

  let sseOpen = false;
  function sendSse(eventName, payload) {
    if (!sseOpen) return;
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // Client disconnected.
    }
  }
  function openSse() {
    if (!streamMode || sseOpen || res.headersSent) return;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    sseOpen = true;
  }
  function respondRun(status, body) {
    if (!streamMode) {
      return res.status(status).json(body);
    }
    openSse();
    sendSse(status >= 200 && status < 300 ? 'test_complete' : 'error', body);
    try { res.end(); } catch { /* noop */ }
    return undefined;
  }

  // Disabled-agent guard. The triage agent profile can be turned off from
  // the Agents view; running a test while it's off would mislead the operator.
  const health = await getAgentHealthSnapshot({ agentIds: [TRIAGE_AGENT_ID] });
  const agentHealth = health.agents?.[TRIAGE_AGENT_ID];
  if (agentHealth?.enabled === false || agentHealth?.status === 'disabled') {
    return respondRun(409, {
      ok: false,
      code: 'AGENT_DISABLED',
      error: `${agentHealth.label || 'Triage Agent'} is turned off in its profile.`,
      stage: 'triage',
    });
  }

  if (triageTestInFlight) {
    return respondRun(409, {
      ok: false,
      code: 'TRIAGE_TEST_ALREADY_RUNNING',
      error: 'Triage Agent test is already running. Wait for it to finish before starting another test.',
    });
  }

  // Pick a fixture before we mark the in-flight flag — if there are zero
  // fixtures we want a clean 409, not a stuck flag.
  let fixturePayload;
  try {
    fixturePayload = await readRandomTriageFixture();
  } catch (err) {
    return respondRun(500, {
      ok: false,
      code: 'TRIAGE_FIXTURE_READ_FAILED',
      error: err.message || 'Failed to read triage fixture folder.',
    });
  }
  if (!fixturePayload.fixture) {
    return respondRun(409, {
      ok: false,
      code: 'NO_TRIAGE_FIXTURES',
      error: 'No triage fixtures are available. Add a JSON fixture to server/fixtures/pipeline-tests/triage/.',
    });
  }

  const runtime = getAgentRuntime(runtimeMap, TRIAGE_AGENT_ID);
  const fallbackPolicy = buildFallbackPolicy(runtimeMap);
  const reasoningEffort = getReasoningEffort(runtimeMap);
  const enrichedRuntimeMap = buildAgentRuntimeMap(runtimeMap, TRIAGE_AGENT_ID, runtime);

  triageTestInFlight = true;
  const bus = streamMode
    ? createStageEventBus({ send: sendSse, stageId: 'triage', runId: randomUUID() })
    : null;
  if (streamMode) {
    openSse();
    bus.emit('triage.server_request_received', {
      provider: safeString(runtime.provider, ''),
      model: safeString(runtime.model, ''),
      streamMode: true,
      testRun: true,
      route: '/api/triage-tests/run',
      fixture: fixturePayload.fixture.name,
    });
  }

  const startedAt = Date.now();
  try {
    const { context, policy } = await runTriageAgent({
      runtimeMap: enrichedRuntimeMap,
      fallbackPolicy,
      reasoningEffort,
      parserText: fixturePayload.payload.parserText,
      parseFields: fixturePayload.payload.parseFields,
      timeoutMs: TEST_TIMEOUT_MS,
      eventBus: bus,
    });
    const elapsedMs = Date.now() - startedAt;
    const providerUsed = safeString(context?.triageMeta?.providerUsed || policy?.primaryProvider || '', '');
    const modelUsed = safeString(context?.triageMeta?.model || policy?.primaryModel || '', '')
      || getProviderModelId(providerUsed)
      || '';

    const savedTestResult = await createTriageTestResultRecord({
      fixture: fixturePayload.fixture,
      runtime,
      provider: providerUsed,
      context,
      policy,
      elapsedMs,
      parserText: fixturePayload.payload.parserText,
      parseFields: fixturePayload.payload.parseFields,
    });

    const providerPackageId = safeString(context?.triageMeta?.providerPackageId, '');
    if (providerPackageId) {
      bus?.emit('triage.provider_content_sending_to_client', {
        provider: providerUsed,
        providerPackageId,
        testRun: true,
        status: 'sent',
        surfaceToUser: true,
        displayMessage: `Sending providerPackageId: ${providerPackageId} triage content to client - sent`,
      });
    }
    bus?.emit('triage.response_sent', {
      elapsedMs,
      streamMode,
      testRun: true,
    });

    const responseBody = {
      ok: Boolean(context?.triageCard),
      stage: 'triage',
      testRun: true,
      alert: 'Test result only - not part of the live escalation log.',
      fixture: fixturePayload.fixture,
      savedTestResultId: savedTestResult ? String(savedTestResult._id) : '',
      savedTestResult: serializeTriageTestResult(savedTestResult),
      providerUsed,
      modelUsed,
      elapsedMs,
      triageCard: context?.triageCard || null,
      triageMeta: context?.triageMeta || null,
      parserText: fixturePayload.payload.parserText,
      parseFields: fixturePayload.payload.parseFields,
    };
    return respondRun(200, responseBody);
  } catch (err) {
    bus?.emit('error', {
      code: err.code || 'TRIAGE_TEST_FAILED',
      message: err.message || 'Triage Agent test failed.',
      testRun: true,
    });
    return respondRun(err.statusCode || 422, {
      ok: false,
      stage: 'triage',
      testRun: true,
      code: err.code || 'TRIAGE_TEST_FAILED',
      error: err.message || 'Triage Agent test failed.',
    });
  } finally {
    triageTestInFlight = false;
  }
});

module.exports = router;
// Exported for tests that want to drive the loader directly without a route
// round-trip.
module.exports.__internals = {
  listTriageFixtures,
  readRandomTriageFixture,
  chooseRandomFixture,
};
