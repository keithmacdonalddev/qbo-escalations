import { useState, useCallback, useRef, useEffect } from 'react';
import {
  sendDevMessage,
  listDevConversations,
  getDevConversation,
  deleteDevConversation,
} from '../api/devApi.js';

const DEFAULT_PROVIDER = 'claude';
const DEFAULT_MODE = 'single';
const PROVIDERS = new Set(['claude', 'chatgpt-5.3-codex-high', 'claude-sonnet-4-6', 'gpt-5-mini']);
const MODES = new Set(['single', 'fallback']);

function normalizeProvider(provider) {
  return PROVIDERS.has(provider) ? provider : DEFAULT_PROVIDER;
}

function normalizeMode(mode) {
  return MODES.has(mode) ? mode : DEFAULT_MODE;
}

const PROVIDER_FAMILY = {
  claude: 'claude',
  'claude-sonnet-4-6': 'claude',
  'chatgpt-5.3-codex-high': 'codex',
  'gpt-5-mini': 'codex',
};

function isClaudeFamily(provider) {
  return (PROVIDER_FAMILY[provider] || 'claude') === 'claude';
}

function alternateProvider(provider) {
  const family = PROVIDER_FAMILY[provider] || 'claude';
  return family === 'claude' ? 'chatgpt-5.3-codex-high' : 'claude';
}

function normalizeFallback(primary, fallback) {
  const normalizedPrimary = normalizeProvider(primary);
  const normalizedFallback = normalizeProvider(fallback);
  if (normalizedFallback === normalizedPrimary) return alternateProvider(normalizedPrimary);
  return normalizedFallback;
}

export function useDevChat() {
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [provider, setProviderState] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_PROVIDER;
    return normalizeProvider(window.localStorage.getItem('qbo-dev-provider'));
  });
  const [mode, setModeState] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_MODE;
    return normalizeMode(window.localStorage.getItem('qbo-dev-mode'));
  });
  const [fallbackProvider, setFallbackProviderState] = useState(() => {
    if (typeof window === 'undefined') return alternateProvider(DEFAULT_PROVIDER);
    const savedProvider = normalizeProvider(window.localStorage.getItem('qbo-dev-provider'));
    return normalizeFallback(savedProvider, window.localStorage.getItem('qbo-dev-fallback-provider'));
  });
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [toolEvents, setToolEvents] = useState([]);
  const [streamProvider, setStreamProvider] = useState(provider);
  const [fallbackNotice, setFallbackNotice] = useState(null);
  const [error, setError] = useState(null);
  const [responseTime, setResponseTime] = useState(null);

  const abortRef = useRef(null);
  const startTimeRef = useRef(null);
  const isStreamingRef = useRef(false);
  const conversationIdRef = useRef(null);
  const sessionIdRef = useRef(null);
  const streamingTextRef = useRef('');
  const toolEventsRef = useRef([]);
  const providerRef = useRef(provider);
  const modeRef = useRef(mode);
  const fallbackProviderRef = useRef(fallbackProvider);

  const setProvider = useCallback((nextProvider) => {
    const normalized = normalizeProvider(nextProvider);
    providerRef.current = normalized;
    setProviderState(normalized);

    if (!isClaudeFamily(normalized)) {
      setSessionId(null);
      sessionIdRef.current = null;
    }

    const fallback = normalizeFallback(normalized, fallbackProviderRef.current);
    fallbackProviderRef.current = fallback;
    setFallbackProviderState(fallback);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('qbo-dev-provider', normalized);
      window.localStorage.setItem('qbo-dev-fallback-provider', fallback);
    }
  }, []);

  const setMode = useCallback((nextMode) => {
    const normalized = normalizeMode(nextMode);
    modeRef.current = normalized;
    setModeState(normalized);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('qbo-dev-mode', normalized);
    }
  }, []);

  const setFallbackProvider = useCallback((nextProvider) => {
    const normalized = normalizeFallback(providerRef.current, nextProvider);
    fallbackProviderRef.current = normalized;
    setFallbackProviderState(normalized);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('qbo-dev-fallback-provider', normalized);
    }
  }, []);

  useEffect(() => { providerRef.current = provider; }, [provider]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { fallbackProviderRef.current = fallbackProvider; }, [fallbackProvider]);

  const loadConversations = useCallback(async () => {
    try {
      const list = await listDevConversations();
      setConversations(list);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Abort any in-flight stream on unmount
  useEffect(() => {
    return () => { if (abortRef.current) abortRef.current(); };
  }, []);

  const selectConversation = useCallback(async (id) => {
    try {
      setError(null);
      setFallbackNotice(null);
      const conv = await getDevConversation(id);
      setConversationId(conv._id);
      conversationIdRef.current = conv._id;

      const conversationProvider = normalizeProvider(conv.provider || providerRef.current);
      if (conv.provider) setProvider(conversationProvider);

      const normalizedSessionId = isClaudeFamily(conversationProvider) ? (conv.sessionId || null) : null;
      setSessionId(normalizedSessionId);
      sessionIdRef.current = normalizedSessionId;

      const normalizedMessages = (conv.messages || []).map((msg) => {
        if (msg.role !== 'assistant') return msg;
        return {
          ...msg,
          provider: normalizeProvider(msg.provider || conv.provider || providerRef.current),
        };
      });

      const lastAssistant = [...normalizedMessages].reverse().find((m) => m.role === 'assistant');
      if (lastAssistant && lastAssistant.mode) setMode(lastAssistant.mode);

      setMessages(normalizedMessages);
    } catch (err) {
      setError(err.message);
    }
  }, [setMode, setProvider]);

  const newConversation = useCallback(() => {
    setConversationId(null);
    conversationIdRef.current = null;
    setSessionId(null);
    sessionIdRef.current = null;
    setMessages([]);
    setStreamingText('');
    streamingTextRef.current = '';
    setToolEvents([]);
    toolEventsRef.current = [];
    setStreamProvider(providerRef.current);
    setFallbackNotice(null);
    setError(null);
  }, []);

  const sendMessage = useCallback((text, images = [], providerOverride) => {
    if (isStreamingRef.current) return;
    const trimmedText = typeof text === 'string' ? text.trim() : '';
    const normalizedImages = Array.isArray(images)
      ? images.filter((src) => typeof src === 'string' && src.trim().length > 0)
      : [];
    if (!trimmedText && normalizedImages.length === 0) return;

    const selectedProvider = normalizeProvider(providerOverride || providerRef.current);
    const selectedMode = normalizeMode(modeRef.current);
    const selectedFallback = normalizeFallback(selectedProvider, fallbackProviderRef.current);

    setError(null);
    setFallbackNotice(null);
    setIsStreaming(true);
    isStreamingRef.current = true;
    setStreamingText('');
    streamingTextRef.current = '';
    setToolEvents([]);
    toolEventsRef.current = [];
    setStreamProvider(selectedProvider);
    setResponseTime(null);
    startTimeRef.current = Date.now();

    const userMsg = {
      role: 'user',
      content: trimmedText || '(image attached)',
      images: normalizedImages,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    const { abort } = sendDevMessage(
      {
        message: trimmedText,
        images: normalizedImages,
        conversationId: conversationIdRef.current,
        sessionId: isClaudeFamily(selectedProvider) ? sessionIdRef.current : null,
        provider: selectedProvider,
        mode: selectedMode,
        fallbackProvider: selectedMode === 'fallback' ? selectedFallback : undefined,
      },
      {
        onInit: (data) => {
          const id = data.conversationId || conversationIdRef.current;
          setConversationId(id);
          conversationIdRef.current = id;

          const initProvider = normalizeProvider(data.primaryProvider || data.provider || selectedProvider);
          if (data.primaryProvider) setProvider(initProvider);

          if (isClaudeFamily(initProvider) && data.sessionId) {
            setSessionId(data.sessionId);
            sessionIdRef.current = data.sessionId;
          }
          if (!isClaudeFamily(initProvider)) {
            setSessionId(null);
            sessionIdRef.current = null;
          }

          setStreamProvider(initProvider);
        },
        onChunk: (data) => {
          if (data.provider) setStreamProvider(normalizeProvider(data.provider));
          streamingTextRef.current += data.text;
          setStreamingText(streamingTextRef.current);
        },
        onToolUse: (data) => {
          toolEventsRef.current = [...toolEventsRef.current, data];
          setToolEvents(toolEventsRef.current);
        },
        onProviderError: () => {},
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
          toolEventsRef.current = [];
          setToolEvents([]);
        },
        onDone: (data) => {
          const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : null;
          setResponseTime(elapsed);
          const finalText = streamingTextRef.current || '';
          const finalProvider = normalizeProvider(data.providerUsed || data.provider || selectedProvider);
          setMessages((prev) => [...prev, {
            role: 'assistant',
            content: finalText,
            timestamp: new Date().toISOString(),
            responseTimeMs: elapsed,
            toolEvents: toolEventsRef.current,
            provider: finalProvider,
            mode: data.mode || selectedMode,
            fallbackFrom: data.fallbackFrom || null,
            attemptMeta: data.attempts ? { attempts: data.attempts } : null,
            usage: data.usage || null,
          }]);
          setStreamingText('');
          streamingTextRef.current = '';
          setToolEvents([]);
          toolEventsRef.current = [];
          setIsStreaming(false);
          isStreamingRef.current = false;
          setConversationId(data.conversationId || conversationIdRef.current);
          conversationIdRef.current = data.conversationId || conversationIdRef.current;

          if (isClaudeFamily(finalProvider)) {
            const nextSessionId = data.sessionId || null;
            setSessionId(nextSessionId);
            sessionIdRef.current = nextSessionId;
          } else {
            setSessionId(null);
            sessionIdRef.current = null;
          }

          setStreamProvider(finalProvider);
          loadConversations();
        },
        onError: (errMsg) => {
          setError(errMsg);
          setIsStreaming(false);
          isStreamingRef.current = false;
          setStreamingText('');
          streamingTextRef.current = '';
          setToolEvents([]);
          toolEventsRef.current = [];
        },
      }
    );

    abortRef.current = abort;
  }, [loadConversations, setProvider]);

  const abortStream = useCallback(() => {
    abortRef.current?.();
    setIsStreaming(false);
    isStreamingRef.current = false;
    setStreamingText('');
    streamingTextRef.current = '';
    setToolEvents([]);
    toolEventsRef.current = [];
  }, []);

  const removeConversation = useCallback(async (id) => {
    try {
      await deleteDevConversation(id);
      if (conversationId === id) newConversation();
      await loadConversations();
    } catch (err) {
      setError(err.message);
    }
  }, [conversationId, newConversation, loadConversations]);

  const dismissFallbackNotice = useCallback(() => {
    setFallbackNotice(null);
  }, []);

  return {
    messages,
    conversationId,
    sessionId,
    conversations,
    provider,
    mode,
    fallbackProvider,
    isStreaming,
    streamingText,
    streamProvider,
    toolEvents,
    fallbackNotice,
    error,
    responseTime,
    sendMessage,
    setProvider,
    setMode,
    setFallbackProvider,
    dismissFallbackNotice,
    abortStream,
    selectConversation,
    newConversation,
    removeConversation,
    setError,
  };
}
