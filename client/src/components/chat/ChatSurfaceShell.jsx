import { useState } from 'react';
import TraceLogsDrawer from './TraceLogsDrawer.jsx';

export default function ChatSurfaceShell({
  conversationId,
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

  const thread = threadContent || null;
  const compose = composeArea || null;
  const legacyChildren = (!threadContent && !composeArea) ? children : null;

  return (
    <div className="chat-input-area">
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
