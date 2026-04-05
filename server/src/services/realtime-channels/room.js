'use strict';

const {
  buildRoomSnapshot,
  getRoomEventsSince,
  subscribeRoom,
} = require('../room-realtime-runtime');

function createChannelError(code, error) {
  const err = new Error(error);
  err.code = code;
  return err;
}

async function subscribe({ key, params, sendEvent }) {
  const roomId = typeof key === 'string' ? key.trim() : '';
  if (!roomId) {
    throw createChannelError('MISSING_ROOM_ID', 'room subscriptions require a room id');
  }

  const snapshot = await buildRoomSnapshot(roomId);
  const sinceSeq = Number.isFinite(Number(params?.since)) ? Number(params.since) : 0;

  sendEvent('snapshot', snapshot);
  for (const event of getRoomEventsSince(roomId, sinceSeq)) {
    sendEvent(event.type, event.data, { seq: event.seq, at: event.at });
  }

  let active = true;
  const unsubscribe = subscribeRoom(roomId, (event) => {
    if (!active) return;
    sendEvent(event.type, event.data, { seq: event.seq, at: event.at });
  });

  return () => {
    if (!active) return;
    active = false;
    try {
      unsubscribe?.();
    } catch {
      // Ignore listener cleanup failures.
    }
  };
}

module.exports = {
  subscribe,
};
