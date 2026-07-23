'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');

const { createApp } = require('../src/app');
const workspaceMonitor = require('../src/services/workspace-monitor');
const {
  REALTIME_PATH,
  attachRealtimeServer,
  stopRealtimeServer,
} = require('../src/services/realtime-server');
const {
  createAgentSession,
  updateAgentSession,
  appendAgentSessionEvent,
  getAgentSession,
} = require('../src/services/agent-session-runtime');
const {
  EVENT_LIMIT,
  getCaseRealtimeStatus,
  publishCaseEvent,
  resetCaseRealtimeEvents,
} = require('../src/services/case-realtime-events');

function openSocket(port, options = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${REALTIME_PATH}`, options);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function expectSocketOpenFailure(port, options = {}, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${REALTIME_PATH}`, options);
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      reject(new Error(`Timed out waiting for websocket failure after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.once('open', () => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      reject(new Error('Expected websocket handshake to fail, but it opened'));
    });
    ws.once('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve(res.statusCode);
    });
    ws.once('error', () => {
      // Some handshake failures surface here after unexpected-response.
    });
  });
}

function waitForClose(ws, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for websocket close after ${timeoutMs}ms`)), timeoutMs);
    ws.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function createMessageFeed(ws) {
  const messages = [];
  const waiters = [];

  ws.on('message', (raw) => {
    let parsed = null;
    try {
      parsed = JSON.parse(String(raw || ''));
    } catch {
      return;
    }

    messages.push(parsed);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (!waiter.predicate(parsed)) continue;
      waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(parsed);
    }
  });

  return {
    messages,
    waitFor(predicate, timeoutMs = 5_000) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const waiterIndex = waiters.findIndex((entry) => entry.resolve === resolve);
          if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
          reject(new Error(`Timed out waiting for websocket message after ${timeoutMs}ms`));
        }, timeoutMs);

        waiters.push({
          predicate,
          resolve,
          timer,
        });
      });
    },
  };
}

test('realtime websocket channels', async (t) => {
  let server = null;
  let port = 0;

  t.before(async () => {
    const app = createApp();
    server = app.listen(0);
    port = server.address().port;
    attachRealtimeServer(server);
    workspaceMonitor.stopMonitor();
  });

  t.after(async () => {
    workspaceMonitor.stopMonitor();
    stopRealtimeServer();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await t.test('workspace-monitor channel sends a snapshot and live alerts', async () => {
    const ws = await openSocket(port);
    const feed = createMessageFeed(ws);

    ws.send(JSON.stringify({
      type: 'subscribe',
      subscriptionId: 'monitor-1',
      channel: 'workspace-monitor',
    }));

    const snapshot = await feed.waitFor((message) => (
      message.type === 'event'
      && message.subscriptionId === 'monitor-1'
      && message.event === 'snapshot'
    ));

    assert.ok(Array.isArray(snapshot.data.alerts));
    assert.ok(Array.isArray(snapshot.data.nudges));

    workspaceMonitor.broadcast('alert', {
      type: 'calendar-alert',
      title: 'Calendar conflict',
      sourceId: 'evt-1',
    });

    const alert = await feed.waitFor((message) => (
      message.type === 'event'
      && message.subscriptionId === 'monitor-1'
      && message.event === 'alert'
    ));

    assert.equal(alert.data.title, 'Calendar conflict');
    assert.equal(alert.data.sourceId, 'evt-1');

    ws.close();
    await waitForClose(ws);
  });

  await t.test('same-host browser origins are accepted without explicit CORS allowlist', async () => {
    const ws = await openSocket(port, {
      headers: {
        Origin: `http://127.0.0.1:${port}`,
      },
    });
    ws.close();
    await waitForClose(ws);
  });

  await t.test('cross-origin websocket handshakes are rejected by default', async () => {
    const statusCode = await expectSocketOpenFailure(port, {
      headers: {
        Origin: 'http://evil.example',
      },
    });
    assert.equal(statusCode, 403);
  });

  await t.test('invalid case subscriptions are rejected without affecting the shared connection', async () => {
    const ws = await openSocket(port);
    const feed = createMessageFeed(ws);
    ws.send(JSON.stringify({
      type: 'subscribe',
      subscriptionId: 'case-invalid',
      channel: 'case-workflow',
      key: 'not-an-object-id',
    }));
    const denied = await feed.waitFor((message) => (
      message.type === 'error' && message.subscriptionId === 'case-invalid'
    ));
    assert.equal(denied.code, 'INVALID_ESCALATION_ID');

    ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await feed.waitFor((message) => message.type === 'pong');
    assert.ok(pong.timestamp);
    ws.close();
    await waitForClose(ws);
  });

  await t.test('agent-session channel replays buffered events and streams live updates', async () => {
    const session = createAgentSession({
      agentType: 'workspace',
      title: 'Realtime Session Test',
    });

    updateAgentSession(session.id, { status: 'running' });
    appendAgentSessionEvent(session.id, 'start', {
      conversationSessionId: 'conv-1',
      provider: 'claude',
    });
    appendAgentSessionEvent(session.id, 'status', {
      phase: 'thinking',
      message: 'Thinking...',
    });

    const ws = await openSocket(port);
    const feed = createMessageFeed(ws);

    ws.send(JSON.stringify({
      type: 'subscribe',
      subscriptionId: 'session-1',
      channel: 'agent-session',
      key: session.id,
      params: { since: 0 },
    }));

    const sessionMessage = await feed.waitFor((message) => (
      message.type === 'event'
      && message.subscriptionId === 'session-1'
      && message.event === 'session'
    ));
    assert.equal(sessionMessage.data.id, session.id);

    const startEvent = await feed.waitFor((message) => (
      message.type === 'event'
      && message.subscriptionId === 'session-1'
      && message.event === 'start'
    ));
    assert.equal(startEvent.meta.seq, 1);
    assert.equal(startEvent.data.provider, 'claude');

    const statusEvent = await feed.waitFor((message) => (
      message.type === 'event'
      && message.subscriptionId === 'session-1'
      && message.event === 'status'
    ));
    assert.equal(statusEvent.meta.seq, 2);
    assert.equal(statusEvent.data.phase, 'thinking');

    assert.equal(getAgentSession(session.id).attachedClients, 1);

    appendAgentSessionEvent(session.id, 'chunk', { text: 'hello' });
    const chunkEvent = await feed.waitFor((message) => (
      message.type === 'event'
      && message.subscriptionId === 'session-1'
      && message.event === 'chunk'
    ));
    assert.equal(chunkEvent.meta.seq, 3);
    assert.equal(chunkEvent.data.text, 'hello');

    appendAgentSessionEvent(session.id, 'done', { fullResponse: 'hello' });
    const doneEvent = await feed.waitFor((message) => (
      message.type === 'event'
      && message.subscriptionId === 'session-1'
      && message.event === 'done'
    ));
    assert.equal(doneEvent.meta.seq, 4);
    assert.equal(doneEvent.data.fullResponse, 'hello');

    ws.send(JSON.stringify({
      type: 'unsubscribe',
      subscriptionId: 'session-1',
    }));

    await feed.waitFor((message) => (
      message.type === 'unsubscribed'
      && message.subscriptionId === 'session-1'
    ));

    assert.equal(getAgentSession(session.id).attachedClients, 0);

    ws.close();
    await waitForClose(ws);
  });

  await t.test('case-workflow channel snapshots, filters, streams, replays, and cleans up', async () => {
    resetCaseRealtimeEvents();
    const escalationId = '507f1f77bcf86cd799439011';
    const otherEscalationId = '507f1f77bcf86cd799439012';
    const ws = await openSocket(port);
    const feed = createMessageFeed(ws);

    ws.send(JSON.stringify({
      type: 'subscribe',
      subscriptionId: 'case-1',
      channel: 'case-workflow',
      key: escalationId,
    }));

    const snapshot = await feed.waitFor((message) => (
      message.type === 'event'
      && message.subscriptionId === 'case-1'
      && message.event === 'snapshot'
    ));
    assert.equal(snapshot.data.escalationId, escalationId);
    assert.equal(snapshot.data.authoritativeRefreshRequired, true);
    assert.equal(snapshot.meta.authoritative, true);
    assert.equal(getCaseRealtimeStatus().listenerCount, 1);

    publishCaseEvent({
      entityType: 'escalation',
      entityId: otherEscalationId,
      escalationId: otherEscalationId,
      action: 'updated',
    });
    const expected = publishCaseEvent({
      entityType: 'escalation',
      entityId: escalationId,
      escalationId,
      action: 'status-changed',
      summary: { status: 'resolved' },
    });

    const live = await feed.waitFor((message) => (
      message.type === 'event'
      && message.subscriptionId === 'case-1'
      && message.event === 'escalation.status-changed'
    ));
    assert.equal(live.data.eventId, expected.eventId);
    assert.equal(live.meta.seq, expected.seq);
    assert.equal(live.data.summary.status, 'resolved');
    assert.equal(feed.messages.some((message) => message.data?.escalationId === otherEscalationId), false);

    ws.send(JSON.stringify({ type: 'unsubscribe', subscriptionId: 'case-1' }));
    await feed.waitFor((message) => message.type === 'unsubscribed' && message.subscriptionId === 'case-1');
    assert.equal(getCaseRealtimeStatus().listenerCount, 0);
    ws.close();
    await waitForClose(ws);

    const missed = publishCaseEvent({
      entityType: 'knowledge',
      entityId: '507f1f77bcf86cd799439021',
      escalationId,
      action: 'created',
    });
    const replaySocket = await openSocket(port);
    const replayFeed = createMessageFeed(replaySocket);
    replaySocket.send(JSON.stringify({
      type: 'subscribe',
      subscriptionId: 'case-replay',
      channel: 'case-workflow',
      key: escalationId,
      params: { since: expected.seq },
    }));
    const replayed = await replayFeed.waitFor((message) => (
      message.type === 'event'
      && message.subscriptionId === 'case-replay'
      && message.data?.eventId === missed.eventId
    ));
    assert.equal(replayed.event, 'knowledge.created');
    replaySocket.close();
    await waitForClose(replaySocket);
  });

  await t.test('case-workflow requires an authoritative refresh when replay retention is exceeded', async () => {
    resetCaseRealtimeEvents();
    const escalationId = '507f1f77bcf86cd799439031';
    for (let index = 0; index < EVENT_LIMIT + 2; index += 1) {
      publishCaseEvent({
        entityType: 'escalation',
        entityId: escalationId,
        escalationId,
        action: 'updated',
      });
    }
    assert.equal(getCaseRealtimeStatus().retainedEventCount, EVENT_LIMIT);

    const ws = await openSocket(port);
    const feed = createMessageFeed(ws);
    ws.send(JSON.stringify({
      type: 'subscribe',
      subscriptionId: 'case-gap',
      channel: 'case-workflow',
      key: escalationId,
      params: { since: 1 },
    }));
    const snapshot = await feed.waitFor((message) => (
      message.type === 'event'
      && message.subscriptionId === 'case-gap'
      && message.event === 'snapshot'
    ));
    assert.equal(snapshot.data.reason, 'replay-gap');
    assert.equal(snapshot.meta.resyncRequired, true);
    assert.equal(snapshot.data.authoritativeRefreshRequired, true);
    ws.close();
    await waitForClose(ws);
  });
});
