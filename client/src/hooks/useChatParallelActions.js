import { useCallback, useState } from 'react';
import {
  acceptParallelTurn as acceptParallelTurnApi,
  getConversation,
  unacceptParallelTurn as unacceptParallelTurnApi,
} from '../api/chatApi.js';
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

export default function useChatParallelActions({
  conversationIdRef,
  setConversationId,
  setError,
  setMessages,
  setMode,
  setProvider,
}) {
  const [parallelAcceptingKey, setParallelAcceptingKey] = useState(null);

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
      const { conversationProvider, normalizedMessages } = normalizeConversationMessages(conversation);
      setProvider(conversationProvider);

      const lastAssistant = [...normalizedMessages].reverse().find((message) => message.role === 'assistant');
      if (lastAssistant && lastAssistant.mode) {
        setMode(lastAssistant.mode);
      }

      setMessages(normalizedMessages);
      setConversationId(conversation._id);
      conversationIdRef.current = conversation._id;
      return out;
    } catch (err) {
      setError(err?.message || 'Failed to accept parallel response');
      throw err;
    } finally {
      setParallelAcceptingKey(null);
    }
  }, [
    conversationIdRef,
    setConversationId,
    setError,
    setMessages,
    setMode,
    setProvider,
  ]);

  const unacceptParallelTurn = useCallback(async (turnId) => {
    if (!turnId || !conversationIdRef.current) return null;
    setError(null);
    try {
      const out = await unacceptParallelTurnApi(turnId, {
        conversationId: conversationIdRef.current,
      });
      const conversation = out.conversation || await getConversation(conversationIdRef.current);
      const { normalizedMessages } = normalizeConversationMessages(conversation);
      setMessages(normalizedMessages);
      return out;
    } catch (err) {
      setError(err?.message || 'Failed to undo acceptance');
      throw err;
    }
  }, [conversationIdRef, setError, setMessages]);

  return {
    parallelAcceptingKey,
    acceptParallelTurn,
    unacceptParallelTurn,
  };
}
