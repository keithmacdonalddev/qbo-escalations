import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listConversations, deleteConversation, updateConversation } from '../api/chatApi.js';
import { onCircuitChange } from '../api/http.js';
import { useToast } from '../hooks/useToast.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import Tooltip from './Tooltip.jsx';
import { transitions, staggerContainer, staggerChild, fade } from '../utils/motion.js';
import { tel, TEL } from '../lib/devTelemetry.js';

// Adaptive poll intervals — fast after mutations, slow when idle
const POLL_ACTIVE_MS = 5_000;
const POLL_IDLE_MS = 30_000;
const POLL_ACTIVE_WINDOW_MS = 60_000;

const NAV_ITEMS = [
  { hash: '#/chat', label: 'Chat', short: 'Chat', icon: IconChat },
  { hash: '#/dashboard', label: 'Dashboard', short: 'Dash', icon: IconDashboard },
  { hash: '#/playbook', label: 'Playbook', short: 'Book', icon: IconBook },
  { hash: '#/templates', label: 'Templates', short: 'Tmpl', icon: IconTemplate },
  { hash: '#/analytics', label: 'Analytics', short: 'Stats', icon: IconChart },
  { hash: '#/usage', label: 'Usage', short: 'Usage', icon: IconUsage },
  { hash: '#/dev', label: 'Dev Mode', short: 'Dev', icon: IconTerminal },
  { hash: '#/gmail', label: 'Gmail', short: 'Mail', icon: IconMail },
  { hash: '#/calendar', label: 'Calendar', short: 'Cal', icon: IconCalendar },
];

export default function Sidebar({ currentRoute, conversationId, isOpen, onClose, collapsed, onToggleCollapse, hoverExpand, showLabels, extraNavItems = [] }) {
  const toast = useToast();
  const [conversations, setConversations] = useState([]);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const hoverTimerRef = useRef(null);
  const mouseOverRef = useRef(false);
  const editInputRef = useRef(null);
  const loadingRef = useRef(false);
  const fetchGenRef = useRef(0);
  const lastMutationRef = useRef(0);  // Start idle — no reason to fast-poll on fresh load
  const [circuitState, setCircuitState] = useState({ status: 'closed', failures: 0 });
  const navItems = [...NAV_ITEMS, ...extraNavItems.map((item) => ({ ...item, icon: item.icon || IconTerminal }))];

  const handleMouseEnter = useCallback(() => {
    mouseOverRef.current = true;
    if (!collapsed || !hoverExpand) return;
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHoverExpanded(true), 200);
  }, [collapsed, hoverExpand]);

  const handleMouseLeave = useCallback(() => {
    mouseOverRef.current = false;
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHoverExpanded(false), 300);
  }, []);

  // When collapsed changes, reset hover state or re-trigger if mouse is still over
  useEffect(() => {
    if (!collapsed) {
      setHoverExpanded(false);
    } else if (mouseOverRef.current && hoverExpand) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = setTimeout(() => setHoverExpanded(true), 200);
    }
  }, [collapsed, hoverExpand]);

  useEffect(() => onCircuitChange(setCircuitState), []);

  const getPollInterval = useCallback(() => {
    return (Date.now() - lastMutationRef.current) < POLL_ACTIVE_WINDOW_MS
      ? POLL_ACTIVE_MS
      : POLL_IDLE_MS;
  }, []);

  const loadConversations = useCallback(async (searchTerm = '') => {
    // Generation counter — suppresses stale responses when search changes
    // mid-flight so an old response never overwrites newer state.
    const gen = ++fetchGenRef.current;
    if (loadingRef.current) return;          // skip if prior request still pending
    loadingRef.current = true;
    try {
      const list = await listConversations(50, 0, searchTerm);
      if (gen === fetchGenRef.current) {
        setConversations(list);
        tel(TEL.DATA_LOAD, `Loaded ${list.length} conversations`, { count: list.length, search: searchTerm || null });
      }
    } catch {
      // Non-critical
    } finally {
      loadingRef.current = false;
    }
  }, []);

  // Backpressure-safe polling with adaptive interval:
  // - 5 s after recent mutations (delete, rename, navigation)
  // - 30 s when idle (no mutations in the last 60 s)
  // Next tick only schedules after prior request settles.
  useEffect(() => {
    let cancelled = false;
    let tid = null;

    const poll = async () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') {
        tid = setTimeout(poll, getPollInterval());
        return;
      }
      await loadConversations(search);
      if (!cancelled) tid = setTimeout(poll, getPollInterval());
    };

    loadConversations(search);                     // initial fetch
    tid = setTimeout(poll, getPollInterval());      // first poll

    return () => { cancelled = true; clearTimeout(tid); };
  }, [loadConversations, search, getPollInterval]);

  useEffect(() => {
    if (conversationId) {
      lastMutationRef.current = Date.now();        // speed up polling after navigation
      loadConversations(search);
    }
  }, [conversationId, loadConversations, search]);

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    tel(TEL.USER_ACTION, 'Deleted conversation', { conversationId: deleteTarget });
    try {
      await deleteConversation(deleteTarget);
      setConversations(prev => prev.filter(c => c._id !== deleteTarget));
      if (conversationId === deleteTarget) {
        window.location.hash = '#/chat';
      }
    } catch {
      toast.error('Failed to delete conversation');
    }
    lastMutationRef.current = Date.now();      // speed up polling after delete
    setDeleteTarget(null);
  }, [deleteTarget, conversationId]);

  const startRename = useCallback((e, conv) => {
    e.stopPropagation();
    setEditingId(conv._id);
    setEditTitle(conv.title || '');
  }, []);

  const submitRename = useCallback(async () => {
    if (!editingId || !editTitle.trim()) {
      setEditingId(null);
      return;
    }
    try {
      await updateConversation(editingId, { title: editTitle.trim() });
      setConversations(prev => prev.map(c =>
        c._id === editingId ? { ...c, title: editTitle.trim() } : c
      ));
    } catch {
      toast.error('Failed to rename conversation');
    }
    lastMutationRef.current = Date.now();      // speed up polling after rename
    setEditingId(null);
  }, [editingId, editTitle]);

  const handleEditKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitRename();
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  }, [submitRename]);

  return (
    <aside
      className={`sidebar${isOpen ? ' is-open' : ''}${collapsed ? ' is-collapsed' : ''}${hoverExpanded ? ' is-hover-expanded' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="sidebar-header">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        <span>QBO Assist</span>
        <button
          className="sidebar-collapse-btn"
          onClick={() => {
            if (hoverExpanded) setHoverExpanded(false);
            onToggleCollapse();
          }}
          aria-label={collapsed && !hoverExpanded ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed && !hoverExpanded ? 'Expand sidebar' : 'Collapse sidebar'}
          type="button"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            {/* Outer frame */}
            <rect x="3" y="3" width="18" height="18" rx="2" />
            {/* Sidebar divider */}
            <line x1="9" y1="3" x2="9" y2="21" />
            {collapsed && !hoverExpanded ? (
              /* Expand arrow in content area */
              <polyline points="13 10 16 12 13 14" strokeWidth="2" />
            ) : (
              /* Three sidebar content lines */
              <>
                <line x1="5.5" y1="8" x2="7" y2="8" strokeWidth="2" />
                <line x1="5.5" y1="12" x2="7" y2="12" strokeWidth="2" />
                <line x1="5.5" y1="16" x2="7" y2="16" strokeWidth="2" />
              </>
            )}
          </svg>
        </button>
      </div>

      <nav className="sidebar-nav">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = currentRoute === item.hash ||
            (item.hash === '#/chat' && currentRoute.startsWith('#/chat'));
          return (
            <a
              key={item.hash}
              href={item.hash}
              className={`sidebar-nav-item${isActive ? ' is-active' : ''}`}
              onClick={onClose}
              style={{ position: 'relative' }}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-nav-indicator"
                  className="sidebar-nav-indicator-bg"
                  transition={transitions.layout}
                />
              )}
              <Icon size={16} />
              <span>{item.label}</span>
              {collapsed && showLabels && !hoverExpanded && (
                <span className="sidebar-nav-short-label">{item.short}</span>
              )}
            </a>
          );
        })}
      </nav>

      <div className="sidebar-collapsible">
      {/* Search */}
      <div style={{ padding: '0 var(--sp-3)', marginTop: 'var(--sp-3)' }}>
        <div style={{ position: 'relative' }}>
          <svg
            width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ink-tertiary)"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              fontSize: 'var(--text-xs)',
              padding: '5px 8px 5px 26px',
              background: 'var(--bg-sunken)',
              border: '1px solid var(--line-subtle)',
              borderRadius: 'var(--radius-md)',
              width: '100%',
              color: 'var(--ink)',
            }}
          />
        </div>
      </div>

      <div className="sidebar-section-title">
        {search ? `Results for "${search}"` : 'Recent Conversations'}
      </div>

      <motion.div
        className="sidebar-conversations"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        key={search}
      >
        {!search && (
          <Tooltip text="Start a fresh chat session" level="medium" position="right">
            <a
              href="#/chat"
              className="sidebar-conv-item"
              style={{ fontWeight: 600, color: 'var(--accent)', gap: 'var(--sp-2)' }}
              onClick={onClose}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>New Conversation</span>
            </a>
          </Tooltip>
        )}

        <AnimatePresence mode="popLayout">
          {conversations.map(conv => (
            <motion.div
              key={conv._id}
              variants={staggerChild}
              exit={{ opacity: 0, x: -20 }}
              transition={transitions.springGentle}
              className={`sidebar-conv-item${conversationId === conv._id ? ' is-active' : ''}`}
              onClick={() => { if (!editingId) { tel(TEL.USER_ACTION, 'Selected conversation', { conversationId: conv._id }); window.location.hash = `#/chat/${conv._id}`; onClose?.(); } }}
              role="button"
              tabIndex={0}
              aria-label={conv.title || 'Untitled conversation'}
              onKeyDown={(e) => { if (e.key === 'Enter' && !editingId) { window.location.hash = `#/chat/${conv._id}`; onClose?.(); } }}
              style={{ alignItems: 'flex-start', padding: 'var(--sp-2) var(--sp-4)' }}
            >
              <AnimatePresence mode="wait">
                {editingId === conv._id ? (
                  <motion.div key="edit" {...fade} transition={transitions.fast} style={{ flex: 1, minWidth: 0 }}>
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={submitRename}
                      onKeyDown={handleEditKeyDown}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        width: '100%',
                        fontSize: 'var(--text-sm)',
                        padding: '2px 4px',
                        border: '1px solid var(--accent)',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-raised)',
                        color: 'var(--ink)',
                        minWidth: 0,
                      }}
                    />
                  </motion.div>
                ) : (
                  <motion.div key="display" {...fade} transition={transitions.fast} style={{ flex: 1, minWidth: 0 }}>
                    <div className="truncate" style={{ fontSize: 'var(--text-sm)' }}>
                      {conv.title || 'Untitled'}
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', marginTop: 1 }}>
                      <span style={{ fontSize: '10px', color: 'var(--ink-tertiary)' }}>
                        {relativeTime(conv.updatedAt)}
                      </span>
                      {conv.messageCount > 0 && (
                        <span style={{
                          fontSize: '10px',
                          color: 'var(--ink-tertiary)',
                          background: 'var(--bg-sunken)',
                          padding: '0 4px',
                          borderRadius: 'var(--radius-sm)',
                          lineHeight: '16px',
                        }}>
                          {conv.messageCount} msg{conv.messageCount !== 1 ? 's' : ''}
                        </span>
                      )}
                      {conv.escalationId && (
                        <span
                          title="Linked to escalation"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                            fontSize: '10px',
                            color: 'var(--accent)',
                            background: 'var(--accent-subtle)',
                            padding: '0 4px',
                            borderRadius: 'var(--radius-sm)',
                            lineHeight: '16px',
                            fontWeight: 600,
                          }}
                        >
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          ESC
                        </span>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="sidebar-conv-actions" style={{ display: 'flex', gap: 2, flexShrink: 0, marginTop: 2 }}>
                {editingId !== conv._id && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => startRename(e, conv)}
                    title="Rename"
                    aria-label="Rename conversation"
                    style={{ padding: '2px 4px', minHeight: 'auto', opacity: 0.4 }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(conv._id); }}
                  title="Delete"
                  aria-label="Delete conversation"
                  style={{ padding: '2px 4px', minHeight: 'auto', opacity: 0.4 }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {conversations.length === 0 && (
          <div style={{ padding: 'var(--sp-3) var(--sp-5)', fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
            {search ? 'No conversations match your search' : 'No conversations yet'}
          </div>
        )}
      </motion.div>
      </div>

      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete Conversation"
        message="This conversation and all its messages will be permanently deleted. This cannot be undone."
        confirmLabel="Delete"
        danger={true}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {circuitState.status !== 'closed' && (
        <div className="sidebar-circuit-indicator" title={
          circuitState.status === 'open'
            ? 'Backend unavailable — requests paused'
            : `Backend degraded — ${circuitState.failures} consecutive failure${circuitState.failures !== 1 ? 's' : ''}`
        }>
          <span
            className="sidebar-circuit-dot"
            style={{
              background: circuitState.status === 'open' ? 'var(--red, #ef4444)' : 'var(--amber, #f59e0b)',
              boxShadow: circuitState.status === 'open'
                ? '0 0 6px var(--red, #ef4444)'
                : '0 0 6px var(--amber, #f59e0b)',
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--ink-secondary)' }}>
            {circuitState.status === 'open' ? 'Backend unavailable' : 'Backend degraded'}
          </span>
        </div>
      )}
    </aside>
  );
}

/** Format a date as relative time */
function relativeTime(dateStr) {
  if (!dateStr) return '';
  const diffSec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return Math.floor(diffSec / 60) + 'm ago';
  if (diffSec < 86400) return Math.floor(diffSec / 3600) + 'h ago';
  if (diffSec < 604800) return Math.floor(diffSec / 86400) + 'd ago';
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// --- SVG Icon Components ---

function IconChat({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

function IconDashboard({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}

function IconBook({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </svg>
  );
}

function IconTemplate({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function IconChart({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function IconUsage({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
    </svg>
  );
}

function IconTerminal({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function IconMail({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function IconCalendar({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

