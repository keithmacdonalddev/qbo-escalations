'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const mongo = require('./_mongo-helper');
const AgentRun = require('../src/models/AgentRun');
const {
  acknowledgeAgentRunCancellation,
  acquireAgentRunLease,
  cancelAgentRun,
  completeAgentRun,
  completeAgentRunAttempt,
  createOrReuseAgentRun,
  hashAgentRunInputs,
  heartbeatAgentRunLease,
  markAgentRunStale,
  reconcileAbandonedAgentRun,
  recordAgentRunAttempt,
  setAgentRunOutputValidation,
} = require('../src/services/agent-run-service');

const BASE_TIME = new Date('2026-07-24T12:00:00.000Z');
const at = (offsetMs) => new Date(BASE_TIME.getTime() + offsetMs);

function baseInputs(overrides = {}) {
  return {
    prompt: 'Investigate the unresolved escalation.',
    provider: { id: 'openai', model: 'gpt-5.4' },
    context: { caseId: 'CASE-42', evidenceIds: ['ev-1', 'ev-2'] },
    request: { reasoningEffort: 'high', tools: ['knowledge-search'] },
    ...overrides,
  };
}

function baseManifest(overrides = {}) {
  return {
    agentId: 'escalation-investigation-agent',
    useCase: 'escalation-investigation',
    surface: 'case-workspace',
    purpose: 'product-escalation-investigation',
    trigger: 'operator-request',
    requestId: 'request-case-42',
    promptId: 'escalation-investigation',
    promptVersion: '2.0.0',
    actor: 'user:operator-42',
    refs: {
      conversationId: 'conversation-42',
      roomId: 'room-7',
      escalationId: 'escalation-42',
      caseNumber: 'CASE-42',
      contextRef: 'case-context:CASE-42:v3',
    },
    ...overrides,
  };
}

async function createRun(idempotencyKey, inputs = baseInputs(), manifest = baseManifest({
  requestId: `request:${idempotencyKey}`,
})) {
  const result = await createOrReuseAgentRun({ idempotencyKey, inputs, manifest });
  return result.run;
}

test.before(async () => {
  await mongo.connect();
  await AgentRun.syncIndexes();
});

test.after(async () => {
  await mongo.disconnect();
});

test.beforeEach(async () => {
  await AgentRun.deleteMany({});
});

test('createOrReuseAgentRun reuses exact inputs and rejects idempotency-key drift', async () => {
  const first = await createOrReuseAgentRun({
    idempotencyKey: 'case-42:investigate:v1',
    inputs: baseInputs(),
    manifest: baseManifest(),
  });
  const reorderedInputs = {
    request: { tools: ['knowledge-search'], reasoningEffort: 'high' },
    context: { evidenceIds: ['ev-1', 'ev-2'], caseId: 'CASE-42' },
    provider: { model: 'gpt-5.4', id: 'openai' },
    prompt: 'Investigate the unresolved escalation.',
  };
  const replay = await createOrReuseAgentRun({
    idempotencyKey: 'case-42:investigate:v1',
    inputs: reorderedInputs,
    manifest: baseManifest(),
  });

  assert.equal(first.reused, false);
  assert.equal(replay.reused, true);
  assert.equal(replay.run.id, first.run.id);
  assert.equal(await AgentRun.countDocuments({}), 1);
  assert.equal(first.run.agentId, 'escalation-investigation-agent');
  assert.equal(first.run.useCase, 'escalation-investigation');
  assert.equal(first.run.surface, 'case-workspace');
  assert.equal(first.run.trigger, 'operator-request');
  assert.equal(first.run.requestId, 'request-case-42');
  assert.equal(first.run.promptId, 'escalation-investigation');
  assert.equal(first.run.promptVersion, '2.0.0');
  assert.equal(first.run.actor, 'user:operator-42');
  assert.equal(first.run.refs.caseNumber, 'CASE-42');
  assert.equal(
    first.run.inputHashes.prompt,
    createHash('sha256').update(baseInputs().prompt).digest('hex')
  );
  assert.equal(first.run.promptHash, first.run.inputHashes.prompt);
  const persistedJson = JSON.stringify(first.run.toObject());
  assert.equal(persistedJson.includes(baseInputs().prompt), false, 'raw prompts must not be stored');
  assert.equal(persistedJson.includes('credential'), false);
  assert.deepEqual(
    hashAgentRunInputs(baseInputs()),
    hashAgentRunInputs(reorderedInputs),
    'object key insertion order must not change exact canonical hashes'
  );

  await assert.rejects(
    createOrReuseAgentRun({
      idempotencyKey: 'case-42:investigate:v1',
      inputs: baseInputs({ prompt: 'Investigate a different escalation.' }),
      manifest: baseManifest(),
    }),
    (error) => error.code === 'AGENT_RUN_IDEMPOTENCY_CONFLICT' && error.status === 409
  );

  await assert.rejects(
    createOrReuseAgentRun({
      idempotencyKey: 'case-42:investigate:v1',
      inputs: baseInputs(),
      manifest: baseManifest({ agentId: 'different-agent' }),
    }),
    (error) => error.code === 'AGENT_RUN_IDEMPOTENCY_CONFLICT'
  );

  const indexes = await AgentRun.collection.indexes();
  assert.ok(indexes.some((index) => index.key.agentId === 1 && index.key.status === 1));
  assert.ok(indexes.some((index) => index.key['refs.conversationId'] === 1));
});

test('leases are atomic across workers, heartbeat extends ownership, and expiry permits takeover', async () => {
  const run = await createRun('lease-contention');
  const first = await acquireAgentRunLease({
    runId: run.id,
    owner: 'worker-a',
    leaseToken: 'worker-a-secret-token',
    leaseTtlMs: 100,
    now: at(0),
  });

  assert.equal(first.run.status, 'running');
  assert.equal(first.run.lease.owner, 'worker-a');
  assert.notEqual(first.run.lease.tokenHash, first.leaseToken, 'only a token hash may be stored');

  await assert.rejects(
    acquireAgentRunLease({
      runId: run.id,
      owner: 'worker-b',
      leaseToken: 'worker-b-secret-token',
      leaseTtlMs: 100,
      now: at(50),
    }),
    (error) => error.code === 'AGENT_RUN_LEASE_HELD'
  );

  const heartbeat = await heartbeatAgentRunLease({
    runId: run.id,
    owner: 'worker-a',
    leaseToken: first.leaseToken,
    leaseTtlMs: 200,
    now: at(50),
  });
  assert.equal(heartbeat.lease.heartbeatAt.toISOString(), at(50).toISOString());
  assert.equal(heartbeat.lease.expiresAt.toISOString(), at(250).toISOString());

  await assert.rejects(
    acquireAgentRunLease({
      runId: run.id,
      owner: 'worker-b',
      leaseToken: 'worker-b-secret-token',
      leaseTtlMs: 100,
      now: at(150),
    }),
    (error) => error.code === 'AGENT_RUN_LEASE_HELD'
  );

  const takeover = await acquireAgentRunLease({
    runId: run.id,
    owner: 'worker-b',
    leaseToken: 'worker-b-secret-token',
    leaseTtlMs: 100,
    now: at(251),
  });
  assert.equal(takeover.run.lease.owner, 'worker-b');
  assert.equal(takeover.run.startedAt.toISOString(), at(0).toISOString());

  await assert.rejects(
    heartbeatAgentRunLease({
      runId: run.id,
      owner: 'worker-a',
      leaseToken: first.leaseToken,
      leaseTtlMs: 100,
      now: at(252),
    }),
    (error) => error.code === 'AGENT_RUN_LEASE_LOST'
  );
});

test('attempt records preserve provider provenance and caller-supplied evidence cannot authorize success', async () => {
  const run = await createRun('attempt-provenance');
  const lease = await acquireAgentRunLease({
    runId: run.id,
    owner: 'agent-executor-1',
    leaseToken: 'executor-secret-token',
    leaseTtlMs: 1000,
    now: at(0),
  });
  const providerPackageSha = createHash('sha256').update('provider-package').digest('hex');
  const outputSha = createHash('sha256').update('validated-output').digest('hex');

  const startedAttempt = await recordAgentRunAttempt({
    runId: run.id,
    owner: 'agent-executor-1',
    leaseToken: lease.leaseToken,
    now: at(10),
    attempt: {
      attemptId: 'attempt-primary-fallback-1',
      attemptNumber: 1,
      status: 'running',
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      role: 'fallback-specialist',
    },
  });
  assert.equal(startedAttempt.attempts[0].status, 'running');

  await assert.rejects(
    completeAgentRunAttempt({
      runId: run.id,
      owner: 'different-executor',
      leaseToken: 'wrong-token',
      attemptId: 'attempt-primary-fallback-1',
      status: 'succeeded',
      now: at(11),
    }),
    (error) => error.code === 'AGENT_RUN_LEASE_LOST'
  );

  const withAttempt = await completeAgentRunAttempt({
    runId: run.id,
    owner: 'agent-executor-1',
    leaseToken: lease.leaseToken,
    attemptId: 'attempt-primary-fallback-1',
    status: 'succeeded',
    now: at(12),
    packageRefs: [{
      kind: 'provider-call-package',
      id: 'provider-package-123',
      sha256: providerPackageSha,
    }],
    usage: {
      inputTokens: 1200,
      outputTokens: 320,
      cacheReadTokens: 800,
      providerReported: { serviceTier: 'priority' },
    },
    fallbackDecision: {
      considered: true,
      used: true,
      reason: 'primary provider was unavailable',
      fromProvider: 'openai',
      fromModel: 'gpt-5.4',
      toProvider: 'anthropic',
      toModel: 'claude-opus-4-6',
      details: { healthCode: 'PRIMARY_UNAVAILABLE' },
    },
  });

  await assert.rejects(
    completeAgentRunAttempt({
      runId: run.id,
      owner: 'agent-executor-1',
      leaseToken: lease.leaseToken,
      attemptId: 'attempt-primary-fallback-1',
      status: 'succeeded',
      now: at(13),
    }),
    (error) => error.code === 'AGENT_RUN_ATTEMPT_ALREADY_TERMINAL'
  );

  assert.equal(withAttempt.attempts.length, 1);
  assert.equal(withAttempt.attempts[0].status, 'succeeded');
  assert.equal(withAttempt.attempts[0].provider, 'anthropic');
  assert.equal(withAttempt.attempts[0].model, 'claude-opus-4-6');
  assert.equal(withAttempt.attempts[0].role, 'fallback-specialist');
  assert.equal(withAttempt.attempts[0].packageRefs[0].id, 'provider-package-123');
  assert.equal(withAttempt.attempts[0].usage.serviceTier, 'priority');
  assert.equal(withAttempt.attempts[0].fallbackDecision.used, true);
  assert.equal(withAttempt.attempts[0].fallbackDecision.fromProvider, 'openai');

  await setAgentRunOutputValidation({
    runId: run.id,
    owner: 'agent-executor-1',
    leaseToken: lease.leaseToken,
    now: at(20),
    validation: {
      status: 'failed',
      validator: 'resolution-contract-v2',
      schemaRef: 'agent-output/resolution-v2',
      outputSha256: outputSha,
      errors: ['recommendation is missing'],
    },
  });
  await assert.rejects(
    completeAgentRun({
      runId: run.id,
      owner: 'agent-executor-1',
      leaseToken: lease.leaseToken,
      status: 'succeeded',
      now: at(30),
    }),
    (error) => error.code === 'AGENT_RUN_VALIDATION_REQUIRED'
  );

  await setAgentRunOutputValidation({
    runId: run.id,
    owner: 'agent-executor-1',
    leaseToken: lease.leaseToken,
    now: at(40),
    validation: {
      status: 'passed',
      validator: 'resolution-contract-v2',
      schemaRef: 'agent-output/resolution-v2',
      outputSha256: outputSha,
      packageRefs: [{ kind: 'validation-package', id: 'validation-123' }],
    },
  });
  await assert.rejects(
    completeAgentRun({
      runId: run.id,
      owner: 'agent-executor-1',
      leaseToken: lease.leaseToken,
      status: 'succeeded',
      now: at(50),
    }),
    (error) => error.code === 'AGENT_RUN_EVIDENCE_UNVERIFIED'
  );
});

test('success requires completed attempts, a result hash, an evidence ref, and server verification', async () => {
  const run = await createRun('explicit-successful-attempt');
  const lease = await acquireAgentRunLease({
    runId: run.id,
    owner: 'success-worker',
    leaseToken: 'success-worker-token',
    leaseTtlMs: 1000,
    now: at(0),
  });
  await setAgentRunOutputValidation({
    runId: run.id,
    owner: 'success-worker',
    leaseToken: lease.leaseToken,
    now: at(10),
    validation: {
      status: 'passed',
      validator: 'resolution-contract-v2',
    },
  });

  await assert.rejects(
    completeAgentRun({
      runId: run.id,
      owner: 'success-worker',
      leaseToken: lease.leaseToken,
      status: 'succeeded',
      now: at(20),
    }),
    (error) => error.code === 'AGENT_RUN_SUCCEEDED_ATTEMPT_REQUIRED'
  );

  const withRunningAttempt = await recordAgentRunAttempt({
    runId: run.id,
    owner: 'success-worker',
    leaseToken: lease.leaseToken,
    now: at(30),
    attempt: {
      attemptNumber: 1,
      status: 'running',
      provider: 'openai',
      model: 'gpt-5.4',
      role: 'primary',
    },
  });
  await assert.rejects(
    completeAgentRun({
      runId: run.id,
      owner: 'success-worker',
      leaseToken: lease.leaseToken,
      status: 'succeeded',
      now: at(40),
    }),
    (error) => error.code === 'AGENT_RUN_ATTEMPT_STILL_RUNNING'
  );
  const afterRejectedCompletion = await AgentRun.findById(run.id).lean();
  assert.equal(afterRejectedCompletion.status, 'running');
  assert.equal(afterRejectedCompletion.attempts[0].status, 'running');
  assert.equal(afterRejectedCompletion.attempts[0].completedAt, null);
  assert.equal(withRunningAttempt.attempts[0].status, 'running');

  await completeAgentRunAttempt({
    runId: run.id,
    owner: 'success-worker',
    leaseToken: lease.leaseToken,
    attemptNumber: 1,
    status: 'succeeded',
    now: at(50),
  });
  await assert.rejects(
    completeAgentRun({
      runId: run.id,
      owner: 'success-worker',
      leaseToken: lease.leaseToken,
      status: 'succeeded',
      now: at(51),
    }),
    (error) => error.code === 'AGENT_RUN_RESULT_HASH_REQUIRED'
  );
  await setAgentRunOutputValidation({
    runId: run.id,
    owner: 'success-worker',
    leaseToken: lease.leaseToken,
    now: at(52),
    validation: {
      status: 'passed',
      validator: 'resolution-contract-v2',
      outputSha256: createHash('sha256').update('explicit-success-output').digest('hex'),
    },
  });
  await assert.rejects(
    completeAgentRun({
      runId: run.id,
      owner: 'success-worker',
      leaseToken: lease.leaseToken,
      status: 'succeeded',
      now: at(53),
    }),
    (error) => error.code === 'AGENT_RUN_EVIDENCE_REF_REQUIRED'
  );
  await setAgentRunOutputValidation({
    runId: run.id,
    owner: 'success-worker',
    leaseToken: lease.leaseToken,
    now: at(54),
    validation: {
      status: 'passed',
      validator: 'resolution-contract-v2',
      outputSha256: createHash('sha256').update('explicit-success-output').digest('hex'),
      packageRefs: [{ kind: 'validation-package', id: 'explicit-success-evidence' }],
    },
  });
  await assert.rejects(
    completeAgentRun({
      runId: run.id,
      owner: 'success-worker',
      leaseToken: lease.leaseToken,
      status: 'succeeded',
      now: at(60),
    }),
    (error) => error.code === 'AGENT_RUN_EVIDENCE_UNVERIFIED'
  );
  const stillRunning = await AgentRun.findById(run.id).lean();
  assert.equal(stillRunning.status, 'running');
  assert.equal(stillRunning.attempts[0].status, 'succeeded');
});

test('terminal outcomes distinguish provider timeout, validation failure, and evidence-save gaps', async () => {
  const timeoutRun = await createRun('provider-timeout');
  const timeoutLease = await acquireAgentRunLease({
    runId: timeoutRun.id,
    owner: 'timeout-worker',
    leaseToken: 'timeout-worker-token',
    leaseTtlMs: 1000,
    now: at(0),
  });
  await recordAgentRunAttempt({
    runId: timeoutRun.id,
    owner: 'timeout-worker',
    leaseToken: timeoutLease.leaseToken,
    now: at(10),
    attempt: {
      attemptNumber: 1,
      status: 'running',
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      role: 'primary',
    },
  });
  const timedOut = await completeAgentRun({
    runId: timeoutRun.id,
    owner: 'timeout-worker',
    leaseToken: timeoutLease.leaseToken,
    status: 'timed-out',
    now: at(20),
    error: { code: 'UPSTREAM_DEADLINE', message: 'Anthropic exceeded 20 seconds.' },
  });
  assert.equal(timedOut.status, 'timed-out');
  assert.equal(timedOut.terminalReason, 'provider-timeout');
  assert.equal(timedOut.completionError.code, 'UPSTREAM_DEADLINE');
  assert.equal(timedOut.attempts[0].status, 'timed-out');
  assert.equal(timedOut.attempts[0].error.code, 'UPSTREAM_DEADLINE');

  const invalidOutputRun = await createRun('invalid-output');
  const invalidOutputLease = await acquireAgentRunLease({
    runId: invalidOutputRun.id,
    owner: 'validation-worker',
    leaseToken: 'validation-worker-token',
    leaseTtlMs: 1000,
    now: at(0),
  });
  await recordAgentRunAttempt({
    runId: invalidOutputRun.id,
    owner: 'validation-worker',
    leaseToken: invalidOutputLease.leaseToken,
    now: at(10),
    attempt: {
      attemptNumber: 1,
      status: 'running',
      provider: 'openai',
      model: 'gpt-5.4',
      role: 'primary',
    },
  });
  await completeAgentRunAttempt({
    runId: invalidOutputRun.id,
    owner: 'validation-worker',
    leaseToken: invalidOutputLease.leaseToken,
    attemptNumber: 1,
    status: 'succeeded',
    now: at(20),
  });
  await setAgentRunOutputValidation({
    runId: invalidOutputRun.id,
    owner: 'validation-worker',
    leaseToken: invalidOutputLease.leaseToken,
    now: at(30),
    validation: {
      status: 'failed',
      validator: 'resolution-contract-v2',
      errors: ['evidence citations are missing'],
    },
  });
  const invalidOutput = await completeAgentRun({
    runId: invalidOutputRun.id,
    owner: 'validation-worker',
    leaseToken: invalidOutputLease.leaseToken,
    status: 'incomplete',
    terminalReason: 'output-validation-failed',
    now: at(40),
  });
  assert.equal(invalidOutput.status, 'incomplete');
  assert.equal(invalidOutput.terminalReason, 'output-validation-failed');
  assert.equal(invalidOutput.completionError.code, 'OUTPUT_VALIDATION_FAILED');
  assert.equal(invalidOutput.outputValidation.status, 'failed');

  const evidenceGapRun = await createRun('evidence-save-gap');
  const evidenceGapLease = await acquireAgentRunLease({
    runId: evidenceGapRun.id,
    owner: 'evidence-worker',
    leaseToken: 'evidence-worker-token',
    leaseTtlMs: 1000,
    now: at(0),
  });
  await recordAgentRunAttempt({
    runId: evidenceGapRun.id,
    owner: 'evidence-worker',
    leaseToken: evidenceGapLease.leaseToken,
    now: at(10),
    attempt: {
      attemptNumber: 1,
      status: 'running',
      provider: 'openai',
      model: 'gpt-5.4',
      role: 'primary',
    },
  });
  const evidenceGap = await completeAgentRun({
    runId: evidenceGapRun.id,
    owner: 'evidence-worker',
    leaseToken: evidenceGapLease.leaseToken,
    status: 'incomplete',
    terminalReason: 'evidence-save-gap',
    now: at(20),
    error: {
      code: 'PROVIDER_PACKAGE_SAVE_FAILED',
      message: 'The provider result exists, but its evidence package was not saved.',
    },
  });
  assert.equal(evidenceGap.status, 'incomplete');
  assert.equal(evidenceGap.terminalReason, 'evidence-save-gap');
  assert.equal(evidenceGap.completionError.code, 'PROVIDER_PACKAGE_SAVE_FAILED');
  assert.equal(evidenceGap.attempts[0].status, 'incomplete');
  assert.equal(evidenceGap.attempts[0].error.code, 'PROVIDER_PACKAGE_SAVE_FAILED');

  const failedRun = await createRun('execution-failed');
  const failedLease = await acquireAgentRunLease({
    runId: failedRun.id,
    owner: 'failure-worker',
    leaseToken: 'failure-worker-token',
    leaseTtlMs: 1000,
    now: at(0),
  });
  await recordAgentRunAttempt({
    runId: failedRun.id,
    owner: 'failure-worker',
    leaseToken: failedLease.leaseToken,
    now: at(10),
    attempt: {
      attemptNumber: 1,
      status: 'running',
      provider: 'openai',
      model: 'gpt-5.4',
      role: 'primary',
    },
  });
  const failed = await completeAgentRun({
    runId: failedRun.id,
    owner: 'failure-worker',
    leaseToken: failedLease.leaseToken,
    status: 'failed',
    now: at(20),
    error: { code: 'PROVIDER_AUTH_FAILED', message: 'The provider rejected authentication.' },
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.terminalReason, 'execution-failed');
  assert.equal(failed.attempts[0].status, 'failed');
  assert.equal(failed.attempts[0].error.code, 'PROVIDER_AUTH_FAILED');

  assert.equal(
    await AgentRun.countDocuments({ status: { $in: AgentRun.RUN_STATUSES.filter((entry) => !['queued', 'running'].includes(entry)) }, 'attempts.status': 'running' }),
    0,
    'no terminal run may retain a running attempt'
  );
});

test('queued and running runs can be cancelled idempotently', async () => {
  const queuedRun = await createRun('cancel-queued');
  const cancelled = await cancelAgentRun({
    runId: queuedRun.id,
    requestedBy: 'operator-42',
    reason: 'The escalation was resolved manually.',
    now: at(0),
  });
  const replay = await cancelAgentRun({
    runId: queuedRun.id,
    requestedBy: 'operator-42',
    reason: 'Repeated click',
    now: at(10),
  });

  assert.equal(cancelled.run.status, 'cancelled');
  assert.equal(cancelled.databaseOnly, true);
  assert.equal(cancelled.run.terminalReason, 'database-only-cancellation');
  assert.equal(cancelled.run.cancellation.mode, 'database-only');
  assert.equal(cancelled.run.cancellation.acknowledgedAt, null);
  assert.equal(cancelled.run.cancellation.databaseOnlyAt.toISOString(), at(0).toISOString());
  assert.equal(cancelled.run.cancellation.requestedBy, 'operator-42');
  assert.equal(cancelled.run.cancellation.reason, 'The escalation was resolved manually.');
  assert.equal(replay.idempotent, true);
  assert.equal(replay.run.cancellation.reason, 'The escalation was resolved manually.');
  await assert.rejects(
    acquireAgentRunLease({
      runId: queuedRun.id,
      owner: 'late-worker',
      leaseToken: 'late-worker-token',
      now: at(20),
    }),
    (error) => error.code === 'AGENT_RUN_TERMINAL'
  );

  const runningRun = await createRun('cancel-running');
  const lease = await acquireAgentRunLease({
    runId: runningRun.id,
    owner: 'worker-a',
    leaseToken: 'worker-a-token',
    leaseTtlMs: 1000,
    now: at(0),
  });
  await recordAgentRunAttempt({
    runId: runningRun.id,
    owner: 'worker-a',
    leaseToken: lease.leaseToken,
    now: at(10),
    attempt: {
      attemptNumber: 1,
      status: 'running',
      provider: 'openai',
      model: 'gpt-5.4',
      role: 'primary',
    },
  });
  const cancellationRequest = await cancelAgentRun({
    runId: runningRun.id,
    requestedBy: 'operator-42',
    reason: 'Stop the provider request.',
    now: at(20),
  });
  assert.equal(cancellationRequest.cancelRequested, true);
  assert.equal(cancellationRequest.run.status, 'running');
  assert.equal(cancellationRequest.run.cancellation.mode, 'executor-acknowledgement-required');
  assert.equal(cancellationRequest.run.cancellation.acknowledgedAt, null);
  assert.equal(cancellationRequest.run.attempts[0].status, 'running');
  assert.equal(cancellationRequest.run.lease.owner, 'worker-a');

  await assert.rejects(
    completeAgentRun({
      runId: runningRun.id,
      owner: 'worker-a',
      leaseToken: lease.leaseToken,
      status: 'failed',
      now: at(21),
    }),
    (error) => error.code === 'AGENT_RUN_CANCEL_REQUESTED'
  );
  await assert.rejects(
    acknowledgeAgentRunCancellation({
      runId: runningRun.id,
      owner: 'worker-b',
      leaseToken: 'wrong-token',
      now: at(22),
    }),
    (error) => error.code === 'AGENT_RUN_LEASE_LOST'
  );

  const runningCancelled = await acknowledgeAgentRunCancellation({
    runId: runningRun.id,
    owner: 'worker-a',
    leaseToken: lease.leaseToken,
    now: at(23),
  });
  assert.equal(runningCancelled.run.status, 'cancelled');
  assert.equal(runningCancelled.run.terminalReason, 'executor-acknowledged-cancellation');
  assert.equal(runningCancelled.run.cancellation.mode, 'executor-acknowledged');
  assert.equal(runningCancelled.run.cancellation.acknowledgedAt.toISOString(), at(23).toISOString());
  assert.equal(runningCancelled.run.attempts[0].status, 'cancelled');
  assert.equal(runningCancelled.run.attempts[0].completedAt.toISOString(), at(23).toISOString());
  assert.equal(runningCancelled.run.attempts[0].error.code, 'AGENT_RUN_CANCELLED');
  assert.equal(runningCancelled.run.lease, null);
});

test('expired leased runs become stale atomically while live leases remain protected', async () => {
  const run = await createRun('stale-run');
  const lease = await acquireAgentRunLease({
    runId: run.id,
    owner: 'worker-a',
    leaseToken: 'worker-a-token',
    leaseTtlMs: 100,
    now: at(0),
  });
  await recordAgentRunAttempt({
    runId: run.id,
    owner: 'worker-a',
    leaseToken: lease.leaseToken,
    now: at(10),
    attempt: {
      attemptNumber: 1,
      status: 'running',
      provider: 'openai',
      model: 'gpt-5.4',
      role: 'primary',
    },
  });

  await assert.rejects(
    markAgentRunStale({ runId: run.id, now: at(99) }),
    (error) => error.code === 'AGENT_RUN_NOT_STALE'
  );
  const stale = await markAgentRunStale({
    runId: run.id,
    reason: 'executor-heartbeat-expired',
    now: at(100),
  });
  const replay = await markAgentRunStale({ runId: run.id, now: at(200) });

  assert.equal(stale.run.status, 'stale');
  assert.equal(stale.run.staleness.reason, 'executor-heartbeat-expired');
  assert.equal(stale.run.attempts[0].status, 'stale');
  assert.equal(stale.run.attempts[0].completedAt.toISOString(), at(100).toISOString());
  assert.equal(stale.run.lease, null);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.run.staleness.reason, 'executor-heartbeat-expired');
});

test('queued runs that never acquire a lease are reconciled as stale', async () => {
  const run = await createRun('queued-without-worker');
  const checkedAt = new Date(new Date(run.createdAt).getTime() + 60_001);
  const reconciled = await reconcileAbandonedAgentRun({
    runId: run.id,
    now: checkedAt,
    queuedGraceMs: 60_000,
  });

  assert.equal(reconciled.status, 'stale');
  assert.equal(reconciled.staleness.reason, 'executor-never-acquired-lease');
  assert.equal(reconciled.terminalReason, 'lease-expired');
});
