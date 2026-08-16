'use strict';

const crypto = require('node:crypto');

const { publishInvestmentAccountEvent } = require('../investment-account-events');
const { normalizeAccount, normalizeBalances, normalizePositions } = require('./snapshot-normalizers');
const { createSnapshotRepository } = require('./snapshot-repository');
const { createSnapshotSourceProvider } = require('./snapshot-source-provider');

const STEP_IDS = Object.freeze(['account', 'balances', 'positions', 'validate', 'publish']);
const DEFAULT_DEADLINE_MS = 45_000;
const INTERRUPTED_GRACE_MS = 5_000;

function safeFailureCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return /^QUESTRADE_[A-Z0-9_]+$/.test(code) || /^SNAPSHOT_[A-Z0-9_]+$/.test(code)
    ? code
    : 'SNAPSHOT_VERIFICATION_FAILED';
}

function initialSteps() {
  return STEP_IDS.map((id) => ({ id, status: 'pending', startedAt: null, completedAt: null }));
}

function updateSteps(steps, stepId, status, at) {
  return steps.map((step) => step.id === stepId ? {
    ...step,
    status,
    ...(status === 'running' ? { startedAt: at } : {}),
    ...(['completed', 'failed'].includes(status) ? { completedAt: at } : {}),
  } : step);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function publicRun(run) {
  if (!run) return null;
  return {
    runId: run.runId,
    accountKey: run.accountKey,
    sourceMode: run.sourceMode,
    status: run.status,
    steps: (run.steps || []).map((step) => ({
      id: step.id,
      status: step.status,
      startedAt: step.startedAt || null,
      completedAt: step.completedAt || null,
    })),
    currentStep: run.currentStep || null,
    snapshotId: run.snapshotId || null,
    priorSnapshotId: run.priorSnapshotId || null,
    failureSection: run.failureSection || null,
    failureCode: run.failureCode || null,
    startedAt: run.startedAt,
    completedAt: run.completedAt || null,
  };
}

function publicSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    snapshotId: snapshot.snapshotId,
    accountKey: snapshot.accountKey,
    accountType: snapshot.accountType,
    sourceMode: snapshot.sourceMode,
    observedAt: snapshot.observedAt,
    fetchedAt: snapshot.fetchedAt,
    complete: snapshot.complete === true,
    contentHash: snapshot.contentHash,
    balances: snapshot.balances || [],
    positions: snapshot.positions || [],
    counts: snapshot.counts || { currencies: 0, positions: 0 },
  };
}

function withDeadline(promise, deadlineAt, currentTimeMs = Date.now()) {
  const remaining = Math.max(1, deadlineAt.getTime() - currentTimeMs);
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Snapshot verification exceeded its total deadline.'), {
        code: 'SNAPSHOT_DEADLINE_EXCEEDED',
      })), remaining);
      timer.unref?.();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function createSnapshotService(options = {}) {
  const repository = options.repository || createSnapshotRepository();
  const sourceProvider = options.sourceProvider || createSnapshotSourceProvider({ connectionService: options.connectionService });
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const now = options.now || (() => new Date());
  const deadlineMs = options.deadlineMs || DEFAULT_DEADLINE_MS;
  const setImmediateFn = options.setImmediateFn || setImmediate;
  const publishEvent = options.publishEvent || publishInvestmentAccountEvent;
  const finalizationFailureRuns = new Set();

  async function reconcileRun(run) {
    if (!run) return null;
    const snapshot = await repository.findSnapshotByRun(run.runId);
    if (snapshot && run.status !== 'completed') {
      return repository.updateRun(run.runId, {
        status: 'completed',
        snapshotId: snapshot.snapshotId,
        currentStep: null,
        completedAt: run.completedAt || snapshot.fetchedAt || now(),
        failureSection: null,
        failureCode: null,
        steps: STEP_IDS.map((id) => ({ id, status: 'completed', startedAt: run.startedAt, completedAt: snapshot.fetchedAt })),
      });
    }
    if (run.status === 'running') {
      const deadline = new Date(run.deadlineAt || 0).getTime();
      if (!Number.isFinite(deadline) || deadline + INTERRUPTED_GRACE_MS < now().getTime()) {
        return repository.updateRun(run.runId, {
          status: 'failed',
          currentStep: null,
          completedAt: now(),
          failureSection: run.currentStep || 'recovery',
          failureCode: 'SNAPSHOT_RUN_INTERRUPTED',
          steps: (run.steps || initialSteps()).map((step) => step.status === 'running'
            ? { ...step, status: 'failed', completedAt: now() }
            : step),
        });
      }
    }
    return run;
  }

  async function step(run, stepId, operation) {
    const startedAt = now();
    run.steps = updateSteps(run.steps, stepId, 'running', startedAt);
    run.currentStep = stepId;
    await repository.updateRun(run.runId, { steps: run.steps, currentStep: stepId });
    publishEvent({ accountKey: run.accountKey, eventType: 'sync-progressed', eventTime: startedAt, snapshotId: null });
    try {
      const result = await withDeadline(Promise.resolve().then(operation), new Date(run.deadlineAt), now().getTime());
      const completedAt = now();
      run.steps = updateSteps(run.steps, stepId, 'completed', completedAt);
      await repository.updateRun(run.runId, { steps: run.steps });
      return result;
    } catch (error) {
      const failedAt = now();
      run.steps = updateSteps(run.steps, stepId, 'failed', failedAt);
      error.snapshotSection = error.section || stepId;
      throw error;
    }
  }

  async function execute(run, source) {
    try {
      const rawAccount = await step(run, 'account', () => source.getAccount());
      const account = normalizeAccount({ ...rawAccount, accountType: source.accountType, label: source.label });
      const rawBalances = await step(run, 'balances', () => source.getBalances());
      const rawPositions = await step(run, 'positions', () => source.getPositions());
      const normalized = await step(run, 'validate', () => ({
        account,
        balances: normalizeBalances(rawBalances),
        positions: normalizePositions(rawPositions),
      }));
      const fetchedAt = now();
      const observedAt = source.observedAt ? new Date(source.observedAt) : fetchedAt;
      if (!Number.isFinite(observedAt.getTime())) throw Object.assign(new Error('The provider observation time is invalid.'), { code: 'SNAPSHOT_INVALID_OBSERVED_TIME' });
      const snapshotId = randomUUID();
      const snapshotBody = {
        snapshotId,
        runId: run.runId,
        accountKey: run.accountKey,
        provider: source.provider,
        accountType: normalized.account.accountType,
        sourceMode: source.sourceMode,
        observedAt,
        fetchedAt,
        complete: true,
        balances: normalized.balances,
        positions: normalized.positions,
        counts: { currencies: normalized.balances.length, positions: normalized.positions.length },
      };
      snapshotBody.contentHash = contentHash({
        accountType: snapshotBody.accountType,
        balances: snapshotBody.balances,
        positions: snapshotBody.positions,
      });
      const saved = await step(run, 'publish', () => repository.insertSnapshot(snapshotBody));
      if (source.failFinalizationOnce && !finalizationFailureRuns.has(run.runId)) {
        finalizationFailureRuns.add(run.runId);
        return;
      }
      const completedAt = now();
      await repository.updateRun(run.runId, {
        status: 'completed',
        currentStep: null,
        snapshotId: saved.snapshotId,
        completedAt,
        failureSection: null,
        failureCode: null,
        steps: run.steps,
      });
      publishEvent({ accountKey: run.accountKey, eventType: 'snapshot-published', eventTime: completedAt, snapshotId: saved.snapshotId });
    } catch (error) {
      const failureCode = safeFailureCode(error);
      const completedAt = now();
      const status = error.snapshotSection && ['balances', 'positions', 'validate', 'publish'].includes(error.snapshotSection)
        ? 'incomplete'
        : 'failed';
      await repository.updateRun(run.runId, {
        status,
        steps: run.steps,
        currentStep: null,
        completedAt,
        failureSection: error.snapshotSection || 'account',
        failureCode,
      });
      publishEvent({
        accountKey: run.accountKey,
        eventType: failureCode === 'QUESTRADE_AUTHORIZATION_REQUIRED' ? 'reauthorization-required' : 'sync-failed',
        eventTime: completedAt,
        snapshotId: run.priorSnapshotId || null,
      });
    }
  }

  async function startSync({ sourceMode = 'live', scenario = '' } = {}) {
    const source = await sourceProvider.getSource({ sourceMode, scenario });
    const account = normalizeAccount({ accountType: source.accountType, label: source.label });
    const seenAt = now();
    let storedAccount = await repository.findAccountBySource({
      provider: source.provider,
      sourceMode: source.sourceMode,
      sourceRef: source.sourceRef,
    });
    if (!storedAccount) {
      storedAccount = await repository.ensureAccount({
        accountKey: randomUUID(),
        provider: source.provider,
        sourceMode: source.sourceMode,
        sourceRef: source.sourceRef,
        label: account.label,
        accountType: account.accountType,
        lastSeenAt: seenAt,
      });
    } else {
      storedAccount = await repository.ensureAccount({ ...storedAccount, lastSeenAt: seenAt });
    }

    const active = await repository.findActiveRun(storedAccount.accountKey);
    if (active) return { reused: true, run: publicRun(await reconcileRun(active)) };
    const prior = await repository.latestSnapshot(storedAccount.accountKey);
    const run = {
      runId: randomUUID(),
      accountKey: storedAccount.accountKey,
      provider: source.provider,
      sourceMode: source.sourceMode,
      status: 'running',
      steps: initialSteps(),
      currentStep: null,
      snapshotId: null,
      priorSnapshotId: prior?.snapshotId || null,
      failureSection: null,
      failureCode: null,
      startedAt: seenAt,
      completedAt: null,
      deadlineAt: new Date(seenAt.getTime() + deadlineMs),
    };
    let savedRun;
    try {
      savedRun = await repository.createRun(run);
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const reused = await repository.findActiveRun(storedAccount.accountKey);
      return { reused: true, run: publicRun(await reconcileRun(reused)) };
    }
    publishEvent({ accountKey: savedRun.accountKey, eventType: 'sync-started', eventTime: seenAt, snapshotId: prior?.snapshotId || null });
    setImmediateFn(() => execute(savedRun, source));
    return { reused: false, run: publicRun(savedRun) };
  }

  async function getRun(runId) {
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(String(runId || ''))) return null;
    return publicRun(await reconcileRun(await repository.findRun(runId)));
  }

  async function getLatest(accountKey = '') {
    return publicSnapshot(await repository.latestSnapshot(accountKey));
  }

  async function getWorkbench({ sourceMode = 'live', scenario = '' } = {}) {
    let account = null;
    let sourceError = null;
    try {
      const source = typeof sourceProvider.inspectSource === 'function'
        ? await sourceProvider.inspectSource({ sourceMode, scenario })
        : await sourceProvider.getSource({ sourceMode, scenario });
      account = await repository.findAccountBySource({
        provider: source.provider,
        sourceMode: source.sourceMode,
        sourceRef: source.sourceRef,
      });
    } catch (error) {
      sourceError = { code: safeFailureCode(error), message: error.message };
    }
    const active = account ? await repository.findActiveRun(account.accountKey) : null;
    const latestRun = account ? await repository.latestRun(account.accountKey) : null;
    const latest = account ? await repository.latestSnapshot(account.accountKey) : null;
    const reconciledActive = active ? await reconcileRun(active) : null;
    const reconciledLatest = latestRun ? await reconcileRun(latestRun) : null;
    const resolvedLatest = reconciledActive && reconciledActive.status !== 'running'
      ? reconciledActive
      : reconciledLatest;
    return {
      ok: true,
      sourceMode,
      account: account ? { accountKey: account.accountKey, label: account.label, accountType: account.accountType } : null,
      readiness: sourceError ? 'blocked' : 'ready',
      sourceError,
      activeRun: publicRun(reconciledActive?.status === 'running' ? reconciledActive : null),
      latestRun: publicRun(resolvedLatest),
      latestSnapshot: publicSnapshot(latest),
      storedCounts: await repository.counts(),
    };
  }

  async function deleteLocalData() {
    const accountKeys = await repository.listAccountKeys();
    const result = await repository.deleteAll();
    const eventTime = now();
    accountKeys.forEach((accountKey) => publishEvent({ accountKey, eventType: 'snapshot-data-deleted', eventTime, snapshotId: null }));
    return result;
  }

  return {
    deleteLocalData,
    getLatest,
    getRun,
    getWorkbench,
    hasSavedSnapshot: repository.hasSnapshots,
    startSync,
  };
}

module.exports = {
  DEFAULT_DEADLINE_MS,
  STEP_IDS,
  contentHash,
  createSnapshotService,
  publicRun,
  publicSnapshot,
};
