import { AnimatePresence, motion } from 'framer-motion';
import { transitions } from '../utils/motion.js';

function CheckIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default function AiAssistantOverviewPanel({
  hasChanges,
  itemMotion,
  saveMessage,
  saveState,
  shouldReduceMotion,
  summaryPills,
  syncSurfaceSelectors,
  onDiscard,
  onResetDraft,
  onSave,
  onToggleSyncSurfaceSelectors,
}) {
  return (
    <>
      <motion.section className="assistant-settings-hero" {...itemMotion}>
        <div className="assistant-settings-hero-main">
          <span className="assistant-settings-kicker">AI Assistant Defaults</span>
          <h2 className="assistant-settings-headline">Make the model choice feel intentional, not hidden.</h2>
          <p className="assistant-settings-copy">
            Pick the application default model, decide how resilient requests should be, and save that choice with one obvious action.
            The goal here is confidence: the user should understand which model leads, what happens if it fails, and whether the rest of the app will follow along.
          </p>

          <div className="assistant-settings-summary-row">
            {summaryPills.map((pill) => (
              <div key={pill.label} className="assistant-settings-summary-pill">
                <span>{pill.label}</span>
                <strong>{pill.value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="assistant-settings-hero-panel">
          <div className="assistant-settings-hero-panel-label">Architecture Answer</div>
          <div className="assistant-settings-hero-panel-value">Yes, the app already has different model selectors for different AI surfaces.</div>
          <p className="assistant-settings-hero-panel-copy">
            Chat, Workspace, and Copilot each keep their own provider, mode, fallback, and reasoning choices.
            This page now acts as the app-level default and can optionally sync those separate selectors when you save.
          </p>
        </div>
      </motion.section>

      <motion.section
        className={`assistant-settings-savebar${hasChanges ? ' is-dirty' : ''}`}
        layout={!shouldReduceMotion}
        transition={transitions.springGentle}
        {...itemMotion}
      >
        <div className="assistant-settings-save-meta">
          <span className={`assistant-settings-save-dot assistant-settings-save-dot--${hasChanges ? 'dirty' : 'clean'}`} />
          <div>
            <div className="assistant-settings-save-title">{hasChanges ? 'Unsaved AI changes' : 'AI defaults are up to date'}</div>
            <div className="assistant-settings-save-copy">
              {syncSurfaceSelectors
                ? 'Saving can also update Chat, Workspace, and Copilot so the default model actually changes across the app.'
                : 'Saving only updates the app-level default. Existing agent selectors stay exactly as they are.'}
            </div>
          </div>
        </div>

        <div className="assistant-settings-save-actions">
          <label className="assistant-settings-sync-toggle">
            <input
              type="checkbox"
              checked={syncSurfaceSelectors}
              onChange={(event) => onToggleSyncSurfaceSelectors(event.target.checked)}
            />
            <span>Also update the separate agent selectors</span>
          </label>

          <div className="assistant-settings-save-buttons">
            <button className="btn btn-secondary" onClick={onDiscard} disabled={!hasChanges} type="button">
              Discard
            </button>
            <button className="btn btn-secondary" onClick={onResetDraft} type="button">
              Reset Draft
            </button>
            <button className="btn btn-primary" onClick={onSave} disabled={!hasChanges || saveState === 'saving'} type="button">
              {saveState === 'saving' ? 'Saving...' : 'Save AI Defaults'}
            </button>
          </div>

          <AnimatePresence mode="wait">
            {saveState !== 'idle' && saveMessage && (
              <motion.div
                key={`${saveState}:${saveMessage}`}
                className={`assistant-settings-save-status is-${saveState}`}
                initial={shouldReduceMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
                animate={shouldReduceMotion ? {} : { opacity: 1, y: 0, scale: 1 }}
                exit={shouldReduceMotion ? {} : { opacity: 0, y: -6, scale: 0.98 }}
                transition={transitions.springGentle}
              >
                {saveState === 'success' && <CheckIcon size={13} />}
                {saveMessage}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.section>
    </>
  );
}
