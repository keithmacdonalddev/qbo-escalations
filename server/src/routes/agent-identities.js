'use strict';

const express = require('express');
const {
  createAgentIdentity,
  getAgentIdentity,
  importAgentIdentities,
  listAgentIdentities,
  recordAgentHarnessRun,
  recordAgentReview,
  updateAgentIdentity,
  updateAgentRuntime,
} = require('../services/agent-identity-service');

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
