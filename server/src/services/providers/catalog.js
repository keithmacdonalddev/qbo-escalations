'use strict';

const catalog = require('../../../../shared/ai-provider-catalog.json');

const PROVIDER_CATALOG = Object.freeze(
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

const PROVIDER_IDS = Object.freeze(PROVIDER_CATALOG.map((entry) => entry.id));
const SELECTABLE_PROVIDER_IDS = Object.freeze(
  PROVIDER_CATALOG.filter((entry) => entry.selectable !== false).map((entry) => entry.id)
);
const DEFAULT_PROVIDER_ID = PROVIDER_CATALOG.find((entry) => entry.default)?.id || PROVIDER_IDS[0] || 'claude';
const PREFERRED_CODEX_FALLBACK = 'chatgpt-5.3-codex-high';

function buildProviderOption(entry) {
  return {
    id: entry.id,
    value: entry.id,
    label: entry.label,
    shortLabel: entry.shortLabel || entry.label,
    family: entry.family,
    transport: entry.transport,
    model: entry.model || null,
    availabilityNote: entry.availabilityNote || '',
    supportsThinking: typeof entry.supportsThinking === 'boolean' ? entry.supportsThinking : null,
    allowedEfforts: Array.isArray(entry.allowedEfforts) ? [...entry.allowedEfforts] : [],
  };
}

function getDefaultProviderMeta() {
  return PROVIDER_MAP[DEFAULT_PROVIDER_ID] || PROVIDER_CATALOG[0] || null;
}

function resolveProviderMeta(providerOrFamily) {
  if (typeof providerOrFamily === 'string' && providerOrFamily) {
    if (PROVIDER_MAP[providerOrFamily]) return PROVIDER_MAP[providerOrFamily];
    const familyMatch = PROVIDER_CATALOG.find((entry) => entry.family === providerOrFamily);
    if (familyMatch) return familyMatch;
  }
  return getDefaultProviderMeta();
}

function getProviderMeta(providerOrFamily) {
  return resolveProviderMeta(providerOrFamily);
}

function getProviderModelId(providerId) {
  return getProviderMeta(providerId)?.model || null;
}

function getProviderTransport(providerId) {
  return getProviderMeta(providerId)?.transport || 'claude';
}

function getProviderFamily(providerId) {
  return getProviderMeta(providerId)?.family || 'claude';
}

function getProviderLabel(providerId) {
  return getProviderMeta(providerId)?.label || getProviderMeta(DEFAULT_PROVIDER_ID)?.label || 'Claude Default (CLI)';
}

function getProviderShortLabel(providerId) {
  return getProviderMeta(providerId)?.shortLabel || getProviderLabel(providerId);
}

function getProviderOptions() {
  return PROVIDER_CATALOG.filter((entry) => entry.selectable !== false).map(buildProviderOption);
}

function getProviderCapabilities(providerOrFamily) {
  const meta = resolveProviderMeta(providerOrFamily);
  const defaultMeta = getDefaultProviderMeta();
  const allowedEfforts = Array.isArray(meta?.allowedEfforts) && meta.allowedEfforts.length > 0
    ? [...meta.allowedEfforts]
    : Array.isArray(defaultMeta?.allowedEfforts) && defaultMeta.allowedEfforts.length > 0
      ? [...defaultMeta.allowedEfforts]
      : ['low', 'medium', 'high'];

  return {
    providerId: meta?.id || DEFAULT_PROVIDER_ID,
    label: getProviderLabel(providerOrFamily),
    shortLabel: getProviderShortLabel(providerOrFamily),
    family: getProviderFamily(providerOrFamily),
    transport: getProviderTransport(providerOrFamily),
    model: getProviderModelId(providerOrFamily),
    supportsThinking: typeof meta?.supportsThinking === 'boolean'
      ? meta.supportsThinking
      : typeof defaultMeta?.supportsThinking === 'boolean'
        ? defaultMeta.supportsThinking
        : false,
    allowedEfforts,
    alternateProvider: getAlternateProvider(providerOrFamily),
  };
}

function isValidProvider(providerId) {
  return Boolean(providerId && typeof providerId === 'string' && PROVIDER_MAP[providerId]);
}

function normalizeProvider(providerId) {
  return isValidProvider(providerId) ? providerId : DEFAULT_PROVIDER_ID;
}

function getAlternateProvider(providerId) {
  const family = getProviderFamily(providerId);
  if (family === 'claude') {
    return isValidProvider(PREFERRED_CODEX_FALLBACK) ? PREFERRED_CODEX_FALLBACK : PROVIDER_IDS.find((id) => getProviderFamily(id) === 'codex') || DEFAULT_PROVIDER_ID;
  }
  return DEFAULT_PROVIDER_ID;
}

function getClaudeProviderIds() {
  return PROVIDER_IDS.filter((id) => getProviderFamily(id) === 'claude');
}

function getCodexProviderIds() {
  return PROVIDER_IDS.filter((id) => getProviderFamily(id) === 'codex');
}

function getSelectableProviderIds() {
  return [...SELECTABLE_PROVIDER_IDS];
}

function isSelectableProvider(providerId) {
  return SELECTABLE_PROVIDER_IDS.includes(providerId);
}

function getAllowedEfforts(providerId) {
  return [...getProviderCapabilities(providerId).allowedEfforts];
}

function getSupportsThinking(providerId) {
  return getProviderCapabilities(providerId).supportsThinking;
}

function isAllowedEffort(providerId, effort) {
  return getProviderCapabilities(providerId).allowedEfforts.includes(effort);
}

module.exports = {
  PROVIDER_CATALOG,
  PROVIDER_IDS,
  SELECTABLE_PROVIDER_IDS,
  DEFAULT_PROVIDER_ID,
  getProviderMeta,
  getProviderModelId,
  getProviderTransport,
  getProviderFamily,
  getProviderLabel,
  getProviderShortLabel,
  getProviderOptions,
  isValidProvider,
  normalizeProvider,
  getAlternateProvider,
  getProviderCapabilities,
  getClaudeProviderIds,
  getCodexProviderIds,
  getSelectableProviderIds,
  isSelectableProvider,
  getAllowedEfforts,
  getSupportsThinking,
  isAllowedEffort,
};
