'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const AgentIdentity = require('../src/models/AgentIdentity');
const WorkspaceActionApproval = require('../src/models/WorkspaceActionApproval');
const WorkspaceActionRecord = require('../src/models/WorkspaceActionRecord');
const { WORKSPACE_TOOL_HANDLERS } = require('../src/services/workspace-tools/handler-registry');
const {
  claimWorkspaceApproval,
  createWorkspaceApproval,
  evaluateWorkspaceAction,
  hashWorkspaceAction,
} = require('../src/services/workspace-action-policy');

test.before(async () => {
  await connect();
});

test.after(async () => {
  await AgentIdentity.deleteMany({ agentId: 'workspace' });
  await WorkspaceActionApproval.deleteMany({});
  await WorkspaceActionRecord.deleteMany({});
  await disconnect();
});

test.beforeEach(async () => {
  await AgentIdentity.deleteMany({ agentId: 'workspace' });
  await WorkspaceActionApproval.deleteMany({});
  await WorkspaceActionRecord.deleteMany({});
});

function enabledAuthority(overrides = {}) {
  return {
    enabled: true,
    policy: {
      proactiveEnabled: true,
      emailMonitoring: true,
      calendarMonitoring: true,
      emailOrganization: true,
      draftReplies: true,
      personalCalendarHolds: true,
      maxAutomaticBatchSize: 25,
      allowedAccounts: [],
      ...overrides,
    },
  };
}

test('Workspace Agent policy is proactive for safe email and calendar work but confirms consequential actions', () => {
  const authority = enabledAuthority();
  assert.equal(evaluateWorkspaceAction({ tool: 'gmail.search', params: { q: 'is:unread' } }, authority).decision, 'allowed');
  assert.equal(evaluateWorkspaceAction({ tool: 'gmail.archive', params: { messageId: 'm1' } }, authority).decision, 'allowed');
  assert.equal(evaluateWorkspaceAction({ tool: 'gmail.draft', params: { to: 'person@example.com', body: 'Draft' } }, authority).decision, 'allowed');
  assert.equal(evaluateWorkspaceAction({ tool: 'gmail.send', params: { to: 'person@example.com', body: 'Send' } }, authority).decision, 'confirmation-required');
  assert.equal(evaluateWorkspaceAction({ tool: 'gmail.trash', params: { messageId: 'm1' } }, authority).decision, 'confirmation-required');
  assert.equal(evaluateWorkspaceAction({ tool: 'calendar.createEvent', params: { summary: 'Focus', start: '2030-01-01T10:00:00Z', end: '2030-01-01T11:00:00Z' } }, authority).decision, 'allowed');
  assert.equal(evaluateWorkspaceAction({ tool: 'calendar.createEvent', params: { summary: 'Meeting', attendees: [{ email: 'guest@example.com' }] } }, authority).decision, 'confirmation-required');
  assert.equal(evaluateWorkspaceAction({ tool: 'calendar.updateEvent', params: { eventId: 'event-1', summary: 'Changed' } }, authority).decision, 'confirmation-required');
  assert.equal(evaluateWorkspaceAction({ tool: 'calendar.deleteEvent', params: { eventId: 'event-1' } }, authority).decision, 'confirmation-required');
});

test('Workspace Agent policy enforces lifecycle, account, feature, and batch boundaries', () => {
  const read = { tool: 'gmail.search', params: { q: 'in:inbox' } };
  assert.equal(evaluateWorkspaceAction(read, { ...enabledAuthority(), enabled: false }).decision, 'blocked');
  assert.equal(evaluateWorkspaceAction(read, enabledAuthority({ emailMonitoring: false })).decision, 'blocked');
  assert.equal(evaluateWorkspaceAction(
    { tool: 'gmail.search', params: { q: 'in:inbox', account: 'other@example.com' } },
    enabledAuthority({ allowedAccounts: ['primary@example.com'] })
  ).decision, 'blocked');
  assert.equal(evaluateWorkspaceAction(
    { tool: 'gmail.batchModify', params: { messageIds: Array.from({ length: 26 }, (_, index) => `m${index}`), removeLabelIds: ['INBOX'] } },
    enabledAuthority()
  ).decision, 'confirmation-required');
});

test('Workspace action approval is exact, expiring, and single-use', async () => {
  const action = { tool: 'gmail.send', params: { to: 'person@example.com', subject: 'Exact', body: 'Bound body' } };
  const approval = await createWorkspaceApproval(action, { surface: 'test', sessionId: 'session-1' });
  const claimed = await claimWorkspaceApproval(approval.id);
  assert.ok(claimed);
  assert.equal(claimed.paramsHash, hashWorkspaceAction(action.tool, action.params));
  assert.equal(evaluateWorkspaceAction(action, enabledAuthority(), { approvedHash: claimed.paramsHash }).decision, 'allowed');
  assert.equal(evaluateWorkspaceAction({ ...action, params: { ...action.params, subject: 'Broadened' } }, enabledAuthority(), { approvedHash: claimed.paramsHash }).decision, 'confirmation-required');
  assert.equal(evaluateWorkspaceAction(action, enabledAuthority({ emailMonitoring: false }), { approvedHash: claimed.paramsHash }).decision, 'blocked');
  assert.equal(await claimWorkspaceApproval(approval.id), null);
});

test('gmail.send approval exposes every consequential message field for inspection', async () => {
  const action = {
    tool: 'gmail.send',
    params: {
      account: 'sender@example.com',
      to: ['to@example.com'],
      cc: ['cc@example.com'],
      bcc: ['bcc@example.com'],
      subject: 'Inspectable subject',
      body: 'Complete inspectable body content.',
      threadId: 'thread-1',
      inReplyTo: 'message-1',
      references: ['ref-1'],
    },
  };
  const approval = await createWorkspaceApproval(action, { surface: 'test' });
  assert.deepEqual(approval.inspection.to, ['to@example.com']);
  assert.deepEqual(approval.inspection.cc, ['cc@example.com']);
  assert.deepEqual(approval.inspection.bcc, ['bcc@example.com']);
  assert.equal(approval.inspection.account, 'sender@example.com');
  assert.equal(approval.inspection.subject, 'Inspectable subject');
  assert.equal(approval.inspection.body, 'Complete inspectable body content.');
  assert.equal(approval.inspection.threadId, 'thread-1');
  assert.equal(approval.inspection.inReplyTo, 'message-1');
  assert.deepEqual(approval.inspection.references, ['ref-1']);
  assert.equal(approval.inspection.attachmentCount, 0);
  assert.match(approval.inspection.note, /No attachments/i);
  const stored = await WorkspaceActionApproval.findOne({ approvalId: approval.id }).lean();
  assert.equal(stored.inspection.body, action.params.body);
});

test('resolved handler failure marks a confirmed approval failed instead of completed', async () => {
  const action = { tool: 'memory.delete', params: { key: 'resolved-failure-fixture' } };
  const approval = await createWorkspaceApproval(action, { surface: 'test', sessionId: 'resolved-failure' });
  const originalHandler = WORKSPACE_TOOL_HANDLERS['memory.delete'];
  WORKSPACE_TOOL_HANDLERS['memory.delete'] = async () => ({ ok: false, error: 'memory store rejected deletion' });
  try {
    const response = await request(createApp())
      .post(`/api/workspace/action-approvals/${approval.id}/execute`)
      .send({})
      .expect(502);
    assert.equal(response.body.ok, false);
    assert.match(response.body.action.error, /memory store rejected deletion/i);
  } finally {
    WORKSPACE_TOOL_HANDLERS['memory.delete'] = originalHandler;
  }
  const stored = await WorkspaceActionApproval.findOne({ approvalId: approval.id }).lean();
  assert.equal(stored.status, 'failed');
});

test('confirmed write deadline returns ACTION_OUTCOME_UNKNOWN through the real approval route', async () => {
  const action = { tool: 'memory.delete', params: { key: 'timeout-route-fixture' } };
  const approval = await createWorkspaceApproval(action, { surface: 'test', sessionId: 'timeout-route' });
  const originalHandler = WORKSPACE_TOOL_HANDLERS['memory.delete'];
  const originalTimeout = process.env.WORKSPACE_APPROVAL_ACTION_TIMEOUT_MS;
  WORKSPACE_TOOL_HANDLERS['memory.delete'] = async () => new Promise(() => {});
  process.env.WORKSPACE_APPROVAL_ACTION_TIMEOUT_MS = '10';
  try {
    const response = await request(createApp())
      .post(`/api/workspace/action-approvals/${approval.id}/execute`)
      .send({})
      .expect(502);
    assert.equal(response.body.code, 'ACTION_OUTCOME_UNKNOWN');
    assert.equal(response.body.evidenceIncomplete, true);
    assert.equal(response.body.retrySafe, false);
    assert.equal(response.body.action.outcomeUnknown, true);
  } finally {
    WORKSPACE_TOOL_HANDLERS['memory.delete'] = originalHandler;
    if (originalTimeout === undefined) delete process.env.WORKSPACE_APPROVAL_ACTION_TIMEOUT_MS;
    else process.env.WORKSPACE_APPROVAL_ACTION_TIMEOUT_MS = originalTimeout;
  }
  const stored = await WorkspaceActionApproval.findOne({ approvalId: approval.id }).lean();
  assert.equal(stored.status, 'failed');
});

test('approval dispatch fails closed when durable pre-dispatch evidence cannot be saved', async () => {
  const approval = await createWorkspaceApproval(
    { tool: 'memory.delete', params: { key: 'predispatch-evidence-fixture' } },
    { surface: 'test' },
  );
  const originalCreate = WorkspaceActionRecord.create;
  const originalHandler = WORKSPACE_TOOL_HANDLERS['memory.delete'];
  const originalConsoleError = console.error;
  let handlerCalls = 0;
  WorkspaceActionRecord.create = async () => { throw new Error('evidence unavailable'); };
  WORKSPACE_TOOL_HANDLERS['memory.delete'] = async () => { handlerCalls += 1; return { ok: true }; };
  console.error = () => {};
  try {
    const response = await request(createApp())
      .post(`/api/workspace/action-approvals/${approval.id}/execute`)
      .send({})
      .expect(503);
    assert.equal(response.body.code, 'ACTION_EVIDENCE_REQUIRED');
    assert.equal(response.body.mayHaveExecuted, false);
    assert.equal(handlerCalls, 0);
  } finally {
    WorkspaceActionRecord.create = originalCreate;
    WORKSPACE_TOOL_HANDLERS['memory.delete'] = originalHandler;
    console.error = originalConsoleError;
  }
});

test('claimed approval is failed deterministically when pre-execution authority loading crashes', async () => {
  const action = { tool: 'memory.delete', params: { key: 'approval-crash-fixture' } };
  const approval = await createWorkspaceApproval(action, { surface: 'test', sessionId: 'approval-crash' });
  const originalFindOne = AgentIdentity.findOne;
  AgentIdentity.findOne = () => ({
    select() {
      throw new Error('authority store unavailable');
    },
  });
  try {
    const response = await request(createApp())
      .post(`/api/workspace/action-approvals/${approval.id}/execute`)
      .send({})
      .expect(502);
    assert.equal(response.body.code, 'APPROVAL_EXECUTION_FAILED');
    assert.equal(response.body.evidenceIncomplete, true);
    assert.equal(response.body.mayHaveExecuted, false);
    assert.equal(response.body.retrySafe, false);
  } finally {
    AgentIdentity.findOne = originalFindOne;
  }
  const stored = await WorkspaceActionApproval.findOne({ approvalId: approval.id }).lean();
  assert.equal(stored.status, 'failed');
  assert.match(stored.error, /could not start/i);
});

test('expired executing approval lease reconciles to outcome-unknown without redispatch', async () => {
  const approval = await createWorkspaceApproval(
    { tool: 'memory.delete', params: { key: 'expired-lease-fixture' } },
    { surface: 'test' },
  );
  await WorkspaceActionApproval.updateOne(
    { approvalId: approval.id },
    {
      $set: {
        status: 'executing',
        claimedAt: new Date(Date.now() - 300000),
        executionLeaseExpiresAt: new Date(Date.now() - 1000),
      },
    },
  );
  const response = await request(createApp())
    .post(`/api/workspace/action-approvals/${approval.id}/execute`)
    .send({})
    .expect(409);
  assert.equal(response.body.code, 'ACTION_OUTCOME_UNKNOWN');
  assert.equal(response.body.mayHaveExecuted, true);
  assert.equal(response.body.retrySafe, false);
  const stored = await WorkspaceActionApproval.findOne({ approvalId: approval.id }).lean();
  assert.equal(stored.status, 'failed');
  assert.match(stored.error, /lease expired.*outcome is unknown/i);
});

test('direct approval ingress and stored approval dispatch both enforce the canonical action schema', async () => {
  const app = request(createApp());
  const invalidIngress = await app
    .post('/api/workspace/action-approvals')
    .send({ tool: 'memory.delete', params: { key: 'k', surprise: true } })
    .expect(400);
  assert.equal(invalidIngress.body.code, 'INVALID_ACTION');

  const approval = await createWorkspaceApproval(
    { tool: 'memory.delete', params: { key: 'stored-schema-fixture' } },
    { surface: 'test' },
  );
  await WorkspaceActionApproval.updateOne(
    { approvalId: approval.id },
    { $set: { params: { key: 'stored-schema-fixture', surprise: true } } },
  );
  const invalidStored = await app
    .post(`/api/workspace/action-approvals/${approval.id}/execute`)
    .send({})
    .expect(422);
  assert.equal(invalidStored.body.code, 'INVALID_STORED_ACTION');
  const stored = await WorkspaceActionApproval.findOne({ approvalId: approval.id }).lean();
  assert.equal(stored.status, 'failed');
});

test('Workspace profile exposes saved proactive controls and deterministic harness evidence', async () => {
  const app = request(createApp());
  const policyRes = await app
    .patch('/api/workspace/profile/policy')
    .send({ policy: { maxAutomaticBatchSize: 12, allowedAccounts: ['PRIMARY@EXAMPLE.COM'] } })
    .expect(200);
  assert.equal(policyRes.body.policy.maxAutomaticBatchSize, 12);
  assert.deepEqual(policyRes.body.policy.allowedAccounts, ['primary@example.com']);

  const profileRes = await app.get('/api/workspace/profile').expect(200);
  assert.equal(profileRes.body.profile.importance, 'primary-operations-agent');
  assert.equal(profileRes.body.profile.policy.maxAutomaticBatchSize, 12);
  assert.ok(Array.isArray(profileRes.body.profile.permissions.confirmation));
  assert.match(profileRes.body.profile.permissions.confirmation.join(' '), /Send an email/);

  const harnessRes = await app.post('/api/workspace/harness/run').send({}).expect(200);
  assert.equal(harnessRes.body.ok, true);
  assert.equal(harnessRes.body.run.status, 'pass');
  assert.equal(harnessRes.body.run.metadata.externalActionsExecuted, false);
  assert.ok(harnessRes.body.run.cases.length >= 10);

  const identity = await AgentIdentity.findOne({ agentId: 'workspace' }).lean();
  assert.equal(identity.harness.runs[0].source, 'workspace-policy-harness');
  assert.equal(identity.harness.runs[0].status, 'pass');
});

test('disabled Workspace Agent rejects direct requests before any provider work starts', async () => {
  await AgentIdentity.create({ agentId: 'workspace', enabled: false });
  const response = await request(createApp())
    .post('/api/workspace/ai')
    .send({ prompt: 'Check my inbox.' })
    .expect(409);
  assert.equal(response.body.code, 'WORKSPACE_AGENT_DISABLED');
});

test('Workspace action evidence and approval collections have TTL indexes', async () => {
  await WorkspaceActionRecord.syncIndexes();
  await WorkspaceActionApproval.syncIndexes();
  for (const Model of [WorkspaceActionRecord, WorkspaceActionApproval]) {
    const indexes = await Model.collection.indexes();
    const ttl = indexes.find((index) => index.key?.expiresAt === 1 && index.expireAfterSeconds === 0);
    assert.ok(ttl, `${Model.modelName} should have an expiresAt TTL index`);
  }
});
