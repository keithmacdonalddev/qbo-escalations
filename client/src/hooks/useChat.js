// @refresh reset — force full remount on HMR (many hooks, HMR can't reconcile)
import { useState, useCallback, useRef, useEffect } from 'react';
import { normalizeError } from '../utils/normalizeError.js';
import { tel, TEL } from '../lib/devTelemetry.js';
import {
  DEFAULT_PROVIDER,
  DEFAULT_REASONING_EFFORT,
  normalizeReasoningEffort,
} from '../lib/providerCatalog.js';
import {
  bindSurfaceDefaultsApplied,
  normalizeSurfaceFallback,
  normalizeSurfaceModel,
  normalizeSurfaceMode,
  normalizeSurfaceProvider,
  readSurfacePreferences,
  writeStoredPreference,
} from '../lib/surfacePreferences.js';
import useChatSessionPersistence, { initialChatSessionRecovery } from './useChatSessionPersistence.js';
import useChatConversationLifecycle from './useChatConversationLifecycle.js';
import useChatParallelActions from './useChatParallelActions.js';
import useChatRequestFlow from './useChatRequestFlow.js';
import useChatStreamState from './useChatStreamState.js';

const DEFAULT_MODE = 'single';
const SUPPORTED_MODES = ['single', 'fallback', 'parallel'];

// Stable empty array returned for `conversations` — Sidebar is the single
// source of truth for conversation list. Kept for API compatibility.
const EMPTY_CONVERSATIONS = Object.freeze([]);

export function useChat(options = {}) {
  const { aiSettings = null } = options;
  const [messages, setMessages] = useState(() => initialChatSessionRecovery.messages || []);
  const [conversationId, setConversationId] = useState(() => initialChatSessionRecovery.conversationId || null);
  const initialPreferencesRef = useRef(null);
  if (!initialPreferencesRef.current) {
    initialPreferencesRef.current = readSurfacePreferences({
      providerKeys: 'qbo-chat-provider',
      modeKeys: 'qbo-chat-mode',
      fallbackProviderKeys: 'qbo-chat-fallback-provider',
      modelKeys: 'qbo-chat-model',
      fallbackModelKeys: 'qbo-chat-fallback-model',
      reasoningEffortKeys: 'qbo-chat-reasoning-effort',
      defaultMode: DEFAULT_MODE,
      supportedModes: SUPPORTED_MODES,
      defaultProvider: DEFAULT_PROVIDER,
      reasoningEffortFallback: aiSettings?.providerStrategy?.reasoningEffort || DEFAULT_REASONING_EFFORT,
    });
  }
  const [provider, setProviderState] = useState(initialPreferencesRef.current.provider);
  const [mode, setModeState] = useState(initialPreferencesRef.current.mode);
  const [fallbackProvider, setFallbackProviderState] = useState(initialPreferencesRef.current.fallbackProvider);
  const [model, setModelState] = useState(initialPreferencesRef.current.model);
  const [fallbackModel, setFallbackModelState] = useState(initialPreferencesRef.current.fallbackModel);
  const [reasoningEffort, setReasoningEffortState] = useState(initialPreferencesRef.current.reasoningEffort);
  const [parallelProviders, setParallelProvidersState] = useState([]);
  const [splitModeActive, setSplitModeActive] = useState(false);
  const [error, setErrorState] = useState(null);
  const [errorDetails, setErrorDetails] = useState(null);

  const {
    abortRef,
    startTimeRef,
    isStreamingRef,
    streamingTextRef,
    parallelStreamingRef,
    chunkStartedProvidersRef,
    thinkingTextRef,
    isThinkingRef,
    isStreaming,
    setIsStreaming,
    streamingText,
    setStreamingText,
    parallelStreaming,
    setParallelStreaming,
    streamProvider,
    setStreamProvider,
    fallbackNotice,
    setFallbackNotice,
    responseTime,
    setResponseTime,
    contextDebug,
    setContextDebug,
    runtimeWarnings,
    setRuntimeWarnings,
    triageCard,
    setTriageCard,
    invMatches,
    setInvMatches,
    processEvents,
    thinkingText,
    setThinkingText,
    isThinking,
    setIsThinking,
    thinkingStartTime,
    setThinkingStartTime,
    currentTraceId,
    setCurrentTraceId,
    clearScheduledStreamFlush,
    scheduleStreamFlush,
    pushProcessEvent,
    resetProcessEvents,
  } = useChatStreamState({ initialStreamProvider: provider });

  const conversationIdRef = useRef(initialChatSessionRecovery.conversationId || null);
  const providerRef = useRef(provider);
  const modeRef = useRef(mode);
  const splitModeActiveRef = useRef(false);
  const fallbackProviderRef = useRef(fallbackProvider);
  const modelRef = useRef(model);
  const fallbackModelRef = useRef(fallbackModel);
  const parallelProvidersRef = useRef([]);
  const aiSettingsRef = useRef(aiSettings);
  const reasoningEffortRef = useRef(reasoningEffort);

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

  const setProvider = useCallback((nextProvider) => {
    const previous = providerRef.current;
    const previousFallback = fallbackProviderRef.current;
    const normalized = normalizeSurfaceProvider(nextProvider);
    providerRef.current = normalized;
    setProviderState(normalized);
    if (!isStreamingRef.current) {
      setStreamProvider(normalized);
    }

    if (previous !== normalized) {
      tel(TEL.PROVIDER_SWITCH, `Switched to ${normalized}`, { from: previous, to: normalized });
    }

    const fallback = normalizeSurfaceFallback(normalized, fallbackProviderRef.current);
    const providerChanged = previous !== normalized;
    fallbackProviderRef.current = fallback;
    setFallbackProviderState(fallback);
    if (providerChanged) {
      modelRef.current = '';
      setModelState('');
      writeStoredPreference('qbo-chat-model', '');
      if (fallback !== previousFallback) {
        fallbackModelRef.current = '';
        setFallbackModelState('');
        writeStoredPreference('qbo-chat-fallback-model', '');
      }
    }

    writeStoredPreference('qbo-chat-provider', normalized);
    writeStoredPreference('qbo-chat-fallback-provider', fallback);
  }, []);

  const setMode = useCallback((nextMode) => {
    const normalized = normalizeSurfaceMode(nextMode, SUPPORTED_MODES, DEFAULT_MODE);
    modeRef.current = normalized;
    setModeState(normalized);
    writeStoredPreference('qbo-chat-mode', normalized);
  }, []);

  const setFallbackProvider = useCallback((nextProvider) => {
    const previous = fallbackProviderRef.current;
    const normalized = normalizeSurfaceFallback(providerRef.current, nextProvider);
    fallbackProviderRef.current = normalized;
    setFallbackProviderState(normalized);
    if (previous !== normalized) {
      fallbackModelRef.current = '';
      setFallbackModelState('');
      writeStoredPreference('qbo-chat-fallback-model', '');
    }
    writeStoredPreference('qbo-chat-fallback-provider', normalized);
  }, []);

  const setParallelProviders = useCallback((nextProviders) => {
    const valid = Array.isArray(nextProviders)
      ? nextProviders.filter((p) => normalizeSurfaceProvider(p) === p)
      : [];
    const unique = [...new Set(valid)].slice(0, 4);
    parallelProvidersRef.current = unique;
    setParallelProvidersState(unique);
  }, []);

  const setReasoningEffort = useCallback((nextEffort) => {
    const normalized = normalizeReasoningEffort(nextEffort);
    reasoningEffortRef.current = normalized;
    setReasoningEffortState(normalized);
    writeStoredPreference('qbo-chat-reasoning-effort', normalized);
  }, []);

  const setModel = useCallback((nextModel) => {
    const normalized = normalizeSurfaceModel(nextModel);
    modelRef.current = normalized;
    setModelState(normalized);
    writeStoredPreference('qbo-chat-model', normalized);
  }, []);

  const setFallbackModel = useCallback((nextModel) => {
    const normalized = normalizeSurfaceModel(nextModel);
    fallbackModelRef.current = normalized;
    setFallbackModelState(normalized);
    writeStoredPreference('qbo-chat-fallback-model', normalized);
  }, []);

  const { clearChatMessagesSnapshot } = useChatSessionPersistence({
    conversationIdRef,
    messages,
    setMessages,
  });
  const {
    selectConversation,
    newConversation,
    removeConversation,
  } = useChatConversationLifecycle({
    abortRef,
    clearScheduledStreamFlush,
    clearChatMessagesSnapshot,
    conversationIdRef,
    isStreamingRef,
    parallelStreamingRef,
    setConversationId,
    setContextDebug,
    setCurrentTraceId,
    setError,
    setFallbackNotice,
    setInvMatches,
    setIsStreaming,
    setIsThinking,
    setMessages,
    setParallelStreaming,
    resetProcessEvents,
    setRuntimeWarnings,
    setSplitModeActive,
    setStreamingText,
    setThinkingStartTime,
    setThinkingText,
    setTriageCard,
    setMode,
    setProvider,
    splitModeActiveRef,
    streamingTextRef,
    thinkingTextRef,
    isThinkingRef,
  });
  const {
    parallelAcceptingKey,
    acceptParallelTurn,
    unacceptParallelTurn,
  } = useChatParallelActions({
    conversationIdRef,
    setConversationId,
    setError,
    setMessages,
    setMode,
    setProvider,
  });

  useEffect(() => {
    providerRef.current = provider;
  }, [provider]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    conversationIdRef.current = conversationId || null;
  }, [conversationId]);

  useEffect(() => {
    fallbackProviderRef.current = fallbackProvider;
  }, [fallbackProvider]);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(() => {
    fallbackModelRef.current = fallbackModel;
  }, [fallbackModel]);

  useEffect(() => bindSurfaceDefaultsApplied('chat', {
    setProvider,
    setMode,
    setFallbackProvider,
    setModel,
    setFallbackModel,
    setReasoningEffort,
  }), [setFallbackModel, setFallbackProvider, setMode, setModel, setProvider, setReasoningEffort]);

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

  const { sendMessage, retryLastResponse } = useChatRequestFlow({
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
    setModel,
    setFallbackModel,
    setResponseTime,
    setRuntimeWarnings,
    setSplitModeActive,
    setStreamProvider,
    setStreamingText,
    setThinkingStartTime,
    setThinkingText,
    setTriageCard,
    shouldShowContextDebug,
  });
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
    clearScheduledStreamFlush();
    setIsStreaming(false);
    isStreamingRef.current = false;
    setTriageCard(null);
    setInvMatches(null);
    setStreamingText('');
    streamingTextRef.current = '';
    setParallelStreaming({});
    parallelStreamingRef.current = {};
    setThinkingText('');
    thinkingTextRef.current = '';
    setIsThinking(false);
    isThinkingRef.current = false;
    setThinkingStartTime(null);
  }, [clearScheduledStreamFlush, pushProcessEvent]);

  const dismissFallbackNotice = useCallback(() => {
    setFallbackNotice(null);
  }, []);

  const dismissRuntimeWarnings = useCallback(() => {
    setRuntimeWarnings([]);
  }, []);

  const clearProcessEvents = useCallback(() => {
    resetProcessEvents();
  }, [resetProcessEvents]);

  return {
    messages,
    conversationId,
    conversations: EMPTY_CONVERSATIONS,
    provider,
    mode,
    fallbackProvider,
    model,
    fallbackModel,
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
    setModel,
    setFallbackModel,
    setReasoningEffort,
    setParallelProviders,
    dismissFallbackNotice,
    dismissRuntimeWarnings,
    acceptParallelTurn,
    unacceptParallelTurn,
    triageCard,
    setTriageCard,
    invMatches,
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
    currentTraceId,
  };
}
