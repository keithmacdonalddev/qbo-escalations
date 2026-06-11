import Tooltip from './Tooltip.jsx';
import { ESCALATION_STATUS_LABELS } from '../hooks/useEscalations.js';

const STATUS_DOT_CLASS = {
  open: 'is-open',
  'in-progress': 'is-working',
  resolved: 'is-resolved',
  'escalated-further': 'is-escalated',
};

export default function EscalationCard({
  escalation,
  showAgent = true,
  onOpen,
  onDelete,
}) {
  if (!escalation) return null;
  const isFinished = escalation.status === 'resolved' || escalation.status === 'escalated-further';

  return (
    <tr
      className="table-clickable-row"
      onClick={onOpen}
      style={{ cursor: onOpen ? 'pointer' : 'default' }}
    >
      <td>
        <span className="esc-status">
          <i className={`esc-status-dot ${STATUS_DOT_CLASS[escalation.status] || 'is-open'}`} aria-hidden="true" />
          {ESCALATION_STATUS_LABELS[escalation.status] || escalation.status || 'Open'}
        </span>
      </td>
      <td className="esc-cat">{(escalation.category || 'general').replace('-', ' ')}</td>
      {showAgent && (
        <td className="truncate esc-cell-agent">{escalation.agentName || '--'}</td>
      )}
      <td className="truncate esc-cell-issue">
        {escalation.attemptingTo || '--'}
        {escalation.conversationId && (
          <Tooltip text="This escalation has a linked conversation" level="medium">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4, verticalAlign: 'middle' }}>
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
          </Tooltip>
        )}
      </td>
      <td className="esc-cell-coid" title={escalation.coid || undefined}>
        <span className="mono">{escalation.coid || '--'}</span>
      </td>
      <td className="esc-cell-date">
        {new Date(escalation.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </td>
      <td>
        <div className="esc-row-actions">
          <button
            className="btn btn-ghost btn-sm esc-quiet-action"
            onClick={(e) => { e.stopPropagation(); onOpen?.(); }}
            type="button"
          >
            {isFinished ? 'Open' : 'Finish'}
          </button>
          <button
            className="btn btn-ghost btn-sm esc-row-delete"
            onClick={(e) => { e.stopPropagation(); onDelete(escalation._id); }}
            title="Delete escalation"
            type="button"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}
