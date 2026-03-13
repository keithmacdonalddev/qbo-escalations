import { apiFetch } from './http.js';
import { consumeSSEStream } from './sse.js';
import { normalizeError } from '../utils/normalizeError.js';
import { serializeJsonRequestBody } from '../lib/jsonRequestBody.js';
const BASE = '/api';
const STREAM_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Send a chat message and consume SSE stream.
 * @param {{ message: string, conversationId?: string, images?: string[], provider?: string, mode?: string, fallbackProvider?: string, parallelProviders?: string[], settings?: object }} body
 * @param {{ onInit: Function, onChunk: Function, onDone: Function, onError: Function, onProviderError?: Function, onFallback?: Function, onLocalStage?: Function }} handlers
 * @returns {{ abort: Function }}
 */
export function sendChatMessage(body, { onInit, onChunk, onThinking, onDone, onError, onProviderError, onFallback, onTriageCard, onLocalStage }) {
  const controller = new AbortController();
  const url = `${BASE}/chat`;
  const hasImages = Array.isArray(body.images) && body.images.length > 0;

  (async () => {
    try {
      let streamSettled = false;
      const requestStartedAt = performance.now();

      // Large base64 image payloads can freeze the UI if JSON serialization
      // runs on the main thread.
      if (hasImages) window.__imageRequestActive = true;
      const serializeStartedAt = performance.now();
      onLocalStage?.({ stage: 'serialize', phase: 'start', hasImages });
      if (hasImages) await new Promise((r) => setTimeout(r, 0));
      const bodyStr = await serializeJsonRequestBody(body, {
        offThread: hasImages,
        signal: controller.signal,
      });
      onLocalStage?.({
        stage: 'serialize',
        phase: 'done',
        hasImages,
        durationMs: Math.round(performance.now() - serializeStartedAt),
      });
      if (hasImages) await new Promise((r) => setTimeout(r, 0));

      const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
        signal: controller.signal,
        timeout: STREAM_TIMEOUT_MS,
      });
      onLocalStage?.({
        stage: 'response',
        phase: 'headers',
        hasImages,
        status: res.status,
        durationMs: Math.round(performance.now() - requestStartedAt),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        onError?.(normalizeError(err, err.error || 'Request failed'));
        return;
      }

      await consumeSSEStream(res, (eventType, data) => {
        if (eventType === 'start' || eventType === 'init') onInit?.(data);
        else if (eventType === 'triage_card') onTriageCard?.(data);
        else if (eventType === 'thinking') onThinking?.(data);
        else if (eventType === 'chunk') onChunk?.(data);
        else if (eventType === 'provider_error') onProviderError?.(data);
        else if (eventType === 'fallback') onFallback?.(data);
        else if (eventType === 'done') {
          streamSettled = true;
          onDone?.(data);
        } else if (eventType === 'error') {
          streamSettled = true;
          onError?.(normalizeError(data, data?.error || 'Request failed'));
        }
      });

      if (!streamSettled && !controller.signal.aborted) {
        onError?.(normalizeError({
          code: 'STREAM_INCOMPLETE',
          error: 'The response stream ended before completion.',
          detail: 'The connection closed without a final done/error event.',
        }, 'The response stream ended before completion.'));
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        window.dispatchEvent(new CustomEvent('sse-stream-error', {
          detail: { url, error: err.message },
        }));
        onError?.(normalizeError({ message: err.message }, err.message));
      }
    } finally {
      if (hasImages) window.__imageRequestActive = false;
    }
  })();

  return { abort: () => controller.abort() };
}

/**
 * Retry last assistant response for a conversation and consume SSE stream.
 * @param {{ conversationId: string, provider?: string, mode?: string, fallbackProvider?: string, parallelProviders?: string[], settings?: object }} body
 * @param {{ onInit: Function, onChunk: Function, onThinking?: Function, onDone: Function, onError: Function, onProviderError?: Function, onFallback?: Function, onTriageCard?: Function, onLocalStage?: Function }} handlers
 * @returns {{ abort: Function }}
 */
export function retryChatMessage(body, { onInit, onChunk, onThinking, onDone, onError, onProviderError, onFallback, onTriageCard, onLocalStage }) {
  const controller = new AbortController();
  const url = `${BASE}/chat/retry`;

  (async () => {
    try {
      let streamSettled = false;
      const requestStartedAt = performance.now();
      const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
        timeout: STREAM_TIMEOUT_MS,
      });
      onLocalStage?.({
        stage: 'response',
        phase: 'headers',
        status: res.status,
        durationMs: Math.round(performance.now() - requestStartedAt),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        onError?.(normalizeError(err, err.error || 'Request failed'));
        return;
      }

      await consumeSSEStream(res, (eventType, data) => {
        if (eventType === 'start' || eventType === 'init') onInit?.(data);
        else if (eventType === 'triage_card') onTriageCard?.(data);
        else if (eventType === 'thinking') onThinking?.(data);
        else if (eventType === 'chunk') onChunk?.(data);
        else if (eventType === 'provider_error') onProviderError?.(data);
        else if (eventType === 'fallback') onFallback?.(data);
        else if (eventType === 'done') {
          streamSettled = true;
          onDone?.(data);
        } else if (eventType === 'error') {
          streamSettled = true;
          onError?.(normalizeError(data, data?.error || 'Request failed'));
        }
      });

      if (!streamSettled && !controller.signal.aborted) {
        onError?.(normalizeError({
          code: 'STREAM_INCOMPLETE',
          error: 'The response stream ended before completion.',
          detail: 'The connection closed without a final done/error event.',
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

/** Get lightweight conversation metadata without message history */
export async function getConversationMeta(id) {
  const res = await apiFetch(`${BASE}/conversations/${id}/meta`);
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
