import { apiFetch } from './http.js';
import { toApiError } from '../utils/normalizeError.js';
import { serializeJsonRequestBody } from '../lib/jsonRequestBody.js';
import { createSSEDecoder } from './sse.js';

const BASE = '/api/model-lab';

// ---------------------------------------------------------------------------
// Lab history persistence API
// ---------------------------------------------------------------------------

export async function saveLabResult(result) {
  const res = await apiFetch(`${BASE}/save-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  });
  const data = await res.json();
  if (!data.ok) throw toApiError(data, 'Failed to save lab result');
  return data.result;
}

export async function getLabHistory({ limit = 50, offset = 0, provider, status } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (provider) params.set('provider', provider);
  if (status) params.set('status', status);

  const res = await apiFetch(`${BASE}/history?${params.toString()}`);
  const data = await res.json();
  if (!data.ok) throw toApiError(data, 'Failed to load lab history');
  return data;
}

export async function deleteLabResult(id) {
  const res = await apiFetch(`${BASE}/history/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!data.ok) throw toApiError(data, 'Failed to delete lab result');
  return data;
}

// Maximum total timeout the server allows (20 minutes).  The client fetch
// timeout must be at least as generous so the request is not aborted before
// the server finishes running every model sequentially.
const MAX_TOTAL_TIMEOUT_MS = 20 * 60_000;

function estimateBenchmarkTimeout(perModelTimeoutMs, providerCount) {
  const serverEstimate = Math.min(
    MAX_TOTAL_TIMEOUT_MS,
    Math.max(120_000, (providerCount * perModelTimeoutMs) + 60_000),
  );
  return serverEstimate + 30_000;
}

export async function runImageBenchmark({
  task,
  image,
  referenceText,
  providers,
  reasoningEffort,
  timeoutMs,
  forceCatalogBlocked,
} = {}) {
  const body = {
    task,
    image,
    referenceText,
    providers,
    reasoningEffort,
    timeoutMs,
    forceCatalogBlocked,
  };

  const providerCount = Array.isArray(providers) ? providers.length : 8;
  const perModelMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 90_000;
  const fetchTimeout = estimateBenchmarkTimeout(perModelMs, providerCount);

  const res = await apiFetch(`${BASE}/image-benchmark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    timeout: fetchTimeout,
    body: await serializeJsonRequestBody(body, {
      offThread: typeof image === 'string' && image.length > 0,
    }),
  });
  const data = await res.json();
  if (!data.ok) throw toApiError(data, 'Failed to run image benchmark');
  return data.benchmark;
}

/**
 * Stream a single-model template extraction via SSE.
 *
 * @param {Object} params
 * @param {string} params.image - Base64 image data
 * @param {string} params.provider - Provider ID
 * @param {string} params.reasoningEffort - low/medium/high/xhigh
 * @param {number} [params.timeoutMs] - Per-model timeout
 * @param {Object} callbacks
 * @param {function} callbacks.onStart - Called with provider metadata
 * @param {function} callbacks.onThinking - Called with incremental thinking text
 * @param {function} callbacks.onText - Called with incremental output text
 * @param {function} callbacks.onDone - Called with final result object
 * @param {function} callbacks.onError - Called with error object
 * @returns {function} abort - Call to cancel the stream
 */
export function streamTranscribe(
  { image, provider, reasoningEffort, timeoutMs },
  { onStart, onThinking, onText, onDone, onError },
) {
  const controller = new AbortController();
  let finished = false;

  (async () => {
    try {
      const body = await serializeJsonRequestBody(
        { image, provider, reasoningEffort, timeoutMs },
        { offThread: typeof image === 'string' && image.length > 0 },
      );

      const fetchTimeoutMs = (timeoutMs || 90_000) + 60_000;
      const res = await apiFetch(`${BASE}/stream-transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        timeout: fetchTimeoutMs,
        signal: controller.signal,
      });

      // If response is JSON (error), handle it
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (!data.ok) {
          if (!finished) {
            finished = true;
            onError?.({ error: data.error || 'Server error', code: data.code });
          }
        }
        return;
      }

      // Stream SSE
      if (!res.body) {
        if (!finished) {
          finished = true;
          onError?.({ error: 'No response body' });
        }
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = createSSEDecoder((eventType, data) => {
        if (finished) return;
        switch (eventType) {
          case 'start':
            onStart?.(data);
            break;
          case 'thinking':
            onThinking?.(data.thinking || '');
            break;
          case 'text':
            onText?.(data.text || '');
            break;
          case 'done':
            finished = true;
            onDone?.(data);
            break;
          case 'error':
            finished = true;
            onError?.(data);
            break;
          default:
            break;
        }
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.pushChunk(decoder.decode(value, { stream: true }));
      }

      const trailing = decoder.decode();
      if (trailing) parser.pushChunk(trailing);
      parser.finish();

      // If we never got a terminal event, treat as error
      if (!finished) {
        finished = true;
        onError?.({ error: 'Stream ended without a terminal event' });
      }
    } catch (err) {
      if (finished) return;
      finished = true;
      if (err.name === 'AbortError') return;
      onError?.({ error: err.message || 'Stream failed' });
    }
  })();

  return () => {
    finished = true;
    try { controller.abort(); } catch { /* ignore */ }
  };
}
