import catalog from '../../../shared/ai-provider-catalog.json';

export const PROVIDER_CATALOG = Object.freeze(
  [...catalog]
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((entry) => Object.freeze({ ...entry }))
);

export const PROVIDER_OPTIONS = Object.freeze(
  PROVIDER_CATALOG
    .filter((entry) => entry.selectable !== false)
    .map((entry) => ({
    value: entry.id,
    label: entry.label,
    shortLabel: entry.shortLabel || entry.label,
    family: entry.family,
    transport: entry.transport,
    model: entry.model || null,
    availabilityNote: entry.availabilityNote || null,
  }))
);

export const PROVIDER_IDS = Object.freeze(PROVIDER_OPTIONS.map((entry) => entry.value));
export const DEFAULT_PROVIDER = PROVIDER_CATALOG.find((entry) => entry.default)?.id || PROVIDER_IDS[0] || 'claude';
export const DEFAULT_REASONING_EFFORT = 'high';
export const REASONING_EFFORT_OPTIONS = Object.freeze([
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
]);

/* Family-specific effort levels derived from catalog allowedEfforts field */
const FAMILY_EFFORT_MAP = (() => {
  const map = {};
  for (const entry of catalog) {
    const f = entry.family;
    if (!map[f] && Array.isArray(entry.allowedEfforts)) {
      map[f] = Object.freeze(
        REASONING_EFFORT_OPTIONS.filter((opt) => entry.allowedEfforts.includes(opt.value))
      );
    }
  }
  return Object.freeze(map);
})();

/**
 * Return the allowed reasoning-effort options for a given provider family.
 * Falls back to the full REASONING_EFFORT_OPTIONS list for unknown families.
 * @param {string} family - 'claude' | 'codex' | etc.
 * @returns {ReadonlyArray<{value:string, label:string}>}
 */
export function getReasoningEffortOptions(family) {
  return FAMILY_EFFORT_MAP[family] || REASONING_EFFORT_OPTIONS;
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
 * Reads the supportsThinking field from the catalog entry.
 * @param {string} providerId
 * @returns {boolean}
 */
export function catalogSupportsThinking(providerId) {
  const entry = PROVIDER_CATALOG.find((e) => e.id === providerId);
  if (entry && typeof entry.supportsThinking === 'boolean') return entry.supportsThinking;
  // Fallback: claude family supports thinking
  return PROVIDER_FAMILY[providerId] === 'claude';
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
  const family = PROVIDER_FAMILY[provider] || PROVIDER_FAMILY[DEFAULT_PROVIDER] || 'claude';
  if (family === 'claude') {
    if (PROVIDER_IDS.includes(PREFERRED_CODEX_FALLBACK)) return PREFERRED_CODEX_FALLBACK;
    return PROVIDER_IDS.find((id) => PROVIDER_FAMILY[id] === 'codex') || DEFAULT_PROVIDER;
  }
  return DEFAULT_PROVIDER;
}

export function isClaudeProvider(provider) {
  return (PROVIDER_FAMILY[provider] || PROVIDER_FAMILY[DEFAULT_PROVIDER] || 'claude') === 'claude';
}

export function supportsLiveReasoning(provider) {
  return isClaudeProvider(provider);
}

export function normalizeReasoningEffort(value, family) {
  if (family) {
    const allowed = getReasoningEffortOptions(family);
    return allowed.some((entry) => entry.value === value) ? value : DEFAULT_REASONING_EFFORT;
  }
  return REASONING_EFFORT_OPTIONS.some((entry) => entry.value === value)
    ? value
    : DEFAULT_REASONING_EFFORT;
}
