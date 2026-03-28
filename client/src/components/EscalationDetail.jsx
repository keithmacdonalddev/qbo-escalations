import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getEscalation,
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
import EscalationForm from './EscalationForm.jsx';
import EscalationKnowledgePanel from './EscalationKnowledgePanel.jsx';
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

export default function EscalationDetail({ escalationId }) {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [escalation, setEscalation] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [loading, setLoading] = useState(true);
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

  const handleStatusTransitionComplete = useCallback(async ({ updated, knowledgeEligible }) => {
    if (!knowledgeEligible) return;
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
  }, [generateEscalationKnowledge, knowledgeSectionRef, setAutoGenBanner, setKnowledge, setKnowledgeBusy, toastRef]);

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
  const knowledgeCanPublish = Boolean(
    knowledge
    && knowledge.reviewStatus === 'approved'
    && knowledge.publishTarget !== 'case-history-only'
    && knowledge.reviewStatus !== 'published'
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
          <EscalationForm
            escalation={escalation}
            statusLabels={STATUS_LABELS}
            statusBadgeMap={STATUS_BADGE_MAP}
            onEscalationUpdate={setEscalation}
            onStatusTransitionComplete={handleStatusTransitionComplete}
          />

          <EscalationKnowledgePanel
            ref={knowledgeSectionRef}
            knowledgeEligible={knowledgeEligible}
            knowledge={knowledge}
            knowledgeBusy={knowledgeBusy}
            knowledgeNotice={knowledgeNotice}
            autoGenBanner={autoGenBanner}
            canPublish={knowledgeCanPublish}
            onGenerateKnowledge={handleGenerateKnowledge}
            onKnowledgeFieldChange={handleKnowledgeFieldChange}
            onSaveKnowledge={handleSaveKnowledge}
            onPublishKnowledge={handlePublishKnowledge}
            onUnpublishKnowledge={handleUnpublishKnowledge}
          />

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
