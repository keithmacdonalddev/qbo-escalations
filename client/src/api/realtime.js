function buildRealtimeUrl(path = '/api/realtime') {
  if (typeof window === 'undefined' || !window.location) return path;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

function createSubscriptionId() {
  return `rt-sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

class SharedRealtimeClient {
  constructor(url = buildRealtimeUrl()) {
    this.url = url;
    this.socket = null;
    this.subscriptions = new Map();
    this.connectionListeners = new Set();
    this.reconnectTimer = 0;
    this.reconnectAttempt = 0;
    this.manualClose = false;
    this.state = {
      state: 'closed',
      connected: false,
      errorCount: 0,
      lastConnectedAt: null,
      lastError: '',
      lastErrorAt: null,
      nextRetryAt: null,
      updatedAt: Date.now(),
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
      onEvent,
      onError,
      onSubscribed,
      onUnsubscribed,
    };

    this.subscriptions.set(subscriptionId, entry);
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
      this.reconnectAttempt = 0;
      this.setState({
        state: 'connected',
        connected: true,
        errorCount: 0,
        lastConnectedAt: Date.now(),
        lastError: '',
        lastErrorAt: null,
        nextRetryAt: null,
      });

      for (const entry of this.subscriptions.values()) {
        this.sendSubscribe(entry);
      }
    });

    this.socket.addEventListener('message', (event) => {
      this.handleMessage(event?.data);
    });

    this.socket.addEventListener('close', () => {
      this.socket = null;
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
        connected: false,
      });
      for (const entry of this.subscriptions.values()) {
        entry.onError?.({
          code: 'REALTIME_ERROR',
          error: 'Realtime socket error',
        });
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
    let message = null;
    try {
      message = JSON.parse(String(rawData || ''));
    } catch {
      return;
    }

    if (message?.type === 'hello' || message?.type === 'pong') return;

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
    if (Number.isFinite(nextSeq)) {
      entry.lastSeq = Math.max(entry.lastSeq || 0, nextSeq);
    }

    entry.onEvent?.(message.event, message.data, message.meta || null);
  }

  scheduleReconnect(reason = 'Realtime connection failed') {
    if (this.manualClose || this.subscriptions.size === 0) return;
    if (this.reconnectTimer) return;

    this.reconnectAttempt += 1;
    const delayMs = Math.min(15_000, 1_000 * (2 ** Math.max(0, this.reconnectAttempt - 1)));
    const nextRetryAt = Date.now() + delayMs;
    this.setState({
      state: 'cooldown',
      connected: false,
      errorCount: this.state.errorCount + 1,
      lastError: reason,
      lastErrorAt: Date.now(),
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

  closeIfIdle() {
    if (this.subscriptions.size > 0) return;
    this.clearReconnectTimer();
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
      updatedAt: Date.now(),
    };

    for (const listener of this.connectionListeners) {
      try {
        listener(this.getStateSnapshot());
      } catch {
        // Ignore state-listener failures.
      }
    }
  }
}

let sharedRealtimeClient = null;

export function getSharedRealtimeClient() {
  if (!sharedRealtimeClient) {
    sharedRealtimeClient = new SharedRealtimeClient();
  }
  return sharedRealtimeClient;
}

export { buildRealtimeUrl };
