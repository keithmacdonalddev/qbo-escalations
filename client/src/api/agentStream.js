import { apiFetch } from './http.js';
import { consumeSSEStream } from './sse.js';
import { normalizeError } from '../utils/normalizeError.js';

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
        timeout,
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
        timeout,
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
