'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const AgentIdentity = require('../src/models/AgentIdentity');

test('agent identity registry persists custom agents, reviews, and harness runs', async (t) => {
  await connect();
  const agent = request(createApp());
  await AgentIdentity.deleteMany({});

  t.after(async () => {
    await AgentIdentity.deleteMany({});
    await disconnect();
  });

  const createRes = await agent
    .post('/api/agent-identities')
    .send({
      agentId: 'billing-audit-agent',
      profile: {
        displayName: 'Billing Audit Agent',
        roleTitle: 'Billing Audit Specialist',
        headline: 'Reviews billing escalations before workflow handoff.',
        tone: 'Precise and evidence-first.',
      },
      summary: 'Created for registry workflow coverage.',
    })
    .expect(201);

  assert.equal(createRes.body.ok, true);
  assert.equal(createRes.body.agent.agentId, 'billing-audit-agent');
  assert.equal(createRes.body.agent.custom.isCustom, true);
  assert.equal(createRes.body.agent.profile.roleTitle, 'Billing Audit Specialist');
  assert.equal(createRes.body.agent.history.entries[0].type, 'registry-create');

  await agent
    .post('/api/agent-identities')
    .send({ agentId: 'billing-audit-agent' })
    .expect(409);

  const reviewRes = await agent
    .post('/api/agent-identities/billing-audit-agent/reviews')
    .send({
      surface: 'profile',
      status: 'approved',
      summary: 'Profile approved after registry creation.',
      versionRef: 'v1',
    })
    .expect(201);

  assert.equal(reviewRes.body.ok, true);
  assert.equal(reviewRes.body.agent.reviews.entries.length, 1);
  assert.equal(reviewRes.body.agent.reviews.entries[0].status, 'approved');
  assert.equal(reviewRes.body.agent.reviews.entries[0].surface, 'profile');
  assert.ok(reviewRes.body.agent.reviews.lastApprovedAt);

  const harnessRes = await agent
    .post('/api/agent-identities/billing-audit-agent/harness-runs')
    .send({
      status: 'warning',
      summary: 'Manual harness run recorded from profile page.',
      source: 'manual-ui',
      cases: [
        {
          id: 'contract-shape',
          name: 'Contract shape',
          status: 'passed',
          expected: 'Profile exposes required operating fields.',
          actual: 'Required fields present.',
        },
        {
          id: 'workflow-fit',
          name: 'Workflow fit',
          status: 'warning',
          expected: 'Workflow assignment is backed by real runs.',
          actual: 'Manual registry entry still needs live workflow evidence.',
        },
      ],
    })
    .expect(201);

  assert.equal(harnessRes.body.agent.harness.runs.length, 1);
  assert.equal(harnessRes.body.agent.harness.runs[0].status, 'warn');
  assert.equal(harnessRes.body.agent.harness.runs[0].cases[0].status, 'pass');
  assert.equal(harnessRes.body.agent.harness.runs[0].cases[1].status, 'warn');

  const importRes = await agent
    .post('/api/agent-identities/import')
    .send({
      sourceLabel: 'Test registry import',
      agents: [
        {
          agentId: 'refund-routing-agent',
          profile: {
            displayName: 'Refund Routing Agent',
            roleTitle: 'Refund Routing Specialist',
            headline: 'Routes refund escalations to the right follow-up lane.',
          },
        },
      ],
    })
    .expect(201);

  assert.equal(importRes.body.ok, true);
  assert.equal(importRes.body.agents.length, 1);
  assert.equal(importRes.body.agents[0].agentId, 'refund-routing-agent');
  assert.equal(importRes.body.agents[0].custom.registryStatus, 'imported');

  const listRes = await agent.get('/api/agent-identities').expect(200);
  const ids = listRes.body.agents.map((item) => item.agentId);
  assert.ok(ids.includes('triage-agent'));
  assert.ok(ids.includes('billing-audit-agent'));
  assert.ok(ids.includes('refund-routing-agent'));

  const reviewsRes = await agent.get('/api/agent-identities/billing-audit-agent/reviews').expect(200);
  assert.equal(reviewsRes.body.reviews.length, 1);

  const harnessRunsRes = await agent.get('/api/agent-identities/billing-audit-agent/harness-runs').expect(200);
  assert.equal(harnessRunsRes.body.runs.length, 1);
});
