'use strict';

const fs = require('node:fs');
const path = require('node:path');
const providerCatalog = require('../../../shared/ai-provider-catalog.json');
const modelCatalog = require('../../../shared/ai-model-catalog.json');

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'ai-management.json');
const DISCOVERY_TIMEOUT_MS = 12_000;
const MANAGED_PROVIDER_IDS = Object.freeze(
  providerCatalog.filter((entry) => entry.selectable !== false).map((entry) => entry.id)
);

const PROVIDER_META = Object.freeze(Object.fromEntries(
  providerCatalog.map((entry) => [entry.id, entry])
));

const DEFAULT_STATE = Object.freeze({
  schemaVersion: 1,
  revision: 1,
  enforceApprovedModels: false,
  updatedAt: '',
  providers: {},
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readState() {
  if (process.env.NODE_ENV === 'test') return clone(DEFAULT_STATE);
  if (!fs.existsSync(STATE_FILE)) return clone(DEFAULT_STATE);
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!isPlainObject(parsed)) throw new Error('the root value is not an object');
    return {
      schemaVersion: 1,
      revision: Number.isFinite(parsed.revision) ? parsed.revision : 1,
      enforceApprovedModels: parsed.enforceApprovedModels === true,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      providers: isPlainObject(parsed.providers) ? parsed.providers : {},
    };
  } catch (cause) {
    const err = new Error(`AI Management policy could not be read from ${STATE_FILE}: ${cause.message}`);
    err.code = 'AI_MANAGEMENT_STATE_INVALID';
    throw err;
  }
}

let state = readState();

function writeState(nextState) {
  const persistedState = {
    ...nextState,
    schemaVersion: 1,
    revision: Math.max(1, Number(nextState.revision) || 1),
    updatedAt: new Date().toISOString(),
  };
  if (process.env.NODE_ENV !== 'test') {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(persistedState, null, 2)}\n`, 'utf8');
  }
  // Update the live enforcement state only after durable storage succeeds.
  state = persistedState;
  return state;
}

function providerModelDefaults(providerId) {
  const definition = modelCatalog.providers?.[providerId];
  return Array.isArray(definition?.models) ? definition.models : [];
}

function mergeModel(providerId, baseModel, modelState = {}) {
  const id = String(baseModel?.id || modelState?.id || '').trim();
  const isCurated = Boolean(baseModel?.id);
  return {
    ...(baseModel || {}),
    ...(modelState || {}),
    id,
    label: modelState.label || baseModel?.label || id,
    approval: modelState.approval || (isCurated ? 'approved' : 'candidate'),
    enabled: typeof modelState.enabled === 'boolean' ? modelState.enabled : isCurated,
    source: modelState.source || (isCurated ? 'curated-catalog' : 'provider-discovery'),
    availability: modelState.availability || (isCurated ? 'catalogued' : 'discovered'),
    validationStatus: modelState.validationStatus || (isCurated ? 'catalogued' : 'not-run'),
  };
}

function buildProviderSnapshot(providerId) {
  const meta = PROVIDER_META[providerId] || {};
  const providerState = isPlainObject(state.providers[providerId]) ? state.providers[providerId] : {};
  const savedModels = isPlainObject(providerState.models) ? providerState.models : {};
  const models = [];
  const seen = new Set();

  for (const baseModel of providerModelDefaults(providerId)) {
    seen.add(baseModel.id);
    models.push(mergeModel(providerId, baseModel, savedModels[baseModel.id]));
  }
  for (const [modelId, modelState] of Object.entries(savedModels)) {
    if (seen.has(modelId)) continue;
    models.push(mergeModel(providerId, null, { ...modelState, id: modelId }));
  }

  models.sort((left, right) => {
    const approvalRank = { approved: 0, candidate: 1, blocked: 2 };
    const rankDiff = (approvalRank[left.approval] ?? 3) - (approvalRank[right.approval] ?? 3);
    if (rankDiff !== 0) return rankDiff;
    return String(left.label || left.id).localeCompare(String(right.label || right.id));
  });

  return {
    id: providerId,
    label: meta.label || providerId,
    shortLabel: meta.shortLabel || meta.label || providerId,
    family: meta.family || providerId,
    transport: meta.transport || providerId,
    defaultModel: meta.model || '',
    enabled: providerState.enabled !== false,
    discoveryMode: modelCatalog.providers?.[providerId]?.discovery || 'manual',
    discoveryStatus: providerState.discoveryStatus || 'not-checked',
    lastCheckedAt: providerState.lastCheckedAt || '',
    discoveryError: providerState.discoveryError || '',
    models,
  };
}

function getManagementSnapshot() {
  const providers = MANAGED_PROVIDER_IDS.map(buildProviderSnapshot);
  return {
    schemaVersion: 1,
    revision: state.revision,
    enforceApprovedModels: state.enforceApprovedModels === true,
    updatedAt: state.updatedAt || '',
    providers,
    summary: {
      providers: providers.length,
      enabledProviders: providers.filter((provider) => provider.enabled).length,
      approvedModels: providers.reduce(
        (total, provider) => total + provider.models.filter((model) => model.approval === 'approved' && model.enabled).length,
        0
      ),
      candidates: providers.reduce(
        (total, provider) => total + provider.models.filter((model) => model.approval === 'candidate').length,
        0
      ),
    },
  };
}

function ensureManagedProvider(providerId) {
  const normalized = String(providerId || '').trim();
  if (!MANAGED_PROVIDER_IDS.includes(normalized)) {
    const err = new Error(`Unknown managed provider: ${normalized || '(empty)'}`);
    err.code = 'INVALID_PROVIDER';
    throw err;
  }
  return normalized;
}

function updateSettings(patch = {}) {
  const next = clone(state);
  if (patch.enforceApprovedModels !== undefined) {
    next.enforceApprovedModels = patch.enforceApprovedModels === true;
  }
  next.revision += 1;
  writeState(next);
  return getManagementSnapshot();
}

function updateProviderPolicy(providerId, patch = {}) {
  const id = ensureManagedProvider(providerId);
  const next = clone(state);
  const current = isPlainObject(next.providers[id]) ? next.providers[id] : {};
  next.providers[id] = {
    ...current,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled === true } : {}),
  };
  next.revision += 1;
  writeState(next);
  return getManagementSnapshot();
}

function updateModelPolicy(providerId, modelId, patch = {}) {
  const id = ensureManagedProvider(providerId);
  const normalizedModel = String(modelId || '').trim();
  if (!normalizedModel || normalizedModel.length > 180) {
    const err = new Error('A valid model ID is required.');
    err.code = 'INVALID_MODEL';
    throw err;
  }

  const next = clone(state);
  const currentProvider = isPlainObject(next.providers[id]) ? next.providers[id] : {};
  const models = isPlainObject(currentProvider.models) ? currentProvider.models : {};
  const currentModel = isPlainObject(models[normalizedModel]) ? models[normalizedModel] : {};
  const nextApproval = ['approved', 'candidate', 'blocked'].includes(patch.approval)
    ? patch.approval
    : currentModel.approval;
  const nextValidation = ['not-run', 'passed', 'failed', 'catalogued'].includes(patch.validationStatus)
    ? patch.validationStatus
    : currentModel.validationStatus;
  const nextValidationEvidence = typeof patch.validationEvidence === 'string'
    ? patch.validationEvidence.trim().slice(0, 500)
    : String(currentModel.validationEvidence || '').trim();
  const isCuratedModel = providerModelDefaults(id).some((model) => model.id === normalizedModel);

  if (nextApproval === 'approved'
    && nextValidation !== 'passed'
    && nextValidation !== 'catalogued'
    && !isCuratedModel) {
    const err = new Error('A discovered model must have a passed validation record before it can be approved.');
    err.code = 'MODEL_VALIDATION_REQUIRED';
    throw err;
  }
  if (nextApproval === 'approved' && !isCuratedModel && !nextValidationEvidence) {
    const err = new Error('Add the harness run or test evidence used to approve this discovered model.');
    err.code = 'MODEL_VALIDATION_REQUIRED';
    throw err;
  }

  models[normalizedModel] = {
    ...currentModel,
    ...(typeof patch.label === 'string' && patch.label.trim() ? { label: patch.label.trim() } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled === true } : {}),
    ...(nextApproval ? { approval: nextApproval } : {}),
    ...(nextValidation ? { validationStatus: nextValidation } : {}),
    ...(typeof patch.validationEvidence === 'string'
      ? { validationEvidence: nextValidationEvidence }
      : {}),
    ...(typeof patch.validationNotes === 'string'
      ? { validationNotes: patch.validationNotes.trim().slice(0, 1000) }
      : {}),
    ...(nextValidation ? { validatedAt: new Date().toISOString() } : {}),
    updatedAt: new Date().toISOString(),
  };
  next.providers[id] = { ...currentProvider, models };
  next.revision += 1;
  writeState(next);
  return getManagementSnapshot();
}

function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const err = new Error(body?.error?.message || body?.error || `Model discovery failed with HTTP ${response.status}.`);
        err.code = response.status === 401 || response.status === 403 ? 'INVALID_KEY' : 'DISCOVERY_FAILED';
        throw err;
      }
      return body;
    })
    .finally(() => clearTimeout(timeout));
}

function getGatewayBaseUrl() {
  return String(process.env.LLM_GATEWAY_API_URL || 'http://localhost:4100').replace(/\/+$/, '');
}

function getLmStudioBaseUrl() {
  return String(process.env.LM_STUDIO_API_URL || 'http://localhost:1234/v1').replace(/\/+$/, '');
}

function normalizeOpenAiModels(data) {
  return (Array.isArray(data?.data) ? data.data : [])
    .filter((model) => typeof model?.id === 'string')
    .filter((model) => /^(gpt-|o\d|chatgpt-)/i.test(model.id))
    .filter((model) => !/(audio|realtime|transcrib|tts|image|search|embedding|moderation)/i.test(model.id))
    .map((model) => ({
      id: model.id,
      label: model.id,
      createdAt: Number.isFinite(model.created) ? new Date(model.created * 1000).toISOString() : '',
      owner: model.owned_by || '',
    }));
}

function normalizeAnthropicModels(data) {
  return (Array.isArray(data?.data) ? data.data : [])
    .filter((model) => typeof model?.id === 'string' && model.id.startsWith('claude-'))
    .map((model) => ({
      id: model.id,
      label: model.display_name || model.id,
      createdAt: model.created_at || '',
      contextWindowTokens: Number.isFinite(model.max_input_tokens) ? model.max_input_tokens : null,
      maxOutputTokens: Number.isFinite(model.max_tokens) ? model.max_tokens : null,
      supportsImageInput: model.capabilities?.image_input?.supported,
      supportsThinking: model.capabilities?.thinking?.supported,
    }));
}

function normalizeGeminiModels(data) {
  return (Array.isArray(data?.models) ? data.models : [])
    .filter((model) => Array.isArray(model?.supportedGenerationMethods)
      && model.supportedGenerationMethods.includes('generateContent'))
    .map((model) => ({
      id: String(model.baseModelId || model.name || '').replace(/^models\//, ''),
      label: model.displayName || model.baseModelId || model.name,
      description: model.description || '',
      contextWindowTokens: Number.isFinite(model.inputTokenLimit) ? model.inputTokenLimit : null,
      maxOutputTokens: Number.isFinite(model.outputTokenLimit) ? model.outputTokenLimit : null,
      supportsThinking: typeof model.thinking === 'boolean' ? model.thinking : null,
    }))
    .filter((model) => model.id && /^gemini-/i.test(model.id));
}

function normalizeKimiModels(data) {
  return (Array.isArray(data?.data) ? data.data : [])
    .filter((model) => typeof model?.id === 'string')
    .map((model) => ({
      id: model.id,
      label: model.id,
      owner: model.owned_by || '',
      contextWindowTokens: Number.isFinite(model.context_length) ? model.context_length : null,
      supportsImageInput: typeof model.supports_image_in === 'boolean' ? model.supports_image_in : null,
      supportsThinking: typeof model.supports_reasoning === 'boolean' ? model.supports_reasoning : null,
    }));
}

function normalizeCompatibleModels(data) {
  return (Array.isArray(data?.data) ? data.data : [])
    .filter((model) => typeof model?.id === 'string' && model.id.trim())
    .map((model) => ({
      id: model.id.trim(),
      label: model.id.trim(),
      owner: model.owned_by || '',
    }));
}

async function discoverProviderModels(providerId) {
  const id = ensureManagedProvider(providerId);
  if (id === 'claude' || id === 'codex') {
    return {
      status: 'manual',
      models: [],
      message: 'CLI model availability is maintained manually because API access does not prove local CLI account access.',
    };
  }

  const { resolveApiKey } = require('./image-parser');
  const apiKey = id === 'lm-studio' ? '' : await resolveApiKey(id);
  if (!apiKey && id !== 'lm-studio') {
    const err = new Error('Add this provider API key before checking for models.');
    err.code = 'NO_KEY';
    throw err;
  }

  if (id === 'anthropic') {
    const data = await fetchJson('https://api.anthropic.com/v1/models?limit=1000', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    });
    return { status: 'success', models: normalizeAnthropicModels(data) };
  }
  if (id === 'openai') {
    const data = await fetchJson('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return { status: 'success', models: normalizeOpenAiModels(data) };
  }
  if (id === 'gemini') {
    const data = await fetchJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
      headers: { 'x-goog-api-key': apiKey },
    });
    return { status: 'success', models: normalizeGeminiModels(data) };
  }
  if (id === 'kimi') {
    const data = await fetchJson('https://api.moonshot.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return { status: 'success', models: normalizeKimiModels(data) };
  }
  if (id === 'llm-gateway') {
    const data = await fetchJson(`${getGatewayBaseUrl()}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return { status: 'success', models: normalizeCompatibleModels(data) };
  }
  if (id === 'lm-studio') {
    const base = getLmStudioBaseUrl();
    const url = /\/v1$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
    const data = await fetchJson(url);
    return { status: 'success', models: normalizeCompatibleModels(data) };
  }
  return { status: 'manual', models: [] };
}

function mergeDiscoveryResult(providerId, result) {
  const next = clone(state);
  const currentProvider = isPlainObject(next.providers[providerId]) ? next.providers[providerId] : {};
  const models = isPlainObject(currentProvider.models) ? currentProvider.models : {};
  const checkedAt = new Date().toISOString();

  for (const discovered of result.models || []) {
    const currentModel = isPlainObject(models[discovered.id]) ? models[discovered.id] : {};
    const isCurated = providerModelDefaults(providerId).some((model) => model.id === discovered.id);
    models[discovered.id] = {
      ...currentModel,
      ...Object.fromEntries(Object.entries(discovered).filter(([, value]) => value !== null && value !== '')),
      approval: currentModel.approval || (isCurated ? 'approved' : 'candidate'),
      enabled: typeof currentModel.enabled === 'boolean' ? currentModel.enabled : isCurated,
      validationStatus: currentModel.validationStatus || (isCurated ? 'catalogued' : 'not-run'),
      source: 'provider-discovery',
      availability: 'available',
      discoveredAt: currentModel.discoveredAt || checkedAt,
      lastSeenAt: checkedAt,
    };
  }

  next.providers[providerId] = {
    ...currentProvider,
    models,
    discoveryStatus: result.status,
    discoveryError: '',
    lastCheckedAt: checkedAt,
  };
  next.revision += 1;
  writeState(next);
}

async function refreshProviderModels(providerIds = MANAGED_PROVIDER_IDS) {
  const requested = [...new Set((Array.isArray(providerIds) ? providerIds : []).map(ensureManagedProvider))];
  const results = [];

  for (const providerId of requested) {
    try {
      const result = await discoverProviderModels(providerId);
      mergeDiscoveryResult(providerId, result);
      results.push({
        providerId,
        ok: true,
        status: result.status,
        found: Array.isArray(result.models) ? result.models.length : 0,
        message: result.message || '',
      });
    } catch (err) {
      const next = clone(state);
      const currentProvider = isPlainObject(next.providers[providerId]) ? next.providers[providerId] : {};
      next.providers[providerId] = {
        ...currentProvider,
        discoveryStatus: 'failed',
        discoveryError: err.message || 'Model discovery failed.',
        lastCheckedAt: new Date().toISOString(),
      };
      next.revision += 1;
      writeState(next);
      results.push({ providerId, ok: false, code: err.code || 'DISCOVERY_FAILED', error: err.message });
    }
  }

  return { snapshot: getManagementSnapshot(), results };
}

function resolveManagedProviderId(providerId) {
  const meta = PROVIDER_META[String(providerId || '').trim()];
  if (!meta) return String(providerId || '').trim();
  if (meta.selectable !== false) return meta.id;
  if (meta.transport === 'claude' || meta.transport === 'codex') return meta.transport;
  return meta.id;
}

function createPolicyError(code, message, providerId, modelId = '') {
  const err = new Error(message);
  err.code = code;
  err.provider = providerId;
  err.model = modelId;
  return err;
}

function assertProviderEnabled(providerId) {
  const managedProviderId = resolveManagedProviderId(providerId);
  if (!MANAGED_PROVIDER_IDS.includes(managedProviderId)) return true;
  const provider = buildProviderSnapshot(managedProviderId);
  if (!provider.enabled) {
    throw createPolicyError(
      'AI_PROVIDER_DISABLED',
      `${provider.label} is disabled in Settings > AI Management.`,
      managedProviderId
    );
  }
  return true;
}

function isProviderEnabled(providerId) {
  try {
    assertProviderEnabled(providerId);
    return true;
  } catch (err) {
    if (err?.code === 'AI_PROVIDER_DISABLED') return false;
    throw err;
  }
}

function assertProviderModelAllowed(providerId, modelId = '') {
  const managedProviderId = resolveManagedProviderId(providerId);
  if (!MANAGED_PROVIDER_IDS.includes(managedProviderId)) return true;
  const provider = buildProviderSnapshot(managedProviderId);
  const meta = PROVIDER_META[String(providerId || '').trim()] || PROVIDER_META[managedProviderId] || {};
  const effectiveModel = String(modelId || meta.model || provider.defaultModel || '').trim();

  assertProviderEnabled(providerId);

  if (!effectiveModel) return true;
  const model = provider.models.find((entry) => entry.id === effectiveModel);
  if (!model) {
    if (state.enforceApprovedModels) {
      throw createPolicyError(
        'AI_MODEL_NOT_APPROVED',
        `${effectiveModel} is not approved in Settings > AI Management.`,
        managedProviderId,
        effectiveModel
      );
    }
    return true;
  }
  // In migration mode, discovery is advisory: a newly discovered candidate
  // does not suddenly break an older custom assignment. Explicitly blocked
  // models and disabled approved models are always enforced. Once strict mode
  // is enabled, candidates are rejected too.
  if (model.approval === 'blocked' || (model.approval === 'approved' && !model.enabled)) {
    throw createPolicyError(
      model.approval === 'approved' ? 'AI_MODEL_DISABLED' : 'AI_MODEL_NOT_APPROVED',
      `${model.label || model.id} is not available for live agents in Settings > AI Management.`,
      managedProviderId,
      effectiveModel
    );
  }
  if (model.approval !== 'approved' && state.enforceApprovedModels) {
    throw createPolicyError(
      'AI_MODEL_NOT_APPROVED',
      `${model.label || model.id} is not approved in Settings > AI Management.`,
      managedProviderId,
      effectiveModel
    );
  }
  return true;
}

function resetStateForTests() {
  state = clone(DEFAULT_STATE);
}

module.exports = {
  MANAGED_PROVIDER_IDS,
  STATE_FILE,
  assertProviderEnabled,
  assertProviderModelAllowed,
  discoverProviderModels,
  getManagementSnapshot,
  isProviderEnabled,
  refreshProviderModels,
  resetStateForTests,
  updateModelPolicy,
  updateProviderPolicy,
  updateSettings,
};
