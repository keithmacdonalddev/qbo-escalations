'use strict';

const crypto = require('crypto');
const { randomUUID } = require('crypto');
const AgentIdentity = require('../models/AgentIdentity');
const WorkspaceActionApproval = require('../models/WorkspaceActionApproval');
const WorkspaceActionRecord = require('../models/WorkspaceActionRecord');
const { READ_WORKSPACE_TOOLS, WORKSPACE_TOOL_METADATA } = require('./workspace-tools/metadata');

const APPROVAL_TTL_MS = 10 * 60 * 1000;
const DEFAULT_WORKSPACE_POLICY = Object.freeze({
  proactiveEnabled: true,
  emailMonitoring: true,
  calendarMonitoring: true,
  emailOrganization: true,
  draftReplies: true,
  personalCalendarHolds: true,
  maxAutomaticBatchSize: 25,
  allowedAccounts: [],
});

const EMAIL_ORGANIZATION_TOOLS = new Set([
  'gmail.archive',
  'gmail.star',
  'gmail.unstar',
  'gmail.markRead',
  'gmail.markUnread',
  'gmail.label',
  'gmail.removeLabel',
  'gmail.createLabel',
]);

const ALWAYS_CONFIRM_TOOLS = new Set([
  'gmail.send',
  'gmail.trash',
  'gmail.createFilter',
  'gmail.deleteFilter',
  'calendar.updateEvent',
  'calendar.deleteEvent',
  'memory.delete',
  'autoAction.createRule',
  'autoAction.approve',
  'agentProfiles.updateAvatar',
  'agentProfiles.generateAvatar',
  'agentProfiles.nudge',
  'shipment.updateStatus',
  'shipment.markDelivered',
]);

function clampBatchSize(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_WORKSPACE_POLICY.maxAutomaticBatchSize;
  return Math.min(100, Math.max(1, parsed));
}

function normalizeAccounts(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean))].slice(0, 20);
}

function mergeWorkspacePolicy(value = {}) {
  return {
    ...DEFAULT_WORKSPACE_POLICY,
    proactiveEnabled: value.proactiveEnabled !== false,
    emailMonitoring: value.emailMonitoring !== false,
    calendarMonitoring: value.calendarMonitoring !== false,
    emailOrganization: value.emailOrganization !== false,
    draftReplies: value.draftReplies !== false,
    personalCalendarHolds: value.personalCalendarHolds !== false,
    maxAutomaticBatchSize: clampBatchSize(value.maxAutomaticBatchSize),
    allowedAccounts: normalizeAccounts(value.allowedAccounts),
    updatedBy: String(value.updatedBy || ''),
    updatedAt: value.updatedAt || null,
  };
}

async function getWorkspaceAuthority() {
  const doc = await AgentIdentity.findOne({ agentId: 'workspace' })
    .select('enabled workspacePolicy runtime updatedAt')
    .lean();
  return {
    enabled: doc?.enabled !== false,
    policy: mergeWorkspacePolicy(doc?.workspacePolicy || {}),
    runtime: doc?.runtime || {},
    updatedAt: doc?.updatedAt || null,
  };
}

async function updateWorkspacePolicy(patch = {}, { actor = 'user' } = {}) {
  const current = await getWorkspaceAuthority();
  const allowedKeys = [
    'proactiveEnabled',
    'emailMonitoring',
    'calendarMonitoring',
    'emailOrganization',
    'draftReplies',
    'personalCalendarHolds',
    'maxAutomaticBatchSize',
    'allowedAccounts',
  ];
  const nextInput = { ...current.policy };
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) nextInput[key] = patch[key];
  }
  const next = mergeWorkspacePolicy({ ...nextInput, updatedBy: actor, updatedAt: new Date() });
  const now = new Date();
  await AgentIdentity.findOneAndUpdate(
    { agentId: 'workspace' },
    {
      $set: {
        workspacePolicy: { ...next, updatedAt: now },
      },
      $push: {
        'history.entries': {
          $each: [{
            type: 'workspace-policy',
            summary: 'Updated Workspace Agent proactive work and action permissions.',
            actor,
            metadata: { changedFields: allowedKeys.filter((key) => Object.prototype.hasOwnProperty.call(patch, key)) },
            createdAt: now,
          }],
          $position: 0,
          $slice: 120,
        },
        'activity.entries': {
          $each: [{
            type: 'workspace-policy',
            phase: 'permissions',
            surface: 'agent-profiles',
            summary: 'Workspace Agent permissions updated.',
            detail: 'Proactive email and calendar settings now use the saved server policy.',
            status: 'updated',
            createdAt: now,
          }],
          $position: 0,
          $slice: 240,
        },
      },
      $setOnInsert: { enabled: true },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  return getWorkspaceAuthority();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableValue(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function hashWorkspaceAction(tool, params) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ tool, params: stableValue(params || {}) }))
    .digest('hex');
}

function targetForAction(tool, params = {}) {
  if (tool === 'gmail.send' || tool === 'gmail.draft') {
    const recipients = Array.isArray(params.to) ? params.to.join(', ') : String(params.to || 'recipient');
    return `${recipients}${params.subject ? ` — ${params.subject}` : ''}`;
  }
  if (tool.startsWith('gmail.')) return String(params.messageId || params.filterId || params.name || `${(params.messageIds || []).length || 0} messages`);
  if (tool.startsWith('calendar.')) return String(params.summary || params.eventId || params.calendarId || 'primary calendar');
  if (tool.startsWith('memory.')) return String(params.key || params.type || 'workspace memory');
  return String(params.name || params.ruleId || params.trackingNumber || params.agentId || tool);
}

function previewWorkspaceAction(tool, params = {}) {
  const target = targetForAction(tool, params);
  const labels = {
    'gmail.send': 'Send email',
    'gmail.trash': 'Move email to trash',
    'gmail.createFilter': 'Create permanent Gmail filter',
    'gmail.deleteFilter': 'Delete Gmail filter',
    'calendar.createEvent': 'Create event with guests',
    'calendar.updateEvent': 'Change calendar event',
    'calendar.deleteEvent': 'Delete calendar event',
    'memory.delete': 'Delete saved memory',
    'autoAction.createRule': 'Create automatic email rule',
    'autoAction.approve': 'Approve automatic email rule',
  };
  return `${labels[tool] || `Run ${tool}`}: ${target}`.slice(0, 280);
}

function safeParamsSummary(tool, params = {}) {
  const summary = {
    account: String(params.account || ''),
    target: targetForAction(tool, params),
  };
  if (Array.isArray(params.messageIds)) summary.itemCount = params.messageIds.length;
  if (Array.isArray(params.attendees)) summary.attendeeCount = params.attendees.length;
  if (params.start) summary.start = typeof params.start === 'string' ? params.start : (params.start.dateTime || params.start.date || '');
  if (params.end) summary.end = typeof params.end === 'string' ? params.end : (params.end.dateTime || params.end.date || '');
  return summary;
}

function evaluateWorkspaceAction(action, authority, { approvedHash = '' } = {}) {
  const tool = String(action?.tool || '');
  const params = action?.params && typeof action.params === 'object' ? action.params : {};
  const policy = mergeWorkspacePolicy(authority?.policy || {});
  const actionHash = hashWorkspaceAction(tool, params);
  if (!WORKSPACE_TOOL_METADATA[tool]) {
    return { decision: 'blocked', reason: `Unknown Workspace tool: ${tool || '(missing)'}.`, actionHash };
  }
  if (authority?.enabled === false) {
    return { decision: 'blocked', reason: 'The Workspace Agent is disabled.', actionHash };
  }
  const account = String(params.account || '').trim().toLowerCase();
  if (account && policy.allowedAccounts.length > 0 && !policy.allowedAccounts.includes(account)) {
    return { decision: 'blocked', reason: `Account ${account} is outside the Workspace Agent allowlist.`, actionHash };
  }
  if (tool.startsWith('gmail.') && !policy.emailMonitoring) {
    return { decision: 'blocked', reason: 'Email access is turned off.', actionHash };
  }
  if (tool.startsWith('calendar.') && !policy.calendarMonitoring) {
    return { decision: 'blocked', reason: 'Calendar access is turned off.', actionHash };
  }
  if (approvedHash && approvedHash === actionHash) {
    return { decision: 'allowed', reason: 'Exact user confirmation matched this action.', actionHash };
  }
  if (READ_WORKSPACE_TOOLS.has(tool)) {
    return { decision: 'allowed', reason: 'Read-only inspection is allowed.', actionHash };
  }
  if (EMAIL_ORGANIZATION_TOOLS.has(tool)) {
    return policy.emailOrganization
      ? { decision: 'allowed', reason: 'Reversible email organization is pre-approved.', actionHash }
      : { decision: 'blocked', reason: 'Automatic email organization is turned off.', actionHash };
  }
  if (tool === 'gmail.draft') {
    return policy.draftReplies
      ? { decision: 'allowed', reason: 'Creating a draft is pre-approved; sending it is not.', actionHash }
      : { decision: 'blocked', reason: 'Automatic draft creation is turned off.', actionHash };
  }
  if (tool === 'gmail.batchModify') {
    const count = Array.isArray(params.messageIds) ? params.messageIds.length : 0;
    const riskyLabels = [...(params.addLabelIds || []), ...(params.addLabels || [])]
      .some((label) => ['TRASH', 'SPAM'].includes(String(label || '').toUpperCase()));
    if (count > policy.maxAutomaticBatchSize || riskyLabels) {
      return { decision: 'confirmation-required', reason: count > policy.maxAutomaticBatchSize ? `Batch exceeds the automatic limit of ${policy.maxAutomaticBatchSize}.` : 'Batch includes a destructive Gmail label.', actionHash };
    }
    return policy.emailOrganization
      ? { decision: 'allowed', reason: 'Small reversible email organization batch is pre-approved.', actionHash }
      : { decision: 'blocked', reason: 'Automatic email organization is turned off.', actionHash };
  }
  if (tool === 'calendar.createEvent') {
    const attendeeCount = Array.isArray(params.attendees) ? params.attendees.length : 0;
    if (attendeeCount > 0) return { decision: 'confirmation-required', reason: 'Events that notify or invite other people require confirmation.', actionHash };
    return policy.personalCalendarHolds
      ? { decision: 'allowed', reason: 'Private personal holds are pre-approved.', actionHash }
      : { decision: 'confirmation-required', reason: 'Automatic personal calendar holds are turned off.', actionHash };
  }
  if (tool === 'memory.save') return { decision: 'allowed', reason: 'Saving operational continuity is pre-approved.', actionHash };
  if (ALWAYS_CONFIRM_TOOLS.has(tool)) return { decision: 'confirmation-required', reason: 'This action can affect other people, delete data, or create a lasting rule.', actionHash };
  return { decision: 'confirmation-required', reason: 'This write action is not on the automatic-action allowlist.', actionHash };
}

async function createWorkspaceApproval(action, context = {}) {
  const params = action?.params && typeof action.params === 'object' ? action.params : {};
  const approvalId = randomUUID();
  const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS);
  const doc = await WorkspaceActionApproval.create({
    approvalId,
    tool: action.tool,
    params,
    paramsHash: hashWorkspaceAction(action.tool, params),
    preview: previewWorkspaceAction(action.tool, params),
    account: String(params.account || ''),
    source: context.source || 'workspace-agent',
    surface: context.surface || 'workspace-panel',
    sessionId: context.sessionId || '',
    expiresAt,
  });
  return {
    id: doc.approvalId,
    preview: doc.preview,
    expiresAt: doc.expiresAt,
  };
}

async function claimWorkspaceApproval(approvalId) {
  const now = new Date();
  return WorkspaceActionApproval.findOneAndUpdate(
    { approvalId, status: 'pending', expiresAt: { $gt: now } },
    { $set: { status: 'executing', claimedAt: now } },
    { returnDocument: 'after' }
  ).lean();
}

async function completeWorkspaceApproval(approvalId, { ok, summary = '', error = '' } = {}) {
  return WorkspaceActionApproval.findOneAndUpdate(
    { approvalId, status: 'executing' },
    {
      $set: {
        status: ok ? 'completed' : 'failed',
        resultSummary: String(summary || '').slice(0, 500),
        error: String(error || '').slice(0, 500),
        completedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  ).lean();
}

async function recordWorkspaceAction(data = {}) {
  try {
    return await WorkspaceActionRecord.create({
      agentId: 'workspace',
      tool: data.tool,
      policyDecision: data.policyDecision,
      status: data.status,
      source: data.source || 'workspace-agent',
      surface: data.surface || 'workspace-panel',
      sessionId: data.sessionId || '',
      approvalId: data.approvalId || '',
      account: String(data.params?.account || ''),
      target: targetForAction(data.tool, data.params),
      paramsSummary: safeParamsSummary(data.tool, data.params),
      resultSummary: String(data.resultSummary || '').slice(0, 1000),
      error: String(data.error || '').slice(0, 1000),
      verified: typeof data.verified === 'boolean' ? data.verified : null,
      warnings: Array.isArray(data.warnings) ? data.warnings.slice(0, 10).map(String) : [],
      durationMs: Number(data.durationMs) || 0,
    });
  } catch (err) {
    console.error('[workspace-policy] Failed to persist action evidence:', err.message);
    return null;
  }
}

module.exports = {
  ALWAYS_CONFIRM_TOOLS,
  DEFAULT_WORKSPACE_POLICY,
  claimWorkspaceApproval,
  completeWorkspaceApproval,
  createWorkspaceApproval,
  evaluateWorkspaceAction,
  getWorkspaceAuthority,
  hashWorkspaceAction,
  mergeWorkspacePolicy,
  previewWorkspaceAction,
  recordWorkspaceAction,
  safeParamsSummary,
  updateWorkspacePolicy,
};
