const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clearProviderStubs,
  registerProviderStub,
} = require('../src/lib/harness-provider-gate');
const { DEFAULT_PARSE_TEXT } = require('../../stress-testing/scripts/harness-provider-stubs');
const {
  parseImage,
  checkProviderAvailability,
  clearProviderAvailabilityCache,
  validateRemoteProvider,
} = require('../src/services/image-parser');

const SAMPLE_IMAGE = 'data:image/png;base64,QUJD';

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

test('parseImage uses parseImage stubs in harness mode', async () => {
  await withHarnessProviders(async () => {
    registerProviderStub('openai', 'parseImage', async () => ({
      text: DEFAULT_PARSE_TEXT,
      usage: {
        provider: 'openai',
        model: 'harness-stub-model',
        inputTokens: 1,
        outputTokens: 1,
      },
    }));

    const result = await parseImage(SAMPLE_IMAGE, { provider: 'openai', timeoutMs: 1000 });

    assert.equal(result.role, 'escalation');
    assert.equal(result.usage.provider, 'openai');
    assert.equal(result.parseFields.category, 'payroll');
    assert.match(result.text, /CX IS ATTEMPTING TO:/);
  });
});

test('validateRemoteProvider uses stubs in harness mode', async () => {
  await withHarnessProviders(async () => {
    registerProviderStub('openai', 'validateRemoteProvider', async () => ({
      ok: true,
      configured: true,
      available: true,
      code: 'OK',
      reason: 'Harness stubbed',
      detail: '',
      model: 'harness-stub-model',
    }));

    const result = await validateRemoteProvider('openai', 'fake-key');
    assert.equal(result.ok, true);
    assert.equal(result.model, 'harness-stub-model');
  });
});

test('checkProviderAvailability stays hermetic in harness mode', async () => {
  await withHarnessProviders(async () => {
    for (const provider of ['llm-gateway', 'anthropic', 'openai', 'kimi', 'gemini']) {
      registerProviderStub(provider, 'validateRemoteProvider', async () => ({
        ok: true,
        configured: true,
        available: true,
        code: 'OK',
        reason: 'Harness stubbed',
        detail: '',
        model: 'harness-stub-model',
      }));
    }
    registerProviderStub('lm-studio', 'providerAvailability', async () => ({
      available: true,
      model: 'harness-stub-model',
      reason: 'Harness stubbed',
    }));

    const providers = await checkProviderAvailability({ forceRefresh: true });

    assert.equal(providers['llm-gateway'].available, true);
    assert.equal(providers['openai'].available, true);
    assert.equal(providers['lm-studio'].available, true);
    assert.equal(providers['lm-studio'].model, 'harness-stub-model');
  });
});
