import { AnimatePresence, motion } from 'framer-motion';
import ModelOverrideControl from '../ModelOverrideControl.jsx';
import {
  getProviderModelSuggestions,
  getProviderShortLabel,
  getReasoningEffortOptions,
  PROVIDER_FAMILY,
  PROVIDER_OPTIONS,
} from '../../lib/providerCatalog.js';
import {
  getProviderOptionTitle,
  isProviderMissingApiKey,
} from '../../lib/providerKeyStatus.js';
import useProviderKeyStatus from '../../hooks/useProviderKeyStatus.js';

const WORKSPACE_PRIMARY_MODEL_LIST_ID = 'workspace-agent-primary-model-options';
const WORKSPACE_FALLBACK_MODEL_LIST_ID = 'workspace-agent-fallback-model-options';
const QUICK_PROVIDER_IDS = ['codex', 'claude', 'llm-gateway', 'openai', 'lm-studio'];

function pickUniqueProviders(ids, currentProvider) {
  const seen = new Set();
  return [currentProvider, ...ids]
    .filter(Boolean)
    .map((id) => PROVIDER_OPTIONS.find((option) => option.value === id))
    .filter((option) => {
      if (!option || seen.has(option.value)) return false;
      seen.add(option.value);
      return true;
    });
}

function WorkspaceCompactProviderMenu({
  provider,
  mode,
  fallbackProvider,
  model,
  fallbackModel,
  reasoningEffort,
  primaryModelSuggestions,
  fallbackModelSuggestions,
  quickProviderOptions,
  advancedProviderOptions,
  providerStatus,
  onSelectProvider,
  patchSession,
}) {
  const currentProvider = PROVIDER_OPTIONS.find((option) => option.value === provider);
  const defaultModel = currentProvider?.model || 'provider default';
  const currentModel = model || defaultModel;
  const reasoningOptions = getReasoningEffortOptions(PROVIDER_FAMILY[provider] || 'claude');
  const isMissingKey = (providerId) => isProviderMissingApiKey(providerId, providerStatus);

  return (
    <motion.div
      className="workspace-agent-quick-provider-menu"
      role="region"
      aria-label="Workspace provider settings"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.15 }}
    >
      <div className="workspace-agent-provider-summary">
        <span className="workspace-agent-provider-summary-label">Active</span>
        <strong>{currentProvider?.shortLabel || currentProvider?.label || provider}</strong>
        <span>{currentModel}</span>
      </div>

      <div className="workspace-agent-provider-choice-grid" aria-label="Recommended providers">
        {quickProviderOptions.map((option) => {
          const disabled = isMissingKey(option.value);
          return (
            <button
              key={option.value}
              type="button"
              className={`workspace-agent-provider-choice${provider === option.value ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                onSelectProvider(option.value);
              }}
              title={getProviderOptionTitle(option, providerStatus)}
            >
              <span>{option.shortLabel || option.label}</span>
              {provider === option.value ? <span aria-hidden="true">✓</span> : null}
            </button>
          );
        })}
      </div>

      <div className="workspace-agent-provider-compact-row">
        <div className="workspace-agent-provider-segment" aria-label="Provider mode">
          {[
            { value: 'single', label: 'Single' },
            { value: 'fallback', label: 'Fallback' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              className={mode === option.value ? 'is-selected' : ''}
              onClick={() => patchSession({ mode: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="workspace-agent-provider-segment" aria-label="Reasoning effort">
          {reasoningOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={reasoningEffort === option.value ? 'is-selected' : ''}
              onClick={() => patchSession({ reasoningEffort: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <details className="workspace-agent-provider-advanced">
        <summary>Advanced provider and model settings</summary>
        <div className="workspace-agent-provider-choice-grid is-advanced" aria-label="All providers">
          {advancedProviderOptions.map((option) => {
            const disabled = isMissingKey(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={`workspace-agent-provider-choice${provider === option.value ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  onSelectProvider(option.value);
                }}
                title={getProviderOptionTitle(option, providerStatus)}
              >
                <span>{option.shortLabel || option.label}</span>
                {provider === option.value ? <span aria-hidden="true">✓</span> : null}
              </button>
            );
          })}
        </div>
        <ModelOverrideControl
          label="Primary Model"
          provider={provider}
          model={model}
          onChange={(value) => patchSession({ model: value })}
          listId={WORKSPACE_PRIMARY_MODEL_LIST_ID}
          suggestions={primaryModelSuggestions}
          className="workspace-agent-model-field"
          disabled={isMissingKey(provider)}
        />
        {mode === 'fallback' && (
          <ModelOverrideControl
            label="Fallback Model"
            provider={fallbackProvider}
            model={fallbackModel}
            onChange={(value) => patchSession({ fallbackModel: value })}
            listId={WORKSPACE_FALLBACK_MODEL_LIST_ID}
            suggestions={fallbackModelSuggestions}
            className="workspace-agent-model-field"
            disabled={isMissingKey(fallbackProvider)}
          />
        )}
      </details>
    </motion.div>
  );
}

export default function WorkspacePanelHeader({
  embedded = false,
  viewLabel = 'Workspace',
  memoryCount = null,
  providerMenuOpen = false,
  onToggleProviderMenu,
  provider,
  mode,
  fallbackProvider,
  model,
  fallbackModel,
  reasoningEffort,
  patchSession,
  historyOpen = false,
  onToggleHistory,
  hasMessages = false,
  onNewConversation,
  onCopyConversation,
  onClose,
}) {
  const { providerStatus } = useProviderKeyStatus();
  const providerLabel = getProviderShortLabel(provider);
  const fallbackLabel = mode === 'fallback' ? getProviderShortLabel(fallbackProvider) : '';
  const primaryModelSuggestions = getProviderModelSuggestions(provider);
  const fallbackModelSuggestions = getProviderModelSuggestions(fallbackProvider);
  const buttonValue = providerLabel;
  const buttonTitle = mode === 'fallback'
    ? `Primary provider: ${providerLabel}. Fallback provider: ${fallbackLabel}.`
    : `Primary provider: ${providerLabel}.`;
  const quickProviderOptions = pickUniqueProviders(QUICK_PROVIDER_IDS, provider);
  const quickProviderIds = new Set(quickProviderOptions.map((option) => option.value));
  const advancedProviderOptions = PROVIDER_OPTIONS.filter((option) => !quickProviderIds.has(option.value));
  const isMissingKey = (providerId) => isProviderMissingApiKey(providerId, providerStatus);
  const handleSelectProvider = (providerId) => {
    if (isMissingKey(providerId)) return;
    const patch = { provider: providerId, model: '' };
    const nextFamily = PROVIDER_FAMILY[providerId] || 'claude';
    const allowed = getReasoningEffortOptions(nextFamily);
    if (!allowed.some((option) => option.value === reasoningEffort)) {
      patch.reasoningEffort = 'high';
    }
    if (providerId === fallbackProvider) {
      patch.fallbackProvider = provider;
      patch.fallbackModel = '';
    }
    patchSession(patch);
  };

  return (
    <>
      {embedded ? (
        <div className="workspace-agent-toolbar">
          <button
            className="workspace-agent-provider-btn"
            type="button"
            onClick={onToggleProviderMenu}
            aria-label="Change workspace model and provider"
            title={buttonTitle}
          >
            <span className="workspace-agent-provider-btn-text">
              <span className="workspace-agent-provider-btn-kicker">Primary</span>
              <span className="workspace-agent-provider-btn-value">{buttonValue}</span>
            </span>
            <svg className="workspace-agent-provider-btn-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <div className="workspace-agent-toolbar-actions">
            <button
              className={`workspace-agent-icon-btn${historyOpen ? ' is-active' : ''}`}
              onClick={onToggleHistory}
              type="button"
              title="Conversation history"
              aria-label="Conversation history"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
            {hasMessages && (
              <button
                className="workspace-agent-icon-btn"
                onClick={onNewConversation}
                type="button"
                title="New conversation"
                aria-label="New conversation"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            )}
            {hasMessages && (
              <button
                className="workspace-agent-icon-btn"
                onClick={onCopyConversation}
                type="button"
                title="Copy entire conversation"
                aria-label="Copy entire conversation"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="workspace-agent-header">
          <div className="workspace-agent-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <span>Workspace Agent</span>
            <span className="workspace-agent-badge">{viewLabel}</span>
            {memoryCount != null && memoryCount > 0 && (
              <span className="workspace-memory-indicator" title="Persistent workspace memory active">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.2 6H8.2C6.3 13.7 5 11.5 5 9a7 7 0 0 1 7-7z" />
                  <line x1="9" y1="17" x2="15" y2="17" />
                  <line x1="10" y1="20" x2="14" y2="20" />
                </svg>
                {memoryCount} {memoryCount === 1 ? 'fact' : 'facts'}
              </span>
            )}
            <button
              className="workspace-agent-provider-btn"
              type="button"
              onClick={onToggleProviderMenu}
              aria-label="Change workspace model and provider"
              title={buttonTitle}
            >
              <span className="workspace-agent-provider-btn-text">
                <span className="workspace-agent-provider-btn-kicker">Primary</span>
                <span className="workspace-agent-provider-btn-value">{buttonValue}</span>
              </span>
              <svg className="workspace-agent-provider-btn-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
          <div className="workspace-agent-header-actions">
            <button
              className={`workspace-agent-icon-btn${historyOpen ? ' is-active' : ''}`}
              onClick={onToggleHistory}
              type="button"
              title="Conversation history"
              aria-label="Conversation history"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
            {hasMessages && (
              <button
                className="workspace-agent-icon-btn"
                onClick={onNewConversation}
                type="button"
                title="New conversation"
                aria-label="New conversation"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            )}
            {hasMessages && (
              <button
                className="workspace-agent-icon-btn"
                onClick={onCopyConversation}
                type="button"
                title="Copy entire conversation"
                aria-label="Copy entire conversation"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
            )}
            {onClose && (
              <button className="workspace-agent-icon-btn" onClick={onClose} type="button" aria-label="Close panel">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {providerMenuOpen && embedded && (
          <WorkspaceCompactProviderMenu
            provider={provider}
            mode={mode}
            fallbackProvider={fallbackProvider}
            model={model}
            fallbackModel={fallbackModel}
            reasoningEffort={reasoningEffort}
            primaryModelSuggestions={primaryModelSuggestions}
            fallbackModelSuggestions={fallbackModelSuggestions}
            quickProviderOptions={quickProviderOptions}
            advancedProviderOptions={advancedProviderOptions}
            providerStatus={providerStatus}
            onSelectProvider={handleSelectProvider}
            patchSession={patchSession}
          />
        )}
        {providerMenuOpen && !embedded && (
          <motion.div
            className="workspace-agent-settings-tray"
            role="region"
            aria-label="Workspace model and provider settings"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <div className="provider-popover-label">Provider</div>
            {PROVIDER_OPTIONS.map((option) => {
              const disabled = isMissingKey(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`provider-popover-option${provider === option.value ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    handleSelectProvider(option.value);
                  }}
                  title={getProviderOptionTitle(option, providerStatus)}
                >
                  <span>{option.label}</span>
                  <span className="check">{provider === option.value ? '\u2713' : ''}</span>
                </button>
              );
            })}
            <ModelOverrideControl
              label="Primary Model"
              provider={provider}
              model={model}
              onChange={(value) => patchSession({ model: value })}
              listId={WORKSPACE_PRIMARY_MODEL_LIST_ID}
              suggestions={primaryModelSuggestions}
              className="workspace-agent-model-field"
              disabled={isMissingKey(provider)}
            />
            <div className="provider-popover-divider" />
            <div className="provider-popover-label">Mode</div>
            {[
              { value: 'single', label: 'Single' },
              { value: 'fallback', label: 'Fallback' },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                className={`provider-popover-option${mode === option.value ? ' is-selected' : ''}`}
                onClick={() => patchSession({ mode: option.value })}
              >
                <span>{option.label}</span>
                <span className="check">{mode === option.value ? '\u2713' : ''}</span>
              </button>
            ))}
            {mode === 'fallback' && (
              <>
                <div className="provider-popover-divider" />
                <div className="provider-popover-label">Fallback Provider</div>
                {PROVIDER_OPTIONS.filter((option) => option.value !== provider).map((option) => {
                  const disabled = isMissingKey(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`provider-popover-option${fallbackProvider === option.value ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
                      disabled={disabled}
                      onClick={() => {
                        if (disabled) return;
                        patchSession({ fallbackProvider: option.value, fallbackModel: '' });
                      }}
                      title={getProviderOptionTitle(option, providerStatus)}
                    >
                      <span>{option.label}</span>
                      <span className="check">{fallbackProvider === option.value ? '\u2713' : ''}</span>
                    </button>
                  );
                })}
                <ModelOverrideControl
                  label="Fallback Model"
                  provider={fallbackProvider}
                  model={fallbackModel}
                  onChange={(value) => patchSession({ fallbackModel: value })}
                  listId={WORKSPACE_FALLBACK_MODEL_LIST_ID}
                  suggestions={fallbackModelSuggestions}
                  className="workspace-agent-model-field"
                  disabled={isMissingKey(fallbackProvider)}
                />
              </>
            )}
            <div className="provider-popover-divider" />
            <div className="provider-popover-label">Reasoning Effort</div>
            {getReasoningEffortOptions(PROVIDER_FAMILY[provider] || 'claude').map((option) => (
              <button
                key={option.value}
                type="button"
                className={`provider-popover-option${reasoningEffort === option.value ? ' is-selected' : ''}`}
                onClick={() => patchSession({ reasoningEffort: option.value })}
              >
                <span>{option.label}</span>
                <span className="check">{reasoningEffort === option.value ? '\u2713' : ''}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
