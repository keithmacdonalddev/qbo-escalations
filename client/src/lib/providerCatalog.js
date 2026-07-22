import catalog from '../../../shared/ai-provider-catalog.json';
import modelCatalog from '../../../shared/ai-model-catalog.json';

let managementSnapshot = null;

export const PROVIDER_CATALOG = Object.freeze(
  [...catalog]
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((entry) => Object.freeze({ ...entry }))
);

const PROVIDER_MAP = Object.freeze(
  PROVIDER_CATALOG.reduce((acc, entry) => {
    acc[entry.id] = entry;
    return acc;
  }, {})
);

function buildProviderOption(entry) {
  const managed = managementSnapshot?.providers?.find((provider) => provider.id === entry.id);
  return {
    id: entry.id,
    value: entry.id,
    label: entry.label,
    shortLabel: entry.shortLabel || entry.label,
    family: entry.family,
    transport: entry.transport,
    model: entry.model || null,
    iconPath: entry.iconPath || null,
    iconLightPath: entry.iconLightPath || null,
    iconSourceUrl: entry.iconSourceUrl || null,
    iconStrategy: entry.iconStrategy || null,
    availabilityNote: entry.availabilityNote || null,
    supportsThinking: typeof entry.supportsThinking === 'boolean' ? entry.supportsThinking : null,
    supportsImageInput: typeof entry.supportsImageInput === 'boolean' ? entry.supportsImageInput : null,
    reasoningVisibility: entry.reasoningVisibility || null,
    reasoningTerminology: entry.reasoningTerminology || null,
    effortTerminology: entry.effortTerminology || null,
    thinkingMode: entry.thinkingMode || null,
    manualThinkingBudget: typeof entry.manualThinkingBudget === 'boolean' ? entry.manualThinkingBudget : null,
    modelAlias: entry.modelAlias === true,
    modelAliases: Array.isArray(entry.modelAliases) ? [...entry.modelAliases] : [],
    featureNotes: Array.isArray(entry.featureNotes) ? [...entry.featureNotes] : [],
    contextWindowTokens: Number.isFinite(entry.contextWindowTokens) ? entry.contextWindowTokens : null,
    maxOutputTokens: Number.isFinite(entry.maxOutputTokens) ? entry.maxOutputTokens : null,
    allowedEfforts: Array.isArray(entry.allowedEfforts) ? [...entry.allowedEfforts] : [],
    enabled: managed ? managed.enabled !== false : true,
    disabled: managed ? managed.enabled === false : false,
  };
}

export function getProviderOptions() {
  return PROVIDER_CATALOG
    .filter((entry) => entry.selectable !== false)
    .map(buildProviderOption);
}

// These arrays intentionally keep stable references. AI Management replaces
// their contents after a catalog refresh so existing imports across the app
// immediately read the governed provider inventory on the next React render.
export const PROVIDER_OPTIONS = getProviderOptions();

export const PROVIDER_IDS = Object.freeze(PROVIDER_CATALOG.map((entry) => entry.id));
export const SELECTABLE_PROVIDER_IDS = PROVIDER_OPTIONS.map((entry) => entry.value);
export const DEFAULT_PROVIDER = PROVIDER_CATALOG.find((entry) => entry.default)?.id || PROVIDER_IDS[0] || 'claude';
export const DEFAULT_REASONING_EFFORT = 'high';
export const DEFAULT_CODEX_SERVICE_TIER = 'fast';
export const REASONING_EFFORT_OPTIONS = Object.freeze([
  { value: 'none', label: 'None' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
  { value: 'max', label: 'Max' },
]);
export const CODEX_SERVICE_TIER_OPTIONS = Object.freeze([
  { value: 'fast', label: 'Fast' },
  { value: 'flex', label: 'Flex' },
]);

const STATIC_MODEL_SUGGESTIONS = Object.freeze(Object.fromEntries(
  Object.entries(modelCatalog.providers || {}).map(([providerId, definition]) => [
    providerId,
    Object.freeze((definition.models || []).map((model) => Object.freeze({
      value: model.id,
      label: model.label || model.id,
      provider: providerId,
      approval: 'approved',
      enabled: true,
      disabled: false,
    }))),
  ])
));

export function applyProviderManagementSnapshot(snapshot) {
  managementSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : null;
  PROVIDER_OPTIONS.splice(0, PROVIDER_OPTIONS.length, ...getProviderOptions());
  SELECTABLE_PROVIDER_IDS.splice(
    0,
    SELECTABLE_PROVIDER_IDS.length,
    ...PROVIDER_OPTIONS.filter((option) => !option.disabled).map((option) => option.value)
  );
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('provider-catalog-updated', {
      detail: { revision: managementSnapshot?.revision || 0 },
    }));
  }
  return managementSnapshot;
}

export function getProviderManagementSnapshot() {
  return managementSnapshot;
}

export function isProviderEnabled(providerId) {
  const managed = managementSnapshot?.providers?.find((provider) => provider.id === providerId);
  return managed ? managed.enabled !== false : true;
}

function getDefaultProviderMeta() {
  return PROVIDER_MAP[DEFAULT_PROVIDER] || PROVIDER_CATALOG[0] || null;
}

function resolveProviderMeta(providerOrFamily) {
  if (typeof providerOrFamily === 'string' && providerOrFamily) {
    if (PROVIDER_MAP[providerOrFamily]) return PROVIDER_MAP[providerOrFamily];
    const familyMatch = PROVIDER_CATALOG.find((entry) => entry.family === providerOrFamily);
    if (familyMatch) return familyMatch;
  }
  return getDefaultProviderMeta();
}

export function getProviderMeta(provider) {
  return resolveProviderMeta(provider);
}

// Resolve provider identity for display-only surfaces without silently falling
// back to the default provider. Health payloads sometimes provide only a model
// name, so match both provider ids and governed model ids/labels.
export function getProviderDisplayMeta(...identifiers) {
  for (const identifier of identifiers) {
    const normalized = String(identifier || '').trim().toLowerCase();
    if (!normalized) continue;

    const exactMatch = PROVIDER_CATALOG.find((entry) => [
      entry.id,
      entry.model,
      entry.label,
      entry.shortLabel,
    ].some((value) => String(value || '').trim().toLowerCase() === normalized));
    if (exactMatch) return exactMatch;
  }

  const combined = identifiers.map((value) => String(value || '').toLowerCase()).join(' ');
  if (!combined.trim()) return null;

  const familyId = combined.includes('claude') || combined.includes('anthropic')
    ? 'anthropic'
    : combined.includes('gpt') || combined.includes('openai') || combined.includes('codex')
      ? 'codex'
      : combined.includes('gemini') || combined.includes('gemma')
        ? 'gemini'
        : combined.includes('kimi') || combined.includes('moonshot')
          ? 'kimi'
          : combined.includes('lm-studio')
            ? 'lm-studio'
            : '';
  return familyId ? (PROVIDER_MAP[familyId] || null) : null;
}

// iconPath is the asset intended for the app's dark surfaces; iconLightPath
// is the contrasting variant for light backgrounds.
export function getProviderIconPath(providerMeta, surface = 'dark') {
  if (!providerMeta) return '';
  return surface === 'light'
    ? (providerMeta.iconLightPath || providerMeta.iconPath || '')
    : (providerMeta.iconPath || providerMeta.iconLightPath || '');
}

export function getProviderCapabilities(providerOrFamily) {
  const meta = resolveProviderMeta(providerOrFamily);
  const defaultMeta = getDefaultProviderMeta();
  const allowedEfforts = Array.isArray(meta?.allowedEfforts) && meta.allowedEfforts.length > 0
    ? [...meta.allowedEfforts]
    : Array.isArray(defaultMeta?.allowedEfforts) && defaultMeta.allowedEfforts.length > 0
      ? [...defaultMeta.allowedEfforts]
      : REASONING_EFFORT_OPTIONS.map((option) => option.value);

  return {
    providerId: meta?.id || DEFAULT_PROVIDER,
    label: meta?.label || PROVIDER_LABELS[DEFAULT_PROVIDER] || 'Claude Default (CLI)',
    shortLabel: meta?.shortLabel || meta?.label || PROVIDER_SHORT_LABELS[DEFAULT_PROVIDER] || 'Claude Default (CLI)',
    family: meta?.family || 'claude',
    transport: meta?.transport || 'claude',
    model: meta?.model || null,
    iconPath: meta?.iconPath || null,
    iconLightPath: meta?.iconLightPath || null,
    iconSourceUrl: meta?.iconSourceUrl || null,
    iconStrategy: meta?.iconStrategy || null,
    supportsImageInput: typeof meta?.supportsImageInput === 'boolean'
      ? meta.supportsImageInput
      : typeof defaultMeta?.supportsImageInput === 'boolean'
        ? defaultMeta.supportsImageInput
        : false,
    supportsThinking: typeof meta?.supportsThinking === 'boolean'
      ? meta.supportsThinking
      : typeof defaultMeta?.supportsThinking === 'boolean'
        ? defaultMeta.supportsThinking
        : false,
    reasoningVisibility: meta?.reasoningVisibility || (meta?.supportsThinking ? 'stream' : 'none'),
    reasoningTerminology: meta?.reasoningTerminology || defaultMeta?.reasoningTerminology || 'reasoning',
    effortTerminology: meta?.effortTerminology || defaultMeta?.effortTerminology || 'reasoning effort',
    thinkingMode: meta?.thinkingMode || defaultMeta?.thinkingMode || null,
    manualThinkingBudget: typeof meta?.manualThinkingBudget === 'boolean'
      ? meta.manualThinkingBudget
      : typeof defaultMeta?.manualThinkingBudget === 'boolean'
        ? defaultMeta.manualThinkingBudget
        : null,
    modelAlias: meta?.modelAlias === true,
    modelAliases: Array.isArray(meta?.modelAliases) ? [...meta.modelAliases] : [],
    featureNotes: Array.isArray(meta?.featureNotes) ? [...meta.featureNotes] : [],
    contextWindowTokens: Number.isFinite(meta?.contextWindowTokens) ? meta.contextWindowTokens : null,
    maxOutputTokens: Number.isFinite(meta?.maxOutputTokens) ? meta.maxOutputTokens : null,
    allowedEfforts,
    alternateProvider: getAlternateProvider(providerOrFamily),
  };
}

export function getProviderModelId(provider) {
  return getProviderMeta(provider)?.model || null;
}

export function normalizeModelOverride(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isProviderModelPreset(provider) {
  const meta = getProviderMeta(provider);
  if (!meta) return false;
  return meta.selectable === false && Boolean(meta.model);
}

export function resolveProviderSelection(provider, model = '') {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedModel = normalizeModelOverride(model);
  const meta = getProviderMeta(normalizedProvider);
  if (meta?.transport === 'codex' && normalizedProvider !== 'codex' && getProviderMeta('codex')) {
    return {
      provider: 'codex',
      model: normalizedModel || meta.model || '',
    };
  }
  if (meta?.transport === 'claude' && normalizedProvider !== 'claude' && getProviderMeta('claude')) {
    return {
      provider: 'claude',
      model: normalizedModel || meta.model || '',
    };
  }
  return {
    provider: normalizedProvider,
    model: normalizedModel,
  };
}

export function getProviderDefaultModel(provider) {
  return getProviderModelId(provider) || '';
}

export function getProviderModelPlaceholder(provider) {
  const normalizedProvider = normalizeProvider(provider);
  const defaultModel = getProviderDefaultModel(normalizedProvider);
  if (PROVIDER_FAMILY[normalizedProvider] === 'lm-studio') {
    return 'Optional override. Default: loaded local model';
  }
  if (PROVIDER_FAMILY[normalizedProvider] === 'llm-gateway') {
    return 'Optional override. Default: gateway auto-detect';
  }
  return defaultModel
    ? `Optional override. Default: ${defaultModel}`
    : 'Optional model override';
}

export function getProviderModelSuggestions(provider) {
  const normalizedProvider = normalizeProvider(provider);
  const family = getProviderFamily(normalizedProvider);
  const options = PROVIDER_CATALOG
    .filter((entry) => entry.model
      && entry.selectable === false
      && entry.showAsModelSuggestion !== false
      && (entry.id === normalizedProvider || entry.family === family))
    .map((entry) => ({
      value: entry.model,
      label: entry.label,
      provider: entry.id,
    }));
  const managedProvider = managementSnapshot?.providers?.find((entry) => entry.id === normalizedProvider);
  const managedOptions = managedProvider
    ? (managedProvider.models || [])
      .filter((model) => model.approval === 'approved')
      .map((model) => ({
        value: model.id,
        label: model.label || model.id,
        provider: normalizedProvider,
        approval: model.approval,
        enabled: model.enabled !== false,
        disabled: model.enabled === false || managedProvider.enabled === false,
      }))
    : (STATIC_MODEL_SUGGESTIONS[normalizedProvider] || []);

  const seen = new Set();
  return [...managedOptions, ...options].filter((option) => {
    if (!option.value || seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

export function isProviderModelEnabled(provider, model) {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedModel = normalizeModelOverride(model) || getProviderDefaultModel(normalizedProvider);
  if (!isProviderEnabled(normalizedProvider)) return false;
  if (!normalizedModel) return true;
  const managed = managementSnapshot?.providers?.find((entry) => entry.id === normalizedProvider);
  if (!managed) return true;
  const record = managed.models?.find((entry) => entry.id === normalizedModel);
  if (!record) return managementSnapshot?.enforceApprovedModels !== true;
  return record.approval === 'approved' && record.enabled !== false;
}

export function hasCustomModelOverride(provider, model) {
  const normalizedModel = normalizeModelOverride(model);
  if (!normalizedModel) return false;
  return normalizedModel !== getProviderDefaultModel(provider);
}

export function getProviderTransport(provider) {
  return getProviderMeta(provider)?.transport || 'claude';
}

export function getProviderFamily(provider) {
  return getProviderMeta(provider)?.family || 'claude';
}

export function providerSupportsCodexServiceTier(provider) {
  return getProviderTransport(provider) === 'codex' || getProviderFamily(provider) === 'codex';
}

export function normalizeCodexServiceTier(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'priority') return 'fast';
  return CODEX_SERVICE_TIER_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : DEFAULT_CODEX_SERVICE_TIER;
}

export function getSelectableProviderIds() {
  return [...SELECTABLE_PROVIDER_IDS];
}

export function getAllowedEfforts(providerOrFamily) {
  return [...getProviderCapabilities(providerOrFamily).allowedEfforts];
}

export function getReasoningEffortOptions(providerOrFamily) {
  const allowed = new Set(getAllowedEfforts(providerOrFamily));
  const options = REASONING_EFFORT_OPTIONS.filter((opt) => allowed.has(opt.value));
  return options.length > 0 ? options : REASONING_EFFORT_OPTIONS;
}

export function getSupportsThinking(provider) {
  return getProviderCapabilities(provider).supportsThinking;
}

export function getReasoningVisibility(provider) {
  return getProviderCapabilities(provider).reasoningVisibility || 'none';
}

export function isAllowedEffort(providerOrFamily, effort) {
  return getAllowedEfforts(providerOrFamily).includes(effort);
}

const PREFERRED_CODEX_FALLBACK = 'codex';
export const PROVIDER_FAMILY = Object.freeze(
  PROVIDER_CATALOG.reduce((acc, entry) => {
    acc[entry.id] = entry.family;
    return acc;
  }, {})
);

/**
 * Returns whether a specific provider supports live thinking/reasoning display.
 * @param {string} providerId
 * @returns {boolean}
 */
export function catalogSupportsThinking(providerId) {
  return getSupportsThinking(providerId);
}

export function catalogReportsReasoningActivity(providerId) {
  const visibility = getReasoningVisibility(providerId);
  return visibility === 'stream' || visibility === 'activity';
}

export const PROVIDER_LABELS = Object.freeze(
  PROVIDER_CATALOG.reduce((acc, entry) => {
    acc[entry.id] = entry.label;
    return acc;
  }, { regex: 'Regex Parser' })
);

export const PROVIDER_SHORT_LABELS = Object.freeze(
  PROVIDER_CATALOG.reduce((acc, entry) => {
    acc[entry.id] = entry.shortLabel || entry.label;
    return acc;
  }, {})
);

export function getProviderLabel(provider) {
  return PROVIDER_LABELS[provider] || PROVIDER_LABELS[DEFAULT_PROVIDER] || 'Claude Default (CLI)';
}

export function getProviderShortLabel(provider) {
  return PROVIDER_SHORT_LABELS[provider] || getProviderLabel(provider);
}

export function isValidProvider(provider) {
  return PROVIDER_IDS.includes(provider);
}

export function normalizeProvider(provider) {
  return isValidProvider(provider) ? provider : DEFAULT_PROVIDER;
}

export function getAlternateProvider(provider) {
  const family = getProviderFamily(provider) || getProviderFamily(DEFAULT_PROVIDER) || 'claude';
  if (family === 'claude') {
    if (PROVIDER_IDS.includes(PREFERRED_CODEX_FALLBACK)) return PREFERRED_CODEX_FALLBACK;
    return PROVIDER_IDS.find((id) => getProviderFamily(id) === 'codex') || DEFAULT_PROVIDER;
  }
  return DEFAULT_PROVIDER;
}

export function isClaudeProvider(provider) {
  return getProviderFamily(provider) === 'claude';
}

export function supportsLiveReasoning(provider) {
  return getSupportsThinking(provider);
}

export function reportsReasoningActivity(provider) {
  return catalogReportsReasoningActivity(provider);
}

export function normalizeReasoningEffort(value, family) {
  if (family) {
    const allowed = getProviderCapabilities(family).allowedEfforts;
    return allowed.includes(value) ? value : DEFAULT_REASONING_EFFORT;
  }
  return REASONING_EFFORT_OPTIONS.some((entry) => entry.value === value)
    ? value
    : DEFAULT_REASONING_EFFORT;
}
