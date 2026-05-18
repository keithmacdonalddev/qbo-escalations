'use strict';

const MAX_EVENTS_PER_RUN = 200;
const MAX_STRING_LEN = 500;
const TRUNCATED_MARKER = '...[truncated]';

// UI events fire as a side-effect of user interaction (opening a popup,
// closing a tab, the server skipping re-parse for a saved conversation) and
// don't represent agent pipeline work. They're displayed in the event log
// for debugging but excluded from counters, denominators, and totals.
const UI_EVENT_KINDS = new Set([
  'parser.popup_opened',
  'parser.popup_closed',
  'parser.replay_skipped',
]);

function categoryForKind(kind) {
  return UI_EVENT_KINDS.has(kind) ? 'ui' : 'run';
}

// Date.now() resolution is 1ms; multiple events emitted in the same tick would
// share a wall-clock timestamp. Anchor the bus to wall time once on creation
// and read sub-millisecond offsets from performance.now() so each event gets a
// unique, monotonically increasing ts even when fired back-to-back.
const PERF_AVAILABLE = typeof performance !== 'undefined' && typeof performance.now === 'function';

function currentTimestamp(anchor) {
  if (!anchor) return Date.now();
  if (!PERF_AVAILABLE) return Date.now();
  const offset = performance.now() - anchor.perfStart;
  return anchor.wallStart + offset;
}

function truncateString(value) {
  if (typeof value !== 'string') return value;
  if (value.length <= MAX_STRING_LEN) return value;
  return value.slice(0, MAX_STRING_LEN - TRUNCATED_MARKER.length) + TRUNCATED_MARKER;
}

function clampData(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return null;
  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => clampData(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    let count = 0;
    for (const key of Object.keys(value)) {
      if (count >= 24) break;
      out[key] = clampData(value[key], depth + 1);
      count += 1;
    }
    return out;
  }
  try {
    return truncateString(String(value));
  } catch {
    return null;
  }
}

function safeSend(send, kind, payload) {
  if (typeof send !== 'function') return;
  try {
    send('stage_event', payload);
  } catch {
    // SSE channel gone — bus continues buffering for persistence
  }
}

/**
 * Create a per-stage event bus that fans out to SSE and buffers for persistence.
 *
 * @param {object} opts
 * @param {function} opts.send  - sendSse(eventName, payload) helper from chat/send.js
 * @param {string}   opts.stageId - 'parser' | 'inv' | 'triage' | 'main'
 * @param {string}   [opts.runId]
 */
function createStageEventBus({ send, stageId, runId } = {}) {
  const buffer = [];
  const resolvedStageId = typeof stageId === 'string' ? stageId : '';
  const resolvedRunId = typeof runId === 'string' ? runId : '';
  const anchor = PERF_AVAILABLE
    ? { wallStart: Date.now(), perfStart: performance.now() }
    : null;
  // Monotonic sequence number so the client can break millisecond ties and
  // render events in the order they fired even if two share `ts`.
  let seq = 0;
  let lastTs = 0;

  function emit(kind, data) {
    if (!kind || typeof kind !== 'string') return;
    // Capture timestamp at emit time, not at flush time. Sub-millisecond
    // precision lets back-to-back emits show different clock readings.
    let ts = currentTimestamp(anchor);
    if (ts <= lastTs) ts = lastTs + 0.001;
    lastTs = ts;
    seq += 1;
    const safeData = clampData(data === undefined ? null : data);
    const event = {
      stageId: resolvedStageId,
      runId: resolvedRunId,
      ts,
      seq,
      kind,
      category: categoryForKind(kind),
      data: safeData,
    };
    if (buffer.length < MAX_EVENTS_PER_RUN) {
      buffer.push(event);
    } else if (buffer.length === MAX_EVENTS_PER_RUN) {
      buffer.push({
        stageId: resolvedStageId,
        runId: resolvedRunId,
        ts,
        seq,
        kind: 'buffer.overflow',
        category: 'run',
        data: { droppedAfter: MAX_EVENTS_PER_RUN },
      });
    }
    safeSend(send, 'stage_event', event);
  }

  function flush() {
    return buffer.slice();
  }

  return { emit, flush, stageId: resolvedStageId, runId: resolvedRunId };
}

/**
 * No-op event bus for code paths where staging events are not needed (e.g.,
 * standalone /api/image-parser/parse). Lets call sites unconditionally invoke
 * emit() without null checks.
 */
function createNoopStageEventBus() {
  return {
    emit() {},
    flush() { return []; },
    stageId: '',
    runId: '',
  };
}

// Insert tiny awaits between back-to-back emits so the monotonic ts also lines
// up with real wall-clock progression. Call sites can also `await delay(0)`
// directly to yield the microtask queue.
function microDelay(ms = 0) {
  return new Promise((resolve) => {
    if (typeof setImmediate === 'function') setImmediate(resolve);
    else setTimeout(resolve, ms);
  });
}

module.exports = {
  createStageEventBus,
  createNoopStageEventBus,
  microDelay,
  categoryForKind,
  UI_EVENT_KINDS,
  MAX_EVENTS_PER_RUN,
  MAX_STRING_LEN,
};
