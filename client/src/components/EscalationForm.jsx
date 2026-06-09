import { useCallback, useEffect, useState } from 'react';
import { updateEscalationWithMetadata } from '../api/escalationsApi.js';
import { useToast } from '../hooks/useToast.jsx';

const FINISH_OPTIONS = [
  {
    key: 'working',
    label: 'Still working',
    title: 'Save next step',
    detail: 'Case stays active. Record what should happen next.',
    status: 'in-progress',
  },
  {
    key: 'fixed',
    label: 'Fully resolved',
    title: 'Record the fix',
    detail: 'Use only when the actual fix is known.',
    status: 'resolved',
  },
  {
    key: 'handoff',
    label: 'Handed off / no proven fix',
    title: 'Record why',
    detail: 'Use when unresolved, handed off, or not proven.',
    status: 'escalated-further',
  },
];

function getInitialFinishMode(escalation) {
  if (escalation?.status === 'resolved') return 'fixed';
  if (escalation?.status === 'escalated-further') return 'handoff';
  return 'working';
}

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
  const [finishMode, setFinishMode] = useState('working');
  const [finishError, setFinishError] = useState('');

  useEffect(() => {
    if (!escalation) return;
    setResolutionNotes(escalation.resolutionNotes || escalation.notes || '');
    setResolution(escalation.resolution || '');
    setFinishMode(getInitialFinishMode(escalation));
    setFinishError('');
    setSavedNotice('');
    setSavingNotes(false);
  }, [escalation?._id]);

  const handleFinishSubmit = useCallback(async () => {
    if (!escalation || savingNotes) return;
    const selected = FINISH_OPTIONS.find((option) => option.key === finishMode) || FINISH_OPTIONS[0];
    const finalText = resolution.trim();
    const notesText = resolutionNotes.trim();

    if (!finalText) {
      setFinishError(selected.key === 'fixed'
        ? 'Write what actually fixed the case before marking it resolved.'
        : selected.key === 'handoff'
          ? 'Write why this was handed off, unresolved, or has no proven fix before saving.'
          : 'Write the current next step before saving progress.');
      return;
    }

    setFinishError('');
    setSavingNotes(true);
    try {
      const result = await updateEscalationWithMetadata(escalation._id, {
        status: selected.status,
        resolution: finalText,
        resolutionNotes: notesText,
      });
      const updated = result.escalation;
      onEscalationUpdate?.(updated);
      onStatusTransitionComplete?.({
        updated,
        newStatus: selected.status,
        resolution: finalText,
        knowledgeDraft: result.knowledgeDraft,
        resolutionDiscipline: result.resolutionDiscipline,
      });
      setSavedNotice(selected.status === 'resolved'
        ? 'Resolved'
        : selected.status === 'escalated-further'
          ? 'Escalated further'
          : 'Progress saved');
      window.setTimeout(() => setSavedNotice(''), 2500);
    } catch {
      toast.error('Failed to finish escalation');
    }
    setSavingNotes(false);
  }, [
    escalation,
    finishMode,
    onEscalationUpdate,
    onStatusTransitionComplete,
    resolution,
    resolutionNotes,
    savingNotes,
    toast,
  ]);

  if (!escalation) {
    return null;
  }

  return (
    <>
      <div className="card esc-finish-card">
        <div className="esc-finish-header">
          <div>
            <span className="eyebrow">Next step</span>
            <h2>Finish this escalation</h2>
            <p>Choose the outcome, record the result, and save the case record.</p>
          </div>
          <span className={`badge ${statusBadgeMap[escalation.status] || ''}`}>
            {statusLabels[escalation.status] || escalation.status}
          </span>
        </div>

        <div className="esc-finish-options" role="group" aria-label="Choose escalation outcome">
          {FINISH_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`esc-finish-option${finishMode === option.key ? ' is-selected' : ''}`}
              onClick={() => {
                setFinishMode(option.key);
                setFinishError('');
              }}
              aria-pressed={finishMode === option.key}
              disabled={savingNotes}
            >
              <span>{option.label}</span>
              <strong>{option.title}</strong>
              <small>{option.detail}</small>
            </button>
          ))}
        </div>

        <div className="esc-finish-guidance">
          {finishMode === 'fixed' ? (
            <>
              <strong>Record only the confirmed final fix.</strong>
              <span>This is what solved the customer issue, not the troubleshooting attempts.</span>
            </>
          ) : finishMode === 'handoff' ? (
            <>
              <strong>Preserve the case without pretending it is solved.</strong>
              <span>Write why it moved on, what is missing, or who owns it next.</span>
            </>
          ) : (
            <>
              <strong>Keep the case active.</strong>
              <span>Save the current blocker or next step so the next agent knows where to continue.</span>
            </>
          )}
        </div>

        <div className="esc-finish-fields">
          <label>
            <span>{finishMode === 'fixed' ? 'What actually fixed it?' : finishMode === 'handoff' ? 'Why is it handed off, unresolved, or not proven?' : 'What is the next step?'}</span>
            <textarea
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder={finishMode === 'fixed'
                ? 'Write the confirmed final fix. Do not include failed attempts here.'
                : finishMode === 'handoff'
                  ? 'Write the handoff reason, unresolved blocker, or why no proven fix exists.'
                  : 'Write what is currently blocking the case or what needs to happen next.'}
              rows={3}
            />
          </label>

          <label>
            <span>What did not work?</span>
            <textarea
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              placeholder="Failed attempts, dead ends, warnings, or evidence caveats."
              rows={3}
            />
          </label>
        </div>

        <div className="esc-finish-footer">
          <div>
            {finishError && <span className="esc-finish-error">{finishError}</span>}
            {savedNotice && <span className="esc-finish-saved">{savedNotice}</span>}
          </div>
          <button
            className="btn btn-primary"
            onClick={handleFinishSubmit}
            disabled={savingNotes}
            type="button"
          >
            {savingNotes
              ? 'Saving...'
              : finishMode === 'fixed'
                ? 'Save As Resolved'
                : finishMode === 'handoff'
                  ? 'Save Outcome'
                  : 'Save Next Step'}
          </button>
        </div>
      </div>

      <div className="card esc-case-facts-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-4)' }}>
          <div>
            <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, margin: 0 }}>Case facts</h2>
            <div className="text-secondary" style={{ fontSize: 'var(--text-sm)', marginTop: 2 }}>
              The shared context every agent should use for this escalation.
            </div>
          </div>
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
