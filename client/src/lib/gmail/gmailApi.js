import { apiFetch as trackedFetch } from '../../api/http.js';
import { consumeSSEStream } from '../../api/sse.js';

const GMAIL_API_BASE = '/api/gmail';

/**
 * Fetch from the Gmail API. Supports injecting `account` param for multi-account.
 * For GET requests, appends ?account=... to the URL.
 * For POST/PATCH/PUT, adds `account` to the JSON body.
 * @param {string} path - API path (e.g. '/messages')
 * @param {Object} [opts] - fetch options
 * @param {string} [accountEmail] - optional active account email to use
 */
export async function apiFetch(path, opts = {}, accountEmail) {
  let url = `${GMAIL_API_BASE}${path}`;

  if (accountEmail && (!opts.method || opts.method === 'GET' || opts.method === 'DELETE')) {
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}account=${encodeURIComponent(accountEmail)}`;
  }

  let body = opts.body;
  if (accountEmail && opts.method && ['POST', 'PATCH', 'PUT'].includes(opts.method) && body) {
    try {
      const parsed = JSON.parse(body);
      parsed.account = accountEmail;
      body = JSON.stringify(parsed);
    } catch {
      // Not JSON, keep the original body.
    }
  }

  const res = await trackedFetch(url, {
    ...opts,
    body,
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    },
  });
  if (!res.ok && !res.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`Server error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// Gmail AI transport wrapper: POST to /api/gmail/ai and stream SSE chunks.
export function sendGmailAI({ prompt, emailContext, conversationHistory, onChunk, onDone, onError }) {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await trackedFetch(`${GMAIL_API_BASE}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, emailContext, conversationHistory }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        onError?.(err.error || 'Request failed');
        return;
      }

      let streamSettled = false;
      await consumeSSEStream(res, (eventType, data) => {
        if (eventType === 'chunk' && data?.text) onChunk?.(data.text);
        else if (eventType === 'done') {
          streamSettled = true;
          onDone?.(data);
        } else if (eventType === 'error') {
          streamSettled = true;
          onError?.(data?.error || 'AI error');
        }
      });

      if (!streamSettled && !controller.signal.aborted) {
        onError?.('The Gmail AI stream ended before completion.');
      }
    } catch (err) {
      if (err.name !== 'AbortError') onError?.(err.message || 'Network error');
    }
  })();

  return { abort: () => controller.abort() };
}
