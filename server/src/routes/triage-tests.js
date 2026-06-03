'use strict';

const express = require('express');
const { randomUUID } = require('node:crypto');
const { getAgentHealthSnapshot } = require('../services/agent-health-service');
const { runTriage } = require('../services/triage');
const { getProviderModelId, getProviderShortLabel } = require('../services/providers/catalog');
const { createStageEventBus } = require('../lib/stage-events');
const { parseEscalationText } = require('../lib/escalation-parser');
// The triage agent test runs ONLY on real, operator-approved escalation parser
// outputs — never synthetic fixtures. Those approved cases are projected from
// the parser baseline store; this route consumes them through the shared lib
// (case shape + random pick) and the parser route's asset pipeline (the SAME
// list the "triage use cases" view shows).
const {
  listApprovedTriageCases,
  getApprovedTriageCaseById,
  chooseRandomCase,
} = require('../lib/approved-triage-cases');
const pipelineTestsRouter = require('./pipeline-tests');
const TriageTestResult = require('../models/TriageTestResult');

const router = express.Router();

const TEST_TIMEOUT_MS = 150_000;
const TRIAGE_AGENT_ID = 'triage-agent';
// Single-flight guard. Operator can only have one triage test in motion at a
// time; concurrent runs would scribble over each other's SSE bus and confuse
// the dashboard.
let triageTestInFlight = false;

// ---------------------------------------------------------------------------
// Generic request helpers. The escalation-parser-baseline resolution and the
// approved-case shape live in ../lib/approved-triage-cases (shared with the
// parser route) — only the small per-request utilities are local here.
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

// ---------------------------------------------------------------------------
// Approved-case loader. The triage test input comes from REAL parser outputs an
// operator has approved — the exact same list surfaced as "triage use cases".
// We reuse the parser route's asset pipeline (one owner for "list image
// fixtures + resolve their approved templates") and the shared lib's case shape.
// No synthetic fixtures, no disk JSON.
// ---------------------------------------------------------------------------
function loadTriageTemplateAssets() {
  if (typeof pipelineTestsRouter.listTriageTemplateAssets !== 'function') {
    throw new Error('Parser route did not expose listTriageTemplateAssets.');
  }
  return pipelineTestsRouter.listTriageTemplateAssets();
}

async function listApprovedCases() {
  return listApprovedTriageCases(loadTriageTemplateAssets);
}

async function getApprovedCaseById(id) {
  return getApprovedTriageCaseById(loadTriageTemplateAssets, id);
}

// Build the TriageTestResult.fixture object for an approved case. The `name`
// MUST be the stable case id (`${sourceFixtureName}#${outputIndex}`) so the
// stats aggregation groups every run of the same approved case together; if it
// drifted, historical grouping by fixture.name would shatter.
function fixtureFromApprovedCase(triageCase, selectionMode) {
  return {
    name: triageCase.id,
    label: triageCase.label,
    sourceFixtureName: triageCase.sourceFixtureName,
    outputIndex: triageCase.outputIndex,
    kind: 'approved-parser-template',
    source: triageCase.source || 'approved-parser-output',
    selectionMode,
    sourceProvider: triageCase.provider,
    sourceModel: triageCase.model,
    confirmedBy: triageCase.confirmedBy,
    approvedAt: triageCase.approvedAt,
    sourceImageUrl: triageCase.sourceImageUrl,
    thumbnailUrl: triageCase.thumbnailUrl,
  };
}

// Resolve which approved case a /run request should execute. `{ caseId }` picks
// that specific case; no/empty caseId picks one at random from the real pool.
// Returns { fixture, payload } mirroring the old loader shape, or a structured
// error object the caller maps to a response.
async function resolveRunCase(body = {}) {
  const requestedId = safeString(body.caseId, '').trim();
  if (requestedId) {
    const triageCase = await getApprovedCaseById(requestedId);
    if (!triageCase) {
      return {
        error: {
          statusCode: 404,
          code: 'APPROVED_CASE_NOT_FOUND',
          error: `No approved triage case found for id "${requestedId}". It may have been un-approved.`,
        },
      };
    }
    return {
      fixture: fixtureFromApprovedCase(triageCase, 'specific'),
      payload: { parserText: triageCase.parserText },
      caseCount: undefined,
    };
  }

  const cases = await listApprovedCases();
  if (!cases.length) {
    return {
      error: {
        statusCode: 409,
        code: 'NO_APPROVED_CASES',
        error: 'No approved escalation cases are available yet. Approve a parser output to add one.',
      },
    };
  }
  const picked = chooseRandomCase(cases);
  return {
    fixture: fixtureFromApprovedCase(picked, 'random'),
    payload: { parserText: picked.parserText },
    caseCount: cases.length,
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
  const publicResult = { ...result };
  delete publicResult.parseFields;
  return {
    ...publicResult,
    id: String(publicResult._id || publicResult.id || ''),
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

// GET /cases — the real, operator-approved escalation cases the triage test can
// run against. Powers the operator's pick-a-case list, "Run all", and the
// random pool. Returns a short label/preview per case (no full parserText).
router.get('/cases', async (req, res) => {
  if (typeof req.setResponseTimeout === 'function') {
    req.setResponseTimeout(30_000);
  }
  let cases;
  try {
    cases = await listApprovedCases();
  } catch (err) {
    return res.status(err?.statusCode || 500).json({
      ok: false,
      code: err?.code || 'TRIAGE_CASES_FAILED',
      error: err?.message || 'Failed to load approved triage cases.',
    });
  }
  return res.json({
    ok: true,
    cases: cases.map((entry) => ({
      id: entry.id,
      sourceFixtureName: entry.sourceFixtureName,
      outputIndex: entry.outputIndex,
      label: entry.label,
      provider: entry.provider,
      model: entry.model,
      confirmedBy: entry.confirmedBy,
      approvedAt: entry.approvedAt,
      thumbnailUrl: entry.thumbnailUrl,
      sourceImageUrl: entry.sourceImageUrl,
    })),
    stats: {
      caseCount: cases.length,
      sourceImageCount: new Set(cases.map((entry) => entry.sourceFixtureName).filter(Boolean)).size,
    },
  });
});

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

  // Resolve the approved case to run BEFORE we mark the in-flight flag — a
  // missing case or empty pool should yield a clean error, not a stuck flag.
  // `{ caseId }` runs that specific approved case; no/empty caseId runs one at
  // random from the real approved pool.
  let fixturePayload;
  try {
    fixturePayload = await resolveRunCase(req.body);
  } catch (err) {
    return respondRun(500, {
      ok: false,
      code: 'TRIAGE_CASE_READ_FAILED',
      error: err.message || 'Failed to load approved triage cases.',
    });
  }
  if (fixturePayload.error) {
    return respondRun(fixturePayload.error.statusCode || 409, {
      ok: false,
      code: fixturePayload.error.code,
      error: fixturePayload.error.error,
      stage: 'triage',
    });
  }

  const runtime = getAgentRuntime(runtimeMap, TRIAGE_AGENT_ID);
  const provider = safeString(runtime.provider, '') || 'lm-studio';
  const model = safeString(runtime.model, '');
  const reasoningEffort = safeString(runtime.reasoningEffort, '') || 'high';

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
    const result = await runTriage(fixturePayload.payload.parserText, {
      provider,
      model,
      reasoningEffort,
      timeoutMs: TEST_TIMEOUT_MS,
      eventBus: bus,
    });
    const context = {
      triageCard: result.card || null,
      triageMeta: result.triageMeta || null,
    };
    const policy = {
      mode: 'single',
      primaryProvider: result.providerUsed || provider,
      primaryModel: result.modelUsed || model,
      reasoningEffort,
    };
    const elapsedMs = Date.now() - startedAt;
    const derivedParseFields = parseEscalationText(fixturePayload.payload.parserText);
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
      parseFields: derivedParseFields,
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
// Exported for tests that want to drive the approved-case loader directly
// without a route round-trip.
module.exports.__internals = {
  listApprovedCases,
  getApprovedCaseById,
  resolveRunCase,
  loadTriageTemplateAssets,
};
