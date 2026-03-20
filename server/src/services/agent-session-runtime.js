'use strict';

const sessions = new Map();
const listeners = new Map();
const controllers = new Map();

const MAX_BUFFERED_EVENTS = 250;
const SESSION_TTL_MS = 15 * 60 * 1000;
const PRUNE_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
const PRUNE_ABORT_GRACE_MS = 30_000;
let _pruneInterval = null;

function nowIso() {
  return new Date().toISOString();
}

function createSessionId(agentType = 'agent') {
  return `${String(agentType || 'agent').toLowerCase()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getListenerSet(id) {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  return set;
}

function emit(id, payload) {
  const set = listeners.get(id);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(payload);
    } catch {
      // Ignore listener failures so one stream cannot break the registry.
    }
  }
}

function pruneExpiredSessions() {
  const now = Date.now();
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions.entries()) {
    if (session.pruneRequestedAtMs && (now - session.pruneRequestedAtMs) >= PRUNE_ABORT_GRACE_MS) {
      sessions.delete(id);
      listeners.delete(id);
      controllers.delete(id);
      continue;
    }
    if (session.updatedAtMs >= cutoff) continue;

    const controller = controllers.get(id);
    if (controller && typeof controller.abort === 'function' && !session.pruneRequestedAtMs) {
      try {
        controller.abort('Agent session pruned after inactivity');
      } catch {
        sessions.delete(id);
        listeners.delete(id);
        controllers.delete(id);
        continue;
      }
      const nextSession = sessions.get(id);
      if (nextSession) {
        nextSession.pruneRequestedAtMs = now;
        nextSession.status = 'aborting';
        nextSession.lastError = nextSession.lastError || 'Agent session pruned after inactivity';
      }
      continue;
    }

    sessions.delete(id);
    listeners.delete(id);
    controllers.delete(id);
  }
}

function cloneSession(session) {
  return {
    id: session.id,
    agentType: session.agentType,
    title: session.title,
    status: session.status,
    metadata: { ...(session.metadata || {}) },
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    attachedClients: session.attachedClients,
    lastEventSeq: session.lastEventSeq,
    lastError: session.lastError || null,
  };
}

function createAgentSession({
  id,
  agentType,
  title,
  metadata,
  status = 'starting',
} = {}) {
  pruneExpiredSessions();
  const sessionId = id || createSessionId(agentType);
  const timestamp = nowIso();
  const entry = {
    id: sessionId,
    agentType: String(agentType || 'agent'),
    title: String(title || agentType || 'Agent'),
    status,
    metadata: metadata && typeof metadata === 'object' ? { ...metadata } : {},
    createdAt: timestamp,
    updatedAt: timestamp,
    updatedAtMs: Date.now(),
    attachedClients: 0,
    lastEventSeq: 0,
    events: [],
    lastError: null,
    pruneRequestedAtMs: 0,
  };
  sessions.set(sessionId, entry);
  return cloneSession(entry);
}

function getAgentSession(id) {
  pruneExpiredSessions();
  const session = sessions.get(id);
  return session ? cloneSession(session) : null;
}

function updateAgentSession(id, patch = {}) {
  const session = sessions.get(id);
  if (!session) return null;
  if (patch.status) session.status = patch.status;
  if (patch.title !== undefined) session.title = String(patch.title || session.title);
  if (patch.lastError !== undefined) session.lastError = patch.lastError;
  if (patch.metadata && typeof patch.metadata === 'object') {
    session.metadata = { ...session.metadata, ...patch.metadata };
  }
  session.updatedAt = nowIso();
  session.updatedAtMs = Date.now();
  session.pruneRequestedAtMs = 0;
  return cloneSession(session);
}

function appendAgentSessionEvent(id, type, data = {}) {
  const session = sessions.get(id);
  if (!session) return null;
  session.lastEventSeq += 1;
  session.updatedAt = nowIso();
  session.updatedAtMs = Date.now();
  const event = {
    seq: session.lastEventSeq,
    type,
    data,
    at: session.updatedAt,
  };
  session.events.push(event);
  if (session.events.length > MAX_BUFFERED_EVENTS) {
    session.events.splice(0, session.events.length - MAX_BUFFERED_EVENTS);
  }
  if (type === 'done') session.status = 'done';
  if (type === 'error') {
    session.status = data?.code === 'ABORTED' ? 'aborted' : 'error';
    session.lastError = data?.error || data?.message || 'Session error';
  }
  emit(id, event);
  session.pruneRequestedAtMs = 0;
  return event;
}

function getAgentSessionEventsSince(id, sinceSeq = 0) {
  const session = sessions.get(id);
  if (!session) return [];
  const seq = Number.isFinite(Number(sinceSeq)) ? Number(sinceSeq) : 0;
  return session.events.filter((event) => event.seq > seq);
}

function listAgentSessions({ agentType, activeOnly = false } = {}) {
  pruneExpiredSessions();
  return [...sessions.values()]
    .filter((session) => (!agentType || session.agentType === agentType))
    .filter((session) => (!activeOnly || !['done', 'error', 'aborted'].includes(session.status)))
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .map(cloneSession);
}

function subscribeAgentSession(id, listener) {
  if (!sessions.has(id)) return () => {};
  const set = getListenerSet(id);
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(id);
  };
}

function setAgentSessionController(id, controller) {
  if (!id) return;
  if (controller && typeof controller.abort === 'function') {
    controllers.set(id, controller);
  } else {
    controllers.delete(id);
  }
}

function abortAgentSession(id, reason = 'Agent session aborted') {
  const controller = controllers.get(id);
  if (!controller || typeof controller.abort !== 'function') {
    return { ok: false, code: 'NO_CONTROLLER', error: 'No abort controller registered for agent session' };
  }
  try {
    controller.abort(reason);
    return { ok: true, id, reason };
  } catch (err) {
    return { ok: false, code: 'ABORT_FAILED', error: err.message || 'Failed to abort agent session' };
  }
}

function attachAgentClient(id) {
  const session = sessions.get(id);
  if (!session) return null;
  session.attachedClients += 1;
  session.updatedAt = nowIso();
  session.updatedAtMs = Date.now();
  session.pruneRequestedAtMs = 0;
  return cloneSession(session);
}

function detachAgentClient(id) {
  const session = sessions.get(id);
  if (!session) return null;
  session.attachedClients = Math.max(0, session.attachedClients - 1);
  session.updatedAt = nowIso();
  session.updatedAtMs = Date.now();
  session.pruneRequestedAtMs = 0;
  return cloneSession(session);
}

function startPruning() {
  if (_pruneInterval) return;
  _pruneInterval = setInterval(() => {
    pruneExpiredSessions();
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

module.exports = {
  createAgentSession,
  getAgentSession,
  updateAgentSession,
  appendAgentSessionEvent,
  getAgentSessionEventsSince,
  listAgentSessions,
  subscribeAgentSession,
  setAgentSessionController,
  abortAgentSession,
  attachAgentClient,
  detachAgentClient,
  createSessionId,
  stopPruning,
};
