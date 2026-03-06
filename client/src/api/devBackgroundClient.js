/**
 * Headless background dev-chat client.
 *
 * Sends requests to the same POST /api/dev/chat endpoint that the foreground
 * useDevChat uses, but processes the SSE stream without touching any React
 * state.  Returns structured results as plain data.
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
 * @param {string} [opts.reasoningEffort]  Reasoning effort level
 * @param {(chunk: {text: string, provider?: string}) => void} [opts.onChunk]
 * @param {(event: object) => void} [opts.onToolUse]
 * @returns {Promise<{conversationId: string, assistantText: string, toolEvents: object[], usage: object|null}>}
 */
export async function sendBackgroundDevMessage({
  message,
  conversationId = null,
  provider,
  channelType,
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

  const body = {
    message,
    conversationId,
    provider,
    channelType,
    reasoningEffort,
  };

  const res = await apiFetch(`${BASE}/dev/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    const err = new Error(normalizeError(errBody).message);
    err.status = res.status;
    throw err;
  }

  await consumeSSEStream(res, (eventType, data) => {
    if (eventType === 'start' || eventType === 'init' || eventType === 'session') {
      resolvedConversationId = data.conversationId || resolvedConversationId;
      sessionId = data.sessionId || sessionId;
      return;
    }

    if (eventType === 'done') {
      resolvedConversationId = data.conversationId || resolvedConversationId;
      usage = data.usage || null;
      return;
    }

    if (eventType === 'error') {
      // Surface SSE-level errors as thrown exceptions
      throw new Error(normalizeError(data).message);
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

  return {
    conversationId: resolvedConversationId,
    assistantText,
    toolEvents,
    usage,
    sessionId,
  };
}
