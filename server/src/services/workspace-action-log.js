'use strict';

/**
 * In-memory ring buffer for workspace agent actions.
 * Provides visibility into what the workspace agent has been doing —
 * catches duplicates, mistakes, and unintended side effects.
 *
 * No persistence — actions are lost on server restart.
 * This is intentional: the log is for live debugging, not auditing.
 */

const MAX_ENTRIES = 200;
let _nextId = 1;
const _buffer = [];

/**
 * Log an agent action to the ring buffer.
 *
 * @param {Object} opts
 * @param {string} opts.action     - Tool name (e.g. 'calendar.createEvent')
 * @param {Object} opts.params     - Parameters passed to the tool (sanitized)
 * @param {*}      opts.result     - Result summary (truncated if needed)
 * @param {string} [opts.status]   - 'ok' | 'error'
 * @param {number} [opts.durationMs] - Execution duration in milliseconds
 * @returns {Object} The logged entry
 */
function logAction({ action, params, result, status = 'ok', durationMs = 0 }) {
  const entry = {
    id: _nextId++,
    action,
    params: sanitizeParams(params),
    result: summarizeResult(result, status),
    status,
    durationMs: Math.round(durationMs),
    timestamp: new Date().toISOString(),
  };

  _buffer.push(entry);

  // FIFO eviction when buffer exceeds max
  while (_buffer.length > MAX_ENTRIES) {
    _buffer.shift();
  }

  return entry;
}

/**
 * Get the most recent N actions.
 *
 * @param {number} [limit=50] - Number of entries to return
 * @returns {Object[]} Most recent actions, newest last
 */
function getRecentActions(limit = 50) {
  const n = Math.max(1, Math.min(limit, _buffer.length));
  return _buffer.slice(-n);
}

/**
 * Get total count of actions logged since server start.
 */
function getTotalCount() {
  return _nextId - 1;
}

/**
 * Clear all entries (useful for dev/debug).
 */
function clear() {
  _buffer.length = 0;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strip large/sensitive fields from params for compact logging.
 * Keeps the log readable without filling memory with base64 blobs.
 */
function sanitizeParams(params) {
  if (!params || typeof params !== 'object') return params;

  const sanitized = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.length > 200) {
      sanitized[key] = value.slice(0, 120) + '...';
    } else if (Array.isArray(value)) {
      sanitized[key] = value.length > 5
        ? `[${value.length} items]`
        : value;
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Produce a short human-readable result summary.
 * Keeps entries compact in the ring buffer.
 */
function summarizeResult(result, status) {
  if (status === 'error') {
    return typeof result === 'string' ? result : (result?.message || result?.error || 'Unknown error');
  }
  if (!result) return null;

  // Gmail message results
  if (result.id && result.threadId) return { id: result.id, threadId: result.threadId };
  // Calendar event results
  if (result.id && result.summary) return { id: result.id, summary: result.summary };
  // List results
  if (Array.isArray(result)) return `${result.length} items`;
  if (result.messages && Array.isArray(result.messages)) return `${result.messages.length} messages`;
  if (result.items && Array.isArray(result.items)) return `${result.items.length} items`;
  if (result.events && Array.isArray(result.events)) return `${result.events.length} events`;
  // Generic ok
  if (result.ok !== undefined) return { ok: result.ok };

  // Fallback: stringify and truncate
  try {
    const s = JSON.stringify(result);
    return s.length > 150 ? s.slice(0, 120) + '...' : result;
  } catch {
    return '[unserializable]';
  }
}

module.exports = { logAction, getRecentActions, getTotalCount, clear };
