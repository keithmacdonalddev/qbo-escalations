import AgentDock from '../AgentDock.jsx';

const AGENT_SURFACE_TABS = [
  { id: 'chat', label: 'Chat' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'copilot', label: 'Co-pilot' },
];

function TabStrip({ surfaceTab, onSurfaceTabChange }) {
  return (
    <div className="compose-card-header-row">
      <div className="compose-card-tab-row">
        <div className="compose-card-tab-strip" role="tablist" aria-label="Agent tabs">
          {AGENT_SURFACE_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`compose-card-tab${surfaceTab === tab.id ? ' is-active' : ''}`}
              onClick={() => onSurfaceTabChange(tab.id)}
              type="button"
              role="tab"
              aria-selected={surfaceTab === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ChatSurfaceShell({
  chat,
  surfaceTab,
  onSurfaceTabChange,
  conversationId,
  conversationIdFromRoute,
  messages,
  isStreaming,
  canRetryLastResponse,
  exportCopied,
  onStartFreshConversation,
  onRetryLastResponse,
  onOpenTraceLogs,
  onCopyConversation,
  threadContent,
  composeArea,
  children,
}) {
  const showActionRow = messages.length > 1 && !isStreaming && conversationId;

  // Support both split props (threadContent + composeArea) and legacy children
  const thread = threadContent || null;
  const compose = composeArea || null;
  const legacyChildren = (!threadContent && !composeArea) ? children : null;

  if (surfaceTab === 'chat') {
    return (
      <>
        {showActionRow && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-2)', padding: '0 var(--sp-2)' }}>
            <button
              className="copy-btn"
              onClick={onStartFreshConversation}
              type="button"
              title="Start a new conversation"
            >
              New Chat
            </button>
            {canRetryLastResponse && (
              <button
                className="copy-btn"
                onClick={onRetryLastResponse}
                type="button"
              >
                Retry Last Response
              </button>
            )}
            <button
              className="copy-btn"
              onClick={onOpenTraceLogs}
              type="button"
              title="Open full trace logs and timings for this conversation"
            >
              View Trace Logs
            </button>
            <button
              className={`copy-btn${exportCopied ? ' is-copied' : ''}`}
              onClick={onCopyConversation}
              type="button"
            >
              {exportCopied ? 'Copied to clipboard' : 'Copy full conversation'}
            </button>
          </div>
        )}

        {legacyChildren || (
          <>
            {thread}
            <TabStrip surfaceTab={surfaceTab} onSurfaceTabChange={onSurfaceTabChange} />
            {compose}
          </>
        )}
      </>
    );
  }

  // workspace and copilot delegate to AgentDock
  return (
    <div className="chat-input-area">
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <AgentDock
          chat={chat}
          activeTab={surfaceTab}
          onActiveTabChange={onSurfaceTabChange}
          hideTabs
          viewContext={{ view: 'chat', conversationId: conversationId || conversationIdFromRoute || null }}
        />
      </div>
      <TabStrip surfaceTab={surfaceTab} onSurfaceTabChange={onSurfaceTabChange} />
      <div className="compose-card-shell">
        <div className="compose-card" />
      </div>
    </div>
  );
}
