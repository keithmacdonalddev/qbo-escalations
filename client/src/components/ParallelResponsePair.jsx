import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { renderMarkdown, CopyButton, formatResponseTime, getProviderLabel, getProviderClass, wordCount } from '../utils/markdown.jsx';
import FeatureAccordion from './FeatureAccordion.jsx';

export default function ParallelResponsePair({
  responses,
  onAccept,
  onUnaccept,
  onDiscard,
  onReEnable,
  onFork,
  accepting,
  isImageParseTurn,
  discardedProvider,
}) {
  const [activeTab, setActiveTab] = useState(0);
  const [undoToastVisible, setUndoToastVisible] = useState(false);
  const [unaccepting, setUnaccepting] = useState(false);

  // Sort responses: provider-a first, provider-b second (consistent ordering)
  const sorted = useMemo(() => {
    if (!responses || responses.length < 2) return responses || [];
    const a = responses.find(r => r.provider === 'claude');
    const b = responses.find(r => r.provider !== 'claude');
    if (a && b) return [a, b];
    return responses;
  }, [responses]);

  const hasAccepted = sorted.some(r => r.isAccepted);
  const turnId = sorted[0]?.turnId;
  const acceptedProvider = sorted.find(r => r.isAccepted)?.provider;

  // Show undo toast briefly after acceptance
  useEffect(() => {
    if (hasAccepted && acceptedProvider) {
      setUndoToastVisible(true);
      const timer = setTimeout(() => setUndoToastVisible(false), 8000);
      return () => clearTimeout(timer);
    }
    setUndoToastVisible(false);
  }, [hasAccepted, acceptedProvider]);

  // Keyboard shortcuts: 1/2 to accept, Ctrl+Z to undo
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Ctrl+Z / Cmd+Z to undo acceptance
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && hasAccepted && onUnaccept && turnId) {
        e.preventDefault();
        handleUnaccept();
        return;
      }

      // 1/2 to accept (only when not yet accepted)
      if (!onAccept || hasAccepted) return;
      if (e.key === '1' && sorted[0]) {
        e.preventDefault();
        onAccept(sorted[0].turnId, sorted[0].provider);
      } else if (e.key === '2' && sorted[1]) {
        e.preventDefault();
        onAccept(sorted[1].turnId, sorted[1].provider);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onAccept, onUnaccept, hasAccepted, sorted, turnId]);

  const handleAccept = useCallback((provider) => {
    if (!onAccept || !turnId) return;
    onAccept(turnId, provider);
  }, [onAccept, turnId]);

  const handleUnaccept = useCallback(async () => {
    if (!onUnaccept || !turnId || unaccepting) return;
    setUnaccepting(true);
    try {
      await onUnaccept(turnId);
    } finally {
      setUnaccepting(false);
      setUndoToastVisible(false);
    }
  }, [onUnaccept, turnId, unaccepting]);

  const handleDiscard = useCallback((provider) => {
    if (onDiscard && turnId) onDiscard(turnId, provider);
  }, [onDiscard, turnId]);

  const handleRestore = useCallback(() => {
    if (onReEnable && turnId) onReEnable(turnId);
  }, [onReEnable, turnId]);

  if (!sorted || sorted.length === 0) return null;

  // For streaming state with only 1 response so far
  if (sorted.length === 1) {
    const r = sorted[0];
    const provClass = getProviderClass(r.provider);
    return (
      <div className="parallel-split" style={{ gridTemplateColumns: '1fr' }}>
        <div className={`parallel-column ${provClass}`}>
          <div className="parallel-column-header">
            <span className="provider-name">
              <span className="provider-dot" />
              {getProviderLabel(r.provider)}
            </span>
          </div>
          <div className="parallel-column-body playbook-content">
            {r.content ? renderMarkdown(r.content) : (
              <span style={{ color: 'var(--ink-tertiary)' }}>
                <span className="spinner spinner-sm" style={{ marginRight: 'var(--sp-2)' }} />
                Waiting...
              </span>
            )}
            {r.isStreaming && r.content && <span className="streaming-cursor" />}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Context line */}
      {!hasAccepted && (
        <div className="parallel-context-line">
          <span className="ctx-dot" style={{ background: 'var(--provider-a)' }} />
          <span className="ctx-dot" style={{ background: 'var(--provider-b)' }} />
          <span>2 responses — compare and accept one</span>
          {!sorted[0]?.isStreaming && (
            <span className="ctx-hints">Press 1 or 2 to accept</span>
          )}
        </div>
      )}

      {/* Mobile tab bar */}
      <div className="parallel-tab-bar">
        {sorted.map((r, idx) => (
          <button
            key={r.provider}
            className={`parallel-tab ${getProviderClass(r.provider)}-tab${activeTab === idx ? ' is-active' : ''}`}
            onClick={() => setActiveTab(idx)}
            type="button"
          >
            {getProviderLabel(r.provider)}
            {r.isAccepted && ' \u2713'}
          </button>
        ))}
      </div>

      {/* Split columns */}
      <div className="parallel-split">
        {sorted.map((r, idx) => {
          const provClass = getProviderClass(r.provider);
          const isAccepted = r.isAccepted;
          const isRejected = r.isRejected;
          const isDiscarded = discardedProvider === r.provider;
          const isAccepting = accepting === `${r.turnId}:${r.provider}`;
          const wc = wordCount(r.content);

          const columnClasses = [
            'parallel-column',
            provClass,
            isAccepted ? 'is-accepted' : '',
            isRejected && !isDiscarded ? 'is-rejected' : '',
            isDiscarded ? 'is-discarded' : '',
            activeTab === idx ? 'is-visible-tab' : '',
          ].filter(Boolean).join(' ');

          // Discarded: show slim restore bar
          if (isDiscarded) {
            return (
              <div
                key={r.provider}
                className={columnClasses}
                onClick={handleRestore}
                title="Click to restore this response"
              >
                <div className="parallel-column-header">
                  <span className="provider-name">
                    <span className="provider-dot" />
                    {getProviderLabel(r.provider)}
                  </span>
                  <span className="parallel-restore-hint">Click to restore</span>
                </div>
              </div>
            );
          }

          return (
            <div
              key={r.provider}
              className={columnClasses}
              onClick={!hasAccepted && onAccept && !r.isStreaming ? () => handleAccept(r.provider) : undefined}
              style={!hasAccepted && onAccept && !r.isStreaming ? { cursor: 'pointer' } : {}}
            >
              {/* Header */}
              <div className="parallel-column-header">
                <span className="provider-name">
                  <span className="provider-dot" />
                  {getProviderLabel(r.provider)}
                  {isAccepted && (
                    <span className="badge badge-resolved" style={{ marginLeft: 'var(--sp-2)', fontSize: '9px', padding: '1px 6px' }}>
                      Accepted
                    </span>
                  )}
                </span>
                <div className="header-actions">
                  {!r.isStreaming && r.content && (
                    <>
                      <span className="header-meta">{wc} words{r.responseTimeMs ? ` \u00B7 ${formatResponseTime(r.responseTimeMs)}` : ''}</span>
                      {/* Accept button — only if no winner yet */}
                      {onAccept && !hasAccepted && (
                        <button
                          className="parallel-accept-btn"
                          onClick={(e) => { e.stopPropagation(); handleAccept(r.provider); }}
                          type="button"
                          disabled={isAccepting}
                        >
                          {isAccepting ? 'Accepting...' : 'Accept'}
                        </button>
                      )}
                      {/* Undo Accept button — on the accepted card */}
                      {isAccepted && onUnaccept && (
                        <button
                          className="parallel-discard-btn"
                          onClick={(e) => { e.stopPropagation(); handleUnaccept(); }}
                          type="button"
                          disabled={unaccepting}
                          title="Undo acceptance (Ctrl+Z)"
                        >
                          {unaccepting ? 'Undoing...' : 'Undo Accept'}
                        </button>
                      )}
                      {/* Discard button — only for the rejected (non-winner) after acceptance */}
                      {hasAccepted && isRejected && onDiscard && (
                        <button
                          className="parallel-discard-btn"
                          onClick={(e) => { e.stopPropagation(); handleDiscard(r.provider); }}
                          type="button"
                        >
                          Discard
                        </button>
                      )}
                      {/* Copy */}
                      <CopyButton text={r.content} />
                    </>
                  )}
                  {/* Keyboard hint */}
                  {!hasAccepted && !r.isStreaming && (
                    <span className="parallel-shortcut-hint">{idx + 1}</span>
                  )}
                </div>
              </div>

              {/* Body */}
              <div className="parallel-column-body playbook-content">
                {r.content ? renderMarkdown(r.content) : (
                  <span style={{ color: 'var(--ink-tertiary)' }}>
                    <span className="spinner spinner-sm" style={{ marginRight: 'var(--sp-2)' }} />
                    Waiting...
                  </span>
                )}
                {r.isStreaming && r.content && <span className="streaming-cursor" />}
              </div>

              {/* Footer */}
              {!r.isStreaming && r.content && (
                <div className="parallel-column-footer">
                  <span>{r.responseTimeMs ? formatResponseTime(r.responseTimeMs) : ''}</span>
                  <span>{wc} words</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Undo toast — shown briefly after acceptance */}
      {undoToastVisible && acceptedProvider && (
        <div style={{ textAlign: 'center', marginTop: 'var(--sp-3)' }}>
          <span className="parallel-undo-toast">
            <span>{getProviderLabel(acceptedProvider)} response accepted</span>
            <button className="undo-link" onClick={handleUnaccept} type="button" disabled={unaccepting}>
              {unaccepting ? 'Undoing...' : 'Undo (Ctrl+Z)'}
            </button>
          </span>
        </div>
      )}

      {/* Feature Accordion — only for image parse turns */}
      {isImageParseTurn && !sorted[0]?.isStreaming && sorted[0]?.content && sorted[1]?.content && (
        <FeatureAccordion
          responseA={{ provider: sorted[0].provider, content: sorted[0].content, responseTimeMs: sorted[0].responseTimeMs }}
          responseB={{ provider: sorted[1].provider, content: sorted[1].content, responseTimeMs: sorted[1].responseTimeMs }}
        />
      )}
    </div>
  );
}
