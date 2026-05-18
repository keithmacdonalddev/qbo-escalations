import { listAgentRuntimeDefaults } from '../../api/agentIdentitiesApi.js';
import {
  normalizeAgentRuntimeState,
  readAgentRuntimeState,
  writeAgentRuntimeState,
} from '../../lib/agentRuntimeSettings.js';

export const PIPELINE_RUNTIME_IDS = Object.freeze({
  parser: 'escalation-template-parser',
  inv: 'known-issue-search-agent',
  triage: 'triage-agent',
  main: 'chat',
});

function hasProvider(runtime) {
  return typeof runtime?.provider === 'string' && runtime.provider.trim().length > 0;
}

function normalizeRuntime(agentId, runtime) {
  if (!runtime || typeof runtime !== 'object') return null;
  const normalized = normalizeAgentRuntimeState(agentId, runtime);
  return hasProvider(normalized) ? normalized : null;
}

function readLocalRuntime(agentId) {
  return readAgentRuntimeState(agentId);
}

function applyProfileRuntime(agentId, runtime, options = {}) {
  const { syncLocal = true } = options;
  const profileRuntime = normalizeRuntime(agentId, runtime);
  if (!profileRuntime) return null;
  return syncLocal ? writeAgentRuntimeState(agentId, profileRuntime) : profileRuntime;
}

async function readProfileRuntimeMap(agentIds, options = {}) {
  try {
    const defaults = await listAgentRuntimeDefaults(agentIds);
    return Object.fromEntries(
      agentIds.map((agentId) => [
        agentId,
        applyProfileRuntime(agentId, defaults?.[agentId]?.runtime, options),
      ])
    );
  } catch {
    return {};
  }
}

export function readPipelineRuntimeStatesSync(overrides = {}) {
  return {
    parser: overrides.parser || readLocalRuntime(PIPELINE_RUNTIME_IDS.parser),
    inv: overrides.inv || readLocalRuntime(PIPELINE_RUNTIME_IDS.inv),
    triage: overrides.triage || readLocalRuntime(PIPELINE_RUNTIME_IDS.triage),
    main: overrides.main || readLocalRuntime(PIPELINE_RUNTIME_IDS.main),
  };
}

export async function readImageParserProfileRuntime(options = {}) {
  const agentId = PIPELINE_RUNTIME_IDS.parser;
  const profiles = await readProfileRuntimeMap([agentId], options);
  return profiles[agentId] || readLocalRuntime(agentId);
}

export async function readPipelineProfileRuntimeStates(options = {}) {
  const local = readPipelineRuntimeStatesSync();
  const profiles = await readProfileRuntimeMap(Object.values(PIPELINE_RUNTIME_IDS), options);
  const entries = Object.entries(PIPELINE_RUNTIME_IDS).map(([stageKey, agentId]) => [
    stageKey,
    profiles[agentId],
  ]);

  return entries.reduce((acc, [stageKey, runtime]) => {
    acc[stageKey] = runtime || acc[stageKey];
    return acc;
  }, local);
}
