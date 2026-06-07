'use strict';

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('node:crypto');
const sharp = require('sharp');
const { parseImage } = require('../services/image-parser');
const { getAgentHealthSnapshot, refreshAgentHealth } = require('../services/agent-health-service');
const { getRenderedAgentPrompt } = require('../lib/agent-prompt-store');
const {
  resolveKnownIssueAgentPolicy,
} = require('../services/chat-request-service');
const { runTriage } = require('../services/triage');
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
const { createStageEventBus } = require('../lib/stage-events');
const { calculateCost, nanosToUsd, PRICING_VERSION } = require('../lib/pricing');
const { buildExactOutputComparison } = require('../lib/exact-output-check');
// Approved parser outputs → confirmed-output resolution + serialization lives in
// a shared lib so the triage test route can consume the SAME real, operator-
// approved data without a cross-route import. Behavior here is unchanged: these
// are the exact functions that previously lived inline in this file.
const {
  imageParserBaselineDbAvailable,
  serializeAcceptedOutput,
  collectAcceptedOutputsFromBaseline,
  serializeImageParserBaseline,
  findBaselineByFixtureName,
  resolveConfirmedOutputSetForFixture,
  resolveConfirmedOutputForFixture,
  flattenTemplatesFromFixtureAssets,
} = require('../lib/approved-triage-cases');
const ImageParserTestResult = require('../models/ImageParserTestResult');
const ImageParserFixtureBaseline = require('../models/ImageParserFixtureBaseline');

const router = express.Router();

const FIXTURE_DIR = path.resolve(__dirname, '..', '..', 'fixtures', 'pipeline-tests');
const IMAGE_FIXTURE_DIR = path.join(FIXTURE_DIR, 'image-parser');
const TEMPLATE_SVG_PATH = path.join(FIXTURE_DIR, 'escalation-template.svg');
const CASE_FIXTURE_PATH = path.join(FIXTURE_DIR, 'escalation-case.json');
const TEST_TIMEOUT_MS = 150_000;
const MAX_IMAGE_FIXTURE_BYTES = 20 * 1024 * 1024;
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

function clientWantsSse(req) {
  const accept = safeString(req.headers?.accept, '').toLowerCase();
  if (accept.includes('text/event-stream')) return true;
  const streamQ = safeString(req.query?.stream, '').toLowerCase();
  return streamQ === '1' || streamQ === 'true' || streamQ === 'yes';
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

function imageParserTestDbAvailable() {
  return Boolean(ImageParserTestResult.db && ImageParserTestResult.db.readyState === 1);
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

function chooseImageParserFixture(fixtures) {
  return chooseRandomFixture(fixtures);
}

function normalizeImageFixtureName(name) {
  const clean = safeString(name, '').trim();
  if (!clean || clean !== path.basename(clean)) return '';
  return clean;
}

function buildImageFixtureUrl(name) {
  const clean = safeString(name, '').trim();
  if (!clean) return '';
  return `/api/pipeline-tests/image-fixtures/${encodeURIComponent(clean)}`;
}

function imageFixtureRelativePath(name) {
  const clean = normalizeImageFixtureName(name);
  if (!clean) return '';
  return path.relative(FIXTURE_DIR, path.join(IMAGE_FIXTURE_DIR, clean)).replace(/\\/g, '/');
}

function isCompatibleImageFixtureExtension(ext, mimeType) {
  const normalizedExt = safeString(ext, '').toLowerCase();
  const normalizedMime = safeString(mimeType, '').toLowerCase();
  if (normalizedMime === 'image/jpeg') return normalizedExt === '.jpg' || normalizedExt === '.jpeg';
  return IMAGE_FIXTURE_MIME_TYPES[normalizedExt] === normalizedMime;
}

function defaultImageFixtureExtension(mimeType) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  return '.jpg';
}

function parseImageFixtureDataUrl(value) {
  const raw = safeString(value, '').trim();
  const match = raw.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    const err = new Error('Image asset must be a PNG, JPEG, or WebP data URL.');
    err.statusCode = 400;
    err.code = 'INVALID_IMAGE_DATA_URL';
    throw err;
  }

  const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length) {
    const err = new Error('Image asset is empty.');
    err.statusCode = 400;
    err.code = 'EMPTY_IMAGE_ASSET';
    throw err;
  }
  if (buffer.length > MAX_IMAGE_FIXTURE_BYTES) {
    const err = new Error(`Image asset is too large. Maximum size is ${Math.round(MAX_IMAGE_FIXTURE_BYTES / 1024 / 1024)} MB.`);
    err.statusCode = 413;
    err.code = 'IMAGE_ASSET_TOO_LARGE';
    throw err;
  }
  return { mimeType, buffer };
}

function sanitizeImageFixtureUploadName(fileName, mimeType) {
  const fallbackExt = defaultImageFixtureExtension(mimeType);
  const base = path.basename(safeString(fileName, '').trim()) || `image-parser-fixture-${Date.now()}${fallbackExt}`;
  const ext = path.extname(base).toLowerCase() || fallbackExt;
  if (!Object.prototype.hasOwnProperty.call(IMAGE_FIXTURE_MIME_TYPES, ext)) {
    const err = new Error('Image asset filename must end in .png, .jpg, .jpeg, or .webp.');
    err.statusCode = 400;
    err.code = 'INVALID_IMAGE_EXTENSION';
    throw err;
  }
  if (!isCompatibleImageFixtureExtension(ext, mimeType)) {
    const err = new Error('Image asset filename extension does not match the uploaded image type.');
    err.statusCode = 400;
    err.code = 'IMAGE_EXTENSION_MISMATCH';
    throw err;
  }
  const rawStem = path.basename(base, path.extname(base)) || 'image-parser-fixture';
  const stem = rawStem
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    || 'image-parser-fixture';
  return `${stem}${ext}`;
}

async function getUniqueImageFixtureName(preferredName) {
  const clean = normalizeImageFixtureName(preferredName);
  if (!clean) {
    const err = new Error('Invalid image fixture name.');
    err.statusCode = 400;
    err.code = 'INVALID_FIXTURE_NAME';
    throw err;
  }

  const ext = path.extname(clean);
  const stem = path.basename(clean, ext);
  let candidate = clean;
  for (let index = 2; index < 1000; index += 1) {
    try {
      await fs.access(path.join(IMAGE_FIXTURE_DIR, candidate));
      candidate = `${stem}-${index}${ext}`;
    } catch (err) {
      if (err?.code === 'ENOENT') return candidate;
      throw err;
    }
  }

  const err = new Error('Could not create a unique image fixture filename.');
  err.statusCode = 409;
  err.code = 'FIXTURE_NAME_CONFLICT';
  throw err;
}

async function verifyImageFixtureBuffer(buffer, expectedMimeType) {
  try {
    const metadata = await sharp(buffer).metadata();
    const actualMimeType = metadata.format === 'jpeg' ? 'image/jpeg' : `image/${metadata.format}`;
    if (actualMimeType !== expectedMimeType) {
      const err = new Error('Uploaded image bytes do not match the declared image type.');
      err.statusCode = 400;
      err.code = 'IMAGE_BYTES_MISMATCH';
      throw err;
    }
    return metadata;
  } catch (err) {
    if (err?.statusCode) throw err;
    const invalid = new Error('Uploaded image could not be decoded as a supported image.');
    invalid.statusCode = 400;
    invalid.code = 'INVALID_IMAGE_BYTES';
    throw invalid;
  }
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

function toTokenCount(value) {
  const numeric = safeNumber(value, 0);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0;
}

function buildApiCostSummary({ usage, provider, model }) {
  if (!isPlainObject(usage)) return null;

  const inputTokens = toTokenCount(usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = toTokenCount(usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens);
  const totalTokens = toTokenCount(usage.totalTokens ?? usage.total_tokens) || inputTokens + outputTokens;
  const modelId = safeString(usage.model || model, '');
  const providerId = safeString(provider, '');
  const cost = calculateCost(inputTokens, outputTokens, modelId, providerId);

  return {
    currency: 'USD',
    source: 'server-pricing',
    pricingVersion: PRICING_VERSION,
    rateFound: Boolean(cost.rateFound),
    provider: providerId,
    model: modelId,
    inputTokens,
    outputTokens,
    totalTokens,
    inputCostNanos: cost.inputCostNanos,
    outputCostNanos: cost.outputCostNanos,
    totalCostNanos: cost.totalCostNanos,
    inputCostMicros: cost.inputCostMicros,
    outputCostMicros: cost.outputCostMicros,
    totalCostMicros: cost.totalCostMicros,
    inputCostUsd: nanosToUsd(cost.inputCostNanos),
    outputCostUsd: nanosToUsd(cost.outputCostNanos),
    totalCostUsd: nanosToUsd(cost.totalCostNanos),
  };
}

async function createImageParserTestResultRecord({ imageFixture, runtime, provider, result, elapsedMs }) {
  if (!imageParserTestDbAvailable()) return null;
  const parseMeta = result?.parseMeta || null;
  const validation = getParserValidationSummary(parseMeta);
  const model = safeString(result?.usage?.model || runtime.model, '') || IMAGE_DEFAULT_MODELS[provider] || '';
  const apiCost = buildApiCostSummary({ usage: result?.usage, provider, model });
  const fallbackSummary = getParserFallbackSummary(result);
  try {
    return await ImageParserTestResult.create({
      fixture: imageFixture,
      provider,
      providerLabel: IMAGE_PROVIDER_LABELS[provider] || provider,
      model,
      modelRequested: safeString(runtime.model, ''),
      reasoningEffort: safeString(runtime.reasoningEffort, ''),
      serviceTier: safeString(runtime.serviceTier, ''),
      runtime,
      promptId: safeString(result?.promptId, 'escalation-template-parser'),
      promptVersion: safeString(result?.promptVersion, ''),
      promptSha256: safeString(result?.promptSha256, ''),
      promptLength: Number.isFinite(Number(result?.promptLength)) ? Number(result.promptLength) : 0,
      providerPackageId: safeString(result?.providerTrace?.providerPackageId, ''),
      providerHarness: safeString(result?.providerTrace?.providerHarness, ''),
      providerTrace: result?.providerTrace || null,
      elapsedMs,
      status: 'pending-review',
      ...validation,
      parsedText: safeString(result?.text || result?.sourceText, ''),
      parseFields: isPlainObject(result?.parseFields) ? result.parseFields : {},
      parseMeta,
      usage: result?.usage || null,
      apiCost,
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

function serializeImageParserTestResultWithConfirmedOutput(doc, confirmedOutput) {
  const result = serializeImageParserTestResult(doc);
  if (!result) return null;
  return {
    ...result,
    hasConfirmedOutput: Boolean(confirmedOutput),
    confirmedOutputSource: safeString(confirmedOutput?.source, ''),
    confirmedOutputUpdatedAt: confirmedOutput?.updatedAt || null,
    confirmedOutputCount: safeNumber(confirmedOutput?.outputCount, confirmedOutput?.outputs?.length || 0),
  };
}

function outputForStorage(output) {
  const stored = {
    expectedText: safeString(output.expectedText, ''),
    sourceResultId: safeString(output.sourceResultId, ''),
    sourceProvider: safeString(output.sourceProvider, ''),
    sourceModel: safeString(output.sourceModel, ''),
    promptId: safeString(output.promptId, 'escalation-template-parser') || 'escalation-template-parser',
    promptVersion: safeString(output.promptVersion, ''),
    promptSha256: safeString(output.promptSha256, ''),
    confirmedBy: safeString(output.confirmedBy, 'operator') || 'operator',
    operatorNote: safeString(output.operatorNote, ''),
    source: safeString(output.source, 'saved') || 'saved',
    createdAt: output.createdAt || new Date(),
    updatedAt: output.updatedAt || new Date(),
  };
  if (/^[a-f\d]{24}$/i.test(safeString(output.id, ''))) {
    stored._id = output.id;
  }
  return stored;
}

async function findImageParserTestResultById(id) {
  if (!imageParserTestDbAvailable()) return null;
  if (typeof ImageParserTestResult.findById === 'function') {
    const query = ImageParserTestResult.findById(id);
    if (query && typeof query.lean === 'function') return query.lean();
    return query;
  }
  return null;
}

async function serializeImageParserTestAsset(fixture) {
  const stats = await fs.stat(fixture.filePath);
  const confirmedOutput = await resolveConfirmedOutputSetForFixture(fixture.name);
  const approvedTemplates = Array.isArray(confirmedOutput?.outputs) ? confirmedOutput.outputs : [];
  return {
    kind: 'image-fixture',
    agentId: STAGE_AGENT_IDS.parser,
    name: fixture.name,
    fileName: fixture.name,
    path: imageFixtureRelativePath(fixture.name),
    url: buildImageFixtureUrl(fixture.name),
    thumbnailUrl: buildImageFixtureUrl(fixture.name),
    mimeType: fixture.mimeType,
    sizeBytes: stats.size,
    updatedAt: stats.mtime?.toISOString?.() || null,
    randomizedForTests: true,
    programmaticCheckReady: approvedTemplates.length > 0,
    hasApprovedTemplates: approvedTemplates.length > 0,
    approvedTemplateCount: approvedTemplates.length,
    approvedTemplates,
    confirmedOutputSource: safeString(confirmedOutput?.source, ''),
    confirmedOutputUpdatedAt: confirmedOutput?.updatedAt || null,
  };
}

async function listImageParserTestAssets() {
  const fixtures = await listImageParserFixtures();
  return Promise.all(fixtures.map((fixture) => serializeImageParserTestAsset(fixture)));
}

async function listTriageTemplateAssets() {
  const parserAssets = await listImageParserTestAssets();
  return flattenTemplatesFromFixtureAssets(parserAssets, { triageAgentId: STAGE_AGENT_IDS.triage });
}

async function saveConfirmedOutputFromResult(result, body = {}) {
  if (!imageParserBaselineDbAvailable()) {
    const err = new Error('Parser confirmed-output database is unavailable.');
    err.statusCode = 503;
    err.code = 'DB_UNAVAILABLE';
    throw err;
  }

  const fixtureName = safeString(result?.fixture?.name, '').trim();
  if (!fixtureName) {
    const err = new Error('Parser test result does not have an image fixture name.');
    err.statusCode = 400;
    err.code = 'MISSING_FIXTURE';
    throw err;
  }

  const expectedText = typeof body.expectedText === 'string' ? body.expectedText : safeString(result?.parsedText, '');
  const now = new Date();
  const newOutput = {
    fixtureName,
    expectedText,
    sourceResultId: String(result?._id || result?.id || ''),
    sourceProvider: safeString(result?.provider, ''),
    sourceModel: safeString(result?.model, ''),
    promptId: safeString(result?.promptId, 'escalation-template-parser') || 'escalation-template-parser',
    promptVersion: safeString(result?.promptVersion, ''),
    promptSha256: safeString(result?.promptSha256, ''),
    confirmedBy: safeString(body.confirmedBy, 'operator') || 'operator',
    operatorNote: safeString(body.operatorNote, ''),
    source: 'saved',
    createdAt: now,
    updatedAt: now,
  };

  if (typeof ImageParserFixtureBaseline.findOneAndUpdate !== 'function') {
    const err = new Error('Parser confirmed-output database does not support updates.');
    err.statusCode = 503;
    err.code = 'DB_UNAVAILABLE';
    throw err;
  }

  const existing = await findBaselineByFixtureName(fixtureName);
  const existingOutputs = collectAcceptedOutputsFromBaseline(existing);
  const duplicate = existingOutputs.find((output) => output.expectedText === expectedText);
  const acceptedOutputs = duplicate
    ? existingOutputs
    : [...existingOutputs, newOutput];
  const latestOutput = duplicate || newOutput;
  const update = {
    ...latestOutput,
    fixtureName,
    acceptableOutputs: acceptedOutputs.map(outputForStorage),
  };

  const query = ImageParserFixtureBaseline.findOneAndUpdate(
    { fixtureName },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  const saved = query && typeof query.lean === 'function' ? await query.lean() : await query;
  return {
    baseline: serializeImageParserBaseline(saved),
    added: !duplicate,
    duplicate: Boolean(duplicate),
    output: serializeAcceptedOutput(latestOutput, fixtureName),
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
    byPromptVersion: [],
  };
}

async function buildParserTestStats() {
  const [overallAgg, byProvider, byModel, byFixture, byPromptVersion] = await Promise.all([
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
    ImageParserTestResult.aggregate([
      {
        $group: {
          _id: {
            promptId: '$promptId',
            promptVersion: '$promptVersion',
            promptSha256: '$promptSha256',
          },
          total: { $sum: 1 },
          pass: { $sum: { $cond: [{ $eq: ['$status', 'pass'] }, 1, 0] } },
          fail: { $sum: { $cond: [{ $eq: ['$status', 'fail'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending-review'] }, 1, 0] } },
          avgElapsedMs: { $avg: '$elapsedMs' },
        },
      },
      { $sort: { '_id.promptVersion': -1, total: -1 } },
      { $limit: 40 },
    ]),
  ]);

  const overall = overallAgg[0] || buildEmptyParserTestStats();
  const passRate = overall.pass + overall.fail > 0 ? overall.pass / (overall.pass + overall.fail) : 0;
  const normalize = (entry) => ({
    ...entry,
    id: typeof entry._id === 'object' ? undefined : entry._id,
    provider: entry._id?.provider || entry.provider || (typeof entry._id === 'string' ? entry._id : ''),
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
    byPromptVersion: byPromptVersion.map((entry) => ({
      ...normalize(entry),
      promptId: entry._id?.promptId || '',
      promptVersion: entry._id?.promptVersion || '',
      promptSha256: entry._id?.promptSha256 || '',
    })),
  };
}

async function readImageParserFixtureDataUrl(fixtureName = '', options = {}) {
  const fixtures = await listImageParserFixtures();
  const requestedName = normalizeImageFixtureName(fixtureName);
  const excludedName = normalizeImageFixtureName(options.excludeFixtureName || '');
  if (safeString(fixtureName, '').trim() && !requestedName) {
    const err = new Error('Invalid image fixture name.');
    err.statusCode = 400;
    err.code = 'INVALID_FIXTURE_NAME';
    throw err;
  }

  const selectableFixtures = !requestedName && excludedName && fixtures.length > 1
    ? fixtures.filter((entry) => entry.name !== excludedName)
    : fixtures;
  const selected = requestedName
    ? fixtures.find((entry) => entry.name === requestedName)
    : chooseImageParserFixture(selectableFixtures);
  if (requestedName && !selected) {
    const err = new Error('Image parser fixture not found.');
    err.statusCode = 404;
    err.code = 'FIXTURE_NOT_FOUND';
    throw err;
  }
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
      requested: Boolean(requestedName),
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
      promptVersion: safeString(result?.promptVersion, ''),
      promptSha256: safeString(result?.promptSha256, ''),
      promptLength: Number.isFinite(Number(result?.promptLength)) ? Number(result.promptLength) : 0,
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
        promptVersion: safeString(result?.promptVersion, ''),
        promptSha256: safeString(result?.promptSha256, ''),
        promptLength: Number.isFinite(Number(result?.promptLength)) ? Number(result.promptLength) : 0,
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

router.get('/test-assets/:agentId', async (req, res) => {
  try {
    const agentId = safeString(req.params?.agentId, '').trim();
    if (agentId === STAGE_AGENT_IDS.parser) {
      const assets = await listImageParserTestAssets();
      const approvedImageCount = assets.filter((asset) => asset.hasApprovedTemplates).length;
      const approvedTemplateCount = assets.reduce((sum, asset) => sum + safeNumber(asset.approvedTemplateCount, 0), 0);
      return res.json({
        ok: true,
        agentId,
        assetType: 'image-fixtures',
        supportsUpload: true,
        uploadPath: '/api/pipeline-tests/image-fixtures',
        fixtureDir: path.relative(process.cwd(), IMAGE_FIXTURE_DIR).replace(/\\/g, '/'),
        assets,
        stats: {
          imageCount: assets.length,
          approvedImageCount,
          unapprovedImageCount: Math.max(0, assets.length - approvedImageCount),
          approvedTemplateCount,
        },
      });
    }

    if (agentId === STAGE_AGENT_IDS.triage) {
      const assets = await listTriageTemplateAssets();
      return res.json({
        ok: true,
        agentId,
        assetType: 'approved-parser-templates',
        supportsUpload: false,
        sourceAgentId: STAGE_AGENT_IDS.parser,
        assets,
        stats: {
          templateCount: assets.length,
          sourceImageCount: new Set(assets.map((asset) => asset.sourceFixtureName).filter(Boolean)).size,
        },
      });
    }

    return res.json({
      ok: true,
      agentId,
      assetType: 'none',
      supportsUpload: false,
      assets: [],
      stats: {
        assetCount: 0,
      },
    });
  } catch (err) {
    return res.status(err?.statusCode || 500).json({
      ok: false,
      code: err?.code || 'TEST_ASSETS_FAILED',
      error: err?.message || 'Failed to load test assets.',
    });
  }
});

router.post('/image-fixtures', async (req, res) => {
  try {
    const { mimeType, buffer } = parseImageFixtureDataUrl(req.body?.dataUrl);
    const metadata = await verifyImageFixtureBuffer(buffer, mimeType);
    const preferredName = sanitizeImageFixtureUploadName(req.body?.fileName, mimeType);
    const fileName = await getUniqueImageFixtureName(preferredName);
    const filePath = path.join(IMAGE_FIXTURE_DIR, fileName);

    await fs.mkdir(IMAGE_FIXTURE_DIR, { recursive: true });
    await fs.writeFile(filePath, buffer, { flag: 'wx' });

    return res.status(201).json({
      ok: true,
      fixture: {
        name: fileName,
        fileName,
        path: imageFixtureRelativePath(fileName),
        url: buildImageFixtureUrl(fileName),
        thumbnailUrl: buildImageFixtureUrl(fileName),
        mimeType,
        sizeBytes: buffer.length,
        width: metadata.width || null,
        height: metadata.height || null,
        randomizedForTests: true,
        hasApprovedTemplates: false,
        approvedTemplateCount: 0,
        approvedTemplates: [],
      },
    });
  } catch (err) {
    const statusCode = err?.code === 'EEXIST' ? 409 : err?.statusCode || 500;
    return res.status(statusCode).json({
      ok: false,
      code: err?.code === 'EEXIST' ? 'FIXTURE_NAME_CONFLICT' : err?.code || 'IMAGE_FIXTURE_UPLOAD_FAILED',
      error: err?.message || 'Failed to save image fixture.',
    });
  }
});

router.get('/image-fixtures/:name', async (req, res) => {
  const requestedName = safeString(req.params?.name, '').trim();
  if (!requestedName || requestedName !== path.basename(requestedName)) {
    return res.status(400).json({ ok: false, code: 'INVALID_FIXTURE_NAME', error: 'Invalid image fixture name.' });
  }

  const fixtures = await listImageParserFixtures();
  const fixture = fixtures.find((entry) => entry.name === requestedName);
  if (!fixture) {
    return res.status(404).json({ ok: false, code: 'FIXTURE_NOT_FOUND', error: 'Image parser fixture not found.' });
  }

  const image = await fs.readFile(fixture.filePath);
  res.setHeader('Content-Type', fixture.mimeType);
  res.setHeader('Cache-Control', 'no-store');
  return res.send(image);
});

router.get('/parser-results', async (req, res) => {
  if (!imageParserTestDbAvailable()) {
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
  if (req.query.promptId) filter.promptId = safeString(req.query.promptId);
  if (req.query.promptVersion) filter.promptVersion = safeString(req.query.promptVersion);
  if (req.query.promptSha256) filter.promptSha256 = safeString(req.query.promptSha256);

  const [results, stats] = await Promise.all([
    ImageParserTestResult.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
    buildParserTestStats(),
  ]);

  const confirmedOutputByFixture = new Map();
  const fixtureNames = Array.from(new Set(
    results
      .map((result) => safeString(result?.fixture?.name, '').trim())
      .filter(Boolean)
  ));
  await Promise.all(fixtureNames.map(async (fixtureName) => {
    confirmedOutputByFixture.set(fixtureName, await resolveConfirmedOutputForFixture(fixtureName));
  }));

  return res.json({
    ok: true,
    results: results.map((result) => {
      const fixtureName = safeString(result?.fixture?.name, '').trim();
      return serializeImageParserTestResultWithConfirmedOutput(
        result,
        fixtureName ? confirmedOutputByFixture.get(fixtureName) : null,
      );
    }),
    stats,
    dbAvailable: true,
  });
});

router.patch('/parser-results/:id', async (req, res) => {
  if (!imageParserTestDbAvailable()) {
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

router.delete('/parser-results/:id', async (req, res) => {
  if (!imageParserTestDbAvailable()) {
    return res.status(503).json({ ok: false, code: 'DB_UNAVAILABLE', error: 'Parser test result database is unavailable.' });
  }

  let result = null;
  if (typeof ImageParserTestResult.findByIdAndDelete === 'function') {
    const query = ImageParserTestResult.findByIdAndDelete(req.params.id);
    result = query && typeof query.lean === 'function' ? await query.lean() : await query;
  } else if (typeof ImageParserTestResult.deleteOne === 'function') {
    const existing = await findImageParserTestResultById(req.params.id);
    if (existing) {
      const deleteResult = await ImageParserTestResult.deleteOne({ _id: req.params.id });
      result = deleteResult?.deletedCount > 0 ? existing : null;
    }
  }

  if (!result) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Parser test result not found.' });
  }

  return res.json({ ok: true, deletedId: String(result._id || result.id || req.params.id) });
});

router.post('/parser-results/:id/confirmed-output', async (req, res) => {
  if (!imageParserTestDbAvailable()) {
    return res.status(503).json({ ok: false, code: 'DB_UNAVAILABLE', error: 'Parser test result database is unavailable.' });
  }

  const result = await findImageParserTestResultById(req.params.id);
  if (!result) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Parser test result not found.' });
  }

  try {
    const saved = await saveConfirmedOutputFromResult(result, req.body || {});
    return res.json({
      ok: true,
      baseline: saved.baseline,
      output: saved.output,
      added: saved.added,
      duplicate: saved.duplicate,
      outputCount: saved.baseline?.outputCount || 0,
    });
  } catch (err) {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    return res.status(status).json({
      ok: false,
      code: err?.code || 'CONFIRMED_OUTPUT_SAVE_FAILED',
      error: err?.message || 'Failed to save confirmed parser output.',
    });
  }
});

router.get('/parser-results/:id/confirmed-output', async (req, res) => {
  if (!imageParserTestDbAvailable()) {
    return res.status(503).json({ ok: false, code: 'DB_UNAVAILABLE', error: 'Parser test result database is unavailable.' });
  }

  const result = await findImageParserTestResultById(req.params.id);
  if (!result) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Parser test result not found.' });
  }

  const fixtureName = safeString(result?.fixture?.name, '').trim();
  if (!fixtureName) {
    return res.status(400).json({
      ok: false,
      code: 'MISSING_FIXTURE',
      error: 'Parser test result does not have an image fixture name.',
    });
  }

  const confirmedOutput = await resolveConfirmedOutputSetForFixture(fixtureName);
  return res.json({
    ok: true,
    fixtureName,
    hasConfirmedOutput: Boolean(confirmedOutput),
    baseline: confirmedOutput?.baseline || null,
    outputs: confirmedOutput?.outputs || [],
    outputCount: confirmedOutput?.outputCount || 0,
    source: confirmedOutput?.source || '',
    updatedAt: confirmedOutput?.updatedAt || null,
  });
});

router.post('/parser-results/:id/programmatic-check', async (req, res) => {
  if (!imageParserTestDbAvailable()) {
    return res.status(503).json({ ok: false, code: 'DB_UNAVAILABLE', error: 'Parser test result database is unavailable.' });
  }

  const result = await findImageParserTestResultById(req.params.id);
  if (!result) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Parser test result not found.' });
  }

  const fixtureName = safeString(result?.fixture?.name, '').trim();
  if (!fixtureName) {
    return res.status(400).json({
      ok: false,
      code: 'MISSING_FIXTURE',
      error: 'Parser test result does not have an image fixture name.',
    });
  }

  const confirmedOutput = await resolveConfirmedOutputSetForFixture(fixtureName);
  if (!confirmedOutput?.outputs?.length) {
    return res.status(409).json({
      ok: false,
      code: 'NO_CONFIRMED_OUTPUT',
      error: `No official confirmed parser output has been saved for ${fixtureName}.`,
      fixtureName,
    });
  }

  const actual = safeString(result?.parsedText, '');
  const checks = [];
  let passingCheck = null;
  for (const output of confirmedOutput.outputs) {
    const comparison = buildExactOutputComparison({
      actual,
      expected: output.expectedText,
    });
    const check = {
      output,
      comparison,
      passed: comparison.passed,
      summary: comparison.summary,
    };
    checks.push(check);
    if (comparison.passed) {
      passingCheck = check;
      break;
    }
  }

  const bestFailedCheck = checks.reduce((best, check) => {
    if (!best) return check;
    const currentFailures = safeNumber(check.summary?.failedCharacters, Number.MAX_SAFE_INTEGER);
    const bestFailures = safeNumber(best.summary?.failedCharacters, Number.MAX_SAFE_INTEGER);
    return currentFailures < bestFailures ? check : best;
  }, null);
  const selectedCheck = passingCheck || bestFailedCheck || checks[0];
  const comparison = selectedCheck.comparison;
  const selectedOutput = selectedCheck.output;
  const checkSummaries = checks.map((check, index) => ({
    outputIndex: check.output.outputIndex ?? index,
    outputId: check.output.id || '',
    source: check.output.source || '',
    passed: check.passed,
    summary: check.summary,
  }));
  const passed = Boolean(passingCheck);
  const manualReviewAfterCheck = req.body?.manualReviewAfterCheck === true
    || safeString(req.body?.recordMode, '') === 'manual-on-fail';
  const requiresManualReview = manualReviewAfterCheck && !passed;
  const programmaticStatus = passed ? 'pass' : 'fail';
  const status = requiresManualReview ? 'pending-review' : programmaticStatus;
  const exactMatchSummary = {
    ...comparison.summary,
    outputCount: confirmedOutput.outputCount,
    checkedOutputCount: checks.length,
    matchedOutputIndex: passingCheck ? selectedOutput.outputIndex : null,
    matchedOutputId: passingCheck ? selectedOutput.id || '' : '',
    matchedOutputSource: passingCheck ? selectedOutput.source || '' : '',
    selectedOutputIndex: selectedOutput?.outputIndex ?? null,
    selectedOutputId: selectedOutput?.id || '',
    selectedOutputSource: selectedOutput?.source || '',
    checks: checkSummaries,
  };
  const baseline = {
    fixtureName,
    id: selectedOutput?.id || '',
    outputIndex: selectedOutput?.outputIndex ?? 0,
    outputCount: confirmedOutput.outputCount,
    source: selectedOutput?.source || confirmedOutput.source,
    updatedAt: selectedOutput?.updatedAt || confirmedOutput.updatedAt,
    expectedText: selectedOutput?.expectedText || '',
    outputs: confirmedOutput.outputs,
  };
  const update = {
    status,
    reviewer: safeString(req.body?.reviewer, 'programmatic-check') || 'programmatic-check',
    operatorNote: passed
      ? `Programmatic exact-output check passed for ${fixtureName}.`
      : requiresManualReview
        ? `Programmatic exact-output check failed for ${fixtureName}; manual review is required.`
        : `Programmatic exact-output check failed for ${fixtureName}.`,
    exactMatchPassed: passed,
    exactMatchCheckedAt: new Date(),
    exactMatchBaselineSource: safeString(baseline.source, ''),
    exactMatchSummary,
  };
  if (!requiresManualReview) {
    update.reviewedAt = new Date();
  }

  const savedResult = await ImageParserTestResult.findByIdAndUpdate(req.params.id, update, { new: true }).lean();

  return res.json({
    ok: true,
    fixtureName,
    status,
    programmaticStatus,
    passed,
    requiresManualReview,
    baseline,
    checkedOutputCount: checks.length,
    matchedOutputIndex: passingCheck ? selectedOutput.outputIndex : null,
    matchedOutputId: passingCheck ? selectedOutput.id || '' : '',
    checks: checkSummaries,
    candidateResults: checkSummaries,
    comparison,
    result: serializeImageParserTestResult(savedResult),
  });
});

router.post('/run', async (req, res) => {
  const stage = safeString(req.body?.stage, '').trim();
  const runtimeMap = readRuntimeMap(req.body);
  const streamMode = stage === 'parser' && clientWantsSse(req);
  const requestAbortController = new AbortController();
  let clientClosed = false;

  if (typeof res.on === 'function') {
    res.on('close', () => {
      if (!res.writableEnded) {
        clientClosed = true;
        requestAbortController.abort();
      }
    });
  }

  if (typeof req.setResponseTimeout === 'function') {
    req.setResponseTimeout(TEST_TIMEOUT_MS + 30_000);
  }

  let sseOpen = false;
  function sendSse(eventName, payload) {
    if (!sseOpen || clientClosed) return;
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // Client disconnected.
    }
  }
  function openSse() {
    if (!streamMode || sseOpen || res.headersSent || clientClosed) return;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    sseOpen = true;
  }
  function respondRun(status, body) {
    if (clientClosed) return undefined;
    if (!streamMode) {
      return res.status(status).json(body);
    }
    openSse();
    sendSse(status >= 200 && status < 300 ? 'test_complete' : 'error', body);
    try { res.end(); } catch { /* noop */ }
    return undefined;
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
      return respondRun(400, { ok: false, code: 'IMAGE_PARSER_NOT_CONFIGURED', error: 'Image parser provider is not configured.' });
    }

    if (parserTestInFlight) {
      return respondRun(409, {
        ok: false,
        code: 'IMAGE_PARSER_TEST_ALREADY_RUNNING',
        error: 'Image Parser test is already running. Wait for it to finish before starting another test.',
      });
    }

    parserTestInFlight = true;
    const bus = streamMode
      ? createStageEventBus({ send: sendSse, stageId: 'parser', runId: randomUUID() })
      : null;
    if (streamMode) {
      openSse();
      bus.emit('parser.server_request_received', {
        provider,
        model: safeString(runtime.model, ''),
        streamMode: true,
        testRun: true,
        route: '/api/pipeline-tests/run',
        fixtureName: safeString(req.body?.fixtureName, '').trim(),
        excludeFixtureName: safeString(req.body?.excludeFixtureName, '').trim(),
        retest: Boolean(req.body?.retest),
      });
    }
    try {
      const requestedFixtureName = safeString(req.body?.fixtureName, '').trim();
      const excludedFixtureName = safeString(req.body?.excludeFixtureName, '').trim();
      const { dataUrl: image, fixture: imageFixture } = await readImageParserFixtureDataUrl(requestedFixtureName, {
        excludeFixtureName: excludedFixtureName,
      });
      const startedAt = Date.now();
      if (requestAbortController.signal.aborted || clientClosed) {
        bus?.emit('parser.test_cancelled', {
          testRun: true,
          status: 'cancelled',
          displayMessage: 'Parser test cancelled by client.',
        });
        return undefined;
      }
      const result = await parseImage(image, {
        provider,
        model: safeString(runtime.model, '') || undefined,
        reasoningEffort: safeString(runtime.reasoningEffort, '') || undefined,
        serviceTier: safeString(runtime.serviceTier, '') || undefined,
        // Wave 2 universal failover: honor the operator's configured image-parser
        // backup (defaults to the neutral global alternate server-side). No
        // capability filtering — any provider may back up any provider.
        fallbackProvider: safeString(runtime.fallbackProvider, ''),
        fallbackModel: safeString(runtime.fallbackModel, ''),
        agentRuntime: runtime,
        promptId: 'escalation-template-parser',
        timeoutMs: TEST_TIMEOUT_MS,
        eventBus: bus,
        signal: requestAbortController.signal,
      });
      if (requestAbortController.signal.aborted || clientClosed) {
        bus?.emit('parser.test_cancelled', {
          testRun: true,
          status: 'cancelled',
          displayMessage: 'Parser test cancelled by client.',
        });
        return undefined;
      }
      const elapsedMs = Date.now() - startedAt;
      const modelUsed = safeString(result?.usage?.model || runtime.model, '') || IMAGE_DEFAULT_MODELS[provider] || '';
      const apiCost = buildApiCostSummary({ usage: result?.usage, provider, model: modelUsed });
      const fallbackSummary = getParserFallbackSummary(result);
      const savedTestResult = await createImageParserTestResultRecord({
        imageFixture,
        runtime,
        provider,
        result,
        elapsedMs,
      });
      const savedSerialized = serializeImageParserTestResult(savedTestResult);
      const saveStatus = savedSerialized ? 'saved' : 'not-saved';
      const saveReason = savedSerialized
        ? ''
        : imageParserTestDbAvailable()
          ? 'The parser test completed, but the result could not be saved.'
          : 'The parser test completed, but the test-result database is unavailable.';
      const responseBody = {
        ok: true,
        stage,
        testRun: true,
        alert: savedSerialized
          ? 'Test result saved as pending review.'
          : 'Test result completed but was not saved.',
        saveStatus,
        saveReason,
        imageFixture,
        savedTestResultId: savedTestResult ? String(savedTestResult._id) : '',
        savedTestResult: savedSerialized,
        providerUsed: provider,
        modelUsed,
        promptId: safeString(result?.promptId, 'escalation-template-parser'),
        promptVersion: safeString(result?.promptVersion, ''),
        promptSha256: safeString(result?.promptSha256, ''),
        promptLength: Number.isFinite(Number(result?.promptLength)) ? Number(result.promptLength) : 0,
        elapsedMs,
        usage: result?.usage || null,
        apiCost,
        text: safeString(result?.text || result?.sourceText, ''),
        parseFields: isPlainObject(result?.parseFields) ? result.parseFields : {},
        parseMeta: result?.parseMeta || null,
        providerTrace: result?.providerTrace || null,
        ...fallbackSummary,
        caseIntake: buildCaseIntakeFromParserResult(result, runtime, elapsedMs, imageFixture),
      };
      if (result?.providerTrace?.providerPackageId) {
        bus?.emit('parser.provider_content_sending_to_client', {
          provider,
          providerPackageId: result.providerTrace.providerPackageId,
          testRun: true,
          status: 'sent',
          surfaceToUser: true,
          displayMessage: `Sending providerPackageId: ${result.providerTrace.providerPackageId} content to client - sent`,
        });
      }
      bus?.emit('parser.response_sent', {
        elapsedMs,
        bytes: 0,
        streamMode,
        testRun: true,
      });
      return respondRun(200, responseBody);
    } catch (err) {
      bus?.emit('error', {
        code: err.code || 'PIPELINE_PARSER_TEST_FAILED',
        message: err.message || 'Image Parser test failed.',
        providerPackageId: err.providerTrace?.providerPackageId || null,
        providerHarness: err.providerTrace?.providerHarness || null,
        testRun: true,
      });
      return respondRun(err.statusCode || 422, {
        ok: false,
        stage,
        testRun: true,
        code: err.code || 'PIPELINE_PARSER_TEST_FAILED',
        error: err.message || 'Image Parser test failed.',
        providerTrace: err.providerTrace || null,
      });
    } finally {
      parserTestInFlight = false;
    }
  }

  if (stage === 'inv') {
    const fixture = await readCaseFixture();
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
    const fixture = await readCaseFixture();
    const runtime = getAgentRuntime(runtimeMap, 'triage-agent');
    const provider = safeString(runtime.provider, '') || 'lm-studio';
    const model = safeString(runtime.model, '');
    const result = await runTriage(fixture.parserText, {
      provider,
      model,
      reasoningEffort: getReasoningEffort(runtimeMap),
      timeoutMs: TEST_TIMEOUT_MS,
      // Wave 2 universal failover: honor the operator's configured triage backup
      // (defaults to the neutral global alternate server-side). No capability logic.
      fallbackProvider: safeString(runtime.fallbackProvider, ''),
      fallbackModel: safeString(runtime.fallbackModel, ''),
      agentRuntime: runtime,
    });
    return res.json({
      ok: Boolean(result?.card),
      stage,
      testRun: true,
      alert: 'Test result only - not part of the live escalation log.',
      providerUsed: result?.providerUsed || provider,
      modelUsed: result?.modelUsed || model || getProviderModelId(provider) || '',
      elapsedMs: result?.elapsedMs || result?.triageMeta?.latencyMs || 0,
      triageCard: result?.card || null,
      triageMeta: result?.triageMeta || null,
      context: {
        triageCard: result?.card || null,
        triageMeta: result?.triageMeta || null,
      },
    });
  }

  if (stage === 'main') {
    const fixture = await readCaseFixture();
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
// Reuse hooks for sibling routes (e.g. routes/triage-tests.js). Attaching these
// to the router keeps a single owner for "list image fixtures + resolve their
// approved templates" — the triage test route consumes the SAME real, operator-
// approved asset pipeline instead of re-deriving it.
module.exports.listImageParserTestAssets = listImageParserTestAssets;
module.exports.listTriageTemplateAssets = listTriageTemplateAssets;
