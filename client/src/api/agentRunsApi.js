import { apiFetchJson } from './http.js';

const PENDING_CHAT_RUN_KEY = 'qbo-pending-chat-agent-run';
const TERMINAL_STATUSES = new Set([
  'succeeded',
  'failed',
  'timed-out',
  'incomplete',
  'cancelled',
  'stale',
]);
const RECOVERABLE_STREAM_ERROR_CODES = new Set([
  'STREAM_INCOMPLETE',
  'REQUEST_FAILED',
  'SSE_STREAM_TIMEOUT',
  'SSE_PRESENTATION_TIMEOUT',
]);

function safeSessionStorage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function rememberPendingChatAgentRun({ agentRunId, conversationId } = {}) {
  if (!agentRunId || !conversationId) return;
  safeSessionStorage()?.setItem(PENDING_CHAT_RUN_KEY, JSON.stringify({
    agentRunId: String(agentRunId),
    conversationId: String(conversationId),
    rememberedAt: new Date().toISOString(),
  }));
}

export function readPendingChatAgentRun() {
  const storage = safeSessionStorage();
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(PENDING_CHAT_RUN_KEY) || 'null');
    if (!value?.agentRunId || !value?.conversationId) return null;
    return value;
  } catch {
    storage.removeItem(PENDING_CHAT_RUN_KEY);
    return null;
  }
}

export function clearPendingChatAgentRun(agentRunId = '') {
  const storage = safeSessionStorage();
  if (!storage) return;
  const current = readPendingChatAgentRun();
  if (!agentRunId || current?.agentRunId === String(agentRunId)) {
    storage.removeItem(PENDING_CHAT_RUN_KEY);
  }
}

export function isAgentRunRecoverableStreamError(errorValue) {
  return RECOVERABLE_STREAM_ERROR_CODES.has(String(errorValue?.code || '').trim().toUpperCase());
}

export async function getAgentRun(agentRunId) {
  const data = await apiFetchJson(
    `/api/agent-runs/${encodeURIComponent(agentRunId)}`,
    { noRetry: true, timeout: 10_000 },
    'The saved agent run could not be checked.',
  );
  return data.run;
}

export async function cancelAgentRun(agentRunId, reason = 'Stopped by the operator from chat.') {
  if (!agentRunId) return null;
  const data = await apiFetchJson(
    `/api/agent-runs/${encodeURIComponent(agentRunId)}/cancel`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestedBy: 'local-operator', reason }),
      noRetry: true,
      timeout: 10_000,
    },
    'The agent run could not be stopped.',
  );
  clearPendingChatAgentRun(agentRunId);
  return data.run;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    let onAbort = null;
    const timer = setTimeout(() => {
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (!signal) return;
    onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Agent-run recovery was cancelled.', 'AbortError'));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function waitForAgentRunTerminal(agentRunId, {
  timeoutMs = 2 * 60 * 1000,
  pollMs = 1000,
  signal,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastRun = null;
  while (Date.now() <= deadline) {
    if (signal?.aborted) throw new DOMException('Agent-run recovery was cancelled.', 'AbortError');
    lastRun = await getAgentRun(agentRunId);
    if (TERMINAL_STATUSES.has(lastRun?.status)) {
      clearPendingChatAgentRun(agentRunId);
      return lastRun;
    }
    await wait(pollMs, signal);
  }
  const error = new Error('The saved agent run is still working, but recovery timed out. Reopen this conversation to check it again.');
  error.code = 'AGENT_RUN_RECOVERY_TIMEOUT';
  error.agentRunId = agentRunId;
  error.run = lastRun;
  throw error;
}

export function agentRunFailureMessage(run) {
  if (run?.status === 'cancelled') return 'The request was stopped.';
  if (run?.status === 'stale') return 'The server restarted or lost the worker before this request finished. Please try again.';
  if (run?.status === 'timed-out') return 'The provider did not finish before the request deadline.';
  if (run?.status === 'incomplete') return 'The response finished without enough saved evidence to mark it complete.';
  return run?.completionError?.message || 'The saved agent run did not complete successfully.';
}
