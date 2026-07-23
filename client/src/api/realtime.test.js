import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedRealtimeClient } from './realtime.js';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.listeners = new Map();
    this.sent = [];
    this.closeCode = null;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, detail = {}) {
    for (const listener of this.listeners.get(type) || []) listener(detail);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open');
  }

  message(payload) {
    this.emit('message', { data: JSON.stringify(payload) });
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close(code = 1000) {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.closeCode = code;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', { code });
  }
}

describe('SharedRealtimeClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deduplicates ordered events and accepts an authoritative cursor reset', () => {
    const events = [];
    const client = new SharedRealtimeClient('ws://example.test/api/realtime', {
      random: () => 0.5,
    });
    client.subscribe({
      channel: 'case-workflow',
      key: 'all',
      onEvent: (type, data) => events.push([type, data]),
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();

    socket.message({
      type: 'event', subscriptionId: socket.sent.find((item) => item.type === 'subscribe').subscriptionId,
      event: 'snapshot', data: { cursor: 5 }, meta: { seq: 5, authoritative: true },
    });
    const subscriptionId = socket.sent.find((item) => item.type === 'subscribe').subscriptionId;
    const live = {
      type: 'event', subscriptionId, event: 'escalation.updated',
      data: { eventId: 'evt-6' }, meta: { seq: 6, eventId: 'evt-6' },
    };
    socket.message(live);
    socket.message(live);
    socket.message({ ...live, data: { eventId: 'evt-5' }, meta: { seq: 5, eventId: 'evt-5' } });
    expect(events.map(([type]) => type)).toEqual(['snapshot', 'escalation.updated']);

    socket.message({
      type: 'event', subscriptionId, event: 'snapshot', data: { cursor: 1 },
      meta: { seq: 1, authoritative: true, resyncRequired: true },
    });
    socket.message({
      type: 'event', subscriptionId, event: 'knowledge.created',
      data: { eventId: 'evt-new-2' }, meta: { seq: 2, eventId: 'evt-new-2' },
    });
    expect(events.map(([type]) => type)).toEqual([
      'snapshot', 'escalation.updated', 'snapshot', 'knowledge.created',
    ]);
    client.destroy();
  });

  it('reconnects with bounded jitter and resubscribes from the last cursor', async () => {
    const client = new SharedRealtimeClient('ws://example.test/api/realtime', {
      random: () => 0,
    });
    client.subscribe({ channel: 'case-workflow', key: 'all', onEvent: vi.fn() });
    const first = FakeWebSocket.instances[0];
    first.open();
    const subscriptionId = first.sent.find((item) => item.type === 'subscribe').subscriptionId;
    first.message({
      type: 'event', subscriptionId, event: 'escalation.updated',
      data: { eventId: 'evt-7' }, meta: { seq: 7, eventId: 'evt-7' },
    });

    first.close(1006);
    const state = client.getStateSnapshot();
    expect(state.state).toBe('cooldown');
    expect(state.nextRetryAt - state.updatedAt).toBe(800);
    await vi.advanceTimersByTimeAsync(800);
    const second = FakeWebSocket.instances[1];
    second.open();
    expect(second.sent.find((item) => item.type === 'subscribe').params.since).toBe(7);
    client.destroy();
  });

  it('closes an unresponsive connection and offers an immediate manual retry', async () => {
    const client = new SharedRealtimeClient('ws://example.test/api/realtime', {
      random: () => 0.5,
      heartbeatIntervalMs: 10,
      staleConnectionMs: 25,
    });
    client.subscribe({ channel: 'case-workflow', key: 'all' });
    const first = FakeWebSocket.instances[0];
    first.open();
    await vi.advanceTimersByTimeAsync(30);
    expect(first.closeCode).toBe(4000);
    expect(client.getStateSnapshot().connected).toBe(false);

    expect(client.reconnectNow()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
    client.destroy();
  });
});
