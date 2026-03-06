const { normalizeProvider, getAlternateProvider } = require('../services/providers/registry');
const { DEFAULT_PROVIDER_ID } = require('../services/providers/catalog');

const KNOWLEDGE_MODES = new Set(['full-playbook', 'hybrid', 'retrieval-only']);
const MEMORY_POLICIES = new Set(['recent-only', 'summary-recent', 'full-history']);
const BUDGET_ACTIONS = new Set(['warn', 'fallback', 'block']);
const PROVIDER_MODES = new Set(['single', 'fallback', 'parallel']);
const REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);

const DEFAULT_CHAT_RUNTIME_SETTINGS = Object.freeze({
  context: Object.freeze({
    maxInputTokens: 12000,
    maxHistoryTurns: 12,
    systemBudgetPercent: 35,
    historyBudgetPercent: 40,
    retrievalBudgetPercent: 25,
  }),
  knowledge: Object.freeze({
    mode: 'hybrid',
    retrievalTopK: 6,
    retrievalMinScore: 1,
    includeCitations: true,
    allowedCategories: [],
    allowedTemplates: [],
    allowedTopLevel: [],
  }),
  memory: Object.freeze({
    policy: 'summary-recent',
    summarizeAfterTurns: 10,
    summaryMaxChars: 1200,
  }),
  guardrails: Object.freeze({
    maxEstimatedRequestCostUsd: 0,
    dailyBudgetUsd: 0,
    onBudgetExceeded: 'warn',
  }),
  providerStrategy: Object.freeze({
    defaultMode: 'single',
    defaultPrimaryProvider: DEFAULT_PROVIDER_ID,
    defaultFallbackProvider: getAlternateProvider(DEFAULT_PROVIDER_ID),
    reasoningEffort: 'high',
    timeoutMs: 0,
  }),
  debug: Object.freeze({
    showContextDebug: false,
    emitContextDebugSse: false,
  }),
});

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value, min, max, fallback) {
  const parsed = toNumber(value, fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeNameArray(value, maxItems = 64) {
  const raw = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(',') : []);
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const name = String(item || '').trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeBudgetPercents(input = {}) {
  const defaults = DEFAULT_CHAT_RUNTIME_SETTINGS.context;
  const rawSystem = clampInteger(input.systemBudgetPercent, 5, 90, defaults.systemBudgetPercent);
  const rawHistory = clampInteger(input.historyBudgetPercent, 5, 90, defaults.historyBudgetPercent);
  const rawRetrieval = clampInteger(input.retrievalBudgetPercent, 5, 90, defaults.retrievalBudgetPercent);
  const sum = rawSystem + rawHistory + rawRetrieval;
  if (!Number.isFinite(sum) || sum <= 0) {
    return {
      systemBudgetPercent: defaults.systemBudgetPercent,
      historyBudgetPercent: defaults.historyBudgetPercent,
      retrievalBudgetPercent: defaults.retrievalBudgetPercent,
    };
  }
  const systemBudgetPercent = Math.round((rawSystem / sum) * 100);
  const historyBudgetPercent = Math.round((rawHistory / sum) * 100);
  const retrievalBudgetPercent = Math.max(0, 100 - systemBudgetPercent - historyBudgetPercent);
  return {
    systemBudgetPercent,
    historyBudgetPercent,
    retrievalBudgetPercent,
  };
}

function normalizeChatRuntimeSettings(rawSettings) {
  const raw = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};

  const contextInput = raw.context && typeof raw.context === 'object' ? raw.context : {};
  const knowledgeInput = raw.knowledge && typeof raw.knowledge === 'object' ? raw.knowledge : {};
  const memoryInput = raw.memory && typeof raw.memory === 'object' ? raw.memory : {};
  const guardrailsInput = raw.guardrails && typeof raw.guardrails === 'object' ? raw.guardrails : {};
  const providerStrategyInput = raw.providerStrategy && typeof raw.providerStrategy === 'object'
    ? raw.providerStrategy
    : {};
  const debugInput = raw.debug && typeof raw.debug === 'object' ? raw.debug : {};

  const budgetPercents = normalizeBudgetPercents(contextInput);

  const defaultMode = PROVIDER_MODES.has(providerStrategyInput.defaultMode)
    ? providerStrategyInput.defaultMode
    : DEFAULT_CHAT_RUNTIME_SETTINGS.providerStrategy.defaultMode;
  const defaultPrimaryProvider = normalizeProvider(
    providerStrategyInput.defaultPrimaryProvider || DEFAULT_CHAT_RUNTIME_SETTINGS.providerStrategy.defaultPrimaryProvider
  );
  const requestedFallback = providerStrategyInput.defaultFallbackProvider
    || DEFAULT_CHAT_RUNTIME_SETTINGS.providerStrategy.defaultFallbackProvider;
  const normalizedFallback = normalizeProvider(requestedFallback);
  const defaultFallbackProvider = normalizedFallback === defaultPrimaryProvider
    ? getAlternateProvider(defaultPrimaryProvider)
    : normalizedFallback;

  const settings = {
    context: {
      maxInputTokens: clampInteger(contextInput.maxInputTokens, 1000, 200000, DEFAULT_CHAT_RUNTIME_SETTINGS.context.maxInputTokens),
      maxHistoryTurns: clampInteger(contextInput.maxHistoryTurns, 2, 80, DEFAULT_CHAT_RUNTIME_SETTINGS.context.maxHistoryTurns),
      systemBudgetPercent: budgetPercents.systemBudgetPercent,
      historyBudgetPercent: budgetPercents.historyBudgetPercent,
      retrievalBudgetPercent: budgetPercents.retrievalBudgetPercent,
    },
    knowledge: {
      mode: KNOWLEDGE_MODES.has(knowledgeInput.mode)
        ? knowledgeInput.mode
        : DEFAULT_CHAT_RUNTIME_SETTINGS.knowledge.mode,
      retrievalTopK: clampInteger(knowledgeInput.retrievalTopK, 1, 20, DEFAULT_CHAT_RUNTIME_SETTINGS.knowledge.retrievalTopK),
      retrievalMinScore: clampNumber(knowledgeInput.retrievalMinScore, 0, 100, DEFAULT_CHAT_RUNTIME_SETTINGS.knowledge.retrievalMinScore),
      includeCitations: knowledgeInput.includeCitations !== false,
      allowedCategories: normalizeNameArray(knowledgeInput.allowedCategories),
      allowedTemplates: normalizeNameArray(knowledgeInput.allowedTemplates),
      allowedTopLevel: normalizeNameArray(knowledgeInput.allowedTopLevel),
    },
    memory: {
      policy: MEMORY_POLICIES.has(memoryInput.policy)
        ? memoryInput.policy
        : DEFAULT_CHAT_RUNTIME_SETTINGS.memory.policy,
      summarizeAfterTurns: clampInteger(memoryInput.summarizeAfterTurns, 4, 80, DEFAULT_CHAT_RUNTIME_SETTINGS.memory.summarizeAfterTurns),
      summaryMaxChars: clampInteger(memoryInput.summaryMaxChars, 300, 8000, DEFAULT_CHAT_RUNTIME_SETTINGS.memory.summaryMaxChars),
    },
    guardrails: {
      maxEstimatedRequestCostUsd: clampNumber(
        guardrailsInput.maxEstimatedRequestCostUsd,
        0,
        50,
        DEFAULT_CHAT_RUNTIME_SETTINGS.guardrails.maxEstimatedRequestCostUsd
      ),
      dailyBudgetUsd: clampNumber(
        guardrailsInput.dailyBudgetUsd,
        0,
        5000,
        DEFAULT_CHAT_RUNTIME_SETTINGS.guardrails.dailyBudgetUsd
      ),
      onBudgetExceeded: BUDGET_ACTIONS.has(guardrailsInput.onBudgetExceeded)
        ? guardrailsInput.onBudgetExceeded
        : DEFAULT_CHAT_RUNTIME_SETTINGS.guardrails.onBudgetExceeded,
    },
    providerStrategy: {
      defaultMode,
      defaultPrimaryProvider,
      defaultFallbackProvider,
      reasoningEffort: REASONING_EFFORTS.has(providerStrategyInput.reasoningEffort)
        ? providerStrategyInput.reasoningEffort
        : DEFAULT_CHAT_RUNTIME_SETTINGS.providerStrategy.reasoningEffort,
      timeoutMs: clampInteger(providerStrategyInput.timeoutMs, 0, 900000, DEFAULT_CHAT_RUNTIME_SETTINGS.providerStrategy.timeoutMs),
    },
    debug: {
      showContextDebug: Boolean(debugInput.showContextDebug),
      emitContextDebugSse: Boolean(debugInput.emitContextDebugSse),
    },
  };

  return settings;
}

module.exports = {
  DEFAULT_CHAT_RUNTIME_SETTINGS,
  normalizeChatRuntimeSettings,
};

