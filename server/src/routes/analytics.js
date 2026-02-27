const express = require('express');
const router = express.Router();
const Escalation = require('../models/Escalation');

// Helper: build date range filter with validation
function dateFilter(query) {
  const filter = {};
  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) {
      const d = new Date(query.dateFrom);
      if (isNaN(d.getTime())) return { _invalid: 'dateFrom' };
      filter.createdAt.$gte = d;
    }
    if (query.dateTo) {
      const d = new Date(query.dateTo);
      if (isNaN(d.getTime())) return { _invalid: 'dateTo' };
      filter.createdAt.$lte = d;
    }
  }
  return filter;
}

// GET /api/analytics/summary -- Dashboard summary stats
router.get('/summary', async (req, res) => {
  const [total, open, inProgress, resolved, escalated] = await Promise.all([
    Escalation.countDocuments(),
    Escalation.countDocuments({ status: 'open' }),
    Escalation.countDocuments({ status: 'in-progress' }),
    Escalation.countDocuments({ status: 'resolved' }),
    Escalation.countDocuments({ status: 'escalated-further' }),
  ]);

  // Avg resolution time for resolved escalations
  const avgResult = await Escalation.aggregate([
    { $match: { status: 'resolved', resolvedAt: { $ne: null } } },
    { $project: { duration: { $subtract: ['$resolvedAt', '$createdAt'] } } },
    { $group: { _id: null, avgMs: { $avg: '$duration' } } },
  ]);

  const avgResolutionMs = avgResult.length > 0 ? avgResult[0].avgMs : null;

  res.json({
    ok: true,
    summary: {
      total,
      open,
      inProgress,
      resolved,
      escalated,
      avgResolutionMs,
      avgResolutionHours: avgResolutionMs ? Math.round(avgResolutionMs / 3600000 * 10) / 10 : null,
    },
  });
});

// GET /api/analytics/categories -- Escalation count by category
router.get('/categories', async (req, res) => {
  const match = dateFilter(req.query);
  if (match._invalid) return res.status(400).json({ ok: false, code: 'INVALID_DATE', error: `Invalid ${match._invalid} date` });
  const result = await Escalation.aggregate([
    { $match: match },
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  res.json({ ok: true, categories: result.map((r) => ({ category: r._id, count: r.count })) });
});

// GET /api/analytics/resolution-time -- Avg resolution time by category
router.get('/resolution-time', async (req, res) => {
  const df = dateFilter(req.query);
  if (df._invalid) return res.status(400).json({ ok: false, code: 'INVALID_DATE', error: `Invalid ${df._invalid} date` });
  const match = { status: 'resolved', resolvedAt: { $ne: null }, ...df };
  const result = await Escalation.aggregate([
    { $match: match },
    { $project: { category: 1, duration: { $subtract: ['$resolvedAt', '$createdAt'] } } },
    { $group: { _id: '$category', avgMs: { $avg: '$duration' }, count: { $sum: 1 } } },
    { $sort: { avgMs: 1 } },
  ]);

  res.json({
    ok: true,
    resolutionTimes: result.map((r) => ({
      category: r._id,
      avgMs: r.avgMs,
      avgHours: Math.round(r.avgMs / 3600000 * 10) / 10,
      count: r.count,
    })),
  });
});

// GET /api/analytics/agents -- Escalation count by agent
router.get('/agents', async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const match = dateFilter(req.query);
  if (match._invalid) return res.status(400).json({ ok: false, code: 'INVALID_DATE', error: `Invalid ${match._invalid} date` });
  // Only include escalations that have an agent name
  match.agentName = { $ne: '' };

  const result = await Escalation.aggregate([
    { $match: match },
    { $group: { _id: '$agentName', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);

  res.json({ ok: true, agents: result.map((r) => ({ agentName: r._id, count: r.count })) });
});

// GET /api/analytics/trends -- Escalations over time
router.get('/trends', async (req, res) => {
  const interval = req.query.interval || 'daily';
  const match = dateFilter(req.query);
  if (match._invalid) return res.status(400).json({ ok: false, code: 'INVALID_DATE', error: `Invalid ${match._invalid} date` });

  let dateFormat;
  if (interval === 'weekly') {
    dateFormat = { $dateToString: { format: '%Y-W%V', date: '$createdAt' } };
  } else if (interval === 'monthly') {
    dateFormat = { $dateToString: { format: '%Y-%m', date: '$createdAt' } };
  } else {
    dateFormat = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
  }

  const result = await Escalation.aggregate([
    { $match: match },
    { $group: { _id: dateFormat, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  res.json({ ok: true, trends: result.map((r) => ({ date: r._id, count: r.count })) });
});

// GET /api/analytics/recurring -- Most frequent issue patterns
router.get('/recurring', async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;

  const result = await Escalation.aggregate([
    { $match: { attemptingTo: { $ne: '' } } },
    { $group: { _id: { category: '$category', attemptingTo: '$attemptingTo' }, count: { $sum: 1 } } },
    { $match: { count: { $gte: 2 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);

  res.json({
    ok: true,
    recurring: result.map((r) => ({
      category: r._id.category,
      issue: r._id.attemptingTo,
      count: r.count,
    })),
  });
});

// GET /api/analytics/today -- Quick snapshot of today's activity
router.get('/today', async (req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [created, resolved, open, inProgress] = await Promise.all([
    Escalation.countDocuments({ createdAt: { $gte: startOfDay } }),
    Escalation.countDocuments({ resolvedAt: { $gte: startOfDay } }),
    Escalation.countDocuments({ status: 'open' }),
    Escalation.countDocuments({ status: 'in-progress' }),
  ]);

  // Top categories today
  const topCategories = await Escalation.aggregate([
    { $match: { createdAt: { $gte: startOfDay } } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 },
  ]);

  // Avg time to resolve today
  const avgToday = await Escalation.aggregate([
    { $match: { resolvedAt: { $gte: startOfDay } } },
    { $project: { duration: { $subtract: ['$resolvedAt', '$createdAt'] } } },
    { $group: { _id: null, avgMs: { $avg: '$duration' } } },
  ]);

  res.json({
    ok: true,
    today: {
      created,
      resolved,
      openBacklog: open,
      inProgress,
      topCategories: topCategories.map((r) => ({ category: r._id, count: r.count })),
      avgResolutionMinutes: avgToday.length > 0
        ? Math.round(avgToday[0].avgMs / 60000)
        : null,
    },
  });
});

// GET /api/analytics/status-flow -- How escalations flow between statuses
router.get('/status-flow', async (req, res) => {
  const match = dateFilter(req.query);
  if (match._invalid) return res.status(400).json({ ok: false, code: 'INVALID_DATE', error: `Invalid ${match._invalid} date` });

  const statusCounts = await Escalation.aggregate([
    { $match: match },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const total = statusCounts.reduce((sum, r) => sum + r.count, 0);
  const flow = {};
  for (const r of statusCounts) {
    flow[r._id] = {
      count: r.count,
      percent: total > 0 ? Math.round(r.count / total * 1000) / 10 : 0,
    };
  }

  res.json({ ok: true, total, flow });
});

module.exports = router;
