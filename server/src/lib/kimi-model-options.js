'use strict';

const KIMI_K3_REASONING_EFFORTS = new Set(['low', 'high', 'max']);

function isKimiK3Model(model) {
  return /^kimi-k3(?:$|[-.])/i.test(String(model || '').trim());
}

function isKimiK27CodeModel(model) {
  return /^kimi-k2\.7-code(?:-highspeed)?$/i.test(String(model || '').trim());
}

function normalizeKimiK3ReasoningEffort(value) {
  const requested = String(value || '').trim().toLowerCase();
  if (KIMI_K3_REASONING_EFFORTS.has(requested)) return requested;
  if (['none', 'minimal', 'medium'].includes(requested)) {
    return requested === 'medium' ? 'high' : 'low';
  }
  if (['xhigh', 'ultra'].includes(requested)) return 'max';
  return '';
}

/**
 * Apply the request fields accepted by the selected Kimi Open Platform model.
 * K3 is always-reasoning and uses reasoning_effort plus max_completion_tokens.
 * K2.7 Code is also always-reasoning, but does not accept reasoning_effort.
 * Older K2 models retain the app's explicit thinking-disabled behavior.
 */
function applyKimiGenerationOptions(body, model, reasoningEffort, maxTokens = 4096) {
  if (!body || typeof body !== 'object') return body;

  delete body.temperature;
  delete body.top_p;
  delete body.topP;
  delete body.top_k;
  delete body.topK;
  delete body.n;
  delete body.presence_penalty;
  delete body.frequency_penalty;
  delete body.reasoning_effort;
  delete body.max_tokens;
  delete body.max_completion_tokens;

  if (isKimiK3Model(model)) {
    delete body.thinking;
    body.max_completion_tokens = maxTokens;
    const effort = normalizeKimiK3ReasoningEffort(reasoningEffort);
    if (effort) body.reasoning_effort = effort;
    return body;
  }

  body.max_tokens = maxTokens;
  if (isKimiK27CodeModel(model)) {
    delete body.thinking;
    return body;
  }

  body.thinking = { type: 'disabled' };
  return body;
}

module.exports = {
  applyKimiGenerationOptions,
  isKimiK27CodeModel,
  isKimiK3Model,
  normalizeKimiK3ReasoningEffort,
};
