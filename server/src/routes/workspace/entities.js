'use strict';

const express = require('express');

const router = express.Router();

router.get('/entities', async (req, res) => {
  try {
    const WorkspaceEntity = require('../../models/WorkspaceEntity');
    const includeAll = req.query.all === 'true';
    const entities = includeAll
      ? await WorkspaceEntity.listAll()
      : await WorkspaceEntity.getActive();
    res.json({ ok: true, entities });
  } catch (err) {
    res.status(500).json({ ok: false, code: 'ENTITY_ERROR', error: err.message });
  }
});

router.patch('/entities/:entityId', async (req, res) => {
  try {
    const WorkspaceEntity = require('../../models/WorkspaceEntity');
    const { entityId } = req.params;
    const { status } = req.body || {};
    if (!entityId) {
      return res.status(400).json({ ok: false, code: 'MISSING_ENTITY_ID', error: 'entityId is required' });
    }
    const validStatuses = ['active', 'completed', 'expired'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ ok: false, code: 'INVALID_STATUS', error: `status must be one of: ${validStatuses.join(', ')}` });
    }
    const update = {};
    if (status) update.status = status;
    update.updatedAt = new Date();

    const entity = await WorkspaceEntity.findOneAndUpdate(
      { entityId },
      { $set: update },
      { returnDocument: 'after', lean: true },
    );
    if (!entity) {
      return res.status(404).json({ ok: false, code: 'ENTITY_NOT_FOUND', error: 'Entity not found' });
    }
    res.json({ ok: true, entity });
  } catch (err) {
    res.status(500).json({ ok: false, code: 'ENTITY_ERROR', error: err.message });
  }
});

module.exports = router;
