import { useState, useEffect, useCallback } from 'react';
import { listConversations, deleteConversation } from '../api/chatApi.js';

const NAV_ITEMS = [
  { hash: '#/chat', label: 'Chat', icon: 'C' },
  { hash: '#/dashboard', label: 'Dashboard', icon: 'D' },
  { hash: '#/playbook', label: 'Playbook', icon: 'P' },
  { hash: '#/templates', label: 'Templates', icon: 'T' },
  { hash: '#/analytics', label: 'Analytics', icon: 'A' },
];

export default function Sidebar({ currentRoute, conversationId }) {
  const [conversations, setConversations] = useState([]);

  const loadConversations = useCallback(async () => {
    try {
      const list = await listConversations();
      setConversations(list);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    loadConversations();
    // Refresh every 10s
    const interval = setInterval(loadConversations, 10000);
    return () => clearInterval(interval);
  }, [loadConversations]);

  // Refresh when conversationId changes (new conversation created)
  useEffect(() => {
    if (conversationId) loadConversations();
  }, [conversationId, loadConversations]);

  const handleDeleteConv = useCallback(async (e, id) => {
    e.stopPropagation();
    try {
      await deleteConversation(id);
      setConversations(prev => prev.filter(c => c._id !== id));
      if (conversationId === id) {
        window.location.hash = '#/chat';
      }
    } catch {
      // Ignore
    }
  }, [conversationId]);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>QBO Assist</span>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(item => (
          <a
            key={item.hash}
            href={item.hash}
            className={`sidebar-nav-item${currentRoute === item.hash || (item.hash === '#/chat' && currentRoute.startsWith('#/chat')) ? ' is-active' : ''}`}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', width: 18, textAlign: 'center', flexShrink: 0 }}>
              {item.icon}
            </span>
            <span>{item.label}</span>
          </a>
        ))}
      </nav>

      {/* Conversation history */}
      <div className="sidebar-section-title">Recent Conversations</div>

      <div className="sidebar-conversations">
        <a
          href="#/chat"
          className="sidebar-conv-item"
          style={{ fontWeight: 600, color: 'var(--accent)' }}
        >
          + New Conversation
        </a>

        {conversations.map(conv => (
          <div
            key={conv._id}
            className={`sidebar-conv-item${conversationId === conv._id ? ' is-active' : ''}`}
            onClick={() => { window.location.hash = `#/chat/${conv._id}`; }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') window.location.hash = `#/chat/${conv._id}`; }}
          >
            <span className="truncate" style={{ flex: 1 }}>
              {conv.title || 'Untitled'}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={(e) => handleDeleteConv(e, conv._id)}
              title="Delete conversation"
              aria-label="Delete conversation"
              style={{ padding: '2px 4px', minHeight: 'auto', opacity: 0.5 }}
            >
              x
            </button>
          </div>
        ))}

        {conversations.length === 0 && (
          <div style={{ padding: 'var(--sp-3) var(--sp-5)', fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
            No conversations yet
          </div>
        )}
      </div>
    </aside>
  );
}
