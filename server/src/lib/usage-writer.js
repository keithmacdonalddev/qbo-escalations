'use strict';

const UsageLog = require('../models/UsageLog');
const { calculateCost } = require('./pricing');

const VALID_SERVICES = new Set(['chat', 'parse', 'dev', 'copilot']);
const VALID_MODES = new Set(['single', 'fallback', 'parallel']);
const VALID_STATUSES = new Set(['ok', 'error', 'timeout', 'abort']);

/**
 * Array of in-flight write promises. Each promise removes itself via .finally()
 * to prevent unbounded growth (R13).
 */
const pending = [];

/**
 * Per-key write chains ensure deterministic first-write-wins ordering.
 */
const writeChains = new Map();

let draining = false;

/** Configurable via USAGE_WRITER_MAX_PENDING env var. */
const MAX_PENDING = (() => {
  const env = Number.parseInt(process.env.USAGE_WRITER_MAX_PENDING, 10);
  return Number.isFinite(env) && env > 0 ? env : 1000;
})();

/** Counters for observability. */
let droppedCount = 0;
let acceptedCount = 0;
let errorCount = 0;

/**
 * Non-blocking usage log write with upsert dedup.
 *
 * Returns true if the write was accepted into the queue, false if dropped
 * (backpressure, draining, or validation failure). Callers can use the return
 * value to surface data-loss signals.
 *
 * @param {Object} data — fields for the UsageLog document
 * @returns {boolean} — true if accepted, false if dropped
 */
function logUsage(data) {
  if (draining) return false;
  if (pending.length >= MAX_PENDING) {
    droppedCount++;
    if (droppedCount === 1 || droppedCount % 100 === 0) {
      console.warn('[usage-writer] backpressure: dropped write #' + droppedCount + ' (pending=' + pending.length + ')');
    }
    return false;
  }
  if (!data || !data.requestId || !data.service || !data.provider) {
    return false;
  }
  if (!VALID_SERVICES.has(data.service)) return false;
  const mode = VALID_MODES.has(data.mode) ? data.mode : 'single';
  const status = VALID_STATUSES.has(data.status) ? data.status : 'error';

  const { model, provider } = data;

  const inputTokens = clampNonNeg(data.inputTokens);
  const outputTokens = clampNonNeg(data.outputTokens);
  const cost = calculateCost(inputTokens, outputTokens, model, provider);

  const usageAvailable = data.usageAvailable === true;
  // When usageAvailable is true, default usageComplete to true (optimistic):
  // the extractor explicitly sets false when extra dimensions are detected,
  // so absence of the field means "presumably complete" — not "incomplete".
  const usageComplete = usageAvailable ? (data.usageComplete !== false) : false;

  const doc = {
    requestId:       data.requestId,
    attemptIndex:    data.attemptIndex ?? 0,
    service:         data.service,
    provider,
    model:           model || '',
    inputTokens,
    outputTokens,
    totalTokens:     inputTokens + outputTokens,
    usageAvailable,
    usageComplete,
    rawUsage:        data.rawUsage ?? null,
    inputCostNanos:   cost.inputCostNanos,
    outputCostNanos:  cost.outputCostNanos,
    totalCostNanos:   cost.totalCostNanos,
    inputCostMicros:  cost.inputCostMicros,
    outputCostMicros: cost.outputCostMicros,
    totalCostMicros:  cost.totalCostMicros,
    rateFound:       cost.rateFound,
    conversationId:  safeObjectId(data.conversationId),
    escalationId:    safeObjectId(data.escalationId),
    category:        data.category || '',
    mode,
    status,
    latencyMs:       data.latencyMs || 0,
    expiresAt:       data.expiresAt || undefined,
  };

  const filter = {
    requestId:    doc.requestId,
    attemptIndex: doc.attemptIndex,
    provider:     doc.provider,
  };

  const dedupKey = doc.requestId + ':' + doc.attemptIndex + ':' + doc.provider;
  const prev = writeChains.get(dedupKey) || Promise.resolve();

  const promise = prev
    .then(() =>
      UsageLog.updateOne(
        filter,
        { $setOnInsert: doc },
        { upsert: true, runValidators: true }
      )
    )
    .then(() => { acceptedCount++; })
    .catch((err) => {
      if (err.code === 11000) return; // expected dedup
      errorCount++;
      console.error('[usage-writer] write failed:', err.message);
    })
    .finally(() => {
      const idx = pending.indexOf(promise);
      if (idx !== -1) pending.splice(idx, 1);
      if (writeChains.get(dedupKey) === promise) {
        writeChains.delete(dedupKey);
      }
    });

  writeChains.set(dedupKey, promise);
  pending.push(promise);
  return true;
}

/**
 * Wait for all in-flight writes to settle, with a timeout guard.
 *
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<{ flushed: boolean, remaining: number }>}
 */
function drainPendingWrites(timeoutMs = 5000) {
  draining = true;

  if (pending.length === 0) {
    return Promise.resolve({ flushed: true, remaining: 0 });
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const remaining = pending.length;
      console.warn('[usage-writer] drain timed out with', remaining, 'writes remaining');
      pending.length = 0;
      writeChains.clear();
      resolve({ flushed: false, remaining });
    }, timeoutMs);

    Promise.allSettled([...pending]).then(() => {
      clearTimeout(timer);
      resolve({ flushed: true, remaining: 0 });
    });
  });
}

/**
 * Health snapshot for monitoring endpoints and alerting.
 */
function getHealth() {
  return {
    pending: pending.length,
    maxPending: MAX_PENDING,
    dropped: droppedCount,
    accepted: acceptedCount,
    errors: errorCount,
    draining,
  };
}

function getPendingCount() { return pending.length; }
function getDroppedCount() { return droppedCount; }

function resetDrain() {
  draining = false;
}

// --- Helpers ---

function clampNonNeg(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;
function safeObjectId(value) {
  if (!value) return null;
  const str = String(value);
  return OBJECT_ID_RE.test(str) ? str : null;
}

module.exports = {
  logUsage,
  drainPendingWrites,
  getPendingCount,
  getDroppedCount,
  getHealth,
  resetDrain,
};
