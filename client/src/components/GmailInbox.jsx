import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import AgentDock from './AgentDock.jsx';
import { apiFetch as trackedFetch } from '../api/http.js';
import { useWorkspaceMonitorStream } from '../context/WorkspaceMonitorContext.jsx';
import { dispatchGmailMutations, GMAIL_MESSAGES_MUTATED_EVENT } from '../lib/gmailUiEvents.js';
import { apiFetch, sendGmailAI } from '../lib/gmail/gmailApi.js';
import { CATEGORY_LABEL_BY_TAB } from '../lib/gmail/gmailInboxHelpers.jsx';
import { buildFolderSuggestions } from '../lib/gmail/folderSuggestions.js';
import useGmailAccounts from '../hooks/useGmailAccounts.js';
import GmailHeaderChrome from './gmail/GmailHeaderChrome.jsx';
import GmailLabelSidebar from './gmail/GmailLabelSidebar.jsx';
import GmailComposeDraft from './gmail/GmailComposeDraft.jsx';
import { KeyboardShortcutHelp, MessageContextMenu } from './gmail/GmailInboxOverlays.jsx';
import GmailMessageReader from './gmail/GmailMessageReader.jsx';
import GmailMessageList from './gmail/GmailMessageList.jsx';
import GmailUnsubscribePanel from './gmail/GmailUnsubscribePanel.jsx';
import './GmailInbox.css';

// ---------------------------------------------------------------------------
// Gmail API base path
// ---------------------------------------------------------------------------

const API = '/api/gmail';

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
        setMessages((prev) => [...prev, { role: 'assistant', content: data.fullResponse || '', usage: data.usage || null }]);
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
          setMessages((prev) => [...prev, { role: 'assistant', content: data.fullResponse || '', usage: data.usage || null }]);
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
              {msg.role === 'assistant' && msg.usage && msg.usage.totalTokens > 0 && (
                <span style={{
                  fontSize: '11px',
                  color: 'var(--text-tertiary, #666)',
                  marginTop: '4px',
                  display: 'inline-flex',
                  gap: '6px',
                  opacity: 0.7,
                }}>
                  {msg.usage.totalTokens.toLocaleString()} tokens
                  {msg.usage.totalCostMicros > 0 && (
                    <span>· ${(msg.usage.totalCostMicros / 1_000_000).toFixed(4)}</span>
                  )}
                  {msg.usage.model && (
                    <span>· {msg.usage.model}</span>
                  )}
                </span>
              )}
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

export default function GmailInbox({ chat = null, agentDock = null, isActive = true }) {
  // State
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
  const [labelSidebarCollapsed, setLabelSidebarCollapsed] = useState(false);
  const [localShowAiPanel, setLocalShowAiPanel] = useState(true);
  const [aiPanelEmailContext, setAiPanelEmailContext] = useState(null);
  const [composeDefaults, setComposeDefaults] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const showToast = useCallback((message, duration = 3000) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(null), duration);
  }, []);
  const searchInputRef = useRef(null);
  const fetchIdRef = useRef(0);

  // Email management state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [composeMode, setComposeMode] = useState(null); // { mode, to, subject, body, cc, bcc, threadId, inReplyTo, references }

  // New UI state
  const [activeCategory, setActiveCategory] = useState('all');
  const [density, setDensity] = useState('default'); // 'comfortable' | 'default' | 'compact'
  const [pageSize, setPageSize] = useState(() => {
    try { const v = parseInt(localStorage.getItem('gmail-page-size'), 10); return [25, 50, 100].includes(v) ? v : 25; } catch { return 25; }
  });
  const pageSizeRef = useRef(pageSize);
  useEffect(() => { pageSizeRef.current = pageSize; }, [pageSize]);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, msg }
  const [snoozedIds, setSnoozedIds] = useState(new Set());
  const [showUnsubPanel, setShowUnsubPanel] = useState(false);
  const showAiPanel = agentDock?.managed ? !!agentDock.open : localShowAiPanel;
  const workspaceMonitor = useWorkspaceMonitorStream();
  const inboxRefreshTimerRef = useRef(null);
  const lastRefreshTokenRef = useRef(0);

  const {
    activeAccount,
    activeAccountRef,
    accounts,
    authErrorParam,
    closeDisconnectDialog,
    disconnectTarget,
    disconnecting,
    errorMsg,
    handleAddAccount,
    handleConnected,
    handleDisconnect,
    handleDisconnectAccount,
    handleRetryBootstrap,
    handleSwitchAccount,
    handleToggleUnified,
    isUnifiedMode,
    showDisconnect,
    status,
    unifiedUnreadCounts,
  } = useGmailAccounts({
    isActive,
    pageSizeRef,
    showToast,
    setProfile,
    setLabels,
    setMessages,
    setNextPageToken,
    setSelectedMessageId,
    setActiveSearch,
    setSearch,
    setSelectedIds,
    setActiveLabel,
    setActiveCategory,
  });

  // Account-aware fetch helper — automatically injects the active account
  const acctFetch = useCallback((path, opts = {}) => {
    return apiFetch(path, opts, activeAccountRef.current || undefined);
  }, [activeAccountRef]);

  // Fetch helper that uses a specific account (for unified mode actions on individual messages)
  const accountSpecificFetch = useCallback((path, opts = {}, accountEmail) => {
    return apiFetch(path, opts, accountEmail || activeAccountRef.current || undefined);
  }, [activeAccountRef]);

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

  const doesMessageMatchCurrentView = useCallback((labelsForMessage) => {
    const labelsForCurrentMessage = Array.isArray(labelsForMessage) ? labelsForMessage : [];
    if (activeLabel) return labelsForCurrentMessage.includes(activeLabel);
    const categoryLabel = CATEGORY_LABEL_BY_TAB[activeCategory];
    if (categoryLabel) return labelsForCurrentMessage.includes(categoryLabel);
    return true;
  }, [activeCategory, activeLabel]);

  useEffect(() => {
    const handleExternalMutations = (event) => {
      const incoming = Array.isArray(event?.detail?.mutations) ? event.detail.mutations : [];
      if (incoming.length === 0) return;

      setMessages((prev) => prev.reduce((next, message) => {
        let current = message;
        let removed = false;

        for (const mutation of incoming) {
          const mutationIds = Array.isArray(mutation?.messageIds) ? mutation.messageIds : [];
          if (!mutationIds.includes(current.id)) continue;

          const mutationAccount = typeof mutation?.account === 'string' ? mutation.account.trim() : '';
          if (mutationAccount && current.account && current.account !== mutationAccount) continue;

          const removeLabelIds = Array.isArray(mutation?.removeLabelIds) ? mutation.removeLabelIds : [];
          const addLabelIds = Array.isArray(mutation?.addLabelIds) ? mutation.addLabelIds : [];
          const nextLabels = Array.isArray(mutation?.labelIds) && mutation.labelIds.length > 0
            ? mutation.labelIds
            : Array.from(new Set([
              ...(current.labels || []).filter((labelId) => !removeLabelIds.includes(labelId)),
              ...addLabelIds.filter((labelId) => !removeLabelIds.includes(labelId)),
            ]));

          current = {
            ...current,
            labels: nextLabels,
            isUnread: nextLabels.includes('UNREAD'),
            isStarred: nextLabels.includes('STARRED'),
          };

          if (mutation.deleted || !doesMessageMatchCurrentView(nextLabels)) {
            removed = true;
            break;
          }
        }

        if (!removed) next.push(current);
        return next;
      }, []));
    };

    window.addEventListener(GMAIL_MESSAGES_MUTATED_EVENT, handleExternalMutations);
    return () => window.removeEventListener(GMAIL_MESSAGES_MUTATED_EVENT, handleExternalMutations);
  }, [doesMessageMatchCurrentView]);

  useEffect(() => {
    const visibleIds = new Set(messages.map((message) => message.id));

    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(Array.from(prev).filter((id) => visibleIds.has(id)));
      if (next.size === prev.size && Array.from(next).every((id) => prev.has(id))) {
        return prev;
      }
      return next;
    });

    setSelectedMessageId((prev) => (prev && !visibleIds.has(prev) ? null : prev));
  }, [messages]);

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
        const account = getMessageAccount(messageId);
        dispatchGmailMutations({
          messageId,
          ...(account ? { account } : {}),
          removeLabelIds: ['INBOX'],
        }, { source: 'gmail-inbox' });
        showToast('Archived');
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        setSelectedMessageId(null);
      }
    } catch (err) {
      showToast('Archive failed: ' + err.message);
    }
  }, [showToast, msgFetch, getMessageAccount]);

  const handleTrash = useCallback(async (messageId) => {
    try {
      const res = await msgFetch(`/messages/${messageId}`, { method: 'DELETE' }, messageId);
      if (res.ok) {
        const account = getMessageAccount(messageId);
        dispatchGmailMutations({
          messageId,
          ...(account ? { account } : {}),
          deleted: true,
        }, { source: 'gmail-inbox' });
        showToast('Moved to Trash');
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        setSelectedMessageId(null);
      }
    } catch (err) {
      showToast('Trash failed: ' + err.message);
    }
  }, [showToast, msgFetch, getMessageAccount]);

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
          dispatchGmailMutations(ids.map((id) => {
            const account = getMessageAccount(id);
            return {
              messageId: id,
              ...(account ? { account } : {}),
              deleted: true,
            };
          }), { source: 'gmail-inbox' });
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
      dispatchGmailMutations(
        isUnifiedMode
          ? Object.entries(ids.reduce((groups, id) => {
            const account = getMessageAccount(id) || '__default__';
            if (!groups[account]) groups[account] = [];
            groups[account].push(id);
            return groups;
          }, {})).map(([account, messageIds]) => ({
            messageIds,
            ...(account !== '__default__' ? { account } : {}),
            ...(addLabelIds.length > 0 ? { addLabelIds } : {}),
            ...(removeLabelIds.length > 0 ? { removeLabelIds } : {}),
          }))
          : [{
            messageIds: ids,
            ...(addLabelIds.length > 0 ? { addLabelIds } : {}),
            ...(removeLabelIds.length > 0 ? { removeLabelIds } : {}),
          }],
        { source: 'gmail-inbox' },
      );
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
      const params = new URLSearchParams({ maxResults: String(pageSizeRef.current) });
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

  // Page size change handler — persists to localStorage and re-fetches
  const handlePageSizeChange = useCallback((newSize) => {
    const size = parseInt(newSize, 10);
    if (![25, 50, 100].includes(size)) return;
    setPageSize(size);
    pageSizeRef.current = size;
    try { localStorage.setItem('gmail-page-size', String(size)); } catch { /* ignore */ }
    // Re-fetch current view with new page size
    setMessages([]);
    setNextPageToken(null);
    setSelectedMessageId(null);
    setSelectedIds(new Set());
    // Slight delay to let state settle, then fetch
    setTimeout(() => {
      const label = activeLabel;
      const search = activeSearch;
      if (isUnifiedMode) {
        trackedFetch(`${API}/unified?maxResults=${size}${search ? `&q=${encodeURIComponent(search)}` : ''}`)
          .then(r => r.json())
          .then(res => {
            if (res.ok) {
              const msgs = res.messages || [];
              msgs.sort((a, b) => new Date(b.date) - new Date(a.date));
              setMessages(msgs);
              setNextPageToken(res.nextPageToken || null);
            }
          })
          .catch(() => {});
      } else {
        const params = new URLSearchParams({ maxResults: String(size) });
        if (search) params.set('q', search);
        if (label) params.set('labelIds', label);
        acctFetch(`/messages?${params}`)
          .then(res => {
            if (res.ok) {
              setMessages(res.messages || []);
              setNextPageToken(res.nextPageToken || null);
            }
          })
          .catch(() => {});
      }
    }, 0);
  }, [activeLabel, activeSearch, isUnifiedMode, acctFetch]);

  // Visible messages (filter snoozed)
  const visibleMessages = useMemo(() => messages.filter((m) => !snoozedIds.has(m.id)), [messages, snoozedIds]);

  // --- Smart Folder Suggestions ---
  const [dismissedSuggestions, setDismissedSuggestions] = useState(() => {
    try { return JSON.parse(localStorage.getItem('gmail-dismissed-suggestions') || '{}'); } catch { return {}; }
  });
  const [movingSuggestion, setMovingSuggestion] = useState(null);

  const folderSuggestions = useMemo(
    () => buildFolderSuggestions(messages, labels, dismissedSuggestions),
    [messages, labels, dismissedSuggestions],
  );

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

  const handleSearch = useCallback((e) => {
    e.preventDefault();
    setActiveSearch(search);
    setSelectedMessageId(null);
    setSelectedIds(new Set());
    setMessages([]);
    setNextPageToken(null);
    fetchMessages(search, activeLabel);
  }, [search, activeLabel, fetchMessages]);

  const handleClearSearch = useCallback(() => {
    setSearch('');
    setActiveSearch('');
    setMessages([]);
    setNextPageToken(null);
    fetchMessages('', activeLabel);
  }, [activeLabel, fetchMessages]);

  const handleClearLabelFilter = useCallback(() => {
    setActiveLabel('INBOX');
    setMessages([]);
    setNextPageToken(null);
    fetchMessages(activeSearch, 'INBOX');
  }, [activeSearch, fetchMessages]);

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

  // Render based on status
  if (status === 'loading') return <div className="gmail-container"><GmailLoadingSpinner text="Connecting to Gmail..." /></div>;
  if (status === 'not-connected') return (
    <div className="gmail-container">
      <GmailConnectPage onConnected={handleConnected} errorParam={authErrorParam} />
    </div>
  );
  if (status === 'error') return (
    <div className="gmail-container">
      <GmailError message={errorMsg} onRetry={handleRetryBootstrap} />
    </div>
  );

  return (
    <div className="gmail-container">
      {/* Header bar */}
      <GmailHeaderChrome
        accounts={accounts}
        activeAccount={activeAccount}
        profile={profile}
        isUnifiedMode={isUnifiedMode}
        unifiedUnreadTotal={unifiedUnreadCounts.total || 0}
        density={density}
        onDensityChange={setDensity}
        pageSize={pageSize}
        onPageSizeChange={handlePageSizeChange}
        onRefresh={handleRefresh}
        showUnsubPanel={showUnsubPanel}
        onToggleSubscriptions={() => setShowUnsubPanel((prev) => !prev)}
        onCompose={() => setShowCompose(true)}
        showAiPanel={showAiPanel}
        onToggleAiPanel={handleToggleAiPanel}
        onDisconnectAccount={(email) => {
          handleDisconnectAccount(email);
        }}
        onSwitchAccount={handleSwitchAccount}
        onAddAccount={handleAddAccount}
        onToggleUnified={handleToggleUnified}
      />

      <div className="gmail-body-with-agent">
      <div className="gmail-body">
        {/* Label sidebar */}
        <GmailLabelSidebar
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
              <GmailMessageReader
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
              <GmailMessageList
                search={search}
                onSearchChange={(e) => setSearch(e.target.value)}
                onSearchSubmit={handleSearch}
                onClearSearch={handleClearSearch}
                searchInputRef={searchInputRef}
                activeCategory={activeCategory}
                onCategoryChange={handleCategoryChange}
                selectedIds={selectedIds}
                onSelectAll={handleSelectAll}
                messagesCount={messages.length}
                visibleMessages={visibleMessages}
                nextPageToken={nextPageToken}
                loadingMore={loadingMore}
                onLoadMore={handleLoadMore}
                activeSearch={activeSearch}
                activeLabel={activeLabel}
                onClearActiveSearch={handleClearSearch}
                onClearActiveLabel={handleClearLabelFilter}
                folderSuggestions={folderSuggestions}
                onMoveSuggestion={handleMoveSuggestion}
                onDismissSuggestion={handleDismissSuggestion}
                movingSuggestion={movingSuggestion}
                density={density}
                focusedIndex={focusedIndex}
                onOpenMessage={setSelectedMessageId}
                onSelectMessage={handleSelectMessage}
                onArchive={handleArchive}
                onTrash={handleTrash}
                onToggleStar={handleToggleStar}
                onToggleRead={handleToggleRead}
                onBulkAction={handleBulkAction}
                onDeselectAll={() => setSelectedIds(new Set())}
                onContextMenu={handleContextMenu}
                isUnifiedMode={isUnifiedMode}
              />
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
          <GmailUnsubscribePanel
            apiFetch={apiFetch}
            onClose={() => setShowUnsubPanel(false)}
            showToast={showToast}
            activeAccount={activeAccount}
          />
        )}
      </AnimatePresence>

      {/* Compose overlay — supports both showCompose (new/ai-draft) and composeMode (reply/forward) */}
      <AnimatePresence>
        {(showCompose || composeMode) && (
          <GmailComposeDraft
            apiFetch={apiFetch}
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
            onCancel={closeDisconnectDialog}
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
