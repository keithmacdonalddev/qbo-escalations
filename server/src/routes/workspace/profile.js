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
const {
  executeWorkspaceActions,
  validateWorkspaceActionShape,
} = require('../../services/workspace-request-helpers');
const {
  createWorkspaceExecutionState,
  createWorkspaceExecutionStateFromStore,
  normalizeWorkspaceActionAccount,
} = require('../../services/workspace-tools/execution-state');
const workspaceMonitor = require('../../services/workspace-monitor');
const workspaceScheduler = require('../../services/workspace-scheduler');
const knowledgeReviewScheduler = require('../../services/knowledgebase-agent-scheduler');
const aiManagementScheduler = require('../../services/ai-management-scheduler');
const { getAgentHealthMonitorStatus } = require('../../services/agent-health-service');
const { buildPermissionStatus } = require('../../services/gmail');
const { SHARED_AGENT_TOOL_METADATA } = require('../../services/shared-agent-tools');

const router = express.Router();
function getApprovalActionTimeoutMs() {
  const parsed = Number.parseInt(process.env.WORKSPACE_APPROVAL_ACTION_TIMEOUT_MS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 120000) : 30000;
}

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
    return (accounts || []).map((account) => {
      const permissionStatus = buildPermissionStatus(account.scope);
      return {
        email: account.email,
        primary: Boolean(account.isPrimary),
        connected: true,
        lastGmailAccessAt: account.lastGmailAccessAt || null,
        lastCalendarAccessAt: account.lastCalendarAccessAt || null,
        missingPermissions: permissionStatus.missingPermissions,
      };
    });
  } catch {
    return [];
  }
}

function buildPermissionGroups(policy) {
  return {
    automatic: [
      'Inspect connected inboxes and calendars when requested',
      policy.emailOrganization ? 'Label, archive, star, and change read state after an authorized agent request' : 'Email organization is turned off',
      policy.draftReplies ? 'Create email drafts after an authorized request, without sending them' : 'Draft creation is turned off',
      policy.personalCalendarHolds ? 'Create private calendar holds after an authorized request, without guests' : 'Private calendar holds require confirmation',
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
      'Background Gmail changes; monitoring currently produces suggestions only',
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
  const knowledgeReview = knowledgeReviewScheduler.getStatus();
  const aiManagement = aiManagementScheduler.getStatus();
  const agentHealth = getAgentHealthMonitorStatus();
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
      background: { monitor, scheduler, knowledgeReview, aiManagement, agentHealth },
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
  const requestedAction = {
    tool: String(req.body?.tool || ''),
    params: req.body?.params && typeof req.body.params === 'object' ? req.body.params : {},
  };
  if (!requestedAction.tool) {
    return res.status(400).json({ ok: false, code: 'MISSING_TOOL', error: 'tool is required' });
  }
  const validationError = validateWorkspaceActionShape(requestedAction);
  if (validationError) {
    return res.status(400).json({ ok: false, code: 'INVALID_ACTION', error: validationError });
  }
  const authority = await getWorkspaceAuthority();
  const executionState = await createWorkspaceExecutionStateFromStore();
  const action = normalizeWorkspaceActionAccount(requestedAction, executionState);
  const decisionAuthority = SHARED_AGENT_TOOL_METADATA[action.tool]
    ? { ...authority, enabled: true }
    : authority;
  const decision = evaluateWorkspaceAction(action, decisionAuthority, {
    connectedAccounts: executionState.connectedGmailAccounts,
    requireAccountProof: true,
  });
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
  if (approval.reconciledOutcomeUnknown) {
    return res.status(409).json({
      ok: false,
      code: 'ACTION_OUTCOME_UNKNOWN',
      error: approval.approval.error,
      approvalId: approval.approval.approvalId,
      evidenceIncomplete: true,
      mayHaveExecuted: true,
      retrySafe: false,
    });
  }

  let executionAttempted = false;
  try {
    const authority = await getWorkspaceAuthority();
    const sharedAgentWrite = SHARED_AGENT_TOOL_METADATA[approval.tool]?.kind === 'write';
    if (!authority.enabled && !sharedAgentWrite) {
      await completeWorkspaceApproval(approval.approvalId, { ok: false, error: 'Workspace Agent is disabled.' });
      return res.status(409).json({ ok: false, code: 'WORKSPACE_AGENT_DISABLED', error: 'The Workspace Agent was disabled before this action was confirmed.' });
    }

    const action = { tool: approval.tool, params: approval.params || {} };
    const validationError = validateWorkspaceActionShape(action);
    if (validationError) {
      await completeWorkspaceApproval(approval.approvalId, { ok: false, error: validationError });
      await recordWorkspaceAction({
        tool: action.tool,
        params: {},
        approvalId: approval.approvalId,
        policyDecision: 'blocked',
        status: 'blocked',
        source: 'user-confirmation',
        surface: approval.surface || 'workspace-panel',
        sessionId: approval.sessionId || '',
        error: validationError,
      });
      return res.status(422).json({
        ok: false,
        code: 'INVALID_STORED_ACTION',
        error: validationError,
        approvalId: approval.approvalId,
      });
    }
    const executionState = await createWorkspaceExecutionStateFromStore();
    const preDispatchEvidence = await recordWorkspaceAction({
      tool: action.tool,
      params: action.params,
      approvalId: approval.approvalId,
      policyDecision: 'allowed',
      status: 'pending',
      source: 'user-confirmation',
      surface: approval.surface || 'workspace-panel',
      sessionId: approval.sessionId || '',
      resultSummary: 'Confirmation claimed; durable pre-dispatch evidence saved before external execution.',
    });
    if (!preDispatchEvidence) {
      const error = 'The action did not start because required pre-dispatch evidence could not be saved.';
      await completeWorkspaceApproval(approval.approvalId, { ok: false, error });
      return res.status(503).json({
        ok: false,
        code: 'ACTION_EVIDENCE_REQUIRED',
        error,
        approvalId: approval.approvalId,
        evidenceIncomplete: true,
        mayHaveExecuted: false,
        retrySafe: false,
      });
    }
    executionAttempted = true;
    const approvalActionTimeoutMs = getApprovalActionTimeoutMs();
    const results = await executeWorkspaceActions([action], executionState, {
      authority: sharedAgentWrite ? { ...authority, enabled: true } : authority,
      approvedHash: approval.paramsHash,
      approvalId: approval.approvalId,
      source: 'user-confirmation',
      surface: approval.surface || 'workspace-panel',
      sessionId: approval.sessionId || '',
      deadlineAt: Date.now() + approvalActionTimeoutMs,
      perToolTimeoutMs: approvalActionTimeoutMs,
    });
    const result = results[0] || { tool: approval.tool, error: 'Action returned no result.' };
    const ok = !result.error && !result.confirmationRequired;
    await completeWorkspaceApproval(approval.approvalId, {
      ok,
      summary: ok ? `${approval.tool} completed.` : '',
      error: result.error || '',
    });
    return res.status(ok ? 200 : 502).json({
      ok,
      ...(result.outcomeUnknown ? {
        code: 'ACTION_OUTCOME_UNKNOWN',
        evidenceIncomplete: true,
        retrySafe: false,
      } : {}),
      action: result,
      approvalId: approval.approvalId,
    });
  } catch (err) {
    const error = executionAttempted
      ? 'The confirmed action outcome could not be verified. It was not retried because repeating it could create a duplicate or additional side effect.'
      : 'The confirmed action could not start. It was not retried.';
    await completeWorkspaceApproval(approval.approvalId, { ok: false, error }).catch(() => null);
    await recordWorkspaceAction({
      tool: approval.tool,
      params: approval.params || {},
      approvalId: approval.approvalId,
      policyDecision: 'allowed',
      status: executionAttempted ? 'outcome-unknown' : 'error',
      source: 'user-confirmation',
      surface: approval.surface || 'workspace-panel',
      sessionId: approval.sessionId || '',
      error: `${error} ${err?.message || ''}`.trim(),
      warnings: ['Durable approval completion or execution evidence was incomplete.'],
    });
    return res.status(502).json({
      ok: false,
      code: executionAttempted ? 'ACTION_OUTCOME_UNKNOWN' : 'APPROVAL_EXECUTION_FAILED',
      error,
      approvalId: approval.approvalId,
      evidenceIncomplete: true,
      mayHaveExecuted: executionAttempted,
      retrySafe: false,
    });
  }
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
  const harnessExecutionState = createWorkspaceExecutionState({
    connectedGmailAccounts: ['primary@example.com'],
    defaultGmailAccount: 'primary@example.com',
    defaultSendingAccount: 'primary@example.com',
    defaultCalendarAccount: 'primary@example.com',
  });
  const cases = [];
  const check = (id, name, action, authority, expectedDecision, options = {}) => {
    const normalizedAction = normalizeWorkspaceActionAccount(action, harnessExecutionState);
    const accountScoped = normalizedAction.tool.startsWith('gmail.') || normalizedAction.tool.startsWith('calendar.');
    const result = evaluateWorkspaceAction(normalizedAction, authority, {
      ...(accountScoped ? {
        connectedAccounts: harnessExecutionState.connectedGmailAccounts,
        requireAccountProof: true,
      } : {}),
      ...options,
    });
    cases.push(makeHarnessCase(id, name, expectedDecision, `${result.decision}: ${result.reason}`, result.decision === expectedDecision));
  };

  check('disabled-blocks', 'Disabled agent blocks live work', { tool: 'gmail.search', params: { q: 'is:unread' } }, { enabled: false, policy }, 'blocked');
  check('email-read', 'Inbox inspection is pre-approved when requested', { tool: 'gmail.search', params: { q: 'is:unread', account: 'primary@example.com' } }, enabledAuthority, 'allowed');
  check('email-organize', 'Reversible email organization is pre-approved when requested', { tool: 'gmail.archive', params: { messageId: 'm1', account: 'primary@example.com' } }, enabledAuthority, 'allowed');
  check('draft-reply', 'Draft creation is pre-approved when requested', { tool: 'gmail.draft', params: { to: 'person@example.com', subject: 'Draft', body: 'Text' } }, enabledAuthority, 'allowed');
  check('send-confirm', 'Sending email requires confirmation', { tool: 'gmail.send', params: { to: 'person@example.com', subject: 'Hello', body: 'Text' } }, enabledAuthority, 'confirmation-required');
  check('private-hold', 'Private calendar holds are pre-approved when requested', { tool: 'calendar.createEvent', params: { summary: 'Focus time', start: '2030-01-01T10:00:00Z', end: '2030-01-01T11:00:00Z' } }, enabledAuthority, 'allowed');
  check('guest-confirm', 'Calendar invitations require confirmation', { tool: 'calendar.createEvent', params: { summary: 'Meeting', attendees: [{ email: 'guest@example.com' }] } }, enabledAuthority, 'confirmation-required');
  check('delete-confirm', 'Calendar deletion requires confirmation', { tool: 'calendar.deleteEvent', params: { eventId: 'event-1' } }, enabledAuthority, 'confirmation-required');
  check('bulk-confirm', 'Large email batches require confirmation', { tool: 'gmail.batchModify', params: { messageIds: Array.from({ length: 26 }, (_, index) => `m${index}`), removeLabelIds: ['INBOX'] } }, enabledAuthority, 'confirmation-required');
  check('account-block', 'Account allowlist is enforced', { tool: 'gmail.search', params: { q: 'in:inbox', account: 'other@example.com' } }, enabledAuthority, 'blocked');
  const approvedAction = { tool: 'gmail.send', params: { to: 'person@example.com', subject: 'Approved', body: 'Exact body', account: 'primary@example.com' } };
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
