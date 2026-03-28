'use strict';

const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { createRateLimiter } = require('../middleware/rate-limit');
const {
  parseImage,
  checkProviderAvailability,
  clearProviderAvailabilityCache,
  getApiKey,
  KEYS_FILE,
} = require('../services/image-parser');
const ImageParseResult = require('../models/ImageParseResult');

const router = express.Router();
const VALID_PARSE_PROVIDERS = ['lm-studio', 'anthropic', 'openai', 'kimi', 'gemini'];
const VALID_KEY_PROVIDERS = ['anthropic', 'openai', 'kimi', 'gemini'];
const VALID_PARSE_PROVIDER_LIST = VALID_PARSE_PROVIDERS.join(', ');
const VALID_KEY_PROVIDER_LIST = VALID_KEY_PROVIDERS.join(', ');

// Rate limit: 10 requests per 60s for parse endpoint
const parseRateLimit = createRateLimiter({ name: 'image-parser', limit: 10, windowMs: 60_000 });

// ---------------------------------------------------------------------------
// POST /parse — Parse an escalation screenshot or INV list image
// ---------------------------------------------------------------------------
router.post('/parse', parseRateLimit, async (req, res) => {
  const { image, provider, model, timeoutMs } = req.body || {};

  // Validate required fields
  if (!image) {
    return res.status(400).json({ ok: false, code: 'MISSING_IMAGE', error: 'Image required' });
  }
  if (!VALID_PARSE_PROVIDERS.includes(provider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: `Provider must be one of: ${VALID_PARSE_PROVIDER_LIST}` });
  }

  // Override middleware timeout — provider timeout + generous buffer.
  // Vision model inference can take 30-90s depending on model/provider.
  // Local models (LM Studio) need much longer — reasoning models processing
  // images can easily exceed 60s, so default to 180s for lm-studio.
  // The global responseTimeout is 30s, so we MUST re-arm before doing any work.
  const isLocal = provider === 'lm-studio';
  const maxTimeout = isLocal ? 300_000 : 120_000;
  const defaultTimeout = isLocal ? 180_000 : 60_000;
  const effectiveTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, maxTimeout) : defaultTimeout;
  if (typeof req.setResponseTimeout === 'function') {
    req.setResponseTimeout(effectiveTimeout + 30_000);
  }

  const startedAt = Date.now();

  // --- DEBUG LOGGING (temporary) ---
  const bodySize = JSON.stringify(req.body).length;
  const imageLen = (image || '').length;
  console.log('[image-parser-debug] Incoming request:', {
    provider,
    model: model || '(default)',
    timeoutMs: effectiveTimeout,
    bodySize,
    imageLength: imageLen,
    imagePrefix: (image || '').slice(0, 120),
  });
  // --- END DEBUG ---

  try {
    const result = await parseImage(image, { provider, model, timeoutMs: effectiveTimeout });
    const elapsedMs = Date.now() - startedAt;
    console.log('[image-parser-debug] Parse succeeded:', {
      elapsedMs,
      textLength: (result.text || '').length,
      textPreview: (result.text || '').slice(0, 200),
      role: result.role,
      usage: result.usage,
    });

    // Fire-and-forget save to MongoDB
    console.log('[image-parser-save] Saving parse result:', { provider, status: 'ok', model: result.usage?.model });
    ImageParseResult.create({
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
      parsedText: result.text || '',
      textLength: (result.text || '').length,
      source: 'panel',
    }).catch(err => console.error('[image-parser-save] FAILED to save:', err.message));

    res.json({ ok: true, ...result, elapsedMs });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const status = err.code === 'PROVIDER_UNAVAILABLE' ? 503
      : err.code === 'TIMEOUT' ? 504
      : err.code === 'PROVIDER_ERROR' ? 422
      : 422;
    console.error('[image-parser-debug] Parse error:', {
      code: err.code || 'UNKNOWN',
      message: err.message,
      stack: (err.stack || '').split('\n').slice(0, 5).join('\n'),
    });

    // Fire-and-forget save error to MongoDB
    ImageParseResult.create({
      provider,
      modelRequested: model || '',
      totalElapsedMs: elapsedMs,
      status: err.message?.includes('timed out') ? 'timeout' : 'error',
      errorCode: err.code || 'UNKNOWN',
      errorMsg: err.message || '',
      source: 'panel',
    }).catch(saveErr => console.error('[image-parser] Failed to save error result:', saveErr.message));

    res.status(status).json({ ok: false, code: err.code || 'PARSE_FAILED', error: err.message || 'Image parse failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /status — Check provider availability
// ---------------------------------------------------------------------------
router.get('/status', async (req, res) => {
  const providers = await checkProviderAvailability();
  res.json({ ok: true, providers });
});

// ---------------------------------------------------------------------------
// GET /keys — Check which providers have stored API keys
// ---------------------------------------------------------------------------
router.get('/keys', async (req, res) => {
  let stored = {};
  try {
    const raw = fs.readFileSync(KEYS_FILE, 'utf8');
    stored = JSON.parse(raw);
  } catch {
    // File doesn't exist or is invalid — all keys absent
  }

  res.json({
    ok: true,
    keys: {
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

  // Ensure data directory exists
  const dataDir = path.dirname(KEYS_FILE);
  fs.mkdirSync(dataDir, { recursive: true });

  // Read existing keys
  let stored = {};
  try {
    const raw = fs.readFileSync(KEYS_FILE, 'utf8');
    stored = JSON.parse(raw);
  } catch {
    // Start fresh
  }

  // Set or remove key
  if (key && typeof key === 'string' && key.trim()) {
    stored[provider] = key.trim();
  } else {
    delete stored[provider];
  }

  fs.writeFileSync(KEYS_FILE, JSON.stringify(stored, null, 2), 'utf8');
  clearProviderAvailabilityCache();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /keys/test — Validate an API key by making a minimal provider call
// ---------------------------------------------------------------------------
const testKeyRateLimit = createRateLimiter({ name: 'image-parser-test-key', limit: 5, windowMs: 60_000 });

const TEST_CONFIGS = {
  anthropic: {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    model: 'claude-sonnet-4-20250514',
    buildBody: (model) => JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    buildHeaders: (key) => ({
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    }),
  },
  openai: {
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    model: 'gpt-4o-mini',
    buildBody: (model) => JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    buildHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    }),
  },
  kimi: {
    hostname: 'api.moonshot.ai',
    path: '/v1/chat/completions',
    model: 'kimi-k2.5',
    buildBody: (model) => JSON.stringify({ model, max_tokens: 1, temperature: 1, messages: [{ role: 'user', content: 'hi' }] }),
    buildHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    }),
  },
  gemini: {
    hostname: 'generativelanguage.googleapis.com',
    path: '/v1beta/models/gemini-3-flash-preview:generateContent',
    model: 'gemini-3-flash-preview',
    buildBody: () => JSON.stringify({
      contents: [{ parts: [{ text: 'hi' }] }],
      generationConfig: { maxOutputTokens: 1, responseMimeType: 'text/plain' },
    }),
    buildHeaders: (key) => ({
      'x-goog-api-key': key,
      'Content-Type': 'application/json',
    }),
  },
};

function testProviderKey(provider, apiKey) {
  const cfg = TEST_CONFIGS[provider];
  const payload = cfg.buildBody(cfg.model);
  const headers = cfg.buildHeaders(apiKey);
  headers['Content-Length'] = Buffer.byteLength(payload);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: cfg.hostname,
      port: 443,
      path: cfg.path,
      method: 'POST',
      headers,
      timeout: 10_000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      const err = new Error('Request timed out');
      err.code = 'TIMEOUT';
      reject(err);
    });
    req.write(payload);
    req.end();
  });
}

function extractProviderErrorMessage(body, fallback) {
  try {
    const parsed = JSON.parse(body);
    return parsed.error?.message
      || parsed.error?.status
      || parsed.message
      || fallback;
  } catch {
    return fallback;
  }
}

router.post('/keys/test', testKeyRateLimit, async (req, res) => {
  const { provider, key } = req.body || {};

  if (!VALID_KEY_PROVIDERS.includes(provider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: `Provider must be one of: ${VALID_KEY_PROVIDER_LIST}` });
  }

  // Use provided key or fall back to stored key
  const apiKey = (key && typeof key === 'string' && key.trim()) ? key.trim() : getApiKey(provider);
  if (!apiKey) {
    return res.status(400).json({ ok: false, code: 'NO_KEY', error: 'No API key provided and none stored for this provider' });
  }

  try {
    const result = await testProviderKey(provider, apiKey);
    const cfg = TEST_CONFIGS[provider];

    if (result.statusCode >= 200 && result.statusCode < 300) {
      return res.json({ ok: true, provider, model: cfg.model });
    }
    // Other error — try to extract a message from the response
    const fallback = result.statusCode === 401
      ? 'Invalid API key'
      : `Provider returned HTTP ${result.statusCode}`;
    const errorMsg = extractProviderErrorMessage(result.body, fallback);
    return res.json({ ok: false, error: errorMsg });
  } catch (err) {
    if (err.code === 'TIMEOUT') {
      return res.json({ ok: false, error: 'Connection to provider timed out' });
    }
    return res.json({ ok: false, error: err.message || 'Connection failed' });
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

  const [results, total] = await Promise.all([
    ImageParseResult.find(filter)
      .select('-parsedText')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ImageParseResult.countDocuments(filter),
  ]);

  res.json({
    ok: true,
    results,
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
  });
});

// ---------------------------------------------------------------------------
// GET /history/:id — Single parse result with full text
// ---------------------------------------------------------------------------
router.get('/history/:id', async (req, res) => {
  const result = await ImageParseResult.findById(req.params.id).lean();
  if (!result) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Parse result not found' });
  }
  res.json({ ok: true, result });
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
