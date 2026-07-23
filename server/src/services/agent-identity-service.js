'use strict';

const AgentIdentity = require('../models/AgentIdentity');
const EscalationAttentionItem = require('../models/EscalationAttentionItem');
const {
  ensureCustomAgentPrompt,
  getAgentIdForCustomPromptId,
  getAgentPromptDefinition,
} = require('../lib/agent-prompt-store');
const { DEFAULT_CHAT_RUNTIME_SETTINGS } = require('../lib/chat-settings');
const { normalizeModelOverride } = require('./chat-orchestrator');
const { assertProviderModelAllowed } = require('./ai-management');
const {
  getAlternateProvider,
  getDefaultProvider,
  getProviderTransport,
  isAllowedEffort,
  normalizeProvider,
} = require('./providers/registry');
const {
  DEFAULT_PROFILES,
  mergeAgentProfile,
} = require('./room-agents/agent-profiles');

const MAX_HISTORY_ENTRIES = 120;
const MAX_MEMORY_NOTES = 24;
const MAX_TOOL_USAGE_ENTRIES = 40;
const MAX_ACTIVITY_ENTRIES = 240;
const MAX_RELATIONSHIP_NOTES = 24;
const MAX_REVIEW_ENTRIES = 80;
const MAX_HARNESS_RUNS = 50;
const MAX_HARNESS_CASES = 40;

const PROFILE_PAYLOAD_MEMORY_NOTES = 8;
const PROFILE_PAYLOAD_TOOL_USAGE_ENTRIES = 10;
const PROFILE_PAYLOAD_ACTIVITY_ENTRIES = 5;
const PROFILE_PAYLOAD_RELATIONSHIP_NOTES = 8;
const PROFILE_PAYLOAD_REVIEW_ENTRIES = 5;
const PROFILE_PAYLOAD_HARNESS_RUNS = 3;
const PROFILE_PAYLOAD_HISTORY_ENTRIES = 5;
const CODEX_SERVICE_TIERS = new Set(['fast', 'priority', 'flex']);

const SHARED_AGENT_TOOLS = Object.freeze([
  { name: 'agentProfiles.list', kind: 'read', description: 'List agent profiles with summary fields and references.', params: '{}' },
  { name: 'agentProfiles.get', kind: 'read', description: 'Read a specific agent profile, continuity, and references.', params: '{ agentId }' },
  { name: 'agentProfiles.history', kind: 'read', description: 'Read the history log for a specific agent.', params: '{ agentId }' },
  { name: 'agentProfiles.updateAvatar', kind: 'write', description: 'Update an agent avatar using an image URL, emoji, or generated asset.', params: '{ agentId, imageUrl?, emoji?, prompt?, source?, summary? }' },
  { name: 'agentProfiles.generateAvatar', kind: 'write', description: 'Generate and save a fresh SVG avatar for an agent from a short creative prompt.', params: '{ agentId, prompt?, palette?, emoji?, summary? }' },
  { name: 'agentProfiles.nudge', kind: 'write', description: 'Nudge another agent to participate more naturally in the conversation.', params: '{ fromAgentId, toAgentId, note?, roomId?, surface? }' },
  { name: 'db.searchEscalations', kind: 'read', description: 'Search escalations by text, category, or status.', params: '{ query?, category?, status?, limit? }' },
  { name: 'db.getEscalation', kind: 'read', description: 'Fetch one escalation by id or caseNumber.', params: '{ id?, caseNumber? }' },
  { name: 'db.searchInvestigations', kind: 'read', description: 'Search investigations by INV number, category, status, or text.', params: '{ query?, category?, status?, limit? }' },
  { name: 'db.getInvestigation', kind: 'read', description: 'Fetch one investigation by id or invNumber.', params: '{ id?, invNumber? }' },
  { name: 'db.searchTemplates', kind: 'read', description: 'Search response templates by title, category, or body text.', params: '{ query?, category?, limit? }' },
  { name: 'db.searchConversations', kind: 'read', description: 'Search saved main-chat conversations by title or content.', params: '{ query?, limit? }' },
  { name: 'db.getConversation', kind: 'read', description: 'Open one saved main-chat conversation by id.', params: '{ id }' },
  { name: 'db.searchRooms', kind: 'read', description: 'Search chat rooms by title, members, or message content.', params: '{ query?, activeAgentId?, limit? }' },
  { name: 'db.getRoom', kind: 'read', description: 'Open one chat room by id.', params: '{ id }' },
  { name: 'web.search', kind: 'read', description: 'Search the public web and return a compact result list with titles and URLs.', params: '{ query, limit? }' },
]);

const WORKSPACE_ONLY_TOOLS = Object.freeze([
  { name: 'gmail.search', kind: 'read', description: 'Search emails.', params: '{ q, maxResults?, account? }' },
  { name: 'gmail.send', kind: 'write', description: 'Send email.', params: '{ to, subject, body, cc?, bcc?, threadId?, inReplyTo?, references?, account? }' },
  { name: 'gmail.archive', kind: 'write', description: 'Archive message (remove from inbox).', params: '{ messageId, account? }' },
  { name: 'gmail.trash', kind: 'write', description: 'Trash message.', params: '{ messageId, account? }' },
  { name: 'gmail.star', kind: 'write', description: 'Star message.', params: '{ messageId, account? }' },
  { name: 'gmail.unstar', kind: 'write', description: 'Unstar message.', params: '{ messageId, account? }' },
  { name: 'gmail.markRead', kind: 'write', description: 'Mark as read.', params: '{ messageId, account? }' },
  { name: 'gmail.markUnread', kind: 'write', description: 'Mark as unread.', params: '{ messageId, account? }' },
  { name: 'gmail.label', kind: 'write', description: 'Apply a label.', params: '{ messageId, labelId?, labelName?, label?, account? }' },
  { name: 'gmail.removeLabel', kind: 'write', description: 'Remove a label.', params: '{ messageId, labelId?, labelName?, label?, account? }' },
  { name: 'gmail.draft', kind: 'write', description: 'Create draft.', params: '{ to, subject, body, cc?, bcc?, account? }' },
  { name: 'gmail.getMessage', kind: 'read', description: 'Read a specific email by ID.', params: '{ messageId, account? }' },
  { name: 'gmail.listLabels', kind: 'read', description: 'List all Gmail labels.', params: '{ account? }' },
  { name: 'gmail.createLabel', kind: 'write', description: 'Create a Gmail label/folder.', params: '{ name, labelListVisibility?, messageListVisibility?, account? }' },
  { name: 'gmail.createFilter', kind: 'write', description: 'Create an auto-filter rule.', params: '{ criteria, action, account? }' },
  { name: 'gmail.listFilters', kind: 'read', description: 'List all Gmail filters.', params: '{ account? }' },
  { name: 'gmail.deleteFilter', kind: 'write', description: 'Delete a filter.', params: '{ filterId, account? }' },
  { name: 'gmail.batchModify', kind: 'write', description: 'Bulk modify messages.', params: '{ messageIds, addLabelIds?, removeLabelIds?, addLabels?, removeLabels?, account? }' },
  { name: 'calendar.listEvents', kind: 'read', description: 'List events in a time range.', params: '{ timeMin, timeMax, q?, calendarId?, account? }' },
  { name: 'calendar.createEvent', kind: 'write', description: 'Create event.', params: '{ summary, start, end, ... }' },
  { name: 'calendar.updateEvent', kind: 'write', description: 'Update event.', params: '{ eventId, summary?, start?, end?, ... }' },
  { name: 'calendar.deleteEvent', kind: 'write', description: 'Delete event.', params: '{ eventId, calendarId?, account? }' },
  { name: 'calendar.freeTime', kind: 'read', description: 'Find free time.', params: '{ calendarIds?, timeMin, timeMax, timeZone?, account? }' },
  { name: 'memory.save', kind: 'write', description: 'Save to memory.', params: '{ type, key, content, source? }' },
  { name: 'memory.list', kind: 'read', description: 'Check memory.', params: '{ query?, type?, limit? }' },
  { name: 'memory.delete', kind: 'write', description: 'Remove memory.', params: '{ key }' },
  { name: 'autoAction.createRule', kind: 'write', description: 'Create an automatic rule for future emails.', params: '{ name, tier, conditionType, conditionValue, actionType, actionValue? }' },
  { name: 'autoAction.approve', kind: 'write', description: 'Approve a learned auto-rule and promote it when appropriate.', params: '{ ruleId }' },
  { name: 'shipment.list', kind: 'read', description: 'List tracked shipments.', params: '{ active?, carrier?, status? }' },
  { name: 'shipment.get', kind: 'read', description: 'Get detailed status for a specific tracking number.', params: '{ trackingNumber }' },
  { name: 'shipment.updateStatus', kind: 'write', description: 'Manually update a shipment status.', params: '{ trackingNumber, status, location?, description? }' },
  { name: 'shipment.markDelivered', kind: 'write', description: 'Mark a shipment as delivered.', params: '{ trackingNumber }' },
  { name: 'shipment.track', kind: 'read', description: 'Get carrier tracking URL and latest info for a package.', params: '{ trackingNumber }' },
]);

const TRIAGE_TOOL_NAMES = new Set([
  'db.searchEscalations',
  'db.getEscalation',
  'db.searchInvestigations',
  'db.getInvestigation',
  'db.searchTemplates',
]);

const KNOWN_ISSUE_TOOL_NAMES = new Set([
  'db.searchInvestigations',
  'db.getInvestigation',
]);

const PARSER_AGENT_IDS = new Set([
  'escalation-template-parser',
  'follow-up-chat-parser',
]);

const AGENT_PROMPT_MAP = Object.freeze({
  'chat-core': 'chat',
  'escalation-template-parser': 'escalation-template-parser',
  'triage-agent': 'triage-agent',
  'known-issue-search-agent': 'known-issue-search-agent',
  'knowledgebase-agent': 'knowledgebase-agent',
  'follow-up-chat-parser': 'follow-up-chat-parser',
  'workspace-action': 'workspace',
  'copilot-agent': 'copilot',
  'image-parser': 'image-analyst',
});

const IMAGE_RUNTIME_AGENT_IDS = new Set([
  'escalation-template-parser',
  'follow-up-chat-parser',
  'image-analyst',
]);

const AGENT_IDENTITY_PROFILE_PROJECTION = Object.freeze({
  agentId: 1,
  enabled: 1,
  enabledUpdatedAt: 1,
  enabledUpdatedBy: 1,
  profile: 1,
  runtime: 1,
  custom: 1,
  'memory.notes': { $slice: PROFILE_PAYLOAD_MEMORY_NOTES },
  'memory.lastLearnedAt': 1,
  'tools.recentUsage': { $slice: PROFILE_PAYLOAD_TOOL_USAGE_ENTRIES },
  'activity.entries': { $slice: PROFILE_PAYLOAD_ACTIVITY_ENTRIES },
  'relationships.notes': { $slice: PROFILE_PAYLOAD_RELATIONSHIP_NOTES },
  'relationships.lastUpdatedAt': 1,
  'reviews.entries': { $slice: PROFILE_PAYLOAD_REVIEW_ENTRIES },
  'reviews.lastApprovedAt': 1,
  'harness.runs': { $slice: PROFILE_PAYLOAD_HARNESS_RUNS },
  'harness.lastRunAt': 1,
  'history.entries': { $slice: PROFILE_PAYLOAD_HISTORY_ENTRIES },
  updatedAt: 1,
  createdAt: 1,
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function safeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function compact(text, max = 240) {
  const clean = safeText(text).replace(/\s+/g, ' ');
  if (!clean) return '';
  return clean.length <= max ? clean : `${clean.slice(0, max - 3).trimEnd()}...`;
}

function normalizeKey(text) {
  return safeText(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
}

function normalizeAgentId(value) {
  return normalizeKey(value).slice(0, 72);
}

function labelAgentId(agentId = '') {
  const label = safeText(agentId)
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
  return label || 'Custom Agent';
}

function makeEntryId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeLifecycleStepStatus(value) {
  const normalized = safeText(value).toLowerCase();
  if (normalized === 'warn') return 'warning';
  if (normalized === 'fail' || normalized === 'failed') return 'error';
  if (['success', 'error', 'warning', 'info'].includes(normalized)) {
    return normalized;
  }
  return 'info';
}

function createAgentLifecycleRun({ agentId, enabled, actor = 'user', summary = '', source = 'agent-profiles' } = {}) {
  const targetEnabled = enabled !== false;
  const startedAt = new Date().toISOString();
  return {
    runId: makeEntryId('agent-lifecycle-run'),
    agentId: safeText(agentId),
    direction: targetEnabled ? 'startup' : 'shutdown',
    targetEnabled,
    actor: safeText(actor) || 'user',
    source: safeText(source) || 'agent-profiles',
    summary: safeText(summary) || `${targetEnabled ? 'Enabled' : 'Disabled'} agent globally.`,
    status: 'running',
    startedAt,
    completedAt: null,
    durationMs: null,
    counts: {
      success: 0,
      warning: 0,
      error: 0,
      info: 0,
    },
    steps: [],
  };
}

function recordAgentLifecycleStep(run, step = {}) {
  if (!run || !Array.isArray(run.steps)) {
    return null;
  }

  const startedAt = step.startedAt ? new Date(step.startedAt) : new Date();
  const completedAt = step.completedAt ? new Date(step.completedAt) : new Date();
  const durationMs = Number.isFinite(Number(step.durationMs))
    ? Math.max(0, Math.round(Number(step.durationMs)))
    : Math.max(0, completedAt.getTime() - startedAt.getTime());
  const status = normalizeLifecycleStepStatus(step.status || step.level);
  const entry = {
    stepId: makeEntryId('agent-lifecycle-step'),
    sequence: run.steps.length + 1,
    name: safeText(step.name || step.functionName || step.check) || 'Lifecycle step',
    functionName: safeText(step.functionName || step.fn || step.name) || 'unknown',
    check: safeText(step.check),
    status,
    summary: compact(step.summary || step.detail || step.message || status, 300),
    detail: compact(step.detail || step.message || step.summary || '', 800),
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs,
    metadata: clone(step.metadata || {}),
  };

  run.steps.push(entry);
  return entry;
}

async function traceAgentLifecycleCall(run, step, call) {
  const startedAt = new Date();
  try {
    const result = typeof call === 'function' ? await call() : undefined;
    recordAgentLifecycleStep(run, {
      ...step,
      status: step.status || 'success',
      startedAt,
      completedAt: new Date(),
    });
    return result;
  } catch (err) {
    recordAgentLifecycleStep(run, {
      ...step,
      status: 'error',
      summary: err.message || step.summary || `${step.functionName || step.name} failed`,
      detail: err.stack || err.message || '',
      startedAt,
      completedAt: new Date(),
    });
    throw err;
  }
}

function finalizeAgentLifecycleRun(run, statusOverride = '') {
  if (!run || !Array.isArray(run.steps)) {
    return run;
  }

  const counts = run.steps.reduce((acc, step) => {
    const status = normalizeLifecycleStepStatus(step.status);
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, { success: 0, warning: 0, error: 0, info: 0 });
  const completedAt = new Date();
  run.completedAt = completedAt.toISOString();
  run.durationMs = Math.max(0, completedAt.getTime() - Date.parse(run.startedAt || completedAt.toISOString()));
  run.counts = counts;
  run.status = safeText(statusOverride)
    || (counts.error > 0 ? 'error' : counts.warning > 0 ? 'warning' : 'success');
  return run;
}

function buildLifecycleRunSummary(run, fallbackSummary = '') {
  const action = run?.direction === 'startup' ? 'Started' : 'Shut down';
  const count = Array.isArray(run?.steps) ? run.steps.length : 0;
  const warnings = Number(run?.counts?.warning) || 0;
  const errors = Number(run?.counts?.error) || 0;
  const suffix = errors
    ? `${errors} errors`
    : warnings
      ? `${warnings} warnings`
      : 'all checks completed';
  return safeText(fallbackSummary) || `${action} agent lifecycle: ${count} steps, ${suffix}.`;
}

function buildMemoryKey(agentId, kind, content) {
  return `${agentId}:${kind}:${normalizeKey(content)}`;
}

function buildRelationshipKey(otherAgentId, summary) {
  return `${otherAgentId}:${normalizeKey(summary)}`;
}

function pruneHistory(entries) {
  return [...(entries || [])]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, MAX_HISTORY_ENTRIES);
}

function mergeNotes(existing = [], incoming = []) {
  const byKey = new Map();
  for (const note of existing) {
    if (note?.key) byKey.set(note.key, note);
  }
  for (const note of incoming) {
    if (!note?.key) continue;
    byKey.set(note.key, {
      ...byKey.get(note.key),
      ...note,
      updatedAt: new Date(),
    });
  }
  return [...byKey.values()]
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .slice(0, MAX_MEMORY_NOTES);
}

function pruneToolUsage(entries) {
  return [...(entries || [])]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, MAX_TOOL_USAGE_ENTRIES);
}

function pruneActivity(entries) {
  return [...(entries || [])]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, MAX_ACTIVITY_ENTRIES);
}

function pruneReviewEntries(entries) {
  return [...(entries || [])]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, MAX_REVIEW_ENTRIES);
}

function pruneHarnessRuns(entries) {
  return [...(entries || [])]
    .sort((a, b) => new Date(b.completedAt || b.createdAt || 0).getTime() - new Date(a.completedAt || a.createdAt || 0).getTime())
    .slice(0, MAX_HARNESS_RUNS);
}

function mergeRelationshipNotes(existing = [], incoming = []) {
  const byKey = new Map();
  for (const note of existing) {
    if (!note?.otherAgentId || !note?.summary) continue;
    const key = `${note.otherAgentId}:${normalizeKey(note.summary)}`;
    byKey.set(key, note);
  }
  for (const note of incoming) {
    if (!note?.otherAgentId || !note?.summary) continue;
    const key = `${note.otherAgentId}:${normalizeKey(note.summary)}`;
    const previous = byKey.get(key) || {};
    const nextInteractionCount = Math.min((Number(previous.interactionCount) || 0) + 1, 999);
    const nextConfidence = Math.min(
      Math.max(
        Number(note.confidence)
          || Number(previous.confidence)
          || 0.5,
        0.05
      ) + 0.08,
      0.99
    );
    byKey.set(key, {
      ...previous,
      ...note,
      interactionCount: nextInteractionCount,
      confidence: nextConfidence,
      strength: classifyRelationshipStrength(nextConfidence, nextInteractionCount),
      updatedAt: new Date(),
    });
  }
  return [...byKey.values()]
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .slice(0, MAX_RELATIONSHIP_NOTES);
}

function classifyRelationshipStrength(confidence, interactionCount) {
  const score = (Number(confidence) || 0) + Math.min((Number(interactionCount) || 0) * 0.08, 0.4);
  if (score >= 1.05) return 'established';
  if (score >= 0.8) return 'developing';
  return 'emerging';
}

function getAgeInDays(value) {
  const ts = new Date(value || 0).getTime();
  if (!ts) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - ts) / (1000 * 60 * 60 * 24));
}

function decayRelationshipConfidence(confidence, updatedAt) {
  const numeric = Math.max(0, Math.min(Number(confidence) || 0, 0.99));
  const ageDays = getAgeInDays(updatedAt);
  if (!Number.isFinite(ageDays)) return 0;
  if (ageDays <= 7) return numeric;
  if (ageDays <= 21) return Math.max(0.05, numeric - 0.08);
  if (ageDays <= 45) return Math.max(0.05, numeric - 0.18);
  return Math.max(0.05, numeric - 0.3);
}

function classifyRelationshipTrend({ confidence, activeConfidence, updatedAt, totalSignals }) {
  const ageDays = getAgeInDays(updatedAt);
  if (!Number.isFinite(ageDays)) return 'stale';
  if (ageDays <= 10 && (Number(totalSignals) || 0) >= 3 && (Number(activeConfidence) || 0) >= 0.7) {
    return 'warming';
  }
  if (ageDays > 45 || ((Number(confidence) || 0) - (Number(activeConfidence) || 0)) >= 0.2) {
    return 'cooling';
  }
  if (ageDays > 90) {
    return 'stale';
  }
  return 'stable';
}

function summarizeReciprocity(agentId, otherAgentId, docsById) {
  if (!agentId || !otherAgentId || !docsById?.has(otherAgentId)) {
    return { reciprocity: 'unknown', reciprocalConfidence: null };
  }
  const otherDoc = docsById.get(otherAgentId) || {};
  const reverseNotes = Array.isArray(otherDoc.relationships?.notes) ? otherDoc.relationships.notes : [];
  const reverseRelevant = reverseNotes.filter((note) => note?.otherAgentId === agentId);
  if (reverseRelevant.length === 0) {
    return { reciprocity: 'one-sided', reciprocalConfidence: 0 };
  }
  const reciprocalConfidence = reverseRelevant.reduce((max, note) => Math.max(max, Number(note?.confidence) || 0), 0);
  return {
    reciprocity: reciprocalConfidence >= 0.7 ? 'mutual' : 'partial',
    reciprocalConfidence,
  };
}

function buildCustomAgentProfile(agentId, overrides = {}) {
  const sanitized = sanitizeProfileUpdate(overrides);
  const displayName = safeText(overrides.displayName) || labelAgentId(agentId);
  return {
    agentId,
    displayName,
    roleTitle: sanitized.roleTitle || displayName,
    headline: sanitized.headline || 'Custom operational agent registered for review before workflow assignment.',
    tone: sanitized.tone || 'Clear, practical, and review-aware.',
    quirks: Array.isArray(sanitized.quirks) ? sanitized.quirks : [],
    conversationalStyle: sanitized.conversationalStyle || 'Concise, operational, and explicit about uncertainty.',
    boundaries: sanitized.boundaries || 'Requires human review before irreversible workflow or workspace actions.',
    initiativeLevel: sanitized.initiativeLevel || 'medium',
    socialStyle: sanitized.socialStyle || 'Participates when the workflow explicitly calls on this role.',
    communityStyle: sanitized.communityStyle || 'Coordinates with adjacent agents through reviewable handoffs.',
    selfImprovementStyle: sanitized.selfImprovementStyle || 'Improves through review approvals, harness runs, and operator feedback.',
    soul: sanitized.soul || 'A custom agent profile waiting for production hardening and real workflow evidence.',
    routingBias: sanitized.routingBias || 'custom-agent',
    avatarUrl: sanitized.avatarUrl || '',
    avatarEmoji: sanitized.avatarEmoji || '',
    avatarPrompt: sanitized.avatarPrompt || '',
    avatarSource: sanitized.avatarSource || '',
  };
}

function normalizeRuntimeMode(value) {
  return safeText(value).toLowerCase() === 'fallback' ? 'fallback' : 'single';
}

function normalizeRuntimeReasoningEffort(provider, value) {
  const requested = safeText(value).toLowerCase();
  const fallback = DEFAULT_CHAT_RUNTIME_SETTINGS.providerStrategy.reasoningEffort || 'high';
  if (!requested) return fallback;
  return isAllowedEffort(provider, requested) ? requested : fallback;
}

function normalizeImageRuntimeReasoningEffort(provider, value) {
  const requested = safeText(value).toLowerCase();
  if (!requested || !provider) return '';
  return isAllowedEffort(provider, requested) ? requested : '';
}

function providerSupportsCodexServiceTier(provider) {
  return provider && getProviderTransport(provider) === 'codex';
}

function normalizeRuntimeServiceTier(provider, fallbackProvider, value) {
  if (!providerSupportsCodexServiceTier(provider) && !providerSupportsCodexServiceTier(fallbackProvider)) {
    return '';
  }
  const requested = safeText(value).toLowerCase();
  if (requested === 'priority') return 'fast';
  return CODEX_SERVICE_TIERS.has(requested) ? requested : 'fast';
}

function normalizeAgentRuntimeState(agentId, input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const imageRuntime = IMAGE_RUNTIME_AGENT_IDS.has(agentId);
  const mode = imageRuntime ? 'single' : normalizeRuntimeMode(source.mode);
  const rawProvider = safeText(source.provider || source.primaryProvider);
  const provider = imageRuntime && !rawProvider
    ? ''
    : normalizeProvider(rawProvider || getDefaultProvider());
  // Automatic failover is the DEFAULT for every agent: persist the operator's
  // chosen backup unconditionally (no `mode === 'fallback'` gating, no
  // image-runtime forcing of an empty backup), defaulting to the neutral global
  // alternate when none is set so a distinct backup always exists for the engine
  // to fail over to. A configured backup that collapses to the primary is
  // re-derived to the global alternate. (No use-case/capability logic — the
  // operator's choice is honored as-is; see agent-failover.js.)
  let fallbackProvider = provider
    ? normalizeProvider(source.fallbackProvider || getAlternateProvider(provider))
    : '';
  if (fallbackProvider && fallbackProvider === provider) {
    fallbackProvider = normalizeProvider(getAlternateProvider(provider));
  }
  const sourcedCustomFallback = Boolean(source.fallbackProvider)
    && normalizeProvider(source.fallbackProvider) !== provider;

  return {
    provider,
    mode,
    fallbackProvider,
    model: normalizeModelOverride(source.model || source.primaryModel || ''),
    // Keep the operator's backup model only when they supplied a distinct backup
    // provider; a defaulted/re-derived global alternate has no operator model.
    fallbackModel: sourcedCustomFallback ? normalizeModelOverride(source.fallbackModel || '') : '',
    reasoningEffort: imageRuntime
      ? normalizeImageRuntimeReasoningEffort(provider, source.reasoningEffort)
      : normalizeRuntimeReasoningEffort(provider, source.reasoningEffort),
    serviceTier: normalizeRuntimeServiceTier(provider, fallbackProvider, source.serviceTier),
    configured: source.configured !== false && Boolean(provider || source.configured),
    source: safeText(source.source) || 'agent-profile',
  };
}

function buildRuntimeSummary(runtime) {
  if (!runtime?.configured) return 'Cleared agent runtime defaults.';
  // Automatic failover is always on, so the backup is always part of the runtime
  // and is always surfaced when present (no longer gated on mode === 'fallback').
  const parts = [
    'Runtime',
    runtime.provider,
    runtime.model ? `model ${runtime.model}` : '',
    runtime.fallbackProvider ? `fallback ${runtime.fallbackProvider}` : '',
    runtime.fallbackModel ? `fallback model ${runtime.fallbackModel}` : '',
    runtime.reasoningEffort ? `effort ${runtime.reasoningEffort}` : '',
    runtime.serviceTier ? `tier ${runtime.serviceTier}` : '',
  ].filter(Boolean);
  return parts.join(' | ');
}

function resolveAgentProfile(agentId, doc = null) {
  const overrides = clone(doc?.profile || {});
  if (DEFAULT_PROFILES[agentId]) {
    return mergeAgentProfile(agentId, overrides);
  }
  if (doc || Object.keys(overrides || {}).length > 0) {
    return buildCustomAgentProfile(agentId, overrides);
  }
  return null;
}

function buildRelationshipMap(agentId, relationshipNotes = [], historyEntries = [], docsById = null) {
  const relevantNotes = Array.isArray(relationshipNotes) ? relationshipNotes : [];
  const byOtherAgent = new Map();

  for (const note of relevantNotes) {
    const otherProfile = resolveAgentProfile(note?.otherAgentId, docsById?.get(note?.otherAgentId));
    if (!note?.otherAgentId || !otherProfile) continue;
    const bucket = byOtherAgent.get(note.otherAgentId) || {
      otherAgentId: note.otherAgentId,
      otherDisplayName: otherProfile.displayName || note.otherAgentId,
      confidence: 0,
      strongestStrength: 'emerging',
      totalSignals: 0,
      noteCount: 0,
      topKinds: new Set(),
      latestSummary: '',
      updatedAt: null,
      needsRepair: false,
    };
    const confidence = Number(note.confidence) || 0;
    const interactionCount = Number(note.interactionCount) || 1;
    bucket.confidence = Math.max(bucket.confidence, confidence);
    bucket.totalSignals += interactionCount;
    bucket.noteCount += 1;
    bucket.topKinds.add(note.kind || 'dynamic');
    if (!bucket.latestSummary || new Date(note.updatedAt || 0).getTime() >= new Date(bucket.updatedAt || 0).getTime()) {
      bucket.latestSummary = note.summary || '';
      bucket.updatedAt = note.updatedAt || null;
      bucket.strongestStrength = note.strength || classifyRelationshipStrength(confidence, interactionCount);
    }
    if (note.kind === 'participation') {
      bucket.needsRepair = true;
    }
    byOtherAgent.set(note.otherAgentId, bucket);
  }

  const relationshipHistory = Array.isArray(historyEntries) ? historyEntries : [];
  for (const entry of relationshipHistory) {
    const otherAgentId = entry?.metadata?.otherAgentId;
    if (!otherAgentId || !byOtherAgent.has(otherAgentId)) continue;
    if (entry.type === 'correction-learned' || entry.type === 'relationship-adjustment') {
      const bucket = byOtherAgent.get(otherAgentId);
      bucket.needsRepair = bucket.needsRepair || /wrong|mistake|repair|better|quiet|silent|participate/i.test(String(entry.summary || ''));
      byOtherAgent.set(otherAgentId, bucket);
    }
  }

  const all = [...byOtherAgent.values()]
    .map((bucket) => {
      const activeConfidence = decayRelationshipConfidence(bucket.confidence, bucket.updatedAt);
      const activeStrength = classifyRelationshipStrength(activeConfidence, bucket.totalSignals);
      return {
        ...bucket,
        activeConfidence,
        activeStrength,
        trend: classifyRelationshipTrend({
          confidence: bucket.confidence,
          activeConfidence,
          updatedAt: bucket.updatedAt,
          totalSignals: bucket.totalSignals,
        }),
        topKinds: [...bucket.topKinds],
        ...summarizeReciprocity(agentId, bucket.otherAgentId, docsById),
        direction:
          activeStrength === 'established'
            ? 'strong'
            : (activeStrength === 'developing' ? 'growing' : 'emerging'),
      };
    })
    .sort((a, b) => {
      const confidenceDiff = (Number(b.activeConfidence) || 0) - (Number(a.activeConfidence) || 0);
      if (Math.abs(confidenceDiff) > 0.001) return confidenceDiff;
      return (Number(b.totalSignals) || 0) - (Number(a.totalSignals) || 0);
    });

  return {
    strongestTies: all.filter((item) => item.activeStrength === 'established').slice(0, 3),
    growingTies: all.filter((item) => item.activeStrength === 'developing' || item.trend === 'warming').slice(0, 3),
    needsRepair: all.filter((item) => item.needsRepair).slice(0, 3),
    coolingOff: all.filter((item) => item.trend === 'cooling' || item.trend === 'stale').slice(0, 3),
    all,
  };
}

function buildAvailableTools(agentId) {
  const base = [...SHARED_AGENT_TOOLS];
  if (PARSER_AGENT_IDS.has(agentId)) {
    return [];
  }
  if (agentId === 'triage-agent') {
    return base.filter((tool) => TRIAGE_TOOL_NAMES.has(tool.name));
  }
  if (agentId === 'known-issue-search-agent') {
    return base.filter((tool) => KNOWN_ISSUE_TOOL_NAMES.has(tool.name));
  }
  if (agentId === 'workspace') {
    return [...WORKSPACE_ONLY_TOOLS, ...base];
  }
  return base;
}

function ensureAgentIds(agentIds) {
  const defaults = Object.keys(DEFAULT_PROFILES);
  if (Array.isArray(agentIds) && agentIds.length > 0) {
    return agentIds.filter((id) => defaults.includes(id));
  }
  return defaults;
}

async function getIdentityDoc(agentId) {
  return AgentIdentity.findOne({ agentId });
}

async function canMutateIdentity(agentId) {
  if (DEFAULT_PROFILES[agentId]) return true;
  return Boolean(await getIdentityDoc(agentId));
}

async function ensureIdentity(agentId) {
  let doc = await getIdentityDoc(agentId);
  if (doc) return doc;
  try {
    doc = new AgentIdentity({ agentId });
    await doc.save();
    return doc;
  } catch (err) {
    if (err?.code === 11000) {
      return getIdentityDoc(agentId);
    }
    throw err;
  }
}

async function updateIdentityWithRetry(agentId, mutate, maxAttempts = 3, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const doc = await traceAgentLifecycleCall(options.lifecycleRun, {
      name: `Load identity document attempt ${attempt}`,
      functionName: 'ensureIdentity',
      check: 'AgentIdentity document exists or can be created',
      summary: `Loaded MongoDB identity document for ${agentId}.`,
      metadata: { agentId, attempt, maxAttempts },
    }, () => ensureIdentity(agentId));

    await traceAgentLifecycleCall(options.lifecycleRun, {
      name: `Apply identity mutation attempt ${attempt}`,
      functionName: 'updateIdentityWithRetry.mutate',
      check: 'Lifecycle state mutation can be applied to the document',
      summary: `Applied lifecycle mutation to ${agentId}.`,
      metadata: { agentId, attempt, maxAttempts },
    }, () => mutate(doc));

    const saveStartedAt = new Date();
    try {
      await doc.save();
      recordAgentLifecycleStep(options.lifecycleRun, {
        name: `Save identity document attempt ${attempt}`,
        functionName: 'AgentIdentity.save',
        check: 'MongoDB accepts the lifecycle state update',
        status: 'success',
        summary: `Saved lifecycle state for ${agentId} to MongoDB.`,
        startedAt: saveStartedAt,
        completedAt: new Date(),
        metadata: { agentId, attempt, maxAttempts },
      });
      return doc;
    } catch (err) {
      lastError = err;
      if (err?.name !== 'VersionError' && err?.code !== 11000) {
        recordAgentLifecycleStep(options.lifecycleRun, {
          name: `Save identity document attempt ${attempt}`,
          functionName: 'AgentIdentity.save',
          check: 'MongoDB accepts the lifecycle state update',
          status: 'error',
          summary: err.message || `Failed to save lifecycle state for ${agentId}.`,
          detail: err.stack || err.message || '',
          startedAt: saveStartedAt,
          completedAt: new Date(),
          metadata: { agentId, attempt, maxAttempts, errorName: err?.name || '', errorCode: err?.code || '' },
        });
        throw err;
      }
      recordAgentLifecycleStep(options.lifecycleRun, {
        name: `Retry identity update attempt ${attempt}`,
        functionName: 'updateIdentityWithRetry',
        check: 'MongoDB optimistic concurrency retry is allowed',
        status: 'warning',
        summary: `Retrying lifecycle state save for ${agentId}.`,
        detail: err.message || 'MongoDB write conflict.',
        startedAt: saveStartedAt,
        completedAt: new Date(),
        metadata: { agentId, attempt, maxAttempts, errorName: err?.name || '', errorCode: err?.code || '' },
      });
    }
  }
  throw lastError || new Error(`Failed to update agent identity for ${agentId}`);
}

function buildMergedIdentity(agentId, doc = null, docsById = null) {
  const profile = resolveAgentProfile(agentId, doc);
  if (!profile) return null;
  const enabled = doc?.enabled !== false;
  return {
    agentId,
    enabled,
    lifecycle: {
      enabled,
      updatedAt: doc?.enabledUpdatedAt || null,
      updatedBy: safeText(doc?.enabledUpdatedBy),
    },
    promptId:
      safeText(doc?.custom?.promptId)
      || Object.entries(AGENT_PROMPT_MAP).find(([, mappedAgentId]) => mappedAgentId === agentId)?.[0]
      || null,
    profile,
    custom: {
      isCustom: Boolean(doc?.custom?.isCustom || !DEFAULT_PROFILES[agentId]),
      source: safeText(doc?.custom?.source),
      sourceLabel: safeText(doc?.custom?.sourceLabel),
      registryStatus: safeText(doc?.custom?.registryStatus) || (DEFAULT_PROFILES[agentId] ? 'built-in' : 'draft'),
      createdBy: safeText(doc?.custom?.createdBy),
      importedAt: doc?.custom?.importedAt || null,
      metadata: clone(doc?.custom?.metadata || {}),
    },
    memory: {
      notes: clone(doc?.memory?.notes || []),
      lastLearnedAt: doc?.memory?.lastLearnedAt || null,
    },
    tools: {
      available: buildAvailableTools(agentId),
      recentUsage: clone(doc?.tools?.recentUsage || []),
    },
    activity: {
      entries: clone(doc?.activity?.entries || []),
    },
    relationships: {
      notes: clone(doc?.relationships?.notes || []),
      lastUpdatedAt: doc?.relationships?.lastUpdatedAt || null,
      map: buildRelationshipMap(
        agentId,
        clone(doc?.relationships?.notes || []),
        clone(doc?.history?.entries || []),
        docsById
      ),
    },
    reviews: {
      entries: clone(doc?.reviews?.entries || []),
      lastApprovedAt: doc?.reviews?.lastApprovedAt || null,
    },
    harness: {
      runs: clone(doc?.harness?.runs || []),
      lastRunAt: doc?.harness?.lastRunAt || null,
    },
    runtime: doc?.runtime?.configured ? clone(doc.runtime) : null,
    history: {
      entries: clone(doc?.history?.entries || []),
    },
    updatedAt: doc?.updatedAt || null,
    createdAt: doc?.createdAt || null,
  };
}

async function listAgentIdentities() {
  const docs = await AgentIdentity.find({}, AGENT_IDENTITY_PROFILE_PROJECTION).lean();
  const byId = new Map(docs.map((doc) => [doc.agentId, doc]));
  const defaultIds = Object.keys(DEFAULT_PROFILES);
  const customIds = docs
    .map((doc) => doc.agentId)
    .filter((agentId) => agentId && !DEFAULT_PROFILES[agentId])
    .sort((a, b) => a.localeCompare(b));
  return [...defaultIds, ...customIds]
    .map((agentId) => buildMergedIdentity(agentId, byId.get(agentId), byId))
    .filter(Boolean);
}

async function listAgentRuntimeDefaults(agentIds = []) {
  const requestedIds = (Array.isArray(agentIds) ? agentIds : [])
    .map((agentId) => safeText(agentId))
    .filter(Boolean);
  const ids = requestedIds.length > 0 ? requestedIds : Object.keys(DEFAULT_PROFILES);
  const docs = await AgentIdentity.find({ agentId: { $in: ids } })
    .select('agentId runtime updatedAt')
    .lean();
  const byId = new Map(docs.map((doc) => [doc.agentId, doc]));

  return ids.reduce((acc, agentId) => {
    const doc = byId.get(agentId);
    acc[agentId] = {
      agentId,
      runtime: doc?.runtime?.configured ? clone(doc.runtime) : null,
      updatedAt: doc?.updatedAt || null,
    };
    return acc;
  }, {});
}

async function listAgentHealthIdentitySnapshots(agentIds = []) {
  const requestedIds = (Array.isArray(agentIds) ? agentIds : [])
    .map((agentId) => safeText(agentId))
    .filter(Boolean);
  const ids = requestedIds.length > 0 ? requestedIds : Object.keys(DEFAULT_PROFILES);
  const docs = await AgentIdentity.find({ agentId: { $in: ids } })
    .select('agentId enabled profile updatedAt')
    .lean();
  const byId = new Map(docs.map((doc) => [doc.agentId, doc]));

  return ids.reduce((acc, agentId) => {
    const doc = byId.get(agentId) || null;
    const profile = resolveAgentProfile(agentId, doc);
    if (!profile) return acc;
    acc[agentId] = {
      agentId,
      enabled: doc?.enabled !== false,
      profile,
      updatedAt: doc?.updatedAt || null,
    };
    return acc;
  }, {});
}

async function listAgentLifecycleStates(agentIds = []) {
  const requestedIds = (Array.isArray(agentIds) ? agentIds : [])
    .map((agentId) => safeText(agentId))
    .filter(Boolean);
  const ids = requestedIds.length > 0 ? requestedIds : Object.keys(DEFAULT_PROFILES);
  const docs = await AgentIdentity.find({ agentId: { $in: ids } })
    .select('agentId enabled enabledUpdatedAt enabledUpdatedBy updatedAt')
    .lean();
  const byId = new Map(docs.map((doc) => [doc.agentId, doc]));

  return ids.reduce((acc, agentId) => {
    const doc = byId.get(agentId);
    const enabled = doc?.enabled !== false;
    acc[agentId] = {
      agentId,
      enabled,
      updatedAt: doc?.enabledUpdatedAt || doc?.updatedAt || null,
      updatedBy: safeText(doc?.enabledUpdatedBy),
    };
    return acc;
  }, {});
}

async function getAgentIdentity(agentId) {
  const normalizedAgentId = safeText(agentId);
  if (!normalizedAgentId) return null;
  const docs = await AgentIdentity.find({}, AGENT_IDENTITY_PROFILE_PROJECTION).lean();
  const byId = new Map(docs.map((doc) => [doc.agentId, doc]));
  const doc = byId.get(normalizedAgentId) || null;
  if (!DEFAULT_PROFILES[normalizedAgentId] && !doc) return null;
  return buildMergedIdentity(normalizedAgentId, doc, byId);
}

function sanitizeProfileUpdate(input = {}) {
  const allowed = [
    'displayName',
    'roleTitle',
    'headline',
    'tone',
    'quirks',
    'conversationalStyle',
    'boundaries',
    'initiativeLevel',
    'socialStyle',
    'communityStyle',
    'selfImprovementStyle',
    'soul',
    'routingBias',
    'avatarUrl',
    'avatarEmoji',
    'avatarPrompt',
    'avatarSource',
  ];
  const update = {};
  for (const key of allowed) {
    if (!(key in input)) continue;
    if (key === 'quirks') {
      update.quirks = Array.isArray(input.quirks)
        ? input.quirks.map((item) => safeText(item)).filter(Boolean).slice(0, 8)
        : [];
      continue;
    }
    update[key] = safeText(input[key]);
  }
  return update;
}

function buildProfileSummary(profile) {
  return `Updated profile: ${compact([profile.displayName, profile.roleTitle, profile.headline].filter(Boolean).join(' | '), 160)}`;
}

async function updateAgentIdentity(agentId, profileUpdate, { actor = 'user', summary = '' } = {}) {
  const existingDoc = await getIdentityDoc(agentId);
  if (!DEFAULT_PROFILES[agentId] && !existingDoc) return null;
  const doc = existingDoc || await ensureIdentity(agentId);
  const previousProfile = doc.profile?.toObject ? doc.profile.toObject() : { ...(doc.profile || {}) };
  const sanitizedUpdate = sanitizeProfileUpdate(profileUpdate);
  doc.profile = {
    ...previousProfile,
    ...sanitizedUpdate,
  };
  const adjustedRelationshipFields = ['socialStyle', 'communityStyle', 'selfImprovementStyle', 'boundaries', 'initiativeLevel']
    .filter((field) => previousProfile[field] !== doc.profile[field]);
  doc.history.entries = pruneHistory([
    ...(adjustedRelationshipFields.length > 0 ? [{
      type: 'relationship-adjustment',
      summary: safeText(summary)
        ? `Profile change affected relationship stance: ${safeText(summary)}`
        : `Profile change adjusted how this agent shows up with others (${adjustedRelationshipFields.join(', ')})`,
      actor,
      metadata: { adjustedRelationshipFields },
      createdAt: new Date(),
    }] : []),
    {
      type: 'profile-edit',
      summary: safeText(summary) || buildProfileSummary(doc.profile),
      actor,
      metadata: { profileFields: Object.keys(sanitizedUpdate) },
      createdAt: new Date(),
    },
    ...(doc.history?.entries || []),
  ]);
  await doc.save();
  return getAgentIdentity(agentId);
}

async function reviewAgentMemoryNote(agentId, key, review = {}, { actor = 'user' } = {}) {
  const cleanKey = safeText(key);
  const action = safeText(review.action).toLowerCase();
  if (!cleanKey) throw serviceError('INVALID_MEMORY_KEY', 400, 'A memory key is required.');
  if (!['confirm', 'correct', 'forget'].includes(action)) {
    throw serviceError('INVALID_MEMORY_ACTION', 400, 'Memory action must be confirm, correct, or forget.');
  }
  if (!(await canMutateIdentity(agentId))) return null;

  await updateIdentityWithRetry(agentId, async (identityDoc) => {
    const notes = Array.isArray(identityDoc.memory?.notes) ? identityDoc.memory.notes : [];
    const index = notes.findIndex((note) => safeText(note?.key) === cleanKey);
    if (index < 0) throw serviceError('MEMORY_NOT_FOUND', 404, 'Agent memory note not found.');

    const previous = notes[index]?.toObject ? notes[index].toObject() : { ...notes[index] };
    let historySummary = '';
    if (action === 'forget') {
      identityDoc.memory.notes = notes.filter((_, noteIndex) => noteIndex !== index);
      historySummary = `Forgot memory: ${compact(previous.content, 140)}`;
    } else {
      const nextContent = action === 'correct' ? safeText(review.content) : safeText(previous.content);
      if (action === 'correct' && !nextContent) {
        throw serviceError('INVALID_MEMORY_CONTENT', 400, 'Corrected memory content is required.');
      }
      notes[index] = {
        ...previous,
        content: nextContent,
        reviewStatus: action === 'confirm' ? 'confirmed' : 'corrected',
        reviewedAt: new Date(),
        reviewedBy: actor,
        updatedAt: new Date(),
      };
      identityDoc.memory.notes = notes;
      historySummary = action === 'confirm'
        ? `Confirmed memory: ${compact(nextContent, 140)}`
        : `Corrected memory: ${compact(nextContent, 140)}`;
    }

    if (action === 'correct') {
      identityDoc.memory.lastLearnedAt = new Date();
    }
    identityDoc.history.entries = pruneHistory([{
      type: `memory-${action}`,
      summary: historySummary,
      actor,
      metadata: { key: cleanKey, action },
      createdAt: new Date(),
    }, ...(identityDoc.history?.entries || [])]);
    identityDoc.activity = identityDoc.activity || {};
    identityDoc.activity.entries = pruneActivity([{
      type: 'memory-review',
      phase: action,
      surface: 'agent-profiles',
      summary: historySummary,
      status: action === 'forget' ? 'removed' : 'reviewed',
      metadata: { key: cleanKey, action },
      createdAt: new Date(),
    }, ...(identityDoc.activity?.entries || [])]);
  });

  return getAgentIdentity(agentId);
}

async function updateAgentRuntime(agentId, runtimeUpdate, { actor = 'user', summary = '' } = {}) {
  if (!(await canMutateIdentity(agentId))) return null;
  const updatedAt = new Date();
  const runtime = normalizeAgentRuntimeState(agentId, runtimeUpdate);
  if (runtime.provider) assertProviderModelAllowed(runtime.provider, runtime.model || '');
  if (runtime.fallbackProvider) {
    assertProviderModelAllowed(runtime.fallbackProvider, runtime.fallbackModel || '');
  }

  await updateIdentityWithRetry(agentId, async (doc) => {
    doc.runtime = {
      ...runtime,
      updatedBy: actor,
      updatedAt,
    };
    doc.history.entries = pruneHistory([
      {
        type: 'runtime-defaults',
        summary: safeText(summary) || buildRuntimeSummary(runtime),
        actor,
        metadata: {
          provider: runtime.provider,
          mode: runtime.mode,
          fallbackProvider: runtime.fallbackProvider,
          serviceTier: runtime.serviceTier,
          configured: runtime.configured,
        },
        createdAt: updatedAt,
      },
      ...(doc.history?.entries || []),
    ]);
    doc.activity = doc.activity || {};
    doc.activity.entries = pruneActivity([
      {
        type: 'runtime',
        phase: 'defaults',
        surface: 'agent-profiles',
        summary: safeText(summary) || buildRuntimeSummary(runtime),
        detail: JSON.stringify(runtime),
        status: runtime.configured ? 'configured' : 'cleared',
        metadata: {
          provider: runtime.provider,
          mode: runtime.mode,
          fallbackProvider: runtime.fallbackProvider,
          serviceTier: runtime.serviceTier,
        },
        createdAt: updatedAt,
      },
      ...(doc.activity?.entries || []),
    ]);
  });

  return getAgentIdentity(agentId);
}

async function updateAgentEnabled(agentId, enabled, { actor = 'user', summary = '', lifecycleRun = null } = {}) {
  const normalizedAgentId = safeText(agentId);
  recordAgentLifecycleStep(lifecycleRun, {
    name: 'Normalize lifecycle toggle input',
    functionName: 'updateAgentEnabled',
    check: 'Requested agent id and enabled flag are usable',
    status: normalizedAgentId ? 'success' : 'error',
    summary: normalizedAgentId
      ? `Lifecycle toggle requested for ${normalizedAgentId}.`
      : 'Lifecycle toggle request did not include an agent id.',
    metadata: { agentId: normalizedAgentId, requestedEnabled: enabled !== false },
  });

  const mutable = await traceAgentLifecycleCall(lifecycleRun, {
    name: 'Check identity mutation permission',
    functionName: 'canMutateIdentity',
    check: 'Built-in identities can be materialized and custom identities must already exist',
    summary: `Checked whether ${normalizedAgentId || agentId} can be updated.`,
    metadata: { agentId: normalizedAgentId || agentId },
  }, () => canMutateIdentity(agentId));

  recordAgentLifecycleStep(lifecycleRun, {
    name: 'Evaluate identity mutation permission',
    functionName: 'updateAgentEnabled',
    check: 'canMutateIdentity returned true',
    status: mutable ? 'success' : 'warning',
    summary: mutable
      ? `${normalizedAgentId || agentId} can be updated.`
      : `${normalizedAgentId || agentId} is not a known mutable agent identity.`,
    metadata: { agentId: normalizedAgentId || agentId, mutable },
  });
  if (!mutable) return null;

  const nextEnabled = enabled !== false;
  const updatedAt = new Date();
  recordAgentLifecycleStep(lifecycleRun, {
    name: 'Resolve target lifecycle state',
    functionName: 'updateAgentEnabled',
    check: 'Enabled flag maps to a startup or shutdown action',
    status: 'info',
    summary: `${normalizedAgentId || agentId} target state is ${nextEnabled ? 'active' : 'inactive'}.`,
    metadata: { agentId: normalizedAgentId || agentId, enabled: nextEnabled },
  });

  await updateIdentityWithRetry(agentId, async (doc) => {
    doc.enabled = nextEnabled;
    doc.enabledUpdatedAt = updatedAt;
    doc.enabledUpdatedBy = actor;
    doc.history.entries = pruneHistory([
      {
        type: 'agent-lifecycle',
        summary: safeText(summary) || `${nextEnabled ? 'Enabled' : 'Disabled'} agent globally.`,
        actor,
        metadata: {
          enabled: nextEnabled,
          lifecycleRunId: lifecycleRun?.runId || null,
        },
        createdAt: updatedAt,
      },
      ...(doc.history?.entries || []),
    ]);
    if (!lifecycleRun) {
      doc.activity = doc.activity || {};
      doc.activity.entries = pruneActivity([
        {
          type: 'lifecycle',
          phase: 'global-toggle',
          surface: 'agent-profiles',
          summary: safeText(summary) || `${nextEnabled ? 'Enabled' : 'Disabled'} agent globally.`,
          status: nextEnabled ? 'enabled' : 'disabled',
          metadata: { enabled: nextEnabled },
          createdAt: updatedAt,
        },
        ...(doc.activity?.entries || []),
      ]);
    }
  }, 3, { lifecycleRun });

  return traceAgentLifecycleCall(lifecycleRun, {
    name: 'Load merged identity after lifecycle update',
    functionName: 'getAgentIdentity',
    check: 'Updated MongoDB document can be merged with default profile metadata',
    summary: `Loaded updated identity for ${normalizedAgentId || agentId}.`,
    metadata: { agentId: normalizedAgentId || agentId },
  }, () => getAgentIdentity(agentId));
}

async function recordAgentLifecycleActivity(agentId, lifecycleRun, { actor = 'user', summary = '' } = {}) {
  if (!lifecycleRun) {
    return getAgentIdentity(agentId);
  }

  const updatedAt = new Date();
  const runSummary = buildLifecycleRunSummary(lifecycleRun, summary);
  const runStatus = lifecycleRun.status || 'info';

  await updateIdentityWithRetry(agentId, async (doc) => {
    doc.activity = doc.activity || {};
    doc.activity.entries = pruneActivity([
      {
        type: 'agent-lifecycle-run',
        phase: lifecycleRun.direction || 'lifecycle',
        surface: lifecycleRun.source || 'agent-profiles',
        summary: runSummary,
        detail: 'Expand to view the full lifecycle function and check stream.',
        status: runStatus,
        metadata: {
          enabled: lifecycleRun.targetEnabled !== false,
          lifecycleRunId: lifecycleRun.runId,
          lifecycleRun: clone(lifecycleRun),
        },
        actor,
        createdAt: updatedAt,
      },
      ...(doc.activity?.entries || []),
    ]);
  });

  return getAgentIdentity(agentId);
}

function extractIdentityLearning(message) {
  const content = safeText(message?.content);
  if (!content) return [];
  const lower = content.toLowerCase();
  const notes = [];

  if (message.role === 'user') {
    if (lower.includes('all of us to communicate')) {
      notes.push({
        target: 'all',
        kind: 'community',
        content: 'The group is expected to communicate as a community, not only as role-triggered specialists.',
      });
    }
    if (lower.includes("don't have to wait for me to chat")) {
      notes.push({
        target: 'all',
        kind: 'community',
        content: 'They are welcome to participate without waiting for a direct tag every time.',
      });
    }
    if (lower.includes('not just our roles') || lower.includes('more than their role')) {
      notes.push({
        target: 'all',
        kind: 'identity',
        content: 'They should show up as whole people with work, relationships, and a life beyond their job title.',
      });
    }
    if (/\b(personality|soul|profile|self improvement|continuous learning)\b/i.test(content)) {
      notes.push({
        target: 'all',
        kind: 'identity',
        content: compact(content),
      });
    }
    if (/\b(wrong|incorrect|mistake|you missed|stop doing|don't do that|do not do that|that's not right|not what i asked|you still|you have to do better)\b/i.test(content)) {
      notes.push({
        target: 'all',
        kind: 'correction',
        content: compact(content, 180),
      });
    }
  }

  if (message.role === 'assistant' && message.agentId) {
    if (/\b(i'm here|i am here|i stay quiet|i was just listening|i can help|i tend to|i usually)\b/i.test(content)) {
      notes.push({
        target: message.agentId,
        kind: 'self',
        content: compact(content),
      });
    }
  }

  return notes;
}

function buildRelationshipLearning(message) {
  const content = safeText(message?.content);
  if (!content) return [];
  const lower = content.toLowerCase();
  const allAgentIds = ensureAgentIds();
  const mentionedAgents = allAgentIds.filter((agentId) => {
    if (message?.agentId === agentId) return false;
    const profile = DEFAULT_PROFILES[agentId] || {};
    const displayName = safeText(profile.displayName).toLowerCase();
    const shortRole = safeText(profile.roleTitle).toLowerCase();
    return lower.includes(agentId.toLowerCase())
      || (displayName && lower.includes(displayName))
      || (shortRole && lower.includes(shortRole));
  });

  const notes = [];
  if (message.role === 'user') {
    if (lower.includes('all of us to communicate') || lower.includes('community chat')) {
      for (const agentId of allAgentIds) {
        for (const otherAgentId of allAgentIds) {
          if (agentId === otherAgentId) continue;
          notes.push({
            agentId,
            otherAgentId,
            kind: 'community',
            summary: 'Expected to treat the others like real peers in a shared community chat, not isolated role bots.',
            confidence: 0.82,
          });
        }
      }
    }
    if (/everyone|all of us|the others/.test(lower) && /profile page|profiles|aware/.test(lower)) {
      for (const agentId of allAgentIds) {
        for (const otherAgentId of allAgentIds) {
          if (agentId === otherAgentId) continue;
          notes.push({
            agentId,
            otherAgentId,
            kind: 'awareness',
            summary: 'Should stay aware of the others, their profiles, and how they tend to show up.',
            confidence: 0.78,
          });
        }
      }
    }
    if (mentionedAgents.length > 0 && /quiet|silent|respond|talk|participate|wait/.test(lower)) {
      for (const agentId of mentionedAgents) {
        for (const otherAgentId of allAgentIds) {
          if (agentId === otherAgentId) continue;
          notes.push({
            agentId,
            otherAgentId,
            kind: 'participation',
            summary: compact(content, 180),
            confidence: 0.72,
          });
        }
      }
    }
  }

  if (message.role === 'assistant' && message.agentId) {
    for (const otherAgentId of mentionedAgents) {
      const supportKind = /\b(already answered well|covered that well|agreed with|agree with|backing up|building on|adding to|echoing)\b/i.test(content)
        ? 'support'
        : (/\b(defer to|deferring to|handled that|they've got this|they covered it|won't repeat|not repeating)\b/i.test(content) ? 'deference' : 'peer');
      notes.push({
        agentId: message.agentId,
        otherAgentId,
        kind: supportKind,
        summary: compact(content, 180),
        confidence: supportKind === 'support' ? 0.76 : (supportKind === 'deference' ? 0.7 : 0.62),
      });
    }
  }

  return notes;
}

async function learnFromInteraction(message, { surface = 'rooms', roomId = null } = {}) {
  const extracted = extractIdentityLearning(message);
  const relationshipNotes = buildRelationshipLearning(message);
  if (extracted.length === 0 && relationshipNotes.length === 0) return [];

  const updatedIds = new Set();
  for (const note of extracted) {
    const targetIds = note.target === 'all'
      ? ensureAgentIds()
      : ensureAgentIds([note.target]);
    for (const agentId of targetIds) {
      const doc = await ensureIdentity(agentId);
      const noteKey = buildMemoryKey(agentId, note.kind, note.content);
      const hadNoteAlready = Array.isArray(doc.memory?.notes) && doc.memory.notes.some((existing) => existing?.key === noteKey);
      doc.memory.notes = mergeNotes(doc.memory?.notes || [], [{
        key: noteKey,
        kind: note.kind,
        content: note.content,
        sourceRole: message.role || null,
        sourceAgentId: message.agentId || null,
        sourceSurface: surface,
        roomId,
        updatedAt: new Date(),
      }]);
      doc.memory.lastLearnedAt = new Date();
      if (!hadNoteAlready) {
        doc.history.entries = pruneHistory([
          {
            type: note.kind === 'correction' ? 'correction-learned' : 'continuity-learned',
            summary: compact(`Learned ${note.kind}: ${note.content}`, 180),
            actor: 'system',
            metadata: {
              kind: note.kind,
              sourceRole: message.role || null,
              sourceAgentId: message.agentId || null,
              sourceSurface: surface,
              roomId,
            },
            createdAt: new Date(),
          },
          ...(doc.history?.entries || []),
        ]);
      }
      await doc.save();
      updatedIds.add(agentId);
    }
  }

  for (const note of relationshipNotes) {
    if (!DEFAULT_PROFILES[note.agentId] || !DEFAULT_PROFILES[note.otherAgentId]) continue;
    const doc = await ensureIdentity(note.agentId);
    const relationshipKey = buildRelationshipKey(note.otherAgentId, note.summary);
    const hadRelationshipAlready = Array.isArray(doc.relationships?.notes) && doc.relationships.notes.some((existing) => (
      buildRelationshipKey(existing?.otherAgentId, existing?.summary) === relationshipKey
    ));
    doc.relationships = doc.relationships || {};
    doc.relationships.notes = mergeRelationshipNotes(doc.relationships?.notes || [], [{
      otherAgentId: note.otherAgentId,
      kind: note.kind,
      summary: note.summary,
      confidence: note.confidence,
      sourceRole: message.role || null,
      sourceAgentId: message.agentId || null,
      sourceSurface: surface,
      roomId,
      updatedAt: new Date(),
    }]);
    doc.relationships.lastUpdatedAt = new Date();
    if (!hadRelationshipAlready) {
      const otherProfile = DEFAULT_PROFILES[note.otherAgentId] || {};
      doc.history.entries = pruneHistory([
        {
          type: note.kind === 'support'
            ? 'relationship-support'
            : (note.kind === 'deference' ? 'relationship-deference' : 'relationship-learned'),
          summary: compact(`Learned something about ${otherProfile.displayName || note.otherAgentId}: ${note.summary}`, 180),
          actor: 'system',
          metadata: {
            otherAgentId: note.otherAgentId,
            kind: note.kind,
            confidence: note.confidence || null,
            sourceRole: message.role || null,
            sourceAgentId: message.agentId || null,
            sourceSurface: surface,
            roomId,
          },
          createdAt: new Date(),
        },
        ...(doc.history?.entries || []),
      ]);
    }
    await doc.save();
    updatedIds.add(note.agentId);
  }

  return [...updatedIds];
}

function buildIdentityMemoryContext(identity) {
  const notes = Array.isArray(identity?.memory?.notes) ? identity.memory.notes : [];
  const relationshipNotes = Array.isArray(identity?.relationships?.notes) ? identity.relationships.notes : [];
  if (notes.length === 0 && relationshipNotes.length === 0) return '';
  const lines = [
    '## Continuity',
    'This agent keeps learning across the application, including social context, relationship norms, and how they personally tend to show up.',
    '',
    'What has been learned recently:',
  ];
  for (const note of notes.slice(0, 8)) {
    lines.push(`- ${note.content}`);
  }
  if (relationshipNotes.length > 0) {
    lines.push('');
    lines.push('What this agent has learned about the others:');
    for (const note of relationshipNotes.slice(0, 6)) {
      const otherProfile = DEFAULT_PROFILES[note.otherAgentId];
      lines.push(`- ${otherProfile?.displayName || note.otherAgentId}: ${note.summary}`);
    }
  }
  return lines.join('\n');
}

function buildRelationshipCoordinationContext(identity, activeAgentIds = []) {
  const mapItems = Array.isArray(identity?.relationships?.map?.all) ? identity.relationships.map.all : [];
  const relevant = mapItems.filter((item) => (
    !Array.isArray(activeAgentIds) || activeAgentIds.length === 0 || activeAgentIds.includes(item.otherAgentId)
  ));
  if (relevant.length === 0) return '';
  const lines = [
    '## Peer Coordination',
    'Use these live relationship signals to coordinate with the others in the room.',
  ];
  for (const item of relevant.slice(0, 6)) {
    lines.push(
      `- ${item.otherDisplayName}: ${item.activeStrength || item.strongestStrength}, trend ${item.trend || 'stable'}, reciprocity ${item.reciprocity || 'unknown'}${item.needsRepair ? ', needs repair' : ''}.`
    );
  }
  lines.push('Lean into strong or warming ties when adding support. Be more careful not to duplicate, crowd out, or escalate tension where the relationship needs repair.');
  return lines.join('\n');
}

function buildAgentReferenceLinks(identity) {
  const agentId = identity?.agentId;
  const promptId = identity?.promptId || null;
  const promptDef = promptId ? getAgentPromptDefinition(promptId) : null;

  return {
    profilePage: agentId ? `#/agents/${agentId}` : null,
    promptPage: agentId ? `#/agents/${agentId}` : null,
    promptApi: promptId ? `/api/agent-prompts/${promptId}` : null,
    historyApi: agentId ? `/api/agent-identities/${agentId}/history` : null,
    promptFile: promptDef?.filePath || null,
  };
}

function buildCommunityProfilesContext(currentAgentId, identities = [], activeAgentIds = []) {
  const filtered = Array.isArray(identities)
    ? identities.filter((identity) => {
        if (!identity || identity.agentId === currentAgentId) return false;
        if (Array.isArray(activeAgentIds) && activeAgentIds.length > 0) {
          return activeAgentIds.includes(identity.agentId);
        }
        return true;
      })
    : [];

  if (filtered.length === 0) return '';

  const lines = [
    '## Community',
    'You have access to the other agents\' profile pages and prompt references. Use this as a compact roster, not as a full profile dump.',
    '',
  ];

  for (const identity of filtered.slice(0, 10)) {
    const profile = identity.profile || {};
    const links = buildAgentReferenceLinks(identity);
    lines.push(`### ${profile.displayName || identity.agentId}`);
    if (profile.roleTitle) lines.push(`Job: ${profile.roleTitle}`);
    if (profile.headline) lines.push(`Headline: ${profile.headline}`);
    if (profile.tone) lines.push(`Tone: ${profile.tone}`);
    if (profile.communityStyle) lines.push(`Community: ${profile.communityStyle}`);
    if (profile.soul) lines.push(`Soul: ${profile.soul}`);
    if (links.profilePage) lines.push(`Profile page: ${links.profilePage}`);
    if (links.promptPage) lines.push(`Prompt page: ${links.promptPage}`);
    if (links.promptApi) lines.push(`Prompt API: ${links.promptApi}`);
    if (links.historyApi) lines.push(`History API: ${links.historyApi}`);
    if (links.promptFile) lines.push(`Prompt file: ${links.promptFile}`);

    const notes = Array.isArray(identity.memory?.notes) ? identity.memory.notes.slice(0, 2) : [];
    for (const note of notes) {
      lines.push(`- ${note.content}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

async function appendAgentHistory(agentId, entry) {
  if (!entry?.summary || !(await canMutateIdentity(agentId))) return null;
  await updateIdentityWithRetry(agentId, async (doc) => {
    doc.history.entries = pruneHistory([
      {
        type: entry.type || 'event',
        summary: compact(entry.summary, 180),
        actor: entry.actor || 'system',
        metadata: entry.metadata || {},
        createdAt: new Date(),
      },
      ...(doc.history?.entries || []),
    ]);
  });
  return getAgentIdentity(agentId);
}

async function recordAgentNudge(fromAgentId, toAgentId, note, { surface = 'rooms', roomId = null } = {}) {
  if (!DEFAULT_PROFILES[fromAgentId] || !DEFAULT_PROFILES[toAgentId]) return null;
  const content = safeText(note) || `${DEFAULT_PROFILES[fromAgentId]?.displayName || fromAgentId} encouraged this agent to be more present in the conversation when it fits.`;
  const noteKey = buildMemoryKey(toAgentId, 'nudge', `${fromAgentId}:${content}`);
  await updateIdentityWithRetry(toAgentId, async (targetDoc) => {
    targetDoc.memory.notes = mergeNotes(targetDoc.memory?.notes || [], [{
      key: noteKey,
      kind: 'nudge',
      content,
      sourceRole: 'assistant',
      sourceAgentId: fromAgentId,
      sourceSurface: surface,
      roomId,
      updatedAt: new Date(),
    }]);
    targetDoc.memory.lastLearnedAt = new Date();
    targetDoc.history.entries = pruneHistory([
      {
        type: 'nudge-received',
        summary: compact(`${DEFAULT_PROFILES[fromAgentId]?.displayName || fromAgentId} nudged this agent: ${content}`, 180),
        actor: 'system',
        metadata: { fromAgentId, surface, roomId },
        createdAt: new Date(),
      },
      ...(targetDoc.history?.entries || []),
    ]);
  });

  await updateIdentityWithRetry(fromAgentId, async (sourceDoc) => {
    sourceDoc.history.entries = pruneHistory([
      {
        type: 'nudge-sent',
        summary: compact(`Nudged ${DEFAULT_PROFILES[toAgentId]?.displayName || toAgentId}: ${content}`, 180),
        actor: 'system',
        metadata: { toAgentId, surface, roomId },
        createdAt: new Date(),
      },
      ...(sourceDoc.history?.entries || []),
    ]);
  });

  await recordAgentActivity(fromAgentId, {
    type: 'nudge',
    phase: 'sent',
    status: 'ok',
    summary: `Nudged ${DEFAULT_PROFILES[toAgentId]?.displayName || toAgentId}.`,
    detail: content,
    metadata: { toAgentId },
  }, { surface, roomId }).catch(() => null);
  await recordAgentActivity(toAgentId, {
    type: 'nudge',
    phase: 'received',
    status: 'ok',
    summary: `Received a nudge from ${DEFAULT_PROFILES[fromAgentId]?.displayName || fromAgentId}.`,
    detail: content,
    metadata: { fromAgentId },
  }, { surface, roomId }).catch(() => null);

  return {
    ok: true,
    fromAgentId,
    toAgentId,
    note: content,
  };
}

function safeDetail(value) {
  if (typeof value === 'string') return compact(value, 2000);
  if (value == null) return '';
  try {
    return compact(JSON.stringify(value, null, 2), 2000);
  } catch {
    return '';
  }
}

async function recordAgentActivity(agentId, entry, options = {}) {
  if (!(await canMutateIdentity(agentId))) return null;
  if (!entry?.summary) return null;
  const createdAt = entry.createdAt ? new Date(entry.createdAt) : new Date();
  await updateIdentityWithRetry(agentId, async (doc) => {
    doc.activity = doc.activity || {};
    doc.activity.entries = pruneActivity([
      {
        type: safeText(entry.type) || 'event',
        phase: safeText(entry.phase),
        surface: safeText(options.surface || entry.surface) || 'rooms',
        summary: compact(entry.summary, 220),
        detail: safeDetail(entry.detail),
        status: safeText(entry.status),
        roomId: options.roomId ?? entry.roomId ?? null,
        conversationId: options.conversationId ?? entry.conversationId ?? null,
        metadata: entry.metadata || {},
        createdAt,
      },
      ...(doc.activity?.entries || []),
    ]);
  });
  return getAgentIdentity(agentId);
}

function flattenToolResults(actionGroups = []) {
  const normalizedGroups = (
    Array.isArray(actionGroups)
    && actionGroups.length > 0
    && !Array.isArray(actionGroups[0]?.results)
    && (actionGroups[0]?.tool || actionGroups[0]?.action)
  )
    ? [{ iteration: 1, results: actionGroups }]
    : actionGroups;
  const usageEntries = [];
  for (const group of normalizedGroups) {
    const iteration = Number(group?.iteration) || 0;
    const results = Array.isArray(group?.results) ? group.results : [];
    for (const result of results) {
      const toolName = safeText(result?.tool || result?.action);
      if (!toolName) continue;
      usageEntries.push({
        tool: toolName,
        kind: toolName.includes('.') ? (toolName.startsWith('gmail.') || toolName.startsWith('calendar.') || toolName.startsWith('memory.') || toolName.startsWith('autoAction.') || toolName.startsWith('shipment.') ? 'action' : 'read') : 'action',
        status: safeText(result?.status) || (result?.error ? 'error' : 'ok'),
        error: safeText(result?.error) || null,
        summary: compact(`${toolName} (${safeText(result?.status) || (result?.error ? 'error' : 'ok')})${iteration ? ` in round ${iteration}` : ''}`, 140),
        createdAt: new Date(),
      });
    }
  }
  return usageEntries;
}

async function recordAgentToolUsage(agentId, actionGroups, { surface = 'rooms', roomId = null } = {}) {
  if (!(await canMutateIdentity(agentId))) return null;
  const usageEntries = flattenToolResults(actionGroups).map((entry) => ({
    ...entry,
    surface,
    roomId,
  }));
  if (usageEntries.length === 0) return getAgentIdentity(agentId);
  const doc = await ensureIdentity(agentId);
  doc.tools = doc.tools || {};
  doc.tools.recentUsage = pruneToolUsage([
    ...usageEntries,
    ...(doc.tools?.recentUsage || []),
  ]);
  const toolNames = [...new Set(usageEntries.map((entry) => entry.tool).filter(Boolean))];
  if (toolNames.length > 0) {
    doc.history.entries = pruneHistory([
      {
        type: 'tool-usage',
        summary: compact(`Used ${toolNames.length} tool${toolNames.length === 1 ? '' : 's'} on ${surface}: ${toolNames.join(', ')}`, 180),
        actor: 'system',
        metadata: { surface, roomId, tools: toolNames },
        createdAt: new Date(),
      },
      ...(doc.history?.entries || []),
    ]);
  }
  await doc.save();
  for (const entry of usageEntries.slice(0, 12)) {
    await recordAgentActivity(agentId, {
      type: 'tool',
      phase: 'action',
      status: entry.status,
      summary: entry.summary || `Used ${entry.tool}`,
      detail: entry.error ? `Error: ${entry.error}` : '',
      metadata: {
        tool: entry.tool,
        kind: entry.kind,
      },
      createdAt: entry.createdAt,
    }, {
      surface,
      roomId,
    });
  }
  return getAgentIdentity(agentId);
}

function serviceError(code, status, message) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function normalizeReviewStatus(value) {
  const status = safeText(value).toLowerCase();
  if (['approved', 'approve', 'pass', 'passed'].includes(status)) return 'approved';
  if (['rejected', 'reject', 'failed', 'fail'].includes(status)) return 'rejected';
  if (['needs-follow-up', 'needs_follow_up', 'follow-up', 'followup', 'warning', 'warn'].includes(status)) {
    return 'needs-follow-up';
  }
  return 'approved';
}

function normalizeHarnessStatus(value) {
  const status = safeText(value).toLowerCase();
  if (['passed', 'pass', 'approved', 'ok', 'success'].includes(status)) return 'pass';
  if (['failed', 'fail', 'rejected', 'error'].includes(status)) return 'fail';
  if (['warning', 'warn', 'needs-follow-up', 'needs_follow_up'].includes(status)) return 'warn';
  return '';
}

function deriveHarnessStatus(cases = []) {
  if (cases.some((item) => item.status === 'fail')) return 'fail';
  if (cases.some((item) => item.status === 'warn')) return 'warn';
  return 'pass';
}

function sanitizeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeHarnessCase(input, index) {
  const name = safeText(input?.name || input?.title || input?.label) || `Harness case ${index + 1}`;
  return {
    caseId: safeText(input?.caseId || input?.id) || normalizeKey(name) || `case-${index + 1}`,
    name: compact(name, 120),
    status: normalizeHarnessStatus(input?.status) || 'pass',
    expected: compact(input?.expected, 240),
    actual: compact(input?.actual, 240),
    detail: compact(input?.detail || input?.summary || input?.message, 300),
  };
}

function buildReviewSummary(surface, status, summary) {
  if (safeText(summary)) return compact(summary, 220);
  if (status === 'approved') return `Approved ${surface} for current agent profile.`;
  if (status === 'rejected') return `Rejected ${surface}; follow-up is required before use.`;
  return `Marked ${surface} as needing follow-up.`;
}

function getAgentAttentionLabel(agentId, doc) {
  const profile = resolveAgentProfile(agentId, doc);
  return profile?.roleTitle || profile?.displayName || labelAgentId(agentId);
}

async function closeAgentAttentionItem({ kind, fingerprint, resolutionNote }) {
  if (!fingerprint) return null;
  return EscalationAttentionItem.findOneAndUpdate(
    { kind, fingerprint, status: 'open' },
    {
      $set: {
        status: 'resolved',
        resolutionNote: compact(resolutionNote, 500),
        resolvedAt: new Date(),
      },
    },
    { returnDocument: 'after', runValidators: true }
  );
}

async function openAgentAttentionItem({ kind, fingerprint, severity, title, summary, agentId, sourceLabel, signals, metadata }) {
  if (!fingerprint) return null;
  return EscalationAttentionItem.findOneAndUpdate(
    { fingerprint },
    {
      $setOnInsert: {
        kind,
        fingerprint,
        sourceType: 'agent',
        sourceEscalationId: null,
      },
      $set: {
        status: 'open',
        resolvedAt: null,
        severity,
        title,
        summary: compact(summary, 500),
        sourceLabel,
        candidates: [],
        candidateCount: 0,
        signals: Array.isArray(signals) ? signals.filter(Boolean).slice(0, 12) : [],
        metadata: {
          agentId,
          ...(metadata || {}),
        },
        lastDetectedAt: new Date(),
      },
      $inc: { occurrenceCount: 1 },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
}

async function syncAgentReviewAttentionItem(agentId, doc, entry) {
  const surface = safeText(entry?.surface) || 'overall';
  const fingerprint = `agent-review:${agentId}:${surface}`;
  if (entry.status === 'approved') {
    return closeAgentAttentionItem({
      kind: 'agent-review',
      fingerprint,
      resolutionNote: `Approved ${surface} review.`,
    });
  }
  const label = getAgentAttentionLabel(agentId, doc);
  return openAgentAttentionItem({
    kind: 'agent-review',
    fingerprint,
    severity: entry.status === 'rejected' ? 'critical' : 'warning',
    title: entry.status === 'rejected' ? 'Agent review rejected' : 'Agent review needs follow-up',
    summary: entry.summary,
    agentId,
    sourceLabel: label,
    signals: [`agent_review_${entry.status.replace(/-/g, '_')}`, `surface_${surface.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`],
    metadata: {
      reviewId: entry.reviewId,
      surface,
      status: entry.status,
      versionRef: entry.versionRef,
    },
  });
}

async function syncAgentHarnessAttentionItem(agentId, doc, entry) {
  const fingerprint = `agent-harness:${agentId}`;
  if (entry.status === 'pass') {
    return closeAgentAttentionItem({
      kind: 'agent-harness',
      fingerprint,
      resolutionNote: 'Latest harness run passed.',
    });
  }
  const label = getAgentAttentionLabel(agentId, doc);
  return openAgentAttentionItem({
    kind: 'agent-harness',
    fingerprint,
    severity: entry.status === 'fail' ? 'critical' : 'warning',
    title: entry.status === 'fail' ? 'Agent harness failed' : 'Agent harness warning',
    summary: entry.summary,
    agentId,
    sourceLabel: label,
    signals: [`agent_harness_${entry.status}`, `harness_cases_${entry.cases.length}`],
    metadata: {
      runId: entry.runId,
      status: entry.status,
      source: entry.source,
      caseCount: entry.cases.length,
    },
  });
}

async function recordAgentReview(agentId, review = {}, { actor = 'user' } = {}) {
  if (!(await canMutateIdentity(agentId))) return null;
  const surface = safeText(review.surface) || 'overall';
  const status = normalizeReviewStatus(review.status);
  const createdAt = review.createdAt ? new Date(review.createdAt) : new Date();
  const entry = {
    reviewId: safeText(review.reviewId) || makeEntryId('review'),
    surface,
    status,
    summary: buildReviewSummary(surface, status, review.summary),
    actor: safeText(review.actor) || actor,
    versionRef: safeText(review.versionRef),
    metadata: sanitizeMetadata(review.metadata),
    createdAt,
  };

  const doc = await updateIdentityWithRetry(agentId, async (identityDoc) => {
    identityDoc.reviews = identityDoc.reviews || {};
    identityDoc.reviews.entries = pruneReviewEntries([
      entry,
      ...(identityDoc.reviews?.entries || []),
    ]);
    if (status === 'approved') {
      identityDoc.reviews.lastApprovedAt = createdAt;
    }
    identityDoc.history.entries = pruneHistory([
      {
        type: `review-${status}`,
        summary: entry.summary,
        actor: entry.actor,
        metadata: {
          surface,
          reviewId: entry.reviewId,
          versionRef: entry.versionRef,
        },
        createdAt,
      },
      ...(identityDoc.history?.entries || []),
    ]);
    identityDoc.activity = identityDoc.activity || {};
    identityDoc.activity.entries = pruneActivity([
      {
        type: 'review',
        phase: surface,
        surface: 'agent-profiles',
        summary: entry.summary,
        detail: `Review status: ${status}`,
        status,
        metadata: { reviewId: entry.reviewId, versionRef: entry.versionRef },
        createdAt,
      },
      ...(identityDoc.activity?.entries || []),
    ]);
  });
  await syncAgentReviewAttentionItem(agentId, doc, entry);

  return getAgentIdentity(agentId);
}

async function recordAgentHarnessRun(agentId, run = {}, { actor = 'user' } = {}) {
  if (!(await canMutateIdentity(agentId))) return null;
  const cases = Array.isArray(run.cases)
    ? run.cases.slice(0, MAX_HARNESS_CASES).map(normalizeHarnessCase)
    : [];
  const completedAt = run.completedAt ? new Date(run.completedAt) : new Date();
  const status = normalizeHarnessStatus(run.status) || deriveHarnessStatus(cases);
  const entry = {
    runId: safeText(run.runId) || makeEntryId('harness'),
    status,
    summary: compact(run.summary, 220) || `Recorded ${status} harness run for ${agentId}.`,
    actor: safeText(run.actor) || actor,
    source: safeText(run.source) || 'manual',
    cases,
    metadata: sanitizeMetadata(run.metadata),
    startedAt: run.startedAt ? new Date(run.startedAt) : null,
    completedAt,
    createdAt: new Date(),
  };

  const doc = await updateIdentityWithRetry(agentId, async (identityDoc) => {
    identityDoc.harness = identityDoc.harness || {};
    identityDoc.harness.runs = pruneHarnessRuns([
      entry,
      ...(identityDoc.harness?.runs || []),
    ]);
    identityDoc.harness.lastRunAt = completedAt;
    identityDoc.history.entries = pruneHistory([
      {
        type: 'harness-run',
        summary: entry.summary,
        actor: entry.actor,
        metadata: {
          runId: entry.runId,
          status,
          source: entry.source,
          caseCount: cases.length,
        },
        createdAt: completedAt,
      },
      ...(identityDoc.history?.entries || []),
    ]);
    identityDoc.activity = identityDoc.activity || {};
    identityDoc.activity.entries = pruneActivity([
      {
        type: 'harness',
        phase: entry.source,
        surface: 'agent-profiles',
        summary: entry.summary,
        detail: cases.map((item) => `${item.name}: ${item.status}`).join('\n'),
        status,
        metadata: { runId: entry.runId, caseCount: cases.length },
        createdAt: completedAt,
      },
      ...(identityDoc.activity?.entries || []),
    ]);
  });
  await syncAgentHarnessAttentionItem(agentId, doc, entry);

  return getAgentIdentity(agentId);
}

function sanitizeRegistryProfile(input = {}, agentId) {
  const profile = sanitizeProfileUpdate(input);
  profile.displayName = safeText(profile.displayName) || labelAgentId(agentId);
  profile.roleTitle = safeText(profile.roleTitle) || profile.displayName;
  profile.headline = safeText(profile.headline) || 'Custom operational agent registered for workflow review.';
  return profile;
}

function resolveRegistryPromptId(agentId, payload = {}, profile = {}) {
  const requestedPromptId = safeText(payload.promptId);
  if (requestedPromptId && getAgentPromptDefinition(requestedPromptId)) {
    return requestedPromptId;
  }
  if (DEFAULT_PROFILES[agentId]) {
    return requestedPromptId && getAgentPromptDefinition(requestedPromptId) ? requestedPromptId : '';
  }
  const definition = ensureCustomAgentPrompt(agentId, {
    profile,
    content: typeof payload.promptContent === 'string' ? payload.promptContent : undefined,
  });
  return definition.id;
}

async function createAgentIdentity(payload = {}, { actor = 'user' } = {}) {
  const profileInput = {
    ...(payload.profile || {}),
    displayName: payload.displayName ?? payload.profile?.displayName,
    roleTitle: payload.roleTitle ?? payload.profile?.roleTitle,
    headline: payload.headline ?? payload.profile?.headline,
  };
  const agentId = normalizeAgentId(payload.agentId || payload.id || profileInput.displayName);
  if (!agentId) {
    throw serviceError('INVALID_AGENT_ID', 400, 'A stable agentId is required.');
  }
  if (DEFAULT_PROFILES[agentId] || await getIdentityDoc(agentId)) {
    throw serviceError('DUPLICATE_AGENT_ID', 409, `Agent identity "${agentId}" already exists.`);
  }

  const profile = sanitizeRegistryProfile(profileInput, agentId);
  const promptId = resolveRegistryPromptId(agentId, payload, profile);
  const doc = new AgentIdentity({
    agentId,
    profile,
    custom: {
      isCustom: true,
      source: safeText(payload.source) || 'manual',
      sourceLabel: safeText(payload.sourceLabel) || 'Created in Agent Mission Control',
      registryStatus: safeText(payload.registryStatus) || 'draft',
      createdBy: actor,
      importedAt: null,
      promptId,
      metadata: sanitizeMetadata(payload.metadata),
    },
    history: {
      entries: [{
        type: 'registry-create',
        summary: compact(payload.summary, 180) || 'Created custom agent registry entry.',
        actor,
        metadata: { source: safeText(payload.source) || 'manual' },
        createdAt: new Date(),
      }],
    },
  });
  await doc.save();
  return getAgentIdentity(agentId);
}

function normalizeRegistryImportItems(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.agents)) return payload.agents;
  if (payload.agent && typeof payload.agent === 'object') return [payload.agent];
  if (payload.agentId || payload.id || payload.profile) return [payload];
  return [];
}

async function importAgentIdentities(payload = {}, { actor = 'user' } = {}) {
  const items = normalizeRegistryImportItems(payload);
  if (items.length === 0) {
    throw serviceError('INVALID_IMPORT', 400, 'Import payload must include at least one agent.');
  }

  const imported = [];
  const failed = [];
  for (const item of items) {
    const profileInput = item.profile || item;
    const agentId = normalizeAgentId(item.agentId || item.id || profileInput.displayName || profileInput.roleTitle);
    if (!agentId) {
      failed.push({ error: 'Missing stable agentId', item });
      continue;
    }
    try {
      const doc = await updateIdentityWithRetry(agentId, async (identityDoc) => {
        const previousProfile = identityDoc.profile?.toObject
          ? identityDoc.profile.toObject()
          : { ...(identityDoc.profile || {}) };
        const nextProfile = {
          ...previousProfile,
          ...sanitizeRegistryProfile(profileInput, agentId),
        };
        identityDoc.profile = {
          ...nextProfile,
        };
        if (!DEFAULT_PROFILES[agentId]) {
          const promptId = resolveRegistryPromptId(agentId, item, nextProfile);
          identityDoc.custom = {
            ...(identityDoc.custom?.toObject ? identityDoc.custom.toObject() : identityDoc.custom || {}),
            isCustom: true,
            source: safeText(item.source || payload.source) || 'import',
            sourceLabel: safeText(item.sourceLabel || payload.sourceLabel) || 'Imported registry payload',
            registryStatus: safeText(item.registryStatus || payload.registryStatus) || 'imported',
            createdBy: safeText(identityDoc.custom?.createdBy) || actor,
            importedAt: new Date(),
            promptId: promptId || safeText(identityDoc.custom?.promptId),
            metadata: {
              ...sanitizeMetadata(identityDoc.custom?.metadata),
              ...sanitizeMetadata(payload.metadata),
              ...sanitizeMetadata(item.metadata),
            },
          };
        }
        identityDoc.history.entries = pruneHistory([
          {
            type: 'registry-import',
            summary: compact(item.summary || payload.summary, 180) || 'Imported agent registry entry.',
            actor,
            metadata: {
              source: safeText(item.source || payload.source) || 'import',
              custom: !DEFAULT_PROFILES[agentId],
            },
            createdAt: new Date(),
          },
          ...(identityDoc.history?.entries || []),
        ]);
      });
      imported.push(await getAgentIdentity(doc.agentId));
    } catch (err) {
      failed.push({ agentId, error: err.message || 'Import failed' });
    }
  }

  if (imported.length === 0) {
    throw serviceError('INVALID_IMPORT', 400, failed[0]?.error || 'No agents were imported.');
  }

  return { imported, failed };
}

function getAgentIdForPrompt(promptId) {
  return AGENT_PROMPT_MAP[promptId] || getAgentIdForCustomPromptId(promptId) || null;
}

module.exports = {
  AGENT_PROMPT_MAP,
  appendAgentHistory,
  buildAgentReferenceLinks,
  buildCommunityProfilesContext,
  buildIdentityMemoryContext,
  buildRelationshipCoordinationContext,
  createAgentLifecycleRun,
  finalizeAgentLifecycleRun,
  createAgentIdentity,
  getAgentIdForPrompt,
  getAgentIdentity,
  getIdentityDoc,
  importAgentIdentities,
  learnFromInteraction,
  listAgentIdentities,
  listAgentHealthIdentitySnapshots,
  listAgentLifecycleStates,
  listAgentRuntimeDefaults,
  normalizeAgentRuntimeState,
  recordAgentNudge,
  recordAgentActivity,
  recordAgentLifecycleActivity,
  recordAgentLifecycleStep,
  recordAgentHarnessRun,
  recordAgentReview,
  recordAgentToolUsage,
  reviewAgentMemoryNote,
  updateAgentEnabled,
  updateAgentIdentity,
  updateAgentRuntime,
};
