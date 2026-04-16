import { apiFetch, apiFetchJson } from './http.js';
import { consumeSSEStream } from './sse.js';
import { normalizeError } from '../utils/normalizeError.js';
const BASE = '/api/rooms';
const STREAM_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Create a new chat room.
 * @param {{ title: string, activeAgents?: string[], settings?: object }} fields
 * @returns {Promise<object>} The created room document.
 */
export async function createRoom({ title, activeAgents, settings }) {
  const data = await apiFetchJson(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, activeAgents, settings }),
  }, 'Failed to create room');
  return data.room;
}

/**
 * List chat rooms with pagination.
 * @param {{ limit?: number, skip?: number }} [options]
 * @returns {Promise<object[]>} Array of room documents.
 */
export async function listRooms({ limit = 50, skip = 0 } = {}) {
  const params = new URLSearchParams({ limit, skip });
  const data = await apiFetchJson(`${BASE}?${params}`, {}, 'Failed to list rooms');
  return data.rooms;
}

/**
 * Get a single room by ID (includes messages).
 * @param {string} roomId
 * @returns {Promise<object>} The room document.
 */
export async function getRoom(roomId) {
  const data = await apiFetchJson(`${BASE}/${roomId}`, {}, 'Room not found');
  return data.room;
}

/**
 * Update room fields (title, activeAgents, settings, etc.).
 * @param {string} roomId
 * @param {object} updates
 * @returns {Promise<object>} The updated room document.
 */
export async function updateRoom(roomId, updates) {
  const data = await apiFetchJson(`${BASE}/${roomId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  }, 'Failed to update room');
  return data.room;
}

/**
 * Delete a room.
 * @param {string} roomId
 * @returns {Promise<object>}
 */
export async function deleteRoom(roomId) {
  return apiFetchJson(`${BASE}/${roomId}`, { method: 'DELETE' }, 'Failed to delete room');
}

/**
 * List available agents that can participate in rooms.
 * @returns {Promise<object[]>} Array of agent descriptors.
 */
export async function listAvailableAgents() {
  const data = await apiFetchJson(`${BASE}/agents`, {}, 'Failed to list agents');
  return data.agents;
}

/**
 * Send a message to a room and consume the multi-agent SSE stream.
 *
 * @param {string} roomId
 * @param {{ message?: string, parsedImageContext?: object, agentRuntime?: object }} payload
 *   At least one of `message` or `parsedImageContext` must be present.
 *   parsedImageContext shape:
 *   { transcription, parseFields, confidence?, validationPassed?, fieldsFound?, role, originalImageMeta }
 * @param {{ onRoomStart?: Function, onAgentStart?: Function, onChunk?: Function, onThinking?: Function, onAgentDone?: Function, onRoomDone?: Function, onAgentError?: Function, onError?: Function }} handlers
 * @returns {{ abort: Function }}
 */
export function sendRoomMessage(roomId, { message, parsedImageContext, systemInitiated, systemMessage, agentRuntime } = {}, { onRoomStart, onAgentStart, onChunk, onThinking, onActions, onStatus, onAgentDone, onRoomDone, onAgentError, onError }) {
  const controller = new AbortController();
  const url = `${BASE}/${roomId}/send`;

  (async () => {
    try {
      let streamSettled = false;

      const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(message && { message }),
          ...(parsedImageContext && { parsedImageContext }),
          ...(systemInitiated ? { systemInitiated: true } : {}),
          ...(systemMessage ? { systemMessage } : {}),
          ...(agentRuntime && typeof agentRuntime === 'object' ? { agentRuntime } : {}),
        }),
        signal: controller.signal,
        timeout: STREAM_TIMEOUT_MS,
        noRetry: true,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        onError?.(normalizeError({ ...err, status: res.status, statusText: res.statusText, url: res.url }, err.error || 'Request failed'));
        return;
      }

      await consumeSSEStream(res, (eventType, data) => {
        if (eventType === 'room_start') {
          onRoomStart?.(data);
        } else if (eventType === 'agent_start') {
          onAgentStart?.(data);
        } else if (eventType === 'chunk') {
          onChunk?.(data);
        } else if (eventType === 'thinking') {
          onThinking?.(data);
        } else if (eventType === 'actions') {
          onActions?.(data);
        } else if (eventType === 'status') {
          onStatus?.(data);
        } else if (eventType === 'agent_done') {
          onAgentDone?.(data);
        } else if (eventType === 'room_done') {
          streamSettled = true;
          onRoomDone?.(data);
        } else if (eventType === 'agent_error') {
          onAgentError?.(data);
        } else if (eventType === 'error') {
          streamSettled = true;
          onError?.(normalizeError(data, data?.error || 'Request failed'));
        }
      });

      if (!streamSettled && !controller.signal.aborted) {
        onError?.(normalizeError({
          code: 'STREAM_INCOMPLETE',
          error: 'The response stream ended before completion.',
          detail: 'The connection closed without a final room_done/error event.',
        }, 'The response stream ended before completion.'));
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        window.dispatchEvent(new CustomEvent('sse-stream-error', {
          detail: { url, error: err.message },
        }));
        onError?.(normalizeError({ message: err.message }, err.message));
      }
    }
  })();

  return { abort: () => controller.abort() };
}
