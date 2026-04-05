'use strict';

const express = require('express');
const {
  getAgentIdentity,
  listAgentIdentities,
  updateAgentIdentity,
} = require('../services/agent-identity-service');

const router = express.Router();

router.get('/', async (_req, res) => {
  const agents = await listAgentIdentities();
  res.json({ ok: true, agents });
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
