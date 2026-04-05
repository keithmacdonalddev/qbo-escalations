'use strict';

const express = require('express');
const patternLearner = require('../../services/workspace-pattern-learner');
const { createApiError, sendApiError } = require('../../lib/api-errors');

const router = express.Router();

router.get('/patterns', async (req, res) => {
  try {
    const status = patternLearner.getStatus();
    const patterns = await patternLearner.detectPatterns();
    res.json({ ok: true, ...status, patterns });
  } catch (err) {
    return sendApiError(res, createApiError('PATTERN_ERROR', err.message || 'Failed to load patterns', 500));
  }
});

router.get('/behavior-stats', async (req, res) => {
  try {
    const WorkspaceBehaviorLog = require('../../models/WorkspaceBehaviorLog');
    const [totalCount, recentActions, topDomains] = await Promise.all([
      WorkspaceBehaviorLog.countDocuments(),
      WorkspaceBehaviorLog.find()
        .sort({ timestamp: -1 })
        .limit(20)
        .lean(),
      WorkspaceBehaviorLog.aggregate([
        { $match: { targetDomain: { $ne: '' } } },
        { $group: {
          _id: { actionType: '$actionType', targetDomain: '$targetDomain' },
          count: { $sum: 1 },
          lastSeen: { $max: '$timestamp' },
        } },
        { $sort: { count: -1 } },
        { $limit: 15 },
      ]),
    ]);
    res.json({
      ok: true,
      totalLogs: totalCount,
      recentActions: recentActions.map((a) => ({
        actionType: a.actionType,
        targetDomain: a.targetDomain,
        targetLabel: a.targetLabel,
        targetSubject: a.targetSubject,
        timestamp: a.timestamp,
      })),
      topDomains,
    });
  } catch (err) {
    return sendApiError(res, createApiError('STATS_ERROR', err.message || 'Failed to load behavior stats', 500));
  }
});

router.post('/patterns/mine', async (req, res) => {
  try {
    const newRules = await patternLearner.proposeNewRules();
    patternLearner.markMiningDone();
    res.json({
      ok: true,
      proposedRules: newRules.length,
      rules: newRules.map((r) => ({
        ruleId: r.ruleId,
        name: r.name,
        description: r.description,
        patternCount: r.patternCount,
        tier: r.tier,
      })),
    });
  } catch (err) {
    return sendApiError(res, createApiError('MINING_ERROR', err.message || 'Failed to mine new patterns', 500));
  }
});

module.exports = router;
