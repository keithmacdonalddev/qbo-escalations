'use strict';

const { randomUUID } = require('node:crypto');
const { reportServerError } = require('../lib/server-error-pipeline');
const patternLearner = require('./workspace-pattern-learner');
const { startChatOrchestration } = require('./chat-orchestrator');
const {
  autoExtractAndSave,
  autoExtractConversationMemories,
} = require('./workspace-memory-extraction');
const {
  buildWorkspaceUsageSubdoc,
  executeWorkspaceActions,
  logWorkspaceAttempts,
  parseWorkspaceActions,
  startWorkspaceCollectedChat,
} = require('./workspace-request-helpers');
const { WORKSPACE_TOOL_STATUS_LABELS } = require('./workspace-tools/metadata');
const {
  buildWorkspaceExecutionCoverageLines,
  createWorkspaceExecutionState,
} = require('./workspace-tools/execution-state');

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function buildWorkspaceFallbackMessage(data = {}) {
  const from = data?.from || 'primary provider';
  const to = data?.to || 'fallback provider';
  const reason = String(data?.reason || '').toUpperCase();

  if (data?.preflight) {
    return `${from} is temporarily unhealthy. Starting with ${to} instead.`;
  }
  if (reason === 'TIMEOUT') {
    return `${from} timed out. Switching to ${to}...`;
  }
  return `Switching provider from ${from} to ${to}...`;
}

/**
 * Emit provider_error + status callbacks (mirrors the old
 * writeWorkspaceProviderErrorEvents helper).
 */
function emitProviderError(callbacks, detail, phase, sessionId) {
  callbacks.onProviderError({
    ...(detail || {}),
    phase,
    sessionId,
  });
  callbacks.onStatus({
    type: 'provider_error',
    message: detail?.message || 'Workspace provider error',
    provider: detail?.provider || null,
    detail: detail?.detail || '',
    phase,
    sessionId,
  });
}

/**
 * Emit fallback + status callbacks (mirrors the old
 * writeWorkspaceFallbackEvents helper).
 */
function emitFallback(callbacks, detail, phase, sessionId) {
  callbacks.onFallback({
    ...(detail || {}),
    phase,
    sessionId,
  });
  callbacks.onStatus({
    type: 'fallback',
    from: detail?.from || null,
    fromModel: detail?.fromModel || null,
    to: detail?.to || null,
    toModel: detail?.toModel || null,
    reason: detail?.reason || null,
    detail: detail?.detail || '',
    preflight: Boolean(detail?.preflight),
    message: buildWorkspaceFallbackMessage(detail),
    phase,
    sessionId,
  });
}

/* ------------------------------------------------------------------ */
/*  Core action loop                                                  */
/* ------------------------------------------------------------------ */

/**
 * Transport-agnostic workspace action loop.
 * Called by both the standalone workspace SSE route and the room adapter.
 *
 * @param {Object} opts
 * @param {string} opts.prompt - User's message
 * @param {Array}  opts.messages - Conversation history [{role, content}]
 * @param {string} opts.sessionId - Session tracking ID
 * @param {Object} opts.policy - Provider policy {mode, primaryProvider, primaryModel, ...}
 * @param {string} opts.requestedPrimaryProvider - Originally requested provider name
 * @param {string} opts.effectiveReasoningEffort - 'low'|'medium'|'high'|'xhigh'
 * @param {number} opts.timeoutMs - Request timeout
 * @param {string} opts.workspaceRole - System prompt for action flow
 * @param {string} opts.workspaceChatOnlyRole - System prompt for direct chat
 * @param {boolean} opts.useActionFlow - Whether to use action loop
 * @param {Promise} opts.connectedAccountsPromise - Connected Gmail accounts
 * @param {Object} opts.runtime - {acquireChatLock, releaseChatLock, updateWorkspaceSession, recordWorkspaceChunk, recordWorkspaceActions, completeWorkspacePass, deleteWorkspaceSession}
 * @param {Function} opts.isClientDisconnected - () => boolean
 * @param {Function} [opts.clearSpawnGuard] - () => void
 * @param {Function} [opts.setPass1Request] - (value) => void
 * @param {Function} [opts.setPass2Cleanup] - (value) => void
 *
 * @param {Object} callbacks
 * @param {Function} callbacks.onChunk - ({text}) => void
 * @param {Function} callbacks.onThinking - ({thinking, provider, phase}) => void
 * @param {Function} callbacks.onStatus - ({type, message, phase, sessionId, ...}) => void
 * @param {Function} callbacks.onActions - ({results, iteration}) => void
 * @param {Function} callbacks.onProviderError - ({detail, phase, sessionId}) => void
 * @param {Function} callbacks.onFallback - ({from, to, reason, message, phase, sessionId}) => void
 * @param {Function} callbacks.onDone - ({ok, fullResponse, actions, iterations, providerUsed, modelUsed, usage}) => void
 * @param {Function} callbacks.onError - ({ok, code, error, detail}) => void
 *
 * @param {Object} [hooks]
 * @param {Function} [hooks.saveConversationTurn] - (fullResponse, usage) => void
 * @param {Function} [hooks.clearTimers] - () => void
 * @param {Function} [hooks.markAiSubprocessOutputReceived] - () => void
 *
 * @returns {void}
 */
async function runWorkspaceActionLoop(opts, callbacks, hooks = {}) {
  const {
    prompt,
    messages,
    sessionId,
    policy,
    requestedPrimaryProvider,
    effectiveReasoningEffort,
    timeoutMs,
    workspaceRole,
    workspaceChatOnlyRole,
    useActionFlow,
    connectedAccountsPromise,
    runtime,
    isClientDisconnected,
    clearSpawnGuard = () => {},
    setPass1Request = () => {},
    setPass2Cleanup = () => {},
  } = opts;
  const lockOwnerId = sessionId ? `action-loop:${sessionId}` : `action-loop:${randomUUID()}`;
  let actionFlowAbortReason = null;

  function requestActionFlowAbort(reason = 'Workspace action loop aborted') {
    if (!actionFlowAbortReason) {
      actionFlowAbortReason = reason;
    }
  }

  function isAbortRequested() {
    return Boolean(actionFlowAbortReason) || isClientDisconnected();
  }

  function throwIfAborted() {
    if (!isAbortRequested()) return;
    const err = new Error(actionFlowAbortReason || 'Workspace action loop aborted');
    err.code = 'ABORTED';
    throw err;
  }

  const {
    updateWorkspaceSession,
    recordWorkspaceChunk,
    recordWorkspaceActions,
    completeWorkspacePass,
    deleteWorkspaceSession,
    acquireChatLock,
    releaseChatLock,
  } = runtime;

  const saveConversationTurn = hooks.saveConversationTurn || (() => {});
  const clearTimers = hooks.clearTimers || (() => {});
  const markAiSubprocessOutputReceived = hooks.markAiSubprocessOutputReceived || (() => {});

  try {
    /* ---------------------------------------------------------------- */
    /*  Direct-chat path (no action flow)                               */
    /* ---------------------------------------------------------------- */
    if (!useActionFlow) {
      const cleanup = startChatOrchestration({
        mode: policy.mode,
        primaryProvider: policy.primaryProvider,
        primaryModel: policy.primaryModel,
        fallbackProvider: policy.fallbackProvider,
        fallbackModel: policy.fallbackModel,
        messages,
        systemPrompt: workspaceChatOnlyRole,
        timeoutMs,
        reasoningEffort: effectiveReasoningEffort,
        onChunk: ({ text }) => {
          markAiSubprocessOutputReceived();
          if (isClientDisconnected()) return;
          recordWorkspaceChunk(sessionId, 'pass1', text);
          callbacks.onChunk({ text });
        },
        onThinkingChunk: ({ thinking, provider }) => {
          markAiSubprocessOutputReceived();
          if (isClientDisconnected()) return;
          callbacks.onThinking({
            thinking,
            provider,
            phase: 'direct',
          });
        },
        onProviderError: (detail) => {
          markAiSubprocessOutputReceived();
          if (!isClientDisconnected()) {
            emitProviderError(callbacks, detail, 'direct', sessionId);
          }
          updateWorkspaceSession(sessionId, {
            lastError: detail?.message || 'Workspace provider error',
          });
        },
        onFallback: (detail) => {
          markAiSubprocessOutputReceived();
          if (isClientDisconnected()) return;
          emitFallback(callbacks, detail, 'direct', sessionId);
        },
        onDone: ({ fullResponse, providerUsed, modelUsed, fallbackUsed, fallbackFrom, usage, attempts }) => {
          markAiSubprocessOutputReceived();
          clearTimers();
          completeWorkspacePass(sessionId, 'pass1');
          updateWorkspaceSession(sessionId, { phase: 'done' });
          deleteWorkspaceSession(sessionId);
          setPass2Cleanup(null);

          try { autoExtractAndSave(fullResponse); } catch (extractErr) { console.error('[workspace] auto-extract (direct) failed:', extractErr.message); }
          try { autoExtractConversationMemories(prompt, fullResponse); } catch (extractErr) { console.error('[workspace] conversation-extract (direct) failed:', extractErr.message); }

          const usageSubdoc = buildWorkspaceUsageSubdoc(usage, providerUsed || requestedPrimaryProvider);
          saveConversationTurn(fullResponse, usageSubdoc);
          logWorkspaceAttempts(attempts, { requestId: randomUUID(), mode: policy.mode });

          if (isClientDisconnected()) return;
          callbacks.onDone({
            ok: true,
            fullResponse,
            actions: [],
            providerUsed: providerUsed || null,
            modelUsed: modelUsed || usageSubdoc?.model || null,
            fallbackUsed: Boolean(fallbackUsed),
            fallbackFrom: fallbackFrom || null,
            usage: usageSubdoc,
          });
        },
        onError: (err) => {
          clearSpawnGuard();
          clearTimers();
          setPass2Cleanup(null);
          updateWorkspaceSession(sessionId, {
            phase: 'error',
            lastError: err.message || 'Workspace direct response failed',
          });
          reportServerError({
            message: `Workspace direct response failed: ${err.message || 'Unknown error'}`,
            detail: 'Workspace agent failed while generating a direct response.',
            stack: err.stack || '',
            source: 'services/workspace-request-service.js',
            category: 'runtime-error',
            severity: err.code === 'TIMEOUT' ? 'warning' : 'error',
          });
          if (!isClientDisconnected()) {
            callbacks.onError({
              ok: false,
              code: err.code || 'AI_ERROR',
              error: err.message || 'Workspace agent error',
              detail: err.detail || '',
            });
          }
          deleteWorkspaceSession(sessionId);
        },
      });

      setPass2Cleanup(cleanup);
      return;
    }

    /* ---------------------------------------------------------------- */
    /*  Action-flow path                                                */
    /* ---------------------------------------------------------------- */
    setPass2Cleanup(() => {
      requestActionFlowAbort('Workspace action loop aborted');
    });
    const MAX_ACTION_ITERATIONS = 15;
    const allActionResults = [];
    const loopConversationHistory = [];
    const toolStatusLabels = WORKSPACE_TOOL_STATUS_LABELS;

    function describeActions(loopActions, loopIteration) {
      const uniqueTools = [...new Set(loopActions.map((action) => action.tool))];
      const labels = uniqueTools.map((tool) => toolStatusLabels[tool] || tool).join(', ');
      return loopIteration > 1
        ? `Step ${loopIteration}: ${labels}...`
        : `${labels}...`;
    }

    function runCollectedPass(passMessages, passLabel) {
      throwIfAborted();
      const currentRequest = startWorkspaceCollectedChat({
        messages: passMessages,
        systemPrompt: workspaceRole,
        timeoutMs,
        mode: policy.mode,
        primaryProvider: policy.primaryProvider,
        primaryModel: policy.primaryModel,
        fallbackProvider: policy.fallbackProvider,
        fallbackModel: policy.fallbackModel,
        reasoningEffort: effectiveReasoningEffort,
        onChunk: (text) => {
          markAiSubprocessOutputReceived();
          recordWorkspaceChunk(sessionId, passLabel, text);
        },
        onThinkingChunk: (thinking, provider) => {
          markAiSubprocessOutputReceived();
          if (isClientDisconnected()) return;
          callbacks.onThinking({
            thinking,
            provider,
            phase: passLabel,
          });
        },
        onStatus: (data) => {
          markAiSubprocessOutputReceived();
          if (isClientDisconnected()) return;
          if (data?.type === 'fallback') {
            emitFallback(callbacks, data, passLabel, sessionId);
          }
          if (data?.type === 'provider_error') {
            emitProviderError(callbacks, data, passLabel, sessionId);
            updateWorkspaceSession(sessionId, {
              lastError: data.message || 'Workspace provider error',
            });
          }
        },
      });

      setPass1Request(currentRequest);

      return currentRequest.promise
        .then((result) => {
          completeWorkspacePass(sessionId, passLabel);
          logWorkspaceAttempts(result.attempts, { requestId: randomUUID(), mode: policy.mode });
          return {
            text: result.fullResponse || '',
            usage: result.usage || null,
            providerUsed: result.providerUsed || null,
            modelUsed: result.modelUsed || result.usage?.model || null,
            fallbackUsed: Boolean(result.fallbackUsed),
            fallbackFrom: result.fallbackFrom || null,
          };
        })
        .finally(() => {
          setPass1Request(null);
        });
    }

    function runStreamedPass1(passMessages) {
      throwIfAborted();
      let insideAction = false;
      let actionBuffer = '';
      let pendingText = '';
      let streamedText = '';
      let actionsSentStatus = false;

      const ACTION_PREFIX = 'ACTION:';
      const ACTION_PREFIX_LEN = ACTION_PREFIX.length;

      function flushPending(force) {
        if (isClientDisconnected() || !pendingText) return;
        if (force) {
          if (pendingText) {
            callbacks.onChunk({ text: pendingText });
            streamedText += pendingText;
            pendingText = '';
          }
          return;
        }

        const safeLen = pendingText.length - (ACTION_PREFIX_LEN - 1);
        if (safeLen > 0) {
          const safe = pendingText.slice(0, safeLen);
          pendingText = pendingText.slice(safeLen);
          callbacks.onChunk({ text: safe });
          streamedText += safe;
        }
      }

      const currentRequest = startWorkspaceCollectedChat({
        messages: passMessages,
        systemPrompt: workspaceRole,
        timeoutMs,
        mode: policy.mode,
        primaryProvider: policy.primaryProvider,
        primaryModel: policy.primaryModel,
        fallbackProvider: policy.fallbackProvider,
        fallbackModel: policy.fallbackModel,
        reasoningEffort: effectiveReasoningEffort,
        onChunk: (text) => {
          markAiSubprocessOutputReceived();
          recordWorkspaceChunk(sessionId, 'pass1', text);
          if (isClientDisconnected()) return;

          if (insideAction) {
            actionBuffer += text;
            const braceNewline = actionBuffer.indexOf('}\n');
            if (braceNewline >= 0) {
              const remainder = actionBuffer.slice(braceNewline + 2);
              actionBuffer = '';
              insideAction = false;
              if (remainder) {
                pendingText += remainder;
                processActionBoundaries();
                flushPending(false);
              }
            }
            return;
          }

          pendingText += text;
          processActionBoundaries();
          flushPending(false);
        },
        onThinkingChunk: (thinking, provider) => {
          markAiSubprocessOutputReceived();
          if (isClientDisconnected()) return;
          callbacks.onThinking({
            thinking,
            provider,
            phase: 'pass1',
          });
        },
        onStatus: (data) => {
          markAiSubprocessOutputReceived();
          if (isClientDisconnected()) return;
          if (data?.type === 'fallback') {
            emitFallback(callbacks, data, 'pass1', sessionId);
          }
          if (data?.type === 'provider_error') {
            emitProviderError(callbacks, data, 'pass1', sessionId);
            updateWorkspaceSession(sessionId, {
              lastError: data.message || 'Workspace provider error',
            });
          }
        },
      });

      setPass1Request(currentRequest);

      function processActionBoundaries() {
        while (true) {
          const idx = pendingText.indexOf(ACTION_PREFIX);
          if (idx < 0) break;

          const before = pendingText.slice(0, idx);
          if (before && !isClientDisconnected()) {
            callbacks.onChunk({ text: before });
            streamedText += before;
          }

          insideAction = true;
          actionBuffer = pendingText.slice(idx + ACTION_PREFIX_LEN);
          pendingText = '';

          if (!actionsSentStatus && !isClientDisconnected()) {
            actionsSentStatus = true;
            callbacks.onStatus({
              message: 'Planning actions...',
              phase: 'actions-detected',
              sessionId,
            });
          }

          const braceNewline = actionBuffer.indexOf('}\n');
          if (braceNewline >= 0) {
            const remainder = actionBuffer.slice(braceNewline + 2);
            actionBuffer = '';
            insideAction = false;
            if (remainder) {
              pendingText = remainder;
              continue;
            }
          }
          break;
        }
      }

      return currentRequest.promise
        .then((result) => {
          if (!insideAction && pendingText && !isClientDisconnected()) {
            flushPending(true);
          }
          completeWorkspacePass(sessionId, 'pass1');
          logWorkspaceAttempts(result.attempts, { requestId: randomUUID(), mode: policy.mode });
          return {
            text: result.fullResponse || '',
            usage: result.usage || null,
            providerUsed: result.providerUsed || null,
            modelUsed: result.modelUsed || result.usage?.model || null,
            fallbackUsed: Boolean(result.fallbackUsed),
            fallbackFrom: result.fallbackFrom || null,
            streamedText,
            hadStreamedActions: actionsSentStatus,
          };
        })
        .finally(() => {
          setPass1Request(null);
        });
    }

    let pass1Result = await runStreamedPass1(messages);
    let currentResponse = pass1Result.text;
    let aggregatedUsage = pass1Result.usage ? { ...pass1Result.usage } : null;
    let finalProviderUsed = pass1Result.providerUsed || null;
    let finalModelUsed = pass1Result.modelUsed || pass1Result.usage?.model || null;
    let finalFallbackUsed = Boolean(pass1Result.fallbackUsed);
    let finalFallbackFrom = pass1Result.fallbackFrom || null;
    if (isAbortRequested()) {
      throwIfAborted();
    }

    let iterationActions = parseWorkspaceActions(currentResponse);

    if (iterationActions.length === 0) {
      setPass2Cleanup(null);
      updateWorkspaceSession(sessionId, { phase: 'done' });
      const cleanedResponse = currentResponse.replace(/ACTION:\s*\{[\s\S]*?\}\s*(?=\n|$)/g, '').trim();
      try { autoExtractAndSave(cleanedResponse); } catch (extractErr) { console.error('[workspace] auto-extract (no-action) failed:', extractErr.message); }
      try { autoExtractConversationMemories(prompt, cleanedResponse); } catch (extractErr) { console.error('[workspace] conversation-extract (no-action) failed:', extractErr.message); }
      const noActionUsage = buildWorkspaceUsageSubdoc(aggregatedUsage, finalProviderUsed || requestedPrimaryProvider);
      saveConversationTurn(cleanedResponse, noActionUsage);
      callbacks.onDone({
        ok: true,
        fullResponse: cleanedResponse,
        actions: [],
        providerUsed: finalProviderUsed || null,
        modelUsed: finalModelUsed || noActionUsage?.model || null,
        fallbackUsed: finalFallbackUsed,
        fallbackFrom: finalFallbackFrom,
        usage: noActionUsage,
      });
      clearTimers();
      deleteWorkspaceSession(sessionId);
      return;
    }

    const lockAcquired = acquireChatLock(lockOwnerId);
    if (!lockAcquired) {
      setPass2Cleanup(null);
      clearTimers();
      updateWorkspaceSession(sessionId, {
        phase: 'error',
        lastError: 'Another workspace request is already executing actions',
      });
      deleteWorkspaceSession(sessionId);
      callbacks.onError({ ok: false, code: 'WORKSPACE_BUSY', error: 'Another workspace request is already executing actions' });
      return;
    }
    const connectedGmailAccounts = ((await connectedAccountsPromise) || [])
      .map((account) => account?.email)
      .filter(Boolean);
    const executionState = createWorkspaceExecutionState({ connectedGmailAccounts });
    let iteration = 1;
    const strippedFirstResponse = currentResponse.replace(/ACTION:\s*\{[\s\S]*?\}\s*(?=\n|$)/g, '').trim();
    loopConversationHistory.push({ role: 'assistant', content: strippedFirstResponse || currentResponse });

    while (iterationActions.length > 0 && iteration <= MAX_ACTION_ITERATIONS) {
      throwIfAborted();

      updateWorkspaceSession(sessionId, {
        phase: 'actions',
        actions: {
          planned: iterationActions.length,
          completed: 0,
          failed: 0,
          iteration,
          maxIterations: MAX_ACTION_ITERATIONS,
        },
      });

      const statusMsg = describeActions(iterationActions, iteration);
      callbacks.onStatus({
        message: statusMsg,
        phase: 'actions',
        iteration,
        maxIterations: MAX_ACTION_ITERATIONS,
        actions: iterationActions.map((action) => action.tool),
        sessionId,
      });

      const iterResults = await executeWorkspaceActions(iterationActions, executionState, {
        shouldAbort: isAbortRequested,
        abortMessage: actionFlowAbortReason || 'Workspace action loop aborted',
      });
      recordWorkspaceActions(sessionId, iterationActions, iterResults);
      allActionResults.push(...iterResults);

      patternLearner.logBehaviorBatch(iterationActions, iterResults).catch((patternErr) => {
        console.error('[workspace] pattern learning failed:', patternErr.message);
      });

      throwIfAborted();

      callbacks.onActions({
        results: iterResults,
        iteration,
      });

      const isLastIteration = iteration >= MAX_ACTION_ITERATIONS;
      const resultsLines = [
        `Action results (round ${iteration}/${MAX_ACTION_ITERATIONS}):`,
        '',
        JSON.stringify(iterResults.map((result) => {
          if (!result || typeof result !== 'object') return result;
          const compact = { tool: result.tool };
          if (result.error) {
            compact.status = 'error';
            compact.error = result.error;
            if (result.failFast) compact.failFast = true;
          } else {
            compact.status = 'ok';
            if (result.verified !== undefined) {
              compact.verified = result.verified;
              if (result.warnings && result.warnings.length > 0) compact.warnings = result.warnings;
            }
            if (result.result && typeof result.result === 'object') {
              for (const key of Object.keys(result.result)) {
                if (typeof result.result[key] === 'string' && result.result[key].length > 500) {
                  compact[key] = result.result[key].slice(0, 500) + '... [truncated]';
                } else {
                  compact[key] = result.result[key];
                }
              }
            }
          }
          return compact;
        })),
      ];
      resultsLines.push(...buildWorkspaceExecutionCoverageLines(executionState));

      if (isLastIteration) {
        resultsLines.push(
          '',
          'INSTRUCTIONS:',
          'This is the FINAL round. You MUST now provide your complete summary to the user.',
          'Do NOT include any ACTION commands.',
          'NEVER repeat your previous response. You already said it \u2014 the user already saw it.',
          'Your response here should ONLY be the concise receipt of actions taken.',
          'Format: "[N] actions taken: [brief comma-separated list]. [Any pending items as a single question]."',
          'Maximum 3 sentences. No tables. No bullet points. No repeating what you said before.',
          'Use the execution coverage above as your checklist. If the user asked for multiple accounts, folders, or ranges and any requested scope is still untouched, say exactly what remains or what blocked you.',
          '**ACCURACY CHECK:** Verify all dates, times, and details match the source data exactly.',
          '**SOURCE ATTRIBUTION:** Indicate where each key detail came from.',
        );
      } else {
        resultsLines.push(
          '',
          'Continue. If you need to perform follow-up actions based on these results, emit more ACTION blocks.',
          'If you have everything you need, provide a BRIEF receipt of what you did (2-3 sentences max). No ACTION blocks.',
          'NEVER repeat your previous response. You already said it \u2014 the user already saw it.',
          'Your response here should ONLY be the concise receipt of actions taken.',
          'Format: "[N] actions taken: [brief comma-separated list]. [Items needing decision]."',
          'Maximum 3 sentences. No tables. No bullet points. No repeating what you said before.',
          'Use the execution coverage above as your checklist. If the request spans multiple accounts, folders, or ranges, continue until each requested scope has been touched or you can state the blocker clearly.',
        );
      }

      const resultsPrompt = resultsLines.join('\n');
      loopConversationHistory.push({ role: 'user', content: resultsPrompt });

      callbacks.onStatus({
        message: isLastIteration ? 'Summarizing results...' : `Processing results (round ${iteration})...`,
        phase: isLastIteration ? 'summary' : `loop-${iteration}`,
        iteration,
        sessionId,
      });

      const recentHistory = loopConversationHistory.slice(-12);
      const loopMessages = [...messages, ...recentHistory];
      const passLabel = isLastIteration ? 'summary' : `loop-${iteration + 1}`;
      const loopResult = await runCollectedPass(loopMessages, passLabel);
      currentResponse = loopResult.text;
      finalProviderUsed = loopResult.providerUsed || finalProviderUsed;
      finalModelUsed = loopResult.modelUsed || loopResult.usage?.model || finalModelUsed;
      finalFallbackUsed = Boolean(loopResult.fallbackUsed || finalFallbackUsed);
      finalFallbackFrom = loopResult.fallbackFrom || finalFallbackFrom;
      if (loopResult.usage) {
        if (aggregatedUsage) {
          aggregatedUsage.inputTokens = (aggregatedUsage.inputTokens || 0) + (loopResult.usage.inputTokens || 0);
          aggregatedUsage.outputTokens = (aggregatedUsage.outputTokens || 0) + (loopResult.usage.outputTokens || 0);
          aggregatedUsage.totalTokens = (aggregatedUsage.totalTokens || 0) + (loopResult.usage.totalTokens || 0);
          aggregatedUsage.totalCostMicros = (aggregatedUsage.totalCostMicros || 0) + (loopResult.usage.totalCostMicros || 0);
        } else {
          aggregatedUsage = { ...loopResult.usage };
        }
      }
      throwIfAborted();

      iterationActions = isLastIteration ? [] : parseWorkspaceActions(currentResponse);
      const strippedLoopResponse = currentResponse.replace(/ACTION:\s*\{[\s\S]*?\}\s*(?=\n|$)/g, '').trim();
      loopConversationHistory.push({ role: 'assistant', content: strippedLoopResponse || currentResponse });
      iteration++;
    }

    releaseChatLock(lockOwnerId);

    const finalResponse = currentResponse.replace(/ACTION:\s*\{[\s\S]*?\}\s*(?=\n|$)/g, '').trim();

    if (finalResponse && !isClientDisconnected()) {
      callbacks.onChunk({ text: '\n\n---\n\n' });
      callbacks.onChunk({ text: finalResponse });
    }

    clearTimers();
    setPass2Cleanup(null);
    updateWorkspaceSession(sessionId, { phase: 'done' });
    deleteWorkspaceSession(sessionId);

    try { autoExtractAndSave(finalResponse); } catch (extractErr) { console.error('[workspace] auto-extract (final) failed:', extractErr.message); }
    try { autoExtractConversationMemories(prompt, finalResponse); } catch (extractErr) { console.error('[workspace] conversation-extract (final) failed:', extractErr.message); }
    const finalUsage = buildWorkspaceUsageSubdoc(aggregatedUsage, finalProviderUsed || requestedPrimaryProvider);
    saveConversationTurn(finalResponse, finalUsage);

    if (isClientDisconnected()) return;
    callbacks.onDone({
      ok: true,
      fullResponse: finalResponse,
      actions: allActionResults,
      iterations: iteration - 1,
      providerUsed: finalProviderUsed || null,
      modelUsed: finalModelUsed || finalUsage?.model || null,
      fallbackUsed: finalFallbackUsed,
      fallbackFrom: finalFallbackFrom,
      usage: finalUsage,
    });
  } catch (err) {
    releaseChatLock(lockOwnerId);
    clearTimers();
    setPass2Cleanup(null);
    updateWorkspaceSession(sessionId, {
      phase: err.code === 'ABORTED' ? 'aborted' : 'error',
      lastError: err.message || 'Workspace agent error',
    });
    if (err.code !== 'ABORTED' && !isClientDisconnected()) {
      reportServerError({
        message: `Workspace error: ${err.message || 'Unknown error'}`,
        detail: 'Workspace route failed before it could complete the current request.',
        stack: err.stack || '',
        source: 'services/workspace-request-service.js',
        category: 'runtime-error',
        severity: err.code === 'TIMEOUT' ? 'warning' : 'error',
      });
    }
    console.error('[Workspace AI] error:', err.message);
    if (!isClientDisconnected()) {
      callbacks.onError({
        ok: false,
        code: err.code || 'AI_ERROR',
        error: err.message || 'Workspace agent error',
        detail: err.detail || '',
      });
    }
    deleteWorkspaceSession(sessionId);
  }
}

module.exports = { runWorkspaceActionLoop };
