import { useCallback } from 'react';
import { sendChatMessage, retryChatMessage } from '../api/chatApi.js';
import { tel, TEL } from '../lib/devTelemetry.js';
import {
  DEFAULT_PROVIDER,
  normalizeProvider,
} from '../lib/providerCatalog.js';
import { normalizeFallback } from '../lib/chatRequestCallbackHandlers.js';
import useChatRequestCallbacks from './useChatRequestCallbacks.js';

const DEFAULT_MODE = 'single';
const SUPPORTED_MODES = new Set(['single', 'fallback', 'parallel']);
const RESERVED_REQUEST_KEYS = new Set([
  'message',
  'conversationId',
  'images',
  'imageMeta',
  'provider',
  'mode',
  'fallbackProvider',
  'primaryModel',
  'fallbackModel',
  'parallelProviders',
  'reasoningEffort',
  'settings',
]);

function normalizeMode(mode) {
  return SUPPORTED_MODES.has(mode) ? mode : DEFAULT_MODE;
}

export default function useChatRequestFlow({
  abortRef,
  aiSettingsRef,
  clearScheduledStreamFlush,
  chunkStartedProvidersRef,
  conversationIdRef,
  fallbackProviderRef,
  isStreamingRef,
  isThinkingRef,
  parallelProvidersRef,
  parallelStreamingRef,
  pushProcessEvent,
  reasoningEffortRef,
  modelRef,
  fallbackModelRef,
  resetProcessEvents,
  scheduleStreamFlush,
  splitModeActiveRef,
  startTimeRef,
  streamingTextRef,
  thinkingTextRef,
  providerRef,
  modeRef,
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
  setThinkingStartTime,
  setThinkingText,
  setTriageCard,
  setCaseIntake,
  shouldShowContextDebug,
}) {
  const { createHandlers, buildRequestSeedEvent, resetActiveRequestState } = useChatRequestCallbacks({
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
    setCaseIntake,
    shouldShowContextDebug,
    startTimeRef,
    streamingTextRef,
    thinkingTextRef,
  });

  const runRequest = useCallback(({
    isRetry,
    selectedProvider,
    selectedMode,
    selectedFallback,
    requestFn,
    requestPayload,
    imageCount = 0,
    selectedSuccessTitle,
    selectedSuccessCode,
    selectedSuccessMessage,
    selectedFailureTitle,
  }) => {
    setError(null);
    resetActiveRequestState({
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
    });

    resetProcessEvents([buildRequestSeedEvent({
      isRetry,
      selectedProvider,
      selectedMode,
      selectedFallback,
      imageCount,
    })]);

    if (!isRetry) {
      tel(
        TEL.CHAT_SEND,
        `User sent message (${requestPayload.message ? requestPayload.message.length : 0} chars)`,
        { provider: selectedProvider, mode: selectedMode, imageCount },
      );
      tel(TEL.STREAM_START, 'Streaming response...', { provider: selectedProvider, mode: selectedMode });
    }

    const { abort } = requestFn(requestPayload, createHandlers({
      isRetry,
      selectedProviderForRequest: selectedProvider,
      selectedModeForRequest: selectedMode,
      selectedFallbackForRequest: selectedFallback,
      selectedRoleLabel: isRetry ? 'Retry' : 'AI',
      selectedSuccessCode,
      selectedSuccessTitle,
      selectedSuccessMessage,
      selectedFailureTitle,
      selectedFailureTelMessage: isRetry ? 'Retry failed' : 'Chat failed',
    }));

    abortRef.current = abort;
    return abort;
  }, [
    abortRef,
    buildRequestSeedEvent,
    clearScheduledStreamFlush,
    createHandlers,
    chunkStartedProvidersRef,
    isStreamingRef,
    isThinkingRef,
    parallelStreamingRef,
    resetActiveRequestState,
    resetProcessEvents,
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
  ]);

  const sendMessage = useCallback((text, images = [], providerOverride, imageMeta = [], options = {}) => {
    const inputText = typeof text === 'string' ? text : '';
    const trimmedText = inputText.trim();
    const payloadText = typeof options?.payloadMessage === 'string'
      ? options.payloadMessage.trim()
      : trimmedText;
    const displayContent = typeof options?.displayContent === 'string'
      ? options.displayContent.trim()
      : trimmedText;
    const requestExtras = options?.requestExtras && typeof options.requestExtras === 'object' && !Array.isArray(options.requestExtras)
      ? Object.fromEntries(
          Object.entries(options.requestExtras).filter(([key]) => !RESERVED_REQUEST_KEYS.has(key))
        )
      : {};
    const normalizedImages = [];
    const normalizedImageMeta = [];
    if ((!payloadText && normalizedImages.length === 0) || isStreamingRef.current) return;

    const selectedProvider = normalizeProvider(providerOverride || providerRef.current || DEFAULT_PROVIDER);
    const selectedMode = splitModeActiveRef.current ? 'parallel' : normalizeMode(modeRef.current);
    const selectedFallback = normalizeFallback(selectedProvider, fallbackProviderRef.current);
    const selectedModel = modelRef.current || undefined;
    const selectedFallbackModel = fallbackModelRef.current || undefined;

    setMessages((prev) => [...prev, {
      role: 'user',
      content: displayContent,
      images: normalizedImages,
      imageMeta: normalizedImageMeta,
      timestamp: new Date().toISOString(),
    }]);

    return runRequest({
      isRetry: false,
      selectedProvider,
      selectedMode,
      selectedFallback,
      requestFn: sendChatMessage,
      requestPayload: {
        message: payloadText,
        conversationId: conversationIdRef.current,
        images: normalizedImages,
        imageMeta: normalizedImageMeta,
        provider: selectedProvider,
        mode: selectedMode,
        fallbackProvider: selectedMode !== 'single' ? selectedFallback : undefined,
        primaryModel: selectedModel,
        fallbackModel: selectedMode === 'fallback' ? selectedFallbackModel : undefined,
        parallelProviders: selectedMode === 'parallel' && parallelProvidersRef.current.length >= 2
          ? parallelProvidersRef.current
          : undefined,
        reasoningEffort: reasoningEffortRef.current,
        settings: aiSettingsRef.current || undefined,
        ...requestExtras,
      },
      imageCount: normalizedImages.length,
      selectedSuccessTitle: 'Request complete',
      selectedSuccessCode: 'REQUEST_COMPLETE',
      selectedSuccessMessage: 'Completed',
      selectedFailureTitle: 'Request failed',
    });
  }, [
    aiSettingsRef,
    conversationIdRef,
    isStreamingRef,
    modeRef,
    parallelProvidersRef,
    providerRef,
    reasoningEffortRef,
    runRequest,
    setMessages,
    splitModeActiveRef,
    fallbackProviderRef,
  ]);

  const retryLastResponse = useCallback((providerOverride) => {
    if (!conversationIdRef.current || isStreamingRef.current) return;

    const selectedProvider = normalizeProvider(providerOverride || providerRef.current || DEFAULT_PROVIDER);
    const selectedMode = splitModeActiveRef.current ? 'parallel' : normalizeMode(modeRef.current);
    const selectedFallback = normalizeFallback(selectedProvider, fallbackProviderRef.current);
    const selectedModel = modelRef.current || undefined;
    const selectedFallbackModel = fallbackModelRef.current || undefined;

    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      while (next.length > 0 && next[next.length - 1]?.role === 'assistant') {
        next.pop();
      }
      return next;
    });

    // Include image parser config for retries (server reconstructs images from last user msg)
    const retryImageParserProvider = localStorage.getItem('qbo-image-parser-provider') || '';
    const retryImageParserModel = localStorage.getItem('qbo-image-parser-model') || '';

    return runRequest({
      isRetry: true,
      selectedProvider,
      selectedMode,
      selectedFallback,
      requestFn: retryChatMessage,
      requestPayload: {
        conversationId: conversationIdRef.current,
        provider: selectedProvider,
        mode: selectedMode,
        fallbackProvider: selectedMode !== 'single' ? selectedFallback : undefined,
        primaryModel: selectedModel,
        fallbackModel: selectedMode === 'fallback' ? selectedFallbackModel : undefined,
        parallelProviders: selectedMode === 'parallel' && parallelProvidersRef.current.length >= 2
          ? parallelProvidersRef.current
          : undefined,
        reasoningEffort: reasoningEffortRef.current,
        settings: aiSettingsRef.current || undefined,
        imageParserProvider: retryImageParserProvider || undefined,
        imageParserModel: retryImageParserModel || undefined,
      },
      selectedSuccessTitle: 'Retry complete',
      selectedSuccessCode: 'RETRY_COMPLETE',
      selectedSuccessMessage: 'Completed',
      selectedFailureTitle: 'Retry failed',
    });
  }, [
    aiSettingsRef,
    conversationIdRef,
    isStreamingRef,
    modeRef,
    parallelProvidersRef,
    providerRef,
    reasoningEffortRef,
    modelRef,
    fallbackModelRef,
    runRequest,
    setMessages,
    splitModeActiveRef,
    fallbackProviderRef,
  ]);

  return {
    sendMessage,
    retryLastResponse,
  };
}
