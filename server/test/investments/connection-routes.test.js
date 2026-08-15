'use strict';

process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const request = require('supertest');

const { createInvestmentsRouter } = require('../../src/routes/investments');
const { createInvestmentsModule } = require('../../src/modules/investments');

function createFixtureApp(env) {
  let scenario = 'disconnected';
  const app = express();
  app.use(express.json());
  app.use('/api/investments', createInvestmentsRouter({
    env,
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
  const initial = await request(app).get('/api/investments/providers/questrade/connection').expect(200);
  assert.equal(initial.body.mode, 'simulated');
  assert.equal(initial.body.liveAccessEnabled, false);
  assert.equal(initial.body.accountType, 'Margin');
  assert.equal(initial.body.scenario, 'disconnected');
  assert.equal(initial.body.scenarios.length, 7);

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

test('production refuses fixture controls and reports live access disabled', async () => {
  const app = createFixtureApp({ NODE_ENV: 'production', QUESTRADE_DEV_FIXTURES: '1', QUESTRADE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64') });
  const status = await request(app).get('/api/investments/providers/questrade/connection').expect(200);
  assert.equal(status.body.mode, 'stage-1');
  assert.equal(status.body.fixtureControlsAvailable, false);
  assert.equal(status.body.liveAccessEnabled, false);
  assert.equal(status.body.scenarios, undefined);

  const response = await request(app)
    .post('/api/investments/providers/questrade/dev-scenario')
    .send({ scenario: 'healthy-margin' })
    .expect(404);
  assert.equal(response.body.code, 'NOT_FOUND');
});
