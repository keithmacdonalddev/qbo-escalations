import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { transitions, widgetSlideUp, scalePop, staggerContainer, staggerChild } from '../utils/motion.js';
import { getProviderShortLabel } from '../lib/providerCatalog.js';
import { useDevAgent } from '../context/DevAgentContext.jsx';
import AgentActivityLog from './AgentActivityLog.jsx';
import { useTokenMonitor, formatTokenCount, formatCost } from '../hooks/useTokenMonitor.js';

/**
 * Floating mini widget with two modes:
 * 1. Quick-chat FAB — always available on non-dev pages for sending
 *    messages to the foreground dev conversation without navigating away.
 * 2. Streaming monitor — when the dev agent is actively streaming,
 *    shows progress overlay with tool events and live text preview.
 *
 * Quick-chat messages go to the FOREGROUND conversation via sendMessage().
 */
/** Notification type -> icon SVG */
const NOTIFICATION_ICONS = {
  'fix-applied': (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  'error-resolved': (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  'error-escalated': (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
};

/** Event types that trigger fix notifications */
const FIX_EVENT_TYPES = new Set(['fix-applied', 'error-resolved', 'error-escalated']);

export default function DevMiniWidget() {
  const {
    isStreaming,
    streamingText,
    streamProvider,
    provider,
    toolEvents,
    error,
    messages,
    sendMessage,
    abortStream,
    miniWidgetOpen,
    setMiniWidgetOpen,
    miniWidgetInputRef,
    agentHealthy,
    healthDetails,
    serverState,
    activityLog,
    bgLastResults,
  } = useDevAgent();

  const tokenStats = useTokenMonitor({ messages, bgLastResults });

  // --- Streaming monitor state ---
  const [streamExpanded, setStreamExpanded] = useState(false);
  const [streamVisible, setStreamVisible] = useState(false);
  const [completedAt, setCompletedAt] = useState(null);
  const [streamDismissed, setStreamDismissed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(null);
  const terminalRef = useRef(null);
  const prevStreamingRef = useRef(false);
  const chatScrollRef = useRef(null);

  // --- Quick-chat state ---
  const [inputValue, setInputValue] = useState('');

  // --- Fix notification state ---
  const [fixNotification, setFixNotification] = useState(null);
  const fixNotifTimerRef = useRef(null);
  const lastNotifIdRef = useRef(null);

  useEffect(() => {
    const entries = activityLog?.entries;
    if (!entries || entries.length === 0) return;

    const latest = entries[entries.length - 1];
    if (!FIX_EVENT_TYPES.has(latest.type)) return;
    if (latest.id === lastNotifIdRef.current) return; // Already shown

    lastNotifIdRef.current = latest.id;
    setFixNotification(latest);

    // Clear any existing timer
    if (fixNotifTimerRef.current) clearTimeout(fixNotifTimerRef.current);

    // Auto-dismiss after 8 seconds
    fixNotifTimerRef.current = setTimeout(() => {
      setFixNotification(null);
      fixNotifTimerRef.current = null;
    }, 8000);

    return () => {
      if (fixNotifTimerRef.current) {
        clearTimeout(fixNotifTimerRef.current);
        fixNotifTimerRef.current = null;
      }
    };
  }, [activityLog?.entries?.length]);

  // Global Ctrl+Shift+D keyboard shortcut (non-dev pages)
  useEffect(() => {
    function handleGlobalKey(e) {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        if (miniWidgetOpen) {
          // Already open -- just focus input
          miniWidgetInputRef.current?.focus();
        } else {
          setMiniWidgetOpen(true);
          setTimeout(() => miniWidgetInputRef.current?.focus(), 80);
        }
      }
    }
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [miniWidgetOpen, setMiniWidgetOpen, miniWidgetInputRef]);

  // Track streaming start for elapsed timer
  useEffect(() => {
    if (isStreaming && !prevStreamingRef.current) {
      startRef.current = Date.now();
      setStreamDismissed(false);
      setCompletedAt(null);
      setStreamVisible(true);
    }
    if (!isStreaming && prevStreamingRef.current) {
      setCompletedAt(Date.now());
      setStreamExpanded(false);
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

  // Auto-hide streaming monitor after completion (5s)
  useEffect(() => {
    if (!completedAt || error) return;
    const timeout = setTimeout(() => {
      setStreamVisible(false);
      setStreamDismissed(true);
    }, 5000);
    return () => clearTimeout(timeout);
  }, [completedAt, error]);

  // Keep error visible until dismissed
  useEffect(() => {
    if (error) {
      setStreamVisible(true);
      setCompletedAt(null);
    }
  }, [error]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [streamingText, toolEvents]);

  // Auto-scroll chat messages
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleStreamDismiss = useCallback(() => {
    setStreamVisible(false);
    setStreamDismissed(true);
    setStreamExpanded(false);
  }, []);

  const handleOpenDevMode = useCallback(() => {
    window.location.hash = '#/dev';
    setMiniWidgetOpen(false);
  }, [setMiniWidgetOpen]);

  const handleStreamPillClick = useCallback(() => {
    if (isStreaming) {
      setStreamExpanded(true);
    } else {
      handleOpenDevMode();
    }
  }, [isStreaming, handleOpenDevMode]);

  // Send quick-chat message (foreground conversation)
  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || isStreaming) return;
    sendMessage(text);
    setInputValue('');
  }, [inputValue, isStreaming, sendMessage]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // Escape closes the widget
    if (e.key === 'Escape') {
      setMiniWidgetOpen(false);
    }
  }, [handleSend, setMiniWidgetOpen]);

  // Server status helpers
  const serverDown = serverState === 'unreachable';
  const serverDegraded = serverState === 'degraded';
  const showServerPill = serverDown || serverDegraded;

  // Streaming monitor state
  const showStreamMonitor = streamVisible && !streamDismissed && (isStreaming || completedAt || error);
  const activeProvider = streamProvider || provider;
  const isComplete = !isStreaming && completedAt && !error;
  const isError = !isStreaming && error;
  const previewLines = (streamingText || '').split('\n').slice(-8).join('\n');

  // Last 3 messages for compact preview
  const recentMessages = useMemo(() => {
    return (messages || []).slice(-3);
  }, [messages]);

  /** Truncate text to ~100 chars */
  function truncate(text, len = 100) {
    if (!text) return '';
    return text.length > len ? text.slice(0, len) + '...' : text;
  }

  return (
    <>
      {/* --- Quick-chat FAB and panel --- */}
      <AnimatePresence>
        {!miniWidgetOpen && (
          <motion.button
            key="dev-fab"
            className="dev-qc-fab"
            onClick={() => {
              setMiniWidgetOpen(true);
              setTimeout(() => miniWidgetInputRef.current?.focus(), 80);
            }}
            type="button"
            aria-label="Quick chat with dev agent (Ctrl+Shift+D)"
            title="Quick chat (Ctrl+Shift+D)"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={transitions.springSnappy}
          >
            {/* Terminal/chat icon */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
            {isStreaming && <span className="dev-qc-fab-pulse" />}
          </motion.button>
        )}
      </AnimatePresence>

      {/* --- Floating server-status pill (visible when widget is closed + server not reachable) --- */}
      <AnimatePresence>
        {showServerPill && !miniWidgetOpen && (
          <motion.div
            key="dev-server-status"
            className={`dev-server-floating-pill ${serverDown ? 'dev-server-floating-pill--offline' : 'dev-server-floating-pill--degraded'}`}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={transitions.springSnappy}
          >
            <span className="dev-server-floating-dot" />
            {serverDown ? 'Server offline' : 'Degraded'}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {miniWidgetOpen && (
          <motion.div
            key="dev-qc-panel"
            className="dev-qc-panel"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={transitions.springGentle}
          >
            {/* Header */}
            <div className="dev-qc-header">
              <div className="dev-qc-header-left">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ec9b5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
                <span className="dev-qc-title">Dev Agent</span>
                <span
                  className={`dev-health-dot ${agentHealthy ? 'dev-health-dot--ok' : 'dev-health-dot--warn'}`}
                  title={agentHealthy
                    ? 'Agent healthy' + (healthDetails.checkedAt ? ` (checked ${Math.round((Date.now() - healthDetails.checkedAt) / 1000)}s ago)` : '')
                    : (healthDetails.issues || []).join('; ') || 'Issues detected'
                  }
                />
                {isStreaming && <span className="dev-mini-spinner" style={{ width: 10, height: 10 }} />}
                <span className="dev-qc-badge">{getProviderShortLabel(activeProvider)}</span>
                {showServerPill && (
                  <span className={`dev-server-pill ${serverDown ? 'dev-server-pill--offline' : 'dev-server-pill--degraded'}`}>
                    {serverDown ? 'Server offline' : 'Server degraded'}
                  </span>
                )}
              </div>
              <div className="dev-qc-header-actions">
                <button
                  className="dev-mini-header-btn"
                  onClick={handleOpenDevMode}
                  title="Open full Dev Mode"
                  type="button"
                >
                  &#8599;
                </button>
                <button
                  className="dev-mini-header-btn"
                  onClick={() => setMiniWidgetOpen(false)}
                  title="Close (Esc)"
                  type="button"
                >
                  &times;
                </button>
              </div>
            </div>

            {/* Messages preview */}
            <div className="dev-qc-messages" ref={chatScrollRef}>
              {recentMessages.length === 0 && !isStreaming && (
                <div className="dev-qc-empty">No messages yet. Type below to start.</div>
              )}
              {recentMessages.map((msg, i) => (
                <div key={i} className={`dev-qc-msg dev-qc-msg--${msg.role}`}>
                  <span className={`dev-qc-role dev-qc-role--${msg.role}`}>
                    {msg.role === 'user' ? 'You' : 'Dev'}
                  </span>
                  <span className="dev-qc-content">{truncate(msg.content)}</span>
                </div>
              ))}
              {isStreaming && streamingText && (
                <div className="dev-qc-msg dev-qc-msg--assistant">
                  <span className="dev-qc-role dev-qc-role--assistant">Dev</span>
                  <span className="dev-qc-content dev-qc-content--streaming">
                    {truncate(streamingText.split('\n').filter(Boolean).slice(-2).join(' '), 120)}
                    <span className="dev-mini-cursor" />
                  </span>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="dev-qc-input-row">
              <input
                ref={miniWidgetInputRef}
                className="dev-qc-input"
                type="text"
                placeholder={isStreaming ? 'Agent is streaming...' : 'Quick message to dev agent...'}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
                autoComplete="off"
                spellCheck="false"
              />
              <button
                className="dev-qc-send"
                onClick={handleSend}
                disabled={isStreaming || !inputValue.trim()}
                type="button"
                title="Send (Enter)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>

            {/* Compact token stats */}
            {tokenStats.combined.total > 0 && (
              <div className="dev-qc-token-bar">
                <span className="dev-qc-token-stat">
                  {formatTokenCount(tokenStats.combined.total)} tokens
                </span>
                {tokenStats.combined.cost > 0 && (
                  <span className="dev-qc-token-stat dev-qc-token-cost">
                    {formatCost(tokenStats.combined.cost)}
                  </span>
                )}
                {tokenStats.background.total > 0 && (
                  <span className="dev-qc-token-stat dev-qc-token-bg">
                    bg: {formatTokenCount(tokenStats.background.total)}
                  </span>
                )}
              </div>
            )}

            {/* Compact activity log */}
            <AgentActivityLog compact />

            {/* Footer link */}
            <div className="dev-qc-footer">
              <button className="dev-qc-fullview" onClick={handleOpenDevMode} type="button">
                Open full view
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              <span className="dev-qc-shortcut">Ctrl+Shift+D</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- Streaming monitor overlay (separate from quick-chat) --- */}
      <AnimatePresence>
        {showStreamMonitor && !miniWidgetOpen && (
          <motion.div
            key="dev-stream-monitor"
            className={`dev-mini-widget ${streamExpanded ? 'dev-mini-widget--expanded' : 'dev-mini-widget--collapsed'}`}
            style={{ bottom: 72 }}
            {...widgetSlideUp}
            transition={transitions.springGentle}
          >
            <AnimatePresence mode="wait" initial={false}>
              {!streamExpanded ? (
                /* ---- Collapsed pill ---- */
                <motion.div
                  key="pill"
                  className="dev-mini-pill"
                  onClick={handleStreamPillClick}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleStreamPillClick();
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
                  <span className="dev-mini-badge">{getProviderShortLabel(activeProvider)}</span>
                  <span className="dev-mini-status">
                    {isStreaming && 'Streaming...'}
                    {isComplete && 'Done'}
                    {isError && 'Error'}
                  </span>
                  {isStreaming && <span className="dev-mini-elapsed">{elapsed}s</span>}
                  <button
                    className="dev-mini-close"
                    onClick={(e) => { e.stopPropagation(); handleStreamDismiss(); }}
                    type="button"
                    aria-label="Dismiss"
                  >
                    &times;
                  </button>
                </motion.div>
              ) : (
                /* ---- Expanded streaming card ---- */
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
                      <span className="dev-mini-badge">{getProviderShortLabel(activeProvider)}</span>
                      <span className="dev-mini-elapsed">{elapsed}s</span>
                    </div>
                    <div className="dev-mini-header-actions">
                      <button
                        className="dev-mini-header-btn"
                        onClick={() => setStreamExpanded(false)}
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

      {/* --- Fix notification toast --- */}
      <AnimatePresence>
        {fixNotification && (
          <motion.div
            key={`fix-notif-${fixNotification.id}`}
            className={`dev-fix-notification dev-fix-notification--${fixNotification.type}`}
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={transitions.springSnappy}
            onClick={() => setFixNotification(null)}
            role="status"
            aria-live="polite"
          >
            <span className="dev-fix-notification-icon">
              {NOTIFICATION_ICONS[fixNotification.type] || null}
            </span>
            <span className="dev-fix-notification-text">
              {fixNotification.message}
            </span>
            <button
              className="dev-fix-notification-dismiss"
              onClick={(e) => { e.stopPropagation(); setFixNotification(null); }}
              type="button"
              aria-label="Dismiss"
            >
              &times;
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
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
