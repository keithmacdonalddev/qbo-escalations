import { useCallback } from 'react';
import { deleteConversation, getConversation } from '../api/chatApi.js';
import { normalizeProvider } from '../lib/providerCatalog.js';

function normalizeConversationMessages(conversation) {
  const conversationProvider = normalizeProvider(conversation?.provider);
  const normalizedMessages = (conversation?.messages || []).map((msg) => {
    if (msg.role !== 'assistant') return msg;
    const quickActions = msg.attemptMeta?.quickActions;
    return {
      ...msg,
      provider: normalizeProvider(msg.provider || conversationProvider),
      ...(Array.isArray(quickActions) && quickActions.length > 0 ? { quickActions } : {}),
    };
  });

  return { conversationProvider, normalizedMessages };
}

export default function useChatConversationLifecycle({
  abortRef,
  clearChatMessagesSnapshot,
  clearScheduledStreamFlush,
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
  setProvider,
  setRuntimeWarnings,
  resetProcessEvents,
  setSplitModeActive,
  setStreamingText,
  setThinkingStartTime,
  setThinkingText,
  setTriageCard,
  setCaseIntake,
  setMode,
  splitModeActiveRef,
  streamingTextRef,
  thinkingTextRef,
  isThinkingRef,
}) {
  const resetTransientState = useCallback(() => {
    setError(null);
    setFallbackNotice(null);
    setTriageCard(null);
    setCaseIntake(null);
    setInvMatches(null);
    setContextDebug(null);
    setRuntimeWarnings([]);
    setCurrentTraceId(null);
    setThinkingText('');
    thinkingTextRef.current = '';
    setIsThinking(false);
    isThinkingRef.current = false;
    setThinkingStartTime(null);
  }, [
    isThinkingRef,
    setContextDebug,
    setCurrentTraceId,
    setError,
    setFallbackNotice,
    setInvMatches,
    setIsThinking,
    setRuntimeWarnings,
    setThinkingStartTime,
    setThinkingText,
    setTriageCard,
    setCaseIntake,
    thinkingTextRef,
  ]);

  const clearTransientStreamingState = useCallback(() => {
    clearScheduledStreamFlush();
    setIsStreaming(false);
    isStreamingRef.current = false;
    setStreamingText('');
    streamingTextRef.current = '';
    setParallelStreaming({});
    parallelStreamingRef.current = {};
  }, [
    clearScheduledStreamFlush,
    isStreamingRef,
    parallelStreamingRef,
    setIsStreaming,
    setParallelStreaming,
    setStreamingText,
    streamingTextRef,
  ]);

  const resetStreamingState = useCallback((clearEvenIfIdle = false) => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
      clearTransientStreamingState();
      return;
    }
    if (clearEvenIfIdle) {
      clearTransientStreamingState();
    }
  }, [abortRef, clearTransientStreamingState]);

  const selectConversation = useCallback(async (id) => {
    try {
      resetStreamingState();
      setError(null);
      resetTransientState();
      resetProcessEvents();

      const conv = await getConversation(id);
      setConversationId(conv._id);
      conversationIdRef.current = conv._id;

      const { conversationProvider, normalizedMessages } = normalizeConversationMessages(conv);
      setProvider(conversationProvider);

      const lastAssistant = [...normalizedMessages].reverse().find((message) => message.role === 'assistant');
      if (lastAssistant && lastAssistant.mode) {
        setMode(lastAssistant.mode);
      }

      const hadParallel = normalizedMessages.some((message) => message.mode === 'parallel' && message.attemptMeta?.parallel);
      setSplitModeActive(hadParallel);
      splitModeActiveRef.current = hadParallel;

      setMessages(normalizedMessages);
      setCaseIntake(conv.caseIntake || null);
    } catch (err) {
      setError(err?.message);
    }
  }, [
    conversationIdRef,
    resetStreamingState,
    resetTransientState,
    setConversationId,
    setCaseIntake,
    setError,
    setMessages,
    setMode,
    setProvider,
    setSplitModeActive,
    splitModeActiveRef,
  ]);

  const newConversation = useCallback(() => {
    resetStreamingState(true);
    setConversationId(null);
    conversationIdRef.current = null;
    setMessages([]);
    setCaseIntake(null);
    clearChatMessagesSnapshot();
    resetProcessEvents();
    setStreamingText('');
    streamingTextRef.current = '';
    setParallelStreaming({});
    parallelStreamingRef.current = {};
    resetTransientState();
    setSplitModeActive(false);
    splitModeActiveRef.current = false;
  }, [
    clearChatMessagesSnapshot,
    conversationIdRef,
    parallelStreamingRef,
    resetStreamingState,
    resetTransientState,
    resetProcessEvents,
    setConversationId,
    setMessages,
    setCaseIntake,
    setParallelStreaming,
    setSplitModeActive,
    setStreamingText,
    streamingTextRef,
    splitModeActiveRef,
  ]);

  const removeConversation = useCallback(async (id) => {
    try {
      await deleteConversation(id);
      if (conversationIdRef.current === id) {
        newConversation();
      }
    } catch (err) {
      setError(err?.message);
    }
  }, [conversationIdRef, newConversation, setError]);

  return {
    selectConversation,
    newConversation,
    removeConversation,
  };
}
