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
const MAX_DISCOVERY_PAGES = 20;
const ACCOUNT_VISIBILITY_EVIDENCE = 'account-model-list';

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

function buildCatalogReview(providerId) {
  const configured = isPlainObject(modelCatalog.catalogReviews?.[providerId])
    ? modelCatalog.catalogReviews[providerId]
    : {};
  const reviewedAt = typeof configured.reviewedAt === 'string' ? configured.reviewedAt : '';
  const reviewedTime = reviewedAt ? Date.parse(`${reviewedAt}T00:00:00Z`) : Number.NaN;
  const ageDays = Number.isFinite(reviewedTime)
    ? Math.max(0, Math.floor((Date.now() - reviewedTime) / 86_400_000))
    : null;
  const expiresAfterDays = Number.isFinite(configured.expiresAfterDays)
    ? configured.expiresAfterDays
    : null;
  const reviewKind = configured.reviewKind === 'operator-managed'
    ? 'operator-managed'
    : 'maintained-release';
  const status = !reviewedAt
    ? 'missing'
    : expiresAfterDays !== null && ageDays > expiresAfterDays
      ? 'overdue'
      : 'current';

  return {
    reviewedAt,
    ageDays,
    expiresAfterDays,
    reviewKind,
    status,
    requiresMaintainedCatalogRelease: reviewKind === 'maintained-release',
    officialSources: Array.isArray(configured.officialSources)
      ? configured.officialSources.filter((source) => typeof source === 'string' && source.startsWith('https://'))
      : [],
  };
}

function isReviewedDiscoveryIgnore(providerId, modelId) {
  if (providerModelDefaults(providerId).some((model) => model.id === modelId)) return false;
  const unsupportedSurfacePattern = providerId === 'gemini'
    ? /(?:^|[-_])(tts|live|audio|image|imagen|veo|embedding|aqa|robotics|computer-use|omni)(?:$|[-_])/i
    : providerId === 'openai'
      ? /(audio|realtime|transcrib|tts|image|search|embedding|moderation)/i
      : null;
  if (unsupportedSurfacePattern?.test(modelId)) return true;
  const patterns = modelCatalog.catalogReviews?.[providerId]?.ignoredModelIdPatterns;
  if (!Array.isArray(patterns)) return false;
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern, 'i').test(modelId);
    } catch {
      return false;
    }
  });
}

function parseVersionParts(value) {
  return String(value || '')
    .split(/[.-]/)
    .filter(Boolean)
    .filter((part) => !/^20\d{6}$/.test(part))
    .map((part) => Number(part))
    .filter(Number.isFinite);
}

function compareVersionParts(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function extractRuleVersion(modelId, pattern) {
  try {
    const match = new RegExp(pattern, 'i').exec(modelId);
    if (!match) return null;
    const parts = match.slice(1).flatMap(parseVersionParts);
    return parts.length > 0 ? parts : null;
  } catch {
    return null;
  }
}

function classifyDiscoveryModel(providerId, model = {}) {
  const modelId = String(model?.id || '').trim();
  if (!modelId) return 'not-new';
  if (providerModelDefaults(providerId).some((entry) => entry.id === modelId)) return 'reviewed';
  if (isReviewedDiscoveryIgnore(providerId, modelId)) return 'not-new';

  const review = buildCatalogReview(providerId);
  if (!review.requiresMaintainedCatalogRelease) return 'new';

  const rules = modelCatalog.catalogReviews?.[providerId]?.newModelVersionRules;
  if (Array.isArray(rules)) {
    for (const rule of rules) {
      const candidateVersion = extractRuleVersion(modelId, rule?.pattern);
      if (!candidateVersion) continue;
      const catalogVersions = providerModelDefaults(providerId)
        .map((catalogModel) => extractRuleVersion(catalogModel.id, rule.pattern))
        .filter(Boolean);
      const configuredVersion = parseVersionParts(rule?.catalogVersion);
      if (configuredVersion.length > 0) catalogVersions.push(configuredVersion);
      if (catalogVersions.length === 0) return 'not-new';
      const newestCatalogVersion = catalogVersions.reduce((newest, version) => (
        compareVersionParts(version, newest) > 0 ? version : newest
      ));
      return compareVersionParts(candidateVersion, newestCatalogVersion) > 0 ? 'new' : 'not-new';
    }
  }

  const createdAt = Date.parse(String(model?.createdAt || ''));
  const reviewDayEnd = review.reviewedAt
    ? Date.parse(`${review.reviewedAt}T23:59:59.999Z`)
    : Number.NaN;
  return Number.isFinite(createdAt) && Number.isFinite(reviewDayEnd) && createdAt > reviewDayEnd
    ? 'new'
    : 'not-new';
}

function reconcileModelPolicy(baseModel, modelState = {}) {
  const isCurated = Boolean(baseModel?.id);
  const source = String(modelState.source || '');
  const approval = String(modelState.approval || '');
  const validationStatus = String(modelState.validationStatus || '');
  const hasValidationEvidence = Boolean(String(modelState.validationEvidence || '').trim());

  // A discovery can see a model before the reviewed catalog is updated. Once
  // that same ID becomes curated, promote only the untouched discovery state.
  if (isCurated
    && approval === 'candidate'
    && modelState.enabled === false
    && validationStatus === 'not-run'
    && !hasValidationEvidence) {
    return {
      approval: 'approved',
      enabled: true,
      validationStatus: 'catalogued',
      source: 'curated-catalog',
    };
  }

  // Conversely, a model removed from the reviewed catalog must not remain in
  // every picker merely because an earlier discovery saved its former
  // auto-approved state. Migration mode still lets an existing profile run it.
  if (!isCurated
    && (source === 'provider-discovery' || source === 'curated-catalog')
    && approval === 'approved'
    && validationStatus === 'catalogued'
    && !hasValidationEvidence) {
    return {
      approval: 'candidate',
      enabled: false,
      validationStatus: 'not-run',
      source: 'provider-discovery',
    };
  }

  return {};
}

function mergeModel(providerId, baseModel, modelState = {}) {
  const id = String(baseModel?.id || modelState?.id || '').trim();
  const isCurated = Boolean(baseModel?.id);
  const reconciledPolicy = reconcileModelPolicy(baseModel, modelState);
  const effectiveState = { ...(modelState || {}), ...reconciledPolicy };
  return {
    ...(modelState || {}),
    ...(baseModel || {}),
    id,
    label: baseModel?.label || modelState.label || id,
    approval: effectiveState.approval || (isCurated ? 'approved' : 'candidate'),
    enabled: typeof effectiveState.enabled === 'boolean' ? effectiveState.enabled : isCurated,
    source: effectiveState.source || (isCurated ? 'curated-catalog' : 'provider-discovery'),
    availability: effectiveState.availability || (isCurated ? 'catalogued' : 'discovered'),
    catalogStatus: isCurated ? 'reviewed' : 'needs-review',
    validationStatus: effectiveState.validationStatus || (isCurated ? 'catalogued' : 'not-run'),
  };
}

function sanitizeDiscoverySummary(providerId, savedModels, configuredSummary) {
  if (!isPlainObject(configuredSummary)) return null;
  const candidateModelIds = Array.isArray(configuredSummary.candidateModelIds)
    ? configuredSummary.candidateModelIds.filter((modelId) => (
      classifyDiscoveryModel(providerId, { ...(savedModels[modelId] || {}), id: modelId }) === 'new'
    ))
    : [];
  const removedCandidates = Math.max(0, (Number(configuredSummary.candidates) || 0) - candidateModelIds.length);
  return {
    ...configuredSummary,
    acceptedCount: (Number(configuredSummary.reviewedVisible) || 0) + candidateModelIds.length,
    ignoredCount: (Number(configuredSummary.ignoredCount) || 0) + removedCandidates,
    newModelsFound: candidateModelIds.length,
    candidates: candidateModelIds.length,
    candidateModelIds,
  };
}

function buildProviderSnapshot(providerId) {
  const meta = PROVIDER_META[providerId] || {};
  const providerState = isPlainObject(state.providers[providerId]) ? state.providers[providerId] : {};
  const savedModels = isPlainObject(providerState.models) ? providerState.models : {};
  const catalogReview = buildCatalogReview(providerId);
  const discoverySummary = sanitizeDiscoverySummary(providerId, savedModels, providerState.discoverySummary);
  const missingReviewedModelIds = new Set(
    Array.isArray(discoverySummary?.missingReviewedModelIds)
      ? discoverySummary.missingReviewedModelIds
      : []
  );
  const models = [];
  const seen = new Set();

  for (const baseModel of providerModelDefaults(providerId)) {
    seen.add(baseModel.id);
    const merged = mergeModel(providerId, baseModel, savedModels[baseModel.id]);
    models.push(missingReviewedModelIds.has(baseModel.id)
      ? { ...merged, availability: 'not-seen' }
      : merged);
  }
  for (const [modelId, modelState] of Object.entries(savedModels)) {
    if (seen.has(modelId)) continue;
    if (modelState?.source === 'provider-discovery'
      && !String(modelState.validationEvidence || '').trim()
      && classifyDiscoveryModel(providerId, { ...modelState, id: modelId }) !== 'new') continue;
    models.push(mergeModel(providerId, null, { ...modelState, id: modelId }));
  }

  models.sort((left, right) => {
    const approvalRank = { approved: 0, candidate: 1, blocked: 2 };
    const rankDiff = (approvalRank[left.approval] ?? 3) - (approvalRank[right.approval] ?? 3);
    if (rankDiff !== 0) return rankDiff;
    return String(left.label || left.id).localeCompare(String(right.label || right.id));
  });

  let discoveryStatus = providerState.discoveryStatus || 'not-checked';
  if (discoverySummary && !['failed', 'manual', 'not-checked'].includes(discoveryStatus)) {
    discoveryStatus = discoverySummary.missingReviewed > 0
      ? 'attention'
      : discoverySummary.candidates > 0
        ? 'review-needed'
        : 'verified';
  }

  return {
    id: providerId,
    label: meta.label || providerId,
    shortLabel: meta.shortLabel || meta.label || providerId,
    family: meta.family || providerId,
    transport: meta.transport || providerId,
    defaultModel: meta.model || '',
    enabled: providerState.enabled !== false,
    discoveryMode: modelCatalog.providers?.[providerId]?.discovery || 'manual',
    discoveryStatus,
    lastCheckedAt: providerState.lastCheckedAt || '',
    lastAttemptedAt: providerState.lastAttemptedAt || providerState.lastCheckedAt || '',
    lastSuccessfulCheckAt: providerState.lastSuccessfulCheckAt || providerState.lastCheckedAt || '',
    discoveryError: providerState.discoveryError || '',
    discoverySummary,
    catalogReview,
    requiresMaintainedCatalogRelease: catalogReview.requiresMaintainedCatalogRelease,
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
      overdueCatalogReviews: providers.filter((provider) => provider.catalogReview.status === 'overdue').length,
      discoveryWarnings: providers.filter((provider) => ['attention', 'failed'].includes(provider.discoveryStatus)).length,
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
    && !isCuratedModel
    && buildCatalogReview(id).requiresMaintainedCatalogRelease) {
    const err = new Error(
      'Cloud models discovered from a provider list cannot be approved from the browser. '
      + 'Update the reviewed catalog, request compatibility, focused tests, and release documentation together.'
    );
    err.code = 'MODEL_CATALOG_RELEASE_REQUIRED';
    throw err;
  }

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
    .filter((model) => !/(?:^|[-_])(tts|live|audio|image|imagen|veo|embedding|aqa|robotics|computer-use|omni)(?:$|[-_])/i.test(
      String(model.baseModelId || model.name || '').replace(/^models\//, '')
    ))
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
      createdAt: Number.isFinite(model.created) ? new Date(model.created * 1000).toISOString() : '',
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

function createDiscoveryError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function requireDiscoveryArray(data, field, providerId) {
  if (!Array.isArray(data?.[field])) {
    throw createDiscoveryError(
      'DISCOVERY_RESPONSE_INVALID',
      `${providerId} returned a successful response without the expected ${field} model list.`
    );
  }
  return data[field];
}

function finalizeDiscoveryResult(providerId, rawModels, normalizedModels, sourceUrl, pages = 1) {
  if (!Array.isArray(rawModels) || rawModels.length === 0) {
    throw createDiscoveryError(
      'DISCOVERY_RESPONSE_EMPTY',
      `${providerId} returned an empty model list. The previous successful result was preserved.`
    );
  }

  if (!Array.isArray(normalizedModels) || normalizedModels.length === 0) {
    throw createDiscoveryError(
      'DISCOVERY_RESPONSE_UNUSABLE',
      `${providerId} returned models, but none matched this application's text-and-agent API surface. The previous successful result was preserved.`
    );
  }

  const reviewFilteredModels = normalizedModels.filter((model) => (
    classifyDiscoveryModel(providerId, model) !== 'not-new'
  ));
  const uniqueModels = [];
  const seenIds = new Set();
  let duplicateCount = 0;
  for (const model of reviewFilteredModels) {
    const modelId = String(model?.id || '').trim();
    if (!modelId) continue;
    if (seenIds.has(modelId)) {
      duplicateCount += 1;
      continue;
    }
    seenIds.add(modelId);
    uniqueModels.push({ ...model, id: modelId });
  }

  return {
    status: 'success',
    models: uniqueModels,
    rawCount: rawModels.length,
    ignoredCount: Math.max(0, rawModels.length - reviewFilteredModels.length),
    duplicateCount,
    sourceUrl,
    evidenceScope: ACCOUNT_VISIBILITY_EVIDENCE,
    complete: true,
    pages,
  };
}

async function discoverAnthropicModels(apiKey) {
  const sourceUrl = 'https://api.anthropic.com/v1/models';
  const rawModels = [];
  const seenCursors = new Set();
  let afterId = '';
  let pages = 0;
  let hasMore = false;

  while (pages < MAX_DISCOVERY_PAGES) {
    const url = `${sourceUrl}?limit=1000${afterId ? `&after_id=${encodeURIComponent(afterId)}` : ''}`;
    const data = await fetchJson(url, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    });
    rawModels.push(...requireDiscoveryArray(data, 'data', 'anthropic'));
    pages += 1;
    hasMore = data.has_more === true;
    if (!hasMore) break;
    const nextCursor = String(data.last_id || '').trim();
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw createDiscoveryError('DISCOVERY_RESPONSE_INVALID', 'anthropic returned an invalid or repeated pagination cursor.');
    }
    seenCursors.add(nextCursor);
    afterId = nextCursor;
  }

  if (pages >= MAX_DISCOVERY_PAGES && hasMore) {
    throw createDiscoveryError('DISCOVERY_RESPONSE_INVALID', 'anthropic model discovery exceeded the safe pagination limit.');
  }
  return finalizeDiscoveryResult(
    'anthropic',
    rawModels,
    normalizeAnthropicModels({ data: rawModels }),
    sourceUrl,
    pages
  );
}

async function discoverGeminiModels(apiKey) {
  const sourceUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
  const rawModels = [];
  const seenTokens = new Set();
  let pageToken = '';
  let pages = 0;

  while (pages < MAX_DISCOVERY_PAGES) {
    const url = `${sourceUrl}?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const data = await fetchJson(url, { headers: { 'x-goog-api-key': apiKey } });
    rawModels.push(...requireDiscoveryArray(data, 'models', 'gemini'));
    pages += 1;
    const nextToken = String(data.nextPageToken || '').trim();
    pageToken = nextToken;
    if (!pageToken) break;
    if (seenTokens.has(pageToken)) {
      throw createDiscoveryError('DISCOVERY_RESPONSE_INVALID', 'gemini returned a repeated pagination token.');
    }
    seenTokens.add(pageToken);
  }

  if (pages >= MAX_DISCOVERY_PAGES && pageToken) {
    throw createDiscoveryError('DISCOVERY_RESPONSE_INVALID', 'gemini model discovery exceeded the safe pagination limit.');
  }
  return finalizeDiscoveryResult(
    'gemini',
    rawModels,
    normalizeGeminiModels({ models: rawModels }),
    sourceUrl,
    pages
  );
}

async function discoverProviderModels(providerId) {
  const id = ensureManagedProvider(providerId);
  if (id === 'claude' || id === 'codex') {
    return {
      status: 'manual',
      models: [],
      message: 'CLI model availability is maintained manually because API access does not prove local CLI account access.',
      evidenceScope: 'maintained-catalog',
      complete: false,
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
    return discoverAnthropicModels(apiKey);
  }
  if (id === 'openai') {
    const sourceUrl = 'https://api.openai.com/v1/models';
    const data = await fetchJson(sourceUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const rawModels = requireDiscoveryArray(data, 'data', 'openai');
    return finalizeDiscoveryResult('openai', rawModels, normalizeOpenAiModels(data), sourceUrl);
  }
  if (id === 'gemini') {
    return discoverGeminiModels(apiKey);
  }
  if (id === 'kimi') {
    const sourceUrl = 'https://api.moonshot.ai/v1/models';
    const data = await fetchJson(sourceUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const rawModels = requireDiscoveryArray(data, 'data', 'kimi');
    return finalizeDiscoveryResult('kimi', rawModels, normalizeKimiModels(data), sourceUrl);
  }
  if (id === 'llm-gateway') {
    const sourceUrl = `${getGatewayBaseUrl()}/v1/models`;
    const data = await fetchJson(sourceUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const rawModels = requireDiscoveryArray(data, 'data', 'llm-gateway');
    return finalizeDiscoveryResult('llm-gateway', rawModels, normalizeCompatibleModels(data), sourceUrl);
  }
  if (id === 'lm-studio') {
    const base = getLmStudioBaseUrl();
    const url = /\/v1$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
    const data = await fetchJson(url);
    const rawModels = requireDiscoveryArray(data, 'data', 'lm-studio');
    return finalizeDiscoveryResult('lm-studio', rawModels, normalizeCompatibleModels(data), url);
  }
  return { status: 'manual', models: [], evidenceScope: 'maintained-catalog', complete: false };
}

function mergeDiscoveryResult(providerId, result) {
  const next = clone(state);
  const currentProvider = isPlainObject(next.providers[providerId]) ? next.providers[providerId] : {};
  const models = isPlainObject(currentProvider.models) ? currentProvider.models : {};
  const checkedAt = new Date().toISOString();

  if (result.status === 'manual') {
    next.providers[providerId] = {
      ...currentProvider,
      discoveryStatus: 'manual',
      discoveryError: '',
    };
    next.revision += 1;
    writeState(next);
    return {
      providerId,
      ok: true,
      status: 'manual',
      found: 0,
      message: result.message || '',
      evidenceScope: result.evidenceScope || 'maintained-catalog',
    };
  }

  const discoveredIds = new Set((result.models || []).map((model) => model.id));
  const curatedModels = providerModelDefaults(providerId);
  const curatedIds = new Set(curatedModels.map((model) => model.id));
  const catalogReview = buildCatalogReview(providerId);

  for (const [modelId, currentModel] of Object.entries(models)) {
    if (currentModel?.source === 'provider-discovery'
      && !String(currentModel.validationEvidence || '').trim()
      && classifyDiscoveryModel(providerId, { ...currentModel, id: modelId }) !== 'new') {
      delete models[modelId];
      continue;
    }
    if (!isPlainObject(currentModel) || !currentModel.lastSeenAt || discoveredIds.has(modelId)) continue;
    models[modelId] = {
      ...currentModel,
      availability: 'not-seen',
      missingSince: currentModel.missingSince || checkedAt,
    };
  }

  for (const discovered of result.models || []) {
    const currentModel = isPlainObject(models[discovered.id]) ? models[discovered.id] : {};
    const curatedModel = providerModelDefaults(providerId).find((model) => model.id === discovered.id) || null;
    const isCurated = Boolean(curatedModel);
    const mergedModel = {
      ...currentModel,
      ...Object.fromEntries(Object.entries(discovered).filter(([, value]) => value !== null && value !== '')),
      approval: currentModel.approval || (isCurated ? 'approved' : 'candidate'),
      enabled: typeof currentModel.enabled === 'boolean' ? currentModel.enabled : isCurated,
      validationStatus: currentModel.validationStatus || (isCurated ? 'catalogued' : 'not-run'),
      source: isCurated ? 'curated-catalog' : 'provider-discovery',
      availability: 'account-visible',
      discoveredAt: currentModel.discoveredAt || checkedAt,
      lastSeenAt: checkedAt,
      missingSince: '',
    };
    models[discovered.id] = {
      ...mergedModel,
      ...reconcileModelPolicy(curatedModel, mergedModel),
    };
  }

  const candidateModelIds = [...discoveredIds].filter((modelId) => !curatedIds.has(modelId));
  const reviewedVisibleModelIds = [...discoveredIds].filter((modelId) => curatedIds.has(modelId));
  const missingReviewedModelIds = catalogReview.requiresMaintainedCatalogRelease
    ? curatedModels.map((model) => model.id).filter((modelId) => !discoveredIds.has(modelId))
    : [];
  const discoveryStatus = missingReviewedModelIds.length > 0
    ? 'attention'
    : candidateModelIds.length > 0
      ? 'review-needed'
      : 'verified';
  const discoverySummary = {
    evidenceScope: result.evidenceScope || ACCOUNT_VISIBILITY_EVIDENCE,
    sourceUrl: result.sourceUrl || '',
    complete: result.complete === true,
    pages: Number(result.pages) || 1,
    rawCount: Number(result.rawCount) || 0,
    acceptedCount: discoveredIds.size,
    ignoredCount: Number(result.ignoredCount) || 0,
    duplicateCount: Number(result.duplicateCount) || 0,
    reviewedVisible: reviewedVisibleModelIds.length,
    newModelsFound: candidateModelIds.length,
    candidates: candidateModelIds.length,
    candidateModelIds,
    missingReviewed: missingReviewedModelIds.length,
    missingReviewedModelIds,
  };

  next.providers[providerId] = {
    ...currentProvider,
    models,
    discoveryStatus,
    discoveryError: '',
    lastCheckedAt: checkedAt,
    lastAttemptedAt: checkedAt,
    lastSuccessfulCheckAt: checkedAt,
    discoverySummary,
  };
  next.revision += 1;
  writeState(next);
  return {
    providerId,
    ok: true,
    status: discoveryStatus,
    found: candidateModelIds.length,
    ...discoverySummary,
  };
}

async function refreshProviderModels(providerIds = MANAGED_PROVIDER_IDS) {
  const requested = [...new Set((Array.isArray(providerIds) ? providerIds : []).map(ensureManagedProvider))];
  const results = [];

  for (const providerId of requested) {
    try {
      const result = await discoverProviderModels(providerId);
      results.push(mergeDiscoveryResult(providerId, result));
    } catch (err) {
      const next = clone(state);
      const currentProvider = isPlainObject(next.providers[providerId]) ? next.providers[providerId] : {};
      const attemptedAt = new Date().toISOString();
      next.providers[providerId] = {
        ...currentProvider,
        discoveryStatus: 'failed',
        discoveryError: err.message || 'Model discovery failed.',
        lastAttemptedAt: attemptedAt,
      };
      next.revision += 1;
      writeState(next);
      results.push({
        providerId,
        ok: false,
        code: err.code || 'DISCOVERY_FAILED',
        error: err.message,
        lastSuccessfulCheckAt: currentProvider.lastSuccessfulCheckAt || currentProvider.lastCheckedAt || '',
      });
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

module.exports._internal = {
  classifyDiscoveryModel,
  isReviewedDiscoveryIgnore,
  mergeModel,
  reconcileModelPolicy,
};
