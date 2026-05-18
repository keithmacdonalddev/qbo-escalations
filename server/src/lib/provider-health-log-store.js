'use strict';

const fs = require('fs/promises');
const path = require('path');

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;
const MAX_TEXT = 500;

function getLogPath() {
  return process.env.PROVIDER_HEALTH_LOG_PATH
    || path.join(__dirname, '..', '..', 'data', 'provider-health-checks.jsonl');
}

function safeText(value, maxLength = MAX_TEXT) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : String(value);
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function compactUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  return {
    model: safeText(usage.model, 120),
    inputTokens: Number.isFinite(usage.inputTokens) ? usage.inputTokens : usage.input_tokens ?? null,
    outputTokens: Number.isFinite(usage.outputTokens) ? usage.outputTokens : usage.output_tokens ?? null,
    totalTokens: Number.isFinite(usage.totalTokens) ? usage.totalTokens : usage.total_tokens ?? null,
  };
}

function compactEndpoint(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    provider: safeText(entry.provider, 80),
    providerLabel: safeText(entry.providerLabel, 120),
    model: safeText(entry.model, 160),
    status: safeText(entry.status, 40),
    code: safeText(entry.code, 80),
    message: safeText(entry.message, 260),
    diagnostic: safeText(entry.diagnostic, 320),
    checkedAt: safeText(entry.checkedAt, 80),
    latencyMs: Number.isFinite(entry.latencyMs) ? entry.latencyMs : null,
    usage: compactUsage(entry.usage),
  };
}

function compactCanary(canary) {
  if (!canary || typeof canary !== 'object') return null;
  return {
    ok: canary.ok === true,
    status: safeText(canary.status, 40),
    code: safeText(canary.code, 80),
    message: safeText(canary.message, 260),
    diagnostic: safeText(canary.diagnostic, 320),
    providerUsed: safeText(canary.providerUsed, 80),
    modelUsed: safeText(canary.modelUsed, 160),
    fallbackUsed: canary.fallbackUsed === true,
    checkedAt: safeText(canary.checkedAt, 80),
    latencyMs: Number.isFinite(canary.latencyMs) ? canary.latencyMs : null,
    usage: compactUsage(canary.usage),
    attempts: Array.isArray(canary.attempts)
      ? canary.attempts.slice(0, 4).map((attempt) => ({
          provider: safeText(attempt.provider, 80),
          model: safeText(attempt.model, 160),
          status: safeText(attempt.status, 40),
          code: safeText(attempt.code, 80),
          latencyMs: Number.isFinite(attempt.latencyMs) ? attempt.latencyMs : null,
        }))
      : [],
  };
}

function buildProviderHealthLogEntry(snapshot, meta = {}) {
  const checkedAt = safeText(snapshot?.checkedAt) || new Date().toISOString();
  return {
    id: `${checkedAt}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
    checkedAt,
    trigger: safeText(meta.trigger || snapshot?.trigger || 'unknown', 40),
    healthLevel: safeText(snapshot?.healthLevel, 40),
    defaultMode: safeText(snapshot?.defaultMode, 40),
    reasoningEffort: safeText(snapshot?.reasoningEffort, 40),
    timeoutMs: Number.isFinite(snapshot?.timeoutMs) ? snapshot.timeoutMs : null,
    effective: {
      status: safeText(snapshot?.effective?.status, 40),
      heartbeatStatus: safeText(snapshot?.effective?.heartbeatStatus, 40),
      readinessStatus: safeText(snapshot?.effective?.readinessStatus, 40),
      canaryStatus: safeText(snapshot?.effective?.canaryStatus, 40),
      confidence: safeText(snapshot?.effective?.confidence, 80),
      active: snapshot?.effective?.active === true,
      message: safeText(snapshot?.effective?.message, 320),
    },
    primary: compactEndpoint(snapshot?.primary),
    fallback: compactEndpoint(snapshot?.fallback),
    readiness: snapshot?.readiness
      ? {
          checkedAt: safeText(snapshot.readiness.checkedAt, 80),
          primary: compactEndpoint(snapshot.readiness.primary),
          fallback: compactEndpoint(snapshot.readiness.fallback),
        }
      : null,
    canary: compactCanary(snapshot?.canary),
  };
}

async function appendProviderHealthLog(snapshot, meta = {}) {
  const entry = buildProviderHealthLogEntry(snapshot, meta);
  try {
    const logPath = getLogPath();
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    console.warn('[provider-health-log] write failed:', err.message);
  }
  return entry;
}

async function listProviderHealthLogs(options = {}) {
  const limitRaw = Number.parseInt(options.limit, 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(limitRaw, MAX_LIMIT)
    : DEFAULT_LIMIT;

  try {
    const raw = await fs.readFile(getLogPath(), 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).reverse().map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

module.exports = {
  appendProviderHealthLog,
  buildProviderHealthLogEntry,
  listProviderHealthLogs,
};
