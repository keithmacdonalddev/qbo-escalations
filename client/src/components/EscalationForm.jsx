import { useCallback, useEffect, useState } from 'react';
import {
  transitionEscalation,
  updateEscalation,
} from '../api/escalationsApi.js';
import { useToast } from '../hooks/useToast.jsx';
import Tooltip from './Tooltip.jsx';

export default function EscalationForm({
  escalation,
  statusLabels,
  statusBadgeMap,
  onEscalationUpdate,
  onStatusTransitionComplete,
}) {
  const toast = useToast();
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolution, setResolution] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');

  useEffect(() => {
    if (!escalation) return;
    setResolutionNotes(escalation.resolutionNotes || escalation.notes || '');
    setResolution(escalation.resolution || '');
    setSavedNotice('');
    setSavingNotes(false);
  }, [escalation?._id]);

  const handleSaveNotes = useCallback(async () => {
    if (!escalation || savingNotes) return;
    setSavingNotes(true);
    try {
      const updated = await updateEscalation(escalation._id, { resolutionNotes, resolution });
      onEscalationUpdate?.(updated);
      setSavedNotice('Saved');
      window.setTimeout(() => setSavedNotice(''), 2000);
    } catch {
      toast.error('Failed to save notes');
    }
    setSavingNotes(false);
  }, [escalation, onEscalationUpdate, resolution, resolutionNotes, savingNotes, toast]);

  const handleStatusChange = useCallback(async (newStatus) => {
    if (!escalation) return;
    try {
      const { escalation: updated, knowledgeEligible } = await transitionEscalation(
        escalation._id,
        newStatus,
        newStatus === 'resolved' ? resolution : undefined,
      );
      onEscalationUpdate?.(updated);
      onStatusTransitionComplete?.({
        updated,
        knowledgeEligible,
        newStatus,
        resolution,
      });
    } catch {
      toast.error('Failed to update status');
    }
  }, [escalation, onEscalationUpdate, onStatusTransitionComplete, resolution, toast]);

  if (!escalation) {
    return null;
  }

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-4)' }}>
          <span className={`badge ${statusBadgeMap[escalation.status] || ''}`} style={{ fontSize: 'var(--text-sm)' }}>
            {statusLabels[escalation.status] || escalation.status}
          </span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
            {new Date(escalation.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            {escalation.resolvedAt && (
              <> &middot; Resolved {new Date(escalation.resolvedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</>
            )}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' }}>
          <FieldRow label="COID" value={escalation.coid} mono />
          <FieldRow label="Case #" value={escalation.caseNumber} mono />
          <FieldRow label="Agent" value={escalation.agentName} />
          <FieldRow label="Category">
            {escalation.category && (
              <span className={`cat-badge cat-${escalation.category}`}>
                {escalation.category.replace('-', ' ')}
              </span>
            )}
          </FieldRow>
          <FieldRow label="Source" value={escalation.source} span2 />
        </div>

        {escalation.attemptingTo && (
          <div style={{ marginTop: 'var(--sp-4)', padding: 'var(--sp-3)', background: 'var(--bg-sunken)', borderRadius: 'var(--radius-md)' }}>
            <div className="eyebrow" style={{ marginBottom: 'var(--sp-1)' }}>Issue</div>
            <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>{escalation.attemptingTo}</div>
          </div>
        )}

        <div style={{ marginTop: 'var(--sp-4)', display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          {['open', 'in-progress', 'resolved', 'escalated-further']
            .filter((status) => status !== escalation.status)
            .map((status) => (
              <Tooltip key={status} text={`Change status to ${statusLabels[status]}`} level="medium">
                <button
                  className={`btn btn-sm ${status === 'resolved' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleStatusChange(status)}
                  type="button"
                >
                  {statusLabels[status]}
                </button>
              </Tooltip>
            ))}
        </div>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, marginBottom: 'var(--sp-3)' }}>Resolution</h2>
        <textarea
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          placeholder="How was this resolved? Document the fix for future reference..."
          rows={3}
          style={{
            width: '100%',
            resize: 'vertical',
            background: 'var(--bg-sunken)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--sp-3)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            color: 'var(--ink)',
            lineHeight: 1.6,
          }}
        />

        <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, marginTop: 'var(--sp-5)', marginBottom: 'var(--sp-3)' }}>
          Notes &amp; Lessons Learned
        </h2>
        <textarea
          value={resolutionNotes}
          onChange={(e) => setResolutionNotes(e.target.value)}
          placeholder="Add annotations, lessons learned, or training notes..."
          rows={4}
          style={{
            width: '100%',
            resize: 'vertical',
            background: 'var(--bg-sunken)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--sp-3)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            color: 'var(--ink)',
            lineHeight: 1.6,
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 'var(--sp-3)', marginTop: 'var(--sp-3)' }}>
          {savedNotice && (
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--success, #41a466)', fontWeight: 600 }}>
              {savedNotice}
            </span>
          )}
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSaveNotes}
            disabled={savingNotes}
            type="button"
          >
            {savingNotes ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </>
  );
}

function FieldRow({ label, value, mono, span2, children }) {
  return (
    <div style={span2 ? { gridColumn: '1 / -1' } : {}}>
      <div className="eyebrow" style={{ marginBottom: 2 }}>{label}</div>
      {children || (
        <div style={{
          fontSize: 'var(--text-sm)',
          fontFamily: mono ? 'var(--font-mono)' : 'inherit',
          color: value ? 'var(--ink)' : 'var(--ink-tertiary)',
        }}>
          {value || '--'}
        </div>
      )}
    </div>
  );
}
