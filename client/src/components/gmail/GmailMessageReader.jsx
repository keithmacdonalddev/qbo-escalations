import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiFetch } from '../../lib/gmail/gmailApi.js';
import { SYSTEM_LABEL_DISPLAY, getInitials, avatarColor } from '../../lib/gmail/gmailInboxHelpers.jsx';
import GmailReaderHeader from './GmailReaderHeader.jsx';
import { SnoozeDropdown } from './GmailInboxOverlays.jsx';
import { parseListUnsubscribe } from './GmailUnsubscribePanel.jsx';

function GmailLoadingSpinner({ text = 'Loading...' }) {
  return (
    <div className="gmail-loading">
      <div className="gmail-spinner" />
      <span>{text}</span>
    </div>
  );
}

function GmailError({ message, onRetry }) {
  return (
    <div className="gmail-error-state">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
      <p>{message}</p>
      {onRetry && <button className="gmail-btn gmail-btn-primary" onClick={onRetry}>Retry</button>}
    </div>
  );
}

function QuickReplyInline({ msg, onSent, activeAccount }) {
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (expanded && textareaRef.current) textareaRef.current.focus();
  }, [expanded]);

  const senderName = msg?.from?.split('<')[0]?.trim() || msg?.from || 'sender';

  const handleSend = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      const replyTo = msg.fromEmail || msg.from || '';
      const replySubject = msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject || ''}`;
      const rfcMsgId = msg.messageId || msg.id;
      const refs = msg.references ? `${msg.references} ${rfcMsgId}` : rfcMsgId;
      const result = await apiFetch('/messages/send', {
        method: 'POST',
        body: JSON.stringify({
          to: replyTo,
          subject: replySubject,
          body: body,
          threadId: msg.threadId || undefined,
          inReplyTo: rfcMsgId,
          references: refs,
        }),
      }, activeAccount || undefined);
      if (result.ok) {
        setSent(true);
        setBody('');
        setTimeout(() => { setSent(false); setExpanded(false); }, 2000);
        onSent?.();
      }
    } catch { /* ignore */ }
    finally { setSending(false); }
  };

  return (
    <div className="gmail-quick-reply">
      {!expanded ? (
        <button className="gmail-quick-reply-collapsed" onClick={() => setExpanded(true)} type="button">
          <div className="gmail-quick-reply-avatar" style={{ background: avatarColor('me') }}>
            {getInitials('Me')}
          </div>
          <span>Click to reply to {senderName}...</span>
        </button>
      ) : (
        <div className="gmail-quick-reply-expanded">
          <div className="gmail-quick-reply-label">Reply to {senderName}</div>
          <textarea
            ref={textareaRef}
            className="gmail-quick-reply-textarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your reply..."
            rows={4}
          />
          <div className="gmail-quick-reply-footer">
            {sent && <span className="gmail-quick-reply-sent">Sent!</span>}
            <button className="gmail-btn" onClick={() => { setExpanded(false); setBody(''); }} type="button">Cancel</button>
            <button className="gmail-btn gmail-btn-send" onClick={handleSend} disabled={!body.trim() || sending} type="button">
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function stripHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent || '';
}

function findUnsubscribeLinkInBody(html) {
  if (!html) return null;
  const anchorRegex = /<a\s[^>]*href=["']([^"']+)["'][^>]*>[^<]*unsubscribe[^<]*<\/a>/gi;
  const match = anchorRegex.exec(html);
  if (match && match[1]) {
    const href = match[1];
    if (href.startsWith('http://') || href.startsWith('https://')) return href;
  }
  const altRegex = /<a\s[^>]*href=["']([^"']+)["'][^>]*>[^<]*\bunsubscrib/gi;
  const altMatch = altRegex.exec(html);
  if (altMatch && altMatch[1]) {
    const href = altMatch[1];
    if (href.startsWith('http://') || href.startsWith('https://')) return href;
  }
  return null;
}

function UnsubscribeChip({ msg }) {
  const unsubLink = useMemo(() => {
    if (!msg) return null;
    if (msg.listUnsubscribe) {
      const { url } = parseListUnsubscribe(msg.listUnsubscribe);
      if (url) return url;
    }
    if (msg.bodyType === 'html' && msg.body) {
      return findUnsubscribeLinkInBody(msg.body);
    }
    return null;
  }, [msg]);

  if (!unsubLink) return null;

  return (
    <div className="gmail-unsub-chip-wrap">
      <button
        className="gmail-unsub-chip"
        onClick={() => window.open(unsubLink, '_blank', 'noopener,noreferrer')}
        type="button"
        title="Open unsubscribe link in new tab"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
        Unsubscribe
      </button>
    </div>
  );
}

function TrackerShield({ msg }) {
  const [showPopover, setShowPopover] = useState(false);
  const shieldRef = useRef(null);

  if (!msg || !msg.trackerCount || msg.trackerCount === 0) return null;

  const trackers = msg.trackers || [];
  const count = msg.trackerCount;

  const byType = { pixel: [], 'tracker-domain': [], 'query-heavy': [] };
  for (const t of trackers) {
    if (byType[t.type]) byType[t.type].push(t);
    else byType['tracker-domain'].push(t);
  }

  const typeLabels = {
    pixel: '1x1 Pixel',
    'tracker-domain': 'Tracking Domain',
    'query-heavy': 'Query Beacon',
  };

  return (
    <div className="tracker-shield" ref={shieldRef}>
      <button
        className="tracker-shield-badge"
        onClick={() => setShowPopover((p) => !p)}
        onMouseEnter={() => setShowPopover(true)}
        onMouseLeave={() => setShowPopover(false)}
        type="button"
        title={`${count} tracking pixel${count !== 1 ? 's' : ''} blocked`}
      >
        <svg className="tracker-shield-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <span>{count} tracker{count !== 1 ? 's' : ''} blocked</span>
      </button>

      <AnimatePresence>
        {showPopover && trackers.length > 0 && (
          <motion.div
            className="tracker-shield-popover"
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.12 }}
          >
            <div className="tracker-shield-popover-title">Blocked Trackers</div>
            <div className="tracker-shield-popover-list">
              {Object.entries(byType).map(([type, items]) =>
                items.length > 0 ? (
                  <div key={type} className="tracker-shield-group">
                    <div className="tracker-shield-group-label">{typeLabels[type] || type}</div>
                    {items.map((t, i) => (
                      <div key={`${type}-${i}`} className="tracker-shield-item">
                        <span className="tracker-shield-domain">{t.domain}</span>
                      </div>
                    ))}
                  </div>
                ) : null
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function GmailMessageReader({
  messageId,
  onBack,
  onOpenAiPanel,
  onReply,
  onForward,
  onArchive,
  onTrash,
  onToggleStar,
  onToggleRead,
  onApplyLabel,
  labels,
  showToast,
  activeAccount,
}) {
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const iframeRef = useRef(null);
  const [showLabelDropdown, setShowLabelDropdown] = useState(false);
  const [actionBusy, setActionBusy] = useState(null);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/messages/${messageId}`, {}, activeAccount || undefined)
      .then((data) => {
        if (cancelled) return;
        if (!data.ok) { setError(data.error || 'Failed to load message'); setLoading(false); return; }
        setMsg(data);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) { setError(err.message); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [messageId, retryCount]);

  useEffect(() => {
    if (!msg || msg.bodyType !== 'html' || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const handleLoad = () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        const style = doc.createElement('style');
        style.textContent = `
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; margin: 8px; word-break: break-word; }
          img { max-width: 100%; height: auto; }
          a { color: var(--accent, #1a7a6d); }
          @media (prefers-color-scheme: dark) {
            body { color: #ede8e1; }
            a { color: #4ec9b5; }
          }
        `;
        doc.head.appendChild(style);
        const resize = () => {
          if (doc.body) iframe.style.height = Math.max(doc.body.scrollHeight + 20, 200) + 'px';
        };
        resize();
        setTimeout(resize, 300);
      } catch { /* cross-origin, ignore */ }
    };
    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, [msg]);

  const getEmailContext = useCallback(() => {
    if (!msg) return null;
    const bodyText = msg.bodyType === 'html' ? stripHtml(msg.body) : msg.body;
    return {
      from: msg.from,
      fromEmail: msg.fromEmail,
      to: msg.to,
      subject: msg.subject,
      date: msg.date,
      body: bodyText,
    };
  }, [msg]);

  const handleSummarize = useCallback(() => {
    const emailContext = getEmailContext();
    if (!emailContext) return;
    onOpenAiPanel?.({
      emailContext,
      prompt: 'Summarize this email concisely. Highlight key points, action items, sender intent, and any deadlines.',
      source: 'gmail-reader-summarize',
    });
    showToast?.('Workspace Agent is summarizing this email.');
  }, [getEmailContext, onOpenAiPanel, showToast]);

  const handleDraftReply = useCallback(() => {
    const emailContext = getEmailContext();
    if (!emailContext) return;
    onOpenAiPanel?.({
      emailContext,
      prompt: 'Draft a professional reply to this email. Output only the reply body text, with no subject line.',
      source: 'gmail-reader-draft-reply',
    });
    showToast?.('Workspace Agent is drafting a reply.');
  }, [getEmailContext, onOpenAiPanel, showToast]);

  if (loading) return <GmailLoadingSpinner text="Loading message..." />;
  if (error) return <GmailError message={error} onRetry={() => setRetryCount(c => c + 1)} />;
  if (!msg) return null;

  return (
    <motion.div
      className="gmail-reader"
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 30 }}
      transition={{ duration: 0.15 }}
    >
      <div className="gmail-reader-toolbar">
        <button className="gmail-btn gmail-btn-back" onClick={onBack} type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
          </svg>
          Back
        </button>
        <div className="gmail-action-toolbar">
          <button className="gmail-action-btn" onClick={() => onReply?.(msg)} type="button" title="Reply" aria-label="Reply">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 00-4-4H4" />
            </svg>
          </button>
          <button className="gmail-action-btn" onClick={() => onForward?.(msg)} type="button" title="Forward" aria-label="Forward">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 17 20 12 15 7" /><path d="M4 18v-2a4 4 0 014-4h12" />
            </svg>
          </button>
          <div className="gmail-action-divider" />
          <button className="gmail-action-btn" onClick={() => { setActionBusy('archive'); onArchive?.(msg.id); }} disabled={actionBusy === 'archive'} type="button" title="Archive" aria-label="Archive">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
            </svg>
          </button>
          <button className="gmail-action-btn gmail-action-btn-danger" onClick={() => setConfirmTrash(true)} type="button" title="Move to Trash" aria-label="Move to Trash">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
          <div className="gmail-action-label-wrap">
            <button className="gmail-action-btn" onClick={() => setShowSnooze((p) => !p)} type="button" title="Snooze" aria-label="Snooze">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
            {showSnooze && (
              <SnoozeDropdown
                onSnooze={(label, time) => { showToast?.(`Snoozed until ${time}`); }}
                onClose={() => setShowSnooze(false)}
              />
            )}
          </div>
          <div className="gmail-action-divider" />
          <button className={`gmail-action-btn${msg.isStarred ? ' is-active' : ''}`} onClick={() => onToggleStar?.(msg)} type="button" title={msg.isStarred ? 'Unstar' : 'Star'} aria-label={msg.isStarred ? 'Unstar' : 'Star'}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill={msg.isStarred ? 'var(--warning)' : 'none'} stroke={msg.isStarred ? 'var(--warning)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
          <button className={`gmail-action-btn${msg.isUnread ? ' is-active' : ''}`} onClick={() => onToggleRead?.(msg)} type="button" title={msg.isUnread ? 'Mark as read' : 'Mark as unread'} aria-label={msg.isUnread ? 'Mark as read' : 'Mark as unread'}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {msg.isUnread ? (
                <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 7l10 6 10-6" /></>
              ) : (
                <><path d="M22 13V6a2 2 0 00-2-2H4a2 2 0 00-2 2v12a2 2 0 002 2h9" /><path d="M2 7l10 6 10-6" /><path d="M16 19h6" /><path d="M19 16v6" /></>
              )}
            </svg>
          </button>
          <div className="gmail-action-label-wrap">
            <button className="gmail-action-btn" onClick={() => setShowLabelDropdown((p) => !p)} type="button" title="Add label" aria-label="Add label">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
                <line x1="7" y1="7" x2="7.01" y2="7" />
              </svg>
            </button>
            {showLabelDropdown && (
              <div className="gmail-action-label-dropdown">
                {(labels || []).filter((l) => l.type === 'user' || ['STARRED', 'IMPORTANT'].includes(l.id)).map((l) => {
                  const hasLabel = (msg.labels || []).includes(l.id);
                  return (
                    <button
                      key={l.id}
                      className={`gmail-action-label-option${hasLabel ? ' is-applied' : ''}`}
                      onClick={() => { onApplyLabel?.(msg.id, l.id, !hasLabel); setShowLabelDropdown(false); }}
                      type="button"
                    >
                      <span className="gmail-action-label-check">{hasLabel ? '\u2713' : ''}</span>
                      <span>{SYSTEM_LABEL_DISPLAY[l.id] || l.name}</span>
                    </button>
                  );
                })}
                {(labels || []).filter((l) => l.type === 'user' || ['STARRED', 'IMPORTANT'].includes(l.id)).length === 0 && (
                  <div className="gmail-action-label-empty">No labels available</div>
                )}
              </div>
            )}
          </div>
        </div>
        {confirmTrash && (
          <div className="gmail-action-confirm">
            <span>Move to Trash?</span>
            <button className="gmail-btn gmail-btn-danger gmail-btn-sm" onClick={() => { setConfirmTrash(false); onTrash?.(msg.id); }} type="button">Trash</button>
            <button className="gmail-btn gmail-btn-sm" onClick={() => setConfirmTrash(false)} type="button">Cancel</button>
          </div>
        )}
        <div className="gmail-reader-ai-actions">
          <button
            className="gmail-btn gmail-ai-action-btn"
            onClick={handleSummarize}
            type="button"
            title="Summarize this email with the Workspace Agent"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            Summarize
          </button>
          <button
            className="gmail-btn gmail-ai-action-btn"
            onClick={handleDraftReply}
            type="button"
            title="Draft a reply with the Workspace Agent"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Draft Reply
          </button>
          <button
            className="gmail-btn gmail-ai-action-btn"
            onClick={() => onOpenAiPanel?.({
              emailContext: getEmailContext(),
              source: 'gmail-reader-open-agent',
            })}
            type="button"
            title="Open Workspace Agent with this email"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            Ask Agent
          </button>
        </div>
      </div>
      <div className="gmail-reader-content">
        <GmailReaderHeader msg={msg} />
        <UnsubscribeChip msg={msg} />
        <TrackerShield msg={msg} />
        <div className="gmail-reader-body">
          {msg.bodyType === 'html' ? (
            <iframe
              ref={iframeRef}
              className="gmail-reader-iframe"
              sandbox="allow-same-origin"
              srcDoc={msg.body}
              title="Email content"
            />
          ) : (
            <pre className="gmail-reader-plaintext">{msg.body}</pre>
          )}
        </div>
        <QuickReplyInline msg={msg} onSent={() => showToast?.('Reply sent!')} activeAccount={activeAccount} />
      </div>
    </motion.div>
  );
}
