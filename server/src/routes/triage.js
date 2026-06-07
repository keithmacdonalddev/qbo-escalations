'use strict';

const express = require('express');
const { randomUUID } = require('node:crypto');
const { createRateLimiter } = require('../middleware/rate-limit');
const { createStageEventBus, createNoopStageEventBus } = require('../lib/stage-events');
const { buildFallbackTriageCard } = require('../lib/chat-triage');
const {
  DIRECT_TRIAGE_PROVIDERS,
  runTriage,
} = require('../services/triage');

const router = express.Router();
const triageRateLimit = createRateLimiter({ name: 'triage', limit: 20, windowMs: 60_000 });
const DEFAULT_TIMEOUT_MS = 120_000;

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function clientWantsSse(req) {
  const accept = safeString(req.headers?.accept, '').toLowerCase();
  if (accept.includes('text/event-stream')) return true;
  const streamQ = safeString(req.query?.stream, '').toLowerCase();
  return streamQ === '1' || streamQ === 'true' || streamQ === 'yes';
}

router.post('/', triageRateLimit, async (req, res) => {
  const {
    text,
    provider,
    model,
    reasoningEffort,
    serviceTier,
    timeoutMs,
    fallbackProvider,
    fallbackModel,
    agentRuntime,
  } = req.body || {};
  const streamMode = clientWantsSse(req);
  const runId = randomUUID();
  const effectiveTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.min(Number(timeoutMs), 180_000)
    : DEFAULT_TIMEOUT_MS;

  if (typeof req.setResponseTimeout === 'function') {
    req.setResponseTimeout(effectiveTimeout + 10_000);
  }

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
    ? createStageEventBus({ send: sendSse, stageId: 'triage', runId })
    : createNoopStageEventBus();

  function respond(status, body) {
    if (!streamMode) {
      return res.status(status).json(body);
    }
    try {
      res.write(`event: triage_complete\ndata: ${JSON.stringify(body)}\n\n`);
      res.end();
    } catch { /* client gone */ }
    return undefined;
  }

  bus.emit('triage.server_request_received', {
    provider: safeString(provider, ''),
    model: safeString(model, ''),
    streamMode,
  });

  const cleanText = safeString(text, '').trim();
  if (!cleanText) {
    const fallbackCard = buildFallbackTriageCard();
    bus.emit('error', {
      code: 'MISSING_TEXT',
      message: 'Escalation template text is required',
      surfaceToUser: true,
      displayMessage: 'Escalation template text is required',
    });
    const body = {
      ok: false,
      code: 'MISSING_TEXT',
      error: 'Escalation template text is required',
      fallbackCard,
    };
    return respond(400, body);
  }

  const startedAt = Date.now();
  try {
    const result = await runTriage(cleanText, {
      runId,
      provider: safeString(provider, ''),
      model: safeString(model, ''),
      reasoningEffort: safeString(reasoningEffort, ''),
      serviceTier: safeString(serviceTier, ''),
      timeoutMs: effectiveTimeout,
      eventBus: bus,
      // Wave 2 universal failover: pass the operator's backup through so triage
      // can fail over on a primary-provider failure before the deterministic
      // rule-card fallback. Request-body fallbackProvider wins; agentRuntime
      // (the agent profile selection) is the source of truth otherwise; runTriage
      // defaults to the neutral global alternate when neither is set. No
      // capability filtering.
      fallbackProvider: safeString(fallbackProvider, ''),
      fallbackModel: safeString(fallbackModel, ''),
      agentRuntime: agentRuntime && typeof agentRuntime === 'object' ? agentRuntime : null,
    });
    const elapsedMs = result.elapsedMs ?? (Date.now() - startedAt);
    const body = {
      ok: true,
      card: result.card,
      triageCard: result.card,
      triageMeta: result.triageMeta,
      rawOutput: result.rawOutput || '',
      providerUsed: result.providerUsed || safeString(provider, ''),
      modelUsed: result.modelUsed || safeString(model, ''),
      fallbackUsed: Boolean(result.fallbackUsed),
      fallbackFrom: result.fallbackFrom || '',
      elapsedMs,
      status: result.status || 'success',
      savedResultId: result.savedResult?.id || result.triageMeta?.resultId || '',
    };
    if (result.triageMeta?.providerPackageId) {
      bus.emit('triage.provider_content_sending_to_client', {
        provider: body.providerUsed,
        providerPackageId: result.triageMeta.providerPackageId,
        status: 'sent',
        surfaceToUser: true,
        displayMessage: `Sending providerPackageId: ${result.triageMeta.providerPackageId} triage content to client - sent`,
      });
    }
    bus.emit('triage.response_sent', {
      elapsedMs,
      streamMode,
      source: result.triageMeta?.source || '',
      fallbackUsed: Boolean(result.triageMeta?.fallbackUsed || result.card?.fallback?.used),
    });
    bus.emit('stage.completed', {
      status: result.status === 'degraded' ? 'degraded' : 'success',
      durationMs: elapsedMs,
      provider: body.providerUsed,
      model: body.modelUsed,
      // A provider-to-provider failover (primary failed, backup produced the
      // result) OR a deterministic rule-card fallback both count as "fallback".
      fallbackUsed: Boolean(result.fallbackUsed || result.triageMeta?.fallbackUsed || result.card?.fallback?.used),
      fallbackFrom: result.fallbackFrom || '',
    });
    return respond(200, body);
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const fallbackCard = err?.fallbackCard || buildFallbackTriageCard();
    bus.emit('error', {
      code: err?.code || 'TRIAGE_FAILED',
      message: err?.message || 'Triage failed',
      surfaceToUser: true,
      displayMessage: err?.message || 'Triage failed',
    });
    bus.emit('triage.response_sent', {
      elapsedMs,
      streamMode,
      source: 'error',
      fallbackUsed: Boolean(fallbackCard),
    });
    return respond(err?.code === 'MISSING_TEXT' ? 400 : 500, {
      ok: false,
      code: err?.code || 'TRIAGE_FAILED',
      error: err?.message || 'Triage failed',
      fallbackCard,
      elapsedMs,
    });
  }
});

router.get('/status', (_req, res) => {
  res.json({
    ok: true,
    providers: DIRECT_TRIAGE_PROVIDERS,
  });
});

module.exports = router;
