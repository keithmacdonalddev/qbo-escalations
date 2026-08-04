import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetchJson } from './http.js';
import {
  cancelAgentRun,
  clearPendingChatAgentRun,
  isAgentRunRecoverableStreamError,
  readPendingChatAgentRun,
  rememberPendingChatAgentRun,
  waitForAgentRunTerminal,
} from './agentRunsApi.js';

vi.mock('./http.js', () => ({ apiFetchJson: vi.fn() }));

describe('agentRunsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('remembers and selectively clears the active chat run', () => {
    rememberPendingChatAgentRun({ agentRunId: 'run-1', conversationId: 'conversation-1' });
    expect(readPendingChatAgentRun()).toMatchObject({
      agentRunId: 'run-1',
      conversationId: 'conversation-1',
    });

    clearPendingChatAgentRun('different-run');
    expect(readPendingChatAgentRun()?.agentRunId).toBe('run-1');
    clearPendingChatAgentRun('run-1');
    expect(readPendingChatAgentRun()).toBeNull();
  });

  it('returns a terminal run and clears its recovery marker', async () => {
    rememberPendingChatAgentRun({ agentRunId: 'run-2', conversationId: 'conversation-2' });
    apiFetchJson.mockResolvedValue({ run: { id: 'run-2', status: 'succeeded' } });

    await expect(waitForAgentRunTerminal('run-2')).resolves.toMatchObject({ status: 'succeeded' });
    expect(readPendingChatAgentRun()).toBeNull();
  });

  it('sends an explicit cancellation and clears the recovery marker', async () => {
    rememberPendingChatAgentRun({ agentRunId: 'run-3', conversationId: 'conversation-3' });
    apiFetchJson.mockResolvedValue({ run: { id: 'run-3', status: 'cancelled' } });

    await expect(cancelAgentRun('run-3', 'Stop now.')).resolves.toMatchObject({ status: 'cancelled' });
    expect(apiFetchJson).toHaveBeenCalledWith(
      '/api/agent-runs/run-3/cancel',
      expect.objectContaining({ method: 'POST', noRetry: true }),
      expect.any(String),
    );
    expect(readPendingChatAgentRun()).toBeNull();
  });

  it('recognizes presentation timeout as a recoverable saved-run stream close', () => {
    expect(isAgentRunRecoverableStreamError({ code: 'SSE_PRESENTATION_TIMEOUT' })).toBe(true);
    expect(isAgentRunRecoverableStreamError({ code: 'PROVIDER_EXEC_FAILED' })).toBe(false);
  });
});
