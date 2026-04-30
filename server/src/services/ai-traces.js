'use strict';

const mongoose = require('mongoose');
const AiTrace = require('../models/AiTrace');
const { getProviderModelId, normalizeProvider } = require('./providers/catalog');

const MAX_EVENTS = 160;
const MAX_ATTEMPTS = 24;

function safeString(value, maxLen = 400) {
  return String(value || '').trim().slice(0, maxLen);
}

function clampInt(value, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Math.round(parsed), max);
}

function clampRatio(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 1000) / 1000;
}

function toDateOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toObjectIdOrNull(value) {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
}

function estimateDataUrlBytes(input) {
  const source = typeof input === 'string' ? input : '';
  if (!source) return 0;
  const commaIndex = source.indexOf(',');
  const base64 = commaIndex >= 0 ? source.slice(commaIndex + 1) : source;
  if (!base64) return 0;
  const sanitized = base64.replace(/\s+/g, '');
  const padding = sanitized.endsWith('==') ? 2 : (sanitized.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((sanitized.length * 3) / 4) - padding);
}

function summarizeUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return {
      model: '',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCostMicros: 0,
      usageAvailable: false,
    };
  }

  const inputTokens = clampInt(usage.inputTokens);
  const outputTokens = clampInt(usage.outputTokens);
  const totalTokens = clampInt(usage.totalTokens || (inputTokens + outputTokens));
  const totalCostMicros = clampInt(usage.totalCostMicros);
  const model = safeString(usage.model || '', 120);
  const usageAvailable = Boolean(
    usage.usageAvailable
      || model
      || inputTokens > 0
      || outputTokens > 0
      || totalTokens > 0
      || totalCostMicros > 0
  );

  return {
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    totalCostMicros,
    usageAvailable,
  };
}

function summarizeAttempt(attempt) {
  if (!attempt || typeof attempt !== 'object') return null;
  const usage = summarizeUsage(attempt.usage);
  return {
    provider: safeString(attempt.provider, 80),
    model: safeString(attempt.model || usage.model || getProviderModelId(attempt.provider), 120),
    status: safeString(attempt.status || (attempt.errorCode ? 'error' : 'ok'), 24),
    latencyMs: clampInt(attempt.latencyMs, 60 * 60 * 1000),
    errorCode: safeString(attempt.errorCode, 80),
    errorMessage: safeString(attempt.errorMessage, 240),
    errorDetail: safeString(attempt.errorDetail, 1200),
    validationScore: Number.isFinite(Number(attempt.validationScore)) ? Number(attempt.validationScore) : null,
    validationIssues: Array.isArray(attempt.validationIssues)
      ? attempt.validationIssues.map((issue) => safeString(issue, 200)).filter(Boolean).slice(0, 12)
      : [],
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    totalCostMicros: usage.totalCostMicros,
    usageAvailable: usage.usageAvailable,
  };
}

function summarizeAttempts(attempts) {
  if (!Array.isArray(attempts)) return [];
  return attempts
    .map(summarizeAttempt)
    .filter(Boolean)
    .slice(0, MAX_ATTEMPTS);
}

function buildImageStats(images) {
  const stats = {
    originalBytesTotal: 0,
    preparedBytesTotal: 0,
    originalPixelCountTotal: 0,
    preparedPixelCountTotal: 0,
    prepDurationMsTotal: 0,
    optimizedCount: 0,
    averageCompressionRatio: 0,
  };

  if (!Array.isArray(images) || images.length === 0) return stats;

  let ratioSum = 0;
  let ratioCount = 0;
  for (const image of images) {
    stats.originalBytesTotal += clampInt(image.originalBytes);
    stats.preparedBytesTotal += clampInt(image.preparedBytes);
    stats.originalPixelCountTotal += clampInt(image.originalWidth) * clampInt(image.originalHeight);
    stats.preparedPixelCountTotal += clampInt(image.preparedWidth) * clampInt(image.preparedHeight);
    stats.prepDurationMsTotal += clampInt(image.prepDurationMs, 60 * 1000);
    if (image.optimized) stats.optimizedCount += 1;
    if (image.compressionRatio > 0) {
      ratioSum += image.compressionRatio;
      ratioCount += 1;
    }
  }

  stats.averageCompressionRatio = ratioCount > 0
    ? Math.round((ratioSum / ratioCount) * 1000) / 1000
    : 0;
  return stats;
}

function normalizeImageMeta(normalizedImages, clientMeta) {
  const images = Array.isArray(normalizedImages) ? normalizedImages : [];
  const meta = Array.isArray(clientMeta) ? clientMeta : [];

  return images.map((src, index) => {
    const entry = meta[index] && typeof meta[index] === 'object' ? meta[index] : {};
    const originalBytes = clampInt(entry.originalBytes, 100 * 1024 * 1024);
    const preparedBytes = clampInt(entry.preparedBytes || estimateDataUrlBytes(src), 100 * 1024 * 1024);
    const originalWidth = clampInt(entry.originalWidth, 20_000);
    const originalHeight = clampInt(entry.originalHeight, 20_000);
    const preparedWidth = clampInt(entry.preparedWidth || entry.width, 20_000);
    const preparedHeight = clampInt(entry.preparedHeight || entry.height, 20_000);
    const compressionRatio = clampRatio(
      entry.compressionRatio || (originalBytes > 0 && preparedBytes > 0 ? preparedBytes / originalBytes : 0)
    );

    return {
      index,
      source: safeString(entry.source || 'upload', 40),
      name: safeString(entry.name, 160),
      mimeType: safeString(entry.mimeType || '', 80),
      originalBytes,
      preparedBytes,
      originalWidth,
      originalHeight,
      preparedWidth,
      preparedHeight,
      optimized: Boolean(entry.optimized),
      textHeavy: Boolean(entry.textHeavy),
      prepDurationMs: clampInt(entry.prepDurationMs, 60 * 1000),
      compressionRatio,
      attachedAt: toDateOrNull(entry.attachedAt),
      preparedAt: toDateOrNull(entry.preparedAt),
    };
  });
}

function buildRequestConfig({
  mode,
  reasoningEffort,
  timeoutMs,
  primaryProvider,
  primaryModel,
  fallbackProvider,
  fallbackModel,
  parallelProviders,
}) {
  const normalizedPrimary = primaryProvider ? normalizeProvider(primaryProvider) : '';
  const normalizedFallback = fallbackProvider ? normalizeProvider(fallbackProvider) : '';
  const normalizedParallel = Array.isArray(parallelProviders)
    ? [...new Set(parallelProviders.map((provider) => normalizeProvider(provider)).filter(Boolean))]
    : [];

  return {
    mode: safeString(mode || 'single', 24) || 'single',
    reasoningEffort: safeString(reasoningEffort || 'high', 24) || 'high',
    timeoutMs: clampInt(timeoutMs, 10 * 60 * 1000),
    primaryProvider: normalizedPrimary,
    primaryModel: normalizedPrimary ? safeString(primaryModel || getProviderModelId(normalizedPrimary), 120) : '',
    fallbackProvider: normalizedFallback,
    fallbackModel: normalizedFallback ? safeString(fallbackModel || getProviderModelId(normalizedFallback), 120) : '',
    parallelProviders: normalizedParallel,
    parallelModels: normalizedParallel.map((provider) => safeString(getProviderModelId(provider), 120)).filter(Boolean),
  };
}

async function createTrace({
  requestId,
  parentTraceId = null,
  service,
  route,
  turnKind = 'send',
  conversationId = null,
  escalationId = null,
  promptPreview = '',
  messageLength = 0,
  normalizedImages = [],
  clientImageMeta = [],
  requested = {},
  resolved = {},
}) {
  const images = normalizeImageMeta(normalizedImages, clientImageMeta);
  const doc = new AiTrace({
    requestId: safeString(requestId, 120),
    parentTraceId: toObjectIdOrNull(parentTraceId),
    service: safeString(service, 24),
    route: safeString(route, 120),
    turnKind: safeString(turnKind, 24),
    conversationId: toObjectIdOrNull(conversationId),
    escalationId: toObjectIdOrNull(escalationId),
    promptPreview: safeString(promptPreview, 240),
    messageLength: clampInt(messageLength, 200_000),
    hasImages: images.length > 0,
    imageCount: images.length,
    images,
    imageStats: buildImageStats(images),
    requested: buildRequestConfig(requested),
    resolved: buildRequestConfig(resolved),
    status: 'running',
  });
  await doc.save();
  return doc;
}

async function patchTrace(traceId, setPatch = {}) {
  if (!traceId) return null;
  return AiTrace.findByIdAndUpdate(
    traceId,
    { $set: setPatch },
    { returnDocument: 'after' }
  ).lean();
}

async function appendTraceEvent(traceId, event, startedAt = null) {
  if (!traceId || !event) return null;
  const at = toDateOrNull(event.at) || new Date();
  const started = toDateOrNull(startedAt);
  const elapsedMs = event.elapsedMs != null
    ? clampInt(event.elapsedMs, 10 * 60 * 1000)
    : (started ? clampInt(at.getTime() - started.getTime(), 10 * 60 * 1000) : 0);
  const normalized = {
    key: safeString(event.key, 80),
    label: safeString(event.label, 120),
    status: safeString(event.status || 'info', 24),
    at,
    elapsedMs,
    provider: safeString(event.provider, 80),
    model: safeString(event.model, 120),
    code: safeString(event.code, 80),
    message: safeString(event.message, 320),
    detail: event.detail ?? null,
  };

  return AiTrace.findByIdAndUpdate(
    traceId,
    {
      $push: {
        events: {
          $each: [normalized],
          $slice: -MAX_EVENTS,
        },
      },
    },
    { returnDocument: 'after' }
  ).lean();
}

async function setTraceAttempts(traceId, attempts) {
  return patchTrace(traceId, { attempts: summarizeAttempts(attempts) });
}

async function setTraceUsage(traceId, usage) {
  return patchTrace(traceId, { usage: summarizeUsage(usage) });
}

function buildParseStage(meta, status, extra = {}) {
  const validation = meta && meta.validation ? meta.validation : null;
  return {
    traceId: toObjectIdOrNull(extra.traceId),
    status: safeString(status || 'ok', 24),
    mode: safeString(meta && meta.mode ? meta.mode : extra.mode || 'single', 24),
    providerUsed: safeString(meta && meta.providerUsed ? meta.providerUsed : extra.providerUsed, 80),
    modelUsed: safeString(
      extra.modelUsed
        || (meta && meta.providerUsed ? getProviderModelId(meta.providerUsed) : ''),
      120
    ),
    winner: safeString(meta && meta.winner ? meta.winner : (meta && meta.providerUsed ? meta.providerUsed : ''), 80),
    fallbackUsed: Boolean(meta && meta.fallbackUsed),
    fallbackFrom: safeString(meta && meta.fallbackFrom ? meta.fallbackFrom : '', 80),
    usedRegexFallback: Boolean(meta && meta.usedRegexFallback),
    validationScore: validation && Number.isFinite(Number(validation.score)) ? Number(validation.score) : null,
    validationConfidence: safeString(validation ? validation.confidence : '', 40),
    validationIssues: Array.isArray(validation && validation.issues)
      ? validation.issues.map((issue) => safeString(issue, 200)).filter(Boolean).slice(0, 12)
      : [],
    fieldsFound: validation && Number.isFinite(Number(validation.fieldsFound)) ? Number(validation.fieldsFound) : 0,
    latencyMs: clampInt(extra.latencyMs, 10 * 60 * 1000),
    attempts: summarizeAttempts(meta && meta.attempts),
    card: extra.card ?? null,
    startedAt: toDateOrNull(extra.startedAt),
    completedAt: toDateOrNull(extra.completedAt),
    escalationId: toObjectIdOrNull(extra.escalationId),
  };
}

function buildOutcome({
  providerUsed,
  modelUsed,
  winner,
  fallbackUsed,
  fallbackFrom,
  responseRepaired,
  totalMs,
  firstThinkingMs,
  firstChunkMs,
  completedAt,
  errorCode,
  errorMessage,
}) {
  return {
    providerUsed: safeString(providerUsed, 80),
    modelUsed: safeString(modelUsed || (providerUsed ? getProviderModelId(providerUsed) : ''), 120),
    winner: safeString(winner, 80),
    fallbackUsed: Boolean(fallbackUsed),
    fallbackFrom: safeString(fallbackFrom, 80),
    responseRepaired: Boolean(responseRepaired),
    totalMs: clampInt(totalMs, 10 * 60 * 1000),
    firstThinkingMs: clampInt(firstThinkingMs, 10 * 60 * 1000),
    firstChunkMs: clampInt(firstChunkMs, 10 * 60 * 1000),
    completedAt: toDateOrNull(completedAt),
    errorCode: safeString(errorCode, 80),
    errorMessage: safeString(errorMessage, 320),
  };
}

async function linkChildTrace(parentTraceId, childTraceId) {
  if (!parentTraceId || !childTraceId) return null;
  return patchTrace(parentTraceId, {
    'postParse.traceId': toObjectIdOrNull(childTraceId),
  });
}

module.exports = {
  createTrace,
  patchTrace,
  appendTraceEvent,
  setTraceAttempts,
  setTraceUsage,
  buildRequestConfig,
  buildParseStage,
  buildOutcome,
  buildImageStats,
  normalizeImageMeta,
  summarizeAttempts,
  summarizeUsage,
  estimateDataUrlBytes,
  linkChildTrace,
};
