const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getProviderCapabilities,
  getProviderMeta,
  getProviderModelId,
  getProviderTransport,
  isValidProvider,
} = require('../src/services/providers/catalog');

test('Claude CLI catalog exposes the four real user-selectable model choices', () => {
  const expected = [
    ['claude-fable-5', 'claude-fable-5'],
    ['claude-opus-4-8', 'claude-opus-4-8'],
    ['claude-sonnet-5', 'claude-sonnet-5'],
    ['claude-haiku-4-5', 'claude-haiku-4-5'],
  ];

  for (const [providerId, modelId] of expected) {
    assert.equal(isValidProvider(providerId), true, `${providerId} should be a valid catalog provider`);
    assert.equal(getProviderTransport(providerId), 'claude');
    assert.equal(getProviderModelId(providerId), modelId);
  }
});

test('current direct-provider and Codex defaults match the July 2026 catalog', () => {
  assert.equal(getProviderModelId('anthropic'), 'claude-sonnet-5');
  assert.equal(getProviderModelId('codex'), 'gpt-5.6-sol');
  assert.equal(getProviderModelId('openai'), 'gpt-5.6-terra');
  assert.equal(getProviderModelId('gemini'), 'gemini-3.5-flash');
  assert.equal(getProviderModelId('kimi'), 'kimi-k2.6');
  assert.equal(getProviderModelId('llm-gateway'), 'auto');
  assert.equal(getProviderModelId('lm-studio'), 'local');

  for (const modelId of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    assert.equal(isValidProvider(modelId), true, `${modelId} should be a valid Codex model preset`);
    assert.equal(getProviderTransport(modelId), 'codex');
    assert.equal(getProviderCapabilities(modelId).allowedEfforts.includes('max'), true);
  }
});

test('Claude Fable 5 capability metadata uses Anthropic adaptive-reasoning terminology', () => {
  const meta = getProviderMeta('claude-fable-5');
  const capabilities = getProviderCapabilities('claude-fable-5');

  assert.equal(meta.selectable, false);
  assert.equal(capabilities.supportsThinking, true);
  assert.equal(capabilities.reasoningVisibility, 'stream');
  assert.equal(capabilities.reasoningTerminology, 'adaptive reasoning');
  assert.equal(capabilities.effortTerminology, 'effort');
  assert.equal(capabilities.thinkingMode, 'adaptive-always-on');
  assert.equal(capabilities.manualThinkingBudget, false);
  assert.deepEqual(capabilities.allowedEfforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(capabilities.contextWindowTokens, 1000000);
  assert.equal(capabilities.maxOutputTokens, 128000);
});

test('Claude CLI default advertises all current Claude Code aliases', () => {
  const capabilities = getProviderCapabilities('claude');

  assert.deepEqual(capabilities.modelAliases, ['best', 'fable', 'opus', 'sonnet', 'haiku']);
  assert.ok(
    capabilities.featureNotes.some((note) => note.includes('manual thinking budgets are not supported')),
    'feature notes should warn about adaptive reasoning instead of manual thinking budgets'
  );
});
