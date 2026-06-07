import {
  DEFAULT_PROVIDER,
  DEFAULT_CODEX_SERVICE_TIER,
  DEFAULT_REASONING_EFFORT,
  PROVIDER_OPTIONS,
  PROVIDER_FAMILY,
  getAlternateProvider,
  getProviderDefaultModel,
  getProviderModelPlaceholder,
  getProviderModelSuggestions,
  getProviderShortLabel,
  hasCustomModelOverride,
  normalizeCodexServiceTier,
  normalizeModelOverride,
  normalizeProvider,
  normalizeReasoningEffort,
  providerSupportsCodexServiceTier,
  resolveProviderSelection,
} from './providerCatalog.js';
import {
  DEFAULT_IMAGE_PARSER_MODELS,
  IMAGE_PARSER_MODEL_SUGGESTIONS,
  getImageParserModelPlaceholder,
  normalizeImageParserReasoningEffort,
  resolveImageParserSelection,
} from './imageParserCatalog.js';
import {
  SURFACE_DEFAULTS_APPLIED_EVENT,
  hasStoredPreference,
  normalizeSurfaceFallback,
  readStoredPreference,
  writeStoredPreference,
} from './surfacePreferences.js';

export const AGENT_RUNTIME_DEFINITIONS = Object.freeze([
  {
    id: 'chat',
    agentId: 'chat',
    label: 'QBO Assistant',
    description: 'Main escalation assistant',
    color: '#0a84ff',
    storagePrefix: 'qbo-chat',
    supportsReasoning: true,
  },
  {
    id: 'escalation-template-parser',
    agentId: 'escalation-template-parser',
    label: 'Image Parser',
    description: 'Strict screenshot-to-canonical-template parser',
    color: '#f0b232',
    storagePrefix: 'qbo-escalation-template-parser',
    supportsReasoning: true,
    kind: 'image-parser',
  },
  {
    id: 'triage-agent',
    agentId: 'triage-agent',
    label: 'Triage Agent',
    description: 'Fast category, severity, and next-step triage',
    color: '#ff9f0a',
    storagePrefix: 'qbo-triage-agent',
    supportsReasoning: true,
    defaultProvider: 'lm-studio',
    kind: 'triage',
  },
  {
    id: 'known-issue-search-agent',
    agentId: 'known-issue-search-agent',
    label: 'INV Search Agent',
    description: 'INV lookup, candidate rejection, and no-match confirmation',
    color: '#34c759',
    storagePrefix: 'qbo-known-issue-search-agent',
    supportsReasoning: true,
  },
  {
    id: 'follow-up-chat-parser',
    agentId: 'follow-up-chat-parser',
    label: 'Follow-Up Chat Parser',
    description: 'Verbatim transcript parser for follow-up phone-agent chats',
    color: '#64d2ff',
    storagePrefix: 'qbo-follow-up-chat-parser',
    supportsReasoning: true,
    kind: 'image-parser',
  },
  {
    id: 'workspace',
    agentId: 'workspace',
    label: 'Workspace',
    description: 'Inbox, calendar, and background actions',
    color: '#30d158',
    storagePrefix: 'qbo-workspace',
    supportsReasoning: true,
  },
  {
    id: 'copilot',
    agentId: 'copilot',
    label: 'Copilot',
    description: 'Search, templates, and trend analysis',
    color: '#bf5af2',
    storagePrefix: 'qbo-copilot',
    supportsReasoning: true,
  },
  {
    id: 'image-parser',
    agentId: 'image-analyst',
    label: 'Image Parser',
    description: 'Screenshot and document analysis',
    color: '#f0b232',
    storagePrefix: 'qbo-image-parser',
    supportsReasoning: true,
    kind: 'image-parser',
  },
]);

const RUNTIME_BY_ID = Object.freeze(
  AGENT_RUNTIME_DEFINITIONS.reduce((acc, definition) => {
    acc[definition.id] = definition;
    acc[definition.agentId] = definition;
    return acc;
  }, {})
);

const RUNTIME_PROVIDER_LABELS = Object.freeze(
  PROVIDER_OPTIONS.reduce((acc, option) => {
    acc[option.value] = option.label;
    return acc;
  }, {})
);

export const TRIAGE_PROVIDER_OPTIONS = PROVIDER_OPTIONS;

function storageKey(prefix, field) {
  return `${prefix}-${field}`;
}

function storageKeysForDefinition(definition) {
  if (!definition?.storagePrefix) return [];
  if (isImageParser(definition)) {
    // Failover is always on for the Image Parser too (Wave 2), so its fallback
    // provider/model storage keys are persisted alongside the primary.
    return [
      storageKey(definition.storagePrefix, 'provider'),
      storageKey(definition.storagePrefix, 'fallback-provider'),
      storageKey(definition.storagePrefix, 'model'),
      storageKey(definition.storagePrefix, 'fallback-model'),
      storageKey(definition.storagePrefix, 'reasoning-effort'),
      storageKey(definition.storagePrefix, 'service-tier'),
    ];
  }
  // Every non-image-parser agent now carries a Primary + Fallback pair, so the
  // fallback storage keys are always present (failover is always on; there is
  // no single-vs-fallback mode toggle anymore). `mode` is retained only so a
  // 'parallel' selection persisted elsewhere is not orphaned.
  return [
    storageKey(definition.storagePrefix, 'provider'),
    storageKey(definition.storagePrefix, 'mode'),
    storageKey(definition.storagePrefix, 'fallback-provider'),
    storageKey(definition.storagePrefix, 'model'),
    storageKey(definition.storagePrefix, 'fallback-model'),
    storageKey(definition.storagePrefix, 'reasoning-effort'),
    storageKey(definition.storagePrefix, 'service-tier'),
  ];
}

function cloneState(state) {
  return state ? { ...state } : {};
}

function isImageParser(definition) {
  return definition?.kind === 'image-parser';
}

function isTriage(definition) {
  return definition?.kind === 'triage';
}

function normalizeImageParserProvider(provider) {
  const value = typeof provider === 'string' ? provider.trim() : '';
  if (!value) return '';
  return PROVIDER_OPTIONS.some((option) => option.value === value) ? value : '';
}

function normalizeTriageProvider(provider, fallback = 'lm-studio') {
  const value = typeof provider === 'string' ? provider.trim() : '';
  if (value && PROVIDER_OPTIONS.some((option) => option.value === value)) return value;
  return PROVIDER_OPTIONS.some((option) => option.value === fallback) ? fallback : (PROVIDER_OPTIONS[0]?.value || '');
}

function normalizeProviderModelOverride(provider, model) {
  const normalized = normalizeModelOverride(model);
  if (!hasCustomModelOverride(provider, normalized)) return '';
  return normalized;
}

function getProviderModelSummary(provider, model) {
  const normalized = normalizeModelOverride(model);
  const providerLabel = getProviderShortLabel(provider);
  if (hasCustomModelOverride(provider, normalized)) {
    return `${providerLabel} custom: ${normalized}`;
  }
  return providerLabel || getProviderDefaultModel(provider) || 'auto';
}

function normalizeProviderServiceTier(provider, value) {
  return providerSupportsCodexServiceTier(provider)
    ? normalizeCodexServiceTier(value || DEFAULT_CODEX_SERVICE_TIER)
    : '';
}

function formatServiceTierSummary(serviceTier) {
  if (!serviceTier) return '';
  return serviceTier === 'flex' ? 'flex tier' : 'fast tier';
}

export function getAgentRuntimeDefinition(id) {
  return RUNTIME_BY_ID[String(id || '').trim()] || null;
}

export function getAgentRuntimeDefinitions() {
  return [...AGENT_RUNTIME_DEFINITIONS];
}

export function normalizeAgentRuntimeState(definitionOrId, state = {}) {
  const definition = typeof definitionOrId === 'string'
    ? getAgentRuntimeDefinition(definitionOrId)
    : definitionOrId;
  if (!definition) return {};

  if (isImageParser(definition)) {
    const selection = resolveImageParserSelection(state.provider, state.model);
    const provider = normalizeImageParserProvider(selection.provider);
    // Wave 2 universal failover: the Image Parser now carries a Primary +
    // Fallback pair like every other agent so the operator can pick the backup
    // the engine fails over to. The fallback defaults to a neutral global
    // alternate (the other main engine) when unset and is freely overridable.
    // No use-case/capability filtering — any provider may back up any provider.
    // It is only populated once a primary is selected (an empty/disabled parser
    // has no backup to carry).
    const fallbackSelection = resolveImageParserSelection(
      state.fallbackProvider || (provider ? getAlternateProvider(provider) : ''),
      state.fallbackModel
    );
    const fallbackProvider = provider
      ? normalizeSurfaceFallback(provider, normalizeImageParserProvider(fallbackSelection.provider))
      : '';
    return {
      provider,
      model: normalizeModelOverride(selection.model),
      fallbackProvider,
      fallbackModel: fallbackProvider === normalizeImageParserProvider(fallbackSelection.provider)
        ? normalizeModelOverride(fallbackSelection.model)
        : '',
      reasoningEffort: normalizeImageParserReasoningEffort(provider, state.reasoningEffort),
      serviceTier: normalizeProviderServiceTier(provider, state.serviceTier),
    };
  }

  if (isTriage(definition)) {
    const provider = normalizeTriageProvider(state.provider, definition.defaultProvider || 'lm-studio');
    const primarySelection = resolveProviderSelection(provider, state.model);
    const providerFamily = PROVIDER_FAMILY[provider] || 'claude';
    // Wave 2 universal failover: Triage now carries a Primary + Fallback pair
    // like every other agent so the operator can pick the backup the engine
    // fails over to before the deterministic rule-card fallback. The fallback
    // defaults to a neutral global alternate when unset and is overridable. No
    // use-case/capability filtering — any provider may back up any provider.
    const fallbackSelection = resolveProviderSelection(
      state.fallbackProvider || getAlternateProvider(provider),
      state.fallbackModel
    );
    const fallbackProvider = normalizeSurfaceFallback(provider, fallbackSelection.provider);
    return {
      provider,
      mode: 'fallback',
      fallbackProvider,
      model: normalizeProviderModelOverride(provider, primarySelection.model),
      fallbackModel: fallbackProvider === fallbackSelection.provider
        ? normalizeProviderModelOverride(fallbackProvider, fallbackSelection.model)
        : '',
      reasoningEffort: normalizeReasoningEffort(
        state.reasoningEffort || DEFAULT_REASONING_EFFORT,
        providerFamily
      ),
      serviceTier: normalizeProviderServiceTier(provider, state.serviceTier),
    };
  }

  // Every conversational/orchestrated agent now always carries a Primary +
  // Fallback pair — failover is always on and there is no single-vs-fallback
  // mode toggle. The fallback defaults to a neutral global alternate (the other
  // main engine) when the user has not picked one, and is freely overridable.
  // No use-case/capability filtering is applied to which provider may back up
  // which: any provider can be the primary and any provider can be the fallback.
  const primarySelection = resolveProviderSelection(state.provider || DEFAULT_PROVIDER, state.model);
  const provider = primarySelection.provider;
  // `mode` is retained only as a marker so a 'parallel' selection persisted by
  // another surface is preserved round-trip. It no longer gates the fallback.
  const mode = state.mode === 'parallel' ? 'parallel' : 'fallback';
  const fallbackSelection = resolveProviderSelection(
    state.fallbackProvider || getAlternateProvider(provider),
    state.fallbackModel
  );
  const fallbackProvider = normalizeSurfaceFallback(provider, fallbackSelection.provider);
  const providerFamily = PROVIDER_FAMILY[provider] || 'claude';
  const reasoningEffort = normalizeReasoningEffort(
    state.reasoningEffort || DEFAULT_REASONING_EFFORT,
    providerFamily
  );

  return {
    provider,
    mode,
    fallbackProvider,
    model: normalizeProviderModelOverride(provider, primarySelection.model),
    fallbackModel: fallbackProvider === fallbackSelection.provider
      ? normalizeProviderModelOverride(fallbackProvider, fallbackSelection.model)
      : '',
    reasoningEffort,
    serviceTier: providerSupportsCodexServiceTier(provider) || providerSupportsCodexServiceTier(fallbackProvider)
      ? normalizeCodexServiceTier(state.serviceTier || DEFAULT_CODEX_SERVICE_TIER)
      : '',
  };
}

export function readAgentRuntimeState(definitionOrId) {
  const definition = typeof definitionOrId === 'string'
    ? getAgentRuntimeDefinition(definitionOrId)
    : definitionOrId;
  if (!definition) return {};

  const { storagePrefix } = definition;
  if (isImageParser(definition)) {
    return normalizeAgentRuntimeState(definition, {
      provider: readStoredPreference(storageKey(storagePrefix, 'provider')) || '',
      fallbackProvider: readStoredPreference(storageKey(storagePrefix, 'fallback-provider')) || '',
      model: readStoredPreference(storageKey(storagePrefix, 'model')) || '',
      fallbackModel: readStoredPreference(storageKey(storagePrefix, 'fallback-model')) || '',
      reasoningEffort: readStoredPreference(storageKey(storagePrefix, 'reasoning-effort')) || '',
      serviceTier: readStoredPreference(storageKey(storagePrefix, 'service-tier')) || DEFAULT_CODEX_SERVICE_TIER,
    });
  }

  const provider = readStoredPreference(storageKey(storagePrefix, 'provider')) || definition.defaultProvider || DEFAULT_PROVIDER;
  const fallbackProvider = readStoredPreference(storageKey(storagePrefix, 'fallback-provider'))
    || getAlternateProvider(provider);

  return normalizeAgentRuntimeState(definition, {
    provider,
    mode: readStoredPreference(storageKey(storagePrefix, 'mode')) || '',
    fallbackProvider,
    model: readStoredPreference(storageKey(storagePrefix, 'model')) || '',
    fallbackModel: readStoredPreference(storageKey(storagePrefix, 'fallback-model')) || '',
    reasoningEffort: readStoredPreference(storageKey(storagePrefix, 'reasoning-effort')) || DEFAULT_REASONING_EFFORT,
    serviceTier: readStoredPreference(storageKey(storagePrefix, 'service-tier')) || DEFAULT_CODEX_SERVICE_TIER,
  });
}

export function writeAgentRuntimeState(definitionOrId, state = {}) {
  const definition = typeof definitionOrId === 'string'
    ? getAgentRuntimeDefinition(definitionOrId)
    : definitionOrId;
  if (!definition) return {};

  const normalized = normalizeAgentRuntimeState(definition, state);
  const { storagePrefix } = definition;

  if (isImageParser(definition)) {
    writeStoredPreference(storageKey(storagePrefix, 'provider'), normalized.provider);
    writeStoredPreference(storageKey(storagePrefix, 'fallback-provider'), normalized.fallbackProvider);
    writeStoredPreference(storageKey(storagePrefix, 'model'), normalized.model);
    writeStoredPreference(storageKey(storagePrefix, 'fallback-model'), normalized.fallbackModel);
    writeStoredPreference(storageKey(storagePrefix, 'reasoning-effort'), normalized.reasoningEffort);
    writeStoredPreference(storageKey(storagePrefix, 'service-tier'), normalized.serviceTier);
    return normalized;
  }

  // Failover is always on for these agents, so the fallback provider/model (and
  // the retained `mode` marker) are always persisted alongside the primary.
  writeStoredPreference(storageKey(storagePrefix, 'provider'), normalized.provider);
  writeStoredPreference(storageKey(storagePrefix, 'mode'), normalized.mode);
  writeStoredPreference(storageKey(storagePrefix, 'fallback-provider'), normalized.fallbackProvider);
  writeStoredPreference(storageKey(storagePrefix, 'model'), normalized.model);
  writeStoredPreference(storageKey(storagePrefix, 'fallback-model'), normalized.fallbackModel);
  writeStoredPreference(storageKey(storagePrefix, 'reasoning-effort'), normalized.reasoningEffort);
  writeStoredPreference(storageKey(storagePrefix, 'service-tier'), normalized.serviceTier);

  return normalized;
}

export function hasStoredAgentRuntimeState(definitionOrId) {
  const definition = typeof definitionOrId === 'string'
    ? getAgentRuntimeDefinition(definitionOrId)
    : definitionOrId;
  return Boolean(definition && hasStoredPreference(storageKeysForDefinition(definition)));
}

export function hasStoredAgentRuntimeDefaults() {
  return AGENT_RUNTIME_DEFINITIONS.some((definition) => hasStoredAgentRuntimeState(definition));
}

export function readAllAgentRuntimeStatesByAgentId() {
  return Object.fromEntries(
    AGENT_RUNTIME_DEFINITIONS.map((definition) => [
      definition.agentId,
      readAgentRuntimeState(definition),
    ])
  );
}

function readRuntimeStateWithMetadata(definition, options = {}) {
  const state = readAgentRuntimeState(definition);
  if (!options.includeConfigured) return state;
  return {
    ...state,
    configured: hasStoredAgentRuntimeState(definition),
  };
}

export function readAllAgentRuntimeStatesBySurfaceId(options = {}) {
  return Object.fromEntries(
    AGENT_RUNTIME_DEFINITIONS.map((definition) => [
      definition.id,
      readRuntimeStateWithMetadata(definition, options),
    ])
  );
}

export function dispatchAgentRuntimeDefaultsApplied(statesById) {
  if (typeof window === 'undefined') return;

  const source = statesById && typeof statesById === 'object'
    ? statesById
    : readAllAgentRuntimeStatesBySurfaceId();
  const surfaces = {};

  for (const [key, state] of Object.entries(source)) {
    const definition = getAgentRuntimeDefinition(key);
    if (!definition) continue;
    surfaces[definition.id] = normalizeAgentRuntimeState(definition, cloneState(state));
  }

  window.dispatchEvent(new CustomEvent(SURFACE_DEFAULTS_APPLIED_EVENT, {
    detail: { surfaces },
  }));
}

export function getAgentRuntimeProviderLabel(definitionOrId, state = {}, options = {}) {
  const definition = typeof definitionOrId === 'string'
    ? getAgentRuntimeDefinition(definitionOrId)
    : definitionOrId;
  if (!definition) return '';
  const normalized = normalizeAgentRuntimeState(definition, state);

  if (isImageParser(definition)) {
    if (!normalized.provider) return 'Disabled';
    const target = options.fallback ? normalized.fallbackProvider : normalized.provider;
    if (!target) return options.fallback ? '' : 'Disabled';
    return RUNTIME_PROVIDER_LABELS[target] || target;
  }
  if (isTriage(definition)) {
    const target = options.fallback ? normalized.fallbackProvider : normalized.provider;
    return RUNTIME_PROVIDER_LABELS[target] || target || '';
  }

  return getProviderShortLabel(options.fallback ? normalized.fallbackProvider : normalized.provider);
}

export function getAgentRuntimeEffectiveModel(definitionOrId, state = {}, options = {}) {
  const definition = typeof definitionOrId === 'string'
    ? getAgentRuntimeDefinition(definitionOrId)
    : definitionOrId;
  if (!definition) return '';
  const normalized = normalizeAgentRuntimeState(definition, state);
  const fallback = Boolean(options.fallback);

  if (isImageParser(definition)) {
    if (!normalized.provider) return '';
    if (fallback) {
      if (!normalized.fallbackProvider) return '';
      return normalized.fallbackModel || DEFAULT_IMAGE_PARSER_MODELS[normalized.fallbackProvider] || 'auto';
    }
    return normalized.model || DEFAULT_IMAGE_PARSER_MODELS[normalized.provider] || 'auto';
  }

  if (fallback) {
    return normalized.fallbackModel || getProviderDefaultModel(normalized.fallbackProvider) || 'auto';
  }

  return normalized.model || getProviderDefaultModel(normalized.provider) || 'auto';
}

export function getAgentRuntimeSummary(definitionOrId, state = {}) {
  const definition = typeof definitionOrId === 'string'
    ? getAgentRuntimeDefinition(definitionOrId)
    : definitionOrId;
  if (!definition) return 'No runtime mapping';
  const normalized = normalizeAgentRuntimeState(definition, state);

  if (isImageParser(definition)) {
    if (!normalized.provider) return 'Image parser disabled';
    const effort = normalized.reasoningEffort ? ` | effort ${normalized.reasoningEffort}` : '';
    const serviceTier = formatServiceTierSummary(normalized.serviceTier);
    const tier = serviceTier ? ` | ${serviceTier}` : '';
    const primary = `${getAgentRuntimeProviderLabel(definition, normalized)}: ${getAgentRuntimeEffectiveModel(definition, normalized)}`;
    // Failover is always on for the Image Parser too, so the summary shows
    // "primary + fallback" whenever a distinct backup is configured.
    if (normalized.fallbackProvider) {
      const backup = `${getAgentRuntimeProviderLabel(definition, normalized, { fallback: true })}: ${getAgentRuntimeEffectiveModel(definition, normalized, { fallback: true })}`;
      return `${primary} + ${backup}${effort}${tier}`;
    }
    return `${primary}${effort}${tier}`;
  }

  const primary = getProviderModelSummary(normalized.provider, normalized.model);
  const serviceTier = formatServiceTierSummary(normalized.serviceTier);
  const tier = serviceTier ? ` | ${serviceTier}` : '';
  // Failover is always on for agents that carry a fallback, so the summary
  // always shows "primary + fallback". Triage (single provider, no fallback)
  // has an empty fallbackProvider and so shows the primary only.
  if (normalized.fallbackProvider) {
    return `${primary} + ${getProviderModelSummary(normalized.fallbackProvider, normalized.fallbackModel)}${tier}`;
  }
  return `${primary}${tier}`;
}

export function getAgentRuntimeModelPlaceholder(definitionOrId, state = {}, options = {}) {
  const definition = typeof definitionOrId === 'string'
    ? getAgentRuntimeDefinition(definitionOrId)
    : definitionOrId;
  if (!definition) return 'Optional model override';
  const normalized = normalizeAgentRuntimeState(definition, state);

  if (isImageParser(definition)) {
    return getImageParserModelPlaceholder(options.fallback ? normalized.fallbackProvider : normalized.provider);
  }

  const provider = options.fallback ? normalized.fallbackProvider : normalized.provider;
  return getProviderModelPlaceholder(provider);
}

export function getAgentRuntimeModelSuggestions(definitionOrId, state = {}, options = {}) {
  const definition = typeof definitionOrId === 'string'
    ? getAgentRuntimeDefinition(definitionOrId)
    : definitionOrId;
  if (!definition) return [];
  const normalized = normalizeAgentRuntimeState(definition, state);

  if (isImageParser(definition)) {
    const target = options.fallback ? normalized.fallbackProvider : normalized.provider;
    return target
      ? IMAGE_PARSER_MODEL_SUGGESTIONS.filter((option) => option.provider === target)
      : IMAGE_PARSER_MODEL_SUGGESTIONS;
  }

  const provider = options.fallback ? normalized.fallbackProvider : normalized.provider;
  return getProviderModelSuggestions(provider);
}
