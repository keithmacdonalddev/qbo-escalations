'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAnthropicEffortParam,
  buildAnthropicThinkingParam,
  modelRejectsSamplingParams,
  supportsAnthropicEffort,
} = require('../src/lib/anthropic-thinking');

test('current adaptive Claude models receive readable thinking summaries', () => {
  for (const model of ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-5']) {
    assert.deepEqual(
      buildAnthropicThinkingParam(model),
      { thinking: { type: 'adaptive', display: 'summarized' } }
    );
  }
  assert.deepEqual(buildAnthropicThinkingParam('claude-haiku-4-5-20251001'), {});
});

test('Anthropic effort is sent only for a model and level that accept it', () => {
  assert.equal(supportsAnthropicEffort('claude-sonnet-5', 'xhigh'), true);
  assert.deepEqual(
    buildAnthropicEffortParam('claude-sonnet-5', 'xhigh'),
    { output_config: { effort: 'xhigh' } }
  );
  assert.equal(supportsAnthropicEffort('claude-sonnet-4-6', 'xhigh'), false);
  assert.deepEqual(buildAnthropicEffortParam('claude-sonnet-4-6', 'xhigh'), {});
  assert.deepEqual(buildAnthropicEffortParam('claude-haiku-4-5-20251001', 'high'), {});
});

test('current Claude 5 models reject sampling parameters in direct requests', () => {
  assert.equal(modelRejectsSamplingParams('claude-fable-5'), true);
  assert.equal(modelRejectsSamplingParams('claude-sonnet-5'), true);
  assert.equal(modelRejectsSamplingParams('claude-haiku-4-5-20251001'), false);
});
