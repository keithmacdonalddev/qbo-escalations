import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAgentSession, streamAgentSessionRealtime } from '../api/agentStream.js';
import { apiFetch, apiFetchJson } from '../api/http.js';
import { useSharedAgentSession } from '../lib/agentSessions.js';
import {
  DEFAULT_PROVIDER,
  DEFAULT_REASONING_EFFORT,
  getAlternateProvider,
  getProviderShortLabel,
  normalizeProvider,
  normalizeReasoningEffort,
  supportsLiveReasoning,
} from '../lib/providerCatalog.js';
import { normalizeSurfaceModel, writeStoredPreference } from '../lib/surfacePreferences.js';

const WORKSPACE_SESSION_KEY = 'workspace:shared';
const WORKSPACE_SESSION_ID_KEY = 'qbo-workspace-session-id';
const WORKSPACE_ACTIVE_AGENT_SESSION_ID_KEY = 'qbo-workspace-active-agent-session-id';
const WORKSPACE_STALL_ALERT_MS = 20_000;
const LIVE_REASONING_PAUSE_MS = 12_000;

function buildInitialWorkspaceSession() {
  let initialProvider = DEFAULT_PROVIDER;
  let initialMode = 'fallback';
  let initialFallbackProvider = getAlternateProvider(DEFAULT_PROVIDER);
  let initialModel = '';
  let initialFallbackModel = '';
  let initialReasoningEffort = DEFAULT_REASONING_EFFORT;

  try {
    initialProvider = normalizeProvider(
      window.localStorage.getItem('qbo-workspace-provider')
      || window.localStorage.getItem('qbo-chat-provider')
      || DEFAULT_PROVIDER
    );
    const savedMode = window.localStorage.getItem('qbo-workspace-mode') || window.localStorage.getItem('qbo-chat-mode');
    initialMode = savedMode === 'single' ? 'single' : 'fallback';
    initialFallbackProvider = normalizeProvider(
      window.localStorage.getItem('qbo-workspace-fallback-provider')
      || window.localStorage.getItem('qbo-chat-fallback-provider')
      || getAlternateProvider(initialProvider)
    );
    initialModel = normalizeSurfaceModel(
      window.localStorage.getItem('qbo-workspace-model')
      || window.localStorage.getItem('qbo-chat-model')
    );
    initialFallbackModel = normalizeSurfaceModel(
      window.localStorage.getItem('qbo-workspace-fallback-model')
      || window.localStorage.getItem('qbo-chat-fallback-model')
    );
    initialReasoningEffort = normalizeReasoningEffort(
      window.localStorage.getItem('qbo-workspace-reasoning-effort')
      || window.localStorage.getItem('qbo-chat-reasoning-effort')
      || DEFAULT_REASONING_EFFORT
    );
  } catch {
    // Ignore storage failures and keep defaults.
  }

  return {
    provider: initialProvider,
    mode: initialMode,
    fallbackProvider: initialFallbackProvider === initialProvider
      ? getAlternateProvider(initialProvider)
      : initialFallbackProvider,
    model: initialModel,
    fallbackModel: initialFallbackModel,
    reasoningEffort: initialReasoningEffort,
    messages: [],
    input: '',
    streaming: false,
    streamText: '',
    thinkingText: '',
    statusState: null,
    lastActions: null,
    currentProvider: initialProvider,
    currentModel: initialModel || null,
    providerStatus: null,
  };
}

async function createWorkspaceAISession({
  prompt,
  context,
  conversationHistory,
  conversationSessionId,
  provider,
  primaryModel,
  mode,
  fallbackProvider,
  fallbackModel,
  reasoningEffort,
}) {
  const payload = await createAgentSession('/api/agents/sessions', {
    agentType: 'workspace',
    title: 'Workspace Agent',
    input: {
      prompt,
      context,
      conversationHistory,
      conversationSessionId,
      provider,
      primaryModel,
      mode,
      fallbackProvider,
      fallbackModel,
      reasoningEffort,
    },
  });
  return payload?.session || null;
}

function attachWorkspaceAISession(sessionId, handlers = {}) {
  return streamAgentSessionRealtime(sessionId, {
    onSession: handlers.onSession,
    onStart: handlers.onStart,
    onChunk: handlers.onChunk,
    onThinking: handlers.onThinking,
    onStatus: handlers.onStatus,
    onActions: handlers.onActions,
    onProviderError: handlers.onProviderError,
    onFallback: handlers.onFallback,
    onDone: handlers.onDone,
    onError: handlers.onError,
  });
}

function getProviderDisplayLabel(providerId, fallbackLabel = 'Provider') {
  return providerId ? getProviderShortLabel(providerId) : fallbackLabel;
}

function cleanProviderDetail(detail, message = '') {
  const normalizedDetail = typeof detail === 'string' ? detail.trim() : '';
  const normalizedMessage = typeof message === 'string' ? message.trim() : '';
  if (!normalizedDetail || normalizedDetail === normalizedMessage) return '';
  return normalizedDetail;
}

function describeProviderFailure(reason, providerLabel) {
  switch (String(reason || '').toUpperCase()) {
    case 'TIMEOUT':
      return `${providerLabel} timed out`;
    case 'PRIMARY_UNHEALTHY':
      return `${providerLabel} is temporarily unhealthy`;
    case 'ABORT':
      return `${providerLabel} was aborted`;
    default:
      return `${providerLabel} failed`;
  }
}

function ensureSentence(text) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (!normalized) return '';
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function joinSentences(...parts) {
  return parts
    .map((part) => ensureSentence(part))
    .filter(Boolean)
    .join(' ');
}

function buildWorkspaceProviderErrorStatus(data, configuredFallbackProvider) {
  const failedProvider = data?.provider || null;
  const failedLabel = getProviderDisplayLabel(failedProvider);
  const fallbackLabel = data?.retriable ? getProviderDisplayLabel(configuredFallbackProvider, 'the fallback provider') : '';
  const baseMessage = data?.message || `${failedLabel} request failed`;

  return {
    kind: 'provider_error',
    tone: data?.retriable ? 'warning' : 'error',
    title: `${failedLabel} failed`,
    message: joinSentences(
      baseMessage,
      data?.retriable && fallbackLabel ? `Trying ${fallbackLabel} instead` : ''
    ),
    detail: cleanProviderDetail(data?.detail, data?.message),
    activeProvider: failedProvider,
    activeModel: data?.model || null,
    failedProvider,
    failedModel: data?.model || null,
    failedCode: data?.code || null,
  };
}

function buildWorkspaceFallbackStatus(data, configuredPrimaryProvider, configuredFallbackProvider) {
  const fromProvider = data?.from || configuredPrimaryProvider || null;
  const toProvider = data?.to || configuredFallbackProvider || null;
  const fromLabel = getProviderDisplayLabel(fromProvider, 'Primary provider');
  const toLabel = getProviderDisplayLabel(toProvider, 'Fallback provider');

  return {
    kind: 'fallback',
    tone: 'warning',
    title: data?.preflight ? `Using ${toLabel} first` : `Switched to ${toLabel}`,
    message: data?.preflight
      ? `${fromLabel} is temporarily unhealthy, so Workspace started with ${toLabel}.`
      : `${describeProviderFailure(data?.reason, fromLabel)}, so Workspace switched to ${toLabel}.`,
    detail: cleanProviderDetail(data?.detail),
    activeProvider: toProvider,
    activeModel: data?.toModel || null,
    failedProvider: fromProvider,
    failedModel: data?.fromModel || null,
    failedCode: data?.reason || null,
    preflight: Boolean(data?.preflight),
  };
}

function buildWorkspaceCompletionStatus(data, configuredPrimaryProvider, previousStatus) {
  const providerUsed = data?.providerUsed || data?.provider || null;
  if (!providerUsed) return previousStatus || null;

  const usedLabel = getProviderDisplayLabel(providerUsed, 'the active provider');
  const activeModel = data?.modelUsed || data?.usage?.model || previousStatus?.activeModel || null;
  const fromProvider = data?.fallbackFrom || previousStatus?.failedProvider || configuredPrimaryProvider || null;
  const switchedAwayFromPrimary = Boolean(data?.fallbackUsed)
    || providerUsed !== configuredPrimaryProvider
    || previousStatus?.kind === 'fallback'
    || previousStatus?.kind === 'provider_error';

  if (!switchedAwayFromPrimary) return null;

  return {
    kind: 'done',
    tone: 'warning',
    title: `Answered with ${usedLabel}`,
    message: fromProvider && fromProvider !== providerUsed
      ? `${usedLabel} completed this request after ${getProviderDisplayLabel(fromProvider, 'the primary provider')} did not.`
      : `${usedLabel} completed this request.`,
    detail: previousStatus?.detail || '',
    activeProvider: providerUsed,
    activeModel,
    failedProvider: previousStatus?.failedProvider || fromProvider || null,
    failedModel: previousStatus?.failedModel || null,
    failedCode: previousStatus?.failedCode || null,
  };
}

function buildWorkspaceFatalStatus(err, currentProvider, previousStatus) {
  const failedProvider = previousStatus?.failedProvider || previousStatus?.activeProvider || currentProvider || null;
  const failedLabel = getProviderDisplayLabel(failedProvider);
  const message = err?.message || err?.error || 'Workspace request failed';

  return {
    kind: 'fatal',
    tone: 'error',
    title: `${failedLabel} failed`,
    message,
    detail: cleanProviderDetail(err?.detail, message) || previousStatus?.detail || '',
    activeProvider: failedProvider,
    activeModel: previousStatus?.activeModel || null,
    failedProvider,
    failedModel: previousStatus?.failedModel || null,
    failedCode: previousStatus?.failedCode || err?.code || null,
  };
}

export default function useWorkspaceAgentRuntime({ viewContext, sendBackground, setReasoningNotice } = {}) {
  const initialSession = useMemo(() => buildInitialWorkspaceSession(), []);
  const [workspaceSessionId, setWorkspaceSessionId] = useState(() => {
    try {
      return window.localStorage.getItem(WORKSPACE_SESSION_ID_KEY) || null;
    } catch {
      return null;
    }
  });
  const [activeAgentSessionId, setActiveAgentSessionId] = useState(() => {
    try {
      return window.localStorage.getItem(WORKSPACE_ACTIVE_AGENT_SESSION_ID_KEY) || null;
    } catch {
      return null;
    }
  });
  const [conversationRestored, setConversationRestored] = useState(false);

  const {
    session,
    patchSession,
    clearSession,
    setController,
    abortSession,
  } = useSharedAgentSession(WORKSPACE_SESSION_KEY, initialSession);
  const {
    provider,
    mode,
    fallbackProvider,
    model,
    fallbackModel,
    reasoningEffort,
    messages,
    input,
    streaming,
    streamText,
    thinkingText,
    statusState,
    lastActions,
    currentProvider,
    currentModel,
    providerStatus,
  } = session;

  const activeRequestRef = useRef(null);
  const stallTimerRef = useRef(null);
  const reasoningPauseTimerRef = useRef(null);
  const reasoningMetaRef = useRef({
    provider: null,
    supportsThinking: true,
    lastThinkingAt: 0,
  });

  const clearStallWatch = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    activeRequestRef.current = null;
  }, []);

  const clearReasoningWatch = useCallback(() => {
    if (reasoningPauseTimerRef.current) {
      clearTimeout(reasoningPauseTimerRef.current);
      reasoningPauseTimerRef.current = null;
    }
  }, []);

  const resetReasoningState = useCallback(() => {
    clearReasoningWatch();
    reasoningMetaRef.current = {
      provider: null,
      supportsThinking: true,
      lastThinkingAt: 0,
    };
    setReasoningNotice?.('');
  }, [clearReasoningWatch, setReasoningNotice]);

  const armStallWatch = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    if (typeof sendBackground !== 'function') return;
    stallTimerRef.current = setTimeout(() => {
      const active = activeRequestRef.current;
      if (!active) return;
      const elapsedMs = Date.now() - active.startedAt;
      const idleMs = Date.now() - (active.lastActivityAt || active.startedAt);
      sendBackground('auto-errors', [
        '[AUTO-ERROR] Workspace panel request appears stuck',
        '',
        `Prompt: ${active.prompt}`,
        `Elapsed: ${Math.round(elapsedMs / 1000)}s`,
        `Idle: ${Math.round(idleMs / 1000)}s since last stream activity`,
        active.currentProvider ? `Provider: ${active.currentProvider}` : '',
        active.lastStatus ? `Last status: ${active.lastStatus}` : 'Last status: none received',
        active.streamChars > 0 ? `Streamed chars: ${active.streamChars}` : 'No streamed output received yet',
        active.view ? `View: ${active.view}` : '',
        '',
        'This was observed directly from the workspace panel while the request was in flight. Investigate the workspace route, SSE flow, and provider execution path.',
      ].filter(Boolean).join('\n'), {
        incidentMeta: {
          kind: 'workspace-ui-stall',
          severity: 'urgent',
          category: 'workspace-ui-stall',
          source: 'WorkspaceAgentPanel',
          subsystem: 'workspace',
          component: 'workspace-panel',
          fingerprint: `workspace-ui-stall:${active.requestKey}`,
        },
        incidentContext: {
          requestKey: active.requestKey,
          prompt: active.prompt,
          view: active.view || null,
          context: active.context || null,
          elapsedMs,
          idleMs,
          currentProvider: active.currentProvider || null,
          lastStatus: active.lastStatus || null,
          streamChars: active.streamChars || 0,
          conversationHistoryLength: active.historyLength || 0,
        },
      });
    }, WORKSPACE_STALL_ALERT_MS);
  }, [sendBackground]);

  const scheduleStallWatch = useCallback((requestMeta) => {
    const startedAt = requestMeta?.startedAt || Date.now();
    activeRequestRef.current = {
      ...(requestMeta || {}),
      startedAt,
      lastActivityAt: Date.now(),
    };
    armStallWatch();
  }, [armStallWatch]);

  const touchStallWatch = useCallback((patch) => {
    const active = activeRequestRef.current;
    if (!active) return;
    const nextPatch = typeof patch === 'function' ? patch(active) : patch;
    activeRequestRef.current = {
      ...active,
      ...(nextPatch || {}),
      lastActivityAt: Date.now(),
    };
    armStallWatch();
  }, [armStallWatch]);

  const scheduleReasoningPauseNotice = useCallback(() => {
    clearReasoningWatch();
    const meta = reasoningMetaRef.current;
    if (!meta.supportsThinking || !meta.lastThinkingAt) return;
    reasoningPauseTimerRef.current = setTimeout(() => {
      const latest = reasoningMetaRef.current;
      if (!latest.supportsThinking || !latest.lastThinkingAt) return;
      if ((Date.now() - latest.lastThinkingAt) < LIVE_REASONING_PAUSE_MS) return;
      const providerLabel = latest.provider ? getProviderShortLabel(latest.provider) : 'The current provider';
      setReasoningNotice?.(`${providerLabel} stopped sending live reasoning. The response may still be running.`);
    }, LIVE_REASONING_PAUSE_MS);
  }, [clearReasoningWatch, setReasoningNotice]);

  const syncReasoningProvider = useCallback((providerId) => {
    const nextProvider = providerId || null;
    const supportsThinking = nextProvider ? supportsLiveReasoning(nextProvider) : true;
    reasoningMetaRef.current = {
      ...reasoningMetaRef.current,
      provider: nextProvider,
      supportsThinking,
    };

    if (!nextProvider) {
      setReasoningNotice?.('');
      return;
    }

    if (!supportsThinking) {
      clearReasoningWatch();
      setReasoningNotice?.(`${getProviderShortLabel(nextProvider)} does not stream live reasoning. The response is still running.`);
      return;
    }

    setReasoningNotice?.('');
    if (reasoningMetaRef.current.lastThinkingAt) {
      scheduleReasoningPauseNotice();
    }
  }, [clearReasoningWatch, scheduleReasoningPauseNotice, setReasoningNotice]);

  const abortActiveAgentSession = useCallback(async (reason) => {
    if (!activeAgentSessionId) return;
    try {
      await apiFetch(`/api/agents/sessions/${encodeURIComponent(activeAgentSessionId)}/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || 'Workspace session aborted from the client' }),
      });
    } catch {
      // Best effort. The local stream will still detach.
    }
  }, [activeAgentSessionId]);

  const loadConversation = useCallback((sessionId) => {
    abortActiveAgentSession('Loading previous conversation');
    abortSession();
    setActiveAgentSessionId(null);
    setWorkspaceSessionId(sessionId);
    setConversationRestored(false);
    clearSession({
      preserveKeys: ['provider', 'mode', 'fallbackProvider', 'model', 'fallbackModel', 'reasoningEffort'],
    });
    clearStallWatch();
    resetReasoningState();
    setController(null);
  }, [abortActiveAgentSession, abortSession, clearSession, clearStallWatch, resetReasoningState, setController]);

  const startNewConversation = useCallback(() => {
    abortActiveAgentSession('Starting new conversation');
    abortSession();
    setActiveAgentSessionId(null);
    setWorkspaceSessionId(null);
    setConversationRestored(false);
    clearSession({
      preserveKeys: ['provider', 'mode', 'fallbackProvider', 'model', 'fallbackModel', 'reasoningEffort'],
    });
    clearStallWatch();
    resetReasoningState();
    setController(null);
  }, [abortActiveAgentSession, abortSession, clearSession, clearStallWatch, resetReasoningState, setController]);

  useEffect(() => {
    try {
      if (workspaceSessionId) {
        window.localStorage.setItem(WORKSPACE_SESSION_ID_KEY, workspaceSessionId);
      } else {
        window.localStorage.removeItem(WORKSPACE_SESSION_ID_KEY);
      }
    } catch {
      // ignore
    }
  }, [workspaceSessionId]);

  useEffect(() => {
    try {
      if (activeAgentSessionId) {
        window.localStorage.setItem(WORKSPACE_ACTIVE_AGENT_SESSION_ID_KEY, activeAgentSessionId);
      } else {
        window.localStorage.removeItem(WORKSPACE_ACTIVE_AGENT_SESSION_ID_KEY);
      }
    } catch {
      // ignore
    }
  }, [activeAgentSessionId]);

  useEffect(() => {
    writeStoredPreference('qbo-workspace-provider', provider);
    writeStoredPreference('qbo-workspace-mode', mode);
    writeStoredPreference('qbo-workspace-fallback-provider', fallbackProvider);
    writeStoredPreference('qbo-workspace-model', model);
    writeStoredPreference('qbo-workspace-fallback-model', fallbackModel);
    writeStoredPreference('qbo-workspace-reasoning-effort', reasoningEffort);
  }, [fallbackModel, fallbackProvider, mode, model, provider, reasoningEffort]);

  useEffect(() => {
    if (!workspaceSessionId || conversationRestored) return;
    let cancelled = false;

    (async () => {
      try {
        const data = await apiFetchJson(
          `/api/workspace/conversation/${encodeURIComponent(workspaceSessionId)}`,
          {},
          'Failed to restore workspace conversation'
        );
        if (cancelled || !data.ok || !Array.isArray(data.messages)) return;
        if (data.messages.length > 0) {
          const restored = data.messages.map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: m.timestamp || null,
            usage: m.usage || null,
          }));
          patchSession((prev) => {
            if (prev.messages.length > 0) return prev;
            return { ...prev, messages: restored };
          });
        }
      } catch {
        // Conversation restoration is best-effort.
      } finally {
        if (!cancelled) setConversationRestored(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceSessionId, conversationRestored, patchSession]);

  const attachExistingWorkspaceSession = useCallback((agentSessionId) => {
    if (!agentSessionId) return null;
    patchSession((prev) => ({
      ...prev,
      streaming: true,
    }));
    const { abort } = attachWorkspaceAISession(agentSessionId, {
      onSession: (sessionMeta) => {
        const conversationId = sessionMeta?.metadata?.conversationSessionId || null;
        const currentProvider = sessionMeta?.metadata?.currentProvider || sessionMeta?.metadata?.provider || null;
        if (conversationId) setWorkspaceSessionId(conversationId);
        if (currentProvider) {
          syncReasoningProvider(currentProvider);
          touchStallWatch({
            currentProvider,
            lastStatus: sessionMeta?.status === 'running' ? 'Streaming response...' : sessionMeta?.status || null,
          });
        }
        patchSession((prev) => ({
          ...prev,
          model: sessionMeta?.metadata?.primaryModel || prev.model,
          fallbackModel: sessionMeta?.metadata?.fallbackModel || prev.fallbackModel,
          currentProvider: currentProvider || prev.currentProvider,
          currentModel: sessionMeta?.metadata?.currentModel || sessionMeta?.metadata?.primaryModel || prev.currentModel,
        }));
      },
      onStart: (data) => {
        resetReasoningState();
        if (data?.conversationSessionId) {
          setWorkspaceSessionId(data.conversationSessionId);
        }
        const currentProvider = data?.provider || data?.primaryProvider || null;
        if (currentProvider) {
          syncReasoningProvider(currentProvider);
        }
        patchSession((prev) => ({
          ...prev,
          model: data?.primaryModel || prev.model,
          fallbackModel: data?.fallbackModel || prev.fallbackModel,
          currentProvider: currentProvider || prev.currentProvider,
          currentModel: data?.primaryModel || prev.currentModel,
          providerStatus: null,
        }));
        touchStallWatch({
          currentProvider: currentProvider || null,
          lastStatus: 'Thinking...',
        });
      },
      onChunk: (chunk) => {
        touchStallWatch((active) => ({
          streamChars: (active.streamChars || 0) + (chunk?.length || 0),
          currentProvider: active.currentProvider || reasoningMetaRef.current.provider || null,
        }));
        patchSession((prev) => ({ ...prev, streamText: `${prev.streamText || ''}${chunk}` }));
      },
      onThinking: (data) => {
        const currentProvider = data?.provider || reasoningMetaRef.current.provider || null;
        reasoningMetaRef.current = {
          provider: currentProvider,
          supportsThinking: true,
          lastThinkingAt: Date.now(),
        };
        setReasoningNotice?.('');
        scheduleReasoningPauseNotice();
        touchStallWatch({
          currentProvider: currentProvider || null,
          lastStatus: currentProvider
            ? `${getProviderShortLabel(currentProvider)} streaming live reasoning`
            : 'Streaming live reasoning',
        });
        patchSession((prev) => ({
          ...prev,
          thinkingText: `${prev.thinkingText || ''}${data?.thinking || ''}`,
        }));
      },
      onStatus: (data) => {
        touchStallWatch({
          lastStatus: data?.message || data?.phase || 'Working...',
          currentProvider: activeRequestRef.current?.currentProvider || reasoningMetaRef.current.provider || null,
        });
        if (
          data?.phase === 'actions-detected'
          || data?.phase === 'actions'
          || data?.phase === 'pass2'
          || data?.phase === 'summary'
          || String(data?.phase || '').startsWith('loop-')
        ) {
          clearReasoningWatch();
          setReasoningNotice?.('');
        }
        patchSession({ statusState: data || null });
      },
      onActions: (data) => {
        clearReasoningWatch();
        setReasoningNotice?.('');
        touchStallWatch((active) => ({
          lastStatus: data?.results?.length
            ? `Executed ${data.results.length} action${data.results.length === 1 ? '' : 's'}`
            : 'Executed actions',
          currentProvider: active.currentProvider || reasoningMetaRef.current.provider || null,
        }));
        patchSession({
          lastActions: data.results || [],
          statusState: null,
        });
      },
      onProviderError: (data) => {
        const failedProvider = data?.provider || activeRequestRef.current?.currentProvider || reasoningMetaRef.current.provider || null;
        const nextProviderStatus = buildWorkspaceProviderErrorStatus(data, fallbackProvider);
        touchStallWatch({
          lastStatus: data?.message || 'Workspace provider error',
          currentProvider: failedProvider,
        });
        patchSession((prev) => ({
          ...prev,
          currentProvider: failedProvider || prev.currentProvider,
          currentModel: data?.model || prev.currentModel,
          providerStatus: nextProviderStatus,
        }));
      },
      onFallback: (data) => {
        const fromProvider = data?.from || null;
        const toProvider = data?.to || null;
        const nextProviderStatus = buildWorkspaceFallbackStatus(data, provider, fallbackProvider);
        if (toProvider) {
          syncReasoningProvider(toProvider);
        }
        touchStallWatch({
          currentProvider: toProvider || activeRequestRef.current?.currentProvider || null,
          lastStatus: `Switching provider from ${getProviderShortLabel(fromProvider || provider)} to ${getProviderShortLabel(toProvider || fallbackProvider)}...`,
        });
        patchSession((prev) => ({
          ...prev,
          currentProvider: toProvider || prev.currentProvider,
          currentModel: data?.toModel || prev.currentModel,
          providerStatus: nextProviderStatus,
          statusState: {
            ...(prev.statusState || {}),
            type: 'fallback',
            from: fromProvider,
            to: toProvider,
            phase: data?.phase || prev.statusState?.phase || 'pass1',
            sessionId: data?.sessionId || prev.statusState?.sessionId || null,
            message: nextProviderStatus.message,
          },
        }));
      },
      onDone: (data) => {
        setController(null);
        setActiveAgentSessionId(null);
        clearStallWatch();
        resetReasoningState();
        patchSession((prev) => {
          const newMsg = {
            role: 'assistant',
            content: data.fullResponse || '',
            actions: data.actions || [],
            timestamp: new Date().toISOString(),
            usage: data.usage || null,
          };
          const lastMsg = prev.messages[prev.messages.length - 1];
          const isDup = lastMsg
            && lastMsg.role === 'assistant'
            && lastMsg.content === newMsg.content;
          return {
            ...prev,
            messages: isDup
              ? [...prev.messages.slice(0, -1), { ...lastMsg, actions: newMsg.actions, usage: newMsg.usage || lastMsg.usage, timestamp: newMsg.timestamp || lastMsg.timestamp }]
              : [...prev.messages, newMsg],
            streamText: '',
            thinkingText: '',
            streaming: false,
            statusState: null,
            currentProvider: data?.providerUsed || data?.provider || prev.currentProvider,
            currentModel: data?.modelUsed || data?.usage?.model || prev.currentModel,
            providerStatus: buildWorkspaceCompletionStatus(data, provider, prev.providerStatus),
          };
        });
      },
      onError: (err) => {
        const errorMessage = err?.message || err?.error || String(err || 'AI error');
        setController(null);
        setActiveAgentSessionId(null);
        clearStallWatch();
        resetReasoningState();
        patchSession((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              role: 'assistant',
              content: err?.detail ? `Error: ${errorMessage}\n${err.detail}` : `Error: ${errorMessage}`,
              isError: true,
              timestamp: new Date().toISOString(),
            },
          ],
          streamText: '',
          thinkingText: '',
          streaming: false,
          statusState: null,
          providerStatus: buildWorkspaceFatalStatus(err, prev.currentProvider || provider, prev.providerStatus),
        }));
      },
    });
    setController(abort);
    return abort;
  }, [
    clearStallWatch,
    fallbackProvider,
    patchSession,
    provider,
    resetReasoningState,
    scheduleReasoningPauseNotice,
    setActiveAgentSessionId,
    setController,
    setWorkspaceSessionId,
    syncReasoningProvider,
    touchStallWatch,
  ]);

  useEffect(() => {
    if (!activeAgentSessionId) return;
    if (streaming) return;
    let cancelled = false;

    (async () => {
      try {
        const data = await apiFetchJson(
          `/api/agents/sessions/${encodeURIComponent(activeAgentSessionId)}`,
          {},
          'Failed to load workspace session'
        );
        const status = data?.session?.status;
        if (cancelled) return;
        if (!data?.ok || !data?.session || ['done', 'error', 'aborted'].includes(status)) {
          setActiveAgentSessionId(null);
          return;
        }
        attachExistingWorkspaceSession(activeAgentSessionId);
      } catch {
        if (!cancelled) setActiveAgentSessionId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeAgentSessionId, streaming, attachExistingWorkspaceSession]);

  const startWorkspaceRequest = useCallback(async (promptText, options = {}) => {
    const text = typeof promptText === 'string' ? promptText.trim() : '';
    if (!text) return;
    const contextOverride = options && typeof options === 'object' && options.contextOverride && typeof options.contextOverride === 'object'
      ? options.contextOverride
      : null;
    const activeViewContext = contextOverride || viewContext || null;

    let currentSessionId = workspaceSessionId;
    if (!currentSessionId) {
      currentSessionId = `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      setWorkspaceSessionId(currentSessionId);
      try {
        window.localStorage.setItem(WORKSPACE_SESSION_ID_KEY, currentSessionId);
      } catch {
        // ignore
      }
    }

    const history = session.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));
    const requestMeta = {
      requestKey: `workspace-ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      prompt: text,
      view: activeViewContext?.view || null,
      context: activeViewContext,
      historyLength: history.length,
      startedAt: Date.now(),
      lastStatus: 'Creating workspace session...',
      streamChars: 0,
      currentProvider: provider,
    };
    scheduleStallWatch(requestMeta);
    resetReasoningState();
    patchSession((prev) => ({
      ...prev,
      messages: [...prev.messages, { role: 'user', content: text, timestamp: new Date().toISOString() }],
      input: '',
      streaming: true,
      streamText: '',
      thinkingText: '',
      statusState: null,
      lastActions: null,
      currentProvider: provider,
      currentModel: model || null,
      providerStatus: null,
    }));

    let proactiveHints = {};
    try {
      const nowIso = new Date().toISOString();
      const in48hIso = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const [inboxRes, calRes, draftsRes] = await Promise.all([
        apiFetchJson(
          '/api/gmail/messages?maxResults=100&q=' + encodeURIComponent('is:unread in:inbox'),
          {},
          'Failed to load unread inbox messages'
        ).catch(() => null),
        apiFetchJson('/api/calendar/events?' + new URLSearchParams({
          timeMin: nowIso,
          timeMax: in48hIso,
        }), {}, 'Failed to load upcoming calendar events').catch(() => null),
        apiFetchJson(
          '/api/gmail/messages?maxResults=5&q=' + encodeURIComponent('in:drafts'),
          {},
          'Failed to load drafts'
        ).catch(() => null),
      ]);
      const unreadMessages = inboxRes?.ok !== false ? (inboxRes?.messages || []) : [];
      const upcomingEvents = calRes?.ok !== false ? (calRes?.events || []) : [];
      let nextEventInMinutes = null;
      if (upcomingEvents.length > 0) {
        const nowMs = Date.now();
        for (const evt of upcomingEvents) {
          const startStr = evt.start?.dateTime || evt.start?.date;
          if (startStr) {
            const evtMs = new Date(startStr).getTime();
            if (evtMs > nowMs) {
              nextEventInMinutes = Math.round((evtMs - nowMs) / 60000);
              break;
            }
          }
        }
      }
      const staleDrafts = draftsRes?.ok !== false ? (draftsRes?.messages || []) : [];
      proactiveHints = {
        unreadCount: unreadMessages.length,
        upcomingEventCount: upcomingEvents.length,
        hasUnreadOlderThan3Days: unreadMessages.some((m) => {
          const msgDate = new Date(m.date || m.internalDate || 0);
          return (Date.now() - msgDate.getTime()) > 3 * 86400000;
        }),
        staleDraftCount: staleDrafts.length,
        ...(nextEventInMinutes != null ? { nextEventInMinutes } : {}),
      };
      if (upcomingEvents.length > 0) {
        proactiveHints.upcomingEvents = upcomingEvents.slice(0, 8).map((evt) => ({
          summary: evt.summary || evt.title || '',
          start: evt.start?.dateTime || evt.start?.date || '',
          location: evt.location || '',
        }));
      }
      if (unreadMessages.length > 0) {
        proactiveHints.recentUnread = unreadMessages.slice(0, 8).map((msg) => ({
          from: msg.from || '',
          subject: msg.subject || '',
          date: msg.date || '',
          id: msg.id || '',
        }));
      }
    } catch {
      // Proactive hints are optional — don't block the request.
    }

    const enrichedContext = activeViewContext
      ? { ...activeViewContext, proactiveHints }
      : { proactiveHints };

    try {
      const created = await createWorkspaceAISession({
        prompt: text,
        context: enrichedContext,
        conversationHistory: currentSessionId ? undefined : history,
        conversationSessionId: currentSessionId || undefined,
        provider,
        primaryModel: model || undefined,
        mode,
        fallbackProvider: mode === 'fallback' ? fallbackProvider : undefined,
        fallbackModel: mode === 'fallback' ? (fallbackModel || undefined) : undefined,
        reasoningEffort,
      });
      if (!created?.id) {
        throw new Error('Workspace session was not created');
      }
      setActiveAgentSessionId(created.id);
      const abort = attachExistingWorkspaceSession(created.id);
      setController(abort);
    } catch (err) {
      clearStallWatch();
      setController(null);
      setActiveAgentSessionId(null);
      resetReasoningState();
      patchSession((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          { role: 'assistant', content: `Error: ${err?.message || 'Workspace request failed'}`, isError: true, timestamp: new Date().toISOString() },
        ],
        streamText: '',
        thinkingText: '',
        streaming: false,
        statusState: null,
        providerStatus: buildWorkspaceFatalStatus(err, provider, prev.providerStatus),
      }));
    }
  }, [
    attachExistingWorkspaceSession,
    clearStallWatch,
    fallbackProvider,
    fallbackModel,
    mode,
    model,
    patchSession,
    provider,
    reasoningEffort,
    resetReasoningState,
    scheduleStallWatch,
    session.messages,
    setActiveAgentSessionId,
    setController,
    setWorkspaceSessionId,
    viewContext,
    workspaceSessionId,
  ]);

  useEffect(() => () => {
    clearStallWatch();
    clearReasoningWatch();
  }, [clearReasoningWatch, clearStallWatch]);

  return {
    sessionKey: WORKSPACE_SESSION_KEY,
    session,
    patchSession,
    clearSession,
    setController,
    abortSession,
    workspaceSessionId,
    setWorkspaceSessionId,
    activeAgentSessionId,
    setActiveAgentSessionId,
    conversationRestored,
    setConversationRestored,
    provider,
    mode,
    fallbackProvider,
    model,
    fallbackModel,
    reasoningEffort,
    messages,
    input,
    streaming,
    streamText,
    thinkingText,
    statusState,
    lastActions,
    currentProvider,
    currentModel,
    providerStatus,
    clearStallWatch,
    clearReasoningWatch,
    resetReasoningState,
    scheduleStallWatch,
    touchStallWatch,
    syncReasoningProvider,
    abortActiveAgentSession,
    loadConversation,
    startNewConversation,
    attachExistingWorkspaceSession,
    startWorkspaceRequest,
  };
}
