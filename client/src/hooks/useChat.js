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
      setMessages(conv.messages || []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  // Start new conversation
  const newConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setStreamingText('');
    setError(null);
  }, []);

  // Send message
  const sendMessage = useCallback((text, images = []) => {
    if (!text.trim() || isStreaming) return;

    setError(null);
    setIsStreaming(true);
    setStreamingText('');
    setResponseTime(null);
    startTimeRef.current = Date.now();

    // Optimistically add user message
    const userMsg = { role: 'user', content: text.trim(), images, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    const { abort } = sendChatMessage(
      { message: text.trim(), conversationId, images },
      {
        onInit: (data) => {
          setConversationId(data.conversationId);
        },
        onChunk: (data) => {
          setStreamingText(prev => prev + data.text);
        },
        onDone: (data) => {
          const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : null;
          setResponseTime(elapsed);
          setStreamingText(prev => {
            // Finalize: add assistant message from accumulated text
            setMessages(msgs => [...msgs, {
              role: 'assistant',
              content: prev,
              timestamp: new Date().toISOString(),
              responseTimeMs: elapsed,
            }]);
            return '';
          });
          setIsStreaming(false);
          setConversationId(data.conversationId);
          loadConversations();
        },
        onError: (errMsg) => {
          setError(errMsg);
          setIsStreaming(false);
          setStreamingText('');
        },
      }
    );

    abortRef.current = abort;
  }, [conversationId, isStreaming, loadConversations]);

  // Abort streaming
  const abortStream = useCallback(() => {
    abortRef.current?.();
    setIsStreaming(false);
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
