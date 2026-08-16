'use strict';

process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  forceInvestmentAccountReplayGap,
  getInvestmentAccountEventWindow,
  publishInvestmentAccountEvent,
  resetInvestmentAccountEvents,
} = require('../../src/services/investment-account-events');
const investmentAccountChannel = require('../../src/services/realtime-channels/investment-account');
const { decimalString } = require('../../src/services/investments/money');
const { normalizeBalances, normalizePositions } = require('../../src/services/investments/snapshot-normalizers');
const { createFixtureSnapshotSource } = require('../../src/services/investments/snapshot-fixtures');
const { createSnapshotService } = require('../../src/services/investments/snapshot-service');

function memoryRepository() {
  const state = { accounts: [], runs: [], snapshots: [] };
  const copy = (value) => value ? structuredClone(value) : null;
  return {
    state,
    async findAccountBySource(query) {
      return copy(state.accounts.find((row) => row.provider === query.provider && row.sourceMode === query.sourceMode && row.sourceRef === query.sourceRef));
    },
    async ensureAccount(account) {
      let row = state.accounts.find((candidate) => candidate.provider === account.provider && candidate.sourceMode === account.sourceMode && candidate.sourceRef === account.sourceRef);
      if (!row) { row = copy(account); state.accounts.push(row); }
      else Object.assign(row, copy(account));
      return copy(row);
    },
    async findRun(runId) { return copy(state.runs.find((row) => row.runId === runId)); },
    async findActiveRun(accountKey) { return copy(state.runs.find((row) => row.accountKey === accountKey && row.status === 'running')); },
    async latestRun(accountKey) { return copy(state.runs.filter((row) => row.accountKey === accountKey).at(-1)); },
    async createRun(run) { state.runs.push(copy(run)); return copy(run); },
    async updateRun(runId, changes) {
      const run = state.runs.find((row) => row.runId === runId);
      Object.assign(run, copy(changes));
      return copy(run);
    },
    async latestSnapshot(accountKey = '') {
      return copy(state.snapshots.filter((row) => row.complete && (!accountKey || row.accountKey === accountKey))
        .sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))[0]);
    },
    async findSnapshotByRun(runId) { return copy(state.snapshots.find((row) => row.runId === runId && row.complete)); },
    async insertSnapshot(snapshot) { state.snapshots.push(copy(snapshot)); return copy(snapshot); },
    async counts() {
      const result = { accounts: state.accounts.length, runs: state.runs.length, snapshots: state.snapshots.length };
      return { ...result, total: result.accounts + result.runs + result.snapshots };
    },
    async listAccountKeys() { return state.accounts.map((row) => row.accountKey); },
    async deleteAll() {
      const deleted = await this.counts();
      state.accounts.length = 0; state.runs.length = 0; state.snapshots.length = 0;
      return { deleted, remaining: await this.counts() };
    },
    async hasSnapshots() { return state.snapshots.some((row) => row.complete); },
  };
}

function harness({ scenario = 'healthy-margin-cad-usd' } = {}) {
  const repository = memoryRepository();
  const pending = [];
  let sequence = 0;
  const clock = { value: Date.parse('2026-08-15T12:01:00.000Z') };
  const service = createSnapshotService({
    repository,
    sourceProvider: { getSource: async ({ scenario: requested }) => createFixtureSnapshotSource(requested || scenario) },
    randomUUID: () => `safe-stage3a-id-${++sequence}`,
    now: () => new Date(clock.value++),
    setImmediateFn: (callback) => pending.push(callback),
  });
  async function flush() {
    while (pending.length) await pending.shift()();
  }
  return { repository, service, flush, clock };
}

test('money helper and normalizers preserve exact, zero, negative, missing, and multi-currency values', () => {
  assert.equal(decimalString('1000000000000000000.0100'), '1000000000000000000.01');
  assert.equal(decimalString('-0.1250'), '-0.125');
  assert.equal(decimalString(0), '0');
  assert.equal(decimalString(null), null);
  assert.throws(() => decimalString('NaN'), /finite decimal/);

  const balances = normalizeBalances({ perCurrencyBalances: [
    { currency: 'USD', cash: '-42.50', totalEquity: '100.00' },
    { currency: 'CAD', cash: '0', totalEquity: null },
  ] });
  assert.deepEqual(balances.map((row) => row.currency), ['CAD', 'USD']);
  assert.equal(balances[0].cash, '0');
  assert.equal(balances[0].totalEquity, null);
  assert.equal(balances[1].cash, '-42.5');

  const positions = normalizePositions({ positions: [{ symbol: 'SHORT', openQuantity: '-7.2500', averageEntryPrice: null }] });
  assert.equal(positions[0].quantity, '-7.25');
  assert.equal(positions[0].averagePrice, null);
});

test('complete fixture run publishes one immutable complete snapshot and a four-field event payload', async () => {
  resetInvestmentAccountEvents();
  const { service, repository, flush } = harness();
  const started = await service.startSync({ sourceMode: 'simulated', scenario: 'healthy-margin-cad-usd' });
  assert.equal(started.run.status, 'running');
  await flush();
  const run = await service.getRun(started.run.runId);
  assert.equal(run.status, 'completed');
  assert.equal(repository.state.snapshots.length, 1);
  const latest = await service.getLatest(run.accountKey);
  assert.equal(latest.complete, true);
  assert.deepEqual(latest.counts, { currencies: 2, positions: 3 });
  assert.deepEqual(latest.balances.map((row) => row.currency), ['CAD', 'USD']);
  assert.equal(latest.positions[2].averagePrice, null);

  const window = getInvestmentAccountEventWindow(0);
  const published = window.events.find((event) => event.data.eventType === 'snapshot-published');
  assert.ok(published);
  assert.deepEqual(Object.keys(published.data).sort(), ['accountKey', 'eventTime', 'eventType', 'snapshotId']);
  assert.doesNotMatch(JSON.stringify(published.data), /FIXTURE|1250|token|symbol/i);
});

test('incomplete refresh saves no partial snapshot and preserves the prior latest snapshot', async () => {
  const { service, repository, flush } = harness();
  const first = await service.startSync({ sourceMode: 'simulated', scenario: 'healthy-margin-cad-usd' });
  await flush();
  const firstRun = await service.getRun(first.run.runId);
  const originalSnapshotId = firstRun.snapshotId;

  const failed = await service.startSync({ sourceMode: 'simulated', scenario: 'partial-positions-response' });
  await flush();
  const failedRun = await service.getRun(failed.run.runId);
  assert.equal(failedRun.status, 'incomplete');
  assert.equal(failedRun.failureSection, 'positions');
  assert.equal(repository.state.snapshots.length, 1);
  assert.equal((await service.getLatest(failedRun.accountKey)).snapshotId, originalSnapshotId);
});

test('simultaneous starts reuse one active run and a post-insert finalization failure reconciles without duplication', async () => {
  const { service, repository, flush } = harness();
  const first = await service.startSync({ sourceMode: 'simulated', scenario: 'finalization-failure' });
  const second = await service.startSync({ sourceMode: 'simulated', scenario: 'finalization-failure' });
  assert.equal(second.reused, true);
  assert.equal(second.run.runId, first.run.runId);
  await flush();
  assert.equal(repository.state.snapshots.length, 1);
  assert.equal(repository.state.runs[0].status, 'running');
  const reconciled = await service.getRun(first.run.runId);
  assert.equal(reconciled.status, 'completed');
  assert.equal(repository.state.snapshots.length, 1);
  const workbench = await service.getWorkbench({ sourceMode: 'simulated', scenario: 'finalization-failure' });
  assert.equal(workbench.activeRun, null);
  assert.equal(workbench.latestRun.status, 'completed');
});

test('bounded deletion removes only Stage 3A repository records and a later fixture run creates a new account key', async () => {
  const { service, repository, flush } = harness();
  const first = await service.startSync({ sourceMode: 'simulated', scenario: 'healthy-margin-cad-usd' });
  await flush();
  const originalKey = first.run.accountKey;
  const deletion = await service.deleteLocalData();
  assert.deepEqual(deletion.deleted, { accounts: 1, runs: 1, snapshots: 1, total: 3 });
  assert.deepEqual(deletion.remaining, { accounts: 0, runs: 0, snapshots: 0, total: 0 });
  assert.equal(repository.state.accounts.length, 0);

  const next = await service.startSync({ sourceMode: 'simulated', scenario: 'healthy-margin-cad-usd' });
  assert.notEqual(next.run.accountKey, originalKey);
});

test('investment realtime channel requires REST resync after a replay gap and carries no financial values', async () => {
  resetInvestmentAccountEvents();
  const accountKey = 'safe-stage3a-account-01';
  assert.ok(forceInvestmentAccountReplayGap(accountKey) > 200);
  const messages = [];
  const unsubscribe = await investmentAccountChannel.subscribe({
    key: accountKey,
    params: { since: 1 },
    sendEvent: (event, data, meta) => messages.push({ event, data, meta }),
  });
  const reset = messages.find((message) => message.event === 'snapshot');
  assert.equal(reset.meta.resyncRequired, true);
  assert.deepEqual(Object.keys(reset.data).sort(), ['accountKey', 'eventTime', 'eventType', 'snapshotId']);

  publishInvestmentAccountEvent({ accountKey, eventType: 'snapshot-published', snapshotId: 'safe-stage3a-snapshot-01' });
  const published = messages.at(-1);
  assert.equal(published.event, 'snapshot-published');
  assert.doesNotMatch(JSON.stringify(published), /balance|position|cash|token|FIXTURE/i);
  unsubscribe();
});
