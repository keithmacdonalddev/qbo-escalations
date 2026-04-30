const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractClaudeUsage,
  extractCodexUsage,
  extractUsageFromMessage,
} = require('../src/lib/usage-extractor');

// --- Claude extraction ---

test('extractClaudeUsage returns tokens from result event', () => {
  const r = extractClaudeUsage({
    type: 'result',
    usage: { input_tokens: 1000, output_tokens: 200 },
    model: 'claude-sonnet-4-5-20250514',
  });
  assert.equal(r.inputTokens, 1000);
  assert.equal(r.outputTokens, 200);
  assert.equal(r.model, 'claude-sonnet-4-5-20250514');
  assert.equal(r.usageComplete, true);
  assert.deepEqual(r.rawUsage, { input_tokens: 1000, output_tokens: 200 });
});

test('extractClaudeUsage returns tokens from message.usage path', () => {
  const r = extractClaudeUsage({
    type: 'assistant',
    message: {
      usage: { input_tokens: 500, output_tokens: 100 },
      model: 'claude-3-5-sonnet-20241022',
    },
  });
  assert.equal(r.inputTokens, 500);
  assert.equal(r.model, 'claude-3-5-sonnet-20241022');
});

test('extractClaudeUsage returns null for non-usage events', () => {
  assert.equal(extractClaudeUsage({ type: 'assistant', message: { content: [] } }), null);
  assert.equal(extractClaudeUsage({ type: 'content_block_delta' }), null);
  assert.equal(extractClaudeUsage(null), null);
  assert.equal(extractClaudeUsage(42), null);
});

test('extractClaudeUsage returns zero-token result for explicit zero usage (known zero, not unknown)', () => {
  const r = extractClaudeUsage({
    type: 'result',
    usage: { input_tokens: 0, output_tokens: 0 },
    model: 'claude-sonnet-4-5-20250514',
  });
  assert.notEqual(r, null, 'explicit zero usage should return a result, not null');
  assert.equal(r.inputTokens, 0);
  assert.equal(r.outputTokens, 0);
  assert.equal(r.usageComplete, true);
  assert.equal(r.model, 'claude-sonnet-4-5-20250514');
});

test('extractClaudeUsage detects cache tokens and sets usageComplete false', () => {
  const r = extractClaudeUsage({
    type: 'result',
    usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 50 },
    model: 'claude-sonnet-4-5-20250514',
  });
  assert.equal(r.usageComplete, false);
});

test('extractClaudeUsage preserves cache-only events (zero input/output)', () => {
  const r = extractClaudeUsage({
    type: 'result',
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 500 },
    model: 'claude-sonnet-4-5-20250514',
  });
  assert.notEqual(r, null);
  assert.equal(r.inputTokens, 0);
  assert.equal(r.usageComplete, false);
});

test('extractClaudeUsage uses fallbackModel when event model is absent', () => {
  const r = extractClaudeUsage(
    { type: 'result', usage: { input_tokens: 100, output_tokens: 50 } },
    { fallbackModel: 'claude-parse-model' }
  );
  assert.equal(r.model, 'claude-parse-model');
});

test('extractClaudeUsage prefers event model over fallbackModel', () => {
  const r = extractClaudeUsage(
    { type: 'result', usage: { input_tokens: 100, output_tokens: 50 }, model: 'event-model' },
    { fallbackModel: 'fallback-model' }
  );
  assert.equal(r.model, 'event-model');
});

// --- Codex extraction ---

test('extractCodexUsage handles top-level usage shape', () => {
  const r = extractCodexUsage({
    usage: { prompt_tokens: 500, completion_tokens: 100 },
    model: 'gpt-5.5',
  });
  assert.equal(r.inputTokens, 500);
  assert.equal(r.outputTokens, 100);
  assert.equal(r.model, 'gpt-5.5');
  assert.equal(r.usageComplete, true);
});

test('extractCodexUsage handles input_tokens/output_tokens naming', () => {
  const r = extractCodexUsage({
    usage: { input_tokens: 300, output_tokens: 80 },
    model: 'gpt-4o',
  });
  assert.equal(r.inputTokens, 300);
  assert.equal(r.outputTokens, 80);
});

test('extractCodexUsage handles item-based flat usage shape', () => {
  const r = extractCodexUsage({
    item: { type: 'usage', prompt_tokens: 200, completion_tokens: 50, model: 'gpt-4o' },
  });
  assert.equal(r.inputTokens, 200);
  assert.equal(r.outputTokens, 50);
});

test('extractCodexUsage handles item with nested usage sub-object', () => {
  const r = extractCodexUsage({
    item: {
      type: 'usage',
      usage: { prompt_tokens: 300, completion_tokens: 75 },
      model: 'gpt-5.5',
    },
  });
  assert.notEqual(r, null);
  assert.equal(r.inputTokens, 300);
  assert.equal(r.outputTokens, 75);
  assert.equal(r.model, 'gpt-5.5');
});

test('extractCodexUsage handles direct usage event shape', () => {
  const r = extractCodexUsage({
    type: 'usage',
    prompt_tokens: 100,
    completion_tokens: 30,
    model: 'gpt-4o-mini',
  });
  assert.equal(r.inputTokens, 100);
  assert.equal(r.outputTokens, 30);
});

test('extractCodexUsage returns null for non-usage events', () => {
  assert.equal(extractCodexUsage({ item: { type: 'agent_message', text: 'hi' } }), null);
  assert.equal(extractCodexUsage(null), null);
});

test('extractCodexUsage detects top-level reasoning_tokens', () => {
  const r = extractCodexUsage({
    usage: { prompt_tokens: 500, completion_tokens: 100, reasoning_tokens: 300 },
    model: 'gpt-5.5',
  });
  assert.equal(r.usageComplete, false);
});

test('extractCodexUsage preserves reasoning-only events', () => {
  const r = extractCodexUsage({
    usage: { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 300 },
    model: 'gpt-5.5',
  });
  assert.notEqual(r, null);
  assert.equal(r.usageComplete, false);
});

test('extractCodexUsage detects nested output_tokens_details.reasoning_tokens', () => {
  const r = extractCodexUsage({
    usage: {
      prompt_tokens: 500,
      completion_tokens: 100,
      output_tokens_details: { reasoning_tokens: 200 },
    },
    model: 'gpt-5.5',
  });
  assert.equal(r.usageComplete, false);
});

test('extractCodexUsage detects nested input_tokens_details.cached_tokens', () => {
  const r = extractCodexUsage({
    usage: {
      prompt_tokens: 500,
      completion_tokens: 100,
      input_tokens_details: { cached_tokens: 400 },
    },
    model: 'gpt-5.5',
  });
  assert.equal(r.usageComplete, false);
});

test('extractCodexUsage detects nested-only billable dimensions with zero top-level', () => {
  const r = extractCodexUsage({
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      output_tokens_details: { reasoning_tokens: 150 },
    },
    model: 'gpt-5.5',
  });
  assert.notEqual(r, null);
  assert.equal(r.usageComplete, false);
});

test('extractCodexUsage uses fallbackModel when event model is absent', () => {
  const r = extractCodexUsage(
    { usage: { prompt_tokens: 100, completion_tokens: 50 } },
    { fallbackModel: 'codex-parse-model' }
  );
  assert.equal(r.model, 'codex-parse-model');
});

// --- Dispatcher ---

test('extractUsageFromMessage dispatches to Claude for claude provider', () => {
  const r = extractUsageFromMessage(
    { type: 'result', usage: { input_tokens: 100, output_tokens: 50 }, model: 'claude-sonnet-4-5-20250514' },
    'claude'
  );
  assert.equal(r.inputTokens, 100);
});

test('extractUsageFromMessage dispatches to Codex for gpt-5.5 provider', () => {
  const r = extractUsageFromMessage(
    { usage: { prompt_tokens: 100, completion_tokens: 50 }, model: 'gpt-5.5' },
    'gpt-5.5'
  );
  assert.equal(r.inputTokens, 100);
});

test('P5: extractUsageFromMessage dispatches to Codex for gpt-5-mini provider', () => {
  const r = extractUsageFromMessage(
    { usage: { prompt_tokens: 200, completion_tokens: 80 }, model: 'gpt-5-mini' },
    'gpt-5-mini'
  );
  assert.ok(r, 'should not return null for gpt-5-mini');
  assert.equal(r.inputTokens, 200);
  assert.equal(r.outputTokens, 80);
});

test('extractUsageFromMessage passes fallbackModel through', () => {
  const r = extractUsageFromMessage(
    { type: 'result', usage: { input_tokens: 100, output_tokens: 50 } },
    'claude',
    { fallbackModel: 'my-parse-model' }
  );
  assert.equal(r.model, 'my-parse-model');
});

test('extractUsageFromMessage returns null for garbage input', () => {
  assert.equal(extractUsageFromMessage(null, 'claude'), null);
  assert.equal(extractUsageFromMessage('string', 'claude'), null);
});

// --- Finding #1 regression: empty usage objects must return null (unknown) ---

test('extractClaudeUsage returns null for empty usage object {}', () => {
  const r = extractClaudeUsage({
    type: 'result',
    usage: {},
    model: 'claude-sonnet-4-5-20250514',
  });
  assert.equal(r, null, 'empty {} usage should be null (unknown), not zero-token result');
});

test('extractCodexUsage returns null for empty usage object {}', () => {
  const r = extractCodexUsage({
    usage: {},
    model: 'gpt-5.5',
  });
  assert.equal(r, null, 'empty {} usage should be null (unknown), not zero-token result');
});

test('extractCodexUsage returns null for item with empty usage sub-object', () => {
  const r = extractCodexUsage({
    item: { type: 'usage', usage: {} },
  });
  assert.equal(r, null, 'empty nested {} usage should be null (unknown)');
});

test('extractUsageFromMessage returns null for empty usage via Claude provider', () => {
  const r = extractUsageFromMessage(
    { type: 'result', usage: {}, model: 'claude-sonnet-4-5-20250514' },
    'claude'
  );
  assert.equal(r, null);
});

test('extractUsageFromMessage returns null for empty usage via Codex provider', () => {
  const r = extractUsageFromMessage(
    { usage: {}, model: 'gpt-5.5' },
    'gpt-5.5'
  );
  assert.equal(r, null);
});

// --- Finding #1 regression: mixed-shape fallthrough ---
// Empty primary usage object must NOT mask a populated secondary.

test('extractClaudeUsage falls through empty primary usage to populated message.usage', () => {
  const r = extractClaudeUsage({
    type: 'result',
    usage: {},
    model: 'claude-sonnet-4-5-20250514',
    message: {
      usage: { input_tokens: 800, output_tokens: 150 },
      model: 'claude-sonnet-4-5-20250514',
    },
  });
  assert.notEqual(r, null, 'should fall through to message.usage');
  assert.equal(r.inputTokens, 800);
  assert.equal(r.outputTokens, 150);
});

test('extractCodexUsage falls through empty top-level usage to populated item.usage', () => {
  const r = extractCodexUsage({
    usage: {},
    model: 'gpt-5.5',
    item: {
      type: 'usage',
      usage: { prompt_tokens: 400, completion_tokens: 90 },
      model: 'gpt-5.5',
    },
  });
  assert.notEqual(r, null, 'should fall through to item.usage');
  assert.equal(r.inputTokens, 400);
  assert.equal(r.outputTokens, 90);
});

test('extractCodexUsage falls through empty top-level usage to flat item fields', () => {
  const r = extractCodexUsage({
    usage: {},
    item: {
      type: 'usage',
      prompt_tokens: 300,
      completion_tokens: 60,
      model: 'gpt-4o',
    },
  });
  assert.notEqual(r, null, 'should fall through to flat item fields');
  assert.equal(r.inputTokens, 300);
  assert.equal(r.outputTokens, 60);
});

test('extractCodexUsage falls through empty top-level usage to direct usage event', () => {
  const r = extractCodexUsage({
    type: 'usage',
    usage: {},
    prompt_tokens: 200,
    completion_tokens: 40,
    model: 'gpt-4o-mini',
  });
  assert.notEqual(r, null, 'should fall through to direct event fields');
  assert.equal(r.inputTokens, 200);
  assert.equal(r.outputTokens, 40);
});

test('extractUsageFromMessage falls through empty Claude usage to message.usage', () => {
  const r = extractUsageFromMessage(
    {
      type: 'result',
      usage: {},
      message: { usage: { input_tokens: 500, output_tokens: 100 }, model: 'claude-sonnet-4-5-20250514' },
    },
    'claude'
  );
  assert.notEqual(r, null);
  assert.equal(r.inputTokens, 500);
});

test('extractUsageFromMessage falls through empty Codex usage to item.usage', () => {
  const r = extractUsageFromMessage(
    {
      usage: {},
      item: { type: 'usage', usage: { prompt_tokens: 600, completion_tokens: 120 }, model: 'gpt-5.5' },
    },
    'gpt-5.5'
  );
  assert.notEqual(r, null);
  assert.equal(r.inputTokens, 600);
});

test('extractClaudeUsage still returns result for explicit { input_tokens: 0, output_tokens: 0 }', () => {
  const r = extractClaudeUsage({
    type: 'result',
    usage: { input_tokens: 0, output_tokens: 0 },
    model: 'claude-sonnet-4-5-20250514',
  });
  assert.notEqual(r, null, 'explicit zero tokens is known-zero, not unknown');
  assert.equal(r.inputTokens, 0);
  assert.equal(r.outputTokens, 0);
});

test('extractCodexUsage still returns result for explicit { prompt_tokens: 0, completion_tokens: 0 }', () => {
  const r = extractCodexUsage({
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    model: 'gpt-5.5',
  });
  assert.notEqual(r, null, 'explicit zero tokens is known-zero, not unknown');
  assert.equal(r.inputTokens, 0);
  assert.equal(r.outputTokens, 0);
});
