'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const { createApp } = require('../src/app');
const {
  clearSessions,
  configuration,
  createSession,
  getSession,
  hashPassword,
  verifyPassword,
} = require('../src/services/app-auth');

const PASSWORD = 'correct horse battery staple';
let passwordHash;

function withEnvironment(values, work) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  return Promise.resolve().then(work).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function enabledEnvironment(overrides = {}) {
  return {
    NODE_ENV: 'test',
    QBO_AUTH_MODE: 'password',
    QBO_AUTH_USER_ID: 'qbo-user-1',
    QBO_AUTH_USER_NAME: 'Taylor QBO',
    QBO_AUTH_USER_EMAIL: 'taylor@example.test',
    QBO_AUTH_PASSWORD_HASH: passwordHash,
    QBO_AUTH_ALLOWED_ORIGINS: 'http://qbo.example.test',
    QBO_AUTH_COOKIE_SECURE: '0',
    RATE_LIMIT_DISABLED: '1',
    ...overrides,
  };
}

test.before(async () => {
  passwordHash = await hashPassword(PASSWORD, Buffer.from('deterministic-auth-test-salt'));
});

test.beforeEach(() => clearSessions());

test('password hashing uses scrypt and constant-shape verification without retaining plaintext', async () => {
  assert.match(passwordHash, /^scrypt\$v1\$/);
  assert.equal(passwordHash.includes(PASSWORD), false);
  assert.equal(await verifyPassword(PASSWORD, passwordHash), true);
  assert.equal(await verifyPassword('incorrect password', passwordHash), false);
  assert.equal(await verifyPassword(PASSWORD, 'malformed'), false);
});

test('authentication is disabled by default and does not invent a signed-in user', async () => withEnvironment({
  QBO_AUTH_MODE: '',
  QBO_AUTH_USER_ID: '',
  QBO_AUTH_USER_NAME: '',
  QBO_AUTH_PASSWORD_HASH: '',
}, async () => {
  assert.equal(configuration().enabled, false);
  const response = await request(createApp()).get('/api/auth/session').expect(200);
  assert.equal(response.body.enabled, false);
  assert.equal(response.body.authenticated, false);
  assert.equal(response.body.user, null);
}));

test('enabled authentication reports incomplete configuration without accepting a password', async () => withEnvironment(enabledEnvironment({ QBO_AUTH_PASSWORD_HASH: '' }), async () => {
  const app = createApp();
  const state = await request(app).get('/api/auth/session').expect(200);
  assert.equal(state.body.enabled, true);
  assert.equal(state.body.configured, false);
  await request(app)
    .post('/api/auth/login')
    .set('Origin', 'http://qbo.example.test')
    .send({ password: PASSWORD })
    .expect(503);
}));

test('unsupported authentication modes stay visibly enabled but cannot accept a password', async () => withEnvironment(enabledEnvironment({ QBO_AUTH_MODE: 'oidc' }), async () => {
  const config = configuration();
  assert.equal(config.enabled, true);
  assert.equal(config.supported, false);
  assert.equal(config.configured, false);
  const response = await request(createApp())
    .post('/api/auth/login')
    .set('Origin', 'http://qbo.example.test')
    .send({ password: PASSWORD });
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'QBO_AUTH_NOT_CONFIGURED');
}));

test('login requires an exact allowed origin and returns a generic credential failure', async () => withEnvironment(enabledEnvironment(), async () => {
  const app = createApp();
  const denied = await request(app)
    .post('/api/auth/login')
    .set('Origin', 'http://evil.example.test')
    .send({ password: PASSWORD });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'QBO_AUTH_ORIGIN_DENIED');

  const invalid = await request(app)
    .post('/api/auth/login')
    .set('Origin', 'http://qbo.example.test')
    .send({ password: 'incorrect password' });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.body.code, 'QBO_AUTH_INVALID_CREDENTIALS');
  assert.equal(JSON.stringify(invalid.body).includes(PASSWORD), false);
}));

test('successful login creates an opaque HttpOnly SameSite session and logout revokes it', async () => withEnvironment(enabledEnvironment(), async () => {
  const agent = request.agent(createApp());
  const login = await agent
    .post('/api/auth/login')
    .set('Origin', 'http://qbo.example.test')
    .send({ password: PASSWORD })
    .expect(200);
  assert.deepEqual(login.body.user, {
    id: 'qbo-user-1',
    displayName: 'Taylor QBO',
    email: 'taylor@example.test',
  });
  const setCookie = login.headers['set-cookie']?.[0] || '';
  assert.match(setCookie, /^qbo_auth_session=[A-Za-z0-9_-]{40,}/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.equal(setCookie.includes(PASSWORD), false);

  const active = await agent.get('/api/auth/session').expect(200);
  assert.equal(active.body.authenticated, true);
  assert.equal(active.body.user.id, 'qbo-user-1');

  await agent
    .post('/api/auth/logout')
    .set('Origin', 'http://qbo.example.test')
    .send({})
    .expect(200);
  const ended = await agent.get('/api/auth/session').expect(200);
  assert.equal(ended.body.authenticated, false);
  assert.equal(ended.body.user, null);
}));

test('production sessions use Secure cookies and expired server sessions are rejected', async () => withEnvironment(enabledEnvironment({
  NODE_ENV: 'production',
  QBO_AUTH_COOKIE_SECURE: '',
}), async () => {
  const login = await request(createApp())
    .post('/api/auth/login')
    .set('Origin', 'http://qbo.example.test')
    .send({ password: PASSWORD })
    .expect(200);
  assert.match(login.headers['set-cookie']?.[0] || '', /Secure/i);

  const now = 1_000_000;
  const session = createSession({ id: 'qbo-user-1', displayName: 'Taylor QBO' }, { now, ttlMs: 5 * 60 * 1000 });
  const requestShape = { headers: { cookie: `qbo_auth_session=${session.token}` } };
  assert.equal(getSession(requestShape, now + (5 * 60 * 1000) - 1)?.user.id, 'qbo-user-1');
  assert.equal(getSession(requestShape, now + (5 * 60 * 1000)), null);
}));
