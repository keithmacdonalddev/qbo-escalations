const BASE = '/api';

/**
 * Send a dev-mode chat message and consume SSE stream.
 * Dev mode uses Claude with full tool access (file read/write, bash, etc.)
 *
 * @param {{ message: string, conversationId?: string }} body
 * @param {{ onInit: Function, onChunk: Function, onToolUse: Function, onDone: Function, onError: Function }} handlers
 * @returns {{ abort: Function }}
 */
export function sendDevMessage(body, { onInit, onChunk, onToolUse, onDone, onError }) {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BASE}/dev/chat`, {
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

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === 'start' || currentEvent === 'init') onInit?.(data);
              else if (currentEvent === 'chunk') onChunk?.(data);
              else if (currentEvent === 'tool_use') onToolUse?.(data);
              else if (currentEvent === 'done') onDone?.(data);
              else if (currentEvent === 'error') onError?.(data.error);
            } catch { /* ignore malformed data lines */ }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        onError?.(err.message);
      }
    }
  })();

  return { abort: () => controller.abort() };
}

/** List dev conversations */
export async function listDevConversations(limit = 50, skip = 0) {
  const params = new URLSearchParams({ limit, skip });
  const res = await fetch(`${BASE}/dev/conversations?${params}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to list dev conversations');
  return data.conversations;
}

/** Get a single dev conversation */
export async function getDevConversation(id) {
  const res = await fetch(`${BASE}/dev/conversations/${id}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Dev conversation not found');
  return data.conversation;
}

/** Delete a dev conversation */
export async function deleteDevConversation(id) {
  const res = await fetch(`${BASE}/dev/conversations/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to delete');
  return data;
}
