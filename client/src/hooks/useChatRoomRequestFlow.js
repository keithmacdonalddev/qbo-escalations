import { useState, useCallback, useRef, useEffect } from 'react';
import { sendRoomMessage } from '../api/roomApi.js';
import { readRoomAgentRuntimeSelections } from '../lib/roomAgentRuntime.js';

/**
 * Orchestrates sending a message to a chat room and wiring the SSE stream
 * events into the room state managed by useChatRoom.
 *
 * @param {string|null} roomId
 * @param {object} roomState - Return value of useChatRoom.
 */
export default function useChatRoomRequestFlow(roomId, roomState) {
  const [streaming, setStreaming] = useState(false);
  const [streamingAgents, setStreamingAgents] = useState(() => new Set());

  const abortRef = useRef(null);
  const streamingRef = useRef(false);
  const streamingAgentsRef = useRef(new Set());
  const autoContinueTimerRef = useRef(null);
  const autoContinueCountRef = useRef(0);
  const sendMessageRef = useRef(null);

  // Keep a ref to roomState so SSE callbacks always see the latest methods
  // without forcing sendMessage to be recreated on every render.
  const roomStateRef = useRef(roomState);
  roomStateRef.current = roomState;

  // ---- Cleanup on unmount or roomId change -----------------------------------

  useEffect(() => {
    return () => {
      abortRef.current?.();
      abortRef.current = null;
      streamingRef.current = false;
      streamingAgentsRef.current = new Set();
      if (autoContinueTimerRef.current) {
        clearTimeout(autoContinueTimerRef.current);
        autoContinueTimerRef.current = null;
      }
    };
  }, [roomId]);

  useEffect(() => {
    const interrupt = roomState.lastInterrupt;
    if (!interrupt || !streamingRef.current) return;

    abortRef.current?.();
    abortRef.current = null;
    streamingRef.current = false;
    streamingAgentsRef.current = new Set();
    setStreaming(false);
    setStreamingAgents(new Set());
    roomStateRef.current.setError('Room updated while agents were responding. Reloaded with fresher context.');
    roomStateRef.current.refreshRoom();
  }, [roomId, roomState.lastInterrupt]);

  const scheduleAutoContinue = useCallback(() => {
    if (autoContinueTimerRef.current) {
      clearTimeout(autoContinueTimerRef.current);
      autoContinueTimerRef.current = null;
    }
    const room = roomStateRef.current.room;
    const messages = roomStateRef.current.messages || [];
    if (!room || autoContinueCountRef.current >= 2) return;
    if (streamingRef.current) return;

    const lastUserMessages = messages.filter((msg) => msg?.role === 'user').slice(-3);
    const lastAssistantMessages = messages.filter((msg) => msg?.role === 'assistant').slice(-4);
    const invitationText = lastUserMessages.map((msg) => String(msg?.content || '').toLowerCase()).join('\n');
    const roomInvitesAutonomy = [
      /talk amongst yourselves/,
      /converse amongst yourselves/,
      /keep talking/,
      /don't stay quiet/,
      /dont stay quiet/,
      /jump in when it gets interesting/,
      /room is alive/,
      /non-stop/,
    ].some((pattern) => pattern.test(invitationText));

    if (!roomInvitesAutonomy || lastAssistantMessages.length < 2) return;

    autoContinueTimerRef.current = setTimeout(() => {
      autoContinueTimerRef.current = null;
      if (streamingRef.current) return;
      autoContinueCountRef.current += 1;
      sendMessageRef.current?.('', null, {
        systemInitiated: true,
        systemMessage: 'Keep the room alive naturally for one more beat. Continue the current thread with a fresh angle, a disagreement, a joke, or a useful tangent. One or two agents is enough. Do not force all agents to speak. Each agent must speak only for itself and must not script another agent\'s reply.',
      });
    }, 3200);
  }, []);

  // ---- Send message ----------------------------------------------------------

  const sendMessage = useCallback((text, parsedImageContext = null, options = {}) => {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    const systemInitiated = Boolean(options?.systemInitiated);
    const systemMessage = typeof options?.systemMessage === 'string' ? options.systemMessage.trim() : '';
    // At least one of text or parsedImageContext must be present
    if (!trimmed && !parsedImageContext && !systemInitiated) return;
    if (!roomId) return;

    if (autoContinueTimerRef.current) {
      clearTimeout(autoContinueTimerRef.current);
      autoContinueTimerRef.current = null;
    }

    if (!systemInitiated) {
      autoContinueCountRef.current = 0;
    }

    if (streamingRef.current) {
      abortRef.current?.();
      abortRef.current = null;
      streamingRef.current = false;
      streamingAgentsRef.current = new Set();
      setStreaming(false);
      setStreamingAgents(new Set());
    }

    // Extract @mentions from text (if text exists)
    const mentionRegex = /@([a-z0-9-]+)\b/gi;
    const mentions = [];
    if (trimmed) {
      let match;
      while ((match = mentionRegex.exec(trimmed)) !== null) {
        mentions.push(match[1]);
      }
    }

    // Optimistic user message — show placeholder if image-only
    if (!systemInitiated) {
      const displayContent = trimmed || '(image attached)';
      roomStateRef.current.appendUserMessage(displayContent, mentions);
    }

    // Reset streaming state
    streamingRef.current = true;
    streamingAgentsRef.current = new Set();
    setStreaming(true);
    setStreamingAgents(new Set());
    roomStateRef.current.clearError();

    const { abort } = sendRoomMessage(roomId, {
      message: !systemInitiated ? (trimmed || undefined) : undefined,
      parsedImageContext: parsedImageContext || undefined,
      systemInitiated,
      systemMessage: systemInitiated ? (systemMessage || 'Keep the room alive naturally for one more beat.') : undefined,
      agentRuntime: readRoomAgentRuntimeSelections(),
    }, {
      onRoomStart(data) {
        // Stream officially started — participatingAgents available
        streamingRef.current = true;
        setStreaming(true);
      },

      onAgentStart(data) {
        const { agentId, agentName } = data;
        // Track this agent as actively streaming
        streamingAgentsRef.current = new Set([...streamingAgentsRef.current, agentId]);
        setStreamingAgents(new Set(streamingAgentsRef.current));

        // Create a placeholder streaming message for this agent
        roomStateRef.current.appendAgentChunk(agentId, '');
      },

      onChunk(data) {
        const { agentId, text } = data;
        roomStateRef.current.appendAgentChunk(agentId, text);
      },

      onThinking(data) {
        // Thinking chunks accumulate separately from content text.
        // Uses a dedicated thinking track so the UI can render them
        // distinctly (e.g. collapsible reasoning panel).
        const { agentId, thinking } = data;
        if (agentId && thinking) {
          roomStateRef.current.appendAgentThinking(agentId, thinking);
        }
      },

      onActions(data) {
        // data: { agentId, results, iteration }
        // Store action results on the current streaming message for this agent
        const { agentId, results, iteration } = data;
        if (agentId) {
          roomStateRef.current.appendAgentActions(agentId, results, iteration);
        }
      },

      onStatus(data) {
        // data: { agentId, type, message, phase, ... }
        // Update agent status (e.g., "Planning actions...", "Executing Gmail search...")
        const { agentId } = data;
        if (agentId) {
          roomStateRef.current.setAgentStatus(agentId, data);
        }
      },

      onAgentDone(data) {
        const { agentId } = data;
        // Finalize this agent's message with the complete response
        roomStateRef.current.finalizeAgentMessage(agentId, data);

        // Remove from active streaming set
        streamingAgentsRef.current = new Set(
          [...streamingAgentsRef.current].filter((id) => id !== agentId)
        );
        setStreamingAgents(new Set(streamingAgentsRef.current));
      },

      onRoomDone(_data) {
        streamingRef.current = false;
        streamingAgentsRef.current = new Set();
        setStreaming(false);
        setStreamingAgents(new Set());
        abortRef.current = null;

        // Re-fetch the room to get the server-persisted state
        roomStateRef.current.refreshRoom();
        scheduleAutoContinue();
      },

      onAgentError(data) {
        // Non-fatal: one agent failed but the stream continues for others.
        // Remove the failed agent from the active streaming set.
        const failedId = data.agentId;
        if (failedId) {
          streamingAgentsRef.current = new Set(
            [...streamingAgentsRef.current].filter((id) => id !== failedId)
          );
          setStreamingAgents(new Set(streamingAgentsRef.current));
        }
        // Record per-agent error so the UI can show it inline.
        roomStateRef.current.setAgentError(
          failedId,
          data.error || 'Agent failed'
        );
        // Do NOT clear streaming or call setError — other agents are still running.
      },

      onError(err) {
        streamingRef.current = false;
        streamingAgentsRef.current = new Set();
        setStreaming(false);
        setStreamingAgents(new Set());
        abortRef.current = null;

        roomStateRef.current.setError(err?.message || err?.error || 'Room request failed');
      },
    });

    abortRef.current = abort;
  }, [roomId, scheduleAutoContinue]);

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  // ---- Abort -----------------------------------------------------------------

  const abort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    streamingRef.current = false;
    streamingAgentsRef.current = new Set();
    setStreaming(false);
    setStreamingAgents(new Set());
    // Refresh room to reconcile local state with server —
    // removes orphaned _streaming placeholder messages that were
    // never persisted by the server.
    roomStateRef.current.refreshRoom();
  }, []);

  return {
    sendMessage,
    streaming,
    streamingAgents,
    abort,
  };
}
