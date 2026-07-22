'use strict';

const {
  runScheduledModelCheck,
  syncReviewNotifications,
} = require('./ai-management');
const {
  completeBackgroundTask,
  failBackgroundTask,
  startBackgroundTask,
  updateBackgroundService,
} = require('./background-runtime');

const TICK_INTERVAL_MS = 15 * 60 * 1000;
let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  const taskId = startBackgroundTask('ai-model-discovery-scheduler');
  try {
    const beforeCheck = syncReviewNotifications();
    const result = await runScheduledModelCheck(new Date());
    const snapshot = result.snapshot || beforeCheck;
    const meta = {
      ranModelCheck: result.ran === true,
      automaticCheckFrequency: snapshot.automaticCheckFrequency,
      nextScheduledCheckAt: snapshot.nextScheduledCheckAt || null,
      notificationsNeedingReview: snapshot.summary?.notificationsNeedingReview || 0,
    };
    completeBackgroundTask(taskId, meta);
    updateBackgroundService('ai-model-discovery-scheduler', {
      state: 'idle',
      meta,
      lastError: null,
    });
  } catch (error) {
    failBackgroundTask(taskId, error);
  } finally {
    running = false;
  }
}

function startScheduler() {
  if (timer) return;
  updateBackgroundService('ai-model-discovery-scheduler', { state: 'idle' });
  void tick();
  timer = setInterval(() => { void tick(); }, TICK_INTERVAL_MS);
  timer.unref?.();
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}

module.exports = {
  startScheduler,
  stopScheduler,
  tick,
};
