import { AnimatePresence, motion } from 'framer-motion';
import { getProviderShortLabel, getReasoningEffortOptions, PROVIDER_FAMILY, PROVIDER_OPTIONS } from '../../lib/providerCatalog.js';

export default function WorkspacePanelHeader({
  embedded = false,
  viewLabel = 'Workspace',
  memoryCount = null,
  providerMenuOpen = false,
  onToggleProviderMenu,
  provider,
  mode,
  fallbackProvider,
  reasoningEffort,
  patchSession,
  historyOpen = false,
  onToggleHistory,
  hasMessages = false,
  onNewConversation,
  onCopyConversation,
  onClose,
}) {
  const providerLabel = getProviderShortLabel(provider);
  const fallbackLabel = mode === 'fallback' ? ` + ${getProviderShortLabel(fallbackProvider)}` : '';

  return (
    <>
      {embedded ? (
        <div className="workspace-agent-toolbar">
          <button
            className="workspace-agent-provider-btn"
            type="button"
            onClick={onToggleProviderMenu}
            aria-label="Choose workspace provider"
          >
            {providerLabel}
            {fallbackLabel}
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
              aria-label="Choose workspace provider"
            >
              {providerLabel}
              {fallbackLabel}
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
        {providerMenuOpen && (
          <motion.div
            className="workspace-agent-provider-popover"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <div className="provider-popover-label">Provider</div>
            {PROVIDER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`provider-popover-option${provider === option.value ? ' is-selected' : ''}`}
                onClick={() => {
                  const patch = { provider: option.value };
                  const nextFamily = PROVIDER_FAMILY[option.value] || 'claude';
                  const allowed = getReasoningEffortOptions(nextFamily);
                  if (!allowed.some((o) => o.value === reasoningEffort)) {
                    patch.reasoningEffort = 'high';
                  }
                  patchSession(patch);
                }}
              >
                <span>{option.label}</span>
                <span className="check">{provider === option.value ? '\u2713' : ''}</span>
              </button>
            ))}
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
                {PROVIDER_OPTIONS.filter((option) => option.value !== provider).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`provider-popover-option${fallbackProvider === option.value ? ' is-selected' : ''}`}
                    onClick={() => patchSession({ fallbackProvider: option.value })}
                  >
                    <span>{option.label}</span>
                    <span className="check">{fallbackProvider === option.value ? '\u2713' : ''}</span>
                  </button>
                ))}
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
