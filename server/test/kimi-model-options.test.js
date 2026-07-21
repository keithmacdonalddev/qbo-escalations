'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyKimiGenerationOptions,
  isKimiK27CodeModel,
  isKimiK3Model,
  normalizeKimiK3ReasoningEffort,
} = require('../src/lib/kimi-model-options');

test('Kimi K3 uses always-on reasoning fields and omits fixed sampling controls', () => {
  const body = {
    model: 'kimi-k3',
    temperature: 1,
    top_p: 0.9,
    max_tokens: 10,
    thinking: { type: 'disabled' },
  };

  applyKimiGenerationOptions(body, body.model, 'xhigh', 4096);

  assert.equal(isKimiK3Model(body.model), true);
  assert.equal(body.max_completion_tokens, 4096);
  assert.equal(body.reasoning_effort, 'max');
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.temperature, undefined);
  assert.equal(body.top_p, undefined);
  assert.equal(body.thinking, undefined);
});

test('Kimi K2.7 Code keeps thinking on and does not accept reasoning_effort', () => {
  const body = {
    model: 'kimi-k2.7-code-highspeed',
    temperature: 1,
    thinking: { type: 'disabled' },
    reasoning_effort: 'high',
  };

  applyKimiGenerationOptions(body, body.model, 'high', 2048);

  assert.equal(isKimiK27CodeModel(body.model), true);
  assert.equal(body.max_tokens, 2048);
  assert.equal(body.max_completion_tokens, undefined);
  assert.equal(body.temperature, undefined);
  assert.equal(body.thinking, undefined);
  assert.equal(body.reasoning_effort, undefined);
});

test('legacy Kimi K2 models remain runnable with explicit thinking disabled', () => {
  const body = { model: 'kimi-k2.6', temperature: 1 };
  applyKimiGenerationOptions(body, body.model, 'medium', 1024);

  assert.equal(body.max_tokens, 1024);
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.temperature, undefined);
  assert.equal(body.reasoning_effort, undefined);
});

test('Kimi K3 effort normalization maps app-wide effort names safely', () => {
  assert.equal(normalizeKimiK3ReasoningEffort('none'), 'low');
  assert.equal(normalizeKimiK3ReasoningEffort('medium'), 'high');
  assert.equal(normalizeKimiK3ReasoningEffort('ultra'), 'max');
  assert.equal(normalizeKimiK3ReasoningEffort('unknown'), '');
});
