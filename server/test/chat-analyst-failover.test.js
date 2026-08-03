'use strict';

// Regression coverage for analyst (QBO Assistant) fallback policy.
//
// Production failover is fail-closed until a server-owned evaluation authority
// can prove that the exact backup provider/model and current behavior contract
// passed. Caller flags and stored profile choices can select a candidate, but
// cannot authorize it. Explicit provider-comparison/evaluation harness paths may
// still exercise fallback mechanics without granting product authority.

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const Conversation = require('../src/models/Conversation');
const AgentIdentity = require('../src/models/AgentIdentity');
const claude = require('../src/services/claude');
const codex = require('../src/services/codex');
const { updateAgentRuntime } = require('../src/services/agent-identity-service');
const { startChatOrchestration } = require('../src/services/chat-orchestrator');
const { startRoomOrchestration } = require('../src/services/room-orchestrator');
const { resetProviderHealth } = require('../src/services/provider-health');

const ANALYST_AGENT_ID = 'chat';

// Primary the analyst will use. Its GLOBAL alternate (getAlternateProvider) is
// 'codex'. The profile backup below is 'gpt-5.4' — a different provider id on
// the SAME codex transport — so a fail-over to 'gpt-5.4' can only come from the
// profile, not the global default. Both gpt-5.4 and codex route through the
// codex.js service module, so stubbing codex.chat covers either backup.
const PRIMARY_PROVIDER = 'claude';
const PROFILE_BACKUP_PROVIDER = 'gpt-5.4';
const GLOBAL_ALTERNATE_PROVIDER = 'codex';

function stubPrimaryFailsBackupSucceeds(backupText) {
  const calls = { primary: 0, backup: 0 };
  claude.chat = ({ onError }) => {
    calls.primary += 1;
    const err = new Error('Codex CLI exited with code 1');
    err.code = 'PROVIDER_EXEC_FAILED';
    onError(err);
    return () => {};
  };
  codex.chat = ({ onChunk, onDone }) => {
    calls.backup += 1;
    onChunk(backupText);
    onDone(backupText);
    return () => {};
  };
  return calls;
}

function parseEvent(text, name) {
  const match = text.match(new RegExp(`event: ${name}\\s+data: (.+)`));
  return match ? JSON.parse(match[1]) : null;
}

function assertProductFallbackBlocked(text) {
  const fallback = parseEvent(text, 'fallback');
  const error = parseEvent(text, 'error');
  assert.ok(fallback, 'expected a fallback decision event');
  assert.equal(fallback.blocked, true);
  assert.equal(fallback.eligible, false);
  assert.equal(fallback.reason, 'FALLBACK_NOT_EVALUATED');
  assert.equal(fallback.decision?.reason, 'server_evaluation_authority_not_implemented');
  assert.ok(error, 'expected the primary failure to terminate the request');
  assert.equal(parseEvent(text, 'done'), null, 'an unevaluated backup must never complete the product request');
}

async function seedAnalystRuntime(runtime) {
  return updateAgentRuntime(ANALYST_AGENT_ID, runtime, {
    actor: 'test',
    summary: 'Seed analyst runtime for failover test.',
  });
}

function runOrchestration(options) {
  return new Promise((resolve) => {
    const events = [];
    startChatOrchestration({
      ...options,
      onChunk: (data) => events.push({ type: 'chunk', data }),
      onProviderError: (data) => events.push({ type: 'provider_error', data }),
      onFallback: (data) => events.push({ type: 'fallback', data }),
      onDone: (data) => resolve({ result: 'done', data, events }),
      onError: (data) => resolve({ result: 'error', data, events }),
    });
  });
}

test('chat-analyst-failover suite', async (t) => {
  let app;
  let agent;
  let originalClaudeChat;
  let originalCodexChat;

  t.before(async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ADMIN_API_KEY;
    delete process.env.EDITOR_API_KEY;
    delete process.env.VIEWER_API_KEY;
    delete process.env.FEATURE_CHAT_PROVIDER_PARITY;
    delete process.env.FEATURE_CHAT_FALLBACK_MODE;

    originalClaudeChat = claude.chat;
    originalCodexChat = codex.chat;

    await connect();
    app = createApp();
    agent = request(app);
  });

  t.after(async () => {
    claude.chat = originalClaudeChat;
    codex.chat = originalCodexChat;
    resetProviderHealth();
    await disconnect();
  });

  t.beforeEach(async () => {
    resetProviderHealth();
    delete process.env.FEATURE_CHAT_PROVIDER_PARITY;
    delete process.env.FEATURE_CHAT_FALLBACK_MODE;
    await Conversation.deleteMany({});
    await AgentIdentity.deleteMany({});
  });

  await t.test(
    'disabled QBO Assistant is rejected before main-chat provider work or conversation creation',
    async () => {
      await AgentIdentity.create({ agentId: ANALYST_AGENT_ID, enabled: false });
      let providerCalls = 0;
      claude.chat = () => { providerCalls += 1; throw new Error('must not run'); };
      codex.chat = () => { providerCalls += 1; throw new Error('must not run'); };

      const createResponse = await agent
        .post('/api/chat')
        .send({ message: 'do not run a disabled agent' });
      assert.equal(createResponse.status, 409);
      assert.equal(createResponse.body.code, 'AGENT_DISABLED');
      assert.equal(providerCalls, 0);
      assert.equal(await Conversation.countDocuments({}), 0);

      const conversation = await Conversation.create({
        title: 'Retry gate fixture',
        messages: [{ role: 'user', content: 'original question' }],
      });
      const retryResponse = await agent
        .post('/api/chat/retry')
        .send({ conversationId: conversation._id.toString() });
      assert.equal(retryResponse.status, 409);
      assert.equal(retryResponse.body.code, 'AGENT_DISABLED');
      assert.equal(providerCalls, 0);
      const unchanged = await Conversation.findById(conversation._id).lean();
      assert.equal(unchanged.messages.length, 1);
    }
  );

  await t.test(
    'disabled room mention is rejected before provider or tool execution',
    async () => {
      await AgentIdentity.create({ agentId: ANALYST_AGENT_ID, enabled: false });
      let agentStarts = 0;
      const error = await new Promise((resolve) => {
        startRoomOrchestration({
          room: {
            activeAgents: [ANALYST_AGENT_ID],
            settings: { orchestrationMode: 'mentioned-only' },
            messages: [],
          },
          userMessage: '@chat help',
          mentions: [ANALYST_AGENT_ID],
          onAgentStart: () => { agentStarts += 1; },
          onError: resolve,
        });
      });
      assert.equal(error.code, 'AGENT_DISABLED');
      assert.deepEqual(error.agentIds, [ANALYST_AGENT_ID]);
      assert.equal(agentStarts, 0);
    }
  );

  await t.test(
    'single-mode analyst request selects the profile backup but blocks it without server evaluation authority',
    async () => {
      // The agent profile carries a CUSTOM backup. Per the runtime schema, a
      // custom (non-global-alternate) backup can only be persisted via
      // mode:'fallback' — single mode collapses fallbackProvider to the global
      // alternate. The analyst REQUEST below still uses mode:'single', proving
      // the analyst inherits the profile's backup choice and auto-fails-over
      // without the request asking for fallback mode.
      await seedAnalystRuntime({
        provider: PRIMARY_PROVIDER,
        mode: 'fallback',
        fallbackProvider: PROFILE_BACKUP_PROVIDER,
        configured: true,
      });
      const calls = stubPrimaryFailsBackupSucceeds('profile backup answer');

      const res = await agent
        .post('/api/chat')
        .send({
          message: 'analyze this escalation',
          mode: 'single',
          primaryProvider: PRIMARY_PROVIDER,
          // No fallbackProvider in the body — the backup must come from the
          // QBO Assistant profile, not the request.
          settings: { debug: { disableSharedAgentTools: true } },
        });

      assert.equal(res.status, 200);
      assert.match(res.text, /event: provider_error/);
      assertProductFallbackBlocked(res.text);
      const fallback = parseEvent(res.text, 'fallback');
      assert.equal(fallback.to, PROFILE_BACKUP_PROVIDER, 'the profile candidate should still be resolved');
      assert.equal(calls.backup, 0, 'blocked product fallback must not dispatch the backup provider');
    }
  );

  await t.test(
    'shared-agent-tool path also blocks an unevaluated product backup',
    async () => {
      await seedAnalystRuntime({
        provider: PRIMARY_PROVIDER,
        mode: 'fallback',
        fallbackProvider: PROFILE_BACKUP_PROVIDER,
        configured: true,
      });
      const calls = stubPrimaryFailsBackupSucceeds('tool path backup answer');

      const res = await agent
        .post('/api/chat')
        .send({
          message: 'analyze this escalation',
          mode: 'single',
          primaryProvider: PRIMARY_PROVIDER,
          // Shared agent tools left ENABLED (default) -> runAgentToolLoop path.
        });

      assert.equal(res.status, 200);
      assertProductFallbackBlocked(res.text);
      assert.equal(parseEvent(res.text, 'fallback').to, PROFILE_BACKUP_PROVIDER);
      assert.equal(calls.primary, 1);
      assert.equal(calls.backup, 0);
    }
  );

  await t.test(
    'single-mode analyst resolves the global alternate but blocks it without evaluation authority',
    async () => {
      // No analyst runtime seeded -> getAgentIdentity('chat').runtime is null.
      const calls = stubPrimaryFailsBackupSucceeds('global alternate answer');

      const res = await agent
        .post('/api/chat')
        .send({
          message: 'analyze this escalation',
          mode: 'single',
          primaryProvider: PRIMARY_PROVIDER,
          settings: { debug: { disableSharedAgentTools: true } },
        });

      assert.equal(res.status, 200);
      assertProductFallbackBlocked(res.text);
      assert.equal(parseEvent(res.text, 'fallback').to, GLOBAL_ALTERNATE_PROVIDER);
      assert.equal(calls.backup, 0);
    }
  );

  await t.test(
    'stored mode:"single" still resolves a candidate but cannot authorize product fallback',
    async () => {
      // The QBO Assistant profile shows MODE = "Single provider". Per the
      // runtime schema this persists fallbackProvider = the global alternate
      // (codex). The locked intent: the analyst must STILL fail over.
      await seedAnalystRuntime({
        provider: PRIMARY_PROVIDER,
        mode: 'single',
        configured: true,
      });
      const calls = stubPrimaryFailsBackupSucceeds('single-mode profile still fails over');

      const res = await agent
        .post('/api/chat')
        .send({
          message: 'analyze this escalation',
          mode: 'single',
          primaryProvider: PRIMARY_PROVIDER,
          settings: { debug: { disableSharedAgentTools: true } },
        });

      assert.equal(res.status, 200);
      assertProductFallbackBlocked(res.text);
      assert.equal(parseEvent(res.text, 'fallback').to, GLOBAL_ALTERNATE_PROVIDER);
      assert.equal(calls.backup, 0);
    }
  );

  await t.test(
    'degenerate profile backup re-derives a distinct candidate but remains blocked',
    async () => {
      // Degenerate profile: operator set the backup to the same provider as the
      // analyst primary. The analyst must not be left without a usable backup —
      // it re-derives the global alternate so failover can still fire.
      await seedAnalystRuntime({
        provider: PRIMARY_PROVIDER,
        mode: 'fallback',
        fallbackProvider: PRIMARY_PROVIDER, // == primary (degenerate)
        configured: true,
      });
      const calls = stubPrimaryFailsBackupSucceeds('re-derived alternate answer');

      const res = await agent
        .post('/api/chat')
        .send({
          message: 'analyze this escalation',
          mode: 'single',
          primaryProvider: PRIMARY_PROVIDER,
          settings: { debug: { disableSharedAgentTools: true } },
        });

      assert.equal(res.status, 200);
      assertProductFallbackBlocked(res.text);
      assert.equal(parseEvent(res.text, 'fallback').to, GLOBAL_ALTERNATE_PROVIDER);
      assert.equal(calls.backup, 0);
    }
  );

  await t.test(
    'explicit provider-comparison orchestration exercises fallback while healthy primary stays single-attempt',
    async () => {
      // Locks the NEW contract: automatic failover is always on. Any caller —
      // analyst or not, with or without a flag — fails over to its distinct
      // backup when the primary fails. The success path stays single-attempt.
      let codexCalled = false;
      const failPrimary = () => {
        claude.chat = ({ onError }) => {
          const err = new Error('primary down');
          err.code = 'PROVIDER_EXEC_FAILED';
          onError(err);
          return () => {};
        };
        codex.chat = ({ onChunk, onDone }) => {
          codexCalled = true;
          onChunk('backup');
          onDone('backup');
          return () => {};
        };
      };

      // (a) single mode, NO autoFailover flag -> STILL fails over (new default).
      failPrimary();
      resetProviderHealth();
      codexCalled = false;
      const noFlag = await runOrchestration({
        executionPurpose: 'provider-comparison',
        mode: 'single',
        primaryProvider: PRIMARY_PROVIDER,
        fallbackProvider: PROFILE_BACKUP_PROVIDER,
        messages: [{ role: 'user', content: 'hi' }],
        systemPrompt: '',
        images: [],
      });
      assert.equal(noFlag.result, 'done', 'single mode must now fail over without any flag');
      assert.equal(noFlag.data.providerUsed, PROFILE_BACKUP_PROVIDER);
      assert.equal(noFlag.data.fallbackUsed, true);
      assert.equal(codexCalled, true, 'backup must run on primary failure');
      assert.equal(noFlag.events.filter((e) => e.type === 'fallback').length, 1);

      // (b) single mode, a degenerate backup (== primary) is re-derived to a
      // DISTINCT global alternate (codex) so failover still fires.
      failPrimary();
      resetProviderHealth();
      codexCalled = false;
      const degenerate = await runOrchestration({
        executionPurpose: 'provider-comparison',
        mode: 'single',
        primaryProvider: PRIMARY_PROVIDER,
        fallbackProvider: PRIMARY_PROVIDER, // collapses to primary -> re-derived
        messages: [{ role: 'user', content: 'hi' }],
        systemPrompt: '',
        images: [],
      });
      assert.equal(degenerate.result, 'done', 'degenerate backup must re-derive and fail over');
      assert.equal(degenerate.data.providerUsed, GLOBAL_ALTERNATE_PROVIDER);
      assert.equal(degenerate.data.fallbackUsed, true);
      assert.equal(codexCalled, true);

      // (c) success path: primary succeeds -> the backup must NOT run (no extra
      // cost/latency when the primary is healthy).
      let backupRan = false;
      claude.chat = ({ onChunk, onDone }) => { onChunk('primary ok'); onDone('primary ok'); return () => {}; };
      codex.chat = ({ onChunk, onDone }) => { backupRan = true; onChunk('backup'); onDone('backup'); return () => {}; };
      resetProviderHealth();
      const success = await runOrchestration({
        mode: 'single',
        primaryProvider: PRIMARY_PROVIDER,
        fallbackProvider: PROFILE_BACKUP_PROVIDER,
        messages: [{ role: 'user', content: 'hi' }],
        systemPrompt: '',
        images: [],
      });
      assert.equal(success.result, 'done');
      assert.equal(success.data.providerUsed, PRIMARY_PROVIDER);
      assert.equal(success.data.fallbackUsed, false);
      assert.equal(backupRan, false, 'backup must not run when the primary succeeds');
      assert.equal(success.events.filter((e) => e.type === 'fallback').length, 0);
    }
  );
});
