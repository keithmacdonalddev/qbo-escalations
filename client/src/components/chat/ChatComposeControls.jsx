import { AnimatePresence, motion } from 'framer-motion';
import { popover, transitions } from '../../utils/motion.js';
import { getProviderLabel } from '../../utils/markdown.jsx';
import ModelOverrideControl from '../ModelOverrideControl.jsx';
import {
  getProviderModelSuggestions,
  PROVIDER_FAMILY,
  PROVIDER_OPTIONS,
  getReasoningEffortOptions,
} from '../../lib/providerCatalog.js';

const MODE_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'fallback', label: 'Fallback' },
  { value: 'parallel', label: 'Parallel' },
];

const CHAT_PRIMARY_MODEL_LIST_ID = 'chat-primary-model-options';
const CHAT_FALLBACK_MODEL_LIST_ID = 'chat-fallback-model-options';

function getReasoningEffortLabel(value) {
  return getReasoningEffortOptions('claude').find((option) => option.value === value)?.label || 'High';
}

export default function ChatComposeControls({
  providerPopoverRef,
  provider,
  mode,
  fallbackProvider,
  model,
  fallbackModel,
  reasoningEffort,
  parallelProviders,
  showProviderPopover,
  setShowProviderPopover,
  setProvider,
  setMode,
  setFallbackProvider,
  setModel,
  setFallbackModel,
  setReasoningEffort,
  setParallelProviders,
  trailingActions = null,
}) {
  const modeLabel = MODE_OPTIONS.find((entry) => entry.value === mode)?.label || 'Single';
  const effortLabel = getReasoningEffortLabel(reasoningEffort);
  const primaryModelSuggestions = getProviderModelSuggestions(provider);
  const fallbackModelSuggestions = getProviderModelSuggestions(fallbackProvider);

  return (
    <div className="compose-top-strip">
      <div ref={providerPopoverRef} style={{ position: 'relative' }}>
        <button
          className={`provider-chip${showProviderPopover ? ' is-open' : ''}`}
          onClick={() => setShowProviderPopover((prev) => !prev)}
          type="button"
          aria-label="Change model and mode settings"
          aria-expanded={showProviderPopover}
        >
          {getProviderLabel(provider)}
          {' \u00b7 '}
          {modeLabel}
          {' \u00b7 '}
          {effortLabel}
          {mode === 'fallback' && (
            <> + {getProviderLabel(fallbackProvider)}</>
          )}
          {mode === 'parallel' && parallelProviders.length >= 2 && (
            <> · Parallel ({parallelProviders.length})</>
          )}
          <span className="chevron">&#9662;</span>
        </button>

        <AnimatePresence>
          {showProviderPopover && (
            <motion.div key="provider-popover" className="provider-popover" {...popover} transition={transitions.fast}>
              <div className="provider-popover-label">Provider</div>
              {PROVIDER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={`provider-popover-option${provider === option.value ? ' is-selected' : ''}`}
                  onClick={() => {
                    setProvider(option.value);
                    const nextFamily = PROVIDER_FAMILY[option.value] || 'claude';
                    const allowed = getReasoningEffortOptions(nextFamily);
                    if (!allowed.some((o) => o.value === reasoningEffort)) {
                      setReasoningEffort('high');
                    }
                  }}
                  type="button"
                >
                  <span className="check">{provider === option.value ? '\u2713' : ''}</span>
                  {option.label}
                </button>
              ))}
              <ModelOverrideControl
                label="Primary Model"
                provider={provider}
                model={model}
                onChange={setModel}
                listId={CHAT_PRIMARY_MODEL_LIST_ID}
                suggestions={primaryModelSuggestions}
                className="provider-popover-field"
              />
              <div className="provider-popover-divider" />
              <div className="provider-popover-label">Mode</div>
              {MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={`provider-popover-option${mode === option.value ? ' is-selected' : ''}`}
                  onClick={() => { setMode(option.value); }}
                  type="button"
                >
                  <span className="check">{mode === option.value ? '\u2713' : ''}</span>
                  {option.label}
                </button>
              ))}
              {mode === 'fallback' && (
                <>
                  <div className="provider-popover-divider" />
                  <div className="provider-popover-label">Fallback Provider</div>
                  {PROVIDER_OPTIONS.filter((option) => option.value !== provider).map((option) => (
                    <button
                      key={option.value}
                      className={`provider-popover-option${fallbackProvider === option.value ? ' is-selected' : ''}`}
                      onClick={() => { setFallbackProvider(option.value); }}
                      type="button"
                    >
                      <span className="check">{fallbackProvider === option.value ? '\u2713' : ''}</span>
                      {option.label}
                    </button>
                  ))}
                  <ModelOverrideControl
                    label="Fallback Model"
                    provider={fallbackProvider}
                    model={fallbackModel}
                    onChange={setFallbackModel}
                    listId={CHAT_FALLBACK_MODEL_LIST_ID}
                    suggestions={fallbackModelSuggestions}
                    className="provider-popover-field"
                  />
                </>
              )}
              {mode === 'parallel' && (
                <>
                  <div className="provider-popover-divider" />
                  <div className="provider-multi-select">
                    <label style={{ fontSize: '0.75rem', color: 'var(--ink-secondary)', marginBottom: 4, display: 'block' }}>
                      Parallel Providers (select 2-4)
                    </label>
                    {PROVIDER_OPTIONS.map((option) => {
                      const isSelected = parallelProviders.includes(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="switch"
                          aria-checked={isSelected}
                          aria-label={`${option.label} provider`}
                          className={`provider-chip ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            const next = isSelected
                              ? parallelProviders.filter((p) => p !== option.value)
                              : [...parallelProviders, option.value];
                            setParallelProviders(next);
                          }}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 10px',
                            margin: '2px 4px 2px 0',
                            borderRadius: 12,
                            border: isSelected ? '1.5px solid var(--accent)' : '1px solid var(--line)',
                            background: isSelected ? 'var(--accent-subtle)' : 'transparent',
                            color: isSelected ? 'var(--accent)' : 'var(--ink-secondary)',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            fontWeight: isSelected ? 600 : 400,
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                    {parallelProviders.length < 2 && (
                      <div role="alert" style={{ fontSize: '0.7rem', color: 'var(--danger)', marginTop: 4 }}>
                        Select at least 2 providers
                      </div>
                    )}
                    {parallelProviders.length > 4 && (
                      <div role="alert" style={{ fontSize: '0.7rem', color: 'var(--danger)', marginTop: 4 }}>
                        Maximum 4 providers allowed
                      </div>
                    )}
                  </div>
                </>
              )}
              <div className="provider-popover-divider" />
              <div className="provider-popover-label">Reasoning Effort</div>
              {getReasoningEffortOptions(PROVIDER_FAMILY[provider] || 'claude').map((option) => (
                <button
                  key={option.value}
                  className={`provider-popover-option${reasoningEffort === option.value ? ' is-selected' : ''}`}
                  onClick={() => { setReasoningEffort(option.value); }}
                  type="button"
                >
                  <span className="check">{reasoningEffort === option.value ? '\u2713' : ''}</span>
                  {option.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {trailingActions}
    </div>
  );
}
