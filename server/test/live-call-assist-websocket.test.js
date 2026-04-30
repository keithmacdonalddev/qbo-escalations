'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { WebSocket, WebSocketServer } = require('ws');
const request = require('supertest');

const { createApp } = require('../src/app');
const {
  LIVE_CALL_ASSIST_PATH,
  attachLiveCallAssistServer,
  stopLiveCallAssistServer,
} = require('../src/services/live-call-assist-server');

function openSocket(port, options = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${LIVE_CALL_ASSIST_PATH}`, options);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
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
    waitFor(predicate, timeoutMs = 5_000) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const waiterIndex = waiters.findIndex((entry) => entry.resolve === resolve);
          if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
          reject(new Error(`Timed out waiting for websocket message after ${timeoutMs}ms`));
        }, timeoutMs);

        waiters.push({ predicate, resolve, timer });
      });
    },
  };
}

test('live call assist websocket bridge', async (t) => {
  const originalKey = process.env.ELEVENLABS_API_KEY;
  const originalUrl = process.env.ELEVENLABS_REALTIME_STT_URL;
  const originalDisableLogging = process.env.ELEVENLABS_DISABLE_LOGGING;
  let appServer = null;
  let appPort = 0;
  let upstreamServer = null;
  let upstreamPort = 0;
  const upstreamMessages = [];
  const upstreamHandshakes = [];

  t.before(async () => {
    upstreamServer = new WebSocketServer({ port: 0 });
    await once(upstreamServer, 'listening');
    upstreamPort = upstreamServer.address().port;

    upstreamServer.on('connection', (ws, req) => {
      upstreamHandshakes.push({
        url: req.url,
        apiKey: req.headers['xi-api-key'],
      });
      ws.send(JSON.stringify({
        message_type: 'session_started',
        session_id: 'stt-session-1',
        config: {
          sample_rate: 16000,
          audio_format: 'pcm_16000',
          model_id: 'scribe_v2_realtime',
          include_timestamps: true,
          include_language_detection: false,
        },
      }));

      ws.on('message', (raw) => {
        const payload = JSON.parse(String(raw || '{}'));
        upstreamMessages.push(payload);
        if (payload.message_type === 'input_audio_chunk' && payload.audio_base_64) {
          ws.send(JSON.stringify({
            message_type: 'partial_transcript',
            text: 'customer cannot export payroll',
          }));
          ws.send(JSON.stringify({
            message_type: 'committed_transcript_with_timestamps',
            text: 'Customer cannot export payroll tax forms.',
            language_code: 'en',
            words: [
              { text: 'Customer', start: 0, end: 0.24, type: 'word' },
            ],
          }));
        }
      });
    });

    process.env.ELEVENLABS_API_KEY = 'test-elevenlabs-key';
    process.env.ELEVENLABS_REALTIME_STT_URL = `ws://127.0.0.1:${upstreamPort}/v1/speech-to-text/realtime`;
    process.env.ELEVENLABS_DISABLE_LOGGING = '1';

    const app = createApp();
    appServer = app.listen(0);
    await once(appServer, 'listening');
    appPort = appServer.address().port;
    attachLiveCallAssistServer(appServer);
  });

  t.after(async () => {
    if (originalKey === undefined) {
      delete process.env.ELEVENLABS_API_KEY;
    } else {
      process.env.ELEVENLABS_API_KEY = originalKey;
    }
    if (originalUrl === undefined) {
      delete process.env.ELEVENLABS_REALTIME_STT_URL;
    } else {
      process.env.ELEVENLABS_REALTIME_STT_URL = originalUrl;
    }
    if (originalDisableLogging === undefined) {
      delete process.env.ELEVENLABS_DISABLE_LOGGING;
    } else {
      process.env.ELEVENLABS_DISABLE_LOGGING = originalDisableLogging;
    }

    stopLiveCallAssistServer();
    if (appServer) {
      await new Promise((resolve) => appServer.close(resolve));
    }
    if (upstreamServer) {
      await new Promise((resolve) => upstreamServer.close(resolve));
    }
  });

  await t.test('status endpoint reports configured provider without exposing the key', async () => {
    const res = await request(`http://127.0.0.1:${appPort}`)
      .get('/api/live-call-assist/status')
      .expect(200);

    assert.equal(res.body.configured, true);
    assert.equal(res.body.provider, 'elevenlabs');
    assert.equal(res.body.modelId, 'scribe_v2_realtime');
    assert.equal(Object.prototype.hasOwnProperty.call(res.body, 'apiKey'), false);
  });

  await t.test('proxies browser audio to ElevenLabs and relays transcript events', async () => {
    const ws = await openSocket(appPort);
    const feed = createMessageFeed(ws);

    ws.send(JSON.stringify({
      type: 'start',
      sources: [{ sourceId: 'customer', label: 'Customer', languageCode: 'en', keyterms: ['QBO', 'payroll tax forms'] }],
      options: { modelId: 'scribe_v2_realtime', includeTimestamps: true, commitStrategy: 'vad' },
    }));

    await feed.waitFor((message) => message.type === 'ready');
    await feed.waitFor((message) => message.type === 'source_started' && message.sourceId === 'customer');

    ws.send(JSON.stringify({
      type: 'audio',
      sourceId: 'customer',
      sampleRate: 16000,
      audioBase64: Buffer.from([0, 0, 1, 0, 2, 0, 3, 0]).toString('base64'),
    }));

    const partial = await feed.waitFor((message) => message.type === 'partial');
    assert.equal(partial.text, 'customer cannot export payroll');

    const committed = await feed.waitFor((message) => message.type === 'committed');
    assert.equal(committed.text, 'Customer cannot export payroll tax forms.');
    assert.equal(committed.words[0].text, 'Customer');

    assert.equal(upstreamHandshakes.length, 1);
    assert.equal(upstreamHandshakes[0].apiKey, 'test-elevenlabs-key');
    const upstreamUrl = new URL(upstreamHandshakes[0].url, `ws://127.0.0.1:${upstreamPort}`);
    assert.equal(upstreamUrl.searchParams.get('model_id'), 'scribe_v2_realtime');
    assert.equal(upstreamUrl.searchParams.get('audio_format'), 'pcm_16000');
    assert.equal(upstreamUrl.searchParams.get('commit_strategy'), 'vad');
    assert.equal(upstreamUrl.searchParams.get('disable_logging'), 'true');
    assert.deepEqual(upstreamUrl.searchParams.getAll('keyterms'), ['QBO', 'payroll tax forms']);
    assert.ok(upstreamMessages.some((message) => message.audio_base_64));

    ws.close();
    await waitForClose(ws);
  });

  await t.test('missing API key produces a server-side configuration error', async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const ws = await openSocket(appPort);
    const feed = createMessageFeed(ws);
    ws.send(JSON.stringify({
      type: 'start',
      sources: [{ sourceId: 'customer', label: 'Customer' }],
    }));

    const error = await feed.waitFor((message) => message.type === 'error');
    assert.equal(error.code, 'ELEVENLABS_API_KEY_MISSING');
    await waitForClose(ws);
    process.env.ELEVENLABS_API_KEY = 'test-elevenlabs-key';
  });
});
