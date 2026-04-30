'use strict';

const activeSessions = new Map();
const sessionControllers = new Map();

const PRUNE_STALE_MS = 10 * 60 * 1000; // 10 minutes
const PRUNE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const PRUNE_ABORT_GRACE_MS = 30_000; // allow abort handlers time to unwind
let _pruneInterval = null;

// --- Cross-request coordination (chat agent <-> background monitor) ---
let _chatAgentLock = false;
let _chatAgentLockAt = 0;
let _chatAgentLockOwner = null;
const LOCK_TIMEOUT_MS = 3 * 60 * 1000; // 3 min auto-release

const _recentlyProcessed = new Map(); // messageId -> timestamp
const RECENTLY_PROCESSED_TTL = 10 * 60 * 1000; // 10 min
const MAX_RECENTLY_PROCESSED = 200;

function acquireChatLock(ownerId = 'unknown') {
  // Check for stale lock (auto-release after timeout)
  if (_chatAgentLock && _chatAgentLockAt && (Date.now() - _chatAgentLockAt > LOCK_TIMEOUT_MS)) {
    console.warn(`[workspace-runtime] Auto-releasing stale chat lock held by ${_chatAgentLockOwner} for ${Date.now() - _chatAgentLockAt}ms`);
    _chatAgentLock = false;
    _chatAgentLockAt = 0;
    _chatAgentLockOwner = null;
  }

  // Check-and-set: if already locked, return false
  if (_chatAgentLock) return false;

  _chatAgentLock = true;
  _chatAgentLockAt = Date.now();
  _chatAgentLockOwner = ownerId;
  return true;
}

function releaseChatLock(ownerId = null) {
  if (ownerId && _chatAgentLockOwner && ownerId !== _chatAgentLockOwner) {
    return false;
  }
  _chatAgentLock = false;
  _chatAgentLockAt = 0;
  _chatAgentLockOwner = null;
  return true;
}

function isChatAgentActive() {
  // Auto-release stale locks
  if (_chatAgentLock && _chatAgentLockAt && (Date.now() - _chatAgentLockAt > LOCK_TIMEOUT_MS)) {
    console.warn(`[workspace-runtime] Auto-releasing stale chat lock held by ${_chatAgentLockOwner} for ${Date.now() - _chatAgentLockAt}ms`);
    _chatAgentLock = false;
    _chatAgentLockAt = 0;
    _chatAgentLockOwner = null;
  }
  return _chatAgentLock;
}

function markMessageProcessed(messageId) {
  _recentlyProcessed.set(messageId, Date.now());
  // TTL-based eviction first, then hard cap as safety net
  if (_recentlyProcessed.size > MAX_RECENTLY_PROCESSED) {
    pruneRecentlyProcessed();
    // If still over cap after TTL prune, FIFO evict oldest
    while (_recentlyProcessed.size > MAX_RECENTLY_PROCESSED) {
      const oldest = _recentlyProcessed.keys().next().value;
      _recentlyProcessed.delete(oldest);
    }
  }
}

function isMessageRecentlyProcessed(messageId) {
  const ts = _recentlyProcessed.get(messageId);
  if (!ts) return false;
  if (Date.now() - ts > RECENTLY_PROCESSED_TTL) {
    _recentlyProcessed.delete(messageId);
    return false;
  }
  return true;
}

function pruneRecentlyProcessed() {
  const cutoff = Date.now() - RECENTLY_PROCESSED_TTL;
  for (const [id, ts] of _recentlyProcessed.entries()) {
    if (ts < cutoff) _recentlyProcessed.delete(id);
  }
}

function pruneStaleWorkspaceSessions() {
  const now = Date.now();
  const cutoff = Date.now() - PRUNE_STALE_MS;
  for (const [id, session] of activeSessions.entries()) {
    if (session.pruneRequestedAt && (now - session.pruneRequestedAt) >= PRUNE_ABORT_GRACE_MS) {
      activeSessions.delete(id);
      sessionControllers.delete(id);
      continue;
    }
    if (session.updatedAt >= cutoff) continue;

    const controller = sessionControllers.get(id);
    if (controller && typeof controller.abort === 'function' && !session.pruneRequestedAt) {
      try {
        controller.abort('Workspace session pruned after inactivity');
      } catch {
        activeSessions.delete(id);
        sessionControllers.delete(id);
        continue;
      }
      const nextSession = activeSessions.get(id);
      if (nextSession) {
        nextSession.pruneRequestedAt = now;
        nextSession.phase = 'aborting';
        nextSession.lastError = 'Workspace session pruned after inactivity';
      }
      continue;
    }

    activeSessions.delete(id);
    sessionControllers.delete(id);
  }
  // Piggyback: prune expired recently-processed message IDs
  pruneRecentlyProcessed();
}

function startPruning() {
  if (_pruneInterval) return;
  _pruneInterval = setInterval(() => {
    pruneStaleWorkspaceSessions();
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
if (process.env.DISABLE_RUNTIME_PRUNING !== '1') {
  startPruning();
}

function createSessionId() {
  return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneSession(session) {
  if (!session || typeof session !== 'object') return null;
  const now = Date.now();
  const startedAt = Number.isFinite(session.startedAt) ? session.startedAt : now;
  const updatedAt = Number.isFinite(session.updatedAt) ? session.updatedAt : now;
  return {
    id: session.id || null,
    phase: session.phase || 'unknown',
    promptPreview: session.promptPreview || '',
    hasContext: Boolean(session.hasContext),
    conversationLength: session.conversationLength || 0,
    clientConnected: session.clientConnected !== false,
    startedAt: new Date(startedAt).toISOString(),
    updatedAt: new Date(updatedAt).toISOString(),
    ageMs: now - startedAt,
    idleMs: now - updatedAt,
    pass1: session.pass1 && typeof session.pass1 === 'object' ? { ...session.pass1 } : { chunks: 0, chars: 0, completedAt: null },
    pass2: session.pass2 && typeof session.pass2 === 'object' ? { ...session.pass2 } : { chunks: 0, chars: 0, completedAt: null },
    actions: session.actions && typeof session.actions === 'object' ? { ...session.actions } : { planned: 0, completed: 0, failed: 0 },
    lastError: session.lastError || null,
  };
}

function createWorkspaceSession({ prompt, context, conversationHistory }) {
  const now = Date.now();
  const entry = {
    id: createSessionId(),
    phase: 'starting',
    promptPreview: String(prompt || '').trim().slice(0, 180),
    hasContext: Boolean(context && typeof context === 'object'),
    conversationLength: Array.isArray(conversationHistory) ? conversationHistory.length : 0,
    clientConnected: true,
    startedAt: now,
    updatedAt: now,
    pass1: {
      chunks: 0,
      chars: 0,
      completedAt: null,
    },
    pass2: {
      chunks: 0,
      chars: 0,
      completedAt: null,
    },
    actions: {
      planned: 0,
      completed: 0,
      failed: 0,
    },
    lastError: null,
    pruneRequestedAt: 0,
  };
  activeSessions.set(entry.id, entry);
  return cloneSession(entry);
}

function updateWorkspaceSession(id, patch = {}) {
  const session = activeSessions.get(id);
  if (!session) return null;

  if (patch.phase) session.phase = patch.phase;
  if (patch.clientConnected !== undefined) session.clientConnected = Boolean(patch.clientConnected);
  if (patch.lastError !== undefined) session.lastError = patch.lastError;

  if (patch.pass1 && typeof patch.pass1 === 'object') {
    session.pass1 = { ...session.pass1, ...patch.pass1 };
  }
  if (patch.pass2 && typeof patch.pass2 === 'object') {
    session.pass2 = { ...session.pass2, ...patch.pass2 };
  }
  if (patch.actions && typeof patch.actions === 'object') {
    session.actions = { ...session.actions, ...patch.actions };
  }

  session.updatedAt = Date.now();
  session.pruneRequestedAt = 0;
  return cloneSession(session);
}

function recordWorkspaceChunk(id, passName, text) {
  const session = activeSessions.get(id);
  if (!session) return null;
  const key = passName === 'pass2' ? 'pass2' : 'pass1';
  const nextText = typeof text === 'string' ? text : '';

  session.phase = key;
  session[key].chunks += 1;
  session[key].chars += nextText.length;
  session.updatedAt = Date.now();
  session.pruneRequestedAt = 0;
  return cloneSession(session);
}

function recordWorkspaceActions(id, plannedActions, results) {
  const session = activeSessions.get(id);
  if (!session) return null;

  const planned = Array.isArray(plannedActions) ? plannedActions.length : 0;
  const completed = Array.isArray(results) ? results.filter((item) => !item.error).length : 0;
  const failed = Array.isArray(results) ? results.filter((item) => item.error).length : 0;

  session.phase = planned > 0 ? 'actions' : session.phase;
  session.actions = { planned, completed, failed };
  session.updatedAt = Date.now();
  session.pruneRequestedAt = 0;
  return cloneSession(session);
}

function completeWorkspacePass(id, passName) {
  const session = activeSessions.get(id);
  if (!session) return null;
  const key = passName === 'pass2' ? 'pass2' : 'pass1';
  session[key].completedAt = new Date().toISOString();
  session.updatedAt = Date.now();
  session.pruneRequestedAt = 0;
  return cloneSession(session);
}

function deleteWorkspaceSession(id) {
  sessionControllers.delete(id);
  activeSessions.delete(id);
}

function attachWorkspaceSessionController(id, controller) {
  if (!activeSessions.has(id) || !controller || typeof controller.abort !== 'function') return false;
  sessionControllers.set(id, controller);
  return true;
}

function abortWorkspaceSession(id, reason = 'Workspace session aborted by supervisor') {
  const controller = sessionControllers.get(id);
  if (!controller || typeof controller.abort !== 'function') {
    return { ok: false, code: 'NO_CONTROLLER', error: 'No abort controller registered for workspace session' };
  }
  try {
    controller.abort(reason);
    return { ok: true, id, reason };
  } catch (err) {
    return { ok: false, code: 'ABORT_FAILED', error: err.message || 'Failed to abort workspace session' };
  }
}

function listWorkspaceSessions() {
  return [...activeSessions.values()]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(cloneSession)
    .filter(Boolean);
}

function getWorkspaceRuntimeHealth() {
  const sessions = listWorkspaceSessions();
  const validSessions = sessions.filter(Boolean);
  const longestActiveMs = validSessions.reduce((max, session) => Math.max(max, session.ageMs || 0), 0);
  const stalestIdleMs = validSessions.reduce((max, session) => Math.max(max, session.idleMs || 0), 0);
  const staleSessions = validSessions.filter((session) => session.idleMs >= 30_000);

  return {
    activeSessions: validSessions.length,
    longestActiveMs,
    stalestIdleMs,
    staleCount: staleSessions.length,
    sessions: validSessions,
  };
}

module.exports = {
  createWorkspaceSession,
  updateWorkspaceSession,
  recordWorkspaceChunk,
  recordWorkspaceActions,
  completeWorkspacePass,
  deleteWorkspaceSession,
  attachWorkspaceSessionController,
  abortWorkspaceSession,
  listWorkspaceSessions,
  getWorkspaceRuntimeHealth,
  stopPruning,
  // Cross-request coordination (chat agent <-> background monitor)
  acquireChatLock,
  releaseChatLock,
  isChatAgentActive,
  markMessageProcessed,
  isMessageRecentlyProcessed,
  pruneRecentlyProcessed,
};
