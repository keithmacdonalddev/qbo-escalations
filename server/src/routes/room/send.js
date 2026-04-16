'use strict';

const { randomUUID } = require('crypto');
const express = require('express');
const { getRoom, pushRoomMessage, captureRoomMemory } = require('../../services/chat-room-service');
const { normalizeRoomActionGroups } = require('../../services/room-action-groups');
const { parseMentions, startRoomOrchestration } = require('../../services/room-orchestrator');
const { learnFromInteraction, recordAgentActivity, recordAgentToolUsage } = require('../../services/agent-identity-service');
const { emitRoomEvent } = require('../../services/room-realtime-runtime');
const { clearRoomOrchestration, interruptRoomOrchestration, registerRoomOrchestration } = require('../../services/room-orchestration-runtime');
const { normalizeRoomAgentRuntimeSelections } = require('../../services/room-agent-runtime');
const { requireValidId } = require('./middleware');

const router = express.Router();

const HEARTBEAT_MS = 15000;
const SAFETY_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 10;

// Simple in-memory rate limiter per room
const rateBuckets = new Map();

function checkRateLimit(roomId) {
  const now = Date.now();
  let bucket = rateBuckets.get(roomId);
  if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
    bucket = { windowStart: now, count: 0 };
    rateBuckets.set(roomId, bucket);
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT;
}

// Clean stale rate buckets every 5 minutes to prevent memory leak
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS * 2;
  for (const [key, bucket] of rateBuckets) {
    if (bucket.windowStart < cutoff) rateBuckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

router.post('/:id/send', requireValidId, async (req, res) => {
  const roomId = req.params.id;
  const requestId = randomUUID();
  const { message, parsedImageContext, systemInitiated, systemMessage, agentRuntime } = req.body || {};
  const isSystemInitiated = Boolean(systemInitiated);
  const agentRuntimeSelections = normalizeRoomAgentRuntimeSelections(agentRuntime);

  // Validate: at least one of message or parsedImageContext required
  if ((!message || typeof message !== 'string' || !message.trim()) && !parsedImageContext && !isSystemInitiated) {
    return res.status(400).json({
      ok: false,
      code: 'MISSING_CONTENT',
      error: 'Message or image context required',
    });
  }

  // Validate parsedImageContext shape when present
  if (parsedImageContext) {
    if (!parsedImageContext.transcription || typeof parsedImageContext.transcription !== 'string') {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_IMAGE_CONTEXT',
        error: 'parsedImageContext.transcription must be a non-empty string',
      });
    }
  }

  if (message && message.length > 50000) {
    return res.status(400).json({
      ok: false,
      code: 'MESSAGE_TOO_LONG',
      error: 'Message must be under 50,000 characters',
    });
  }

  // Rate limit
  if (!checkRateLimit(roomId)) {
    return res.status(429).json({
      ok: false,
      code: 'RATE_LIMITED',
      error: 'Too many messages. Please wait before sending again.',
    });
  }

  // Load room
  let room;
  try {
    room = await getRoom(roomId);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({
      ok: false,
      code: err.code || 'NOT_FOUND',
      error: err.message || 'Room not found',
    });
  }

  // Derive message content — use placeholder for image-only sends
  const messageContent = isSystemInitiated
    ? (String(systemMessage || '').trim() || 'Keep the room alive naturally for one more beat. Each agent must speak only for itself and must not script another agent\'s reply.')
    : ((message && message.trim()) || '(image attached)');

  // Parse @mentions from message
  const mentions = parseMentions(messageContent);

  // Save user message
  try {
    if (!isSystemInitiated) {
      const userMsg = {
        role: 'user',
        content: messageContent,
        mentions,
        timestamp: new Date(),
        ...(parsedImageContext ? { parsedImageContext } : {}),
      };

      room = await pushRoomMessage(roomId, userMsg);
      room.memory = await captureRoomMemory(roomId, userMsg);
      emitRoomEvent(roomId, 'message-posted', {
        roomId,
        message: userMsg,
        actor: 'user',
      });
      await learnFromInteraction(userMsg, { surface: 'rooms', roomId });
      await Promise.all((room.agents || []).map((agent) => recordAgentActivity(agent.id, {
        type: 'message',
        phase: 'user-input',
        status: 'received',
        summary: 'Room received a new user message.',
        detail: messageContent,
        metadata: {
          mentions,
          hasImageContext: Boolean(parsedImageContext),
        },
      }, { surface: 'rooms', roomId })));
    } else {
      emitRoomEvent(roomId, 'room-autonomy', {
        roomId,
        requestId,
        message: messageContent,
      });
      await Promise.all((room.activeAgents || []).map((agentId) => recordAgentActivity(agentId, {
        type: 'status',
        phase: 'autonomy',
        status: 'info',
        summary: 'Room triggered an autonomous continuation turn.',
        detail: messageContent,
      }, { surface: 'rooms', roomId })));
    }
  } catch (err) {
    return res.status(500).json({
      ok: false,
      code: 'SAVE_FAILED',
      error: 'Failed to save user message',
    });
  }

  // --- SSE setup ---
  // Pattern from routes/chat/send.js lines 321-328
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let streamSettled = false;
  let cleanupFn = null;
  let settledReason = null;

  function finishStream(reason = 'completed') {
    if (streamSettled) return false;
    streamSettled = true;
    settledReason = reason;
    clearInterval(heartbeat);
    clearTimeout(safetyTimeout);
    clearRoomOrchestration(roomId, requestId);
    return true;
  }

  function interruptCurrentStream(payload = {}) {
    const reason = payload.reason || 'superseded';
    if (!finishStream(reason)) return;

    if (cleanupFn) {
      try { cleanupFn(); } catch { /* ignore */ }
    }

    emitRoomEvent(roomId, 'room-interrupt', {
      roomId,
      requestId,
      reason,
      supersededByRequestId: payload.supersededByRequestId || null,
      actor: payload.actor || 'system',
    });

    try {
      res.write('event: error\ndata: ' + JSON.stringify({
        error: 'This room updated while agents were responding. Restarting with fresher context.',
        code: 'ROOM_INTERRUPTED',
        reason,
        roomId,
        requestId,
        supersededByRequestId: payload.supersededByRequestId || null,
      }) + '\n\n');
      res.end();
    } catch { /* client gone */ }
  }

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* client gone */ }
  }, HEARTBEAT_MS);

  // Safety timeout — force-close hung streams
  const safetyTimeout = setTimeout(() => {
    if (!finishStream('timeout')) return;
    console.error('[room/send] SSE safety timeout hit after %dms — force-closing', SAFETY_TIMEOUT_MS);
    try {
      res.write('event: error\ndata: ' + JSON.stringify({
        error: 'Request timed out — please try again',
        code: 'SSE_STREAM_TIMEOUT',
      }) + '\n\n');
      res.end();
    } catch { /* client gone */ }
    if (cleanupFn) {
      try { cleanupFn(); } catch { /* ignore */ }
    }
  }, SAFETY_TIMEOUT_MS);

  interruptRoomOrchestration(roomId, 'superseded-by-new-message', {
    supersededByRequestId: requestId,
    actor: 'user',
  });

  // Start orchestration
  cleanupFn = startRoomOrchestration({
    room,
    userMessage: messageContent,
    mentions,
    parsedImageContext,
    agentRuntimeSelections,

    onRoomStart: (data) => {
      if (isSystemInitiated) {
        emitRoomEvent(roomId, 'agent-status', {
          type: 'autonomous-room-turn',
          phase: 'autonomy',
          message: 'The room picked the conversation back up on its own.',
        });
      }
      emitRoomEvent(roomId, 'room-start', data);
      try {
        res.write('event: room_start\ndata: ' + JSON.stringify(data) + '\n\n');
      } catch { /* client gone */ }
    },

    onAgentStart: (data) => {
      emitRoomEvent(roomId, 'agent-start', data);
      recordAgentActivity(data.agentId, {
        type: 'lifecycle',
        phase: 'start',
        status: 'running',
        summary: `${data.agentName || data.agentId} started responding in this room.`,
        detail: data,
      }, { surface: 'rooms', roomId }).catch(() => {});
      try {
        res.write('event: agent_start\ndata: ' + JSON.stringify(data) + '\n\n');
      } catch { /* client gone */ }
    },

    onChunk: (data) => {
      emitRoomEvent(roomId, 'agent-chunk', data);
      try {
        res.write('event: chunk\ndata: ' + JSON.stringify(data) + '\n\n');
      } catch { /* client gone */ }
    },

    onThinkingChunk: (data) => {
      emitRoomEvent(roomId, 'agent-thinking', data);
      try {
        res.write('event: thinking\ndata: ' + JSON.stringify(data) + '\n\n');
      } catch { /* client gone */ }
    },

    onActions: (data) => {
      emitRoomEvent(roomId, 'agent-actions', data);
      // Workspace agent action results: { agentId, results, iteration }
      recordAgentActivity(data.agentId, {
        type: 'tool',
        phase: 'actions',
        status: 'ok',
        summary: `${data.agentId} completed ${Array.isArray(data.results) ? data.results.length : 0} room tool action(s).`,
        detail: data,
        metadata: {
          iteration: data.iteration || null,
        },
      }, { surface: 'rooms', roomId }).catch(() => {});
      try {
        res.write('event: actions\ndata: ' + JSON.stringify(data) + '\n\n');
      } catch { /* client gone */ }
    },

    onStatus: (data) => {
      emitRoomEvent(roomId, 'agent-status', data);
      // Workspace agent status updates: { agentId, type, message, phase, ... }
      if (data?.agentId) {
        recordAgentActivity(data.agentId, {
          type: 'status',
          phase: data.phase || data.type || 'status',
          status: data.type || 'info',
          summary: data.message || `${data.agentId} emitted a room status update.`,
          detail: data,
        }, { surface: 'rooms', roomId }).catch(() => {});
      }
      try {
        res.write('event: status\ndata: ' + JSON.stringify(data) + '\n\n');
      } catch { /* client gone */ }
    },

    onAgentDone: async (data) => {
      const normalizedActions = normalizeRoomActionGroups(data.actions, data.iterations);
      // Persist agent response to room
      const agentMsg = {
        role: 'assistant',
        content: data.fullResponse || '',
        thinking: data.thinking || '',
        agentId: data.agentId,
        agentName: data.agentName,
        provider: data.provider,
        usage: data.usage ? {
          inputTokens: data.usage.inputTokens || 0,
          outputTokens: data.usage.outputTokens || 0,
          totalTokens: (data.usage.inputTokens || 0) + (data.usage.outputTokens || 0),
          model: data.usage.model || '',
          totalCostMicros: data.usage.totalCostMicros || 0,
          usageAvailable: true,
        } : undefined,
        actions: normalizedActions.length > 0 ? normalizedActions : undefined,
        iterations: data.iterations || normalizedActions.length || undefined,
        timestamp: new Date(),
      };

      try {
        await pushRoomMessage(roomId, agentMsg);
        await captureRoomMemory(roomId, agentMsg);
        emitRoomEvent(roomId, 'message-posted', {
          roomId,
          message: agentMsg,
          actor: 'agent',
        });
        await learnFromInteraction(agentMsg, { surface: 'rooms', roomId });
        await recordAgentActivity(data.agentId, {
          type: 'response',
          phase: 'done',
          status: 'ok',
          summary: `${data.agentName || data.agentId} finished a room response.`,
          detail: {
            content: data.fullResponse || '',
            thinking: data.thinking || '',
            latencyMs: data.latencyMs || 0,
            iterations: data.iterations || normalizedActions.length || 0,
            usage: data.usage || null,
          },
        }, { surface: 'rooms', roomId });
        if (normalizedActions.length > 0 && data.agentId) {
          await recordAgentToolUsage(data.agentId, normalizedActions, { surface: 'rooms', roomId });
        }
      } catch (saveErr) {
        console.warn('[room/send] Failed to save agent message for %s: %s', data.agentId, saveErr.message);
      }

      try {
        emitRoomEvent(roomId, 'agent-done', {
          agentId: data.agentId,
          agentName: data.agentName,
          fullResponse: data.fullResponse,
          provider: data.provider,
          latencyMs: data.latencyMs,
        });
        res.write('event: agent_done\ndata: ' + JSON.stringify({
          agentId: data.agentId,
          agentName: data.agentName,
          fullResponse: data.fullResponse,
          thinking: data.thinking || '',
          usage: data.usage,
          provider: data.provider,
          latencyMs: data.latencyMs,
          citations: data.citations || [],
          actions: normalizedActions.length > 0 ? normalizedActions : undefined,
          iterations: data.iterations || normalizedActions.length || undefined,
        }) + '\n\n');
      } catch { /* client gone */ }
    },

    onAgentError: (data) => {
      emitRoomEvent(roomId, 'agent-error', data);
      if (data?.agentId) {
        recordAgentActivity(data.agentId, {
          type: 'error',
          phase: 'agent-error',
          status: 'error',
          summary: data.message || `${data.agentId} hit an error in the room.`,
          detail: data,
        }, { surface: 'rooms', roomId }).catch(() => {});
      }
      try {
        res.write('event: agent_error\ndata: ' + JSON.stringify(data) + '\n\n');
      } catch { /* client gone */ }
    },

    onRoomDone: (data) => {
      if (!finishStream('done')) return;
      try {
        emitRoomEvent(roomId, 'room-done', data);
        res.write('event: room_done\ndata: ' + JSON.stringify(data) + '\n\n');
        res.end();
      } catch { /* client gone */ }
    },

    onError: (err) => {
      if (!finishStream(err?.code === 'ROOM_INTERRUPTED' ? 'interrupted' : 'error')) return;
      try {
        res.write('event: error\ndata: ' + JSON.stringify({
          error: err.message || 'Room orchestration failed',
          code: err.code || 'ORCHESTRATION_FAILED',
        }) + '\n\n');
        res.end();
      } catch { /* client gone */ }
    },
  });

  registerRoomOrchestration(roomId, requestId, ({ reason, supersededByRequestId, actor }) => {
    interruptCurrentStream({
      reason,
      supersededByRequestId: supersededByRequestId || null,
      actor: actor || 'system',
    });
  });

  // Clean up on client disconnect.
  // NOTE: must use res.on('close'), NOT req.on('close'). See send.js line 1110-1116.
  res.on('close', () => {
    clearRoomOrchestration(roomId, requestId);
    clearInterval(heartbeat);
    clearTimeout(safetyTimeout);
    if (!streamSettled) {
      streamSettled = true;
      settledReason = settledReason || 'client-disconnect';
      if (cleanupFn) {
        try { cleanupFn(); } catch { /* ignore */ }
      }
    }
  });
});

module.exports = router;
