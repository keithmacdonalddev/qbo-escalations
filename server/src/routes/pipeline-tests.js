'use strict';

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const { parseImage } = require('../services/image-parser');
const { getAgentHealthSnapshot, refreshAgentHealth } = require('../services/agent-health-service');
const { getRenderedAgentPrompt } = require('../lib/agent-prompt-store');
const {
  buildAgentBackedTriageContext,
  resolveKnownIssueAgentPolicy,
  resolveTriageAgentPolicy,
} = require('../services/chat-request-service');
const {
  knownIssueSearchToInvMatchResult,
  runKnownIssueSearchAgent,
} = require('../services/known-issue-search-agent');
const {
  resolvePolicy,
  startChatOrchestration,
} = require('../services/chat-orchestrator');
const {
  getAlternateProvider,
  getDefaultProvider,
  normalizeProvider,
} = require('../services/providers/registry');
const {
  getCodexProviderIds,
  getProviderModelId,
  getProviderShortLabel,
} = require('../services/providers/catalog');
const ImageParserTestResult = require('../models/ImageParserTestResult');

const router = express.Router();

const FIXTURE_DIR = path.resolve(__dirname, '..', '..', 'fixtures', 'pipeline-tests');
const IMAGE_FIXTURE_DIR = path.join(FIXTURE_DIR, 'image-parser');
const TEMPLATE_SVG_PATH = path.join(FIXTURE_DIR, 'escalation-template.svg');
const CASE_FIXTURE_PATH = path.join(FIXTURE_DIR, 'escalation-case.json');
const TEST_TIMEOUT_MS = 150_000;
let parserTestInFlight = false;
const STAGE_AGENT_IDS = Object.freeze({
  parser: 'escalation-template-parser',
  inv: 'known-issue-search-agent',
  triage: 'triage-agent',
  main: 'chat',
});

const CODEX_IMAGE_PROVIDER_IDS = Object.freeze(getCodexProviderIds());
const CODEX_IMAGE_PROVIDER_LABELS = Object.freeze(
  CODEX_IMAGE_PROVIDER_IDS.reduce((acc, providerId) => {
    acc[providerId] = getProviderShortLabel(providerId);
    return acc;
  }, {})
);
const CODEX_IMAGE_DEFAULT_MODELS = Object.freeze(
  CODEX_IMAGE_PROVIDER_IDS.reduce((acc, providerId) => {
    acc[providerId] = getProviderModelId(providerId) || providerId;
    return acc;
  }, {})
);

const IMAGE_PROVIDER_LABELS = Object.freeze({
  'llm-gateway': 'Gateway',
  'lm-studio': 'LM Studio',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  kimi: 'Kimi',
  gemini: 'Gemini',
  ...CODEX_IMAGE_PROVIDER_LABELS,
});

const IMAGE_DEFAULT_MODELS = Object.freeze({
  'llm-gateway': 'auto',
  'lm-studio': 'local',
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-5.4-mini',
  kimi: 'kimi-k2.5',
  gemini: 'gemini-3-flash-preview',
  ...CODEX_IMAGE_DEFAULT_MODELS,
});

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

function readRuntimeMap(body = {}) {
  return isPlainObject(body.runtime) ? body.runtime : {};
}

function getImageParserRuntime(runtimeMap) {
  const source = runtimeMap.imageParser
    || runtimeMap['image-parser']
    || runtimeMap['escalation-template-parser']
    || {};
  return isPlainObject(source) ? source : {};
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

async function readCaseFixture() {
  const raw = await fs.readFile(CASE_FIXTURE_PATH, 'utf8');
  return JSON.parse(raw);
}

async function readTemplateImageDataUrl() {
  const svg = await fs.readFile(TEMPLATE_SVG_PATH);
  const png = await sharp(svg).png().toBuffer();
  return {
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    fixture: {
      name: path.basename(TEMPLATE_SVG_PATH),
      path: path.relative(FIXTURE_DIR, TEMPLATE_SVG_PATH).replace(/\\/g, '/'),
      mimeType: 'image/png',
      source: 'svg-fallback',
    },
  };
}

const IMAGE_FIXTURE_MIME_TYPES = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
});

async function listImageParserFixtures() {
  let entries = [];
  try {
    entries = await fs.readdir(IMAGE_FIXTURE_DIR, { withFileTypes: true });
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const ext = path.extname(entry.name).toLowerCase();
      const mimeType = IMAGE_FIXTURE_MIME_TYPES[ext];
      if (!mimeType) return null;
      return {
        name: entry.name,
        filePath: path.join(IMAGE_FIXTURE_DIR, entry.name),
        mimeType,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function chooseRandomFixture(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) return null;
  return fixtures[Math.floor(Math.random() * fixtures.length)];
}

function buildImageFixtureUrl(name) {
  const clean = safeString(name, '').trim();
  if (!clean) return '';
  return `/api/pipeline-tests/image-fixtures/${encodeURIComponent(clean)}`;
}

function getParserValidationSummary(parseMeta) {
  const meta = isPlainObject(parseMeta) ? parseMeta : {};
  const canonical = isPlainObject(meta.canonicalTemplate) ? meta.canonicalTemplate : {};
  return {
    canonicalPassed: typeof canonical.passed === 'boolean' ? canonical.passed : null,
    semanticPassed: typeof meta.semanticPassed === 'boolean' ? meta.semanticPassed : null,
    parserIssues: Array.isArray(meta.issues) ? meta.issues.map((issue) => safeString(issue)).filter(Boolean) : [],
    canonicalIssues: Array.isArray(canonical.issues) ? canonical.issues : [],
    fieldsFound: safeNumber(meta.fieldsFound, 0),
  };
}

function parserIssueToText(issue) {
  if (!issue) return '';
  if (typeof issue === 'string') return safeString(issue, '').replace(/\s+/g, ' ').trim();
  if (isPlainObject(issue)) {
    return safeString(issue.message || issue.code || issue.reason || issue.field, '').replace(/\s+/g, ' ').trim();
  }
  return safeString(issue, '').replace(/\s+/g, ' ').trim();
}

function getParserFallbackSummary(result) {
  const parseMeta = isPlainObject(result?.parseMeta) ? result.parseMeta : {};
  if (parseMeta.passed !== false) {
    return {
      fallbackEligible: false,
      fallbackUsed: false,
      fallbackFrom: null,
      fallbackReason: '',
      recoverySurface: 'none',
    };
  }

  const canonical = isPlainObject(parseMeta.canonicalTemplate) ? parseMeta.canonicalTemplate : {};
  const directIssue = Array.isArray(parseMeta.issues)
    ? parseMeta.issues.map(parserIssueToText).find(Boolean)
    : '';
  const canonicalIssue = Array.isArray(canonical.issues)
    ? canonical.issues.map(parserIssueToText).find(Boolean)
    : '';
  return {
    fallbackEligible: true,
    fallbackUsed: false,
    fallbackFrom: 'parse-validation',
    fallbackReason: directIssue || canonicalIssue || 'validation failed',
    recoverySurface: 'pipeline-test-record-only',
  };
}

async function createImageParserTestResultRecord({ imageFixture, runtime, provider, result, elapsedMs }) {
  if (!ImageParserTestResult.db || ImageParserTestResult.db.readyState !== 1) return null;
  const parseMeta = result?.parseMeta || null;
  const validation = getParserValidationSummary(parseMeta);
  const model = safeString(result?.usage?.model || runtime.model, '') || IMAGE_DEFAULT_MODELS[provider] || '';
  const fallbackSummary = getParserFallbackSummary(result);
  try {
    return await ImageParserTestResult.create({
      fixture: imageFixture,
      provider,
      providerLabel: IMAGE_PROVIDER_LABELS[provider] || provider,
      model,
      modelRequested: safeString(runtime.model, ''),
      reasoningEffort: safeString(runtime.reasoningEffort, ''),
      runtime,
      elapsedMs,
      status: 'pending-review',
      ...validation,
      parsedText: safeString(result?.text || result?.sourceText, ''),
      parseFields: isPlainObject(result?.parseFields) ? result.parseFields : {},
      parseMeta,
      usage: result?.usage || null,
      ...fallbackSummary,
    });
  } catch (err) {
    console.warn('[pipeline-tests] Failed to save image parser test result:', err.message);
    return null;
  }
}

function serializeImageParserTestResult(doc) {
  if (!doc) return null;
  const result = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    ...result,
    id: String(result._id || result.id || ''),
  };
}

function buildEmptyParserTestStats() {
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

async function buildParserTestStats() {
  const [overallAgg, byProvider, byModel, byFixture] = await Promise.all([
    ImageParserTestResult.aggregate([
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
    ImageParserTestResult.aggregate([
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
    ImageParserTestResult.aggregate([
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
    ImageParserTestResult.aggregate([
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

  const overall = overallAgg[0] || buildEmptyParserTestStats();
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

async function readRandomImageParserFixtureDataUrl() {
  const fixtures = await listImageParserFixtures();
  const selected = chooseRandomFixture(fixtures);
  if (!selected) return readTemplateImageDataUrl();

  const image = await fs.readFile(selected.filePath);
  return {
    dataUrl: `data:${selected.mimeType};base64,${image.toString('base64')}`,
    fixture: {
      name: selected.name,
      path: path.relative(FIXTURE_DIR, selected.filePath).replace(/\\/g, '/'),
      url: buildImageFixtureUrl(selected.name),
      mimeType: selected.mimeType,
      source: 'image-fixture',
      fixtureCount: fixtures.length,
    },
  };
}

function normalizeImageParserProvider(provider) {
  const clean = safeString(provider, '').trim();
  return Object.prototype.hasOwnProperty.call(IMAGE_PROVIDER_LABELS, clean) ? clean : '';
}

function buildImageRuntimeSummary(runtime, availabilityByProvider = null) {
  const provider = normalizeImageParserProvider(runtime.provider);
  const providerStatus = provider && availabilityByProvider ? availabilityByProvider[provider] : null;
  const configuredModel = safeString(runtime.model, '');
  const model = configuredModel && configuredModel !== 'auto' && configuredModel !== 'local'
    ? configuredModel
    : safeString(providerStatus?.model, '') || configuredModel || IMAGE_DEFAULT_MODELS[provider] || '';
  const available = Boolean(providerStatus?.available);
  const unavailableReason = safeString(providerStatus?.reason || providerStatus?.code, '');

  return {
    provider,
    providerLabel: provider ? (IMAGE_PROVIDER_LABELS[provider] || provider) : 'No provider',
    model,
    status: !provider ? 'disabled' : available ? 'online' : 'offline',
    checked: Boolean(providerStatus),
    message: !provider
      ? 'Image parser provider is not configured.'
      : available
        ? (providerStatus.model ? `Available: ${providerStatus.model}` : 'Image parser provider available.')
        : (unavailableReason || 'Image parser provider unavailable.'),
    lastCheckedAt: new Date().toISOString(),
  };
}

function buildChatRuntimeSummary(runtime, providerHealth = []) {
  const provider = normalizeProvider(runtime.provider || getDefaultProvider());
  const model = safeString(runtime.model, '') || getProviderModelId(provider) || 'auto';
  const health = providerHealth.find((entry) => entry?.provider === provider) || null;
  const hasSignal = Boolean(health?.lastSuccessAt || health?.lastFailureAt);
  const healthy = health ? Boolean(health.healthy) : false;

  return {
    provider,
    providerLabel: getProviderShortLabel(provider),
    model,
    status: healthy ? (hasSignal ? 'online' : 'unknown') : 'offline',
    checked: Boolean(health),
    message: healthy
      ? (hasSignal ? 'Provider runtime is healthy.' : 'No runtime failures recorded yet.')
      : (health?.lastErrorMessage || 'Provider runtime is unhealthy.'),
    lastCheckedAt: new Date().toISOString(),
  };
}

function buildCaseIntakeFromParserResult(result, runtime, elapsedMs, imageFixture = null) {
  const provider = normalizeImageParserProvider(runtime.provider);
  const model = safeString(result?.usage?.model || runtime.model, '') || IMAGE_DEFAULT_MODELS[provider] || '';
  const text = safeString(result?.text || result?.sourceText, '');
  const fallbackSummary = getParserFallbackSummary(result);
  return {
    source: 'pipeline-test',
    canonicalTemplate: text,
    parseFields: isPlainObject(result?.parseFields) ? result.parseFields : {},
    parseMeta: {
      providerUsed: result?.providerUsed || provider,
      model,
      elapsedMs,
      testRun: true,
      promptId: result?.promptId || 'escalation-template-parser',
      imageFixture,
      parserValidation: result?.parseMeta || null,
        fallback: fallbackSummary,
    },
    runs: [{
      agentId: 'escalation-template-parser',
      agentName: 'Image Parser',
      phase: 'parse-template',
      status: text ? 'completed' : 'failed',
      provider,
      model,
      durationMs: elapsedMs,
      summary: text ? `Test parse returned ${text.length} characters.` : 'Test parse returned no text.',
      detail: {
        testRun: true,
        promptId: result?.promptId || 'escalation-template-parser',
        imageFixture,
        parserValidation: result?.parseMeta || null,
        fallback: fallbackSummary,
      },
    }],
    testRun: true,
  };
}

function normalizeInvMatchesForDisplay(searchResult) {
  const { ssePayload } = knownIssueSearchToInvMatchResult(searchResult);
  return ssePayload.map((item, index) => ({
    id: item.invNumber || `INV-${index + 1}`,
    title: item.subject || 'Investigation candidate',
    similarity: Math.max(0, Math.min(100, Math.round(Number(item.score) || 0))),
    status: item.status || '',
    age: '',
    note: item.confidence || '',
    best: index === 0,
    _raw: item,
  }));
}

function runAssistantCompletion({ policy, reasoningEffort, prompt, fixture }) {
  const systemPrompt = getRenderedAgentPrompt('chat-core');
  const content = [
    safeString(fixture.assistantPrompt, ''),
    '',
    'Parsed template:',
    safeString(fixture.parserText, ''),
    '',
    'Parsed fields JSON:',
    JSON.stringify(fixture.parseFields || {}, null, 2),
  ].join('\n');

  return new Promise((resolve) => {
    let settled = false;
    const startedAt = Date.now();
    const chunks = [];

    function finish(payload) {
      if (settled) return;
      settled = true;
      resolve({
        elapsedMs: Date.now() - startedAt,
        ...payload,
      });
    }

    const cleanup = startChatOrchestration({
      mode: policy.mode,
      primaryProvider: policy.primaryProvider,
      primaryModel: policy.primaryModel,
      fallbackProvider: policy.fallbackProvider,
      fallbackModel: policy.fallbackModel,
      messages: [{ role: 'user', content: prompt || content }],
      systemPrompt,
      images: [],
      reasoningEffort,
      timeoutMs: TEST_TIMEOUT_MS,
      onChunk: (chunk) => {
        const text = typeof chunk === 'string' ? chunk : safeString(chunk?.text, '');
        if (text) chunks.push(text);
      },
      onThinkingChunk: () => {},
      onProviderError: () => {},
      onFallback: () => {},
      onDone: (data) => finish({
        ok: true,
        text: safeString(data?.fullResponse, '') || chunks.join(''),
        providerUsed: data?.providerUsed || policy.primaryProvider,
        modelUsed: data?.modelUsed || getProviderModelId(data?.providerUsed || policy.primaryProvider) || '',
        usage: data?.usage || null,
        attempts: Array.isArray(data?.attempts) ? data.attempts : [],
        fallbackUsed: Boolean(data?.fallbackUsed),
      }),
      onError: (err) => finish({
        ok: false,
        text: '',
        providerUsed: policy.primaryProvider,
        modelUsed: getProviderModelId(policy.primaryProvider) || '',
        error: {
          code: err?.code || 'ASSISTANT_TEST_FAILED',
          message: err?.message || 'QBO Assistant test failed.',
          detail: err?.detail || '',
        },
        attempts: Array.isArray(err?.attempts) ? err.attempts : [],
      }),
      onAbort: () => finish({
        ok: false,
        text: '',
        providerUsed: policy.primaryProvider,
        modelUsed: getProviderModelId(policy.primaryProvider) || '',
        error: {
          code: 'ASSISTANT_TEST_ABORTED',
          message: 'QBO Assistant test was aborted.',
        },
      }),
    });

    if (typeof cleanup !== 'function') {
      finish({
        ok: false,
        text: '',
        providerUsed: policy.primaryProvider,
        modelUsed: getProviderModelId(policy.primaryProvider) || '',
        error: {
          code: 'ASSISTANT_TEST_NOT_STARTED',
          message: 'QBO Assistant test did not start.',
        },
      });
    }
  });
}

router.post('/status', async (req, res) => {
  if (typeof req.setResponseTimeout === 'function') {
    req.setResponseTimeout(90_000);
  }

  const runtimeMap = readRuntimeMap(req.body);
  const forceRefresh = Boolean(req.body?.forceRefresh);
  const healthSnapshot = forceRefresh
    ? await refreshAgentHealth({
        agentIds: ['escalation-template-parser', 'known-issue-search-agent', 'triage-agent', 'chat'],
        runtimeOverrides: {
          'escalation-template-parser': getImageParserRuntime(runtimeMap),
          'known-issue-search-agent': getAgentRuntime(runtimeMap, 'known-issue-search-agent'),
          'triage-agent': getAgentRuntime(runtimeMap, 'triage-agent'),
          chat: getChatRuntime(runtimeMap),
        },
        forceRefresh: true,
      })
    : await getAgentHealthSnapshot({
        agentIds: ['escalation-template-parser', 'known-issue-search-agent', 'triage-agent', 'chat'],
        runtimeOverrides: {
          'escalation-template-parser': getImageParserRuntime(runtimeMap),
          'known-issue-search-agent': getAgentRuntime(runtimeMap, 'known-issue-search-agent'),
          'triage-agent': getAgentRuntime(runtimeMap, 'triage-agent'),
          chat: getChatRuntime(runtimeMap),
        },
      });
  const healthByAgent = healthSnapshot.agents || {};

  function toPipelineHealth(agentId) {
    const health = healthByAgent[agentId] || {};
    return {
      provider: health.provider || '',
      providerLabel: health.providerLabel || '',
      model: health.model || '',
      status: health.enabled === false ? 'disabled' : (health.status || 'unknown'),
      checked: Boolean(health.checkedAt),
      message: health.message || 'Health not checked yet.',
      enabled: health.enabled !== false,
      active: Boolean(health.active),
      lastCheckedAt: health.checkedAt || healthSnapshot.checkedAt || new Date().toISOString(),
    };
  }

  res.json({
    ok: true,
    checkedAt: healthSnapshot.checkedAt || new Date().toISOString(),
    stages: {
      parser: toPipelineHealth('escalation-template-parser'),
      inv: toPipelineHealth('known-issue-search-agent'),
      triage: toPipelineHealth('triage-agent'),
      main: toPipelineHealth('chat'),
    },
  });
});

router.get('/parser-results', async (req, res) => {
  if (!ImageParserTestResult.db || ImageParserTestResult.db.readyState !== 1) {
    return res.json({
      ok: true,
      results: [],
      stats: buildEmptyParserTestStats(),
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
    ImageParserTestResult.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
    buildParserTestStats(),
  ]);

  return res.json({
    ok: true,
    results: results.map(serializeImageParserTestResult),
    stats,
    dbAvailable: true,
  });
});

router.patch('/parser-results/:id', async (req, res) => {
  if (!ImageParserTestResult.db || ImageParserTestResult.db.readyState !== 1) {
    return res.status(503).json({ ok: false, code: 'DB_UNAVAILABLE', error: 'Parser test result database is unavailable.' });
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

  const result = await ImageParserTestResult.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
  if (!result) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Parser test result not found.' });
  }

  return res.json({ ok: true, result: serializeImageParserTestResult(result) });
});

router.post('/run', async (req, res) => {
  const stage = safeString(req.body?.stage, '').trim();
  const runtimeMap = readRuntimeMap(req.body);
  const fixture = await readCaseFixture();

  if (typeof req.setResponseTimeout === 'function') {
    req.setResponseTimeout(TEST_TIMEOUT_MS + 30_000);
  }

  const stageAgentId = STAGE_AGENT_IDS[stage];
  if (stageAgentId) {
    const health = await getAgentHealthSnapshot({ agentIds: [stageAgentId] });
    const agentHealth = health.agents?.[stageAgentId];
    if (agentHealth?.enabled === false || agentHealth?.status === 'disabled') {
      return res.status(409).json({
        ok: false,
        code: 'AGENT_DISABLED',
        error: `${agentHealth.label || stageAgentId} is turned off in its profile.`,
        stage,
      });
    }
  }

  if (stage === 'parser') {
    const runtime = getImageParserRuntime(runtimeMap);
    const provider = normalizeImageParserProvider(runtime.provider);
    if (!provider) {
      return res.status(400).json({ ok: false, code: 'IMAGE_PARSER_NOT_CONFIGURED', error: 'Image parser provider is not configured.' });
    }

    if (parserTestInFlight) {
      return res.status(409).json({
        ok: false,
        code: 'IMAGE_PARSER_TEST_ALREADY_RUNNING',
        error: 'Image Parser test is already running. Wait for it to finish before starting another test.',
      });
    }

    parserTestInFlight = true;
    try {
      const { dataUrl: image, fixture: imageFixture } = await readRandomImageParserFixtureDataUrl();
      const startedAt = Date.now();
      const result = await parseImage(image, {
        provider,
        model: safeString(runtime.model, '') || undefined,
        promptId: 'escalation-template-parser',
        timeoutMs: TEST_TIMEOUT_MS,
      });
      const elapsedMs = Date.now() - startedAt;
      const fallbackSummary = getParserFallbackSummary(result);
      const savedTestResult = await createImageParserTestResultRecord({
        imageFixture,
        runtime,
        provider,
        result,
        elapsedMs,
      });
      return res.json({
        ok: true,
        stage,
        testRun: true,
        alert: 'Test result only - not saved to the database.',
        imageFixture,
        savedTestResultId: savedTestResult ? String(savedTestResult._id) : '',
        savedTestResult: serializeImageParserTestResult(savedTestResult),
        providerUsed: provider,
        modelUsed: safeString(result?.usage?.model || runtime.model, '') || IMAGE_DEFAULT_MODELS[provider] || '',
        elapsedMs,
        text: safeString(result?.text || result?.sourceText, ''),
        parseFields: isPlainObject(result?.parseFields) ? result.parseFields : {},
        parseMeta: result?.parseMeta || null,
        ...fallbackSummary,
        caseIntake: buildCaseIntakeFromParserResult(result, runtime, elapsedMs, imageFixture),
      });
    } finally {
      parserTestInFlight = false;
    }
  }

  if (stage === 'inv') {
    const runtime = getAgentRuntime(runtimeMap, 'known-issue-search-agent');
    const fallbackPolicy = buildFallbackPolicy(runtimeMap);
    const policy = resolveKnownIssueAgentPolicy({
      agentRuntime: buildAgentRuntimeMap(runtimeMap, 'known-issue-search-agent', runtime),
      fallbackPolicy,
      fallbackReasoningEffort: getReasoningEffort(runtimeMap),
    });
    const result = await runKnownIssueSearchAgent({
      parserText: fixture.parserText,
      parseFields: fixture.parseFields,
      policy,
      timeoutMs: TEST_TIMEOUT_MS,
      emitStatus: async () => {},
    });
    return res.json({
      ok: result.ok !== false,
      stage,
      testRun: true,
      alert: 'Test result only - not saved to the database.',
      providerUsed: result?.meta?.providerUsed || policy.primaryProvider,
      modelUsed: result?.meta?.model || policy.primaryModel || getProviderModelId(policy.primaryProvider) || '',
      elapsedMs: result?.meta?.latencyMs || 0,
      result,
      matches: normalizeInvMatchesForDisplay(result),
    });
  }

  if (stage === 'triage') {
    const runtime = getAgentRuntime(runtimeMap, 'triage-agent');
    const fallbackPolicy = buildFallbackPolicy(runtimeMap);
    const policy = resolveTriageAgentPolicy({
      agentRuntime: buildAgentRuntimeMap(runtimeMap, 'triage-agent', runtime),
      fallbackPolicy,
      fallbackReasoningEffort: getReasoningEffort(runtimeMap),
    });
    const context = await buildAgentBackedTriageContext({
      parserText: fixture.parserText,
      parserProvider: 'pipeline-test-fixture',
      parserModel: 'fixture',
      parseFieldsOverride: fixture.parseFields,
      elapsedMs: 0,
      triageAgentRuntime: buildAgentRuntimeMap(runtimeMap, 'triage-agent', runtime),
      fallbackPolicy,
      reasoningEffort: getReasoningEffort(runtimeMap),
      timeoutMs: TEST_TIMEOUT_MS,
      emitStatus: async () => {},
      runKnownIssueSearch: false,
    });
    return res.json({
      ok: Boolean(context?.triageCard),
      stage,
      testRun: true,
      alert: 'Test result only - not saved to the database.',
      providerUsed: context?.triageMeta?.providerUsed || policy.primaryProvider,
      modelUsed: context?.triageMeta?.model || policy.primaryModel || getProviderModelId(policy.primaryProvider) || '',
      elapsedMs: context?.elapsedMs || context?.triageMeta?.latencyMs || 0,
      triageCard: context?.triageCard || null,
      context,
    });
  }

  if (stage === 'main') {
    const runtime = getChatRuntime(runtimeMap);
    const policy = buildFallbackPolicy({ ...runtimeMap, chat: runtime });
    const result = await runAssistantCompletion({
      policy,
      reasoningEffort: safeString(runtime.reasoningEffort, getReasoningEffort(runtimeMap)),
      fixture,
      prompt: safeString(req.body?.prompt, ''),
    });
    return res.status(result.ok ? 200 : 502).json({
      ok: result.ok,
      stage,
      testRun: true,
      alert: 'Test result only - not saved to the database.',
      providerUsed: result.providerUsed,
      modelUsed: result.modelUsed,
      elapsedMs: result.elapsedMs,
      text: result.text || '',
      error: result.error || null,
      attempts: result.attempts || [],
      usage: result.usage || null,
      fallbackUsed: Boolean(result.fallbackUsed),
    });
  }

  return res.status(400).json({
    ok: false,
    code: 'UNKNOWN_STAGE',
    error: 'Stage must be one of parser, inv, triage, or main.',
  });
});

module.exports = router;
