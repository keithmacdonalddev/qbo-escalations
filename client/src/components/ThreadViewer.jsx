import { useState, useEffect, useRef, useCallback } from 'react';
import { getDevConversation } from '../api/devApi.js';
import { CopyButton } from '../utils/markdown.jsx';
import { formatDateWithTime as formatDate } from '../utils/dateFormatting.js';
import './ThreadViewer.css';

/**
 * localStorage key map — mirrors useBackgroundConversations.js CHANNEL_KEYS.
 * We read directly rather than importing the hook to avoid adding state overhead.
 */
const CHANNEL_LS_KEYS = {
  'auto-errors': 'qbo-dev-bg-auto-errors',
  'code-reviews': 'qbo-dev-bg-code-reviews',
  'quality-scans': 'qbo-dev-bg-quality-scans',
};

const CHANNEL_LABELS = {
  'auto-errors': 'Auto-Errors',
  'code-reviews': 'Code Reviews',
  'quality-scans': 'Quality Scans',
};

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}


/**
 * Read-only slide-over panel that shows the full conversation thread
 * for a background channel (auto-errors, code-reviews, quality-scans).
 *
 * @param {{ channel: string, onClose: () => void }} props
 */
export default function ThreadViewer({ channel, onClose }) {
  const [conversation, setConversation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [visible, setVisible] = useState(false);
  const scrollRef = useRef(null);

  // Slide-in animation on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Fetch conversation from MongoDB via API
  useEffect(() => {
    setLoading(true);
    setError(null);
    setConversation(null);

    const lsKey = CHANNEL_LS_KEYS[channel];
    if (!lsKey) {
      setError(`Unknown channel: ${channel}`);
      setLoading(false);
      return;
    }

    let conversationId;
    try {
      conversationId = window.localStorage.getItem(lsKey) || null;
    } catch {
      conversationId = null;
    }

    if (!conversationId) {
      setError('No conversation found for this channel. The channel may not have been used yet.');
      setLoading(false);
      return;
    }

    let cancelled = false;

    getDevConversation(conversationId)
      .then((conv) => {
        if (cancelled) return;
        setConversation(conv);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Failed to load conversation');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [channel]);

  // Auto-scroll to bottom when conversation loads
  useEffect(() => {
    if (!conversation || !scrollRef.current) return;
    const el = scrollRef.current;
    // Small delay to let DOM render messages
    const t = setTimeout(() => {
      el.scrollTop = el.scrollHeight;
    }, 50);
    return () => clearTimeout(t);
  }, [conversation]);

  // Close with slide-out animation
  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 200); // match CSS transition duration
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose]);

  const messages = conversation?.messages || [];
  const label = CHANNEL_LABELS[channel] || channel;
  const msgCount = messages.length;
  const lastUpdated = conversation?.updatedAt ? formatDate(conversation.updatedAt) : null;

  return (
    <div
      className={`aal-thread-overlay${visible ? ' is-visible' : ''}`}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className={`aal-thread-panel${visible ? ' is-visible' : ''}`}>
        {/* Header */}
        <div className="aal-thread-header">
          <div className="aal-thread-header-left">
            <span className="aal-thread-channel-badge">{label}</span>
            {msgCount > 0 && (
              <span className="aal-thread-msg-count">{msgCount} messages</span>
            )}
            {lastUpdated && (
              <span className="aal-thread-updated">Last: {lastUpdated}</span>
            )}
          </div>
          <button
            className="aal-thread-close"
            onClick={handleClose}
            type="button"
            title="Close thread viewer"
          >
            x
          </button>
        </div>

        {/* Body */}
        <div className="aal-thread-body" ref={scrollRef}>
          {loading && (
            <div className="aal-thread-state">
              <div className="aal-thread-spinner" />
              <span>Loading thread...</span>
            </div>
          )}

          {error && (
            <div className="aal-thread-state aal-thread-state--error">
              <span className="aal-thread-error-icon">!</span>
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && messages.length === 0 && (
            <div className="aal-thread-state">
              <span>No messages in this conversation.</span>
            </div>
          )}

          {!loading && !error && messages.map((msg, idx) => (
            <div
              key={idx}
              className={`aal-thread-msg aal-thread-msg--${msg.role}`}
            >
              <div className="aal-thread-msg-meta">
                <span className={`aal-thread-msg-role aal-thread-role--${msg.role}`}>
                  {msg.role}
                </span>
                {msg.provider && (
                  <span className="aal-thread-msg-provider">{msg.provider}</span>
                )}
                {msg.usage?.model && (
                  <span className="aal-thread-msg-model">{msg.usage.model}</span>
                )}
                <span className="aal-thread-msg-time">
                  {formatTimestamp(msg.timestamp)}
                </span>
                {msg.usage?.totalTokens && (
                  <span className="aal-thread-msg-tokens">
                    {msg.usage.totalTokens.toLocaleString()} tok
                  </span>
                )}
                {msg.usage?.totalCostMicros > 0 && (
                  <span className="aal-thread-msg-cost" style={{ fontSize: '10px', opacity: 0.7 }}>
                    ${(msg.usage.totalCostMicros / 1_000_000).toFixed(4)}
                  </span>
                )}
                <CopyButton text={msg.content || ''} style={{ padding: 0, background: 'none', border: 'none', opacity: 0.5, cursor: 'pointer', marginLeft: 'auto' }} />
              </div>
              <div className="aal-thread-msg-content">
                {msg.content || '(empty)'}
              </div>
              {msg.toolEvents && msg.toolEvents.length > 0 && (
                <div className="aal-thread-tools">
                  <span className="aal-thread-tools-label">
                    Tools ({msg.toolEvents.length}):
                  </span>
                  {msg.toolEvents.map((te, ti) => (
                    <span
                      key={ti}
                      className={`aal-thread-tool-chip aal-thread-tool--${te.status}`}
                    >
                      {te.tool}
                      {te.status === 'error' && ' !'}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
