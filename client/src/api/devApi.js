import { apiFetch } from './http.js';
import { consumeSSEStream } from './sse.js';
const BASE = '/api';

/**
 * Send a dev-mode chat message and consume SSE stream.
 * Dev mode supports provider policy (single/fallback) and streams tool events.
 *
 * @param {{ message: string, images?: string[], conversationId?: string, sessionId?: string, provider?: string, mode?: string, fallbackProvider?: string }} body
 * @param {{ onInit: Function, onChunk: Function, onToolUse: Function, onDone: Function, onError: Function, onProviderError?: Function, onFallback?: Function }} handlers
 * @returns {{ abort: Function }}
 */
export function sendDevMessage(body, { onInit, onChunk, onToolUse, onDone, onError, onProviderError, onFallback }) {
  const controller = new AbortController();

  (async () => {
    try {
      let activeConversationId = body.conversationId || null;
      let activeSessionId = body.sessionId || null;

      const res = await apiFetch(`${BASE}/dev/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        onError?.(err.error || 'Request failed');
        return;
      }

      await consumeSSEStream(res, (eventType, data) => {
        if (eventType === 'start' || eventType === 'init') {
          activeConversationId = data.conversationId || activeConversationId;
          onInit?.({
            ...data,
            conversationId: activeConversationId,
            sessionId: activeSessionId,
          });
          return;
        }

        if (eventType === 'session') {
          activeSessionId = data.sessionId || activeSessionId;
          activeConversationId = data.conversationId || activeConversationId;
          onInit?.({
            ...data,
            conversationId: activeConversationId,
            sessionId: activeSessionId,
          });
          return;
        }

        if (eventType === 'done') {
          onDone?.({
            ...data,
            conversationId: data.conversationId || activeConversationId || null,
            sessionId: data.sessionId !== undefined ? data.sessionId : (activeSessionId || null),
          });
          return;
        }

        if (eventType === 'error') {
          onError?.(data.error);
          return;
        }
        if (eventType === 'provider_error') {
          onProviderError?.(data);
          return;
        }
        if (eventType === 'fallback') {
          onFallback?.(data);
          return;
        }

        const chunkText = extractTextFromEvent(eventType, data);
        if (chunkText) {
          onChunk?.({ text: chunkText, provider: data.provider || null });
        }

        const toolEvents = extractToolEvents(eventType, data);
        for (const event of toolEvents) {
          onToolUse?.({ ...event, provider: data.provider || event.provider || null });
        }
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        onError?.(err.message);
      }
    }
  })();

  return { abort: () => controller.abort() };
}

function extractTextFromEvent(eventType, payload) {
  if (!payload) return '';
  if (eventType === 'chunk' && typeof payload.text === 'string') {
    return payload.text;
  }
  if (eventType === 'delta' && payload.delta && typeof payload.delta.text === 'string') {
    return payload.delta.text;
  }
  if (eventType === 'result' && typeof payload.result === 'string') {
    return payload.result;
  }
  if (eventType === 'text' && payload.message && Array.isArray(payload.message.content)) {
    return payload.message.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
  }
  return '';
}

function extractToolEvents(eventType, payload) {
  if (!payload) return [];

  if (eventType === 'tool_use') {
    return [{
      tool: payload.tool || 'tool_use',
      input: payload.details || payload.input || {},
      details: payload.details || payload.input || {},
      status: payload.status || 'started',
      provider: payload.provider || null,
    }];
  }

  if (eventType === 'tool_result') {
    return [{
      tool: payload.tool || payload.name || 'tool_result',
      details: payload.details || payload,
      status: payload.status || (payload.is_error ? 'error' : 'success'),
      provider: payload.provider || null,
    }];
  }

  return [];
}

/** List persisted dev conversations */
export async function listDevConversations(limit = 50, skip = 0) {
  const params = new URLSearchParams({ limit, skip });
  const res = await apiFetch(`${BASE}/dev/conversations?${params}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to list conversations');
  return data.conversations;
}

/** Get a single persisted dev conversation */
export async function getDevConversation(id) {
  const res = await apiFetch(`${BASE}/dev/conversations/${id}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Conversation not found');
  return data.conversation;
}

/** Delete a persisted dev conversation */
export async function deleteDevConversation(id) {
  const res = await apiFetch(`${BASE}/dev/conversations/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to delete');
  return data;
}

