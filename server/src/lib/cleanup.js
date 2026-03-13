'use strict';

const DevConversation = require('../models/DevConversation');
const DevAgentLog = require('../models/DevAgentLog');
const {
  startBackgroundTask,
  completeBackgroundTask,
  failBackgroundTask,
  updateBackgroundService,
} = require('../services/background-runtime');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 30_000;
const MAX_CHANNELS_KEPT = 3;

const BACKGROUND_CHANNEL_TYPES = ['auto-errors', 'code-reviews', 'quality-scans'];

/**
 * Run all cleanup tasks:
 * 1. Delete DevConversation docs older than 30 days
 * 2. Prune background channels to last 3 per type
 * 3. Backup TTL: delete DevAgentLog older than 7 days
 */
async function runCleanup() {
  const results = { conversations: 0, logs: 0, channels: 0 };
  const taskId = startBackgroundTask('cleanup', { trigger: 'scheduled' });

  try {
    // 1. Delete stale conversations (>30 days since last update)
    const convResult = await DevConversation.deleteMany({
      updatedAt: { $lt: new Date(Date.now() - THIRTY_DAYS_MS) },
    });
    results.conversations = convResult.deletedCount || 0;

    // 2. Prune background channels to last MAX_CHANNELS_KEPT per type
    for (const channelType of BACKGROUND_CHANNEL_TYPES) {
      const conversations = await DevConversation.find({ channelType })
        .sort({ updatedAt: -1 })
        .select('_id')
        .lean();

      if (conversations.length > MAX_CHANNELS_KEPT) {
        const toDelete = conversations.slice(MAX_CHANNELS_KEPT).map((c) => c._id);
        const delResult = await DevConversation.deleteMany({ _id: { $in: toDelete } });
        results.channels += delResult.deletedCount || 0;
      }
    }

    // 3. Backup TTL: delete DevAgentLog older than 7 days
    //    (in case MongoDB's TTL monitor hasn't run yet)
    const logResult = await DevAgentLog.deleteMany({
      createdAt: { $lt: new Date(Date.now() - SEVEN_DAYS_MS) },
    });
    results.logs = logResult.deletedCount || 0;

    const total = results.conversations + results.logs + results.channels;
    if (total > 0) {
      console.log('[cleanup] Removed:', results);
    }
    completeBackgroundTask(taskId, results);
  } catch (err) {
    console.error('[cleanup] Error:', err.message);
    failBackgroundTask(taskId, err, results);
  }

  return results;
}

// --- Scheduling ---

let cleanupInterval = null;
let startupTimer = null;

/**
 * Schedule cleanup: run once after STARTUP_DELAY_MS, then every 6 hours.
 */
function startCleanupSchedule() {
  updateBackgroundService('cleanup', {
    state: 'scheduled',
    meta: { startupDelayMs: STARTUP_DELAY_MS, intervalMs: SIX_HOURS_MS },
  });
  startupTimer = setTimeout(() => {
    startupTimer = null;
    runCleanup();
    cleanupInterval = setInterval(runCleanup, SIX_HOURS_MS);
    updateBackgroundService('cleanup', {
      state: 'idle',
      meta: { startupDelayMs: STARTUP_DELAY_MS, intervalMs: SIX_HOURS_MS, scheduled: true },
    });
  }, STARTUP_DELAY_MS);
}

/**
 * Stop the recurring cleanup interval (for graceful shutdown).
 */
function stopCleanupSchedule() {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  updateBackgroundService('cleanup', {
    state: 'stopped',
    meta: { scheduled: false },
  });
}

module.exports = { runCleanup, startCleanupSchedule, stopCleanupSchedule };
