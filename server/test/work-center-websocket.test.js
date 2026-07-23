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
  EVENT_LIMIT,
  getWorkCenterStatus,
  publishAttentionChange,
  publishWorkItem,
  resetWorkCenterEvents,
} = require('../src/services/work-center-events');

function openSocket(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${REALTIME_PATH}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitForClose(ws, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for websocket close')), timeoutMs);
    ws.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function createFeed(ws) {
  const messages = [];
  const waiters = [];
  ws.on('message', (raw) => {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (!waiter.predicate(message)) continue;
      waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  });
  return {
    messages,
    waitFor(predicate, timeoutMs = 5_000) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for websocket message')), timeoutMs);
        waiters.push({ predicate, resolve, timer });
      });
    },
  };
}

test('work-center websocket snapshots, streams, replays, validates scope, and cleans up', async () => {
  let server;
  let port;
  try {
    server = createApp().listen(0);
    port = server.address().port;
    attachRealtimeServer(server);
    workspaceMonitor.stopMonitor();
    resetWorkCenterEvents();

    publishWorkItem({
      id: 'test:active',
      kind: 'qbo-workflow',
      title: 'QBO escalation workflow',
      owner: 'Triage Agent',
      status: 'running',
      phase: 'triage',
      phaseLabel: 'Classifying the escalation',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const ws = await openSocket(port);
    const feed = createFeed(ws);
    ws.send(JSON.stringify({
      type: 'subscribe',
      subscriptionId: 'work-1',
      channel: 'work-center',
      key: 'all',
    }));
    const snapshot = await feed.waitFor((message) => (
      message.type === 'event' && message.subscriptionId === 'work-1' && message.event === 'snapshot'
    ));
    assert.equal(snapshot.data.workItems.length, 1);
    assert.equal(snapshot.data.workItems[0].owner, 'Triage Agent');
    assert.equal(snapshot.meta.authoritative, true);
    assert.equal(getWorkCenterStatus().listenerCount, 1);

    const secondSocket = await openSocket(port);
    const secondFeed = createFeed(secondSocket);
    secondSocket.send(JSON.stringify({
      type: 'subscribe',
      subscriptionId: 'work-second-tab',
      channel: 'work-center',
      key: 'all',
    }));
    await secondFeed.waitFor((message) => message.event === 'snapshot' && message.subscriptionId === 'work-second-tab');
    assert.equal(getWorkCenterStatus().listenerCount, 2);

    const attention = publishAttentionChange({
      _id: '507f1f77bcf86cd799439011',
      kind: 'knowledge-review',
      status: 'open',
      severity: 'warning',
      title: 'Knowledge draft needs review',
    }, { action: 'created' });
    const live = await feed.waitFor((message) => message.data?.eventId === attention.eventId);
    const secondTabLive = await secondFeed.waitFor((message) => message.data?.eventId === attention.eventId);
    assert.equal(live.event, 'attention.changed');
    assert.equal(live.meta.seq, attention.seq);
    assert.equal(secondTabLive.event, 'attention.changed');

    secondSocket.close();
    await waitForClose(secondSocket);

    ws.send(JSON.stringify({ type: 'unsubscribe', subscriptionId: 'work-1' }));
    await feed.waitFor((message) => message.type === 'unsubscribed' && message.subscriptionId === 'work-1');
    assert.equal(getWorkCenterStatus().listenerCount, 0);
    ws.close();
    await waitForClose(ws);

    const missed = publishWorkItem({
      id: 'test:completed',
      title: 'QBO escalation workflow',
      status: 'completed',
      updatedAt: new Date().toISOString(),
    }, { reason: 'completed' });
    const replaySocket = await openSocket(port);
    const replayFeed = createFeed(replaySocket);
    replaySocket.send(JSON.stringify({
      type: 'subscribe',
      subscriptionId: 'work-replay',
      channel: 'work-center',
      key: 'all',
      params: { since: attention.seq },
    }));
    const replay = await replayFeed.waitFor((message) => message.data?.eventId === missed.eventId);
    assert.equal(replay.event, 'work.changed');

    replaySocket.send(JSON.stringify({
      type: 'subscribe',
      subscriptionId: 'work-invalid',
      channel: 'work-center',
      key: 'private-scope',
    }));
    const denied = await replayFeed.waitFor((message) => message.type === 'error' && message.subscriptionId === 'work-invalid');
    assert.equal(denied.code, 'INVALID_WORK_CENTER_SCOPE');
    replaySocket.send(JSON.stringify({ type: 'ping' }));
    assert.ok((await replayFeed.waitFor((message) => message.type === 'pong')).timestamp);
    replaySocket.close();
    await waitForClose(replaySocket);

    resetWorkCenterEvents();
    for (let index = 0; index < EVENT_LIMIT + 2; index += 1) {
      publishAttentionChange({ attentionItemId: `gap-${index}` }, { action: 'updated' });
    }
    const gapSocket = await openSocket(port);
    const gapFeed = createFeed(gapSocket);
    gapSocket.send(JSON.stringify({
      type: 'subscribe',
      subscriptionId: 'work-gap',
      channel: 'work-center',
      key: 'all',
      params: { since: 1 },
    }));
    const gapSnapshot = await gapFeed.waitFor((message) => message.event === 'snapshot' && message.subscriptionId === 'work-gap');
    assert.equal(gapSnapshot.data.reason, 'replay-gap');
    assert.equal(gapSnapshot.meta.resyncRequired, true);
    gapSocket.close();
    await waitForClose(gapSocket);
  } finally {
    workspaceMonitor.stopMonitor();
    stopRealtimeServer();
    if (server) await new Promise((resolve) => server.close(resolve));
  }
});
