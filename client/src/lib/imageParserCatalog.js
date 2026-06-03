import {
  PROVIDER_OPTIONS,
  getProviderDefaultModel,
  getProviderModelPlaceholder,
  getProviderModelSuggestions,
  getProviderShortLabel,
  getReasoningEffortOptions,
  normalizeModelOverride,
  resolveProviderSelection,
} from './providerCatalog.js';

export const IMAGE_PARSER_PROVIDER_OPTIONS = Object.freeze(
  PROVIDER_OPTIONS.map((option) => Object.freeze({
    value: option.value,
    label: option.label,
    shortLabel: option.shortLabel || option.label,
  }))
);

const SELECTABLE_IMAGE_PARSER_PROVIDER_IDS = new Set(
  IMAGE_PARSER_PROVIDER_OPTIONS.map((option) => option.value)
);

export const DEFAULT_IMAGE_PARSER_MODELS = Object.freeze(
  IMAGE_PARSER_PROVIDER_OPTIONS.reduce((acc, option) => {
    const defaultModel = getProviderDefaultModel(option.value);
    acc[option.value] = defaultModel || (option.value === 'lm-studio' ? 'local' : 'auto');
    return acc;
  }, {})
);

export const IMAGE_PARSER_REASONING_EFFORT_OPTIONS = Object.freeze([
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
  { value: 'max', label: 'Max' },
]);

function uniqueSuggestions(suggestions) {
  const seen = new Set();
  return suggestions.filter((option) => {
    const key = `${option.provider}:${option.value}`;
    if (!option.value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const IMAGE_PARSER_MODEL_SUGGESTIONS = Object.freeze(uniqueSuggestions(
  IMAGE_PARSER_PROVIDER_OPTIONS.flatMap((providerOption) => {
    const suggestions = getProviderModelSuggestions(providerOption.value);
    if (suggestions.length > 0) {
      return suggestions.map((suggestion) => ({
        ...suggestion,
        provider: providerOption.value,
      }));
    }
    return [{
      value: DEFAULT_IMAGE_PARSER_MODELS[providerOption.value] || 'auto',
      provider: providerOption.value,
      label: getProviderShortLabel(providerOption.value),
    }];
  })
));

const IMAGE_PARSER_DETERMINISM_BY_PROVIDER = Object.freeze({
  claude: Object.freeze({
    tone: 'warn',
    label: 'Checked after AI reply',
    metric: 'Review recent pass/fail results',
    summary: 'Claude CLI answers are checked after the AI replies. Review recent test results before relying on this provider.',
  }),
  'llm-gateway': Object.freeze({
    tone: 'warn',
    label: 'Checked after AI reply',
    metric: 'Review recent pass/fail results',
    summary: 'Gateway routing can change which AI handles the request. Use recent test results before relying on this provider.',
  }),
  codex: Object.freeze({
    tone: 'warn',
    label: 'Checked after AI reply',
    metric: 'Review recent pass/fail results',
    summary: 'Codex model choices can vary by preset. Review recent test results before relying on this provider.',
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
    metric: 'Review recent test results',
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
  unknown: Object.freeze({
    tone: 'warn',
    label: 'Not rated yet',
    metric: 'Review recent pass/fail results',
    summary: 'This provider has not been rated in the app yet. Use recent test results before relying on it.',
  }),
});

export function resolveImageParserSelection(provider, model = '') {
  const normalizedModel = normalizeModelOverride(model);
  const providerValue = typeof provider === 'string' ? provider.trim() : '';
  if (!providerValue) return { provider: '', model: normalizedModel };

  const selection = resolveProviderSelection(providerValue, normalizedModel);
  if (SELECTABLE_IMAGE_PARSER_PROVIDER_IDS.has(selection.provider)) {
    return selection;
  }

  return { provider: '', model: normalizedModel };
}

export function getImageParserModelPlaceholder(provider) {
  return provider ? getProviderModelPlaceholder(provider) : 'Optional model override';
}

export function getImageParserReasoningEffortOptions(provider) {
  return provider ? getReasoningEffortOptions(provider) : [];
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
