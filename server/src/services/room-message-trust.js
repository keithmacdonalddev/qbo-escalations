'use strict';

const { serializeUntrustedRoomEvidence } = require('./room-memory');

function normalizeRoomMessageForAgent(message, targetAgentId) {
  const content = typeof message?.content === 'string' ? message.content : '';
  if (message?.role !== 'assistant') return { role: 'user', content };
  if (message?.agentId && message.agentId === targetAgentId) {
    return { role: 'assistant', content };
  }
  return {
    role: 'user',
    content: serializeUntrustedRoomEvidence('cross-agent-message', {
      sourceAgentId: message?.agentId || 'unknown-agent',
      sourceAgentName: message?.agentName || '',
      content,
    }, 8_000),
  };
}

module.exports = { normalizeRoomMessageForAgent };
