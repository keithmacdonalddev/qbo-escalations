'use strict';

const express = require('express');
const { randomUUID } = require('node:crypto');
const { createRateLimiter } = require('../middleware/rate-limit');
const {
  parseImage,
  checkProviderAvailability,
  checkProviderPackageStoreHealth,
  clearProviderAvailabilityCache,
  normalizeImageParsePromptId,
  resolveApiKey,
  getAllStoredKeys,
  setStoredApiKey,
  validateRemoteProvider,
  VALID_IMAGE_PARSER_PROVIDERS,
} = require('../services/image-parser');
const { createStageEventBus, createNoopStageEventBus } = require('../lib/stage-events');
const ImageParseResult = require('../models/ImageParseResult');
const {
  archiveParserImage,
  getParserImageFile,
} = require('../lib/image-parser-archive');
const { createApiError, sendApiError } = require('../lib/api-errors');

const router = express.Router();
const IMAGE_PARSER_VERBOSE_LOGS = process.env.IMAGE_PARSER_VERBOSE_LOGS === '1';
const VALID_PARSE_PROVIDERS = VALID_IMAGE_PARSER_PROVIDERS;
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

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parserIssueToText(issue) {
  if (typeof issue === 'string') return issue;
  if (!isPlainObject(issue)) return '';
  return [issue.code, issue.message].filter(Boolean).join(': ');
}

function buildParserValidationRecord(parseMeta) {
  const meta = isPlainObject(parseMeta) ? parseMeta : {};
  const canonical = isPlainObject(meta.canonicalTemplate) ? meta.canonicalTemplate : {};
  const fieldsFound = Number(meta.fieldsFound);

  return {
    validationPassed: typeof meta.passed === 'boolean' ? meta.passed : null,
    canonicalPassed: typeof canonical.passed === 'boolean' ? canonical.passed : null,
    semanticPassed: typeof meta.semanticPassed === 'boolean' ? meta.semanticPassed : null,
    parserIssues: Array.isArray(meta.issues)
      ? meta.issues.map(parserIssueToText).filter(Boolean)
      : [],
    canonicalIssues: Array.isArray(canonical.issues) ? canonical.issues : [],
    fieldsFound: Number.isFinite(fieldsFound) ? fieldsFound : 0,
  };
}

function persistParseResult(record, sourceImage, onArchived) {
  return (async () => {
    if (!ImageParseResult.db || ImageParseResult.db.readyState !== 1) {
      return;
    }
    try {
      const saved = await ImageParseResult.create(record);
      const archived = archiveParserImage(saved._id, sourceImage);
      if (!archived.ok) {
        verboseWarn('[image-parser-save] Source image archive failed:', archived.error);
        if (typeof onArchived === 'function') {
          try { onArchived({ ok: false, error: archived.error || 'archive_failed' }); } catch { /* noop */ }
        }
        return;
      }

      saved.set('image.sourceFileName', archived.fileName);
      saved.set('image.sourceContentType', archived.contentType);
      saved.set('image.sourceSizeBytes', archived.sizeBytes);
      saved.set('image.sourceStoredAt', new Date());
      await saved.save();
      if (typeof onArchived === 'function') {
        try {
          onArchived({
            ok: true,
            id: saved._id ? String(saved._id) : '',
            sizeBytes: archived.sizeBytes || 0,
            contentType: archived.contentType || '',
          });
        } catch { /* noop */ }
      }
    } catch (err) {
      verboseError('[image-parser-save] FAILED to save:', err.message);
      if (typeof onArchived === 'function') {
        try { onArchived({ ok: false, error: err.message || 'save_failed' }); } catch { /* noop */ }
      }
    }
  })();
}

// Rate limit: 10 requests per 60s for parse endpoint
const parseRateLimit = createRateLimiter({ name: 'image-parser', limit: 10, windowMs: 60_000 });

function clientWantsSse(req) {
  const accept = String(req.headers?.accept || '').toLowerCase();
  if (accept.includes('text/event-stream')) return true;
  const streamQ = String(req.query?.stream || '').toLowerCase();
  return streamQ === '1' || streamQ === 'true' || streamQ === 'yes';
}

// ---------------------------------------------------------------------------
// POST /parse — Parse an escalation screenshot or INV list image
//
// Two response modes share the same code path:
//   - default JSON: existing callers (ImageParserPanel) get { ok, text, ... }
//   - SSE (when Accept: text/event-stream or ?stream=1): the same final result
//     is delivered via an `event: parse_complete` frame, preceded by a live
//     stream of `event: stage_event` frames for the parser pipeline.
// ---------------------------------------------------------------------------
router.post('/parse', parseRateLimit, async (req, res) => {
  // Request body shape:
  //   image, provider, model, reasoningEffort, serviceTier, timeoutMs, promptId,
  //   parserPromptId — standard parse fields (existing).
  //   useAnthropicSdk (optional legacy boolean, default false) — when provider
  //   is 'anthropic', true uses the old Agent SDK adapter. The default path is
  //   the direct Anthropic API provider harness with package capture.
  const { image, provider, model, reasoningEffort, serviceTier, timeoutMs, promptId, parserPromptId, useAnthropicSdk, fallbackProvider, fallbackModel, agentRuntime } = req.body || {};
  const streamMode = clientWantsSse(req);
  const runId = randomUUID();

  // SSE writer — set headers once, then push framed events. Falls back to a
  // no-op writer for the JSON path so the bus call sites can stay uniform.
  let sseOpen = false;
  function sendSse(eventName, payload) {
    if (!sseOpen) return;
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch { /* client disconnected */ }
  }
  function openSse() {
    if (sseOpen || res.headersSent) return;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    sseOpen = true;
  }
  if (streamMode) openSse();
  const bus = streamMode
    ? createStageEventBus({ send: sendSse, stageId: 'parser', runId })
    : createNoopStageEventBus();

  function respondJson(status, body) {
    if (!streamMode) {
      return res.status(status).json(body);
    }
    // SSE branch: send a final terminal frame and close. The HTTP status code
    // for SSE is always 200 (already written); body.code/error signal failure.
    try {
      res.write(`event: parse_complete\ndata: ${JSON.stringify(body)}\n\n`);
      res.end();
    } catch { /* client gone */ }
    return undefined;
  }

  bus.emit('parser.server_request_received', {
    provider: typeof provider === 'string' ? provider : '',
    model: typeof model === 'string' ? model : '',
    streamMode,
  });

  // Validate required fields
  if (!image) {
    bus.emit('error', { code: 'MISSING_IMAGE', message: 'Image required' });
    return respondJson(400, { ok: false, code: 'MISSING_IMAGE', error: 'Image required' });
  }
  if (!VALID_PARSE_PROVIDERS.includes(provider)) {
    bus.emit('error', {
      code: 'INVALID_PROVIDER',
      message: `Provider must be one of: ${VALID_PARSE_PROVIDER_LIST}`,
    });
    return respondJson(400, { ok: false, code: 'INVALID_PROVIDER', error: `Provider must be one of: ${VALID_PARSE_PROVIDER_LIST}` });
  }
  bus.emit('parser.request_validated', {
    provider,
    model: model || '',
    reasoningEffort: reasoningEffort || '',
    serviceTier: serviceTier || '',
    imageBytes: typeof image === 'string' ? image.length : 0,
  });

  // Default to the full parser ceiling; Codex vision runs can finish just
  // past 60s on larger screenshots. Keep the cap at 120s and give the
  // response timeout a 10s buffer.
  const maxTimeout = 120_000;
  const defaultTimeout = 120_000;
  const effectiveTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, maxTimeout) : defaultTimeout;
  if (typeof req.setResponseTimeout === 'function') {
    req.setResponseTimeout(effectiveTimeout + 10_000);
  }
  bus.emit('parser.timeout_resolved', {
    requestedMs: Number.isFinite(timeoutMs) ? timeoutMs : null,
    effectiveMs: effectiveTimeout,
    maxMs: maxTimeout,
  });

  const startedAt = Date.now();
  const effectivePromptId = normalizeImageParsePromptId(promptId || parserPromptId);

  try {
    const result = await parseImage(image, {
      provider,
      model,
      reasoningEffort,
      serviceTier,
      timeoutMs: effectiveTimeout,
      promptId: effectivePromptId,
      eventBus: bus,
      useAnthropicSdk: useAnthropicSdk === true,
      // Wave 2 universal failover: pass the operator's backup through so the
      // parser can fail over on a primary-provider failure. An explicit
      // request-body fallbackProvider wins; agentRuntime (the agent profile
      // selection) is the source of truth otherwise; parseImage defaults to the
      // neutral global alternate when neither is set. No capability filtering.
      fallbackProvider: typeof fallbackProvider === 'string' ? fallbackProvider : '',
      fallbackModel: typeof fallbackModel === 'string' ? fallbackModel : '',
      agentRuntime: agentRuntime && typeof agentRuntime === 'object' ? agentRuntime : null,
    });
    const elapsedMs = Date.now() - startedAt;

    const responseBody = {
      ok: true,
      ...result,
      promptId: result.promptId || effectivePromptId,
      meta: result.stats?.image,
      parseFields: result.parseFields || {},
      elapsedMs,
    };
    // After an automatic failover, result.providerUsed is the backup that
    // actually produced the parse; fall back to the requested provider otherwise.
    const providerUsed = result.providerUsed || provider;
    bus.emit('parser.result_built', {
      elapsedMs,
      providerLatencyMs: result.stats?.providerLatencyMs || 0,
      textLength: (result.text || '').length,
      role: result.role || '',
      parseFieldCount: result.parseFields ? Object.keys(result.parseFields).length : 0,
      providerPackageId: result.providerTrace?.providerPackageId || null,
      providerHarness: result.providerTrace?.providerHarness || null,
      providerUsed,
      fallbackUsed: Boolean(result.fallbackUsed),
      fallbackFrom: result.fallbackFrom || '',
    });

    // Fire-and-forget save to MongoDB + on-disk image archive
    bus.emit('parser.result_save_started', {
      provider,
      model: result.usage?.model || model || '',
      role: result.role || '',
    });
    persistParseResult({
      provider: providerUsed,
      model: result.usage?.model || result.modelUsed || model || '',
      modelRequested: model || '',
      fallbackUsed: Boolean(result.fallbackUsed),
      fallbackFrom: result.fallbackFrom || '',
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
      parseFields: result.parseFields || {},
      parseMeta: result.parseMeta || null,
      ...buildParserValidationRecord(result.parseMeta),
      source: 'panel',
      providerTrace: result.providerTrace || null,
    }, image, (archived) => {
      if (archived?.ok) {
        bus.emit('parser.source_image_archived', {
          id: archived.id || '',
          sizeBytes: archived.sizeBytes || 0,
          contentType: archived.contentType || '',
        });
      } else if (archived) {
        bus.emit('parser.source_image_archived', {
          ok: false,
          error: archived.error || 'archive_failed',
        });
      }
    });

    if (streamMode) {
      if (result.providerTrace?.providerPackageId) {
        bus.emit('parser.provider_content_sending_to_client', {
          provider,
          providerPackageId: result.providerTrace.providerPackageId,
          status: 'sent',
          surfaceToUser: true,
          displayMessage: `Sending providerPackageId: ${result.providerTrace.providerPackageId} content to client - sent`,
        });
      }
      bus.emit('parser.response_sent', {
        elapsedMs,
        bytes: 0,
        streamMode: true,
      });
      return respondJson(200, responseBody);
    }

    if (result.providerTrace?.providerPackageId) {
      bus.emit('parser.provider_content_sending_to_client', {
        provider,
        providerPackageId: result.providerTrace.providerPackageId,
        status: 'sent',
        surfaceToUser: true,
        displayMessage: `Sending providerPackageId: ${result.providerTrace.providerPackageId} content to client - sent`,
      });
    }
    res.json(responseBody);
    bus.emit('parser.response_sent', {
      elapsedMs,
      bytes: 0,
      streamMode: false,
    });
    return undefined;
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const status = err.code === 'PROVIDER_UNAVAILABLE' ? 503
      : err.code === 'TIMEOUT' || err.code === 'PROVIDER_TIMEOUT' ? 504
      : err.code === 'PROVIDER_PACKAGE_LOAD_TIMEOUT' ? 504
      : err.code === 'PROVIDER_PACKAGE_MONGO_UNAVAILABLE' ? 503
      : err.code === 'PROVIDER_PACKAGE_CAPTURE_FAILED' ? 502
      : err.code === 'PROVIDER_ERROR' ? 422
      : 422;
    bus.emit('error', {
      code: err.code || 'PARSE_FAILED',
      message: err.message || 'Image parse failed',
      providerPackageId: err.providerTrace?.providerPackageId || null,
      providerHarness: err.providerTrace?.providerHarness || null,
      captureMode: err.captureMode || err.providerTrace?.captureMode || null,
      packageCaptureStatus: err.providerTrace?.packageCaptureStatus || null,
      packageReadbackStatus: err.providerTrace?.packageReadbackStatus || null,
      surfaceToUser: true,
      displayMessage: err.message || 'Image parse failed',
    });

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
      providerTrace: err.providerTrace || null,
    }, image, (archived) => {
      if (archived?.ok) {
        bus.emit('parser.source_image_archived', {
          id: archived.id || '',
          sizeBytes: archived.sizeBytes || 0,
          contentType: archived.contentType || '',
        });
      }
    });

    return respondJson(status, {
      ok: false,
      code: err.code || 'PARSE_FAILED',
      error: err.message || 'Image parse failed',
      captureMode: err.captureMode || err.providerTrace?.captureMode || null,
      providerTrace: err.providerTrace || null,
    });
  }
});

// ---------------------------------------------------------------------------
// GET /status — Check provider availability
// ---------------------------------------------------------------------------
router.get('/status', async (req, res) => {
  const refreshRaw = String(req.query?.refresh || req.query?.forceRefresh || '').toLowerCase();
  const forceRefresh = refreshRaw === '1' || refreshRaw === 'true' || refreshRaw === 'yes';
  const [providers, packageStore] = await Promise.all([
    checkProviderAvailability({ forceRefresh }),
    checkProviderPackageStoreHealth(),
  ]);
  res.json({ ok: true, providers, packageStore });
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
