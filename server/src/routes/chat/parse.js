'use strict';

const express = require('express');
const { randomUUID } = require('node:crypto');
const Escalation = require('../../models/Escalation');
const { createRateLimiter } = require('../../middleware/rate-limit');
const { isValidProvider } = require('../../services/providers/registry');
const { parseWithPolicy } = require('../../services/parse-orchestrator');
const {
  createAiOperation,
  updateAiOperation,
  recordAiEvent,
  deleteAiOperation,
} = require('../../services/ai-runtime');
const { reportServerError } = require('../../lib/server-error-pipeline');
const { getProviderModelId } = require('../../services/providers/catalog');
const {
  createTrace,
  patchTrace,
  appendTraceEvent,
  setTraceAttempts,
  setTraceUsage,
  buildParseStage,
  buildOutcome,
} = require('../../services/ai-traces');
const {
  DEFAULT_PROVIDER,
  isValidParseMode,
  resolveParseMode,
  toParseResponseMeta,
} = require('../../services/chat-request-service');
const { logAttemptsUsage } = require('../../lib/chat-route-helpers');

const router = express.Router();
const parseRateLimit = createRateLimiter({ name: 'chat-parse', limit: 12, windowMs: 60_000 });

// POST /api/chat/parse-escalation -- Parse escalation from image/text
router.post('/parse-escalation', parseRateLimit, async (req, res) => {
  const {
    image,
    imageMeta,
    text,
    mode,
    provider, // backward-compatible alias for primaryProvider
    primaryProvider,
    fallbackProvider,
    reasoningEffort,
    timeoutMs,
    persist,
  } = req.body || {};

  if (!image && !text) {
    return res.status(400).json({ ok: false, code: 'MISSING_INPUT', error: 'Image or text required' });
  }
  if (provider !== undefined && !isValidProvider(provider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported provider' });
  }
  if (primaryProvider !== undefined && !isValidProvider(primaryProvider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported primary provider' });
  }
  if (fallbackProvider !== undefined && !isValidProvider(fallbackProvider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported fallback provider' });
  }
  if (!isValidParseMode(mode)) {
    return res.status(400).json({ ok: false, code: 'INVALID_MODE', error: 'Unsupported parse mode' });
  }

  const parseRequestId = req.requestId || randomUUID();
  const resolvedMode = resolveParseMode(mode);
  const traceStartedAt = new Date();
  const selectedProvider = primaryProvider || provider || DEFAULT_PROVIDER;
  const normalizedClientImageMeta = Array.isArray(imageMeta) ? imageMeta : [];
  const parseRuntimeOperation = createAiOperation({
    kind: 'parse',
    route: '/api/chat/parse-escalation',
    action: 'chat-parse-escalation',
    provider: selectedProvider,
    mode: resolvedMode,
    promptPreview: text || '[image parse]',
    hasImages: Boolean(image),
    messageCount: text ? 1 : 0,
    providers: [selectedProvider, fallbackProvider].filter(Boolean),
  });
  const parseRuntimeOperationId = parseRuntimeOperation.id;
  const trace = await createTrace({
    requestId: parseRequestId,
    service: 'parse',
    route: '/api/chat/parse-escalation',
    turnKind: 'parse',
    promptPreview: text || '[image parse]',
    messageLength: typeof text === 'string' ? text.length : 0,
    normalizedImages: image ? [image] : [],
    clientImageMeta: normalizedClientImageMeta,
    requested: {
      mode: resolvedMode,
      reasoningEffort,
      timeoutMs,
      primaryProvider: selectedProvider,
      fallbackProvider,
    },
    resolved: {
      mode: resolvedMode,
      reasoningEffort,
      timeoutMs,
      primaryProvider: selectedProvider,
      fallbackProvider,
    },
  }).catch(() => null);
  await appendTraceEvent(trace?._id, {
    key: 'parse_request_received',
    label: 'Parse request received',
    status: 'info',
    provider: selectedProvider,
    model: getProviderModelId(selectedProvider),
    message: image
      ? 'Received chat-side image escalation parse request.'
      : 'Received chat-side text escalation parse request.',
  }, traceStartedAt).catch(() => null);
  let parseSettled = false;
  res.on('close', () => {
    if (parseSettled) return;
    updateAiOperation(parseRuntimeOperationId, {
      clientConnected: false,
      phase: 'aborting',
    });
    patchTrace(trace?._id, {
      status: 'aborted',
      postParse: buildParseStage(
        {
          mode: resolvedMode,
          providerUsed: selectedProvider,
          attempts: [],
        },
        'error',
        {
          traceId: trace?._id,
          latencyMs: Date.now() - traceStartedAt.getTime(),
          startedAt: traceStartedAt,
          completedAt: new Date(),
        }
      ),
      outcome: buildOutcome({
        providerUsed: selectedProvider,
        modelUsed: getProviderModelId(selectedProvider),
        totalMs: Date.now() - traceStartedAt.getTime(),
        completedAt: new Date(),
        errorCode: 'CLIENT_DISCONNECTED',
        errorMessage: 'The client connection closed before parse completed.',
      }),
    }).catch(() => null);
    appendTraceEvent(trace?._id, {
      key: 'client_disconnected',
      label: 'Client disconnected',
      status: 'warning',
      provider: selectedProvider,
      model: getProviderModelId(selectedProvider),
      code: 'CLIENT_DISCONNECTED',
      message: 'The client connection closed before the parse request settled.',
    }, traceStartedAt).catch(() => null);
  });

  try {
    await appendTraceEvent(trace?._id, {
      key: 'parse_started',
      label: 'Provider parse started',
      status: 'info',
      provider: selectedProvider,
      model: getProviderModelId(selectedProvider),
      message: 'Running provider-orchestrated chat parse.',
    }, traceStartedAt).catch(() => null);
    const parseResult = await parseWithPolicy({
      image,
      text,
      mode: resolvedMode,
      primaryProvider: selectedProvider,
      fallbackProvider,
      reasoningEffort,
      timeoutMs,
      allowRegexFallback: true,
    });
    const responseMeta = toParseResponseMeta(parseResult.meta);
    await setTraceAttempts(trace?._id, parseResult.meta?.attempts || []).catch(() => null);
    await setTraceUsage(
      trace?._id,
      (responseMeta.attempts || []).find((attempt) => attempt.status === 'ok' && attempt.provider === responseMeta.providerUsed)?.usage || null
    ).catch(() => null);
    recordAiEvent(parseRuntimeOperationId, 'saving', {
      provider: responseMeta.providerUsed || selectedProvider,
    });

    let escalation = null;
    if (persist) {
      escalation = new Escalation({
        ...parseResult.fields,
        source: image ? 'screenshot' : 'chat',
        parseMeta: {
          mode: responseMeta.mode,
          providerUsed: responseMeta.providerUsed,
          winner: responseMeta.winner || responseMeta.providerUsed,
          fallbackUsed: responseMeta.fallbackUsed,
          fallbackFrom: responseMeta.fallbackFrom || '',
          validationScore: responseMeta.validation ? responseMeta.validation.score : null,
          validationConfidence: responseMeta.validation ? responseMeta.validation.confidence : '',
          validationIssues: responseMeta.validation ? responseMeta.validation.issues : [],
          usedRegexFallback: responseMeta.usedRegexFallback,
          attempts: responseMeta.attempts,
        },
      });
      await escalation.save();
      logAttemptsUsage(parseResult.meta.attempts, {
        requestId: parseRequestId,
        service: 'parse',
        escalationId: escalation._id,
        mode: resolvedMode,
      });
      await appendTraceEvent(trace?._id, {
        key: 'parse_persisted',
        label: 'Escalation persisted',
        status: 'success',
        provider: responseMeta.providerUsed || selectedProvider,
        model: getProviderModelId(responseMeta.providerUsed || selectedProvider),
        message: 'Structured parse was saved as an escalation record.',
        detail: { escalationId: escalation._id },
      }, traceStartedAt).catch(() => null);
    } else {
      logAttemptsUsage(parseResult.meta.attempts, {
        requestId: parseRequestId,
        service: 'parse',
        mode: resolvedMode,
      });
    }
    await patchTrace(trace?._id, {
      status: 'ok',
      escalationId: escalation?._id || null,
      postParse: buildParseStage(responseMeta, 'ok', {
        traceId: trace?._id,
        latencyMs: Date.now() - traceStartedAt.getTime(),
        startedAt: traceStartedAt,
        completedAt: new Date(),
        escalationId: escalation?._id || null,
      }),
      outcome: buildOutcome({
        providerUsed: responseMeta.providerUsed || selectedProvider,
        modelUsed: getProviderModelId(responseMeta.providerUsed || selectedProvider),
        winner: responseMeta.winner || responseMeta.providerUsed,
        fallbackUsed: Boolean(responseMeta.fallbackUsed),
        fallbackFrom: responseMeta.fallbackFrom || '',
        totalMs: Date.now() - traceStartedAt.getTime(),
        completedAt: new Date(),
      }),
    }).catch(() => null);
    await appendTraceEvent(trace?._id, {
      key: 'parse_completed',
      label: 'Structured parse completed',
      status: 'success',
      provider: responseMeta.providerUsed || selectedProvider,
      model: getProviderModelId(responseMeta.providerUsed || selectedProvider),
      message: 'Structured parse completed successfully.',
      detail: responseMeta.validation || null,
    }, traceStartedAt).catch(() => null);
    parseSettled = true;
    recordAiEvent(parseRuntimeOperationId, 'completed', {
      provider: responseMeta.providerUsed || selectedProvider,
    });
    deleteAiOperation(parseRuntimeOperationId);
    if (persist) {
      return res.status(201).json({
        ok: true,
        escalation: escalation.toObject(),
        _meta: responseMeta,
        traceId: trace ? trace._id.toString() : null,
      });
    }
    return res.json({
      ok: true,
      escalation: parseResult.fields,
      _meta: responseMeta,
      traceId: trace ? trace._id.toString() : null,
    });
  } catch (err) {
    if (err && Array.isArray(err.attempts)) {
      logAttemptsUsage(err.attempts, { requestId: parseRequestId, service: 'parse', mode: resolvedMode });
    }
    await setTraceAttempts(trace?._id, err && Array.isArray(err.attempts) ? err.attempts : []).catch(() => null);
    await patchTrace(trace?._id, {
      status: 'error',
      postParse: buildParseStage(
        {
          mode: resolvedMode,
          providerUsed: selectedProvider,
          attempts: err && Array.isArray(err.attempts) ? err.attempts : [],
        },
        'error',
        {
          traceId: trace?._id,
          latencyMs: Date.now() - traceStartedAt.getTime(),
          startedAt: traceStartedAt,
          completedAt: new Date(),
        }
      ),
      outcome: buildOutcome({
        providerUsed: selectedProvider,
        modelUsed: getProviderModelId(selectedProvider),
        totalMs: Date.now() - traceStartedAt.getTime(),
        completedAt: new Date(),
        errorCode: err && err.code ? err.code : 'PARSE_FAILED',
        errorMessage: err && err.message ? err.message : 'Failed to parse escalation',
      }),
    }).catch(() => null);
    await appendTraceEvent(trace?._id, {
      key: 'parse_failed',
      label: 'Structured parse failed',
      status: 'error',
      provider: selectedProvider,
      model: getProviderModelId(selectedProvider),
      code: err && err.code ? err.code : 'PARSE_FAILED',
      message: err && err.message ? err.message : 'Failed to parse escalation',
      detail: { attempts: err && Array.isArray(err.attempts) ? err.attempts : [] },
    }, traceStartedAt).catch(() => null);
    parseSettled = true;
    recordAiEvent(parseRuntimeOperationId, 'error', {
      provider: selectedProvider,
      lastError: {
        code: err && err.code ? err.code : 'PARSE_FAILED',
        message: err && err.message ? err.message : 'Failed to parse escalation',
        detail: '',
      },
    });
    reportServerError({
      route: '/api/chat/parse-escalation',
      message: err && err.message ? err.message : 'Failed to parse escalation',
      code: err && err.code ? err.code : 'PARSE_FAILED',
      detail: err && err.stack ? err.stack : '',
      severity: 'error',
    });
    deleteAiOperation(parseRuntimeOperationId);
    const code = err && err.code ? err.code : 'PARSE_FAILED';
    const status = code === 'PARSE_FAILED' ? 422 : 500;
    return res.status(status).json({
      ok: false,
      code,
      error: err && err.message ? err.message : 'Failed to parse escalation',
      attempts: err && Array.isArray(err.attempts) ? err.attempts : [],
      traceId: trace ? trace._id.toString() : null,
    });
  }
});

module.exports = router;
