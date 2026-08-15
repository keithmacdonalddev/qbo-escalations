'use strict';

process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const request = require('supertest');

const { createInvestmentsRouter } = require('../../src/routes/investments');
const { createInvestmentsModule } = require('../../src/modules/investments');

function createFixtureApp(env, overrides = {}) {
  let scenario = 'disconnected';
  const connectionService = overrides.connectionService || {
    getStatus: async () => ({
      ok: true,
      provider: 'questrade',
      mode: 'live',
      liveAccessEnabled: true,
      readOnly: true,
      state: 'disconnected',
      secureStorageReady: true,
      fixtureControlsAvailable: false,
    }),
    connect: async () => ({ ok: true, provider: 'questrade', mode: 'live', state: 'connected', readOnly: true }),
    disconnect: async () => ({ ok: true, provider: 'questrade', mode: 'live', state: 'disconnected', readOnly: true }),
    forgetLocal: async () => ({ ok: true, provider: 'questrade', mode: 'live', state: 'disconnected', readOnly: true }),
    reauthorize: async () => ({ ok: true, provider: 'questrade', mode: 'live', state: 'connected', readOnly: true }),
    retryRevocation: async () => ({ ok: true, provider: 'questrade', mode: 'live', state: 'disconnected', readOnly: true }),
    retryVerification: async () => ({ ok: true, provider: 'questrade', mode: 'live', state: 'connected', readOnly: true }),
    selectAccount: async () => ({ ok: true, provider: 'questrade', mode: 'live', state: 'connected', readOnly: true }),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/investments', createInvestmentsRouter({
    env,
    connectionService,
    getScenario: () => scenario,
    setScenario: (value) => { scenario = value; },
  }));
  return app;
}

test('module import exposes one inert public boundary', () => {
  const module = createInvestmentsModule({ env: { NODE_ENV: 'test' } });
  assert.equal(module.id, 'investments');
  assert.equal(module.apiBasePath, '/api/investments');
  assert.equal(typeof module.router, 'function');
});

test('development fixture route switches among safe test states', async () => {
  const app = createFixtureApp({ NODE_ENV: 'development', QUESTRADE_DEV_FIXTURES: '1' });
  const live = await request(app).get('/api/investments/providers/questrade/connection').expect(200);
  assert.equal(live.body.mode, 'live');
  assert.equal(live.body.state, 'disconnected');

  const initial = await request(app).get('/api/investments/providers/questrade/dev-connection').expect(200);
  assert.equal(initial.body.mode, 'simulated');
  assert.equal(initial.body.liveAccessEnabled, false);
  assert.equal(initial.body.accountType, 'Margin');
  assert.equal(initial.body.scenario, 'disconnected');
  assert.ok(initial.body.scenarios.length >= 12);

  const changed = await request(app)
    .post('/api/investments/providers/questrade/dev-scenario')
    .send({ scenario: 'token-expired' })
    .expect(200);
  assert.equal(changed.body.state, 'reauthorization-required');
  assert.equal(changed.body.previousSnapshotAvailable, true);
  assert.equal(changed.body.liveAccessEnabled, false);

  const text = JSON.stringify(changed.body);
  assert.doesNotMatch(text, /access-token-canary|refresh-token-canary|fullAccountNumber|financialValue/);

  await request(app)
    .post('/api/investments/providers/questrade/dev-scenario')
    .send({ scenario: 'trade-now' })
    .expect(400);
});

test('production refuses fixture controls and exposes only the real connection projection', async () => {
  const app = createFixtureApp({ NODE_ENV: 'production', QUESTRADE_DEV_FIXTURES: '1', QUESTRADE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64') });
  const status = await request(app).get('/api/investments/providers/questrade/connection').expect(200);
  assert.equal(status.body.mode, 'live');
  assert.equal(status.body.fixtureControlsAvailable, false);
  assert.equal(status.body.liveAccessEnabled, true);
  assert.equal(status.body.scenarios, undefined);

  const response = await request(app)
    .post('/api/investments/providers/questrade/dev-scenario')
    .send({ scenario: 'healthy-margin' })
    .expect(404);
  assert.equal(response.body.code, 'NOT_FOUND');

  await request(app).get('/api/investments/providers/questrade/dev-connection').expect(404);
});

test('sensitive connection mutations require one-time action intents', async () => {
  const calls = [];
  const app = createFixtureApp({ NODE_ENV: 'test' }, {
    connectionService: {
      getStatus: async () => ({ ok: true, mode: 'live', state: 'disconnected' }),
      connect: async ({ refreshToken }) => { calls.push(refreshToken); return { ok: true, mode: 'live', state: 'connected' }; },
      selectAccount: async () => ({ ok: true, mode: 'live', state: 'connected' }),
    },
  });

  await request(app)
    .post('/api/investments/providers/questrade/connect')
    .send({ refreshToken: 'never-forwarded-without-intent' })
    .expect(409);
  assert.deepEqual(calls, []);

  const issued = await request(app)
    .post('/api/investments/providers/questrade/action-intents')
    .send({ action: 'connect' })
    .expect(200);

  const connected = await request(app)
    .post('/api/investments/providers/questrade/connect')
    .send({ intent: issued.body.intent, refreshToken: 'manual-token-canary' })
    .expect(200);
  assert.equal(connected.body.state, 'connected');
  assert.deepEqual(calls, ['manual-token-canary']);
  assert.doesNotMatch(JSON.stringify(connected.body), /manual-token-canary/);

  await request(app)
    .post('/api/investments/providers/questrade/connect')
    .send({ intent: issued.body.intent, refreshToken: 'replay-canary' })
    .expect(409);
  assert.deepEqual(calls, ['manual-token-canary']);
});

test('each Stage 2 lifecycle mutation requires the matching one-time intent and local forget requires explicit confirmation', async () => {
  const calls = [];
  const connectionService = {
    getStatus: async () => ({ ok: true, mode: 'live', state: 'connected' }),
    reauthorize: async () => { calls.push('reauthorize'); return { ok: true, state: 'connected' }; },
    retryVerification: async () => { calls.push('retry-verification'); return { ok: true, state: 'connected' }; },
    disconnect: async () => { calls.push('disconnect'); return { ok: true, state: 'revocation-pending' }; },
    retryRevocation: async () => { calls.push('retry-revocation'); return { ok: true, state: 'disconnected' }; },
    forgetLocal: async () => { calls.push('forget-local'); return { ok: true, state: 'disconnected' }; },
    connect: async () => ({ ok: true, state: 'connected' }),
    selectAccount: async () => ({ ok: true, state: 'connected' }),
  };
  const app = createFixtureApp({ NODE_ENV: 'test' }, { connectionService });
  const actions = [
    ['reauthorize', 'reauthorize', { refreshToken: 'manual-token-canary' }],
    ['retry-verification', 'retry-verification', {}],
    ['disconnect', 'disconnect', {}],
    ['retry-revocation', 'retry-revocation', {}],
  ];

  for (const [action, path, body] of actions) {
    await request(app).post(`/api/investments/providers/questrade/${path}`).send(body).expect(409);
    const issued = await request(app)
      .post('/api/investments/providers/questrade/action-intents')
      .send({ action })
      .expect(200);
    await request(app)
      .post(`/api/investments/providers/questrade/${path}`)
      .send({ ...body, intent: issued.body.intent })
      .expect(200);
    await request(app)
      .post(`/api/investments/providers/questrade/${path}`)
      .send({ ...body, intent: issued.body.intent })
      .expect(409);
  }

  const forgetIntent = await request(app)
    .post('/api/investments/providers/questrade/action-intents')
    .send({ action: 'forget-local' })
    .expect(200);
  await request(app)
    .post('/api/investments/providers/questrade/forget-local')
    .send({ intent: forgetIntent.body.intent })
    .expect(400);

  const confirmedIntent = await request(app)
    .post('/api/investments/providers/questrade/action-intents')
    .send({ action: 'forget-local' })
    .expect(200);
  await request(app)
    .post('/api/investments/providers/questrade/forget-local')
    .send({ intent: confirmedIntent.body.intent, confirm: 'FORGET_LOCAL_QUESTRADE' })
    .expect(200);

  assert.deepEqual(calls, ['reauthorize', 'retry-verification', 'disconnect', 'retry-revocation', 'forget-local']);
});
