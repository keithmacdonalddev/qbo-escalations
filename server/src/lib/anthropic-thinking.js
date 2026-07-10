'use strict';

/**
 * Adaptive-thinking support for the direct Anthropic API leg.
 *
 * On current adaptive-thinking models the API can omit readable summaries
 * "omitted", so thinking blocks come back with EMPTY text. Sending
 * `thinking: {type: "adaptive", display: "summarized"}` opts the response into
 * readable reasoning summaries. The param is only valid on models that support
 * adaptive thinking, so we gate it with a model-id prefix allowlist and omit
 * it entirely for everything else (haiku, sonnet-4-5, claude-3-*, unknown ids).
 */

const ADAPTIVE_THINKING_MODEL_PREFIXES = [
  'claude-fable',
  'claude-mythos',
  'claude-opus-4-5',
  'claude-opus-4-6',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-sonnet-5',
];

const EFFORT_MODEL_PREFIXES = [
  'claude-fable',
  'claude-mythos',
  'claude-opus-4-5',
  'claude-opus-4-6',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-sonnet-5',
];

const XHIGH_EFFORT_MODEL_PREFIXES = [
  'claude-fable',
  'claude-mythos',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-sonnet-5',
];

function supportsAdaptiveThinking(modelId) {
  if (typeof modelId !== 'string' || !modelId) return false;
  const normalized = modelId.trim().toLowerCase();
  return ADAPTIVE_THINKING_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Returns `{ thinking: {...} }` for allowlisted models, `{}` otherwise —
 * spreadable straight into an Anthropic /v1/messages request body.
 */
function buildAnthropicThinkingParam(modelId) {
  if (!supportsAdaptiveThinking(modelId)) return {};
  return { thinking: { type: 'adaptive', display: 'summarized' } };
}

function supportsAnthropicEffort(modelId, effort) {
  if (typeof modelId !== 'string' || !modelId) return false;
  const normalizedModel = modelId.trim().toLowerCase();
  const normalizedEffort = String(effort || '').trim().toLowerCase();
  if (!EFFORT_MODEL_PREFIXES.some((prefix) => normalizedModel.startsWith(prefix))) return false;
  if (['low', 'medium', 'high', 'max'].includes(normalizedEffort)) return true;
  return normalizedEffort === 'xhigh'
    && XHIGH_EFFORT_MODEL_PREFIXES.some((prefix) => normalizedModel.startsWith(prefix));
}

function buildAnthropicEffortParam(modelId, effort) {
  const normalizedEffort = String(effort || '').trim().toLowerCase();
  if (!supportsAnthropicEffort(modelId, normalizedEffort)) return {};
  return { output_config: { effort: normalizedEffort } };
}

// Sampling parameters (temperature, top_p, top_k) are REMOVED on these models —
// sending any of them returns a 400. Older models (incl. opus-4-5/4-6, sonnet-4-6)
// still accept them.
const SAMPLING_PARAMS_REJECTED_MODEL_PREFIXES = [
  'claude-fable',
  'claude-mythos',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-sonnet-5',
];

function modelRejectsSamplingParams(modelId) {
  if (typeof modelId !== 'string' || !modelId) return false;
  const normalized = modelId.trim().toLowerCase();
  return SAMPLING_PARAMS_REJECTED_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

module.exports = {
  ADAPTIVE_THINKING_MODEL_PREFIXES,
  SAMPLING_PARAMS_REJECTED_MODEL_PREFIXES,
  EFFORT_MODEL_PREFIXES,
  XHIGH_EFFORT_MODEL_PREFIXES,
  supportsAdaptiveThinking,
  supportsAnthropicEffort,
  modelRejectsSamplingParams,
  buildAnthropicThinkingParam,
  buildAnthropicEffortParam,
};
