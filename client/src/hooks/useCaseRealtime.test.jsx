import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import useCaseRealtime from './useCaseRealtime.js';
import RealtimeStatusPill from '../components/RealtimeStatusPill.jsx';

const fake = vi.hoisted(() => ({
  subscriptions: [],
  connectionListeners: [],
  reconnectNow: vi.fn(() => true),
  state: { state: 'connected', connected: true, errorCount: 0 },
}));

vi.mock('../api/realtime.js', () => ({
  getSharedRealtimeClient: () => ({
    getStateSnapshot: () => ({ ...fake.state }),
    subscribeConnectionState: (callback) => {
      fake.connectionListeners.push(callback);
      callback({ ...fake.state });
      return vi.fn();
    },
    subscribe: (options) => {
      fake.subscriptions.push(options);
      return vi.fn();
    },
    reconnectNow: fake.reconnectNow,
  }),
}));

function Harness({ name, onSync }) {
  const realtime = useCaseRealtime({ onSync });
  return <div><span>{name}</span><RealtimeStatusPill realtime={realtime} /></div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.subscriptions = [];
  fake.connectionListeners = [];
  fake.state = { state: 'connected', connected: true, errorCount: 0 };
});

it('coalesces a live event into an authoritative refresh for every mounted tab', async () => {
  vi.useFakeTimers();
  const syncOne = vi.fn().mockResolvedValue(undefined);
  const syncTwo = vi.fn().mockResolvedValue(undefined);
  render(<><Harness name="Tab one" onSync={syncOne} /><Harness name="Tab two" onSync={syncTwo} /></>);
  expect(fake.subscriptions).toHaveLength(2);

  const event = { eventId: 'evt-1', entityType: 'escalation', escalationId: 'esc-1' };
  act(() => {
    for (const subscription of fake.subscriptions) {
      subscription.onEvent('escalation.updated', event, { seq: 1 });
    }
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(120); });
  expect(syncOne).toHaveBeenCalledWith({ reason: 'live-event', event });
  expect(syncTwo).toHaveBeenCalledWith({ reason: 'live-event', event });
  vi.useRealTimers();
});

it('shows truthful offline state and lets the user retry', async () => {
  const user = userEvent.setup();
  const sync = vi.fn().mockResolvedValue(undefined);
  render(<Harness name="Current tab" onSync={sync} />);
  act(() => {
    fake.connectionListeners[0]({ state: 'offline', connected: false, errorCount: 1 });
  });

  const retry = screen.getByRole('button', { name: /Offline.*Retry live updates/i });
  expect(retry).toBeVisible();
  await user.click(retry);
  expect(fake.reconnectNow).toHaveBeenCalled();
  expect(sync).toHaveBeenCalledWith({ reason: 'manual-retry', event: null });
});
