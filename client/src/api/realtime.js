function buildRealtimeUrl(path = '/api/realtime') {
  if (typeof window === 'undefined' || !window.location) return path;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

function createSubscriptionId() {
  return `rt-sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;
const RECONNECT_JITTER_RATIO = 0.2;
const HEARTBEAT_INTERVAL_MS = 20_000;
const STALE_CONNECTION_MS = 55_000;
const MAX_RECENT_EVENT_IDS = 250;

class SharedRealtimeClient {
  constructor(url = buildRealtimeUrl(), options = {}) {
    this.url = url;
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.random = typeof options.random === 'function' ? options.random : () => Math.random();
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || HEARTBEAT_INTERVAL_MS;
    this.staleConnectionMs = options.staleConnectionMs || STALE_CONNECTION_MS;
    this.socket = null;
    this.subscriptions = new Map();
    this.connectionListeners = new Set();
    this.reconnectTimer = 0;
    this.heartbeatTimer = 0;
    this.reconnectAttempt = 0;
    this.manualClose = false;
    this.reconnectRequested = false;
    this.networkListenersInstalled = false;
    this.handleOnline = () => this.reconnectNow('Network connection restored');
    this.handleOffline = () => this.markOffline();
    this.state = {
      state: 'closed',
      connected: false,
      errorCount: 0,
      lastConnectedAt: null,
      lastError: '',
      lastErrorAt: null,
      nextRetryAt: null,
      lastMessageAt: null,
      lastPongAt: null,
      staleSince: null,
      lastRecoveredAt: null,
      updatedAt: this.now(),
    };
  }

  getStateSnapshot() {
    return { ...this.state };
  }

  subscribeConnectionState(callback) {
    if (typeof callback !== 'function') return () => {};
    this.connectionListeners.add(callback);
    callback(this.getStateSnapshot());
    return () => {
      this.connectionListeners.delete(callback);
    };
  }

  subscribe({ channel, key = null, params = {}, onEvent, onError, onSubscribed, onUnsubscribed } = {}) {
    const subscriptionId = createSubscriptionId();
    const entry = {
      id: subscriptionId,
      channel,
      key,
      params: params && typeof params === 'object' ? { ...params } : {},
      lastSeq: Number.isFinite(Number(params?.since)) ? Number(params.since) : 0,
      hasSequencedEvent: Number.isFinite(Number(params?.since)) && Number(params.since) > 0,
      recentEventIds: new Set(),
      recentEventIdQueue: [],
      onEvent,
      onError,
      onSubscribed,
      onUnsubscribed,
    };

    this.subscriptions.set(subscriptionId, entry);
    this.installNetworkListeners();
    this.ensureConnected();
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(entry);
    }

    return () => {
      if (!this.subscriptions.has(subscriptionId)) return;
      this.subscriptions.delete(subscriptionId);
      this.send({
        type: 'unsubscribe',
        subscriptionId,
      });
      this.closeIfIdle();
    };
  }

  hasHealthyConnection() {
    return this.socket?.readyState === WebSocket.OPEN && this.state.connected === true;
  }

  waitForHealthyConnection(timeoutMs = 1500) {
    if (typeof window === 'undefined' || typeof window.WebSocket !== 'function') {
      return Promise.resolve(false);
    }
    if (this.hasHealthyConnection()) return Promise.resolve(true);

    this.ensureConnected();

    return new Promise((resolve) => {
      let settled = false;
      let timer = 0;
      let unsubscribe = () => {};

      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer) window.clearTimeout(timer);
        unsubscribe();
        resolve(value);
      };

      unsubscribe = this.subscribeConnectionState((state) => {
        if (state?.connected) {
          finish(true);
          return;
        }
        if (state?.errorCount > 0 && state?.state !== 'connecting') {
          finish(false);
        }
      });

      timer = window.setTimeout(() => finish(this.hasHealthyConnection()), timeoutMs);
    });
  }

  ensureConnected() {
    if (typeof window === 'undefined' || typeof window.WebSocket !== 'function') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setState({
        state: 'offline',
        connected: false,
        nextRetryAt: null,
        lastError: 'This device is offline',
        lastErrorAt: this.now(),
      });
      return;
    }
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.manualClose = false;
    this.clearReconnectTimer();
    this.socket = new WebSocket(this.url);
    this.setState({
      state: 'connecting',
      connected: false,
      nextRetryAt: null,
    });

    this.socket.addEventListener('open', () => {
      const recovered = this.state.errorCount > 0
        || ['cooldown', 'degraded', 'offline', 'stale'].includes(this.state.state);
      this.reconnectAttempt = 0;
      this.setState({
        state: 'connected',
        connected: true,
        errorCount: 0,
        lastConnectedAt: this.now(),
        lastError: '',
        lastErrorAt: null,
        nextRetryAt: null,
        staleSince: null,
        ...(recovered ? { lastRecoveredAt: this.now() } : {}),
      });
      this.startHeartbeat();

      for (const entry of this.subscriptions.values()) {
        this.sendSubscribe(entry);
      }
    });

    this.socket.addEventListener('message', (event) => {
      this.handleMessage(event?.data);
    });

    this.socket.addEventListener('close', () => {
      this.clearHeartbeat();
      this.socket = null;
      if (this.reconnectRequested) {
        this.reconnectRequested = false;
        this.setState({ state: 'connecting', connected: false, nextRetryAt: null });
        window.setTimeout(() => this.ensureConnected(), 0);
        return;
      }
      if (this.manualClose) {
        this.setState({
          state: 'closed',
          connected: false,
          nextRetryAt: null,
        });
        return;
      }

      this.setState({
        state: 'closed',
        connected: false,
      });
      for (const entry of this.subscriptions.values()) {
        entry.onError?.({
          code: 'REALTIME_DISCONNECTED',
          error: 'Realtime socket closed',
        });
      }
      this.scheduleReconnect('Realtime socket closed');
    });

    this.socket.addEventListener('error', () => {
      this.setState({
        state: 'degraded',
        connected: false,
        lastError: 'Realtime socket error',
        lastErrorAt: this.now(),
      });
      for (const entry of this.subscriptions.values()) {
        entry.onError?.({
          code: 'REALTIME_ERROR',
          error: 'Realtime socket error',
        });
      }
      if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
        try { this.socket.close(4003, 'realtime-error'); } catch { /* close handling will retry when possible */ }
      }
    });
  }

  send(payload) {
    if (!payload || !this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  sendSubscribe(entry) {
    if (!entry) return;
    const params = {
      ...(entry.params || {}),
    };
    if (entry.lastSeq > 0) {
      params.since = entry.lastSeq;
    }

    this.send({
      type: 'subscribe',
      subscriptionId: entry.id,
      channel: entry.channel,
      key: entry.key,
      params,
    });
  }

  handleMessage(rawData) {
    const receivedAt = this.now();
    this.setState({
      lastMessageAt: receivedAt,
      staleSince: null,
    });

    let message = null;
    try {
      message = JSON.parse(String(rawData || ''));
    } catch {
      return;
    }

    if (message?.type === 'hello') return;
    if (message?.type === 'pong') {
      this.setState({ lastPongAt: receivedAt });
      return;
    }

    const entry = message?.subscriptionId ? this.subscriptions.get(message.subscriptionId) : null;
    if (message?.type === 'subscribed') {
      entry?.onSubscribed?.(message);
      return;
    }

    if (message?.type === 'unsubscribed') {
      entry?.onUnsubscribed?.(message);
      return;
    }

    if (message?.type === 'error') {
      entry?.onError?.(message);
      if (!entry && message?.error) {
        this.scheduleReconnect(message.error);
      }
      return;
    }

    if (message?.type !== 'event' || !entry) return;

    const nextSeq = Number(message?.meta?.seq);
    const authoritativeReset = message?.meta?.authoritative === true && message?.meta?.resyncRequired === true;
    const eventId = String(message?.meta?.eventId || message?.data?.eventId || '').trim();
    if (!authoritativeReset && eventId && entry.recentEventIds.has(eventId)) return;
    if (!authoritativeReset && Number.isFinite(nextSeq) && entry.hasSequencedEvent && nextSeq <= entry.lastSeq) return;

    if (authoritativeReset) {
      entry.recentEventIds.clear();
      entry.recentEventIdQueue = [];
      entry.lastSeq = Number.isFinite(nextSeq) ? nextSeq : 0;
      entry.hasSequencedEvent = Number.isFinite(nextSeq);
    }
    if (Number.isFinite(nextSeq)) {
      entry.lastSeq = nextSeq;
      entry.hasSequencedEvent = true;
    }
    if (eventId) {
      entry.recentEventIds.add(eventId);
      entry.recentEventIdQueue.push(eventId);
      while (entry.recentEventIdQueue.length > MAX_RECENT_EVENT_IDS) {
        const oldest = entry.recentEventIdQueue.shift();
        entry.recentEventIds.delete(oldest);
      }
    }

    entry.onEvent?.(message.event, message.data, message.meta || null);
  }

  scheduleReconnect(reason = 'Realtime connection failed') {
    if (this.manualClose || this.subscriptions.size === 0) return;
    if (this.reconnectTimer) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.markOffline();
      return;
    }

    this.reconnectAttempt += 1;
    const exponentialMs = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * (2 ** Math.max(0, this.reconnectAttempt - 1))
    );
    const jitterFactor = (1 - RECONNECT_JITTER_RATIO) + (this.random() * RECONNECT_JITTER_RATIO * 2);
    const delayMs = Math.max(250, Math.min(RECONNECT_MAX_MS, Math.round(exponentialMs * jitterFactor)));
    const nextRetryAt = this.now() + delayMs;
    this.setState({
      state: 'cooldown',
      connected: false,
      errorCount: this.state.errorCount + 1,
      lastError: reason,
      lastErrorAt: this.now(),
      nextRetryAt,
    });

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = 0;
      if (this.subscriptions.size === 0) {
        this.setState({
          state: 'closed',
          connected: false,
          nextRetryAt: null,
        });
        return;
      }
      this.ensureConnected();
    }, delayMs);
  }

  clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = 0;
  }

  startHeartbeat() {
    this.clearHeartbeat();
    const now = this.now();
    this.setState({
      lastMessageAt: now,
      lastPongAt: now,
      staleSince: null,
    });
    this.send({ type: 'ping' });
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      const lastResponseAt = Math.max(
        Number(this.state.lastMessageAt) || 0,
        Number(this.state.lastPongAt) || 0,
        Number(this.state.lastConnectedAt) || 0
      );
      if (lastResponseAt > 0 && this.now() - lastResponseAt > this.staleConnectionMs) {
        const staleSince = this.state.staleSince || this.now();
        this.setState({
          state: 'stale',
          connected: false,
          staleSince,
          lastError: 'Live updates stopped responding',
          lastErrorAt: this.now(),
        });
        try {
          this.socket.close(4000, 'heartbeat-timeout');
        } catch {
          this.scheduleReconnect('Live updates stopped responding');
        }
        return;
      }
      this.send({ type: 'ping' });
    }, this.heartbeatIntervalMs);
  }

  clearHeartbeat() {
    if (!this.heartbeatTimer) return;
    window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = 0;
  }

  installNetworkListeners() {
    if (this.networkListenersInstalled || typeof window === 'undefined') return;
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    this.networkListenersInstalled = true;
  }

  removeNetworkListeners() {
    if (!this.networkListenersInstalled || typeof window === 'undefined') return;
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    this.networkListenersInstalled = false;
  }

  markOffline() {
    this.clearReconnectTimer();
    this.clearHeartbeat();
    this.setState({
      state: 'offline',
      connected: false,
      nextRetryAt: null,
      lastError: 'This device is offline',
      lastErrorAt: this.now(),
    });
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      try { this.socket.close(4001, 'offline'); } catch { /* ignore */ }
    }
  }

  reconnectNow(reason = 'Retry requested') {
    if (this.subscriptions.size === 0) return false;
    this.manualClose = false;
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.markOffline();
      return false;
    }
    this.setState({
      state: 'connecting',
      connected: false,
      nextRetryAt: null,
      lastError: reason,
      lastErrorAt: this.now(),
    });
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      this.reconnectRequested = true;
      try {
        this.socket.close(4002, 'manual-reconnect');
      } catch {
        this.reconnectRequested = false;
        this.socket = null;
        this.ensureConnected();
      }
    } else {
      this.socket = null;
      this.ensureConnected();
    }
    return true;
  }

  closeIfIdle() {
    if (this.subscriptions.size > 0) return;
    this.clearReconnectTimer();
    this.clearHeartbeat();
    this.removeNetworkListeners();
    if (!this.socket) {
      this.setState({
        state: 'closed',
        connected: false,
        nextRetryAt: null,
      });
      return;
    }

    this.manualClose = true;
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close(1000, 'idle');
    } else {
      this.socket = null;
      this.setState({
        state: 'closed',
        connected: false,
        nextRetryAt: null,
      });
    }
  }

  setState(patch = {}) {
    this.state = {
      ...this.state,
      ...patch,
      updatedAt: this.now(),
    };

    for (const listener of this.connectionListeners) {
      try {
        listener(this.getStateSnapshot());
      } catch {
        // Ignore state-listener failures.
      }
    }
  }

  destroy() {
    this.subscriptions.clear();
    this.manualClose = true;
    this.clearReconnectTimer();
    this.clearHeartbeat();
    this.removeNetworkListeners();
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      try { this.socket.close(1000, 'client-destroyed'); } catch { /* ignore */ }
    }
    this.socket = null;
    this.connectionListeners.clear();
  }
}

let sharedRealtimeClient = null;

export function getSharedRealtimeClient() {
  if (!sharedRealtimeClient) {
    sharedRealtimeClient = new SharedRealtimeClient();
  }
  return sharedRealtimeClient;
}

export { SharedRealtimeClient, buildRealtimeUrl };
