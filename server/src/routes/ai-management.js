'use strict';

const express = require('express');
const { createRateLimiter } = require('../middleware/rate-limit');
const {
  MANAGED_PROVIDER_IDS,
  buildModelReleaseReviewPacket,
  clearProviderConnectionTestResult,
  getAgentUsageSnapshot,
  getManagementSnapshot,
  recordConnectionTestResults,
  recordProviderConnectionTestResult,
  refreshProviderModels,
  reviewNotification,
  updateModelPolicy,
  updateProviderPolicy,
  updateSettings,
} = require('../services/ai-management');
const {
  clearProviderAvailabilityCache,
  checkProviderAvailability,
  getAllStoredKeys,
  resolveApiKey,
  setStoredApiKey,
  validateRemoteProvider,
} = require('../services/image-parser');
const {
  ProviderSpendingError,
  getProviderSpendingSnapshot,
  refreshProviderSpending,
  setStoredReportingKey,
} = require('../services/provider-spending');

const router = express.Router();
const KEY_PROVIDER_IDS = Object.freeze(['llm-gateway', 'anthropic', 'openai', 'kimi', 'gemini']);
const KEY_ENVIRONMENT_VARIABLES = Object.freeze({
  'llm-gateway': 'LLM_GATEWAY_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  kimi: 'MOONSHOT_API_KEY',
  gemini: 'GEMINI_API_KEY',
});

function sendKnownError(res, err) {
  if (err instanceof ProviderSpendingError) {
    return res.status(err.status).json({
      ok: false,
      code: err.code,
      error: err.message,
    });
  }
  const status = ['INVALID_PROVIDER', 'INVALID_MODEL', 'INVALID_SCHEDULE', 'INVALID_NOTIFICATION'].includes(err?.code) ? 400
    : err?.code === 'MODEL_VALIDATION_REQUIRED' || err?.code === 'MODEL_CATALOG_RELEASE_REQUIRED' ? 409
      : 500;
  return res.status(status).json({
    ok: false,
    code: err?.code || 'AI_MANAGEMENT_FAILED',
    error: status >= 500 ? 'AI management request failed.' : err.message,
  });
}

function assertKeyProvider(providerId) {
  const normalized = String(providerId || '').trim();
  if (!KEY_PROVIDER_IDS.includes(normalized)) {
    const err = new Error(`API keys are not managed for provider: ${normalized || '(empty)'}`);
    err.code = 'INVALID_PROVIDER';
    throw err;
  }
  return normalized;
}

async function getKeyStatus() {
  const stored = await getAllStoredKeys();
  return Object.fromEntries(KEY_PROVIDER_IDS.map((providerId) => {
    const hasStored = Boolean(typeof stored[providerId] === 'string' && stored[providerId].trim());
    const environmentVariable = KEY_ENVIRONMENT_VARIABLES[providerId];
    const hasEnvironment = Boolean(environmentVariable && String(process.env[environmentVariable] || '').trim());
    return [providerId, {
      configured: hasStored || hasEnvironment,
      source: hasStored ? 'saved' : hasEnvironment ? 'environment' : 'missing',
      environmentVariable,
    }];
  }));
}

async function buildResponse(extra = {}) {
  return {
    ok: true,
    catalog: getManagementSnapshot(),
    keys: await getKeyStatus(),
    ...extra,
  };
}

router.get('/', async (req, res) => {
  res.json(await buildResponse());
});

router.put('/settings', async (req, res) => {
  try {
    updateSettings(req.body || {});
    res.json(await buildResponse());
  } catch (err) {
    sendKnownError(res, err);
  }
});

router.put('/providers/:providerId', async (req, res) => {
  try {
    updateProviderPolicy(req.params.providerId, req.body || {});
    res.json(await buildResponse());
  } catch (err) {
    sendKnownError(res, err);
  }
});

router.put('/models', async (req, res) => {
  try {
    const { providerId, modelId, ...patch } = req.body || {};
    updateModelPolicy(providerId, modelId, patch);
    res.json(await buildResponse());
  } catch (err) {
    sendKnownError(res, err);
  }
});

const refreshRateLimit = createRateLimiter({ name: 'ai-model-discovery', limit: 6, windowMs: 60_000 });
router.post('/refresh', refreshRateLimit, async (req, res) => {
  try {
    const requested = Array.isArray(req.body?.providerIds)
      ? req.body.providerIds
      : MANAGED_PROVIDER_IDS;
    const result = await refreshProviderModels(requested);
    res.json(await buildResponse({ results: result.results }));
  } catch (err) {
    sendKnownError(res, err);
  }
});

router.get('/usage', async (req, res) => {
  try {
    const usage = await getAgentUsageSnapshot();
    res.json({ ok: true, usage });
  } catch (err) {
    sendKnownError(res, err);
  }
});

router.get('/spending/:providerId', async (req, res) => {
  try {
    const spending = await getProviderSpendingSnapshot(req.params.providerId);
    res.json({ ok: true, spending });
  } catch (err) {
    sendKnownError(res, err);
  }
});

const spendingRefreshRateLimit = createRateLimiter({ name: 'ai-management-provider-spending', limit: 6, windowMs: 60_000 });
router.post('/spending/:providerId/refresh', spendingRefreshRateLimit, async (req, res) => {
  try {
    const spending = await refreshProviderSpending(req.params.providerId);
    res.json({ ok: true, spending });
  } catch (err) {
    sendKnownError(res, err);
  }
});

router.put('/spending/:providerId/credential', async (req, res) => {
  try {
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    if (!key) {
      return res.status(400).json({ ok: false, code: 'REPORTING_KEY_REQUIRED', error: 'Enter a reporting key to save.' });
    }
    setStoredReportingKey(req.params.providerId, key);
    const spending = await getProviderSpendingSnapshot(req.params.providerId);
    return res.json({ ok: true, spending });
  } catch (err) {
    return sendKnownError(res, err);
  }
});

router.delete('/spending/:providerId/credential', async (req, res) => {
  try {
    setStoredReportingKey(req.params.providerId, '');
    const spending = await getProviderSpendingSnapshot(req.params.providerId);
    return res.json({ ok: true, spending });
  } catch (err) {
    return sendKnownError(res, err);
  }
});

router.put('/notifications/:notificationId/review', async (req, res) => {
  try {
    reviewNotification(req.params.notificationId);
    res.json(await buildResponse());
  } catch (err) {
    sendKnownError(res, err);
  }
});

router.get('/review-packet', async (req, res) => {
  try {
    const providerId = String(req.query.providerId || '').trim();
    const modelId = String(req.query.modelId || '').trim();
    const usage = await getAgentUsageSnapshot();
    const modelUsage = usage.models?.[`${providerId}:${modelId}`] || [];
    const packet = buildModelReleaseReviewPacket(providerId, modelId, modelUsage);
    const filenameModel = modelId.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 100) || 'model';
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameModel}-release-review.md"`);
    res.send(packet);
  } catch (err) {
    sendKnownError(res, err);
  }
});

const testConnectionsRateLimit = createRateLimiter({ name: 'ai-management-test-connections', limit: 3, windowMs: 60_000 });
router.post('/connections/test', testConnectionsRateLimit, async (req, res) => {
  try {
    clearProviderAvailabilityCache();
    const availability = await checkProviderAvailability({ forceRefresh: true });
    const snapshot = getManagementSnapshot();
    const results = snapshot.providers.map((provider) => {
      const result = availability?.[provider.id] || availability?.[provider.defaultModel] || null;
      const disabled = provider.enabled === false || result?.code === 'AI_PROVIDER_DISABLED';
      return {
        providerId: provider.id,
        ok: result?.available === true || result?.ok === true,
        skipped: disabled,
        code: disabled ? 'DISABLED' : result?.code || (result ? 'UNAVAILABLE' : 'NO_RESULT'),
        message: disabled
          ? 'Provider is disabled.'
          : result?.reason || result?.detail || (result ? 'Connection unavailable.' : 'No connection result was returned.'),
      };
    });
    recordConnectionTestResults(results);
    res.json(await buildResponse({ results }));
  } catch (err) {
    sendKnownError(res, err);
  }
});

router.put('/keys/:providerId', async (req, res) => {
  try {
    const providerId = assertKeyProvider(req.params.providerId);
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    if (!key) {
      return res.status(400).json({ ok: false, code: 'KEY_REQUIRED', error: 'Enter an API key to save.' });
    }
    await setStoredApiKey(providerId, key);
    clearProviderConnectionTestResult(providerId);
    clearProviderAvailabilityCache();
    return res.json(await buildResponse());
  } catch (err) {
    return sendKnownError(res, err);
  }
});

router.delete('/keys/:providerId', async (req, res) => {
  try {
    const providerId = assertKeyProvider(req.params.providerId);
    await setStoredApiKey(providerId, '');
    clearProviderConnectionTestResult(providerId);
    clearProviderAvailabilityCache();
    res.json(await buildResponse());
  } catch (err) {
    sendKnownError(res, err);
  }
});

const testKeyRateLimit = createRateLimiter({ name: 'ai-management-test-key', limit: 5, windowMs: 60_000 });
router.post('/keys/:providerId/test', testKeyRateLimit, async (req, res) => {
  try {
    const providerId = assertKeyProvider(req.params.providerId);
    const supplied = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    const key = supplied || await resolveApiKey(providerId);
    if (!key) {
      return res.status(400).json({ ok: false, code: 'NO_KEY', error: 'No API key is configured for this provider.' });
    }
    const result = await validateRemoteProvider(providerId, key);
    if (!result.ok) {
      if (!supplied) recordProviderConnectionTestResult({
        providerId,
        ok: false,
        code: result.code || 'PROVIDER_TEST_FAILED',
        message: result.reason || 'Provider connection test failed.',
      });
      const status = result.code === 'INVALID_KEY' ? 401
        : result.code === 'TIMEOUT' ? 504
          : result.code === 'PROVIDER_UNAVAILABLE' ? 503
            : 502;
      return res.status(status).json({
        ok: false,
        code: result.code || 'PROVIDER_TEST_FAILED',
        error: result.reason || 'Provider connection test failed.',
        detail: result.detail || '',
      });
    }
    if (!supplied) {
      recordProviderConnectionTestResult({ providerId, ok: true, code: 'OK', message: 'API key verified.' });
    }
    return res.json({ ok: true, providerId, model: result.model || '' });
  } catch (err) {
    return sendKnownError(res, err);
  }
});

module.exports = router;
