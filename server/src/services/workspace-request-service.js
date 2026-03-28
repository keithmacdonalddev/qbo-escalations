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

function writeSseEvent(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function endSseResponse(res) {
  try {
    res.end();
  } catch {
    // Ignore disconnect races.
  }
}

async function runWorkspaceRequest({
  res,
  useActionFlow,
  prompt,
  messages,
  sessionId,
  requestedPrimaryProvider,
  effectiveReasoningEffort,
  timeoutMs,
  policy,
  requestState,
  saveConversationTurn,
  connectedAccountsPromise,
  workspaceRole,
  workspaceChatOnlyRole,
  runtime,
  ui,
}) {
  const {
    updateWorkspaceSession,
    recordWorkspaceChunk,
    recordWorkspaceActions,
    completeWorkspacePass,
    deleteWorkspaceSession,
    acquireChatLock,
    releaseChatLock,
  } = runtime;
  const { clearTimers, markAiSubprocessOutputReceived } = ui;

  const isClientDisconnected = () => requestState.isClientDisconnected();
  const clearSpawnGuard = () => requestState.clearSpawnGuard?.();
  const setPass1Request = (value) => requestState.setPass1Request?.(value);
  const setPass2Cleanup = (value) => requestState.setPass2Cleanup?.(value);

  try {
    if (!useActionFlow) {
      const cleanup = startChatOrchestration({
        mode: policy.mode,
        primaryProvider: policy.primaryProvider,
        fallbackProvider: policy.fallbackProvider,
        messages,
        systemPrompt: workspaceChatOnlyRole,
        timeoutMs,
        reasoningEffort: effectiveReasoningEffort,
        onChunk: ({ text }) => {
          markAiSubprocessOutputReceived();
          if (isClientDisconnected()) return;
          recordWorkspaceChunk(sessionId, 'pass1', text);
          writeSseEvent(res, 'chunk', { text });
        },
        onThinkingChunk: ({ thinking, provider }) => {
          markAiSubprocessOutputReceived();
          if (isClientDisconnected()) return;
          writeSseEvent(res, 'thinking', {
            thinking,
            provider,
            phase: 'direct',
          });
        },
        onProviderError: (detail) => {
          markAiSubprocessOutputReceived();
          if (!isClientDisconnected()) {
            writeSseEvent(res, 'provider_error', {
              ...(detail || {}),
              phase: 'direct',
              sessionId,
            });
            writeSseEvent(res, 'status', {
              type: 'provider_error',
              message: detail?.message || 'Workspace provider error',
              provider: detail?.provider || null,
              phase: 'direct',
              sessionId,
            });
          }
          updateWorkspaceSession(sessionId, {
            lastError: detail?.message || 'Workspace provider error',
          });
        },
        onFallback: ({ from, to }) => {
          markAiSubprocessOutputReceived();
          if (isClientDisconnected()) return;
          writeSseEvent(res, 'fallback', {
            from,
            to,
            phase: 'direct',
            sessionId,
          });
          writeSseEvent(res, 'status', {
            type: 'fallback',
            from,
            to,
            message: `Switching provider from ${from} to ${to}...`,
            phase: 'direct',
            sessionId,
          });
        },
        onDone: ({ fullResponse, providerUsed, usage, attempts }) => {
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
          writeSseEvent(res, 'done', {
            ok: true,
            fullResponse,
            actions: [],
            usage: usageSubdoc,
          });
          endSseResponse(res);
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
            writeSseEvent(res, 'error', {
              ok: false,
              code: err.code || 'AI_ERROR',
              error: err.message || 'Workspace agent error',
              detail: err.detail || '',
            });
            endSseResponse(res);
          }
          deleteWorkspaceSession(sessionId);
        },
      });

      setPass2Cleanup(cleanup);
      return;
    }

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
      const currentRequest = startWorkspaceCollectedChat({
        messages: passMessages,
        systemPrompt: workspaceRole,
        timeoutMs,
        mode: policy.mode,
        primaryProvider: policy.primaryProvider,
        fallbackProvider: policy.fallbackProvider,
        reasoningEffort: effectiveReasoningEffort,
        onChunk: (text) => {
          markAiSubprocessOutputReceived();
          recordWorkspaceChunk(sessionId, passLabel, text);
        },
        onThinkingChunk: (thinking, provider) => {
          markAiSubprocessOutputReceived();
          if (isClientDisconnected()) return;
          writeSseEvent(res, 'thinking', {
            thinking,
            provider,
            phase: passLabel,
          });
        },
        onStatus: (data) => {
          markAiSubprocessOutputReceived();
          if (isClientDisconnected()) return;
          if (data?.type === 'fallback') {
            writeSseEvent(res, 'fallback', {
              from: data.from,
              to: data.to,
              phase: passLabel,
              sessionId,
            });
            writeSseEvent(res, 'status', {
              type: 'fallback',
              from: data.from,
              to: data.to,
              message: `Switching provider from ${data.from} to ${data.to}...`,
              phase: passLabel,
              sessionId,
            });
          }
          if (data?.type === 'provider_error') {
            writeSseEvent(res, 'provider_error', {
              ...(data || {}),
              phase: passLabel,
              sessionId,
            });
            writeSseEvent(res, 'status', {
              type: 'provider_error',
              message: data.message || 'Workspace provider error',
              provider: data.provider || null,
              phase: passLabel,
              sessionId,
            });
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
          return { text: result.fullResponse || '', usage: result.usage || null };
        })
        .finally(() => {
          setPass1Request(null);
        });
    }

    function runStreamedPass1(passMessages) {
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
            writeSseEvent(res, 'chunk', { text: pendingText });
            streamedText += pendingText;
            pendingText = '';
          }
          return;
        }

        const safeLen = pendingText.length - (ACTION_PREFIX_LEN - 1);
        if (safeLen > 0) {
          const safe = pendingText.slice(0, safeLen);
          pendingText = pendingText.slice(safeLen);
          writeSseEvent(res, 'chunk', { text: safe });
          streamedText += safe;
        }
      }

      const currentRequest = startWorkspaceCollectedChat({
        messages: passMessages,
        systemPrompt: workspaceRole,
        timeoutMs,
        mode: policy.mode,
        primaryProvider: policy.primaryProvider,
        fallbackProvider: policy.fallbackProvider,
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
          writeSseEvent(res, 'thinking', {
            thinking,
            provider,
            phase: 'pass1',
          });
        },
        onStatus: (data) => {
          markAiSubprocessOutputReceived();
          if (isClientDisconnected()) return;
          if (data?.type === 'fallback') {
            writeSseEvent(res, 'fallback', {
              from: data.from,
              to: data.to,
              phase: 'pass1',
              sessionId,
            });
            writeSseEvent(res, 'status', {
              type: 'fallback',
              from: data.from,
              to: data.to,
              message: `Switching provider from ${data.from} to ${data.to}...`,
              phase: 'pass1',
              sessionId,
            });
          }
          if (data?.type === 'provider_error') {
            writeSseEvent(res, 'provider_error', {
              ...(data || {}),
              phase: 'pass1',
              sessionId,
            });
            writeSseEvent(res, 'status', {
              type: 'provider_error',
              message: data.message || 'Workspace provider error',
              provider: data.provider || null,
              phase: 'pass1',
              sessionId,
            });
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
            writeSseEvent(res, 'chunk', { text: before });
            streamedText += before;
          }

          insideAction = true;
          actionBuffer = pendingText.slice(idx + ACTION_PREFIX_LEN);
          pendingText = '';

          if (!actionsSentStatus && !isClientDisconnected()) {
            actionsSentStatus = true;
            writeSseEvent(res, 'status', {
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
    if (isClientDisconnected()) return;

    let iterationActions = parseWorkspaceActions(currentResponse);

    if (iterationActions.length === 0) {
      updateWorkspaceSession(sessionId, { phase: 'done' });
      const cleanedResponse = currentResponse.replace(/ACTION:\s*\{[\s\S]*?\}\s*(?=\n|$)/g, '').trim();
      try { autoExtractAndSave(cleanedResponse); } catch (extractErr) { console.error('[workspace] auto-extract (no-action) failed:', extractErr.message); }
      try { autoExtractConversationMemories(prompt, cleanedResponse); } catch (extractErr) { console.error('[workspace] conversation-extract (no-action) failed:', extractErr.message); }
      const noActionUsage = buildWorkspaceUsageSubdoc(aggregatedUsage, requestedPrimaryProvider);
      saveConversationTurn(cleanedResponse, noActionUsage);
      writeSseEvent(res, 'done', {
        ok: true,
        fullResponse: cleanedResponse,
        actions: [],
        usage: noActionUsage,
      });
      endSseResponse(res);
      clearTimers();
      deleteWorkspaceSession(sessionId);
      return;
    }

    acquireChatLock();
    const connectedGmailAccounts = ((await connectedAccountsPromise) || [])
      .map((account) => account?.email)
      .filter(Boolean);
    const executionState = createWorkspaceExecutionState({ connectedGmailAccounts });
    let iteration = 1;
    const strippedFirstResponse = currentResponse.replace(/ACTION:\s*\{[\s\S]*?\}\s*(?=\n|$)/g, '').trim();
    loopConversationHistory.push({ role: 'assistant', content: strippedFirstResponse || currentResponse });

    while (iterationActions.length > 0 && iteration <= MAX_ACTION_ITERATIONS) {
      if (isClientDisconnected()) return;

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
      writeSseEvent(res, 'status', {
        message: statusMsg,
        phase: 'actions',
        iteration,
        maxIterations: MAX_ACTION_ITERATIONS,
        actions: iterationActions.map((action) => action.tool),
        sessionId,
      });

      const iterResults = await executeWorkspaceActions(iterationActions, executionState);
      recordWorkspaceActions(sessionId, iterationActions, iterResults);
      allActionResults.push(...iterResults);

      patternLearner.logBehaviorBatch(iterationActions, iterResults).catch((patternErr) => {
        console.error('[workspace] pattern learning failed:', patternErr.message);
      });

      if (isClientDisconnected()) return;

      writeSseEvent(res, 'actions', {
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
          'NEVER repeat your previous response. You already said it — the user already saw it.',
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
          'NEVER repeat your previous response. You already said it — the user already saw it.',
          'Your response here should ONLY be the concise receipt of actions taken.',
          'Format: "[N] actions taken: [brief comma-separated list]. [Items needing decision]."',
          'Maximum 3 sentences. No tables. No bullet points. No repeating what you said before.',
          'Use the execution coverage above as your checklist. If the request spans multiple accounts, folders, or ranges, continue until each requested scope has been touched or you can state the blocker clearly.',
        );
      }

      const resultsPrompt = resultsLines.join('\n');
      loopConversationHistory.push({ role: 'user', content: resultsPrompt });

      writeSseEvent(res, 'status', {
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
      if (isClientDisconnected()) return;

      iterationActions = isLastIteration ? [] : parseWorkspaceActions(currentResponse);
      const strippedLoopResponse = currentResponse.replace(/ACTION:\s*\{[\s\S]*?\}\s*(?=\n|$)/g, '').trim();
      loopConversationHistory.push({ role: 'assistant', content: strippedLoopResponse || currentResponse });
      iteration++;
    }

    releaseChatLock();

    const finalResponse = currentResponse.replace(/ACTION:\s*\{[\s\S]*?\}\s*(?=\n|$)/g, '').trim();

    if (finalResponse && !isClientDisconnected()) {
      writeSseEvent(res, 'chunk', { text: '\n\n---\n\n' });
      writeSseEvent(res, 'chunk', { text: finalResponse });
    }

    clearTimers();
    updateWorkspaceSession(sessionId, { phase: 'done' });
    deleteWorkspaceSession(sessionId);

    try { autoExtractAndSave(finalResponse); } catch (extractErr) { console.error('[workspace] auto-extract (final) failed:', extractErr.message); }
    try { autoExtractConversationMemories(prompt, finalResponse); } catch (extractErr) { console.error('[workspace] conversation-extract (final) failed:', extractErr.message); }
    const finalUsage = buildWorkspaceUsageSubdoc(aggregatedUsage, requestedPrimaryProvider);
    saveConversationTurn(finalResponse, finalUsage);

    if (isClientDisconnected()) return;
    writeSseEvent(res, 'done', {
      ok: true,
      actions: allActionResults,
      iterations: iteration - 1,
      usage: finalUsage,
    });
    endSseResponse(res);
  } catch (err) {
    releaseChatLock();
    clearTimers();
    updateWorkspaceSession(sessionId, {
      phase: 'error',
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
      writeSseEvent(res, 'error', {
        ok: false,
        code: err.code || 'AI_ERROR',
        error: err.message || 'Workspace agent error',
        detail: err.detail || '',
      });
      endSseResponse(res);
    }
    deleteWorkspaceSession(sessionId);
  }
}

module.exports = {
  runWorkspaceRequest,
};
