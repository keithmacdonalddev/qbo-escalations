const STANDARD_AGENT_PROFILE_TABS = Object.freeze([
  { id: 'overview', label: 'Overview' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'prompt', label: 'Prompt' },
  { id: 'harness', label: 'Harness' },
  { id: 'test-assets', label: 'Test Assets' },
  { id: 'memory', label: 'Memory' },
  { id: 'monitoring', label: 'Monitoring' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'activity', label: 'Activity' },
  { id: 'versions', label: 'Versions' },
]);

const IMAGE_PARSER_PROFILE_TABS = Object.freeze([
  ...STANDARD_AGENT_PROFILE_TABS.slice(0, 5),
  { id: 'test-results', label: 'Test Results' },
  { id: 'event-streams', label: 'Event Streams' },
  { id: 'chat-sessions', label: 'Chat Sessions' },
  ...STANDARD_AGENT_PROFILE_TABS.slice(5),
]);

const TRIAGE_AGENT_PROFILE_TABS = Object.freeze([
  ...STANDARD_AGENT_PROFILE_TABS.slice(0, 5),
  { id: 'triage-test-results', label: 'Test Results' },
  ...STANDARD_AGENT_PROFILE_TABS.slice(5),
]);

export function getAgentProfileTabs(agentId) {
  if (agentId === 'escalation-template-parser') return IMAGE_PARSER_PROFILE_TABS;
  if (agentId === 'triage-agent') return TRIAGE_AGENT_PROFILE_TABS;
  return STANDARD_AGENT_PROFILE_TABS;
}

export function resolveAgentProfileTab(agentId, requestedTab) {
  const tabs = getAgentProfileTabs(agentId);
  return tabs.some((tab) => tab.id === requestedTab) ? requestedTab : 'overview';
}

export { STANDARD_AGENT_PROFILE_TABS };
