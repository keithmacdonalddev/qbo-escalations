'use strict';

// Wave 2 universal-failover coverage for TRIAGE.
//
// Product intent (locked): every agent ALWAYS has a primary + a fallback and
// fails over automatically when the primary provider fails — including Triage.
// The app does NOT reason about an agent's use case when choosing the backup
// (NO capability filtering). The operator picks primary + fallback in the agent
// profile; the engine uses what is configured, defaulting to a neutral global
// alternate when nothing is set.
//
// These tests drive the REAL runTriage failover path using the injection seams
// it already exposes (preflightProvider / runDirectTriageProviderCall /
// waitForProviderPackage). The primary provider attempt fails; the engine must
// attempt the configured backup BEFORE the deterministic rule-card fallback.
// The capture pipeline keys off the providerTrace returned by EACH attempt, so
// the backup produces and reads back its OWN ProviderCallPackage.

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const mongo = require('./_mongo-helper');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const TriageResult = require('../src/models/TriageResult');
const { runTriage } = require('../src/services/triage');
const { getAlternateProvider } = require('../src/services/providers/registry');

const PARSER_TEXT = [
  'COID/MID: 12345 / 67890',
  'CASE: CS-2026-002099',
  'CLIENT/CONTACT: Failover Client',
  'CX IS ATTEMPTING TO: connect a bank account',
  'EXPECTED OUTCOME: bank feed connects',
  'ACTUAL OUTCOME: bank feed connection error appears',
  'KB/TOOLS USED: Help panel',
  'TRIED TEST ACCOUNT: yes',
  'TS STEPS: cleared cache and retried in incognito',
].join('\n');

const TRIAGE_OUTPUT = [
  'Category: bank feeds',
  'Severity: P3',
  'Fast read: Bank feed connection is failing after basic browser troubleshooting.',
  'Immediate next step: Capture the bank name and exact connector error, then retry once in incognito.',
  'Missing info: bank name; exact connector error',
  'Confidence: High',
  'Category check: Bank feeds because the failure is in the bank connection workflow.',
].join('\n');

// Build a minimal ProviderCallPackage whose readback yields TRIAGE_OUTPUT,
// shaped to the given provider's extraction path (see
// extractTriageTextFromProviderPackage). Each attempt produces its OWN package,
// so the backup gets a package matching ITS provider id — this is exactly the
// capture-pipeline behavior the failover relies on.
async function insertTriagePackage(packageId, providerId) {
  const openAiLikeChoices = { choices: [{ message: { role: 'assistant', content: TRIAGE_OUTPUT } }] };
  const base = {
    _id: packageId,
    providerId,
    outcome: 'success',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
  };
  let doc;
  if (providerId === 'lm-studio') {
    doc = {
      ...base,
      providerResearchId: 'lm-studio-openai-compatible',
      providerPathType: 'lm-studio-http-nonstream',
      lmStudio: { response: { parsedJson: openAiLikeChoices } },
    };
  } else if (providerId === 'llm-gateway') {
    doc = {
      ...base,
      providerPathType: 'gateway-http',
      llmGateway: { response: { parsedJson: openAiLikeChoices } },
    };
  } else {
    // openai / kimi read the top-level `response.parsedJson` (OpenAI-compatible).
    doc = {
      ...base,
      providerResearchId: `${providerId}-api`,
      providerPathType: 'direct-http',
      response: { parsedJson: openAiLikeChoices },
    };
  }
  await ProviderCallPackage.collection.insertOne(doc);
}

test.before(async () => {
  process.env.NODE_ENV = 'test';
  await mongo.connect();
});

test.after(async () => {
  await mongo.disconnect();
});

test.beforeEach(async () => {
  await ProviderCallPackage.deleteMany({});
  await TriageResult.deleteMany({});
});

test('triage fails over to the configured backup when the primary provider fails', async () => {
  const PRIMARY = 'lm-studio';
  const BACKUP = 'openai'; // a distinct, supported DIRECT_TRIAGE_PROVIDER
  const backupPackageId = new mongoose.Types.ObjectId();

  const calledProviders = [];
  let preflightProviders = [];

  const result = await runTriage(PARSER_TEXT, {
    runId: 'triage-failover-backup-attempted',
    provider: PRIMARY,
    model: 'local-triage-model',
    // The operator's configured backup (as it would arrive from the profile /
    // request body). This is honored as-is — no capability filtering.
    fallbackProvider: BACKUP,
    fallbackModel: 'gpt-5.4-mini',
    // Both the primary AND the backup are reachable; only the provider CALL for
    // the primary fails, forcing a failover (not a preflight degrade).
    preflightProvider: async ({ provider }) => {
      preflightProviders.push(provider);
      return { ok: true, code: 'OK', reason: 'stub reachable' };
    },
    runDirectTriageProviderCall: async ({ provider, model }) => {
      calledProviders.push(provider);
      if (provider === PRIMARY) {
        const err = new Error('primary lm-studio exploded');
        err.code = 'TRIAGE_PROVIDER_FAILED';
        throw err;
      }
      // Backup attempt: produce and "capture" its OWN package.
      await insertTriagePackage(backupPackageId, provider);
      return {
        providerTrace: {
          providerId: provider,
          providerPackageId: String(backupPackageId),
          model,
          captureEnabled: true,
        },
        fullResponse: '',
      };
    },
  });

  // The primary was attempted first, then the backup.
  assert.deepEqual(calledProviders, [PRIMARY, BACKUP], 'primary then backup must be attempted in order');
  // Backup also cleared its own pre-flight before hand-off.
  assert.ok(preflightProviders.includes(BACKUP), 'backup must pass its own pre-flight before hand-off');

  // The backup produced a real, validated triage card (NOT the deterministic
  // rule-card fallback).
  assert.equal(result.ok, true);
  assert.equal(result.status, 'success');
  assert.equal(result.triageMeta.source, 'agent', 'result came from a provider, not the rule card');
  assert.equal(result.triageMeta.providerPackageId, String(backupPackageId));
  assert.equal(result.card.category, 'bank-feeds');
  assert.equal(result.card.severity, 'P3');

  // The result reports the failover honestly.
  assert.equal(result.providerUsed, BACKUP, 'providerUsed is the backup that succeeded');
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.fallbackFrom, PRIMARY);

  // Persistence reflects the backup provider + its package.
  const saved = await TriageResult.findOne({ runId: 'triage-failover-backup-attempted' }).lean();
  assert.ok(saved);
  assert.equal(saved.provider, BACKUP);
  assert.equal(saved.providerPackageId, String(backupPackageId));
  assert.equal(saved.fallbackUsed, false, 'fallbackUsed on TriageResult marks the rule card, which was NOT used here');
  assert.equal(saved.status, 'success');
});

test('triage attempts the neutral global alternate as backup when none is configured (failover always on)', async () => {
  // No fallbackProvider / no agentRuntime: the engine must STILL attempt a
  // distinct backup — the neutral global alternate — proving failover is always
  // on even without an operator selection. (We make the neutral backup also fail
  // so the assertion is provider-shape-agnostic: what matters is that the neutral
  // alternate was ATTEMPTED as the backup before the rule card.)
  const PRIMARY = 'claude';
  const NEUTRAL = getAlternateProvider(PRIMARY); // distinct from claude
  assert.notEqual(NEUTRAL, PRIMARY, 'precondition: neutral alternate is distinct from the primary');
  const calledProviders = [];

  const result = await runTriage(PARSER_TEXT, {
    runId: 'triage-failover-neutral-default',
    provider: PRIMARY,
    model: 'claude-opus-4-8',
    // An agent profile runtime IS present (failover intent) but the operator
    // configured NO explicit fallback — the engine must default the backup to
    // the neutral global alternate. The routes always pass this runtime, so this
    // is the real-world "no fallback picked" case.
    agentRuntime: { provider: PRIMARY, configured: true },
    preflightProvider: async () => ({ ok: true, code: 'OK', reason: 'stub reachable' }),
    runDirectTriageProviderCall: async ({ provider }) => {
      calledProviders.push(provider);
      const err = new Error(`${provider} exploded`);
      err.code = 'TRIAGE_PROVIDER_FAILED';
      throw err;
    },
  });

  assert.equal(calledProviders[0], PRIMARY);
  assert.equal(calledProviders[1], NEUTRAL, 'backup defaults to the neutral global alternate when unset');
  // Both failed here, so the final resort (rule card) is used — that part is
  // covered elsewhere; this test only asserts the neutral backup was attempted.
  assert.equal(result.status, 'degraded');
  assert.equal(result.triageMeta.source, 'fallback');
});

test('triage falls back to the deterministic rule card when BOTH primary and backup fail', async () => {
  const PRIMARY = 'lm-studio';
  const BACKUP = 'openai';
  const calledProviders = [];

  const result = await runTriage(PARSER_TEXT, {
    runId: 'triage-failover-both-fail-rule-card',
    provider: PRIMARY,
    model: 'local-triage-model',
    fallbackProvider: BACKUP,
    preflightProvider: async () => ({ ok: true, code: 'OK', reason: 'stub reachable' }),
    runDirectTriageProviderCall: async ({ provider }) => {
      calledProviders.push(provider);
      const err = new Error(`${provider} exploded`);
      err.code = 'TRIAGE_PROVIDER_FAILED';
      throw err;
    },
  });

  // Both providers were attempted before the rule card.
  assert.deepEqual(calledProviders, [PRIMARY, BACKUP], 'both primary and backup must be attempted');

  // The deterministic rule-card fallback is the FINAL resort and is preserved.
  assert.equal(result.ok, true, 'runTriage never throws; it degrades to the rule card');
  assert.equal(result.status, 'degraded');
  assert.equal(result.triageMeta.source, 'fallback', 'final result is the deterministic rule card');

  const saved = await TriageResult.findOne({ runId: 'triage-failover-both-fail-rule-card' }).lean();
  assert.ok(saved);
  assert.equal(saved.status, 'degraded');
  assert.equal(saved.fallbackUsed, true, 'the rule card marks fallbackUsed on the TriageResult');
});

test('triage does NOT attempt a backup for a bare caller with no failover intent', async () => {
  // A bare engine caller (no fallbackProvider, no agentRuntime) keeps the
  // original behavior: the primary failure flows straight to the rule card with
  // no second provider attempt. Production triage flows go through the routes,
  // which always pass the agent profile runtime, so failover stays always-on.
  const PRIMARY = 'lm-studio';
  const calledProviders = [];

  const result = await runTriage(PARSER_TEXT, {
    runId: 'triage-failover-no-intent',
    provider: PRIMARY,
    model: 'local-triage-model',
    preflightProvider: async () => ({ ok: true, code: 'OK', reason: 'stub reachable' }),
    runDirectTriageProviderCall: async ({ provider }) => {
      calledProviders.push(provider);
      const err = new Error('primary exploded');
      err.code = 'TRIAGE_PROVIDER_FAILED';
      throw err;
    },
  });

  assert.deepEqual(calledProviders, [PRIMARY], 'only the primary is attempted — no failover intent');
  assert.equal(result.status, 'degraded');
  assert.equal(result.triageMeta.source, 'fallback');
});

test('chat-v5 wiring: agentRuntime alone (profile fallback, no explicit request fallback) enables failover to the CONFIGURED backup', async () => {
  // Regression guard for the SHIP-BLOCKING wiring gap: chat-v5 triage now sends
  // the triage agent profile runtime as a FLAT agentRuntime object carrying the
  // operator's configured fallbackProvider/fallbackModel (no top-level explicit
  // fallbackProvider on the request). This mirrors EXACTLY the options the
  // /api/triage route builds from that client body. The gate must turn on from
  // agentRuntime alone, and resolveAgentBackup must source the backup from the
  // runtime's configured fallbackProvider — NOT the neutral global alternate.
  const PRIMARY = 'lm-studio';
  const CONFIGURED_BACKUP = 'openai'; // operator-picked in the profile, distinct + supported
  const NEUTRAL = getAlternateProvider(PRIMARY);
  assert.notEqual(CONFIGURED_BACKUP, NEUTRAL, 'precondition: configured backup differs from the neutral alternate, so we can prove the PROFILE choice (not the default) was honored');
  const backupPackageId = new mongoose.Types.ObjectId();
  const calledProviders = [];

  const result = await runTriage(PARSER_TEXT, {
    runId: 'triage-chatv5-agentruntime-configured-backup',
    provider: PRIMARY,
    model: 'local-triage-model',
    // No explicit request-body fallbackProvider/fallbackModel — exactly the
    // chat-v5 profile path where the backup lives INSIDE agentRuntime.
    agentRuntime: {
      provider: PRIMARY,
      fallbackProvider: CONFIGURED_BACKUP,
      fallbackModel: 'gpt-5.4-mini',
      configured: true,
    },
    preflightProvider: async () => ({ ok: true, code: 'OK', reason: 'stub reachable' }),
    runDirectTriageProviderCall: async ({ provider, model }) => {
      calledProviders.push(provider);
      if (provider === PRIMARY) {
        const err = new Error('primary lm-studio exploded');
        err.code = 'TRIAGE_PROVIDER_FAILED';
        throw err;
      }
      await insertTriagePackage(backupPackageId, provider);
      return {
        providerTrace: {
          providerId: provider,
          providerPackageId: String(backupPackageId),
          model,
          captureEnabled: true,
        },
        fullResponse: '',
      };
    },
  });

  // Failover turned on from agentRuntime alone, and the backup is the operator's
  // CONFIGURED choice — not the neutral alternate.
  assert.deepEqual(calledProviders, [PRIMARY, CONFIGURED_BACKUP], 'primary then the PROFILE-configured backup must be attempted in order');
  assert.equal(result.ok, true);
  assert.equal(result.status, 'success');
  assert.equal(result.triageMeta.source, 'agent', 'a provider produced the card, not the rule fallback');
  assert.equal(result.providerUsed, CONFIGURED_BACKUP);
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.fallbackFrom, PRIMARY);
});

test('rule-card provenance records the primary (and backup) that failed, not just the active attempt', async () => {
  // P3: when BOTH the primary and the configured backup fail, the deterministic
  // rule card must attribute the failure to BOTH in order — the primary first.
  // Previously `provider` was reassigned to the backup before the rule card was
  // built, so the card blamed the backup alone.
  const PRIMARY = 'lm-studio';
  const BACKUP = 'openai';
  const calledProviders = [];

  const result = await runTriage(PARSER_TEXT, {
    runId: 'triage-failover-attempted-provenance',
    provider: PRIMARY,
    model: 'local-triage-model',
    fallbackProvider: BACKUP,
    fallbackModel: 'gpt-5.4-mini',
    preflightProvider: async () => ({ ok: true, code: 'OK', reason: 'stub reachable' }),
    runDirectTriageProviderCall: async ({ provider }) => {
      calledProviders.push(provider);
      const err = new Error(`${provider} exploded`);
      err.code = 'TRIAGE_PROVIDER_FAILED';
      throw err;
    },
  });

  assert.deepEqual(calledProviders, [PRIMARY, BACKUP]);
  assert.equal(result.status, 'degraded');
  assert.equal(result.triageMeta.source, 'fallback');
  // Ordered provenance: primary first, then the backup that also failed.
  assert.ok(Array.isArray(result.triageMeta.attempted), 'triageMeta.attempted is populated on a rule-card fallback');
  assert.equal(result.triageMeta.attempted.length, 2);
  assert.equal(result.triageMeta.attempted[0].provider, PRIMARY);
  assert.equal(result.triageMeta.attempted[0].role, 'primary');
  assert.equal(result.triageMeta.attempted[1].provider, BACKUP);
  assert.equal(result.triageMeta.attempted[1].role, 'backup');
});

test('triage does NOT fail over (rule card only) when the backup collapses to the primary', async () => {
  // A degenerate configured backup equal to the primary is not usable; there is
  // nothing distinct to fail over to, so the original failure flows straight to
  // the rule card without a second provider attempt.
  const PRIMARY = 'lm-studio';
  const calledProviders = [];

  const result = await runTriage(PARSER_TEXT, {
    runId: 'triage-failover-degenerate-backup',
    provider: PRIMARY,
    model: 'local-triage-model',
    // Explicit request backup == primary. resolveAgentBackup would re-derive a
    // distinct alternate from the PROFILE path, but an explicit request-body
    // fallbackProvider that equals the primary is treated as "no distinct backup"
    // by the engine guard (backupProvider === primaryProvider).
    fallbackProvider: PRIMARY,
    preflightProvider: async () => ({ ok: true, code: 'OK', reason: 'stub reachable' }),
    runDirectTriageProviderCall: async ({ provider }) => {
      calledProviders.push(provider);
      const err = new Error('primary exploded');
      err.code = 'TRIAGE_PROVIDER_FAILED';
      throw err;
    },
  });

  assert.deepEqual(calledProviders, [PRIMARY], 'only the primary is attempted; no distinct backup to try');
  assert.equal(result.status, 'degraded');
  assert.equal(result.triageMeta.source, 'fallback');
});
