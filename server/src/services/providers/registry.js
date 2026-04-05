const claude = require('../claude');
const codex = require('../codex');
const lmStudio = require('../lm-studio');
const remoteApiProviders = require('../remote-api-providers');
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
  getSelectableProviderIds,
  getAllowedEfforts,
  getSupportsThinking,
  isAllowedEffort,
  getProviderCapabilities,
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

function getServiceForTransport(transport) {
  switch (transport) {
    case 'lm-studio':
      return lmStudio;
    case 'codex':
      return codex;
    case 'anthropic':
      return remoteApiProviders.anthropic;
    case 'llm-gateway':
      return remoteApiProviders.llmGateway;
    case 'openai':
      return remoteApiProviders.openai;
    case 'gemini':
      return remoteApiProviders.gemini;
    case 'kimi':
      return remoteApiProviders.kimi;
    case 'claude':
    default:
      return claude;
  }
}

function getTimeoutEnvValue(transport, kind) {
  switch (transport) {
    case 'lm-studio':
      return process.env.LM_STUDIO_CHAT_TIMEOUT_MS;
    case 'codex':
      return kind === 'transcribe'
        ? process.env.CODEX_TRANSCRIBE_TIMEOUT_MS
        : kind === 'parse'
          ? process.env.CODEX_PARSE_TIMEOUT_MS
          : process.env.CODEX_CHAT_TIMEOUT_MS;
    case 'anthropic':
      return kind === 'transcribe'
        ? process.env.ANTHROPIC_TRANSCRIBE_TIMEOUT_MS
        : kind === 'parse'
          ? process.env.ANTHROPIC_PARSE_TIMEOUT_MS
          : process.env.ANTHROPIC_CHAT_TIMEOUT_MS;
    case 'llm-gateway':
      return kind === 'transcribe'
        ? process.env.LLM_GATEWAY_TRANSCRIBE_TIMEOUT_MS
        : kind === 'parse'
          ? process.env.LLM_GATEWAY_PARSE_TIMEOUT_MS
          : process.env.LLM_GATEWAY_CHAT_TIMEOUT_MS;
    case 'openai':
      return kind === 'transcribe'
        ? process.env.OPENAI_TRANSCRIBE_TIMEOUT_MS
        : kind === 'parse'
          ? process.env.OPENAI_PARSE_TIMEOUT_MS
          : process.env.OPENAI_CHAT_TIMEOUT_MS;
    case 'gemini':
      return kind === 'transcribe'
        ? process.env.GEMINI_TRANSCRIBE_TIMEOUT_MS
        : kind === 'parse'
          ? process.env.GEMINI_PARSE_TIMEOUT_MS
          : process.env.GEMINI_CHAT_TIMEOUT_MS;
    case 'kimi':
      return kind === 'transcribe'
        ? process.env.KIMI_TRANSCRIBE_TIMEOUT_MS || process.env.MOONSHOT_TRANSCRIBE_TIMEOUT_MS
        : kind === 'parse'
          ? process.env.KIMI_PARSE_TIMEOUT_MS || process.env.MOONSHOT_PARSE_TIMEOUT_MS
          : process.env.KIMI_CHAT_TIMEOUT_MS || process.env.MOONSHOT_CHAT_TIMEOUT_MS;
    case 'claude':
    default:
      return kind === 'transcribe'
        ? process.env.CLAUDE_TRANSCRIBE_TIMEOUT_MS
        : kind === 'parse'
          ? process.env.CLAUDE_PARSE_TIMEOUT_MS
          : process.env.CLAUDE_CHAT_TIMEOUT_MS;
  }
}

const PROVIDER_DEFS = Object.freeze(
  PROVIDER_IDS.reduce((acc, id) => {
    const meta = getProviderMeta(id);
    const transport = meta?.transport || 'claude';
    const model = getProviderModelId(id);
    const service = getServiceForTransport(transport);
    const supportsImageInput = typeof service?.transcribeImage === 'function'
      ? transport === 'lm-studio'
        ? toBool(process.env.LM_STUDIO_SUPPORTS_IMAGE_INPUT, true)
        : transport === 'codex'
          ? toBool(process.env.CODEX_SUPPORTS_IMAGE_INPUT, true)
          : transport === 'claude'
            ? toBool(process.env.CLAUDE_SUPPORTS_IMAGE_INPUT, false)
            : false
      : false;

    function withDefaultModel(fn) {
      if (typeof fn !== 'function') return null;
      if (!model) return fn;
      return (...args) => {
        const lastArg = args[args.length - 1];
        if (lastArg && typeof lastArg === 'object' && !Array.isArray(lastArg)) {
          const nextArgs = [...args];
          nextArgs[nextArgs.length - 1] = { ...lastArg, model: lastArg.model || model };
          return fn(...nextArgs);
        }
        if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
          return fn({ ...args[0], model: args[0].model || model });
        }
        return fn(...args);
      };
    }

    acc[id] = {
      id,
      label: getCatalogProviderLabel(id),
      family: getCatalogProviderFamily(id),
      supportsImageInput,
      getChat: () => withDefaultModel(service?.chat),
      getDefaultTimeoutMs: () => toInt(getTimeoutEnvValue(transport, 'chat'), 120_000),
      getParse: () => withDefaultModel(service?.parseEscalation),
      getTranscribe: () => withDefaultModel(service?.transcribeImage),
      getDefaultParseTimeoutMs: () => toInt(
        getTimeoutEnvValue(transport, 'parse'),
        toInt(getTimeoutEnvValue(transport, 'chat'), 120_000)
      ),
      getDefaultTranscribeTimeoutMs: () => toInt(
        getTimeoutEnvValue(transport, 'transcribe'),
        toInt(getTimeoutEnvValue(transport, 'parse'), 60_000)
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
  const capabilities = getProviderCapabilities(normalized);
  return {
    id: def.id,
    label: def.label,
    supportsImageInput: Boolean(def.supportsImageInput),
    supportsThinking: capabilities.supportsThinking,
    allowedEfforts: capabilities.allowedEfforts,
    isAllowedEffort: (effort) => capabilities.allowedEfforts.includes(effort),
    chat: createChatAdapter(def.id, def.getChat()),
    defaultTimeoutMs: def.getDefaultTimeoutMs(),
    parseEscalation: def.getParse ? def.getParse() : null,
    defaultParseTimeoutMs: def.getDefaultParseTimeoutMs ? def.getDefaultParseTimeoutMs() : def.getDefaultTimeoutMs(),
    transcribeImage: def.getTranscribe ? def.getTranscribe() : null,
    defaultTranscribeTimeoutMs: def.getDefaultTranscribeTimeoutMs ? def.getDefaultTranscribeTimeoutMs() : def.getDefaultTimeoutMs(),
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
  getSelectableProviderIds,
  getAllowedEfforts,
  getSupportsThinking,
  isAllowedEffort,
};
