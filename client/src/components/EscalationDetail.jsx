import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getEscalation,
  updateEscalation,
  transitionEscalation,
  uploadEscalationScreenshots,
  deleteEscalationScreenshot,
  listSimilarEscalations,
  getEscalationKnowledge,
  generateEscalationKnowledge,
  updateEscalationKnowledge,
  publishEscalationKnowledge,
  unpublishEscalationKnowledge,
} from '../api/escalationsApi.js';
import { getConversation } from '../api/chatApi.js';
import { useToast } from '../hooks/useToast.jsx';
import ChatMessage from './ChatMessage.jsx';
import CopilotPanel from './CopilotPanel.jsx';
import Tooltip from './Tooltip.jsx';

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

const KNOWLEDGE_REVIEW_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const KNOWLEDGE_TARGET_OPTIONS = [
  { value: 'category', label: 'Category playbook' },
  { value: 'edge-case', label: 'Edge-case playbook' },
  { value: 'case-history-only', label: 'Case history only' },
];

const KNOWLEDGE_REUSABLE_OPTIONS = [
  { value: 'canonical', label: 'Canonical' },
  { value: 'edge-case', label: 'Edge case' },
  { value: 'case-history-only', label: 'Case history only' },
  { value: 'customer-specific', label: 'Customer specific' },
  { value: 'temporary-incident', label: 'Temporary incident' },
  { value: 'unsafe-to-reuse', label: 'Unsafe to reuse' },
];

const KNOWLEDGE_CONFIDENCE_OPTIONS = [
  { value: 0.35, label: 'Low' },
  { value: 0.6, label: 'Medium' },
  { value: 0.85, label: 'High' },
];

const KNOWLEDGE_CATEGORY_OPTIONS = [
  'payroll',
  'bank-feeds',
  'reconciliation',
  'permissions',
  'billing',
  'tax',
  'invoicing',
  'reporting',
  'inventory',
  'payments',
  'integrations',
  'general',
  'technical',
  'unknown',
];

export default function EscalationDetail({ escalationId }) {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [escalation, setEscalation] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolution, setResolution] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');
  const [uploadingScreenshots, setUploadingScreenshots] = useState(false);
  const [similarEscalations, setSimilarEscalations] = useState([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [knowledge, setKnowledge] = useState(null);
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [knowledgeNotice, setKnowledgeNotice] = useState('');
  const [autoGenBanner, setAutoGenBanner] = useState(null); // 'generating' | 'done' | null
  const knowledgeSectionRef = useRef(null);

  // Load escalation and linked conversation
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setKnowledge(null);
    (async () => {
      try {
        const [esc, draft] = await Promise.all([
          getEscalation(escalationId),
          getEscalationKnowledge(escalationId).catch(() => null),
        ]);
        if (cancelled) return;
        setEscalation(esc);
        setResolutionNotes(esc.resolutionNotes || esc.notes || '');
        setResolution(esc.resolution || '');
        setKnowledge(draft || null);

        if (esc.conversationId) {
          const conv = await getConversation(esc.conversationId);
          if (!cancelled) setConversation(conv);
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [escalationId]);

  const showKnowledgeNotice = useCallback((message) => {
    setKnowledgeNotice(message);
    window.setTimeout(() => setKnowledgeNotice(''), 2500);
  }, []);

  const handleSaveNotes = useCallback(async () => {
    if (!escalation || savingNotes) return;
    setSavingNotes(true);
    try {
      const updated = await updateEscalation(escalation._id, { resolutionNotes, resolution });
      setEscalation(updated);
      setSavedNotice('Saved');
      setTimeout(() => setSavedNotice(''), 2000);
    } catch { toastRef.current.error('Failed to save notes'); }
    setSavingNotes(false);
  }, [escalation, resolutionNotes, resolution, savingNotes]);

  const handleStatusChange = useCallback(async (newStatus) => {
    if (!escalation) return;
    try {
      const { escalation: updated, knowledgeEligible } = await transitionEscalation(
        escalation._id,
        newStatus,
        newStatus === 'resolved' ? resolution : undefined,
      );
      setEscalation(updated);

      // Auto-generate knowledge draft on resolution when no draft exists yet
      if (knowledgeEligible) {
        setAutoGenBanner('generating');
        setKnowledgeBusy(true);
        // Scroll the knowledge section into view after a tick so the banner is rendered
        requestAnimationFrame(() => {
          knowledgeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
        try {
          const draft = await generateEscalationKnowledge(updated._id, { force: false, enrich: true });
          setKnowledge(draft);
          setAutoGenBanner('done');
          // Clear the "done" banner after a few seconds
          setTimeout(() => setAutoGenBanner(null), 5000);
        } catch {
          toastRef.current.error('Knowledge draft auto-generation failed — you can generate it manually below.');
          setAutoGenBanner(null);
        }
        setKnowledgeBusy(false);
      }
    } catch { toastRef.current.error('Failed to update status'); }
  }, [escalation, resolution]);

  const handleGenerateKnowledge = useCallback(async (force = false) => {
    if (!escalation || knowledgeBusy) return;
    setKnowledgeBusy(true);
    try {
      const draft = await generateEscalationKnowledge(escalation._id, { force });
      setKnowledge(draft);
      showKnowledgeNotice(force ? 'Draft refreshed' : 'Draft generated');
    } catch {
      toastRef.current.error('Failed to generate knowledge draft');
    }
    setKnowledgeBusy(false);
  }, [escalation, knowledgeBusy, showKnowledgeNotice]);

  const handleKnowledgeFieldChange = useCallback((field, value) => {
    setKnowledge((prev) => (prev ? { ...prev, [field]: value } : prev));
  }, []);

  const handleSaveKnowledge = useCallback(async () => {
    if (!escalation || !knowledge || knowledgeBusy) return;
    setKnowledgeBusy(true);
    try {
      const updated = await updateEscalationKnowledge(escalation._id, {
        reviewStatus: knowledge.reviewStatus,
        publishTarget: knowledge.publishTarget,
        reusableOutcome: knowledge.reusableOutcome,
        category: knowledge.category,
        title: knowledge.title,
        summary: knowledge.summary,
        symptom: knowledge.symptom,
        rootCause: knowledge.rootCause,
        exactFix: knowledge.exactFix,
        escalationPath: knowledge.escalationPath,
        keySignals: Array.isArray(knowledge.keySignals)
          ? knowledge.keySignals
          : String(knowledge.keySignals || '').split(/\r?\n/),
        confidence: knowledge.confidence,
        reviewNotes: knowledge.reviewNotes,
      });
      setKnowledge(updated);
      showKnowledgeNotice('Draft saved');
    } catch {
      toastRef.current.error('Failed to save knowledge draft');
    }
    setKnowledgeBusy(false);
  }, [escalation, knowledge, knowledgeBusy, showKnowledgeNotice]);

  const handlePublishKnowledge = useCallback(async () => {
    if (!escalation || !knowledge || knowledgeBusy) return;
    setKnowledgeBusy(true);
    try {
      const result = await publishEscalationKnowledge(escalation._id);
      setKnowledge(result.knowledge);
      showKnowledgeNotice(result.publish?.inserted === false ? 'Already published' : 'Published to playbook');
    } catch {
      toastRef.current.error('Failed to publish knowledge draft');
    }
    setKnowledgeBusy(false);
  }, [escalation, knowledge, knowledgeBusy, showKnowledgeNotice]);

  const handleUnpublishKnowledge = useCallback(async () => {
    if (!escalation || !knowledge || knowledgeBusy) return;
    if (!window.confirm('Unpublish this knowledge entry? It will be removed from the playbook and reset to draft status.')) return;
    setKnowledgeBusy(true);
    try {
      const result = await unpublishEscalationKnowledge(escalation._id);
      setKnowledge(result.knowledge);
      showKnowledgeNotice('Unpublished from playbook');
    } catch {
      toastRef.current.error('Failed to unpublish knowledge');
    }
    setKnowledgeBusy(false);
  }, [escalation, knowledge, knowledgeBusy, showKnowledgeNotice]);

  const handleUploadScreenshots = useCallback(async (e) => {
    if (!escalation) return;
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploadingScreenshots(true);
    try {
      const images = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read image'));
        reader.readAsDataURL(file);
      })));
      const updated = await uploadEscalationScreenshots(escalation._id, images);
      setEscalation(updated);
    } catch { toastRef.current.error('Failed to upload screenshots'); }
    setUploadingScreenshots(false);
    e.target.value = '';
  }, [escalation]);

  const handleDeleteScreenshot = useCallback(async (fileName) => {
    if (!escalation || !fileName) return;
    try {
      const updated = await deleteEscalationScreenshot(escalation._id, fileName);
      setEscalation(updated);
    } catch { toastRef.current.error('Failed to delete screenshot'); }
  }, [escalation]);

  useEffect(() => {
    if (!escalation?._id) {
      setSimilarEscalations([]);
      return;
    }
    let cancelled = false;
    setSimilarLoading(true);
    (async () => {
      try {
        const similar = await listSimilarEscalations({ escalationId: escalation._id, limit: 6 });
        if (!cancelled) setSimilarEscalations(similar || []);
      } catch {
        if (!cancelled) setSimilarEscalations([]);
      }
      if (!cancelled) setSimilarLoading(false);
    })();
    return () => { cancelled = true; };
  }, [escalation?._id]);

  const knowledgeEligible = escalation
    ? escalation.status === 'resolved' || escalation.status === 'escalated-further'
    : false;
  const knowledgeLocked = knowledge?.reviewStatus === 'published';
  const knowledgeCanPublish = Boolean(
    knowledge
    && knowledge.reviewStatus === 'approved'
    && knowledge.publishTarget !== 'case-history-only'
    && !knowledgeLocked
  );

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
    <div className="esc-detail-shell">
      {/* Header */}
      <div className="esc-detail-header">
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

      {/* Two-column layout: escalation info (scrollable) + chat transcript (fixed) */}
      <div className="esc-detail-columns">

        {/* Left: Escalation details — independently scrollable */}
        <div className="esc-detail-left">
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
                  <Tooltip key={s} text={`Change status to ${STATUS_LABELS[s]}`} level="medium">
                    <button
                      className={`btn btn-sm ${s === 'resolved' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => handleStatusChange(s)}
                      type="button"
                    >
                      {STATUS_LABELS[s]}
                    </button>
                  </Tooltip>
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

          <div className="card" ref={knowledgeSectionRef}>
            {/* Auto-generation banner -- shown after resolving when a draft is being created */}
            {autoGenBanner && (
              <div style={{
                padding: 'var(--sp-3) var(--sp-4)',
                marginBottom: 'var(--sp-4)',
                borderRadius: 'var(--radius-md)',
                background: autoGenBanner === 'done'
                  ? 'var(--success-bg, rgba(65, 164, 102, 0.12))'
                  : 'var(--warning-bg, rgba(234, 179, 8, 0.12))',
                border: `1px solid ${autoGenBanner === 'done' ? 'var(--success, #41a466)' : 'var(--warning, #eab308)'}`,
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--sp-3)',
                fontSize: 'var(--text-sm)',
                lineHeight: 1.5,
                color: 'var(--ink)',
              }}>
                {autoGenBanner === 'generating' && <span className="spinner spinner-sm" />}
                <span style={{ fontWeight: 600 }}>
                  {autoGenBanner === 'generating'
                    ? 'Case resolved — generating a knowledge draft from your resolution...'
                    : 'Knowledge draft ready — review and approve it below, then publish to the playbook.'}
                </span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
              <div>
                <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, margin: 0 }}>Knowledge Promotion</h2>
                <div className="text-secondary" style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--sp-1)' }}>
                  Turn a confirmed case into reviewed reusable knowledge.
                </div>
              </div>
              {knowledge && (
                <span className={`badge ${knowledge.reviewStatus === 'published' ? 'badge-resolved' : knowledge.reviewStatus === 'approved' ? 'badge-progress' : ''}`}>
                  {knowledge.reviewStatus}
                </span>
              )}
            </div>

            {!knowledgeEligible ? (
              <div className="text-secondary" style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
                Resolve or escalate this case further first. The reviewed knowledge draft is only available once the case outcome is final enough to review.
              </div>
            ) : !knowledge ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                <div className="text-secondary" style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
                  Generate a draft from the escalation details and your resolution notes. You can review and edit it before publishing anything to the playbook.
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleGenerateKnowledge(false)}
                    disabled={knowledgeBusy}
                    type="button"
                  >
                    {knowledgeBusy ? 'Generating...' : 'Generate Draft'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
                {knowledgeNotice && (
                  <div style={{
                    padding: 'var(--sp-2) var(--sp-3)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-sunken)',
                    color: 'var(--ink-secondary)',
                    fontSize: 'var(--text-sm)',
                  }}>
                    {knowledgeNotice}
                  </div>
                )}

                {knowledge.publishedDocPath && (
                  <div style={{
                    padding: 'var(--sp-2) var(--sp-3)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-sunken)',
                    fontSize: 'var(--text-sm)',
                    lineHeight: 1.6,
                  }}>
                    Published to <span className="mono">{knowledge.publishedDocPath}</span>
                    {knowledge.publishedAt && (
                      <> on {new Date(knowledge.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</>
                    )}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-3)' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                    <span className="eyebrow">Review Status</span>
                    <select
                      value={knowledge.reviewStatus || 'draft'}
                      onChange={(e) => handleKnowledgeFieldChange('reviewStatus', e.target.value)}
                      disabled={knowledgeBusy || knowledgeLocked}
                    >
                      {KNOWLEDGE_REVIEW_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                    <span className="eyebrow">Publish Target</span>
                    <select
                      value={knowledge.publishTarget || 'case-history-only'}
                      onChange={(e) => handleKnowledgeFieldChange('publishTarget', e.target.value)}
                      disabled={knowledgeBusy || knowledgeLocked}
                    >
                      {KNOWLEDGE_TARGET_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                    <span className="eyebrow">Reusable Outcome</span>
                    <select
                      value={knowledge.reusableOutcome || 'case-history-only'}
                      onChange={(e) => handleKnowledgeFieldChange('reusableOutcome', e.target.value)}
                      disabled={knowledgeBusy || knowledgeLocked}
                    >
                      {KNOWLEDGE_REUSABLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                    <span className="eyebrow">Confidence</span>
                    <select
                      value={String(Number(knowledge.confidence ?? 0.6))}
                      onChange={(e) => handleKnowledgeFieldChange('confidence', Number(e.target.value))}
                      disabled={knowledgeBusy || knowledgeLocked}
                    >
                      {KNOWLEDGE_CONFIDENCE_OPTIONS.map((option) => (
                        <option key={option.label} value={String(option.value)}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                  <span className="eyebrow">Category</span>
                  <select
                    value={knowledge.category || 'unknown'}
                    onChange={(e) => handleKnowledgeFieldChange('category', e.target.value)}
                    disabled={knowledgeBusy || knowledgeLocked}
                  >
                    {KNOWLEDGE_CATEGORY_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option.replace('-', ' ')}</option>
                    ))}
                  </select>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                  <span className="eyebrow">Title</span>
                  <input
                    type="text"
                    value={knowledge.title || ''}
                    onChange={(e) => handleKnowledgeFieldChange('title', e.target.value)}
                    disabled={knowledgeBusy || knowledgeLocked}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                  <span className="eyebrow">Summary</span>
                  <textarea
                    value={knowledge.summary || ''}
                    onChange={(e) => handleKnowledgeFieldChange('summary', e.target.value)}
                    rows={2}
                    disabled={knowledgeBusy || knowledgeLocked}
                    style={{ width: '100%', resize: 'vertical' }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                  <span className="eyebrow">Symptom</span>
                  <textarea
                    value={knowledge.symptom || ''}
                    onChange={(e) => handleKnowledgeFieldChange('symptom', e.target.value)}
                    rows={2}
                    disabled={knowledgeBusy || knowledgeLocked}
                    style={{ width: '100%', resize: 'vertical' }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                  <span className="eyebrow">Root Cause</span>
                  <textarea
                    value={knowledge.rootCause || ''}
                    onChange={(e) => handleKnowledgeFieldChange('rootCause', e.target.value)}
                    rows={2}
                    disabled={knowledgeBusy || knowledgeLocked}
                    style={{ width: '100%', resize: 'vertical' }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                  <span className="eyebrow">Exact Fix</span>
                  <textarea
                    value={knowledge.exactFix || ''}
                    onChange={(e) => handleKnowledgeFieldChange('exactFix', e.target.value)}
                    rows={4}
                    disabled={knowledgeBusy || knowledgeLocked}
                    style={{ width: '100%', resize: 'vertical' }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                  <span className="eyebrow">Escalation Path</span>
                  <textarea
                    value={knowledge.escalationPath || ''}
                    onChange={(e) => handleKnowledgeFieldChange('escalationPath', e.target.value)}
                    rows={2}
                    disabled={knowledgeBusy || knowledgeLocked}
                    style={{ width: '100%', resize: 'vertical' }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                  <span className="eyebrow">Signals To Look For</span>
                  <textarea
                    value={Array.isArray(knowledge.keySignals) ? knowledge.keySignals.join('\n') : ''}
                    onChange={(e) => handleKnowledgeFieldChange('keySignals', e.target.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))}
                    rows={3}
                    disabled={knowledgeBusy || knowledgeLocked}
                    style={{ width: '100%', resize: 'vertical' }}
                    placeholder="One signal per line"
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                  <span className="eyebrow">Review Notes</span>
                  <textarea
                    value={knowledge.reviewNotes || ''}
                    onChange={(e) => handleKnowledgeFieldChange('reviewNotes', e.target.value)}
                    rows={2}
                    disabled={knowledgeBusy || knowledgeLocked}
                    style={{ width: '100%', resize: 'vertical' }}
                  />
                </label>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                  <div className="text-secondary" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.6 }}>
                    {knowledge.publishTarget === 'case-history-only'
                      ? 'Case-history-only drafts stay searchable later but are not written into the playbook.'
                      : 'Only approved drafts can be published into the playbook.'}
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                    {!knowledgeLocked && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleGenerateKnowledge(true)}
                        disabled={knowledgeBusy}
                        type="button"
                      >
                        Refresh Draft
                      </button>
                    )}
                    {!knowledgeLocked && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={handleSaveKnowledge}
                        disabled={knowledgeBusy}
                        type="button"
                      >
                        {knowledgeBusy ? 'Saving...' : 'Save Draft'}
                      </button>
                    )}
                    {knowledgeLocked ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={handleUnpublishKnowledge}
                        disabled={knowledgeBusy}
                        type="button"
                        style={{ color: 'var(--danger)' }}
                      >
                        {knowledgeBusy ? 'Unpublishing...' : 'Unpublish'}
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={handlePublishKnowledge}
                        disabled={!knowledgeCanPublish || knowledgeBusy}
                        type="button"
                      >
                        {knowledgeBusy ? 'Publishing...' : 'Publish'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, marginBottom: 'var(--sp-3)' }}>Screenshots</h2>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
              <span className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
                Attach screenshots for this escalation record.
              </span>
              <Tooltip text="Upload a screenshot of the issue" level="medium">
                <label className="btn btn-secondary btn-sm" style={{ cursor: uploadingScreenshots ? 'default' : 'pointer' }}>
                  {uploadingScreenshots ? 'Uploading...' : 'Upload'}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleUploadScreenshots}
                    style={{ display: 'none' }}
                    disabled={uploadingScreenshots}
                  />
                </label>
              </Tooltip>
            </div>

            {Array.isArray(escalation.screenshotPaths) && escalation.screenshotPaths.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 'var(--sp-3)' }}>
                {escalation.screenshotPaths.map((relativePath) => {
                  const fileName = relativePath.split('/').pop();
                  const src = `/uploads/${relativePath}`;
                  return (
                    <div key={relativePath} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                      <a href={src} target="_blank" rel="noopener noreferrer">
                        <img
                          src={src}
                          alt={fileName}
                          style={{
                            width: '100%',
                            aspectRatio: '1 / 1',
                            objectFit: 'cover',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--line)',
                          }}
                        />
                      </a>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleDeleteScreenshot(fileName)}
                        type="button"
                        style={{ color: 'var(--danger)' }}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
                No screenshots attached.
              </div>
            )}
          </div>

          <div className="card">
            <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, marginBottom: 'var(--sp-3)' }}>Similar Cases</h2>
            {similarLoading ? (
              <div style={{ textAlign: 'center', padding: 'var(--sp-4)' }}>
                <span className="spinner spinner-sm" />
              </div>
            ) : similarEscalations.length === 0 ? (
              <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
                No similar escalations found yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                {similarEscalations.map((item) => (
                  <Tooltip key={item._id} text="Click to view a similar past escalation" level="high">
                    <button
                      type="button"
                      className="card card-compact card-clickable"
                      onClick={() => { window.location.hash = `#/escalations/${item._id}`; }}
                      style={{ textAlign: 'left' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-2)' }}>
                        <span className={`cat-badge cat-${item.category || 'general'}`}>
                          {(item.category || 'general').replace('-', ' ')}
                        </span>
                        <span className={`badge ${STATUS_BADGE_MAP[item.status] || ''}`} style={{ fontSize: 'var(--text-xs)' }}>
                          {STATUS_LABELS[item.status] || item.status}
                        </span>
                      </div>
                      <div className="truncate" style={{ marginTop: 'var(--sp-1)', fontSize: 'var(--text-sm)' }}>
                        {item.attemptingTo || item.actualOutcome || 'Untitled issue'}
                      </div>
                    </button>
                  </Tooltip>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Chat transcript + copilot — fixed in viewport */}
        <div className="esc-detail-right">
          <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
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
                    provider={msg.provider || conversation.provider}
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

          <CopilotPanel escalationId={escalation._id} title="Escalation Co-pilot" />
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
