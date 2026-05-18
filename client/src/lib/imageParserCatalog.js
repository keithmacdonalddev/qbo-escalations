import { PROVIDER_CATALOG, normalizeModelOverride } from './providerCatalog.js';

const CODEX_IMAGE_PARSER_OPTIONS = PROVIDER_CATALOG
  .filter((entry) => entry.selectable !== false && entry.family === 'codex')
  .map((entry) => ({
    value: entry.id,
    label: entry.label,
    shortLabel: entry.shortLabel || entry.label,
    model: entry.model || entry.id,
  }));

const CODEX_IMAGE_PARSER_MODEL_OPTIONS = PROVIDER_CATALOG
  .filter((entry) => entry.family === 'codex' && entry.model)
  .map((entry) => ({
    value: entry.id,
    label: entry.label,
    shortLabel: entry.shortLabel || entry.label,
    model: entry.model,
  }));

export const IMAGE_PARSER_PROVIDER_OPTIONS = [
  { value: 'llm-gateway', label: 'LLM Gateway API' },
  ...CODEX_IMAGE_PARSER_OPTIONS.map(({ value, label, shortLabel }) => ({
    value,
    label,
    shortLabel,
  })),
  { value: 'lm-studio', label: 'LM Studio (Local)' },
  { value: 'anthropic', label: 'Anthropic API' },
  { value: 'openai', label: 'OpenAI API' },
  { value: 'kimi', label: 'Kimi K2.5 (Moonshot)' },
  { value: 'gemini', label: 'Google Gemini API' },
];

const CODEX_DEFAULT_IMAGE_PARSER_MODELS = Object.freeze(
  CODEX_IMAGE_PARSER_OPTIONS.reduce((acc, option) => {
    acc[option.value] = option.model;
    return acc;
  }, {})
);

export const DEFAULT_IMAGE_PARSER_MODELS = {
  ...CODEX_DEFAULT_IMAGE_PARSER_MODELS,
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-5.4-mini',
  kimi: 'kimi-k2.5',
  gemini: 'gemini-3-flash-preview',
};

export const IMAGE_PARSER_REASONING_EFFORT_OPTIONS = Object.freeze([
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
]);

const IMAGE_PARSER_EFFORTS_BY_PROVIDER = Object.freeze({
  openai: Object.freeze(['none', 'low', 'medium', 'high', 'xhigh']),
  ...Object.fromEntries(CODEX_IMAGE_PARSER_OPTIONS.map((option) => [
    option.value,
    Object.freeze(['low', 'medium', 'high', 'xhigh']),
  ])),
});

function formatCodexModelLabel(option) {
  const model = option.model || option.value;
  const label = option.label || option.shortLabel || model;
  const cleaned = label.replace(/^OpenAI Codex CLI\s*-\s*/i, '').trim();
  return cleaned && cleaned !== label ? cleaned : model;
}

function uniqueSuggestions(suggestions) {
  const seen = new Set();
  return suggestions.filter((option) => {
    const key = `${option.provider}:${option.value}`;
    if (!option.value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const IMAGE_PARSER_MODEL_SUGGESTIONS = uniqueSuggestions([
  ...CODEX_IMAGE_PARSER_MODEL_OPTIONS.map((option) => ({
    value: option.model,
    provider: 'codex',
    label: formatCodexModelLabel(option),
  })),
  { value: DEFAULT_IMAGE_PARSER_MODELS.anthropic, provider: 'anthropic', label: 'Claude Sonnet 4' },
  { value: DEFAULT_IMAGE_PARSER_MODELS.openai, provider: 'openai', label: 'GPT-5.4 Mini - high-volume parser' },
  { value: 'gpt-5.5', provider: 'openai', label: 'GPT-5.5 - hardest screenshots' },
  { value: 'gpt-5.4', provider: 'openai', label: 'GPT-5.4 - balanced frontier' },
  { value: 'gpt-5.4-nano', provider: 'openai', label: 'GPT-5.4 Nano - cheapest extraction' },
  { value: DEFAULT_IMAGE_PARSER_MODELS.kimi, provider: 'kimi', label: 'Kimi K2.5' },
  { value: DEFAULT_IMAGE_PARSER_MODELS.gemini, provider: 'gemini', label: 'Gemini 3 Flash' },
]);

export function resolveImageParserSelection(provider, model = '') {
  const normalizedModel = normalizeModelOverride(model);
  const providerValue = typeof provider === 'string' ? provider.trim() : '';
  if (!providerValue) return { provider: '', model: normalizedModel };

  if (IMAGE_PARSER_PROVIDER_OPTIONS.some((option) => option.value === providerValue)) {
    return { provider: providerValue, model: normalizedModel };
  }

  const codexPreset = CODEX_IMAGE_PARSER_MODEL_OPTIONS.find((option) => option.value === providerValue);
  if (codexPreset) {
    return {
      provider: 'codex',
      model: normalizedModel || codexPreset.model || '',
    };
  }

  return { provider: '', model: normalizedModel };
}

export function getImageParserModelPlaceholder(provider) {
  const defaultModel = DEFAULT_IMAGE_PARSER_MODELS[provider];
  return defaultModel ? `Default: ${defaultModel}` : 'Auto-detect';
}

export function getImageParserReasoningEffortOptions(provider) {
  const allowed = IMAGE_PARSER_EFFORTS_BY_PROVIDER[provider] || [];
  return IMAGE_PARSER_REASONING_EFFORT_OPTIONS.filter((option) => allowed.includes(option.value));
}

export function normalizeImageParserReasoningEffort(provider, value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) return '';
  return getImageParserReasoningEffortOptions(provider).some((option) => option.value === normalized)
    ? normalized
    : '';
}
