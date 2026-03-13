import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Tooltip from './Tooltip.jsx';
import { renderMarkdown, CopyButton } from '../utils/markdown.jsx';
import {
  DEFAULT_PROVIDER,
  DEFAULT_REASONING_EFFORT,
  getAlternateProvider,
  getProviderShortLabel,
  normalizeProvider,
  normalizeReasoningEffort,
  PROVIDER_OPTIONS,
  REASONING_EFFORT_OPTIONS,
} from '../lib/providerCatalog.js';
import {
  streamAnalyzeEscalation,
  streamFindSimilar,
  streamSuggestTemplate,
  streamGenerateTemplate,
  streamImproveTemplate,
  streamExplainTrends,
  streamPlaybookCheck,
  streamSemanticSearch,
} from '../api/copilotApi.js';
import {
  useSharedAgentSession,
} from '../lib/agentSessions.js';

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

/**
 * Custom hook to batch high-frequency SSE updates via requestAnimationFrame.
 * Accumulates text in a ref and flushes into patchSession at most once per
 * animation frame, preventing per-chunk re-renders that freeze the UI.
 */
function useChunkBatcher(patchSession) {
  const pendingOutputRef = useRef('');
  const pendingThinkingRef = useRef('');
  const pendingThinkingPhaseRef = useRef(null);
  const rafRef = useRef(null);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      const outputChunk = pendingOutputRef.current;
      const thinkingChunk = pendingThinkingRef.current;
      const phase = pendingThinkingPhaseRef.current;
      pendingOutputRef.current = '';
      pendingThinkingRef.current = '';
      pendingThinkingPhaseRef.current = null;
      rafRef.current = null;

      if (outputChunk || thinkingChunk) {
        patchSession((prev) => {
          const next = { ...prev };
          if (outputChunk) next.output = `${prev.output || ''}${outputChunk}`;
          if (thinkingChunk) {
            next.thinkingText = `${prev.thinkingText || ''}${thinkingChunk}`;
            next.statusText = phase === 'pass2' ? 'Summarizing...' : 'Reasoning...';
          }
          return next;
        });
      }
    });
  }, [patchSession]);

  const appendOutput = useCallback((text) => {
    pendingOutputRef.current += text;
    scheduleFlush();
  }, [scheduleFlush]);

  const appendThinking = useCallback((text, phase) => {
    pendingThinkingRef.current += text;
    if (phase) pendingThinkingPhaseRef.current = phase;
    scheduleFlush();
  }, [scheduleFlush]);

  const cancelBatcher = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingOutputRef.current = '';
    pendingThinkingRef.current = '';
    pendingThinkingPhaseRef.current = null;
  }, []);

  // Clean up on unmount
  useEffect(() => cancelBatcher, [cancelBatcher]);

  return { appendOutput, appendThinking, cancelBatcher };
}

export default function CopilotPanel({ escalationId = null, title = 'Co-pilot' }) {
  const sessionKey = useMemo(() => {
    if (escalationId) return `copilot:escalation:${escalationId}`;
    return `copilot:${String(title || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  }, [escalationId, title]);
  const initialSession = useMemo(() => {
    let initialProvider = DEFAULT_PROVIDER;
    let initialMode = 'fallback';
    let initialFallbackProvider = getAlternateProvider(DEFAULT_PROVIDER);
    let initialReasoningEffort = DEFAULT_REASONING_EFFORT;
    try {
      initialProvider = normalizeProvider(
        window.localStorage.getItem('qbo-copilot-provider')
        || window.localStorage.getItem('qbo-chat-provider')
        || DEFAULT_PROVIDER
      );
      const savedMode = window.localStorage.getItem('qbo-copilot-mode') || window.localStorage.getItem('qbo-chat-mode');
      initialMode = savedMode === 'single' ? 'single' : 'fallback';
      initialFallbackProvider = normalizeProvider(
        window.localStorage.getItem('qbo-copilot-fallback-provider')
        || window.localStorage.getItem('qbo-chat-fallback-provider')
        || getAlternateProvider(initialProvider)
      );
      initialReasoningEffort = normalizeReasoningEffort(
        window.localStorage.getItem('qbo-copilot-reasoning-effort')
        || window.localStorage.getItem('qbo-chat-reasoning-effort')
        || DEFAULT_REASONING_EFFORT
      );
    } catch {
      // Ignore storage failures and keep defaults.
    }
    return {
      mode: escalationId ? 'analyze' : 'search',
      query: '',
      streaming: false,
      output: '',
      thinkingText: '',
      error: '',
      statusText: '',
      provider: initialProvider,
      providerMode: initialMode,
      fallbackProvider: initialFallbackProvider === initialProvider
        ? getAlternateProvider(initialProvider)
        : initialFallbackProvider,
      reasoningEffort: initialReasoningEffort,
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
    reasoningEffort,
  } = session;
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);

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

  const { appendOutput, appendThinking, cancelBatcher } = useChunkBatcher(patchSession);

  const needsQuery = MODES_WITH_QUERY.has(mode);

  useEffect(() => {
    const nextFallback = fallbackProvider === provider
      ? getAlternateProvider(provider)
      : fallbackProvider;
    if (nextFallback !== fallbackProvider) {
      patchSession({ fallbackProvider: nextFallback });
    }
  }, [provider, fallbackProvider, patchSession]);

  useEffect(() => {
    try {
      window.localStorage.setItem('qbo-copilot-provider', provider);
      window.localStorage.setItem('qbo-copilot-mode', providerMode);
      window.localStorage.setItem('qbo-copilot-fallback-provider', fallbackProvider);
      window.localStorage.setItem('qbo-copilot-reasoning-effort', reasoningEffort);
    } catch {
      // ignore localStorage failures
    }
  }, [provider, providerMode, fallbackProvider, reasoningEffort]);

  const handleRun = useCallback(() => {
    if (streaming) return;
    if (needsQuery && !query.trim()) return;

    patchSession({
      output: '',
      thinkingText: '',
      error: '',
      statusText: '',
      streaming: true,
    });

    let streamFn;
    if (mode === 'analyze') streamFn = (handlers, options) => streamAnalyzeEscalation(escalationId, handlers, options);
    else if (mode === 'similar') streamFn = (handlers, options) => streamFindSimilar(escalationId, handlers, options);
    else if (mode === 'template') streamFn = (handlers, options) => streamSuggestTemplate(escalationId, handlers, options);
    else if (mode === 'generate') streamFn = (handlers, options) => streamGenerateTemplate('general', query.trim(), handlers, options);
    else if (mode === 'improve') streamFn = (handlers, options) => streamImproveTemplate(query.trim(), handlers, options);
    else if (mode === 'trends') streamFn = (handlers, options) => streamExplainTrends(handlers, options);
    else if (mode === 'playbook') streamFn = (handlers, options) => streamPlaybookCheck(handlers, options);
    else streamFn = (handlers, options) => streamSemanticSearch(query.trim(), handlers, options);

    const { abort } = streamFn({
      onStart: (data) => {
        patchSession({
          statusText:
          `Running with ${getProviderShortLabel(data?.primaryProvider || provider)}`
          + (data?.fallbackProvider ? ` + ${getProviderShortLabel(data.fallbackProvider)}` : '')
        });
      },
      onStatus: (data) => {
        patchSession({ statusText: data?.message || '' });
      },
      onThinking: (data) => {
        appendThinking(data?.thinking || '', data?.phase);
      },
      onChunk: (data) => {
        appendOutput(data.text || '');
      },
      onProviderError: (data) => {
        patchSession({ statusText: data?.message || 'Provider attempt failed' });
      },
      onFallback: (data) => {
        patchSession({
          statusText: `Switched from ${getProviderShortLabel(data?.from || provider)} to ${getProviderShortLabel(data?.to || fallbackProvider)}`,
        });
      },
      onDone: (data) => {
        setController(null);
        patchSession((prev) => ({
          ...prev,
          output: prev.output || data.fullResponse || '',
          statusText: `Completed with ${getProviderShortLabel(data?.providerUsed || data?.provider || provider)}`,
          streaming: false,
        }));
      },
      onError: (msg) => {
        setController(null);
        patchSession({
          error: typeof msg === 'string' ? msg : (msg?.message || 'Copilot request failed'),
          statusText: '',
          streaming: false,
        });
      },
    }, {
      provider,
      mode: providerMode,
      fallbackProvider: providerMode === 'fallback' ? fallbackProvider : undefined,
      reasoningEffort,
    });

    setController(abort);
  }, [
    streaming,
    needsQuery,
    query,
    mode,
    escalationId,
    provider,
    providerMode,
    fallbackProvider,
    reasoningEffort,
    patchSession,
    setController,
    appendOutput,
    appendThinking,
  ]);

  function handleStop() {
    cancelBatcher();
    abortSession();
    setController(null);
    patchSession({
      streaming: false,
      statusText: '',
    });
  }

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
          <button type="button" className="workspace-agent-provider-btn" onClick={() => setProviderMenuOpen((prev) => !prev)}>
            {getProviderShortLabel(provider)}
            {providerMode === 'fallback' ? ` + ${getProviderShortLabel(fallbackProvider)}` : ''}
          </button>
          {providerMenuOpen && (
            <div className="workspace-agent-provider-popover" style={{ left: 'auto', right: 0, width: 260 }}>
              <div className="provider-popover-label">Provider</div>
              {PROVIDER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`provider-popover-option${provider === option.value ? ' is-selected' : ''}`}
                  onClick={() => patchSession({ provider: option.value })}
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
              {REASONING_EFFORT_OPTIONS.map((option) => (
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
