'use strict';

// Dedicated Knowledge Base Agent tool loop.
//
// Why a dedicated loop instead of reusing runAgentToolLoop (agent-tool-loop.js)?
// That loop MUTATES the global WORKSPACE_TOOL_HANDLERS map and runs actions
// through executeWorkspaceActions, which logs to the workspace action log and
// applies workspace-only verification handlers. Reusing it for KB would risk
// cross-contamination of the workspace toolset and emit misleading workspace
// logs. So we reuse only the two SAFE, standalone exported helpers —
// startWorkspaceCollectedChat (provider/model/failover-aware chat) and
// parseWorkspaceActions (the `ACTION:` text parser) — and execute against the
// KB-scoped handler map directly. This keeps the crown-jewel boundary and the
// provider/model/failover wiring intact without touching workspace internals.

const {
  parseWorkspaceActions,
  startWorkspaceCollectedChat,
} = require('./workspace-request-helpers');

const KB_TOOL_LOOP_MAX_ITERATIONS = 3;
const KB_TOOL_LOOP_TIMEOUT_MS = 120000;

const ACTION_LINE_REGEX = /ACTION:\s*\{[\s\S]*?\}\s*(?=\n|$)/g;

function stripActionLines(text) {
  return safeString(text).replace(ACTION_LINE_REGEX, '').trim();
}

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

// Run the KB-scoped text-ACTION tool loop. `toolHandlers` is the per-request
// KB handler map (see createKbAgentToolHandlers). `runtimePolicy` carries the
// resolved primary/fallback provider+model + failover from the agent profile.
async function runKnowledgeBaseAgentToolLoop({
  systemPrompt,
  messagesForModel,
  images = [],
  toolHandlers,
  runtimePolicy = null,
  timeoutMs = KB_TOOL_LOOP_TIMEOUT_MS,
}) {
  const handlers = toolHandlers && typeof toolHandlers === 'object' ? toolHandlers : {};
  const policy = runtimePolicy || {};

  let currentMessages = messagesForModel;
  let currentResponse = '';
  let finalProviderUsed = null;
  let finalModelUsed = null;
  let fallbackUsed = false;
  let fallbackFrom = null;
  let aggregatedUsage = null;
  let thinkingText = '';
  const allActionResults = [];
  const appliedChanges = [];

  for (let iteration = 1; iteration <= KB_TOOL_LOOP_MAX_ITERATIONS; iteration++) {
    // Images only need to be sent on the first turn; later turns are tool-result
    // text only, so re-sending the (potentially large) image payload is wasteful.
    const iterationImages = iteration === 1 && Array.isArray(images) ? images : [];
    const collectedChat = startWorkspaceCollectedChat({
      messages: currentMessages,
      systemPrompt,
      images: iterationImages,
      timeoutMs,
      mode: policy.mode || 'fallback',
      primaryProvider: policy.primaryProvider,
      primaryModel: policy.primaryModel || '',
      fallbackProvider: policy.fallbackProvider,
      fallbackModel: policy.fallbackModel || '',
      autoFailover: policy.autoFailover !== false,
      reasoningEffort: policy.reasoningEffort || 'medium',
      serviceTier: policy.serviceTier || '',
    });

    const result = await collectedChat.promise;

    currentResponse = result.fullResponse || '';
    finalProviderUsed = result.providerUsed || finalProviderUsed;
    finalModelUsed = result.modelUsed || finalModelUsed;
    fallbackUsed = fallbackUsed || Boolean(result.fallbackUsed);
    fallbackFrom = fallbackFrom || result.fallbackFrom || null;
    if (result.thinking && !thinkingText.includes(result.thinking)) {
      thinkingText += result.thinking;
    }
    if (result.usage) {
      if (!aggregatedUsage) {
        aggregatedUsage = { ...result.usage };
      } else {
        aggregatedUsage.inputTokens = (aggregatedUsage.inputTokens || 0) + (result.usage.inputTokens || 0);
        aggregatedUsage.outputTokens = (aggregatedUsage.outputTokens || 0) + (result.usage.outputTokens || 0);
        aggregatedUsage.totalTokens = (aggregatedUsage.totalTokens || 0) + (result.usage.totalTokens || 0);
        if (!aggregatedUsage.model && result.usage.model) aggregatedUsage.model = result.usage.model;
      }
    }

    const actions = parseWorkspaceActions(currentResponse);
    if (actions.length === 0) {
      return finalize({ iterations: iteration - 1 });
    }

    const actionResults = [];
    for (const action of actions) {
      const handler = handlers[action.tool];
      if (!handler) {
        actionResults.push({ tool: action.tool, error: `Unknown tool: ${action.tool}` });
        continue;
      }
      try {
        const handlerResult = await handler(action.params || {});
        actionResults.push({ tool: action.tool, result: handlerResult });
        if (action.tool === 'kb.updateDraft'
          && handlerResult
          && handlerResult.applied
          && Array.isArray(handlerResult.changedFields)) {
          appliedChanges.push(...handlerResult.changedFields);
        }
      } catch (err) {
        actionResults.push({ tool: action.tool, error: err?.message || 'Tool execution failed' });
      }
    }
    allActionResults.push(...actionResults);

    const strippedResponse = stripActionLines(currentResponse);
    currentMessages = [
      ...messagesForModel,
      { role: 'assistant', content: strippedResponse || currentResponse },
      {
        role: 'user',
        content: [
          `Tool results (round ${iteration}/${KB_TOOL_LOOP_MAX_ITERATIONS}):`,
          JSON.stringify(actionResults, null, 2),
          '',
          iteration >= KB_TOOL_LOOP_MAX_ITERATIONS
            ? 'This was the final tool round. Give the final answer now with no ACTION lines. If you saved any fields, state exactly which fields changed.'
            : 'Use these results. If more edits or inspection are needed, emit more ACTION lines. Otherwise give the final answer with no ACTION lines, and state exactly which fields you changed.',
        ].join('\n'),
      },
    ];
  }

  return finalize({ iterations: KB_TOOL_LOOP_MAX_ITERATIONS });

  function finalize({ iterations }) {
    return {
      text: stripActionLines(currentResponse),
      usage: aggregatedUsage,
      providerUsed: finalProviderUsed || policy.primaryProvider || null,
      modelUsed: finalModelUsed || aggregatedUsage?.model || policy.primaryModel || null,
      fallbackUsed,
      fallbackFrom,
      thinking: thinkingText,
      actions: allActionResults,
      appliedChanges,
      iterations,
    };
  }
}

module.exports = {
  runKnowledgeBaseAgentToolLoop,
};
