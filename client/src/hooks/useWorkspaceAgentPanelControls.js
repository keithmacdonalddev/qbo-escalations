import { useCallback, useEffect, useRef, useState } from 'react';

const HISTORY_LIMIT = 30;
const AUTO_BRIEFING_KEY = 'qbo-workspace-last-briefing-ts';
const AUTO_BRIEFING_DEBOUNCE_MS = 60_000;
const AUTO_BRIEFING_DELAY_MS = 300;

export default function useWorkspaceAgentPanelControls({
  open,
  workspaceSessionId,
  conversationRestored,
  messagesLength = 0,
  streaming = false,
  loadConversation,
  startNewConversation,
  startWorkspaceRequest,
} = {}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const prevOpenRef = useRef(false);
  const autoBriefingSentRef = useRef(false);

  const fetchConversationHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/workspace/conversations?limit=${HISTORY_LIMIT}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok && Array.isArray(data.conversations)) {
        setHistoryItems(data.conversations);
      }
    } catch {
      // silent
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const toggleHistory = useCallback(() => {
    setHistoryOpen((prev) => {
      const next = !prev;
      if (next) fetchConversationHistory();
      return next;
    });
  }, [fetchConversationHistory]);

  const handleLoadConversation = useCallback((sessionId) => {
    loadConversation(sessionId);
    setHistoryOpen(false);
  }, [loadConversation]);

  const handleStartNewConversation = useCallback(() => {
    startNewConversation();
    setHistoryOpen(false);
  }, [startNewConversation]);

  useEffect(() => {
    const restorationPending = workspaceSessionId && !conversationRestored;
    if (open && !prevOpenRef.current && messagesLength === 0 && !streaming && !restorationPending && !autoBriefingSentRef.current) {
      try {
        const lastBriefingTs = Number(window.localStorage.getItem(AUTO_BRIEFING_KEY) || 0);
        if (lastBriefingTs && (Date.now() - lastBriefingTs) < AUTO_BRIEFING_DEBOUNCE_MS) {
          autoBriefingSentRef.current = true;
          prevOpenRef.current = open;
          return;
        }
      } catch {
        // ignore
      }

      autoBriefingSentRef.current = true;
      try {
        window.localStorage.setItem(AUTO_BRIEFING_KEY, String(Date.now()));
      } catch {
        // ignore
      }

      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
      window.setTimeout(() => startWorkspaceRequest(`${greeting} — brief me on my inbox and calendar.`), AUTO_BRIEFING_DELAY_MS);
    }
    prevOpenRef.current = open;
  }, [open, messagesLength, streaming, workspaceSessionId, conversationRestored, startWorkspaceRequest]);

  return {
    historyOpen,
    historyItems,
    historyLoading,
    toggleHistory,
    handleLoadConversation,
    handleStartNewConversation,
  };
}
