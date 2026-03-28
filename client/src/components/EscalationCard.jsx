import Tooltip from './Tooltip.jsx';
import {
  ESCALATION_STATUSES,
  ESCALATION_STATUS_BADGE_MAP,
  ESCALATION_STATUS_LABELS,
} from '../hooks/useEscalations.js';

export default function EscalationCard({
  escalation,
  onOpen,
  onChangeStatus,
  onDelete,
}) {
  if (!escalation) return null;

  return (
    <tr
      className="table-clickable-row"
      onClick={onOpen}
      style={{ cursor: onOpen ? 'pointer' : 'default' }}
    >
      <td>
        <select
          value={escalation.status}
          onChange={(e) => {
            e.stopPropagation();
            onChangeStatus(escalation._id, e.target.value);
          }}
          className={`badge ${ESCALATION_STATUS_BADGE_MAP[escalation.status] || ''}`}
          style={{ border: 'none', cursor: 'pointer', fontSize: 'var(--text-xs)', padding: '2px 6px' }}
          onClick={(e) => e.stopPropagation()}
        >
          {ESCALATION_STATUSES.slice(1).map(s => (
            <option key={s} value={s}>{ESCALATION_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </td>
      <td>
        <span className={`cat-badge cat-${escalation.category || 'general'}`}>
          {(escalation.category || 'general').replace('-', ' ')}
        </span>
      </td>
      <td className="truncate" style={{ maxWidth: 120 }}>{escalation.agentName || '--'}</td>
      <td className="truncate" style={{ maxWidth: 250 }}>
        {escalation.attemptingTo || '--'}
        {escalation.conversationId && (
          <Tooltip text="This escalation has a linked conversation" level="medium">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4, verticalAlign: 'middle' }}>
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
          </Tooltip>
        )}
      </td>
      <td><span className="mono">{escalation.coid || '--'}</span></td>
      <td style={{ whiteSpace: 'nowrap', fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)' }}>
        {new Date(escalation.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </td>
      <td>
        <button
          className="btn btn-ghost btn-sm"
          onClick={(e) => { e.stopPropagation(); onDelete(escalation._id); }}
          title="Delete escalation"
          type="button"
          style={{ color: 'var(--danger)', opacity: 0.6 }}
        >
          Delete
        </button>
      </td>
    </tr>
  );
}
