import { apiFetch } from './http.js';
import { consumeSSEStream } from './sse.js';
import { normalizeError } from '../utils/normalizeError.js';
const BASE = '/api/copilot';

function streamRequest(url, body, { onStart, onChunk, onDone, onError }) {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        onError?.(normalizeError(err));
        return;
      }

      await consumeSSEStream(res, (eventType, data) => {
        if (eventType === 'start') onStart?.(data);
        else if (eventType === 'chunk') onChunk?.(data);
        else if (eventType === 'done') onDone?.(data);
        else if (eventType === 'error') onError?.(normalizeError(data));
      });
    } catch (err) {
      if (err.name !== 'AbortError') onError?.(normalizeError(err));
    }
  })();

  return { abort: () => controller.abort() };
}

export function streamAnalyzeEscalation(escalationId, handlers) {
  return streamRequest(`${BASE}/analyze-escalation`, { escalationId }, handlers);
}

export function streamFindSimilar(escalationId, handlers) {
  return streamRequest(`${BASE}/find-similar`, { escalationId }, handlers);
}

export function streamSuggestTemplate(escalationId, handlers) {
  return streamRequest(`${BASE}/suggest-template`, { escalationId }, handlers);
}

export function streamGenerateTemplate(category, description, handlers) {
  return streamRequest(`${BASE}/generate-template`, { category, description }, handlers);
}

export function streamImproveTemplate(templateContent, handlers) {
  return streamRequest(`${BASE}/improve-template`, { templateContent }, handlers);
}

export function streamExplainTrends(handlers) {
  return streamRequest(`${BASE}/explain-trends`, {}, handlers);
}

export function streamPlaybookCheck(handlers) {
  return streamRequest(`${BASE}/playbook-check`, {}, handlers);
}

export function streamSemanticSearch(query, handlers) {
  return streamRequest(`${BASE}/search`, { query }, handlers);
}

