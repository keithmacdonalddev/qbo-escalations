'use strict';

const { createHash } = require('node:crypto');

const AGENT_TOOL_CAPABILITY_VERSION = '2026-07-24.1';
// Kept dependency-neutral because shared-agent-tools depends on the identity
// service that consumes this registry for UI projection. A focused contract
// test verifies this catalog against SHARED_AGENT_ALLOWED_TOOL_NAMES.
const KNOWN_SHARED_TOOL_NAMES = Object.freeze([
  'agentProfiles.list',
  'agentProfiles.get',
  'agentProfiles.history',
  'agentProfiles.updateAvatar',
  'agentProfiles.generateAvatar',
  'agentProfiles.nudge',
  'db.searchEscalations',
  'db.getEscalation',
  'db.searchInvestigations',
  'db.getInvestigation',
  'db.searchTemplates',
  'db.searchConversations',
  'db.getConversation',
  'db.searchRooms',
  'db.getRoom',
  'web.search',
]);
const KNOWN_SHARED_TOOLS = new Set(KNOWN_SHARED_TOOL_NAMES);

function immutableTools(names) {
  return Object.freeze([...new Set(names)].sort());
}

const AGENT_TOOL_CAPABILITY_SETS = Object.freeze({
  'main-chat-assistant:main-chat': immutableTools([
    'db.searchEscalations',
    'db.getEscalation',
    'db.searchInvestigations',
    'db.getInvestigation',
    'db.searchTemplates',
    'db.searchConversations',
    'db.getConversation',
    'web.search',
  ]),
  'chat:room-chat': immutableTools([
    'agentProfiles.list',
    'agentProfiles.get',
    'agentProfiles.nudge',
    'db.searchEscalations',
    'db.getEscalation',
    'db.searchInvestigations',
    'db.getInvestigation',
    'db.searchTemplates',
    'web.search',
  ]),
  'copilot:room-chat': immutableTools([
    'agentProfiles.list',
    'agentProfiles.get',
    'agentProfiles.nudge',
    'db.searchEscalations',
    'db.getEscalation',
    'db.searchInvestigations',
    'db.getInvestigation',
    'db.searchTemplates',
    'web.search',
  ]),
  'image-analyst:room-chat': immutableTools([
    'agentProfiles.list',
    'agentProfiles.get',
    'agentProfiles.nudge',
    'db.searchEscalations',
    'db.getEscalation',
    'db.searchInvestigations',
    'db.getInvestigation',
    'web.search',
  ]),
  'known-issue-search-agent:known-issue-search': immutableTools([
    'db.searchInvestigations',
    'db.getInvestigation',
  ]),
  // These agents use dedicated non-shared execution paths. Their empty sets
  // prevent accidental access to the shared registry if routing drifts.
  'workspace:workspace-action': immutableTools([]),
  'triage-agent:triage': immutableTools([]),
  'knowledgebase-agent:knowledgebase': immutableTools([]),
});

for (const [capabilityKey, tools] of Object.entries(AGENT_TOOL_CAPABILITY_SETS)) {
  const unknown = tools.filter((tool) => !KNOWN_SHARED_TOOLS.has(tool));
  if (unknown.length > 0) {
    throw new Error(`Agent tool capability ${capabilityKey} contains unknown shared tools: ${unknown.join(', ')}`);
  }
}

function normalizeCapabilityPart(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveAgentToolCapabilities({ agentId, useCase, requestedToolNames } = {}) {
  const normalizedAgentId = normalizeCapabilityPart(agentId);
  const normalizedUseCase = normalizeCapabilityPart(useCase);
  const capabilityKey = `${normalizedAgentId}:${normalizedUseCase}`;
  const maximumTools = AGENT_TOOL_CAPABILITY_SETS[capabilityKey];
  if (!maximumTools) {
    const error = new Error(`No shared-tool capability is registered for agent "${normalizedAgentId || 'unknown'}" and use case "${normalizedUseCase || 'unknown'}".`);
    error.code = 'AGENT_TOOL_CAPABILITY_UNKNOWN';
    throw error;
  }
  if (!Array.isArray(requestedToolNames)) {
    const error = new Error('Shared-tool requests require an explicit array allowlist.');
    error.code = 'AGENT_TOOL_CAPABILITY_INVALID_REQUEST';
    throw error;
  }

  const requested = [...new Set(requestedToolNames.map((tool) => String(tool || '').trim()).filter(Boolean))].sort();
  const unknown = requested.filter((tool) => !KNOWN_SHARED_TOOLS.has(tool));
  if (unknown.length > 0) {
    const error = new Error(`Unknown shared tools requested: ${unknown.join(', ')}`);
    error.code = 'AGENT_TOOL_CAPABILITY_UNKNOWN_TOOL';
    error.tools = unknown;
    throw error;
  }
  const maximumSet = new Set(maximumTools);
  const escalated = requested.filter((tool) => !maximumSet.has(tool));
  if (escalated.length > 0) {
    const error = new Error(`Agent tool request exceeds registered capability: ${escalated.join(', ')}`);
    error.code = 'AGENT_TOOL_CAPABILITY_ESCALATION';
    error.tools = escalated;
    throw error;
  }

  const effectiveToolNames = Object.freeze(requested.filter((tool) => maximumSet.has(tool)));
  const allowlistHash = createHash('sha256')
    .update(JSON.stringify({
      version: AGENT_TOOL_CAPABILITY_VERSION,
      agentId: normalizedAgentId,
      useCase: normalizedUseCase,
      tools: effectiveToolNames,
    }))
    .digest('hex');

  return Object.freeze({
    version: AGENT_TOOL_CAPABILITY_VERSION,
    capabilityKey,
    agentId: normalizedAgentId,
    useCase: normalizedUseCase,
    effectiveToolNames,
    allowlistHash,
  });
}

function getMaximumAgentToolNames(agentId, useCase) {
  const capabilityKey = `${normalizeCapabilityPart(agentId)}:${normalizeCapabilityPart(useCase)}`;
  return AGENT_TOOL_CAPABILITY_SETS[capabilityKey] || null;
}

module.exports = {
  AGENT_TOOL_CAPABILITY_SETS,
  AGENT_TOOL_CAPABILITY_VERSION,
  KNOWN_SHARED_TOOL_NAMES,
  getMaximumAgentToolNames,
  resolveAgentToolCapabilities,
};
