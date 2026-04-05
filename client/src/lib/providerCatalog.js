import catalog from '../../../shared/ai-provider-catalog.json';

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
  return {
    id: entry.id,
    value: entry.id,
    label: entry.label,
    shortLabel: entry.shortLabel || entry.label,
    family: entry.family,
    transport: entry.transport,
    model: entry.model || null,
    availabilityNote: entry.availabilityNote || null,
    supportsThinking: typeof entry.supportsThinking === 'boolean' ? entry.supportsThinking : null,
    allowedEfforts: Array.isArray(entry.allowedEfforts) ? [...entry.allowedEfforts] : [],
  };
}

export function getProviderOptions() {
  return PROVIDER_CATALOG
    .filter((entry) => entry.selectable !== false)
    .map(buildProviderOption);
}

export const PROVIDER_OPTIONS = Object.freeze(getProviderOptions());

export const PROVIDER_IDS = Object.freeze(PROVIDER_OPTIONS.map((entry) => entry.value));
export const SELECTABLE_PROVIDER_IDS = Object.freeze([...PROVIDER_IDS]);
export const DEFAULT_PROVIDER = PROVIDER_CATALOG.find((entry) => entry.default)?.id || PROVIDER_IDS[0] || 'claude';
export const DEFAULT_REASONING_EFFORT = 'high';
export const REASONING_EFFORT_OPTIONS = Object.freeze([
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
]);

const EXTRA_MODEL_SUGGESTIONS = Object.freeze({
  'llm-gateway': Object.freeze([
    { value: 'auto', label: 'Auto-detect' },
  ]),
  anthropic: Object.freeze([
    { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
  ]),
  openai: Object.freeze([
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'o3', label: 'o3' },
  ]),
  gemini: Object.freeze([
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  ]),
  kimi: Object.freeze([
    { value: 'kimi-k2.5', label: 'Kimi K2.5' },
  ]),
});

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
    supportsThinking: typeof meta?.supportsThinking === 'boolean'
      ? meta.supportsThinking
      : typeof defaultMeta?.supportsThinking === 'boolean'
        ? defaultMeta.supportsThinking
        : false,
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
    .filter((entry) => entry.model && (entry.id === normalizedProvider || entry.family === family))
    .map((entry) => ({
      value: entry.model,
      label: entry.label,
      provider: entry.id,
    }));
  const extraOptions = (EXTRA_MODEL_SUGGESTIONS[normalizedProvider] || []).map((entry) => ({
    ...entry,
    provider: normalizedProvider,
  }));

  const seen = new Set();
  return [...options, ...extraOptions].filter((option) => {
    if (!option.value || seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
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

export function isAllowedEffort(providerOrFamily, effort) {
  return getAllowedEfforts(providerOrFamily).includes(effort);
}

const PREFERRED_CODEX_FALLBACK = 'chatgpt-5.3-codex-high';
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

export function normalizeReasoningEffort(value, family) {
  if (family) {
    const allowed = getProviderCapabilities(family).allowedEfforts;
    return allowed.includes(value) ? value : DEFAULT_REASONING_EFFORT;
  }
  return REASONING_EFFORT_OPTIONS.some((entry) => entry.value === value)
    ? value
    : DEFAULT_REASONING_EFFORT;
}
