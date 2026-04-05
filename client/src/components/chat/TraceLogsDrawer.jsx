import { useEffect, useState, useCallback } from 'react';
import { getConversationTraces } from '../../api/traceApi.js';

export default function TraceLogsDrawer({ conversationId, open, onClose }) {
  const [traces, setTraces] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !conversationId) return;
    setLoading(true);
    getConversationTraces(conversationId)
      .then(setTraces)
      .catch(() => setTraces([]))
      .finally(() => setLoading(false));
  }, [open, conversationId]);

  // Close on Escape key
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className="trace-drawer-overlay" onClick={onClose}>
      <div
        className="trace-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Trace Logs"
        aria-modal="true"
      >
        <div className="trace-drawer-head">
          <h3>Trace Logs</h3>
          <button type="button" onClick={onClose} aria-label="Close trace logs">
            <svg
              aria-hidden="true"
              focusable="false"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="trace-drawer-body">
          {loading && (
            <div className="trace-drawer-loading">Loading traces...</div>
          )}
          {!loading && traces.length === 0 && (
            <div className="trace-drawer-empty">
              No traces found for this conversation.
            </div>
          )}
          {!loading &&
            traces.map((t) => (
              <div key={t._id} className="trace-drawer-item">
                <div className="trace-drawer-item-header">
                  <span className="trace-drawer-model">
                    {t.outcome?.modelUsed ||
                      t.requested?.primaryModel ||
                      t.model ||
                      t.resolvedModel ||
                      'Unknown model'}
                  </span>
                  <span className="trace-drawer-time">
                    {new Date(
                      t.createdAt || t.timestamp || t.startedAt,
                    ).toLocaleString()}
                  </span>
                </div>
                {(t.inputTokens != null || t.usage) && (
                  <div className="trace-drawer-tokens">
                    In:{' '}
                    {(
                      t.inputTokens ?? t.usage?.inputTokens
                    )?.toLocaleString() || '—'}{' '}
                    · Out:{' '}
                    {(
                      t.outputTokens ?? t.usage?.outputTokens
                    )?.toLocaleString() || '—'}{' '}
                    · Cost: $
                    {(
                      (t.costUsd ??
                        t.cost ??
                        t.usage?.costUsd ??
                        (t.usage?.totalCostMicros != null
                          ? t.usage.totalCostMicros / 1_000_000
                          : null) ??
                        0)
                    ).toFixed(4)}
                  </div>
                )}
                {(t.outcome?.totalMs || t.durationMs || t.duration) > 0 && (
                  <div className="trace-drawer-duration">
                    Duration:{' '}
                    {(
                      (t.outcome?.totalMs || t.durationMs || t.duration) / 1000
                    ).toFixed(1)}s
                  </div>
                )}
                {t.turnKind && (
                  <div className="trace-drawer-kind">
                    Turn: {t.turnKind}
                  </div>
                )}
                {t.status && (
                  <div
                    className={`trace-drawer-outcome trace-drawer-outcome--${t.status}`}
                  >
                    {t.status}
                  </div>
                )}
                {t.outcome?.providerUsed && (
                  <div className="trace-drawer-provider">
                    Provider: {t.outcome.providerUsed}
                    {t.outcome.modelUsed ? ` / ${t.outcome.modelUsed}` : ''}
                    {t.outcome.fallbackUsed ? ' (fallback)' : ''}
                  </div>
                )}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
