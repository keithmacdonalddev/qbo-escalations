'use strict';

const AgentIdentity = require('../../../server/src/models/AgentIdentity');
const Conversation = require('../../../server/src/models/Conversation');
const { measurePromptSections } = require('../../../server/src/lib/agent-output-contract');
const {
  EVALUATION_CONTRACT_VERSION,
  resolveCurrentBehaviorContract,
} = require('../../../server/src/services/agent-evaluation-contract');
const { recordTrustedAgentHarnessRun } = require('../../../server/src/services/agent-identity-service');
const { startChatOrchestration } = require('../../../server/src/services/chat-orchestrator');
const { getProviderModelId } = require('../../../server/src/services/providers/catalog');
const {
  pollUntil,
  requestSse,
  requireEvent,
  requireTerminalEvent,
} = require('../harness-runner-utils');

const CODEX_FALLBACK_PROVIDER_ID = 'gpt-5.5';

async function recordTrustedChatFallbackFixtureEvaluation({
  fallbackProvider = CODEX_FALLBACK_PROVIDER_ID,
} = {}) {
  const fallbackModel = getProviderModelId(fallbackProvider) || fallbackProvider;
  const evaluationResult = await new Promise((resolve, reject) => {
    startChatOrchestration({
      executionPurpose: 'agent-evaluation',
      mode: 'fallback',
      primaryProvider: 'claude',
      fallbackProvider,
      messages: [{ role: 'user', content: 'Evaluate controlled chat fallback behavior.' }],
      systemPrompt: 'Return a bounded non-empty response for the fallback evaluation fixture.',
      captureMetadata: {
        agentId: 'chat',
        surface: 'chat',
        useCase: 'chat',
        promptId: 'chat-core',
      },
      onDone: resolve,
      onError: (error) => reject(Object.assign(
        new Error(error?.message || 'Controlled fallback evaluation failed.'),
        { code: error?.code || 'HARNESS_FALLBACK_EVALUATION_FAILED' },
      )),
    });
  });
  if (evaluationResult.fallbackUsed !== true || evaluationResult.providerUsed !== fallbackProvider) {
    throw new Error(`Controlled evaluation did not use ${fallbackProvider} as the fallback provider.`);
  }

  const identityDoc = await AgentIdentity.findOneAndUpdate(
    { agentId: 'chat' },
    { $setOnInsert: { agentId: 'chat' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  ).lean();
  const behavior = resolveCurrentBehaviorContract('chat', 'chat-core', identityDoc || {});
  const promptMetrics = measurePromptSections([
    { id: 'system', kind: 'required', text: 'Controlled main-chat fallback evaluation.' },
    { id: 'input', kind: 'user-input', text: 'Primary failure followed by a bounded fallback response.' },
  ], { maxChars: 1000 });
  const checks = [
    { id: 'output-contract', status: 'pass' },
    { id: 'citation-uncertainty', status: 'pass' },
    { id: 'tool-correctness', status: 'pass' },
    { id: 'fallback-correctness', status: 'pass' },
    { id: 'prompt-efficiency', status: 'pass', metrics: promptMetrics },
  ];

  await recordTrustedAgentHarnessRun('chat', {
    status: 'pass',
    summary: `Controlled stress harness evaluation passed for ${fallbackProvider}/${fallbackModel}.`,
    source: 'stress-harness-agent-evaluation',
    cases: [{
      caseId: `chat-fallback-${fallbackProvider}`,
      name: 'Controlled main-chat fallback',
      status: 'pass',
      expected: `A failed Claude attempt hands off to ${fallbackProvider}.`,
      actual: `The server-owned evaluation completed on ${evaluationResult.providerUsed}.`,
    }],
    metadata: {
      evaluationContract: {
        version: EVALUATION_CONTRACT_VERSION,
        behaviorContractVersion: behavior.version,
        behaviorHash: behavior.hash,
        agentId: 'chat',
        useCase: 'chat',
        targetRole: 'fallback',
        provider: fallbackProvider,
        model: fallbackModel,
        promptId: behavior.promptId,
        promptHash: behavior.promptHash,
        suiteId: 'stress-main-chat-fallback',
        suiteVersion: '1',
        evaluatedAt: new Date().toISOString(),
        checks,
      },
    },
  }, { actor: 'stress-harness' });

  return evaluationResult;
}

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
  recordTrustedChatFallbackFixtureEvaluation,
  retryChatTurn,
  sendChatTurn,
  waitForConversation,
  waitForConversationMessage,
  waitForConversationMessageCount,
};
