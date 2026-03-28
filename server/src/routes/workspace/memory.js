'use strict';

const express = require('express');

const router = express.Router();

router.get('/memory/count', async (req, res) => {
  try {
    const WorkspaceMemory = require('../../models/WorkspaceMemory');
    const now = new Date();

    const count = await WorkspaceMemory.countDocuments({
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    });

    res.json({ ok: true, count });
  } catch (err) {
    res.json({ ok: false, code: 'MEMORY_ERROR', error: err.message });
  }
});

router.get('/memories', async (req, res) => {
  try {
    const workspaceMemory = require('../../services/workspace-memory');
    const type = req.query.type;
    const query = req.query.q;
    const limit = parseInt(req.query.limit, 10) || 20;

    let memories;
    if (type) {
      memories = await workspaceMemory.getByType(type);
    } else if (query) {
      memories = await workspaceMemory.getRelevantMemories(query, limit);
    } else {
      memories = await workspaceMemory.getRelevantMemories('', limit);
    }

    res.json({ ok: true, memories });
  } catch (err) {
    res.json({ ok: false, code: 'MEMORY_ERROR', error: err.message });
  }
});

router.delete('/memories/:key', async (req, res) => {
  try {
    const workspaceMemory = require('../../services/workspace-memory');
    const result = await workspaceMemory.deleteMemory(req.params.key);
    res.json(result);
  } catch (err) {
    res.json({ ok: false, code: 'MEMORY_ERROR', error: err.message });
  }
});

module.exports = router;
