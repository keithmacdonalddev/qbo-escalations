import { useCallback, useMemo, useState } from 'react';
import { tel, TEL } from '../lib/devTelemetry.js';
import {
  DEFAULT_PROVIDER,
  DEFAULT_REASONING_EFFORT,
  PROVIDER_IDS,
  getAlternateProvider,
  normalizeReasoningEffort,
} from '../lib/providerCatalog.js';

const STORAGE_KEY = 'qbo-ai-runtime-settings-v1';

export const DEFAULT_AI_SETTINGS = Object.freeze({
  context: {
    maxInputTokens: 12000,
    maxHistoryTurns: 12,
    systemBudgetPercent: 35,
    historyBudgetPercent: 40,
    retrievalBudgetPercent: 25,
  },
  knowledge: {
    mode: 'hybrid',
    retrievalTopK: 6,
    retrievalMinScore: 1,
    includeCitations: true,
    allowedCategories: [],
    allowedTemplates: [],
    allowedTopLevel: [],
  },
  memory: {
    policy: 'summary-recent',
    summarizeAfterTurns: 10,
    summaryMaxChars: 1200,
  },
  guardrails: {
    maxEstimatedRequestCostUsd: 0,
    dailyBudgetUsd: 0,
    onBudgetExceeded: 'warn',
  },
  providerStrategy: {
    defaultMode: 'single',
    defaultPrimaryProvider: DEFAULT_PROVIDER,
    defaultFallbackProvider: getAlternateProvider(DEFAULT_PROVIDER),
    reasoningEffort: DEFAULT_REASONING_EFFORT,
    timeoutMs: 0,
  },
  debug: {
    showContextDebug: false,
    emitContextDebugSse: false,
  },
});

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((v) => String(v || '').trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

function normalizePercents(contextRaw) {
  const defaults = DEFAULT_AI_SETTINGS.context;
  const rawSystem = clampInt(contextRaw.systemBudgetPercent, 5, 90, defaults.systemBudgetPercent);
  const rawHistory = clampInt(contextRaw.historyBudgetPercent, 5, 90, defaults.historyBudgetPercent);
  const rawRetrieval = clampInt(contextRaw.retrievalBudgetPercent, 5, 90, defaults.retrievalBudgetPercent);
  const sum = rawSystem + rawHistory + rawRetrieval || 100;
  const systemBudgetPercent = Math.round((rawSystem / sum) * 100);
  const historyBudgetPercent = Math.round((rawHistory / sum) * 100);
  const retrievalBudgetPercent = Math.max(0, 100 - systemBudgetPercent - historyBudgetPercent);
  return { systemBudgetPercent, historyBudgetPercent, retrievalBudgetPercent };
}

function normalizeAiSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const contextRaw = source.context && typeof source.context === 'object' ? source.context : {};
  const knowledgeRaw = source.knowledge && typeof source.knowledge === 'object' ? source.knowledge : {};
  const memoryRaw = source.memory && typeof source.memory === 'object' ? source.memory : {};
  const guardrailsRaw = source.guardrails && typeof source.guardrails === 'object' ? source.guardrails : {};
  const providerRaw = source.providerStrategy && typeof source.providerStrategy === 'object'
    ? source.providerStrategy
    : {};
  const debugRaw = source.debug && typeof source.debug === 'object' ? source.debug : {};

  const percents = normalizePercents(contextRaw);

  return {
    context: {
      maxInputTokens: clampInt(contextRaw.maxInputTokens, 1000, 200000, DEFAULT_AI_SETTINGS.context.maxInputTokens),
      maxHistoryTurns: clampInt(contextRaw.maxHistoryTurns, 2, 80, DEFAULT_AI_SETTINGS.context.maxHistoryTurns),
      systemBudgetPercent: percents.systemBudgetPercent,
      historyBudgetPercent: percents.historyBudgetPercent,
      retrievalBudgetPercent: percents.retrievalBudgetPercent,
    },
    knowledge: {
      mode: ['full-playbook', 'hybrid', 'retrieval-only'].includes(knowledgeRaw.mode)
        ? knowledgeRaw.mode
        : DEFAULT_AI_SETTINGS.knowledge.mode,
      retrievalTopK: clampInt(knowledgeRaw.retrievalTopK, 1, 20, DEFAULT_AI_SETTINGS.knowledge.retrievalTopK),
      retrievalMinScore: clampNumber(knowledgeRaw.retrievalMinScore, 0, 100, DEFAULT_AI_SETTINGS.knowledge.retrievalMinScore),
      includeCitations: knowledgeRaw.includeCitations !== false,
      allowedCategories: parseStringArray(knowledgeRaw.allowedCategories),
      allowedTemplates: parseStringArray(knowledgeRaw.allowedTemplates),
      allowedTopLevel: parseStringArray(knowledgeRaw.allowedTopLevel),
    },
    memory: {
      policy: ['recent-only', 'summary-recent', 'full-history'].includes(memoryRaw.policy)
        ? memoryRaw.policy
        : DEFAULT_AI_SETTINGS.memory.policy,
      summarizeAfterTurns: clampInt(memoryRaw.summarizeAfterTurns, 4, 80, DEFAULT_AI_SETTINGS.memory.summarizeAfterTurns),
      summaryMaxChars: clampInt(memoryRaw.summaryMaxChars, 300, 8000, DEFAULT_AI_SETTINGS.memory.summaryMaxChars),
    },
    guardrails: {
      maxEstimatedRequestCostUsd: clampNumber(
        guardrailsRaw.maxEstimatedRequestCostUsd,
        0,
        50,
        DEFAULT_AI_SETTINGS.guardrails.maxEstimatedRequestCostUsd
      ),
      dailyBudgetUsd: clampNumber(guardrailsRaw.dailyBudgetUsd, 0, 5000, DEFAULT_AI_SETTINGS.guardrails.dailyBudgetUsd),
      onBudgetExceeded: ['warn', 'fallback', 'block'].includes(guardrailsRaw.onBudgetExceeded)
        ? guardrailsRaw.onBudgetExceeded
        : DEFAULT_AI_SETTINGS.guardrails.onBudgetExceeded,
    },
    providerStrategy: {
      defaultMode: ['single', 'fallback', 'parallel'].includes(providerRaw.defaultMode)
        ? providerRaw.defaultMode
        : DEFAULT_AI_SETTINGS.providerStrategy.defaultMode,
      defaultPrimaryProvider: PROVIDER_IDS.includes(providerRaw.defaultPrimaryProvider)
        ? providerRaw.defaultPrimaryProvider
        : DEFAULT_AI_SETTINGS.providerStrategy.defaultPrimaryProvider,
      defaultFallbackProvider: PROVIDER_IDS.includes(providerRaw.defaultFallbackProvider)
        ? providerRaw.defaultFallbackProvider
        : DEFAULT_AI_SETTINGS.providerStrategy.defaultFallbackProvider,
      reasoningEffort: normalizeReasoningEffort(providerRaw.reasoningEffort),
      timeoutMs: clampInt(providerRaw.timeoutMs, 0, 900000, DEFAULT_AI_SETTINGS.providerStrategy.timeoutMs),
    },
    debug: {
      showContextDebug: Boolean(debugRaw.showContextDebug),
      emitContextDebugSse: Boolean(debugRaw.emitContextDebugSse),
    },
  };
}

function readStoredAiSettings() {
  if (typeof window === 'undefined') return DEFAULT_AI_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AI_SETTINGS;
    return normalizeAiSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

function deepSet(source, path, value) {
  const keys = String(path || '').split('.').filter(Boolean);
  if (keys.length === 0) return source;
  const next = { ...source };
  let cursor = next;
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (i === keys.length - 1) {
      cursor[key] = value;
      break;
    }
    cursor[key] = { ...(cursor[key] || {}) };
    cursor = cursor[key];
  }
  return next;
}

export default function useAiSettings() {
  const [aiSettings, setAiSettingsState] = useState(readStoredAiSettings);

  const setAiSettings = useCallback((nextValueOrUpdater) => {
    setAiSettingsState((prev) => {
      const nextRaw = typeof nextValueOrUpdater === 'function'
        ? nextValueOrUpdater(prev)
        : nextValueOrUpdater;
      const normalized = normalizeAiSettings(nextRaw);
      if (typeof window !== 'undefined') {
        try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized)); } catch {}
      }
      return normalized;
    });
  }, []);

  const updateAiSetting = useCallback((path, value) => {
    tel(TEL.USER_ACTION, `AI setting changed: ${path}`, { setting: path, value });
    setAiSettings((prev) => deepSet(prev, path, value));
  }, [setAiSettings]);

  const resetAiSettings = useCallback(() => {
    setAiSettings(DEFAULT_AI_SETTINGS);
  }, [setAiSettings]);

  const isAiModified = useMemo(() => (
    JSON.stringify(aiSettings) !== JSON.stringify(DEFAULT_AI_SETTINGS)
  ), [aiSettings]);

  return {
    aiSettings,
    setAiSettings,
    updateAiSetting,
    resetAiSettings,
    isAiModified,
  };
}

