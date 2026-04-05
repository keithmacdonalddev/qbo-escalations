'use strict';

const express = require('express');
const { sendApiError } = require('../../lib/api-errors');
const {
  createRoom,
  listRooms,
  getRoom,
  updateRoom,
  deleteRoom,
} = require('../../services/chat-room-service');
const { getAllAgents, getAgentIds } = require('../../services/room-agents/registry');
const { getAgentIdentity } = require('../../services/agent-identity-service');
const { requireValidId } = require('./middleware');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    // Require at least one active agent
    if (!Array.isArray(body.activeAgents) || body.activeAgents.length === 0) {
      return res.status(400).json({
        ok: false,
        code: 'MISSING_AGENTS',
        error: 'At least one active agent is required',
      });
    }
    // Validate activeAgents against registry
    const validIds = new Set(getAgentIds());
    const invalid = body.activeAgents.filter(id => !validIds.has(id));
    if (invalid.length > 0) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_FIELD',
        error: `Unknown agent IDs: ${invalid.join(', ')}. Valid agents: ${[...validIds].join(', ')}`,
      });
    }
    const room = await createRoom(body);
    return res.status(201).json({ ok: true, room });
  } catch (err) {
    return sendApiError(res, err, 'CREATE_FAILED', 'Failed to create room');
  }
});

router.get('/', async (req, res) => {
  try {
    const parsedLimit = parseInt(req.query.limit, 10);
    const parsedSkip = parseInt(req.query.skip || req.query.offset, 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;
    const skip = Number.isFinite(parsedSkip) && parsedSkip > 0 ? parsedSkip : 0;

    const rooms = await listRooms({ limit, skip });
    return res.json({ ok: true, rooms });
  } catch (err) {
    return sendApiError(res, err, 'LIST_FAILED', 'Failed to list rooms');
  }
});

router.get('/agents', async (_req, res) => {
  const agents = await Promise.all(getAllAgents().map(async (a) => {
    const identity = await getAgentIdentity(a.id);
    return {
    id: a.id,
    name: a.name,
    shortName: a.shortName,
    icon: a.icon,
    color: a.color,
    description: a.description,
    profile: identity?.profile || a.profile || null,
    memory: identity?.memory || { notes: [] },
    history: identity?.history || { entries: [] },
    };
  }));
  return res.json({ ok: true, agents });
});

router.get('/:id', requireValidId, async (req, res) => {
  try {
    const room = await getRoom(req.params.id);
    return res.json({ ok: true, room });
  } catch (err) {
    return sendApiError(res, err, 'NOT_FOUND', 'Room not found');
  }
});

router.patch('/:id', requireValidId, async (req, res) => {
  try {
    const body = req.body || {};
    // Reject explicitly empty activeAgents on update
    if (Array.isArray(body.activeAgents) && body.activeAgents.length === 0) {
      return res.status(400).json({
        ok: false,
        code: 'MISSING_AGENTS',
        error: 'At least one active agent is required',
      });
    }
    // Validate activeAgents against registry
    if (Array.isArray(body.activeAgents)) {
      const validIds = new Set(getAgentIds());
      const invalid = body.activeAgents.filter(id => !validIds.has(id));
      if (invalid.length > 0) {
        return res.status(400).json({
          ok: false,
          code: 'INVALID_FIELD',
          error: `Unknown agent IDs: ${invalid.join(', ')}. Valid agents: ${[...validIds].join(', ')}`,
        });
      }
    }
    const room = await updateRoom(req.params.id, body);
    return res.json({ ok: true, room });
  } catch (err) {
    return sendApiError(res, err, 'UPDATE_FAILED', 'Failed to update room');
  }
});

router.delete('/:id', requireValidId, async (req, res) => {
  try {
    await deleteRoom(req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    return sendApiError(res, err, 'DELETE_FAILED', 'Failed to delete room');
  }
});

module.exports = router;
