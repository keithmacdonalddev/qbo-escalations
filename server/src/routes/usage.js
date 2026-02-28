'use strict';

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const UsageLog = require('../models/UsageLog');
const { microsToUsd } = require('../lib/pricing');

// ── Strict date parsing (R5, R14) ──────────────────────────────────────
// All date handling is UTC. Rejects impossible calendar dates like Feb 31
// that new Date() silently normalizes. Only accepts ISO formats
// (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS...).
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function parseStrictDate(str) {
  if (typeof str !== 'string') return null;
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;

  // Extract YYYY-MM-DD from start; reject non-ISO formats
  const m = str.match(ISO_PREFIX_RE);
  if (!m) return null;

  // Validate the calendar date exists — catches Feb 31, Apr 31, etc.
  // Constructs a fresh Date from the extracted components and checks
  // whether they survive round-trip without normalization.
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) {
    return null;
  }

  return d;
}

// When dateTo is a date-only string (YYYY-MM-DD), apply end-of-day
// correction so the full day is included. When it's a full timestamp,
// use it as-is to respect the caller's precision (R5, R14).
function dateFilter(query) {
  const filter = {};
  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) {
      const d = parseStrictDate(query.dateFrom);
      if (!d) return { _invalid: 'dateFrom' };
      filter.createdAt.$gte = d;
    }
    if (query.dateTo) {
      const d = parseStrictDate(query.dateTo);
      if (!d) return { _invalid: 'dateTo' };
      if (DATE_ONLY_RE.test(query.dateTo)) {
        d.setUTCHours(23, 59, 59, 999);
      }
      filter.createdAt.$lte = d;
    }
  }
  return filter;
}

// ── Shared: oldest log timestamp ───────────────────────────────────────
async function getDataAvailableFrom() {
  const oldest = await UsageLog.findOne()
    .sort({ createdAt: 1 })
    .select('createdAt')
    .lean();
  return oldest ? oldest.createdAt : null;
}

// ── Shared: clamp pagination ───────────────────────────────────────────
function clampLimit(query, defaultLimit = 50, maxLimit = 200) {
  const parsed = parseInt(query.limit, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return defaultLimit;
  return Math.min(parsed, maxLimit);
}

function clampPage(query) {
  const parsed = parseInt(query.page, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

// ── Helper: convert aggregated nanos to micros + USD string ────────────
function costFields(totalNanos, inputNanos, outputNanos) {
  const totalCostMicros = Math.round((totalNanos || 0) / 1000);
  const inputCostMicros = Math.round((inputNanos || 0) / 1000);
  const outputCostMicros = totalCostMicros - inputCostMicros;
  return {
    totalCostMicros,
    totalCostUsd: microsToUsd(totalCostMicros),
    inputCostMicros,
    outputCostMicros,
  };
}

// ── GET /api/usage/summary ─────────────────────────────────────────────
// Total requests, tokens, cost for period.
// Includes usageReportedCount and usageCoveragePercent (R12).
router.get('/summary', async (req, res) => {
  const match = dateFilter(req.query);
  if (match._invalid) {
    return res.status(400).json({ ok: false, code: 'INVALID_DATE', error: `Invalid ${match._invalid} date` });
  }

  const [agg, dataAvailableFrom] = await Promise.all([
    UsageLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          totalInputTokens: { $sum: '$inputTokens' },
          totalOutputTokens: { $sum: '$outputTokens' },
          totalTokens: { $sum: '$totalTokens' },
          totalCostNanos: { $sum: '$totalCostNanos' },
          inputCostNanos: { $sum: '$inputCostNanos' },
          outputCostNanos: { $sum: '$outputCostNanos' },
          usageReportedCount: {
            $sum: { $cond: ['$usageAvailable', 1, 0] },
          },
          usageCompleteCount: {
            $sum: { $cond: ['$usageComplete', 1, 0] },
          },
        },
      },
    ]),
    getDataAvailableFrom(),
  ]);

  const d = agg[0] || {
    totalRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalCostNanos: 0,
    inputCostNanos: 0,
    outputCostNanos: 0,
    usageReportedCount: 0,
    usageCompleteCount: 0,
  };

  const usageCoveragePercent = d.totalRequests > 0
    ? Math.round((d.usageReportedCount / d.totalRequests) * 1000) / 10
    : 0;

  const usageCompleteCoveragePercent = d.totalRequests > 0
    ? Math.round((d.usageCompleteCount / d.totalRequests) * 1000) / 10
    : 0;

  res.json({
    ok: true,
    summary: {
      totalRequests: d.totalRequests,
      totalInputTokens: d.totalInputTokens,
      totalOutputTokens: d.totalOutputTokens,
      totalTokens: d.totalTokens,
      ...costFields(d.totalCostNanos, d.inputCostNanos, d.outputCostNanos),
      usageReportedCount: d.usageReportedCount,
      usageCoveragePercent,
      usageCompleteCount: d.usageCompleteCount,
      usageCompleteCoveragePercent,
    },
    dataAvailableFrom,
  });
});

// ── GET /api/usage/by-provider ─────────────────────────────────────────
// Breakdown per provider.
router.get('/by-provider', async (req, res) => {
  const match = dateFilter(req.query);
  if (match._invalid) {
    return res.status(400).json({ ok: false, code: 'INVALID_DATE', error: `Invalid ${match._invalid} date` });
  }

  const [result, dataAvailableFrom] = await Promise.all([
    UsageLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$provider',
          requests: { $sum: 1 },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          totalTokens: { $sum: '$totalTokens' },
          totalCostNanos: { $sum: '$totalCostNanos' },
          inputCostNanos: { $sum: '$inputCostNanos' },
          outputCostNanos: { $sum: '$outputCostNanos' },
        },
      },
      { $sort: { totalTokens: -1 } },
    ]),
    getDataAvailableFrom(),
  ]);

  res.json({
    ok: true,
    providers: result.map((r) => ({
      provider: r._id,
      requests: r.requests,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.totalTokens,
      ...costFields(r.totalCostNanos, r.inputCostNanos, r.outputCostNanos),
    })),
    dataAvailableFrom,
  });
});

// ── GET /api/usage/by-service ──────────────────────────────────────────
// Breakdown per service (chat, parse, dev, copilot).
router.get('/by-service', async (req, res) => {
  const match = dateFilter(req.query);
  if (match._invalid) {
    return res.status(400).json({ ok: false, code: 'INVALID_DATE', error: `Invalid ${match._invalid} date` });
  }

  const [result, dataAvailableFrom] = await Promise.all([
    UsageLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$service',
          requests: { $sum: 1 },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          totalTokens: { $sum: '$totalTokens' },
          totalCostNanos: { $sum: '$totalCostNanos' },
          inputCostNanos: { $sum: '$inputCostNanos' },
          outputCostNanos: { $sum: '$outputCostNanos' },
        },
      },
      { $sort: { totalTokens: -1 } },
    ]),
    getDataAvailableFrom(),
  ]);

  res.json({
    ok: true,
    services: result.map((r) => ({
      service: r._id,
      requests: r.requests,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.totalTokens,
      ...costFields(r.totalCostNanos, r.inputCostNanos, r.outputCostNanos),
    })),
    dataAvailableFrom,
  });
});

// ── GET /api/usage/trends ──────────────────────────────────────────────
// Time-series (daily/weekly/monthly).
const VALID_INTERVALS = ['daily', 'weekly', 'monthly'];

router.get('/trends', async (req, res) => {
  const rawInterval = req.query.interval || 'daily';
  const interval = VALID_INTERVALS.includes(rawInterval) ? rawInterval : 'daily';
  const match = dateFilter(req.query);
  if (match._invalid) {
    return res.status(400).json({ ok: false, code: 'INVALID_DATE', error: `Invalid ${match._invalid} date` });
  }

  let dateFormat;
  if (interval === 'weekly') {
    // Use %G (ISO year) with %V (ISO week) so year-boundary weeks are correct
    dateFormat = { $dateToString: { format: '%G-W%V', date: '$createdAt' } };
  } else if (interval === 'monthly') {
    dateFormat = { $dateToString: { format: '%Y-%m', date: '$createdAt' } };
  } else {
    dateFormat = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
  }

  const [result, dataAvailableFrom] = await Promise.all([
    UsageLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: dateFormat,
          requests: { $sum: 1 },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          totalTokens: { $sum: '$totalTokens' },
          totalCostNanos: { $sum: '$totalCostNanos' },
          inputCostNanos: { $sum: '$inputCostNanos' },
          outputCostNanos: { $sum: '$outputCostNanos' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    getDataAvailableFrom(),
  ]);

  res.json({
    ok: true,
    interval,
    trends: result.map((r) => ({
      date: r._id,
      requests: r.requests,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.totalTokens,
      ...costFields(r.totalCostNanos, r.inputCostNanos, r.outputCostNanos),
    })),
    dataAvailableFrom,
  });
});

// ── GET /api/usage/by-category ─────────────────────────────────────────
// Token usage per escalation category / copilot action.
// Groups include both service and category fields (R11).
// Optional ?service= filter to narrow to one service.
const VALID_SERVICES = ['chat', 'parse', 'dev', 'copilot'];

router.get('/by-category', async (req, res) => {
  const match = dateFilter(req.query);
  if (match._invalid) {
    return res.status(400).json({ ok: false, code: 'INVALID_DATE', error: `Invalid ${match._invalid} date` });
  }

  if (req.query.service) {
    if (!VALID_SERVICES.includes(req.query.service)) {
      return res.status(400).json({ ok: false, code: 'INVALID_SERVICE', error: `Invalid service. Must be one of: ${VALID_SERVICES.join(', ')}` });
    }
    match.service = req.query.service;
  }

  const [result, dataAvailableFrom] = await Promise.all([
    UsageLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: { service: '$service', category: '$category' },
          requests: { $sum: 1 },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          totalTokens: { $sum: '$totalTokens' },
          totalCostNanos: { $sum: '$totalCostNanos' },
          inputCostNanos: { $sum: '$inputCostNanos' },
          outputCostNanos: { $sum: '$outputCostNanos' },
        },
      },
      { $sort: { totalTokens: -1 } },
    ]),
    getDataAvailableFrom(),
  ]);

  res.json({
    ok: true,
    categories: result.map((r) => ({
      service: r._id.service,
      category: r._id.category,
      requests: r.requests,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.totalTokens,
      ...costFields(r.totalCostNanos, r.inputCostNanos, r.outputCostNanos),
    })),
    dataAvailableFrom,
  });
});

// ── GET /api/usage/recent ──────────────────────────────────────────────
// Paginated recent requests table. Limit capped at 200, default 50.
router.get('/recent', async (req, res) => {
  const match = dateFilter(req.query);
  if (match._invalid) {
    return res.status(400).json({ ok: false, code: 'INVALID_DATE', error: `Invalid ${match._invalid} date` });
  }

  const limit = clampLimit(req.query);
  const page = clampPage(req.query);
  const skip = (page - 1) * limit;

  const [docs, total, dataAvailableFrom] = await Promise.all([
    UsageLog.find(match)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    UsageLog.countDocuments(match),
    getDataAvailableFrom(),
  ]);

  res.json({
    ok: true,
    recent: docs.map((d) => ({
      id: d._id,
      requestId: d.requestId,
      service: d.service,
      provider: d.provider,
      model: d.model,
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      totalTokens: d.totalTokens,
      totalCostMicros: d.totalCostMicros,
      totalCostUsd: microsToUsd(d.totalCostMicros),
      status: d.status,
      category: d.category,
      latencyMs: d.latencyMs,
      usageAvailable: d.usageAvailable,
      usageComplete: d.usageComplete,
      createdAt: d.createdAt,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    dataAvailableFrom,
  });
});

// ── GET /api/usage/conversation/:id ────────────────────────────────────
// Aggregate usage for one conversation. Validates ObjectId format (R15).
// Accepts dateFrom/dateTo for consistency with all other endpoints.
router.get('/conversation/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_ID',
      error: 'Invalid conversation ID',
    });
  }

  const dateMatch = dateFilter(req.query);
  if (dateMatch._invalid) {
    return res.status(400).json({ ok: false, code: 'INVALID_DATE', error: `Invalid ${dateMatch._invalid} date` });
  }

  const conversationId = new mongoose.Types.ObjectId(req.params.id);
  const match = { conversationId, ...dateMatch };

  const [agg, docs, dataAvailableFrom] = await Promise.all([
    UsageLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          totalTokens: { $sum: '$totalTokens' },
          totalCostNanos: { $sum: '$totalCostNanos' },
          inputCostNanos: { $sum: '$inputCostNanos' },
          outputCostNanos: { $sum: '$outputCostNanos' },
        },
      },
    ]),
    UsageLog.find(match)
      .sort({ createdAt: 1 })
      .lean(),
    getDataAvailableFrom(),
  ]);

  const d = agg[0] || {
    totalRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    totalCostNanos: 0,
    inputCostNanos: 0,
    outputCostNanos: 0,
  };

  res.json({
    ok: true,
    conversationId: req.params.id,
    aggregate: {
      totalRequests: d.totalRequests,
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      totalTokens: d.totalTokens,
      ...costFields(d.totalCostNanos, d.inputCostNanos, d.outputCostNanos),
    },
    requests: docs.map((doc) => ({
      id: doc._id,
      requestId: doc.requestId,
      provider: doc.provider,
      model: doc.model,
      inputTokens: doc.inputTokens,
      outputTokens: doc.outputTokens,
      totalTokens: doc.totalTokens,
      totalCostMicros: doc.totalCostMicros,
      totalCostUsd: microsToUsd(doc.totalCostMicros),
      status: doc.status,
      createdAt: doc.createdAt,
    })),
    dataAvailableFrom,
  });
});

// ── GET /api/usage/models ──────────────────────────────────────────────
// Breakdown per model.
router.get('/models', async (req, res) => {
  const match = dateFilter(req.query);
  if (match._invalid) {
    return res.status(400).json({ ok: false, code: 'INVALID_DATE', error: `Invalid ${match._invalid} date` });
  }

  const [result, dataAvailableFrom] = await Promise.all([
    UsageLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: { model: '$model', provider: '$provider' },
          requests: { $sum: 1 },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          totalTokens: { $sum: '$totalTokens' },
          totalCostNanos: { $sum: '$totalCostNanos' },
          inputCostNanos: { $sum: '$inputCostNanos' },
          outputCostNanos: { $sum: '$outputCostNanos' },
        },
      },
      { $sort: { totalTokens: -1 } },
    ]),
    getDataAvailableFrom(),
  ]);

  res.json({
    ok: true,
    models: result.map((r) => ({
      model: r._id.model,
      provider: r._id.provider,
      requests: r.requests,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.totalTokens,
      ...costFields(r.totalCostNanos, r.inputCostNanos, r.outputCostNanos),
    })),
    dataAvailableFrom,
  });
});

module.exports = router;
