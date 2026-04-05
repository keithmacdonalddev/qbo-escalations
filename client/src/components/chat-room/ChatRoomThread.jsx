import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import AgentAvatar from './AgentAvatar.jsx';
import { normalizeRoomActionGroups } from '../../lib/roomActionGroups.js';

const SCROLL_THRESHOLD = 100;

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getAgent(agents, agentId) {
  if (!agents || !agentId) return null;
  return agents.find((a) => a.id === agentId) || null;
}

function getActionStatus(result) {
  return result?.status || (result?.error ? 'error' : (result?.result !== undefined ? 'success' : 'unknown'));
}

/**
 * Group consecutive agent messages together so we can show a single
 * avatar + name header for a run of messages from the same agent.
 */
function groupMessages(messages) {
  const groups = [];
  let current = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const isAgent = msg.role === 'agent' || msg.role === 'assistant';
    const agentId = msg.agentId || msg.agent || null;

    if (isAgent && current && current.agentId === agentId) {
      current.messages.push(msg);
    } else {
      current = {
        key: msg._id || msg.id || `grp-${i}`,
        role: msg.role,
        agentId: isAgent ? agentId : null,
        messages: [msg],
      };
      groups.push(current);
    }
  }

  return groups;
}

function StreamingDots() {
  return (
    <span className="chat-room-streaming-dots" aria-label="Agent is typing">
      <span className="chat-room-dot" />
      <span className="chat-room-dot" />
      <span className="chat-room-dot" />
    </span>
  );
}

function ThinkingBlock({ thinking }) {
  const [open, setOpen] = useState(false);

  if (!thinking) return null;

  return (
    <details
      className="chat-room-thinking"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="chat-room-thinking-toggle">Thinking</summary>
      <div className="chat-room-thinking-content">{thinking}</div>
    </details>
  );
}

function ChatRoomThread({
  messages = [],
  agents = [],
  streamingAgents,
  agentErrors,
  onScrollToBottom,
  onNudgeAgent,
  onAvatarRefresh,
}) {
  const scrollRef = useRef(null);
  const endRef = useRef(null);
  const shouldAutoScroll = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScroll.current = distanceFromBottom <= SCROLL_THRESHOLD;
  }, []);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (shouldAutoScroll.current && endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
      if (onScrollToBottom) onScrollToBottom();
    }
  }, [messages, messages.length, onScrollToBottom]);

  const grouped = useMemo(() => groupMessages(messages), [messages]);

  // Determine which agents are currently streaming but don't yet have a
  // message in the current batch (show a standalone streaming indicator)
  const streamingSet = useMemo(() => {
    if (!streamingAgents) return new Set();
    return streamingAgents instanceof Set ? streamingAgents : new Set(streamingAgents);
  }, [streamingAgents]);

  // Agents that are streaming but whose last message in `messages` is already
  // present get an inline indicator. Agents streaming with no messages yet
  // get a standalone bubble at the bottom.
  const standaloneStreamingAgents = useMemo(() => {
    if (streamingSet.size === 0) return [];
    const agentsWithMessages = new Set();
    for (let i = messages.length - 1; i >= 0; i--) {
      const id = messages[i].agentId || messages[i].agent;
      if (id) agentsWithMessages.add(id);
    }
    return [...streamingSet].filter((id) => !agentsWithMessages.has(id));
  }, [streamingSet, messages]);

  if (messages.length === 0 && streamingSet.size === 0) {
    return (
      <div className="chat-room-thread">
        <div className="chat-room-empty">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            <line x1="9" y1="9" x2="15" y2="9" opacity="0.5" />
            <line x1="9" y1="12" x2="13" y2="12" opacity="0.5" />
          </svg>
          <div className="chat-room-empty-title">No messages yet</div>
          <div className="chat-room-empty-desc">Start the conversation!</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="chat-room-thread"
      ref={scrollRef}
      onScroll={handleScroll}
      role="log"
      aria-label="Chat room messages"
      aria-live="polite"
    >
      {grouped.map((group) => {
        const isUser = group.role === 'user';
        const agent = !isUser ? getAgent(agents, group.agentId) : null;
        const firstMsg = group.messages[0];
        const isGroupStreaming = !isUser && group.agentId && streamingSet.has(group.agentId);

        return (
          <div
            key={group.key}
            className={`chat-room-message-group${isUser ? ' is-user' : ' is-agent'}`}
            data-agent-id={group.agentId || undefined}
          >
            {/* Header: avatar + name + provider + timestamp */}
            <div className="chat-room-message-header">
              {isUser ? (
                <span className="chat-room-sender-label">You</span>
              ) : (
                <>
                  {agent && (
                    <AgentAvatar
                      agent={agent}
                      size={28}
                      interactive
                      onNudge={onNudgeAgent}
                      onAvatarRefresh={onAvatarRefresh}
                    />
                  )}
                  <span className="chat-room-sender-label">
                    {agent?.name || group.agentId || 'Agent'}
                  </span>
                  {firstMsg.provider && (
                    <span className="chat-room-provider-badge">{firstMsg.provider}</span>
                  )}
                </>
              )}
              <span className="chat-room-timestamp">
                {formatTimestamp(firstMsg.timestamp || firstMsg.createdAt)}
              </span>
            </div>

            {/* Message bodies */}
            {group.messages.map((msg, idx) => {
              const actionGroups = normalizeRoomActionGroups(msg._actions || msg.actions, msg.iterations);
              return (
                <div key={msg._id || msg.id || `msg-${idx}`} className="chat-room-message-body">
                  {msg.thinking && <ThinkingBlock thinking={msg.thinking} />}
                  <div className="chat-room-message-content">{msg.content}</div>

                  {/* Collapsible action results (streaming _actions or finalized actions) */}
                  {actionGroups.length > 0 && (
                    <details className="room-message-actions">
                      <summary>
                        Actions ({actionGroups.reduce((sum, groupEntry) => sum + (groupEntry.results?.length || 0), 0)} executed)
                      </summary>
                      <div className="room-message-actions-list">
                        {actionGroups.map((actionGroup, gi) => (
                          actionGroup.results?.map((result, ri) => {
                            const status = getActionStatus(result);
                            return (
                              <div key={`${gi}-${ri}`} className="room-action-result">
                                <span className={`action-status ${status}`}>
                                  {status === 'success' ? '\u2713' : status === 'error' ? '\u2717' : '?'}
                                </span>
                                <span className="action-tool">{result.tool || result.action}</span>
                                {result.error && <span className="action-error">{result.error}</span>}
                              </div>
                            );
                          })
                        ))}
                      </div>
                    </details>
                  )}

                  {/* Ephemeral status indicator during streaming */}
                  {msg._streaming && msg._status && (
                    <div className="room-message-status">
                      {msg._status.message}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Inline streaming indicator for this agent */}
            {isGroupStreaming && <StreamingDots />}
          </div>
        );
      })}

      {/* Standalone streaming indicators for agents with no messages yet */}
      {standaloneStreamingAgents.map((agentId) => {
        const agent = getAgent(agents, agentId);
        return (
          <div key={`streaming-${agentId}`} className="chat-room-message-group is-agent">
            <div className="chat-room-message-header">
              {agent && (
                <AgentAvatar
                  agent={agent}
                  size={28}
                  interactive
                  onNudge={onNudgeAgent}
                  onAvatarRefresh={onAvatarRefresh}
                />
              )}
              <span className="chat-room-sender-label">
                {agent?.name || agentId}
              </span>
            </div>
            <StreamingDots />
          </div>
        );
      })}

      {/* Per-agent error indicators */}
      {agentErrors && Object.keys(agentErrors).length > 0 &&
        Object.entries(agentErrors).map(([agentId, errorMsg]) => {
          const agent = getAgent(agents, agentId);
          return (
            <div key={`error-${agentId}`} className="chat-room-message-group is-agent agent-error-group">
              <div className="chat-room-message-header">
                {agent && (
                  <AgentAvatar
                    agent={agent}
                    size={28}
                    interactive
                    onNudge={onNudgeAgent}
                    onAvatarRefresh={onAvatarRefresh}
                  />
                )}
                <span className="chat-room-sender-label">
                  {agent?.name || agentId}
                </span>
              </div>
              <div className="chat-room-message-body">
                <div className="chat-room-message-content agent-error-content">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="agent-error-icon">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{errorMsg}</span>
                </div>
              </div>
            </div>
          );
        })
      }

      <div ref={endRef} />
    </div>
  );
}

export default React.memo(ChatRoomThread);
