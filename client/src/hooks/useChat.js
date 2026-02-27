import { useState, useCallback, useRef, useEffect } from 'react';
import { sendChatMessage, listConversations, getConversation, deleteConversation } from '../api/chatApi.js';

export function useChat() {
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState(null);
  const [responseTime, setResponseTime] = useState(null); // ms for last response
  const abortRef = useRef(null);
  const startTimeRef = useRef(null);
  const isStreamingRef = useRef(false);
  const conversationIdRef = useRef(null);
  const streamingTextRef = useRef('');

  // Load conversation list
  const loadConversations = useCallback(async () => {
    try {
      const list = await listConversations();
      setConversations(list);
    } catch {
      // Silently fail — conversations sidebar is not critical
    }
  }, []);

  // Load on mount
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Select a conversation
  const selectConversation = useCallback(async (id) => {
    try {
      setError(null);
      const conv = await getConversation(id);
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
    setError(null);
  }, []);

  // Send message — uses refs to avoid stale closures
  const sendMessage = useCallback((text, images = []) => {
    if ((!text.trim() && images.length === 0) || isStreamingRef.current) return;

    setError(null);
    setIsStreaming(true);
    isStreamingRef.current = true;
    setStreamingText('');
    streamingTextRef.current = '';
    setResponseTime(null);
    startTimeRef.current = Date.now();

    // Optimistically add user message
    const userMsg = { role: 'user', content: text.trim() || '(image attached)', images, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    const { abort } = sendChatMessage(
      { message: text.trim(), conversationId: conversationIdRef.current, images },
      {
        onInit: (data) => {
          setConversationId(data.conversationId);
          conversationIdRef.current = data.conversationId;
        },
        onChunk: (data) => {
          streamingTextRef.current += data.text;
          setStreamingText(streamingTextRef.current);
        },
        onDone: (data) => {
          const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : null;
          setResponseTime(elapsed);
          // Use ref value for final content — avoids stale state from React batching
          const finalText = streamingTextRef.current;
          setMessages(msgs => [...msgs, {
            role: 'assistant',
            content: finalText,
            timestamp: new Date().toISOString(),
            responseTimeMs: elapsed,
          }]);
          setStreamingText('');
          streamingTextRef.current = '';
          setIsStreaming(false);
          isStreamingRef.current = false;
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
      await deleteConversation(id);
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
