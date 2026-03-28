'use strict';

const Conversation = require('../../models/Conversation');
const { normalizeProvider } = require('../../services/providers/registry');
const { buildUsageSubdoc } = require('../../lib/chat-route-helpers');

function isParallelAcceptEnabled() {
  return process.env.FEATURE_CHAT_PARALLEL_ACCEPT !== '0';
}

function isParallelTurnMessage(msg, turnId) {
  return Boolean(
    msg
      && msg.role === 'assistant'
      && msg.mode === 'parallel'
      && msg.attemptMeta
      && msg.attemptMeta.parallel === true
      && msg.attemptMeta.turnId === turnId
  );
}

async function saveConversationLenient(conversation) {
  try {
    await conversation.save();
  } catch (err) {
    if (!err || err.name !== 'ValidationError') throw err;

    // Legacy documents may contain old enum values in message metadata.
    // Fall back to a direct update to avoid blocking new chat activity locally.
    const serializedMessages = Array.isArray(conversation.messages)
      ? conversation.messages.map((msg) => (
        msg && typeof msg.toObject === 'function' ? msg.toObject() : msg
      ))
      : [];
    await Conversation.updateOne(
      { _id: conversation._id },
      {
        $set: {
          title: conversation.title || 'New Conversation',
          provider: normalizeProvider(conversation.provider),
          messages: serializedMessages,
          escalationId: conversation.escalationId || null,
          systemPromptHash: conversation.systemPromptHash || '',
          updatedAt: new Date(),
        },
      }
    );
  }
}

function createTriageCardDetector() {
  let buffer = '';
  let emitted = false;
  const TRIAGE_START = '<!-- TRIAGE_START -->';
  const TRIAGE_END = '<!-- TRIAGE_END -->';
  const MAX_BUFFER = 4096;

  function parseTriageBlock(block) {
    const fields = {};
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/^(Agent|Client|Category|Severity|Read|Action):\s*(.+)$/i);
      if (match) {
        fields[match[1].toLowerCase()] = match[2].trim();
      }
    }
    if (!fields.category || !fields.severity) return null;
    return {
      agent: fields.agent || 'Unknown',
      client: fields.client || 'Unknown',
      category: fields.category,
      severity: fields.severity,
      read: fields.read || '',
      action: fields.action || '',
    };
  }

  function feed(text) {
    if (emitted) {
      return { triageCard: null, passthrough: text };
    }

    buffer += text;

    if (buffer.length > MAX_BUFFER && !buffer.includes(TRIAGE_END)) {
      emitted = true;
      const flushed = buffer;
      buffer = '';
      return { triageCard: null, passthrough: flushed };
    }

    const endIdx = buffer.indexOf(TRIAGE_END);
    if (endIdx === -1) {
      return { triageCard: null, passthrough: '' };
    }

    emitted = true;
    const startIdx = buffer.indexOf(TRIAGE_START);
    const afterEnd = endIdx + TRIAGE_END.length;

    if (startIdx === -1) {
      const flushed = buffer;
      buffer = '';
      return { triageCard: null, passthrough: flushed };
    }

    const blockContent = buffer.slice(startIdx + TRIAGE_START.length, endIdx);
    const parsed = parseTriageBlock(blockContent);
    const remainder = buffer.slice(afterEnd);
    buffer = '';
    return { triageCard: parsed, passthrough: remainder };
  }

  return { feed };
}

function toCandidateFromResult(result) {
  const state = result.status === 'ok'
    ? 'ok'
    : (result.errorCode === 'TIMEOUT' ? 'timeout' : 'error');
  return {
    provider: result.provider,
    content: result.status === 'ok' ? (result.fullResponse || '') : '',
    thinking: typeof result.thinking === 'string' ? result.thinking : '',
    state,
    errorCode: result.status === 'ok' ? '' : (result.errorCode || ''),
    errorMessage: result.status === 'ok' ? '' : (result.errorMessage || ''),
    errorDetail: result.status === 'ok' ? '' : (result.errorDetail || ''),
    latencyMs: Number(result.latencyMs) || 0,
    usage: result.usage ? buildUsageSubdoc(result.usage) : null,
  };
}

function normalizeProviderThinking(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = {};
  for (const [provider, thinking] of Object.entries(value)) {
    if (typeof thinking !== 'string') continue;
    if (!thinking.trim()) continue;
    normalized[provider] = thinking;
  }
  return normalized;
}

function getProviderThinking(providerThinking, provider, fallback = '') {
  if (provider && typeof providerThinking?.[provider] === 'string' && providerThinking[provider].trim()) {
    return providerThinking[provider];
  }
  return typeof fallback === 'string' ? fallback : '';
}

function deriveFallbackReasonCode(fallbackFrom, attempts) {
  if (!fallbackFrom || !Array.isArray(attempts)) return null;
  const failedAttempt = attempts.find((attempt) => (
    attempt
      && attempt.provider === fallbackFrom
      && attempt.status === 'error'
  ));
  return failedAttempt ? (failedAttempt.errorCode || null) : null;
}

function logChatTurn(payload) {
  const base = {
    event: 'chat_turn',
    ts: new Date().toISOString(),
  };
  try {
    console.info(JSON.stringify({ ...base, ...payload }));
  } catch {
    console.info('[chat_turn]', payload && payload.conversationId ? payload.conversationId : '');
  }
}

function ensureMessagesArray(conversation) {
  if (!conversation) return [];
  if (Array.isArray(conversation.messages)) return conversation.messages;
  conversation.messages = [];
  return conversation.messages;
}

function normalizeMessageForModel(message) {
  if (!message || typeof message !== 'object') {
    return { role: 'user', content: '' };
  }
  const role = message.role === 'assistant' || message.role === 'system' ? message.role : 'user';
  return {
    role,
    content: typeof message.content === 'string' ? message.content : String(message.content || ''),
  };
}

function shouldEmitContextDebug(runtimeSettings) {
  return Boolean(
    runtimeSettings
      && runtimeSettings.debug
      && (runtimeSettings.debug.showContextDebug || runtimeSettings.debug.emitContextDebugSse)
  );
}

function buildContextDebugPayload(runtimeSettings, contextDebug, costEstimate) {
  if (!shouldEmitContextDebug(runtimeSettings)) return null;
  if (!contextDebug || typeof contextDebug !== 'object') return null;
  return {
    ...contextDebug,
    costEstimate: costEstimate || null,
  };
}

module.exports = {
  buildContextDebugPayload,
  createTriageCardDetector,
  deriveFallbackReasonCode,
  ensureMessagesArray,
  getProviderThinking,
  isParallelAcceptEnabled,
  isParallelTurnMessage,
  logChatTurn,
  normalizeMessageForModel,
  normalizeProviderThinking,
  saveConversationLenient,
  shouldEmitContextDebug,
  toCandidateFromResult,
};
