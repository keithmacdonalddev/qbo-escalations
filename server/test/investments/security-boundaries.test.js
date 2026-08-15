'use strict';

process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const request = require('supertest');

const { createApp } = require('../../src/app');
const { decryptField, encryptField } = require('../../src/lib/field-encryption');
const { isAllowedLocalRequestHost, parseHostHeader } = require('../../src/lib/local-host-policy');
const { createCredentialKeyProvider } = require('../../src/services/investments/credential-key-provider');
const { validateQuestradeApiUrl } = require('../../src/services/investments/providers/questrade/api-host-policy');
const { createFixtureAdapter } = require('../../src/services/investments/providers/questrade/fixture-adapter');
const { serializeQuestradeConnection } = require('../../src/services/investments/questrade-connection-serializer');
const QuestradeConnection = require('../../src/models/QuestradeConnection');

test('local Host policy accepts loopback and rejects rebinding and malformed targets', async () => {
  const allowedPorts = new Set([4000, 5174]);
  assert.deepEqual(parseHostHeader('[::1]:4000'), { hostname: '::1', port: 4000 });
  assert.equal(isAllowedLocalRequestHost('localhost:4000', { allowedPorts, env: {}, allowAnyLoopbackPort: false }), true);
  assert.equal(isAllowedLocalRequestHost('127.0.0.1:5174', { allowedPorts, env: {}, allowAnyLoopbackPort: false }), true);

  for (const value of ['evil.example:4000', 'localhost:4999', 'user@localhost:4000', 'localhost:4000/path', 'localhost:4000,evil.example']) {
    assert.equal(isAllowedLocalRequestHost(value, { allowedPorts, env: {}, allowAnyLoopbackPort: false }), false, value);
  }

  const response = await request(createApp()).get('/api/health').set('Host', 'attacker.example:4000').expect(403);
  assert.equal(response.body.code, 'LOCAL_HOST_REQUIRED');
});

test('AES-GCM encryption authenticates ciphertext and rejects tampering', () => {
  const key = crypto.randomBytes(32);
  const encrypted = encryptField('refresh-token-canary', key);
  assert.equal(decryptField(encrypted, key), 'refresh-token-canary');
  assert.equal(JSON.stringify(encrypted).includes('refresh-token-canary'), false);

  const tampered = { ...encrypted, ciphertext: Buffer.from('tampered').toString('base64') };
  assert.throws(() => decryptField(tampered, key), /could not be authenticated/);
  assert.throws(() => encryptField('value', crypto.randomBytes(16)), /exactly 32 bytes/);
});

test('credential key provider is lazy and can protect a newly created key without command-line secrets', async () => {
  const writes = [];
  let protectionInput = '';
  const provider = createCredentialKeyProvider({
    env: {},
    platform: 'win32',
    keyPath: 'C:\\safe\\credential-key',
    readFile: async () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error; },
    mkdir: async () => {},
    writeFile: async (...args) => { writes.push(args); },
    randomBytes: () => Buffer.alloc(32, 7),
    protect: async (value) => { protectionInput = value; return `protected:${value.length}`; },
  });

  assert.deepEqual(provider.getStatus(), { available: true, source: 'windows-user-credential-store' });
  assert.equal(writes.length, 0);
  const key = await provider.ensureKey();
  assert.equal(key.length, 32);
  assert.equal(Buffer.from(protectionInput, 'base64').length, 32);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1], 'protected:44');
  assert.equal(writes[0][2].flag, 'wx');
});

test('Questrade API host allowlist fails closed', () => {
  assert.equal(validateQuestradeApiUrl('https://api01.iq.questrade.com/v1'), 'https://api01.iq.questrade.com/v1');
  for (const value of [
    'http://api01.iq.questrade.com/v1',
    'https://api01.iq.questrade.com.evil.example/v1',
    'https://user@api01.iq.questrade.com/v1',
    'https://api01.iq.questrade.com:444/v1',
    'https://api01.iq.questrade.com/private',
  ]) {
    assert.throws(() => validateQuestradeApiUrl(value), /Questrade returned/);
  }
});

test('provider and persistence contracts remain read-only and secret-safe', () => {
  const adapter = createFixtureAdapter();
  assert.equal(typeof adapter.getPositions, 'function');
  assert.equal(adapter.placeOrder, undefined);
  assert.equal(adapter.cancelOrder, undefined);

  for (const field of ['accessToken', 'refreshToken', 'tokenExpiresAt', 'apiServer']) {
    assert.equal(QuestradeConnection.schema.path(field).options.select, false, field);
  }

  const serialized = serializeQuestradeConnection({
    provider: 'questrade',
    safeAccountId: 'margin-demo-01',
    state: 'connected',
    accessToken: 'access-token-canary',
    refreshToken: 'refresh-token-canary',
    apiServer: 'https://api01.iq.questrade.com',
    rawPayload: { balance: 999 },
  });
  const text = JSON.stringify(serialized);
  assert.deepEqual(serialized, { provider: 'questrade', safeAccountId: 'margin-demo-01', state: 'connected' });
  assert.doesNotMatch(text, /token-canary|api01|balance|999/);
});
