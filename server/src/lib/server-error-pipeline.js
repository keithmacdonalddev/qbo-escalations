'use strict';

// ---------------------------------------------------------------------------
// Server Error Pipeline
//
// Central collector and broadcaster for server-side errors.
// Errors are stored in a ring buffer and broadcast to subscribers.
// ---------------------------------------------------------------------------

/** @type {Set<function>} */
const _subscribers = new Set();

/** @type {Array<Object>} Ring buffer — last MAX_RECENT errors */
const _recentErrors = [];
const MAX_RECENT = 50;

// Dedup window: suppress identical messages within DEDUP_WINDOW_MS
const _recentHashes = new Map(); // hash -> timestamp
const DEDUP_WINDOW_MS = 5_000;
const DEDUP_CLEANUP_INTERVAL_MS = 60_000; // periodic cleanup every 60s

function _hash(message, source) {
  return `${source || ''}::${message || ''}`;
}

function _isDuplicate(message, source) {
  const key = _hash(message, source);
  const now = Date.now();
  const last = _recentHashes.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return true;
  _recentHashes.set(key, now);
  // Prune old entries every 50 inserts
  if (_recentHashes.size > 100) {
    for (const [k, ts] of _recentHashes) {
      if (now - ts > DEDUP_WINDOW_MS) _recentHashes.delete(k);
    }
  }
  return false;
}

/**
 * Report a server-side error to the pipeline.
 *
 * @param {Object} opts
 * @param {string} [opts.type='server-error'] - Event type
 * @param {string} opts.message - Short error description
 * @param {string} [opts.detail] - Longer context
 * @param {string} [opts.stack] - Stack trace
 * @param {string} [opts.source] - Origin (e.g. 'process', 'mongodb', 'claude.js')
 * @param {string} [opts.category] - Error category
 * @param {string} [opts.severity] - 'error' | 'warning' | 'info'
 */
function reportServerError({ type, message, detail, stack, source, category, severity }) {
  // Dedup rapid-fire identical errors
  if (_isDuplicate(message, source)) return;

  const entry = {
    type: type || 'server-error',
    message: message || 'Unknown server error',
    detail: detail || '',
    stack: stack || '',
    source: source || 'unknown',
    category: category || 'other',
    severity: severity || 'error',
    timestamp: Date.now(),
  };

  // Push to ring buffer
  _recentErrors.push(entry);
  if (_recentErrors.length > MAX_RECENT) _recentErrors.shift();

  // Broadcast to SSE subscribers
  for (const cb of _subscribers) {
    try { cb(entry); } catch { /* subscriber error — silently drop */ }
  }
}

/**
 * Subscribe to real-time server error events.
 * @param {function} callback - Called with each error entry
 * @returns {function} unsubscribe
 */
function subscribe(callback) {
  _subscribers.add(callback);
  return () => _subscribers.delete(callback);
}

/**
 * Get a copy of the recent error ring buffer.
 * @returns {Array<Object>}
 */
function getRecentErrors() {
  return [..._recentErrors];
}

/**
 * Current circuit breaker stats (for diagnostics).
 */
function getStats() {
  return {
    subscribers: _subscribers.size,
    recentCount: _recentErrors.length,
  };
}

// Periodic background cleanup — delete expired dedup hashes every 60s
let _dedupCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of _recentHashes) {
    if (now - ts > DEDUP_WINDOW_MS) _recentHashes.delete(k);
  }
}, DEDUP_CLEANUP_INTERVAL_MS);
if (_dedupCleanupInterval.unref) _dedupCleanupInterval.unref();

function stopErrorPipeline() {
  if (_dedupCleanupInterval) {
    clearInterval(_dedupCleanupInterval);
    _dedupCleanupInterval = null;
  }
}

module.exports = { reportServerError, subscribe, getRecentErrors, getStats, stopErrorPipeline };
