'use strict';

const gmail = require('./gmail');
const calendar = require('./calendar');
const { startChatOrchestration } = require('./chat-orchestrator');
const { getDefaultProvider, getAlternateProvider } = require('./providers/registry');
const actionLog = require('./workspace-action-log');
const { markMessageProcessed } = require('./workspace-runtime');
const { logUsage } = require('../lib/usage-writer');
const { calculateCost } = require('../lib/pricing');
const {
  normalizeWorkspaceLabelRef,
  orderWorkspaceActionsByDependency,
  prepareActionForExecution,
  trackWorkspaceExecutionState,
} = require('./workspace-tools/execution-state');
const { WORKSPACE_TOOL_HANDLERS: TOOL_HANDLERS } = require('./workspace-tools/handler-registry');

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const WORKSPACE_CHAT_TIMEOUT_MS = Math.min(
  parsePositiveInt(process.env.WORKSPACE_CHAT_TIMEOUT_MS, 600_000),
  1_800_000
);
const WORKSPACE_PRIMARY_PROVIDER = getDefaultProvider();
const WORKSPACE_FALLBACK_PROVIDER = getAlternateProvider(WORKSPACE_PRIMARY_PROVIDER);
const WORKSPACE_ALLOWED_REASONING = new Set(['low', 'medium', 'high', 'xhigh']);

const VERIFICATION_HANDLERS = {
  'calendar.createEvent': async (params, result) => {
    const warnings = [];
    if (!result || !result.event || !result.event.id) return { verified: false, warnings: ['No event ID returned'] };
    const readBack = await calendar.getEvent('primary', result.event.id, params.account || undefined);
    if (!readBack || !readBack.ok || !readBack.event) return { verified: false, warnings: ['Could not re-read created event'] };
    const ev = readBack.event;
    if (params.summary && ev.summary !== params.summary) warnings.push(`summary mismatch: expected "${params.summary}", got "${ev.summary}"`);
    if (params.start) {
      const expected = typeof params.start === 'string' ? params.start : (params.start.dateTime || params.start.date || '');
      const actual = ev.start.dateTime || ev.start.date || '';
      if (expected && actual && !actual.startsWith(expected.replace(/Z$/, ''))) warnings.push(`start mismatch: expected "${expected}", got "${actual}"`);
    }
    if (params.end) {
      const expected = typeof params.end === 'string' ? params.end : (params.end.dateTime || params.end.date || '');
      const actual = ev.end.dateTime || ev.end.date || '';
      if (expected && actual && !actual.startsWith(expected.replace(/Z$/, ''))) warnings.push(`end mismatch: expected "${expected}", got "${actual}"`);
    }
    if (params.reminders && !params.reminders.useDefault) {
      if (ev.reminders && ev.reminders.useDefault !== false) warnings.push('reminders.useDefault is true but custom reminders were requested');
    }
    return { verified: warnings.length === 0, warnings };
  },

  'calendar.updateEvent': async (params, result) => {
    const warnings = [];
    if (!result || !result.event || !result.event.id) return { verified: false, warnings: ['No event ID in update result'] };
    const readBack = await calendar.getEvent(params.calendarId || 'primary', params.eventId, params.account || undefined);
    if (!readBack || !readBack.ok || !readBack.event) return { verified: false, warnings: ['Could not re-read updated event'] };
    const ev = readBack.event;
    if (params.summary !== undefined && ev.summary !== params.summary) warnings.push(`summary mismatch: expected "${params.summary}", got "${ev.summary}"`);
    if (params.location !== undefined && ev.location !== params.location) warnings.push(`location mismatch: expected "${params.location}", got "${ev.location}"`);
    if (params.description !== undefined && ev.description !== params.description) warnings.push('description mismatch');
    if (params.reminders && !params.reminders.useDefault) {
      if (ev.reminders && ev.reminders.useDefault !== false) warnings.push('reminders.useDefault is true but custom reminders were requested');
    }
    return { verified: warnings.length === 0, warnings };
  },

  'gmail.createLabel': async (params, result) => {
    const warnings = [];
    const listResult = await gmail.listLabels(params.account || undefined);
    if (!listResult || !listResult.ok) {
      return { verified: false, warnings: ['Could not re-list labels after creating label'] };
    }

    const expectedName = normalizeWorkspaceLabelRef(result?.label?.name || params.name).toLowerCase();
    const found = (listResult.labels || []).find((label) => {
      if (result?.label?.id && label.id === result.label.id) return true;
      return expectedName && normalizeWorkspaceLabelRef(label.name).toLowerCase() === expectedName;
    });
    if (!found) {
      warnings.push(`Created label "${params.name}" was not found in Gmail after creation`);
    }
    return { verified: warnings.length === 0, warnings };
  },

  'gmail.label': async (params, result) => {
    const warnings = [];
    if (!params.messageId) return { verified: false, warnings: ['No messageId to verify'] };
    const msg = await gmail.getMessage(params.messageId, params.account || undefined);
    if (!msg || !msg.ok) return { verified: false, warnings: ['Could not re-read message after labeling'] };
    if (!msg.labels || !msg.labels.includes(params.labelId)) {
      warnings.push(`labelIds does not include "${params.labelId}" after applying label`);
    }
    return { verified: warnings.length === 0, warnings };
  },

  'gmail.removeLabel': async (params, result) => {
    const warnings = [];
    if (!params.messageId) return { verified: false, warnings: ['No messageId to verify'] };
    const msg = await gmail.getMessage(params.messageId, params.account || undefined);
    if (!msg || !msg.ok) return { verified: false, warnings: ['Could not re-read message after removing label'] };
    if (msg.labels && msg.labels.includes(params.labelId)) {
      warnings.push(`labelIds still includes "${params.labelId}" after removing label`);
    }
    return { verified: warnings.length === 0, warnings };
  },

  'gmail.archive': async (params, result) => {
    const warnings = [];
    if (!params.messageId) return { verified: false, warnings: ['No messageId to verify'] };
    const msg = await gmail.getMessage(params.messageId, params.account || undefined);
    if (!msg || !msg.ok) return { verified: false, warnings: ['Could not re-read message after archiving'] };
    if (msg.labels && msg.labels.includes('INBOX')) {
      warnings.push('Message still has INBOX label after archive');
    }
    return { verified: warnings.length === 0, warnings };
  },

  'gmail.batchModify': async (params, result) => {
    const warnings = [];
    const sampleIds = Array.isArray(params.messageIds) ? params.messageIds.slice(0, 3) : [];
    if (sampleIds.length === 0) {
      return { verified: false, warnings: ['No messageIds to verify'] };
    }

    const addLabelIds = new Set(params.addLabelIds || []);
    const removeLabelIds = new Set(params.removeLabelIds || []);

    for (const messageId of sampleIds) {
      const msg = await gmail.getMessage(messageId, params.account || undefined);
      if (!msg || !msg.ok) {
        warnings.push(`Could not re-read message ${messageId} after batchModify`);
        if (warnings.length >= 3) break;
        continue;
      }

      const labels = new Set(msg.labels || []);
      for (const labelId of addLabelIds) {
        if (!labels.has(labelId)) {
          warnings.push(`Message ${messageId} is missing added label "${labelId}" after batchModify`);
          break;
        }
      }
      for (const labelId of removeLabelIds) {
        if (labels.has(labelId)) {
          warnings.push(`Message ${messageId} still has removed label "${labelId}" after batchModify`);
          break;
        }
      }
      if (warnings.length >= 3) break;
    }

    return { verified: warnings.length === 0, warnings };
  },
};

const TRANSIENT_ERROR_PATTERNS = ['429', 'rate limit', 'quota', '503', 'timeout', 'etimedout', 'econnreset'];
const NON_RETRYABLE_TOOLS = new Set(['gmail.send', 'gmail.trash', 'gmail.draft', 'gmail.createLabel', 'calendar.deleteEvent']);
const failureFingerprints = new Map();

function normalizeWorkspaceReasoningEffort(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return WORKSPACE_ALLOWED_REASONING.has(normalized) ? normalized : 'high';
}

function clearWorkspaceFailureFingerprints() {
  failureFingerprints.clear();
}

function isTransientError(err) {
  const msg = String(err && err.message ? err.message : err).toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => msg.includes(pattern));
}

function getFailureFingerprint(action) {
  return `${action.tool}:${JSON.stringify(Object.keys(action.params || {}).sort())}`;
}

function parseWorkspaceActions(text) {
  const actions = [];
  const regex = /ACTION:\s*(\{[\s\S]*?\})\s*(?=\n|$)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.tool && typeof parsed.tool === 'string') {
        actions.push({ tool: parsed.tool, params: parsed.params || {} });
      }
    } catch {
      // Skip malformed action blocks.
    }
  }
  return actions;
}

function createWorkspaceAbortError(message = 'Workspace action loop aborted') {
  const err = new Error(message);
  err.code = 'ABORTED';
  return err;
}

async function executeWorkspaceActions(actions, executionState, opts = {}) {
  const ordered = orderWorkspaceActionsByDependency(actions);
  const results = [];
  const shouldAbort = typeof opts.shouldAbort === 'function' ? opts.shouldAbort : () => false;
  const abortMessage = typeof opts.abortMessage === 'string' && opts.abortMessage.trim()
    ? opts.abortMessage
    : 'Workspace action loop aborted';

  for (const action of ordered) {
    if (shouldAbort()) {
      throw createWorkspaceAbortError(abortMessage);
    }
    const handler = TOOL_HANDLERS[action.tool];
    if (!handler) {
      actionLog.logAction({
        action: action.tool,
        params: action.params,
        result: `Unknown tool: ${action.tool}`,
        status: 'error',
        durationMs: 0,
      });
      results.push({ tool: action.tool, error: `Unknown tool: ${action.tool}` });
      continue;
    }

    let preparedAction;
    try {
      preparedAction = await prepareActionForExecution(action, executionState);
    } catch (prepErr) {
      const errMsg = prepErr?.message || 'Failed to prepare action';
      actionLog.logAction({
        action: action.tool,
        params: action.params,
        result: errMsg,
        status: 'error',
        durationMs: 0,
      });
      results.push({ tool: action.tool, error: errMsg, preparationFailed: true });
      continue;
    }

    const fingerprint = getFailureFingerprint(preparedAction);
    const priorFailure = failureFingerprints.get(fingerprint);
    if (priorFailure && priorFailure.count >= 2) {
      const failFastMsg = 'This action has failed 2 times with the same approach. The system cannot complete this action.';
      actionLog.logAction({
        action: preparedAction.tool,
        params: preparedAction.params,
        result: failFastMsg,
        status: 'error',
        durationMs: 0,
      });
      results.push({ tool: preparedAction.tool, error: failFastMsg, failFast: true });
      continue;
    }

    const startMs = Date.now();
    const maxAttempts = NON_RETRYABLE_TOOLS.has(preparedAction.tool) ? 1 : 3;
    let lastErr = null;
    let succeeded = false;
    let result;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (shouldAbort()) {
        throw createWorkspaceAbortError(abortMessage);
      }
      try {
        result = await handler(preparedAction.params);
        succeeded = true;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < maxAttempts && isTransientError(err)) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        break;
      }
    }

    if (succeeded) {
      let verified;
      let warnings;
      const verifier = VERIFICATION_HANDLERS[preparedAction.tool];
      if (verifier) {
        try {
          const verificationResult = await verifier(preparedAction.params, result);
          verified = verificationResult.verified;
          warnings = verificationResult.warnings || [];
        } catch (verificationErr) {
          verified = false;
          warnings = [`Verification error: ${verificationErr.message}`];
        }
      }

      actionLog.logAction({
        action: preparedAction.tool,
        params: preparedAction.params,
        result,
        status: 'ok',
        durationMs: Date.now() - startMs,
        ...(verified !== undefined ? { verified, warnings } : {}),
      });

      trackWorkspaceExecutionState(executionState, preparedAction, result);

      const entry = { tool: preparedAction.tool, result };
      if (verified !== undefined) {
        entry.verified = verified;
        entry.warnings = warnings;
      }
      results.push(entry);

      if (preparedAction.params?.messageId && preparedAction.tool.startsWith('gmail.')) {
        markMessageProcessed(preparedAction.params.messageId);
      }
    } else {
      const errMsg = (lastErr && lastErr.message) || 'Execution failed';
      const existing = failureFingerprints.get(fingerprint) || { count: 0, lastError: '' };
      existing.count++;
      existing.lastError = errMsg;
      failureFingerprints.set(fingerprint, existing);

      actionLog.logAction({
        action: preparedAction.tool,
        params: preparedAction.params,
        result: errMsg,
        status: 'error',
        durationMs: Date.now() - startMs,
      });
      results.push({ tool: preparedAction.tool, error: errMsg });
    }
  }

  return results;
}

function logWorkspaceAttempts(attempts, opts) {
  if (!Array.isArray(attempts)) return;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    if (attempt.provider === 'regex') continue;
    const usage = attempt.usage || {};
    const status = attempt.status === 'ok'
      ? 'ok'
      : (attempt.errorCode === 'TIMEOUT' ? 'timeout' : (attempt.errorCode === 'ABORT' ? 'abort' : 'error'));
    logUsage({
      requestId: opts.requestId,
      attemptIndex: i,
      service: 'workspace',
      provider: attempt.provider,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      usageAvailable: !!attempt.usage,
      usageComplete: usage.usageComplete,
      rawUsage: usage.rawUsage,
      mode: opts.mode,
      status,
      latencyMs: attempt.latencyMs,
    });
  }
}

function buildWorkspaceUsageSubdoc(usage, provider) {
  if (!usage) return null;
  const inputTokens = usage.inputTokens || 0;
  const outputTokens = usage.outputTokens || 0;
  const cost = calculateCost(inputTokens, outputTokens, usage.model || '', provider || 'claude');
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    model: usage.model || null,
    totalCostMicros: cost.totalCostMicros,
    usageAvailable: true,
  };
}

function startWorkspaceCollectedChat({
  messages,
  systemPrompt,
  timeoutMs = WORKSPACE_CHAT_TIMEOUT_MS,
  mode = 'fallback',
  primaryProvider = WORKSPACE_PRIMARY_PROVIDER,
  primaryModel = '',
  fallbackProvider = WORKSPACE_FALLBACK_PROVIDER,
  fallbackModel = '',
  reasoningEffort = 'high',
  onChunk,
  onThinkingChunk,
  onStatus,
}) {
  let abort = () => {};
  let rejectPromise = () => {};

  const promise = new Promise((resolve, reject) => {
    let fullText = '';
    let settled = false;
    rejectPromise = reject;

    const safetyTimeoutMs = Math.round(timeoutMs * 1.5);
    const timer = setTimeout(() => {
      if (!settled) {
        try { abort(); } catch { /* ignore */ }
        const timeoutErr = new Error(`Workspace agent timed out after ${Math.round(safetyTimeoutMs / 1000)}s (safety net)`);
        timeoutErr.code = 'TIMEOUT';
        reject(timeoutErr);
      }
    }, safetyTimeoutMs);

    const cleanup = startChatOrchestration({
      mode,
      primaryProvider,
      primaryModel,
      fallbackProvider,
      fallbackModel,
      messages,
      systemPrompt,
      timeoutMs,
      reasoningEffort,
      onChunk: ({ text, provider }) => {
        fullText += text;
        try { onChunk?.(text, provider); } catch { /* ignore caller callback errors */ }
      },
      onThinkingChunk: onThinkingChunk ? ({ thinking, provider }) => {
        try { onThinkingChunk?.(thinking, provider); } catch { /* ignore caller callback errors */ }
      } : undefined,
      onProviderError: (detail) => {
        try { onStatus?.({ type: 'provider_error', ...detail }); } catch { /* ignore */ }
      },
      onFallback: (detail) => {
        try { onStatus?.({ type: 'fallback', ...detail }); } catch { /* ignore */ }
      },
      onDone: ({ fullResponse, providerUsed, modelUsed, fallbackUsed, fallbackFrom, attempts, usage }) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({
            fullResponse: typeof fullResponse === 'string' && fullResponse ? fullResponse : fullText,
            providerUsed: providerUsed || null,
            modelUsed: modelUsed || usage?.model || null,
            fallbackUsed: Boolean(fallbackUsed),
            fallbackFrom: fallbackFrom || null,
            attempts: Array.isArray(attempts) ? attempts : [],
            usage: usage || null,
          });
        }
      },
      onError: (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const nextErr = new Error(err?.message || 'Workspace chat failed');
          nextErr.code = err?.code || 'PROVIDER_EXEC_FAILED';
          nextErr.detail = err?.detail || '';
          nextErr.attempts = Array.isArray(err?.attempts) ? err.attempts : [];
          nextErr._usage = err?.usage || null;
          reject(nextErr);
        }
      },
      onAbort: () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const abortErr = new Error('Workspace chat aborted');
          abortErr.code = 'ABORTED';
          reject(abortErr);
        }
      },
    });

    abort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { cleanup?.(); } catch { /* ignore */ }
    };
  });

  return {
    promise,
    abort: (reason = 'Workspace request aborted') => {
      abort();
      const err = new Error(reason);
      err.code = 'ABORTED';
      rejectPromise(err);
    },
  };
}

module.exports = {
  buildWorkspaceUsageSubdoc,
  clearWorkspaceFailureFingerprints,
  executeWorkspaceActions,
  logWorkspaceAttempts,
  normalizeWorkspaceReasoningEffort,
  parseWorkspaceActions,
  startWorkspaceCollectedChat,
};
