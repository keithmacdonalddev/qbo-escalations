export const IMAGE_PARSER_PROVIDER_OPTIONS = [
  { value: 'llm-gateway', label: 'LLM Gateway API' },
  { value: 'lm-studio', label: 'LM Studio (Local)' },
  { value: 'anthropic', label: 'Anthropic API' },
  { value: 'openai', label: 'OpenAI API' },
  { value: 'kimi', label: 'Kimi K2.5 (Moonshot)' },
  { value: 'gemini', label: 'Google Gemini API' },
];

export const DEFAULT_IMAGE_PARSER_MODELS = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  kimi: 'kimi-k2.5',
  gemini: 'gemini-3-flash-preview',
};

export const IMAGE_PARSER_MODEL_SUGGESTIONS = [
  { value: DEFAULT_IMAGE_PARSER_MODELS.anthropic, provider: 'anthropic', label: 'Claude Sonnet 4' },
  { value: DEFAULT_IMAGE_PARSER_MODELS.openai, provider: 'openai', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', provider: 'openai', label: 'GPT-4o Mini' },
  { value: DEFAULT_IMAGE_PARSER_MODELS.kimi, provider: 'kimi', label: 'Kimi K2.5' },
  { value: DEFAULT_IMAGE_PARSER_MODELS.gemini, provider: 'gemini', label: 'Gemini 3 Flash' },
];

export function getImageParserModelPlaceholder(provider) {
  const defaultModel = DEFAULT_IMAGE_PARSER_MODELS[provider];
  return defaultModel ? `Default: ${defaultModel}` : 'Auto-detect';
}
