'use strict';

const { getRoomMeta } = require('./chat-room-service');

const listeners = new Map();
const eventBuffers = new Map();
const MAX_BUFFERED_EVENTS = 300;

function getListenerSet(roomId) {
  let set = listeners.get(roomId);
  if (!set) {
    set = new Set();
    listeners.set(roomId, set);
  }
  return set;
}

function getBufferedEvents(roomId) {
  return eventBuffers.get(roomId) || [];
}

function emitRoomEvent(roomId, eventType, data = {}) {
  const key = String(roomId || '').trim();
  if (!key) return null;

  const nextEvent = {
    seq: Date.now() + Math.floor(Math.random() * 1000),
    type: eventType,
    data,
    at: new Date().toISOString(),
  };

  const existing = getBufferedEvents(key);
  const updated = [...existing, nextEvent].slice(-MAX_BUFFERED_EVENTS);
  eventBuffers.set(key, updated);

  const set = listeners.get(key);
  if (set) {
    for (const listener of set) {
      try {
        listener(nextEvent);
      } catch {
        // Ignore listener failures so one broken websocket client
        // cannot break the room broadcast path.
      }
    }
  }

  return nextEvent;
}

function getRoomEventsSince(roomId, sinceSeq = 0) {
  const key = String(roomId || '').trim();
  const numericSeq = Number.isFinite(Number(sinceSeq)) ? Number(sinceSeq) : 0;
  return getBufferedEvents(key).filter((event) => Number(event.seq) > numericSeq);
}

function subscribeRoom(roomId, listener) {
  const key = String(roomId || '').trim();
  if (!key || typeof listener !== 'function') return () => {};
  const set = getListenerSet(key);
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      listeners.delete(key);
    }
  };
}

async function buildRoomSnapshot(roomId) {
  const room = await getRoomMeta(roomId);
  return {
    roomId: room._id ? room._id.toString() : String(roomId),
    title: room.title || 'New Room',
    activeAgents: Array.isArray(room.activeAgents) ? room.activeAgents : [],
    settings: room.settings || {},
    messageCount: room.messageCount || 0,
    updatedAt: room.updatedAt || null,
    lastMessagePreview: room.lastMessagePreview || null,
  };
}

module.exports = {
  buildRoomSnapshot,
  emitRoomEvent,
  getRoomEventsSince,
  subscribeRoom,
};
