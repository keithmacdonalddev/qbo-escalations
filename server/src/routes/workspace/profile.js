'use strict';

const express = require('express');
const GmailAuth = require('../../models/GmailAuth');
const WorkspaceActionRecord = require('../../models/WorkspaceActionRecord');
const WorkspaceAutoRule = require('../../models/WorkspaceAutoRule');
const WorkspaceConversation = require('../../models/WorkspaceConversation');
const WorkspaceMemory = require('../../models/WorkspaceMemory');
const { getAgentIdentity, recordAgentHarnessRun } = require('../../services/agent-identity-service');
const {
  claimWorkspaceApproval,
  completeWorkspaceApproval,
  createWorkspaceApproval,
  evaluateWorkspaceAction,
  getWorkspaceAuthority,
  hashWorkspaceAction,
  recordWorkspaceAction,
  updateWorkspacePolicy,
} = require('../../services/workspace-action-policy');
const { executeWorkspaceActions } = require('../../services/workspace-request-helpers');
const { createWorkspaceExecutionState } = require('../../services/workspace-tools/execution-state');
const workspaceMonitor = require('../../services/workspace-monitor');
const workspaceScheduler = require('../../services/workspace-scheduler');

const router = express.Router();

async function safeCount(Model, query = {}) {
  try {
    return await Model.countDocuments(query);
  } catch {
    return null;
  }
}

async function getConnectedAccounts() {
  try {
    const accounts = await GmailAuth.getAll();
    return (accounts || []).map((account) => ({
      email: account.email,
      primary: Boolean(account.isPrimary),
      connected: true,
    }));
  } catch {
    return [];
  }
}

function buildPermissionGroups(policy) {
  return {
    automatic: [
      'Inspect connected inboxes and calendars',
      policy.emailOrganization ? 'Label, archive, star, and mark email read or unread' : 'Email organization is turned off',
      policy.draftReplies ? 'Create email drafts without sending them' : 'Automatic draft creation is turned off',
      policy.personalCalendarHolds ? 'Create private calendar holds without guests' : 'Private calendar holds require confirmation',
      'Save useful operational memory',
    ],
    confirmation: [
      'Send an email',
      'Move email to trash',
      'Create or delete a permanent Gmail filter',
      'Invite people to a calendar event',
      'Change or delete an existing calendar event',
      `Modify more than ${policy.maxAutomaticBatchSize} emails at once`,
      'Delete memory or create a lasting automatic rule',
    ],
    blocked: [
      'All live and background work while the Workspace Agent is disabled',
      'Email or calendar access when its monitoring switch is off',
      'Accounts outside the optional allowed-account list',
    ],
  };
}

router.get('/profile', async (_req, res) => {
  const [authority, identity, accounts, memoryCount, ruleCount, conversationCount, actionCount, recentActions] = await Promise.all([
    getWorkspaceAuthority(),
    getAgentIdentity('workspace'),
    getConnectedAccounts(),
    safeCount(WorkspaceMemory),
    safeCount(WorkspaceAutoRule, { active: true }),
    safeCount(WorkspaceConversation),
    safeCount(WorkspaceActionRecord),
    WorkspaceActionRecord.find({}).sort({ createdAt: -1 }).limit(30).lean().catch(() => []),
  ]);
  const monitor = workspaceMonitor.getStatus();
  const scheduler = workspaceScheduler.getStatus();
  const checks = [
    { id: 'enabled', label: 'Agent enabled', ok: authority.enabled, detail: authority.enabled ? 'Live requests are allowed.' : 'Live and background work is blocked.' },
    { id: 'accounts', label: 'Google account connected', ok: accounts.length > 0, detail: accounts.length > 0 ? `${accounts.length} connected account${accounts.length === 1 ? '' : 's'}.` : 'Connect Gmail/Google Calendar before the agent can inspect them.' },
    { id: 'monitor', label: 'Background monitor running', ok: monitor.running, detail: monitor.running ? 'Email and calendar checks are scheduled.' : 'The background monitor is not running in this server process.' },
    { id: 'scheduler', label: 'Daily briefing scheduler running', ok: scheduler.running, detail: scheduler.running ? `Daily check is configured for ${String(scheduler.briefingHour).padStart(2, '0')}:${String(scheduler.briefingMinute).padStart(2, '0')}.` : 'The briefing scheduler is not running in this server process.' },
    { id: 'runtime', label: 'Model runtime configured', ok: Boolean(identity?.runtime?.configured || identity?.runtime?.provider), detail: identity?.runtime?.provider ? `${identity.runtime.provider}${identity.runtime.model ? ` / ${identity.runtime.model}` : ''}` : 'The shared provider default will be used until this profile has an explicit runtime.' },
  ];

  res.json({
    ok: true,
    profile: {
      agentId: 'workspace',
      importance: 'primary-operations-agent',
      identity,
      enabled: authority.enabled,
      policy: authority.policy,
      runtime: authority.runtime,
      connections: { googleAccounts: accounts },
      background: { monitor, scheduler },
      counts: { memory: memoryCount, activeRules: ruleCount, conversations: conversationCount, actions: actionCount },
      permissions: buildPermissionGroups(authority.policy),
      recentActions,
      readiness: {
        ready: checks.every((check) => check.ok),
        checks,
      },
    },
  });
});

router.patch('/profile/policy', async (req, res) => {
  const authority = await updateWorkspacePolicy(req.body?.policy || req.body || {}, { actor: 'user' });
  res.json({
    ok: true,
    enabled: authority.enabled,
    policy: authority.policy,
    permissions: buildPermissionGroups(authority.policy),
  });
});

router.post('/action-approvals', async (req, res) => {
  const action = {
    tool: String(req.body?.tool || ''),
    params: req.body?.params && typeof req.body.params === 'object' ? req.body.params : {},
  };
  if (!action.tool) {
    return res.status(400).json({ ok: false, code: 'MISSING_TOOL', error: 'tool is required' });
  }
  const authority = await getWorkspaceAuthority();
  const decision = evaluateWorkspaceAction(action, authority);
  if (decision.decision === 'blocked') {
    await recordWorkspaceAction({
      tool: action.tool,
      params: action.params,
      policyDecision: 'blocked',
      status: 'blocked',
      source: 'user-preview',
      surface: req.body?.surface || 'workspace-panel',
      error: decision.reason,
    });
    return res.status(403).json({ ok: false, code: 'ACTION_BLOCKED', error: decision.reason });
  }
  if (decision.decision !== 'confirmation-required') {
    return res.status(400).json({
      ok: false,
      code: 'CONFIRMATION_NOT_REQUIRED',
      error: 'This action is already covered by the saved automatic-action policy and does not need a confirmation token.',
    });
  }
  const approval = await createWorkspaceApproval(action, {
    source: 'user-preview',
    surface: req.body?.surface || 'workspace-panel',
    sessionId: req.body?.sessionId || '',
  });
  await recordWorkspaceAction({
    tool: action.tool,
    params: action.params,
    approvalId: approval.id,
    policyDecision: 'confirmation-required',
    status: 'pending',
    source: 'user-preview',
    surface: req.body?.surface || 'workspace-panel',
    resultSummary: approval.preview,
  });
  return res.status(201).json({ ok: true, approval });
});

router.post('/action-approvals/:id/execute', async (req, res) => {
  const approval = await claimWorkspaceApproval(req.params.id);
  if (!approval) {
    return res.status(409).json({
      ok: false,
      code: 'APPROVAL_UNAVAILABLE',
      error: 'This confirmation expired, was already used, or is no longer pending. Ask the Workspace Agent to prepare it again.',
    });
  }

  const authority = await getWorkspaceAuthority();
  if (!authority.enabled) {
    await completeWorkspaceApproval(approval.approvalId, { ok: false, error: 'Workspace Agent is disabled.' });
    return res.status(409).json({ ok: false, code: 'WORKSPACE_AGENT_DISABLED', error: 'The Workspace Agent was disabled before this action was confirmed.' });
  }

  const action = { tool: approval.tool, params: approval.params || {} };
  const executionState = createWorkspaceExecutionState({ connectedGmailAccounts: [] });
  const results = await executeWorkspaceActions([action], executionState, {
    authority,
    approvedHash: approval.paramsHash,
    approvalId: approval.approvalId,
    source: 'user-confirmation',
    surface: approval.surface || 'workspace-panel',
    sessionId: approval.sessionId || '',
  });
  const result = results[0] || { tool: approval.tool, error: 'Action returned no result.' };
  const ok = !result.error && !result.confirmationRequired;
  await completeWorkspaceApproval(approval.approvalId, {
    ok,
    summary: ok ? `${approval.tool} completed.` : '',
    error: result.error || '',
  });
  return res.status(ok ? 200 : 502).json({ ok, action: result, approvalId: approval.approvalId });
});

function makeHarnessCase(caseId, name, expected, actual, pass) {
  return { caseId, name, expected, actual, status: pass ? 'pass' : 'fail' };
}

router.post('/harness/run', async (_req, res) => {
  const policy = {
    proactiveEnabled: true,
    emailMonitoring: true,
    calendarMonitoring: true,
    emailOrganization: true,
    draftReplies: true,
    personalCalendarHolds: true,
    maxAutomaticBatchSize: 25,
    allowedAccounts: ['primary@example.com'],
  };
  const enabledAuthority = { enabled: true, policy };
  const cases = [];
  const check = (id, name, action, authority, expectedDecision, options = {}) => {
    const result = evaluateWorkspaceAction(action, authority, options);
    cases.push(makeHarnessCase(id, name, expectedDecision, `${result.decision}: ${result.reason}`, result.decision === expectedDecision));
  };

  check('disabled-blocks', 'Disabled agent blocks live work', { tool: 'gmail.search', params: { q: 'is:unread' } }, { enabled: false, policy }, 'blocked');
  check('email-read', 'Inbox inspection is automatic', { tool: 'gmail.search', params: { q: 'is:unread', account: 'primary@example.com' } }, enabledAuthority, 'allowed');
  check('email-organize', 'Reversible email organization is automatic', { tool: 'gmail.archive', params: { messageId: 'm1', account: 'primary@example.com' } }, enabledAuthority, 'allowed');
  check('draft-reply', 'Draft creation is automatic', { tool: 'gmail.draft', params: { to: 'person@example.com', subject: 'Draft', body: 'Text' } }, enabledAuthority, 'allowed');
  check('send-confirm', 'Sending email requires confirmation', { tool: 'gmail.send', params: { to: 'person@example.com', subject: 'Hello', body: 'Text' } }, enabledAuthority, 'confirmation-required');
  check('private-hold', 'Private calendar holds are automatic', { tool: 'calendar.createEvent', params: { summary: 'Focus time', start: '2030-01-01T10:00:00Z', end: '2030-01-01T11:00:00Z' } }, enabledAuthority, 'allowed');
  check('guest-confirm', 'Calendar invitations require confirmation', { tool: 'calendar.createEvent', params: { summary: 'Meeting', attendees: [{ email: 'guest@example.com' }] } }, enabledAuthority, 'confirmation-required');
  check('delete-confirm', 'Calendar deletion requires confirmation', { tool: 'calendar.deleteEvent', params: { eventId: 'event-1' } }, enabledAuthority, 'confirmation-required');
  check('bulk-confirm', 'Large email batches require confirmation', { tool: 'gmail.batchModify', params: { messageIds: Array.from({ length: 26 }, (_, index) => `m${index}`), removeLabelIds: ['INBOX'] } }, enabledAuthority, 'confirmation-required');
  check('account-block', 'Account allowlist is enforced', { tool: 'gmail.search', params: { q: 'in:inbox', account: 'other@example.com' } }, enabledAuthority, 'blocked');
  const approvedAction = { tool: 'gmail.send', params: { to: 'person@example.com', subject: 'Approved', body: 'Exact body' } };
  check('exact-approval', 'Exact confirmation unlocks only its bound action', approvedAction, enabledAuthority, 'allowed', { approvedHash: hashWorkspaceAction(approvedAction.tool, approvedAction.params) });

  const failed = cases.filter((item) => item.status === 'fail').length;
  const run = {
    runId: `workspace-policy-${Date.now()}`,
    status: failed === 0 ? 'pass' : 'fail',
    summary: failed === 0
      ? `Workspace Agent policy harness passed all ${cases.length} deterministic cases.`
      : `Workspace Agent policy harness failed ${failed} of ${cases.length} cases.`,
    source: 'workspace-policy-harness',
    cases,
    completedAt: new Date(),
    metadata: { deterministic: true, externalActionsExecuted: false },
  };
  const identity = await recordAgentHarnessRun('workspace', run, { actor: 'user' });
  return res.status(failed === 0 ? 200 : 422).json({ ok: failed === 0, run, persisted: Boolean(identity) });
});

module.exports = router;
