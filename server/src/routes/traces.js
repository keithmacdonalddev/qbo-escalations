'use strict';

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const AiTrace = require('../models/AiTrace');

const VALID_INTERVALS = new Set(['daily', 'weekly', 'monthly']);
const VALID_SERVICES = new Set(['chat', 'parse']);
const VALID_STATUSES = new Set(['running', 'ok', 'error', 'aborted']);
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseStrictDate(str) {
  if (typeof str !== 'string') return null;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  const match = str.match(ISO_PREFIX_RE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) {
    return null;
  }
  return d;
}

function dateFilter(query) {
  const filter = {};
  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) {
      const from = parseStrictDate(query.dateFrom);
      if (!from) return { _invalid: 'dateFrom' };
      filter.createdAt.$gte = from;
    }
    if (query.dateTo) {
      const to = parseStrictDate(query.dateTo);
      if (!to) return { _invalid: 'dateTo' };
      if (DATE_ONLY_RE.test(query.dateTo)) to.setUTCHours(23, 59, 59, 999);
      filter.createdAt.$lte = to;
    }
  }
  return filter;
}

function parseBoolQuery(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function clampLimit(query, defaultLimit = 50, maxLimit = 200) {
  const parsed = Number.parseInt(query.limit, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return defaultLimit;
  return Math.min(parsed, maxLimit);
}

function clampPage(query) {
  const parsed = Number.parseInt(query.page, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function clampSeriesLimit(value, fallback = 6, max = 10) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function getDataAvailableFrom() {
  return AiTrace.findOne().sort({ createdAt: 1 }).select('createdAt').lean();
}

function buildMatch(query) {
  const match = dateFilter(query);
  if (match._invalid) return match;

  if (query.service) {
    if (!VALID_SERVICES.has(query.service)) {
      return { _invalid: 'service' };
    }
    match.service = query.service;
  }
  if (query.status) {
    if (!VALID_STATUSES.has(query.status)) {
      return { _invalid: 'status' };
    }
    match.status = query.status;
  }
  if (query.conversationId) {
    if (!mongoose.Types.ObjectId.isValid(query.conversationId)) {
      return { _invalid: 'conversationId' };
    }
    match.conversationId = new mongoose.Types.ObjectId(query.conversationId);
  }
  const hasImages = parseBoolQuery(query.hasImages);
  if (hasImages !== null) {
    match.hasImages = hasImages;
  }
  if (query.provider) {
    match.$or = [
      { 'outcome.providerUsed': query.provider },
      { 'requested.primaryProvider': query.provider },
      { 'triage.providerUsed': query.provider },
      { 'postParse.providerUsed': query.provider },
    ];
  }
  if (query.model) {
    const rx = new RegExp(escapeRegex(query.model), 'i');
    const modelMatcher = {
      $or: [
        { 'outcome.modelUsed': rx },
        { 'requested.primaryModel': rx },
        { 'triage.modelUsed': rx },
        { 'postParse.modelUsed': rx },
        { 'usage.model': rx },
      ],
    };
    if (match.$or) {
      match.$and = [{ $or: match.$or }, modelMatcher];
      delete match.$or;
    } else {
      Object.assign(match, modelMatcher);
    }
  }
  return match;
}

function baseProjection() {
  return {
    providerUsed: {
      $ifNull: [
        '$outcome.providerUsed',
        {
          $ifNull: [
            '$postParse.providerUsed',
            {
              $ifNull: ['$triage.providerUsed', '$requested.primaryProvider'],
            },
          ],
        },
      ],
    },
    modelUsed: {
      $ifNull: [
        '$outcome.modelUsed',
        {
          $ifNull: [
            '$postParse.modelUsed',
            {
              $ifNull: ['$triage.modelUsed', '$requested.primaryModel'],
            },
          ],
        },
      ],
    },
    service: 1,
    status: 1,
    hasImages: 1,
    imageCount: 1,
    totalMs: '$outcome.totalMs',
    firstThinkingMs: '$outcome.firstThinkingMs',
    firstChunkMs: '$outcome.firstChunkMs',
    triageMs: '$triage.latencyMs',
    postParseMs: '$postParse.latencyMs',
    triageScore: '$triage.validationScore',
    postParseScore: '$postParse.validationScore',
    fallbackUsed: '$outcome.fallbackUsed',
    preparedBytesTotal: '$imageStats.preparedBytesTotal',
    averageCompressionRatio: '$imageStats.averageCompressionRatio',
    totalTokens: '$usage.totalTokens',
    totalCostMicros: '$usage.totalCostMicros',
    createdAt: 1,
  };
}

function avgExpr(field) {
  return {
    $avg: {
      $cond: [
        { $gt: [field, 0] },
        field,
        null,
      ],
    },
  };
}

router.get('/summary', async (req, res) => {
  const match = buildMatch(req.query);
  if (match._invalid) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_FILTER',
      error: `Invalid ${match._invalid} filter`,
    });
  }

  const [rows, dataAvailableFrom] = await Promise.all([
    AiTrace.aggregate([
      { $match: match },
      { $project: baseProjection() },
      {
        $group: {
          _id: null,
          totalTraces: { $sum: 1 },
          runningCount: { $sum: { $cond: [{ $eq: ['$status', 'running'] }, 1, 0] } },
          okCount: { $sum: { $cond: [{ $eq: ['$status', 'ok'] }, 1, 0] } },
          errorCount: { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
          abortedCount: { $sum: { $cond: [{ $eq: ['$status', 'aborted'] }, 1, 0] } },
          imageTurns: { $sum: { $cond: ['$hasImages', 1, 0] } },
          fallbackCount: { $sum: { $cond: ['$fallbackUsed', 1, 0] } },
          parseCount: { $sum: { $cond: [{ $gt: ['$postParseMs', 0] }, 1, 0] } },
          avgImagesPerTrace: { $avg: '$imageCount' },
          avgTotalMs: avgExpr('$totalMs'),
          avgFirstThinkingMs: avgExpr('$firstThinkingMs'),
          avgFirstChunkMs: avgExpr('$firstChunkMs'),
          avgTriageMs: avgExpr('$triageMs'),
          avgPostParseMs: avgExpr('$postParseMs'),
          avgTriageScore: { $avg: '$triageScore' },
          avgPostParseScore: { $avg: '$postParseScore' },
          avgPreparedBytes: avgExpr('$preparedBytesTotal'),
          avgCompressionRatio: { $avg: '$averageCompressionRatio' },
        },
      },
    ]),
    getDataAvailableFrom(),
  ]);

  const row = rows[0] || {
    totalTraces: 0,
    runningCount: 0,
    okCount: 0,
    errorCount: 0,
    abortedCount: 0,
    imageTurns: 0,
    fallbackCount: 0,
    parseCount: 0,
    avgImagesPerTrace: 0,
    avgTotalMs: 0,
    avgFirstThinkingMs: 0,
    avgFirstChunkMs: 0,
    avgTriageMs: 0,
    avgPostParseMs: 0,
    avgTriageScore: null,
    avgPostParseScore: null,
    avgPreparedBytes: 0,
    avgCompressionRatio: 0,
  };

  const total = row.totalTraces || 0;
  res.json({
    ok: true,
    summary: {
      ...row,
      imageTurnPercent: total > 0 ? Math.round((row.imageTurns / total) * 1000) / 10 : 0,
      fallbackRatePercent: total > 0 ? Math.round((row.fallbackCount / total) * 1000) / 10 : 0,
      parseCoveragePercent: total > 0 ? Math.round((row.parseCount / total) * 1000) / 10 : 0,
      errorRatePercent: total > 0 ? Math.round((row.errorCount / total) * 1000) / 10 : 0,
    },
    dataAvailableFrom: dataAvailableFrom ? dataAvailableFrom.createdAt : null,
  });
});

router.get('/models', async (req, res) => {
  const match = buildMatch(req.query);
  if (match._invalid) {
    return res.status(400).json({ ok: false, code: 'INVALID_FILTER', error: `Invalid ${match._invalid} filter` });
  }

  const [rows, dataAvailableFrom] = await Promise.all([
    AiTrace.aggregate([
      { $match: match },
      { $project: baseProjection() },
      {
        $group: {
          _id: { model: '$modelUsed', provider: '$providerUsed' },
          requests: { $sum: 1 },
          okCount: { $sum: { $cond: [{ $eq: ['$status', 'ok'] }, 1, 0] } },
          errorCount: { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
          abortedCount: { $sum: { $cond: [{ $eq: ['$status', 'aborted'] }, 1, 0] } },
          runningCount: { $sum: { $cond: [{ $eq: ['$status', 'running'] }, 1, 0] } },
          imageTurns: { $sum: { $cond: ['$hasImages', 1, 0] } },
          fallbackCount: { $sum: { $cond: ['$fallbackUsed', 1, 0] } },
          avgTotalMs: avgExpr('$totalMs'),
          avgFirstThinkingMs: avgExpr('$firstThinkingMs'),
          avgFirstChunkMs: avgExpr('$firstChunkMs'),
          avgTriageMs: avgExpr('$triageMs'),
          avgPostParseMs: avgExpr('$postParseMs'),
          avgTriageScore: { $avg: '$triageScore' },
          avgPostParseScore: { $avg: '$postParseScore' },
          avgPreparedBytes: avgExpr('$preparedBytesTotal'),
          totalTokens: { $sum: '$totalTokens' },
          totalCostMicros: { $sum: '$totalCostMicros' },
        },
      },
      { $sort: { requests: -1, '_id.model': 1 } },
      { $limit: 20 },
    ]),
    getDataAvailableFrom(),
  ]);

  res.json({
    ok: true,
    models: rows.map((row) => ({
      model: row._id.model || '',
      provider: row._id.provider || '',
      requests: row.requests,
      okCount: row.okCount,
      errorCount: row.errorCount,
      abortedCount: row.abortedCount,
      runningCount: row.runningCount,
      imageTurns: row.imageTurns,
      fallbackRatePercent: row.requests > 0 ? Math.round((row.fallbackCount / row.requests) * 1000) / 10 : 0,
      errorRatePercent: row.requests > 0 ? Math.round((row.errorCount / row.requests) * 1000) / 10 : 0,
      avgTotalMs: row.avgTotalMs || 0,
      avgFirstThinkingMs: row.avgFirstThinkingMs || 0,
      avgFirstChunkMs: row.avgFirstChunkMs || 0,
      avgTriageMs: row.avgTriageMs || 0,
      avgPostParseMs: row.avgPostParseMs || 0,
      avgTriageScore: row.avgTriageScore,
      avgPostParseScore: row.avgPostParseScore,
      avgPreparedBytes: row.avgPreparedBytes || 0,
      totalTokens: row.totalTokens || 0,
      totalCostMicros: row.totalCostMicros || 0,
    })),
    dataAvailableFrom: dataAvailableFrom ? dataAvailableFrom.createdAt : null,
  });
});

router.get('/model-trends', async (req, res) => {
  const match = buildMatch(req.query);
  if (match._invalid) {
    return res.status(400).json({ ok: false, code: 'INVALID_FILTER', error: `Invalid ${match._invalid} filter` });
  }
  const interval = VALID_INTERVALS.has(req.query.interval) ? req.query.interval : 'daily';
  const seriesLimit = clampSeriesLimit(req.query.seriesLimit);

  let dateFormat;
  if (interval === 'weekly') {
    dateFormat = { $dateToString: { format: '%G-W%V', date: '$createdAt' } };
  } else if (interval === 'monthly') {
    dateFormat = { $dateToString: { format: '%Y-%m', date: '$createdAt' } };
  } else {
    dateFormat = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
  }

  const [rows, dataAvailableFrom] = await Promise.all([
    AiTrace.aggregate([
      { $match: match },
      { $project: baseProjection() },
      {
        $group: {
          _id: {
            date: dateFormat,
            model: '$modelUsed',
            provider: '$providerUsed',
          },
          requests: { $sum: 1 },
          errorCount: { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
          imageTurns: { $sum: { $cond: ['$hasImages', 1, 0] } },
          avgTotalMs: avgExpr('$totalMs'),
          avgFirstThinkingMs: avgExpr('$firstThinkingMs'),
          avgFirstChunkMs: avgExpr('$firstChunkMs'),
          avgTriageMs: avgExpr('$triageMs'),
          avgPostParseMs: avgExpr('$postParseMs'),
          avgTriageScore: { $avg: '$triageScore' },
          avgPostParseScore: { $avg: '$postParseScore' },
          avgPreparedBytes: avgExpr('$preparedBytesTotal'),
        },
      },
      { $sort: { '_id.date': 1 } },
    ]),
    getDataAvailableFrom(),
  ]);

  const totals = new Map();
  for (const row of rows) {
    const key = `${row._id.provider || ''}::${row._id.model || ''}`;
    totals.set(key, (totals.get(key) || 0) + (row.requests || 0));
  }
  const topKeys = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, seriesLimit)
    .map(([key]) => key);

  const grouped = new Map();
  for (const row of rows) {
    const key = `${row._id.provider || ''}::${row._id.model || ''}`;
    if (!topKeys.includes(key)) continue;
    if (!grouped.has(key)) {
      grouped.set(key, {
        provider: row._id.provider || '',
        model: row._id.model || '',
        totalRequests: totals.get(key) || 0,
        points: [],
      });
    }
    grouped.get(key).points.push({
      date: row._id.date,
      requests: row.requests || 0,
      errorRatePercent: row.requests > 0 ? Math.round((row.errorCount / row.requests) * 1000) / 10 : 0,
      imageTurns: row.imageTurns || 0,
      avgTotalMs: row.avgTotalMs || 0,
      avgFirstThinkingMs: row.avgFirstThinkingMs || 0,
      avgFirstChunkMs: row.avgFirstChunkMs || 0,
      avgTriageMs: row.avgTriageMs || 0,
      avgPostParseMs: row.avgPostParseMs || 0,
      avgTriageScore: row.avgTriageScore,
      avgPostParseScore: row.avgPostParseScore,
      avgPreparedBytes: row.avgPreparedBytes || 0,
    });
  }

  res.json({
    ok: true,
    interval,
    series: [...grouped.values()].sort((a, b) => b.totalRequests - a.totalRequests),
    dataAvailableFrom: dataAvailableFrom ? dataAvailableFrom.createdAt : null,
  });
});

router.get('/recent', async (req, res) => {
  const match = buildMatch(req.query);
  if (match._invalid) {
    return res.status(400).json({ ok: false, code: 'INVALID_FILTER', error: `Invalid ${match._invalid} filter` });
  }

  const limit = clampLimit(req.query, 50, 100);
  const page = clampPage(req.query);
  const skip = (page - 1) * limit;

  const [docs, total, dataAvailableFrom] = await Promise.all([
    AiTrace.find(match)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AiTrace.countDocuments(match),
    getDataAvailableFrom(),
  ]);

  res.json({
    ok: true,
    recent: docs.map((doc) => ({
      id: doc._id,
      requestId: doc.requestId,
      parentTraceId: doc.parentTraceId || null,
      service: doc.service,
      route: doc.route,
      turnKind: doc.turnKind,
      status: doc.status,
      conversationId: doc.conversationId || null,
      escalationId: doc.escalationId || null,
      promptPreview: doc.promptPreview || '',
      requestedPrimaryProvider: doc.requested?.primaryProvider || '',
      requestedPrimaryModel: doc.requested?.primaryModel || '',
      providerUsed: doc.outcome?.providerUsed || doc.postParse?.providerUsed || doc.triage?.providerUsed || '',
      modelUsed: doc.outcome?.modelUsed || doc.postParse?.modelUsed || doc.triage?.modelUsed || '',
      mode: doc.resolved?.mode || doc.requested?.mode || 'single',
      hasImages: Boolean(doc.hasImages),
      imageCount: doc.imageCount || 0,
      firstImage: Array.isArray(doc.images) && doc.images[0] ? doc.images[0] : null,
      imageStats: doc.imageStats || null,
      totalMs: doc.outcome?.totalMs || 0,
      firstThinkingMs: doc.outcome?.firstThinkingMs || 0,
      firstChunkMs: doc.outcome?.firstChunkMs || 0,
      triageMs: doc.triage?.latencyMs || 0,
      postParseMs: doc.postParse?.latencyMs || 0,
      triageScore: doc.triage?.validationScore ?? null,
      postParseScore: doc.postParse?.validationScore ?? null,
      fallbackUsed: Boolean(doc.outcome?.fallbackUsed),
      totalTokens: doc.usage?.totalTokens || 0,
      totalCostMicros: doc.usage?.totalCostMicros || 0,
      createdAt: doc.createdAt,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    dataAvailableFrom: dataAvailableFrom ? dataAvailableFrom.createdAt : null,
  });
});

router.get('/conversation/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ ok: false, code: 'INVALID_ID', error: 'Invalid conversation ID' });
  }
  const docs = await AiTrace.find({ conversationId: new mongoose.Types.ObjectId(req.params.id) })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  res.json({
    ok: true,
    traces: docs,
  });
});

router.get('/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ ok: false, code: 'INVALID_ID', error: 'Invalid trace ID' });
  }
  const trace = await AiTrace.findById(req.params.id).lean();
  if (!trace) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Trace not found' });
  }
  res.json({ ok: true, trace });
});

module.exports = router;
