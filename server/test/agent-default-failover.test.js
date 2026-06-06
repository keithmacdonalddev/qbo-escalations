'use strict';

// Coverage for the "automatic failover is the DEFAULT for every agent" change.
//
// Product intent (locked): every agent ALWAYS has a primary + a fallback and
// fails over automatically when the primary provider fails. There is no
// single-vs-fallback MODE that disables this, and the app does NOT reason about
// an agent's use case when choosing the backup (no capability filtering). The
// operator picks primary + fallback per agent; the app uses what is configured,
// defaulting to a neutral global alternate when nothing is set.
//
// These tests exercise the pieces that make that true everywhere:
//   - resolveAgentBackup (the shared, use-case-agnostic backup rule)
//   - resolveSequentialProviders / startChatOrchestration (engine always fails
//     over for a sequential policy; success path stays single-attempt; parallel
//     unaffected)
//   - parse-orchestrator (parse substrate mirrors the same default)
//   - normalizeAgentRuntimeState (persistence always carries a distinct backup
//     for ALL agents, including image-runtime agents)

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveAgentBackup } = require('../src/services/agent-failover');
const {
  startChatOrchestration,
  resolvePolicy,
} = require('../src/services/chat-orchestrator');
const { parseWithPolicy } = require('../src/services/parse-orchestrator');
const { normalizeAgentRuntimeState } = require('../src/services/agent-identity-service');
const { getAlternateProvider } = require('../src/services/providers/registry');
const { resetProviderHealth } = require('../src/services/provider-health');
const claude = require('../src/services/claude');
const codex = require('../src/services/codex');

const PRIMARY = 'claude';
const GLOBAL_ALTERNATE = getAlternateProvider(PRIMARY); // 'codex'
const CUSTOM_BACKUP = 'gpt-5.4'; // distinct id, also codex transport

function runOrchestration(options) {
  return new Promise((resolve) => {
    const events = [];
    startChatOrchestration({
      messages: [{ role: 'user', content: 'hi' }],
      systemPrompt: '',
      images: [],
      ...options,
      onChunk: (data) => events.push({ type: 'chunk', data }),
      onProviderError: (data) => events.push({ type: 'provider_error', data }),
      onFallback: (data) => events.push({ type: 'fallback', data }),
      onDone: (data) => resolve({ result: 'done', data, events }),
      onError: (data) => resolve({ result: 'error', data, events }),
    });
  });
}

test('agent-default-failover suite', async (t) => {
  let originalClaudeChat;
  let originalCodexChat;
  let originalClaudeParse;
  let originalCodexParse;

  t.before(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.FEATURE_CHAT_PROVIDER_PARITY;
    delete process.env.FEATURE_CHAT_FALLBACK_MODE;
    originalClaudeChat = claude.chat;
    originalCodexChat = codex.chat;
    originalClaudeParse = claude.parseEscalation;
    originalCodexParse = codex.parseEscalation;
  });

  t.after(() => {
    claude.chat = originalClaudeChat;
    codex.chat = originalCodexChat;
    claude.parseEscalation = originalClaudeParse;
    codex.parseEscalation = originalCodexParse;
    resetProviderHealth();
  });

  t.beforeEach(() => {
    resetProviderHealth();
  });

  // --- Shared helper: the use-case-agnostic backup rule --------------------

  await t.test('resolveAgentBackup uses the global alternate when no runtime is set', () => {
    const backup = resolveAgentBackup(PRIMARY, null);
    assert.equal(backup.provider, GLOBAL_ALTERNATE);
    assert.equal(backup.model, '');
    assert.equal(backup.fromProfile, false);
  });

  await t.test('resolveAgentBackup honors a configured distinct backup + model (no capability logic)', () => {
    const backup = resolveAgentBackup(PRIMARY, {
      fallbackProvider: CUSTOM_BACKUP,
      fallbackModel: 'gpt-5.4-some-model',
      configured: true,
    });
    assert.equal(backup.provider, CUSTOM_BACKUP);
    assert.equal(backup.model, 'gpt-5.4-some-model');
    assert.equal(backup.fromProfile, true);
  });

  await t.test('resolveAgentBackup re-derives a distinct alternate when the configured backup == primary', () => {
    const backup = resolveAgentBackup(PRIMARY, { fallbackProvider: PRIMARY, configured: true });
    assert.equal(backup.provider, GLOBAL_ALTERNATE);
    assert.equal(backup.model, '', 're-derived alternate carries no operator model');
    assert.equal(backup.fromProfile, false);
  });

  await t.test('resolveAgentBackup treats configured:false as "no operator selection"', () => {
    const backup = resolveAgentBackup(PRIMARY, { fallbackProvider: CUSTOM_BACKUP, configured: false });
    assert.equal(backup.provider, GLOBAL_ALTERNATE);
    assert.equal(backup.fromProfile, false);
  });

  // --- Engine: a generic leg fails over with NO per-agent flag -------------

  await t.test('a generic chat-substrate leg fails over to its backup WITHOUT any flag (single mode)', async () => {
    claude.chat = ({ onError }) => { const e = new Error('down'); e.code = 'PROVIDER_EXEC_FAILED'; onError(e); return () => {}; };
    let backupRan = false;
    codex.chat = ({ onChunk, onDone }) => { backupRan = true; onChunk('backup-answer'); onDone('backup-answer'); return () => {}; };

    const res = await runOrchestration({
      mode: 'single',
      primaryProvider: PRIMARY,
      fallbackProvider: GLOBAL_ALTERNATE,
    });

    assert.equal(res.result, 'done');
    assert.equal(res.data.providerUsed, GLOBAL_ALTERNATE);
    assert.equal(res.data.fallbackUsed, true);
    assert.equal(backupRan, true);
  });

  await t.test('a profile-configured backup is the provider failed over to', async () => {
    claude.chat = ({ onError }) => { const e = new Error('down'); e.code = 'PROVIDER_EXEC_FAILED'; onError(e); return () => {}; };
    codex.chat = ({ onChunk, onDone }) => { onChunk('custom-backup'); onDone('custom-backup'); return () => {}; };

    // Resolve the backup the way a leg would (from a profile selection), then run.
    const backup = resolveAgentBackup(PRIMARY, { fallbackProvider: CUSTOM_BACKUP, configured: true });
    const res = await runOrchestration({
      mode: 'single',
      primaryProvider: PRIMARY,
      fallbackProvider: backup.provider,
      fallbackModel: backup.model,
    });

    assert.equal(res.result, 'done');
    // gpt-5.4 != the global alternate (codex), proving the configured backup won.
    assert.equal(res.data.providerUsed, CUSTOM_BACKUP);
    assert.equal(res.data.fallbackUsed, true);
  });

  await t.test('the success path runs ONLY the primary (backup never invoked)', async () => {
    claude.chat = ({ onChunk, onDone }) => { onChunk('primary-ok'); onDone('primary-ok'); return () => {}; };
    let backupRan = false;
    codex.chat = ({ onChunk, onDone }) => { backupRan = true; onChunk('backup'); onDone('backup'); return () => {}; };

    const res = await runOrchestration({
      mode: 'single',
      primaryProvider: PRIMARY,
      fallbackProvider: GLOBAL_ALTERNATE,
    });

    assert.equal(res.result, 'done');
    assert.equal(res.data.providerUsed, PRIMARY);
    assert.equal(res.data.fallbackUsed, false);
    assert.equal(backupRan, false);
  });

  await t.test('parallel mode is unaffected (both providers run; no sequential failover)', async () => {
    let claudeRan = false;
    let codexRan = false;
    claude.chat = ({ onChunk, onDone }) => { claudeRan = true; onChunk('c'); onDone('c'); return () => {}; };
    codex.chat = ({ onChunk, onDone }) => { codexRan = true; onChunk('x'); onDone('x'); return () => {}; };

    const res = await runOrchestration({
      mode: 'parallel',
      primaryProvider: PRIMARY,
      parallelProviders: [PRIMARY, GLOBAL_ALTERNATE],
    });

    assert.equal(res.result, 'done');
    assert.equal(res.data.providerUsed, 'parallel');
    assert.equal(claudeRan, true);
    assert.equal(codexRan, true);
  });

  // --- resolvePolicy always yields a distinct backup -----------------------

  await t.test('resolvePolicy yields a distinct backup even for single mode with no fallback', () => {
    const policy = resolvePolicy({ mode: 'single', primaryProvider: PRIMARY });
    assert.notEqual(policy.fallbackProvider, policy.primaryProvider);
    assert.equal(policy.fallbackProvider, GLOBAL_ALTERNATE);
  });

  // --- getAlternateProvider NEVER returns its own input --------------------
  // Failover is always on, so the alternate must always be DISTINCT from the
  // primary; otherwise the backup silently collapses to the primary and
  // failover is disabled for that agent. This is the latent foot-gun hardened
  // in catalog.getAlternateProvider.

  await t.test('getAlternateProvider returns a distinct provider for every catalog id', () => {
    const { getProviderIds } = require('../src/services/providers/registry');
    for (const id of getProviderIds()) {
      const alternate = getAlternateProvider(id);
      assert.notEqual(alternate, id, `getAlternateProvider("${id}") must not return its own input`);
    }
  });

  await t.test('getAlternateProvider stays distinct when the catalog default is flipped onto a non-claude provider', () => {
    // The catalog is frozen at module load, so to exercise the degenerate case
    // (an operator sets "default": true on a non-claude provider) we inject a
    // mutated catalog into the require cache and load a FRESH copy of catalog.js,
    // then restore the cache so the rest of the suite uses the real catalog.
    const catalogModulePath = require.resolve('../src/services/providers/catalog');
    const catalogJsonPath = require.resolve('../../shared/ai-provider-catalog.json');

    const realJson = require(catalogJsonPath);
    // Move "default": true from the claude entry onto a non-claude provider
    // (codex). With the old code, getAlternateProvider('codex') -> DEFAULT (now
    // 'codex') == its own input. The hardened code must pick a different family.
    const flippedJson = realJson.map((entry) => {
      if (entry.id === 'claude') return { ...entry, default: false };
      if (entry.id === 'codex') return { ...entry, default: true };
      return entry;
    });
    assert.equal(flippedJson.find((e) => e.default).id, 'codex', 'precondition: codex is now the catalog default');

    const realJsonCacheEntry = require.cache[catalogJsonPath];
    const realCatalogCacheEntry = require.cache[catalogModulePath];
    try {
      require.cache[catalogJsonPath] = { id: catalogJsonPath, filename: catalogJsonPath, loaded: true, exports: flippedJson };
      delete require.cache[catalogModulePath];
      const freshCatalog = require(catalogModulePath);

      assert.equal(freshCatalog.DEFAULT_PROVIDER_ID, 'codex', 'fresh catalog picked up the flipped default');
      // The critical assertion: the alternate for the (now-default) codex
      // provider must NOT be codex itself.
      const alternate = freshCatalog.getAlternateProvider('codex');
      assert.notEqual(alternate, 'codex', 'alternate must stay distinct from the flipped default');
      assert.equal(freshCatalog.getProviderFamily(alternate) !== 'codex', true, 'alternate is a different provider family');
      // Every id must still resolve to a distinct alternate under the flipped catalog.
      for (const id of freshCatalog.PROVIDER_IDS) {
        assert.notEqual(freshCatalog.getAlternateProvider(id), id, `flipped catalog: getAlternateProvider("${id}") must not return its input`);
      }
    } finally {
      if (realJsonCacheEntry) require.cache[catalogJsonPath] = realJsonCacheEntry;
      else delete require.cache[catalogJsonPath];
      if (realCatalogCacheEntry) require.cache[catalogModulePath] = realCatalogCacheEntry;
      else delete require.cache[catalogModulePath];
    }
  });

  // --- Parse substrate mirrors the default ---------------------------------

  // A field set + source text that pass the real escalation validator.
  const VALID_FIELDS = {
    coid: '123456789', mid: '987654321', caseNumber: 'CASE-001',
    clientContact: 'Jane Doe', agentName: 'Agent Smith',
    attemptingTo: 'Run payroll for the latest pay period',
    expectedOutcome: 'Payroll processes and taxes calculate correctly',
    actualOutcome: 'Payroll tax calculation is wrong for the latest run',
    kbToolsUsed: 'Checked KB article 12345', tsSteps: 'Verified account settings, recalculated',
    triedTestAccount: 'Yes', category: 'payroll',
  };
  const VALID_SOURCE = 'COID 123456789 MID 987654321 CASE-001 Jane Doe Agent Smith attempting to run payroll, '
    + 'expected taxes correct, actual tax calculation wrong, checked KB 12345, verified settings, tried test account yes, payroll';

  await t.test('parse substrate fails over to a distinct backup by default (no mode flag)', async () => {
    // Single mode must STILL attempt the distinct backup when the primary fails
    // (no per-agent flag). The backup returns a validating parse, so the result
    // is a successful failover.
    let backupParserRan = false;
    claude.parseEscalation = async () => { const e = new Error('parser down'); e.code = 'PARSE_PROVIDER_FAILED'; throw e; };
    codex.parseEscalation = async () => { backupParserRan = true; return ({ fields: VALID_FIELDS, usage: null }); };

    const out = await parseWithPolicy({
      text: VALID_SOURCE,
      mode: 'single', // single mode must still fail over to the distinct backup
      primaryProvider: PRIMARY,
      fallbackProvider: GLOBAL_ALTERNATE,
      minScore: 0,
      allowRegexFallback: false,
    });

    assert.equal(backupParserRan, true, 'backup parser must be attempted on primary failure (single mode)');
    assert.equal(out.meta.providerUsed, GLOBAL_ALTERNATE);
    assert.equal(out.meta.fallbackUsed, true);
    assert.equal(out.meta.fallbackFrom, PRIMARY);
  });

  await t.test('parse substrate success path runs ONLY the primary parser', async () => {
    let backupParserRan = false;
    claude.parseEscalation = async () => ({ fields: VALID_FIELDS, usage: null });
    codex.parseEscalation = async () => { backupParserRan = true; return ({ fields: VALID_FIELDS, usage: null }); };

    const out = await parseWithPolicy({
      text: VALID_SOURCE,
      mode: 'single',
      primaryProvider: PRIMARY,
      fallbackProvider: GLOBAL_ALTERNATE,
      minScore: 0,
      allowRegexFallback: false,
    });

    assert.equal(out.meta.providerUsed, PRIMARY);
    assert.equal(out.meta.fallbackUsed, false);
    assert.equal(backupParserRan, false, 'backup parser must not run when the primary succeeds');
  });

  // --- Persistence: every agent always persists a distinct backup ----------

  await t.test('normalizeAgentRuntimeState persists the global alternate when no backup is configured', () => {
    const runtime = normalizeAgentRuntimeState('chat', { provider: PRIMARY, configured: true });
    assert.equal(runtime.provider, PRIMARY);
    assert.equal(runtime.fallbackProvider, GLOBAL_ALTERNATE);
    assert.notEqual(runtime.fallbackProvider, runtime.provider);
  });

  await t.test('normalizeAgentRuntimeState persists a custom backup + model in ANY mode (single included)', () => {
    const runtime = normalizeAgentRuntimeState('chat', {
      provider: PRIMARY,
      mode: 'single', // single mode no longer discards the custom backup
      fallbackProvider: CUSTOM_BACKUP,
      fallbackModel: 'gpt-5.4-some-model',
      configured: true,
    });
    assert.equal(runtime.fallbackProvider, CUSTOM_BACKUP);
    assert.equal(runtime.fallbackModel, 'gpt-5.4-some-model');
  });

  await t.test('normalizeAgentRuntimeState gives image-runtime agents a distinct backup too', () => {
    // image-analyst is an image-runtime agent. Previously its fallback was forced
    // empty; now automatic failover applies to it like every other agent.
    const runtime = normalizeAgentRuntimeState('image-analyst', { provider: PRIMARY, configured: true });
    assert.equal(runtime.fallbackProvider, GLOBAL_ALTERNATE);
    assert.notEqual(runtime.fallbackProvider, runtime.provider);
  });

  await t.test('normalizeAgentRuntimeState re-derives a distinct backup when the configured backup == primary', () => {
    const runtime = normalizeAgentRuntimeState('chat', {
      provider: PRIMARY,
      mode: 'fallback',
      fallbackProvider: PRIMARY, // degenerate
      configured: true,
    });
    assert.equal(runtime.fallbackProvider, GLOBAL_ALTERNATE);
    assert.equal(runtime.fallbackModel, '', 're-derived alternate carries no operator model');
  });
});
