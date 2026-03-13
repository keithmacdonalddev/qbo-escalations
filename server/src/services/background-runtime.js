'use strict';

const activeTasks = new Map();
const services = new Map();

const PRUNE_TASK_STALE_MS = 15 * 60 * 1000; // 15 minutes
const PRUNE_SERVICE_IDLE_MS = 30 * 60 * 1000; // 30 minutes
const PRUNE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let _pruneInterval = null;

function pruneStaleBackgroundTasks() {
  const now = Date.now();
  const taskCutoff = now - PRUNE_TASK_STALE_MS;
  for (const [id, task] of activeTasks.entries()) {
    if (task.updatedAt < taskCutoff) {
      activeTasks.delete(id);
    }
  }

  const serviceCutoff = now - PRUNE_SERVICE_IDLE_MS;
  for (const [name, service] of services.entries()) {
    if (service.state === 'idle' && service.updatedAt < serviceCutoff) {
      services.delete(name);
    }
  }
}

function startPruning() {
  if (_pruneInterval) return;
  _pruneInterval = setInterval(() => {
    pruneStaleBackgroundTasks();
  }, PRUNE_INTERVAL_MS);
  if (_pruneInterval.unref) _pruneInterval.unref();
}

function stopPruning() {
  if (_pruneInterval) {
    clearInterval(_pruneInterval);
    _pruneInterval = null;
  }
}

// Auto-start
startPruning();

function cloneTask(task) {
  const now = Date.now();
  return {
    id: task.id,
    name: task.name,
    phase: task.phase,
    meta: task.meta || null,
    startedAt: new Date(task.startedAt).toISOString(),
    updatedAt: new Date(task.updatedAt).toISOString(),
    ageMs: now - task.startedAt,
    idleMs: now - task.updatedAt,
    lastError: task.lastError || null,
  };
}

function cloneService(entry) {
  const now = Date.now();
  const updatedAt = entry.updatedAt || entry.startedAt || now;
  return {
    name: entry.name,
    state: entry.state || 'idle',
    meta: entry.meta || null,
    activeCount: entry.activeCount || 0,
    startedAt: entry.startedAt ? new Date(entry.startedAt).toISOString() : null,
    updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
    lastCompletedAt: entry.lastCompletedAt ? new Date(entry.lastCompletedAt).toISOString() : null,
    ageMs: updatedAt ? now - updatedAt : null,
    lastError: entry.lastError || null,
  };
}

function ensureService(name) {
  if (!services.has(name)) {
    services.set(name, {
      name,
      state: 'idle',
      meta: null,
      activeCount: 0,
      startedAt: null,
      updatedAt: Date.now(),
      lastCompletedAt: null,
      lastError: null,
    });
  }
  return services.get(name);
}

function createTaskId(name) {
  return `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function startBackgroundTask(name, meta = null) {
  const now = Date.now();
  const task = {
    id: createTaskId(name),
    name,
    phase: 'running',
    meta,
    startedAt: now,
    updatedAt: now,
    lastError: null,
  };
  activeTasks.set(task.id, task);

  const service = ensureService(name);
  service.state = 'running';
  service.meta = meta;
  service.activeCount += 1;
  service.startedAt = service.startedAt || now;
  service.updatedAt = now;

  return task.id;
}

function completeBackgroundTask(id, meta = null) {
  const task = activeTasks.get(id);
  if (!task) return null;

  task.phase = 'completed';
  task.meta = meta !== null ? meta : task.meta;
  task.updatedAt = Date.now();

  const service = ensureService(task.name);
  service.activeCount = Math.max(0, (service.activeCount || 0) - 1);
  service.state = service.activeCount > 0 ? 'running' : 'idle';
  service.meta = task.meta;
  service.updatedAt = task.updatedAt;
  service.lastCompletedAt = task.updatedAt;
  service.lastError = null;

  activeTasks.delete(id);
  return cloneTask(task);
}

function failBackgroundTask(id, error, meta = null) {
  const task = activeTasks.get(id);
  if (!task) return null;

  const lastError = error ? {
    message: error.message || String(error),
    stack: error.stack || '',
  } : {
    message: 'Unknown background task failure',
    stack: '',
  };

  task.phase = 'error';
  task.meta = meta !== null ? meta : task.meta;
  task.updatedAt = Date.now();
  task.lastError = lastError;

  const service = ensureService(task.name);
  service.activeCount = Math.max(0, (service.activeCount || 0) - 1);
  service.state = 'error';
  service.meta = task.meta;
  service.updatedAt = task.updatedAt;
  service.lastError = lastError;

  activeTasks.delete(id);
  return cloneTask(task);
}

function updateBackgroundService(name, patch = {}) {
  const service = ensureService(name);
  if (patch.state !== undefined) service.state = patch.state;
  if (patch.meta !== undefined) service.meta = patch.meta;
  if (patch.activeCount !== undefined) service.activeCount = patch.activeCount;
  if (patch.startedAt !== undefined) service.startedAt = patch.startedAt;
  if (patch.lastCompletedAt !== undefined) service.lastCompletedAt = patch.lastCompletedAt;
  if (patch.lastError !== undefined) service.lastError = patch.lastError;
  service.updatedAt = Date.now();
  return cloneService(service);
}

function getBackgroundRuntimeHealth() {
  const tasks = [...activeTasks.values()].sort((a, b) => a.startedAt - b.startedAt).map(cloneTask).filter(Boolean);
  const servicesSnapshot = [...services.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).map(cloneService).filter(Boolean);
  const longestActiveMs = tasks.reduce((max, task) => Math.max(max, task.ageMs || 0), 0);
  const staleTasks = tasks.filter((task) => (task.ageMs || 0) >= 30_000);

  return {
    activeTasks: tasks.length,
    longestActiveMs,
    staleCount: staleTasks.length,
    tasks,
    services: servicesSnapshot,
  };
}

module.exports = {
  startBackgroundTask,
  completeBackgroundTask,
  failBackgroundTask,
  updateBackgroundService,
  getBackgroundRuntimeHealth,
  stopPruning,
};
