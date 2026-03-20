/**
 * Headless background dev-chat client.
 *
 * Sends requests to the dedicated background-monitor ingestion route for
 * non-user channels, while preserving the foreground /api/dev/chat path for
 * normal conversational traffic. Processes the SSE stream without touching
 * any React state and returns structured results as plain data.
 *
 * Design contract:
 * - Zero React imports — this is a pure async function.
 * - Callers can wire up optional onChunk / onToolUse callbacks for
 *   progress observability (e.g. mini-widget pulse).
 * - On 404 (stale conversationId), throws with `{ status: 404 }` so the
 *   caller can clear the channel and retry.
 */

import { apiFetch } from './http.js';
import { consumeSSEStream } from './sse.js';
import { normalizeError } from '../utils/normalizeError.js';

const BASE = '/api';

/**
 * @param {object} opts
 * @param {string} opts.message            User message text
 * @param {string} [opts.conversationId]   Existing conversation to continue
 * @param {string} [opts.provider]         Provider ID
 * @param {string} [opts.channelType]      Background channel type
 * @param {object} [opts.incidentMeta]     Structured monitor-incident metadata
 * @param {object} [opts.incidentContext]  Structured supervisor context for the dev agent
 * @param {string} [opts.reasoningEffort]  Reasoning effort level
 * @param {(chunk: {text: string, provider?: string}) => void} [opts.onChunk]
 * @param {(event: object) => void} [opts.onToolUse]
 * @returns {Promise<{conversationId: string|null, assistantText: string, toolEvents: object[], usage: object|null, collapsed?: boolean, collapseReason?: string|null, incident?: object|null}>}
 */
export async function sendBackgroundDevMessage({
  message,
  conversationId = null,
  provider,
  channelType,
  incidentMeta,
  incidentContext,
  reasoningEffort,
  onChunk,
  onToolUse,
}) {
  const controller = new AbortController();
  let resolvedConversationId = conversationId;
  let assistantText = '';
  const toolEvents = [];
  let usage = null;
  let sessionId = null;
  let collapsed = false;
  let collapseReason = null;
  let incident = null;

  const body = {
    message,
    conversationId,
    provider,
    channelType,
    incidentMeta,
    incidentContext,
    reasoningEffort,
  };
  const endpoint = channelType && channelType !== 'user'
    ? `${BASE}/dev/monitor`
    : `${BASE}/dev/chat`;

  const res = await apiFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    const normalized = normalizeError(errBody);
    const err = new Error(normalized.message);
    err.status = res.status;
    err.code = normalized.code || errBody?.code || null;
    const retryAfterHeader = res.headers.get('Retry-After');
    const retryAfterSec = Number.parseInt(retryAfterHeader || '', 10);
    err.retryAfterMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? retryAfterSec * 1000
      : null;
    throw err;
  }

  let streamSettled = false;
  const streamMeta = await consumeSSEStream(res, (eventType, data) => {
    if (eventType === 'start' || eventType === 'init' || eventType === 'session') {
      resolvedConversationId = data.conversationId || resolvedConversationId;
      sessionId = data.sessionId || sessionId;
      return;
    }

    if (eventType === 'done') {
      streamSettled = true;
      resolvedConversationId = data.conversationId || resolvedConversationId;
      usage = data.usage || null;
      collapsed = Boolean(data.collapsed);
      collapseReason = data.collapseReason || null;
      incident = data.incident || null;
      return;
    }

    if (eventType === 'error') {
      streamSettled = true;
      // Surface SSE-level errors as thrown exceptions
      const normalized = normalizeError(data);
      const err = new Error(normalized.message);
      err.code = normalized.code;
      err.detail = normalized.detail;
      throw err;
    }

    // Text chunks
    if (eventType === 'chunk' && typeof data.text === 'string') {
      assistantText += data.text;
      onChunk?.({ text: data.text, provider: data.provider || null });
    } else if (eventType === 'delta' && data.delta?.text) {
      assistantText += data.delta.text;
      onChunk?.({ text: data.delta.text, provider: data.provider || null });
    } else if (eventType === 'result' && typeof data.result === 'string') {
      assistantText += data.result;
      onChunk?.({ text: data.result, provider: data.provider || null });
    }

    // Tool events
    if (eventType === 'tool_use') {
      const evt = {
        tool: data.tool || 'tool_use',
        input: data.details || data.input || {},
        status: data.status || 'started',
        provider: data.provider || null,
      };
      toolEvents.push(evt);
      onToolUse?.(evt);
    } else if (eventType === 'tool_result') {
      const evt = {
        tool: data.tool || data.name || 'tool_result',
        details: data.details || data,
        status: data.status || (data.is_error ? 'error' : 'success'),
        provider: data.provider || null,
      };
      toolEvents.push(evt);
      onToolUse?.(evt);
    }
  });

  if (!streamSettled && !controller.signal.aborted) {
    const normalized = normalizeError({
      code: 'STREAM_INCOMPLETE',
      error: 'The background dev stream ended before completion.',
      detail: streamMeta?.malformedEventCount > 0
        ? `The connection closed without a final done/error event and ${streamMeta.malformedEventCount} malformed SSE payload${streamMeta.malformedEventCount === 1 ? ' was' : 's were'} ignored.`
        : 'The connection closed without a final done/error event.',
    }, 'The background dev stream ended before completion.');
    const err = new Error(normalized.message);
    err.code = normalized.code;
    err.detail = normalized.detail;
    throw err;
  }

  return {
    conversationId: resolvedConversationId,
    assistantText,
    toolEvents,
    usage,
    sessionId,
    collapsed,
    collapseReason,
    incident,
  };
}
