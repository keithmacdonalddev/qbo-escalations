import { AnimatePresence, motion } from 'framer-motion';

function formatTimeAgo(dateStr) {
  try {
    const ms = Date.now() - new Date(dateStr).getTime();
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return 'Just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export default function WorkspaceHistoryDrawer({
  open = false,
  workspaceSessionId = null,
  historyItems = [],
  historyLoading = false,
  onStartNewConversation,
  onLoadConversation,
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="workspace-history-overlay"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.18 }}
        >
          <div className="workspace-history-list">
            <button
              className="workspace-history-item workspace-history-new"
              type="button"
              onClick={onStartNewConversation}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>New conversation</span>
            </button>
            {historyLoading ? (
              <div className="workspace-history-loading">Loading...</div>
            ) : historyItems.length === 0 ? (
              <div className="workspace-history-empty">No past conversations</div>
            ) : (
              historyItems.map((conv) => {
                const isActive = conv.sessionId === workspaceSessionId;
                const lastMsg = conv.messages?.[0];
                const preview = lastMsg?.content
                  ? (lastMsg.content.length > 60 ? `${lastMsg.content.slice(0, 60)}...` : lastMsg.content)
                  : 'Empty conversation';
                const timeAgo = formatTimeAgo(conv.updatedAt);
                return (
                  <button
                    key={conv.sessionId}
                    className={`workspace-history-item${isActive ? ' is-active' : ''}`}
                    type="button"
                    onClick={() => !isActive && onLoadConversation?.(conv.sessionId)}
                    title={preview}
                  >
                    <span className="workspace-history-time">{timeAgo}</span>
                    <span className="workspace-history-preview">{preview}</span>
                  </button>
                );
              })
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
