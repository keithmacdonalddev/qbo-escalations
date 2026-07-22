import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EvidenceRecoveryPanel, { EvidenceRecoveryCompletionNotices } from './EvidenceRecoveryPanel.jsx';
import { useEvidenceRecovery, useEvidenceRecoveryMonitor } from './useEvidenceRecovery.js';

const mocks = vi.hoisted(() => ({
  acceptEvidenceRecoveryCandidate: vi.fn(),
  cancelEvidenceRecovery: vi.fn(),
  confirmEvidenceRecovery: vi.fn(),
  getConversationMeta: vi.fn(),
  getEvidenceRecoveryOperation: vi.fn(),
  getEvidenceRecoveryOptions: vi.fn(),
  listActiveEvidenceRecoveries: vi.fn(),
  onConversationRefresh: vi.fn(),
  onEvidenceRefresh: vi.fn(),
}));

vi.mock('../../api/evidenceRecoveryApi.js', () => ({
  acceptEvidenceRecoveryCandidate: mocks.acceptEvidenceRecoveryCandidate,
  cancelEvidenceRecovery: mocks.cancelEvidenceRecovery,
  confirmEvidenceRecovery: mocks.confirmEvidenceRecovery,
  getEvidenceRecoveryOperation: mocks.getEvidenceRecoveryOperation,
  getEvidenceRecoveryOptions: mocks.getEvidenceRecoveryOptions,
  listActiveEvidenceRecoveries: mocks.listActiveEvidenceRecoveries,
}));

vi.mock('../../api/chatApi.js', () => ({
  getConversationMeta: mocks.getConversationMeta,
}));

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

const STORAGE_KEY = 'qbo.evidenceRecovery.operations.v1';
const FINGERPRINT = {
  contractVersion: 1,
  evidenceUpdatedAt: '2026-07-22T12:00:00.000Z',
  missingCodes: ['TRIAGE_CARD'],
};

function makeOption(overrides = {}) {
  return {
    planId: 'plan-current-evidence',
    strategy: 'repersist',
    recommended: true,
    reason: 'Repair the missing save from the already validated result.',
    aiCallNeeded: false,
    estimatedDuration: 'Usually less than a minute.',
    cancellationBoundary: 'You can cancel before the saved update is committed.',
    artifacts: [{ code: 'TRIAGE_CARD', label: 'Triage card' }],
    evidenceFingerprint: FINGERPRINT,
    ...overrides,
  };
}

function makeRecovery(option = makeOption()) {
  return { evidenceFingerprint: FINGERPRINT, options: [option] };
}

async function flushReactWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function EvidenceChangedHarness() {
  const controller = useEvidenceRecovery({
    conversationId: 'conversation-evidence-changed',
    onEvidenceRefresh: mocks.onEvidenceRefresh,
  });
  return (
    <>
      <button type="button" onClick={controller.openRecovery}>Open recovery</button>
      <EvidenceRecoveryPanel controller={controller} />
    </>
  );
}

function CompletionNoticeHarness() {
  const monitor = useEvidenceRecoveryMonitor({
    enabled: true,
    notify: true,
    currentConversationId: '',
    currentConversationVisible: false,
  });
  return (
    <EvidenceRecoveryCompletionNotices
      notices={monitor.completionNotices}
      onDismiss={monitor.dismissCompletionNotice}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', createMemoryStorage());
  mocks.listActiveEvidenceRecoveries.mockResolvedValue({ operations: [] });
  mocks.getConversationMeta.mockResolvedValue({ title: 'Recovered payroll session' });
  mocks.getEvidenceRecoveryOptions.mockResolvedValue({ recovery: makeRecovery() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useEvidenceRecovery confirmation', () => {
  it('sends the exact plan and fingerprint, reuses a key for a retry, and creates a fresh key for a new confirmation', async () => {
    const randomUUID = vi.fn()
      .mockReturnValueOnce('confirmation-key-1')
      .mockReturnValueOnce('confirmation-key-2');
    vi.stubGlobal('crypto', { randomUUID });
    const retryableError = Object.assign(new Error('The recovery service is temporarily unavailable.'), {
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    });
    mocks.confirmEvidenceRecovery
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValueOnce({
        operation: { operationId: 'operation-first', strategy: 'repersist', status: 'failed' },
      })
      .mockResolvedValueOnce({
        operation: { operationId: 'operation-second', strategy: 'repersist', status: 'failed' },
      });
    const option = makeOption();
    const { result } = renderHook(() => useEvidenceRecovery({ conversationId: 'conversation-confirm' }));
    await flushReactWork();

    await act(async () => {
      await result.current.confirmRecovery(option);
    });
    await act(async () => {
      await result.current.confirmRecovery(option);
    });
    await act(async () => {
      await result.current.confirmRecovery(option);
    });

    expect(mocks.confirmEvidenceRecovery).toHaveBeenCalledTimes(3);
    expect(mocks.confirmEvidenceRecovery.mock.calls[0]).toEqual([
      'conversation-confirm',
      {
        action: 'plan-current-evidence',
        evidenceFingerprint: FINGERPRINT,
        idempotencyKey: 'confirmation-key-1',
      },
    ]);
    expect(mocks.confirmEvidenceRecovery.mock.calls[1][1].idempotencyKey).toBe('confirmation-key-1');
    expect(mocks.confirmEvidenceRecovery.mock.calls[2][1].idempotencyKey).toBe('confirmation-key-2');
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });

  it('does not silently retry EVIDENCE_CHANGED and shows refreshed choices with a plain explanation', async () => {
    const user = userEvent.setup();
    const refreshed = makeOption({
      planId: 'plan-refreshed-evidence',
      reason: 'Use the newly verified saved result.',
    });
    mocks.getEvidenceRecoveryOptions
      .mockResolvedValueOnce({ recovery: makeRecovery() })
      .mockResolvedValueOnce({ recovery: makeRecovery(refreshed) });
    mocks.confirmEvidenceRecovery.mockRejectedValue(Object.assign(
      new Error('Conversation evidence changed.'),
      { code: 'EVIDENCE_CHANGED', status: 409 },
    ));

    render(<EvidenceChangedHarness />);

    await user.click(screen.getByRole('button', { name: 'Open recovery' }));
    await user.click(await screen.findByRole('button', { name: 'Start recovery' }));

    expect(await screen.findByText(
      'The saved evidence changed before recovery started. The options below have been refreshed.',
    )).toBeVisible();
    expect(screen.getByRole('heading', { name: refreshed.reason })).toBeVisible();
    expect(mocks.confirmEvidenceRecovery).toHaveBeenCalledOnce();
    expect(mocks.getEvidenceRecoveryOptions).toHaveBeenCalledTimes(2);
    expect(mocks.onEvidenceRefresh).toHaveBeenCalledOnce();
  });

  it('never accepts an awaiting candidate automatically and sends only explicitly supplied comparison hashes', async () => {
    vi.useFakeTimers();
    const option = makeOption({ strategy: 'rerun-stage', aiCallNeeded: true });
    mocks.confirmEvidenceRecovery.mockResolvedValue({
      operation: {
        operationId: 'operation-awaiting-acceptance',
        strategy: 'rerun-stage',
        status: 'awaiting-acceptance',
      },
    });
    mocks.acceptEvidenceRecoveryCandidate.mockResolvedValue({
      operation: {
        operationId: 'operation-awaiting-acceptance',
        strategy: 'rerun-stage',
        status: 'succeeded',
      },
    });
    const { result } = renderHook(() => useEvidenceRecovery({
      conversationId: 'conversation-accept',
      onConversationRefresh: mocks.onConversationRefresh,
    }));
    await flushReactWork();

    await act(async () => {
      await result.current.confirmRecovery(option);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(result.current.operation.status).toBe('awaiting-acceptance');
    expect(mocks.acceptEvidenceRecoveryCandidate).not.toHaveBeenCalled();
    expect(mocks.onConversationRefresh).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.acceptCandidate({
        candidateSha256: 'candidate-sha-256',
        previousSha256: 'previous-sha-256',
      });
    });

    expect(mocks.acceptEvidenceRecoveryCandidate).toHaveBeenCalledOnce();
    expect(mocks.acceptEvidenceRecoveryCandidate).toHaveBeenCalledWith(
      'conversation-accept',
      'operation-awaiting-acceptance',
      {
        candidateSha256: 'candidate-sha-256',
        previousSha256: 'previous-sha-256',
      },
    );
    expect(mocks.onConversationRefresh).toHaveBeenCalledOnce();
    expect(mocks.onConversationRefresh).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'operation-awaiting-acceptance',
      status: 'succeeded',
    }));
  });
});

describe('useEvidenceRecovery polling', () => {
  it.each(['succeeded', 'failed', 'cancelled', 'interrupted', 'manual-review'])(
    'stops polling when the operation becomes %s',
    async (terminalStatus) => {
      vi.useFakeTimers();
      mocks.confirmEvidenceRecovery.mockResolvedValue({
        operation: { operationId: `operation-${terminalStatus}`, status: 'confirmed', strategy: 'repersist' },
      });
      mocks.getEvidenceRecoveryOperation.mockResolvedValue({
        operation: { operationId: `operation-${terminalStatus}`, status: terminalStatus, strategy: 'repersist' },
      });
      const { result } = renderHook(() => useEvidenceRecovery({
        conversationId: `conversation-${terminalStatus}`,
      }));
      await flushReactWork();

      await act(async () => {
        await result.current.confirmRecovery(makeOption());
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_500);
      });

      expect(result.current.operation.status).toBe(terminalStatus);
      expect(mocks.getEvidenceRecoveryOperation).toHaveBeenCalledOnce();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(mocks.getEvidenceRecoveryOperation).toHaveBeenCalledOnce();
    },
  );

  it('clears the polling timer on unmount', async () => {
    vi.useFakeTimers();
    mocks.confirmEvidenceRecovery.mockResolvedValue({
      operation: { operationId: 'operation-unmount', status: 'confirmed', strategy: 'repersist' },
    });
    const { result, unmount } = renderHook(() => useEvidenceRecovery({
      conversationId: 'conversation-unmount',
    }));
    await flushReactWork();

    await act(async () => {
      await result.current.confirmRecovery(makeOption());
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(mocks.getEvidenceRecoveryOperation).not.toHaveBeenCalled();
  });

  it('keeps polling while cancellation is waiting for server confirmation', async () => {
    vi.useFakeTimers();
    mocks.confirmEvidenceRecovery.mockResolvedValue({
      operation: {
        operationId: 'operation-cancelling',
        status: 'cancel-requested',
        strategy: 'rerun-stage',
      },
    });
    mocks.getEvidenceRecoveryOperation
      .mockResolvedValueOnce({
        operation: {
          operationId: 'operation-cancelling',
          status: 'cancel-requested',
          strategy: 'rerun-stage',
        },
      })
      .mockResolvedValueOnce({
        operation: {
          operationId: 'operation-cancelling',
          status: 'cancelled',
          strategy: 'rerun-stage',
        },
      });
    const { result } = renderHook(() => useEvidenceRecovery({
      conversationId: 'conversation-cancelling',
    }));
    await flushReactWork();

    await act(async () => {
      await result.current.confirmRecovery(makeOption({ strategy: 'rerun-stage' }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });

    expect(result.current.operation.status).toBe('cancel-requested');
    expect(mocks.getEvidenceRecoveryOperation).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });

    expect(result.current.operation.status).toBe('cancelled');
    expect(mocks.getEvidenceRecoveryOperation).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mocks.getEvidenceRecoveryOperation).toHaveBeenCalledTimes(2);
  });

  it('explains when cancellation arrived after recovery had already completed', async () => {
    mocks.confirmEvidenceRecovery.mockResolvedValue({
      operation: { operationId: 'operation-too-late', status: 'running', strategy: 'repersist' },
    });
    mocks.cancelEvidenceRecovery.mockResolvedValue({
      alreadyCompleted: true,
      operation: { operationId: 'operation-too-late', status: 'succeeded', strategy: 'repersist' },
    });
    const { result } = renderHook(() => useEvidenceRecovery({
      conversationId: 'conversation-too-late',
    }));
    await flushReactWork();

    await act(async () => {
      await result.current.confirmRecovery(makeOption());
    });
    await act(async () => {
      await result.current.requestCancel();
    });

    expect(result.current.operation.status).toBe('succeeded');
    expect(result.current.operationError).toBe(
      'Too late to cancel — recovery had already finished; nothing was lost.',
    );
  });

  it('reattaches to an existing conversation operation and resumes polling without confirming again', async () => {
    vi.useFakeTimers();
    mocks.listActiveEvidenceRecoveries.mockResolvedValue({
      operations: [{
        operationId: 'operation-reattach',
        conversationId: 'conversation-reattach',
        status: 'running',
        strategy: 'repersist',
      }],
    });
    mocks.getEvidenceRecoveryOperation
      .mockResolvedValueOnce({
        operation: {
          operationId: 'operation-reattach',
          conversationId: 'conversation-reattach',
          status: 'running',
          strategy: 'repersist',
        },
      })
      .mockResolvedValueOnce({
        operation: {
          operationId: 'operation-reattach',
          conversationId: 'conversation-reattach',
          status: 'succeeded',
          strategy: 'repersist',
        },
      });

    const { result } = renderHook(() => useEvidenceRecovery({
      conversationId: 'conversation-reattach',
    }));
    await flushReactWork();

    expect(result.current.operation).toMatchObject({
      operationId: 'operation-reattach',
      status: 'running',
    });
    expect(mocks.confirmEvidenceRecovery).not.toHaveBeenCalled();
    expect(mocks.getEvidenceRecoveryOperation).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });

    expect(result.current.operation.status).toBe('succeeded');
    expect(mocks.getEvidenceRecoveryOperation).toHaveBeenCalledTimes(2);
    expect(mocks.confirmEvidenceRecovery).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(mocks.getEvidenceRecoveryOperation).toHaveBeenCalledTimes(2);
  });
});

describe('useEvidenceRecoveryMonitor completion notice', () => {
  it('shows a dismissible notice when a confirmed operation finishes while its panel is closed', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      'conversation-notice': {
        conversationId: 'conversation-notice',
        operationId: 'operation-notice',
        status: 'confirmed',
        updatedAt: '2026-07-22T12:00:00.000Z',
      },
    }));
    mocks.getEvidenceRecoveryOperation.mockResolvedValue({
      operation: {
        conversationId: 'conversation-notice',
        operationId: 'operation-notice',
        status: 'succeeded',
      },
    });

    render(<CompletionNoticeHarness />);

    expect(await screen.findByText(/Recovery finished for Recovered payroll session/)).toBeVisible();
    await user.click(screen.getByRole('button', {
      name: 'Dismiss recovery notice for Recovered payroll session',
    }));

    await waitFor(() => {
      expect(screen.queryByText(/Recovery finished for Recovered payroll session/)).not.toBeInTheDocument();
    });
    expect(mocks.confirmEvidenceRecovery).not.toHaveBeenCalled();
    expect(mocks.acceptEvidenceRecoveryCandidate).not.toHaveBeenCalled();
    expect(mocks.cancelEvidenceRecovery).not.toHaveBeenCalled();
  });
});
