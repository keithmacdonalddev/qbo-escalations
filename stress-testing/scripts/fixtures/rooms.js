'use strict';

const {
  pollUntil,
  requestJson,
  requestSse,
  requireEvent,
  requireTerminalEvent,
} = require('../harness-runner-utils');

function getUniqueAgentIds(events, eventName) {
  return new Set(
    events
      .filter((event) => event.event === eventName)
      .map((event) => event.data.agentId)
      .filter(Boolean)
  );
}

async function createRoom(baseUrl, payload, options = {}) {
  const response = await requestJson(baseUrl, '/api/rooms', {
    method: 'POST',
    json: payload,
    ...options,
  });

  return {
    response,
    roomId: response.data.room._id,
    room: response.data.room,
  };
}

async function sendRoomTurn(baseUrl, roomId, payload, options = {}) {
  const response = await requestSse(baseUrl, `/api/rooms/${roomId}/send`, {
    method: 'POST',
    json: payload,
    timeoutMs: 180_000,
    ...options,
  });
  const roomStartEvent = requireEvent(response.events, 'room_start');
  const agentStartEvent = requireEvent(response.events, 'agent_start');
  const roomDoneEvent = requireEvent(response.events, 'room_done');
  requireTerminalEvent(response.events);

  return {
    response,
    events: response.events,
    roomStartEvent,
    agentStartEvent,
    roomDoneEvent,
    agentDoneEvents: response.events.filter((event) => event.event === 'agent_done'),
    uniqueAgentStartIds: getUniqueAgentIds(response.events, 'agent_start'),
    uniqueAgentDoneIds: getUniqueAgentIds(response.events, 'agent_done'),
  };
}

async function waitForRoomAssistantCount(baseUrl, roomId, minimumCount, {
  timeoutMs = 10_000,
  description = 'persisted room messages',
} = {}) {
  return pollUntil(
    async () => {
      const response = await requestJson(baseUrl, `/api/rooms/${roomId}`);
      const messages = response.data.room.messages || [];
      const assistantCount = messages.filter((message) => message.role === 'assistant').length;
      return assistantCount >= minimumCount
        ? {
          room: response.data.room,
          assistantCount,
          messageCount: messages.length,
        }
        : null;
    },
    {
      timeoutMs,
      description,
    }
  );
}

module.exports = {
  createRoom,
  getUniqueAgentIds,
  sendRoomTurn,
  waitForRoomAssistantCount,
};
