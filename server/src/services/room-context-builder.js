'use strict';

const { DEFAULT_CHAT_RUNTIME_SETTINGS } = require('../lib/chat-settings');
const { summarizeMessages } = require('../lib/chat-context-builder');
const { buildRoomMemoryContext } = require('./room-memory');
const { buildRoomRuntimeContext } = require('./room-agent-runtime');
const { buildAgentIdentityOverlay } = require('./room-agents/agent-profiles');
const { SHARED_AGENT_TOOL_LINES } = require('./shared-agent-tools');
const {
  buildCommunityProfilesContext,
  buildIdentityMemoryContext,
  buildRelationshipCoordinationContext,
  getAgentIdentity,
  listAgentIdentities,
} = require('./agent-identity-service');

/**
 * Build context for a specific agent within a room conversation.
 *
 * This is a thin wrapper that:
 * 1. Windows the room's messages to the agent's maxContextMessages limit
 * 2. Delegates to the agent's own buildContext() for actual prompt construction
 *
 * Each agent type controls its own context strategy. The QBO Analyst agent,
 * for example, delegates to buildChatModelContext() for full playbook retrieval,
 * token budgeting, and citation support.
 *
 * @param {Object} agent - Agent definition from registry
 * @param {Object} room - ChatRoom document (with messages array)
 * @param {Object} [opts={}] - Additional context options
 * @param {Object} [opts.aiSettings] - Override for DEFAULT_CHAT_RUNTIME_SETTINGS
 * @returns {Promise<{ systemPrompt: string, messagesForModel: Object[], contextDebug: Object }>}
 */
async function buildAgentContext(agent, room, opts = {}) {
  const messages = Array.isArray(room.messages) ? room.messages : [];
  const maxMessages = agent.maxContextMessages || 30;

  // Summarize older messages instead of dropping them entirely.
  // This preserves conversational context beyond the window limit.
  let summaryMessage = null;
  if (messages.length > maxMessages) {
    const omitted = messages.slice(0, messages.length - maxMessages);
    const summaryMaxChars = DEFAULT_CHAT_RUNTIME_SETTINGS.memory.summaryMaxChars || 1200;
    const summaryText = summarizeMessages(omitted, summaryMaxChars);
    if (summaryText) {
      summaryMessage = {
        role: 'system',
        content: `[Summary of earlier conversation]\n${summaryText}`,
      };
    }
  }

  const windowed = messages.length > maxMessages
    ? messages.slice(-maxMessages)
    : messages;

  // Prepend the summary (if any) so the agent sees compressed older context
  // before the recent windowed messages.
  const contextMessages = summaryMessage
    ? [summaryMessage, ...windowed]
    : windowed;

  // Resolve parsedImageContext: use current-turn value when present,
  // otherwise fall back to the most recent message that carried one.
  let resolvedImageContext = opts.parsedImageContext || null;
  if (!resolvedImageContext) {
    const allMessages = Array.isArray(room.messages) ? room.messages : [];
    for (let i = allMessages.length - 1; i >= 0; i--) {
      if (allMessages[i].parsedImageContext?.transcription) {
        resolvedImageContext = allMessages[i].parsedImageContext;
        break;
      }
    }
  }

  const ctx = {
    aiSettings: opts.aiSettings || DEFAULT_CHAT_RUNTIME_SETTINGS,
    roomId: room._id ? room._id.toString() : null,
    activeAgents: room.activeAgents || [],
    parsedImageContext: resolvedImageContext,
    roomMemory: room.memory || null,
  };

  if (typeof agent.buildContext !== 'function') {
    throw new Error(`Agent "${agent.id}" is missing a buildContext function`);
  }

  const result = await agent.buildContext(contextMessages, ctx);
  const identity = await getAgentIdentity(agent.id);
  const identities = await listAgentIdentities();
  const hasSharedAgentTools = Boolean(agent.supportsAgentTools || agent.supportsTools || agent.useActionFlow);

  return {
    systemPrompt: [
      result.systemPrompt || '',
      'You are sending exactly one chat bubble as yourself. Never write dialogue for another agent, never script a multi-speaker scene, and never include transcript prefixes like "[Copilot]:" or "QBO Analyst:" for anyone else in your final answer. If you want another agent to speak, nudge them or mention them, but do not write their reply for them.',
      buildAgentIdentityOverlay(identity?.profile || agent.id),
      buildRoomRuntimeContext(agent.id, room.activeAgents || [], opts.runtimeSelections || {}),
      buildIdentityMemoryContext(identity),
      buildRelationshipCoordinationContext(identity, room.activeAgents || []),
      hasSharedAgentTools ? SHARED_AGENT_TOOL_LINES : '',
      buildCommunityProfilesContext(agent.id, identities, room.activeAgents || []),
      buildRoomMemoryContext(room.memory || null, agent.id),
    ]
      .filter(Boolean)
      .join('\n\n'),
    messagesForModel: result.messagesForModel || [],
    contextDebug: result.contextDebug || {},
    citations: result.citations || [],
  };
}

module.exports = {
  buildAgentContext,
};
