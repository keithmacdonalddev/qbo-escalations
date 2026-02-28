const claude = require('../claude');
const codex = require('../codex');
const { createChatAdapter } = require('./chat-provider');

const DEFAULT_PROVIDER = 'claude';
const PROVIDER_IDS = ['claude', 'chatgpt-5.3-codex-high', 'claude-sonnet-4-6', 'gpt-5-mini'];

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return fallback;
}

const PROVIDER_FAMILIES = {
  claude: 'claude',
  'claude-sonnet-4-6': 'claude',
  'chatgpt-5.3-codex-high': 'codex',
  'gpt-5-mini': 'codex',
};

const PROVIDER_DEFS = {
  claude: {
    id: 'claude',
    label: 'Claude',
    family: 'claude',
    supportsImageInput: toBool(process.env.CLAUDE_SUPPORTS_IMAGE_INPUT, false),
    getChat: () => claude.chat,
    getDefaultTimeoutMs: () => toInt(process.env.CLAUDE_CHAT_TIMEOUT_MS, 120_000),
    getParse: () => claude.parseEscalation,
    getDefaultParseTimeoutMs: () => toInt(process.env.CLAUDE_PARSE_TIMEOUT_MS, 120_000),
  },
  'chatgpt-5.3-codex-high': {
    id: 'chatgpt-5.3-codex-high',
    label: 'ChatGPT 5.3 Codex (High)',
    family: 'codex',
    supportsImageInput: toBool(process.env.CODEX_SUPPORTS_IMAGE_INPUT, true),
    getChat: () => codex.chat,
    getDefaultTimeoutMs: () => toInt(process.env.CODEX_CHAT_TIMEOUT_MS, 120_000),
    getParse: () => codex.parseEscalation,
    getDefaultParseTimeoutMs: () => toInt(process.env.CODEX_PARSE_TIMEOUT_MS, 120_000),
  },
  'claude-sonnet-4-6': {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    family: 'claude',
    supportsImageInput: toBool(process.env.CLAUDE_SUPPORTS_IMAGE_INPUT, false),
    getChat: () => (opts) => claude.chat({ ...opts, model: 'claude-sonnet-4-6' }),
    getDefaultTimeoutMs: () => toInt(process.env.CLAUDE_CHAT_TIMEOUT_MS, 120_000),
    getParse: () => (input, options) => claude.parseEscalation(input, { ...options, model: 'claude-sonnet-4-6' }),
    getDefaultParseTimeoutMs: () => toInt(process.env.CLAUDE_PARSE_TIMEOUT_MS, 120_000),
  },
  'gpt-5-mini': {
    id: 'gpt-5-mini',
    label: 'GPT-5 Mini',
    family: 'codex',
    supportsImageInput: toBool(process.env.CODEX_SUPPORTS_IMAGE_INPUT, true),
    getChat: () => (opts) => codex.chat({ ...opts, model: 'gpt-5-mini' }),
    getDefaultTimeoutMs: () => toInt(process.env.CODEX_CHAT_TIMEOUT_MS, 120_000),
    getParse: () => (input, options) => codex.parseEscalation(input, { ...options, model: 'gpt-5-mini' }),
    getDefaultParseTimeoutMs: () => toInt(process.env.CODEX_PARSE_TIMEOUT_MS, 120_000),
  },
};

function getProviderIds() {
  return [...PROVIDER_IDS];
}

function getDefaultProvider() {
  return DEFAULT_PROVIDER;
}

function isValidProvider(provider) {
  return Boolean(provider && PROVIDER_DEFS[provider]);
}

function normalizeProvider(provider) {
  return isValidProvider(provider) ? provider : DEFAULT_PROVIDER;
}

function getProvider(provider) {
  const normalized = normalizeProvider(provider);
  const def = PROVIDER_DEFS[normalized];
  return {
    id: def.id,
    label: def.label,
    supportsImageInput: Boolean(def.supportsImageInput),
    chat: createChatAdapter(def.id, def.getChat()),
    defaultTimeoutMs: def.getDefaultTimeoutMs(),
    parseEscalation: def.getParse ? def.getParse() : null,
    defaultParseTimeoutMs: def.getDefaultParseTimeoutMs ? def.getDefaultParseTimeoutMs() : def.getDefaultTimeoutMs(),
  };
}

function getProviderLabel(provider) {
  return getProvider(provider).label;
}

function getProviderFamily(provider) {
  return PROVIDER_FAMILIES[provider] || PROVIDER_FAMILIES[normalizeProvider(provider)] || 'claude';
}

function getAlternateProvider(provider) {
  const normalized = normalizeProvider(provider);
  const family = getProviderFamily(normalized);
  return family === 'claude' ? 'chatgpt-5.3-codex-high' : 'claude';
}

function providerSupportsImageInput(provider) {
  const normalized = normalizeProvider(provider);
  return Boolean(PROVIDER_DEFS[normalized] && PROVIDER_DEFS[normalized].supportsImageInput);
}

module.exports = {
  getProviderIds,
  getDefaultProvider,
  isValidProvider,
  normalizeProvider,
  getProvider,
  getProviderLabel,
  getProviderFamily,
  getAlternateProvider,
  providerSupportsImageInput,
};
