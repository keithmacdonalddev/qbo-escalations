'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Token pricing in integer nanodollars per token (1 nano = $0.000000001).
 * Using nanodollars avoids fractional rates and rounding bias on small requests.
 *
 * To convert from vendor pricing ($/MTok): rate_nanos = price_per_MTok * 1000
 * Example: $3/MTok input = 3000 nanos/token
 *
 * PRICING_VERSION: 2026-02-27
 * Sources:
 *   Anthropic: https://docs.anthropic.com/en/docs/about-claude/pricing
 *   OpenAI:    https://openai.com/api/pricing/
 * Override stale values via PRICING_CONFIG_PATH env var.
 */
const DEFAULT_PRICING = {
  // Claude models — Anthropic pricing as of 2026-02-27
  'claude-opus-4-6':              { inputNanosPerToken: 5000,  outputNanosPerToken: 25000  }, // $5/$25 per MTok
  'claude-opus-4-5':              { inputNanosPerToken: 5000,  outputNanosPerToken: 25000  }, // $5/$25 per MTok
  'claude-4-6-opus':              { inputNanosPerToken: 5000,  outputNanosPerToken: 25000  }, // alias
  'claude-sonnet-4-6':            { inputNanosPerToken: 3000,  outputNanosPerToken: 15000  }, // $3/$15 per MTok
  'claude-sonnet-4-5-20250514':   { inputNanosPerToken: 3000,  outputNanosPerToken: 15000  }, // $3/$15 per MTok
  'claude-sonnet-4-5':            { inputNanosPerToken: 3000,  outputNanosPerToken: 15000  }, // alias
  'claude-3-5-sonnet-20241022':   { inputNanosPerToken: 3000,  outputNanosPerToken: 15000  }, // $3/$15 per MTok
  'claude-haiku-4-5':             { inputNanosPerToken: 1000,  outputNanosPerToken: 5000   }, // $1/$5 per MTok
  'claude-3-5-haiku-20241022':    { inputNanosPerToken: 800,   outputNanosPerToken: 4000   }, // $0.80/$4 per MTok
  'claude-3-haiku-20240307':      { inputNanosPerToken: 250,   outputNanosPerToken: 1250   }, // $0.25/$1.25 per MTok

  // OpenAI / Codex models — pricing as of 2026-02-27
  'gpt-5.3-codex':                { inputNanosPerToken: 2500,  outputNanosPerToken: 10000  }, // $2.50/$10 per MTok
  'gpt-4o':                       { inputNanosPerToken: 2500,  outputNanosPerToken: 10000  }, // $2.50/$10 per MTok
  'gpt-4o-mini':                  { inputNanosPerToken: 150,   outputNanosPerToken: 600    }, // $0.15/$0.60 per MTok
  'gpt-5-mini':                   { inputNanosPerToken: 150,   outputNanosPerToken: 600    }, // $0.15/$0.60 per MTok (estimate, gpt-4o-mini tier)
  'o3':                           { inputNanosPerToken: 2000,  outputNanosPerToken: 8000   }, // $2/$8 per MTok
  'o3-mini':                      { inputNanosPerToken: 1100,  outputNanosPerToken: 4400   }, // $1.10/$4.40 per MTok
};

const PRICING_VERSION = '2026-02-27';

/**
 * Provider-level fallback rates (nanodollars) when the exact model is unknown.
 */
const PROVIDER_FALLBACKS = {
  claude:                       { inputNanosPerToken: 3000,  outputNanosPerToken: 15000 },
  'claude-sonnet-4-6':          { inputNanosPerToken: 3000,  outputNanosPerToken: 15000 },
  'chatgpt-5.3-codex-high':    { inputNanosPerToken: 2500,  outputNanosPerToken: 10000 },
  'gpt-5.3-codex-high':        { inputNanosPerToken: 2500,  outputNanosPerToken: 10000 },
  'gpt-5-mini':                 { inputNanosPerToken: 150,   outputNanosPerToken: 600   },
  codex:                        { inputNanosPerToken: 2500,  outputNanosPerToken: 10000 },
  openai:                       { inputNanosPerToken: 2500,  outputNanosPerToken: 10000 },
};

/**
 * Null sentinel: when both model and provider are unknown, cost is zero.
 * This prevents fabricated spend data for unrecognized providers/models.
 */
const UNKNOWN_FALLBACK = null;

// Load optional pricing override from env
let pricingTable = { ...DEFAULT_PRICING };
let providerFallbacks = { ...PROVIDER_FALLBACKS };

/**
 * Keys sorted longest-first for prefix matching. Rebuilt after config override.
 * This ensures "gpt-4o-mini-2025" matches "gpt-4o-mini" before "gpt-4o".
 */
let sortedKeys = Object.keys(pricingTable).sort((a, b) => b.length - a.length);

/**
 * Validate a rate entry has finite positive numbers for both fields.
 * Invalid entries are rejected at load time, not at query time.
 */
function isValidRate(entry) {
  return entry
    && typeof entry === 'object'
    && typeof entry.inputNanosPerToken === 'number'
    && typeof entry.outputNanosPerToken === 'number'
    && Number.isFinite(entry.inputNanosPerToken)
    && Number.isFinite(entry.outputNanosPerToken)
    && entry.inputNanosPerToken >= 0
    && entry.outputNanosPerToken >= 0;
}

const configPath = process.env.PRICING_CONFIG_PATH;
if (configPath) {
  try {
    const resolved = path.resolve(configPath);
    const raw = fs.readFileSync(resolved, 'utf-8');
    const override = JSON.parse(raw);
    let accepted = 0;
    let rejected = 0;
    if (override.models && typeof override.models === 'object') {
      for (const [key, val] of Object.entries(override.models)) {
        if (isValidRate(val)) {
          pricingTable[key] = val;
          accepted++;
        } else {
          console.warn('[pricing] rejected invalid override for model', key, ':', JSON.stringify(val));
          rejected++;
        }
      }
    }
    if (override.providers && typeof override.providers === 'object') {
      for (const [key, val] of Object.entries(override.providers)) {
        if (isValidRate(val)) {
          providerFallbacks[key] = val;
          accepted++;
        } else {
          console.warn('[pricing] rejected invalid override for provider', key, ':', JSON.stringify(val));
          rejected++;
        }
      }
    }
    // Rebuild sorted keys after override
    sortedKeys = Object.keys(pricingTable).sort((a, b) => b.length - a.length);
    console.log('Pricing config loaded from', resolved, '(' + accepted + ' accepted, ' + rejected + ' rejected)');
  } catch (err) {
    console.warn('Failed to load pricing config from', configPath, ':', err.message);
  }
}

/**
 * Look up the per-token rates for a model/provider combo.
 *
 * Precedence: exact model → model-starts-with-key prefix match → provider fallback → null.
 * Returns null when no rate is found, so calculateCost can produce zero cost + rateFound: false.
 */
function getRates(model, provider) {
  // Exact match
  if (model && pricingTable[model]) {
    return pricingTable[model];
  }

  // Prefix match with boundary check: model must equal key or the character
  // immediately after the key must be a separator (-, ., :, @) or digit.
  // This prevents "gpt-4ofoo" from matching "gpt-4o".
  // Keys are sorted longest-first so "gpt-4o-mini" is checked before "gpt-4o".
  if (model) {
    for (const key of sortedKeys) {
      if (model.startsWith(key)) {
        if (model.length === key.length) return pricingTable[key]; // exact
        const next = model[key.length];
        if (next === '-' || next === '.' || next === ':' || next === '@' || (next >= '0' && next <= '9')) {
          return pricingTable[key];
        }
      }
    }
  }

  // Provider fallback
  if (provider && providerFallbacks[provider]) {
    return providerFallbacks[provider];
  }

  return UNKNOWN_FALLBACK;
}

/**
 * Calculate cost in integer nanodollars (for precision) and integer microdollars (for display).
 *
 * Nanodollars eliminate rounding bias on small requests: 1 token of gpt-4o-mini
 * costs 150 nanos, which would round to 0 micros per-request but aggregates correctly
 * when you sum nanos across requests then convert.
 *
 * When the model/provider combination is not recognized, all costs are zero and
 * `rateFound` is false — preventing fabricated spend data.
 *
 * @param {number} inputTokens  — raw prompt token count
 * @param {number} outputTokens — raw completion token count
 * @param {string} [model]      — exact model ID from CLI output
 * @param {string} [provider]   — provider identifier (claude, chatgpt-5.3-codex-high)
 * @returns {{ inputCostMicros: number, outputCostMicros: number, totalCostMicros: number,
 *             inputCostNanos: number, outputCostNanos: number, totalCostNanos: number,
 *             rateFound: boolean }}
 */
function calculateCost(inputTokens, outputTokens, model, provider) {
  // Enforce integer tokens: round to nearest int to guarantee integer nanos/micros downstream.
  const inp = Number.isFinite(inputTokens) && inputTokens > 0 ? Math.round(inputTokens) : 0;
  const out = Number.isFinite(outputTokens) && outputTokens > 0 ? Math.round(outputTokens) : 0;
  const zero = {
    inputCostMicros: 0, outputCostMicros: 0, totalCostMicros: 0,
    inputCostNanos: 0, outputCostNanos: 0, totalCostNanos: 0,
    rateFound: false,
  };

  const rates = getRates(model, provider);
  if (!rates) return zero;

  // Guard against corrupted rate entries producing NaN costs
  if (!Number.isFinite(rates.inputNanosPerToken) || !Number.isFinite(rates.outputNanosPerToken)) {
    return zero;
  }

  // Compute in integer nanodollars (all rates are integer nanos/token)
  const inputCostNanos = inp * rates.inputNanosPerToken;
  const outputCostNanos = out * rates.outputNanosPerToken;
  const totalCostNanos = inputCostNanos + outputCostNanos;

  // Derive microdollars from nanos. totalCostMicros is authoritative (rounded
  // from the precise nano total). inputCostMicros is rounded independently,
  // and outputCostMicros is derived so that input + output === total always.
  const totalCostMicros = Math.round(totalCostNanos / 1000);
  const inputCostMicros = Math.round(inputCostNanos / 1000);
  const outputCostMicros = totalCostMicros - inputCostMicros;

  return {
    inputCostMicros, outputCostMicros, totalCostMicros,
    inputCostNanos, outputCostNanos, totalCostNanos,
    rateFound: true,
  };
}

/**
 * Convert integer microdollars to a formatted USD string.
 *
 * @param {number} micros — integer microdollars
 * @returns {string} e.g. "$0.001234"
 */
function microsToUsd(micros) {
  if (!Number.isFinite(micros) || micros === 0) return '$0.000000';
  const dollars = micros / 1_000_000;
  return '$' + dollars.toFixed(6);
}

/**
 * Convert integer nanodollars to a formatted USD string.
 * Use this when aggregating nanos across requests for precision.
 *
 * @param {number} nanos — integer nanodollars
 * @returns {string} e.g. "$0.001234"
 */
function nanosToUsd(nanos) {
  if (!Number.isFinite(nanos) || nanos === 0) return '$0.000000';
  const dollars = nanos / 1_000_000_000;
  return '$' + dollars.toFixed(9);
}

module.exports = { calculateCost, microsToUsd, nanosToUsd, getRates, PRICING_VERSION };
module.exports._internal = { DEFAULT_PRICING, PROVIDER_FALLBACKS, UNKNOWN_FALLBACK };
