'use strict';

const Conversation = require('../../../server/src/models/Conversation');
const {
  pollUntil,
  requestSse,
  requireEvent,
  requireTerminalEvent,
} = require('../harness-runner-utils');

const CODEX_FALLBACK_PROVIDER_ID = 'gpt-5.5';

function buildChatUsage({
  provider,
  model = 'harness-stub-model',
  inputTokens = 3,
  outputTokens = 5,
  totalTokens = inputTokens + outputTokens,
  totalCostMicros = 0,
  usageAvailable = true,
} = {}) {
  return {
    provider,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    totalCostMicros,
    usageAvailable,
  };
}

function makeFallbackChatStub(text, overrides = {}) {
  const usage = buildChatUsage({
    provider: 'codex',
    ...overrides,
  });

  return ({ onChunk, onDone }) => {
    queueMicrotask(() => {
      if (typeof onChunk === 'function') onChunk(text);
      if (typeof onDone === 'function') onDone(text, usage);
    });
    return () => {};
  };
}

function makeDelayedChatStub(text, delayMs = 1500, overrides = {}) {
  const usage = buildChatUsage({
    provider: 'claude',
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    ...overrides,
  });

  return ({ onChunk, onDone, onError }) => {
    const timer = setTimeout(() => {
      try {
        if (typeof onChunk === 'function') onChunk(text);
        if (typeof onDone === 'function') onDone(text, usage);
      } catch (err) {
        if (typeof onError === 'function') onError(err);
      }
    }, delayMs);
    return () => clearTimeout(timer);
  };
}

function makeChunkedChatStub(chunks, {
  chunkDelayMs = 400,
  initialDelayMs = 150,
  provider = 'claude',
  usage: usageOverrides = {},
} = {}) {
  const normalizedChunks = Array.isArray(chunks)
    ? chunks.map((chunk) => String(chunk || '')).filter(Boolean)
    : [];
  const finalText = normalizedChunks.join('');
  const usage = buildChatUsage({
    provider,
    inputTokens: 2,
    outputTokens: Math.max(1, normalizedChunks.length),
    totalTokens: Math.max(3, normalizedChunks.length + 2),
    ...usageOverrides,
  });

  return ({ onChunk, onDone, onError }) => {
    if (normalizedChunks.length === 0) {
      queueMicrotask(() => {
        if (typeof onDone === 'function') onDone('', usage);
      });
      return () => {};
    }

    const timers = [];
    let cancelled = false;

    normalizedChunks.forEach((chunk, index) => {
      const delayMs = initialDelayMs + (index * chunkDelayMs);
      const timer = setTimeout(() => {
        if (cancelled) return;
        try {
          if (typeof onChunk === 'function') onChunk(chunk);
          if (index === normalizedChunks.length - 1 && typeof onDone === 'function') {
            onDone(finalText, usage);
          }
        } catch (err) {
          if (typeof onError === 'function') onError(err);
        }
      }, delayMs);
      timers.push(timer);
    });

    return () => {
      cancelled = true;
      timers.forEach((timer) => clearTimeout(timer));
    };
  };
}

function makeFailingChatStub(message, { code = 'PROVIDER_EXEC_FAILED' } = {}) {
  return ({ onError }) => {
    queueMicrotask(() => {
      const err = new Error(message);
      err.code = code;
      if (typeof onError === 'function') onError(err);
    });
    return () => {};
  };
}

async function sendChatTurn(baseUrl, json, options = {}) {
  const response = await requestSse(baseUrl, '/api/chat', {
    method: 'POST',
    json,
    ...options,
  });
  const startEvent = requireEvent(response.events, 'start');
  const doneEvent = requireEvent(response.events, 'done');
  requireTerminalEvent(response.events);

  return {
    response,
    events: response.events,
    startEvent,
    doneEvent,
    conversationId: startEvent.data.conversationId,
  };
}

async function retryChatTurn(baseUrl, json, options = {}) {
  const response = await requestSse(baseUrl, '/api/chat/retry', {
    method: 'POST',
    json,
    ...options,
  });
  const startEvent = requireEvent(response.events, 'start');
  const doneEvent = requireEvent(response.events, 'done');
  requireTerminalEvent(response.events);

  return {
    response,
    events: response.events,
    startEvent,
    doneEvent,
  };
}

async function waitForConversation(conversationId, predicate, {
  timeoutMs = 10_000,
  description = 'conversation state',
} = {}) {
  return pollUntil(
    async () => {
      const doc = await Conversation.findById(conversationId).lean();
      if (!doc || !Array.isArray(doc.messages)) return null;
      return predicate(doc) ? doc : null;
    },
    {
      timeoutMs,
      description,
    }
  );
}

async function waitForConversationMessage(conversationId, content, options = {}) {
  return waitForConversation(
    conversationId,
    (doc) => doc.messages.some((message) => message.content === content),
    {
      description: 'saved conversation message',
      ...options,
    }
  );
}

async function waitForConversationMessageCount(conversationId, minimumCount, options = {}) {
  return waitForConversation(
    conversationId,
    (doc) => doc.messages.length >= minimumCount,
    {
      description: 'conversation message count',
      ...options,
    }
  );
}

module.exports = {
  CODEX_FALLBACK_PROVIDER_ID,
  makeChunkedChatStub,
  makeDelayedChatStub,
  makeFailingChatStub,
  makeFallbackChatStub,
  retryChatTurn,
  sendChatTurn,
  waitForConversation,
  waitForConversationMessage,
  waitForConversationMessageCount,
};
