'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { normalizeApiError } = require('../src/lib/api-errors');
const providerCatalog = require('../../shared/ai-provider-catalog.json');
const modelCatalog = require('../../shared/ai-model-catalog.json');

const {
  assertProviderEnabled,
  assertProviderModelAllowed,
  getManagementSnapshot,
  refreshProviderModels,
  resetStateForTests,
  updateModelPolicy,
  updateProviderPolicy,
  updateSettings,
} = require('../src/services/ai-management');
const {
  isReviewedDiscoveryIgnore,
  mergeModel,
  reconcileModelPolicy,
} = require('../src/services/ai-management')._internal;
const { createApp } = require('../src/app');
const { evaluateProactiveAction } = require('../src/services/workspace-proactive');
const { getProvider } = require('../src/services/providers/registry');

test.beforeEach(() => {
  resetStateForTests();
});

test('curated providers and models start approved while strict enforcement starts in migration mode', () => {
  const snapshot = getManagementSnapshot();

  assert.equal(snapshot.enforceApprovedModels, false);
  assert.equal(snapshot.providers.length, 8);
  assert.equal(snapshot.summary.enabledProviders, 8);
  assert.ok(snapshot.summary.approvedModels > 0);

  for (const provider of snapshot.providers) {
    assert.equal(provider.enabled, true, `${provider.id} should start enabled`);
    assert.ok(provider.models.length > 0, `${provider.id} should have a curated model inventory`);
    assert.ok(
      provider.models.some((model) => model.id === provider.defaultModel),
      `${provider.id} should include its runtime default model`
    );
  }
});

test('provider defaults and CLI model presets cannot drift from the governed model inventory', () => {
  for (const provider of providerCatalog.filter((entry) => entry.selectable !== false)) {
    const models = modelCatalog.providers?.[provider.id]?.models || [];
    assert.ok(models.some((model) => model.id === provider.model), `${provider.id} default is missing from the model catalog`);
  }

  for (const preset of providerCatalog.filter((entry) => entry.selectable === false && entry.model)) {
    const models = modelCatalog.providers?.[preset.transport]?.models || [];
    assert.ok(models.some((model) => model.id === preset.model), `${preset.id} preset is missing from ${preset.transport}`);
  }
});

test('the governed catalog carries review provenance and current Gemini stable choices', () => {
  const snapshot = getManagementSnapshot();
  const gemini = snapshot.providers.find((provider) => provider.id === 'gemini');

  assert.ok(gemini.models.some((model) => model.id === 'gemini-3.6-flash'));
  assert.ok(gemini.models.some((model) => model.id === 'gemini-3.5-flash'));
  assert.ok(gemini.models.some((model) => model.id === 'gemini-3.5-flash-lite'));
  assert.equal(gemini.catalogReview.reviewedAt, '2026-07-21');
  assert.equal(gemini.catalogReview.expiresAfterDays, 14);
  assert.equal(gemini.catalogReview.requiresMaintainedCatalogRelease, true);
  assert.ok(gemini.catalogReview.officialSources.some((source) => source === 'https://ai.google.dev/gemini-api/docs/models'));
});

test('catalog refresh promotes newly curated discoveries and demotes superseded auto-approvals', () => {
  const newlyCurated = mergeModel(
    'gemini',
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', releaseChannel: 'stable' },
    {
      id: 'gemini-3.6-flash',
      label: 'Gemini 3.6 Flash from discovery',
      approval: 'candidate',
      enabled: false,
      validationStatus: 'not-run',
      source: 'provider-discovery',
      availability: 'available',
    }
  );
  assert.equal(newlyCurated.approval, 'approved');
  assert.equal(newlyCurated.enabled, true);
  assert.equal(newlyCurated.validationStatus, 'catalogued');
  assert.equal(newlyCurated.source, 'curated-catalog');
  assert.equal(newlyCurated.label, 'Gemini 3.6 Flash');

  assert.deepEqual(reconcileModelPolicy(null, {
    id: 'gemini-superseded-flash',
    approval: 'approved',
    enabled: true,
    validationStatus: 'catalogued',
    source: 'provider-discovery',
  }), {
    approval: 'candidate',
    enabled: false,
    validationStatus: 'not-run',
    source: 'provider-discovery',
  });

  assert.deepEqual(reconcileModelPolicy(null, {
    id: 'custom-validated-model',
    approval: 'approved',
    enabled: true,
    validationStatus: 'passed',
    validationEvidence: 'harness-run-123',
    source: 'provider-discovery',
  }), {});
});

test('reviewed discovery filters suppress known obsolete and non-agent surfaces without hiding future candidates', () => {
  assert.equal(isReviewedDiscoveryIgnore('gemini', 'gemini-3.1-flash-tts-preview'), true);
  assert.equal(isReviewedDiscoveryIgnore('gemini', 'gemini-2.5-flash'), true);
  assert.equal(isReviewedDiscoveryIgnore('gemini', 'gemini-3.5-flash'), false);
  assert.equal(isReviewedDiscoveryIgnore('gemini', 'gemini-3.7-flash'), false);
  assert.equal(isReviewedDiscoveryIgnore('openai', 'text-embedding-5-large'), true);
});

test('provider and approved-model switches are enforced at the server boundary', () => {
  updateProviderPolicy('openai', { enabled: false });
  assert.throws(
    () => assertProviderEnabled('openai'),
    (err) => err.code === 'AI_PROVIDER_DISABLED' && /AI Management/.test(err.message)
  );
  assert.throws(
    () => getProvider('openai'),
    (err) => err.code === 'AI_PROVIDER_DISABLED'
  );

  resetStateForTests();
  updateModelPolicy('openai', 'gpt-5.6-terra', { enabled: false });
  assert.throws(
    () => assertProviderModelAllowed('openai', 'gpt-5.6-terra'),
    (err) => err.code === 'AI_MODEL_DISABLED' && err.model === 'gpt-5.6-terra'
  );
});

test('policy failures keep their actionable message in API responses', () => {
  updateProviderPolicy('openai', { enabled: false });
  let policyError;
  try {
    assertProviderEnabled('openai');
  } catch (err) {
    policyError = err;
  }

  const normalized = normalizeApiError(policyError);
  assert.equal(normalized.status, 409);
  assert.equal(normalized.code, 'AI_PROVIDER_DISABLED');
  assert.match(normalized.message, /Settings > AI Management/);
});

test('model preset providers inherit the policy of their CLI transport', () => {
  updateProviderPolicy('codex', { enabled: false });

  assert.throws(
    () => assertProviderModelAllowed('gpt-5.6-sol'),
    (err) => err.code === 'AI_PROVIDER_DISABLED' && err.provider === 'codex'
  );
});

test('background proactive agents cannot bypass a disabled provider', async () => {
  updateProviderPolicy('claude', { enabled: false });

  await assert.rejects(
    evaluateProactiveAction({ context: 'A warning needs review.' }),
    (err) => err.code === 'AI_PROVIDER_DISABLED'
  );
});

test('migration mode preserves legacy custom assignments until strict approval is enabled', () => {
  updateModelPolicy('openai', 'gpt-future-candidate', {
    approval: 'candidate',
    enabled: false,
  });

  assert.equal(assertProviderModelAllowed('openai', 'gpt-future-candidate'), true);
  assert.equal(assertProviderModelAllowed('openai', 'legacy-custom-model'), true);

  updateSettings({ enforceApprovedModels: true });

  assert.throws(
    () => assertProviderModelAllowed('openai', 'gpt-future-candidate'),
    (err) => err.code === 'AI_MODEL_NOT_APPROVED'
  );
  assert.throws(
    () => assertProviderModelAllowed('openai', 'legacy-custom-model'),
    (err) => err.code === 'AI_MODEL_NOT_APPROVED'
  );
});

test('provider discovery adds new model IDs as disabled review candidates', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'discovery-test-key';
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/models');
    assert.equal(options.headers.Authorization, 'Bearer discovery-test-key');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: 'gpt-5.6-terra', created: 1780000000, owned_by: 'openai' },
          { id: 'gpt-future-candidate', created: 1780001000, owned_by: 'openai' },
          { id: 'text-embedding-future', created: 1780002000, owned_by: 'openai' },
        ],
      }),
    };
  };

  try {
    const result = await refreshProviderModels(['openai']);
    const provider = result.snapshot.providers.find((entry) => entry.id === 'openai');
    const candidate = provider.models.find((model) => model.id === 'gpt-future-candidate');

    assert.deepEqual(result.results.map((entry) => [entry.providerId, entry.ok, entry.found]), [['openai', true, 2]]);
    assert.equal(candidate.approval, 'candidate');
    assert.equal(candidate.enabled, false);
    assert.equal(candidate.validationStatus, 'not-run');
    assert.equal(provider.models.some((model) => model.id === 'text-embedding-future'), false);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test('Gemini discovery follows pagination and ignores non-agent model surfaces', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'gemini-discovery-test-key';
  const urls = [];
  global.fetch = async (url, options) => {
    urls.push(url);
    assert.equal(options.headers['x-goog-api-key'], 'gemini-discovery-test-key');
    if (urls.length === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            {
              name: 'models/gemini-3.6-flash',
              baseModelId: 'gemini-3.6-flash',
              displayName: 'Gemini 3.6 Flash',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-3.1-flash-tts-preview',
              baseModelId: 'gemini-3.1-flash-tts-preview',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-2.5-flash',
              baseModelId: 'gemini-2.5-flash',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
          nextPageToken: 'page two',
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          {
            name: 'models/gemini-future-agent',
            baseModelId: 'gemini-future-agent',
            displayName: 'Gemini Future Agent',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      }),
    };
  };

  try {
    const result = await refreshProviderModels(['gemini']);
    const provider = result.snapshot.providers.find((entry) => entry.id === 'gemini');
    const candidate = provider.models.find((model) => model.id === 'gemini-future-agent');

    assert.deepEqual(urls, [
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=page%20two',
    ]);
    assert.equal(result.results[0].ok, true);
    assert.equal(result.results[0].found, 2);
    assert.equal(result.results[0].ignoredCount, 2);
    assert.equal(result.results[0].candidates, 1);
    assert.equal(result.results[0].missingReviewed, 3);
    assert.equal(provider.discoveryStatus, 'attention');
    assert.equal(provider.discoverySummary.pages, 2);
    assert.equal(candidate.approval, 'candidate');
    assert.equal(candidate.enabled, false);
    assert.equal(provider.models.some((model) => model.id === 'gemini-3.1-flash-tts-preview'), false);
    assert.equal(provider.models.some((model) => model.id === 'gemini-2.5-flash'), false);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('a suspicious empty discovery fails closed and preserves prior successful evidence', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'discovery-test-key';
  let responseData = {
    data: [{ id: 'gpt-5.6-terra', created: 1780000000, owned_by: 'openai' }],
  };
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => responseData,
  });

  try {
    const first = await refreshProviderModels(['openai']);
    const firstProvider = first.snapshot.providers.find((entry) => entry.id === 'openai');
    const previousSuccessfulCheck = firstProvider.lastSuccessfulCheckAt;
    const previousSummary = firstProvider.discoverySummary;

    responseData = { data: [] };
    const second = await refreshProviderModels(['openai']);
    const secondProvider = second.snapshot.providers.find((entry) => entry.id === 'openai');

    assert.equal(second.results[0].ok, false);
    assert.equal(second.results[0].code, 'DISCOVERY_RESPONSE_EMPTY');
    assert.equal(secondProvider.discoveryStatus, 'failed');
    assert.equal(secondProvider.lastSuccessfulCheckAt, previousSuccessfulCheck);
    assert.deepEqual(secondProvider.discoverySummary, previousSummary);
    assert.ok(secondProvider.lastAttemptedAt);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test('models absent from a later complete account list are marked not seen instead of silently staying available', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'discovery-test-key';
  let responseData = {
    data: [
      { id: 'gpt-5.6-terra', owned_by: 'openai' },
      { id: 'gpt-future-candidate', owned_by: 'openai' },
    ],
  };
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => responseData,
  });

  try {
    await refreshProviderModels(['openai']);
    responseData = { data: [{ id: 'gpt-5.6-terra', owned_by: 'openai' }] };
    const result = await refreshProviderModels(['openai']);
    const provider = result.snapshot.providers.find((entry) => entry.id === 'openai');
    const candidate = provider.models.find((model) => model.id === 'gpt-future-candidate');

    assert.equal(candidate.availability, 'not-seen');
    assert.ok(candidate.missingSince);
    assert.equal(candidate.enabled, false);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test('an operator-managed model needs a passed validation record and evidence before approval', () => {
  updateModelPolicy('llm-gateway', 'operator-model', {
    approval: 'candidate',
    enabled: false,
  });

  assert.throws(
    () => updateModelPolicy('llm-gateway', 'operator-model', { approval: 'approved' }),
    (err) => err.code === 'MODEL_VALIDATION_REQUIRED'
  );
  assert.throws(
    () => updateModelPolicy('llm-gateway', 'operator-model', {
      approval: 'approved',
      validationStatus: 'passed',
    }),
    (err) => err.code === 'MODEL_VALIDATION_REQUIRED' && /evidence/i.test(err.message)
  );

  const snapshot = updateModelPolicy('llm-gateway', 'operator-model', {
    approval: 'approved',
    enabled: true,
    validationStatus: 'passed',
    validationEvidence: 'Harness run model-refresh-2026-07-21: all required scenarios passed.',
  });
  const approved = snapshot.providers
    .find((provider) => provider.id === 'llm-gateway')
    .models.find((model) => model.id === 'operator-model');

  assert.equal(approved.approval, 'approved');
  assert.equal(approved.enabled, true);
  assert.equal(approved.validationStatus, 'passed');
  updateSettings({ enforceApprovedModels: true });
  assert.equal(assertProviderModelAllowed('llm-gateway', 'operator-model'), true);
});

test('a cloud discovery candidate cannot bypass the maintained release with typed evidence', () => {
  updateModelPolicy('openai', 'gpt-future-candidate', {
    approval: 'candidate',
    enabled: false,
  });

  assert.throws(
    () => updateModelPolicy('openai', 'gpt-future-candidate', {
      approval: 'approved',
      enabled: true,
      validationStatus: 'passed',
      validationEvidence: 'I typed that a harness passed, but no maintained catalog release exists.',
    }),
    (err) => err.code === 'MODEL_CATALOG_RELEASE_REQUIRED'
      && /request compatibility/i.test(err.message)
  );
});

test('AI management API returns policy and key status without returning API-key secrets', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-secret-that-must-not-be-returned';

  try {
    const response = await request(createApp()).get('/api/ai-management').expect(200);

    assert.equal(response.body.ok, true);
    assert.equal(response.body.catalog.enforceApprovedModels, false);
    assert.equal(response.body.keys.openai.configured, true);
    assert.ok(['saved', 'environment'].includes(response.body.keys.openai.source));
    assert.equal(JSON.stringify(response.body).includes('test-secret-that-must-not-be-returned'), false);
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test('AI management API requires a maintained release before approving a cloud discovery', async () => {
  const response = await request(createApp())
    .put('/api/ai-management/models')
    .send({
      providerId: 'openai',
      modelId: 'gpt-unvalidated-candidate',
      approval: 'approved',
      enabled: true,
    })
    .expect(409);

  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, 'MODEL_CATALOG_RELEASE_REQUIRED');
});

test('AI management API still requires harness evidence for operator-managed models', async () => {
  const response = await request(createApp())
    .put('/api/ai-management/models')
    .send({
      providerId: 'llm-gateway',
      modelId: 'operator-model',
      approval: 'approved',
      enabled: true,
    })
    .expect(409);

  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, 'MODEL_VALIDATION_REQUIRED');
});
