import { apiFetch } from './http.js';
import { getSharedRealtimeClient } from './realtime.js';
import { consumeSSEStream } from './sse.js';
import { normalizeError } from '../utils/normalizeError.js';

const STREAM_TIMEOUT_MS = 10 * 60 * 1000;

function dispatchSessionStreamEvent(eventType, data, handlers = {}, markSettled) {
  const {
    onSession,
    onStart,
    onStatus,
    onThinking,
    onChunk,
    onActions,
    onProviderError,
    onFallback,
    onDone,
    onError,
  } = handlers;

  if (eventType === 'session') onSession?.(data);
  else if (eventType === 'start' || eventType === 'init') onStart?.(data);
  else if (eventType === 'status') onStatus?.(data);
  else if (eventType === 'thinking') onThinking?.(data);
  else if (eventType === 'chunk') onChunk?.(data);
  else if (eventType === 'actions') onActions?.(data);
  else if (eventType === 'provider_error') onProviderError?.(data);
  else if (eventType === 'fallback') onFallback?.(data);
  else if (eventType === 'done') {
    markSettled?.();
    onDone?.(data);
  } else if (eventType === 'error') {
    markSettled?.();
    onError?.(normalizeError(data, data?.error || 'Session stream failed'));
  }
}

function extractSessionIdFromUrl(url) {
  const match = String(url || '').match(/\/api\/agents\/sessions\/([^/]+)\/stream(?:\?.*)?$/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function streamAgentRequest(url, body, {
  onStart,
  onStatus,
  onThinking,
  onChunk,
  onActions,
  onProviderError,
  onFallback,
  onDone,
  onError,
  timeout,
} = {}) {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: controller.signal,
        timeout: timeout ?? STREAM_TIMEOUT_MS,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        onError?.(normalizeError(err, err?.error || 'Request failed'));
        return;
      }

      let streamSettled = false;
      const streamMeta = await consumeSSEStream(res, (eventType, data) => {
        if (eventType === 'start' || eventType === 'init') onStart?.(data);
        else if (eventType === 'status') onStatus?.(data);
        else if (eventType === 'thinking') onThinking?.(data);
        else if (eventType === 'chunk') onChunk?.(data);
        else if (eventType === 'actions') onActions?.(data);
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
        const error = normalizeError({
          code: 'STREAM_INCOMPLETE',
          error: 'The response stream ended before completion.',
          detail: streamMeta?.malformedEventCount > 0
            ? `The connection closed without a final done/error event and ${streamMeta.malformedEventCount} malformed SSE payload${streamMeta.malformedEventCount === 1 ? ' was' : 's were'} ignored.`
            : 'The connection closed without a final done/error event.',
        }, 'The response stream ended before completion.');
        window.dispatchEvent(new CustomEvent('sse-stream-error', {
          detail: { url, error: error.message, code: error.code },
        }));
        onError?.(error);
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

export async function createAgentSession(url, body) {
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });

  const payload = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok || !payload?.ok) {
    throw normalizeError(payload, payload?.error || 'Failed to create agent session');
  }
  return payload;
}

export function streamAgentSession(url, {
  onSession,
  onStart,
  onStatus,
  onThinking,
  onChunk,
  onActions,
  onProviderError,
  onFallback,
  onDone,
  onError,
  timeout,
} = {}) {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await apiFetch(url, {
        method: 'GET',
        signal: controller.signal,
        timeout: timeout ?? STREAM_TIMEOUT_MS,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        onError?.(normalizeError(err, err?.error || 'Session stream failed'));
        return;
      }

      let streamSettled = false;
      const streamMeta = await consumeSSEStream(res, (eventType, data) => {
        if (eventType === 'session') onSession?.(data);
        else if (eventType === 'start' || eventType === 'init') onStart?.(data);
        else if (eventType === 'status') onStatus?.(data);
        else if (eventType === 'thinking') onThinking?.(data);
        else if (eventType === 'chunk') onChunk?.(data);
        else if (eventType === 'actions') onActions?.(data);
        else if (eventType === 'provider_error') onProviderError?.(data);
        else if (eventType === 'fallback') onFallback?.(data);
        else if (eventType === 'done') {
          streamSettled = true;
          onDone?.(data);
        } else if (eventType === 'error') {
          streamSettled = true;
          onError?.(normalizeError(data, data?.error || 'Session stream failed'));
        }
      });

      if (!streamSettled && !controller.signal.aborted) {
        const error = normalizeError({
          code: 'STREAM_INCOMPLETE',
          error: 'The session stream ended before completion.',
          detail: streamMeta?.malformedEventCount > 0
            ? `The connection closed without a final done/error event and ${streamMeta.malformedEventCount} malformed SSE payload${streamMeta.malformedEventCount === 1 ? ' was' : 's were'} ignored.`
            : 'The connection closed without a final done/error event.',
        }, 'The session stream ended before completion.');
        window.dispatchEvent(new CustomEvent('sse-stream-error', {
          detail: { url, error: error.message, code: error.code },
        }));
        onError?.(error);
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

export function streamAgentSessionRealtime(sessionIdOrUrl, handlers = {}) {
  const sessionId = extractSessionIdFromUrl(sessionIdOrUrl) || String(sessionIdOrUrl || '').trim();
  if (!sessionId || typeof window === 'undefined' || typeof window.WebSocket !== 'function') {
    return streamAgentSession(
      `/api/agents/sessions/${encodeURIComponent(sessionId)}/stream`,
      handlers,
    );
  }

  const realtime = getSharedRealtimeClient();
  let settled = false;
  let stopped = false;
  let currentAbort = () => {};

  const stop = () => {
    if (stopped) return;
    stopped = true;
    currentAbort?.();
  };

  const startSseFallback = () => {
    if (stopped) return;
    const stream = streamAgentSession(
      `/api/agents/sessions/${encodeURIComponent(sessionId)}/stream`,
      handlers,
    );
    currentAbort = () => stream.abort();
  };

  const startRealtime = () => {
    if (stopped) return;
    const unsubscribe = realtime.subscribe({
      channel: 'agent-session',
      key: sessionId,
      params: { since: 0 },
      onEvent(eventType, data) {
        if (stopped) return;
        dispatchSessionStreamEvent(eventType, data, handlers, () => {
          settled = true;
        });
        if (eventType === 'done' || eventType === 'error') {
          stop();
        }
      },
      onError() {
        if (stopped || settled) return;
        unsubscribe();
        startSseFallback();
      },
    });
    currentAbort = () => unsubscribe();
  };

  realtime.waitForHealthyConnection(1500).then((healthy) => {
    if (stopped) return;
    if (healthy || realtime.hasHealthyConnection()) {
      startRealtime();
    } else {
      startSseFallback();
    }
  }).catch(() => {
    if (!stopped) startSseFallback();
  });

  return { abort: stop };
}
