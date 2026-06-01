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

// =============================================================================
// PIPELINE_TOPOLOGY — the single REAL source of truth for how the escalation
// agents connect to one another. This replaces the old fabricated "Workflow
// Footprint" (which sliced a hardcoded AGENT_OPERATION_META.workflows list in
// half and called the halves "inputs"/"outputs"). The shape here describes the
// actual runtime dependency graph used by server/src/routes/chat/send.js:
//
//   Operator screenshot ─▶ Escalation Image Parser (entry; no upstream agent)
//                              │
//                  ┌──────────┴──────────┐   (these two run in PARALLEL,
//                  ▼                     ▼    both fed by the parser output)
//        Known-Issue Search        Triage Agent
//                  └──────────┬──────────┘
//                             ▼
//                       QBO Assistant (final response)
//
// Each node is keyed by its REAL agentId. `upstream`/`downstream` list other
// agentIds (never UI labels). `entry: true` marks the agent fed directly by the
// operator's screenshot rather than by another agent. `parallelWith` records
// the sibling(s) an agent runs concurrently with so the diagram can group them.
// `inputLabel` is an honest description of the non-agent input that enters the
// pipeline here (only the entry node has one). Any agentId NOT present in this
// map is genuinely standalone and must render an honest "not part of the
// escalation pipeline" state instead of a fabricated diagram.
export const PIPELINE_TOPOLOGY = Object.freeze({
  'escalation-template-parser': {
    entry: true,
    inputLabel: 'Operator screenshot',
    upstream: [],
    downstream: ['known-issue-search-agent', 'triage-agent'],
    parallelWith: [],
  },
  'known-issue-search-agent': {
    entry: false,
    upstream: ['escalation-template-parser'],
    downstream: ['chat'],
    parallelWith: ['triage-agent'],
  },
  'triage-agent': {
    entry: false,
    upstream: ['escalation-template-parser'],
    downstream: ['chat'],
    parallelWith: ['known-issue-search-agent'],
  },
  chat: {
    entry: false,
    isFinal: true,
    // VERIFIED DATA FLOW (server/src/routes/chat/send.js): the Assistant's
    // prompt is composed from the parser's structured fields PLUS the INV
    // (known-issue) results PLUS the triage classification. The parser feeds
    // the Assistant DIRECTLY (its context passes straight through), in addition
    // to seeding the two parallel agents — so the parser is a real upstream of
    // the Assistant, not just of the parallel pair. Listing all three keeps the
    // dependency graph honest (the animated pipeline draws a direct
    // parser→Assistant "context" spine alongside the INV/Triage merge because
    // of this edge).
    upstream: ['escalation-template-parser', 'known-issue-search-agent', 'triage-agent'],
    downstream: [],
    parallelWith: [],
  },
});

// Linear order of the pipeline stages, used to derive a "Step N of M" position.
// Note the two parallel agents share the same step number (2) because neither
// runs before the other — they both depend only on the parser and both feed the
// assistant. This keeps the position honest rather than implying a false order.
export const PIPELINE_TOPOLOGY_ORDER = Object.freeze([
  ['escalation-template-parser'],
  ['known-issue-search-agent', 'triage-agent'],
  ['chat'],
]);

// Map a topology agentId to a human display name. Prefers the chat-v5
// STAGE_LABELS (the names already shown in the live pipeline UI) so the diagram
// stays consistent with the running app, then falls back to a title-cased
// agentId. Kept here, beside the topology it labels, so callers import one
// thing. STAGE_LABELS is keyed by stage key (parser/inv/triage/main), so we
// translate agentId -> stage key via PIPELINE_RUNTIME_IDS first.
const AGENT_ID_TO_STAGE_KEY = Object.freeze(
  Object.entries(PIPELINE_RUNTIME_IDS).reduce((acc, [stageKey, agentId]) => {
    acc[agentId] = stageKey;
    return acc;
  }, {})
);

export function pipelineNodeLabel(agentId, stageLabels) {
  const stageKey = AGENT_ID_TO_STAGE_KEY[agentId];
  if (stageKey && stageLabels && stageLabels[stageKey]) {
    return stageLabels[stageKey];
  }
  return String(agentId || '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// Derive an honest "position in pipeline" descriptor for an agent from the
// topology order above. Returns null for agents that aren't in the pipeline so
// the caller can render the standalone state instead. `step` is 1-based;
// `total` is the number of sequential stages (parallel siblings share a step).
export function pipelinePosition(agentId) {
  const total = PIPELINE_TOPOLOGY_ORDER.length;
  for (let i = 0; i < PIPELINE_TOPOLOGY_ORDER.length; i += 1) {
    if (PIPELINE_TOPOLOGY_ORDER[i].includes(agentId)) {
      const node = PIPELINE_TOPOLOGY[agentId] || {};
      const role = node.entry
        ? 'entry parser'
        : node.isFinal
          ? 'final response'
          : node.parallelWith?.length
            ? 'parallel stage'
            : 'stage';
      return { step: i + 1, total, role };
    }
  }
  return null;
}

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

export function buildPipelineRuntimePayload(runtimeByStage) {
  const runtime = runtimeByStage || {};
  return {
    imageParser: runtime.parser || {},
    'image-parser': runtime.parser || {},
    'escalation-template-parser': runtime.parser || {},
    'known-issue-search-agent': runtime.inv || {},
    'triage-agent': runtime.triage || {},
    chat: runtime.main || {},
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
