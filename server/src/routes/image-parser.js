'use strict';

const express = require('express');
const { createRateLimiter } = require('../middleware/rate-limit');
const {
  parseImage,
  checkProviderAvailability,
  clearProviderAvailabilityCache,
  normalizeImageParsePromptId,
  resolveApiKey,
  getAllStoredKeys,
  setStoredApiKey,
  validateRemoteProvider,
} = require('../services/image-parser');
const ImageParseResult = require('../models/ImageParseResult');
const {
  archiveParserImage,
  getParserImageFile,
} = require('../lib/image-parser-archive');
const { createApiError, sendApiError } = require('../lib/api-errors');

const router = express.Router();
const IMAGE_PARSER_VERBOSE_LOGS = process.env.IMAGE_PARSER_VERBOSE_LOGS === '1';
const VALID_PARSE_PROVIDERS = [
  'llm-gateway',
  'lm-studio',
  'anthropic',
  'openai',
  'kimi',
  'gemini',
];
const VALID_KEY_PROVIDERS = [
  'llm-gateway',
  'anthropic',
  'openai',
  'kimi',
  'gemini',
];
const VALID_PARSE_PROVIDER_LIST = VALID_PARSE_PROVIDERS.join(', ');
const VALID_KEY_PROVIDER_LIST = VALID_KEY_PROVIDERS.join(', ');

function attachSourceImageUrl(result) {
  if (!result || !result._id) return result;
  const hasSourceImage = !!(result.image && result.image.sourceFileName);
  return {
    ...result,
    hasSourceImage,
    sourceImageUrl: hasSourceImage ? `/api/image-parser/history/${result._id}/image` : '',
  };
}

function verboseWarn(...args) {
  if (IMAGE_PARSER_VERBOSE_LOGS) {
    console.warn(...args);
  }
}

function verboseError(...args) {
  if (IMAGE_PARSER_VERBOSE_LOGS) {
    console.error(...args);
  }
}

function persistParseResult(record, sourceImage) {
  return (async () => {
    if (!ImageParseResult.db || ImageParseResult.db.readyState !== 1) {
      return;
    }
    try {
      const saved = await ImageParseResult.create(record);
      const archived = archiveParserImage(saved._id, sourceImage);
      if (!archived.ok) {
        verboseWarn('[image-parser-save] Source image archive failed:', archived.error);
        return;
      }

      saved.set('image.sourceFileName', archived.fileName);
      saved.set('image.sourceContentType', archived.contentType);
      saved.set('image.sourceSizeBytes', archived.sizeBytes);
      saved.set('image.sourceStoredAt', new Date());
      await saved.save();
    } catch (err) {
      verboseError('[image-parser-save] FAILED to save:', err.message);
    }
  })();
}

// Rate limit: 10 requests per 60s for parse endpoint
const parseRateLimit = createRateLimiter({ name: 'image-parser', limit: 10, windowMs: 60_000 });

// ---------------------------------------------------------------------------
// POST /parse — Parse an escalation screenshot or INV list image
// ---------------------------------------------------------------------------
router.post('/parse', parseRateLimit, async (req, res) => {
  const { image, provider, model, timeoutMs, promptId, parserPromptId } = req.body || {};

  // Validate required fields
  if (!image) {
    return res.status(400).json({ ok: false, code: 'MISSING_IMAGE', error: 'Image required' });
  }
  if (!VALID_PARSE_PROVIDERS.includes(provider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: `Provider must be one of: ${VALID_PARSE_PROVIDER_LIST}` });
  }

  // Keep the route contract stable for the existing dashboard and tests:
  // default to 60s, cap at 120s, and give the response timeout a 10s buffer.
  const maxTimeout = 120_000;
  const defaultTimeout = 60_000;
  const effectiveTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, maxTimeout) : defaultTimeout;
  if (typeof req.setResponseTimeout === 'function') {
    req.setResponseTimeout(effectiveTimeout + 10_000);
  }

  const startedAt = Date.now();
  const effectivePromptId = normalizeImageParsePromptId(promptId || parserPromptId);

  try {
    const result = await parseImage(image, {
      provider,
      model,
      timeoutMs: effectiveTimeout,
      promptId: effectivePromptId,
    });
    const elapsedMs = Date.now() - startedAt;

    // Fire-and-forget save to MongoDB + on-disk image archive
    persistParseResult({
      provider,
      model: result.usage?.model || model || '',
      modelRequested: model || '',
      image: result.stats?.image || {},
      inputTokens: result.usage?.inputTokens || 0,
      outputTokens: result.usage?.outputTokens || 0,
      totalTokens: (result.usage?.inputTokens || 0) + (result.usage?.outputTokens || 0),
      totalElapsedMs: elapsedMs,
      providerLatencyMs: result.stats?.providerLatencyMs || 0,
      conversionTimeMs: result.stats?.image?.conversionTimeMs || 0,
      status: 'ok',
      role: result.role || '',
      parserPromptId: result.promptId || effectivePromptId,
      parsedText: result.text || '',
      textLength: (result.text || '').length,
      source: 'panel',
    }, image);

    res.json({ ok: true, ...result, promptId: result.promptId || effectivePromptId, meta: result.stats?.image, parseFields: result.parseFields || {}, elapsedMs });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const status = err.code === 'PROVIDER_UNAVAILABLE' ? 503
      : err.code === 'TIMEOUT' ? 504
      : err.code === 'PROVIDER_ERROR' ? 422
      : 422;

    // Fire-and-forget save error to MongoDB + on-disk image archive
    persistParseResult({
      provider,
      modelRequested: model || '',
      parserPromptId: effectivePromptId,
      totalElapsedMs: elapsedMs,
      status: err.message?.includes('timed out') ? 'timeout' : 'error',
      errorCode: err.code || 'UNKNOWN',
      errorMsg: err.message || '',
      source: 'panel',
    }, image);

    res.status(status).json({ ok: false, code: err.code || 'PARSE_FAILED', error: err.message || 'Image parse failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /status — Check provider availability
// ---------------------------------------------------------------------------
router.get('/status', async (req, res) => {
  const refreshRaw = String(req.query?.refresh || req.query?.forceRefresh || '').toLowerCase();
  const forceRefresh = refreshRaw === '1' || refreshRaw === 'true' || refreshRaw === 'yes';
  const providers = await checkProviderAvailability({ forceRefresh });
  res.json({ ok: true, providers });
});

// ---------------------------------------------------------------------------
// GET /keys — Check which providers have stored API keys
// ---------------------------------------------------------------------------
router.get('/keys', async (req, res) => {
  const stored = await getAllStoredKeys();
  res.json({
    ok: true,
    keys: {
      'llm-gateway': !!(stored['llm-gateway'] && stored['llm-gateway'].trim()),
      anthropic: !!(stored.anthropic && stored.anthropic.trim()),
      openai: !!(stored.openai && stored.openai.trim()),
      kimi: !!(stored.kimi && stored.kimi.trim()),
      gemini: !!(stored.gemini && stored.gemini.trim()),
    },
  });
});

// ---------------------------------------------------------------------------
// PUT /keys — Store or remove an API key for a provider
// ---------------------------------------------------------------------------
router.put('/keys', async (req, res) => {
  const { provider, key } = req.body || {};

  if (!VALID_KEY_PROVIDERS.includes(provider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: `Provider must be one of: ${VALID_KEY_PROVIDER_LIST}` });
  }

  await setStoredApiKey(provider, key);
  clearProviderAvailabilityCache();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /keys/test — Validate an API key by making a minimal provider call
// ---------------------------------------------------------------------------
const testKeyRateLimit = createRateLimiter({ name: 'image-parser-test-key', limit: 5, windowMs: 60_000 });

router.post('/keys/test', testKeyRateLimit, async (req, res) => {
  const { provider, key } = req.body || {};

  if (!VALID_KEY_PROVIDERS.includes(provider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: `Provider must be one of: ${VALID_KEY_PROVIDER_LIST}` });
  }

  // Use provided key or fall back to stored key
  const apiKey = (key && typeof key === 'string' && key.trim()) ? key.trim() : await resolveApiKey(provider);
  if (!apiKey) {
    return res.status(400).json({ ok: false, code: 'NO_KEY', error: 'No API key provided and none stored for this provider' });
  }

  try {
    const result = await validateRemoteProvider(provider, apiKey);
    if (result.ok) {
      return res.json({ ok: true, provider, model: result.model || '' });
    }

    const status = result.code === 'INVALID_KEY'
      ? 401
      : result.code === 'TIMEOUT'
        ? 504
        : result.code === 'NO_KEY'
          ? 400
          : result.code === 'PROVIDER_UNAVAILABLE'
            ? 503
          : 502;

    return sendApiError(
      res,
      createApiError(result.code, result.reason || 'Provider test failed', status, { detail: result.detail || '' })
    );
  } catch (err) {
    return sendApiError(res, createApiError('PROVIDER_TEST_FAILED', err.message || 'Connection failed', 502));
  }
});

// ---------------------------------------------------------------------------
// GET /history — Paginated list of parse results (excludes parsedText)
// ---------------------------------------------------------------------------
router.get('/history', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.provider) filter.provider = req.query.provider;
  if (req.query.status) filter.status = req.query.status;

  const [rawResults, total] = await Promise.all([
    ImageParseResult.find(filter)
      .select('-parsedText')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ImageParseResult.countDocuments(filter),
  ]);
  const results = rawResults.map(attachSourceImageUrl);

  res.json({
    ok: true,
    results,
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
  });
});

// ---------------------------------------------------------------------------
// GET /history/:id/image — Source screenshot for a parse result
// ---------------------------------------------------------------------------
router.get('/history/:id/image', async (req, res) => {
  const result = await ImageParseResult.findById(req.params.id)
    .select('image.sourceFileName image.sourceContentType')
    .lean();

  if (!result) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Parse result not found' });
  }

  const file = getParserImageFile(req.params.id, result.image?.sourceFileName || '');
  if (!file.ok) {
    return res.status(404).json({ ok: false, code: 'SOURCE_IMAGE_NOT_FOUND', error: 'Source image not available for this parse result' });
  }

  if (result.image?.sourceContentType || file.contentType) {
    res.type(result.image?.sourceContentType || file.contentType);
  }
  return res.sendFile(file.filePath);
});

// ---------------------------------------------------------------------------
// GET /history/:id — Single parse result with full text
// ---------------------------------------------------------------------------
router.get('/history/:id', async (req, res) => {
  const result = await ImageParseResult.findById(req.params.id).lean();
  if (!result) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Parse result not found' });
  }
  res.json({ ok: true, result: attachSourceImageUrl(result) });
});

// ---------------------------------------------------------------------------
// GET /stats — Aggregated image parse statistics
// ---------------------------------------------------------------------------
router.get('/stats', async (req, res) => {
  const [overallAgg, byProviderAgg, byModelAgg, recentErrors] = await Promise.all([
    // Overall stats
    ImageParseResult.aggregate([
      {
        $group: {
          _id: null,
          totalParses: { $sum: 1 },
          successCount: { $sum: { $cond: [{ $eq: ['$status', 'ok'] }, 1, 0] } },
          avgElapsedMs: { $avg: '$totalElapsedMs' },
        },
      },
    ]),
    // By provider
    ImageParseResult.aggregate([
      {
        $group: {
          _id: '$provider',
          totalParses: { $sum: 1 },
          successCount: { $sum: { $cond: [{ $eq: ['$status', 'ok'] }, 1, 0] } },
          avgElapsedMs: { $avg: '$totalElapsedMs' },
          avgProviderLatencyMs: { $avg: '$providerLatencyMs' },
          avgInputTokens: { $avg: '$inputTokens' },
          avgOutputTokens: { $avg: '$outputTokens' },
        },
      },
      { $sort: { totalParses: -1 } },
      {
        $project: {
          _id: 0,
          provider: '$_id',
          totalParses: 1,
          successCount: 1,
          successRate: {
            $cond: [{ $gt: ['$totalParses', 0] }, { $divide: ['$successCount', '$totalParses'] }, 0],
          },
          avgElapsedMs: { $round: ['$avgElapsedMs', 0] },
          avgProviderLatencyMs: { $round: ['$avgProviderLatencyMs', 0] },
          avgInputTokens: { $round: ['$avgInputTokens', 0] },
          avgOutputTokens: { $round: ['$avgOutputTokens', 0] },
        },
      },
    ]),
    // By model
    ImageParseResult.aggregate([
      { $match: { model: { $ne: '' } } },
      {
        $group: {
          _id: { provider: '$provider', model: '$model' },
          totalParses: { $sum: 1 },
          successCount: { $sum: { $cond: [{ $eq: ['$status', 'ok'] }, 1, 0] } },
          avgElapsedMs: { $avg: '$totalElapsedMs' },
          avgProviderLatencyMs: { $avg: '$providerLatencyMs' },
        },
      },
      { $sort: { totalParses: -1 } },
      { $limit: 20 },
      {
        $project: {
          _id: 0,
          provider: '$_id.provider',
          model: '$_id.model',
          totalParses: 1,
          successCount: 1,
          successRate: {
            $cond: [{ $gt: ['$totalParses', 0] }, { $divide: ['$successCount', '$totalParses'] }, 0],
          },
          avgElapsedMs: { $round: ['$avgElapsedMs', 0] },
          avgProviderLatencyMs: { $round: ['$avgProviderLatencyMs', 0] },
        },
      },
    ]),
    // Recent errors
    ImageParseResult.find({ status: { $ne: 'ok' } })
      .select('-parsedText')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
  ]);

  const overall = overallAgg[0] || { totalParses: 0, successCount: 0, avgElapsedMs: 0 };
  const successRate = overall.totalParses > 0 ? overall.successCount / overall.totalParses : 0;

  res.json({
    ok: true,
    stats: {
      totalParses: overall.totalParses,
      successRate: Math.round(successRate * 10000) / 10000,
      avgElapsedMs: Math.round(overall.avgElapsedMs || 0),
      byProvider: byProviderAgg,
      byModel: byModelAgg,
      recentErrors,
    },
  });
});

module.exports = router;
