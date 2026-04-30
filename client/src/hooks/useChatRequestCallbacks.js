import { useCallback } from 'react';
import { getConversation } from '../api/chatApi.js';
import { normalizeError } from '../utils/normalizeError.js';
import { tel, TEL } from '../lib/devTelemetry.js';
import {
  buildParallelResultBatch,
  buildRequestSeedEvent,
  mapLocalStageEventToProcessEvent,
} from '../lib/chatRequestEvents.js';
import {
  createRequestTerminalHandlers,
  normalizeProvider,
} from '../lib/chatRequestCallbackHandlers.js';
import { getProviderShortLabel } from '../lib/providerCatalog.js';

const DEFAULT_MODE = 'single';
const MODES = new Set(['single', 'fallback', 'parallel']);

function normalizeMode(mode) {
  return MODES.has(mode) ? mode : DEFAULT_MODE;
}

function normalizeConversationMessages(conversation) {
  const conversationProvider = normalizeProvider(conversation?.provider);
  const normalizedMessages = Array.isArray(conversation?.messages)
    ? conversation.messages.map((msg) => {
      if (msg?.role !== 'assistant') return msg;
      const quickActions = msg.attemptMeta?.quickActions;
      return {
        ...msg,
        provider: normalizeProvider(msg.provider || conversationProvider),
        ...(Array.isArray(quickActions) && quickActions.length > 0 ? { quickActions } : {}),
      };
    })
    : [];

  return {
    conversationProvider,
    normalizedMessages,
  };
}

function shouldAttemptStreamRecovery(normalized) {
  const code = String(normalized?.code || '').trim().toUpperCase();
  const message = String(normalized?.message || '').trim().toLowerCase();
  if (!code && !message) return false;
  if (code === 'STREAM_INCOMPLETE' || code === 'REQUEST_FAILED' || code === 'SSE_STREAM_TIMEOUT') return true;
  return (
    message.includes('network error')
    || message.includes('failed to fetch')
    || message.includes('response stream ended before completion')
    || message.includes('signal is aborted')
  );
}

function resetActiveRequestState({
  clearScheduledStreamFlush,
  chunkStartedProvidersRef,
  isStreamingRef,
  isThinkingRef,
  parallelStreamingRef,
  setCurrentTraceId,
  setFallbackNotice,
  setInvMatches,
  setIsStreaming,
  setIsThinking,
  setParallelStreaming,
  setResponseTime,
  setRuntimeWarnings,
  setStreamingText,
  setThinkingStartTime,
  setThinkingText,
  setTriageCard,
  startTimeRef,
  streamingTextRef,
  thinkingTextRef,
}) {
  chunkStartedProvidersRef.current = new Set();
  clearScheduledStreamFlush();
  setIsStreaming(true);
  isStreamingRef.current = true;
  setStreamingText('');
  streamingTextRef.current = '';
  setParallelStreaming({});
  parallelStreamingRef.current = {};
  setResponseTime(null);
  setThinkingText('');
  thinkingTextRef.current = '';
  setIsThinking(true);
  isThinkingRef.current = true;
  setThinkingStartTime(Date.now());
  startTimeRef.current = Date.now();
  setCurrentTraceId(null);
  setFallbackNotice(null);
  setTriageCard(null);
  setInvMatches(null);
  setRuntimeWarnings([]);
}

export default function useChatRequestCallbacks({
  clearScheduledStreamFlush,
  chunkStartedProvidersRef,
  conversationIdRef,
  isStreamingRef,
  isThinkingRef,
  parallelProvidersRef,
  parallelStreamingRef,
  pushProcessEvent,
  scheduleStreamFlush,
  setConversationId,
  setContextDebug,
  setCurrentTraceId,
  setError,
  setFallbackNotice,
  setInvMatches,
  setIsStreaming,
  setIsThinking,
  setMessages,
  setParallelProviders,
  setParallelStreaming,
  setProvider,
  setResponseTime,
  setRuntimeWarnings,
  setSplitModeActive,
  setStreamProvider,
  setStreamingText,
  setThinkingText,
  setThinkingStartTime,
  setTriageCard,
  shouldShowContextDebug,
  startTimeRef,
  streamingTextRef,
  thinkingTextRef,
}) {
  const finalizeSuccess = useCallback((
    data,
    selectedModeForRequest,
    selectedProviderForRequest,
    selectedRoleLabel,
    selectedSuccessCode,
    selectedSuccessTitle,
    selectedSuccessMessage,
  ) => {
    const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : null;
    setResponseTime(elapsed);
    setContextDebug(shouldShowContextDebug() ? (data.contextDebug || null) : null);
    setRuntimeWarnings(Array.isArray(data.warnings) ? data.warnings : []);

    const providerThinking = data?.providerThinking && typeof data.providerThinking === 'object' && !Array.isArray(data.providerThinking)
      ? data.providerThinking
      : null;

    const parallelResultBatch = buildParallelResultBatch({
      data,
      parallelStreamingByProvider: parallelStreamingRef.current,
      selectedMode: selectedModeForRequest,
      selectedProvider: selectedProviderForRequest,
      providerThinking,
      startedAtMs: startTimeRef.current,
    });
    if (parallelResultBatch.handled) {
      if (parallelResultBatch.messages.length > 0) {
        setMessages((prev) => [...prev, ...parallelResultBatch.messages]);
        setSplitModeActive(true);
      }
      for (const failed of parallelResultBatch.processEvents) {
        pushProcessEvent(failed);
      }
    } else {
      const finalText = data.responseRepaired
        ? (data.fullResponse || '')
        : (streamingTextRef.current || data.fullResponse || '');
      const finalProvider = normalizeProvider(data.providerUsed || data.provider || selectedProviderForRequest);
      const finalProviderLabel = getProviderShortLabel(finalProvider);

      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: finalText,
        thinking: data.thinking || '',
        provider: finalProvider,
        mode: data.mode || selectedModeForRequest,
        fallbackFrom: data.fallbackFrom || null,
        attemptMeta: data.attempts
          ? {
              attempts: data.attempts,
              ...(providerThinking ? { providerThinking } : {}),
            }
          : null,
        timestamp: new Date().toISOString(),
        responseTimeMs: elapsed,
        usage: data.usage || null,
        citations: Array.isArray(data.citations) && data.citations.length > 0 ? data.citations : undefined,
        quickActions: Array.isArray(data.quickActions) && data.quickActions.length > 0 ? data.quickActions : undefined,
      }]);
      setStreamProvider(finalProvider);
      setSplitModeActive(Boolean(data.mode === 'parallel' || data.attemptMeta?.parallel));
    }

    if (parallelResultBatch.handled && data.mode !== 'parallel') {
      setSplitModeActive(Boolean(data.attemptMeta?.parallel));
    }

    pushProcessEvent({
      level: 'success',
      title: selectedSuccessTitle,
      message: `${selectedSuccessMessage} in ${elapsed || 0}ms using ${finalProviderLabel}.`,
      code: selectedSuccessCode,
      provider: finalProvider,
      elapsedMs: elapsed || 0,
      fallbackUsed: Boolean(data.fallbackUsed),
      fallbackFrom: data.fallbackFrom || null,
    });

    tel(TEL.CHAT_RESPONSE, `${selectedRoleLabel} responded (${elapsed || 0}ms)`, {
      provider: normalizeProvider(data.providerUsed || data.provider || selectedProviderForRequest),
      elapsedMs: elapsed,
    });
    tel(TEL.STREAM_END, `${selectedRoleLabel} stream complete (${elapsed || 0}ms)`, {
      provider: normalizeProvider(data.providerUsed || data.provider || selectedProviderForRequest),
    });

    clearScheduledStreamFlush();
    setStreamingText('');
    streamingTextRef.current = '';
    setParallelStreaming({});
    parallelStreamingRef.current = {};
    setIsStreaming(false);
    isStreamingRef.current = false;
    setIsThinking(false);
    isThinkingRef.current = false;
    setThinkingStartTime(null);
    setConversationId(data.conversationId);
    if (conversationIdRef) {
      conversationIdRef.current = data.conversationId || null;
    }
    return elapsed;
  }, [
    clearScheduledStreamFlush,
    conversationIdRef,
    isStreamingRef,
    isThinkingRef,
    parallelStreamingRef,
    pushProcessEvent,
    setConversationId,
    setContextDebug,
    setIsStreaming,
    setIsThinking,
    setParallelStreaming,
    setResponseTime,
    setRuntimeWarnings,
    setSplitModeActive,
    setStreamProvider,
    setStreamingText,
    setThinkingText,
    setThinkingStartTime,
    shouldShowContextDebug,
    startTimeRef,
    streamingTextRef,
  ]);

  const createHandlers = useCallback(({
    isRetry,
    selectedProviderForRequest,
    selectedModeForRequest,
    selectedFallbackForRequest,
    selectedRoleLabel,
    selectedSuccessCode,
    selectedSuccessTitle,
    selectedSuccessMessage,
    selectedFailureTitle,
    selectedFailureTelMessage,
  }) => ({
    onInit: (data) => {
      setConversationId(data.conversationId);
      if (conversationIdRef) {
        conversationIdRef.current = data.conversationId || null;
      }
      setCurrentTraceId(data.traceId || null);
      if (data.primaryProvider) setProvider(data.primaryProvider);
      const activeProvider = normalizeProvider(data.primaryProvider || data.provider || selectedProviderForRequest);
      const activeProviderLabel = getProviderShortLabel(activeProvider);
      setStreamProvider(activeProvider);
      setContextDebug(shouldShowContextDebug() ? (data.contextDebug || null) : null);
      setRuntimeWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      pushProcessEvent({
        level: 'info',
        title: isRetry ? 'Retry accepted' : 'Server accepted request',
        message: isRetry
          ? `Conversation ${data.conversationId} retry started with ${activeProviderLabel}.`
          : `Conversation ${data.conversationId} is active. Using ${activeProviderLabel} in ${data.mode || selectedModeForRequest} mode.`,
        code: isRetry ? 'RETRY_ACCEPTED' : 'REQUEST_ACCEPTED',
        conversationId: data.conversationId,
        provider: activeProvider,
        mode: data.mode || selectedModeForRequest,
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
        setParallelProviders(data.parallelProviders);
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
    onInvMatches: (data) => {
      if (Array.isArray(data) && data.length > 0) {
        setInvMatches(data);
        const topMatch = data[0];
        pushProcessEvent({
          level: 'warning',
          title: 'Known issue match',
          message: `${data.length} INV match(es) found — top: ${topMatch.invNumber} (${topMatch.confidence || 'possible'})`,
          code: 'INV_MATCH',
        });
      }
    },
    onStatus: (data) => {
      const message = typeof data?.message === 'string' ? data.message.trim() : '';
      if (!message) return;
      pushProcessEvent({
        level: 'info',
        title: 'Server status',
        message,
        code: typeof data?.code === 'string' ? data.code : 'SERVER_STATUS',
      });
    },
    onThinking: (data) => {
      if (!isThinkingRef.current) {
        isThinkingRef.current = true;
        setIsThinking(true);
      }
      thinkingTextRef.current += data.thinking;
      scheduleStreamFlush('thinking');
    },
    onChunk: (data) => {
      if (isThinkingRef.current) {
        isThinkingRef.current = false;
        setIsThinking(false);
      }
      const chunkProvider = normalizeProvider(data.provider || selectedProviderForRequest);
      if (!chunkStartedProvidersRef.current.has(chunkProvider)) {
        chunkStartedProvidersRef.current.add(chunkProvider);
        pushProcessEvent({
          level: 'info',
          title: 'Provider responding',
          message: `${getProviderShortLabel(chunkProvider)} started streaming output.`,
          code: 'STREAM_STARTED',
          provider: chunkProvider,
        });
      }
      if (selectedModeForRequest === 'parallel') {
        setStreamProvider(chunkProvider);
        parallelStreamingRef.current = {
          ...parallelStreamingRef.current,
          [chunkProvider]: (parallelStreamingRef.current[chunkProvider] || '') + data.text,
        };
        scheduleStreamFlush('parallel');
        return;
      }
      if (data.provider) setStreamProvider(data.provider);
      streamingTextRef.current += data.text;
      scheduleStreamFlush('streaming');
    },
    onLocalStage: (stageEvent) => {
      const processEvent = mapLocalStageEventToProcessEvent(stageEvent);
      if (processEvent) pushProcessEvent(processEvent);
    },
    ...createRequestTerminalHandlers({
      clearScheduledStreamFlush,
      finalizeSuccess,
      pushProcessEvent,
      selectedFallbackForRequest,
      selectedModeForRequest,
      selectedProviderForRequest,
      selectedRoleLabel,
      selectedSuccessCode,
      selectedSuccessMessage,
      selectedSuccessTitle,
      setFallbackNotice,
      setStreamProvider,
      setStreamingText,
      streamingTextRef,
    }),
    onError: async (errPayload) => {
      const normalized = normalizeError(errPayload);
      let recovered = false;

      if (conversationIdRef?.current && shouldAttemptStreamRecovery(normalized)) {
        try {
          const conversation = await getConversation(conversationIdRef.current);
          const { conversationProvider, normalizedMessages } = normalizeConversationMessages(conversation);
          const latestAssistant = [...normalizedMessages].reverse().find((message) => message?.role === 'assistant');

          if (latestAssistant) {
            const recoveredProvider = normalizeProvider(latestAssistant.provider || conversationProvider || selectedProviderForRequest);
            const recoveredThinking = typeof latestAssistant.thinking === 'string' ? latestAssistant.thinking : '';
            const hadParallel = normalizedMessages.some((message) => (
              message?.role === 'assistant' && message?.mode === 'parallel' && message?.attemptMeta?.parallel
            ));

            setConversationId(conversation._id);
            conversationIdRef.current = conversation._id || conversationIdRef.current;
            setProvider(conversationProvider);
            setMessages(normalizedMessages);
            setSplitModeActive(hadParallel);
            setStreamProvider(recoveredProvider);
            if (!String(thinkingTextRef.current || '').trim() && recoveredThinking.trim()) {
              setThinkingText(recoveredThinking);
              thinkingTextRef.current = recoveredThinking;
            }
            setError(null);
            pushProcessEvent({
              level: 'success',
              title: 'Recovered saved response',
              message: 'The stream connection dropped, but the saved assistant response and reasoning were recovered from the server.',
              code: 'STREAM_RECOVERED',
              provider: recoveredProvider,
            });
            recovered = true;
          }
        } catch {
          recovered = false;
        }
      }

      if (!recovered) {
        setError(normalized);
        tel(TEL.CHAT_ERROR, `${selectedFailureTelMessage}: ${normalized.message}`, {
          code: normalized.code,
          provider: selectedProviderForRequest,
        });
        pushProcessEvent({
          level: 'error',
          title: selectedFailureTitle,
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
      }
      clearScheduledStreamFlush();
      setStreamingText('');
      streamingTextRef.current = '';
      setParallelStreaming({});
      parallelStreamingRef.current = {};
      setIsStreaming(false);
      isStreamingRef.current = false;
      setIsThinking(false);
      isThinkingRef.current = false;
      setThinkingStartTime(null);
    },
  }), [
    clearScheduledStreamFlush,
    chunkStartedProvidersRef,
    conversationIdRef,
    finalizeSuccess,
    isStreamingRef,
    isThinkingRef,
    parallelStreamingRef,
    pushProcessEvent,
    scheduleStreamFlush,
    setConversationId,
    setContextDebug,
    setCurrentTraceId,
    setError,
    setFallbackNotice,
    setInvMatches,
    setIsThinking,
    setParallelProviders,
    setParallelStreaming,
    setProvider,
    setSplitModeActive,
    setStreamProvider,
    setStreamingText,
    setThinkingText,
    setTriageCard,
    setThinkingStartTime,
    setIsStreaming,
    setMessages,
    setResponseTime,
    setRuntimeWarnings,
    shouldShowContextDebug,
    thinkingTextRef,
    streamingTextRef,
  ]);

  return {
    createHandlers,
    buildRequestSeedEvent,
    resetActiveRequestState,
  };
}
