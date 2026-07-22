import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useToast } from '../hooks/useToast.jsx';
import { DEFAULT_AI_SETTINGS } from '../hooks/useAiSettings.js';
import { syncAiAssistantDefaultsToServer } from '../lib/aiAssistantPreferences.js';
import { staggerChild, staggerContainer, transitions } from '../utils/motion.js';

// ---------------------------------------------------------------------------
// NOTE: Per-agent provider / model / fallback editing lives ONLY on the Agents
// profile page (AgentsView). That page is the single source of truth — it writes
// the authoritative `AgentIdentity.runtime` store that the chat/triage/INV legs
// actually read. The duplicate per-agent cards that used to live here wrote a
// SEPARATE `UserPreferences` store that nothing on the runtime path consumed, so
// edits made here silently never took effect. They have been removed. This panel
// now owns only the cross-cutting AI settings (cost guardrails, context /
// retrieval budgets, memory policy, debug telemetry).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Utility / icons
// ---------------------------------------------------------------------------
function ChevronIcon({ open }) {
  return (
    <motion.svg
      width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round"
      animate={{ rotate: open ? 180 : 0 }}
      transition={transitions.springSnappy}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </motion.svg>
  );
}

function ShieldIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 5 6v6c0 4.4 2.7 8.5 7 9 4.3-.5 7-4.6 7-9V6l-7-3Z" />
    </svg>
  );
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

function BrainIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 4a3.5 3.5 0 0 0-3.5 3.5v9A3.5 3.5 0 0 0 9.5 20" />
      <path d="M14.5 4A3.5 3.5 0 0 1 18 7.5v9a3.5 3.5 0 0 1-3.5 3.5" />
      <path d="M9.5 4a2.5 2.5 0 0 1 5 0" />
      <path d="M8 10h2" /><path d="M8 14h2" /><path d="M14 10h2" /><path d="M14 14h2" />
      <path d="M12 8v8" />
    </svg>
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
  return String(value || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export default function AiAssistantSettingsPanel({ aiProps, liveRegionRef }) {
  const toast = useToast();
  const shouldReduceMotion = useReducedMotion();
  const aiSettings = aiProps?.aiSettings || DEFAULT_AI_SETTINGS;
  const setAiSettings = aiProps?.setAiSettings;

  // Global settings draft (context / memory / guardrails)
  const [draft, setDraft] = useState(() => cloneSettings(aiSettings));
  const [savedGlobalState, setSavedGlobalState] = useState(() => cloneSettings(aiSettings));
  const [saveState, setSaveState] = useState('idle');
  const [openSections, setOpenSections] = useState({ cost: false, context: false, memory: false });

  // Sync global draft when aiSettings prop changes (e.g. reset from outside)
  useEffect(() => {
    const next = cloneSettings(aiSettings);
    setDraft(next);
    setSavedGlobalState(next);
  }, [aiSettings]);

  // Reset save state timer after success — 1400ms matches the Dynamic Island hold duration
  useEffect(() => {
    if (saveState !== 'success') return undefined;
    const id = window.setTimeout(() => setSaveState('idle'), 1400);
    return () => window.clearTimeout(id);
  }, [saveState]);

  const announce = useCallback((message) => {
    if (!liveRegionRef?.current || !message) return;
    liveRegionRef.current.textContent = message;
  }, [liveRegionRef]);

  // Dirty check — true if the global draft differs from saved
  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(savedGlobalState),
    [draft, savedGlobalState]
  );

  const updateField = useCallback((path, value) => {
    setDraft((previous) => {
      const next = cloneSettings(previous);
      deepSet(next, path, value);
      return next;
    });
  }, []);

  const updateListField = useCallback((path, value) => {
    updateField(path, parseCommaList(value));
  }, [updateField]);

  const handleDiscard = useCallback(() => {
    setDraft(cloneSettings(savedGlobalState));
    setSaveState('idle');
    announce('Changes discarded.');
  }, [savedGlobalState, announce]);

  const handleSave = useCallback(async () => {
    setSaveState('saving');
    try {
      // Persist global settings only. Per-agent runtime is owned by AgentsView
      // (the authoritative AgentIdentity.runtime store), so we no longer send an
      // `agents` map from here — doing so would write the orphaned
      // UserPreferences agent store the runtime path ignores.
      const savedDefaults = await syncAiAssistantDefaultsToServer({
        settings: draft,
      });
      const savedSettings = savedDefaults?.settings || draft;

      // Apply the server-confirmed value locally only after persistence
      // succeeds. A failed save no longer changes live browser behavior.
      if (setAiSettings) setAiSettings(savedSettings);

      setSavedGlobalState(cloneSettings(savedSettings));
      setSaveState('success');
      const msg = 'AI settings saved.';
      announce(msg);
      toast.success(msg, { duration: 3500 });
    } catch (err) {
      setSaveState('error');
      const msg = err?.message || 'Could not save AI settings.';
      announce(msg);
      toast.error(msg, { duration: 5000 });
    }
  }, [draft, setAiSettings, announce, toast]);

  // Accordion section summaries
  const costSummary = [
    draft.guardrails.maxEstimatedRequestCostUsd === 0 ? 'No per-request cap' : `$${draft.guardrails.maxEstimatedRequestCostUsd} request cap`,
    draft.guardrails.dailyBudgetUsd === 0 ? 'No daily cap' : `$${draft.guardrails.dailyBudgetUsd} daily budget`,
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
    <div className="settings-panel agent-settings-shell">
      {/* ── Header ── */}
      <motion.div className="agent-settings-header" {...itemMotion}>
        <div className="agent-settings-header-text">
          <h2 className="agent-settings-title">AI Safety &amp; Context</h2>
          <p className="agent-settings-subtitle">
            Global cost, context, memory, and diagnostic limits.
          </p>
        </div>
      </motion.div>

      {/* ── Accordions ── */}
      <motion.div className="agent-accordion-list" {...panelMotion}>

        {/* Cost & Guardrails */}
        <motion.section className="agent-accordion-card" layout={!shouldReduceMotion} transition={transitions.springGentle} {...itemMotion}>
          <button
            type="button"
            className="agent-accordion-trigger"
            onClick={() => setOpenSections((p) => ({ ...p, cost: !p.cost }))}
          >
            <div className="agent-accordion-copy">
              <div className="agent-accordion-title"><ShieldIcon size={15} /> Cost &amp; Guardrails</div>
              <div className="agent-accordion-summary">{costSummary.join(' · ')}</div>
            </div>
            <ChevronIcon open={openSections.cost} />
          </button>

          <AnimatePresence initial={false}>
            {openSections.cost && (
              <motion.div
                key="cost"
                className="agent-accordion-content"
                initial={shouldReduceMotion ? false : { opacity: 0, y: -6 }}
                animate={shouldReduceMotion ? {} : { opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? {} : { opacity: 0, y: -6 }}
                transition={transitions.normal}
              >
                <div className="agent-field-grid agent-field-grid--two">
                  <label className="settings-ai-field">
                    <span>Max Request Cost (USD)</span>
                    <input type="number" min={0} step={0.001}
                      value={draft.guardrails.maxEstimatedRequestCostUsd}
                      onChange={(e) => updateField('guardrails.maxEstimatedRequestCostUsd', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <span>Daily Budget (USD)</span>
                    <input type="number" min={0} step={0.01}
                      value={draft.guardrails.dailyBudgetUsd}
                      onChange={(e) => updateField('guardrails.dailyBudgetUsd', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <span>On Budget Exceed</span>
                    <select value={draft.guardrails.onBudgetExceeded}
                      onChange={(e) => updateField('guardrails.onBudgetExceeded', e.target.value)}>
                      <option value="warn">warn</option>
                      <option value="fallback">fallback</option>
                      <option value="block">block</option>
                    </select>
                  </label>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

        {/* Context & Retrieval */}
        <motion.section className="agent-accordion-card" layout={!shouldReduceMotion} transition={transitions.springGentle} {...itemMotion}>
          <button
            type="button"
            className="agent-accordion-trigger"
            onClick={() => setOpenSections((p) => ({ ...p, context: !p.context }))}
          >
            <div className="agent-accordion-copy">
              <div className="agent-accordion-title"><LayersIcon size={15} /> Context &amp; Retrieval</div>
              <div className="agent-accordion-summary">{contextSummary.join(' · ')}</div>
            </div>
            <ChevronIcon open={openSections.context} />
          </button>

          <AnimatePresence initial={false}>
            {openSections.context && (
              <motion.div
                key="context"
                className="agent-accordion-content"
                initial={shouldReduceMotion ? false : { opacity: 0, y: -6 }}
                animate={shouldReduceMotion ? {} : { opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? {} : { opacity: 0, y: -6 }}
                transition={transitions.normal}
              >
                <div className="agent-field-grid agent-field-grid--three">
                  <label className="settings-ai-field">
                    <span>Max Input Tokens</span>
                    <input type="number" min={1000} max={200000}
                      value={draft.context.maxInputTokens}
                      onChange={(e) => updateField('context.maxInputTokens', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <span>Max History Turns</span>
                    <input type="number" min={2} max={80}
                      value={draft.context.maxHistoryTurns}
                      onChange={(e) => updateField('context.maxHistoryTurns', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <span>Knowledge Mode</span>
                    <select value={draft.knowledge.mode}
                      onChange={(e) => updateField('knowledge.mode', e.target.value)}>
                      <option value="hybrid">hybrid</option>
                      <option value="full-playbook">full-playbook</option>
                      <option value="retrieval-only">retrieval-only</option>
                    </select>
                  </label>
                  <label className="settings-ai-field">
                    <span>System %</span>
                    <input type="number" min={5} max={90}
                      value={draft.context.systemBudgetPercent}
                      onChange={(e) => updateField('context.systemBudgetPercent', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <span>History %</span>
                    <input type="number" min={5} max={90}
                      value={draft.context.historyBudgetPercent}
                      onChange={(e) => updateField('context.historyBudgetPercent', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <span>Retrieval %</span>
                    <input type="number" min={5} max={90}
                      value={draft.context.retrievalBudgetPercent}
                      onChange={(e) => updateField('context.retrievalBudgetPercent', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <span>Top K</span>
                    <input type="number" min={1} max={20}
                      value={draft.knowledge.retrievalTopK}
                      onChange={(e) => updateField('knowledge.retrievalTopK', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <span>Min Score</span>
                    <input type="number" min={0} max={100} step={0.1}
                      value={draft.knowledge.retrievalMinScore}
                      onChange={(e) => updateField('knowledge.retrievalMinScore', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-toggle settings-ai-toggle--full">
                    <input type="checkbox"
                      checked={draft.knowledge.includeCitations}
                      onChange={(e) => updateField('knowledge.includeCitations', e.target.checked)}
                    />
                    <span>Include citation hints in model instructions</span>
                  </label>
                  <label className="settings-ai-field settings-ai-field--full">
                    <span>Allowed Categories</span>
                    <input type="text"
                      value={draft.knowledge.allowedCategories.join(', ')}
                      placeholder="payroll, reconciliation"
                      onChange={(e) => updateListField('knowledge.allowedCategories', e.target.value)}
                    />
                  </label>
                  <label className="settings-ai-field settings-ai-field--full">
                    <span>Allowed Templates</span>
                    <input type="text"
                      value={draft.knowledge.allowedTemplates.join(', ')}
                      placeholder="chat-responses, workaround"
                      onChange={(e) => updateListField('knowledge.allowedTemplates', e.target.value)}
                    />
                  </label>
                  <label className="settings-ai-field settings-ai-field--full">
                    <span>Allowed Top-Level Docs</span>
                    <input type="text"
                      value={draft.knowledge.allowedTopLevel.join(', ')}
                      placeholder="triage, error-messages"
                      onChange={(e) => updateListField('knowledge.allowedTopLevel', e.target.value)}
                    />
                  </label>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

        {/* Memory & Debug */}
        <motion.section className="agent-accordion-card" layout={!shouldReduceMotion} transition={transitions.springGentle} {...itemMotion}>
          <button
            type="button"
            className="agent-accordion-trigger"
            onClick={() => setOpenSections((p) => ({ ...p, memory: !p.memory }))}
          >
            <div className="agent-accordion-copy">
              <div className="agent-accordion-title"><BrainIcon size={15} /> Memory &amp; Debug</div>
              <div className="agent-accordion-summary">{memorySummary.join(' · ')}</div>
            </div>
            <ChevronIcon open={openSections.memory} />
          </button>

          <AnimatePresence initial={false}>
            {openSections.memory && (
              <motion.div
                key="memory"
                className="agent-accordion-content"
                initial={shouldReduceMotion ? false : { opacity: 0, y: -6 }}
                animate={shouldReduceMotion ? {} : { opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? {} : { opacity: 0, y: -6 }}
                transition={transitions.normal}
              >
                <div className="agent-field-grid agent-field-grid--two">
                  <label className="settings-ai-field">
                    <span>Memory Policy</span>
                    <select value={draft.memory.policy}
                      onChange={(e) => updateField('memory.policy', e.target.value)}>
                      <option value="recent-only">recent-only</option>
                      <option value="summary-recent">summary-recent</option>
                      <option value="full-history">full-history</option>
                    </select>
                  </label>
                  <label className="settings-ai-field">
                    <span>Summarize After Turns</span>
                    <input type="number" min={4} max={80}
                      value={draft.memory.summarizeAfterTurns}
                      onChange={(e) => updateField('memory.summarizeAfterTurns', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field settings-ai-field--full">
                    <span>Summary Max Chars</span>
                    <input type="number" min={300} max={8000}
                      value={draft.memory.summaryMaxChars}
                      onChange={(e) => updateField('memory.summaryMaxChars', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-toggle settings-ai-toggle--full">
                    <input type="checkbox"
                      checked={draft.debug.showContextDebug}
                      onChange={(e) => updateField('debug.showContextDebug', e.target.checked)}
                    />
                    <span>Show context budget telemetry in chat</span>
                  </label>
                  <label className="settings-ai-toggle settings-ai-toggle--full">
                    <input type="checkbox"
                      checked={draft.debug.emitContextDebugSse}
                      onChange={(e) => updateField('debug.emitContextDebugSse', e.target.checked)}
                    />
                    <span>Emit context debug data in SSE payloads</span>
                  </label>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

      </motion.div>

      {/* Save actions appear only when they carry information. */}
      {(isDirty || saveState === 'success') && (
        <div className="agent-savebar-wrap">
          <div className={[
            'agent-savebar',
            isDirty ? 'agent-savebar--dirty' : '',
            saveState === 'success' && !isDirty ? 'agent-savebar--saved' : '',
          ].filter(Boolean).join(' ')}>
            <div className="agent-savebar-content">
              <span className="agent-savebar-label">
                {saveState === 'success' && !isDirty ? '✓ Saved' : saveState === 'saving' ? 'Saving...' : 'Unsaved changes'}
              </span>
              <div className="agent-savebar-actions">
                <button
                  type="button"
                  className="agent-savebar-btn agent-savebar-btn--discard"
                  onClick={handleDiscard}
                  disabled={saveState === 'saving'}
                >
                  Discard
                </button>
                <button
                  type="button"
                  className="agent-savebar-btn agent-savebar-btn--save"
                  onClick={handleSave}
                  disabled={saveState === 'saving'}
                >
                  {saveState === 'saving' ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
