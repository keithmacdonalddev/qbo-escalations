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
  onStatus,
  isCancelled,
  runtimePolicy = null,
}) {
  const primaryProvider = normalizeProvider(runtimePolicy?.primaryProvider || agent.preferredProvider);
  const policy = resolvePolicy({
    mode: runtimePolicy?.mode || 'fallback',
    primaryProvider,
    primaryModel: normalizeModelOverride(runtimePolicy?.primaryModel || null),
    fallbackProvider: normalizeProvider(runtimePolicy?.fallbackProvider || getAlternateProvider(primaryProvider)),
    fallbackModel: normalizeModelOverride(runtimePolicy?.fallbackModel || null),
  });

  Object.assign(WORKSPACE_TOOL_HANDLERS, SHARED_AGENT_TOOL_HANDLERS);

  try {
    let currentMessages = messagesForModel;
    let aggregatedUsage = null;
    let finalProviderUsed = null;
    let finalModelUsed = null;
    let currentResponse = '';
    const allActionResults = [];
    const executionState = createWorkspaceExecutionState({});

    for (let iteration = 1; iteration <= TOOL_LOOP_MAX_ITERATIONS; iteration++) {
      if (isCancelled?.()) {
        const err = new Error('Agent tool loop cancelled');
        err.code = 'ABORTED';
        throw err;
      }

      const result = await startWorkspaceCollectedChat({
        messages: currentMessages,
        systemPrompt,
        timeoutMs: TOOL_LOOP_TIMEOUT_MS,
        mode: policy.mode,
        primaryProvider: policy.primaryProvider,
        primaryModel: policy.primaryModel,
        fallbackProvider: policy.fallbackProvider,
        fallbackModel: policy.fallbackModel,
        reasoningEffort: runtimePolicy?.reasoningEffort || 'medium',
      }).promise;

      currentResponse = result.fullResponse || '';
      finalProviderUsed = result.providerUsed || finalProviderUsed;
      finalModelUsed = result.modelUsed || finalModelUsed;
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
        return {
          fullResponse: currentResponse.trim(),
          usage: buildWorkspaceUsageSubdoc(aggregatedUsage, finalProviderUsed || primaryProvider),
          providerUsed: finalProviderUsed || primaryProvider,
          modelUsed: finalModelUsed || aggregatedUsage?.model || runtimePolicy?.primaryModel || null,
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

      const actionResults = await executeWorkspaceActions(actions, executionState);
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

    return {
      fullResponse: currentResponse.replace(/ACTION:\s*\{[\s\S]*?\}\s*(?=\n|$)/g, '').trim(),
      usage: buildWorkspaceUsageSubdoc(aggregatedUsage, finalProviderUsed || primaryProvider),
      providerUsed: finalProviderUsed || primaryProvider,
      modelUsed: finalModelUsed || aggregatedUsage?.model || runtimePolicy?.primaryModel || null,
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
