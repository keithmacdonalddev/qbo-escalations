'use strict';

const express = require('express');
const {
  createAgentLifecycleRun,
  createAgentIdentity,
  finalizeAgentLifecycleRun,
  getAgentIdentity,
  importAgentIdentities,
  listAgentLifecycleStates,
  listAgentRuntimeDefaults,
  listAgentIdentities,
  recordAgentHarnessRun,
  recordAgentLifecycleActivity,
  recordAgentLifecycleStep,
  recordAgentReview,
  reviewAgentMemoryNote,
  updateAgentIdentity,
  updateAgentEnabled,
  updateAgentRuntime,
} = require('../services/agent-identity-service');
const {
  checkProviderStrategyHealth,
  getAgentHealthSnapshot,
  refreshAgentHealth,
} = require('../services/agent-health-service');
const {
  appendProviderHealthLog,
  listProviderHealthLogs,
} = require('../lib/provider-health-log-store');

const router = express.Router();

function sendServiceError(res, err) {
  const status = Number(err?.status) || 500;
  if (status >= 500) {
    throw err;
  }
  return res.status(status).json({
    ok: false,
    code: err?.code || 'REQUEST_FAILED',
    error: err?.message || 'Request failed',
  });
}

function cloneLifecycleRun(run) {
  return run == null ? run : JSON.parse(JSON.stringify(run));
}

function streamLifecycleEvent(res, event) {
  try {
    res.write(`${JSON.stringify(event)}\n`);
  } catch {
    // The lifecycle operation should continue even if the browser closes the modal.
  }
}

async function executeAgentLifecycleToggle({ agentId, enabled, summary = '', clientSteps = [], onStep = null }) {
  const lifecycleRun = createAgentLifecycleRun({
    agentId,
    enabled,
    actor: 'user',
    summary,
  });
  const recordStep = (step) => {
    const entry = recordAgentLifecycleStep(lifecycleRun, step);
    if (entry && typeof onStep === 'function') {
      onStep(entry, cloneLifecycleRun(lifecycleRun));
    }
    return entry;
  };

  try {
    for (const step of Array.isArray(clientSteps) ? clientSteps.slice(0, 12) : []) {
      recordStep({
        name: step.name || 'Client lifecycle step',
        functionName: step.functionName || 'client',
        check: step.check || 'Client-side lifecycle action completed before the server request',
        status: step.status || 'info',
        summary: step.summary || 'Client-side lifecycle step completed.',
        detail: step.detail || '',
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        durationMs: step.durationMs,
        metadata: {
          ...(step.metadata && typeof step.metadata === 'object' ? step.metadata : {}),
          source: 'client',
        },
      });
    }

    recordStep({
      name: 'Receive lifecycle toggle request',
      functionName: 'PATCH /api/agent-identities/:id/enabled',
      check: 'Route accepted the profile toggle request',
      status: 'success',
      summary: `Received ${lifecycleRun.direction} request for ${agentId}.`,
      metadata: { agentId, requestedEnabled: enabled !== false },
    });

    recordStep({
      name: 'Normalize request body',
      functionName: 'agent-identities.enabled route',
      check: 'Request body enabled flag and summary are normalized',
      status: 'success',
      summary: `Target enabled state normalized to ${enabled !== false}.`,
      metadata: { hasSummary: Boolean(summary), enabled: enabled !== false },
    });

    const agent = await updateAgentEnabled(agentId, enabled !== false, {
      actor: 'user',
      summary,
      lifecycleRun,
    });
    if (!agent) {
      recordStep({
        name: 'Resolve lifecycle target identity',
        functionName: 'updateAgentEnabled',
        check: 'Agent identity exists before health refresh',
        status: 'error',
        summary: 'Agent identity was not found, so lifecycle update cannot continue.',
        metadata: { agentId },
      });
      finalizeAgentLifecycleRun(lifecycleRun, 'error');
      return {
        status: 404,
        body: {
          ok: false,
          code: 'NOT_FOUND',
          error: 'Agent identity not found',
          lifecycleRun,
        },
      };
    }

    const healthStartedAt = new Date();
    await refreshAgentHealth({
      agentIds: [agentId],
      forceRefresh: true,
      trace: recordStep,
    });
    recordStep({
      name: 'Refresh lifecycle health snapshot',
      functionName: 'refreshAgentHealth',
      check: 'Forced health refresh completed after lifecycle state change',
      status: 'success',
      summary: `Refreshed health snapshot for ${agentId}.`,
      startedAt: healthStartedAt,
      completedAt: new Date(),
      metadata: { agentId, forceRefresh: true },
    });

    recordStep({
      name: 'Prepare expandable activity row',
      functionName: 'recordAgentLifecycleActivity',
      check: 'Lifecycle run will be stored as one MongoDB activity entry',
      status: 'info',
      summary: 'Prepared one expandable Activity tab row with the full lifecycle stream.',
      metadata: { lifecycleRunId: lifecycleRun.runId, stepCount: lifecycleRun.steps.length },
    });
    finalizeAgentLifecycleRun(lifecycleRun);

    const agentWithActivity = await recordAgentLifecycleActivity(agentId, lifecycleRun, {
      actor: 'user',
      summary,
    });

    return {
      status: 200,
      body: {
        ok: true,
        agent: agentWithActivity || agent,
        enabled: (agentWithActivity || agent).enabled !== false,
        lifecycleRun,
      },
    };
  } catch (err) {
    recordStep({
      name: 'Lifecycle route failure',
      functionName: 'PATCH /api/agent-identities/:id/enabled',
      check: 'Unhandled lifecycle operation errors are surfaced to the caller',
      status: 'error',
      summary: err.message || 'Failed to update agent status.',
      detail: err.stack || err.message || '',
      metadata: { agentId },
    });
    finalizeAgentLifecycleRun(lifecycleRun, 'error');
    try {
      await recordAgentLifecycleActivity(agentId, lifecycleRun, {
        actor: 'user',
        summary,
      });
    } catch {
      // If MongoDB is the failed dependency, there is nowhere reliable to store the run.
    }
    return {
      status: Number(err?.status) || 500,
      body: {
        ok: false,
        code: err?.code || 'AGENT_LIFECYCLE_FAILED',
        error: err.message || 'Failed to update agent status.',
        lifecycleRun,
      },
    };
  }
}

router.get('/', async (_req, res) => {
  const agents = await listAgentIdentities();
  res.json({ ok: true, agents });
});

router.get('/runtime-defaults', async (req, res) => {
  const ids = typeof req.query.ids === 'string'
    ? req.query.ids.split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  const runtimes = await listAgentRuntimeDefaults(ids);
  res.json({ ok: true, runtimes });
});

router.get('/lifecycle', async (req, res) => {
  const ids = typeof req.query.ids === 'string'
    ? req.query.ids.split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  const lifecycle = await listAgentLifecycleStates(ids);
  res.json({ ok: true, lifecycle });
});

router.get('/health', async (req, res) => {
  const ids = typeof req.query.ids === 'string'
    ? req.query.ids.split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  const refreshRaw = String(req.query?.refresh || req.query?.forceRefresh || '').toLowerCase();
  const forceRefresh = refreshRaw === '1' || refreshRaw === 'true' || refreshRaw === 'yes';
  const snapshot = forceRefresh
    ? await refreshAgentHealth({ agentIds: ids, forceRefresh: true })
    : await getAgentHealthSnapshot({ agentIds: ids });
  res.json({ ok: true, ...snapshot });
});

// Streaming per-agent health refresh. Emits one NDJSON event as each agent's
// reachability check settles, then a final 'complete' event with the full
// snapshot. Matches the NDJSON pattern used by /:id/enabled/stream.
router.get('/health/stream', async (req, res) => {
  const ids = typeof req.query.ids === 'string'
    ? req.query.ids.split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.socket?.setNoDelay(true);

  let clientClosed = false;
  function writeEvent(event) {
    if (clientClosed) return;
    try {
      res.write(`${JSON.stringify(event)}\n`);
      res.flush?.();
    } catch {
      // Client closed mid-write; stop trying.
      clientClosed = true;
    }
  }
  req.on('close', () => {
    clientClosed = true;
  });

  try {
    const snapshot = await refreshAgentHealth({
      agentIds: ids,
      forceRefresh: true,
      onAgent: (agentId, health) => {
        writeEvent({ type: 'agent', agentId, health });
      },
    });
    writeEvent({
      type: 'complete',
      checkedAt: snapshot.checkedAt,
      agents: snapshot.agents,
    });
  } catch (err) {
    writeEvent({
      type: 'error',
      code: err?.code || 'AGENT_HEALTH_STREAM_FAILED',
      error: err?.message || 'Agent health stream failed.',
    });
  }
  if (!clientClosed) res.end();
});

router.post('/provider-strategy/health', async (req, res) => {
  const body = req.body || {};
  const refreshRaw = String(req.query?.refresh || req.query?.forceRefresh || '').toLowerCase();
  const forceRefresh = body.forceRefresh === true
    || refreshRaw === '1'
    || refreshRaw === 'true'
    || refreshRaw === 'yes';
  const snapshot = await checkProviderStrategyHealth(body.providerStrategy || body, {
    forceRefresh,
    healthLevel: body.healthLevel || body.level || req.query?.level,
    readinessTimeoutMs: body.readinessTimeoutMs,
  });
  await appendProviderHealthLog(snapshot, {
    trigger: body.trigger || req.query?.trigger || 'unknown',
  });
  res.json({ ok: true, ...snapshot });
});

router.get('/provider-strategy/health/logs', async (req, res) => {
  const logs = await listProviderHealthLogs({
    limit: req.query?.limit,
  });
  res.json({ ok: true, logs });
});

router.post('/', async (req, res) => {
  try {
    const agent = await createAgentIdentity(req.body || {}, {
      actor: 'user',
    });
    return res.status(201).json({ ok: true, agent });
  } catch (err) {
    return sendServiceError(res, err);
  }
});

router.post('/import', async (req, res) => {
  try {
    const result = await importAgentIdentities(req.body || {}, {
      actor: 'user',
    });
    return res.status(201).json({
      ok: true,
      agents: result.imported,
      failed: result.failed,
    });
  } catch (err) {
    return sendServiceError(res, err);
  }
});

router.get('/:id', async (req, res) => {
  const agent = await getAgentIdentity(req.params.id);
  if (!agent) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Agent identity not found' });
  }
  return res.json({ ok: true, agent });
});

router.get('/:id/history', async (req, res) => {
  const agent = await getAgentIdentity(req.params.id);
  if (!agent) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Agent identity not found' });
  }
  return res.json({
    ok: true,
    history: agent.history?.entries || [],
    activity: agent.activity?.entries || [],
  });
});

router.get('/:id/reviews', async (req, res) => {
  const agent = await getAgentIdentity(req.params.id);
  if (!agent) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Agent identity not found' });
  }
  return res.json({ ok: true, reviews: agent.reviews?.entries || [] });
});

router.post('/:id/reviews', async (req, res) => {
  const agent = await recordAgentReview(req.params.id, req.body || {}, {
    actor: 'user',
  });
  if (!agent) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Agent identity not found' });
  }
  return res.status(201).json({ ok: true, agent, reviews: agent.reviews?.entries || [] });
});

router.get('/:id/harness-runs', async (req, res) => {
  const agent = await getAgentIdentity(req.params.id);
  if (!agent) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Agent identity not found' });
  }
  return res.json({ ok: true, runs: agent.harness?.runs || [] });
});

router.post('/:id/harness-runs', async (req, res) => {
  const agent = await recordAgentHarnessRun(req.params.id, req.body || {}, {
    actor: 'user',
  });
  if (!agent) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Agent identity not found' });
  }
  return res.status(201).json({ ok: true, agent, runs: agent.harness?.runs || [] });
});

router.patch('/:id/memory/:key', async (req, res) => {
  try {
    const agent = await reviewAgentMemoryNote(req.params.id, req.params.key, req.body || {}, { actor: 'user' });
    if (!agent) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Agent identity not found' });
    }
    return res.json({ ok: true, agent });
  } catch (err) {
    return sendServiceError(res, err);
  }
});

router.delete('/:id/memory/:key', async (req, res) => {
  try {
    const agent = await reviewAgentMemoryNote(
      req.params.id,
      req.params.key,
      { action: 'forget' },
      { actor: 'user' },
    );
    if (!agent) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Agent identity not found' });
    }
    return res.json({ ok: true, agent });
  } catch (err) {
    return sendServiceError(res, err);
  }
});

router.patch('/:id/runtime', async (req, res) => {
  const body = req.body || {};
  const agent = await updateAgentRuntime(req.params.id, body.runtime || body, {
    actor: 'user',
    summary: typeof body.summary === 'string' ? body.summary : '',
  });
  if (!agent) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Agent identity not found' });
  }
  return res.json({ ok: true, agent, runtime: agent.runtime || {} });
});

router.patch('/:id/enabled/stream', async (req, res) => {
  const body = req.body || {};
  const summary = typeof body.summary === 'string' ? body.summary : '';
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const result = await executeAgentLifecycleToggle({
    agentId: req.params.id,
    enabled: body.enabled !== false,
    summary,
    clientSteps: body.clientSteps,
    onStep: (step, lifecycleRun) => {
      streamLifecycleEvent(res, {
        type: 'step',
        step,
        lifecycleRun,
      });
    },
  });

  streamLifecycleEvent(res, {
    type: result.body.ok ? 'complete' : 'error',
    ...result.body,
  });
  res.end();
});

router.patch('/:id/enabled', async (req, res) => {
  const body = req.body || {};
  const result = await executeAgentLifecycleToggle({
    agentId: req.params.id,
    enabled: body.enabled !== false,
    summary: typeof body.summary === 'string' ? body.summary : '',
    clientSteps: body.clientSteps,
  });
  return res.status(result.status).json(result.body);
});

router.patch('/:id', async (req, res) => {
  const body = req.body || {};
  const agent = await updateAgentIdentity(req.params.id, body.profile || body, {
    actor: 'user',
    summary: typeof body.summary === 'string' ? body.summary : '',
  });
  if (!agent) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Agent identity not found' });
  }
  return res.json({ ok: true, agent });
});

module.exports = router;
