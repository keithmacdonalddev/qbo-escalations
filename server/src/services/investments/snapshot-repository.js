'use strict';

const InvestmentAccount = require('../../models/InvestmentAccount');
const InvestmentSnapshot = require('../../models/InvestmentSnapshot');
const InvestmentSyncRun = require('../../models/InvestmentSyncRun');

function createSnapshotRepository(options = {}) {
  const accountModel = options.accountModel || InvestmentAccount;
  const snapshotModel = options.snapshotModel || InvestmentSnapshot;
  const runModel = options.runModel || InvestmentSyncRun;

  async function findAccountBySource({ provider, sourceMode, sourceRef }) {
    return accountModel.findOne({ provider, sourceMode, sourceRef }).select('+sourceRef').lean().exec();
  }

  async function ensureAccount(account) {
    return accountModel.findOneAndUpdate(
      { provider: account.provider, sourceMode: account.sourceMode, sourceRef: account.sourceRef },
      {
        $set: { label: account.label, accountType: account.accountType, lastSeenAt: account.lastSeenAt },
        $setOnInsert: { accountKey: account.accountKey, provider: account.provider, sourceMode: account.sourceMode, sourceRef: account.sourceRef },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean().exec();
  }

  async function findRun(runId) {
    return runModel.findOne({ runId }).lean().exec();
  }

  async function findActiveRun(accountKey) {
    return runModel.findOne({ accountKey, status: 'running' }).sort({ startedAt: -1 }).lean().exec();
  }

  async function latestRun(accountKey) {
    return runModel.findOne({ accountKey }).sort({ startedAt: -1, createdAt: -1 }).lean().exec();
  }

  async function createRun(run) {
    return runModel.create(run).then((document) => document.toObject());
  }

  async function updateRun(runId, changes) {
    return runModel.findOneAndUpdate({ runId }, { $set: changes }, { new: true }).lean().exec();
  }

  async function latestSnapshot(accountKey = '') {
    const query = { complete: true, ...(accountKey ? { accountKey } : {}) };
    return snapshotModel.findOne(query).sort({ observedAt: -1, createdAt: -1 }).lean().exec();
  }

  async function findSnapshotByRun(runId) {
    return snapshotModel.findOne({ runId, complete: true }).lean().exec();
  }

  async function insertSnapshot(snapshot) {
    return snapshotModel.create(snapshot).then((document) => document.toObject());
  }

  async function counts() {
    const [accounts, runs, snapshots] = await Promise.all([
      accountModel.countDocuments({}),
      runModel.countDocuments({}),
      snapshotModel.countDocuments({}),
    ]);
    return { accounts, runs, snapshots, total: accounts + runs + snapshots };
  }

  async function listAccountKeys() {
    const rows = await accountModel.find({}, { accountKey: 1, _id: 0 }).lean().exec();
    return rows.map((row) => row.accountKey).filter(Boolean);
  }

  async function deleteAll() {
    const before = await counts();
    await snapshotModel.deleteMany({}).exec();
    await runModel.deleteMany({}).exec();
    await accountModel.deleteMany({}).exec();
    return { deleted: before, remaining: await counts() };
  }

  async function hasSnapshots() {
    return Boolean(await snapshotModel.exists({ complete: true }));
  }

  return {
    counts,
    createRun,
    deleteAll,
    ensureAccount,
    findAccountBySource,
    findActiveRun,
    findRun,
    findSnapshotByRun,
    hasSnapshots,
    insertSnapshot,
    latestSnapshot,
    latestRun,
    listAccountKeys,
    updateRun,
  };
}

module.exports = { createSnapshotRepository };
