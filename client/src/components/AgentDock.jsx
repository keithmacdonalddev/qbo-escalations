import './AgentDock.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderMarkdown } from '../utils/markdown.jsx';
import { catalogSupportsThinking, getProviderShortLabel } from '../lib/providerCatalog.js';
import WorkspaceAgentPanel from './WorkspaceAgentPanel.jsx';
import CopilotPanel from './CopilotPanel.jsx';

const TAB_OPTIONS = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'chat', label: 'Chat' },
  { id: 'copilot', label: 'Co-pilot' },
];
const TAB_IDS = TAB_OPTIONS.map((tab) => tab.id);

function normalizeTabId(tabId, fallback = 'workspace') {
  return TAB_IDS.includes(tabId) ? tabId : fallback;
}

function formatProcessEventTime(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatTokenEstimate(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

/* SVG icons for empty states and buttons */
const TerminalIcon = () => (
  <svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

const ChatBubbleIcon = () => (
  <svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const SendArrowIcon = ({ size = 16 }) => (
  <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const StopSquareIcon = () => (
  <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
);

const SUGGESTION_CHIPS = {
  'Main Chat': [
    'Summarize this escalation',
    'Draft a customer response',
    'Check policy guidelines',
  ],
};

const EMPTY_STATE_MAP = {
  'Main Chat': {
    icon: <ChatBubbleIcon />,
    title: 'Main Chat',
    desc: 'Continue your conversation from here.',
  },
};

function CompactConversationPane({
  title,
  badge,
  messages,
  streamingText,
  thinkingText,
  parallelStreaming,
  isParallelMode,
  isStreaming,
  processEvents,
  onClearProcessEvents,
  contextDebug,
  error,
  errorDetails,
  providerId,
  onSend,
  onAbort,
  emptyText,
  liveMonitorMode = false,
  showCompose = true,
}) {
  const [input, setInput] = useState('');
  const textareaRef = useRef(null);
  const messagesEndRef = useRef(null);

  const handleSubmit = useCallback((e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isStreaming) return;
    onSend?.(text);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, isStreaming, onSend]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleInput = useCallback((e) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, thinkingText]);

  const visibleMessages = useMemo(() => (
    Array.isArray(messages) ? messages.slice(-14) : []
  ), [messages]);
  const savedReasoningEntries = useMemo(() => (
    Array.isArray(messages)
      ? messages
        .filter((msg) => msg?.role === 'assistant' && typeof msg.thinking === 'string' && msg.thinking.trim())
        .slice(-6)
      : []
  ), [messages]);
  const recentProcessEvents = useMemo(() => (
    Array.isArray(processEvents) ? processEvents.slice(-10).reverse() : []
  ), [processEvents]);
  const liveParallelEntries = useMemo(() => (
    Object.entries(parallelStreaming || {}).filter(([, text]) => Boolean(text))
  ), [parallelStreaming]);
  const hasReasoningContent = Boolean(String(thinkingText || '').trim());
  const hasConversationHistory = visibleMessages.length > 0;
  const hasSavedReasoning = savedReasoningEntries.length > 0;
  const showSavedReasoning = liveMonitorMode && !isStreaming && !hasReasoningContent && hasSavedReasoning;
  const providerSupportsThinking = catalogSupportsThinking(providerId);
  const latestProcessEvent = recentProcessEvents[0] || null;
  const reasoningStatusText = hasReasoningContent
    ? ''
    : error
      ? 'The request ended before live reasoning could be completed.'
      : isStreaming
        ? providerSupportsThinking
          ? `Waiting for live reasoning from ${getProviderShortLabel(providerId)}.`
          : `${getProviderShortLabel(providerId)} does not expose live reasoning.`
        : hasSavedReasoning
          ? 'Showing the saved reasoning trace from the latest completed response.'
          : hasConversationHistory
            ? 'No reasoning trace was saved for the latest run.'
            : 'Reasoning appears here when the model sends it.';

  const emptyInfo = EMPTY_STATE_MAP[title] || {
    icon: <ChatBubbleIcon />,
    title: title || 'Chat',
    desc: emptyText || 'Send a message to get started.',
  };

  const chips = liveMonitorMode ? [] : (SUGGESTION_CHIPS[title] || []);
  const canSend = input.trim() && !isStreaming;

  const liveMonitorStatus = liveMonitorMode ? (
    <>
      <div className="compact-pane-status-card">
        <div className="compact-pane-status-head">
          <span>Live Chat Monitor</span>
          <span
            className={`compact-pane-status-pill${isStreaming ? ' is-live' : error ? ' is-error' : ''}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {error ? 'Attention' : isStreaming ? 'Live' : 'Idle'}
          </span>
        </div>
        <div className="compact-pane-status-body">
          {error
            ? (errorDetails?.message || error)
            : latestProcessEvent?.message
              ? latestProcessEvent.message
              : isStreaming
                ? 'Main chat is running.'
                : 'No active main chat request.'}
        </div>
        {contextDebug?.budgets && (
          <div className="compact-pane-status-meta">
            <span>Context {contextDebug.knowledgeMode || 'hybrid'}</span>
            <span>{formatTokenEstimate(contextDebug.budgets.estimatedInputTokens)} est input tokens</span>
            <span>S {formatTokenEstimate(contextDebug.budgets.systemChars / 4)}</span>
            <span>H {formatTokenEstimate(contextDebug.budgets.historyChars / 4)}</span>
            <span>R {formatTokenEstimate(contextDebug.budgets.retrievalChars / 4)}</span>
          </div>
        )}
        {errorDetails?.code && (
          <div className="compact-pane-status-meta">
            <span className="compact-pane-status-code">{errorDetails.code}</span>
          </div>
        )}
      </div>

      <div className="compact-pane-section">
        <div className="compact-pane-section-head">
          <span>Request Activity</span>
          {recentProcessEvents.length > 0 && onClearProcessEvents ? (
            <button type="button" className="compact-pane-section-clear" onClick={onClearProcessEvents}>
              Clear
            </button>
          ) : null}
        </div>
        {recentProcessEvents.length > 0 ? (
          <div className="compact-pane-process-feed">
            {recentProcessEvents.map((event) => (
              <div key={event.id} className={`compact-pane-process-item is-${event.level || 'info'}`}>
                <div className="compact-pane-process-title">
                  <strong>{event.title || 'Event'}</strong>
                  <span>{formatProcessEventTime(event.at)}</span>
                </div>
                {event.message ? (
                  <div className="compact-pane-process-message">{event.message}</div>
                ) : null}
                {(event.code || event.provider || Number.isFinite(event.latencyMs)) && (
                  <div className="compact-pane-process-meta">
                    {event.code ? <span className="compact-pane-status-code">{event.code}</span> : null}
                    {event.provider ? <span>{getProviderShortLabel(event.provider)}</span> : null}
                    {Number.isFinite(event.latencyMs) ? <span>{event.latencyMs}ms</span> : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="compact-pane-live-empty">
            No active or recent request activity for the main chat.
          </div>
        )}
      </div>
    </>
  ) : null;

  return (
    <div className={`compact-pane${liveMonitorMode ? ' compact-pane--live-monitor' : ''}`}>
      {/* Messages */}
      <div className="compact-pane-messages">
        {!liveMonitorMode && visibleMessages.length === 0 && !isStreaming ? (
          <div className="compact-pane-empty">
            <div className="compact-pane-empty-icon">{emptyInfo.icon}</div>
            <div className="compact-pane-empty-title">{emptyInfo.title}</div>
            <div className="compact-pane-empty-desc">{emptyInfo.desc}</div>
            {chips.length > 0 && (
              <div className="compact-pane-chips">
                {chips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="compact-pane-chip"
                    onClick={() => { onSend?.(chip); }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <div className="compact-pane-messages-inner">
          {!liveMonitorMode ? (
            <>
              {visibleMessages.map((msg, index) => {
                const isUser = msg.role === 'user';
                return (
                  <div
                    key={`${msg.role}-${index}`}
                    className={`compact-pane-msg compact-pane-msg--${isUser ? 'user' : 'assistant'}`}
                  >
                    {!isUser && (
                      <div className="compact-pane-msg-label">
                        {title === 'Main Chat' ? 'Claude' : 'Assistant'}
                      </div>
                    )}
                    <div className={`compact-pane-msg-body${isUser ? ' compact-pane-msg-bubble' : ''}`}>
                      {renderMarkdown(msg.content || '')}
                    </div>
                  </div>
                );
              })}
            </>
          ) : liveMonitorStatus}

          {thinkingText ? (
            <div className="compact-pane-thinking">
              <div className="compact-pane-thinking-label">Reasoning</div>
              <div className="compact-pane-thinking-content">{thinkingText}</div>
            </div>
          ) : null}

          {showSavedReasoning ? (
            <div className="compact-pane-thinking">
              <div className="compact-pane-thinking-label">Saved Reasoning</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                {savedReasoningEntries.map((msg, index) => (
                  <div
                    key={`${msg.timestamp || 'saved'}-${msg.provider || 'assistant'}-${index}`}
                    className="compact-pane-thinking-content"
                  >
                    {savedReasoningEntries.length > 1 ? (
                      <strong style={{ display: 'block', marginBottom: 'var(--sp-1)' }}>
                        {msg.provider ? getProviderShortLabel(msg.provider) : 'Assistant'}
                      </strong>
                    ) : null}
                    {msg.thinking}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {liveMonitorMode && !thinkingText && !showSavedReasoning ? (
            <div className="compact-pane-thinking">
              <div className="compact-pane-thinking-label">Reasoning</div>
              <div className="compact-pane-thinking-content">{reasoningStatusText}</div>
            </div>
          ) : null}

          {!liveMonitorMode && isParallelMode && liveParallelEntries.length > 0 ? (
            <div className="compact-pane-thinking">
              <div className="compact-pane-thinking-label">Live Provider Output</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                {liveParallelEntries.map(([providerId, text]) => (
                  <div key={providerId} className="compact-pane-thinking-content">
                    <strong style={{ display: 'block', marginBottom: 'var(--sp-1)' }}>
                      {getProviderShortLabel(providerId)}
                    </strong>
                    {text}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {!liveMonitorMode && streamingText ? (
            <div className="compact-pane-msg compact-pane-msg--assistant">
              <div className="compact-pane-msg-label">
                {title === 'Main Chat' ? 'Claude' : 'Assistant'}
              </div>
              <div className="compact-pane-msg-body compact-pane-msg--streaming">
                {renderMarkdown(streamingText || '')}
                <span className="streaming-cursor" />
              </div>
            </div>
          ) : null}
        </div>

        <div ref={messagesEndRef} />
      </div>

      {/* Compose area — Claude-style */}
      {showCompose ? (
        <div className="compact-pane-compose-area">
          <form onSubmit={handleSubmit} className="compact-pane-compose">
            <textarea
              ref={textareaRef}
              className="compact-pane-compose-textarea"
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${title}...`}
              disabled={isStreaming}
              rows={1}
              aria-label={`Message ${title}`}
            />
            <div className="compact-pane-compose-footer">
              {badge ? <span className="compact-pane-badge">{badge}</span> : <span />}
              {isStreaming ? (
                <button
                  type="button"
                  className="compact-pane-compose-send compact-pane-compose-send--stop"
                  onClick={onAbort}
                  aria-label="Stop generation"
                >
                  <StopSquareIcon />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!canSend}
                  className={`compact-pane-compose-send${canSend ? ' compact-pane-compose-send--active' : ''}`}
                  aria-label="Send message"
                >
                  <SendArrowIcon size={14} />
                </button>
              )}
            </div>
          </form>
        </div>
      ) : (
        <div className="compact-pane-compose-area compact-pane-compose-area--monitor">
          <div className="compact-pane-monitor-footer">
            {badge ? <span className="compact-pane-badge">{badge}</span> : <span />}
            {isStreaming ? (
              <button
                type="button"
                className="compact-pane-compose-send compact-pane-compose-send--stop"
                onClick={onAbort}
                aria-label="Stop generation"
              >
                <StopSquareIcon />
              </button>
            ) : (
              <span className="compact-pane-monitor-hint">Compose in the main chat</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const DOCK_MIN = 280;
const DOCK_MAX = 500;
const DOCK_DEFAULT = 380;
const DOCK_WIDTH_KEY = 'agent-dock-width';

function clampWidth(w) {
  return Math.min(DOCK_MAX, Math.max(DOCK_MIN, w));
}

export default function AgentDock({
  chat,
  viewContext,
  defaultTab = 'workspace',
  activeTab: controlledActiveTab,
  onActiveTabChange,
  hideTabs = false,
  onClose,
}) {
  const [internalActiveTab, setInternalActiveTab] = useState(() => normalizeTabId(defaultTab));
  const activeTab = normalizeTabId(controlledActiveTab || internalActiveTab, normalizeTabId(defaultTab));
  const setActiveTab = useCallback((nextTab) => {
    const normalizedTab = normalizeTabId(nextTab, normalizeTabId(defaultTab));
    if (controlledActiveTab === undefined) {
      setInternalActiveTab(normalizedTab);
    }
    onActiveTabChange?.(normalizedTab);
  }, [controlledActiveTab, defaultTab, onActiveTabChange]);

  useEffect(() => {
    if (controlledActiveTab === undefined) {
      setInternalActiveTab(normalizeTabId(defaultTab));
    }
  }, [controlledActiveTab, defaultTab]);

  // --- Resizable panel ---
  const dockRef = useRef(null);
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(DOCK_WIDTH_KEY);
      return saved ? clampWidth(parseInt(saved, 10)) : DOCK_DEFAULT;
    } catch { return DOCK_DEFAULT; }
  });
  const [isDragging, setIsDragging] = useState(false);
  const widthRef = useRef(panelWidth);

  // Keep widthRef in sync for the mouseup closure
  useEffect(() => { widthRef.current = panelWidth; }, [panelWidth]);

  // Apply width to the parent wrapper element via CSS custom property
  useEffect(() => {
    const wrapper = dockRef.current?.closest('.gmail-agent-dock-wrapper');
    if (wrapper) {
      wrapper.style.setProperty('--agent-dock-width', `${panelWidth}px`);
    }
  }, [panelWidth]);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  // Double-click resets to default width
  const handleDoubleClick = useCallback(() => {
    setPanelWidth(DOCK_DEFAULT);
    try { localStorage.setItem(DOCK_WIDTH_KEY, String(DOCK_DEFAULT)); } catch {}
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      const newWidth = clampWidth(window.innerWidth - e.clientX);
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      try { localStorage.setItem(DOCK_WIDTH_KEY, String(widthRef.current)); } catch {}
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isDragging]);

  const chatBadge = useMemo(() => {
    if (!chat) return null;
    const label = getProviderShortLabel(chat.streamProvider || chat.provider);
    return chat.isStreaming ? `${label} · live` : label;
  }, [chat]);
  const chatTabUsesLiveMonitor = viewContext?.view === 'chat';

  return (
    <div className="agent-dock" ref={dockRef} role="region" aria-label="Agent dock panel">
      <h2 className="sr-only">Agent Panel</h2>
      <div
        className={`agent-dock-resize-handle${isDragging ? ' is-dragging' : ''}`}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      />
      {!hideTabs ? (
        <div className="agent-dock-tabs" role="tablist" aria-label="Agent dock tabs">
          {TAB_OPTIONS.map((tab) => (
            <button
              key={tab.id}
              id={`dock-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`dock-tabpanel-${tab.id}`}
              className={`agent-dock-tab${activeTab === tab.id ? ' is-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
          <div className="agent-dock-tabs-right">
            {onClose ? (
              <button
                type="button"
                className="agent-dock-close"
                onClick={onClose}
                aria-label="Close agent dock"
              >
                <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="agent-dock-body">
        <div
          role="tabpanel"
          id="dock-tabpanel-workspace"
          aria-labelledby="dock-tab-workspace"
          hidden={activeTab !== 'workspace'}
        >
          {activeTab === 'workspace' ? (
            <WorkspaceAgentPanel
              open
              embedded
              onToggle={onClose || (() => {})}
              viewContext={viewContext}
            />
          ) : null}
        </div>

        <div
          role="tabpanel"
          id="dock-tabpanel-chat"
          aria-labelledby="dock-tab-chat"
          hidden={activeTab !== 'chat'}
        >
          {activeTab === 'chat' && chat ? (
            <CompactConversationPane
              title="Main Chat"
              badge={chatBadge}
              messages={chat.messages || []}
              streamingText={chat.streamingText || ''}
              thinkingText={chat.thinkingText || ''}
              parallelStreaming={chat.parallelStreaming || {}}
              isParallelMode={chat.mode === 'parallel'}
              isStreaming={chat.isStreaming === true}
              processEvents={chat.processEvents || []}
              onClearProcessEvents={chat.clearProcessEvents}
              contextDebug={chat.contextDebug || null}
              error={chat.error || ''}
              errorDetails={chat.errorDetails || null}
              providerId={chat.streamProvider || chat.provider}
              onSend={(text) => chat.sendMessage(text)}
              onAbort={chat.abortStream}
              emptyText="Continue your current main chat from here."
              liveMonitorMode={chatTabUsesLiveMonitor}
              showCompose={!chatTabUsesLiveMonitor}
            />
          ) : null}
        </div>

        <div
          role="tabpanel"
          id="dock-tabpanel-copilot"
          aria-labelledby="dock-tab-copilot"
          hidden={activeTab !== 'copilot'}
        >
          {activeTab === 'copilot' ? (
            <CopilotPanel title="Global Co-pilot" />
          ) : null}
        </div>
      </div>
    </div>
  );
}
