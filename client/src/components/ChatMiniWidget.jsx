import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { transitions, widgetSlideUp, scalePop } from '../utils/motion.js';

const PROVIDER_LABELS = {
  claude: 'Claude',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'chatgpt-5.3-codex-high': 'Codex',
  'gpt-5-mini': 'GPT-5 Mini',
};

function getLabel(provider) {
  return PROVIDER_LABELS[provider] || 'Model';
}

function tailLines(text, count = 8) {
  return (text || '').split('\n').slice(-count).join('\n');
}

function lastNonEmptyLine(text) {
  return (text || '').split('\n').filter(Boolean).slice(-1)[0] || '';
}

export default function ChatMiniWidget({
  isStreaming,
  streamingText,
  parallelStreaming,
  streamProvider,
  provider,
  mode,
  conversationId,
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

  const parallelChunks = useMemo(
    () => Object.entries(parallelStreaming || {})
      .filter(([, text]) => Boolean(text))
      .map(([laneProvider, text]) => ({ provider: laneProvider, text })),
    [parallelStreaming]
  );

  const isParallel = (mode === 'parallel' && isStreaming) || parallelChunks.length > 1;

  useEffect(() => {
    if (isStreaming && !prevStreamingRef.current) {
      startRef.current = Date.now();
      setDismissed(false);
      setCompletedAt(null);
      setVisible(true);
    }
    if (!isStreaming && prevStreamingRef.current) {
      setCompletedAt(Date.now());
      setExpanded(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    if (!isStreaming) return undefined;
    const interval = setInterval(() => {
      if (startRef.current) {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isStreaming]);

  useEffect(() => {
    if (!completedAt || error) return undefined;
    const timeout = setTimeout(() => {
      setVisible(false);
      setDismissed(true);
    }, 5000);
    return () => clearTimeout(timeout);
  }, [completedAt, error]);

  useEffect(() => {
    if (error) {
      setVisible(true);
      setCompletedAt(null);
    }
  }, [error]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [streamingText, parallelChunks]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setDismissed(true);
    setExpanded(false);
  }, []);

  const handleOpenChat = useCallback(() => {
    window.location.hash = conversationId ? `#/chat/${conversationId}` : '#/chat';
  }, [conversationId]);

  const handleCollapsedActivate = useCallback(() => {
    if (isStreaming) {
      setExpanded(true);
    } else {
      handleOpenChat();
    }
  }, [isStreaming, handleOpenChat]);

  const shouldShow = visible && !dismissed && (isStreaming || completedAt || error);

  const activeProvider = streamProvider || provider;
  const isComplete = !isStreaming && completedAt && !error;
  const isError = !isStreaming && error;

  const previewLines = isParallel ? '' : tailLines(streamingText, 8);
  const collapsedPreview = isParallel
    ? parallelChunks.map((chunk) => getLabel(chunk.provider)).join(' + ')
    : lastNonEmptyLine(streamingText);

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          key="chat-mini-widget"
          className={`chat-mini-widget ${expanded ? 'chat-mini-widget--expanded' : 'chat-mini-widget--collapsed'}`}
          {...widgetSlideUp}
          transition={transitions.springGentle}
        >
          <AnimatePresence mode="wait" initial={false}>
            {!expanded ? (
              <motion.div
                key="pill"
                className="chat-mini-pill"
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
                  {isStreaming && <motion.span key="spin" className="chat-mini-spinner" {...scalePop} transition={transitions.fast} />}
                  {isComplete && (
                    <motion.svg key="check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...scalePop} transition={transitions.springSnappy}>
                      <polyline points="20 6 9 17 4 12" />
                    </motion.svg>
                  )}
                  {isError && (
                    <motion.svg key="error" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f85149" strokeWidth="2.5" strokeLinecap="round" {...scalePop} transition={transitions.springSnappy}>
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </motion.svg>
                  )}
                </AnimatePresence>
                <span className="chat-mini-badge">{isParallel ? 'Parallel' : getLabel(activeProvider)}</span>
                <span className="chat-mini-status">
                  {isStreaming && 'Streaming...'}
                  {isComplete && 'Done'}
                  {isError && 'Error'}
                </span>
                {isStreaming && <span className="chat-mini-elapsed">{elapsed}s</span>}
                {collapsedPreview && (
                  <span className="chat-mini-preview">{collapsedPreview}</span>
                )}
                <button
                  className="chat-mini-close"
                  onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
                  type="button"
                  aria-label="Dismiss"
                >
                  &times;
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="card"
                className="chat-mini-card"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={transitions.fast}
              >
                <div className="chat-mini-header">
                  <div className="chat-mini-header-left">
                    <span className="chat-mini-spinner" />
                    <span className="chat-mini-badge">{isParallel ? 'Parallel' : getLabel(activeProvider)}</span>
                    <span className="chat-mini-elapsed">{elapsed}s</span>
                  </div>
                  <div className="chat-mini-header-actions">
                    <button
                      className="chat-mini-header-btn"
                      onClick={() => setExpanded(false)}
                      title="Minimize"
                      type="button"
                    >
                      &ndash;
                    </button>
                    <button
                      className="chat-mini-header-btn"
                      onClick={handleOpenChat}
                      title="Open chat"
                      type="button"
                    >
                      &#8599;
                    </button>
                  </div>
                </div>

                <div className="chat-mini-terminal" ref={terminalRef}>
                  {isParallel ? (
                    <div className="chat-mini-lanes">
                      {parallelChunks.map((chunk) => (
                        <div key={chunk.provider} className="chat-mini-lane">
                          <div className="chat-mini-lane-head">{getLabel(chunk.provider)}</div>
                          <div className="chat-mini-lane-text">
                            {tailLines(chunk.text, 4)}
                            {isStreaming && <span className="chat-mini-cursor" />}
                          </div>
                        </div>
                      ))}
                      {parallelChunks.length === 0 && (
                        <div className="chat-mini-text chat-mini-text--dim">Waiting for provider output...</div>
                      )}
                    </div>
                  ) : (
                    <>
                      {previewLines ? (
                        <div className="chat-mini-text">
                          {previewLines}
                          {isStreaming && <span className="chat-mini-cursor" />}
                        </div>
                      ) : (
                        <div className="chat-mini-text chat-mini-text--dim">Processing...</div>
                      )}
                    </>
                  )}
                </div>

                <div className="chat-mini-footer">
                  <span className="chat-mini-footer-mode">
                    {isParallel ? 'Parallel chat' : 'Regular chat'}
                  </span>
                  <div className="chat-mini-footer-actions">
                    {isStreaming && (
                      <button
                        className="chat-mini-stop-btn"
                        onClick={abortStream}
                        type="button"
                        title="Stop"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="6" width="12" height="12" rx="2" />
                        </svg>
                      </button>
                    )}
                    <button
                      className="chat-mini-open-btn"
                      onClick={handleOpenChat}
                      type="button"
                    >
                      Open Chat &rarr;
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
