'use strict';

process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { decryptField } = require('../../src/lib/field-encryption');
const { createQuestradeConnectionService } = require('../../src/services/investments/questrade-connection-service');
const { createLiveQuestradeAdapter } = require('../../src/services/investments/providers/questrade/live-adapter');
const { REVOKE_ENDPOINT, TOKEN_ENDPOINT, createQuestradeOAuthClient } = require('../../src/services/investments/providers/questrade/oauth-client');

function createMemoryRepository(initialRecord = null) {
  let record = initialRecord;
  return {
    appendAudit: async (event) => {
      record = { provider: 'questrade', ...(record || {}), auditEvents: [...(record?.auditEvents || []), event] };
    },
    find: async () => record,
    update: async (changes, options = {}) => {
      record = { provider: 'questrade', ...(record || {}), ...changes };
      for (const field of options.unset || []) delete record[field];
      return record;
    },
    remove: async () => { record = null; },
    read: () => record,
  };
}

function jsonResponse(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    text: async () => JSON.stringify(payload),
  };
}

test('OAuth exchange uses the fixed secure endpoint and returns a validated rotating token set', async () => {
  const calls = [];
  const client = createQuestradeOAuthClient({
    now: () => Date.parse('2026-08-15T09:00:00.000Z'),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse(200, {
        access_token: 'access-token-canary',
        refresh_token: 'rotated-refresh-canary',
        token_type: 'Bearer',
        expires_in: 300,
        api_server: 'https://api01.iq.questrade.com',
      });
    },
  });

  const token = await client.exchangeRefreshToken('manual-refresh-canary');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, TOKEN_ENDPOINT);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.redirect, 'error');
  assert.match(calls[0].options.body, /grant_type=refresh_token/);
  assert.match(calls[0].options.body, /manual-refresh-canary/);
  assert.equal(token.apiServer, 'https://api01.iq.questrade.com/v1');
  assert.equal(token.expiresAt.toISOString(), '2026-08-15T09:05:00.000Z');
});

test('OAuth revocation uses the fixed secure endpoint without following redirects', async () => {
  const calls = [];
  const client = createQuestradeOAuthClient({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse(200, {});
    },
  });

  await client.revoke('access-token-canary');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, REVOKE_ENDPOINT);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.body, 'token=access-token-canary');
});

test('live adapter uses bearer headers, the approved API server, and read-only methods only', async () => {
  const urls = [];
  const adapter = createLiveQuestradeAdapter({
    apiServer: 'https://api01.iq.questrade.com/v1',
    accessToken: 'access-token-canary',
    now: () => new Date('2026-08-15T09:00:00.000Z'),
    fetchImpl: async (url, options) => {
      urls.push({ url: String(url), options });
      return jsonResponse(200, String(url).endsWith('/accounts') ? { accounts: [{ number: '12345678', type: 'Margin' }] } : {});
    },
  });

  await adapter.getAccounts();
  await adapter.getBalances('12345678');
  await adapter.getPositions('12345678');
  await adapter.getOrders('12345678');
  await adapter.getExecutions('12345678');
  assert.equal(urls.length, 5);
  assert.ok(urls.every((entry) => entry.url.startsWith('https://api01.iq.questrade.com/v1/')));
  assert.ok(urls.every((entry) => entry.options.headers.Authorization === 'Bearer access-token-canary'));
  assert.equal(adapter.placeOrder, undefined);
  assert.equal(adapter.cancelOrder, undefined);
});

test('connection service encrypts credentials and account identity before returning a safe connected projection', async () => {
  const key = crypto.randomBytes(32);
  let record = null;
  const repository = {
    find: async () => record,
    update: async (changes) => { record = { provider: 'questrade', ...(record || {}), ...changes }; return record; },
    remove: async () => { record = null; },
  };
  const calls = [];
  const service = createQuestradeConnectionService({
    keyProvider: { getStatus: () => ({ available: true, source: 'test' }), ensureKey: async () => key, loadKey: async () => key },
    repository,
    oauthClient: {
      exchangeRefreshToken: async () => ({
        accessToken: 'access-token-canary',
        refreshToken: 'rotated-refresh-canary',
        expiresAt: new Date('2026-08-15T09:05:00.000Z'),
        apiServer: 'https://api01.iq.questrade.com/v1',
      }),
    },
    adapterFactory: () => ({
      getAccounts: async () => [{ number: '98765432', type: 'Margin', status: 'Active', isPrimary: true }],
      getBalances: async () => { calls.push('balances'); return {}; },
      getPositions: async () => { calls.push('positions'); return {}; },
      getOrders: async () => { calls.push('orders'); return {}; },
      getExecutions: async () => { calls.push('executions'); return {}; },
    }),
    randomUUID: () => 'account-key-safe-01',
    now: () => new Date('2026-08-15T09:01:00.000Z'),
  });

  const result = await service.connect({ refreshToken: 'manual-refresh-canary' });
  assert.equal(result.state, 'connected');
  assert.equal(result.selectedAccountKey, 'account-key-safe-01');
  assert.deepEqual(calls, ['balances', 'positions', 'orders', 'executions']);
  assert.equal(decryptField(record.accessToken, key), 'access-token-canary');
  assert.equal(decryptField(record.refreshToken, key), 'rotated-refresh-canary');
  assert.equal(decryptField(record.accounts[0].accountNumber, key), '98765432');
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /token-canary|98765432|api01/);
  assert.equal(result.accounts[0].label, 'Margin account');
});

test('multiple Questrade accounts are projected as opaque choices without account numbers', async () => {
  const key = crypto.randomBytes(32);
  let record = null;
  let id = 0;
  const service = createQuestradeConnectionService({
    keyProvider: { getStatus: () => ({ available: true }), ensureKey: async () => key, loadKey: async () => key },
    repository: {
      find: async () => record,
      update: async (changes) => { record = { provider: 'questrade', ...(record || {}), ...changes }; return record; },
    },
    oauthClient: { exchangeRefreshToken: async () => ({ accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date(), apiServer: 'https://api01.iq.questrade.com/v1' }) },
    adapterFactory: () => ({
      getAccounts: async () => [
        { number: '11111111', type: 'Margin', status: 'Active' },
        { number: '22222222', type: 'Margin', status: 'Active' },
      ],
      getBalances: async () => ({}), getPositions: async () => ({}), getOrders: async () => ({}), getExecutions: async () => ({}),
    }),
    randomUUID: () => `opaque-account-key-${++id}`,
  });

  const result = await service.connect({ refreshToken: 'manual' });
  assert.equal(result.state, 'account-selection-required');
  assert.deepEqual(result.accounts.map((account) => account.label), ['Margin account 1', 'Margin account 2']);
  assert.doesNotMatch(JSON.stringify(result), /11111111|22222222/);
});

test('reauthorization preserves the opaque account identity for the same Questrade account', async () => {
  const key = crypto.randomBytes(32);
  const repository = createMemoryRepository();
  let uuidCount = 0;
  const service = createQuestradeConnectionService({
    keyProvider: { getStatus: () => ({ available: true }), ensureKey: async () => key, loadKey: async () => key },
    repository,
    oauthClient: {
      exchangeRefreshToken: async () => ({
        accessToken: `access-${uuidCount}`,
        refreshToken: `refresh-${uuidCount}`,
        expiresAt: new Date('2026-08-15T10:00:00.000Z'),
        apiServer: 'https://api01.iq.questrade.com/v1',
      }),
    },
    adapterFactory: () => ({
      getAccounts: async () => [{ number: '98765432', type: 'Margin', status: 'Active' }],
      getBalances: async () => ({}), getPositions: async () => ({}), getOrders: async () => ({}), getExecutions: async () => ({}),
    }),
    randomUUID: () => `stable-account-key-${++uuidCount}`,
    now: () => new Date('2026-08-15T09:00:00.000Z'),
  });

  const connected = await service.connect({ refreshToken: 'manual-one' });
  const reauthorized = await service.reauthorize({ refreshToken: 'manual-two' });

  assert.equal(connected.selectedAccountKey, 'stable-account-key-1');
  assert.equal(reauthorized.selectedAccountKey, connected.selectedAccountKey);
});

test('confirmed disconnect revokes remotely and removes credentials while preserving stable account history', async () => {
  const key = crypto.randomBytes(32);
  const repository = createMemoryRepository();
  const revoked = [];
  const service = createQuestradeConnectionService({
    keyProvider: { getStatus: () => ({ available: true }), ensureKey: async () => key, loadKey: async () => key },
    repository,
    oauthClient: {
      exchangeRefreshToken: async () => ({ accessToken: 'access-canary', refreshToken: 'refresh-canary', expiresAt: new Date('2026-08-15T10:00:00.000Z'), apiServer: 'https://api01.iq.questrade.com/v1' }),
      revoke: async (token) => { revoked.push(token); },
    },
    adapterFactory: () => ({
      getAccounts: async () => [{ number: '98765432', type: 'Margin', status: 'Active' }],
      getBalances: async () => ({}), getPositions: async () => ({}), getOrders: async () => ({}), getExecutions: async () => ({}),
    }),
    randomUUID: () => 'stable-account-key-01',
    now: () => new Date('2026-08-15T09:00:00.000Z'),
  });

  await service.connect({ refreshToken: 'manual-canary' });
  const result = await service.disconnect();
  const saved = repository.read();

  assert.deepEqual(revoked, ['access-canary']);
  assert.equal(result.state, 'disconnected');
  assert.equal(result.revocationState, 'confirmed');
  assert.equal(result.liveAccessEnabled, false);
  assert.equal(saved.accessToken, undefined);
  assert.equal(saved.refreshToken, undefined);
  assert.equal(saved.apiServer, undefined);
  assert.equal(saved.accounts[0].accountKey, 'stable-account-key-01');
  assert.doesNotMatch(JSON.stringify(result), /access-canary|refresh-canary|98765432|api01/);
});

test('failed revocation stops local access, supports retry, and permits explicit local forget only while pending', async () => {
  const key = crypto.randomBytes(32);
  const repository = createMemoryRepository();
  let revokeAttempts = 0;
  const service = createQuestradeConnectionService({
    keyProvider: { getStatus: () => ({ available: true }), ensureKey: async () => key, loadKey: async () => key },
    repository,
    oauthClient: {
      exchangeRefreshToken: async () => ({ accessToken: 'access-canary', refreshToken: 'refresh-canary', expiresAt: new Date('2026-08-15T10:00:00.000Z'), apiServer: 'https://api01.iq.questrade.com/v1' }),
      revoke: async () => {
        revokeAttempts += 1;
        throw Object.assign(new Error('offline'), { code: 'QUESTRADE_AUTHORIZATION_UNAVAILABLE' });
      },
    },
    adapterFactory: () => ({
      getAccounts: async () => [{ number: '98765432', type: 'Margin' }],
      getBalances: async () => ({}), getPositions: async () => ({}), getOrders: async () => ({}), getExecutions: async () => ({}),
    }),
    randomUUID: () => 'stable-account-key-02',
    now: () => new Date('2026-08-15T09:00:00.000Z'),
  });

  await service.connect({ refreshToken: 'manual-canary' });
  const pending = await service.disconnect();
  const retried = await service.retryRevocation();

  assert.equal(revokeAttempts, 2);
  assert.equal(pending.state, 'revocation-pending');
  assert.equal(retried.liveAccessEnabled, false);
  assert.equal(repository.read().credentialState, 'revocation-pending');

  const forgotten = await service.forgetLocal();
  assert.equal(forgotten.completionKind, 'forgot-local');
  assert.equal(forgotten.manualRevocationRequired, true);
  assert.equal(repository.read(), null);
});

test('concurrent expired-session checks exchange the rotating refresh token only once', async () => {
  const key = crypto.randomBytes(32);
  const repository = createMemoryRepository();
  let refreshCount = 0;
  const service = createQuestradeConnectionService({
    keyProvider: { getStatus: () => ({ available: true }), ensureKey: async () => key, loadKey: async () => key },
    repository,
    oauthClient: {
      exchangeRefreshToken: async () => {
        refreshCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: new Date('2026-08-15T10:00:00.000Z'), apiServer: 'https://api01.iq.questrade.com/v1' };
      },
    },
    adapterFactory: () => ({
      getAccounts: async () => [{ number: '98765432', type: 'Margin' }],
      getBalances: async () => ({}), getPositions: async () => ({}), getOrders: async () => ({}), getExecutions: async () => ({}),
    }),
    randomUUID: () => 'stable-account-key-03',
    now: () => new Date('2026-08-15T09:00:00.000Z'),
  });

  await service.connect({ refreshToken: 'manual-canary' });
  await repository.update({ tokenExpiresAt: new Date('2026-08-15T08:59:00.000Z') });
  refreshCount = 0;

  const [first, second] = await Promise.all([service.retryVerification(), service.retryVerification()]);
  assert.equal(refreshCount, 1);
  assert.equal(first.state, 'connected');
  assert.equal(second.state, 'connected');
});
