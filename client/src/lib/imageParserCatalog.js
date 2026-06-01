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

const CODEX_DETERMINISM_PROFILES = Object.fromEntries(CODEX_IMAGE_PARSER_OPTIONS.map((option) => [
  option.value,
  Object.freeze({
    tone: 'warn',
    label: 'Checked after AI reply',
    metric: 'Review recent pass/fail results',
    summary: 'This model can vary between runs. The app checks the answer after the AI replies, so use recent test results before relying on it.',
  }),
]));

const IMAGE_PARSER_DETERMINISM_BY_PROVIDER = Object.freeze({
  'llm-gateway': Object.freeze({
    tone: 'warn',
    label: 'Checked after AI reply',
    metric: 'Review recent pass/fail results',
    summary: 'Gateway routing can change which AI handles the request. Use recent test results before relying on this provider.',
  }),
  'lm-studio': Object.freeze({
    tone: 'warn',
    label: 'Checked after AI reply',
    metric: 'Review recent pass/fail results',
    summary: 'Local model settings can vary. The app checks the answer after the AI replies, so review recent test results before relying on it.',
  }),
  anthropic: Object.freeze({
    tone: 'warn',
    label: 'Checked after AI reply',
    metric: 'Review recent pass/fail results',
    summary: 'The app checks this provider answer after the AI replies. Review recent test results before relying on it.',
  }),
  openai: Object.freeze({
    tone: 'ok',
    label: 'Good comparison option',
    metric: 'Watch recent pass/fail results',
    summary: 'This is a good provider to compare others against, but the recent test results still matter.',
  }),
  kimi: Object.freeze({
    tone: 'danger',
    label: 'Use carefully',
    metric: 'Do not use as the main comparison',
    summary: 'This provider requires settings that can make answers vary. Use it for trials, not as the main reliability comparison.',
  }),
  gemini: Object.freeze({
    tone: 'warn',
    label: 'Checked after AI reply',
    metric: 'Review recent pass/fail results',
    summary: 'Gemini answers are checked after the AI replies. Review recent test results before relying on this provider.',
  }),
  codex: Object.freeze({
    tone: 'warn',
    label: 'Checked after AI reply',
    metric: 'Review recent pass/fail results',
    summary: 'Codex model choices can vary by preset. Review recent test results before relying on this provider.',
  }),
  unknown: Object.freeze({
    tone: 'warn',
    label: 'Not rated yet',
    metric: 'Review recent pass/fail results',
    summary: 'This provider has not been rated in the app yet. Use recent test results before relying on it.',
  }),
  ...CODEX_DETERMINISM_PROFILES,
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
  { value: 'gemini-3.5-flash', provider: 'gemini', label: 'Gemini 3.5 Flash' },
  { value: 'gemini-3.1-pro-preview', provider: 'gemini', label: 'Gemini 3.1 Pro Preview' },
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

export function getImageParserDeterminismProfile(provider, model = '') {
  const providerValue = typeof provider === 'string' ? provider.trim() : '';
  const modelValue = typeof model === 'string' ? model.trim() : '';
  const profile = IMAGE_PARSER_DETERMINISM_BY_PROVIDER[providerValue]
    || IMAGE_PARSER_DETERMINISM_BY_PROVIDER[modelValue]
    || IMAGE_PARSER_DETERMINISM_BY_PROVIDER.unknown;

  return {
    ...profile,
    provider: providerValue,
    model: modelValue,
  };
}
