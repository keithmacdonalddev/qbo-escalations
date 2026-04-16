import {
  DEFAULT_PROVIDER,
  DEFAULT_REASONING_EFFORT,
  getAlternateProvider,
  normalizeProvider,
  normalizeReasoningEffort,
} from './providerCatalog.js';
import {
  normalizeSurfaceFallback,
  normalizeSurfaceMode,
  readStoredPreference,
} from './surfacePreferences.js';

const ROOM_AGENT_SURFACE_CONFIG = Object.freeze({
  chat: {
    storagePrefix: 'qbo-chat',
    defaultMode: 'single',
    supportedModes: ['single', 'fallback'],
  },
  copilot: {
    storagePrefix: 'qbo-copilot',
    defaultMode: 'fallback',
    supportedModes: ['single', 'fallback'],
  },
  workspace: {
    storagePrefix: 'qbo-workspace',
    defaultMode: 'fallback',
    supportedModes: ['single', 'fallback'],
  },
  'image-analyst': {
    storagePrefix: 'qbo-image-parser',
    defaultMode: 'single',
    supportedModes: ['single'],
    reasoningEffort: 'medium',
    providerOptional: true,
  },
});

function storageKey(prefix, field) {
  return `${prefix}-${field}`;
}

function readAgentSelection(agentId, config) {
  const providerRaw = readStoredPreference(storageKey(config.storagePrefix, 'provider'));
  const provider = providerRaw
    ? normalizeProvider(providerRaw)
    : (config.providerOptional ? '' : DEFAULT_PROVIDER);
  const model = readStoredPreference(storageKey(config.storagePrefix, 'model')) || '';

  if (config.providerOptional && !provider && !model) {
    return null;
  }

  const mode = normalizeSurfaceMode(
    readStoredPreference(storageKey(config.storagePrefix, 'mode')) || config.defaultMode,
    config.supportedModes,
    config.defaultMode
  );
  const fallbackProvider = normalizeSurfaceFallback(
    provider || DEFAULT_PROVIDER,
    readStoredPreference(storageKey(config.storagePrefix, 'fallback-provider')) || getAlternateProvider(provider || DEFAULT_PROVIDER)
  );
  const fallbackModel = readStoredPreference(storageKey(config.storagePrefix, 'fallback-model')) || '';
  const reasoningEffort = normalizeReasoningEffort(
    config.reasoningEffort || readStoredPreference(storageKey(config.storagePrefix, 'reasoning-effort')) || DEFAULT_REASONING_EFFORT
  );

  return {
    provider,
    model,
    mode,
    fallbackProvider,
    fallbackModel,
    reasoningEffort,
  };
}

export function readRoomAgentRuntimeSelections() {
  const selections = {};

  for (const [agentId, config] of Object.entries(ROOM_AGENT_SURFACE_CONFIG)) {
    const selection = readAgentSelection(agentId, config);
    if (selection) {
      selections[agentId] = selection;
    }
  }

  return selections;
}
