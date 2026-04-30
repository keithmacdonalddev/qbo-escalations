import { apiFetchJson } from '../api/http.js';
import { normalizeAiSettings } from './aiSettingsStore.js';
import {
  AGENT_RUNTIME_DEFINITIONS,
  dispatchAgentRuntimeDefaultsApplied,
  normalizeAgentRuntimeState,
  writeAgentRuntimeState,
} from './agentRuntimeSettings.js';

const PREFERENCES_ENDPOINT = '/api/preferences';

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeAgentRuntimeDefaults(rawAgents) {
  if (!isObject(rawAgents)) return null;
  return Object.fromEntries(
    AGENT_RUNTIME_DEFINITIONS.map((definition) => {
      const rawState = rawAgents[definition.id] || rawAgents[definition.agentId] || {};
      return [definition.id, normalizeAgentRuntimeState(definition, rawState)];
    })
  );
}

export function normalizeAiAssistantDefaults(rawDefaults) {
  if (!isObject(rawDefaults)) return null;

  const settingsSource = rawDefaults.settings || rawDefaults.aiSettings || null;
  const agentsSource = rawDefaults.agents || rawDefaults.agentRuntime || rawDefaults.surfaces || null;
  const normalized = {};

  if (isObject(settingsSource)) {
    normalized.settings = normalizeAiSettings(settingsSource);
  }

  const agents = normalizeAgentRuntimeDefaults(agentsSource);
  if (agents) {
    normalized.agents = agents;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

export async function loadAiAssistantDefaultsFromServer() {
  const data = await apiFetchJson(PREFERENCES_ENDPOINT, {}, 'Could not load preferences');
  return normalizeAiAssistantDefaults(data?.aiAssistantDefaults);
}

export async function syncAiAssistantDefaultsToServer(defaults) {
  const normalized = normalizeAiAssistantDefaults(defaults);
  if (!normalized) return null;

  const data = await apiFetchJson(PREFERENCES_ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aiAssistantDefaults: normalized }),
  }, 'Could not save AI defaults');

  return normalizeAiAssistantDefaults(data?.aiAssistantDefaults) || normalized;
}

export function applyAgentRuntimeDefaults(agents) {
  const normalized = normalizeAgentRuntimeDefaults(agents);
  if (!normalized) return null;

  AGENT_RUNTIME_DEFINITIONS.forEach((definition) => {
    writeAgentRuntimeState(definition, normalized[definition.id]);
  });
  dispatchAgentRuntimeDefaultsApplied(normalized);
  return normalized;
}
