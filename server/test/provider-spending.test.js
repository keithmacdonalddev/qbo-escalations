'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ProviderSpendingError,
  getProviderSpendingSnapshot,
  refreshProviderSpending,
  setStoredReportingKey,
} = require('../src/services/provider-spending');
const {
  getLocalObserved,
  monthWindow,
  parseAnthropicReport,
  parseGatewayReport,
  parseKimiReport,
  parseOpenAiReport,
  requestJson,
  safeProviderMessage,
} = require('../src/services/provider-spending')._internal;

const NOW = new Date('2026-07-21T18:30:00.000Z');

test('provider parsers keep reported balances separate from month-to-date spend', () => {
  const window = monthWindow(NOW);
  const openai = parseOpenAiReport({
    data: [
      { results: [{ amount: { value: 1.125 } }, { amount: { value: '0.375' } }] },
      { results: [{ amount: { value: 2 } }] },
    ],
  }, window);
  assert.equal(openai.kind, 'organization-spend');
  assert.equal(openai.spendUsd, 3.5);
  assert.equal(openai.balanceUsd, null);

  const anthropic = parseAnthropicReport({
    data: [{ results: [{ amount: '150.5' }, { amount: 49.5 }] }],
  }, window);
  assert.equal(anthropic.kind, 'organization-spend');
  assert.equal(anthropic.spendUsd, 2);
  assert.equal(anthropic.balanceUsd, null);

  const kimi = parseKimiReport({
    status: true,
    data: { available_balance: '18.25', cash_balance: '12.00', voucher_balance: '6.25' },
  }, window);
  assert.equal(kimi.kind, 'account-balance');
  assert.equal(kimi.balanceUsd, 18.25);
  assert.equal(kimi.cashBalanceUsd, 12);
  assert.equal(kimi.voucherBalanceUsd, 6.25);
});

test('gateway reports distinguish managed-key credit from operator-key usage', () => {
  const window = monthWindow(NOW);
  const managed = parseGatewayReport({
    usage: { totalCostUsd: 9 },
    credits: { balanceUsd: 21 },
    currentBillingPeriod: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
      usage: { totalCostUsd: 4 },
      status: { remainingCostUsd: 6, remainingRequests: 100, remainingTokens: 2000 },
    },
  }, window);
  assert.equal(managed.spendUsd, 4);
  assert.equal(managed.balanceUsd, 21);
  assert.equal(managed.remainingBudgetUsd, 6);

  const operator = parseGatewayReport({ usage: { totalCostUsd: 9 } }, window);
  assert.equal(operator.spendUsd, 9);
  assert.equal(operator.balanceUsd, null);
  assert.match(operator.note, /Static operator keys/);
});

test('app-observed usage exposes evidence coverage instead of presenting an estimate as exact', async () => {
  let receivedPipeline;
  const usageModel = {
    db: { readyState: 1 },
    aggregate: async (pipeline) => {
      receivedPipeline = pipeline;
      return [{
        requests: 4,
        totalTokens: 1250,
        totalCostNanos: 2_500_000_000,
        usageAvailableCount: 3,
        fullyCostedCount: 2,
      }];
    },
  };
  const observed = await getLocalObserved('openai', { usageModel, now: NOW });
  assert.equal(observed.available, true);
  assert.equal(observed.spendUsd, 2.5);
  assert.equal(observed.usageCoveragePercent, 75);
  assert.equal(observed.fullyCostedPercent, 50);
  assert.deepEqual(receivedPipeline[0].$match.provider.$in, ['openai']);
});

test('refresh uses the server-only admin key without exposing or persisting it', async () => {
  const state = { version: 1, providers: {} };
  const recordAttemptFn = (providerId, patch) => {
    state.providers[providerId] = { ...(state.providers[providerId] || {}), ...patch };
  };
  let outboundAuthorization = '';
  const result = await refreshProviderSpending('openai', {
    env: { OPENAI_ADMIN_KEY: 'admin-secret-value' },
    resolveReportingCredentialFn: (_providerId, { env }) => ({ key: env.OPENAI_ADMIN_KEY, source: 'environment' }),
    now: NOW,
    usageModel: { db: { readyState: 0 } },
    readStateFn: () => state,
    recordAttemptFn,
    requestJsonFn: async ({ headers }) => {
      outboundAuthorization = headers.Authorization;
      return { data: [{ results: [{ amount: { value: 1.25 } }] }] };
    },
  });

  assert.equal(outboundAuthorization, 'Bearer admin-secret-value');
  assert.equal(result.providerReport.spendUsd, 1.25);
  assert.equal(result.credential.configured, true);
  assert.doesNotMatch(JSON.stringify(result), /admin-secret-value/);
  assert.doesNotMatch(JSON.stringify(state), /admin-secret-value/);
});

test('saved admin reporting keys are represented by status only and never returned', async () => {
  const snapshot = await getProviderSpendingSnapshot('anthropic', {
    env: {},
    usageModel: { db: { readyState: 0 } },
    readStateFn: () => ({ version: 1, providers: {} }),
    resolveReportingCredentialFn: () => ({ key: 'stored-admin-secret', source: 'saved' }),
  });

  assert.equal(snapshot.credential.configured, true);
  assert.equal(snapshot.credential.source, 'saved');
  assert.equal(snapshot.credential.uiManaged, true);
  assert.doesNotMatch(JSON.stringify(snapshot), /stored-admin-secret/);
});

test('UI-managed reporting keys can be saved, replaced, and removed without touching model keys', () => {
  let stored = { anthropic: 'existing-anthropic-admin' };
  const deps = {
    readKeysFn: () => ({ ...stored }),
    writeKeysFn: (next) => { stored = next; },
  };

  setStoredReportingKey('openai', 'new-openai-admin', deps);
  assert.deepEqual(stored, {
    anthropic: 'existing-anthropic-admin',
    openai: 'new-openai-admin',
  });

  setStoredReportingKey('openai', '', deps);
  assert.deepEqual(stored, { anthropic: 'existing-anthropic-admin' });
  assert.throws(
    () => setStoredReportingKey('gemini', 'not-supported', deps),
    (error) => error instanceof ProviderSpendingError && error.code === 'REPORTING_KEY_NOT_SUPPORTED'
  );
});

test('all providers return a consistent spending snapshot even without billing APIs', async () => {
  const providers = ['claude', 'anthropic', 'llm-gateway', 'codex', 'openai', 'gemini', 'kimi', 'lm-studio'];
  for (const providerId of providers) {
    const snapshot = await getProviderSpendingSnapshot(providerId, {
      env: {},
      usageModel: { db: { readyState: 0 } },
      readStateFn: () => ({ version: 1, providers: {} }),
      resolveApiKeyFn: async () => '',
      resolveReportingCredentialFn: () => ({ key: '', source: 'missing' }),
    });
    assert.equal(snapshot.providerId, providerId);
    assert.equal(typeof snapshot.summary, 'string');
    assert.equal(snapshot.localObserved.available, false);
  }
});

test('provider diagnostics redact credential-like values before they reach cached evidence or the UI', () => {
  const message = safeProviderMessage(
    { message: 'Authorization Bearer sk-example-secret-value-1234567890 was rejected' },
    'Fallback'
  );
  assert.equal(message, 'Authorization Bearer [redacted] was rejected');
});

test('reporting requests reject insecure non-loopback URLs', async () => {
  await assert.rejects(
    requestJson({ url: 'http://example.com/reporting' }),
    (error) => error instanceof ProviderSpendingError && error.code === 'UNSAFE_REPORTING_URL'
  );
});
