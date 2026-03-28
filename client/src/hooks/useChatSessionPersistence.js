import { useCallback, useEffect } from 'react';
import { getConversation } from '../api/chatApi.js';
import {
  readChatMessagesSnapshot,
  writeChatMessagesSnapshot,
} from '../lib/chatMessageSnapshot.js';
import { normalizeProvider } from '../lib/providerCatalog.js';

function recoverSessionState() {
  try {
    const raw = sessionStorage.getItem('qbo-chat-messages');
    const id = sessionStorage.getItem('qbo-chat-conversationId');
    sessionStorage.removeItem('qbo-chat-messages');
    sessionStorage.removeItem('qbo-chat-conversationId');
    sessionStorage.removeItem('qbo-chat-route');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { messages: parsed, conversationId: id || null, recovered: true };
      }
    }
  } catch {
    // Corrupted or unavailable storage falls back to empty state.
  }
  return { messages: null, conversationId: null, recovered: false };
}

export const initialChatSessionRecovery = recoverSessionState();

export default function useChatSessionPersistence({
  conversationIdRef,
  messages,
  setMessages,
}) {
  const clearChatMessagesSnapshot = useCallback(() => {
    writeChatMessagesSnapshot([]);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const snapshotState = () => {
      try {
        const id = conversationIdRef.current;
        if (id) {
          sessionStorage.setItem('qbo-chat-conversationId', id);
        }
        const msgs = readChatMessagesSnapshot();
        if (msgs && msgs.length > 0) {
          const capped = msgs.slice(-50);
          sessionStorage.setItem('qbo-chat-messages', JSON.stringify(capped));
        }
        if (window.location.hash) {
          sessionStorage.setItem('qbo-chat-route', window.location.hash);
        }
      } catch {
        // sessionStorage can throw if full or in private browsing.
      }
    };

    window.addEventListener('beforeunload', snapshotState);

    if (import.meta.hot) {
      import.meta.hot.on('vite:beforeFullReload', snapshotState);
    }

    return () => {
      window.removeEventListener('beforeunload', snapshotState);
    };
  }, [conversationIdRef]);

  useEffect(() => {
    writeChatMessagesSnapshot(messages);
  }, [messages]);

  useEffect(() => {
    if (!initialChatSessionRecovery.recovered) return;
    const recoveredId = initialChatSessionRecovery.conversationId;

    if (recoveredId) {
      conversationIdRef.current = recoveredId;
    }

    window.dispatchEvent(new CustomEvent('qbo:session-recovered'));

    if (recoveredId) {
      getConversation(recoveredId)
        .then((conv) => {
          const conversationProvider = normalizeProvider(conv.provider);
          const normalizedMessages = (conv.messages || []).map((msg) => {
            if (msg.role !== 'assistant') return msg;
            const qa = msg.attemptMeta?.quickActions;
            return {
              ...msg,
              provider: normalizeProvider(msg.provider || conversationProvider),
              ...(Array.isArray(qa) && qa.length > 0 ? { quickActions: qa } : {}),
            };
          });
          setMessages((current) => {
            if (normalizedMessages.length >= current.length) return normalizedMessages;
            return current;
          });
        })
        .catch(() => {
          // If the DB fetch fails, keep the recovered session snapshot.
        });
    }

    initialChatSessionRecovery.recovered = false;
  }, [conversationIdRef, setMessages]);

  return {
    clearChatMessagesSnapshot,
  };
}
