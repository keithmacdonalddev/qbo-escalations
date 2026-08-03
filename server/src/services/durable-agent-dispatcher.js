'use strict';

const { randomUUID } = require('node:crypto');
const {
  acknowledgeAgentRunCancellation,
  acquireAgentRunLease,
  cancelAgentRun,
  completeAgentRun,
  completeAgentRunAttempt,
  createOrReuseAgentRun,
  heartbeatAgentRunLease,
  recordAgentRunAttempt,
  verifySavedAgentRunOutput,
} = require('./agent-run-service');

const DEFAULT_DISPATCH_LEASE_MS = 15_000;

function safeText(value, max = 1000) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function normalizedAttemptStatus(attempt) {
  if (attempt?.status === 'ok' || attempt?.status === 'succeeded') return 'succeeded';
  if (attempt?.status === 'timeout' || attempt?.errorCode === 'TIMEOUT') return 'timed-out';
  return 'failed';
}

function usageFromAttempt(attempt) {
  if (attempt?.usage && typeof attempt.usage === 'object') return attempt.usage;
  if (!attempt || typeof attempt !== 'object') return null;
  const hasUsage = ['inputTokens', 'outputTokens', 'totalTokens', 'totalCostMicros']
    .some((key) => Number.isFinite(Number(attempt[key])));
  if (!hasUsage) return null;
  return {
    inputTokens: attempt.inputTokens,
    outputTokens: attempt.outputTokens,
    totalTokens: attempt.totalTokens,
    totalCostMicros: attempt.totalCostMicros,
    usageAvailable: true,
  };
}

function publicRun(run) {
  return {
    id: String(run._id || run.id),
    status: run.status,
    agentId: run.agentId,
    useCase: run.useCase,
    surface: run.surface,
    purpose: run.purpose,
    requestId: run.requestId,
    leaseGeneration: run.leaseGeneration,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

async function createDurableAgentExecution({
  idempotencyKey,
  manifest,
  inputs,
  owner = `api-worker:${process.pid}:${randomUUID()}`,
  leaseTtlMs = DEFAULT_DISPATCH_LEASE_MS,
  now = new Date(),
  autoHeartbeat = true,
} = {}) {
  const created = await createOrReuseAgentRun({ idempotencyKey, manifest, inputs });
  if (!['queued', 'running'].includes(created.run.status)) {
    const error = new Error(`Agent run already ended as ${created.run.status}.`);
    error.code = 'AGENT_RUN_ALREADY_TERMINAL';
    error.status = 409;
    error.run = publicRun(created.run);
    throw error;
  }

  let leased;
  try {
    leased = await acquireAgentRunLease({
      runId: created.run.id,
      owner,
      leaseTtlMs,
      now,
    });
  } catch (error) {
    if (error?.code === 'AGENT_RUN_LEASE_HELD') {
      error.code = 'AGENT_RUN_ALREADY_ACTIVE';
      error.run = publicRun(created.run);
    }
    throw error;
  }

  const state = {
    runId: leased.run.id,
    owner,
    leaseToken: leased.leaseToken,
    leaseGeneration: leased.run.leaseGeneration,
    agentId: leased.run.agentId,
    stopped: false,
    clientAttached: true,
    cleanup: null,
    heartbeatTimer: null,
    queue: Promise.resolve(),
    currentAttemptNumbers: [],
    attempts: new Map((leased.run.attempts || []).map((attempt) => [attempt.attemptNumber, {
      attemptId: attempt.attemptId,
      attemptNumber: attempt.attemptNumber,
      agentId: attempt.agentId,
      provider: attempt.provider,
      model: attempt.model,
      role: attempt.role,
      status: attempt.status,
    }])),
  };

  const enqueue = (operation) => {
    state.queue = state.queue.then(operation);
    return state.queue;
  };

  const stopHeartbeat = () => {
    state.stopped = true;
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  };

  const acknowledgeCancellation = async () => {
    if (state.stopped) return null;
    try { state.cleanup?.(); } catch { /* best-effort provider cancellation */ }
    const result = await acknowledgeAgentRunCancellation({
      runId: state.runId,
      owner: state.owner,
      leaseToken: state.leaseToken,
    });
    stopHeartbeat();
    return result.run;
  };

  const heartbeat = async (heartbeatNow = new Date()) => {
    if (state.stopped) return null;
    const run = await heartbeatAgentRunLease({
      runId: state.runId,
      owner: state.owner,
      leaseToken: state.leaseToken,
      leaseTtlMs,
      now: heartbeatNow,
    });
    if (run.cancellation?.requestedAt) return acknowledgeCancellation();
    return run;
  };

  if (autoHeartbeat) {
    state.heartbeatTimer = setInterval(() => {
      enqueue(() => heartbeat()).catch(() => stopHeartbeat());
    }, Math.max(1000, Math.floor(leaseTtlMs / 3)));
    state.heartbeatTimer.unref?.();
  }

  const beginAttempt = (attempt = {}) => enqueue(async () => {
    const attemptNumber = Number.isInteger(attempt.attemptNumber)
      ? attempt.attemptNumber
      : Math.max(0, ...state.attempts.keys()) + 1;
    const attemptId = safeText(attempt.attemptId, 500) || randomUUID();
    const descriptor = {
      attemptId,
      attemptNumber,
      agentId: safeText(attempt.agentId, 500) || state.agentId,
      provider: safeText(attempt.provider, 500) || 'unknown-provider',
      model: safeText(attempt.model, 500) || 'provider-default',
      role: safeText(attempt.role, 500) || 'primary',
    };
    await recordAgentRunAttempt({
      runId: state.runId,
      owner: state.owner,
      leaseToken: state.leaseToken,
      attempt: {
        ...descriptor,
        leaseGeneration: state.leaseGeneration,
        status: 'running',
      },
    });
    state.attempts.set(attemptNumber, { ...descriptor, status: 'running' });
    if (!state.currentAttemptNumbers.includes(attemptNumber)) state.currentAttemptNumbers.push(attemptNumber);
    return descriptor;
  });

  const finishAttempt = (attemptNumber, result = {}) => enqueue(async () => {
    const descriptor = state.attempts.get(attemptNumber);
    if (!descriptor || descriptor.status !== 'running') return null;
    const status = normalizedAttemptStatus(result);
    const run = await completeAgentRunAttempt({
      runId: state.runId,
      owner: state.owner,
      leaseToken: state.leaseToken,
      attemptNumber,
      status,
      usage: usageFromAttempt(result),
      fallbackDecision: result.fallbackDecision,
      error: status === 'succeeded' ? null : {
        code: safeText(result.errorCode || result.code, 500) || 'PROVIDER_EXEC_FAILED',
        message: safeText(result.errorMessage || result.message, 4000) || 'Provider attempt failed.',
      },
    });
    state.attempts.set(attemptNumber, { ...descriptor, status });
    return run;
  });

  const reconcileAttempts = async (attempts, result = {}) => {
    const list = Array.isArray(attempts) ? attempts : [];
    if (list.length === 0) {
      const running = [...state.attempts.values()].find((attempt) => attempt.status === 'running');
      if (running) {
        await finishAttempt(running.attemptNumber, {
          status: result.ok === false ? 'error' : 'ok',
          provider: result.providerUsed,
          model: result.modelUsed,
          usage: result.usage,
          errorCode: result.code,
          errorMessage: result.message,
        });
      }
      return;
    }
    for (let index = 0; index < list.length; index += 1) {
      const attempt = list[index];
      let attemptNumber = state.currentAttemptNumbers[index];
      if (!attemptNumber) {
        const started = await beginAttempt({
          agentId: attempt.agentId || result.agentId,
          provider: attempt.provider,
          model: attempt.model || attempt.usage?.model,
          role: index === 0 ? 'primary' : 'fallback',
        });
        attemptNumber = started.attemptNumber;
      }
      await finishAttempt(attemptNumber, attempt);
    }
  };

  const completeSucceeded = async ({ attempts, evidenceRefs, result = {} } = {}) => {
    await reconcileAttempts(attempts, { ...result, ok: true });
    await state.queue;
    await verifySavedAgentRunOutput({
      runId: state.runId,
      owner: state.owner,
      leaseToken: state.leaseToken,
      packageRefs: evidenceRefs,
    });
    const run = await completeAgentRun({
      runId: state.runId,
      owner: state.owner,
      leaseToken: state.leaseToken,
      status: 'succeeded',
    });
    stopHeartbeat();
    return run;
  };

  const completeFailed = async ({ attempts, error = {}, timedOut = false, incomplete = false } = {}) => {
    await reconcileAttempts(attempts, {
      ok: false,
      code: error.code,
      message: error.message,
      usage: error.usage,
    });
    await state.queue;
    const status = incomplete ? 'incomplete' : (timedOut ? 'timed-out' : 'failed');
    const run = await completeAgentRun({
      runId: state.runId,
      owner: state.owner,
      leaseToken: state.leaseToken,
      status,
      terminalReason: incomplete ? 'evidence-save-gap' : undefined,
      error,
    });
    stopHeartbeat();
    return run;
  };

  return {
    run: publicRun(leased.run),
    reused: created.reused,
    beginAttempt,
    finishAttempt,
    completeSucceeded,
    completeFailed,
    heartbeat: (heartbeatNow) => enqueue(() => heartbeat(heartbeatNow)),
    requestCancellation: async ({ requestedBy = '', reason = '' } = {}) => {
      const result = await cancelAgentRun({ runId: state.runId, requestedBy, reason });
      if (result.cancelRequested) await enqueue(acknowledgeCancellation);
      else stopHeartbeat();
      return result.run;
    },
    registerAbort: (cleanup) => { state.cleanup = typeof cleanup === 'function' ? cleanup : null; },
    detachClient: () => { state.clientAttached = false; },
    isClientAttached: () => state.clientAttached,
    stopHeartbeat,
  };
}

module.exports = {
  DEFAULT_DISPATCH_LEASE_MS,
  createDurableAgentExecution,
  publicRun,
};
