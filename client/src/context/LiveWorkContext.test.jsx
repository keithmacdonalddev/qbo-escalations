import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LiveWorkProvider, useLiveWork } from './LiveWorkContext.jsx';

const mocks = vi.hoisted(() => ({
  listAttentionItems: vi.fn(),
  reconnectNow: vi.fn(),
  subscriptions: [],
  connectionListeners: [],
  connection: { state: 'connected', connected: true, errorCount: 0 },
}));

vi.mock('../api/escalationsApi.js', () => ({
  listAttentionItems: mocks.listAttentionItems,
}));

vi.mock('../api/realtime.js', () => ({
  getSharedRealtimeClient: () => ({
    getStateSnapshot: () => ({ ...mocks.connection }),
    subscribeConnectionState: (callback) => {
      mocks.connectionListeners.push(callback);
      callback({ ...mocks.connection });
      return vi.fn();
    },
    subscribe: (options) => {
      mocks.subscriptions.push(options);
      return vi.fn();
    },
    reconnectNow: mocks.reconnectNow,
  }),
}));

function Harness() {
  const live = useLiveWork();
  return (
    <div>
      <span data-testid="status">{live.status}</span>
      <span data-testid="active">{live.activeWork.length}</span>
      <span data-testid="attention">{live.attention.counts.open}</span>
      <span data-testid="knowledge">{live.sidebarBadges['#/knowledge'].count}</span>
      <span data-testid="owner">{live.activeWork[0]?.owner || ''}</span>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.subscriptions = [];
  mocks.connectionListeners = [];
  mocks.connection = { state: 'connected', connected: true, errorCount: 0 };
  mocks.listAttentionItems.mockResolvedValue({
    items: [{ _id: 'attention-1', title: 'Review this', kind: 'knowledge-review' }],
    total: 2,
    counts: { open: 2, resolved: 0, dismissed: 0, split: 0 },
    kindCounts: { 'knowledge-review': 1 },
    severityCounts: { critical: 0, warning: 1, info: 1 },
  });
});

it('combines authoritative Attention data with live work snapshots and preserves it while stale', async () => {
  render(<LiveWorkProvider><Harness /></LiveWorkProvider>);
  expect(mocks.subscriptions).toHaveLength(1);

  act(() => {
    mocks.subscriptions[0].onEvent('snapshot', {
      workItems: [{
        id: 'agent:1',
        source: 'agent-session',
        kind: 'workspace',
        title: 'Workspace Agent',
        owner: 'Workspace Agent',
        status: 'running',
        updatedAt: new Date().toISOString(),
      }],
    });
  });
  await waitFor(() => expect(screen.getByTestId('attention')).toHaveTextContent('2'));
  expect(screen.getByTestId('active')).toHaveTextContent('1');
  expect(screen.getByTestId('owner')).toHaveTextContent('Workspace Agent');
  expect(screen.getByTestId('knowledge')).toHaveTextContent('1');

  act(() => {
    mocks.connectionListeners[0]({ state: 'stale', connected: false, errorCount: 1 });
  });
  expect(screen.getByTestId('status')).toHaveTextContent('stale');
  expect(screen.getByTestId('attention')).toHaveTextContent('2');
  expect(screen.getByTestId('active')).toHaveTextContent('1');
});

it('refreshes sidebar counts when an Attention event arrives', async () => {
  render(<LiveWorkProvider><Harness /></LiveWorkProvider>);
  act(() => mocks.subscriptions[0].onEvent('snapshot', { workItems: [] }));
  await waitFor(() => expect(screen.getByTestId('attention')).toHaveTextContent('2'));

  mocks.listAttentionItems.mockResolvedValueOnce({
    items: [],
    total: 0,
    counts: { open: 0, resolved: 2, dismissed: 0, split: 0 },
    kindCounts: {},
    severityCounts: { critical: 0, warning: 0, info: 0 },
  });
  act(() => mocks.subscriptions[0].onEvent('attention.changed', { eventId: 'attention-event-1' }));
  await waitFor(() => expect(screen.getByTestId('attention')).toHaveTextContent('0'));
  expect(screen.getByTestId('knowledge')).toHaveTextContent('0');
});

it('does not claim live updates when the running server rejects the work-center channel', async () => {
  render(<LiveWorkProvider><Harness /></LiveWorkProvider>);
  await waitFor(() => expect(screen.getByTestId('attention')).toHaveTextContent('2'));

  act(() => {
    mocks.subscriptions[0].onError({
      code: 'UNKNOWN_CHANNEL',
      error: 'Unknown realtime channel: work-center',
    });
  });

  expect(screen.getByTestId('status')).toHaveTextContent('stale');
  expect(screen.getByTestId('attention')).toHaveTextContent('2');
});
