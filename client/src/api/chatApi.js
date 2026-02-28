import { apiFetch } from './http.js';
import { consumeSSEStream } from './sse.js';
const BASE = '/api';

function normalizeErrorPayload(payload, fallbackMessage = 'Request failed') {
  if (typeof payload === 'string') {
    return {
      message: payload,
      error: payload,
      code: 'REQUEST_FAILED',
      attempts: [],
    };
  }

  if (payload && typeof payload === 'object') {
    const message = payload.message || payload.error || fallbackMessage;
    return {
      ...payload,
      message,
      error: message,
      code: payload.code || 'REQUEST_FAILED',
      attempts: Array.isArray(payload.attempts) ? payload.attempts : [],
    };
  }

  return {
    message: fallbackMessage,
    error: fallbackMessage,
    code: 'REQUEST_FAILED',
    attempts: [],
  };
}

/**
 * Send a chat message and consume SSE stream.
 * @param {{ message: string, conversationId?: string, images?: string[], provider?: string, mode?: string, fallbackProvider?: string, parallelProviders?: string[], settings?: object }} body
 * @param {{ onInit: Function, onChunk: Function, onDone: Function, onError: Function, onProviderError?: Function, onFallback?: Function }} handlers
 * @returns {{ abort: Function }}
 */
export function sendChatMessage(body, { onInit, onChunk, onThinking, onDone, onError, onProviderError, onFallback, onTriageCard }) {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await apiFetch(`${BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        onError?.(normalizeErrorPayload(err, err.error || 'Request failed'));
        return;
      }

      await consumeSSEStream(res, (eventType, data) => {
        if (eventType === 'start' || eventType === 'init') onInit?.(data);
        else if (eventType === 'triage_card') onTriageCard?.(data);
        else if (eventType === 'thinking') onThinking?.(data);
        else if (eventType === 'chunk') onChunk?.(data);
        else if (eventType === 'provider_error') onProviderError?.(data);
        else if (eventType === 'fallback') onFallback?.(data);
        else if (eventType === 'done') onDone?.(data);
        else if (eventType === 'error') onError?.(normalizeErrorPayload(data, data?.error || 'Request failed'));
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        onError?.(normalizeErrorPayload({ message: err.message }, err.message));
      }
    }
  })();

  return { abort: () => controller.abort() };
}

/**
 * Retry last assistant response for a conversation and consume SSE stream.
 * @param {{ conversationId: string, provider?: string, mode?: string, fallbackProvider?: string, parallelProviders?: string[], settings?: object }} body
 * @param {{ onInit: Function, onChunk: Function, onThinking?: Function, onDone: Function, onError: Function, onProviderError?: Function, onFallback?: Function, onTriageCard?: Function }} handlers
 * @returns {{ abort: Function }}
 */
export function retryChatMessage(body, { onInit, onChunk, onThinking, onDone, onError, onProviderError, onFallback, onTriageCard }) {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await apiFetch(`${BASE}/chat/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        onError?.(normalizeErrorPayload(err, err.error || 'Request failed'));
        return;
      }

      await consumeSSEStream(res, (eventType, data) => {
        if (eventType === 'start' || eventType === 'init') onInit?.(data);
        else if (eventType === 'triage_card') onTriageCard?.(data);
        else if (eventType === 'thinking') onThinking?.(data);
        else if (eventType === 'chunk') onChunk?.(data);
        else if (eventType === 'provider_error') onProviderError?.(data);
        else if (eventType === 'fallback') onFallback?.(data);
        else if (eventType === 'done') onDone?.(data);
        else if (eventType === 'error') onError?.(normalizeErrorPayload(data, data?.error || 'Request failed'));
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        onError?.(normalizeErrorPayload({ message: err.message }, err.message));
      }
    }
  })();

  return { abort: () => controller.abort() };
}

/** List conversations (with optional search) */
export async function listConversations(limit = 50, skip = 0, search = '') {
  const params = new URLSearchParams({ limit, skip });
  if (search) params.set('search', search);
  const res = await apiFetch(`${BASE}/conversations?${params}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to list conversations');
  return data.conversations;
}

/** Get a single conversation with messages */
export async function getConversation(id) {
  const res = await apiFetch(`${BASE}/conversations/${id}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Conversation not found');
  return data.conversation;
}

/** Rename or update a conversation */
export async function updateConversation(id, fields) {
  const res = await apiFetch(`${BASE}/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to update');
  return data.conversation;
}

/** Export conversation as plain text */
export async function exportConversation(id) {
  const res = await apiFetch(`${BASE}/conversations/${id}/export`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to export');
  return data.text;
}

/** Delete a conversation */
export async function deleteConversation(id) {
  const res = await apiFetch(`${BASE}/conversations/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to delete');
  return data;
}

/** Fork a conversation from a specific message index */
export async function forkConversation(id, fromMessageIndex) {
  const res = await apiFetch(`${BASE}/conversations/${id}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromMessageIndex }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fork conversation');
  return data.conversation;
}

/**
 * Accept a parallel-turn provider response as the canonical winner.
 * @param {string} turnId
 * @param {{ conversationId: string, provider: string, editedContent?: string }} body
 */
export async function acceptParallelTurn(turnId, body) {
  const res = await apiFetch(`${BASE}/chat/parallel/${encodeURIComponent(turnId)}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to accept parallel response');
  return data;
}

/**
 * Discard all candidates for an unaccepted parallel turn.
 * @param {string} turnId
 * @param {{ conversationId: string }} body
 */
/**
 * Reverse a parallel-turn acceptance, restoring both candidates to open state.
 * @param {string} turnId
 * @param {{ conversationId: string }} body
 */
export async function unacceptParallelTurn(turnId, body) {
  const res = await apiFetch(`${BASE}/chat/parallel/${encodeURIComponent(turnId)}/unaccept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to unaccept parallel response');
  return data;
}

export async function discardParallelTurn(turnId, body) {
  const res = await apiFetch(`${BASE}/chat/parallel/${encodeURIComponent(turnId)}/discard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to discard parallel response');
  return data;
}
