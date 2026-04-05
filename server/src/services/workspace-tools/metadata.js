'use strict';

const { SHARED_AGENT_TOOL_METADATA } = require('../shared-agent-tools');

const WORKSPACE_TOOL_METADATA = {
  'gmail.search': {
    kind: 'read',
    description: 'Search emails.',
    params: '{ q, maxResults?, account? }',
    statusLabel: 'Searching emails',
  },
  'gmail.send': {
    kind: 'write',
    description: 'Send email.',
    params: '{ to, subject, body, cc?, bcc?, threadId?, inReplyTo?, references?, account? }',
    statusLabel: 'Sending email',
  },
  'gmail.archive': {
    kind: 'write',
    description: 'Archive message (remove from inbox).',
    params: '{ messageId, account? }',
    statusLabel: 'Archiving message',
  },
  'gmail.trash': {
    kind: 'write',
    description: 'Trash message.',
    params: '{ messageId, account? }',
    statusLabel: 'Trashing message',
  },
  'gmail.star': {
    kind: 'write',
    description: 'Star message.',
    params: '{ messageId, account? }',
    statusLabel: 'Starring message',
  },
  'gmail.unstar': {
    kind: 'write',
    description: 'Unstar message.',
    params: '{ messageId, account? }',
    statusLabel: 'Unstarring message',
  },
  'gmail.markRead': {
    kind: 'write',
    description: 'Mark as read.',
    params: '{ messageId, account? }',
    statusLabel: 'Marking as read',
  },
  'gmail.markUnread': {
    kind: 'write',
    description: 'Mark as unread.',
    params: '{ messageId, account? }',
    statusLabel: 'Marking as unread',
  },
  'gmail.label': {
    kind: 'write',
    description: 'Apply a label. Accepts a label ID or label name; missing user labels are created automatically.',
    params: '{ messageId, labelId?, labelName?, label?, account? }',
    statusLabel: 'Applying label',
  },
  'gmail.removeLabel': {
    kind: 'write',
    description: 'Remove a label. Accepts a label ID or label name.',
    params: '{ messageId, labelId?, labelName?, label?, account? }',
    statusLabel: 'Removing label',
  },
  'gmail.draft': {
    kind: 'write',
    description: 'Create draft.',
    params: '{ to, subject, body, cc?, bcc?, account? }',
    statusLabel: 'Creating draft',
  },
  'gmail.getMessage': {
    kind: 'read',
    description: 'Read a specific email by ID.',
    params: '{ messageId, account? }',
    statusLabel: 'Reading email',
  },
  'gmail.listLabels': {
    kind: 'read',
    description: 'List all Gmail labels.',
    params: '{ account? }',
    statusLabel: 'Listing labels',
  },
  'gmail.createLabel': {
    kind: 'write',
    description: 'Create a Gmail label/folder.',
    params: '{ name, labelListVisibility?, messageListVisibility?, account? }',
    statusLabel: 'Creating label',
  },
  'gmail.createFilter': {
    kind: 'write',
    description: 'Create an auto-filter rule.',
    params: '{ criteria: { from?, to?, subject?, query? }, action: { addLabelIds?: ["label-id"], removeLabelIds?: ["INBOX"] }, account? }',
    statusLabel: 'Creating filter',
  },
  'gmail.listFilters': {
    kind: 'read',
    description: 'List all Gmail filters.',
    params: '{ account? }',
    statusLabel: 'Listing filters',
  },
  'gmail.deleteFilter': {
    kind: 'write',
    description: 'Delete a filter.',
    params: '{ filterId, account? }',
    statusLabel: 'Deleting filter',
  },
  'gmail.batchModify': {
    kind: 'write',
    description: 'Bulk modify messages. Accepts label IDs or label names; missing add-labels are created automatically.',
    params: '{ messageIds: ["id1","id2"], addLabelIds?: ["label-id-or-name"], removeLabelIds?: ["label-id-or-name"], addLabels?: ["name"], removeLabels?: ["name"], account? }',
    statusLabel: 'Updating messages',
  },
  'calendar.listEvents': {
    kind: 'read',
    description: 'List events in a time range.',
    params: '{ timeMin, timeMax, q?, calendarId?, account? }',
    statusLabel: 'Checking calendar',
  },
  'calendar.createEvent': {
    kind: 'write',
    description: 'Create event.',
    params: '{ summary, start, end, location?, description?, attendees?, allDay?, timeZone?, account?, reminders?: { useDefault: false, overrides: [{ method: "popup", minutes: 5 }] } }',
    statusLabel: 'Creating event',
  },
  'calendar.updateEvent': {
    kind: 'write',
    description: 'Update event.',
    params: '{ eventId, summary?, start?, end?, location?, description?, attendees?, calendarId?, account?, reminders?: { useDefault: false, overrides: [{ method: "popup", minutes: 5 }] } }',
    statusLabel: 'Updating event',
  },
  'calendar.deleteEvent': {
    kind: 'write',
    description: 'Delete event.',
    params: '{ eventId, calendarId?, account? }',
    statusLabel: 'Deleting event',
  },
  'calendar.freeTime': {
    kind: 'read',
    description: 'Find free time.',
    params: '{ calendarIds?, timeMin, timeMax, timeZone?, account? }',
    statusLabel: 'Finding free time',
  },
  'memory.save': {
    kind: 'write',
    description: 'Save to memory.',
    params: '{ type, key, content, source? }',
    statusLabel: 'Saving to memory',
  },
  'memory.list': {
    kind: 'read',
    description: 'Check memory.',
    params: '{ query?, type?, limit? }',
    statusLabel: 'Checking memory',
  },
  'memory.delete': {
    kind: 'write',
    description: 'Remove memory.',
    params: '{ key }',
    statusLabel: 'Removing memory',
  },
  'agentProfiles.list': {
    kind: 'read',
    description: 'List all agent profiles with summary fields and links to their profile pages.',
    params: '{}',
    statusLabel: 'Listing agent profiles',
  },
  'agentProfiles.get': {
    kind: 'read',
    description: 'Open a specific agent profile, including profile data, learned continuity, and links.',
    params: '{ agentId }',
    statusLabel: 'Opening agent profile',
  },
  'agentProfiles.history': {
    kind: 'read',
    description: 'Read the profile and prompt history log for a specific agent.',
    params: '{ agentId }',
    statusLabel: 'Reading agent history',
  },
  'agentProfiles.updateAvatar': {
    kind: 'write',
    description: 'Update an agent avatar using an external image URL, emoji, or prompt metadata.',
    params: '{ agentId, imageUrl?, emoji?, prompt?, source?, summary? }',
    statusLabel: 'Updating avatar',
  },
  'agentProfiles.generateAvatar': {
    kind: 'write',
    description: 'Generate and save a new SVG avatar for an agent from a short prompt.',
    params: '{ agentId, prompt?, palette?, emoji?, summary? }',
    statusLabel: 'Generating avatar',
  },
  'agentProfiles.nudge': {
    kind: 'write',
    description: 'Send another agent a social nudge to encourage them to join the conversation more naturally.',
    params: '{ fromAgentId, toAgentId, note?, roomId?, surface? }',
    statusLabel: 'Sending nudge',
  },
  'autoAction.createRule': {
    kind: 'write',
    description: 'Create an automatic rule for future emails.',
    params: '{ name, tier, conditionType, conditionValue, actionType, actionValue? }',
    statusLabel: 'Creating auto-rule',
  },
  'autoAction.approve': {
    kind: 'write',
    description: 'Approve a learned auto-rule and promote it when appropriate.',
    params: '{ ruleId }',
    statusLabel: 'Approving auto-rule',
  },
  'shipment.list': {
    kind: 'read',
    description: 'List tracked shipments.',
    params: '{ active?: true, carrier?, status? }',
    statusLabel: 'Listing shipments',
  },
  'shipment.get': {
    kind: 'read',
    description: 'Get detailed status for a specific tracking number.',
    params: '{ trackingNumber }',
    statusLabel: 'Checking shipment',
  },
  'shipment.updateStatus': {
    kind: 'write',
    description: 'Manually update a shipment status.',
    params: '{ trackingNumber, status: "label-created"|"in-transit"|"out-for-delivery"|"delivered"|"exception", location?, description? }',
    statusLabel: 'Updating shipment',
  },
  'shipment.markDelivered': {
    kind: 'write',
    description: 'Mark a shipment as delivered.',
    params: '{ trackingNumber }',
    statusLabel: 'Marking delivered',
  },
  'shipment.track': {
    kind: 'read',
    description: 'Get carrier tracking URL and latest info for a package.',
    params: '{ trackingNumber }',
    statusLabel: 'Getting tracking info',
  },
  'db.searchEscalations': {
    kind: 'read',
    description: SHARED_AGENT_TOOL_METADATA['db.searchEscalations'].description,
    params: SHARED_AGENT_TOOL_METADATA['db.searchEscalations'].params,
    statusLabel: 'Searching escalations',
  },
  'db.getEscalation': {
    kind: 'read',
    description: SHARED_AGENT_TOOL_METADATA['db.getEscalation'].description,
    params: SHARED_AGENT_TOOL_METADATA['db.getEscalation'].params,
    statusLabel: 'Opening escalation',
  },
  'db.searchInvestigations': {
    kind: 'read',
    description: SHARED_AGENT_TOOL_METADATA['db.searchInvestigations'].description,
    params: SHARED_AGENT_TOOL_METADATA['db.searchInvestigations'].params,
    statusLabel: 'Searching investigations',
  },
  'db.getInvestigation': {
    kind: 'read',
    description: SHARED_AGENT_TOOL_METADATA['db.getInvestigation'].description,
    params: SHARED_AGENT_TOOL_METADATA['db.getInvestigation'].params,
    statusLabel: 'Opening investigation',
  },
  'db.searchTemplates': {
    kind: 'read',
    description: SHARED_AGENT_TOOL_METADATA['db.searchTemplates'].description,
    params: SHARED_AGENT_TOOL_METADATA['db.searchTemplates'].params,
    statusLabel: 'Searching templates',
  },
  'db.searchConversations': {
    kind: 'read',
    description: SHARED_AGENT_TOOL_METADATA['db.searchConversations'].description,
    params: SHARED_AGENT_TOOL_METADATA['db.searchConversations'].params,
    statusLabel: 'Searching conversations',
  },
  'db.getConversation': {
    kind: 'read',
    description: SHARED_AGENT_TOOL_METADATA['db.getConversation'].description,
    params: SHARED_AGENT_TOOL_METADATA['db.getConversation'].params,
    statusLabel: 'Opening conversation',
  },
  'db.searchRooms': {
    kind: 'read',
    description: SHARED_AGENT_TOOL_METADATA['db.searchRooms'].description,
    params: SHARED_AGENT_TOOL_METADATA['db.searchRooms'].params,
    statusLabel: 'Searching rooms',
  },
  'db.getRoom': {
    kind: 'read',
    description: SHARED_AGENT_TOOL_METADATA['db.getRoom'].description,
    params: SHARED_AGENT_TOOL_METADATA['db.getRoom'].params,
    statusLabel: 'Opening room',
  },
  'web.search': {
    kind: 'read',
    description: SHARED_AGENT_TOOL_METADATA['web.search'].description,
    params: SHARED_AGENT_TOOL_METADATA['web.search'].params,
    statusLabel: 'Searching the web',
  },
};

function buildWorkspaceAvailableToolLines() {
  const lines = [
    'AVAILABLE TOOLS:',
    '',
    'MULTI-ACCOUNT NOTE: Multiple Gmail accounts may be connected. All gmail.* tools accept an optional `account` parameter — the email address of the account to operate on (e.g., account: "work@example.com"). If omitted, the primary (most recently active) account is used. Always specify `account` when operating on a non-primary account. The connected accounts are listed at the top of the auto-context.',
    'LABEL/FOLDER RULE: If the user asks for a Gmail label or folder and it does not exist, create it. You can call gmail.createLabel directly, or use label names in gmail.label and gmail.batchModify — the system will resolve them and create missing user labels automatically.',
    'EXECUTION RULE: For requests that span multiple accounts, folders, labels, inbox/trash/archive scopes, or calendar ranges, keep a checklist and do not summarize until each requested scope has been touched or you report the exact blocker.',
    '',
  ];

  for (const [tool, meta] of Object.entries(WORKSPACE_TOOL_METADATA)) {
    lines.push(`- ${tool}: ${meta.description} Params: ${meta.params}`);
  }

  return lines;
}

const WORKSPACE_AVAILABLE_TOOL_LINES = buildWorkspaceAvailableToolLines();
const WORKSPACE_TOOL_STATUS_LABELS = Object.fromEntries(
  Object.entries(WORKSPACE_TOOL_METADATA).map(([tool, meta]) => [tool, meta.statusLabel || tool])
);
const READ_WORKSPACE_TOOLS = new Set(
  Object.entries(WORKSPACE_TOOL_METADATA)
    .filter(([, meta]) => meta.kind === 'read')
    .map(([tool]) => tool)
);

module.exports = {
  READ_WORKSPACE_TOOLS,
  WORKSPACE_AVAILABLE_TOOL_LINES,
  WORKSPACE_TOOL_METADATA,
  WORKSPACE_TOOL_STATUS_LABELS,
};
