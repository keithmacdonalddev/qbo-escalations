'use strict';

const WorkspaceConversation = require('../models/WorkspaceConversation');

const MAX_WORKSPACE_HISTORY_MESSAGES = 20;

function cleanWorkspaceConversationHistoryText(content) {
  return String(content || '')
    .replace(/^✓ PM rules loaded\s*/i, '')
    .replace(/Feature (?:logged|suggestion|idea)[^\n]*/gi, '')
    .replace(/Special Feature:[^\n]*/gi, '')
    .trim();
}

function normalizeWorkspaceConversationMessages(messages, limit = MAX_WORKSPACE_HISTORY_MESSAGES) {
  const normalized = [];

  if (!Array.isArray(messages)) {
    return normalized;
  }

  for (const msg of messages.slice(-limit)) {
    if (!msg || (msg.role !== 'user' && msg.role !== 'assistant') || typeof msg.content !== 'string') {
      continue;
    }

    const cleaned = cleanWorkspaceConversationHistoryText(msg.content);
    if (cleaned) {
      normalized.push({ role: msg.role, content: cleaned });
    }
  }

  return normalized;
}

async function loadWorkspaceConversationMessages({
  conversationSessionId,
  conversationHistory,
  fullPrompt,
  historyLimit = MAX_WORKSPACE_HISTORY_MESSAGES,
} = {}) {
  const messages = [];

  if (conversationSessionId) {
    try {
      const stored = await WorkspaceConversation.getHistory(conversationSessionId);
      messages.push(...normalizeWorkspaceConversationMessages(stored, historyLimit));
    } catch (histErr) {
      console.error('[workspace] conversation history load failed:', histErr.message);
    }
  }

  if (messages.length === 0) {
    messages.push(...normalizeWorkspaceConversationMessages(conversationHistory, historyLimit));
  }

  messages.push({ role: 'user', content: String(fullPrompt || '') });
  return messages;
}

function createWorkspaceConversationSaver({ persistentSessionId, prompt }) {
  return function saveWorkspaceConversationTurn(assistantResponse, usage) {
    try {
      const cleanPrompt = String(prompt || '').trim().replace(/^✓ PM rules loaded\s*/i, '');
      const cleanResponse = String(assistantResponse || '').replace(/^✓ PM rules loaded\s*/i, '');

      WorkspaceConversation.appendMessages(persistentSessionId, [
        { role: 'user', content: cleanPrompt },
        { role: 'assistant', content: cleanResponse, usage: usage || undefined },
      ]).catch((saveErr) => {
        console.error('[workspace] conversation save failed:', saveErr.message);
      });
    } catch (saveOuterErr) {
      console.error('[workspace] conversation save outer failed:', saveOuterErr.message);
    }
  };
}

module.exports = {
  createWorkspaceConversationSaver,
  loadWorkspaceConversationMessages,
};
