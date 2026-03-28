import { useCallback, useEffect, useRef, useState } from 'react';
import { exportConversation, forkConversation, getConversationMeta } from '../../api/chatApi.js';
import {
  getEscalation,
  transitionEscalation,
} from '../../api/escalationsApi.js';
import { useToast } from '../../hooks/useToast.jsx';
import { getProviderLabel } from '../../utils/markdown.jsx';

export default function useChatConversationState({
  conversationId,
  isStreaming,
  pendingImageParseRef,
  provider,
  appendProcessEvent,
}) {
  const toast = useToast();
  const [exportCopied, setExportCopied] = useState(false);
  const [linkedEscalation, setLinkedEscalation] = useState(null);
  const [forkInfo, setForkInfo] = useState(null);
  const [resolvingEscalation, setResolvingEscalation] = useState(false);
  const [savedEscalationId, setSavedEscalationId] = useState(null);
  const [parseMeta, setParseMeta] = useState(null);
  const exportCopiedTimerRef = useRef(0);

  const resetConversationState = useCallback(() => {
    setExportCopied(false);
    setLinkedEscalation(null);
    setForkInfo(null);
    setResolvingEscalation(false);
    setSavedEscalationId(null);
    setParseMeta(null);
    pendingImageParseRef.current = false;
    if (exportCopiedTimerRef.current) {
      clearTimeout(exportCopiedTimerRef.current);
      exportCopiedTimerRef.current = 0;
    }
  }, [pendingImageParseRef]);

  useEffect(() => {
    return () => {
      if (exportCopiedTimerRef.current) {
        clearTimeout(exportCopiedTimerRef.current);
        exportCopiedTimerRef.current = 0;
      }
    };
  }, []);

  useEffect(() => {
    resetConversationState();
  }, [conversationId, resetConversationState]);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;

    (async () => {
      try {
        const conv = await getConversationMeta(conversationId);
        if (cancelled) return;

        if (conv.forkedFrom) {
          setForkInfo({ forkedFrom: conv.forkedFrom, forkMessageIndex: conv.forkMessageIndex });
        } else {
          setForkInfo(null);
        }

        if (conv.escalationId) {
          const esc = await getEscalation(conv.escalationId);
          if (!cancelled) {
            setLinkedEscalation(esc);
            setSavedEscalationId(esc._id || conv.escalationId);
            setParseMeta(esc.parseMeta || null);
          }
        } else {
          setLinkedEscalation(null);
          setParseMeta(null);
        }
      } catch {
        if (!cancelled) {
          setLinkedEscalation(null);
          setForkInfo(null);
          setParseMeta(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, savedEscalationId]);

  useEffect(() => {
    if (isStreaming || !pendingImageParseRef.current || !conversationId || savedEscalationId) return;
    pendingImageParseRef.current = false;

    let cancelled = false;
    (async () => {
      try {
        const conv = await getConversationMeta(conversationId);
        if (cancelled) return;

        if (conv?.escalationId) {
          const esc = await getEscalation(conv.escalationId);
          if (cancelled) return;
          setLinkedEscalation(esc);
          setSavedEscalationId(esc._id || conv.escalationId);
          setParseMeta(esc.parseMeta || null);
          appendProcessEvent({
            level: 'success',
            title: 'Escalation parse available',
            message: `Using the saved image parse from ${getProviderLabel(esc?.parseMeta?.providerUsed || provider)}.`,
            code: 'PARSE_AVAILABLE',
            provider: esc?.parseMeta?.providerUsed || provider,
          });
          return;
        }

        appendProcessEvent({
          level: 'warning',
          title: 'No saved image parse',
          message: 'The image parser did not produce a linked escalation for this image-only turn.',
          code: 'PARSE_NOT_SAVED',
        });
      } catch (err) {
        appendProcessEvent({
          level: 'error',
          title: 'Image parse refresh failed',
          message: err?.message || 'Failed to refresh the saved image parse state.',
          code: err?.code || 'PARSE_REFRESH_FAILED',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isStreaming,
    conversationId,
    savedEscalationId,
    provider,
    appendProcessEvent,
    pendingImageParseRef,
  ]);

  const handleResolveEscalation = useCallback(async () => {
    if (!linkedEscalation || resolvingEscalation) return;
    setResolvingEscalation(true);
    try {
      const updated = await transitionEscalation(linkedEscalation._id, 'resolved');
      setLinkedEscalation(updated);
    } catch {
      toast.error('Failed to resolve escalation');
    } finally {
      setResolvingEscalation(false);
    }
  }, [linkedEscalation, resolvingEscalation, toast]);

  const handleOpenTraceLogs = useCallback(() => {
    if (!conversationId) return;
    window.location.hash = `#/usage?tab=traces&conversationId=${encodeURIComponent(conversationId)}`;
  }, [conversationId]);

  const handleCopyConversation = useCallback(async () => {
    if (!conversationId) return;
    try {
      const text = await exportConversation(conversationId);
      await navigator.clipboard.writeText(text);
      setExportCopied(true);
      if (exportCopiedTimerRef.current) {
        clearTimeout(exportCopiedTimerRef.current);
      }
      exportCopiedTimerRef.current = window.setTimeout(() => {
        setExportCopied(false);
        exportCopiedTimerRef.current = 0;
      }, 2000);
    } catch {
      toast.error('Failed to copy conversation');
    }
  }, [conversationId, toast]);

  const handleFork = useCallback(async (messageIndex) => {
    if (!conversationId) return;
    try {
      const forked = await forkConversation(conversationId, messageIndex);
      window.location.hash = `#/chat/${forked._id}`;
    } catch {
      toast.error('Failed to fork conversation');
    }
  }, [conversationId, toast]);

  return {
    exportCopied,
    linkedEscalation,
    forkInfo,
    resolvingEscalation,
    savedEscalationId,
    parseMeta,
    setParseMeta,
    resetConversationState,
    handleResolveEscalation,
    handleOpenTraceLogs,
    handleCopyConversation,
    handleFork,
  };
}
