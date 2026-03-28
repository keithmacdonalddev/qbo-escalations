import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useToast } from '../hooks/useToast.jsx';
import { apiFetch } from '../api/http.js';
import { DEFAULT_AI_SETTINGS } from '../hooks/useAiSettings.js';
import AiAssistantOverviewPanel from './AiAssistantOverviewPanel.jsx';
import AiAssistantProviderStrategyPanel, { MODE_OPTIONS } from './AiAssistantProviderStrategyPanel.jsx';
import AiAssistantSurfaceSelectors from './AiAssistantSurfaceSelectors.jsx';
import {
  DEFAULT_PROVIDER,
  DEFAULT_REASONING_EFFORT,
  PROVIDER_FAMILY,
  getAlternateProvider,
  getProviderShortLabel,
  getReasoningEffortOptions,
  normalizeProvider,
  normalizeReasoningEffort,
} from '../lib/providerCatalog.js';
import { patchAgentSessionsByPrefix } from '../lib/agentSessions.js';
import {
  resolveSurfaceMode,
  readBooleanPreference,
  readSurfaceSelection,
  writeStoredPreference,
  writeSurfacePreferences,
  SURFACE_DEFAULTS_APPLIED_EVENT,
} from '../lib/surfacePreferences.js';
import {
  IMAGE_PARSER_MODEL_SUGGESTIONS,
  IMAGE_PARSER_PROVIDER_OPTIONS,
  getImageParserModelPlaceholder,
} from '../lib/imageParserCatalog.js';
import { staggerChild, staggerContainer, transitions } from '../utils/motion.js';

const SYNC_SURFACE_PREFERENCE_KEY = 'qbo-ai-defaults-sync-surfaces';

const SURFACE_DEFINITIONS = [
  {
    id: 'chat',
    label: 'Chat',
    description: 'Main escalation assistant',
    defaultMode: 'single',
    supportedModes: ['single', 'fallback', 'parallel'],
    storage: {
      provider: 'qbo-chat-provider',
      mode: 'qbo-chat-mode',
      fallbackProvider: 'qbo-chat-fallback-provider',
      reasoningEffort: 'qbo-chat-reasoning-effort',
    },
  },
  {
    id: 'workspace',
    label: 'Workspace',
    description: 'Inbox, calendar, and background actions',
    defaultMode: 'fallback',
    supportedModes: ['single', 'fallback'],
    storage: {
      provider: 'qbo-workspace-provider',
      mode: 'qbo-workspace-mode',
      fallbackProvider: 'qbo-workspace-fallback-provider',
      reasoningEffort: 'qbo-workspace-reasoning-effort',
    },
  },
  {
    id: 'copilot',
    label: 'Copilot',
    description: 'Search, template, and analysis helper',
    defaultMode: 'fallback',
    supportedModes: ['single', 'fallback'],
    storage: {
      provider: 'qbo-copilot-provider',
      mode: 'qbo-copilot-mode',
      fallbackProvider: 'qbo-copilot-fallback-provider',
      reasoningEffort: 'qbo-copilot-reasoning-effort',
    },
  },
];

// ---------------------------------------------------------------------------
// Image Parser Settings — self-contained, independent of surface/catalog system
// ---------------------------------------------------------------------------
const IMAGE_PARSER_PROVIDERS = [
  { value: '', label: 'Disabled (use existing transcription)' },
  ...IMAGE_PARSER_PROVIDER_OPTIONS,
];
const IMAGE_PARSER_SETTINGS_MODEL_LIST_ID = 'assistant-image-parser-model-options';

function ImageParserSettings({ motionProps }) {
  const [provider, setProvider] = useState(() =>
    localStorage.getItem('qbo-image-parser-provider') || ''
  );
  const [model, setModel] = useState(() =>
    localStorage.getItem('qbo-image-parser-model') || ''
  );
  const [availability, setAvailability] = useState(null);
  const [checking, setChecking] = useState(false);
  const mountedRef = useRef(true);
  const modelSuggestions = provider
    ? IMAGE_PARSER_MODEL_SUGGESTIONS.filter((option) => option.provider === provider)
    : IMAGE_PARSER_MODEL_SUGGESTIONS;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Persist to localStorage on change
  useEffect(() => {
    localStorage.setItem('qbo-image-parser-provider', provider);
  }, [provider]);
  useEffect(() => {
    localStorage.setItem('qbo-image-parser-model', model);
  }, [model]);

  // Check availability on mount and when provider changes
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    apiFetch('/api/image-parser/status')
      .then((res) => res.json())
      .then((data) => { if (!cancelled && mountedRef.current) setAvailability(data); })
      .catch(() => { if (!cancelled && mountedRef.current) setAvailability(null); })
      .finally(() => { if (!cancelled && mountedRef.current) setChecking(false); });
    return () => { cancelled = true; };
  }, [provider]);

  const currentStatus = provider && availability?.providers?.[provider];
  let statusClass = 'image-parser-status--disabled';
  let statusLabel = 'No provider selected';

  if (checking) {
    statusClass = 'image-parser-status--checking';
    statusLabel = 'Checking...';
  } else if (provider && currentStatus) {
    if (currentStatus.available) {
      statusClass = 'image-parser-status--available';
      statusLabel = `${IMAGE_PARSER_PROVIDERS.find((p) => p.value === provider)?.label || provider} is online`;
    } else {
      statusClass = 'image-parser-status--unavailable';
      statusLabel = currentStatus.reason || 'Unavailable';
    }
  } else if (provider && availability && !currentStatus) {
    statusClass = 'image-parser-status--error';
    statusLabel = 'Could not check availability';
  }

  return (
    <motion.section className="assistant-settings-panel assistant-architecture-card" {...(motionProps || {})}>
      <div className="assistant-settings-panel-header">
        <div>
          <div className="assistant-settings-panel-title">Image Parser Agent</div>
          <p className="assistant-settings-panel-copy">
            Dedicated API-only agent for parsing escalation screenshots and INV lists.
            Runs independently from the main chat provider.
          </p>
        </div>
        <span className={`image-parser-status ${statusClass}`}>
          {statusLabel}
        </span>
      </div>

      <div className="assistant-field-grid assistant-field-grid--two">
        <label className="settings-ai-field">
          <span>Provider</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            {IMAGE_PARSER_PROVIDERS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <label className="settings-ai-field">
          <span>Model Override</span>
          <input
            type="text"
            value={model}
            placeholder={getImageParserModelPlaceholder(provider)}
            list={IMAGE_PARSER_SETTINGS_MODEL_LIST_ID}
            onChange={(e) => setModel(e.target.value)}
          />
          <datalist id={IMAGE_PARSER_SETTINGS_MODEL_LIST_ID}>
            {modelSuggestions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </datalist>
        </label>
      </div>
    </motion.section>
  );
}

function cloneSettings(settings) {
  return JSON.parse(JSON.stringify(settings || DEFAULT_AI_SETTINGS));
}

function deepSet(target, path, value) {
  const keys = String(path || '').split('.').filter(Boolean);
  if (keys.length === 0) return target;
  let cursor = target;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (index === keys.length - 1) {
      cursor[key] = value;
      return target;
    }
    cursor[key] = { ...(cursor[key] || {}) };
    cursor = cursor[key];
  }
  return target;
}

function parseCommaList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function formatModeLabel(value) {
  return MODE_OPTIONS.find((option) => option.value === value)?.label || value;
}

function buildSurfacePayloads(settings) {
  const requestedMode = settings?.providerStrategy?.defaultMode || 'single';
  const provider = normalizeProvider(settings?.providerStrategy?.defaultPrimaryProvider || DEFAULT_PROVIDER);
  const fallback = normalizeProvider(
    settings?.providerStrategy?.defaultFallbackProvider || getAlternateProvider(provider)
  );
  const reasoningEffort = normalizeReasoningEffort(
    settings?.providerStrategy?.reasoningEffort || DEFAULT_REASONING_EFFORT
  );

  return SURFACE_DEFINITIONS.reduce((accumulator, surface) => {
    accumulator[surface.id] = {
      provider,
      mode: resolveSurfaceMode(requestedMode, surface.supportedModes, surface.defaultMode),
      fallbackProvider: fallback === provider ? getAlternateProvider(provider) : fallback,
      reasoningEffort,
    };
    return accumulator;
  }, {});
}

function readSurfaceSelections() {
  return SURFACE_DEFINITIONS.map((surface) => readSurfaceSelection(surface, {
    defaultProvider: DEFAULT_PROVIDER,
    reasoningEffortFallback: DEFAULT_REASONING_EFFORT,
  }));
}

function syncSurfaceSelections(settings) {
  if (typeof window === 'undefined') return buildSurfacePayloads(settings);

  const surfaces = buildSurfacePayloads(settings);
  for (const surface of SURFACE_DEFINITIONS) {
    writeSurfacePreferences(surface.storage, surfaces[surface.id]);
  }

  patchAgentSessionsByPrefix('workspace:', (current) => ({
    ...current,
    provider: surfaces.workspace.provider,
    mode: surfaces.workspace.mode,
    fallbackProvider: surfaces.workspace.fallbackProvider,
    reasoningEffort: surfaces.workspace.reasoningEffort,
  }));

  patchAgentSessionsByPrefix('copilot:', (current) => ({
    ...current,
    provider: surfaces.copilot.provider,
    providerMode: surfaces.copilot.mode,
    fallbackProvider: surfaces.copilot.fallbackProvider,
    reasoningEffort: surfaces.copilot.reasoningEffort,
  }));

  window.dispatchEvent(new CustomEvent(SURFACE_DEFAULTS_APPLIED_EVENT, { detail: { surfaces } }));
  return surfaces;
}

function normalizeDraftSettings(nextDraft) {
  const primary = normalizeProvider(nextDraft.providerStrategy?.defaultPrimaryProvider || DEFAULT_PROVIDER);
  const fallback = normalizeProvider(
    nextDraft.providerStrategy?.defaultFallbackProvider || getAlternateProvider(primary)
  );
  const resolvedFallback = fallback === primary ? getAlternateProvider(primary) : fallback;
  const allowedEfforts = getReasoningEffortOptions(PROVIDER_FAMILY[primary] || 'claude');
  const currentEffort = normalizeReasoningEffort(
    nextDraft.providerStrategy?.reasoningEffort || DEFAULT_REASONING_EFFORT
  );
  const resolvedEffort = allowedEfforts.some((option) => option.value === currentEffort)
    ? currentEffort
    : (allowedEfforts.find((option) => option.value === 'high')?.value || allowedEfforts[0]?.value || DEFAULT_REASONING_EFFORT);

  nextDraft.providerStrategy.defaultPrimaryProvider = primary;
  nextDraft.providerStrategy.defaultFallbackProvider = resolvedFallback;
  nextDraft.providerStrategy.reasoningEffort = resolvedEffort;
  return nextDraft;
}

function LayersIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z" />
      <path d="m3 12 9 4.5 9-4.5" />
      <path d="m3 16.5 9 4.5 9-4.5" />
    </svg>
  );
}

function ShieldIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 5 6v6c0 4.4 2.7 8.5 7 9 4.3-.5 7-4.6 7-9V6l-7-3Z" />
    </svg>
  );
}

function BrainIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 4a3.5 3.5 0 0 0-3.5 3.5v9A3.5 3.5 0 0 0 9.5 20" />
      <path d="M14.5 4A3.5 3.5 0 0 1 18 7.5v9a3.5 3.5 0 0 1-3.5 3.5" />
      <path d="M9.5 4a2.5 2.5 0 0 1 5 0" />
      <path d="M8 10h2" />
      <path d="M8 14h2" />
      <path d="M14 10h2" />
      <path d="M14 14h2" />
      <path d="M12 8v8" />
    </svg>
  );
}

function ChevronIcon({ open }) {
  return (
    <motion.svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      animate={{ rotate: open ? 180 : 0 }}
      transition={transitions.springSnappy}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </motion.svg>
  );
}

export default function AiAssistantSettingsPanel({ aiProps, liveRegionRef }) {
  const toast = useToast();
  const shouldReduceMotion = useReducedMotion();
  const aiSettings = aiProps?.aiSettings || DEFAULT_AI_SETTINGS;
  const setAiSettings = aiProps?.setAiSettings;

  const [draft, setDraft] = useState(() => cloneSettings(aiSettings));
  const [saveState, setSaveState] = useState('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [syncSurfaceSelectors, setSyncSurfaceSelectors] = useState(() => readBooleanPreference(SYNC_SURFACE_PREFERENCE_KEY, true));
  const [surfaceSelections, setSurfaceSelections] = useState(() => readSurfaceSelections());
  const [openSections, setOpenSections] = useState({
    orchestration: false,
    context: false,
    memory: false,
  });

  useEffect(() => {
    setDraft(cloneSettings(aiSettings));
    setSurfaceSelections(readSurfaceSelections());
    setSaveState('idle');
    setSaveMessage('');
  }, [aiSettings]);

  useEffect(() => {
    writeStoredPreference(SYNC_SURFACE_PREFERENCE_KEY, String(syncSurfaceSelectors));
  }, [syncSurfaceSelectors]);

  useEffect(() => {
    if (saveState !== 'success') return undefined;
    const timerId = window.setTimeout(() => {
      setSaveState((current) => (current === 'success' ? 'idle' : current));
      setSaveMessage((current) => (current === saveMessage ? '' : current));
    }, 3200);
    return () => window.clearTimeout(timerId);
  }, [saveMessage, saveState]);

  const announce = useCallback((message) => {
    if (!liveRegionRef?.current || !message) return;
    liveRegionRef.current.textContent = message;
  }, [liveRegionRef]);

  const updateDraft = useCallback((updater) => {
    setSaveState('idle');
    setSaveMessage('');
    setDraft((previous) => {
      const next = cloneSettings(previous);
      updater(next);
      return normalizeDraftSettings(next);
    });
  }, []);

  const updateField = useCallback((path, value) => {
    updateDraft((next) => {
      deepSet(next, path, value);
    });
  }, [updateDraft]);

  const updateListField = useCallback((path, value) => {
    updateDraft((next) => {
      deepSet(next, path, parseCommaList(value));
    });
  }, [updateDraft]);

  const handleDiscard = useCallback(() => {
    setDraft(cloneSettings(aiSettings));
    setSaveState('idle');
    setSaveMessage('');
    announce('Unsaved AI settings changes discarded.');
  }, [aiSettings, announce]);

  const handleResetDraft = useCallback(() => {
    setDraft(cloneSettings(DEFAULT_AI_SETTINGS));
    setSaveState('idle');
    setSaveMessage('');
    announce('AI settings draft reset to factory defaults.');
  }, [announce]);

  const currentPrimary = draft.providerStrategy.defaultPrimaryProvider;
  const currentFallback = draft.providerStrategy.defaultFallbackProvider;
  const currentMode = draft.providerStrategy.defaultMode;
  const currentEffortOptions = useMemo(
    () => getReasoningEffortOptions(PROVIDER_FAMILY[currentPrimary] || 'claude'),
    [currentPrimary],
  );
  const selectedMode = MODE_OPTIONS.find((option) => option.value === currentMode) || MODE_OPTIONS[0];
  const selectedPrimaryLabel = getProviderShortLabel(currentPrimary);
  const selectedFallbackLabel = getProviderShortLabel(currentFallback);
  const hasChanges = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(aiSettings),
    [draft, aiSettings],
  );

  const summaryPills = [
    { label: 'Application Default', value: selectedPrimaryLabel },
    { label: 'Request Strategy', value: formatModeLabel(currentMode) },
    { label: 'Fallback Model', value: selectedFallbackLabel },
    {
      label: 'Reasoning',
      value: currentEffortOptions.find((option) => option.value === draft.providerStrategy.reasoningEffort)?.label
        || draft.providerStrategy.reasoningEffort,
    },
  ];

  const orchestrationSummary = [
    `${draft.guardrails.maxEstimatedRequestCostUsd === 0 ? 'No per-request cap' : `$${draft.guardrails.maxEstimatedRequestCostUsd} request cap`}`,
    `${draft.guardrails.dailyBudgetUsd === 0 ? 'No daily cap' : `$${draft.guardrails.dailyBudgetUsd} daily budget`}`,
    `${draft.sessionBudget.costLimitUsd === 0 ? 'Unlimited session spend' : `$${draft.sessionBudget.costLimitUsd} session limit`}`,
  ];

  const contextSummary = [
    `${draft.context.maxInputTokens.toLocaleString()} max tokens`,
    `${draft.context.maxHistoryTurns} history turns`,
    `${draft.knowledge.mode} retrieval`,
  ];

  const memorySummary = [
    draft.memory.policy,
    `Summarize after ${draft.memory.summarizeAfterTurns}`,
    draft.debug.showContextDebug ? 'Telemetry visible' : 'Telemetry hidden',
  ];

  const handleSave = useCallback(async () => {
    if (!setAiSettings) return;
    setSaveState('saving');
    setSaveMessage('Saving AI defaults...');

    if (typeof window !== 'undefined') {
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
    }

    let savedSettings = null;

    try {
      savedSettings = setAiSettings(draft);
      if (syncSurfaceSelectors) {
        syncSurfaceSelections(savedSettings);
        setSurfaceSelections(readSurfaceSelections());
      }

      const parallelFallbackNotice = syncSurfaceSelectors && currentMode === 'parallel'
        ? ' Chat keeps parallel mode; Workspace and Copilot were synced to fallback because they do not support parallel.'
        : '';
      const nextMessage = syncSurfaceSelectors
        ? `AI defaults saved and pushed into the agent selectors.${parallelFallbackNotice}`
        : 'AI defaults saved. Existing agent selectors were left alone.';

      setSaveState('success');
      setSaveMessage(nextMessage);
      announce(nextMessage);
      toast.success(nextMessage, { duration: 4200 });
    } catch (error) {
      const nextMessage = savedSettings
        ? 'Application defaults were saved, but syncing the existing agent selectors failed.'
        : (error?.message || 'Could not save the AI defaults.');
      setSaveState('error');
      setSaveMessage(nextMessage);
      announce(nextMessage);
      toast.error(nextMessage, { duration: 5000 });
    }
  }, [
    announce,
    currentMode,
    draft,
    setAiSettings,
    syncSurfaceSelectors,
    toast,
  ]);

  const panelMotion = shouldReduceMotion ? {} : {
    variants: staggerContainer,
    initial: 'initial',
    animate: 'animate',
  };

  const itemMotion = shouldReduceMotion ? {} : {
    variants: staggerChild,
    transition: transitions.springGentle,
  };

  return (
    <div className="settings-panel assistant-settings-shell">
      <AiAssistantOverviewPanel
        hasChanges={hasChanges}
        itemMotion={itemMotion}
        saveMessage={saveMessage}
        saveState={saveState}
        shouldReduceMotion={shouldReduceMotion}
        summaryPills={summaryPills}
        syncSurfaceSelectors={syncSurfaceSelectors}
        onDiscard={handleDiscard}
        onResetDraft={handleResetDraft}
        onSave={handleSave}
        onToggleSyncSurfaceSelectors={setSyncSurfaceSelectors}
      />

      <motion.div className="assistant-settings-layout" {...panelMotion}>
        <AiAssistantProviderStrategyPanel
          currentEffortOptions={currentEffortOptions}
          currentFallback={currentFallback}
          currentMode={currentMode}
          currentPrimary={currentPrimary}
          currentReasoningEffort={draft.providerStrategy.reasoningEffort}
          motionProps={itemMotion}
          selectedMode={selectedMode}
          selectedPrimaryLabel={selectedPrimaryLabel}
          shouldReduceMotion={shouldReduceMotion}
          timeoutMs={draft.providerStrategy.timeoutMs}
          updateField={updateField}
        />

        <AiAssistantSurfaceSelectors
          surfaceSelections={surfaceSelections}
          formatModeLabel={formatModeLabel}
          motionProps={itemMotion}
        />

        <ImageParserSettings motionProps={itemMotion} />

        <motion.div className="assistant-accordion-list" {...itemMotion}>
          <motion.section className="assistant-accordion-card" layout={!shouldReduceMotion} transition={transitions.springGentle}>
            <button
              type="button"
              className="assistant-accordion-trigger"
              onClick={() => setOpenSections((previous) => ({ ...previous, orchestration: !previous.orchestration }))}
            >
              <div className="assistant-accordion-copy">
                <div className="assistant-accordion-title"><ShieldIcon size={16} /> Cost, Session Limits, and Guardrails</div>
                <div className="assistant-accordion-summary">{orchestrationSummary.join(' • ')}</div>
              </div>
              <ChevronIcon open={openSections.orchestration} />
            </button>

            <AnimatePresence initial={false}>
              {openSections.orchestration && (
                <motion.div
                  key="orchestration"
                  className="assistant-accordion-content"
                  initial={shouldReduceMotion ? false : { opacity: 0, y: -8 }}
                  animate={shouldReduceMotion ? {} : { opacity: 1, y: 0 }}
                  exit={shouldReduceMotion ? {} : { opacity: 0, y: -8 }}
                  transition={transitions.normal}
                >
                  <div className="assistant-field-grid assistant-field-grid--two">
                    <label className="settings-ai-field">
                      <span>Max Request Cost (USD)</span>
                      <input
                        type="number"
                        min={0}
                        step={0.001}
                        value={draft.guardrails.maxEstimatedRequestCostUsd}
                        onChange={(event) => updateField('guardrails.maxEstimatedRequestCostUsd', Number(event.target.value))}
                      />
                    </label>
                    <label className="settings-ai-field">
                      <span>Daily Budget (USD)</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={draft.guardrails.dailyBudgetUsd}
                        onChange={(event) => updateField('guardrails.dailyBudgetUsd', Number(event.target.value))}
                      />
                    </label>
                    <label className="settings-ai-field">
                      <span>On Budget Exceed</span>
                      <select
                        value={draft.guardrails.onBudgetExceeded}
                        onChange={(event) => updateField('guardrails.onBudgetExceeded', event.target.value)}
                      >
                        <option value="warn">warn</option>
                        <option value="fallback">fallback</option>
                        <option value="block">block</option>
                      </select>
                    </label>
                    <label className="settings-ai-field">
                      <span>Session Token Limit</span>
                      <input
                        type="number"
                        min={0}
                        max={10000000}
                        step={10000}
                        value={draft.sessionBudget.tokenLimit}
                        onChange={(event) => updateField('sessionBudget.tokenLimit', Number(event.target.value))}
                      />
                    </label>
                    <label className="settings-ai-field settings-ai-field--full">
                      <span>Session Cost Limit (USD)</span>
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        step={0.1}
                        value={draft.sessionBudget.costLimitUsd}
                        onChange={(event) => updateField('sessionBudget.costLimitUsd', Number(event.target.value))}
                      />
                    </label>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>

          <motion.section className="assistant-accordion-card" layout={!shouldReduceMotion} transition={transitions.springGentle}>
            <button
              type="button"
              className="assistant-accordion-trigger"
              onClick={() => setOpenSections((previous) => ({ ...previous, context: !previous.context }))}
            >
              <div className="assistant-accordion-copy">
                <div className="assistant-accordion-title"><LayersIcon size={16} /> Context and Retrieval</div>
                <div className="assistant-accordion-summary">{contextSummary.join(' • ')}</div>
              </div>
              <ChevronIcon open={openSections.context} />
            </button>

            <AnimatePresence initial={false}>
              {openSections.context && (
                <motion.div
                  key="context"
                  className="assistant-accordion-content"
                  initial={shouldReduceMotion ? false : { opacity: 0, y: -8 }}
                  animate={shouldReduceMotion ? {} : { opacity: 1, y: 0 }}
                  exit={shouldReduceMotion ? {} : { opacity: 0, y: -8 }}
                  transition={transitions.normal}
                >
                  <div className="assistant-field-grid assistant-field-grid--three">
                    <label className="settings-ai-field">
                      <span>Max Input Tokens</span>
                      <input
                        type="number"
                        min={1000}
                        max={200000}
                        value={draft.context.maxInputTokens}
                        onChange={(event) => updateField('context.maxInputTokens', Number(event.target.value))}
                      />
                    </label>
                    <label className="settings-ai-field">
                      <span>Max History Turns</span>
                      <input
                        type="number"
                        min={2}
                        max={80}
                        value={draft.context.maxHistoryTurns}
                        onChange={(event) => updateField('context.maxHistoryTurns', Number(event.target.value))}
                      />
                    </label>
                    <label className="settings-ai-field">
                      <span>Knowledge Mode</span>
                      <select
                        value={draft.knowledge.mode}
                        onChange={(event) => updateField('knowledge.mode', event.target.value)}
                      >
                        <option value="hybrid">hybrid</option>
                        <option value="full-playbook">full-playbook</option>
                        <option value="retrieval-only">retrieval-only</option>
                      </select>
                    </label>
                    <label className="settings-ai-field">
                      <span>System %</span>
                      <input
                        type="number"
                        min={5}
                        max={90}
                        value={draft.context.systemBudgetPercent}
                        onChange={(event) => updateField('context.systemBudgetPercent', Number(event.target.value))}
                      />
                    </label>
                    <label className="settings-ai-field">
                      <span>History %</span>
                      <input
                        type="number"
                        min={5}
                        max={90}
                        value={draft.context.historyBudgetPercent}
                        onChange={(event) => updateField('context.historyBudgetPercent', Number(event.target.value))}
                      />
                    </label>
                    <label className="settings-ai-field">
                      <span>Retrieval %</span>
                      <input
                        type="number"
                        min={5}
                        max={90}
                        value={draft.context.retrievalBudgetPercent}
                        onChange={(event) => updateField('context.retrievalBudgetPercent', Number(event.target.value))}
                      />
                    </label>
                    <label className="settings-ai-field">
                      <span>Top K</span>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={draft.knowledge.retrievalTopK}
                        onChange={(event) => updateField('knowledge.retrievalTopK', Number(event.target.value))}
                      />
                    </label>
                    <label className="settings-ai-field">
                      <span>Min Score</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={draft.knowledge.retrievalMinScore}
                        onChange={(event) => updateField('knowledge.retrievalMinScore', Number(event.target.value))}
                      />
                    </label>
                    <label className="settings-ai-toggle settings-ai-toggle--full">
                      <input
                        type="checkbox"
                        checked={draft.knowledge.includeCitations}
                        onChange={(event) => updateField('knowledge.includeCitations', event.target.checked)}
                      />
                      <span>Include citation hints in model instructions</span>
                    </label>
                    <label className="settings-ai-field settings-ai-field--full">
                      <span>Allowed Categories</span>
                      <input
                        type="text"
                        value={draft.knowledge.allowedCategories.join(', ')}
                        placeholder="payroll, reconciliation"
                        onChange={(event) => updateListField('knowledge.allowedCategories', event.target.value)}
                      />
                    </label>
                    <label className="settings-ai-field settings-ai-field--full">
                      <span>Allowed Templates</span>
                      <input
                        type="text"
                        value={draft.knowledge.allowedTemplates.join(', ')}
                        placeholder="chat-responses, workaround"
                        onChange={(event) => updateListField('knowledge.allowedTemplates', event.target.value)}
                      />
                    </label>
                    <label className="settings-ai-field settings-ai-field--full">
                      <span>Allowed Top-Level Docs</span>
                      <input
                        type="text"
                        value={draft.knowledge.allowedTopLevel.join(', ')}
                        placeholder="triage, error-messages"
                        onChange={(event) => updateListField('knowledge.allowedTopLevel', event.target.value)}
                      />
                    </label>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>

          <motion.section className="assistant-accordion-card" layout={!shouldReduceMotion} transition={transitions.springGentle}>
            <button
              type="button"
              className="assistant-accordion-trigger"
              onClick={() => setOpenSections((previous) => ({ ...previous, memory: !previous.memory }))}
            >
              <div className="assistant-accordion-copy">
                <div className="assistant-accordion-title"><BrainIcon size={16} /> Memory and Diagnostics</div>
                <div className="assistant-accordion-summary">{memorySummary.join(' • ')}</div>
              </div>
              <ChevronIcon open={openSections.memory} />
            </button>

            <AnimatePresence initial={false}>
              {openSections.memory && (
                <motion.div
                  key="memory"
                  className="assistant-accordion-content"
                  initial={shouldReduceMotion ? false : { opacity: 0, y: -8 }}
                  animate={shouldReduceMotion ? {} : { opacity: 1, y: 0 }}
                  exit={shouldReduceMotion ? {} : { opacity: 0, y: -8 }}
                  transition={transitions.normal}
                >
                  <div className="assistant-field-grid assistant-field-grid--two">
                    <label className="settings-ai-field">
                      <span>Memory Policy</span>
                      <select
                        value={draft.memory.policy}
                        onChange={(event) => updateField('memory.policy', event.target.value)}
                      >
                        <option value="recent-only">recent-only</option>
                        <option value="summary-recent">summary-recent</option>
                        <option value="full-history">full-history</option>
                      </select>
                    </label>
                    <label className="settings-ai-field">
                      <span>Summarize After Turns</span>
                      <input
                        type="number"
                        min={4}
                        max={80}
                        value={draft.memory.summarizeAfterTurns}
                        onChange={(event) => updateField('memory.summarizeAfterTurns', Number(event.target.value))}
                      />
                    </label>
                    <label className="settings-ai-field settings-ai-field--full">
                      <span>Summary Max Chars</span>
                      <input
                        type="number"
                        min={300}
                        max={8000}
                        value={draft.memory.summaryMaxChars}
                        onChange={(event) => updateField('memory.summaryMaxChars', Number(event.target.value))}
                      />
                    </label>
                    <label className="settings-ai-toggle settings-ai-toggle--full">
                      <input
                        type="checkbox"
                        checked={draft.debug.showContextDebug}
                        onChange={(event) => updateField('debug.showContextDebug', event.target.checked)}
                      />
                      <span>Show context budget telemetry in chat</span>
                    </label>
                    <label className="settings-ai-toggle settings-ai-toggle--full">
                      <input
                        type="checkbox"
                        checked={draft.debug.emitContextDebugSse}
                        onChange={(event) => updateField('debug.emitContextDebugSse', event.target.checked)}
                      />
                      <span>Emit context debug data in SSE payloads</span>
                    </label>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        </motion.div>
      </motion.div>
    </div>
  );
}
