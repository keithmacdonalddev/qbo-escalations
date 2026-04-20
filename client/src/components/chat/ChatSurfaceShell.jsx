import { useState } from 'react';
import AgentDock from '../AgentDock.jsx';
import TraceLogsDrawer from './TraceLogsDrawer.jsx';

const AGENT_SURFACE_TABS = [
  { id: 'chat', label: 'Chat' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'copilot', label: 'Co-pilot' },
];

function TabStrip({ surfaceTab, onSurfaceTabChange }) {
  return (
    <div className="compose-card-header-row">
      <div className="compose-card-tab-row">
        <div className="compose-card-tab-strip" role="tablist" aria-label="Compose mode">
          {AGENT_SURFACE_TABS.map((tab) => (
            <button
              key={tab.id}
              id={`surface-tab-${tab.id}`}
              className={`compose-card-tab${surfaceTab === tab.id ? ' is-active' : ''}`}
              onClick={() => onSurfaceTabChange(tab.id)}
              type="button"
              role="tab"
              aria-selected={surfaceTab === tab.id}
              aria-controls={`surface-tabpanel-${tab.id}`}
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
  onCopyConversation,
  threadContent,
  composeArea,
  children,
}) {
  const hasConversation = messages.length > 1 && !isStreaming && conversationId;
  const [traceDrawerOpen, setTraceDrawerOpen] = useState(false);

  // Support both split props (threadContent + composeArea) and legacy children
  const thread = threadContent || null;
  const compose = composeArea || null;
  const legacyChildren = (!threadContent && !composeArea) ? children : null;

  if (surfaceTab === 'chat') {
    return (
      <div role="tabpanel" id="surface-tabpanel-chat" aria-labelledby="surface-tab-chat" className="chat-input-area">
        <h2 className="sr-only">Chat</h2>
        <div className="chat-action-row">
          <button
            className="copy-btn"
            onClick={onStartFreshConversation}
            type="button"
            title="Start a new conversation"
          >
            New Chat
          </button>
          <button
            className="copy-btn"
            onClick={onRetryLastResponse}
            type="button"
            disabled={!canRetryLastResponse}
          >
            Retry Last Response
          </button>
          <button
            className="copy-btn"
            onClick={() => setTraceDrawerOpen(true)}
            type="button"
            title="View trace logs for this conversation"
            disabled={!hasConversation}
          >
            View Trace Logs
          </button>
          <button
            className={`copy-btn${exportCopied ? ' is-copied' : ''}`}
            onClick={onCopyConversation}
            type="button"
            disabled={!hasConversation}
          >
            {exportCopied ? 'Copied to clipboard' : 'Copy full conversation'}
          </button>
        </div>

        {legacyChildren || (
          <>
            {thread}
            <TabStrip surfaceTab={surfaceTab} onSurfaceTabChange={onSurfaceTabChange} />
            {compose}
          </>
        )}

        <TraceLogsDrawer
          conversationId={conversationId}
          open={traceDrawerOpen}
          onClose={() => setTraceDrawerOpen(false)}
        />
      </div>
    );
  }

  // workspace and copilot delegate to AgentDock
  return (
    <div
      role="tabpanel"
      id={`surface-tabpanel-${surfaceTab}`}
      aria-labelledby={`surface-tab-${surfaceTab}`}
      className="chat-input-area"
    >
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
