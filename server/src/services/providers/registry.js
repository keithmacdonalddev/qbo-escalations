const claude = require('../claude');
const codex = require('../codex');
const { createChatAdapter } = require('./chat-provider');
const {
  PROVIDER_IDS,
  DEFAULT_PROVIDER_ID,
  getProviderMeta,
  getProviderFamily: getCatalogProviderFamily,
  getProviderLabel: getCatalogProviderLabel,
  getProviderTransport: getCatalogProviderTransport,
  getProviderModelId,
  isValidProvider: catalogIsValidProvider,
  normalizeProvider: normalizeCatalogProvider,
  getAlternateProvider: getCatalogAlternateProvider,
  getProviderOptions,
} = require('./catalog');

const DEFAULT_PROVIDER = DEFAULT_PROVIDER_ID;

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

const PROVIDER_DEFS = Object.freeze(
  PROVIDER_IDS.reduce((acc, id) => {
    const meta = getProviderMeta(id);
    const transport = meta?.transport || 'claude';
    const model = getProviderModelId(id);
    const isCodex = transport === 'codex';
    acc[id] = {
      id,
      label: getCatalogProviderLabel(id),
      family: getCatalogProviderFamily(id),
      supportsImageInput: isCodex
        ? toBool(process.env.CODEX_SUPPORTS_IMAGE_INPUT, true)
        : toBool(process.env.CLAUDE_SUPPORTS_IMAGE_INPUT, false),
      getChat: () => {
        if (isCodex) {
          return model
            ? (opts) => codex.chat({ ...opts, model })
            : codex.chat;
        }
        return model
          ? (opts) => claude.chat({ ...opts, model })
          : claude.chat;
      },
      getDefaultTimeoutMs: () => toInt(
        isCodex ? process.env.CODEX_CHAT_TIMEOUT_MS : process.env.CLAUDE_CHAT_TIMEOUT_MS,
        120_000
      ),
      getParse: () => {
        if (isCodex) {
          return model
            ? (input, options) => codex.parseEscalation(input, { ...options, model })
            : codex.parseEscalation;
        }
        return model
          ? (input, options) => claude.parseEscalation(input, { ...options, model })
          : claude.parseEscalation;
      },
      getDefaultParseTimeoutMs: () => toInt(
        isCodex ? process.env.CODEX_PARSE_TIMEOUT_MS : process.env.CLAUDE_PARSE_TIMEOUT_MS,
        120_000
      ),
    };
    return acc;
  }, {})
);

function getProviderIds() {
  return [...PROVIDER_IDS];
}

function getDefaultProvider() {
  return DEFAULT_PROVIDER;
}

function isValidProvider(provider) {
  return catalogIsValidProvider(provider);
}

function normalizeProvider(provider) {
  if (isValidProvider(provider)) return provider;
  console.warn(`[registry] Unknown provider "${provider}", falling back to "${DEFAULT_PROVIDER}"`);
  return normalizeCatalogProvider(provider);
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
  return getCatalogProviderLabel(provider);
}

function getProviderFamily(provider) {
  return getCatalogProviderFamily(provider);
}

function getProviderTransport(provider) {
  return getCatalogProviderTransport(provider);
}

function getAlternateProvider(provider) {
  return getCatalogAlternateProvider(normalizeProvider(provider));
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
  getProviderTransport,
  getProviderModelId,
  getAlternateProvider,
  providerSupportsImageInput,
  getProviderOptions,
};
