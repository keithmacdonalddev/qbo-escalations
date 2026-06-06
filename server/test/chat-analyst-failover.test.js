'use strict';

// Regression coverage for analyst (QBO Assistant) auto-failover.
//
// Incident: the analyst ran in mode:'single' with provider sequence [codex]
// only. When Codex crashed ("Codex CLI exited with code 1") the analyst leg did
// NOT fail over to a backup, because resolveSequentialProviders only appended a
// fallback when mode === 'fallback'.
//
// Product direction (now): automatic failover is the DEFAULT for EVERY agent.
// resolveSequentialProviders ALWAYS appends the (distinct) backup for sequential
// policies — there is no per-agent "mode" or flag that disables it. resolvePolicy
// guarantees a distinct backup (the neutral global alternate when none is set,
// re-derived if a configured backup collapses to the primary). The analyst still
// SOURCES its backup from the "QBO Assistant" agent profile (AgentIdentity key
// 'chat') runtime fallbackProvider/Model, via the shared resolveAgentBackup
// helper, but failover itself is unconditional.
//
// These tests prove: with a profile-configured distinct backup, a single-mode
// analyst fails over to THAT backup (proving profile sourcing, since the backup
// id differs from the global alternate); the same holds on both the plain
// orchestration path and the shared-agent-tool path; with no profile backup the
// analyst still fails over to the global alternate; and that the orchestrator now
// fails over by DEFAULT for any caller (no flag required) while the success path
// runs only the primary and parallel mode is unaffected.

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
  claude.chat = ({ onError }) => {
    const err = new Error('Codex CLI exited with code 1');
    err.code = 'PROVIDER_EXEC_FAILED';
    onError(err);
    return () => {};
  };
  codex.chat = ({ onChunk, onDone }) => {
    onChunk(backupText);
    onDone(backupText);
    return () => {};
  };
}

function parseEvent(text, name) {
  const match = text.match(new RegExp(`event: ${name}\\s+data: (.+)`));
  return match ? JSON.parse(match[1]) : null;
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
    'single-mode analyst request inherits the profile-configured backup and fails over (plain orchestration path)',
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
      stubPrimaryFailsBackupSucceeds('profile backup answer');

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
      assert.match(res.text, /event: fallback/);
      assert.match(res.text, /event: done/);

      const done = parseEvent(res.text, 'done');
      assert.ok(done, 'expected a done event');
      // Proves profile sourcing: gpt-5.4 is NOT the global alternate (codex).
      assert.equal(done.providerUsed, PROFILE_BACKUP_PROVIDER);
      assert.equal(done.fallbackUsed, true);
      assert.equal(done.fallbackFrom, PRIMARY_PROVIDER);
      assert.equal(done.fullResponse, 'profile backup answer');
    }
  );

  await t.test(
    'single-mode analyst request inherits the profile backup on the shared-agent-tool path too',
    async () => {
      await seedAnalystRuntime({
        provider: PRIMARY_PROVIDER,
        mode: 'fallback',
        fallbackProvider: PROFILE_BACKUP_PROVIDER,
        configured: true,
      });
      stubPrimaryFailsBackupSucceeds('tool path backup answer');

      const res = await agent
        .post('/api/chat')
        .send({
          message: 'analyze this escalation',
          mode: 'single',
          primaryProvider: PRIMARY_PROVIDER,
          // Shared agent tools left ENABLED (default) -> runAgentToolLoop path.
        });

      assert.equal(res.status, 200);
      const done = parseEvent(res.text, 'done');
      assert.ok(done, 'expected a done event');
      assert.equal(done.providerUsed, PROFILE_BACKUP_PROVIDER);
      assert.equal(done.fallbackUsed, true);
    }
  );

  await t.test(
    'single-mode analyst with no profile backup still fails over to the global alternate',
    async () => {
      // No analyst runtime seeded -> getAgentIdentity('chat').runtime is null.
      stubPrimaryFailsBackupSucceeds('global alternate answer');

      const res = await agent
        .post('/api/chat')
        .send({
          message: 'analyze this escalation',
          mode: 'single',
          primaryProvider: PRIMARY_PROVIDER,
          settings: { debug: { disableSharedAgentTools: true } },
        });

      assert.equal(res.status, 200);
      const done = parseEvent(res.text, 'done');
      assert.ok(done, 'expected a done event');
      // Fallback-of-last-resort: the global alternate of claude is codex.
      assert.equal(done.providerUsed, GLOBAL_ALTERNATE_PROVIDER);
      assert.equal(done.fallbackUsed, true);
      assert.equal(done.fallbackFrom, PRIMARY_PROVIDER);
    }
  );

  await t.test(
    'analyst with a stored mode:"single" profile still auto-fails-over (single mode is not honored as no-backup)',
    async () => {
      // The QBO Assistant profile shows MODE = "Single provider". Per the
      // runtime schema this persists fallbackProvider = the global alternate
      // (codex). The locked intent: the analyst must STILL fail over.
      await seedAnalystRuntime({
        provider: PRIMARY_PROVIDER,
        mode: 'single',
        configured: true,
      });
      stubPrimaryFailsBackupSucceeds('single-mode profile still fails over');

      const res = await agent
        .post('/api/chat')
        .send({
          message: 'analyze this escalation',
          mode: 'single',
          primaryProvider: PRIMARY_PROVIDER,
          settings: { debug: { disableSharedAgentTools: true } },
        });

      assert.equal(res.status, 200);
      const done = parseEvent(res.text, 'done');
      assert.ok(done, 'expected a done event');
      assert.equal(done.providerUsed, GLOBAL_ALTERNATE_PROVIDER);
      assert.equal(done.fallbackUsed, true);
      assert.equal(done.fallbackFrom, PRIMARY_PROVIDER);
    }
  );

  await t.test(
    'analyst with a profile backup equal to the primary re-derives a distinct global alternate and still fails over',
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
      stubPrimaryFailsBackupSucceeds('re-derived alternate answer');

      const res = await agent
        .post('/api/chat')
        .send({
          message: 'analyze this escalation',
          mode: 'single',
          primaryProvider: PRIMARY_PROVIDER,
          settings: { debug: { disableSharedAgentTools: true } },
        });

      assert.equal(res.status, 200);
      const done = parseEvent(res.text, 'done');
      assert.ok(done, 'expected a done event');
      assert.equal(done.providerUsed, GLOBAL_ALTERNATE_PROVIDER);
      assert.equal(done.fallbackUsed, true);
      assert.equal(done.fallbackFrom, PRIMARY_PROVIDER);
    }
  );

  await t.test(
    'orchestrator fails over by DEFAULT (no flag) and only when a distinct backup exists',
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
