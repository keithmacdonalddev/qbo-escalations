import { useState, useCallback, useRef, useEffect } from 'react';
import { sendDevMessage, listDevConversations, getDevConversation, deleteDevConversation } from '../api/devApi.js';

export function useDevChat() {
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [toolEvents, setToolEvents] = useState([]); // tool_use events during current stream
  const [error, setError] = useState(null);
  const [responseTime, setResponseTime] = useState(null);
  const abortRef = useRef(null);
  const startTimeRef = useRef(null);
  const isStreamingRef = useRef(false);
  const conversationIdRef = useRef(null);
  const streamingTextRef = useRef('');

  // Load conversation list
  const loadConversations = useCallback(async () => {
    try {
      const list = await listDevConversations();
      setConversations(list);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Select a conversation
  const selectConversation = useCallback(async (id) => {
    try {
      setError(null);
      const conv = await getDevConversation(id);
      setConversationId(conv._id);
      conversationIdRef.current = conv._id;
      setMessages(conv.messages || []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  // Start new conversation
  const newConversation = useCallback(() => {
    setConversationId(null);
    conversationIdRef.current = null;
    setMessages([]);
    setStreamingText('');
    setToolEvents([]);
    setError(null);
  }, []);

  // Send message
  const sendMessage = useCallback((text) => {
    if (!text.trim() || isStreamingRef.current) return;

    setError(null);
    setIsStreaming(true);
    isStreamingRef.current = true;
    setStreamingText('');
    streamingTextRef.current = '';
    setToolEvents([]);
    setResponseTime(null);
    startTimeRef.current = Date.now();

    const userMsg = { role: 'user', content: text.trim(), timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    const { abort } = sendDevMessage(
      { message: text.trim(), conversationId: conversationIdRef.current },
      {
        onInit: (data) => {
          const id = data.conversationId || data.sessionKey;
          setConversationId(id);
          conversationIdRef.current = id;
        },
        onChunk: (data) => {
          streamingTextRef.current += data.text;
          setStreamingText(streamingTextRef.current);
        },
        onToolUse: (data) => {
          setToolEvents(prev => [...prev, data]);
        },
        onDone: (data) => {
          const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : null;
          setResponseTime(elapsed);
          const finalText = streamingTextRef.current;
          setMessages(msgs => [...msgs, {
            role: 'assistant',
            content: finalText,
            timestamp: new Date().toISOString(),
            responseTimeMs: elapsed,
            toolEvents: data.toolEvents || [],
          }]);
          setStreamingText('');
          streamingTextRef.current = '';
          setIsStreaming(false);
          isStreamingRef.current = false;
          setToolEvents([]);
          setConversationId(data.conversationId);
          conversationIdRef.current = data.conversationId;
          loadConversations();
        },
        onError: (errMsg) => {
          setError(errMsg);
          setIsStreaming(false);
          isStreamingRef.current = false;
          setStreamingText('');
          streamingTextRef.current = '';
        },
      }
    );

    abortRef.current = abort;
  }, [loadConversations]);

  // Abort streaming
  const abortStream = useCallback(() => {
    abortRef.current?.();
    setIsStreaming(false);
    isStreamingRef.current = false;
    setStreamingText('');
  }, []);

  // Delete conversation
  const removeConversation = useCallback(async (id) => {
    try {
      await deleteDevConversation(id);
      if (conversationId === id) {
        newConversation();
      }
      await loadConversations();
    } catch (err) {
      setError(err.message);
    }
  }, [conversationId, newConversation, loadConversations]);

  return {
    messages,
    conversationId,
    conversations,
    isStreaming,
    streamingText,
    toolEvents,
    error,
    responseTime,
    sendMessage,
    abortStream,
    selectConversation,
    newConversation,
    removeConversation,
    setError,
  };
}
