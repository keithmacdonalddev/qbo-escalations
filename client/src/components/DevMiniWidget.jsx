import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { transitions, widgetSlideUp, scalePop, staggerContainer, staggerChild } from '../utils/motion.js';

const PROVIDER_LABELS = {
  claude: 'Claude',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'chatgpt-5.3-codex-high': 'Codex',
  'gpt-5-mini': 'GPT-5 Mini',
};

function getLabel(provider) {
  return PROVIDER_LABELS[provider] || 'Claude';
}

/**
 * Floating mini widget that shows Dev Mode streaming progress
 * when the user is on another tab. Appears bottom-right.
 */
export default function DevMiniWidget({
  isStreaming,
  streamingText,
  streamProvider,
  provider,
  toolEvents,
  error,
  abortStream,
}) {
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(false);
  const [completedAt, setCompletedAt] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(null);
  const terminalRef = useRef(null);
  const prevStreamingRef = useRef(false);

  // Track streaming start for elapsed timer
  useEffect(() => {
    if (isStreaming && !prevStreamingRef.current) {
      startRef.current = Date.now();
      setDismissed(false);
      setCompletedAt(null);
      setVisible(true);
    }
    if (!isStreaming && prevStreamingRef.current) {
      // Streaming just finished
      setCompletedAt(Date.now());
      setExpanded(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Elapsed timer
  useEffect(() => {
    if (!isStreaming) return;
    const interval = setInterval(() => {
      if (startRef.current) setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isStreaming]);

  // Auto-hide after completion (5s)
  useEffect(() => {
    if (!completedAt || error) return;
    const timeout = setTimeout(() => {
      setVisible(false);
      setDismissed(true);
    }, 5000);
    return () => clearTimeout(timeout);
  }, [completedAt, error]);

  // Keep error visible until dismissed
  useEffect(() => {
    if (error) {
      setVisible(true);
      setCompletedAt(null);
    }
  }, [error]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [streamingText, toolEvents]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setDismissed(true);
    setExpanded(false);
  }, []);

  const handleOpenDevMode = useCallback(() => {
    window.location.hash = '#/dev';
  }, []);

  const handleCollapsedActivate = useCallback(() => {
    if (isStreaming) {
      setExpanded(true);
    } else {
      handleOpenDevMode();
    }
  }, [isStreaming, handleOpenDevMode]);

  // Determine if widget should show
  const shouldShow = visible && !dismissed && (isStreaming || completedAt || error);

  const activeProvider = streamProvider || provider;
  const isComplete = !isStreaming && completedAt && !error;
  const isError = !isStreaming && error;

  // Get the last ~8 lines of streaming text for preview
  const previewLines = (streamingText || '').split('\n').slice(-8).join('\n');
  // Truncated single-line for collapsed view
  const collapsedPreview = (streamingText || '').split('\n').filter(Boolean).slice(-1)[0] || '';

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          key="dev-mini-widget"
          className={`dev-mini-widget ${expanded ? 'dev-mini-widget--expanded' : 'dev-mini-widget--collapsed'}`}
          {...widgetSlideUp}
          transition={transitions.springGentle}
        >
          <AnimatePresence mode="wait" initial={false}>
            {!expanded ? (
              /* ---- Collapsed pill ---- */
              <motion.div
                key="pill"
                className="dev-mini-pill"
                onClick={handleCollapsedActivate}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleCollapsedActivate();
                  }
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={transitions.fast}
              >
                <AnimatePresence mode="wait">
                  {isStreaming && <motion.span key="spin" className="dev-mini-spinner" {...scalePop} transition={transitions.fast} />}
                  {isComplete && (
                    <motion.svg key="check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...scalePop} transition={transitions.springSnappy}>
                      <polyline points="20 6 9 17 4 12" />
                    </motion.svg>
                  )}
                  {isError && (
                    <motion.svg key="error" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--status-danger, #dc2626)" strokeWidth="2.5" strokeLinecap="round" {...scalePop} transition={transitions.springSnappy}>
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </motion.svg>
                  )}
                </AnimatePresence>
                <span className="dev-mini-badge">{getLabel(activeProvider)}</span>
                <span className="dev-mini-status">
                  {isStreaming && 'Streaming...'}
                  {isComplete && 'Done'}
                  {isError && 'Error'}
                </span>
                {isStreaming && <span className="dev-mini-elapsed">{elapsed}s</span>}
                <button
                  className="dev-mini-close"
                  onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
                  type="button"
                  aria-label="Dismiss"
                >
                  &times;
                </button>
              </motion.div>
            ) : (
              /* ---- Expanded card ---- */
              <motion.div
                key="card"
                className="dev-mini-card"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={transitions.fast}
              >
                {/* Header */}
                <div className="dev-mini-header">
                  <div className="dev-mini-header-left">
                    <span className="dev-mini-spinner" />
                    <span className="dev-mini-badge">{getLabel(activeProvider)}</span>
                    <span className="dev-mini-elapsed">{elapsed}s</span>
                  </div>
                  <div className="dev-mini-header-actions">
                    <button
                      className="dev-mini-header-btn"
                      onClick={() => setExpanded(false)}
                      title="Minimize"
                      type="button"
                    >
                      &ndash;
                    </button>
                    <button
                      className="dev-mini-header-btn"
                      onClick={handleOpenDevMode}
                      title="Open Dev Mode"
                      type="button"
                    >
                      &#8599;
                    </button>
                  </div>
                </div>

                {/* Terminal */}
                <div className="dev-mini-terminal" ref={terminalRef}>
                  <motion.div variants={staggerContainer} initial="initial" animate="animate">
                    {toolEvents.map((evt, i) => (
                      <motion.div key={`${evt.tool}-${i}`} variants={staggerChild} transition={transitions.fast} className="dev-mini-tool-line">
                        <span className="dev-mini-tool-icon">&#9654;</span>
                        <span className="dev-mini-tool-name">{evt.tool}</span>
                        {evt.status !== 'started' && (
                          <span className={`dev-mini-tool-status ${evt.status === 'error' ? 'dev-mini-tool-status--error' : ''}`}>
                            {evt.status}
                          </span>
                        )}
                      </motion.div>
                    ))}
                  </motion.div>
                  {previewLines && (
                    <div className="dev-mini-text">
                      {previewLines}
                      {isStreaming && <span className="dev-mini-cursor" />}
                    </div>
                  )}
                  {!previewLines && isStreaming && (
                    <div className="dev-mini-text dev-mini-text--dim">Processing...</div>
                  )}
                </div>

                {/* Footer */}
                <div className="dev-mini-footer">
                  <motion.div className="dev-mini-tool-badges" variants={staggerContainer} initial="initial" animate="animate">
                    {summarizeTools(toolEvents).map(({ tool, count }) => (
                      <motion.span key={tool} variants={staggerChild} transition={transitions.fast} className={`dev-mini-tool-badge dev-mini-tool-badge--${toolClass(tool)}`}>
                        {tool} &times;{count}
                      </motion.span>
                    ))}
                  </motion.div>
                  <div className="dev-mini-footer-actions">
                    {isStreaming && (
                      <button
                        className="dev-mini-stop-btn"
                        onClick={abortStream}
                        type="button"
                        title="Stop"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                      </button>
                    )}
                    <button
                      className="dev-mini-open-btn"
                      onClick={handleOpenDevMode}
                      type="button"
                    >
                      Open Dev Mode &rarr;
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Summarize tool events into { tool, count } for badges */
function summarizeTools(events) {
  const map = {};
  for (const evt of events) {
    const name = evt.tool || 'unknown';
    map[name] = (map[name] || 0) + 1;
  }
  return Object.entries(map).map(([tool, count]) => ({ tool, count }));
}

/** Map tool name to CSS class suffix */
function toolClass(name) {
  const lower = (name || '').toLowerCase();
  if (lower.includes('read') || lower.includes('glob') || lower.includes('grep')) return 'read';
  if (lower.includes('write') || lower.includes('edit')) return 'write';
  if (lower.includes('bash') || lower.includes('exec')) return 'bash';
  return 'default';
}
