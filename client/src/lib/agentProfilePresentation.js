const CORE_COLLABORATOR_IDS = new Set(['chat', 'workspace', 'copilot', 'image-analyst']);

const REVIEW_TABS = new Set([
  'review',
  'configuration',
  'technical',
  'prompt',
  'harness',
  'test-assets',
  'test-results',
  'triage-test-results',
  'event-streams',
  'chat-sessions',
  'monitoring',
  'activity',
  'versions',
]);

export function getAgentProfileKind(agentId = '') {
  return CORE_COLLABORATOR_IDS.has(String(agentId)) ? 'collaborator' : 'specialist';
}

export function getAgentProfileKindLabel(agentId = '') {
  return getAgentProfileKind(agentId) === 'collaborator'
    ? 'Core collaborator'
    : 'Workflow specialist';
}

export function groupAgentsForDirectory(agents = []) {
  const groups = { collaborators: [], specialists: [] };
  for (const agent of agents) {
    if (getAgentProfileKind(agent?.agentId) === 'collaborator') groups.collaborators.push(agent);
    else groups.specialists.push(agent);
  }
  return groups;
}

export function getPrimaryProfileSection(tabId = '') {
  if (tabId === 'memory' || tabId === 'continuity') return 'continuity';
  if (tabId === 'workflows' || tabId === 'work') return 'work';
  if (REVIEW_TABS.has(tabId)) return 'review';
  return 'profile';
}

export function normalizeProfileRouteTab(tabId = '') {
  const primary = getPrimaryProfileSection(tabId);
  if (tabId === 'overview' || tabId === 'configuration') return primary === 'review' ? 'review' : 'profile';
  return tabId || 'profile';
}

export function getLatestMemoryNote(agent) {
  const notes = Array.isArray(agent?.memory?.notes) ? agent.memory.notes : [];
  return notes
    .slice()
    .sort((a, b) => new Date(b?.updatedAt || 0).getTime() - new Date(a?.updatedAt || 0).getTime())[0] || null;
}

export function formatMemorySource(note = {}) {
  if (note.sourceRole === 'user') return 'Taught directly by you';
  if (note.sourceAgentId) return `Learned from ${note.sourceAgentId}`;
  if (note.sourceSurface === 'workspace') return 'Observed in Workspace';
  if (note.sourceSurface === 'chat' || note.sourceSurface === 'rooms') return 'Observed in conversation';
  return 'Source not recorded';
}

export function formatMemoryReviewStatus(note = {}) {
  if (note.reviewStatus === 'confirmed') return 'Confirmed';
  if (note.reviewStatus === 'corrected') return 'Corrected by you';
  return 'Needs confirmation';
}

export function getProfileChanges(current = {}, draft = {}) {
  const keys = new Set([...Object.keys(current || {}), ...Object.keys(draft || {})]);
  return [...keys].filter((key) => {
    const before = key === 'quirks' && Array.isArray(current?.[key]) ? current[key].join('\n') : String(current?.[key] ?? '');
    const after = key === 'quirks' && Array.isArray(draft?.[key]) ? draft[key].join('\n') : String(draft?.[key] ?? '');
    return before.trim() !== after.trim();
  });
}
