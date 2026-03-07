import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import WorkspaceAgentPanel from './WorkspaceAgentPanel.jsx';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const API = '/api/gmail';

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
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
        window.history.replaceState(null, '', cleaned || '#/gmail');
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
    <div className="gmail-empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--ink-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
      <p>{search ? `No messages matching "${search}"` : 'No messages found'}</p>
    </div>
  );
}

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

function LabelSidebar({ labels, activeLabel, onSelectLabel, collapsed, onToggle }) {
  const systemLabels = labels
    .filter((l) => l.type === 'system' && SYSTEM_LABEL_ORDER.includes(l.id))
    .sort((a, b) => SYSTEM_LABEL_ORDER.indexOf(a.id) - SYSTEM_LABEL_ORDER.indexOf(b.id));

  const userLabels = labels
    .filter((l) => l.type === 'user')
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return (
    <div className={`gmail-label-sidebar${collapsed ? ' is-collapsed' : ''}`}>
      <button className="gmail-label-toggle" onClick={onToggle} type="button" aria-label={collapsed ? 'Show labels' : 'Hide labels'}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {collapsed
            ? <polyline points="9 18 15 12 9 6" />
            : <polyline points="15 18 9 12 15 6" />}
        </svg>
      </button>
      {!collapsed && (
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
            <span>All Mail</span>
          </button>
          {systemLabels.map((l) => (
            <button
              key={l.id}
              className={`gmail-label-item${activeLabel === l.id ? ' is-active' : ''}`}
              onClick={() => onSelectLabel(l.id)}
              type="button"
            >
              <span className="gmail-label-name">{SYSTEM_LABEL_DISPLAY[l.id] || l.name}</span>
              {l.messagesUnread > 0 && <span className="gmail-label-badge">{l.messagesUnread}</span>}
            </button>
          ))}
          {userLabels.length > 0 && (
            <>
              <div className="gmail-label-divider" />
              <div className="gmail-label-section-title">Labels</div>
              {userLabels.map((l) => (
                <button
                  key={l.id}
                  className={`gmail-label-item${activeLabel === l.id ? ' is-active' : ''}`}
                  onClick={() => onSelectLabel(l.id)}
                  type="button"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </svg>
                  <span className="gmail-label-name">{l.name}</span>
                  {l.messagesUnread > 0 && <span className="gmail-label-badge">{l.messagesUnread}</span>}
                </button>
              ))}
            </>
          )}
        </div>
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
      const res = await fetch(`${API}/ai`, {
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

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let dataLines = [];

      function flushEvent() {
        if (!currentEvent && dataLines.length === 0) return;
        const rawData = dataLines.join('\n');
        dataLines = [];
        const evtName = currentEvent;
        currentEvent = '';
        if (!rawData) return;
        try {
          const data = JSON.parse(rawData);
          if (evtName === 'chunk' && data.text) onChunk?.(data.text);
          else if (evtName === 'done') onDone?.(data);
          else if (evtName === 'error') onError?.(data.error || 'AI error');
        } catch { /* ignore */ }
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
          if (!trimmed) { flushEvent(); continue; }
          if (trimmed.startsWith(':')) continue;
          if (trimmed.startsWith('event:')) { currentEvent = trimmed.slice(6).trim(); continue; }
          if (trimmed.startsWith('data:')) { dataLines.push(trimmed.slice(5).trimStart()); }
        }
      }
      flushEvent();
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

function ComposeDraft({ onClose, onSaved, onSent, initialTo, initialSubject, initialBody, initialCc, initialBcc, threadId, inReplyTo, references, mode }) {
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
      });
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
      });
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

function MessageReader({ messageId, onBack, onOpenCompose, onOpenAiPanel, onReply, onForward, onArchive, onTrash, onToggleStar, onToggleRead, onApplyLabel, labels }) {
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
  const summaryAbortRef = useRef(null);
  const draftAbortRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/messages/${messageId}`)
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
        console.error('[Gmail AI] Draft reply error:', err);
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
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Message Row
// ---------------------------------------------------------------------------

function MessageRow({ msg, onClick, selected, onSelect }) {
  return (
    <div className={`gmail-msg-row${msg.isUnread ? ' is-unread' : ''}${selected ? ' is-selected' : ''}`}>
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
            <span className="gmail-msg-from">{msg.from || '(unknown)'}</span>
            <span className="gmail-msg-date">{formatDate(msg.date)}</span>
          </div>
          <div className="gmail-msg-subject">{msg.subject}</div>
          <div className="gmail-msg-snippet">{msg.snippet}</div>
        </div>
        {msg.isStarred && (
          <svg className="gmail-msg-star" width="14" height="14" viewBox="0 0 24 24" fill="var(--warning)" stroke="var(--warning)" strokeWidth="1.5">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        )}
      </button>
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
// Main Component
// ---------------------------------------------------------------------------

export default function GmailInbox() {
  // State
  const [initRetry, setInitRetry] = useState(0);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'not-connected' | 'error'
  const [profile, setProfile] = useState(null);
  const [messages, setMessages] = useState([]);
  const [labels, setLabels] = useState([]);
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [activeLabel, setActiveLabel] = useState(null);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  const [showCompose, setShowCompose] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [labelSidebarCollapsed, setLabelSidebarCollapsed] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [authErrorParam, setAuthErrorParam] = useState(null);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiPanelEmailContext, setAiPanelEmailContext] = useState(null);
  const [composeDefaults, setComposeDefaults] = useState(null);
  const searchInputRef = useRef(null);

  // Email management state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [composeMode, setComposeMode] = useState(null); // { mode, to, subject, body, cc, bcc, threadId, inReplyTo, references }
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

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
    });
  }, []);

  const handleArchive = useCallback(async (messageId) => {
    try {
      const res = await apiFetch(`/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
      });
      if (res.ok) {
        showToast('Archived');
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        setSelectedMessageId(null);
      }
    } catch (err) {
      showToast('Archive failed: ' + err.message);
    }
  }, [showToast]);

  const handleTrash = useCallback(async (messageId) => {
    try {
      const res = await apiFetch(`/messages/${messageId}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Moved to Trash');
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        setSelectedMessageId(null);
      }
    } catch (err) {
      showToast('Trash failed: ' + err.message);
    }
  }, [showToast]);

  const handleToggleStar = useCallback(async (msg) => {
    const add = msg.isStarred ? [] : ['STARRED'];
    const remove = msg.isStarred ? ['STARRED'] : [];
    try {
      const res = await apiFetch(`/messages/${msg.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
      });
      if (res.ok) {
        setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, isStarred: !msg.isStarred, labels: res.labelIds || m.labels } : m));
        showToast(msg.isStarred ? 'Unstarred' : 'Starred');
      }
    } catch { /* ignore */ }
  }, [showToast]);

  const handleToggleRead = useCallback(async (msg) => {
    const add = msg.isUnread ? [] : ['UNREAD'];
    const remove = msg.isUnread ? ['UNREAD'] : [];
    try {
      const res = await apiFetch(`/messages/${msg.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
      });
      if (res.ok) {
        setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, isUnread: !msg.isUnread, labels: res.labelIds || m.labels } : m));
        showToast(msg.isUnread ? 'Marked as read' : 'Marked as unread');
      }
    } catch { /* ignore */ }
  }, [showToast]);

  const handleApplyLabel = useCallback(async (messageId, labelId, apply) => {
    try {
      const res = await apiFetch(`/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify(apply ? { addLabelIds: [labelId] } : { removeLabelIds: [labelId] }),
      });
      if (res.ok) {
        setMessages((prev) => prev.map((m) => {
          if (m.id !== messageId) return m;
          const newLabels = apply ? [...(m.labels || []), labelId] : (m.labels || []).filter((l) => l !== labelId);
          return { ...m, labels: newLabels, isStarred: newLabels.includes('STARRED'), isUnread: newLabels.includes('UNREAD') };
        }));
        showToast(apply ? 'Label added' : 'Label removed');
      }
    } catch { /* ignore */ }
  }, [showToast]);

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
          // Trash each individually (no batch trash in Gmail API)
          await Promise.all(ids.map((id) => apiFetch(`/messages/${id}`, { method: 'DELETE' })));
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
      const res = await apiFetch('/messages/batch', {
        method: 'PATCH',
        body: JSON.stringify({ messageIds: ids, addLabelIds, removeLabelIds }),
      });
      if (res.ok) {
        // Update local state
        setMessages((prev) => prev.map((m) => {
          if (!selectedIds.has(m.id)) return m;
          if (action === 'archive') return null; // filter out archived
          const newLabels = [...(m.labels || []).filter((l) => !removeLabelIds.includes(l)), ...addLabelIds];
          return { ...m, labels: newLabels, isStarred: newLabels.includes('STARRED'), isUnread: newLabels.includes('UNREAD') };
        }).filter(Boolean));
        setSelectedIds(new Set());
        showToast(toastMsg);
      }
    } catch { showToast('Bulk action failed'); }
  }, [selectedIds, showToast]);

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
    window.history.replaceState(null, '', cleanHash || '#/gmail');
  }, []);

  // Initial load — check auth status first, then load data if connected
  useEffect(() => {
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
          setStatus('not-connected');
          return;
        }

        // Step 2: Load inbox data (connected)
        const [profileRes, labelsRes, messagesRes] = await Promise.all([
          apiFetch('/profile'),
          apiFetch('/labels'),
          apiFetch('/messages?maxResults=25'),
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
  }, [initRetry]);

  // Fetch messages when search or label changes
  const fetchMessages = useCallback(async (query, labelId, append = false) => {
    if (append) setLoadingMore(true);
    try {
      const params = new URLSearchParams({ maxResults: '25' });
      if (query) params.set('q', query);
      if (labelId) params.set('labelIds', labelId);
      if (append && nextPageToken) params.set('pageToken', nextPageToken);

      const res = await apiFetch(`/messages?${params}`);
      if (res.ok) {
        setMessages((prev) => append ? [...prev, ...res.messages] : res.messages);
        setNextPageToken(res.nextPageToken);
      }
    } catch { /* ignore */ }
    finally { setLoadingMore(false); }
  }, [nextPageToken]);

  const handleSearch = useCallback((e) => {
    e.preventDefault();
    setActiveSearch(search);
    setSelectedMessageId(null);
    fetchMessages(search, activeLabel);
  }, [search, activeLabel, fetchMessages]);

  const handleLabelSelect = useCallback((labelId) => {
    setActiveLabel(labelId);
    setSelectedMessageId(null);
    fetchMessages(activeSearch, labelId);
  }, [activeSearch, fetchMessages]);

  const handleLoadMore = useCallback(() => {
    fetchMessages(activeSearch, activeLabel, true);
  }, [activeSearch, activeLabel, fetchMessages]);

  const handleRefresh = useCallback(() => {
    setSelectedMessageId(null);
    fetchMessages(activeSearch, activeLabel);
  }, [activeSearch, activeLabel, fetchMessages]);

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      const res = await apiFetch('/auth/disconnect', { method: 'POST' });
      if (res.ok) {
        setStatus('not-connected');
        setProfile(null);
        setMessages([]);
        setLabels([]);
        setShowDisconnect(false);
      }
    } catch (err) {
      console.error('Disconnect failed:', err);
    } finally {
      setDisconnecting(false);
    }
  }, []);

  const handleConnected = useCallback(() => {
    // Re-init after connecting
    setStatus('loading');
    setAuthErrorParam(null);
    async function reload() {
      try {
        const [profileRes, labelsRes, messagesRes] = await Promise.all([
          apiFetch('/profile'),
          apiFetch('/labels'),
          apiFetch('/messages?maxResults=25'),
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
      <div className="gmail-header">
        <div className="gmail-header-left">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
          <span className="gmail-header-title">Gmail</span>
          {profile && (
            <span className="gmail-header-email-badge">
              <span className="gmail-header-email-dot" />
              {profile.email}
            </span>
          )}
        </div>
        <div className="gmail-header-right">
          <button className="gmail-btn-icon" onClick={handleRefresh} type="button" title="Refresh" aria-label="Refresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
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
            onClick={() => setShowAiPanel((p) => !p)}
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
            onClick={() => setShowDisconnect(true)}
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
                  setShowAiPanel(true);
                }}
                onReply={handleReply}
                onForward={handleForward}
                onArchive={handleArchive}
                onTrash={handleTrash}
                onToggleStar={handleToggleStar}
                onToggleRead={handleToggleRead}
                onApplyLabel={handleApplyLabel}
                labels={labels}
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
                      onClick={() => { setSearch(''); setActiveSearch(''); fetchMessages('', activeLabel); }}
                      type="button"
                      aria-label="Clear search"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </form>

                {/* Active filters indicator */}
                {(activeSearch || activeLabel) && (
                  <div className="gmail-active-filters">
                    {activeSearch && (
                      <span className="gmail-filter-chip">
                        Search: {activeSearch}
                        <button type="button" onClick={() => { setSearch(''); setActiveSearch(''); fetchMessages('', activeLabel); }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </span>
                    )}
                    {activeLabel && (
                      <span className="gmail-filter-chip">
                        Label: {SYSTEM_LABEL_DISPLAY[activeLabel] || activeLabel}
                        <button type="button" onClick={() => { setActiveLabel(null); fetchMessages(activeSearch, null); }}>
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

                {/* Message list */}
                {messages.length === 0 ? (
                  <GmailEmpty search={activeSearch} />
                ) : (
                  <div className="gmail-msg-list">
                    {messages.map((msg) => (
                      <MessageRow key={msg.id} msg={msg} onClick={setSelectedMessageId} selected={selectedIds.has(msg.id)} onSelect={handleSelectMessage} />
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
      <WorkspaceAgentPanel
        open={showAiPanel}
        onToggle={() => setShowAiPanel((p) => !p)}
        viewContext={{
          view: 'gmail',
          ...(selectedMessageId ? { emailId: selectedMessageId } : {}),
          ...(aiPanelEmailContext ? {
            emailSubject: aiPanelEmailContext.subject,
            emailFrom: `${aiPanelEmailContext.from || ''} <${aiPanelEmailContext.fromEmail || ''}>`,
            emailBody: aiPanelEmailContext.body,
          } : {}),
        }}
      />
      </div>

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
            email={profile?.email || 'your account'}
            onConfirm={handleDisconnect}
            onCancel={() => setShowDisconnect(false)}
          />
        )}
      </AnimatePresence>

      {/* Old floating AI FAB and panel removed — replaced by docked WorkspaceAgentPanel */}
    </div>
  );
}
