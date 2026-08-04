'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { cancelAgentRun, reconcileAbandonedAgentRun } = require('../services/agent-run-service');
const { requestActiveAgentRunCancellation } = require('../services/durable-agent-dispatcher');

const router = express.Router();

function serializeRun(run) {
  const value = typeof run?.toObject === 'function' ? run.toObject() : run;
  if (!value) return null;
  return {
    id: String(value._id),
    schemaVersion: value.schemaVersion,
    agentId: value.agentId,
    useCase: value.useCase,
    surface: value.surface,
    purpose: value.purpose,
    trigger: value.trigger,
    requestId: value.requestId,
    promptId: value.promptId,
    promptVersion: value.promptVersion,
    refs: value.refs,
    status: value.status,
    leaseGeneration: value.leaseGeneration,
    executor: value.lease ? {
      owner: value.lease.owner,
      generation: value.lease.generation,
      acquiredAt: value.lease.acquiredAt,
      heartbeatAt: value.lease.heartbeatAt,
      expiresAt: value.lease.expiresAt,
    } : null,
    attempts: value.attempts || [],
    outputValidation: value.outputValidation,
    cancellation: value.cancellation,
    staleness: value.staleness,
    terminalReason: value.terminalReason,
    completionError: value.completionError,
    createdAt: value.createdAt,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
  };
}

router.get('/:id', async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    return res.status(400).json({ ok: false, code: 'AGENT_RUN_INVALID_ID', error: 'Agent run id is invalid.' });
  }
  const run = await reconcileAbandonedAgentRun({ runId: req.params.id });
  if (!run) return res.status(404).json({ ok: false, code: 'AGENT_RUN_NOT_FOUND', error: 'Agent run not found.' });
  return res.json({ ok: true, run: serializeRun(run) });
});

router.post('/:id/cancel', async (req, res) => {
  try {
    const details = {
      requestedBy: String(req.body?.requestedBy || 'local-operator').slice(0, 500),
      reason: String(req.body?.reason || 'Cancellation requested through the Agent Runs API.').slice(0, 4000),
    };
    const activelyCancelled = await requestActiveAgentRunCancellation(req.params.id, details);
    const result = activelyCancelled
      ? { run: activelyCancelled, cancelRequested: false, idempotent: false }
      : await cancelAgentRun({ runId: req.params.id, ...details });
    return res.json({
      ok: true,
      run: serializeRun(result.run),
      cancelRequested: result.cancelRequested,
      idempotent: result.idempotent,
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      code: error.code || 'AGENT_RUN_CANCEL_FAILED',
      error: error.message || 'Failed to cancel agent run.',
    });
  }
});

module.exports = router;
module.exports.serializeRun = serializeRun;
