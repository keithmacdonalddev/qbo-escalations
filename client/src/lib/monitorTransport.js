const transports = new Map();
const subscribers = new Set();
const commandSubscribers = new Map();

function emit() {
  for (const subscriber of subscribers) {
    try {
      subscriber();
    } catch {
      // Ignore subscriber failures.
    }
  }
}

function cloneTransport(entry) {
  const now = Date.now();
  return {
    key: entry.key,
    label: entry.label || entry.key,
    url: entry.url || '',
    state: entry.state || 'closed',
    errorCount: entry.errorCount || 0,
    lastEventAt: entry.lastEventAt || null,
    lastConnectedAt: entry.lastConnectedAt || null,
    lastErrorAt: entry.lastErrorAt || null,
    nextRetryAt: entry.nextRetryAt || null,
    lastError: entry.lastError || '',
    updatedAt: entry.updatedAt || null,
    idleMs: entry.lastEventAt ? now - entry.lastEventAt : null,
    retryInMs: entry.nextRetryAt ? Math.max(0, entry.nextRetryAt - now) : 0,
  };
}

function computeSnapshot() {
  const items = [...transports.values()]
    .sort((a, b) => String(a.label || a.key).localeCompare(String(b.label || b.key)))
    .map(cloneTransport);

  return {
    items,
    connectedCount: items.filter((item) => item.state === 'connected').length,
    connectingCount: items.filter((item) => item.state === 'connecting').length,
    cooldownCount: items.filter((item) => item.state === 'cooldown').length,
    degradedCount: items.filter((item) => item.state === 'degraded').length,
    closedCount: items.filter((item) => item.state === 'closed').length,
  };
}

function setMonitorTransport(key, patch = {}) {
  if (!key) return computeSnapshot();
  const current = transports.get(key) || {
    key,
    label: patch.label || key,
    url: patch.url || '',
    state: 'closed',
    errorCount: 0,
    lastEventAt: null,
    lastConnectedAt: null,
    lastErrorAt: null,
    nextRetryAt: null,
    lastError: '',
    updatedAt: Date.now(),
  };

  const next = {
    ...current,
    ...patch,
    key,
    label: patch.label || current.label || key,
    updatedAt: Date.now(),
  };

  transports.set(key, next);
  emit();
  return computeSnapshot();
}

function clearMonitorTransport(key) {
  if (!key) return computeSnapshot();
  transports.delete(key);
  emit();
  return computeSnapshot();
}

function getMonitorTransportSnapshot() {
  return computeSnapshot();
}

function subscribeMonitorTransports(callback) {
  if (typeof callback !== 'function') return () => {};
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

function subscribeMonitorTransportCommands(key, callback) {
  if (!key || typeof callback !== 'function') return () => {};
  const set = commandSubscribers.get(key) || new Set();
  set.add(callback);
  commandSubscribers.set(key, set);
  return () => {
    const current = commandSubscribers.get(key);
    if (!current) return;
    current.delete(callback);
    if (current.size === 0) {
      commandSubscribers.delete(key);
    }
  };
}

function requestMonitorTransportReconnect(key, detail = {}) {
  if (!key) return false;
  const listeners = commandSubscribers.get(key);
  if (!listeners || listeners.size === 0) return false;
  for (const listener of listeners) {
    try {
      listener({
        ...detail,
        requestedAt: Date.now(),
      });
    } catch {
      // Ignore command listener failures.
    }
  }
  return true;
}

export {
  setMonitorTransport,
  clearMonitorTransport,
  getMonitorTransportSnapshot,
  subscribeMonitorTransports,
  subscribeMonitorTransportCommands,
  requestMonitorTransportReconnect,
};
