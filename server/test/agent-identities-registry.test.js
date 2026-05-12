'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const AgentIdentity = require('../src/models/AgentIdentity');
const {
  AGENT_PROMPT_VERSIONS_ROOT,
  CUSTOM_AGENT_PROMPTS_ROOT,
} = require('../src/lib/agent-prompt-store');

function cleanupCustomPrompt(agentId) {
  fs.rmSync(path.join(CUSTOM_AGENT_PROMPTS_ROOT, `${agentId}.md`), { force: true });
  fs.rmSync(path.join(AGENT_PROMPT_VERSIONS_ROOT, `custom-${agentId}`), { recursive: true, force: true });
}

test('agent identity registry persists custom agents, reviews, and harness runs', async (t) => {
  await connect();
  const agent = request(createApp());
  await AgentIdentity.deleteMany({});

  t.after(async () => {
    await AgentIdentity.deleteMany({});
    cleanupCustomPrompt('billing-audit-agent');
    cleanupCustomPrompt('refund-routing-agent');
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
  assert.equal(createRes.body.agent.promptId, 'custom-billing-audit-agent');
  assert.equal(createRes.body.agent.custom.isCustom, true);
  assert.equal(createRes.body.agent.profile.roleTitle, 'Billing Audit Specialist');
  assert.equal(createRes.body.agent.history.entries[0].type, 'registry-create');

  const promptRes = await agent.get('/api/agent-prompts/custom-billing-audit-agent').expect(200);
  assert.equal(promptRes.body.ok, true);
  assert.match(promptRes.body.content, /Billing Audit Specialist/);

  const editedPrompt = `${promptRes.body.content}\n## Test Note\nPersist custom prompt edits.\n`;
  await agent
    .put('/api/agent-prompts/custom-billing-audit-agent')
    .send({
      content: editedPrompt,
      label: 'Custom prompt test edit',
    })
    .expect(200);

  const editedPromptRes = await agent.get('/api/agent-prompts/custom-billing-audit-agent').expect(200);
  assert.match(editedPromptRes.body.content, /Persist custom prompt edits/);

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
  assert.equal(importRes.body.agents[0].promptId, 'custom-refund-routing-agent');
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

  const runtimeRes = await agent
    .patch('/api/agent-identities/triage-agent/runtime')
    .send({
      runtime: {
        provider: 'gpt-5.5',
        mode: 'fallback',
        fallbackProvider: 'llm-gateway',
        model: 'gpt-5.5',
        fallbackModel: 'auto',
        reasoningEffort: 'high',
      },
      summary: 'Persisted triage runtime defaults.',
    })
    .expect(200);

  assert.equal(runtimeRes.body.ok, true);
  assert.equal(runtimeRes.body.runtime.provider, 'gpt-5.5');
  assert.equal(runtimeRes.body.runtime.mode, 'fallback');
  assert.equal(runtimeRes.body.runtime.fallbackProvider, 'llm-gateway');
  assert.equal(runtimeRes.body.runtime.reasoningEffort, 'high');
  assert.equal(runtimeRes.body.agent.history.entries[0].type, 'runtime-defaults');

  const triageRes = await agent.get('/api/agent-identities/triage-agent').expect(200);
  assert.equal(triageRes.body.agent.runtime.provider, 'gpt-5.5');
  assert.equal(triageRes.body.agent.runtime.configured, true);
});
