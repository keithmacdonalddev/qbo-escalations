'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const AgentIdentity = require('../src/models/AgentIdentity');
const {
  clearProviderStubs,
  registerProviderStub,
} = require('../src/lib/harness-provider-gate');
const {
  clearProviderAvailabilityCache,
} = require('../src/services/image-parser');

// All non-CLI providers that the shared availability probe walks. We stub
// every one so the health refresh never touches the network. Stubs return
// deterministic, vague upstream reasons so we can verify the health service
// sharpens them into specific diagnostics.
const REMOTE_PROVIDERS = ['anthropic', 'openai', 'kimi', 'gemini', 'llm-gateway'];

function withHarnessProviders(fn) {
  const prior = process.env.HARNESS_PROVIDERS_STUBBED;
  process.env.HARNESS_PROVIDERS_STUBBED = '1';
  clearProviderAvailabilityCache();
  clearProviderStubs();
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      clearProviderAvailabilityCache();
      clearProviderStubs();
      if (prior === undefined) {
        delete process.env.HARNESS_PROVIDERS_STUBBED;
      } else {
        process.env.HARNESS_PROVIDERS_STUBBED = prior;
      }
    });
}

// Register an LM Studio availability stub and per-provider validation
// stubs that report unavailable with a vague upstream reason. The health
// service should rewrite these reasons into specific diagnostics that
// name the provider, label, or host.
function stubAllProvidersOffline({ probeSpy } = {}) {
  registerProviderStub('lm-studio', 'providerAvailability', async () => {
    if (probeSpy) probeSpy('lm-studio');
    return {
      available: false,
      model: null,
      reason: '', // intentionally empty to test the sharpener's empty-string path
    };
  });
  for (const provider of REMOTE_PROVIDERS) {
    registerProviderStub(provider, 'validateRemoteProvider', async () => {
      if (probeSpy) probeSpy(provider);
      return {
        ok: false,
        configured: true,
        available: false,
        code: 'PROVIDER_TEST_FAILED',
        reason: 'Connection failed', // vague upstream — must be sharpened
        detail: '',
        model: null,
      };
    });
  }
}

// Point every non-CLI agent at a known remote provider so the shared
// availability map is exercised. We patch the agents one by one through
// the public API to mirror the user-facing flow. These are the agentIds
// from DEFAULT_PROFILES (server/src/services/room-agents/agent-profiles.js).
async function configureAgentsToRemoteProvider(app, provider) {
  const ids = [
    'chat',
    'triage-agent',
    'known-issue-search-agent',
    'workspace',
    'copilot',
  ];
  for (const agentId of ids) {
    await request(app)
      .patch(`/api/agent-identities/${agentId}/runtime`)
      .send({
        runtime: {
          provider,
          mode: 'single',
          fallbackProvider: '',
          model: '',
          fallbackModel: '',
          reasoningEffort: 'medium',
        },
        summary: 'Health test fixture',
      })
      .expect(200);
  }
}

test('GET /api/agent-identities/health includes a per-agent checkedAt ISO timestamp', async (t) => {
  await connect();
  const app = createApp();
  await AgentIdentity.deleteMany({});

  t.after(async () => {
    await AgentIdentity.deleteMany({});
    await disconnect();
  });

  await withHarnessProviders(async () => {
    stubAllProvidersOffline();
    await configureAgentsToRemoteProvider(app, 'anthropic');

    const res = await request(app)
      .get('/api/agent-identities/health?forceRefresh=true')
      .expect(200);

    assert.equal(res.body.ok, true);
    assert.ok(res.body.checkedAt, 'root checkedAt should still be present');
    assert.ok(res.body.agents && typeof res.body.agents === 'object', 'agents map should be present');

    const agentEntries = Object.values(res.body.agents);
    assert.ok(agentEntries.length > 0, 'should return at least one agent');

    for (const entry of agentEntries) {
      assert.ok(
        entry.checkedAt,
        `per-agent checkedAt missing on agent ${entry.agentId}`
      );
      // ISO 8601 timestamp parses to a finite number
      const parsed = Date.parse(entry.checkedAt);
      assert.ok(
        Number.isFinite(parsed),
        `per-agent checkedAt for ${entry.agentId} should parse as ISO date (got "${entry.checkedAt}")`
      );
    }
  });
});

test('GET /api/agent-identities/health returns a specific diagnostic for offline agents (not generic "offline")', async (t) => {
  await connect();
  const app = createApp();
  await AgentIdentity.deleteMany({});

  t.after(async () => {
    await AgentIdentity.deleteMany({});
    await disconnect();
  });

  await withHarnessProviders(async () => {
    stubAllProvidersOffline();
    await configureAgentsToRemoteProvider(app, 'anthropic');

    const res = await request(app)
      .get('/api/agent-identities/health?forceRefresh=true')
      .expect(200);

    assert.equal(res.body.ok, true);

    // Pick an agent we configured to anthropic. Its diagnostic must be
    // specific — name the provider label or its host — not just "offline".
    const triage = res.body.agents['triage-agent'];
    assert.ok(triage, 'triage-agent should be present in health response');
    assert.equal(triage.status, 'offline', 'triage agent should be offline under stubbed failure');

    const diagnostic = triage.diagnostic;
    assert.ok(diagnostic, 'offline agent diagnostic must not be empty');
    assert.notEqual(diagnostic.trim().toLowerCase(), 'offline', 'diagnostic must not be the bare word "offline"');
    assert.doesNotMatch(
      diagnostic,
      /^connection failed\.?$/i,
      'diagnostic must not pass through the vague upstream "Connection failed"'
    );

    // Sharpened diagnostic should mention the provider host or label so a
    // human can act on it. For anthropic the host hint is api.anthropic.com.
    assert.match(
      diagnostic,
      /api\.anthropic\.com|Anthropic/i,
      `expected sharpened diagnostic to name the provider host or label, got "${diagnostic}"`
    );
  });
});

test('GET /api/agent-identities/health with forceRefresh=true invalidates the cache and reprobes every call', async (t) => {
  await connect();
  const app = createApp();
  await AgentIdentity.deleteMany({});

  t.after(async () => {
    await AgentIdentity.deleteMany({});
    await disconnect();
  });

  await withHarnessProviders(async () => {
    const probeCalls = [];
    stubAllProvidersOffline({ probeSpy: (provider) => probeCalls.push(provider) });
    await configureAgentsToRemoteProvider(app, 'anthropic');

    // First force-refresh call.
    const first = await request(app)
      .get('/api/agent-identities/health?forceRefresh=true')
      .expect(200);
    assert.equal(first.body.ok, true);
    const anthropicCallsAfterFirst = probeCalls.filter((p) => p === 'anthropic').length;
    assert.ok(
      anthropicCallsAfterFirst >= 1,
      `expected anthropic probe to fire on first force-refresh, saw ${anthropicCallsAfterFirst}`
    );

    // Second force-refresh call should NOT reuse the cache from the first.
    const second = await request(app)
      .get('/api/agent-identities/health?forceRefresh=true')
      .expect(200);
    assert.equal(second.body.ok, true);
    const anthropicCallsAfterSecond = probeCalls.filter((p) => p === 'anthropic').length;
    assert.ok(
      anthropicCallsAfterSecond > anthropicCallsAfterFirst,
      `expected anthropic probe to fire again on second force-refresh, saw ${anthropicCallsAfterSecond} (was ${anthropicCallsAfterFirst})`
    );
  });
});

test('GET /api/agent-identities/health without forceRefresh may reuse the cache', async (t) => {
  await connect();
  const app = createApp();
  await AgentIdentity.deleteMany({});

  t.after(async () => {
    await AgentIdentity.deleteMany({});
    await disconnect();
  });

  await withHarnessProviders(async () => {
    const probeCalls = [];
    stubAllProvidersOffline({ probeSpy: (provider) => probeCalls.push(provider) });
    await configureAgentsToRemoteProvider(app, 'anthropic');

    // Prime the cache.
    await request(app).get('/api/agent-identities/health?forceRefresh=true').expect(200);
    const baseline = probeCalls.length;

    // A non-force call inside the TTL should NOT re-probe.
    await request(app).get('/api/agent-identities/health').expect(200);
    assert.equal(
      probeCalls.length,
      baseline,
      'non-force health calls within TTL should reuse cache (no new probe expected)'
    );
  });
});
