'use strict';

const { normalizeModelOverride, resolvePolicy } = require('./chat-orchestrator');
const { getAlternateProvider, normalizeProvider } = require('./providers/registry');
const {
  buildWorkspaceUsageSubdoc,
  executeWorkspaceActions,
  parseWorkspaceActions,
  startWorkspaceCollectedChat,
} = require('./workspace-request-helpers');
const { createWorkspaceExecutionState } = require('./workspace-tools/execution-state');
const { WORKSPACE_TOOL_HANDLERS } = require('./workspace-tools/handler-registry');
const { SHARED_AGENT_TOOL_HANDLERS } = require('./shared-agent-tools');

const ORIGINAL_TOOL_HANDLERS = { ...WORKSPACE_TOOL_HANDLERS };
const TOOL_LOOP_MAX_ITERATIONS = 4;
const TOOL_LOOP_TIMEOUT_MS = 180000;

async function runAgentToolLoop({
  agent,
  systemPrompt,
  messagesForModel,
  onActions,
  onChunk,
  onThinkingChunk,
  onStatus,
  isCancelled,
  runtimePolicy = null,
  timeoutMs,
  allowedToolNames = null,
  includeActionParamsInResults = false,
  registerAbort = null,
}) {
  const primaryProvider = normalizeProvider(runtimePolicy?.primaryProvider || agent.preferredProvider);
  const policy = resolvePolicy({
    mode: runtimePolicy?.mode || 'fallback',
    primaryProvider,
    primaryModel: normalizeModelOverride(runtimePolicy?.primaryModel || null),
    fallbackProvider: normalizeProvider(runtimePolicy?.fallbackProvider || getAlternateProvider(primaryProvider)),
    fallbackModel: normalizeModelOverride(runtimePolicy?.fallbackModel || null),
    autoFailover: runtimePolicy?.autoFailover === true,
  });

  const allowedTools = Array.isArray(allowedToolNames)
    ? new Set(allowedToolNames.filter(Boolean))
    : (allowedToolNames instanceof Set ? allowedToolNames : null);
  const sharedHandlers = allowedTools
    ? Object.fromEntries(
        Object.entries(SHARED_AGENT_TOOL_HANDLERS)
          .filter(([toolName]) => allowedTools.has(toolName))
      )
    : SHARED_AGENT_TOOL_HANDLERS;

  Object.assign(WORKSPACE_TOOL_HANDLERS, sharedHandlers);

  try {
    let currentMessages = messagesForModel;
    let aggregatedUsage = null;
    let finalProviderUsed = null;
    let finalModelUsed = null;
    let fallbackUsed = false;
    let fallbackFrom = null;
    let currentResponse = '';
    let thinkingText = '';
    const providerThinking = {};
    const allActionResults = [];
    const allAttempts = [];
    const executionState = createWorkspaceExecutionState({});
    const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : TOOL_LOOP_TIMEOUT_MS;

    for (let iteration = 1; iteration <= TOOL_LOOP_MAX_ITERATIONS; iteration++) {
      if (isCancelled?.()) {
        const err = new Error('Agent tool loop cancelled');
        err.code = 'ABORTED';
        throw err;
      }

      const collectedChat = startWorkspaceCollectedChat({
        messages: currentMessages,
        systemPrompt,
        timeoutMs: effectiveTimeoutMs,
        mode: policy.mode,
        primaryProvider: policy.primaryProvider,
        primaryModel: policy.primaryModel,
        fallbackProvider: policy.fallbackProvider,
        fallbackModel: policy.fallbackModel,
        autoFailover: policy.autoFailover === true,
        reasoningEffort: runtimePolicy?.reasoningEffort || 'medium',
        serviceTier: runtimePolicy?.serviceTier || '',
        onThinkingChunk: (thinking, provider) => {
          const chunk = typeof thinking === 'string' ? thinking : '';
          const thinkingProvider = provider || finalProviderUsed || policy.primaryProvider;
          if (chunk) {
            thinkingText += chunk;
            providerThinking[thinkingProvider] = `${providerThinking[thinkingProvider] || ''}${chunk}`;
            onThinkingChunk?.({ provider: thinkingProvider, thinking: chunk });
          }
        },
        onStatus,
      });
      if (typeof registerAbort === 'function') registerAbort(collectedChat.abort);
      let result;
      try {
        result = await collectedChat.promise;
      } finally {
        if (typeof registerAbort === 'function') registerAbort(null);
      }

      currentResponse = result.fullResponse || '';
      finalProviderUsed = result.providerUsed || finalProviderUsed;
      finalModelUsed = result.modelUsed || finalModelUsed;
      if (result.thinking && !thinkingText.includes(result.thinking)) {
        thinkingText += result.thinking;
      }
      if (result.providerThinking && typeof result.providerThinking === 'object') {
        for (const [provider, thinking] of Object.entries(result.providerThinking)) {
          const chunk = typeof thinking === 'string' ? thinking : '';
          if (provider && chunk && !String(providerThinking[provider] || '').includes(chunk)) {
            providerThinking[provider] = `${providerThinking[provider] || ''}${chunk}`;
          }
        }
      }
      fallbackUsed = fallbackUsed || Boolean(result.fallbackUsed);
      fallbackFrom = fallbackFrom || result.fallbackFrom || null;
      if (Array.isArray(result.attempts) && result.attempts.length > 0) {
        allAttempts.push(...result.attempts);
      }
      if (result.usage) {
        if (!aggregatedUsage) {
          aggregatedUsage = { ...result.usage };
        } else {
          aggregatedUsage.inputTokens = (aggregatedUsage.inputTokens || 0) + (result.usage.inputTokens || 0);
          aggregatedUsage.outputTokens = (aggregatedUsage.outputTokens || 0) + (result.usage.outputTokens || 0);
          aggregatedUsage.totalTokens = (aggregatedUsage.totalTokens || 0) + (result.usage.totalTokens || 0);
          aggregatedUsage.totalCostMicros = (aggregatedUsage.totalCostMicros || 0) + (result.usage.totalCostMicros || 0);
        }
      }

      const actions = parseWorkspaceActions(currentResponse);
      if (actions.length === 0) {
        const finalResponse = currentResponse.trim();
        if (finalResponse) {
          onChunk?.({
            provider: finalProviderUsed || primaryProvider,
            text: finalResponse,
          });
        }
        return {
          fullResponse: finalResponse,
          usage: buildWorkspaceUsageSubdoc(aggregatedUsage, finalProviderUsed || primaryProvider),
          providerUsed: finalProviderUsed || primaryProvider,
          modelUsed: finalModelUsed || aggregatedUsage?.model || runtimePolicy?.primaryModel || null,
          fallbackUsed,
          fallbackFrom,
          attempts: allAttempts,
          thinking: thinkingText,
          providerThinking,
          actions: allActionResults,
          iterations: iteration - 1,
        };
      }

      onStatus?.({
        type: 'tool_loop',
        phase: 'actions',
        message: `Running ${actions.length} tool action${actions.length === 1 ? '' : 's'}...`,
        iteration,
      });

      const rawActionResults = await executeWorkspaceActions(actions, executionState);
      const actionResults = includeActionParamsInResults
        ? rawActionResults.map((result, index) => ({
            ...result,
            params: actions[index]?.params || {},
          }))
        : rawActionResults;
      allActionResults.push(...actionResults);
      onActions?.({ iteration, results: actionResults });

      const strippedResponse = currentResponse.replace(/ACTION:\s*\{[\s\S]*?\}\s*(?=\n|$)/g, '').trim();
      currentMessages = [
        ...messagesForModel,
        { role: 'assistant', content: strippedResponse || currentResponse },
        {
          role: 'user',
          content: [
            `Tool results (round ${iteration}/${TOOL_LOOP_MAX_ITERATIONS}):`,
            JSON.stringify(actionResults, null, 2),
            '',
            iteration >= TOOL_LOOP_MAX_ITERATIONS
              ? 'This was the final tool round. Give the final answer now with no ACTION lines.'
              : 'Use these results. If more inspection is needed, emit more ACTION lines. Otherwise provide the final answer with no ACTION lines.',
          ].join('\n'),
        },
      ];
    }

    const finalResponse = currentResponse.replace(/ACTION:\s*\{[\s\S]*?\}\s*(?=\n|$)/g, '').trim();
    if (finalResponse) {
      onChunk?.({
        provider: finalProviderUsed || primaryProvider,
        text: finalResponse,
      });
    }

    return {
      fullResponse: finalResponse,
      usage: buildWorkspaceUsageSubdoc(aggregatedUsage, finalProviderUsed || primaryProvider),
      providerUsed: finalProviderUsed || primaryProvider,
      modelUsed: finalModelUsed || aggregatedUsage?.model || runtimePolicy?.primaryModel || null,
      fallbackUsed,
      fallbackFrom,
      attempts: allAttempts,
      thinking: thinkingText,
      providerThinking,
      actions: allActionResults,
      iterations: TOOL_LOOP_MAX_ITERATIONS,
    };
  } finally {
    for (const key of Object.keys(WORKSPACE_TOOL_HANDLERS)) {
      delete WORKSPACE_TOOL_HANDLERS[key];
    }
    Object.assign(WORKSPACE_TOOL_HANDLERS, ORIGINAL_TOOL_HANDLERS);
  }
}

module.exports = {
  runAgentToolLoop,
};
