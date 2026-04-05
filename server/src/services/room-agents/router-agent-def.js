'use strict';

const { buildAgentRoutingDescriptor } = require('./agent-profiles');
const { buildRoomMemoryBrief } = require('../room-memory');

module.exports = {
  id: '__router',
  name: 'Router',
  internal: true,
  preferredProvider: 'claude-sonnet-4-6',
  // Token limits are controlled by the provider/chat-orchestrator, not agent definitions

  /**
   * Build the routing classification prompt.
   *
   * @param {string} userMessage - The user's message text
   * @param {Object[]} availableAgents - Array of public agent definitions
   * @returns {string} The prompt to send to the router model
   */
  buildPrompt: (userMessage, availableAgents, room) => {
    const agentList = availableAgents
      .map(a => buildAgentRoutingDescriptor(a))
      .join('\n');
    const recentMessages = Array.isArray(room?.messages)
      ? room.messages.slice(-6).map((msg) => `${msg.role === 'assistant' ? (msg.agentName || msg.agentId || 'Assistant') : 'User'}: ${String(msg.content || '').slice(0, 180)}`).join('\n')
      : '';
    const roomMemory = buildRoomMemoryBrief(room?.memory || null);

    return `Given this user message and available agents, return JSON only:
{"agents": ["agent-id-1", "agent-id-2"], "reason": "brief reason"}

Available agents:
${agentList}

Recent room context:
${recentMessages || '(none)'}

Room memory:
${roomMemory || '(none)'}

User message: ${userMessage}

Rules:
- Only include agents whose expertise is clearly relevant.
- Respect personality and initiative. Some agents are quieter, some are more socially proactive.
- If the message is social, relational, or about room dynamics, you may include agents whose social style fits even if the topic is not purely task-based.
- If unsure, include the "chat" agent (QBO Analyst) as default.
- Return 1-3 agents maximum.
- Return valid JSON only — no markdown fences, no explanation.`;
  },
};
