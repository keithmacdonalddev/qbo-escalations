'use strict';

const activeRoomRuns = new Map();

function normalizeRoomId(roomId) {
  return String(roomId || '').trim();
}

function registerRoomOrchestration(roomId, requestId, interrupt) {
  const key = normalizeRoomId(roomId);
  if (!key || !requestId || typeof interrupt !== 'function') return null;

  const record = {
    roomId: key,
    requestId: String(requestId),
    interrupt,
    startedAt: new Date().toISOString(),
  };

  activeRoomRuns.set(key, record);
  return record;
}

function getRoomOrchestration(roomId) {
  const key = normalizeRoomId(roomId);
  if (!key) return null;
  return activeRoomRuns.get(key) || null;
}

function clearRoomOrchestration(roomId, requestId = null) {
  const key = normalizeRoomId(roomId);
  if (!key) return false;

  const current = activeRoomRuns.get(key);
  if (!current) return false;
  if (requestId && current.requestId !== String(requestId)) return false;

  activeRoomRuns.delete(key);
  return true;
}

function interruptRoomOrchestration(roomId, reason = 'superseded', metadata = {}) {
  const key = normalizeRoomId(roomId);
  if (!key) return null;

  const current = activeRoomRuns.get(key);
  if (!current) return null;

  activeRoomRuns.delete(key);

  try {
    current.interrupt({
      reason,
      roomId: key,
      requestId: current.requestId,
      supersededByRequestId: metadata.supersededByRequestId || null,
      actor: metadata.actor || 'system',
    });
  } catch {
    // Ignore interrupt errors so a stale run cannot block the next one.
  }

  return current;
}

module.exports = {
  clearRoomOrchestration,
  getRoomOrchestration,
  interruptRoomOrchestration,
  registerRoomOrchestration,
};
