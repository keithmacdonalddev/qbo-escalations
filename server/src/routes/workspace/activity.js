'use strict';

const express = require('express');
const { sendApiError } = require('../../lib/api-errors');

const router = express.Router();

router.get('/activity', async (req, res) => {
  try {
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
  } catch (err) {
    return sendApiError(res, err, 'ACTIVITY_ERROR', 'Failed to load workspace activity');
  }
});

module.exports = router;
