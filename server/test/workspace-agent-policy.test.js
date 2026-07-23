'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const AgentIdentity = require('../src/models/AgentIdentity');
const WorkspaceActionApproval = require('../src/models/WorkspaceActionApproval');
const WorkspaceActionRecord = require('../src/models/WorkspaceActionRecord');
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
