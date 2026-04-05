import { useState, useCallback, useRef, useEffect } from 'react';
import { listAvailableAgents, getRoom, listRooms, createRoom, deleteRoom } from '../api/roomApi.js';
import { getSharedRealtimeClient } from '../api/realtime.js';
import { normalizeRoomActionGroups, normalizeRoomMessage } from '../lib/roomActionGroups.js';
import { normalizeError } from '../utils/normalizeError.js';

const ERROR_AUTO_CLEAR_MS = 8000;

/**
 * Manages chat room state: room data, messages, agents, CRUD, and
 * optimistic message helpers for streaming.
 *
 * @param {string|null} roomId - Current room ID, or null for the room list view.
 */
export default function useChatRoom(roomId) {
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [agents, setAgents] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setErrorState] = useState(null);
  const [agentErrors, setAgentErrors] = useState({});
  const [lastInterrupt, setLastInterrupt] = useState(null);
  const [roomEvents, setRoomEvents] = useState([]);
  const [agentPresence, setAgentPresence] = useState({});

  const agentsCacheRef = useRef(null);
  const chunkBufferRef = useRef({});
  const thinkingBufferRef = useRef({});
  const rafIdRef = useRef(0);
  const errorTimerRef = useRef(null);
  const refreshTimerRef = useRef(null);
  const messagesRef = useRef([]);

  const appendRoomEvent = useCallback((event) => {
    if (!event?.type) return;
    setRoomEvents((prev) => [event, ...prev].slice(0, 30));
  }, []);

  // ---- Error helpers ----------------------------------------------------------

  const setError = useCallback((msg) => {
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    const normalized = msg ? (typeof msg === 'string' ? msg : normalizeError(msg).message) : null;
    setErrorState(normalized);
    if (normalized) {
      errorTimerRef.current = setTimeout(() => {
        setErrorState(null);
        errorTimerRef.current = null;
      }, ERROR_AUTO_CLEAR_MS);
    }
  }, []);

  const clearError = useCallback(() => {
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    setErrorState(null);
  }, []);

  // ---- Fetch agents once (cache in ref) --------------------------------------

  useEffect(() => {
    let cancelled = false;
    if (agentsCacheRef.current) {
      setAgents(agentsCacheRef.current);
      return;
    }
    (async () => {
      try {
        const list = await listAvailableAgents();
        if (!cancelled) {
          agentsCacheRef.current = list;
          setAgents(list);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Fetch room or room list when roomId changes ---------------------------

  useEffect(() => {
    let cancelled = false;

    // Clear stale state immediately on any roomId change to prevent
    // previous room content from flashing during navigation.
    setRoom(null);
    setMessages([]);
    setErrorState(null);
    setAgentErrors({});
    setLastInterrupt(null);
    setRoomEvents([]);
    setAgentPresence({});

    if (!roomId) {
      // No room selected — show list view
      setLoading(true);
      (async () => {
        try {
          const list = await listRooms();
          if (!cancelled) setRooms(list);
        } catch (err) {
          if (!cancelled) setError(err);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }

    // Room selected — fetch it
    setLoading(true);
    setRooms([]);
    (async () => {
      try {
        const fetched = await getRoom(roomId);
        if (!cancelled) {
          setRoom(fetched);
          setMessages((fetched.messages || []).map(normalizeRoomMessage));
          const nextPresence = {};
          for (const msg of fetched.messages || []) {
            if (msg?.role === 'assistant' && msg?.agentId) {
              nextPresence[msg.agentId] = {
                state: 'idle',
                lastActiveAt: msg.timestamp || msg.createdAt || new Date().toISOString(),
                note: 'Recently spoke',
              };
            }
          }
          setAgentPresence(nextPresence);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Cleanup RAF + error timer on unmount ----------------------------------

  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // ---- Derived: activeAgents (full agent objects for room.activeAgents) -------

  const activeAgents = room && agents.length > 0
    ? (room.activeAgents || [])
        .map((id) => agents.find((a) => a.id === id || a._id === id))
        .filter(Boolean)
    : [];

  // ---- CRUD operations -------------------------------------------------------

  const createNewRoom = useCallback(async (title, agentIds, settings) => {
    try {
      const newRoom = await createRoom({ title, activeAgents: agentIds, settings });
      window.location.hash = '#/rooms/' + newRoom._id;
      return newRoom;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [setError]);

  const deleteExistingRoom = useCallback(async (id) => {
    try {
      await deleteRoom(id);
      setRooms((prev) => prev.filter((r) => r._id !== id));
      if (room && room._id === id) {
        setRoom(null);
        setMessages([]);
        window.location.hash = '#/rooms';
      }
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [room, setError]);

  // ---- Message helpers (optimistic add, streaming chunk, finalize) -----------

  const appendUserMessage = useCallback((content, mentions) => {
    const msg = {
      role: 'user',
      content,
      mentions: mentions || [],
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, msg]);
  }, []);

  /**
   * Single RAF flush that drains BOTH content and thinking buffers in the
   * same frame. This eliminates the race where one buffer schedules RAF
   * first and the other's data sits unflushed until the next event.
   */
  const flushBuffers = useCallback(() => {
    const chunks = chunkBufferRef.current;
    const thinkingChunks = thinkingBufferRef.current;
    const hasChunks = Object.keys(chunks).length > 0;
    const hasThinking = Object.keys(thinkingChunks).length > 0;

    if (!hasChunks && !hasThinking) return;

    // Clear buffers before the state update so new events arriving during
    // the React commit can start filling fresh buffers.
    if (hasChunks) chunkBufferRef.current = {};
    if (hasThinking) thinkingBufferRef.current = {};

    setMessages((prev) => {
      const next = [...prev];

      // --- Flush content chunks ---
      if (hasChunks) {
        for (const [aid, accumulated] of Object.entries(chunks)) {
          let idx = -1;
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].agentId === aid && next[i]._streaming) {
              idx = i;
              break;
            }
          }
          if (idx >= 0) {
            if (accumulated) {
              next[idx] = {
                ...next[idx],
                content: (next[idx].content || '') + accumulated,
              };
            }
          } else {
            // No in-progress message found — create a placeholder
            next.push({
              role: 'assistant',
              agentId: aid,
              content: accumulated,
              _streaming: true,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      // --- Flush thinking chunks ---
      if (hasThinking) {
        for (const [aid, accumulated] of Object.entries(thinkingChunks)) {
          let idx = -1;
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].agentId === aid && next[i]._streaming) {
              idx = i;
              break;
            }
          }
          if (idx >= 0 && accumulated) {
            next[idx] = {
              ...next[idx],
              thinking: (next[idx].thinking || '') + accumulated,
            };
          }
        }
      }

      return next;
    });
  }, []);

  /**
   * Schedule a RAF flush if one isn't already pending. Used by both
   * appendAgentChunk and appendAgentThinking so all buffered data
   * (content + thinking) is flushed together in one frame.
   */
  const scheduleFlush = useCallback(() => {
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(() => {
        // Clear the ref BEFORE flushing so that events arriving during
        // the flush can schedule a new frame.
        rafIdRef.current = 0;
        flushBuffers();
      });
    }
  }, [flushBuffers]);

  /**
   * RAF-batched chunk accumulation. Deltas are buffered in a ref and flushed
   * to React state once per animation frame to avoid excessive re-renders
   * during high-frequency SSE chunk events.
   */
  const appendAgentChunk = useCallback((agentId, delta) => {
    if (!agentId) return;

    // Buffer the delta (empty string is valid — creates the placeholder)
    if (!chunkBufferRef.current[agentId]) {
      chunkBufferRef.current[agentId] = '';
    }
    if (delta) chunkBufferRef.current[agentId] += delta;

    scheduleFlush();
  }, [scheduleFlush]);

  /**
   * RAF-batched thinking-text accumulation. Thinking deltas are buffered
   * separately from content chunks and flushed to the `thinking` field
   * of the streaming message so the UI can render them distinctly.
   */
  const appendAgentThinking = useCallback((agentId, thinkingDelta) => {
    if (!agentId || !thinkingDelta) return;

    if (!thinkingBufferRef.current[agentId]) {
      thinkingBufferRef.current[agentId] = '';
    }
    thinkingBufferRef.current[agentId] += thinkingDelta;

    scheduleFlush();
  }, [scheduleFlush]);

  /**
   * Record a per-agent error. Does not affect global error state --
   * the stream continues for other agents.
   */
  const setAgentError = useCallback((agentId, errorMsg) => {
    if (!agentId) return;
    setAgentErrors((prev) => ({ ...prev, [agentId]: errorMsg }));
  }, []);

  /**
   * Append action results to the current streaming message for an agent.
   * Each call adds a new action group ({ results, iteration }) to the
   * message's _actions array so the UI can display them progressively.
   */
  const appendAgentActions = useCallback((agentId, results, iteration) => {
    if (!agentId) return;
    const [nextGroup] = normalizeRoomActionGroups([{ results, iteration }], iteration);
    if (!nextGroup) return;
    setMessages((prev) => prev.map((msg) => {
      if (msg.agentId === agentId && msg._streaming) {
        const existingActions = msg._actions || [];
        return { ...msg, _actions: [...existingActions, nextGroup] };
      }
      return msg;
    }));
  }, []);

  /**
   * Set status text for a streaming agent. The status object is stored
   * on the message's _status field and rendered as an ephemeral indicator
   * below the message content while streaming.
   */
  const setAgentStatus = useCallback((agentId, statusData) => {
    if (!agentId) return;
    setMessages((prev) => prev.map((msg) => {
      if (msg.agentId === agentId && msg._streaming) {
        return { ...msg, _status: statusData };
      }
      return msg;
    }));
  }, []);

  const finalizeAgentMessage = useCallback((agentId, fullData) => {
    setMessages((prev) => {
      const next = [...prev];
      let idx = -1;
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].agentId === agentId && next[i]._streaming) {
          idx = i;
          break;
        }
      }
      // Preserve actions accumulated during streaming, or use server-provided ones
      const streamingActions = idx >= 0 ? next[idx]._actions : undefined;
      const normalizedFinalActions = normalizeRoomActionGroups(
        fullData.actions,
        fullData.iterations || (streamingActions ? streamingActions.length : 1)
      );
      const finalMsg = {
        role: 'assistant',
        agentId: fullData.agentId || agentId,
        agentName: fullData.agentName || '',
        content: fullData.fullResponse || '',
        thinking: fullData.thinking || '',
        usage: fullData.usage || null,
        provider: fullData.provider || '',
        latencyMs: fullData.latencyMs || 0,
        citations: fullData.citations || [],
        actions: normalizedFinalActions.length > 0 ? normalizedFinalActions : (streamingActions || undefined),
        iterations: fullData.iterations || normalizedFinalActions.length || streamingActions?.length || undefined,
        timestamp: new Date().toISOString(),
      };
      if (idx >= 0) {
        next[idx] = finalMsg;
      } else {
        next.push(finalMsg);
      }
      return next;
    });
  }, []);

  // ---- Refresh current room --------------------------------------------------

  const refreshRoom = useCallback(async () => {
    if (!roomId) {
      // No room selected — re-fetch the room list
      setLoading(true);
      try {
        const list = await listRooms();
        setRooms(list);
        setErrorState(null);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
      return;
    }
    try {
      const fetched = await getRoom(roomId);
      setRoom(fetched);
      setMessages((fetched.messages || []).map(normalizeRoomMessage));
    } catch (err) {
      setError(err);
    }
  }, [roomId, setError]);

  const scheduleRealtimeRefresh = useCallback((delayMs = 120) => {
    if (!roomId) return;
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(async () => {
      refreshTimerRef.current = null;
      try {
        const fetched = await getRoom(roomId);
        setRoom(fetched);
        setMessages((fetched.messages || []).map(normalizeRoomMessage));
      } catch (err) {
        setError(err);
      }
    }, delayMs);
  }, [roomId, setError]);

  useEffect(() => {
    if (!roomId) return undefined;

    const realtime = getSharedRealtimeClient();
    const unsubscribe = realtime.subscribe({
      channel: 'room',
      key: roomId,
      params: { since: 0 },
      onEvent(eventType, data) {
        if (eventType === 'snapshot') {
          setRoom((current) => current ? {
            ...current,
            ...data,
          } : current);
          return;
        }

        if (eventType === 'room-start') {
          const startedAt = Date.now();
          const invitedAgents = Array.isArray(data?.agents) ? data.agents : [];
          setAgentPresence((prev) => {
            const next = { ...prev };
            for (const agent of invitedAgents) {
              if (!agent?.id) continue;
              next[agent.id] = {
                ...(next[agent.id] || {}),
                state: 'invited',
                lastActiveAt: new Date(startedAt).toISOString(),
                note: 'Pulled into the current turn',
              };
            }
            return next;
          });
          appendRoomEvent({
            id: `room-start-${Date.now()}`,
            type: 'room-start',
            title: 'Room turn started',
            detail: invitedAgents.length > 0
              ? `${invitedAgents.map((agent) => agent.shortName || agent.name || agent.id).join(', ')} joined this turn.`
              : 'A new room turn started.',
            at: startedAt,
          });
          return;
        }

        if (eventType === 'agent-start') {
          setAgentPresence((prev) => ({
            ...prev,
            [data.agentId]: {
              ...(prev[data.agentId] || {}),
              state: 'responding',
              lastActiveAt: new Date().toISOString(),
              note: 'Responding now',
            },
          }));
          appendRoomEvent({
            id: `agent-start-${data.agentId}-${Date.now()}`,
            type: 'agent-start',
            agentId: data.agentId,
            title: `${data.agentName || data.agentId} joined in`,
            detail: 'Started responding.',
            at: Date.now(),
          });
          return;
        }

        if (eventType === 'message-posted') {
          if (data?.actor === 'agent' && data?.message?.agentId) {
            setAgentPresence((prev) => ({
              ...prev,
              [data.message.agentId]: {
                ...(prev[data.message.agentId] || {}),
                state: 'idle',
                lastActiveAt: data.message.timestamp || new Date().toISOString(),
                note: 'Recently spoke',
              },
            }));
          }
          const hasStreamingMessages = messagesRef.current.some((msg) => msg?._streaming);
          if (!hasStreamingMessages) {
            scheduleRealtimeRefresh(60);
          }
          return;
        }

        if (eventType === 'room-autonomy') {
          appendRoomEvent({
            id: `room-autonomy-${Date.now()}`,
            type: 'room-autonomy',
            title: 'Room kept itself going',
            detail: 'The room started an autonomous follow-up beat on its own.',
            at: Date.now(),
          });
          return;
        }

        if (eventType === 'agent-status' && !data?.agentId && data?.type === 'autonomous-room-turn') {
          appendRoomEvent({
            id: `status-room-${Date.now()}`,
            type: data.type,
            title: 'Room autonomy engaged',
            detail: data.message || 'The room picked the conversation back up on its own.',
            at: Date.now(),
          });
          return;
        }

        if (eventType === 'agent-status' && data?.agentId) {
          setAgentPresence((prev) => ({
            ...prev,
            [data.agentId]: {
              ...(prev[data.agentId] || {}),
              state: data.type === 'social_nudge' ? 'social' : 'thinking',
              lastActiveAt: new Date().toISOString(),
              note: data.message || 'Active in the room',
            },
          }));

          if (data.type === 'social_nudge' || data.type === 'tool_loop' || data.type === 'tool_ready' || data.type === 'autonomous-room-turn') {
            appendRoomEvent({
              id: `status-${data.agentId || 'room'}-${Date.now()}`,
              type: data.type || 'status',
              agentId: data.agentId || null,
              title: data.agentId ? `${data.agentId} update` : 'Room update',
              detail: data.message || 'Status update',
              at: Date.now(),
            });
          }
          return;
        }

        if (eventType === 'agent-actions' && data?.agentId) {
          const count = Array.isArray(data.results) ? data.results.length : 0;
          setAgentPresence((prev) => ({
            ...prev,
            [data.agentId]: {
              ...(prev[data.agentId] || {}),
              state: 'using-tools',
              lastActiveAt: new Date().toISOString(),
              note: `Used ${count} tool${count === 1 ? '' : 's'}`,
            },
          }));
          appendRoomEvent({
            id: `actions-${data.agentId}-${Date.now()}`,
            type: 'agent-actions',
            agentId: data.agentId,
            title: `${data.agentId} used tools`,
            detail: count > 0 ? `${count} tool action${count === 1 ? '' : 's'} executed.` : 'Tool activity recorded.',
            at: Date.now(),
          });
          return;
        }

        if (eventType === 'agent-done' && data?.agentId) {
          setAgentPresence((prev) => ({
            ...prev,
            [data.agentId]: {
              ...(prev[data.agentId] || {}),
              state: 'idle',
              lastActiveAt: new Date().toISOString(),
              note: 'Finished their turn',
            },
          }));
          appendRoomEvent({
            id: `done-${data.agentId}-${Date.now()}`,
            type: 'agent-done',
            agentId: data.agentId,
            title: `${data.agentName || data.agentId} wrapped up`,
            detail: data.latencyMs ? `Finished in ${Math.round(data.latencyMs)}ms.` : 'Finished their turn.',
            at: Date.now(),
          });
          return;
        }

        if (eventType === 'agent-error' && data?.agentId) {
          setAgentPresence((prev) => ({
            ...prev,
            [data.agentId]: {
              ...(prev[data.agentId] || {}),
              state: 'error',
              lastActiveAt: new Date().toISOString(),
              note: data.error || 'Hit an error',
            },
          }));
          appendRoomEvent({
            id: `error-${data.agentId}-${Date.now()}`,
            type: 'agent-error',
            agentId: data.agentId,
            title: `${data.agentName || data.agentId} hit a snag`,
            detail: data.error || 'Agent error',
            at: Date.now(),
          });
          return;
        }

        if (eventType === 'room-done') {
          setAgentPresence((prev) => {
            const next = { ...prev };
            for (const [agentId, value] of Object.entries(next)) {
              next[agentId] = {
                ...value,
                state: value?.state === 'error' ? 'error' : 'idle',
              };
            }
            return next;
          });
          appendRoomEvent({
            id: `room-done-${Date.now()}`,
            type: 'room-done',
            title: 'Room turn complete',
            detail: 'The room settled for a moment.',
            at: Date.now(),
          });
          scheduleRealtimeRefresh(40);
          return;
        }

        if (eventType === 'room-interrupt') {
          setLastInterrupt({
            at: Date.now(),
            ...data,
          });
          appendRoomEvent({
            id: `room-interrupt-${Date.now()}`,
            type: 'room-interrupt',
            title: 'Room turn superseded',
            detail: 'A fresher message interrupted the previous turn.',
            at: Date.now(),
          });
          scheduleRealtimeRefresh(20);
        }
      },
    });

    return () => {
      unsubscribe?.();
    };
  }, [roomId, scheduleRealtimeRefresh]);

  return {
    room,
    messages,
    agents,
    activeAgents,
    loading,
    error,
    rooms,
    createNewRoom,
    deleteExistingRoom,
    appendUserMessage,
    appendAgentChunk,
    appendAgentThinking,
    appendAgentActions,
    setAgentStatus,
    finalizeAgentMessage,
    setError,
    setAgentError,
    agentErrors,
    roomEvents,
    agentPresence,
    lastInterrupt,
    clearError,
    refreshRoom,
  };
}
