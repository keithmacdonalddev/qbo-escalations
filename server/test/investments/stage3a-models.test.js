'use strict';

process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const test = require('node:test');
const mongo = require('../_mongo-helper');
const InvestmentAccount = require('../../src/models/InvestmentAccount');
const InvestmentSnapshot = require('../../src/models/InvestmentSnapshot');
const InvestmentSyncRun = require('../../src/models/InvestmentSyncRun');
const { createSnapshotRepository } = require('../../src/services/investments/snapshot-repository');

test.before(async () => {
  await mongo.connect();
  await Promise.all([InvestmentAccount.syncIndexes(), InvestmentSnapshot.syncIndexes(), InvestmentSyncRun.syncIndexes()]);
});

test.after(async () => {
  await Promise.all([InvestmentAccount.deleteMany({}), InvestmentSnapshot.deleteMany({}), InvestmentSyncRun.deleteMany({})]);
  await mongo.disconnect();
});

test('Stage 3A Mongo models enforce one active run and select the latest complete snapshot through the account/time index', async () => {
  const repository = createSnapshotRepository();
  const accountKey = 'safe-stage3a-mongo-account-01';
  await repository.ensureAccount({
    accountKey,
    provider: 'questrade',
    sourceMode: 'simulated',
    sourceRef: 'fixture-margin-primary',
    label: 'Margin account',
    accountType: 'Margin',
    lastSeenAt: new Date('2026-08-15T12:00:00.000Z'),
  });
  const storedAccount = await repository.findAccountBySource({
    provider: 'questrade',
    sourceMode: 'simulated',
    sourceRef: 'fixture-margin-primary',
  });
  assert.equal(storedAccount.sourceRef, 'fixture-margin-primary');
  const run = (runId, status = 'running') => ({
    runId, accountKey, provider: 'questrade', sourceMode: 'simulated', status,
    steps: [], startedAt: new Date('2026-08-15T12:00:00.000Z'), deadlineAt: new Date('2026-08-15T12:01:00.000Z'),
  });
  await repository.createRun(run('safe-stage3a-mongo-run-01'));
  await assert.rejects(repository.createRun(run('safe-stage3a-mongo-run-02')), (error) => error?.code === 11000);
  await repository.updateRun('safe-stage3a-mongo-run-01', { status: 'completed', completedAt: new Date('2026-08-15T12:00:30.000Z') });
  await repository.createRun(run('safe-stage3a-mongo-run-02'));

  const snapshot = (id, observedAt) => ({
    snapshotId: id, runId: `run-${id}`, accountKey, provider: 'questrade', accountType: 'Margin', sourceMode: 'simulated',
    observedAt: new Date(observedAt), fetchedAt: new Date(observedAt), complete: true,
    contentHash: `hash-${id}`, balances: [{ currency: 'CAD', cash: '0' }], positions: [], counts: { currencies: 1, positions: 0 },
  });
  await repository.insertSnapshot(snapshot('safe-stage3a-snapshot-old', '2026-08-15T11:00:00.000Z'));
  await repository.insertSnapshot(snapshot('safe-stage3a-snapshot-new', '2026-08-15T12:00:00.000Z'));
  assert.equal((await repository.latestSnapshot(accountKey)).snapshotId, 'safe-stage3a-snapshot-new');
  assert.equal(await repository.hasSnapshots(), true);
});
