'use strict';

const { buildChatModelContext } = require('../../lib/chat-context-builder');
const { DEFAULT_CHAT_RUNTIME_SETTINGS } = require('../../lib/chat-settings');
const { buildRoomImageContextSection } = require('./image-context-section');

module.exports = {
  id: 'chat',
  name: 'QBO Analyst',
  shortName: 'Analyst',
  icon: 'brain',
  color: '#6366f1',
  role: 'escalation-expert',
  description: 'QBO escalation expert with full playbook knowledge.',
  triggerKeywords: ['escalation', 'customer', 'qbo', 'quickbooks', 'payroll', 'billing'],
  triggerMentions: ['@analyst', '@qbo', '@chat'],
  priority: 10,
  maxContextMessages: 30,
  preferredProvider: 'claude-opus-4-6',
  supportsAgentTools: true,

  /**
   * Build context for the QBO Analyst using the full chat context pipeline.
   *
   * Reuses buildChatModelContext from chat-context-builder.js so this agent
   * gets the same playbook retrieval, token budgeting, history trimming,
   * summarization, and citation support as the main chat.
   *
   * @param {Object[]} roomMessages - Messages from the room, already windowed
   * @param {Object} ctx - Context options (aiSettings, etc.)
   * @returns {{ systemPrompt: string, messagesForModel: Object[], contextDebug: Object }}
   */
  buildContext: async (roomMessages, ctx) => {
    // Normalize room messages for the chat-context-builder.
    // Other agents' messages get a [AgentName] prefix so the LLM can
    // distinguish different speakers. User messages pass through as-is.
    const normalizedMessages = roomMessages.map(msg => {
      if (msg.role === 'assistant' && msg.agentId && msg.agentName) {
        return {
          role: 'assistant',
          content: `[${msg.agentName}]: ${msg.content}`,
        };
      }
      return {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content || '',
      };
    });

    const settings = ctx.aiSettings || DEFAULT_CHAT_RUNTIME_SETTINGS;

    const { systemPrompt, messagesForModel, contextDebug, citations } =
      buildChatModelContext({ normalizedMessages, settings });

    // Append image context when available so the analyst can reference the screenshot.
    const imageContextSection = buildRoomImageContextSection(ctx.parsedImageContext);

    // Append room-awareness instruction so the model knows it's in a
    // multi-agent environment and should complement rather than duplicate.
    const roomAwarePrompt = systemPrompt + imageContextSection + '\n\n' +
      'You are participating in a shared community chat with other persistent agents. ' +
      'You know they exist, you are expected to be aware of them, and you should respond like a real person in an ongoing group rather than a single isolated role. ' +
      'Add value without repeating what others already covered. If another agent answered well, say so briefly and contribute only what is missing. ' +
      'Carry a continuous identity across work and social conversation. ' +
      'If another agent is too quiet and you want their perspective, you are allowed to use the agentProfiles.nudge tool. ' +
      'Do not say you lack the ability to nudge unless you have actually checked your available tools and confirmed it is absent.';

    return {
      systemPrompt: roomAwarePrompt,
      messagesForModel,
      contextDebug,
      citations: citations || [],
    };
  },

  /**
   * QBO Analyst always responds — it's the default agent.
   */
  shouldRespond: (_message, _roomState) => true,
};
