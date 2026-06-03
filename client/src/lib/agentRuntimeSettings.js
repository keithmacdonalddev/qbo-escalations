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
  normalizeSurfaceMode,
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
    supportsModes: true,
    supportsReasoning: true,
    defaultMode: 'single',
    supportedModes: ['single', 'fallback'],
  },
  {
    id: 'escalation-template-parser',
    agentId: 'escalation-template-parser',
    label: 'Image Parser',
    description: 'Strict screenshot-to-canonical-template parser',
    color: '#f0b232',
    storagePrefix: 'qbo-escalation-template-parser',
    supportsModes: false,
    supportsReasoning: true,
    defaultMode: 'single',
    supportedModes: ['single'],
    kind: 'image-parser',
  },
  {
    id: 'triage-agent',
    agentId: 'triage-agent',
    label: 'Triage Agent',
    description: 'Fast category, severity, and next-step triage',
    color: '#ff9f0a',
    storagePrefix: 'qbo-triage-agent',
    supportsModes: false,
    supportsReasoning: true,
    defaultMode: 'single',
    supportedModes: ['single'],
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
    supportsModes: true,
    supportsReasoning: true,
    defaultMode: 'single',
    supportedModes: ['single', 'fallback'],
  },
  {
    id: 'follow-up-chat-parser',
    agentId: 'follow-up-chat-parser',
    label: 'Follow-Up Chat Parser',
    description: 'Verbatim transcript parser for follow-up phone-agent chats',
    color: '#64d2ff',
    storagePrefix: 'qbo-follow-up-chat-parser',
    supportsModes: false,
    supportsReasoning: true,
    defaultMode: 'single',
    supportedModes: ['single'],
    kind: 'image-parser',
  },
  {
    id: 'workspace',
    agentId: 'workspace',
    label: 'Workspace',
    description: 'Inbox, calendar, and background actions',
    color: '#30d158',
    storagePrefix: 'qbo-workspace',
    supportsModes: true,
    supportsReasoning: true,
    defaultMode: 'fallback',
    supportedModes: ['single', 'fallback'],
  },
  {
    id: 'copilot',
    agentId: 'copilot',
    label: 'Copilot',
    description: 'Search, templates, and trend analysis',
    color: '#bf5af2',
    storagePrefix: 'qbo-copilot',
    supportsModes: true,
    supportsReasoning: true,
    defaultMode: 'fallback',
    supportedModes: ['single', 'fallback'],
  },
  {
    id: 'image-parser',
    agentId: 'image-analyst',
    label: 'Image Parser',
    description: 'Screenshot and document analysis',
    color: '#f0b232',
    storagePrefix: 'qbo-image-parser',
    supportsModes: false,
    supportsReasoning: true,
    defaultMode: 'single',
    supportedModes: ['single'],
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
    return [
      storageKey(definition.storagePrefix, 'provider'),
      storageKey(definition.storagePrefix, 'model'),
      storageKey(definition.storagePrefix, 'reasoning-effort'),
      storageKey(definition.storagePrefix, 'service-tier'),
    ];
  }
  const keys = [
    storageKey(definition.storagePrefix, 'provider'),
    storageKey(definition.storagePrefix, 'model'),
    storageKey(definition.storagePrefix, 'reasoning-effort'),
    storageKey(definition.storagePrefix, 'service-tier'),
  ];
  if (definition.supportsModes) {
    keys.splice(1, 0, storageKey(definition.storagePrefix, 'mode'));
    keys.splice(2, 0, storageKey(definition.storagePrefix, 'fallback-provider'));
    keys.splice(4, 0, storageKey(definition.storagePrefix, 'fallback-model'));
  }
  return keys;
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
    return {
      provider,
      model: normalizeModelOverride(selection.model),
      reasoningEffort: normalizeImageParserReasoningEffort(provider, state.reasoningEffort),
      serviceTier: normalizeProviderServiceTier(provider, state.serviceTier),
    };
  }

  if (isTriage(definition)) {
    const provider = normalizeTriageProvider(state.provider, definition.defaultProvider || 'lm-studio');
    const primarySelection = resolveProviderSelection(provider, state.model);
    const providerFamily = PROVIDER_FAMILY[provider] || 'claude';
    return {
      provider,
      mode: 'single',
      fallbackProvider: '',
      model: normalizeProviderModelOverride(provider, primarySelection.model),
      fallbackModel: '',
      reasoningEffort: normalizeReasoningEffort(
        state.reasoningEffort || DEFAULT_REASONING_EFFORT,
        providerFamily
      ),
      serviceTier: normalizeProviderServiceTier(provider, state.serviceTier),
    };
  }

  const primarySelection = resolveProviderSelection(state.provider || DEFAULT_PROVIDER, state.model);
  const provider = primarySelection.provider;
  const mode = definition.supportsModes
    ? normalizeSurfaceMode(
        state.mode || definition.defaultMode,
        definition.supportedModes,
        definition.defaultMode
      )
    : 'single';
  const fallbackSelection = resolveProviderSelection(
    state.fallbackProvider || getAlternateProvider(provider),
    state.fallbackModel
  );
  const fallbackProvider = definition.supportsModes
    ? normalizeSurfaceFallback(provider, fallbackSelection.provider)
    : '';
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
    fallbackModel: definition.supportsModes && fallbackProvider === fallbackSelection.provider
      ? normalizeProviderModelOverride(fallbackProvider, fallbackSelection.model)
      : '',
    reasoningEffort,
    serviceTier: providerSupportsCodexServiceTier(provider) || (definition.supportsModes && providerSupportsCodexServiceTier(fallbackProvider))
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
      model: readStoredPreference(storageKey(storagePrefix, 'model')) || '',
      reasoningEffort: readStoredPreference(storageKey(storagePrefix, 'reasoning-effort')) || '',
      serviceTier: readStoredPreference(storageKey(storagePrefix, 'service-tier')) || DEFAULT_CODEX_SERVICE_TIER,
    });
  }

  const provider = readStoredPreference(storageKey(storagePrefix, 'provider')) || definition.defaultProvider || DEFAULT_PROVIDER;
  const fallbackProvider = readStoredPreference(storageKey(storagePrefix, 'fallback-provider'))
    || getAlternateProvider(provider);

  return normalizeAgentRuntimeState(definition, {
    provider,
    mode: readStoredPreference(storageKey(storagePrefix, 'mode')) || definition.defaultMode,
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
    writeStoredPreference(storageKey(storagePrefix, 'model'), normalized.model);
    writeStoredPreference(storageKey(storagePrefix, 'reasoning-effort'), normalized.reasoningEffort);
    writeStoredPreference(storageKey(storagePrefix, 'service-tier'), normalized.serviceTier);
    return normalized;
  }

  writeStoredPreference(storageKey(storagePrefix, 'provider'), normalized.provider);
  if (definition.supportsModes) {
    writeStoredPreference(storageKey(storagePrefix, 'mode'), normalized.mode);
    writeStoredPreference(storageKey(storagePrefix, 'fallback-provider'), normalized.fallbackProvider);
  }
  writeStoredPreference(storageKey(storagePrefix, 'model'), normalized.model);
  if (definition.supportsModes) {
    writeStoredPreference(storageKey(storagePrefix, 'fallback-model'), normalized.fallbackModel);
  }
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

export function getAgentRuntimeProviderLabel(definitionOrId, state = {}) {
  const definition = typeof definitionOrId === 'string'
    ? getAgentRuntimeDefinition(definitionOrId)
    : definitionOrId;
  if (!definition) return '';
  const normalized = normalizeAgentRuntimeState(definition, state);

  if (isImageParser(definition)) {
    if (!normalized.provider) return 'Disabled';
    return RUNTIME_PROVIDER_LABELS[normalized.provider] || normalized.provider;
  }
  if (isTriage(definition)) {
    return RUNTIME_PROVIDER_LABELS[normalized.provider] || normalized.provider;
  }

  return getProviderShortLabel(normalized.provider);
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
    return `${getAgentRuntimeProviderLabel(definition, normalized)}: ${getAgentRuntimeEffectiveModel(definition, normalized)}${effort}${tier}`;
  }

  const primary = getProviderModelSummary(normalized.provider, normalized.model);
  const serviceTier = formatServiceTierSummary(normalized.serviceTier);
  const tier = serviceTier ? ` | ${serviceTier}` : '';
  if (normalized.mode === 'fallback') {
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
    return getImageParserModelPlaceholder(normalized.provider);
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
    return normalized.provider
      ? IMAGE_PARSER_MODEL_SUGGESTIONS.filter((option) => option.provider === normalized.provider)
      : IMAGE_PARSER_MODEL_SUGGESTIONS;
  }

  const provider = options.fallback ? normalized.fallbackProvider : normalized.provider;
  return getProviderModelSuggestions(provider);
}
