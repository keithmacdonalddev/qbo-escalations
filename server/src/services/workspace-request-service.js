'use strict';

const { runWorkspaceActionLoop } = require('./workspace-action-loop');
const { learnFromInteraction, recordAgentActivity, recordAgentToolUsage } = require('./agent-identity-service');

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
  await recordAgentActivity('workspace', {
    type: 'message',
    phase: 'user-input',
    status: 'received',
    summary: 'Workspace received a new user request.',
    detail: prompt,
  }, { surface: 'workspace' }).catch(() => {});
  const callbacks = {
    onChunk: (data) => writeSseEvent(res, 'chunk', data),
    onThinking: (data) => writeSseEvent(res, 'thinking', data),
    onStatus: (data) => {
      recordAgentActivity('workspace', {
        type: 'status',
        phase: data?.phase || data?.type || 'status',
        status: data?.type || 'info',
        summary: data?.message || 'Workspace emitted a status update.',
        detail: data,
      }, { surface: 'workspace' }).catch(() => {});
      return writeSseEvent(res, 'status', data);
    },
    onActions: (data) => {
      recordAgentActivity('workspace', {
        type: 'tool',
        phase: 'actions',
        status: 'ok',
        summary: `Workspace completed ${Array.isArray(data?.results) ? data.results.length : 0} action(s).`,
        detail: data,
      }, { surface: 'workspace' }).catch(() => {});
      return writeSseEvent(res, 'actions', data);
    },
    onProviderError: (data) => {
      recordAgentActivity('workspace', {
        type: 'error',
        phase: 'provider-error',
        status: 'error',
        summary: data?.message || 'Workspace provider attempt failed.',
        detail: data,
      }, { surface: 'workspace' }).catch(() => {});
      return writeSseEvent(res, 'provider_error', data);
    },
    onFallback: (data) => {
      recordAgentActivity('workspace', {
        type: 'fallback',
        phase: 'provider-fallback',
        status: 'warning',
        summary: `${data?.from || 'primary'} -> ${data?.to || 'fallback'}`,
        detail: data,
      }, { surface: 'workspace' }).catch(() => {});
      return writeSseEvent(res, 'fallback', data);
    },
    onDone: async (data) => {
      await learnFromInteraction({ role: 'user', content: prompt }, { surface: 'workspace' }).catch(() => {});
      await learnFromInteraction({
        role: 'assistant',
        agentId: 'workspace',
        content: data?.fullResponse || '',
      }, { surface: 'workspace' }).catch(() => {});
      await recordAgentActivity('workspace', {
        type: 'response',
        phase: 'done',
        status: 'ok',
        summary: 'Workspace finished responding.',
        detail: {
          content: data?.fullResponse || '',
          usage: data?.usage || null,
          providerUsed: data?.providerUsed || null,
        },
      }, { surface: 'workspace' }).catch(() => {});
      if (Array.isArray(data?.actions) && data.actions.length > 0) {
        await recordAgentToolUsage('workspace', data.actions, { surface: 'workspace' }).catch(() => {});
      }
      writeSseEvent(res, 'done', data);
      endSseResponse(res);
    },
    onError: (data) => {
      recordAgentActivity('workspace', {
        type: 'error',
        phase: 'error',
        status: 'error',
        summary: data?.error || data?.message || 'Workspace request failed.',
        detail: data,
      }, { surface: 'workspace' }).catch(() => {});
      writeSseEvent(res, 'error', data);
      endSseResponse(res);
    },
  };

  const hooks = {
    saveConversationTurn,
    clearTimers: ui?.clearTimers,
    markAiSubprocessOutputReceived: ui?.markAiSubprocessOutputReceived,
  };

  await runWorkspaceActionLoop(
    {
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
      isClientDisconnected: () => requestState.isClientDisconnected(),
      clearSpawnGuard: () => requestState.clearSpawnGuard?.(),
      setPass1Request: (value) => requestState.setPass1Request?.(value),
      setPass2Cleanup: (value) => requestState.setPass2Cleanup?.(value),
    },
    callbacks,
    hooks,
  );
}

module.exports = {
  runWorkspaceRequest,
};
