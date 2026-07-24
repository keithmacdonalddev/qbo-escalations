'use strict';

const PROVIDER_FAMILIES = Object.freeze([
  ['openai', 'OpenAI'],
  ['kimi', 'Kimi'],
  ['gemini', 'Gemini'],
  ['anthropic', 'Anthropic API'],
  ['claude', 'Claude CLI'],
  ['codex', 'Codex CLI'],
  ['llm-gateway', 'LLM Gateway'],
  ['lm-studio', 'LM Studio'],
]);

function summarizeProviderAvailability(providers = {}) {
  const ready = [];
  const unavailable = [];

  for (const [id, label] of PROVIDER_FAMILIES) {
    const info = providers[id];
    if (!info || typeof info !== 'object') continue;
    const item = {
      id,
      label,
      reason: String(info.reason || '').trim(),
    };
    if (info.available) ready.push(item);
    else unavailable.push(item);
  }

  return { ready, unavailable };
}

function formatProviderAvailabilitySummary(providers = {}, options = {}) {
  const { ready, unavailable } = summarizeProviderAvailability(providers);
  const lines = [];

  if (ready.length > 0) {
    lines.push(`[providers] ✅ AI providers ready (${ready.length}): ${ready.map((item) => item.label).join(', ')}`);
  } else {
    lines.push('[providers] ❌ No AI provider is currently ready');
  }

  if (unavailable.length > 0) {
    const prefix = ready.length > 0 ? 'ℹ️ Other connections unavailable' : '⚠️ Connections needing attention';
    lines.push(`[providers] ${prefix} (${unavailable.length}): ${unavailable.map((item) => item.label).join(', ')}`);
  }

  if (options.verbose) {
    for (const item of unavailable) {
      lines.push(`[providers]   ${item.label}: ${item.reason || 'Unavailable'}`);
    }
  }

  return lines;
}

module.exports = {
  PROVIDER_FAMILIES,
  formatProviderAvailabilitySummary,
  summarizeProviderAvailability,
};
