'use strict';

const { scanKnowledgebaseAgent } = require('./knowledgebase-agent-service');

// ---------------------------------------------------------------------------
// Knowledge Base Agent Scheduler — lightweight setInterval-based scheduler
//
// Mirrors workspace-scheduler.js. Runs the Knowledge Base Agent's SAFE,
// READ-ONLY scan on a schedule. The scan (scanKnowledgebaseAgent) only FLAGS
// work — it generates review/attention items (missing drafts, low-quality
// candidates, duplicates, contradictions, stale trusted records). It NEVER
// edits or auto-fills any draft. Unattended auto-fill is explicitly out of
// scope here (that is a separate, opt-in, default-OFF phase).
//
// Behaviour:
//   - Runs once shortly after startup (the immediate tick in startScheduler).
//   - Then re-runs at most once per calendar day (tracks lastRunDate), checked
//     every CHECK_INTERVAL_MS like the workspace briefing scheduler.
//
// Guards (same style as workspace-scheduler.js):
//   - Only runs once per calendar day (lastRunDate)
//   - Skips if MongoDB is not connected (the scan also self-guards and
//     returns status:'skipped', but we check up front to avoid noise)
//   - Non-blocking: errors are logged but never crash the process
// ---------------------------------------------------------------------------

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — matches workspace cadence

const config = {
  enabled: true,
  // Scan options forwarded to scanKnowledgebaseAgent. Read-only proposal
  // generation that persists attention items + an activity record. These are
  // FLAGS for human review — not edits to any draft.
  persistAttention: true,
  persistActivity: true,
};

let intervalId = null;
let lastRunDate = null; // YYYY-MM-DD — ensures at most one scan per day
let running = false; // re-entrancy guard so overlapping ticks cannot stack

/** Return YYYY-MM-DD in local timezone (avoids UTC drift from toISOString) */
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Run the read-only KB agent scan once. Logs a concise result (how many items
 * were flagged). Returns the scan object (or null on guard/skip) for callers
 * and tests. Never throws — failures are logged and swallowed.
 */
async function runScan() {
  const started = Date.now();

  // Guard: check MongoDB is connected (matches workspace-scheduler.js).
  const mongoose = require('mongoose');
  if (mongoose.connection.readyState !== 1) {
    console.log('[kb-agent-scheduler] Skipping scan — MongoDB not connected');
    return null;
  }

  console.log('[kb-agent-scheduler] Running Knowledge Base Agent scan (read-only)...');

  try {
    const scan = await scanKnowledgebaseAgent({
      persistAttention: config.persistAttention,
      persistActivity: config.persistActivity,
    });

    const counts = scan?.counts || {};
    const proposals = counts.proposals || 0;
    const opened = scan?.attention?.opened || 0;
    const durationMs = Date.now() - started;
    console.log(
      `[kb-agent-scheduler] Scan ${scan?.status || 'done'} — ${proposals} item(s) flagged, ${opened} attention item(s) opened (${durationMs}ms)`
    );
    return scan;
  } catch (err) {
    console.error('[kb-agent-scheduler] Scan failed:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scheduler loop
// ---------------------------------------------------------------------------

function shouldRunNow() {
  if (!config.enabled) return false;

  const todayStr = localDateStr();

  // Already ran today
  if (lastRunDate === todayStr) return false;

  return true;
}

function tick() {
  if (running) return; // do not stack overlapping scans
  if (!shouldRunNow()) return;

  const todayStr = localDateStr();
  lastRunDate = todayStr; // Mark immediately to prevent double-runs
  running = true;

  runScan()
    .then((scan) => {
      // If the scan was guarded/skipped (e.g. Mongo not ready yet), reset so
      // the next tick retries today rather than waiting until tomorrow.
      if (!scan && lastRunDate === todayStr) {
        lastRunDate = null;
      }
    })
    .catch((err) => {
      console.error('[kb-agent-scheduler] Scan tick failed:', err.message);
      if (lastRunDate === todayStr) {
        lastRunDate = null; // retry next tick
      }
    })
    .finally(() => {
      running = false;
    });
}

function startScheduler() {
  if (intervalId) return; // Already running
  console.log('[kb-agent-scheduler] Started — read-only scan on startup, then once per day');

  // Run first scan immediately on startup
  tick();

  intervalId = setInterval(tick, CHECK_INTERVAL_MS);
  if (intervalId.unref) intervalId.unref();
}

function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[kb-agent-scheduler] Stopped');
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  runScan,
  shouldRunNow,
  config,
  // exposed for tests
  _setLastRunDate(value) { lastRunDate = value; },
  _getLastRunDate() { return lastRunDate; },
};
