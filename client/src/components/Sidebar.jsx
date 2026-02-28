import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listConversations, deleteConversation, updateConversation } from '../api/chatApi.js';
import ConfirmModal from './ConfirmModal.jsx';
import Tooltip from './Tooltip.jsx';
import { transitions, staggerContainer, staggerChild, fade } from '../utils/motion.js';

const NAV_ITEMS = [
  { hash: '#/chat', label: 'Chat', icon: IconChat },
  { hash: '#/dashboard', label: 'Dashboard', icon: IconDashboard },
  { hash: '#/playbook', label: 'Playbook', icon: IconBook },
  { hash: '#/templates', label: 'Templates', icon: IconTemplate },
  { hash: '#/analytics', label: 'Analytics', icon: IconChart },
  { hash: '#/usage', label: 'Usage', icon: IconUsage },
  { hash: '#/dev', label: 'Dev Mode', icon: IconTerminal },
];

export default function Sidebar({ currentRoute, conversationId, isOpen, onClose, collapsed, onToggleCollapse }) {
  const [conversations, setConversations] = useState([]);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const editInputRef = useRef(null);

  const loadConversations = useCallback(async (searchTerm = '') => {
    try {
      const list = await listConversations(50, 0, searchTerm);
      setConversations(list);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    loadConversations(search);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') loadConversations(search);
    }, 10000);
    return () => clearInterval(interval);
  }, [loadConversations, search]);

  useEffect(() => {
    if (conversationId) loadConversations(search);
  }, [conversationId, loadConversations, search]);

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteConversation(deleteTarget);
      setConversations(prev => prev.filter(c => c._id !== deleteTarget));
      if (conversationId === deleteTarget) {
        window.location.hash = '#/chat';
      }
    } catch {
      // Ignore
    }
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
      // Ignore
    }
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
    <aside className={`sidebar${isOpen ? ' is-open' : ''}${collapsed ? ' is-collapsed' : ''}`}>
      <div className="sidebar-header">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        <span>QBO Assist</span>
        <button
          className="sidebar-collapse-btn"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          type="button"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            {/* Outer frame */}
            <rect x="3" y="3" width="18" height="18" rx="2" />
            {/* Sidebar divider */}
            <line x1="9" y1="3" x2="9" y2="21" />
            {collapsed ? (
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
        {NAV_ITEMS.map(item => {
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
              onClick={() => { if (!editingId) { window.location.hash = `#/chat/${conv._id}`; onClose?.(); } }}
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

function IconSettings({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}
