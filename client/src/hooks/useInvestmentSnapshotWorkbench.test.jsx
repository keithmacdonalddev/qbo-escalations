import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useInvestmentSnapshotWorkbench from './useInvestmentSnapshotWorkbench.js';
import { getSnapshotRun, getSnapshotWorkbench } from '../api/investments.js';

vi.mock('../api/investments.js', () => ({
  deleteLocalInvestmentData: vi.fn(),
  forceSnapshotReplayGap: vi.fn(),
  getSnapshotRun: vi.fn(),
  getSnapshotWorkbench: vi.fn(),
  selectSnapshotDevScenario: vi.fn(),
  startSnapshotRun: vi.fn(),
}));

const realtime = {
  getStateSnapshot: () => ({ connected: true, state: 'connected' }),
  reconnectNow: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
  subscribeConnectionState: vi.fn((callback) => {
    callback({ connected: true, state: 'connected' });
    return vi.fn();
  }),
};

vi.mock('../api/realtime.js', () => ({ getSharedRealtimeClient: () => realtime }));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function workbench(status) {
  return {
    account: { accountKey: 'safe-stage3a-account-01' },
    activeRun: status === 'running' ? { runId: 'safe-stage3a-run-01', status } : null,
    latestRun: { runId: 'safe-stage3a-run-01', status },
    latestSnapshot: status === 'completed' ? { snapshotId: 'safe-stage3a-snapshot-01' } : null,
    readiness: 'ready',
    scenarios: [],
    storedCounts: { total: status === 'completed' ? 3 : 2 },
  };
}

describe('useInvestmentSnapshotWorkbench', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realtime.subscribe.mockImplementation(() => vi.fn());
    realtime.subscribeConnectionState.mockImplementation((callback) => {
      callback({ connected: true, state: 'connected' });
      return vi.fn();
    });
  });

  it('does not let an older running response replace newer completed evidence', async () => {
    const older = deferred();
    const newer = deferred();
    getSnapshotWorkbench
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    const { result } = renderHook(() => useInvestmentSnapshotWorkbench());
    await waitFor(() => expect(getSnapshotWorkbench).toHaveBeenCalledTimes(1));

    let refreshPromise;
    act(() => { refreshPromise = result.current.refresh(); });
    await waitFor(() => expect(getSnapshotWorkbench).toHaveBeenCalledTimes(2));

    await act(async () => {
      newer.resolve(workbench('completed'));
      await refreshPromise;
    });
    expect(result.current.workbench.latestRun.status).toBe('completed');

    await act(async () => { older.resolve(workbench('running')); await older.promise; });
    expect(result.current.workbench.latestRun.status).toBe('completed');
    expect(result.current.workbench.activeRun).toBeNull();
  });

  it('uses authoritative run polling as a backstop even while the socket is connected', async () => {
    getSnapshotWorkbench
      .mockResolvedValueOnce(workbench('running'))
      .mockResolvedValueOnce(workbench('incomplete'));
    getSnapshotRun.mockResolvedValue({ run: { runId: 'safe-stage3a-run-01', status: 'incomplete' } });

    const { result } = renderHook(() => useInvestmentSnapshotWorkbench());
    await waitFor(() => expect(result.current.workbench?.activeRun?.status).toBe('running'));
    await waitFor(() => expect(getSnapshotRun).toHaveBeenCalledWith('safe-stage3a-run-01'), { timeout: 2000 });
    await waitFor(() => expect(result.current.workbench?.latestRun?.status).toBe('incomplete'));
    expect(result.current.workbench.activeRun).toBeNull();
  });
});
