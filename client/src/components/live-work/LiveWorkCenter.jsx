import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveWork } from '../../context/LiveWorkContext.jsx';
import './LiveWorkCenter.css';

const ATTENTION_KIND_LABELS = Object.freeze({
  'possible-duplicate': 'Possible duplicate',
  'missing-resolution': 'Missing resolution',
  'knowledge-review': 'Knowledge review',
  'stale-open': 'Stale case',
  'parse-review': 'Parser review',
  'missing-link': 'Broken link',
  'agent-review': 'Agent review',
  'agent-harness': 'Agent harness',
});

const STAGE_PHASE_LABELS = Object.freeze({
  pending: 'Waiting',
  running: 'Working',
  done: 'Complete',
  failed: 'Stopped',
  skipped: 'Skipped',
});

function countLabel(value) {
  const count = Number(value || 0);
  return count > 99 ? '99+' : String(count);
}

function relativeTime(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, 'day');
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(months, 'month');
  return formatter.format(Math.round(months / 12), 'year');
}

function attentionExplanation(item) {
  const explanations = {
    'possible-duplicate': 'This case may overlap with another saved case. Compare them before continuing.',
    'missing-resolution': 'The case is missing the final outcome an agent would need to trust or reuse it.',
    'knowledge-review': 'A saved knowledge draft is waiting for a human decision before agents can reuse it.',
    'stale-open': 'This case has remained open without recent progress. Confirm its next step or close it.',
    'parse-review': 'The extracted case details were marked uncertain. Review the saved evidence before relying on them.',
    'missing-link': 'A saved workflow link is missing. Review the case and reconnect the related record.',
    'agent-review': 'An agent decision needs a human review before the workflow can safely continue.',
    'agent-harness': 'An agent quality check needs review before its result should be trusted.',
  };
  return explanations[item?.kind] || 'This saved item needs a human review before the workflow can continue.';
}

function attentionContext(item) {
  const source = item?.sourceEscalationId;
  const caseNumber = typeof source === 'object' ? source?.caseNumber : '';
  return caseNumber ? `Case ${caseNumber}` : '';
}

function attentionHref(item) {
  const escalationId = item?.sourceEscalationId?._id || item?.sourceEscalationId;
  const conversationId = item?.sourceConversationId?._id || item?.sourceConversationId;
  if (escalationId) return `#/escalations/${encodeURIComponent(escalationId)}`;
  if (conversationId) return `#/chat/${encodeURIComponent(conversationId)}`;
  if (item?.kind === 'agent-review' || item?.kind === 'agent-harness') return '#/agents';
  return '#/attention';
}

function workHref(item) {
  if (item?.escalationId) return `#/escalations/${encodeURIComponent(item.escalationId)}`;
  if (item?.conversationId) return `#/chat/${encodeURIComponent(item.conversationId)}`;
  if (typeof item?.route === 'string' && item.route.startsWith('#/')) return item.route;
  if (item?.source === 'agent-session') return '#/workspace';
  return '#/chat';
}

function navigateTo(href, close) {
  close();
  window.location.hash = href;
}

function HandoffPath({ stages = [] }) {
  if (!Array.isArray(stages) || stages.length < 2) return null;
  return (
    <ol className="live-work-handoff" aria-label="Agent handoff progress">
      {stages.map((stage, index) => (
        <li key={stage.key || stage.label} className={`is-${stage.status || 'pending'}`}>
          <span className="live-work-handoff__node" aria-hidden="true" />
          <span className="live-work-handoff__copy">
            <strong>{stage.label}</strong>
            <small>{STAGE_PHASE_LABELS[stage.status] || 'Waiting'}</small>
          </span>
          {index < stages.length - 1 && <span className="live-work-handoff__line" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

function WorkCard({ item, onOpen }) {
  const statusLabel = item.status === 'completed'
    ? 'Ready'
    : item.status === 'failed'
      ? 'Stopped'
      : item.status === 'cancelled'
        ? 'Cancelled'
        : 'Live';
  return (
    <article className={`live-work-card is-${item.status || 'running'}`}>
      <div className="live-work-card__topline">
        <span className="live-work-card__owner">{item.owner || 'Agent team'}</span>
        <span className={`live-work-status is-${item.status || 'running'}`}>
          <span aria-hidden="true" />{statusLabel}
        </span>
      </div>
      <h4>{item.title}</h4>
      <p>{item.phaseLabel || item.summary || 'Working'}</p>
      {item.stages && item.summary && item.summary !== item.phaseLabel && (
        <div className="live-work-card__handoff-note">{item.summary}</div>
      )}
      {item.hasFallback && <div className="live-work-card__notice">Backup provider in use</div>}
      <HandoffPath stages={item.stages} />
      <div className="live-work-card__footer">
        <span>{relativeTime(item.updatedAt)}</span>
        <button type="button" onClick={() => onOpen(workHref(item))}>Open</button>
      </div>
    </article>
  );
}

function AttentionCard({ item, onOpen }) {
  const label = ATTENTION_KIND_LABELS[item.kind] || 'Review item';
  const context = attentionContext(item);
  return (
    <article className={`live-attention-card is-${item.severity || 'info'}`}>
      <div className="live-attention-card__topline">
        <span>{label}</span>
        <time>{relativeTime(item.updatedAt || item.lastDetectedAt)}</time>
      </div>
      <h4>{item.title || 'Review needed'}</h4>
      {context && <div className="live-attention-card__context">{context}</div>}
      <p>{attentionExplanation(item)}</p>
      <button type="button" onClick={() => onOpen(attentionHref(item))}>Review</button>
    </article>
  );
}

export default function LiveWorkCenter() {
  const { activeWork, recentWork, attention, status, retry } = useLiveWork();
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef(null);
  const attentionCount = Number(attention.counts.open || attention.total || 0);
  const knowledgeCount = Number(attention.kindCounts['knowledge-review'] || 0);
  const triggerDetail = activeWork.length > 0
    ? `${activeWork.length} running`
    : attention.loading && !attention.lastConfirmedAt
      ? 'Checking priorities'
      : attention.error && !attention.lastConfirmedAt
        ? 'Attention unavailable'
    : attentionCount > 0
      ? `${attentionCount} need you`
      : 'All caught up';
  const connectionLabel = status === 'connected'
    ? 'Live'
    : status === 'offline'
      ? 'Offline'
      : status === 'stale'
        ? 'Updates paused'
        : 'Reconnecting';
  const recentVisible = useMemo(() => recentWork.slice(0, 5), [recentWork]);

  useEffect(() => {
    if (!open) return undefined;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const close = () => setOpen(false);
  const onOpen = (href) => navigateTo(href, close);

  return (
    <>
      <button
        type="button"
        className={`live-work-trigger is-${status}${activeWork.length > 0 ? ' has-active-work' : ''}${attentionCount > 0 ? ' has-attention' : ''}`}
        onClick={() => setOpen(true)}
        aria-label={`Open Live Work Center. ${triggerDetail}.`}
        aria-expanded={open}
      >
        <span className="live-work-trigger__icon" aria-hidden="true">
          <span />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M4 12h10M4 18h7" />
          </svg>
        </span>
        <span className="live-work-trigger__copy">
          <strong>Live work</strong>
          <small>{triggerDetail}</small>
        </span>
        {activeWork.length > 0 && attentionCount > 0 && (
          <span className="live-work-trigger__badge" title={`${attentionCount} items need you`}>
            {countLabel(attentionCount)}
          </span>
        )}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div className="live-work-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) close();
        }}>
          <aside className="live-work-panel" role="dialog" aria-modal="true" aria-labelledby="live-work-title">
            <header className="live-work-panel__header">
              <div>
                <span className="live-work-panel__eyebrow">Work &amp; attention</span>
                <h2 id="live-work-title">Live Work Center</h2>
                <p>What the agent team is doing, and what needs you next.</p>
              </div>
              <button ref={closeButtonRef} type="button" className="live-work-panel__close" onClick={close} aria-label="Close Live Work Center">×</button>
            </header>

            <div className={`live-work-connection is-${status}`} role="status">
              <span aria-hidden="true" />
              <strong>{connectionLabel}</strong>
              <p>{status === 'connected' ? 'Changes appear here as they are confirmed.' : 'Showing the last confirmed information.'}</p>
              {status !== 'connected' && <button type="button" onClick={retry}>Retry</button>}
            </div>

            <div className="live-work-summary" aria-label="Work summary">
              <button type="button" onClick={() => document.getElementById('live-work-running')?.scrollIntoView({ block: 'start' })}>
                <strong>{activeWork.length}</strong><span>Running now</span>
              </button>
              <button type="button" onClick={() => document.getElementById('live-work-attention')?.scrollIntoView({ block: 'start' })}>
                <strong>{attentionCount}</strong><span>Need you</span>
              </button>
              <button type="button" onClick={() => onOpen('#/knowledge')}>
                <strong>{knowledgeCount}</strong><span>Knowledge review</span>
              </button>
            </div>

            <div className="live-work-panel__scroll">
              <section id="live-work-attention" className="live-work-section">
                <div className="live-work-section__heading">
                  <div><span>Priority inbox</span><h3>Needs your attention</h3></div>
                  <button type="button" onClick={() => onOpen('#/attention')}>View all</button>
                </div>
                {attention.loading && attention.items.length === 0 ? (
                  <div className="live-work-empty is-loading">Confirming your attention queue…</div>
                ) : attention.error && !attention.lastConfirmedAt ? (
                  <div className="live-work-empty">
                    <strong>The attention queue could not be confirmed.</strong>
                    <span>Retry live updates before treating this inbox as current.</span>
                  </div>
                ) : attention.items.length > 0 ? (
                  <div className="live-work-list">
                    {attention.items.slice(0, 6).map((item) => <AttentionCard key={item._id} item={item} onOpen={onOpen} />)}
                  </div>
                ) : (
                  <div className="live-work-empty"><strong>Nothing needs a decision.</strong><span>New review items will stay here until they are handled.</span></div>
                )}
              </section>

              <section id="live-work-running" className="live-work-section">
                <div className="live-work-section__heading">
                  <div><span>Agent team</span><h3>Running now</h3></div>
                  <small>{activeWork.length ? 'Safe to leave this screen' : 'No active work'}</small>
                </div>
                {activeWork.length > 0 ? (
                  <div className="live-work-list">{activeWork.map((item) => <WorkCard key={item.id} item={item} onOpen={onOpen} />)}</div>
                ) : (
                  <div className="live-work-empty"><strong>The agent team is ready.</strong><span>Start a QBO workflow or agent task and its progress will appear here.</span></div>
                )}
              </section>

              {recentVisible.length > 0 && (
                <section className="live-work-section">
                  <div className="live-work-section__heading">
                    <div><span>Recent</span><h3>Ready or stopped</h3></div>
                    <small>Last 30 minutes</small>
                  </div>
                  <div className="live-work-list">{recentVisible.map((item) => <WorkCard key={item.id} item={item} onOpen={onOpen} />)}</div>
                </section>
              )}
            </div>
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}
