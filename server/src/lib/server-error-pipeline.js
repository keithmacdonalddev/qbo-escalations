'use strict';

const DevAgentLog = require('../models/DevAgentLog');

// ---------------------------------------------------------------------------
// Server Error Pipeline
//
// Central collector and broadcaster for server-side errors.
// Errors are stored in a ring buffer, broadcast to SSE subscribers,
// and logged to DevAgentLog (with circuit breaker to prevent flood).
// ---------------------------------------------------------------------------

/** @type {Set<function>} */
const _subscribers = new Set();

/** @type {Array<Object>} Ring buffer — last MAX_RECENT errors */
const _recentErrors = [];
const MAX_RECENT = 50;

// Circuit breaker: max LOG_LIMIT logged errors per LOG_WINDOW to prevent
// cascading-failure storms from filling MongoDB.
let _logCount = 0;
let _logWindowStart = Date.now();
const LOG_LIMIT = 10;
const LOG_WINDOW = 60_000; // 1 minute

// Dedup window: suppress identical messages within DEDUP_WINDOW_MS
const _recentHashes = new Map(); // hash -> timestamp
const DEDUP_WINDOW_MS = 5_000;

function _hash(message, source) {
  return `${source || ''}::${message || ''}`;
}

function _isDuplicate(message, source) {
  const key = _hash(message, source);
  const now = Date.now();
  const last = _recentHashes.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return true;
  _recentHashes.set(key, now);
  // Prune old entries every 100 inserts
  if (_recentHashes.size > 200) {
    for (const [k, ts] of _recentHashes) {
      if (now - ts > DEDUP_WINDOW_MS) _recentHashes.delete(k);
    }
  }
  return false;
}

function _canLog() {
  const now = Date.now();
  if (now - _logWindowStart > LOG_WINDOW) {
    _logCount = 0;
    _logWindowStart = now;
  }
  return _logCount < LOG_LIMIT;
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
 * @param {string} [opts.category] - DevAgentLog category
 * @param {string} [opts.severity] - 'error' | 'warning' | 'info'
 */
async function reportServerError({ type, message, detail, stack, source, category, severity }) {
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

  // Log to DevAgentLog (with circuit breaker)
  if (_canLog()) {
    _logCount++;
    try {
      await DevAgentLog.create({
        type: 'error-fix',
        summary: `[SERVER] ${message}`,
        detail: `${detail || ''}\n${stack || ''}`.trim().slice(0, 5000),
        category: category || 'other',
        filesAffected: source ? [source] : [],
      });
    } catch (err) {
      // Cannot log the logging failure — just print to stderr
      console.error('[server-error-pipeline] Failed to log to DevAgentLog:', err.message);
    }
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
    logCount: _logCount,
    logLimit: LOG_LIMIT,
    windowRemainingMs: Math.max(0, LOG_WINDOW - (Date.now() - _logWindowStart)),
  };
}

module.exports = { reportServerError, subscribe, getRecentErrors, getStats };
