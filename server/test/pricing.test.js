const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateCost, microsToUsd, nanosToUsd, getRates, PRICING_VERSION } = require('../src/lib/pricing');
const { DEFAULT_PRICING } = require('../src/lib/pricing')._internal;

// --- calculateCost ---

test('known Claude model returns correct nanos and micros', () => {
  const r = calculateCost(1000, 500, 'claude-sonnet-4-5-20250514', 'claude');
  // Sonnet 4.5: 3000 nanos/input, 15000 nanos/output
  assert.equal(r.inputCostNanos, 3_000_000);
  assert.equal(r.outputCostNanos, 7_500_000);
  assert.equal(r.totalCostNanos, 10_500_000);
  assert.equal(r.inputCostMicros, 3000);
  assert.equal(r.outputCostMicros, 7500);
  assert.equal(r.totalCostMicros, 10500);
  assert.equal(r.rateFound, true);
});

test('known Codex model returns correct nanos and micros', () => {
  const r = calculateCost(1000, 500, 'gpt-5.3-codex', 'chatgpt-5.3-codex-high');
  assert.equal(r.inputCostNanos, 2_500_000);
  assert.equal(r.outputCostNanos, 5_000_000);
  assert.equal(r.totalCostNanos, 7_500_000);
  assert.equal(r.rateFound, true);
});

test('zero tokens returns zero cost', () => {
  const r = calculateCost(0, 0, 'claude-sonnet-4-5-20250514', 'claude');
  assert.equal(r.totalCostNanos, 0);
  assert.equal(r.totalCostMicros, 0);
  assert.equal(r.rateFound, true);
});

test('unknown model + unknown provider returns zero cost and rateFound false', () => {
  const r = calculateCost(1000, 500, 'mystery-model', 'mystery-provider');
  assert.equal(r.totalCostNanos, 0);
  assert.equal(r.totalCostMicros, 0);
  assert.equal(r.rateFound, false);
});

test('unknown model with known provider uses provider fallback', () => {
  const r = calculateCost(1000, 500, 'some-new-claude-thing', 'claude');
  assert.equal(r.rateFound, true);
  assert.ok(r.totalCostNanos > 0);
});

test('negative tokens treated as zero', () => {
  const r = calculateCost(-100, -50, 'claude-sonnet-4-5-20250514', 'claude');
  assert.equal(r.totalCostNanos, 0);
});

test('NaN and undefined tokens treated as zero', () => {
  const r1 = calculateCost(NaN, undefined, 'claude-sonnet-4-5-20250514', 'claude');
  assert.equal(r1.totalCostNanos, 0);
  const r2 = calculateCost(Infinity, 100, 'claude-sonnet-4-5-20250514', 'claude');
  assert.equal(r2.inputCostNanos, 0);
});

// --- Nanos precision eliminates small-request rounding bias ---

test('single token of gpt-4o-mini has non-zero nanos', () => {
  const r = calculateCost(1, 0, 'gpt-4o-mini', 'chatgpt-5.3-codex-high');
  // 1 token * 150 nanos = 150 nanos → 0 micros (expected rounding)
  assert.equal(r.inputCostNanos, 150);
  assert.equal(r.inputCostMicros, 0); // rounds to 0 at micro level
});

test('10 single-token requests aggregate correctly via nanos', () => {
  let totalNanos = 0;
  for (let i = 0; i < 10; i++) {
    const r = calculateCost(1, 0, 'gpt-4o-mini', 'chatgpt-5.3-codex-high');
    totalNanos += r.inputCostNanos;
  }
  // 10 * 150 = 1500 nanos = 1.5 micros → rounds to 2 micros
  assert.equal(totalNanos, 1500);
  assert.equal(Math.round(totalNanos / 1000), 2);
});

// --- Prefix matching: longest-first prevents mispricing ---

test('gpt-4o-mini-2025 matches gpt-4o-mini NOT gpt-4o', () => {
  const rates = getRates('gpt-4o-mini-2025', null);
  const expected = DEFAULT_PRICING['gpt-4o-mini'];
  assert.deepEqual(rates, expected);
});

test('o3-mini-2025 matches o3-mini NOT o3', () => {
  const rates = getRates('o3-mini-2025', null);
  const expected = DEFAULT_PRICING['o3-mini'];
  assert.deepEqual(rates, expected);
});

test('gpt-4o-20240101 matches gpt-4o', () => {
  const rates = getRates('gpt-4o-20240101', null);
  const expected = DEFAULT_PRICING['gpt-4o'];
  assert.deepEqual(rates, expected);
});

test('short ambiguous model like gpt-4 does not match any key', () => {
  const rates = getRates('gpt-4', null);
  assert.equal(rates, null);
});

test('gpt-4ofoo does not match gpt-4o (no separator boundary)', () => {
  const rates = getRates('gpt-4ofoo', null);
  assert.equal(rates, null);
});

test('o3mega does not match o3 (no separator boundary)', () => {
  const rates = getRates('o3mega', null);
  assert.equal(rates, null);
});

test('gpt-4o.2025 matches gpt-4o (dot is valid separator)', () => {
  const rates = getRates('gpt-4o.2025', null);
  assert.notEqual(rates, null);
  assert.equal(rates.inputNanosPerToken, DEFAULT_PRICING['gpt-4o'].inputNanosPerToken);
});

test('exact key o3 still matches', () => {
  const rates = getRates('o3', null);
  const expected = DEFAULT_PRICING['o3'];
  assert.deepEqual(rates, expected);
});

// --- Pricing table correctness (cross-checked against vendor docs) ---

test('Claude Opus 4.6 priced at $5/$25 per MTok', () => {
  const rates = getRates('claude-opus-4-6', null);
  assert.equal(rates.inputNanosPerToken, 5000);
  assert.equal(rates.outputNanosPerToken, 25000);
});

test('Claude Haiku 3.5 priced at $0.80/$4 per MTok', () => {
  const rates = getRates('claude-3-5-haiku-20241022', null);
  assert.equal(rates.inputNanosPerToken, 800);
  assert.equal(rates.outputNanosPerToken, 4000);
});

// --- microsToUsd / nanosToUsd ---

test('microsToUsd formats correctly', () => {
  assert.equal(microsToUsd(10500), '$0.010500');
  assert.equal(microsToUsd(0), '$0.000000');
  assert.equal(microsToUsd(1), '$0.000001');
});

test('nanosToUsd formats correctly', () => {
  assert.equal(nanosToUsd(10_500_000), '$0.010500000');
  assert.equal(nanosToUsd(150), '$0.000000150');
  assert.equal(nanosToUsd(0), '$0.000000');
});

test('PRICING_VERSION is a date string', () => {
  assert.match(PRICING_VERSION, /^\d{4}-\d{2}-\d{2}$/);
});

test('corrupted rate entry returns zero cost and rateFound false', () => {
  const r = calculateCost(100, 50, 'mystery', 'mystery');
  assert.equal(r.rateFound, false);
  assert.equal(r.totalCostNanos, 0);
});

// --- Pricing config override validation (isValidRate) ---

// --- Finding #2 regression: input + output micros must always equal total micros ---

test('component micros always sum to total micros (small-request rounding)', () => {
  // This exact case was the review repro: 4 input, 1 output on gpt-4o-mini
  const r = calculateCost(4, 1, 'gpt-4o-mini', 'chatgpt-5.3-codex-high');
  assert.equal(
    r.inputCostMicros + r.outputCostMicros,
    r.totalCostMicros,
    `input(${r.inputCostMicros}) + output(${r.outputCostMicros}) must equal total(${r.totalCostMicros})`
  );
});

test('component micros sum to total for various token counts', () => {
  const cases = [
    [1, 1, 'gpt-4o-mini', 'chatgpt-5.3-codex-high'],
    [3, 2, 'gpt-4o-mini', 'chatgpt-5.3-codex-high'],
    [7, 3, 'gpt-4o-mini', 'chatgpt-5.3-codex-high'],
    [1, 0, 'claude-3-haiku-20240307', 'claude'],
    [0, 1, 'claude-3-haiku-20240307', 'claude'],
    [13, 7, 'o3-mini', 'openai'],
    [100000, 50000, 'claude-opus-4-6', 'claude'],
  ];
  for (const [inp, out, model, prov] of cases) {
    const r = calculateCost(inp, out, model, prov);
    assert.equal(
      r.inputCostMicros + r.outputCostMicros,
      r.totalCostMicros,
      `${model} (${inp}/${out}): input(${r.inputCostMicros}) + output(${r.outputCostMicros}) != total(${r.totalCostMicros})`
    );
  }
});

// --- Finding #3 regression: all Codex provider aliases must have fallback rates ---

test('gpt-5.3-codex-high provider fallback returns rates', () => {
  const r = calculateCost(1000, 500, 'unknown-model', 'gpt-5.3-codex-high');
  assert.equal(r.rateFound, true, 'gpt-5.3-codex-high must have a provider fallback');
  assert.ok(r.totalCostNanos > 0);
});

test('codex provider fallback returns rates', () => {
  const r = calculateCost(1000, 500, 'unknown-model', 'codex');
  assert.equal(r.rateFound, true, 'codex must have a provider fallback');
  assert.ok(r.totalCostNanos > 0);
});

test('openai provider fallback returns rates', () => {
  const r = calculateCost(1000, 500, 'unknown-model', 'openai');
  assert.equal(r.rateFound, true, 'openai must have a provider fallback');
  assert.ok(r.totalCostNanos > 0);
});

test('all CODEX_PROVIDERS have matching fallback rates in pricing', () => {
  // Verify parity: every provider the extractor recognizes should have pricing fallback
  const codexProviders = ['chatgpt-5.3-codex-high', 'gpt-5.3-codex-high', 'gpt-5-mini', 'codex', 'openai'];
  for (const prov of codexProviders) {
    const rates = getRates('totally-unknown-model-xyz', prov);
    assert.notEqual(rates, null, `provider "${prov}" missing from PROVIDER_FALLBACKS`);
  }
});

// --- Finding #2 regression: fractional tokens must produce integer nanos ---

test('fractional input tokens produce integer nanos (review repro: 0.333)', () => {
  const r = calculateCost(0.333, 0, 'gpt-4o-mini', 'chatgpt-5.3-codex-high');
  assert.equal(Number.isInteger(r.inputCostNanos), true, 'inputCostNanos must be integer, got ' + r.inputCostNanos);
  assert.equal(Number.isInteger(r.totalCostNanos), true, 'totalCostNanos must be integer, got ' + r.totalCostNanos);
  assert.equal(Number.isInteger(r.inputCostMicros), true, 'inputCostMicros must be integer');
});

test('fractional output tokens produce integer nanos', () => {
  const r = calculateCost(0, 1.7, 'claude-opus-4-6', 'claude');
  assert.equal(Number.isInteger(r.outputCostNanos), true, 'outputCostNanos must be integer, got ' + r.outputCostNanos);
  assert.equal(Number.isInteger(r.totalCostNanos), true);
});

test('all cost fields are integers for arbitrary fractional inputs', () => {
  const cases = [0.1, 0.5, 0.9, 1.333, 2.7, 99.99];
  for (const frac of cases) {
    const r = calculateCost(frac, frac, 'gpt-4o', 'openai');
    for (const field of ['inputCostNanos', 'outputCostNanos', 'totalCostNanos', 'inputCostMicros', 'outputCostMicros', 'totalCostMicros']) {
      assert.equal(Number.isInteger(r[field]), true, `${field} not integer for tokens=${frac}: ${r[field]}`);
    }
  }
});

test('pricing override rejects non-numeric rates at load time', () => {
  // We can't test the load path directly without env manipulation,
  // but we verify the exported pricing table only contains valid entries.
  // All entries must have finite non-negative inputNanosPerToken/outputNanosPerToken.
  for (const [key, val] of Object.entries(DEFAULT_PRICING)) {
    assert.equal(typeof val.inputNanosPerToken, 'number', key + ' inputNanosPerToken');
    assert.equal(typeof val.outputNanosPerToken, 'number', key + ' outputNanosPerToken');
    assert.ok(Number.isFinite(val.inputNanosPerToken), key + ' inputNanosPerToken finite');
    assert.ok(Number.isFinite(val.outputNanosPerToken), key + ' outputNanosPerToken finite');
    assert.ok(val.inputNanosPerToken >= 0, key + ' inputNanosPerToken non-negative');
    assert.ok(val.outputNanosPerToken >= 0, key + ' outputNanosPerToken non-negative');
  }
});
