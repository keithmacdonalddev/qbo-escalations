import { useState, useCallback, useRef, useEffect } from 'react';
import useChatRoom from '../hooks/useChatRoom.js';
import useChatRoomRequestFlow from '../hooks/useChatRoomRequestFlow.js';
import ChatRoomThread from './chat-room/ChatRoomThread.jsx';
import ChatRoomComposer from './chat-room/ChatRoomComposer.jsx';
import AgentAvatar from './chat-room/AgentAvatar.jsx';
import './ChatRoom.css';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(ts) {
  if (!ts) return '';
  const now = Date.now();
  const then = new Date(ts).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = now - then;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function truncatePreview(text, max = 100) {
  if (!text || typeof text !== 'string') return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 3).trimEnd() + '...';
}

function formatMessageTimestamp(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function formatEventTime(ts) {
  const date = new Date(ts || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function buildRoomTranscript(room, messages, agents) {
  const title = room?.title || 'Untitled Room';
  const agentNameById = new Map(
    (agents || []).map((agent) => [
      agent.id || agent._id || agent.agentId,
      agent.name || agent.profile?.displayName || agent.id || agent._id || agent.agentId || 'Agent',
    ])
  );
  const lines = [`Room: ${title}`, ''];

  for (const message of messages || []) {
    const role = message?.role || 'message';
    const agentId = message?.agentId || message?.agent || null;
    const speaker = role === 'user'
      ? 'You'
      : (agentNameById.get(agentId) || agentId || 'Agent');
    const timestamp = formatMessageTimestamp(message?.timestamp || message?.createdAt);
    const content = typeof message?.content === 'string' ? message.content.trim() : '';
    const header = timestamp ? `${speaker} [${timestamp}]` : speaker;
    lines.push(header);
    lines.push(content || '(no content)');
    lines.push('');
  }

  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Room Creation Dialog
// ---------------------------------------------------------------------------

function RoomCreateDialog({ agents, onClose, onCreateRoom }) {
  const [title, setTitle] = useState('');
  const [selectedAgents, setSelectedAgents] = useState(() => new Set());
  const [orchMode, setOrchMode] = useState('auto');
  const [creating, setCreating] = useState(false);
  const titleRef = useRef(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const toggleAgent = useCallback((agentId) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  }, []);

  const handleCreate = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      await onCreateRoom(
        title.trim() || 'New Room',
        [...selectedAgents],
        { orchestrationMode: orchMode },
      );
      onClose();
    } catch {
      // Error is handled by the hook
    } finally {
      setCreating(false);
    }
  }, [creating, title, selectedAgents, orchMode, onCreateRoom, onClose]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleCreate();
    }
  }, [onClose, handleCreate]);

  return (
    <div className="room-create-backdrop" onClick={onClose}>
      <div
        className="room-create-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-label="Create chat room"
      >
        <div className="room-create-header">
          <h3 className="room-create-title">New Chat Room</h3>
          <button
            type="button"
            className="room-create-close"
            onClick={onClose}
            aria-label="Cancel"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="room-create-body">
          <label className="room-create-label">
            Room Title
            <input
              ref={titleRef}
              type="text"
              className="room-create-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="New Room"
              maxLength={80}
            />
          </label>

          <div className="room-create-section">
            <span className="room-create-label">Agents</span>
            <div className="room-create-agent-grid">
              {agents.map((agent) => {
                const checked = selectedAgents.has(agent.id || agent._id);
                const agentId = agent.id || agent._id;
                return (
                  <label
                    key={agentId}
                    className={`room-create-agent-chip${checked ? ' is-selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAgent(agentId)}
                      className="room-create-agent-checkbox"
                    />
                    <AgentAvatar agent={agent} size={20} interactive={false} />
                    <span className="room-create-agent-name">{agent.name}</span>
                  </label>
                );
              })}
              {agents.length === 0 && (
                <span className="room-create-no-agents">No agents available</span>
              )}
            </div>
          </div>

          <label className="room-create-label">
            Orchestration Mode
            <select
              className="room-create-select"
              value={orchMode}
              onChange={(e) => setOrchMode(e.target.value)}
            >
              <option value="auto">Auto (server decides)</option>
              <option value="mentioned-only">Mentioned only (@agent)</option>
              <option value="all">All agents respond</option>
            </select>
          </label>
        </div>

        <div className="room-create-footer">
          <button
            type="button"
            className="room-create-cancel-btn"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="room-create-submit-btn"
            onClick={handleCreate}
            disabled={creating || selectedAgents.size === 0}
            title={selectedAgents.size === 0 ? 'Select at least one agent' : ''}
          >
            {creating ? 'Creating...' : 'Create Room'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading / Error states
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <div className="chat-room chat-room--loading">
      <div className="chat-room-loading-indicator">
        <span className="chat-room-streaming-dots">
          <span className="chat-room-dot" />
          <span className="chat-room-dot" />
          <span className="chat-room-dot" />
        </span>
        <span>Loading...</span>
      </div>
    </div>
  );
}

function ErrorState({ error, onRetry }) {
  return (
    <div className="chat-room chat-room--error">
      <div className="chat-room-error-card">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p className="chat-room-error-text">{typeof error === 'string' ? error : 'Something went wrong'}</p>
        {onRetry && (
          <button type="button" className="chat-room-error-retry" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Room List View
// ---------------------------------------------------------------------------

function RoomListView({ rooms, agents, loading, onCreateRoom, onDeleteRoom }) {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="chat-room chat-room--list">
      <div className="room-list-header">
        <h2 className="room-list-title">Chat Rooms</h2>
        <button
          type="button"
          className="room-list-create-btn"
          onClick={() => setShowCreate(true)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Room
        </button>
      </div>

      {loading && rooms.length === 0 ? (
        <div className="room-list-loading">
          <span className="chat-room-streaming-dots">
            <span className="chat-room-dot" />
            <span className="chat-room-dot" />
            <span className="chat-room-dot" />
          </span>
        </div>
      ) : rooms.length === 0 ? (
        <div className="room-list-empty">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          <p className="room-list-empty-text">No rooms yet. Create one to start collaborating with AI agents.</p>
        </div>
      ) : (
        <div className="room-list-grid">
          {rooms.map((room) => {
            const roomId = room._id || room.id;
            const roomAgents = (room.activeAgents || [])
              .map((id) => {
                if (typeof id === 'object') return id;
                return agents.find((a) => a.id === id || a._id === id);
              })
              .filter(Boolean);
            const messageCount = room.messageCount || room.messages?.length || 0;

            return (
              <a
                key={roomId}
                className="room-card"
                href={`#/rooms/${roomId}`}
                role="link"
                aria-label={`Open room: ${room.title || 'Untitled Room'}`}
              >
                <div className="room-card-top">
                  <h3 className="room-card-title">{room.title || 'Untitled Room'}</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="room-card-time">{relativeTime(room.updatedAt || room.createdAt)}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const label = room.title || 'Untitled Room';
                        if (window.confirm(`Delete room "${label}"? This cannot be undone.`)) {
                          onDeleteRoom?.(roomId);
                        }
                      }}
                      aria-label={`Delete room: ${room.title || 'Untitled Room'}`}
                      title="Delete room"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted, rgba(255,255,255,0.65))',
                        cursor: 'pointer',
                        padding: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    </button>
                  </div>
                </div>

                {room.lastMessagePreview && (
                  <p className="room-card-preview">
                    {room.lastMessagePreview.agentName
                      ? `${room.lastMessagePreview.agentName}: ${truncatePreview(room.lastMessagePreview.preview)}`
                      : truncatePreview(room.lastMessagePreview.preview || '')}
                  </p>
                )}

                <div className="room-card-footer">
                  <div className="room-card-avatars">
                    {roomAgents.slice(0, 4).map((agent) => (
                      <AgentAvatar key={agent.id || agent._id} agent={agent} size={20} interactive />
                    ))}
                    {roomAgents.length > 4 && (
                      <span className="room-card-avatar-overflow">+{roomAgents.length - 4}</span>
                    )}
                  </div>
                  {messageCount > 0 && (
                    <span className="room-card-badge">{messageCount}</span>
                  )}
                </div>
              </a>
            );
          })}
        </div>
      )}

      {showCreate && (
        <RoomCreateDialog
          agents={agents}
          onClose={() => setShowCreate(false)}
          onCreateRoom={onCreateRoom}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Room Settings Panel
// ---------------------------------------------------------------------------

function RoomSettingsPanel({ room, onClose }) {
  const roomId = room._id || room.id;
  const [reactionRounds, setReactionRounds] = useState(
    (room.settings?.maxRoundsPerTurn ?? 1) > 1,
  );
  const [orchMode, setOrchMode] = useState(
    room.settings?.orchestrationMode || 'auto',
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const resp = await fetch(`/api/rooms/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            maxRoundsPerTurn: reactionRounds ? 2 : 1,
            orchestrationMode: orchMode,
          },
        }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || 'Save failed');
      setSaved(true);
    } catch (err) {
      setSaveError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }, [saving, roomId, reactionRounds, orchMode]);

  return (
    <div
      className="chat-room-settings-panel"
      style={{
        position: 'absolute',
        top: '52px',
        right: '8px',
        zIndex: 100,
        background: 'var(--surface-elevated, #1e1e2e)',
        border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
        borderRadius: '10px',
        padding: '16px',
        minWidth: '280px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        color: 'var(--text-primary, #e2e8f0)',
        fontSize: '13px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <span style={{ fontWeight: 600, fontSize: '14px' }}>Room Settings</span>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: '2px 4px', lineHeight: 1 }}
          aria-label="Close settings"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Reaction Rounds */}
      <div style={{ marginBottom: '14px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={reactionRounds}
            onChange={(e) => setReactionRounds(e.target.checked)}
            style={{ width: '15px', height: '15px', cursor: 'pointer' }}
          />
          <span style={{ fontWeight: 500 }}>Reaction Rounds</span>
        </label>
        <p style={{ margin: '4px 0 0 25px', fontSize: '12px', opacity: 0.65, lineHeight: '1.4' }}>
          When on, agents may react to each other (~2x token usage)
        </p>
      </div>

      {/* Orchestration Mode */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontWeight: 500, marginBottom: '6px' }}>
          Orchestration Mode
        </label>
        <select
          className="room-create-select"
          value={orchMode}
          onChange={(e) => setOrchMode(e.target.value)}
          style={{ width: '100%' }}
        >
          <option value="auto">Auto (server decides)</option>
          <option value="mentioned-only">Mentioned only (@agent)</option>
          <option value="all">All agents respond</option>
        </select>
      </div>

      {saveError && (
        <p style={{ color: '#f87171', fontSize: '12px', marginBottom: '8px' }}>{saveError}</p>
      )}
      {saved && (
        <p style={{ color: '#34d399', fontSize: '12px', marginBottom: '8px' }}>Settings saved.</p>
      )}

      <button
        type="button"
        className="room-create-submit-btn"
        onClick={handleSave}
        disabled={saving}
        style={{ width: '100%' }}
      >
        {saving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  );
}

function RoomPresenceStrip({ activeAgents = [], agentPresence = {}, streamingAgents }) {
  const activeSet = streamingAgents instanceof Set ? streamingAgents : new Set(streamingAgents || []);

  return (
    <div className="chat-room-presence-strip">
      {activeAgents.map((agent) => {
        const agentId = agent.id || agent._id || agent.agentId;
        const presence = agentPresence?.[agentId] || {};
        const state = activeSet.has(agentId) ? 'responding' : (presence.state || 'idle');
        const note = presence.note || (state === 'idle' ? 'Listening' : state);

        return (
          <div key={agentId} className={`chat-room-presence-pill is-${state}`}>
            <AgentAvatar agent={agent} size={18} interactive={false} />
            <div className="chat-room-presence-copy">
              <span className="chat-room-presence-name">{agent.name || agentId}</span>
              <span className="chat-room-presence-note">{note}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RoomEventRail({ roomEvents = [] }) {
  if (!roomEvents.length) return null;
  return (
    <div className="chat-room-event-rail" aria-label="Room activity">
      {roomEvents.slice(0, 8).map((event) => (
        <div key={event.id} className={`chat-room-event-card is-${event.type}`}>
          <div className="chat-room-event-top">
            <span className="chat-room-event-title">{event.title}</span>
            <span className="chat-room-event-time">{formatEventTime(event.at)}</span>
          </div>
          <div className="chat-room-event-detail">{event.detail}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Room Chat View
// ---------------------------------------------------------------------------

function RoomChatView({
  room,
  messages,
  agents,
  activeAgents,
  error,
  agentErrors,
  roomEvents,
  agentPresence,
  streaming,
  streamingAgents,
  onSend,
  onAbort,
  onClearError,
  onDeleteRoom,
}) {
  const [showSettings, setShowSettings] = useState(false);
  const handleNudgeAgent = useCallback((agent) => {
    const agentId = agent?.id || agent?._id || agent?.agentId;
    if (!agentId || !onSend) return;
    onSend(`@${agentId} quick nudge: jump in if you have something to add to the conversation.`);
  }, [onSend]);

  const handleAvatarRefresh = useCallback((agent) => {
    const agentId = agent?.id || agent?._id || agent?.agentId;
    if (!agentId || !onSend) return;
    onSend(`@${agentId} if your avatar feels stale, use your avatar tools to create or find a fresh one and update your profile.`);
  }, [onSend]);
  const handleCopyTranscript = useCallback(async () => {
    if (!navigator?.clipboard?.writeText) return;
    const transcript = buildRoomTranscript(room, messages, agents);
    await navigator.clipboard.writeText(transcript);
  }, [room, messages, agents]);

  const handleNudgeAllAgents = useCallback(() => {
    const mentions = (activeAgents || [])
      .map((agent) => agent?.id || agent?._id || agent?.agentId)
      .filter(Boolean)
      .map((agentId) => `@${agentId}`)
      .join(' ');
    if (!mentions || !onSend) return;
    onSend(`${mentions} group nudge: this room is alive, so jump in when you have something worth adding.`);
  }, [activeAgents, onSend]);

  return (
    <div className="chat-room chat-room--active" style={{ position: 'relative' }}>
      {/* Header */}
      <div className="chat-room-header">
        <a
          href="#/rooms"
          className="chat-room-back-btn"
          aria-label="Back to room list"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </a>

        <h2 className="chat-room-title">{room.title || 'Untitled Room'}</h2>

        <div className="chat-room-header-agents">
          {activeAgents.map((agent) => (
            <AgentAvatar
              key={agent.id || agent._id}
              agent={agent}
              size={28}
              showName={false}
              interactive
              onNudge={handleNudgeAgent}
              onAvatarRefresh={handleAvatarRefresh}
            />
          ))}
        </div>

        <button
          type="button"
          className="chat-room-settings-btn"
          aria-label="Copy room transcript"
          onClick={handleCopyTranscript}
          title="Copy room transcript"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>

        <button
          type="button"
          className="chat-room-settings-btn"
          aria-label="Nudge all agents"
          onClick={handleNudgeAllAgents}
          title="Nudge all agents"
          disabled={!activeAgents.length}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
          </svg>
        </button>

        <button
          type="button"
          className="chat-room-settings-btn"
          aria-label="Room settings"
          onClick={() => setShowSettings((v) => !v)}
          title="Room settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <button
          type="button"
          className="chat-room-settings-btn"
          aria-label="Delete room"
          onClick={() => {
            const label = room.title || 'Untitled Room';
            if (window.confirm(`Delete room "${label}"? This cannot be undone.`)) {
              onDeleteRoom?.(room._id || room.id);
            }
          }}
          title="Delete room"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <RoomSettingsPanel room={room} onClose={() => setShowSettings(false)} />
      )}

      <RoomPresenceStrip
        activeAgents={activeAgents}
        agentPresence={agentPresence}
        streamingAgents={streamingAgents}
      />

      <RoomEventRail roomEvents={roomEvents} />

      {/* Error banner */}
      {error && (
        <div className="chat-room-error-banner">
          <span className="chat-room-error-banner-text">{error}</span>
          <button
            type="button"
            className="chat-room-error-dismiss"
            onClick={onClearError}
            aria-label="Dismiss error"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Thread */}
      <ChatRoomThread
        messages={messages}
        agents={agents}
        streamingAgents={streamingAgents}
        agentErrors={agentErrors}
        onNudgeAgent={handleNudgeAgent}
        onAvatarRefresh={handleAvatarRefresh}
      />

      {/* Composer */}
      <ChatRoomComposer
        onSend={onSend}
        onAbort={onAbort}
        streaming={streaming}
        agents={agents}
        disabled={false}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ChatRoom component
// ---------------------------------------------------------------------------

export default function ChatRoom({ roomId }) {
  const roomState = useChatRoom(roomId);
  const requestFlow = useChatRoomRequestFlow(roomId, roomState);

  const {
    room,
    messages,
    agents,
    activeAgents,
    loading,
    error,
    agentErrors,
    roomEvents,
    agentPresence,
    rooms,
    createNewRoom,
    deleteExistingRoom,
    clearError,
    refreshRoom,
  } = roomState;

  const {
    sendMessage,
    streaming,
    streamingAgents,
    abort,
  } = requestFlow;

  // Early returns for loading / fatal error
  if (loading && !room && !rooms.length) return <LoadingState />;
  if (error && !room && !rooms.length) {
    return <ErrorState error={error} onRetry={refreshRoom} />;
  }

  // List mode — no roomId selected
  if (!roomId) {
    return (
      <RoomListView
        rooms={rooms}
        agents={agents}
        loading={loading}
        onCreateRoom={createNewRoom}
        onDeleteRoom={deleteExistingRoom}
      />
    );
  }

  // Room mode — specific room selected
  if (!room && !loading) {
    return <ErrorState error="Room not found" onRetry={refreshRoom} />;
  }

  if (!room) return <LoadingState />;

  return (
    <RoomChatView
      room={room}
      messages={messages}
      agents={agents}
      activeAgents={activeAgents}
      error={error}
      agentErrors={agentErrors}
      roomEvents={roomEvents}
      agentPresence={agentPresence}
      streaming={streaming}
      streamingAgents={streamingAgents}
      onSend={sendMessage}
      onAbort={abort}
      onClearError={clearError}
      onDeleteRoom={deleteExistingRoom}
    />
  );
}
