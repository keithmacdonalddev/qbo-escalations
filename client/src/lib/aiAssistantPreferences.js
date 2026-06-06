import { apiFetchJson } from '../api/http.js';
import { listAgentRuntimeDefaults } from '../api/agentIdentitiesApi.js';
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

// LEGACY: seeds localStorage agent runtime from the `UserPreferences`
// (aiAssistantDefaults.agents) store. That store is NOT on the runtime path —
// nothing reads it to pick a provider/model — so seeding from it could silently
// stomp the authoritative AgentIdentity.runtime values that AgentsView saved.
// Boot hydration now uses `hydrateAgentRuntimeFromIdentities` instead. Retained
// only for any explicit caller that still wants the old behavior.
export function applyAgentRuntimeDefaults(agents) {
  const normalized = normalizeAgentRuntimeDefaults(agents);
  if (!normalized) return null;

  AGENT_RUNTIME_DEFINITIONS.forEach((definition) => {
    writeAgentRuntimeState(definition, normalized[definition.id]);
  });
  dispatchAgentRuntimeDefaultsApplied(normalized);
  return normalized;
}

// AUTHORITATIVE boot hydration. Seeds localStorage agent runtime from the same
// `AgentIdentity.runtime` store that AgentsView writes and the chat / triage /
// INV legs read, so the value the runtime request-body map sends after a reload
// MATCHES what AgentsView last saved. We only overwrite localStorage for agents
// whose server runtime is `configured` (the runtime-defaults endpoint returns
// `runtime: null` otherwise) — an unconfigured agent keeps its local/default
// value rather than being blanked. Mirrors the per-stage hydration the chat-v5
// pipeline already does (pipelineRuntime.readProfileRuntimeMap), generalized to
// every agent definition. Failures are swallowed so a preference read outage
// leaves the existing local settings usable.
export async function hydrateAgentRuntimeFromIdentities() {
  const agentIds = AGENT_RUNTIME_DEFINITIONS.map((definition) => definition.agentId);
  let runtimesByAgentId = {};
  try {
    runtimesByAgentId = await listAgentRuntimeDefaults(agentIds);
  } catch {
    return null;
  }

  const appliedById = {};
  AGENT_RUNTIME_DEFINITIONS.forEach((definition) => {
    const serverRuntime = runtimesByAgentId?.[definition.agentId]?.runtime;
    // `runtime` is null for agents the operator has never configured in the
    // profile page — skip those so we don't overwrite a local selection or
    // a sensible per-agent default with an empty object.
    if (!serverRuntime || typeof serverRuntime !== 'object') return;
    appliedById[definition.id] = writeAgentRuntimeState(definition, serverRuntime);
  });

  if (Object.keys(appliedById).length === 0) return null;

  dispatchAgentRuntimeDefaultsApplied(appliedById);
  return appliedById;
}
