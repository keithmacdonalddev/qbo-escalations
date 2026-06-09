'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const EscalationAttentionItem = require('../src/models/EscalationAttentionItem');
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
  await EscalationAttentionItem.deleteMany({});

  t.after(async () => {
    await AgentIdentity.deleteMany({});
    await EscalationAttentionItem.deleteMany({});
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

  const editedPrompt = `PROMPT_VERSION: P1\n\n${promptRes.body.content}\n## Test Note\nPersist custom prompt edits.\n`;
  await agent
    .put('/api/agent-prompts/custom-billing-audit-agent')
    .send({
      content: editedPrompt,
      label: 'Custom prompt test edit',
    })
    .expect(200);

  const editedPromptRes = await agent.get('/api/agent-prompts/custom-billing-audit-agent').expect(200);
  assert.match(editedPromptRes.body.content, /Persist custom prompt edits/);
  assert.match(editedPromptRes.body.content, /PROMPT_VERSION: P1/);

  const secondEditedPrompt = editedPrompt
    .replace('PROMPT_VERSION: P1', 'PROMPT_VERSION: P2')
    .replace('Persist custom prompt edits.', 'Persist custom prompt edits with a second version.');
  await agent
    .put('/api/agent-prompts/custom-billing-audit-agent')
    .send({
      content: secondEditedPrompt,
      label: 'Second custom prompt test edit',
    })
    .expect(200);

  const promptVersionsRes = await agent.get('/api/agent-prompts/custom-billing-audit-agent/versions').expect(200);
  assert.equal(promptVersionsRes.body.ok, true);
  assert.equal(promptVersionsRes.body.versions[0].promptVersion, 'P2');
  assert.equal(promptVersionsRes.body.versions[0].label, 'Second custom prompt test edit');
  assert.match(promptVersionsRes.body.versions[0].sha256, /^[a-f0-9]{64}$/);
  assert.ok(promptVersionsRes.body.versions.some((version) => version.promptVersion === 'P1'));

  const newestVersionContentRes = await agent
    .get(`/api/agent-prompts/custom-billing-audit-agent/versions/${promptVersionsRes.body.versions[0].ts}`)
    .expect(200);
  assert.match(newestVersionContentRes.body.content, /PROMPT_VERSION: P2/);

  const thirdEditedPrompt = secondEditedPrompt
    .replace('PROMPT_VERSION: P2', 'PROMPT_VERSION: P3')
    .replace('second version.', 'third direct-file version.');
  fs.writeFileSync(
    path.join(CUSTOM_AGENT_PROMPTS_ROOT, 'billing-audit-agent.md'),
    thirdEditedPrompt,
    'utf-8'
  );

  const directFileVersionsRes = await agent.get('/api/agent-prompts/custom-billing-audit-agent/versions').expect(200);
  assert.equal(directFileVersionsRes.body.ok, true);
  assert.equal(directFileVersionsRes.body.versions[0].promptVersion, 'P3');
  assert.equal(directFileVersionsRes.body.versions[0].source, 'api-list-current');
  assert.match(directFileVersionsRes.body.versions[0].sha256, /^[a-f0-9]{64}$/);

  const directFileVersionContentRes = await agent
    .get(`/api/agent-prompts/custom-billing-audit-agent/versions/${directFileVersionsRes.body.versions[0].ts}`)
    .expect(200);
  assert.match(directFileVersionContentRes.body.content, /third direct-file version/);

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

  await agent
    .post('/api/agent-identities/billing-audit-agent/reviews')
    .send({
      surface: 'runtime',
      status: 'rejected',
      summary: 'Runtime review rejected until model defaults are set.',
    })
    .expect(201);

  let reviewAttention = await EscalationAttentionItem.findOne({
    kind: 'agent-review',
    fingerprint: 'agent-review:billing-audit-agent:runtime',
  }).lean();
  assert.equal(reviewAttention.status, 'open');
  assert.equal(reviewAttention.severity, 'critical');
  assert.equal(reviewAttention.sourceType, 'agent');
  assert.equal(reviewAttention.sourceLabel, 'Billing Audit Specialist');

  await agent
    .post('/api/agent-identities/billing-audit-agent/reviews')
    .send({
      surface: 'runtime',
      status: 'approved',
      summary: 'Runtime review approved after defaults were set.',
    })
    .expect(201);

  reviewAttention = await EscalationAttentionItem.findOne({
    kind: 'agent-review',
    fingerprint: 'agent-review:billing-audit-agent:runtime',
  }).lean();
  assert.equal(reviewAttention.status, 'resolved');

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

  let harnessAttention = await EscalationAttentionItem.findOne({
    kind: 'agent-harness',
    fingerprint: 'agent-harness:billing-audit-agent',
  }).lean();
  assert.equal(harnessAttention.status, 'open');
  assert.equal(harnessAttention.severity, 'warning');
  assert.equal(harnessAttention.metadata.runId, harnessRes.body.agent.harness.runs[0].runId);

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
  assert.equal(reviewsRes.body.reviews.length, 3);

  const harnessRunsRes = await agent.get('/api/agent-identities/billing-audit-agent/harness-runs').expect(200);
  assert.equal(harnessRunsRes.body.runs.length, 1);

  await agent
    .post('/api/agent-identities/billing-audit-agent/harness-runs')
    .send({
      status: 'passed',
      summary: 'Follow-up harness run passed.',
      cases: [
        {
          id: 'contract-shape',
          name: 'Contract shape',
          status: 'passed',
        },
      ],
    })
    .expect(201);

  harnessAttention = await EscalationAttentionItem.findOne({
    kind: 'agent-harness',
    fingerprint: 'agent-harness:billing-audit-agent',
  }).lean();
  assert.equal(harnessAttention.status, 'resolved');

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

  const runtimeDefaultsRes = await agent
    .get('/api/agent-identities/runtime-defaults?ids=triage-agent,escalation-template-parser')
    .expect(200);
  assert.equal(runtimeDefaultsRes.body.ok, true);
  assert.equal(runtimeDefaultsRes.body.runtimes['triage-agent'].runtime.provider, 'gpt-5.5');
  assert.equal(runtimeDefaultsRes.body.runtimes['triage-agent'].runtime.mode, 'fallback');
  assert.equal(runtimeDefaultsRes.body.runtimes['escalation-template-parser'].runtime, null);
});

test('knowledgebase-agent runtime round-trips and resolveKbAgentRuntimePolicy reads it', async (t) => {
  await connect();
  const agent = request(createApp());
  await AgentIdentity.deleteMany({});
  const { resolveKbAgentRuntimePolicy } = require('../src/services/knowledgebase-agent-context-service');

  t.after(async () => {
    await AgentIdentity.deleteMany({});
    await disconnect();
  });

  // Unconfigured -> neutral default policy with a distinct backup + failover on.
  const defaultPolicy = await resolveKbAgentRuntimePolicy();
  assert.ok(defaultPolicy.primaryProvider, 'neutral default has a primary provider');
  assert.notEqual(defaultPolicy.primaryProvider, defaultPolicy.fallbackProvider, 'distinct backup');
  assert.equal(defaultPolicy.autoFailover, true, 'failover always on');

  // The generic runtime route (no special-casing) accepts the KB agent id.
  const runtimeRes = await agent
    .patch('/api/agent-identities/knowledgebase-agent/runtime')
    .send({
      runtime: {
        provider: 'openai',
        mode: 'fallback',
        fallbackProvider: 'gemini',
        model: 'gpt-5.5',
        fallbackModel: 'auto',
        reasoningEffort: 'high',
      },
      summary: 'Persisted KB agent runtime defaults.',
    })
    .expect(200);
  assert.equal(runtimeRes.body.ok, true);
  assert.equal(runtimeRes.body.runtime.provider, 'openai');
  assert.equal(runtimeRes.body.runtime.configured, true);

  const runtimeDefaultsRes = await agent
    .get('/api/agent-identities/runtime-defaults?ids=knowledgebase-agent')
    .expect(200);
  assert.equal(runtimeDefaultsRes.body.runtimes['knowledgebase-agent'].runtime.provider, 'openai');

  // The server-side resolver now reads the saved runtime.
  const configuredPolicy = await resolveKbAgentRuntimePolicy();
  assert.equal(configuredPolicy.primaryProvider, 'openai');
  assert.equal(configuredPolicy.primaryModel, 'gpt-5.5');
  assert.equal(configuredPolicy.fallbackProvider, 'gemini');
  assert.equal(configuredPolicy.autoFailover, true);
});

test('knowledgebase-agent persists a non-default Claude CLI primary model', async (t) => {
  // Regression guard for an operator-reported confusion: a primary model the
  // operator picks for the Claude CLI provider must persist verbatim — even when
  // it equals the CLI default (claude-opus-4-8). Only a truly empty/whitespace
  // field means "no override → use the provider default". (The client previously
  // collapsed a default-equal model to '' before sending, which made a deliberate
  // pick on the KB agent vanish on save; that client-side collapse was removed so
  // any non-empty model now round-trips like any other agent — see the second
  // case below, where claude-opus-4-8 itself persists.)
  await connect();
  const agent = request(createApp());
  await AgentIdentity.deleteMany({});

  t.after(async () => {
    await AgentIdentity.deleteMany({});
    await disconnect();
  });

  // A distinct (non-default) Claude CLI model persists round-trip.
  await agent
    .patch('/api/agent-identities/knowledgebase-agent/runtime')
    .send({
      runtime: {
        provider: 'claude',
        mode: 'fallback',
        fallbackProvider: 'gemini',
        model: 'claude-sonnet-4-20250514',
        reasoningEffort: 'high',
      },
      summary: 'Persisted KB agent Claude CLI primary model.',
    })
    .expect(200);

  const distinctRes = await agent
    .get('/api/agent-identities/runtime-defaults?ids=knowledgebase-agent')
    .expect(200);
  assert.equal(distinctRes.body.runtimes['knowledgebase-agent'].runtime.provider, 'claude');
  assert.equal(
    distinctRes.body.runtimes['knowledgebase-agent'].runtime.model,
    'claude-sonnet-4-20250514',
    'a non-default Claude CLI primary model must round-trip'
  );

  // The CLI default itself round-trips: neither the client nor the server strips
  // a model against the catalog default anymore. The client now sends whatever
  // non-empty model the operator chose, and the server persists it verbatim — so
  // claude-opus-4-8 (the default) is stored and reloaded instead of vanishing.
  await agent
    .patch('/api/agent-identities/knowledgebase-agent/runtime')
    .send({
      runtime: {
        provider: 'claude',
        mode: 'fallback',
        fallbackProvider: 'gemini',
        model: 'claude-opus-4-8',
      },
      summary: 'Persisted KB agent runtime with explicit CLI default model.',
    })
    .expect(200);

  const defaultRes = await agent
    .get('/api/agent-identities/runtime-defaults?ids=knowledgebase-agent')
    .expect(200);
  assert.equal(
    defaultRes.body.runtimes['knowledgebase-agent'].runtime.model,
    'claude-opus-4-8',
    'a default-equal Claude CLI model must persist verbatim (no longer stripped)'
  );
});
