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
