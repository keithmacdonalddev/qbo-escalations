'use strict';

const express = require('express');

const router = express.Router();

router.get('/activity', async (req, res) => {
  const WorkspaceActivity = require('../../models/WorkspaceActivity');
  const since = req.query.since
    ? new Date(req.query.since)
    : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const activities = await WorkspaceActivity.find({ timestamp: { $gte: since } })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
  res.json({ ok: true, activities, since: since.toISOString() });
});

module.exports = router;
