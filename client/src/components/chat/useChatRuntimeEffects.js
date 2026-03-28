import { useCallback, useEffect, useRef } from 'react';
import { apiFetch } from '../../api/http.js';

export default function useChatRuntimeEffects({
  aiSettings = null,
  conversationIdFromRoute = null,
  conversationId = null,
  isStreaming = false,
  streamingText = '',
  parallelStreaming = {},
  provider = null,
  thinkingStartTime = null,
  surfaceTab = 'chat',
  messages = [],
  input = '',
  textareaRef,
  messagesEndRef,
  scrollFrameRef,
  setInput,
  setGhostText,
  setImages,
  setShowWebcam,
  setShowCopilot,
  setSurfaceTab,
  setComposeFocused,
  setIsComposeDragOver,
  setStreamElapsedMs,
  setLiveRequestRuntime,
  selectConversation,
  newConversation,
  resetConversationState,
  dismissFallbackNotice,
  dismissRuntimeWarnings,
  clearProcessEvents,
  setError,
}) {
  const previousRouteConversationIdRef = useRef(conversationIdFromRoute);

  const focusComposerWithValue = useCallback((nextValue) => {
    setInput(nextValue);
    setGhostText('');
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const length = nextValue.length;
      textareaRef.current?.setSelectionRange(length, length);
    });
  }, [setGhostText, setInput, textareaRef]);

  const startFreshConversation = useCallback(() => {
    resetConversationState();
    setImages([]);
    setShowWebcam(false);
    setShowCopilot(false);
    setSurfaceTab('chat');
    setComposeFocused(false);
    setIsComposeDragOver(false);
    setGhostText('');
    dismissFallbackNotice();
    dismissRuntimeWarnings();
    clearProcessEvents();
    setError(null);
    newConversation();
    if (window.location.hash !== '#/chat') {
      window.location.hash = '#/chat';
    }
    focusComposerWithValue('');
  }, [
    clearProcessEvents,
    dismissFallbackNotice,
    dismissRuntimeWarnings,
    focusComposerWithValue,
    newConversation,
    resetConversationState,
    setComposeFocused,
    setError,
    setGhostText,
    setImages,
    setIsComposeDragOver,
    setShowCopilot,
    setShowWebcam,
    setSurfaceTab,
  ]);

  useEffect(() => {
    const prev = previousRouteConversationIdRef.current;
    previousRouteConversationIdRef.current = conversationIdFromRoute;

    if (conversationIdFromRoute === prev) return;

    if (conversationIdFromRoute && conversationIdFromRoute !== conversationId) {
      selectConversation(conversationIdFromRoute);
    } else if (prev && !conversationIdFromRoute) {
      newConversation();
    }
  }, [conversationId, conversationIdFromRoute, newConversation, selectConversation]);

  useEffect(() => {
    if (scrollFrameRef.current) {
      cancelAnimationFrame(scrollFrameRef.current);
    }

    scrollFrameRef.current = requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: isStreaming ? 'auto' : 'smooth',
        block: 'end',
      });
      scrollFrameRef.current = 0;
    });

    return () => {
      if (scrollFrameRef.current) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = 0;
      }
    };
  }, [isStreaming, messages.length, messagesEndRef, parallelStreaming, scrollFrameRef, streamingText]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    try {
      const raw = sessionStorage.getItem('qbo-draft-scroll');
      if (raw) {
        sessionStorage.removeItem('qbo-draft-scroll');
        const el = document.querySelector('.chat-messages');
        if (el) requestAnimationFrame(() => { el.scrollTop = Number(raw); });
      }
    } catch {}
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 400) + 'px';
  }, [input, textareaRef]);

  useEffect(() => {
    const handler = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'n') {
        event.preventDefault();
        startFreshConversation();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [startFreshConversation]);

  useEffect(() => {
    if (!isStreaming) {
      textareaRef.current?.focus();
    }
  }, [isStreaming, textareaRef]);

  useEffect(() => {
    const showRuntimeDiagnostics = Boolean(aiSettings?.debug?.showContextDebug);
    if (!showRuntimeDiagnostics || !isStreaming || !thinkingStartTime) {
      setStreamElapsedMs(0);
      return;
    }

    setStreamElapsedMs(Date.now() - thinkingStartTime);
    const interval = window.setInterval(() => {
      setStreamElapsedMs(Date.now() - thinkingStartTime);
    }, 250);

    return () => window.clearInterval(interval);
  }, [aiSettings?.debug?.showContextDebug, isStreaming, setStreamElapsedMs, thinkingStartTime]);

  useEffect(() => {
    const showRuntimeDiagnostics = Boolean(aiSettings?.debug?.showContextDebug);
    if (!showRuntimeDiagnostics || !isStreaming || surfaceTab !== 'chat') {
      setLiveRequestRuntime(null);
      return;
    }

    let cancelled = false;

    async function pollRuntime() {
      try {
        const res = await apiFetch('/api/runtime/health', {
          timeout: 8_000,
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (!data || cancelled) return;

        const requestEntries = Array.isArray(data?.requests?.requests)
          ? data.requests.requests.filter((entry) => String(entry.path || '').startsWith('/api/chat'))
          : [];
        const chatAi = data?.ai?.chat || data?.ai?.byKind?.chat || {};
        const parseAi = data?.ai?.parse || data?.ai?.byKind?.parse || {};

        setLiveRequestRuntime({
          checkedAt: Date.now(),
          requests: requestEntries,
          chatAiActive: Number(chatAi.activeSessions) || 0,
          parseAiActive: Number(parseAi.activeSessions) || 0,
          chatSessions: Array.isArray(chatAi.sessions) ? chatAi.sessions : [],
          parseSessions: Array.isArray(parseAi.sessions) ? parseAi.sessions : [],
        });
      } catch {
        if (!cancelled) {
          setLiveRequestRuntime((prev) => prev ? { ...prev, checkedAt: Date.now() } : prev);
        }
      }
    }

    pollRuntime();
    const interval = window.setInterval(pollRuntime, 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [aiSettings?.debug?.showContextDebug, isStreaming, setLiveRequestRuntime, surfaceTab]);

  return {
    focusComposerWithValue,
    startFreshConversation,
  };
}
