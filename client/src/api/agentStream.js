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

      await consumeSSEStream(res, (eventType, data) => {
        if (eventType === 'start' || eventType === 'init') onStart?.(data);
        else if (eventType === 'status') onStatus?.(data);
        else if (eventType === 'thinking') onThinking?.(data);
        else if (eventType === 'chunk') onChunk?.(data);
        else if (eventType === 'actions') onActions?.(data);
        else if (eventType === 'provider_error') onProviderError?.(data);
        else if (eventType === 'fallback') onFallback?.(data);
        else if (eventType === 'done') onDone?.(data);
        else if (eventType === 'error') onError?.(normalizeError(data, data?.error || 'Request failed'));
      });
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

      await consumeSSEStream(res, (eventType, data) => {
        if (eventType === 'session') onSession?.(data);
        else if (eventType === 'start' || eventType === 'init') onStart?.(data);
        else if (eventType === 'status') onStatus?.(data);
        else if (eventType === 'thinking') onThinking?.(data);
        else if (eventType === 'chunk') onChunk?.(data);
        else if (eventType === 'actions') onActions?.(data);
        else if (eventType === 'provider_error') onProviderError?.(data);
        else if (eventType === 'fallback') onFallback?.(data);
        else if (eventType === 'done') onDone?.(data);
        else if (eventType === 'error') onError?.(normalizeError(data, data?.error || 'Session stream failed'));
      });
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
