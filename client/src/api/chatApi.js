const BASE = '/api';

/**
 * Send a chat message and consume SSE stream.
 * @param {{ message: string, conversationId?: string, images?: string[] }} body
 * @param {{ onInit: Function, onChunk: Function, onDone: Function, onError: Function }} handlers
 * @returns {{ abort: Function }}
 */
export function sendChatMessage(body, { onInit, onChunk, onDone, onError }) {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BASE}/chat`, {
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

/** List conversations (with optional search) */
export async function listConversations(limit = 50, skip = 0, search = '') {
  const params = new URLSearchParams({ limit, skip });
  if (search) params.set('search', search);
  const res = await fetch(`${BASE}/conversations?${params}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to list conversations');
  return data.conversations;
}

/** Get a single conversation with messages */
export async function getConversation(id) {
  const res = await fetch(`${BASE}/conversations/${id}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Conversation not found');
  return data.conversation;
}

/** Rename or update a conversation */
export async function updateConversation(id, fields) {
  const res = await fetch(`${BASE}/conversations/${id}`, {
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
  const res = await fetch(`${BASE}/conversations/${id}/export`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to export');
  return data.text;
}

/** Delete a conversation */
export async function deleteConversation(id) {
  const res = await fetch(`${BASE}/conversations/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to delete');
  return data;
}

/** Parse escalation from image or text */
export async function parseEscalation(input) {
  const body = input.startsWith('data:image') ? { image: input } : { text: input };
  const res = await fetch(`${BASE}/chat/parse-escalation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to parse');
  return data.escalation;
}
