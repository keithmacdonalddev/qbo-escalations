'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const { isAllowedOrigin } = require('../lib/origin-policy');
const workspaceMonitorChannel = require('./realtime-channels/workspace-monitor');
const agentSessionChannel = require('./realtime-channels/agent-session');
const roomChannel = require('./realtime-channels/room');

const REALTIME_PATH = '/api/realtime';
const HEARTBEAT_INTERVAL_MS = 25_000;

const channelHandlers = new Map([
  ['workspace-monitor', workspaceMonitorChannel],
  ['agent-session', agentSessionChannel],
  ['room', roomChannel],
]);

let _websocketServer = null;
let _attachedServer = null;
let _upgradeHandler = null;
let _heartbeatTimer = null;
let _clientCounter = 0;
const _clients = new Map();

function createProtocolError(code, error, detail = '') {
  const err = new Error(error);
  err.code = code;
  err.detail = detail;
  return err;
}

function attachSubscriptionId(err, subscriptionId) {
  if (err && subscriptionId && typeof err.subscriptionId !== 'string') {
    err.subscriptionId = subscriptionId;
  }
  return err;
}

function createClientId() {
  _clientCounter += 1;
  return `rt-${Date.now().toString(36)}-${_clientCounter.toString(36)}`;
}

function safeSend(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function normalizeCleanup(cleanup) {
  if (typeof cleanup === 'function') return cleanup;
  if (cleanup && typeof cleanup.unsubscribe === 'function') return cleanup.unsubscribe;
  return () => {};
}

function getRealtimeStatus() {
  const subscriptions = [..._clients.values()].flatMap((client) => [...client.subscriptions.values()]);
  const channels = {};
  for (const subscription of subscriptions) {
    channels[subscription.channel] = (channels[subscription.channel] || 0) + 1;
  }

  return {
    path: REALTIME_PATH,
    clientCount: _clients.size,
    subscriptionCount: subscriptions.length,
    channels,
  };
}

function cleanupSubscription(client, subscriptionId, { notify = true, reason = 'unsubscribed' } = {}) {
  const subscription = client?.subscriptions?.get(subscriptionId);
  if (!subscription) return false;

  client.subscriptions.delete(subscriptionId);
  try {
    subscription.unsubscribe?.();
  } catch {
    // Ignore cleanup failures so one bad handler does not leak the socket.
  }

  if (notify) {
    safeSend(client.ws, {
      type: 'unsubscribed',
      subscriptionId,
      channel: subscription.channel,
      key: subscription.key,
      reason,
    });
  }

  return true;
}

function cleanupClient(client) {
  if (!client) return;
  for (const subscriptionId of [...client.subscriptions.keys()]) {
    cleanupSubscription(client, subscriptionId, { notify: false, reason: 'socket-closed' });
  }
  _clients.delete(client.id);
}

async function handleSubscribe(client, payload) {
  const subscriptionId = typeof payload?.subscriptionId === 'string' ? payload.subscriptionId.trim() : '';
  if (!subscriptionId) {
    throw createProtocolError('MISSING_SUBSCRIPTION_ID', 'subscriptionId is required');
  }

  const channel = typeof payload?.channel === 'string' ? payload.channel.trim() : '';
  const handler = channelHandlers.get(channel);
  if (!handler || typeof handler.subscribe !== 'function') {
    throw attachSubscriptionId(
      createProtocolError('UNKNOWN_CHANNEL', `Unknown realtime channel "${channel || 'unknown'}"`),
      subscriptionId,
    );
  }

  cleanupSubscription(client, subscriptionId, { notify: false, reason: 'replaced' });

  const record = {
    id: subscriptionId,
    channel,
    key: payload?.key ?? null,
    unsubscribe: () => {},
  };
  client.subscriptions.set(subscriptionId, record);

  try {
    const cleanup = await handler.subscribe({
      subscriptionId,
      channel,
      key: payload?.key ?? null,
      params: payload?.params && typeof payload.params === 'object' ? payload.params : {},
      request: client.request,
      clientId: client.id,
      sendEvent(event, data, meta = undefined) {
        safeSend(client.ws, {
          type: 'event',
          subscriptionId,
          channel,
          key: payload?.key ?? null,
          event,
          data,
          ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
        });
      },
    });

    if (!client.subscriptions.has(subscriptionId)) {
      normalizeCleanup(cleanup)();
      return;
    }

    record.unsubscribe = normalizeCleanup(cleanup);

    safeSend(client.ws, {
      type: 'subscribed',
      subscriptionId,
      channel,
      key: payload?.key ?? null,
    });
  } catch (err) {
    client.subscriptions.delete(subscriptionId);
    throw attachSubscriptionId(err, subscriptionId);
  }
}

function handleUnsubscribe(client, payload) {
  const subscriptionId = typeof payload?.subscriptionId === 'string' ? payload.subscriptionId.trim() : '';
  if (!subscriptionId) {
    throw createProtocolError('MISSING_SUBSCRIPTION_ID', 'subscriptionId is required');
  }
  cleanupSubscription(client, subscriptionId, { notify: true, reason: 'client-unsubscribe' });
}

async function handleMessage(client, rawMessage) {
  let payload = null;
  try {
    payload = JSON.parse(String(rawMessage || ''));
  } catch {
    throw createProtocolError('INVALID_JSON', 'Realtime messages must be valid JSON');
  }

  const type = typeof payload?.type === 'string' ? payload.type.trim() : '';
  switch (type) {
    case 'subscribe':
      await handleSubscribe(client, payload);
      return;
    case 'unsubscribe':
      handleUnsubscribe(client, payload);
      return;
    case 'ping':
      safeSend(client.ws, { type: 'pong', timestamp: new Date().toISOString() });
      return;
    default:
      throw createProtocolError('UNKNOWN_MESSAGE_TYPE', `Unknown realtime message type "${type || 'unknown'}"`);
  }
}

function startHeartbeat() {
  if (_heartbeatTimer) return;
  _heartbeatTimer = setInterval(() => {
    for (const client of _clients.values()) {
      if (!client.ws || client.ws.readyState !== WebSocket.OPEN) continue;
      if (client.alive === false) {
        try {
          client.ws.terminate();
        } catch {
          // Ignore terminate failures.
        }
        continue;
      }
      client.alive = false;
      try {
        client.ws.ping();
      } catch {
        // Ignore ping failures; close handling will clean up.
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  if (_heartbeatTimer.unref) _heartbeatTimer.unref();
}

function stopRealtimeServer() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }

  if (_websocketServer) {
    for (const client of _clients.values()) {
      try {
        client.ws.close(1001, 'server-shutdown');
      } catch {
        // Ignore close failures during shutdown.
      }
      cleanupClient(client);
    }
    _websocketServer.close();
    _websocketServer = null;
  }

  if (_attachedServer && _upgradeHandler) {
    _attachedServer.removeListener('upgrade', _upgradeHandler);
  }

  _upgradeHandler = null;
  _attachedServer = null;
  _clients.clear();
}

function attachRealtimeServer(httpServer) {
  if (!httpServer) {
    throw new Error('attachRealtimeServer requires an http server');
  }

  if (_attachedServer === httpServer && _websocketServer) {
    return _websocketServer;
  }

  if (_attachedServer && _attachedServer !== httpServer) {
    stopRealtimeServer();
  }

  _websocketServer = new WebSocketServer({ noServer: true });
  _attachedServer = httpServer;

  _websocketServer.on('connection', (ws, request) => {
    const client = {
      id: createClientId(),
      ws,
      request,
      subscriptions: new Map(),
      alive: true,
      connectedAt: Date.now(),
    };

    _clients.set(client.id, client);
    safeSend(ws, {
      type: 'hello',
      connectionId: client.id,
      serverTime: new Date().toISOString(),
      status: getRealtimeStatus(),
    });

    ws.on('pong', () => {
      client.alive = true;
    });

    ws.on('message', async (rawMessage) => {
      try {
        await handleMessage(client, rawMessage);
      } catch (err) {
        safeSend(ws, {
          type: 'error',
          code: err.code || 'REALTIME_ERROR',
          error: err.message || 'Realtime request failed',
          ...(err.detail ? { detail: err.detail } : {}),
          ...(typeof err.subscriptionId === 'string' ? { subscriptionId: err.subscriptionId } : {}),
        });
      }
    });

    ws.on('close', () => {
      cleanupClient(client);
    });

    ws.on('error', () => {
      cleanupClient(client);
    });
  });

  _upgradeHandler = (request, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }

    if (pathname !== REALTIME_PATH) return;

    if (!isAllowedOrigin(request.headers.origin, undefined, { host: request.headers.host })) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    _websocketServer.handleUpgrade(request, socket, head, (ws) => {
      _websocketServer.emit('connection', ws, request);
    });
  };

  httpServer.on('upgrade', _upgradeHandler);
  startHeartbeat();

  return _websocketServer;
}

module.exports = {
  REALTIME_PATH,
  attachRealtimeServer,
  stopRealtimeServer,
  getRealtimeStatus,
};
