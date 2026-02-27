import { useState, useEffect, useCallback } from 'react';
import { getEscalation, updateEscalation, transitionEscalation } from '../api/escalationsApi.js';
import { getConversation } from '../api/chatApi.js';
import ChatMessage from './ChatMessage.jsx';

const STATUS_LABELS = {
  'open': 'Open',
  'in-progress': 'In Progress',
  'resolved': 'Resolved',
  'escalated-further': 'Escalated',
};

const STATUS_BADGE_MAP = {
  'open': 'badge-open',
  'in-progress': 'badge-progress',
  'resolved': 'badge-resolved',
  'escalated-further': 'badge-escalated',
};

export default function EscalationDetail({ escalationId }) {
  const [escalation, setEscalation] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [resolution, setResolution] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');

  // Load escalation and linked conversation
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const esc = await getEscalation(escalationId);
        if (cancelled) return;
        setEscalation(esc);
        setNotes(esc.notes || '');
        setResolution(esc.resolution || '');

        if (esc.conversationId) {
          const conv = await getConversation(esc.conversationId);
          if (!cancelled) setConversation(conv);
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [escalationId]);

  const handleSaveNotes = useCallback(async () => {
    if (!escalation || savingNotes) return;
    setSavingNotes(true);
    try {
      const updated = await updateEscalation(escalation._id, { notes, resolution });
      setEscalation(updated);
      setSavedNotice('Saved');
      setTimeout(() => setSavedNotice(''), 2000);
    } catch { /* ignore */ }
    setSavingNotes(false);
  }, [escalation, notes, resolution, savingNotes]);

  const handleStatusChange = useCallback(async (newStatus) => {
    if (!escalation) return;
    try {
      const updated = await transitionEscalation(escalation._id, newStatus, newStatus === 'resolved' ? resolution : undefined);
      setEscalation(updated);
    } catch { /* ignore */ }
  }, [escalation, resolution]);

  if (loading) {
    return (
      <div className="app-content-constrained" style={{ textAlign: 'center', padding: 'var(--sp-10)' }}>
        <span className="spinner" />
      </div>
    );
  }

  if (!escalation) {
    return (
      <div className="app-content-constrained">
        <div className="empty-state">
          <div className="empty-state-title">Escalation Not Found</div>
          <div className="empty-state-desc">This escalation may have been deleted.</div>
          <button className="btn btn-secondary" onClick={() => { window.location.hash = '#/dashboard'; }} type="button">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-content-constrained">
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { window.location.hash = '#/dashboard'; }}
            type="button"
          >
            &larr; Dashboard
          </button>
          <h1 className="page-title" style={{ margin: 0 }}>
            Escalation Detail
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          {escalation.conversationId && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => { window.location.hash = `#/chat/${escalation.conversationId}`; }}
              type="button"
            >
              Open Chat
            </button>
          )}
        </div>
      </div>

      {/* Two-column layout: escalation info + chat transcript */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-5)', alignItems: 'start' }}>

        {/* Left: Escalation details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
          {/* Status + meta card */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-4)' }}>
              <span className={`badge ${STATUS_BADGE_MAP[escalation.status] || ''}`} style={{ fontSize: 'var(--text-sm)' }}>
                {STATUS_LABELS[escalation.status] || escalation.status}
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

            {/* Status transition buttons */}
            <div style={{ marginTop: 'var(--sp-4)', display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              {['open', 'in-progress', 'resolved', 'escalated-further']
                .filter(s => s !== escalation.status)
                .map(s => (
                  <button
                    key={s}
                    className={`btn btn-sm ${s === 'resolved' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => handleStatusChange(s)}
                    type="button"
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
            </div>
          </div>

          {/* Resolution notes */}
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
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
        </div>

        {/* Right: Chat transcript */}
        <div className="card" style={{ maxHeight: 'calc(100vh - 160px)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, marginBottom: 'var(--sp-3)' }}>
            Chat Transcript
          </h2>
          {conversation && conversation.messages && conversation.messages.length > 0 ? (
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {conversation.messages.map((msg, i) => (
                <ChatMessage
                  key={i}
                  role={msg.role}
                  content={msg.content}
                  images={msg.images}
                  timestamp={msg.timestamp}
                  responseTimeMs={msg.responseTimeMs}
                />
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 'var(--sp-6)', color: 'var(--ink-secondary)', fontSize: 'var(--text-sm)' }}>
              {escalation.conversationId
                ? 'No messages in the linked conversation.'
                : 'No conversation linked to this escalation.'}
            </div>
          )}
        </div>
      </div>
    </div>
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
