import { useState, useCallback, useRef, useEffect } from 'react';
import {
  sendChatMessage,
  retryChatMessage,
  getConversation,
  deleteConversation,
  acceptParallelTurn as acceptParallelTurnApi,
  unacceptParallelTurn as unacceptParallelTurnApi,
} from '../api/chatApi.js';
import { normalizeError } from '../utils/normalizeError.js';
import {
  DEFAULT_PROVIDER,
  DEFAULT_REASONING_EFFORT,
  PROVIDER_IDS,
  getAlternateProvider,
  normalizeProvider as normalizeCatalogProvider,
  normalizeReasoningEffort,
} from '../lib/providerCatalog.js';

const DEFAULT_MODE = 'single';
const PROVIDERS = new Set(PROVIDER_IDS);
const MODES = new Set(['single', 'fallback', 'parallel']);

// Stable empty array returned for `conversations` — Sidebar is the single
// source of truth for conversation list. Kept for API compatibility.
const EMPTY_CONVERSATIONS = Object.freeze([]);

function alternateProvider(provider) {
  return getAlternateProvider(provider);
}

function normalizeProvider(provider) {
  return PROVIDERS.has(provider) ? provider : normalizeCatalogProvider(provider);
}

function normalizeMode(mode) {
  return MODES.has(mode) ? mode : DEFAULT_MODE;
}

function normalizeFallback(primary, fallback) {
  const normalizedPrimary = normalizeProvider(primary);
  const normalizedFallback = normalizeProvider(fallback);
  if (normalizedFallback === normalizedPrimary) return alternateProvider(normalizedPrimary);
  return normalizedFallback;
}


function createProcessEvent(event) {
  const now = new Date().toISOString();
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: now,
    level: 'info',
    title: '',
    message: '',
    ...event,
  };
}

export function useChat(options = {}) {
  const { aiSettings = null } = options;
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [provider, setProviderState] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_PROVIDER;
    return normalizeProvider(window.localStorage.getItem('qbo-chat-provider'));
  });
  const [mode, setModeState] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_MODE;
    return normalizeMode(window.localStorage.getItem('qbo-chat-mode'));
  });
  const [fallbackProvider, setFallbackProviderState] = useState(() => {
    if (typeof window === 'undefined') return alternateProvider(DEFAULT_PROVIDER);
    const savedProvider = normalizeProvider(window.localStorage.getItem('qbo-chat-provider'));
    return normalizeFallback(savedProvider, window.localStorage.getItem('qbo-chat-fallback-provider'));
  });
  const [reasoningEffort, setReasoningEffortState] = useState(() => {
    if (typeof window === 'undefined') {
      return normalizeReasoningEffort(aiSettings?.providerStrategy?.reasoningEffort || DEFAULT_REASONING_EFFORT);
    }
    const stored = window.localStorage.getItem('qbo-chat-reasoning-effort');
    return normalizeReasoningEffort(stored || aiSettings?.providerStrategy?.reasoningEffort || DEFAULT_REASONING_EFFORT);
  });
  const [parallelProviders, setParallelProvidersState] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [parallelStreaming, setParallelStreaming] = useState({});
  const [streamProvider, setStreamProvider] = useState(provider);
  const [fallbackNotice, setFallbackNotice] = useState(null);
  const [parallelAcceptingKey, setParallelAcceptingKey] = useState(null);
  const [splitModeActive, setSplitModeActive] = useState(false);
  const [error, setErrorState] = useState(null);
  const [errorDetails, setErrorDetails] = useState(null);
  const [responseTime, setResponseTime] = useState(null);
  const [contextDebug, setContextDebug] = useState(null);
  const [runtimeWarnings, setRuntimeWarnings] = useState([]);
  const [triageCard, setTriageCard] = useState(null);
  const [processEvents, setProcessEvents] = useState([]);
  const [thinkingText, setThinkingText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingStartTime, setThinkingStartTime] = useState(null);

  const abortRef = useRef(null);
  const startTimeRef = useRef(null);
  const isStreamingRef = useRef(false);
  const conversationIdRef = useRef(null);
  const streamingTextRef = useRef('');
  const parallelStreamingRef = useRef({});
  const providerRef = useRef(provider);
  const modeRef = useRef(mode);
  const splitModeActiveRef = useRef(false);
  const fallbackProviderRef = useRef(fallbackProvider);
  const parallelProvidersRef = useRef([]);
  const aiSettingsRef = useRef(aiSettings);
  const reasoningEffortRef = useRef(reasoningEffort);
  const processEventsRef = useRef([]);
  const chunkStartedProvidersRef = useRef(new Set());
  const thinkingTextRef = useRef('');
  const isThinkingRef = useRef(false);

  const shouldShowContextDebug = useCallback(() => (
    Boolean(aiSettingsRef.current?.debug?.showContextDebug)
  ), []);

  const setError = useCallback((nextError) => {
    if (!nextError) {
      setErrorState(null);
      setErrorDetails(null);
      return;
    }
    const normalized = normalizeError(nextError);
    setErrorState(normalized.message);
    setErrorDetails(normalized);
  }, []);

  const pushProcessEvent = useCallback((event) => {
    const normalized = createProcessEvent(event);
    setProcessEvents((prev) => {
      const next = [...prev, normalized].slice(-80);
      processEventsRef.current = next;
      return next;
    });
  }, []);

  const resetProcessEvents = useCallback((seedEvents = []) => {
    const next = Array.isArray(seedEvents) ? seedEvents.map((e) => createProcessEvent(e)) : [];
    processEventsRef.current = next;
    setProcessEvents(next);
  }, []);

  const setProvider = useCallback((nextProvider) => {
    const normalized = normalizeProvider(nextProvider);
    providerRef.current = normalized;
    setProviderState(normalized);

    const fallback = normalizeFallback(normalized, fallbackProviderRef.current);
    fallbackProviderRef.current = fallback;
    setFallbackProviderState(fallback);

    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem('qbo-chat-provider', normalized); } catch {}
      try { window.localStorage.setItem('qbo-chat-fallback-provider', fallback); } catch {}
    }
  }, []);

  const setMode = useCallback((nextMode) => {
    const normalized = normalizeMode(nextMode);
    modeRef.current = normalized;
    setModeState(normalized);
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem('qbo-chat-mode', normalized); } catch {}
    }
  }, []);

  const setFallbackProvider = useCallback((nextProvider) => {
    const normalized = normalizeFallback(providerRef.current, nextProvider);
    fallbackProviderRef.current = normalized;
    setFallbackProviderState(normalized);
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem('qbo-chat-fallback-provider', normalized); } catch {}
    }
  }, []);

  const setParallelProviders = useCallback((nextProviders) => {
    const valid = Array.isArray(nextProviders)
      ? nextProviders.filter(p => PROVIDERS.has(p))
      : [];
    const unique = [...new Set(valid)].slice(0, 4);
    parallelProvidersRef.current = unique;
    setParallelProvidersState(unique);
  }, []);

  const setReasoningEffort = useCallback((nextEffort) => {
    const normalized = normalizeReasoningEffort(nextEffort);
    reasoningEffortRef.current = normalized;
    setReasoningEffortState(normalized);
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem('qbo-chat-reasoning-effort', normalized); } catch {}
    }
  }, []);

  useEffect(() => {
    providerRef.current = provider;
  }, [provider]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    fallbackProviderRef.current = fallbackProvider;
  }, [fallbackProvider]);

  useEffect(() => {
    aiSettingsRef.current = aiSettings;
  }, [aiSettings]);

  useEffect(() => {
    reasoningEffortRef.current = reasoningEffort;
  }, [reasoningEffort]);

  useEffect(() => {
    if (!aiSettings?.debug?.showContextDebug) {
      setContextDebug(null);
    }
  }, [aiSettings?.debug?.showContextDebug]);

  // Abort any in-flight stream on unmount
  useEffect(() => {
    return () => { if (abortRef.current) abortRef.current(); };
  }, []);

  const selectConversation = useCallback(async (id) => {
    try {
      // Abort any in-flight stream before switching conversations
      if (abortRef.current) {
        abortRef.current();
        abortRef.current = null;
        setIsStreaming(false);
        isStreamingRef.current = false;
        setStreamingText('');
        streamingTextRef.current = '';
        setParallelStreaming({});
        parallelStreamingRef.current = {};
      }

      setError(null);
      setFallbackNotice(null);
      setContextDebug(null);
      setRuntimeWarnings([]);
      resetProcessEvents();
      setThinkingText('');
      thinkingTextRef.current = '';
      setIsThinking(false);
      isThinkingRef.current = false;
      setThinkingStartTime(null);

      const conv = await getConversation(id);
      setConversationId(conv._id);
      conversationIdRef.current = conv._id;

      const conversationProvider = normalizeProvider(conv.provider);
      setProvider(conversationProvider);

      const normalizedMessages = (conv.messages || []).map((msg) => {
        if (msg.role !== 'assistant') return msg;
        return {
          ...msg,
          provider: normalizeProvider(msg.provider || conversationProvider),
        };
      });

      const lastAssistant = [...normalizedMessages].reverse().find((m) => m.role === 'assistant');
      if (lastAssistant && lastAssistant.mode) {
        setMode(lastAssistant.mode);
      }

      // Detect if conversation had parallel turns — reactivate split mode
      const hadParallel = normalizedMessages.some(m => m.mode === 'parallel' && m.attemptMeta?.parallel);
      setSplitModeActive(hadParallel);
      splitModeActiveRef.current = hadParallel;

      setMessages(normalizedMessages);
    } catch (err) {
      setError(err.message);
    }
  }, [resetProcessEvents, setError, setMode, setProvider]);

  const newConversation = useCallback(() => {
    setConversationId(null);
    conversationIdRef.current = null;
    setMessages([]);
    setStreamingText('');
    streamingTextRef.current = '';
    setParallelStreaming({});
    parallelStreamingRef.current = {};
    setFallbackNotice(null);
    setTriageCard(null);
    setError(null);
    setContextDebug(null);
    setRuntimeWarnings([]);
    resetProcessEvents();
    setSplitModeActive(false);
    splitModeActiveRef.current = false;
    setThinkingText('');
    thinkingTextRef.current = '';
    setIsThinking(false);
    isThinkingRef.current = false;
    setThinkingStartTime(null);
  }, [resetProcessEvents, setError]);

  const sendMessage = useCallback((text, images = [], providerOverride) => {
    if ((!text.trim() && images.length === 0) || isStreamingRef.current) return;

    const selectedProvider = normalizeProvider(providerOverride || providerRef.current);
    const selectedMode = splitModeActiveRef.current ? 'parallel' : normalizeMode(modeRef.current);
    const selectedFallback = normalizeFallback(selectedProvider, fallbackProviderRef.current);

    setError(null);
    setFallbackNotice(null);
    setTriageCard(null);
    setRuntimeWarnings([]);
    resetProcessEvents([{
      level: 'info',
      title: 'Request queued',
      message: `Dispatching to ${selectedProvider}${selectedMode === 'fallback' ? ` with fallback ${selectedFallback}` : ''}${selectedMode === 'parallel' ? ` and parallel ${selectedFallback}` : ''}.`,
      mode: selectedMode,
      provider: selectedProvider,
      fallbackProvider: selectedMode === 'single' ? null : selectedFallback,
      imageCount: images.length,
    }]);
    chunkStartedProvidersRef.current = new Set();
    setIsStreaming(true);
    isStreamingRef.current = true;
    setStreamingText('');
    streamingTextRef.current = '';
    setParallelStreaming({});
    parallelStreamingRef.current = {};
    setStreamProvider(selectedProvider);
    setResponseTime(null);
    startTimeRef.current = Date.now();
    setThinkingText('');
    thinkingTextRef.current = '';
    setIsThinking(true);
    isThinkingRef.current = true;
    setThinkingStartTime(Date.now());

    const userMsg = {
      role: 'user',
      content: text.trim() || '(image attached)',
      images,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    const { abort } = sendChatMessage(
      {
        message: text.trim(),
        conversationId: conversationIdRef.current,
        images,
        provider: selectedProvider,
        mode: selectedMode,
        fallbackProvider: selectedMode !== 'single' ? selectedFallback : undefined,
        parallelProviders: selectedMode === 'parallel' && parallelProvidersRef.current.length >= 2
          ? parallelProvidersRef.current
          : undefined,
        reasoningEffort: reasoningEffortRef.current,
        settings: aiSettingsRef.current || undefined,
      },
      {
        onInit: (data) => {
          setConversationId(data.conversationId);
          conversationIdRef.current = data.conversationId;
          if (data.primaryProvider) setProvider(data.primaryProvider);
          const activeProvider = normalizeProvider(data.primaryProvider || data.provider || selectedProvider);
          setStreamProvider(activeProvider);
          setContextDebug(shouldShowContextDebug() ? (data.contextDebug || null) : null);
          setRuntimeWarnings(Array.isArray(data.warnings) ? data.warnings : []);
          pushProcessEvent({
            level: 'info',
            title: 'Server accepted request',
            message: `Conversation ${data.conversationId} is active. Using ${activeProvider} in ${data.mode || selectedMode} mode.`,
            code: 'REQUEST_ACCEPTED',
            conversationId: data.conversationId,
            provider: activeProvider,
            mode: data.mode || selectedMode,
            turnId: data.turnId || null,
          });
          if (Array.isArray(data.warnings) && data.warnings.length > 0) {
            pushProcessEvent({
              level: 'warning',
              title: 'Runtime warning',
              message: data.warnings[0]?.message || 'Runtime guardrail warning raised.',
              code: data.warnings[0]?.code || 'RUNTIME_WARNING',
            });
          }
          if (Array.isArray(data.parallelProviders) && data.parallelProviders.length >= 2) {
            parallelProvidersRef.current = data.parallelProviders;
            setParallelProvidersState(data.parallelProviders);
          }
        },
        onTriageCard: (data) => {
          setTriageCard(data);
          pushProcessEvent({
            level: 'info',
            title: 'Triage card received',
            message: `${data.severity || '?'} ${data.category || 'unknown'} — ${(data.read || '').slice(0, 80)}`,
            code: 'TRIAGE_CARD',
          });
        },
        onThinking: (data) => {
          if (!isThinkingRef.current) {
            isThinkingRef.current = true;
            setIsThinking(true);
          }
          thinkingTextRef.current += data.thinking;
          setThinkingText(thinkingTextRef.current);
        },
        onChunk: (data) => {
          if (isThinkingRef.current) {
            isThinkingRef.current = false;
            setIsThinking(false);
          }
          const chunkProvider = normalizeProvider(data.provider || selectedProvider);
          if (!chunkStartedProvidersRef.current.has(chunkProvider)) {
            chunkStartedProvidersRef.current.add(chunkProvider);
            pushProcessEvent({
              level: 'info',
              title: 'Provider responding',
              message: `${chunkProvider} started streaming output.`,
              code: 'STREAM_STARTED',
              provider: chunkProvider,
            });
          }
          if (selectedMode === 'parallel') {
            setStreamProvider(chunkProvider);
            parallelStreamingRef.current = {
              ...parallelStreamingRef.current,
              [chunkProvider]: (parallelStreamingRef.current[chunkProvider] || '') + data.text,
            };
            setParallelStreaming(parallelStreamingRef.current);
            return;
          }
          if (data.provider) setStreamProvider(data.provider);
          streamingTextRef.current += data.text;
          setStreamingText(streamingTextRef.current);
        },
        onProviderError: (data) => {
          const normalized = normalizeError(data);
          pushProcessEvent({
            level: 'error',
            title: 'Provider attempt failed',
            message: normalized.message,
            code: normalized.code,
            detail: normalized.detail || '',
            provider: normalizeProvider(data?.provider || selectedProvider),
            retriable: Boolean(data?.retriable),
          });
        },
        onFallback: (data) => {
          const nextProvider = normalizeProvider(data.to || selectedFallback);
          setFallbackNotice({
            from: normalizeProvider(data.from || selectedProvider),
            to: nextProvider,
            reason: data.reason || 'PROVIDER_ERROR',
            at: Date.now(),
          });
          setStreamProvider(nextProvider);
          // Discard partial output from failed provider to avoid mixed responses.
          streamingTextRef.current = '';
          setStreamingText('');
          pushProcessEvent({
            level: 'warning',
            title: 'Fallback engaged',
            message: `${normalizeProvider(data.from || selectedProvider)} failed; switched to ${nextProvider}.`,
            code: data.reason || 'PROVIDER_ERROR',
            from: normalizeProvider(data.from || selectedProvider),
            to: nextProvider,
          });
        },
        onDone: (data) => {
          const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : null;
          setResponseTime(elapsed);
          setContextDebug(shouldShowContextDebug() ? (data.contextDebug || null) : null);
          setRuntimeWarnings(Array.isArray(data.warnings) ? data.warnings : []);
          if ((data.mode || selectedMode) === 'parallel' && Array.isArray(data.results)) {
            const nextMessages = data.results
              .filter((result) => result.status === 'ok')
              .map((result) => ({
                role: 'assistant',
                content: result.fullResponse || parallelStreamingRef.current[result.provider] || '',
                provider: normalizeProvider(result.provider || selectedProvider),
                mode: 'parallel',
                fallbackFrom: null,
                attemptMeta: {
                  attempts: data.attempts || [],
                  parallel: true,
                  turnId: data.turnId || null,
                },
                timestamp: new Date().toISOString(),
                responseTimeMs: elapsed,
                usage: result.usage || null,
              }));

            if (nextMessages.length > 0) {
              setMessages((prev) => [...prev, ...nextMessages]);
              // Activate persistent split mode for this conversation
              splitModeActiveRef.current = true;
              setSplitModeActive(true);
            }
            const failedProviders = Array.isArray(data.results)
              ? data.results.filter((result) => result.status === 'error')
              : [];
            for (const failed of failedProviders) {
              pushProcessEvent({
                level: 'error',
                title: 'Parallel provider failed',
                message: failed.errorMessage || `${failed.provider} failed`,
                code: failed.errorCode || 'PROVIDER_EXEC_FAILED',
                detail: failed.errorDetail || '',
                provider: failed.provider,
              });
            }
          } else {
            const finalText = data.responseRepaired
              ? (data.fullResponse || '')
              : (streamingTextRef.current || data.fullResponse || '');
            const finalProvider = normalizeProvider(data.providerUsed || data.provider || selectedProvider);

            setMessages((prev) => [...prev, {
              role: 'assistant',
              content: finalText,
              provider: finalProvider,
              mode: data.mode || selectedMode,
              fallbackFrom: data.fallbackFrom || null,
              attemptMeta: data.attempts ? { attempts: data.attempts } : null,
              timestamp: new Date().toISOString(),
              responseTimeMs: elapsed,
              usage: data.usage || null,
            }]);
            setStreamProvider(finalProvider);
          }
          pushProcessEvent({
            level: 'success',
            title: 'Request complete',
            message: `Completed in ${elapsed || 0}ms using ${data.providerUsed || data.provider || selectedProvider}.`,
            code: 'REQUEST_COMPLETE',
            provider: normalizeProvider(data.providerUsed || data.provider || selectedProvider),
            elapsedMs: elapsed || 0,
            fallbackUsed: Boolean(data.fallbackUsed),
            fallbackFrom: data.fallbackFrom || null,
          });

          setStreamingText('');
          streamingTextRef.current = '';
          setParallelStreaming({});
          parallelStreamingRef.current = {};
          setIsStreaming(false);
          isStreamingRef.current = false;
          setThinkingText('');
          thinkingTextRef.current = '';
          setIsThinking(false);
          isThinkingRef.current = false;
          setThinkingStartTime(null);
          setConversationId(data.conversationId);
          conversationIdRef.current = data.conversationId;
        },
        onError: (errPayload) => {
          const normalized = normalizeError(errPayload);
          setError(normalized);
          pushProcessEvent({
            level: 'error',
            title: 'Request failed',
            message: normalized.message,
            code: normalized.code,
            detail: normalized.detail || '',
            attempts: normalized.attempts || [],
          });
          if (Array.isArray(normalized.attempts)) {
            for (const attempt of normalized.attempts) {
              if (attempt.status !== 'error') continue;
              pushProcessEvent({
                level: 'error',
                title: `Attempt failed: ${attempt.provider}`,
                message: attempt.errorMessage || 'Provider request failed.',
                code: attempt.errorCode || normalized.code,
                detail: attempt.errorDetail || '',
                provider: attempt.provider,
                latencyMs: attempt.latencyMs || 0,
              });
            }
          }
          setIsStreaming(false);
          isStreamingRef.current = false;
          setStreamingText('');
          streamingTextRef.current = '';
          setParallelStreaming({});
          parallelStreamingRef.current = {};
          setThinkingText('');
          thinkingTextRef.current = '';
          setIsThinking(false);
          isThinkingRef.current = false;
          setThinkingStartTime(null);
        },
      }
    );

    abortRef.current = abort;
  }, [pushProcessEvent, resetProcessEvents, setError, setProvider, shouldShowContextDebug]);

  const retryLastResponse = useCallback((providerOverride) => {
    if (!conversationIdRef.current || isStreamingRef.current) return;

    const selectedProvider = normalizeProvider(providerOverride || providerRef.current);
    const selectedMode = splitModeActiveRef.current ? 'parallel' : normalizeMode(modeRef.current);
    const selectedFallback = normalizeFallback(selectedProvider, fallbackProviderRef.current);

    setError(null);
    setFallbackNotice(null);
    setRuntimeWarnings([]);
    resetProcessEvents([{
      level: 'info',
      title: 'Retry queued',
      message: `Retrying with ${selectedProvider}${selectedMode === 'fallback' ? ` and fallback ${selectedFallback}` : ''}.`,
      code: 'RETRY_QUEUED',
      mode: selectedMode,
      provider: selectedProvider,
      fallbackProvider: selectedMode === 'single' ? null : selectedFallback,
    }]);
    chunkStartedProvidersRef.current = new Set();
    setIsStreaming(true);
    isStreamingRef.current = true;
    setStreamingText('');
    streamingTextRef.current = '';
    setParallelStreaming({});
    parallelStreamingRef.current = {};
    setStreamProvider(selectedProvider);
    setResponseTime(null);
    startTimeRef.current = Date.now();
    setThinkingText('');
    thinkingTextRef.current = '';
    setIsThinking(true);
    isThinkingRef.current = true;
    setThinkingStartTime(Date.now());

    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      while (next.length > 0 && next[next.length - 1]?.role === 'assistant') {
        next.pop();
      }
      return next;
    });

    const { abort } = retryChatMessage(
      {
        conversationId: conversationIdRef.current,
        provider: selectedProvider,
        mode: selectedMode,
        fallbackProvider: selectedMode !== 'single' ? selectedFallback : undefined,
        parallelProviders: selectedMode === 'parallel' && parallelProvidersRef.current.length >= 2
          ? parallelProvidersRef.current
          : undefined,
        reasoningEffort: reasoningEffortRef.current,
        settings: aiSettingsRef.current || undefined,
      },
      {
        onInit: (data) => {
          setConversationId(data.conversationId);
          conversationIdRef.current = data.conversationId;
          if (data.primaryProvider) setProvider(data.primaryProvider);
          const activeProvider = normalizeProvider(data.primaryProvider || data.provider || selectedProvider);
          setStreamProvider(activeProvider);
          setContextDebug(shouldShowContextDebug() ? (data.contextDebug || null) : null);
          setRuntimeWarnings(Array.isArray(data.warnings) ? data.warnings : []);
          pushProcessEvent({
            level: 'info',
            title: 'Retry accepted',
            message: `Conversation ${data.conversationId} retry started with ${activeProvider}.`,
            code: 'RETRY_ACCEPTED',
            conversationId: data.conversationId,
            provider: activeProvider,
            mode: data.mode || selectedMode,
            turnId: data.turnId || null,
          });
          if (Array.isArray(data.warnings) && data.warnings.length > 0) {
            pushProcessEvent({
              level: 'warning',
              title: 'Runtime warning',
              message: data.warnings[0]?.message || 'Runtime guardrail warning raised.',
              code: data.warnings[0]?.code || 'RUNTIME_WARNING',
            });
          }
          if (Array.isArray(data.parallelProviders) && data.parallelProviders.length >= 2) {
            parallelProvidersRef.current = data.parallelProviders;
            setParallelProvidersState(data.parallelProviders);
          }
        },
        onTriageCard: (data) => {
          setTriageCard(data);
          pushProcessEvent({
            level: 'info',
            title: 'Triage card received',
            message: `${data.severity || '?'} ${data.category || 'unknown'} — ${(data.read || '').slice(0, 80)}`,
            code: 'TRIAGE_CARD',
          });
        },
        onThinking: (data) => {
          if (!isThinkingRef.current) {
            isThinkingRef.current = true;
            setIsThinking(true);
          }
          thinkingTextRef.current += data.thinking;
          setThinkingText(thinkingTextRef.current);
        },
        onChunk: (data) => {
          if (isThinkingRef.current) {
            isThinkingRef.current = false;
            setIsThinking(false);
          }
          const chunkProvider = normalizeProvider(data.provider || selectedProvider);
          if (!chunkStartedProvidersRef.current.has(chunkProvider)) {
            chunkStartedProvidersRef.current.add(chunkProvider);
            pushProcessEvent({
              level: 'info',
              title: 'Provider responding',
              message: `${chunkProvider} started streaming output.`,
              code: 'STREAM_STARTED',
              provider: chunkProvider,
            });
          }
          if (selectedMode === 'parallel') {
            setStreamProvider(chunkProvider);
            parallelStreamingRef.current = {
              ...parallelStreamingRef.current,
              [chunkProvider]: (parallelStreamingRef.current[chunkProvider] || '') + data.text,
            };
            setParallelStreaming(parallelStreamingRef.current);
            return;
          }
          if (data.provider) setStreamProvider(data.provider);
          streamingTextRef.current += data.text;
          setStreamingText(streamingTextRef.current);
        },
        onProviderError: (data) => {
          const normalized = normalizeError(data);
          pushProcessEvent({
            level: 'error',
            title: 'Provider attempt failed',
            message: normalized.message,
            code: normalized.code,
            detail: normalized.detail || '',
            provider: normalizeProvider(data?.provider || selectedProvider),
            retriable: Boolean(data?.retriable),
          });
        },
        onFallback: (data) => {
          const nextProvider = normalizeProvider(data.to || selectedFallback);
          setFallbackNotice({
            from: normalizeProvider(data.from || selectedProvider),
            to: nextProvider,
            reason: data.reason || 'PROVIDER_ERROR',
            at: Date.now(),
          });
          setStreamProvider(nextProvider);
          streamingTextRef.current = '';
          setStreamingText('');
          pushProcessEvent({
            level: 'warning',
            title: 'Fallback engaged',
            message: `${normalizeProvider(data.from || selectedProvider)} failed; switched to ${nextProvider}.`,
            code: data.reason || 'PROVIDER_ERROR',
            from: normalizeProvider(data.from || selectedProvider),
            to: nextProvider,
          });
        },
        onDone: (data) => {
          const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : null;
          setResponseTime(elapsed);
          setContextDebug(shouldShowContextDebug() ? (data.contextDebug || null) : null);
          setRuntimeWarnings(Array.isArray(data.warnings) ? data.warnings : []);
          if ((data.mode || selectedMode) === 'parallel' && Array.isArray(data.results)) {
            const nextMessages = data.results
              .filter((result) => result.status === 'ok')
              .map((result) => ({
                role: 'assistant',
                content: result.fullResponse || parallelStreamingRef.current[result.provider] || '',
                provider: normalizeProvider(result.provider || selectedProvider),
                mode: 'parallel',
                fallbackFrom: null,
                attemptMeta: {
                  attempts: data.attempts || [],
                  parallel: true,
                  turnId: data.turnId || null,
                },
                timestamp: new Date().toISOString(),
                responseTimeMs: elapsed,
                usage: result.usage || null,
              }));
            if (nextMessages.length > 0) {
              setMessages((prev) => [...prev, ...nextMessages]);
            }
            const failedProviders = Array.isArray(data.results)
              ? data.results.filter((result) => result.status === 'error')
              : [];
            for (const failed of failedProviders) {
              pushProcessEvent({
                level: 'error',
                title: 'Parallel provider failed',
                message: failed.errorMessage || `${failed.provider} failed`,
                code: failed.errorCode || 'PROVIDER_EXEC_FAILED',
                detail: failed.errorDetail || '',
                provider: failed.provider,
              });
            }
          } else {
            const finalText = data.responseRepaired
              ? (data.fullResponse || '')
              : (streamingTextRef.current || data.fullResponse || '');
            const finalProvider = normalizeProvider(data.providerUsed || data.provider || selectedProvider);

            setMessages((prev) => [...prev, {
              role: 'assistant',
              content: finalText,
              provider: finalProvider,
              mode: data.mode || selectedMode,
              fallbackFrom: data.fallbackFrom || null,
              attemptMeta: data.attempts ? { attempts: data.attempts } : null,
              timestamp: new Date().toISOString(),
              responseTimeMs: elapsed,
              usage: data.usage || null,
            }]);
            setStreamProvider(finalProvider);
          }
          pushProcessEvent({
            level: 'success',
            title: 'Retry complete',
            message: `Completed in ${elapsed || 0}ms using ${data.providerUsed || data.provider || selectedProvider}.`,
            code: 'RETRY_COMPLETE',
            provider: normalizeProvider(data.providerUsed || data.provider || selectedProvider),
            elapsedMs: elapsed || 0,
            fallbackUsed: Boolean(data.fallbackUsed),
            fallbackFrom: data.fallbackFrom || null,
          });

          setStreamingText('');
          streamingTextRef.current = '';
          setParallelStreaming({});
          parallelStreamingRef.current = {};
          setIsStreaming(false);
          isStreamingRef.current = false;
          setThinkingText('');
          thinkingTextRef.current = '';
          setIsThinking(false);
          isThinkingRef.current = false;
          setThinkingStartTime(null);
        },
        onError: (errPayload) => {
          const normalized = normalizeError(errPayload);
          setError(normalized);
          pushProcessEvent({
            level: 'error',
            title: 'Retry failed',
            message: normalized.message,
            code: normalized.code,
            detail: normalized.detail || '',
            attempts: normalized.attempts || [],
          });
          if (Array.isArray(normalized.attempts)) {
            for (const attempt of normalized.attempts) {
              if (attempt.status !== 'error') continue;
              pushProcessEvent({
                level: 'error',
                title: `Attempt failed: ${attempt.provider}`,
                message: attempt.errorMessage || 'Provider request failed.',
                code: attempt.errorCode || normalized.code,
                detail: attempt.errorDetail || '',
                provider: attempt.provider,
                latencyMs: attempt.latencyMs || 0,
              });
            }
          }
          setIsStreaming(false);
          isStreamingRef.current = false;
          setStreamingText('');
          streamingTextRef.current = '';
          setParallelStreaming({});
          parallelStreamingRef.current = {};
          setThinkingText('');
          thinkingTextRef.current = '';
          setIsThinking(false);
          isThinkingRef.current = false;
          setThinkingStartTime(null);
        },
      }
    );

    abortRef.current = abort;
  }, [pushProcessEvent, resetProcessEvents, setError, setProvider, shouldShowContextDebug]);

  const abortStream = useCallback(() => {
    if (isStreamingRef.current) {
      pushProcessEvent({
        level: 'warning',
        title: 'Request cancelled',
        message: 'Streaming was stopped before completion.',
        code: 'REQUEST_ABORTED',
      });
    }
    abortRef.current?.();
    setIsStreaming(false);
    isStreamingRef.current = false;
    setTriageCard(null);
    setStreamingText('');
    streamingTextRef.current = '';
    setParallelStreaming({});
    parallelStreamingRef.current = {};
    setThinkingText('');
    thinkingTextRef.current = '';
    setIsThinking(false);
    isThinkingRef.current = false;
    setThinkingStartTime(null);
  }, [pushProcessEvent]);

  const removeConversation = useCallback(async (id) => {
    try {
      await deleteConversation(id);
      if (conversationIdRef.current === id) newConversation();
    } catch (err) {
      setError(err.message);
    }
  }, [newConversation]);

  const dismissFallbackNotice = useCallback(() => {
    setFallbackNotice(null);
  }, []);

  const dismissRuntimeWarnings = useCallback(() => {
    setRuntimeWarnings([]);
  }, []);

  const clearProcessEvents = useCallback(() => {
    resetProcessEvents();
  }, [resetProcessEvents]);

  const acceptParallelTurn = useCallback(async (turnId, selectedProvider, editedContent = '') => {
    if (!turnId || !conversationIdRef.current) return null;
    const normalizedProvider = normalizeProvider(selectedProvider);
    const key = `${turnId}:${normalizedProvider}`;

    setError(null);
    setParallelAcceptingKey(key);
    try {
      const out = await acceptParallelTurnApi(turnId, {
        conversationId: conversationIdRef.current,
        provider: normalizedProvider,
        editedContent: editedContent || undefined,
      });

      const conversation = out.conversation || await getConversation(conversationIdRef.current);
      const conversationProvider = normalizeProvider(conversation.provider);
      setProvider(conversationProvider);

      const normalizedMessages = (conversation.messages || []).map((msg) => {
        if (msg.role !== 'assistant') return msg;
        return {
          ...msg,
          provider: normalizeProvider(msg.provider || conversationProvider),
        };
      });
      const lastAssistant = [...normalizedMessages].reverse().find((m) => m.role === 'assistant');
      if (lastAssistant && lastAssistant.mode) {
        setMode(lastAssistant.mode);
      }

      setMessages(normalizedMessages);
      setConversationId(conversation._id);
      conversationIdRef.current = conversation._id;
      return out;
    } catch (err) {
      setError(err.message || 'Failed to accept parallel response');
      throw err;
    } finally {
      setParallelAcceptingKey(null);
    }
  }, [setMode, setProvider]);

  const unacceptParallelTurn = useCallback(async (turnId) => {
    if (!turnId || !conversationIdRef.current) return null;
    setError(null);
    try {
      const out = await unacceptParallelTurnApi(turnId, {
        conversationId: conversationIdRef.current,
      });
      const conversation = out.conversation || await getConversation(conversationIdRef.current);
      const conversationProvider = normalizeProvider(conversation.provider);
      const normalizedMessages = (conversation.messages || []).map((msg) => {
        if (msg.role !== 'assistant') return msg;
        return { ...msg, provider: normalizeProvider(msg.provider || conversationProvider) };
      });
      setMessages(normalizedMessages);
      return out;
    } catch (err) {
      setError(err.message || 'Failed to undo acceptance');
      throw err;
    }
  }, []);

  return {
    messages,
    conversationId,
    conversations: EMPTY_CONVERSATIONS,
    provider,
    mode,
    fallbackProvider,
    reasoningEffort,
    parallelProviders,
    isStreaming,
    streamingText,
    parallelStreaming,
    streamProvider,
    fallbackNotice,
    parallelAcceptingKey,
    error,
    errorDetails,
    responseTime,
    contextDebug,
    runtimeWarnings,
    processEvents,
    sendMessage,
    retryLastResponse,
    setProvider,
    setMode,
    setFallbackProvider,
    setReasoningEffort,
    setParallelProviders,
    dismissFallbackNotice,
    dismissRuntimeWarnings,
    acceptParallelTurn,
    unacceptParallelTurn,
    triageCard,
    abortStream,
    selectConversation,
    newConversation,
    removeConversation,
    setError,
    appendProcessEvent: pushProcessEvent,
    clearProcessEvents,
    splitModeActive,
    setSplitModeActive,
    thinkingText,
    isThinking,
    thinkingStartTime,
  };
}
