'use strict';

const AgentIdentity = require('../models/AgentIdentity');
const { getAgentPromptDefinition } = require('../lib/agent-prompt-store');
const {
  DEFAULT_PROFILES,
  mergeAgentProfile,
} = require('./room-agents/agent-profiles');

const MAX_HISTORY_ENTRIES = 120;
const MAX_MEMORY_NOTES = 24;
const MAX_TOOL_USAGE_ENTRIES = 40;
const MAX_ACTIVITY_ENTRIES = 240;
const MAX_RELATIONSHIP_NOTES = 24;

const SHARED_AGENT_TOOLS = Object.freeze([
  { name: 'agentProfiles.list', kind: 'read', description: 'List agent profiles with summary fields and references.', params: '{}' },
  { name: 'agentProfiles.get', kind: 'read', description: 'Read a specific agent profile, continuity, and references.', params: '{ agentId }' },
  { name: 'agentProfiles.history', kind: 'read', description: 'Read the history log for a specific agent.', params: '{ agentId }' },
  { name: 'agentProfiles.updateAvatar', kind: 'write', description: 'Update an agent avatar using an image URL, emoji, or generated asset.', params: '{ agentId, imageUrl?, emoji?, prompt?, source?, summary? }' },
  { name: 'agentProfiles.generateAvatar', kind: 'write', description: 'Generate and save a fresh SVG avatar for an agent from a short creative prompt.', params: '{ agentId, prompt?, palette?, emoji?, summary? }' },
  { name: 'agentProfiles.nudge', kind: 'write', description: 'Nudge another agent to participate more naturally in the conversation.', params: '{ fromAgentId, toAgentId, note?, roomId?, surface? }' },
  { name: 'db.searchEscalations', kind: 'read', description: 'Search escalations by text, category, or status.', params: '{ query?, category?, status?, limit? }' },
  { name: 'db.getEscalation', kind: 'read', description: 'Fetch one escalation by id or caseNumber.', params: '{ id?, caseNumber? }' },
  { name: 'db.searchInvestigations', kind: 'read', description: 'Search investigations by INV number or text.', params: '{ query?, status?, limit? }' },
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

const PARSER_AGENT_IDS = new Set([
  'escalation-template-parser',
  'follow-up-chat-parser',
]);

const AGENT_PROMPT_MAP = Object.freeze({
  'chat-core': 'chat',
  'escalation-template-parser': 'escalation-template-parser',
  'triage-agent': 'triage-agent',
  'follow-up-chat-parser': 'follow-up-chat-parser',
  'workspace-action': 'workspace',
  'copilot-agent': 'copilot',
  'image-parser': 'image-analyst',
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

function buildRelationshipMap(agentId, relationshipNotes = [], historyEntries = [], docsById = null) {
  const relevantNotes = Array.isArray(relationshipNotes) ? relationshipNotes : [];
  const byOtherAgent = new Map();

  for (const note of relevantNotes) {
    if (!note?.otherAgentId || !DEFAULT_PROFILES[note.otherAgentId]) continue;
    const bucket = byOtherAgent.get(note.otherAgentId) || {
      otherAgentId: note.otherAgentId,
      otherDisplayName: DEFAULT_PROFILES[note.otherAgentId]?.displayName || note.otherAgentId,
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

async function updateIdentityWithRetry(agentId, mutate, maxAttempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const doc = await ensureIdentity(agentId);
    await mutate(doc);
    try {
      await doc.save();
      return doc;
    } catch (err) {
      lastError = err;
      if (err?.name !== 'VersionError' && err?.code !== 11000) {
        throw err;
      }
    }
  }
  throw lastError || new Error(`Failed to update agent identity for ${agentId}`);
}

function buildMergedIdentity(agentId, doc = null, docsById = null) {
  const overrides = clone(doc?.profile || {});
  const profile = mergeAgentProfile(agentId, overrides);
  if (!profile) return null;
  return {
    agentId,
    promptId: Object.entries(AGENT_PROMPT_MAP).find(([, mappedAgentId]) => mappedAgentId === agentId)?.[0] || null,
    profile,
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
    history: {
      entries: clone(doc?.history?.entries || []),
    },
    updatedAt: doc?.updatedAt || null,
    createdAt: doc?.createdAt || null,
  };
}

async function listAgentIdentities() {
  const docs = await AgentIdentity.find({
    agentId: { $in: Object.keys(DEFAULT_PROFILES) },
  }).lean();
  const byId = new Map(docs.map((doc) => [doc.agentId, doc]));
  return Object.keys(DEFAULT_PROFILES).map((agentId) => buildMergedIdentity(agentId, byId.get(agentId), byId));
}

async function getAgentIdentity(agentId) {
  if (!DEFAULT_PROFILES[agentId]) return null;
  const docs = await AgentIdentity.find({
    agentId: { $in: Object.keys(DEFAULT_PROFILES) },
  }).lean();
  const byId = new Map(docs.map((doc) => [doc.agentId, doc]));
  const doc = byId.get(agentId) || null;
  return buildMergedIdentity(agentId, doc, byId);
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
  if (!DEFAULT_PROFILES[agentId]) return null;
  const doc = await ensureIdentity(agentId);
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
  if (!DEFAULT_PROFILES[agentId] || !entry?.summary) return null;
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
  if (!DEFAULT_PROFILES[agentId]) return null;
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
  if (!DEFAULT_PROFILES[agentId]) return null;
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

function getAgentIdForPrompt(promptId) {
  return AGENT_PROMPT_MAP[promptId] || null;
}

module.exports = {
  AGENT_PROMPT_MAP,
  appendAgentHistory,
  buildAgentReferenceLinks,
  buildCommunityProfilesContext,
  buildIdentityMemoryContext,
  buildRelationshipCoordinationContext,
  getAgentIdForPrompt,
  getAgentIdentity,
  getIdentityDoc,
  learnFromInteraction,
  listAgentIdentities,
  recordAgentNudge,
  recordAgentActivity,
  recordAgentToolUsage,
  updateAgentIdentity,
};
