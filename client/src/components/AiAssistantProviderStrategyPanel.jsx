import { motion } from 'framer-motion';
import { PROVIDER_FAMILY, PROVIDER_OPTIONS, getReasoningEffortOptions } from '../lib/providerCatalog.js';

export const MODE_OPTIONS = [
  { value: 'single', label: 'Single', description: 'Fastest. One model handles the request start to finish.' },
  { value: 'fallback', label: 'Fallback', description: 'Recommended. Automatically hands off to a second model if needed.' },
  { value: 'parallel', label: 'Parallel', description: 'Compares more than one model at the same time for tougher requests.' },
];

function CheckIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SparkIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
    </svg>
  );
}

export default function AiAssistantProviderStrategyPanel({
  currentEffortOptions,
  currentFallback,
  currentMode,
  currentPrimary,
  currentReasoningEffort,
  motionProps,
  selectedMode,
  selectedPrimaryLabel,
  shouldReduceMotion,
  timeoutMs,
  updateField,
}) {
  return (
    <>
      <motion.section className="assistant-settings-panel assistant-model-selector" {...motionProps}>
        <div className="assistant-settings-panel-header">
          <div>
            <div className="assistant-settings-panel-title">Default Model</div>
            <p className="assistant-settings-panel-copy">
              Choose the model you want the application to treat as the lead assistant.
              This is the most important choice on the page, so it gets the most visual weight.
            </p>
          </div>
          <div className="assistant-settings-panel-badge">{selectedPrimaryLabel}</div>
        </div>

        <div className="assistant-model-grid">
          {PROVIDER_OPTIONS.map((option) => {
            const isSelected = currentPrimary === option.value;
            const tone = PROVIDER_FAMILY[option.value] || option.family || 'claude';
            const effortOptions = getReasoningEffortOptions(tone);
            return (
              <motion.button
                key={option.value}
                type="button"
                className={`assistant-model-card family-${tone}${isSelected ? ' is-selected' : ''}`}
                onClick={() => updateField('providerStrategy.defaultPrimaryProvider', option.value)}
                whileHover={shouldReduceMotion ? undefined : { y: -4, scale: 1.01 }}
                whileTap={shouldReduceMotion ? undefined : { scale: 0.99 }}
              >
                <div className="assistant-model-card-brow">
                  <span className="assistant-model-badge">{tone}</span>
                  {isSelected && (
                    <span className="assistant-model-card-check">
                      <CheckIcon size={12} />
                      Default
                    </span>
                  )}
                </div>
                <div className="assistant-model-card-name">{option.label}</div>
                <div className="assistant-model-card-meta">{option.model || option.value}</div>
                <div className="assistant-model-card-badges">
                  <span className="assistant-model-tag">{effortOptions.map((entry) => entry.label).join(' / ')}</span>
                  <span className="assistant-model-tag">{tone === 'claude' ? 'Thinking stream' : 'Direct output'}</span>
                </div>
              </motion.button>
            );
          })}
        </div>
      </motion.section>

      <motion.section className="assistant-settings-panel assistant-settings-panel--spotlight" {...motionProps}>
        <div className="assistant-settings-panel-header">
          <div>
            <div className="assistant-settings-panel-title">Request Strategy</div>
            <p className="assistant-settings-panel-copy">
              Decide how the app should behave around that default model: fast and direct, resilient with fallback, or multi-model for harder work.
            </p>
          </div>
        </div>

        <div className="assistant-mode-grid">
          {MODE_OPTIONS.map((option) => {
            const isSelected = currentMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={`assistant-mode-card${isSelected ? ' is-selected' : ''}`}
                onClick={() => updateField('providerStrategy.defaultMode', option.value)}
              >
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </button>
            );
          })}
        </div>

        <div className="assistant-field-grid assistant-field-grid--two">
          <label className="settings-ai-field">
            <span>Fallback Model</span>
            <select
              value={currentFallback}
              onChange={(event) => updateField('providerStrategy.defaultFallbackProvider', event.target.value)}
            >
              {PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="settings-ai-field">
            <span>Timeout Override (ms)</span>
            <input
              type="number"
              min={0}
              max={900000}
              step={1000}
              value={timeoutMs}
              onChange={(event) => updateField('providerStrategy.timeoutMs', Number(event.target.value))}
            />
          </label>
        </div>

        <div className="assistant-chip-label">Reasoning Effort</div>
        <div className="assistant-chip-row">
          {currentEffortOptions.map((option) => {
            const isSelected = currentReasoningEffort === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={`assistant-choice-pill${isSelected ? ' is-selected' : ''}`}
                onClick={() => updateField('providerStrategy.reasoningEffort', option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="assistant-settings-callout">
          <SparkIcon size={15} />
          <span>
            {selectedMode.description}
            {currentMode === 'parallel' && ' When you sync this default across the app, Chat keeps parallel mode while the other agent surfaces step down to fallback.'}
          </span>
        </div>
      </motion.section>
    </>
  );
}
