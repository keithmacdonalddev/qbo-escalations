'use strict';

const express = require('express');
const {
  createAgentIdentity,
  getAgentIdentity,
  importAgentIdentities,
  listAgentLifecycleStates,
  listAgentRuntimeDefaults,
  listAgentIdentities,
  recordAgentHarnessRun,
  recordAgentReview,
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
  return res.json({ ok: true, history: agent.history.entries || [] });
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

router.patch('/:id/enabled', async (req, res) => {
  const body = req.body || {};
  const agent = await updateAgentEnabled(req.params.id, body.enabled !== false, {
    actor: 'user',
    summary: typeof body.summary === 'string' ? body.summary : '',
  });
  if (!agent) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Agent identity not found' });
  }
  await refreshAgentHealth({ agentIds: [req.params.id], forceRefresh: true });
  return res.json({ ok: true, agent, enabled: agent.enabled !== false });
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
