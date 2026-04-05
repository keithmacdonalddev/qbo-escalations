import './CopilotPanel.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { renderMarkdown, CopyButton } from '../utils/markdown.jsx';
import ModelOverrideControl from './ModelOverrideControl.jsx';
import {
  DEFAULT_PROVIDER,
  DEFAULT_REASONING_EFFORT,
  getAlternateProvider,
  getProviderModelSuggestions,
  getProviderShortLabel,
  getReasoningEffortOptions,
  PROVIDER_FAMILY,
  PROVIDER_OPTIONS,
} from '../lib/providerCatalog.js';
import {
  readSurfacePreferences,
  writeStoredPreference,
} from '../lib/surfacePreferences.js';
import { formatTokenCount, formatCost } from '../hooks/useTokenMonitor.js';
import {
  useSharedAgentSession,
} from '../lib/agentSessions.js';
import useCopilotRun from '../hooks/useCopilotRun.js';

const COPILOT_PRIMARY_MODEL_LIST_ID = 'copilot-primary-model-options';
const COPILOT_FALLBACK_MODEL_LIST_ID = 'copilot-fallback-model-options';

/* SVG icons for mode buttons and empty states */
const CopilotIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </svg>
);

const SearchIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const PlayIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const StopIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
);

const RetryIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const MODE_ICONS = {
  search: <SearchIcon size={12} />,
  analyze: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
  similar: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="8" height="14" rx="1" /><rect x="14" y="3" width="8" height="14" rx="1" />
    </svg>
  ),
  template: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  generate: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  improve: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  ),
  trends: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  playbook: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
};

const MODES_WITH_QUERY = new Set(['search', 'generate', 'improve']);

const QUERY_PLACEHOLDERS = {
  search: 'Search escalations semantically...',
  generate: 'Describe the template — e.g. "payroll CPP dispute acknowledgment"',
  improve: 'Paste the template content to improve...',
};

export default function CopilotPanel({ escalationId = null, title = 'Co-pilot' }) {
  const sessionKey = useMemo(() => {
    if (escalationId) return `copilot:escalation:${escalationId}`;
    return `copilot:${String(title || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  }, [escalationId, title]);
  const initialSession = useMemo(() => {
    const storedPreferences = readSurfacePreferences({
      providerKeys: ['qbo-copilot-provider', 'qbo-chat-provider'],
      modeKeys: ['qbo-copilot-mode', 'qbo-chat-mode'],
      fallbackProviderKeys: ['qbo-copilot-fallback-provider', 'qbo-chat-fallback-provider'],
      modelKeys: ['qbo-copilot-model', 'qbo-chat-model'],
      fallbackModelKeys: ['qbo-copilot-fallback-model', 'qbo-chat-fallback-model'],
      reasoningEffortKeys: ['qbo-copilot-reasoning-effort', 'qbo-chat-reasoning-effort'],
      defaultMode: 'fallback',
      supportedModes: ['single', 'fallback'],
      defaultProvider: DEFAULT_PROVIDER,
      reasoningEffortFallback: DEFAULT_REASONING_EFFORT,
    });
    return {
      mode: escalationId ? 'analyze' : 'search',
      query: '',
      streaming: false,
      output: '',
      thinkingText: '',
      error: '',
      statusText: '',
      provider: storedPreferences.provider,
      providerMode: storedPreferences.mode,
      fallbackProvider: storedPreferences.fallbackProvider,
      model: storedPreferences.model,
      fallbackModel: storedPreferences.fallbackModel,
      reasoningEffort: storedPreferences.reasoningEffort,
    };
  }, [escalationId]);
  const {
    session,
    patchSession,
    setController,
    abortSession,
  } = useSharedAgentSession(sessionKey, initialSession);
  const {
    mode,
    query,
    streaming,
    output,
    thinkingText,
    error,
    statusText,
    provider,
    providerMode,
    fallbackProvider,
    model,
    fallbackModel,
    reasoningEffort,
    usage,
  } = session;
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const primaryModelSuggestions = useMemo(() => getProviderModelSuggestions(provider), [provider]);
  const fallbackModelSuggestions = useMemo(() => getProviderModelSuggestions(fallbackProvider), [fallbackProvider]);
  const providerButtonValue = getProviderShortLabel(provider);
  const providerButtonTitle = providerMode === 'fallback'
    ? `Primary provider: ${getProviderShortLabel(provider)}. Fallback provider: ${getProviderShortLabel(fallbackProvider)}.`
    : `Primary provider: ${getProviderShortLabel(provider)}.`;

  const modeOptions = useMemo(() => (
    escalationId
      ? [
          { value: 'analyze', label: 'Analyze Escalation' },
          { value: 'similar', label: 'Find Similar Cases' },
          { value: 'template', label: 'Suggest Template' },
          { value: 'generate', label: 'Generate Template' },
          { value: 'improve', label: 'Improve Template' },
          { value: 'search', label: 'Semantic Search' },
        ]
      : [
          { value: 'search', label: 'Semantic Search' },
          { value: 'trends', label: 'Explain Trends' },
          { value: 'playbook', label: 'Playbook Coverage' },
          { value: 'generate', label: 'Generate Template' },
        ]
  ), [escalationId]);

  const needsQuery = MODES_WITH_QUERY.has(mode);

  const { handleRun, handleStop } = useCopilotRun({
    escalationId,
    query,
    mode,
    streaming,
    provider,
    providerMode,
    fallbackProvider,
    model,
    fallbackModel,
    reasoningEffort,
    needsQuery,
    patchSession,
    setController,
    abortSession,
  });

  useEffect(() => {
    const nextFallback = fallbackProvider === provider
      ? getAlternateProvider(provider)
      : fallbackProvider;
    if (nextFallback !== fallbackProvider) {
      patchSession({ fallbackProvider: nextFallback, fallbackModel: '' });
    }
  }, [provider, fallbackProvider, patchSession]);

  useEffect(() => {
    writeStoredPreference('qbo-copilot-provider', provider);
    writeStoredPreference('qbo-copilot-mode', providerMode);
    writeStoredPreference('qbo-copilot-fallback-provider', fallbackProvider);
    writeStoredPreference('qbo-copilot-model', model);
    writeStoredPreference('qbo-copilot-fallback-model', fallbackModel);
    writeStoredPreference('qbo-copilot-reasoning-effort', reasoningEffort);
  }, [fallbackModel, fallbackProvider, model, provider, providerMode, reasoningEffort]);

  const renderedOutput = useMemo(() => {
    if (!output) return null;
    return renderMarkdown(output);
  }, [output]);

  // Close provider menu when clicking outside
  const providerMenuRef = useRef(null);
  useEffect(() => {
    if (!providerMenuOpen) return;
    const handleClick = (e) => {
      if (providerMenuRef.current && !providerMenuRef.current.contains(e.target)) {
        setProviderMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [providerMenuOpen]);

  return (
    <div className="copilot-panel">
      <div className="copilot-inner">
      {/* Header */}
      <div className="copilot-header">
        <div className="copilot-header-left">
          <span className="copilot-header-icon"><CopilotIcon /></span>
          <h2 className="copilot-title">{title}</h2>
        </div>
        <div style={{ position: 'relative' }} ref={providerMenuRef}>
          <button
            type="button"
            className="workspace-agent-provider-btn"
            onClick={() => setProviderMenuOpen((prev) => !prev)}
            aria-label="Change copilot model and provider"
            title={providerButtonTitle}
          >
            <span className="workspace-agent-provider-btn-text">
              <span className="workspace-agent-provider-btn-kicker">Primary</span>
              <span className="workspace-agent-provider-btn-value">{providerButtonValue}</span>
            </span>
            <svg className="workspace-agent-provider-btn-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {providerMenuOpen && (
            <div className="workspace-agent-provider-popover" style={{ left: 'auto', right: 0, width: 340 }}>
              <div className="provider-popover-label">Provider</div>
              {PROVIDER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`provider-popover-option${provider === option.value ? ' is-selected' : ''}`}
                  onClick={() => {
                    const patch = { provider: option.value, model: '' };
                    const nextFamily = PROVIDER_FAMILY[option.value] || 'claude';
                    const allowed = getReasoningEffortOptions(nextFamily);
                    if (!allowed.some((o) => o.value === reasoningEffort)) {
                      patch.reasoningEffort = 'high';
                    }
                    if (option.value === fallbackProvider) {
                      patch.fallbackProvider = provider;
                      patch.fallbackModel = '';
                    }
                    patchSession(patch);
                  }}
                >
                  <span>{option.label}</span>
                  <span className="check">{provider === option.value ? '\u2713' : ''}</span>
                </button>
              ))}
              <ModelOverrideControl
                label="Primary Model"
                provider={provider}
                model={model}
                onChange={(value) => patchSession({ model: value })}
                listId={COPILOT_PRIMARY_MODEL_LIST_ID}
                suggestions={primaryModelSuggestions}
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
                  className={`provider-popover-option${providerMode === option.value ? ' is-selected' : ''}`}
                  onClick={() => patchSession({ providerMode: option.value })}
                >
                  <span>{option.label}</span>
                  <span className="check">{providerMode === option.value ? '\u2713' : ''}</span>
                </button>
              ))}
              {providerMode === 'fallback' && (
                <>
                  <div className="provider-popover-divider" />
                  <div className="provider-popover-label">Fallback Provider</div>
                  {PROVIDER_OPTIONS.filter((option) => option.value !== provider).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`provider-popover-option${fallbackProvider === option.value ? ' is-selected' : ''}`}
                      onClick={() => patchSession({ fallbackProvider: option.value, fallbackModel: '' })}
                    >
                      <span>{option.label}</span>
                      <span className="check">{fallbackProvider === option.value ? '\u2713' : ''}</span>
                    </button>
                  ))}
                  <ModelOverrideControl
                    label="Fallback Model"
                    provider={fallbackProvider}
                    model={fallbackModel}
                    onChange={(value) => patchSession({ fallbackModel: value })}
                    listId={COPILOT_FALLBACK_MODEL_LIST_ID}
                    suggestions={fallbackModelSuggestions}
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
            </div>
          )}
        </div>
      </div>

      {/* Segmented mode selector */}
      <div className="copilot-mode-strip">
        {modeOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`copilot-mode-btn${mode === opt.value ? ' is-active' : ''}`}
            onClick={() => patchSession({ mode: opt.value })}
          >
            <span className="copilot-mode-icon">{MODE_ICONS[opt.value] || null}</span>
            {opt.label}
          </button>
        ))}
      </div>

      {/* Query input */}
      {needsQuery && (
        mode === 'improve' ? (
          <textarea
            className="copilot-search"
            value={query}
            onChange={(e) => patchSession({ query: e.target.value })}
            placeholder={QUERY_PLACEHOLDERS[mode]}
            rows={4}
          />
        ) : (
          <div className="copilot-search-wrap">
            <span className="copilot-search-icon"><SearchIcon size={14} /></span>
            <input
              type="search"
              className="copilot-search"
              value={query}
              onChange={(e) => patchSession({ query: e.target.value })}
              placeholder={QUERY_PLACEHOLDERS[mode] || 'Enter query...'}
            />
          </div>
        )
      )}

      {/* Action buttons */}
      <div className="copilot-actions">
        {streaming ? (
          <button className="copilot-run-btn copilot-run-btn--danger" onClick={handleStop} type="button">
            <StopIcon />
            Stop
          </button>
        ) : (
          <button
            className="copilot-run-btn copilot-run-btn--primary"
            onClick={handleRun}
            type="button"
            disabled={needsQuery && !query.trim()}
          >
            <PlayIcon />
            Run
          </button>
        )}
        {!streaming && (output || error) && (
          <button
            className="copilot-run-btn copilot-run-btn--secondary"
            onClick={handleRun}
            type="button"
            disabled={needsQuery && !query.trim()}
          >
            <RetryIcon />
            Retry
          </button>
        )}
        {output && <CopyButton text={output} />}
      </div>

      {/* Status */}
      {statusText && (
        <div className="copilot-status">
          <span className="copilot-status-dot" />
          {statusText}
        </div>
      )}

      {/* Thinking */}
      {streaming && thinkingText && (
        <div className="copilot-thinking">
          <div className="copilot-thinking-header">
            <span className="copilot-thinking-pill">Live reasoning</span>
            <span className="copilot-thinking-phase">{getProviderShortLabel(provider)}</span>
          </div>
          <div className="copilot-thinking-content">
            {thinkingText}
            <span className="streaming-cursor" />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-danger" style={{ fontSize: '12px' }}>{error}</div>
      )}

      {/* Results */}
      <div className="copilot-results playbook-content">
        {renderedOutput ? (
          <>
            {renderedOutput}
            {streaming && <span className="streaming-cursor" />}
            {!streaming && usage && (usage.inputTokens > 0 || usage.outputTokens > 0) && (
              <div className="copilot-usage-badge">
                <span className="copilot-usage-tokens">
                  {formatTokenCount((usage.inputTokens || 0) + (usage.outputTokens || 0))} tokens
                </span>
                <span className="copilot-usage-detail">
                  {formatTokenCount(usage.inputTokens || 0)} in / {formatTokenCount(usage.outputTokens || 0)} out
                </span>
                {usage.rateFound && usage.totalCostMicros > 0 && (
                  <span className="copilot-usage-cost">
                    {formatCost(usage.totalCostMicros / 1_000_000)}
                  </span>
                )}
                {usage.model && (
                  <span className="copilot-usage-model">{usage.model}</span>
                )}
              </div>
            )}
          </>
        ) : streaming ? (
          <div className="copilot-results-empty">
            <div className="copilot-results-empty-icon">
              <CopilotIcon />
            </div>
            <div className="copilot-results-empty-title">Working...</div>
            <span className="streaming-cursor" />
          </div>
        ) : (
          <div className="copilot-results-empty">
            <div className="copilot-results-empty-icon">
              <SearchIcon size={20} />
            </div>
            <div className="copilot-results-empty-title">No results yet</div>
            <div className="copilot-results-empty-desc">
              Select a mode and run an action to see AI-powered analysis here.
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
