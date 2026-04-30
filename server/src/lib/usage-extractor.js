'use strict';

const { getCodexProviderIds } = require('../services/providers/catalog');

/**
 * Shared extraction of token usage from CLI JSON events.
 *
 * Used by claude.js, codex.js, AND dev.js (Issue 10).
 * Returns a normalized usage object or null when no usage data is found.
 * Null signals "unknown" (distinct from zero tokens) so callers can set `usageAvailable`.
 */

// Billable dimensions beyond input/output that we detect but don't yet cost (R18)
const CLAUDE_EXTRA_DIMENSIONS = [
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
];
const CODEX_EXTRA_DIMENSIONS = [
  'reasoning_tokens',
  'cached_tokens',
];

// Env-level model fallback as last resort when caller doesn't supply fallbackModel.
// These are checked after opts.fallbackModel, so caller context always takes priority.
const ENV_CLAUDE_MODEL = process.env.CLAUDE_CHAT_MODEL || process.env.CLAUDE_PARSE_MODEL || process.env.CLAUDE_DEV_MODEL || '';
const ENV_CODEX_MODEL = process.env.CODEX_CHAT_MODEL || process.env.CODEX_PARSE_MODEL || process.env.CODEX_DEV_MODEL || '';

/**
 * Check if a usage object contains any recognized token/cost fields.
 * Returns true if at least one standard or extra-dimension field KEY is present,
 * regardless of its value. This distinguishes:
 *   - { usage: {} }                        → false → null (unknown)
 *   - { usage: { input_tokens: 0 } }       → true  → result (known zero)
 *   - { usage: { reasoning_tokens: 300 } }  → true  → result
 *
 * Checks nested *_details objects for billable dimensions too.
 */
function hasAnyUsageField(u, extraDimensions) {
  // Standard token field keys (present at all = recognized usage payload)
  if ('input_tokens' in u || 'output_tokens' in u) return true;
  if ('prompt_tokens' in u || 'completion_tokens' in u) return true;
  // Top-level extra dimensions
  for (const dim of extraDimensions) {
    if (dim in u) return true;
  }
  // Nested *_details objects
  for (const key of Object.keys(u)) {
    if (key.endsWith('_details') && u[key] && typeof u[key] === 'object') {
      for (const dim of extraDimensions) {
        if (dim in u[key]) return true;
      }
    }
  }
  return false;
}

/**
 * Extract usage from a Claude CLI stream-json message.
 *
 * @param {Object} msg — parsed JSON line from Claude CLI stdout
 * @param {Object} [opts]
 * @param {string} [opts.fallbackModel] — contextual model to use when event has none
 * @returns {{ inputTokens: number, outputTokens: number, model: string, rawUsage: Object, usageComplete: boolean } | null}
 */
function extractClaudeUsage(msg, opts) {
  if (!msg || typeof msg !== 'object') return null;
  const fallbackModel = (opts && opts.fallbackModel) || '';

  // Primary: result event with usage object
  // If _buildResult returns null (empty usage object), fall through to secondary.
  if (msg.type === 'result' && msg.usage && typeof msg.usage === 'object') {
    const result = _buildResult(msg.usage, msg.model || '', fallbackModel, CLAUDE_EXTRA_DIMENSIONS, ENV_CLAUDE_MODEL);
    if (result) return result;
  }

  // Secondary: some Claude versions put usage in message.usage
  if (msg.message && msg.message.usage && typeof msg.message.usage === 'object') {
    return _buildResult(msg.message.usage, msg.message.model || msg.model || '', fallbackModel, CLAUDE_EXTRA_DIMENSIONS, ENV_CLAUDE_MODEL);
  }

  return null;
}

/**
 * Extract usage from a Codex CLI JSON event.
 *
 * Supported shapes:
 * - `event.usage` — top-level usage object
 * - `event.item.type === 'usage'` with flat token fields on item
 * - `event.item.type === 'usage'` with nested `item.usage` sub-object
 * - `event.type === 'usage'` — direct usage event
 *
 * @param {Object} event — parsed JSON line from Codex CLI stdout
 * @param {Object} [opts]
 * @param {string} [opts.fallbackModel] — contextual model to use when event has none
 * @returns {{ inputTokens: number, outputTokens: number, model: string, rawUsage: Object, usageComplete: boolean } | null}
 */
function extractCodexUsage(event, opts) {
  if (!event || typeof event !== 'object') return null;
  const fallbackModel = (opts && opts.fallbackModel) || '';

  // Try each recognized shape in priority order. If _buildResult returns null
  // for one shape (e.g. empty usage object), fall through to the next rather
  // than returning null early. This prevents an empty primary (event.usage: {})
  // from masking a populated secondary (event.item.usage).

  // Shape 1: top-level usage
  if (event.usage && typeof event.usage === 'object') {
    const result = _buildResult(event.usage, event.model || '', fallbackModel, CODEX_EXTRA_DIMENSIONS, ENV_CODEX_MODEL);
    if (result) return result;
  }

  // Shape 2: item-based usage event
  if (event.item && event.item.type === 'usage' && typeof event.item === 'object') {
    // Shape 2a: item has a nested usage sub-object
    if (event.item.usage && typeof event.item.usage === 'object') {
      const result = _buildResult(event.item.usage, event.item.model || event.model || '', fallbackModel, CODEX_EXTRA_DIMENSIONS, ENV_CODEX_MODEL);
      if (result) return result;
    }
    // Shape 2b: token fields are flat on the item itself
    const result = _buildResult(event.item, event.item.model || event.model || '', fallbackModel, CODEX_EXTRA_DIMENSIONS, ENV_CODEX_MODEL);
    if (result) return result;
  }

  // Shape 3: direct usage event
  if (event.type === 'usage') {
    const result = _buildResult(event, event.model || '', fallbackModel, CODEX_EXTRA_DIMENSIONS, ENV_CODEX_MODEL);
    if (result) return result;
  }

  return null;
}

/**
 * Providers known to emit Codex/OpenAI-style events.
 * Explicit set avoids prefix heuristic drift.
 */
const CODEX_PROVIDERS = new Set([
  ...getCodexProviderIds(),
  'gpt-5.5',
  'codex',
  'openai',
]);

/**
 * Dispatch to the correct extractor by provider ID.
 *
 * @param {Object} msg — parsed JSON event from CLI stdout
 * @param {string} provider — 'claude' or 'gpt-5.5' (or similar)
 * @param {Object} [opts]
 * @param {string} [opts.fallbackModel] — contextual model fallback (caller knows chat vs parse vs dev)
 * @returns {{ inputTokens: number, outputTokens: number, model: string, rawUsage: Object, usageComplete: boolean } | null}
 */
function extractUsageFromMessage(msg, provider, opts) {
  if (!msg || typeof msg !== 'object') return null;

  if (typeof provider === 'string' && CODEX_PROVIDERS.has(provider)) {
    return extractCodexUsage(msg, opts);
  }

  // Default to Claude extractor (covers 'claude' and any unknown provider)
  return extractClaudeUsage(msg, opts);
}

// --- Internal helpers ---

/**
 * Shared result builder for both providers.
 * Model precedence: eventModel → opts.fallbackModel → envFallbackModel → ''
 *
 * Returns null if the usage object has no recognized token/cost fields (e.g. {}).
 * An empty object means "no usage data" (usageAvailable=false), which is
 * semantically distinct from { input_tokens: 0, output_tokens: 0 } where the
 * provider explicitly reported zero usage (usageAvailable=true).
 */
function _buildResult(u, eventModel, fallbackModel, extraDimensions, envFallbackModel) {
  // Empty usage object ({}) = unknown, not "known zero"
  if (!hasAnyUsageField(u, extraDimensions)) return null;

  const inputTokens = toInt(u.input_tokens ?? u.prompt_tokens);
  const outputTokens = toInt(u.output_tokens ?? u.completion_tokens);
  const usageComplete = !hasExtraDimensions(u, extraDimensions);
  const model = eventModel || fallbackModel || envFallbackModel || '';

  return {
    inputTokens,
    outputTokens,
    model,
    rawUsage: u,
    usageComplete,
  };
}

function toInt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  return 0;
}

/**
 * Check for known extra billable dimensions in usage payload.
 * Checks both top-level keys and nested *_details objects.
 */
function hasExtraDimensions(usage, dimensions) {
  for (const dim of dimensions) {
    if (typeof usage[dim] === 'number' && usage[dim] > 0) {
      return true;
    }
  }
  for (const key of Object.keys(usage)) {
    if (key.endsWith('_details') && usage[key] && typeof usage[key] === 'object') {
      for (const dim of dimensions) {
        if (typeof usage[key][dim] === 'number' && usage[key][dim] > 0) {
          return true;
        }
      }
    }
  }
  return false;
}

module.exports = { extractClaudeUsage, extractCodexUsage, extractUsageFromMessage };
