import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import AgentDock from './AgentDock.jsx';
import { apiFetch as trackedFetch } from '../api/http.js';
import { consumeSSEStream } from '../api/sse.js';
import { useWorkspaceMonitorStream } from '../context/WorkspaceMonitorContext.jsx';
import { getDefaultGmailAccount, resolveConnectedAccount } from '../lib/accountDefaults.js';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const API = '/api/gmail';

/**
 * Fetch from the Gmail API. Supports injecting `account` param for multi-account.
 * For GET requests, appends ?account=... to the URL.
 * For POST/PATCH/PUT, adds `account` to the JSON body.
 * @param {string} path - API path (e.g. '/messages')
 * @param {Object} [opts] - fetch options
 * @param {string} [accountEmail] - optional active account email to use
 */
async function apiFetch(path, opts = {}, accountEmail) {
  let url = `${API}${path}`;

  // For GET/DELETE requests, inject account as query param
  if (accountEmail && (!opts.method || opts.method === 'GET' || opts.method === 'DELETE')) {
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}account=${encodeURIComponent(accountEmail)}`;
  }

  // For POST/PATCH/PUT with JSON body, inject account into body
  let body = opts.body;
  if (accountEmail && opts.method && ['POST', 'PATCH', 'PUT'].includes(opts.method) && body) {
    try {
      const parsed = JSON.parse(body);
      parsed.account = accountEmail;
      body = JSON.stringify(parsed);
    } catch { /* not JSON, skip */ }
  }

  const res = await trackedFetch(url, {
    ...opts,
    body,
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    },
  });
  if (!res.ok && !res.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`Server error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Unified inbox helper — consistent account color from email string
// ---------------------------------------------------------------------------

function getAccountColor(email) {
  let hash = 0;
  for (let i = 0; i < (email || '').length; i++) {
    hash = (email || '').charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 50%)`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function GmailConnectPage({ onConnected, errorParam }) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(errorParam || null);
  const [appConfigured, setAppConfigured] = useState(true);

  useEffect(() => {
    // Check if app credentials are configured
    apiFetch('/auth/status')
      .then((data) => {
        if (data.ok && data.appConfigured === false) {
          setAppConfigured(false);
        }
      })
      .catch(() => {});
  }, []);

  // Clear error param from URL after displaying
  useEffect(() => {
    if (errorParam) {
      const cleaned = window.location.hash.replace(/[?&](error|connected)=[^&]*/g, '');
      if (cleaned !== window.location.hash) {
        window.history.replaceState(null, '', cleaned || '#/workspace/inbox');
      }
    }
  }, [errorParam]);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const data = await apiFetch('/auth/url');
      if (!data.ok) {
        setError(data.error || 'Failed to generate login URL');
        setConnecting(false);
        return;
      }
      // Redirect to Google OAuth consent screen (same tab)
      window.location.href = data.url;
    } catch (err) {
      setError(err.message || 'Network error');
      setConnecting(false);
    }
  };

  if (!appConfigured) {
    return (
      <div className="gmail-auth-page">
        <div className="gmail-auth-card">
          <div className="gmail-auth-icon">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="var(--ink-tertiary)" strokeWidth="1.5" />
              <polyline points="22,6 12,13 2,6" stroke="var(--ink-tertiary)" strokeWidth="1.5" />
            </svg>
          </div>
          <h2 className="gmail-auth-title">Gmail Not Configured</h2>
          <p className="gmail-auth-desc">
            The server needs Google OAuth2 credentials to enable Gmail integration.
            Set <code>GMAIL_CLIENT_ID</code> and <code>GMAIL_CLIENT_SECRET</code> in the server <code>.env</code> file.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="gmail-auth-page">
      <motion.div
        className="gmail-auth-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="gmail-auth-icon">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="4" width="20" height="16" rx="2" stroke="var(--accent)" strokeWidth="1.5" />
            <path d="M2 6l10 7 10-7" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="18" cy="8" r="4" fill="var(--success)" stroke="var(--bg-raised)" strokeWidth="1.5" />
          </svg>
        </div>

        <h2 className="gmail-auth-title">Connect Your Gmail</h2>
        <p className="gmail-auth-desc">
          Sign in with your Google account to access your inbox, read messages,
          and draft replies directly from the escalation workspace.
        </p>

        <div className="gmail-auth-scopes">
          <div className="gmail-auth-scopes-title">This app will be able to:</div>
          <ul className="gmail-auth-scopes-list">
            <li>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              Read your email messages and labels
            </li>
            <li>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              Create draft emails on your behalf
            </li>
            <li>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              View your email address
            </li>
          </ul>
        </div>

        {error && (
          <div className="gmail-auth-error">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <span>{decodeURIComponent(error)}</span>
          </div>
        )}

        <button
          className="gmail-auth-connect-btn"
          onClick={handleConnect}
          disabled={connecting}
          type="button"
        >
          {connecting ? (
            <>
              <div className="gmail-spinner gmail-spinner-sm" />
              Connecting...
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </>
          )}
        </button>

        <p className="gmail-auth-footer">
          You can manage or disconnect your account at any time from Settings &gt; Accounts.
        </p>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account Switcher — multi-account dropdown
// ---------------------------------------------------------------------------

function AccountSwitcher({ accounts, activeAccount, onSwitch, onAdd, onDisconnect, isUnifiedMode, onToggleUnified, unifiedUnreadTotal }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  if (!accounts || accounts.length === 0) return null;

  const activeEmail = activeAccount || (accounts[0] && accounts[0].email) || '';
  const initial = isUnifiedMode ? '*' : (activeEmail ? activeEmail[0].toUpperCase() : '?');

  // Deterministic color for avatar
  const colors = ['#1a7a6d', '#5e3d8a', '#b45309', '#047857', '#c0392b', '#2a6987', '#873555', '#3b3f8a'];
  const colorForEmail = (email) => {
    let hash = 0;
    for (let i = 0; i < (email || '').length; i++) hash = (email || '').charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const triggerLabel = isUnifiedMode ? 'All Inboxes' : activeEmail;
  const triggerBg = isUnifiedMode ? 'var(--accent)' : colorForEmail(activeEmail);

  return (
    <div className="gmail-account-switcher" ref={ref}>
      <button
        className="gmail-account-trigger"
        onClick={() => setOpen((p) => !p)}
        type="button"
        title={isUnifiedMode ? 'Unified Inbox — all accounts' : `Active account: ${activeEmail}`}
        aria-label="Switch Gmail account"
      >
        <span className="gmail-account-avatar" style={{ background: triggerBg }}>
          {initial}
        </span>
        <span className="gmail-account-trigger-email">{triggerLabel}</span>
        {isUnifiedMode && unifiedUnreadTotal > 0 && (
          <span className="gmail-unified-badge">{unifiedUnreadTotal}</span>
        )}
        <svg className={`gmail-account-chevron${open ? ' is-open' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="gmail-account-dropdown"
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.12 }}
          >
            <div className="gmail-account-dropdown-header">Accounts</div>
            {/* All Inboxes unified option — only show when 2+ accounts */}
            {accounts.length >= 2 && (
              <button
                className={`gmail-account-item${isUnifiedMode ? ' is-active' : ''}`}
                onClick={() => {
                  onToggleUnified();
                  setOpen(false);
                }}
                type="button"
              >
                <span className="gmail-account-avatar gmail-account-avatar-sm gmail-unified-avatar" style={{ background: 'var(--accent)' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                    <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
                  </svg>
                </span>
                <span className="gmail-account-item-email">All Inboxes</span>
                {unifiedUnreadTotal > 0 && (
                  <span className="gmail-unified-badge gmail-unified-badge-dropdown">{unifiedUnreadTotal}</span>
                )}
                {isUnifiedMode && (
                  <svg className="gmail-account-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            )}
            {accounts.length >= 2 && <div className="gmail-account-divider" />}
            {accounts.map((acc) => {
              const isActive = !isUnifiedMode && acc.email === activeEmail;
              const accInitial = acc.email ? acc.email[0].toUpperCase() : '?';
              return (
                <div
                  key={acc.email}
                  className={`gmail-account-item${isActive ? ' is-active' : ''}`}
                >
                  <button
                    className="gmail-account-item-main"
                    onClick={() => {
                      if (!isActive || isUnifiedMode) {
                        onSwitch(acc.email);
                      }
                      setOpen(false);
                    }}
                    type="button"
                  >
                    <span className="gmail-account-avatar gmail-account-avatar-sm" style={{ background: colorForEmail(acc.email) }}>
                      {accInitial}
                    </span>
                    <span className="gmail-account-item-email">{acc.email}</span>
                    {isActive && (
                      <svg className="gmail-account-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                  <button
                    className="gmail-account-item-disconnect"
                    onClick={() => { onDisconnect(acc.email); setOpen(false); }}
                    type="button"
                    title={`Disconnect ${acc.email}`}
                    aria-label={`Disconnect ${acc.email}`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              );
            })}
            <button
              className="gmail-account-add"
              onClick={() => { onAdd(); setOpen(false); }}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add another account
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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

function GmailEmpty({ search }) {
  return (
    <div className={`gmail-empty${search ? '' : ' gmail-empty-inbox-zero'}`}>
      <div className="gmail-empty-icon-wrap">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--ink-tertiary)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      </div>
      {search ? (
        <>
          <p className="gmail-empty-title">No results for &ldquo;{search}&rdquo;</p>
          <p className="gmail-empty-sub">Try different keywords or remove filters</p>
        </>
      ) : (
        <>
          <p className="gmail-empty-title">All caught up!</p>
          <p className="gmail-empty-sub">Nothing new here. Time to get things done.</p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyboard Shortcut Help Modal
// ---------------------------------------------------------------------------

function KeyboardShortcutHelp({ onClose }) {
  const shortcuts = [
    { key: 'j / \u2193', desc: 'Next message' },
    { key: 'k / \u2191', desc: 'Previous message' },
    { key: 'Enter / o', desc: 'Open message' },
    { key: 'e', desc: 'Archive' },
    { key: '#', desc: 'Trash' },
    { key: 's', desc: 'Toggle star' },
    { key: 'r', desc: 'Reply' },
    { key: 'f', desc: 'Forward' },
    { key: 'c', desc: 'Compose' },
    { key: 'Esc', desc: 'Back / Close / Deselect' },
    { key: '/', desc: 'Focus search' },
    { key: '?', desc: 'This help' },
  ];
  return (
    <motion.div className="gmail-compose-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="gmail-shortcut-modal"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gmail-shortcut-header">
          <h3>Keyboard Shortcuts</h3>
          <button className="gmail-btn-icon" onClick={onClose} type="button" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="gmail-shortcut-grid">
          {shortcuts.map((s) => (
            <div key={s.key} className="gmail-shortcut-row">
              <kbd className="gmail-shortcut-key">{s.key}</kbd>
              <span className="gmail-shortcut-desc">{s.desc}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Context Menu for message rows
// ---------------------------------------------------------------------------

function MessageContextMenu({ x, y, msg, onClose, onOpen, onReply, onForward, onArchive, onTrash, onToggleStar, onToggleRead }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) onClose(); };
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('keydown', handleKey); };
  }, [onClose]);

  // Adjust position to stay in viewport
  const style = { position: 'fixed', top: y, left: x, zIndex: 5000 };

  const items = [
    { label: 'Open', action: () => onOpen?.(msg.id) },
    { label: 'Reply', action: () => onReply?.(msg) },
    { label: 'Forward', action: () => onForward?.(msg) },
    { divider: true },
    { label: 'Archive', action: () => onArchive?.(msg.id) },
    { label: msg.isStarred ? 'Unstar' : 'Star', action: () => onToggleStar?.(msg) },
    { label: msg.isUnread ? 'Mark as read' : 'Mark as unread', action: () => onToggleRead?.(msg) },
    { label: 'Trash', action: () => onTrash?.(msg.id), danger: true },
    { divider: true },
    { label: 'Copy subject', action: () => { navigator.clipboard?.writeText(msg.subject || ''); } },
    { label: 'Copy sender email', action: () => { navigator.clipboard?.writeText(msg.fromEmail || msg.from || ''); } },
  ];

  return (
    <div ref={menuRef} className="gmail-context-menu" style={style}>
      {items.map((item, i) =>
        item.divider ? (
          <div key={`d${i}`} className="gmail-context-divider" />
        ) : (
          <button
            key={item.label}
            className={`gmail-context-item${item.danger ? ' gmail-context-item-danger' : ''}`}
            onClick={() => { item.action(); onClose(); }}
            type="button"
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Snooze Dropdown
// ---------------------------------------------------------------------------

function SnoozeDropdown({ onSnooze, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const handle = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  const presets = [
    { label: 'Later today', time: 'today, 6:00 PM' },
    { label: 'Tomorrow', time: 'tomorrow, 8:00 AM' },
    { label: 'Next week', time: 'next Monday, 8:00 AM' },
  ];

  return (
    <div ref={ref} className="gmail-snooze-dropdown">
      <div className="gmail-snooze-title">Snooze until...</div>
      {presets.map((p) => (
        <button key={p.label} className="gmail-snooze-option" onClick={() => { onSnooze(p.label, p.time); onClose(); }} type="button">
          <span>{p.label}</span>
          <span className="gmail-snooze-time">{p.time}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick Reply Inline (for MessageReader)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// System Label Icons map
// ---------------------------------------------------------------------------

const SYSTEM_LABEL_ICONS = {
  INBOX: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" /></svg>,
  STARRED: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>,
  SENT: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>,
  DRAFT: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>,
  IMPORTANT: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" /></svg>,
  SPAM: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
  TRASH: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>,
};

/** Format a date string into a short display form. */
function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) {
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

/** Format a full date for the message reader header. */
function formatFullDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

/** Get initials from a name or email for avatar. */
function getInitials(name) {
  if (!name) return '?';
  const parts = name.replace(/[<>"]/g, '').trim().split(/[\s@.]+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0][0] || '?').toUpperCase();
}

/** Simple deterministic color from a string. */
function avatarColor(str) {
  if (!str) return 'var(--accent)';
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#1a7a6d', '#5e3d8a', '#b45309', '#047857', '#c0392b', '#2a6987', '#873555', '#3b3f8a'];
  return colors[Math.abs(hash) % colors.length];
}

// ---------------------------------------------------------------------------
// Sender domain -> folder mapping (smart folder suggestions)
// ---------------------------------------------------------------------------

const DEFAULT_DOMAIN_FOLDER_MAP = {
  'amazon.ca': 'Shopping',
  'ebay.com': 'Shopping',
  'reply.ebay.ca': 'Shopping',
  'flyflair.com': 'Travel',
  'eg.hotels.com': 'Travel',
  'chat.hotels.com': 'Travel',
  'e.budget.com': 'Travel',
  'mail.aircanada.com': 'Travel',
  'payments.interac.ca': 'Finance',
  'notification.capitalone.com': 'Finance',
  'message.capitalone.com': 'Finance',
  'mail.questrade.com': 'Finance',
  'members.netflix.com': 'Entertainment',
  'infomail.landmarkcinemas.com': 'Entertainment',
  'updates.bandsintown.com': 'Entertainment',
  'email.ticketmaster.ca': 'Entertainment',
  'noreply.timhortons.ca': 'Food',
  'email.triangle.com': 'Rewards',
  'foundever.com': 'Work',
  'accounts.google.com': 'Security',
};

// System-only label IDs that don't count as "user-labeled"
const SYSTEM_ONLY_LABEL_IDS = new Set([
  'INBOX', 'STARRED', 'UNREAD', 'TRASH', 'SPAM', 'SENT', 'DRAFT', 'IMPORTANT',
  'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS', 'CATEGORY_PROMOTIONS', 'CATEGORY_PERSONAL',
]);

/** Extract domain from an email address string. */
function extractDomain(email) {
  if (!email) return '';
  // Handle "Name <email@domain.com>" format
  const match = email.match(/@([^>]+)/);
  return match ? match[1].toLowerCase() : '';
}

// ---------------------------------------------------------------------------
// Label sidebar — collapsible folder/label list
// ---------------------------------------------------------------------------

const SYSTEM_LABEL_ORDER = ['INBOX', 'STARRED', 'SENT', 'DRAFT', 'IMPORTANT', 'SPAM', 'TRASH'];
const SYSTEM_LABEL_DISPLAY = {
  INBOX: 'Inbox',
  STARRED: 'Starred',
  SENT: 'Sent',
  DRAFT: 'Drafts',
  IMPORTANT: 'Important',
  SPAM: 'Spam',
  TRASH: 'Trash',
  UNREAD: 'Unread',
  CATEGORY_SOCIAL: 'Social',
  CATEGORY_UPDATES: 'Updates',
  CATEGORY_FORUMS: 'Forums',
  CATEGORY_PROMOTIONS: 'Promotions',
  CATEGORY_PERSONAL: 'Personal',
};

// Deterministic color from string — consistent across sessions
const LABEL_COLORS = [
  '#4285f4', '#ea4335', '#fbbc04', '#34a853', '#ff6d01',
  '#46bdc6', '#7baaf7', '#f07b72', '#fdd663', '#57bb8a',
  '#e8710a', '#ab47bc', '#ec407a', '#26a69a', '#5c6bc0',
];
function labelColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length];
}

const PRIMARY_MAILBOX_IDS = ['INBOX', 'STARRED', 'SENT'];
const SECONDARY_MAILBOX_IDS = ['DRAFT', 'IMPORTANT', 'SPAM', 'TRASH'];

function LabelSidebar({ labels, activeLabel, onSelectLabel, collapsed, onToggle, onCreateLabel }) {
  const [expandedGroups, setExpandedGroups] = useState({});
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showAllLabels, setShowAllLabels] = useState(false);
  const [showMoreMailboxes, setShowMoreMailboxes] = useState(false);
  const createInputRef = useRef(null);

  // Auto-expand secondary mailbox section when one of its items is active
  useEffect(() => {
    if (activeLabel && SECONDARY_MAILBOX_IDS.includes(activeLabel)) {
      setShowMoreMailboxes(true);
    }
  }, [activeLabel]);

  const systemLabels = labels
    .filter((l) => l.type === 'system' && SYSTEM_LABEL_ORDER.includes(l.id))
    .sort((a, b) => SYSTEM_LABEL_ORDER.indexOf(a.id) - SYSTEM_LABEL_ORDER.indexOf(b.id));

  const primaryMailbox = systemLabels.filter((l) => PRIMARY_MAILBOX_IDS.includes(l.id));
  const secondaryMailbox = systemLabels.filter((l) => SECONDARY_MAILBOX_IDS.includes(l.id));

  const userLabels = labels
    .filter((l) => l.type === 'user')
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Group user labels by '/' separator (Gmail nesting convention)
  const { topLevel, groups } = useMemo(() => {
    const top = [];
    const grp = {}; // groupName -> { labels: [], totalUnread: 0 }
    for (const l of userLabels) {
      const slashIdx = (l.name || '').indexOf('/');
      if (slashIdx > 0) {
        const groupName = l.name.slice(0, slashIdx);
        const childName = l.name.slice(slashIdx + 1);
        if (!grp[groupName]) grp[groupName] = { labels: [], totalUnread: 0 };
        grp[groupName].labels.push({ ...l, childName });
        grp[groupName].totalUnread += (l.messagesUnread || 0);
      } else {
        top.push(l);
      }
    }
    // Sort children within each group
    for (const g of Object.values(grp)) {
      g.labels.sort((a, b) => a.childName.localeCompare(b.childName));
    }
    return { topLevel: top, groups: grp };
  }, [userLabels]);

  const toggleGroup = useCallback((groupName) => {
    setExpandedGroups((prev) => ({ ...prev, [groupName]: !prev[groupName] }));
  }, []);

  // Auto-focus the create input when shown
  useEffect(() => {
    if (showCreateInput && createInputRef.current) createInputRef.current.focus();
  }, [showCreateInput]);

  const handleCreateLabel = useCallback(async () => {
    if (!newLabelName.trim() || creating) return;
    setCreating(true);
    try {
      await onCreateLabel(newLabelName.trim());
      setNewLabelName('');
      setShowCreateInput(false);
    } catch { /* parent handles error */ }
    setCreating(false);
  }, [newLabelName, creating, onCreateLabel]);

  const sortedGroupNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));

  return (
    <div className={`gmail-label-sidebar${collapsed ? ' is-collapsed' : ''}`}>
      {collapsed && (
        <button className="gmail-label-toggle" onClick={onToggle} type="button" aria-label="Show labels">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}
      {!collapsed && (
        <>
          {/* --- Mailbox scroll region --- */}
          <div className="gmail-sidebar-mailbox-region">
            <div className="gmail-label-list">
              <button
                className={`gmail-label-item${activeLabel === null ? ' is-active' : ''}`}
                onClick={() => onSelectLabel(null)}
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                <span className="gmail-label-name">All Mail</span>
              </button>
              {primaryMailbox.map((l) => (
                <button
                  key={l.id}
                  className={`gmail-label-item${activeLabel === l.id ? ' is-active' : ''}`}
                  onClick={() => onSelectLabel(l.id)}
                  type="button"
                >
                  {SYSTEM_LABEL_ICONS[l.id] || null}
                  <span className="gmail-label-name">{SYSTEM_LABEL_DISPLAY[l.id] || l.name}</span>
                  {l.messagesUnread > 0 && <span className={`gmail-label-badge${l.id === 'INBOX' ? ' gmail-label-badge-inbox' : ''}`}>{l.messagesUnread}</span>}
                </button>
              ))}

              {/* Secondary mailbox items (Drafts, Important, Spam, Trash) — collapsed by default */}
              {secondaryMailbox.length > 0 && (
                <>
                  <button
                    className="gmail-label-show-more gmail-more-mailboxes"
                    onClick={() => setShowMoreMailboxes((p) => !p)}
                    type="button"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {showMoreMailboxes
                        ? <polyline points="18 15 12 9 6 15" />
                        : <polyline points="6 9 12 15 18 9" />}
                    </svg>
                    <span>{showMoreMailboxes ? 'Less' : 'More'}</span>
                  </button>
                  {showMoreMailboxes && secondaryMailbox.map((l) => (
                    <button
                      key={l.id}
                      className={`gmail-label-item${activeLabel === l.id ? ' is-active' : ''}`}
                      onClick={() => onSelectLabel(l.id)}
                      type="button"
                    >
                      {SYSTEM_LABEL_ICONS[l.id] || null}
                      <span className="gmail-label-name">{SYSTEM_LABEL_DISPLAY[l.id] || l.name}</span>
                      {l.messagesUnread > 0 && <span className={`gmail-label-badge${l.id === 'INBOX' ? ' gmail-label-badge-inbox' : ''}`}>{l.messagesUnread}</span>}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* --- Labels scroll region --- */}
          <div className="gmail-sidebar-labels-region">
            <div className="gmail-label-divider" />
            <div className="gmail-label-section-title">
              <span>Labels</span>
              <div className="gmail-label-section-actions">
                <button
                  className="gmail-create-label-btn"
                  onClick={() => setShowCreateInput((p) => !p)}
                  type="button"
                  title="Create new label"
                  aria-label="Create new label"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
                <button className="gmail-label-toggle" onClick={onToggle} type="button" aria-label="Hide labels">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="gmail-sidebar-labels-scroll">
              {/* Create label inline input */}
              {showCreateInput && (
                <div className="gmail-create-label-row">
                  <input
                    ref={createInputRef}
                    type="text"
                    className="gmail-create-label-input"
                    value={newLabelName}
                    onChange={(e) => setNewLabelName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateLabel(); if (e.key === 'Escape') { setShowCreateInput(false); setNewLabelName(''); } }}
                    placeholder="Label name..."
                    disabled={creating}
                  />
                  <button className="gmail-create-label-confirm" onClick={handleCreateLabel} disabled={creating || !newLabelName.trim()} type="button" title="Create">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Grouped (nested) labels */}
              {sortedGroupNames.map((groupName) => {
                const group = groups[groupName];
                const isExpanded = expandedGroups[groupName] !== false; // default open
                return (
                  <div key={groupName} className="gmail-folder-group">
                    <button
                      className="gmail-folder-header"
                      onClick={() => toggleGroup(groupName)}
                      type="button"
                    >
                      <svg className={`gmail-folder-arrow${isExpanded ? ' is-expanded' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                      </svg>
                      <span className="gmail-folder-name">{groupName}</span>
                      {group.totalUnread > 0 && <span className="gmail-label-badge">{group.totalUnread}</span>}
                    </button>
                    {isExpanded && (
                      <div className="gmail-folder-children">
                        {group.labels.map((l) => (
                          <button
                            key={l.id}
                            className={`gmail-label-item gmail-label-nested${activeLabel === l.id ? ' is-active' : ''}`}
                            onClick={() => onSelectLabel(l.id)}
                            type="button"
                          >
                            <span className="gmail-label-dot" style={{ background: labelColor(l.childName) }} />
                            <span className="gmail-label-name">{l.childName}</span>
                            {l.messagesUnread > 0 && <span className="gmail-label-badge">{l.messagesUnread}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Top-level (non-nested) user labels */}
              {(showAllLabels ? topLevel : topLevel.slice(0, 5)).map((l) => (
                <button
                  key={l.id}
                  className={`gmail-label-item${activeLabel === l.id ? ' is-active' : ''}`}
                  onClick={() => onSelectLabel(l.id)}
                  type="button"
                >
                  <span className="gmail-label-dot" style={{ background: labelColor(l.name) }} />
                  <span className="gmail-label-name">{l.name}</span>
                  {l.messagesUnread > 0 && <span className="gmail-label-badge">{l.messagesUnread}</span>}
                </button>
              ))}
              {topLevel.length > 5 && (
                <button
                  className="gmail-label-show-more"
                  onClick={() => setShowAllLabels((p) => !p)}
                  type="button"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {showAllLabels
                      ? <polyline points="18 15 12 9 6 15" />
                      : <polyline points="6 9 12 15 18 9" />}
                  </svg>
                  <span>{showAllLabels ? 'Show less' : `${topLevel.length - 5} more`}</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gmail AI helpers — SSE streaming to /api/gmail/ai
// ---------------------------------------------------------------------------

function sendGmailAI({ prompt, emailContext, conversationHistory, onChunk, onDone, onError }) {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await trackedFetch(`${API}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, emailContext, conversationHistory }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        onError?.(err.error || 'Request failed');
        return;
      }
      await consumeSSEStream(res, (eventType, data) => {
        if (eventType === 'chunk' && data?.text) onChunk?.(data.text);
        else if (eventType === 'done') onDone?.(data);
        else if (eventType === 'error') onError?.(data?.error || 'AI error');
      });
    } catch (err) {
      if (err.name !== 'AbortError') onError?.(err.message || 'Network error');
    }
  })();

  return { abort: () => controller.abort() };
}

/** Strip HTML tags for plain text extraction. */
function stripHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent || '';
}

// ---------------------------------------------------------------------------
// AI Summary Popover — inline summary display
// ---------------------------------------------------------------------------

function AiSummaryPopover({ text, loading, error, onClose }) {
  return (
    <motion.div
      className="gmail-ai-summary-popover"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
    >
      <div className="gmail-ai-summary-header">
        <span className="gmail-ai-summary-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          AI Summary
        </span>
        <button className="gmail-btn-icon gmail-ai-summary-close" onClick={onClose} type="button" aria-label="Close summary">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="gmail-ai-summary-body">
        {loading && (
          <div className="gmail-ai-summary-loading">
            <div className="gmail-ai-typing-indicator">
              <span /><span /><span />
            </div>
            <span>Analyzing email...</span>
          </div>
        )}
        {error && <div className="gmail-ai-summary-error">{error}</div>}
        {text && <div className="gmail-ai-summary-text">{text}</div>}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// AI Chat Panel — floating assistant panel
// ---------------------------------------------------------------------------

function AiChatPanel({ emailContext, onDraftReply, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const abortRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Abort any in-flight AI stream on unmount to prevent state updates on unmounted component
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current();
        abortRef.current = null;
      }
    };
  }, []);

  const handleSend = useCallback((e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setStreaming(true);
    setStreamText('');

    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    const { abort } = sendGmailAI({
      prompt: text,
      emailContext: emailContext || undefined,
      conversationHistory: history,
      onChunk: (chunk) => setStreamText((prev) => prev + chunk),
      onDone: (data) => {
        setMessages((prev) => [...prev, { role: 'assistant', content: data.fullResponse || '' }]);
        setStreamText('');
        setStreaming(false);
      },
      onError: (err) => {
        setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err}`, isError: true }]);
        setStreamText('');
        setStreaming(false);
      },
    });

    abortRef.current = abort;
  }, [input, streaming, messages, emailContext]);

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    if (streamText) {
      setMessages((prev) => [...prev, { role: 'assistant', content: streamText }]);
    }
    setStreamText('');
    setStreaming(false);
  }, [streamText]);

  const quickActions = useMemo(() => {
    const actions = [];
    if (emailContext) {
      actions.push({ label: 'Summarize this email', prompt: 'Summarize this email concisely. Highlight key points, action items, and sender intent.' });
      actions.push({ label: 'Draft a reply', prompt: 'Draft a professional reply to this email. Output only the reply body text.' });
      actions.push({ label: 'Extract action items', prompt: 'Extract all action items and deadlines from this email as a bullet list.' });
    } else {
      actions.push({ label: 'Unread emails', prompt: 'What are my most recent unread emails? Give me a brief summary.' });
      actions.push({ label: 'Important emails today', prompt: 'What important emails have I received today?' });
    }
    return actions;
  }, [emailContext]);

  const handleQuickAction = useCallback((promptText) => {
    setInput(promptText);
    // Trigger send after state update
    setTimeout(() => {
      const userMsg = { role: 'user', content: promptText };
      setMessages((prev) => [...prev, userMsg]);
      setStreaming(true);
      setStreamText('');

      const history = messages.map((m) => ({ role: m.role, content: m.content }));

      const { abort } = sendGmailAI({
        prompt: promptText,
        emailContext: emailContext || undefined,
        conversationHistory: history,
        onChunk: (chunk) => setStreamText((prev) => prev + chunk),
        onDone: (data) => {
          setMessages((prev) => [...prev, { role: 'assistant', content: data.fullResponse || '' }]);
          setStreamText('');
          setStreaming(false);
        },
        onError: (err) => {
          setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err}`, isError: true }]);
          setStreamText('');
          setStreaming(false);
        },
      });
      abortRef.current = abort;
      setInput('');
    }, 0);
  }, [messages, emailContext]);

  return (
    <motion.div
      className="gmail-ai-panel"
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      transition={{ duration: 0.2 }}
    >
      <div className="gmail-ai-panel-header">
        <div className="gmail-ai-panel-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          Email AI Assistant
        </div>
        <div className="gmail-ai-panel-actions">
          {messages.length > 0 && (
            <button
              className="gmail-btn-icon"
              onClick={() => { setMessages([]); setStreamText(''); }}
              type="button"
              title="Clear chat"
              aria-label="Clear chat"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </button>
          )}
          <button className="gmail-btn-icon" onClick={onClose} type="button" aria-label="Close AI panel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="gmail-ai-panel-messages">
        {messages.length === 0 && !streaming && (
          <div className="gmail-ai-panel-welcome">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--ink-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            <p>Ask me about your emails. I can summarize, draft replies, search, and more.</p>
            <div className="gmail-ai-quick-actions">
              {quickActions.map((action, i) => (
                <button
                  key={i}
                  className="gmail-ai-quick-btn"
                  onClick={() => handleQuickAction(action.prompt)}
                  type="button"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`gmail-ai-msg ${msg.role === 'user' ? 'gmail-ai-msg-user' : 'gmail-ai-msg-assistant'}${msg.isError ? ' gmail-ai-msg-error' : ''}`}
          >
            {msg.role === 'assistant' && (
              <div className="gmail-ai-msg-avatar">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
            )}
            <div className="gmail-ai-msg-content">
              {msg.content.split('\n').map((line, j) => (
                <span key={j}>{line}{j < msg.content.split('\n').length - 1 && <br />}</span>
              ))}
            </div>
          </div>
        ))}

        {streaming && streamText && (
          <div className="gmail-ai-msg gmail-ai-msg-assistant">
            <div className="gmail-ai-msg-avatar">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <div className="gmail-ai-msg-content gmail-ai-streaming">
              {streamText.split('\n').map((line, j) => (
                <span key={j}>{line}{j < streamText.split('\n').length - 1 && <br />}</span>
              ))}
            </div>
          </div>
        )}

        {streaming && !streamText && (
          <div className="gmail-ai-msg gmail-ai-msg-assistant">
            <div className="gmail-ai-msg-avatar">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <div className="gmail-ai-msg-content">
              <div className="gmail-ai-typing-indicator">
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="gmail-ai-panel-input" onSubmit={handleSend}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={emailContext ? 'Ask about this email...' : 'Ask about your emails...'}
          disabled={streaming}
        />
        {streaming ? (
          <button className="gmail-ai-send-btn gmail-ai-stop-btn" onClick={handleStop} type="button" aria-label="Stop">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        ) : (
          <button className="gmail-ai-send-btn" type="submit" disabled={!input.trim()} aria-label="Send">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
      </form>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Compose Draft Modal
// ---------------------------------------------------------------------------

function ComposeDraft({ onClose, onSaved, onSent, initialTo, initialSubject, initialBody, initialCc, initialBcc, threadId, inReplyTo, references, mode, activeAccount }) {
  const [to, setTo] = useState(initialTo || '');
  const [cc, setCc] = useState(initialCc || '');
  const [bcc, setBcc] = useState(initialBcc || '');
  const [showCc, setShowCc] = useState(!!(initialCc));
  const [showBcc, setShowBcc] = useState(!!(initialBcc));
  const [subject, setSubject] = useState(initialSubject || '');
  const [body, setBody] = useState(initialBody || '');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const titleText = mode === 'reply' ? 'Reply' : mode === 'forward' ? 'Forward' : 'New Message';

  const handleSave = async () => {
    if (!to.trim()) { setError('"To" field is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const result = await apiFetch('/drafts', {
        method: 'POST',
        body: JSON.stringify({ to: to.trim(), subject: subject.trim(), body, cc: cc.trim() || undefined, bcc: bcc.trim() || undefined }),
      }, activeAccount || undefined);
      if (!result.ok) {
        setError(result.error || 'Failed to save draft');
      } else {
        setSuccessMsg('Draft saved!');
        onSaved?.();
        setTimeout(onClose, 1200);
      }
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    if (!to.trim()) { setError('"To" field is required'); return; }
    setSending(true);
    setError(null);
    try {
      const result = await apiFetch('/messages/send', {
        method: 'POST',
        body: JSON.stringify({
          to: to.trim(),
          cc: cc.trim() || undefined,
          bcc: bcc.trim() || undefined,
          subject: subject.trim(),
          body,
          threadId: threadId || undefined,
          inReplyTo: inReplyTo || undefined,
          references: references || undefined,
        }),
      }, activeAccount || undefined);
      if (!result.ok) {
        setError(result.error || 'Failed to send');
      } else {
        setSuccessMsg('Sent!');
        onSent?.();
        setTimeout(onClose, 1000);
      }
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setSending(false);
    }
  };

  return (
    <motion.div className="gmail-compose-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="gmail-compose"
        initial={{ opacity: 0, y: 40, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 40, scale: 0.96 }}
        transition={{ duration: 0.2 }}
      >
        <div className="gmail-compose-header">
          <h3>{titleText}</h3>
          <button className="gmail-btn-icon" onClick={onClose} type="button" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="gmail-compose-body">
          <div className="gmail-compose-field">
            <label>To</label>
            <input type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="recipient@example.com" autoFocus />
            <div className="gmail-compose-field-toggles">
              {!showCc && <button className="gmail-compose-cc-toggle" onClick={() => setShowCc(true)} type="button">Cc</button>}
              {!showBcc && <button className="gmail-compose-cc-toggle" onClick={() => setShowBcc(true)} type="button">Bcc</button>}
            </div>
          </div>
          {showCc && (
            <div className="gmail-compose-field">
              <label>Cc</label>
              <input type="text" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="cc@example.com" />
            </div>
          )}
          {showBcc && (
            <div className="gmail-compose-field">
              <label>Bcc</label>
              <input type="text" value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="bcc@example.com" />
            </div>
          )}
          <div className="gmail-compose-field">
            <label>Subject</label>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
          </div>
          <textarea
            className="gmail-compose-textarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message..."
            rows={10}
          />
        </div>
        <div className="gmail-compose-footer">
          {error && <span className="gmail-compose-error">{error}</span>}
          {successMsg && <span className="gmail-compose-success">{successMsg}</span>}
          <div className="gmail-compose-actions">
            <button className="gmail-btn" onClick={onClose} type="button">Cancel</button>
            <button className="gmail-btn gmail-btn-secondary" onClick={handleSave} disabled={saving || sending} type="button">
              {saving ? 'Saving...' : 'Save Draft'}
            </button>
            <button className="gmail-btn gmail-btn-send" onClick={handleSend} disabled={sending || saving} type="button">
              {sending ? (
                <><div className="gmail-spinner gmail-spinner-sm" /> Sending...</>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                  Send
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Message Reader
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Unsubscribe Chip — shown on message detail when unsubscribe link detected
// ---------------------------------------------------------------------------

/** Scan HTML body for <a> tags with "unsubscribe" text. Returns the href or null. */
function findUnsubscribeLinkInBody(html) {
  if (!html) return null;
  // Match <a...>...unsubscribe...</a> patterns (case-insensitive)
  const anchorRegex = /<a\s[^>]*href=["']([^"']+)["'][^>]*>[^<]*unsubscribe[^<]*<\/a>/gi;
  const match = anchorRegex.exec(html);
  if (match && match[1]) {
    const href = match[1];
    // Only return HTTP(S) links
    if (href.startsWith('http://') || href.startsWith('https://')) return href;
  }
  // Also check text-only patterns: href before "unsubscribe" text
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
    // Priority 1: List-Unsubscribe header
    if (msg.listUnsubscribe) {
      const { url } = parseListUnsubscribe(msg.listUnsubscribe);
      if (url) return url;
    }
    // Priority 2: Scan HTML body
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

  // Group trackers by type for cleaner display
  const byType = { pixel: [], 'tracker-domain': [], 'query-heavy': [] };
  for (const t of trackers) {
    if (byType[t.type]) byType[t.type].push(t);
    else byType['tracker-domain'].push(t); // fallback
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

function MessageReader({ messageId, onBack, onOpenCompose, onOpenAiPanel, onReply, onForward, onArchive, onTrash, onToggleStar, onToggleRead, onApplyLabel, labels, showToast, activeAccount }) {
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const iframeRef = useRef(null);
  const [summaryState, setSummaryState] = useState({ show: false, text: '', loading: false, error: null });
  const [showLabelDropdown, setShowLabelDropdown] = useState(false);
  const [actionBusy, setActionBusy] = useState(null); // tracks which action is in-flight
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [draftingReply, setDraftingReply] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);
  const summaryAbortRef = useRef(null);
  const draftAbortRef = useRef(null);

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

  // Auto-resize iframe to fit content
  useEffect(() => {
    if (!msg || msg.bodyType !== 'html' || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const handleLoad = () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        // Inject dark-mode-friendly base styles
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
        // Resize
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
    if (summaryState.loading) return;
    if (summaryAbortRef.current) summaryAbortRef.current();
    setSummaryState({ show: true, text: '', loading: true, error: null });

    const { abort } = sendGmailAI({
      prompt: 'Summarize this email concisely. Highlight: key points, action items, sender intent, and any deadlines.',
      emailContext: getEmailContext(),
      onChunk: (text) => setSummaryState((prev) => ({ ...prev, text: prev.text + text })),
      onDone: (data) => setSummaryState((prev) => ({ ...prev, loading: false, text: data.fullResponse || prev.text })),
      onError: (err) => setSummaryState((prev) => ({ ...prev, loading: false, error: err })),
    });
    summaryAbortRef.current = abort;
  }, [summaryState.loading, getEmailContext]);

  const handleDraftReply = useCallback(() => {
    if (draftingReply) return;
    if (draftAbortRef.current) draftAbortRef.current();
    setDraftingReply(true);

    let draftBody = '';
    const { abort } = sendGmailAI({
      prompt: 'Draft a professional reply to this email. Output ONLY the reply body text, no subject line. Be concise and professional.',
      emailContext: getEmailContext(),
      onChunk: (text) => { draftBody += text; },
      onDone: (data) => {
        setDraftingReply(false);
        const replyTo = msg.fromEmail || msg.from || '';
        const replySubject = msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject || ''}`;
        onOpenCompose?.({
          to: replyTo,
          subject: replySubject,
          body: data.fullResponse || draftBody,
        });
      },
      onError: (err) => {
        setDraftingReply(false);
        setError(err?.message || 'Failed to draft AI reply');
      },
    });
    draftAbortRef.current = abort;
  }, [draftingReply, msg, getEmailContext, onOpenCompose]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (summaryAbortRef.current) summaryAbortRef.current();
      if (draftAbortRef.current) draftAbortRef.current();
    };
  }, []);

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
          {/* Reply */}
          <button className="gmail-action-btn" onClick={() => onReply?.(msg)} type="button" title="Reply" aria-label="Reply">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 00-4-4H4" />
            </svg>
          </button>
          {/* Forward */}
          <button className="gmail-action-btn" onClick={() => onForward?.(msg)} type="button" title="Forward" aria-label="Forward">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 17 20 12 15 7" /><path d="M4 18v-2a4 4 0 014-4h12" />
            </svg>
          </button>
          <div className="gmail-action-divider" />
          {/* Archive */}
          <button className="gmail-action-btn" onClick={() => { setActionBusy('archive'); onArchive?.(msg.id); }} disabled={actionBusy === 'archive'} type="button" title="Archive" aria-label="Archive">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
            </svg>
          </button>
          {/* Trash */}
          <button className="gmail-action-btn gmail-action-btn-danger" onClick={() => setConfirmTrash(true)} type="button" title="Move to Trash" aria-label="Move to Trash">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
          {/* Snooze */}
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
          {/* Star toggle */}
          <button className={`gmail-action-btn${msg.isStarred ? ' is-active' : ''}`} onClick={() => onToggleStar?.(msg)} type="button" title={msg.isStarred ? 'Unstar' : 'Star'} aria-label={msg.isStarred ? 'Unstar' : 'Star'}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill={msg.isStarred ? 'var(--warning)' : 'none'} stroke={msg.isStarred ? 'var(--warning)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
          {/* Read/Unread toggle */}
          <button className={`gmail-action-btn${msg.isUnread ? ' is-active' : ''}`} onClick={() => onToggleRead?.(msg)} type="button" title={msg.isUnread ? 'Mark as read' : 'Mark as unread'} aria-label={msg.isUnread ? 'Mark as read' : 'Mark as unread'}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {msg.isUnread ? (
                <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 7l10 6 10-6" /></>
              ) : (
                <><path d="M22 13V6a2 2 0 00-2-2H4a2 2 0 00-2 2v12a2 2 0 002 2h9" /><path d="M2 7l10 6 10-6" /><path d="M16 19h6" /><path d="M19 16v6" /></>
              )}
            </svg>
          </button>
          {/* Label dropdown */}
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
        {/* Trash confirm inline */}
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
            disabled={summaryState.loading}
            type="button"
            title="Summarize this email with AI"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            {summaryState.loading ? 'Summarizing...' : 'Summarize'}
          </button>
          <button
            className="gmail-btn gmail-ai-action-btn"
            onClick={handleDraftReply}
            disabled={draftingReply}
            type="button"
            title="Draft a reply with AI"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            {draftingReply ? 'Drafting...' : 'Draft Reply'}
          </button>
          <button
            className="gmail-btn gmail-ai-action-btn"
            onClick={() => onOpenAiPanel?.(getEmailContext())}
            type="button"
            title="Open AI assistant with this email"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            Ask AI
          </button>
        </div>
      </div>
      <div className="gmail-reader-content">
        <AnimatePresence>
          {summaryState.show && (
            <AiSummaryPopover
              text={summaryState.text}
              loading={summaryState.loading}
              error={summaryState.error}
              onClose={() => { setSummaryState({ show: false, text: '', loading: false, error: null }); if (summaryAbortRef.current) summaryAbortRef.current(); }}
            />
          )}
        </AnimatePresence>
        <h2 className="gmail-reader-subject">{msg.subject}</h2>
        <div className="gmail-reader-meta">
          <div className="gmail-reader-avatar" style={{ background: avatarColor(msg.fromEmail || msg.from) }}>
            {getInitials(msg.from)}
          </div>
          <div className="gmail-reader-meta-text">
            <div className="gmail-reader-from">
              <strong>{msg.from}</strong>
              {msg.fromEmail && <span className="gmail-reader-email">&lt;{msg.fromEmail}&gt;</span>}
            </div>
            <div className="gmail-reader-to">
              to {msg.to}
              {msg.cc && <span> cc {msg.cc}</span>}
            </div>
          </div>
          <div className="gmail-reader-date">{formatFullDate(msg.date)}</div>
        </div>

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

        {msg.attachments && msg.attachments.length > 0 && (
          <div className="gmail-reader-attachments">
            <div className="gmail-reader-attachments-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
              {msg.attachments.length} attachment{msg.attachments.length !== 1 ? 's' : ''}
            </div>
            <div className="gmail-reader-attachment-list">
              {msg.attachments.map((att, i) => (
                <div key={i} className="gmail-reader-attachment-chip">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span>{att.filename}</span>
                  <span className="gmail-reader-attachment-size">
                    {att.size > 1048576
                      ? (att.size / 1048576).toFixed(1) + ' MB'
                      : att.size > 1024
                        ? Math.round(att.size / 1024) + ' KB'
                        : att.size + ' B'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Reply Inline */}
        <QuickReplyInline msg={msg} onSent={() => showToast?.('Reply sent!')} activeAccount={activeAccount} />
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Message Row
// ---------------------------------------------------------------------------

function MessageRow({ msg, onClick, selected, onSelect, focused, onArchive, onTrash, onToggleStar, onToggleRead, onContextMenu, density, isUnifiedMode }) {
  const hasAttachment = msg.hasAttachments || (msg.attachments && msg.attachments.length > 0);
  return (
    <div
      className={`gmail-msg-row${msg.isUnread ? ' is-unread' : ''}${selected ? ' is-selected' : ''}${focused ? ' is-focused' : ''}`}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(e, msg); }}
    >
      <label className="gmail-select-checkbox" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={!!selected}
          onChange={(e) => onSelect?.(msg.id, e.target.checked)}
        />
        <span className="gmail-select-checkmark" />
      </label>
      <button
        className="gmail-msg-row-inner"
        onClick={() => onClick(msg.id)}
        type="button"
      >
        <div className="gmail-msg-avatar" style={{ background: avatarColor(msg.fromEmail || msg.from) }}>
          {getInitials(msg.from)}
        </div>
        <div className="gmail-msg-content">
          <div className="gmail-msg-top">
            {isUnifiedMode && msg.account && (
              <span
                className="gmail-unified-account-dot"
                style={{ background: getAccountColor(msg.account) }}
                title={msg.account}
              />
            )}
            <span className="gmail-msg-from">{msg.from || '(unknown)'}</span>
            {isUnifiedMode && msg.account && (
              <span className="gmail-unified-account-label" style={{ color: getAccountColor(msg.account) }}>
                {msg.account}
              </span>
            )}
            <span className="gmail-msg-date-area">
              {hasAttachment && (
                <svg className="gmail-msg-attachment-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                </svg>
              )}
              <span className="gmail-msg-date">{formatDate(msg.date)}</span>
            </span>
          </div>
          <div className="gmail-msg-subject">{msg.subject}</div>
          {density !== 'compact' && <div className="gmail-msg-snippet">{msg.snippet}</div>}
        </div>
        {msg.isStarred && (
          <svg className="gmail-msg-star" width="14" height="14" viewBox="0 0 24 24" fill="var(--warning)" stroke="var(--warning)" strokeWidth="1.5">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        )}
      </button>
      {/* Hover action buttons */}
      <div className="gmail-msg-hover-actions" onClick={(e) => e.stopPropagation()}>
        <button className="gmail-hover-btn" onClick={() => onArchive?.(msg.id)} type="button" title="Archive" aria-label="Archive">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
          </svg>
        </button>
        <button className="gmail-hover-btn" onClick={() => onTrash?.(msg.id)} type="button" title="Trash" aria-label="Trash">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>
        <button className="gmail-hover-btn" onClick={() => onToggleRead?.(msg)} type="button" title={msg.isUnread ? 'Mark read' : 'Mark unread'} aria-label={msg.isUnread ? 'Mark read' : 'Mark unread'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 7l10 6 10-6" />
          </svg>
        </button>
        <button className="gmail-hover-btn" onClick={() => onToggleStar?.(msg)} type="button" title={msg.isStarred ? 'Unstar' : 'Star'} aria-label={msg.isStarred ? 'Unstar' : 'Star'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill={msg.isStarred ? 'var(--warning)' : 'none'} stroke={msg.isStarred ? 'var(--warning)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Disconnect Confirmation Modal
// ---------------------------------------------------------------------------

function DisconnectModal({ email, onConfirm, onCancel }) {
  return (
    <motion.div className="gmail-compose-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="gmail-disconnect-modal"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15 }}
      >
        <div className="gmail-disconnect-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </div>
        <h3>Disconnect Gmail?</h3>
        <p>
          This will disconnect <strong>{email}</strong> and revoke access tokens.
          You can reconnect at any time.
        </p>
        <div className="gmail-disconnect-actions">
          <button className="gmail-btn" onClick={onCancel} type="button">Cancel</button>
          <button className="gmail-btn gmail-btn-danger" onClick={onConfirm} type="button">Disconnect</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Unsubscribe Panel
// ---------------------------------------------------------------------------

const UNSUB_STORAGE_KEY = 'qbo-gmail-unsubscribed';

function getProcessedSenders() {
  try {
    return JSON.parse(localStorage.getItem(UNSUB_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function setProcessedSender(domain, done) {
  const current = getProcessedSenders();
  if (done) {
    current[domain] = Date.now();
  } else {
    delete current[domain];
  }
  try { localStorage.setItem(UNSUB_STORAGE_KEY, JSON.stringify(current)); } catch { /* ignore */ }
  return current;
}

/** Parse a List-Unsubscribe header value into { url, mailto } */
function parseListUnsubscribe(header) {
  if (!header) return { url: null, mailto: null };
  let url = null;
  let mailto = null;
  // Header format: <https://...>, <mailto:...>
  const matches = header.match(/<([^>]+)>/g);
  if (matches) {
    for (const m of matches) {
      const val = m.slice(1, -1); // strip < >
      if (val.startsWith('http://') || val.startsWith('https://')) {
        url = val;
      } else if (val.startsWith('mailto:')) {
        mailto = val.replace('mailto:', '');
      }
    }
  }
  return { url, mailto };
}

function UnsubscribePanel({ onClose, showToast, activeAccount }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [scannedCount, setScannedCount] = useState(0);
  const [processed, setProcessed] = useState(getProcessedSenders);
  const [hideProcessed, setHideProcessed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch('/subscriptions?maxScan=300', {}, activeAccount || undefined)
      .then((data) => {
        if (cancelled) return;
        if (!data.ok) { setError(data.error || 'Failed to scan subscriptions'); setLoading(false); return; }
        setSubscriptions(data.subscriptions || []);
        setScannedCount(data.scannedCount || 0);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) { setError(err.message); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, []);

  const handleMarkProcessed = useCallback((domain) => {
    const updated = setProcessedSender(domain, !processed[domain]);
    setProcessed({ ...updated });
    showToast?.(processed[domain] ? `Unmarked ${domain}` : `Marked ${domain} as processed`);
  }, [processed, showToast]);

  const handleUnsubscribe = useCallback((sub) => {
    const { url, mailto } = parseListUnsubscribe(sub.listUnsubscribe);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      showToast?.(`Opening unsubscribe page for ${sub.domain}`);
    } else if (mailto) {
      window.open(`mailto:${mailto}?subject=Unsubscribe`, '_blank');
      showToast?.(`Opening email to unsubscribe from ${sub.domain}`);
    } else {
      showToast?.('No unsubscribe link found for this sender');
    }
  }, [showToast]);

  const processedCount = useMemo(() => {
    return subscriptions.filter((s) => processed[s.domain]).length;
  }, [subscriptions, processed]);

  const sortedSubs = useMemo(() => {
    const subs = hideProcessed ? subscriptions.filter((s) => !processed[s.domain]) : [...subscriptions];
    // Sort: unprocessed first (by count desc), then processed (by count desc)
    subs.sort((a, b) => {
      const aProc = processed[a.domain] ? 1 : 0;
      const bProc = processed[b.domain] ? 1 : 0;
      if (aProc !== bProc) return aProc - bProc;
      return b.count - a.count;
    });
    return subs;
  }, [subscriptions, processed, hideProcessed]);

  return (
    <motion.div
      className="gmail-unsub-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
    >
      <motion.div
        className="gmail-unsub-panel"
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 40 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gmail-unsub-header">
          <div className="gmail-unsub-header-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <line x1="2" y1="14" x2="22" y2="14" />
              <line x1="8" y1="18" x2="16" y2="18" />
            </svg>
            <h3>Manage Subscriptions</h3>
          </div>
          <button className="gmail-btn-icon" onClick={onClose} type="button" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="gmail-unsub-loading">
            <div className="gmail-spinner" />
            <span>Scanning recent emails for subscriptions...</span>
          </div>
        ) : error ? (
          <div className="gmail-unsub-error">
            <p>{error}</p>
          </div>
        ) : (
          <>
            <div className="gmail-unsub-summary">
              <span>{subscriptions.length} subscription sender{subscriptions.length !== 1 ? 's' : ''} found from {scannedCount} emails scanned</span>
              {processedCount > 0 && <span className="gmail-unsub-summary-done">{processedCount} processed</span>}
            </div>

            <div className="gmail-unsub-toggle">
              <label className="gmail-unsub-toggle-label">
                <input
                  type="checkbox"
                  checked={hideProcessed}
                  onChange={(e) => setHideProcessed(e.target.checked)}
                />
                <span>Hide processed</span>
              </label>
            </div>

            <div className="gmail-unsub-list">
              {sortedSubs.length === 0 ? (
                <div className="gmail-unsub-empty">
                  {hideProcessed ? 'All senders have been processed!' : 'No subscription senders found.'}
                </div>
              ) : (
                sortedSubs.map((sub) => {
                  const isProcessed = !!processed[sub.domain];
                  const { url, mailto } = parseListUnsubscribe(sub.listUnsubscribe);
                  const hasUnsub = !!(url || mailto);

                  return (
                    <div key={sub.domain} className={`gmail-unsub-row${isProcessed ? ' is-processed' : ''}`}>
                      <div className="gmail-unsub-row-info">
                        <div className="gmail-unsub-row-top">
                          <span className="gmail-unsub-domain">{sub.domain}</span>
                          <span className="gmail-unsub-badge">{sub.count}</span>
                        </div>
                        <div className="gmail-unsub-row-meta">
                          <span className="gmail-unsub-from" title={sub.fromEmail}>{sub.fromName || sub.fromEmail}</span>
                          <span className="gmail-unsub-subject" title={sub.latestSubject}>{sub.latestSubject}</span>
                        </div>
                      </div>
                      <div className="gmail-unsub-row-actions">
                        {hasUnsub ? (
                          <button
                            className="gmail-unsub-btn"
                            onClick={() => handleUnsubscribe(sub)}
                            type="button"
                            title={url ? 'Open unsubscribe page' : `Email ${mailto} to unsubscribe`}
                          >
                            {url ? 'Unsubscribe' : 'Email to unsub'}
                          </button>
                        ) : (
                          <span className="gmail-unsub-no-link" title="No List-Unsubscribe header found">No link</span>
                        )}
                        <button
                          className={`gmail-unsub-done${isProcessed ? ' is-done' : ''}`}
                          onClick={() => handleMarkProcessed(sub.domain)}
                          type="button"
                          title={isProcessed ? 'Mark as not processed' : 'Mark as processed'}
                          aria-label={isProcessed ? 'Mark as not processed' : 'Mark as processed'}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function GmailInbox({ chat = null, agentDock = null, isActive = true }) {
  // State
  const [initRetry, setInitRetry] = useState(0);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'not-connected' | 'error'
  const [profile, setProfile] = useState(null);
  const [messages, setMessages] = useState([]);
  const [labels, setLabels] = useState([]);
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [activeLabel, setActiveLabel] = useState('INBOX');
  const [nextPageToken, setNextPageToken] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  const [showCompose, setShowCompose] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState(null); // email of account to disconnect
  const [labelSidebarCollapsed, setLabelSidebarCollapsed] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [authErrorParam, setAuthErrorParam] = useState(null);
  const [localShowAiPanel, setLocalShowAiPanel] = useState(true);
  const [aiPanelEmailContext, setAiPanelEmailContext] = useState(null);
  const [composeDefaults, setComposeDefaults] = useState(null);
  const searchInputRef = useRef(null);
  const fetchIdRef = useRef(0);

  // Multi-account state
  const [accounts, setAccounts] = useState([]);
  const [activeAccount, setActiveAccount] = useState(null);

  // Unified inbox mode state
  const [isUnifiedMode, setIsUnifiedMode] = useState(false);
  const [unifiedUnreadCounts, setUnifiedUnreadCounts] = useState({}); // { 'email@...': N, total: N }

  // Keep a ref to activeAccount so callbacks always see the latest value
  const activeAccountRef = useRef(activeAccount);
  useEffect(() => { activeAccountRef.current = activeAccount; }, [activeAccount]);
  const resolvePreferredAccount = useCallback((accountList, fallbackEmail = '') => {
    return resolveConnectedAccount(accountList, getDefaultGmailAccount(), fallbackEmail);
  }, []);

  // Account-aware fetch helper — automatically injects the active account
  const acctFetch = useCallback((path, opts = {}) => {
    return apiFetch(path, opts, activeAccountRef.current || undefined);
  }, []);

  // Fetch helper that uses a specific account (for unified mode actions on individual messages)
  const accountSpecificFetch = useCallback((path, opts = {}, accountEmail) => {
    return apiFetch(path, opts, accountEmail || activeAccountRef.current || undefined);
  }, []);

  // Email management state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [composeMode, setComposeMode] = useState(null); // { mode, to, subject, body, cc, bcc, threadId, inReplyTo, references }
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  // New UI state
  const [activeCategory, setActiveCategory] = useState('all');
  const [density, setDensity] = useState('default'); // 'comfortable' | 'default' | 'compact'
  const [showDensityMenu, setShowDensityMenu] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, msg }
  const [snoozedIds, setSnoozedIds] = useState(new Set());
  const [showUnsubPanel, setShowUnsubPanel] = useState(false);
  const densityRef = useRef(null);
  const showAiPanel = agentDock?.managed ? !!agentDock.open : localShowAiPanel;
  const workspaceMonitor = useWorkspaceMonitorStream();
  const inboxRefreshTimerRef = useRef(null);
  const lastRefreshTokenRef = useRef(0);

  const handleToggleAiPanel = useCallback(() => {
    const nextOpen = !showAiPanel;
    if (nextOpen) {
      agentDock?.setActiveTab?.('workspace');
    }
    if (agentDock?.managed) {
      agentDock.setOpen?.(nextOpen);
      return;
    }
    setLocalShowAiPanel(nextOpen);
  }, [showAiPanel, agentDock]);

  const openAiPanel = useCallback(() => {
    agentDock?.setActiveTab?.('workspace');
    if (agentDock?.managed) {
      agentDock.setOpen?.(true);
      return;
    }
    setLocalShowAiPanel(true);
  }, [agentDock]);

  // Toast helper
  const showToast = useCallback((message, duration = 3000) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(null), duration);
  }, []);

  // Selection helpers
  const handleSelectMessage = useCallback((id, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === messages.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(messages.map((m) => m.id)));
    }
  }, [messages, selectedIds.size]);

  // Helper: resolve the account email for a message (for unified mode, use the message's own account)
  const getMessageAccount = useCallback((msgOrId) => {
    if (typeof msgOrId === 'object' && msgOrId?.account) return msgOrId.account;
    if (typeof msgOrId === 'string') {
      // Look up the message from current state
      const found = messages.find((m) => m.id === msgOrId);
      if (found?.account) return found.account;
    }
    return undefined; // falls back to activeAccount in apiFetch
  }, [messages]);

  // Fetch with correct account for a specific message (unified-aware)
  const msgFetch = useCallback((path, opts = {}, msgOrId) => {
    const account = isUnifiedMode ? getMessageAccount(msgOrId) : undefined;
    return account ? accountSpecificFetch(path, opts, account) : acctFetch(path, opts);
  }, [isUnifiedMode, getMessageAccount, accountSpecificFetch, acctFetch]);

  // Message action helpers
  const handleReply = useCallback((msg) => {
    const replyTo = msg.fromEmail || msg.from || '';
    const replySubject = msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject || ''}`;
    // Use RFC822 Message-ID header for proper threading (falls back to Gmail ID)
    const rfcMsgId = msg.messageId || msg.id;
    const refs = msg.references ? `${msg.references} ${rfcMsgId}` : rfcMsgId;
    setComposeMode({
      mode: 'reply',
      to: replyTo,
      subject: replySubject,
      body: '',
      cc: '',
      bcc: '',
      threadId: msg.threadId,
      inReplyTo: rfcMsgId,
      references: refs,
      account: msg.account || undefined, // preserve account for unified mode
    });
  }, []);

  const handleForward = useCallback((msg) => {
    const fwdSubject = msg.subject?.startsWith('Fwd:') ? msg.subject : `Fwd: ${msg.subject || ''}`;
    const bodyText = msg.bodyType === 'html' ? msg.body : msg.body;
    const fwdBody = `\n\n---------- Forwarded message ----------\nFrom: ${msg.from} <${msg.fromEmail || ''}>\nDate: ${msg.date}\nSubject: ${msg.subject}\nTo: ${msg.to || ''}\n\n${bodyText || ''}`;
    setComposeMode({
      mode: 'forward',
      to: '',
      subject: fwdSubject,
      body: fwdBody,
      cc: '',
      bcc: '',
      threadId: null,
      inReplyTo: null,
      references: null,
      account: msg.account || undefined, // preserve account for unified mode
    });
  }, []);

  const handleArchive = useCallback(async (messageId) => {
    try {
      const res = await msgFetch(`/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
      }, messageId);
      if (res.ok) {
        showToast('Archived');
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        setSelectedMessageId(null);
      }
    } catch (err) {
      showToast('Archive failed: ' + err.message);
    }
  }, [showToast, msgFetch]);

  const handleTrash = useCallback(async (messageId) => {
    try {
      const res = await msgFetch(`/messages/${messageId}`, { method: 'DELETE' }, messageId);
      if (res.ok) {
        showToast('Moved to Trash');
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        setSelectedMessageId(null);
      }
    } catch (err) {
      showToast('Trash failed: ' + err.message);
    }
  }, [showToast, msgFetch]);

  const handleToggleStar = useCallback(async (msg) => {
    const add = msg.isStarred ? [] : ['STARRED'];
    const remove = msg.isStarred ? ['STARRED'] : [];
    try {
      const res = await msgFetch(`/messages/${msg.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
      }, msg);
      if (res.ok) {
        setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, isStarred: !msg.isStarred, labels: res.labelIds || m.labels } : m));
        showToast(msg.isStarred ? 'Unstarred' : 'Starred');
      }
    } catch { /* ignore */ }
  }, [showToast, msgFetch]);

  const handleToggleRead = useCallback(async (msg) => {
    const add = msg.isUnread ? [] : ['UNREAD'];
    const remove = msg.isUnread ? ['UNREAD'] : [];
    try {
      const res = await msgFetch(`/messages/${msg.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
      }, msg);
      if (res.ok) {
        setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, isUnread: !msg.isUnread, labels: res.labelIds || m.labels } : m));
        showToast(msg.isUnread ? 'Marked as read' : 'Marked as unread');
      }
    } catch { /* ignore */ }
  }, [showToast, msgFetch]);

  const handleApplyLabel = useCallback(async (messageId, labelId, apply) => {
    try {
      const res = await msgFetch(`/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify(apply ? { addLabelIds: [labelId] } : { removeLabelIds: [labelId] }),
      }, messageId);
      if (res.ok) {
        setMessages((prev) => prev.map((m) => {
          if (m.id !== messageId) return m;
          const newLabels = apply ? [...(m.labels || []), labelId] : (m.labels || []).filter((l) => l !== labelId);
          return { ...m, labels: newLabels, isStarred: newLabels.includes('STARRED'), isUnread: newLabels.includes('UNREAD') };
        }));
        showToast(apply ? 'Label added' : 'Label removed');
      }
    } catch { /* ignore */ }
  }, [showToast, msgFetch]);

  // Bulk action handlers
  const handleBulkAction = useCallback(async (action) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    let addLabelIds = [];
    let removeLabelIds = [];
    let toastMsg = '';

    switch (action) {
      case 'archive': removeLabelIds = ['INBOX']; toastMsg = `Archived ${ids.length} message${ids.length > 1 ? 's' : ''}`; break;
      case 'trash':
        try {
          // Trash each individually — in unified mode, use each message's own account
          await Promise.all(ids.map((id) => msgFetch(`/messages/${id}`, { method: 'DELETE' }, id)));
          setMessages((prev) => prev.filter((m) => !selectedIds.has(m.id)));
          setSelectedIds(new Set());
          showToast(`Trashed ${ids.length} message${ids.length > 1 ? 's' : ''}`);
        } catch (err) { showToast('Bulk trash failed'); }
        return;
      case 'read': removeLabelIds = ['UNREAD']; toastMsg = 'Marked as read'; break;
      case 'unread': addLabelIds = ['UNREAD']; toastMsg = 'Marked as unread'; break;
      case 'star': addLabelIds = ['STARRED']; toastMsg = 'Starred'; break;
      default: return;
    }

    try {
      if (isUnifiedMode) {
        // In unified mode, group messages by account and batch per account
        const byAccount = {};
        for (const id of ids) {
          const account = getMessageAccount(id) || '__default__';
          if (!byAccount[account]) byAccount[account] = [];
          byAccount[account].push(id);
        }
        await Promise.all(Object.entries(byAccount).map(([account, msgIds]) => {
          const fetchFn = account === '__default__' ? acctFetch : (path, opts) => accountSpecificFetch(path, opts, account);
          return fetchFn('/messages/batch', {
            method: 'PATCH',
            body: JSON.stringify({ messageIds: msgIds, addLabelIds, removeLabelIds }),
          });
        }));
      } else {
        const res = await acctFetch('/messages/batch', {
          method: 'PATCH',
          body: JSON.stringify({ messageIds: ids, addLabelIds, removeLabelIds }),
        });
        if (!res.ok) throw new Error('Batch failed');
      }
      // Update local state
      setMessages((prev) => prev.map((m) => {
        if (!selectedIds.has(m.id)) return m;
        if (action === 'archive') return null; // filter out archived
        const newLabels = [...(m.labels || []).filter((l) => !removeLabelIds.includes(l)), ...addLabelIds];
        return { ...m, labels: newLabels, isStarred: newLabels.includes('STARRED'), isUnread: newLabels.includes('UNREAD') };
      }).filter(Boolean));
      setSelectedIds(new Set());
      showToast(toastMsg);
    } catch { showToast('Bulk action failed'); }
  }, [selectedIds, showToast, isUnifiedMode, msgFetch, getMessageAccount, acctFetch, accountSpecificFetch]);

  // Category tab handler
  const CATEGORY_MAP = {
    all: null,
    primary: 'CATEGORY_PERSONAL',
    social: 'CATEGORY_SOCIAL',
    promotions: 'CATEGORY_PROMOTIONS',
    updates: 'CATEGORY_UPDATES',
  };

  // Fetch messages when search or label changes
  const fetchMessages = useCallback(async (query, labelId, append = false, pageToken = null) => {
    const id = ++fetchIdRef.current;
    if (append) setLoadingMore(true);
    try {
      const params = new URLSearchParams({ maxResults: '25' });
      if (query) params.set('q', query);
      if (labelId) params.set('labelIds', labelId);
      if (append && pageToken) params.set('pageToken', pageToken);

      let res;
      if (isUnifiedMode) {
        // Unified mode — fetch from unified endpoint (no account param, merges all)
        res = await trackedFetch(`${API}/unified?${params}`).then(r => r.json());
      } else {
        res = await acctFetch(`/messages?${params}`);
      }
      // Discard stale responses from superseded requests
      if (id !== fetchIdRef.current) return;
      if (res.ok) {
        const msgs = res.messages || [];
        // In unified mode, sort by date (newest first) since messages come from multiple accounts
        if (isUnifiedMode) {
          msgs.sort((a, b) => new Date(b.date) - new Date(a.date));
        }
        setMessages((prev) => append ? [...prev, ...msgs] : msgs);
        setNextPageToken(res.nextPageToken || null);
      }
    } catch { /* ignore */ }
    finally { if (id === fetchIdRef.current) setLoadingMore(false); }
  }, [acctFetch, isUnifiedMode]);

  const handleCategoryChange = useCallback((cat) => {
    setActiveCategory(cat);
    setSelectedMessageId(null);
    setSelectedIds(new Set());
    setFocusedIndex(-1);
    setMessages([]);
    setNextPageToken(null);
    const catLabel = CATEGORY_MAP[cat];
    if (catLabel) {
      setActiveLabel(null);
      fetchMessages(activeSearch, catLabel);
    } else {
      // 'all' category — clear any sidebar label and fetch with no label filter
      setActiveLabel(null);
      fetchMessages(activeSearch, null);
    }
  }, [activeSearch, fetchMessages]);

  // Density menu outside click
  useEffect(() => {
    if (!showDensityMenu) return;
    const handle = (e) => { if (densityRef.current && !densityRef.current.contains(e.target)) setShowDensityMenu(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showDensityMenu]);

  // Visible messages (filter snoozed)
  const visibleMessages = useMemo(() => messages.filter((m) => !snoozedIds.has(m.id)), [messages, snoozedIds]);

  // --- Smart Folder Suggestions ---
  const [dismissedSuggestions, setDismissedSuggestions] = useState(() => {
    try { return JSON.parse(localStorage.getItem('gmail-dismissed-suggestions') || '{}'); } catch { return {}; }
  });
  const [movingSuggestion, setMovingSuggestion] = useState(null);

  // Build dynamic domain -> label map from current messages + labels
  const folderSuggestions = useMemo(() => {
    if (!messages.length || !labels.length) return [];

    // Build label name -> id lookup for user labels
    const labelNameToId = {};
    const labelIdToName = {};
    for (const l of labels) {
      if (l.type === 'user') {
        labelNameToId[l.name.toLowerCase()] = l.id;
        labelIdToName[l.id] = l.name;
      }
    }

    // Dynamic learning: for each user label, tally sender domains
    const labelDomainCounts = {}; // labelId -> { domain -> count }
    for (const msg of messages) {
      const userLabelIds = (msg.labels || []).filter((lid) => !SYSTEM_ONLY_LABEL_IDS.has(lid));
      if (userLabelIds.length === 0) continue;
      const domain = extractDomain(msg.fromEmail || msg.from || '');
      if (!domain) continue;
      for (const lid of userLabelIds) {
        if (!labelDomainCounts[lid]) labelDomainCounts[lid] = {};
        labelDomainCounts[lid][domain] = (labelDomainCounts[lid][domain] || 0) + 1;
      }
    }

    // Build dynamic domain -> label name from learned patterns (>= 3 messages or >= 60% of label)
    const dynamicMap = {};
    for (const [lid, domains] of Object.entries(labelDomainCounts)) {
      const totalForLabel = Object.values(domains).reduce((s, c) => s + c, 0);
      for (const [domain, count] of Object.entries(domains)) {
        if (count >= 3 || (totalForLabel > 0 && count / totalForLabel >= 0.6)) {
          dynamicMap[domain] = labelIdToName[lid] || lid;
        }
      }
    }

    // Merge: hardcoded defaults + dynamic (dynamic overrides if conflict)
    const mergedMap = { ...DEFAULT_DOMAIN_FOLDER_MAP, ...dynamicMap };

    // Find unlabeled messages that match a known domain pattern
    const domainBuckets = {}; // "domain::folderName" -> [messageIds]
    for (const msg of messages) {
      const userLabelIds = (msg.labels || []).filter((lid) => !SYSTEM_ONLY_LABEL_IDS.has(lid));
      if (userLabelIds.length > 0) continue; // already labeled
      const domain = extractDomain(msg.fromEmail || msg.from || '');
      if (!domain || !mergedMap[domain]) continue;
      const folderName = mergedMap[domain];
      const key = `${domain}::${folderName}`;
      if (!domainBuckets[key]) domainBuckets[key] = [];
      domainBuckets[key].push(msg.id);
    }

    // Convert to suggestion list, filter dismissed
    const suggestions = [];
    for (const [key, msgIds] of Object.entries(domainBuckets)) {
      if (dismissedSuggestions[key]) continue;
      const [domain, folderName] = key.split('::');
      const labelId = labelNameToId[folderName.toLowerCase()] || null;
      suggestions.push({ domain, folderName, labelId, messageIds: msgIds, key });
    }

    // Sort by message count desc
    suggestions.sort((a, b) => b.messageIds.length - a.messageIds.length);
    return suggestions;
  }, [messages, labels, dismissedSuggestions]);

  const handleDismissSuggestion = useCallback((suggestionKey) => {
    setDismissedSuggestions((prev) => {
      const next = { ...prev, [suggestionKey]: true };
      try { localStorage.setItem('gmail-dismissed-suggestions', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const handleMoveSuggestion = useCallback(async (suggestion) => {
    if (movingSuggestion === suggestion.key) return;
    setMovingSuggestion(suggestion.key);
    try {
      let targetLabelId = suggestion.labelId;
      // If the label doesn't exist yet, create it
      if (!targetLabelId) {
        const createRes = await acctFetch('/labels', {
          method: 'POST',
          body: JSON.stringify({ name: suggestion.folderName }),
        });
        if (createRes.ok && createRes.label) {
          targetLabelId = createRes.label.id;
          // Refresh labels so sidebar picks it up
          const labelsRes = await acctFetch('/labels');
          if (labelsRes.ok) setLabels(labelsRes.labels);
        } else {
          showToast('Failed to create label');
          setMovingSuggestion(null);
          return;
        }
      }
      // Batch add label to all matching messages
      const res = await acctFetch('/messages/batch', {
        method: 'PATCH',
        body: JSON.stringify({ messageIds: suggestion.messageIds, addLabelIds: [targetLabelId] }),
      });
      if (res.ok) {
        // Update local message state
        const idSet = new Set(suggestion.messageIds);
        setMessages((prev) => prev.map((m) => {
          if (!idSet.has(m.id)) return m;
          return { ...m, labels: [...(m.labels || []), targetLabelId] };
        }));
        showToast(`Moved ${suggestion.messageIds.length} email${suggestion.messageIds.length !== 1 ? 's' : ''} to ${suggestion.folderName}`);
        // Auto-dismiss this suggestion
        handleDismissSuggestion(suggestion.key);
      }
    } catch {
      showToast('Failed to move messages');
    }
    setMovingSuggestion(null);
  }, [movingSuggestion, showToast, handleDismissSuggestion]);

  const handleCreateLabel = useCallback(async (name) => {
    const res = await acctFetch('/labels', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (res.ok && res.label) {
      // Refresh labels
      const labelsRes = await acctFetch('/labels');
      if (labelsRes.ok) setLabels(labelsRes.labels);
      showToast(`Label "${name}" created`);
    } else {
      showToast(res.error || 'Failed to create label');
      throw new Error(res.error || 'Failed');
    }
  }, [showToast]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isActive || status !== 'ready') return;
    const handler = (e) => {
      const tag = e.target.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;

      // / focuses search even from input context
      if (e.key === '/' && !isInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // ? toggles help
      if (e.key === '?' && !isInput) {
        e.preventDefault();
        setShowShortcutHelp((p) => !p);
        return;
      }

      // Escape: close things
      if (e.key === 'Escape') {
        if (showShortcutHelp) { setShowShortcutHelp(false); return; }
        if (showCompose || composeMode) { setShowCompose(false); setComposeMode(null); return; }
        if (contextMenu) { setContextMenu(null); return; }
        if (selectedMessageId) { setSelectedMessageId(null); return; }
        if (selectedIds.size > 0) { setSelectedIds(new Set()); return; }
        return;
      }

      // Don't handle shortcuts if input is focused or if event was stopped
      if (isInput) return;
      if (e.defaultPrevented) return; // respect stopPropagation from child components

      // c = compose
      if (e.key === 'c') { e.preventDefault(); setShowCompose(true); return; }

      if (selectedMessageId) {
        // In reader view
        if (e.key === 'r') { const msg = visibleMessages.find(m => m.id === selectedMessageId); if (msg) handleReply(msg); return; }
        if (e.key === 'f') { const msg = visibleMessages.find(m => m.id === selectedMessageId); if (msg) handleForward(msg); return; }
        return;
      }

      // In list view — navigation (j/k only, not arrow keys when input is focused)
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, visibleMessages.length - 1));
        return;
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if ((e.key === 'Enter' || e.key === 'o') && focusedIndex >= 0 && focusedIndex < visibleMessages.length) {
        e.preventDefault();
        setSelectedMessageId(visibleMessages[focusedIndex].id);
        return;
      }
      if (e.key === 'e' && focusedIndex >= 0 && focusedIndex < visibleMessages.length) {
        e.preventDefault();
        if (selectedIds.size > 0) { handleBulkAction('archive'); } else { handleArchive(visibleMessages[focusedIndex].id); }
        return;
      }
      if (e.key === '#' && focusedIndex >= 0 && focusedIndex < visibleMessages.length) {
        e.preventDefault();
        if (selectedIds.size > 0) { handleBulkAction('trash'); } else { handleTrash(visibleMessages[focusedIndex].id); }
        return;
      }
      if (e.key === 's' && focusedIndex >= 0 && focusedIndex < visibleMessages.length) {
        e.preventDefault();
        handleToggleStar(visibleMessages[focusedIndex]);
        return;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isActive, status, selectedMessageId, focusedIndex, visibleMessages, showCompose, composeMode, selectedIds, showShortcutHelp, contextMenu, activeSearch, handleReply, handleForward, handleArchive, handleTrash, handleToggleStar, handleBulkAction]);

  // Context menu handler
  const handleContextMenu = useCallback((e, msg) => {
    setContextMenu({ x: e.clientX, y: e.clientY, msg });
  }, []);

  // Parse error/connected query params from callback redirect
  useEffect(() => {
    const hash = window.location.hash || '';
    const queryStart = hash.indexOf('?');
    if (queryStart === -1) return;

    const params = new URLSearchParams(hash.slice(queryStart));
    const error = params.get('error');
    if (error) {
      setAuthErrorParam(error);
    }
    // Clean up query params from hash
    const cleanHash = hash.slice(0, queryStart);
    window.history.replaceState(null, '', cleanHash || '#/workspace/inbox');
  }, []);

  // Initial load — check auth status first, then load data if connected
  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    async function init() {
      try {
        // Step 1: Check auth status
        const authStatus = await apiFetch('/auth/status');
        if (cancelled) return;

        if (!authStatus.ok) {
          setErrorMsg(authStatus.error || 'Failed to check auth status');
          setStatus('error');
          return;
        }

        if (!authStatus.connected) {
          // Store accounts list even if none connected (for edge cases)
          setAccounts(authStatus.accounts || []);
          setActiveAccount(null);
          activeAccountRef.current = null;
          setStatus('not-connected');
          return;
        }

        // Store account list and active account from auth status
        const nextAccounts = authStatus.accounts || [];
        setAccounts(nextAccounts);
        const currentActive = resolvePreferredAccount(nextAccounts, authStatus.activeAccount || authStatus.email);
        setActiveAccount(currentActive);
        // Update the ref immediately so subsequent fetches in this init use it
        activeAccountRef.current = currentActive;

        // Step 2: Load inbox data (connected) — use the active account
        const [profileRes, labelsRes, messagesRes] = await Promise.all([
          apiFetch('/profile', {}, currentActive),
          apiFetch('/labels', {}, currentActive),
          apiFetch('/messages?maxResults=25&labelIds=INBOX', {}, currentActive),
        ]);
        if (cancelled) return;

        if (!profileRes.ok && (profileRes.code === 'GMAIL_NOT_CONNECTED')) {
          setStatus('not-connected');
          return;
        }
        if (!profileRes.ok) {
          setErrorMsg(profileRes.error || 'Failed to load Gmail');
          setStatus('error');
          return;
        }

        setProfile(profileRes);
        setLabels(labelsRes.ok ? labelsRes.labels : []);
        if (messagesRes.ok) {
          setMessages(messagesRes.messages);
          setNextPageToken(messagesRes.nextPageToken);
        }
        setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err.message || 'Network error');
          setStatus('error');
        }
      }
    }
    init();
    return () => { cancelled = true; };
  }, [initRetry, isActive, resolvePreferredAccount]);

  const handleSearch = useCallback((e) => {
    e.preventDefault();
    setActiveSearch(search);
    setSelectedMessageId(null);
    setSelectedIds(new Set());
    setMessages([]);
    setNextPageToken(null);
    fetchMessages(search, activeLabel);
  }, [search, activeLabel, fetchMessages]);

  const handleLabelSelect = useCallback((labelId) => {
    setActiveLabel(labelId);
    setActiveCategory('all');
    setSelectedMessageId(null);
    setSelectedIds(new Set());
    setMessages([]);
    setNextPageToken(null);
    fetchMessages(activeSearch, labelId);
  }, [activeSearch, fetchMessages]);

  const handleLoadMore = useCallback(() => {
    fetchMessages(activeSearch, activeLabel, true, nextPageToken);
  }, [activeSearch, activeLabel, nextPageToken, fetchMessages]);

  const handleRefresh = useCallback(() => {
    setSelectedMessageId(null);
    setSelectedIds(new Set());
    setMessages([]);
    setNextPageToken(null);
    fetchMessages(activeSearch, activeLabel);
  }, [activeSearch, activeLabel, fetchMessages]);

  const workspaceDockContext = useMemo(() => ({
    view: 'gmail',
    ...(selectedMessageId ? { emailId: selectedMessageId } : {}),
    ...(aiPanelEmailContext ? {
      emailSubject: aiPanelEmailContext.subject,
      emailFrom: `${aiPanelEmailContext.from || ''} <${aiPanelEmailContext.fromEmail || ''}>`,
      emailBody: aiPanelEmailContext.body,
    } : {}),
  }), [selectedMessageId, aiPanelEmailContext]);

  useEffect(() => {
    if (!isActive) return;
    agentDock?.onContextChange?.(workspaceDockContext);
  }, [agentDock, workspaceDockContext, isActive]);

  const handleRefreshRef = useRef(handleRefresh);
  handleRefreshRef.current = handleRefresh;
  useEffect(() => {
    if (!isActive || status !== 'ready') return;
    const nextToken = workspaceMonitor.inboxRefreshToken || 0;
    if (!nextToken || nextToken === lastRefreshTokenRef.current) return;
    lastRefreshTokenRef.current = nextToken;

    if (inboxRefreshTimerRef.current) {
      clearTimeout(inboxRefreshTimerRef.current);
    }

    inboxRefreshTimerRef.current = setTimeout(() => {
      inboxRefreshTimerRef.current = null;
      handleRefreshRef.current();
    }, 5000);
  }, [isActive, status, workspaceMonitor.inboxRefreshToken]);

  useEffect(() => (
    () => {
      if (inboxRefreshTimerRef.current) {
        clearTimeout(inboxRefreshTimerRef.current);
        inboxRefreshTimerRef.current = null;
      }
    }
  ), []);

  // --- Unified inbox: poll unread counts every 30 seconds ---
  useEffect(() => {
    if (!isActive || status !== 'ready' || !isUnifiedMode || accounts.length < 2) return;
    let cancelled = false;

    const fetchUnreadCounts = async () => {
      try {
        const res = await trackedFetch(`${API}/unified/unread-counts`).then(r => r.json());
        if (!cancelled && res.ok && res.counts) {
          setUnifiedUnreadCounts(res.counts);
        }
      } catch { /* ignore */ }
    };

    // Fetch immediately, then poll
    fetchUnreadCounts();
    const interval = setInterval(fetchUnreadCounts, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isActive, status, isUnifiedMode, accounts.length]);

  const handleDisconnect = useCallback(async (emailToDisconnect) => {
    const targetEmail = emailToDisconnect || disconnectTarget || activeAccount;
    setDisconnecting(true);
    try {
      const body = targetEmail ? JSON.stringify({ email: targetEmail }) : undefined;
      const res = await apiFetch('/auth/disconnect', {
        method: 'POST',
        ...(body ? { body } : {}),
      });
      if (res.ok) {
        // Refresh account list
        const statusRes = await apiFetch('/auth/status');
        if (statusRes.ok && statusRes.connected) {
          // Still have accounts — switch to the new primary
          const nextAccounts = statusRes.accounts || [];
          setAccounts(nextAccounts);
          const newActive = resolvePreferredAccount(nextAccounts, statusRes.activeAccount || statusRes.email);
          setActiveAccount(newActive);
          activeAccountRef.current = newActive;
          setShowDisconnect(false);
          setDisconnectTarget(null);
          showToast(`Disconnected ${targetEmail}`);
          // Reload data for the new active account
          const [profileRes, labelsRes, messagesRes] = await Promise.all([
            apiFetch('/profile', {}, newActive),
            apiFetch('/labels', {}, newActive),
            apiFetch('/messages?maxResults=25&labelIds=INBOX', {}, newActive),
          ]);
          setProfile(profileRes.ok ? profileRes : null);
          setLabels(labelsRes.ok ? labelsRes.labels : []);
          if (messagesRes.ok) {
            setMessages(messagesRes.messages);
            setNextPageToken(messagesRes.nextPageToken);
          }
        } else {
          // No accounts left
          setAccounts([]);
          setActiveAccount(null);
          activeAccountRef.current = null;
          setStatus('not-connected');
          setProfile(null);
          setMessages([]);
          setLabels([]);
          setShowDisconnect(false);
          setDisconnectTarget(null);
        }
      }
    } catch (err) {
      setErrorMsg(err?.message || 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  }, [disconnectTarget, activeAccount, showToast, resolvePreferredAccount]);

  const handleConnected = useCallback(() => {
    // Re-init after connecting (or adding another account)
    setStatus('loading');
    setAuthErrorParam(null);
    async function reload() {
      try {
        // Refresh auth status to get updated accounts list
        const authStatus = await apiFetch('/auth/status');
        if (!authStatus.ok || !authStatus.connected) {
          setStatus('not-connected');
          return;
        }
        const nextAccounts = authStatus.accounts || [];
        setAccounts(nextAccounts);
        const newActive = resolvePreferredAccount(nextAccounts, authStatus.activeAccount || authStatus.email);
        setActiveAccount(newActive);
        activeAccountRef.current = newActive;

        const [profileRes, labelsRes, messagesRes] = await Promise.all([
          apiFetch('/profile', {}, newActive),
          apiFetch('/labels', {}, newActive),
          apiFetch('/messages?maxResults=25&labelIds=INBOX', {}, newActive),
        ]);
        if (!profileRes.ok) {
          setStatus('not-connected');
          return;
        }
        setProfile(profileRes);
        setLabels(labelsRes.ok ? labelsRes.labels : []);
        if (messagesRes.ok) {
          setMessages(messagesRes.messages);
          setNextPageToken(messagesRes.nextPageToken);
        }
        setStatus('ready');
      } catch {
        setStatus('not-connected');
      }
    }
    reload();
  }, [resolvePreferredAccount]);

  // Multi-account: switch active account (exits unified mode)
  const handleSwitchAccount = useCallback(async (email) => {
    try {
      // Exit unified mode when switching to a specific account
      setIsUnifiedMode(false);

      const res = await apiFetch('/accounts/switch', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setActiveAccount(email);
        activeAccountRef.current = email;
        setSelectedMessageId(null);
        setActiveSearch('');
        setSearch('');
        setActiveLabel('INBOX');
        showToast(`Switched to ${email}`);

        // Reload inbox data for the switched account
        const [profileRes, labelsRes, messagesRes] = await Promise.all([
          apiFetch('/profile', {}, email),
          apiFetch('/labels', {}, email),
          apiFetch('/messages?maxResults=25&labelIds=INBOX', {}, email),
        ]);
        if (profileRes.ok) setProfile(profileRes);
        setLabels(labelsRes.ok ? labelsRes.labels : []);
        if (messagesRes.ok) {
          setMessages(messagesRes.messages);
          setNextPageToken(messagesRes.nextPageToken);
        }
      }
    } catch (err) {
      showToast('Failed to switch account: ' + (err.message || 'Unknown error'));
    }
  }, [showToast]);

  // Unified inbox: toggle unified mode on/off
  const handleToggleUnified = useCallback(() => {
    setIsUnifiedMode((prev) => {
      const nextUnified = !prev;
      // Reset view state
      setSelectedMessageId(null);
      setActiveSearch('');
      setSearch('');
      setSelectedIds(new Set());
      setMessages([]);
      setNextPageToken(null);
      setActiveLabel(nextUnified ? null : 'INBOX');
      setActiveCategory('all');

      if (nextUnified) {
        // Entering unified mode — fetch unified messages
        const id = ++fetchIdRef.current;
        trackedFetch(`${API}/unified?maxResults=25`)
          .then(r => r.json())
          .then(res => {
            if (id !== fetchIdRef.current) return;
            if (res.ok) {
              const msgs = res.messages || [];
              msgs.sort((a, b) => new Date(b.date) - new Date(a.date));
              setMessages(msgs);
              setNextPageToken(res.nextPageToken || null);
            }
          })
          .catch(() => {});

        // Fetch unified unread counts
        trackedFetch(`${API}/unified/unread-counts`)
          .then(r => r.json())
          .then(res => {
            if (res.ok && res.counts) setUnifiedUnreadCounts(res.counts);
          })
          .catch(() => {});

        showToast('Unified Inbox — showing all accounts');
      } else {
        // Exiting unified mode — reload the active account's inbox
        const email = activeAccountRef.current;
        if (email) {
          Promise.all([
            apiFetch('/labels', {}, email),
            apiFetch('/messages?maxResults=25&labelIds=INBOX', {}, email),
          ]).then(([labelsRes, messagesRes]) => {
            setLabels(labelsRes.ok ? labelsRes.labels : []);
            if (messagesRes.ok) {
              setMessages(messagesRes.messages);
              setNextPageToken(messagesRes.nextPageToken);
            }
          }).catch(() => {});
        }
        showToast(`Showing ${activeAccountRef.current || 'single account'}`);
      }

      return nextUnified;
    });
  }, [showToast]);

  // Multi-account: add another account (triggers OAuth flow)
  const handleAddAccount = useCallback(async () => {
    try {
      const data = await apiFetch('/auth/url');
      if (data.ok && data.url) {
        window.location.href = data.url;
      } else {
        showToast(data.error || 'Failed to start OAuth flow');
      }
    } catch (err) {
      showToast('Failed to add account: ' + (err.message || 'Unknown error'));
    }
  }, [showToast]);

  // Multi-account: disconnect a specific account (from the switcher)
  const handleDisconnectAccount = useCallback((email) => {
    setDisconnectTarget(email);
    setShowDisconnect(true);
  }, []);

  // Render based on status
  if (status === 'loading') return <div className="gmail-container"><GmailLoadingSpinner text="Connecting to Gmail..." /></div>;
  if (status === 'not-connected') return (
    <div className="gmail-container">
      <GmailConnectPage onConnected={handleConnected} errorParam={authErrorParam} />
    </div>
  );
  if (status === 'error') return (
    <div className="gmail-container">
      <GmailError message={errorMsg} onRetry={() => { setStatus('loading'); setErrorMsg(''); setInitRetry(c => c + 1); }} />
    </div>
  );

  return (
    <div className="gmail-container">
      {/* Header bar */}
      <div className="gmail-header gmail-header-shadow">
        <div className="gmail-header-left">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
          <span className="gmail-header-title">Gmail{isUnifiedMode ? ' — Unified' : ''}</span>
          {accounts.length > 0 ? (
            <AccountSwitcher
              accounts={accounts}
              activeAccount={activeAccount}
              onSwitch={handleSwitchAccount}
              onAdd={handleAddAccount}
              onDisconnect={handleDisconnectAccount}
              isUnifiedMode={isUnifiedMode}
              onToggleUnified={handleToggleUnified}
              unifiedUnreadTotal={unifiedUnreadCounts.total || 0}
            />
          ) : profile && (
            <span className="gmail-header-email-badge">
              <span className="gmail-header-email-dot" />
              {profile.email}
            </span>
          )}
        </div>
        <div className="gmail-header-right">
          {/* Density toggle */}
          <div className="gmail-density-wrap" ref={densityRef}>
            <button className="gmail-btn-icon" onClick={() => setShowDensityMenu((p) => !p)} type="button" title="Display density" aria-label="Display density">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            {showDensityMenu && (
              <div className="gmail-density-dropdown">
                {['comfortable', 'default', 'compact'].map((d) => (
                  <button
                    key={d}
                    className={`gmail-density-option${density === d ? ' is-active' : ''}`}
                    onClick={() => { setDensity(d); setShowDensityMenu(false); }}
                    type="button"
                  >
                    <span className="gmail-density-check">{density === d ? '\u2713' : ''}</span>
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="gmail-btn-icon" onClick={handleRefresh} type="button" title="Refresh" aria-label="Refresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
          <button
            className={`gmail-btn-icon${showUnsubPanel ? ' is-active' : ''}`}
            onClick={() => setShowUnsubPanel((p) => !p)}
            type="button"
            title="Manage Subscriptions"
            aria-label="Manage Subscriptions"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <line x1="2" y1="14" x2="22" y2="14" />
              <line x1="8" y1="18" x2="16" y2="18" />
            </svg>
          </button>
          <button className="gmail-btn gmail-btn-compose" onClick={() => setShowCompose(true)} type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Compose
          </button>
          <button
            className={`workspace-agent-toggle${showAiPanel ? ' is-active' : ''}`}
            onClick={handleToggleAiPanel}
            type="button"
            title={showAiPanel ? 'Close Workspace Agent' : 'Open Workspace Agent'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            Agent
          </button>
          <button
            className="gmail-btn gmail-btn-disconnect"
            onClick={() => { setDisconnectTarget(activeAccount); setShowDisconnect(true); }}
            type="button"
            title="Disconnect Gmail account"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="gmail-body-with-agent">
      <div className="gmail-body">
        {/* Label sidebar */}
        <LabelSidebar
          labels={labels}
          activeLabel={activeLabel}
          onSelectLabel={handleLabelSelect}
          collapsed={labelSidebarCollapsed}
          onToggle={() => setLabelSidebarCollapsed((p) => !p)}
          onCreateLabel={handleCreateLabel}
        />

        {/* Main content area */}
        <div className="gmail-main">
          <AnimatePresence mode="wait">
            {selectedMessageId ? (
              <MessageReader
                key="reader"
                messageId={selectedMessageId}
                onBack={() => setSelectedMessageId(null)}
                onOpenCompose={(defaults) => {
                  setComposeDefaults(defaults);
                  setShowCompose(true);
                }}
                onOpenAiPanel={(emailCtx) => {
                  setAiPanelEmailContext(emailCtx);
                  openAiPanel();
                }}
                onReply={handleReply}
                onForward={handleForward}
                onArchive={handleArchive}
                onTrash={handleTrash}
                onToggleStar={handleToggleStar}
                onToggleRead={handleToggleRead}
                onApplyLabel={handleApplyLabel}
                labels={labels}
                showToast={showToast}
                activeAccount={isUnifiedMode ? (getMessageAccount(selectedMessageId) || activeAccount) : activeAccount}
              />
            ) : (
              <motion.div
                key="list"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                className="gmail-list-wrapper"
              >
                {/* Search bar */}
                <form className="gmail-search" onSubmit={handleSearch}>
                  <svg className="gmail-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    ref={searchInputRef}
                    type="text"
                    className="gmail-search-input"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search mail (e.g. from:user subject:invoice)"
                  />
                  {search && (
                    <button
                      className="gmail-btn-icon gmail-search-clear"
                      onClick={() => { setSearch(''); setActiveSearch(''); setMessages([]); setNextPageToken(null); fetchMessages('', activeLabel); }}
                      type="button"
                      aria-label="Clear search"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </form>

                {/* Category tabs + message count */}
                <div className="gmail-category-tabs">
                  {[
                    { key: 'all', label: 'All Mail' },
                    { key: 'primary', label: 'Primary' },
                    { key: 'social', label: 'Social' },
                    { key: 'promotions', label: 'Promotions' },
                    { key: 'updates', label: 'Updates' },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      className={`gmail-category-tab${activeCategory === tab.key ? ' is-active' : ''}`}
                      onClick={() => handleCategoryChange(tab.key)}
                      type="button"
                    >
                      {tab.label}
                    </button>
                  ))}
                  <span className="gmail-msg-count-inline">
                    {selectedIds.size > 0
                      ? `${selectedIds.size} selected`
                      : visibleMessages.length > 0
                        ? `${visibleMessages.length}${nextPageToken ? '+' : ''}`
                        : ''
                    }
                  </span>
                </div>

                {/* Active filters indicator — only show for non-default filters */}
                {(activeSearch || (activeLabel && activeLabel !== 'INBOX')) && (
                  <div className="gmail-active-filters">
                    {activeSearch && (
                      <span className="gmail-filter-chip">
                        Search: {activeSearch}
                        <button type="button" onClick={() => { setSearch(''); setActiveSearch(''); setMessages([]); setNextPageToken(null); fetchMessages('', activeLabel); }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </span>
                    )}
                    {activeLabel && activeLabel !== 'INBOX' && (
                      <span className="gmail-filter-chip">
                        Label: {SYSTEM_LABEL_DISPLAY[activeLabel] || activeLabel}
                        <button type="button" onClick={() => { setActiveLabel('INBOX'); setMessages([]); setNextPageToken(null); fetchMessages(activeSearch, 'INBOX'); }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </span>
                    )}
                  </div>
                )}

                {/* Bulk action bar */}
                {selectedIds.size > 0 && (
                  <div className="gmail-bulk-bar">
                    <label className="gmail-select-checkbox gmail-bulk-select-all" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds.size === messages.length} onChange={handleSelectAll} />
                      <span className="gmail-select-checkmark" />
                    </label>
                    <span className="gmail-bulk-count">{selectedIds.size} selected</span>
                    <div className="gmail-bulk-actions">
                      <button className="gmail-bulk-btn" onClick={() => handleBulkAction('archive')} type="button" title="Archive selected">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
                        </svg>
                        Archive
                      </button>
                      <button className="gmail-bulk-btn" onClick={() => handleBulkAction('trash')} type="button" title="Trash selected">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                        </svg>
                        Trash
                      </button>
                      <button className="gmail-bulk-btn" onClick={() => handleBulkAction('read')} type="button" title="Mark as read">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 7l10 6 10-6" />
                        </svg>
                        Read
                      </button>
                      <button className="gmail-bulk-btn" onClick={() => handleBulkAction('unread')} type="button" title="Mark as unread">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 13V6a2 2 0 00-2-2H4a2 2 0 00-2 2v12a2 2 0 002 2h9" /><path d="M2 7l10 6 10-6" /><path d="M16 19h6" /><path d="M19 16v6" />
                        </svg>
                        Unread
                      </button>
                      <button className="gmail-bulk-btn" onClick={() => handleBulkAction('star')} type="button" title="Star selected">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                        Star
                      </button>
                    </div>
                    <button className="gmail-bulk-deselect" onClick={() => setSelectedIds(new Set())} type="button" title="Deselect all">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                )}


                {/* Smart folder suggestion banners */}
                {folderSuggestions.length > 0 && !selectedMessageId && (
                  <div className="gmail-suggestions-container">
                    {folderSuggestions.slice(0, 3).map((s) => (
                      <div key={s.key} className="gmail-suggestion-banner">
                        <div className="gmail-suggestion-text">
                          <strong>{s.messageIds.length}</strong> email{s.messageIds.length !== 1 ? 's' : ''} from <strong>{s.domain}</strong> could go in <strong>{s.folderName}</strong>
                        </div>
                        <div className="gmail-suggestion-actions">
                          <button
                            className="gmail-suggestion-move"
                            onClick={() => handleMoveSuggestion(s)}
                            disabled={movingSuggestion === s.key}
                            type="button"
                          >
                            {movingSuggestion === s.key ? 'Moving...' : 'Move'}
                          </button>
                          <button
                            className="gmail-suggestion-dismiss"
                            onClick={() => handleDismissSuggestion(s.key)}
                            type="button"
                          >
                            Dismiss
                          </button>
                          <a
                            className="gmail-suggestion-filter-link"
                            href={`https://mail.google.com/mail/u/0/#create-filter/from=${encodeURIComponent(s.domain)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Create Gmail filter
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Message list */}
                {visibleMessages.length === 0 ? (
                  <GmailEmpty search={activeSearch} />
                ) : (
                  <div className={`gmail-msg-list density-${density}`}>
                    {visibleMessages.map((msg, idx) => (
                      <MessageRow
                        key={msg.id}
                        msg={msg}
                        onClick={setSelectedMessageId}
                        selected={selectedIds.has(msg.id)}
                        onSelect={handleSelectMessage}
                        focused={idx === focusedIndex}
                        onArchive={handleArchive}
                        onTrash={handleTrash}
                        onToggleStar={handleToggleStar}
                        onToggleRead={handleToggleRead}
                        onContextMenu={handleContextMenu}
                        density={density}
                        isUnifiedMode={isUnifiedMode}
                      />
                    ))}
                    {nextPageToken && (
                      <div className="gmail-load-more">
                        <button
                          className="gmail-btn gmail-btn-secondary"
                          onClick={handleLoadMore}
                          disabled={loadingMore}
                          type="button"
                        >
                          {loadingMore ? 'Loading...' : 'Load more'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Workspace Agent — docked right panel */}
      {!agentDock?.managed && showAiPanel ? (
        <div className="gmail-agent-dock-wrapper">
          <AgentDock
            chat={chat}
            defaultTab="workspace"
            onClose={handleToggleAiPanel}
            viewContext={workspaceDockContext}
          />
        </div>
      ) : null}
      </div>

      {/* Unsubscribe panel */}
      <AnimatePresence>
        {showUnsubPanel && (
          <UnsubscribePanel
            onClose={() => setShowUnsubPanel(false)}
            showToast={showToast}
            activeAccount={activeAccount}
          />
        )}
      </AnimatePresence>

      {/* Compose overlay — supports both showCompose (new/ai-draft) and composeMode (reply/forward) */}
      <AnimatePresence>
        {(showCompose || composeMode) && (
          <ComposeDraft
            onClose={() => { setShowCompose(false); setComposeDefaults(null); setComposeMode(null); }}
            onSaved={() => fetchMessages(activeSearch, activeLabel)}
            onSent={() => { fetchMessages(activeSearch, activeLabel); showToast('Message sent!'); }}
            initialTo={composeMode?.to || composeDefaults?.to || ''}
            initialSubject={composeMode?.subject || composeDefaults?.subject || ''}
            initialBody={composeMode?.body || composeDefaults?.body || ''}
            initialCc={composeMode?.cc || ''}
            initialBcc={composeMode?.bcc || ''}
            threadId={composeMode?.threadId}
            inReplyTo={composeMode?.inReplyTo}
            references={composeMode?.references}
            mode={composeMode?.mode || 'new'}
            activeAccount={composeMode?.account || activeAccount}
          />
        )}
      </AnimatePresence>

      {/* Toast notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            className="gmail-toast"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ duration: 0.2 }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Disconnect confirmation modal */}
      <AnimatePresence>
        {showDisconnect && (
          <DisconnectModal
            email={disconnectTarget || activeAccount || profile?.email || 'your account'}
            onConfirm={() => handleDisconnect(disconnectTarget || activeAccount)}
            onCancel={() => { setShowDisconnect(false); setDisconnectTarget(null); }}
          />
        )}
      </AnimatePresence>

      {/* Old floating AI FAB and panel removed — replaced by docked WorkspaceAgentPanel */}

      {/* Context menu */}
      {contextMenu && (
        <MessageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          msg={contextMenu.msg}
          onClose={() => setContextMenu(null)}
          onOpen={(id) => setSelectedMessageId(id)}
          onReply={handleReply}
          onForward={handleForward}
          onArchive={handleArchive}
          onTrash={handleTrash}
          onToggleStar={handleToggleStar}
          onToggleRead={handleToggleRead}
        />
      )}

      {/* Keyboard shortcut help */}
      <AnimatePresence>
        {showShortcutHelp && (
          <KeyboardShortcutHelp onClose={() => setShowShortcutHelp(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
