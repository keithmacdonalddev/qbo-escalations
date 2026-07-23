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
import useCaseRealtime from '../hooks/useCaseRealtime.js';
import EscalationForm from './EscalationForm.jsx';
import EscalationKnowledgePanel from './EscalationKnowledgePanel.jsx';
import ChatMessage from './ChatMessage.jsx';
import CopilotPanel from './CopilotPanel.jsx';
import Tooltip from './Tooltip.jsx';
import RealtimeStatusPill from './RealtimeStatusPill.jsx';
import WorkflowLogPanel from './chat-v5/WorkflowLogPanel.jsx';
import './EscalationDashboard.css';
import {
  ESCALATION_STATUS_LABELS as LIFECYCLE_STATUS_LABELS,
  getEscalationKnowledgeLifecycle,
} from '../lib/escalationKnowledgeLifecycle.js';

const STATUS_LABELS = LIFECYCLE_STATUS_LABELS;

const STATUS_BADGE_MAP = {
  'open': 'badge-open',
  'in-progress': 'badge-progress',
  'resolved': 'badge-resolved',
  'escalated-further': 'badge-escalated',
};

// Unified workflow event log for the conversation linked to this escalation.
// Reuses the chat-v5 WorkflowLogPanel against the already-loaded conversation's
// saved caseIntake — no extra fetch, no live events. Renders nothing when the
// linked conversation has no captured pipeline runs so the card never shows an
// empty shell.
function WorkflowLogCard({ conversation }) {
  const runs = Array.isArray(conversation?.caseIntake?.runs) ? conversation.caseIntake.runs : [];
  const hasAnyEvents = runs.some((run) => Array.isArray(run?.events) && run.events.length > 0);
  if (!hasAnyEvents) return null;
  return (
    <div className="card" style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
      <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, marginBottom: 'var(--sp-3)' }}>
        Workflow Log
      </h2>
      <div className="v5-workflow-log-host">
        <WorkflowLogPanel conversation={conversation} liveEvents={{}} />
      </div>
    </div>
  );
}

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
  const [autoGenBanner, setAutoGenBanner] = useState(null);
  const [externalKnowledgeUpdate, setExternalKnowledgeUpdate] = useState(null);
  const knowledgeSectionRef = useRef(null);
  const loadGenerationRef = useRef(0);
  const knowledgeDirtyRef = useRef(false);
  const knowledgeNoticeTimerRef = useRef(0);

  const loadCase = useCallback(async ({
    background = false,
    preserveDirtyKnowledge = false,
    event = null,
  } = {}) => {
    const generation = ++loadGenerationRef.current;
    if (!background) setLoading(true);
    const [esc, draft] = await Promise.all([
      getEscalation(escalationId),
      getEscalationKnowledge(escalationId).catch((error) => {
        if (error?.status === 404) return null;
        throw error;
      }),
    ]);
    const conv = esc.conversationId
      ? await getConversation(esc.conversationId).catch(() => undefined)
      : null;
    if (generation !== loadGenerationRef.current) return;

    setEscalation(esc);
    if (conv !== undefined) setConversation(conv);
    if (preserveDirtyKnowledge && knowledgeDirtyRef.current) {
      if (!event?.entityType || event.entityType === 'knowledge') {
        setExternalKnowledgeUpdate({ draft: draft || null, event, receivedAt: Date.now() });
      }
    } else {
      setKnowledge(draft || null);
      setExternalKnowledgeUpdate(null);
    }
    setLoading(false);
  }, [escalationId]);

  // Load escalation and linked conversation
  useEffect(() => {
    let cancelled = false;
    setKnowledge(null);
    setExternalKnowledgeUpdate(null);
    knowledgeDirtyRef.current = false;
    loadCase().catch(() => {
      if (!cancelled) {
        setEscalation(null);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      loadGenerationRef.current += 1;
      if (knowledgeNoticeTimerRef.current) window.clearTimeout(knowledgeNoticeTimerRef.current);
      knowledgeNoticeTimerRef.current = 0;
    };
  }, [escalationId, loadCase]);

  const showKnowledgeNotice = useCallback((message) => {
    if (knowledgeNoticeTimerRef.current) window.clearTimeout(knowledgeNoticeTimerRef.current);
    setKnowledgeNotice(message);
    knowledgeNoticeTimerRef.current = window.setTimeout(() => {
      setKnowledgeNotice('');
      knowledgeNoticeTimerRef.current = 0;
    }, 2500);
  }, []);

  const handleStatusTransitionComplete = useCallback((result = {}) => {
    const draft = result.knowledgeDraft?.knowledge || null;
    if (draft) {
      setKnowledge(draft);
      knowledgeDirtyRef.current = false;
      setExternalKnowledgeUpdate(null);
      setAutoGenBanner('done');
      showKnowledgeNotice('KB draft created from the finished escalation');
      return;
    }
    setAutoGenBanner(null);
  }, [showKnowledgeNotice]);

  const handleGenerateKnowledge = useCallback(async (force = false) => {
    if (!escalation || knowledgeBusy) return;
    setKnowledgeBusy(true);
    try {
      const draft = await generateEscalationKnowledge(escalation._id, { force });
      setKnowledge(draft);
      knowledgeDirtyRef.current = false;
      setExternalKnowledgeUpdate(null);
      showKnowledgeNotice(force ? 'Review draft refreshed' : 'Review draft created');
    } catch {
      toastRef.current.error('Failed to create KB draft');
    }
    setKnowledgeBusy(false);
  }, [escalation, knowledgeBusy, showKnowledgeNotice]);

  const handleKnowledgeFieldChange = useCallback((field, value) => {
    knowledgeDirtyRef.current = true;
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
        customerGoal: knowledge.customerGoal,
        reportedProblem: knowledge.reportedProblem || knowledge.symptom,
        evidenceFromCase: knowledge.evidenceFromCase,
        troubleshootingTried: knowledge.troubleshootingTried,
        confirmedCause: knowledge.confirmedCause || knowledge.rootCause,
        finalOutcome: knowledge.finalOutcome || knowledge.exactFix,
        invEscalationStatus: knowledge.invEscalationStatus,
        importantBoundaries: Array.isArray(knowledge.importantBoundaries)
          ? knowledge.importantBoundaries
          : String(knowledge.importantBoundaries || '').split(/\r?\n/),
        symptom: knowledge.reportedProblem || knowledge.symptom,
        rootCause: knowledge.confirmedCause || knowledge.rootCause,
        exactFix: knowledge.finalOutcome || knowledge.exactFix,
        escalationPath: knowledge.escalationPath,
        keySignals: Array.isArray(knowledge.keySignals)
          ? knowledge.keySignals
          : String(knowledge.keySignals || '').split(/\r?\n/),
        confidence: knowledge.confidence,
        reviewNotes: knowledge.reviewNotes,
      });
      setKnowledge(updated);
      knowledgeDirtyRef.current = false;
      setExternalKnowledgeUpdate(null);
      showKnowledgeNotice('Review draft saved');
    } catch {
      toastRef.current.error('Failed to save KB draft');
    }
    setKnowledgeBusy(false);
  }, [escalation, knowledge, knowledgeBusy, showKnowledgeNotice]);

  const handlePublishKnowledge = useCallback(async () => {
    if (!escalation || !knowledge || knowledgeBusy) return;
    setKnowledgeBusy(true);
    try {
      const result = await publishEscalationKnowledge(escalation._id);
      setKnowledge(result.knowledge);
      knowledgeDirtyRef.current = false;
      setExternalKnowledgeUpdate(null);
      showKnowledgeNotice(result.publish?.inserted === false ? 'Already published for agents' : 'Published for agents');
    } catch {
      toastRef.current.error('Failed to publish for agents');
    }
    setKnowledgeBusy(false);
  }, [escalation, knowledge, knowledgeBusy, showKnowledgeNotice]);

  const handleUnpublishKnowledge = useCallback(async () => {
    if (!escalation || !knowledge || knowledgeBusy) return;
    if (!window.confirm('Unpublish this knowledge record? Agents will stop using it, and it will return to review.')) return;
    setKnowledgeBusy(true);
    try {
      const result = await unpublishEscalationKnowledge(escalation._id);
      setKnowledge(result.knowledge);
      knowledgeDirtyRef.current = false;
      setExternalKnowledgeUpdate(null);
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

  const syncLiveCase = useCallback(async ({ event } = {}) => {
    if (event?.entityType === 'knowledge' && event?.action === 'failed') return;
    const hadDirtyKnowledge = knowledgeDirtyRef.current;
    try {
      await loadCase({
        background: true,
        preserveDirtyKnowledge: true,
        event,
      });
    } catch (error) {
      if (event?.entityType === 'escalation' && event?.action === 'deleted') {
        setEscalation(null);
        setKnowledge(null);
        setConversation(null);
        return;
      }
      throw error;
    }
    if (event?.entityType === 'knowledge' && !hadDirtyKnowledge) {
      showKnowledgeNotice(event.action === 'failed'
        ? 'Knowledge drafting needs attention'
        : 'Knowledge updated from live case activity');
    }
  }, [loadCase, showKnowledgeNotice]);

  const handleLiveCaseEvent = useCallback((eventType, event) => {
    if (eventType === 'knowledge.failed') {
      toastRef.current.warning('Knowledge drafting could not finish for this case.', {
        groupKey: `knowledge:${event?.entityId || escalationId}:failed`,
      });
    }
  }, [escalationId]);

  const realtime = useCaseRealtime({
    escalationId,
    onSync: syncLiveCase,
    onCaseEvent: handleLiveCaseEvent,
  });

  const acceptExternalKnowledgeUpdate = useCallback(() => {
    if (!externalKnowledgeUpdate) return;
    setKnowledge(externalKnowledgeUpdate.draft || null);
    knowledgeDirtyRef.current = false;
    setExternalKnowledgeUpdate(null);
    showKnowledgeNotice('Loaded the latest knowledge changes');
  }, [externalKnowledgeUpdate, showKnowledgeNotice]);

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
  }, [escalation?._id, escalation?.category, escalation?.status]);

  // Every case is eligible for a KB draft now — drafts auto-create from the
  // pipeline regardless of status, and the reviewer can refresh/edit at any
  // stage. The resolve-status gate is no longer the on-ramp into the KB queue.
  const knowledgeEligible = Boolean(escalation);
  const knowledgeCanPublish = Boolean(
    knowledge
    && knowledge.reviewStatus === 'approved'
    && knowledge.publishTarget !== 'case-history-only'
    && knowledge.reviewStatus !== 'published'
  );
  const lifecycle = getEscalationKnowledgeLifecycle({ escalation, knowledge });

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
          <button className="btn btn-secondary" onClick={() => { window.location.hash = '#/escalations'; }} type="button">
            Back to Escalations
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
            onClick={() => { window.location.hash = '#/escalations'; }}
            type="button"
          >
            &larr; Escalations
          </button>
          <h1 className="page-title" style={{ margin: 0 }}>
            Escalation Case
          </h1>
        </div>
        <div className="esc-detail-header-actions">
          <RealtimeStatusPill realtime={realtime} />
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

      {externalKnowledgeUpdate && (
        <div className="esc-live-conflict" role="status">
          <span className="esc-live-conflict-icon" aria-hidden="true">↻</span>
          <span>
            <strong>Newer knowledge changes are available.</strong>
            Your unsaved review text has been kept in place.
          </span>
          <button className="btn btn-secondary btn-sm" type="button" onClick={acceptExternalKnowledgeUpdate}>
            Replace with latest
          </button>
        </div>
      )}

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

          <details className="esc-detail-secondary">
            <summary>Optional: create agent guidance after the outcome is proven</summary>
            <EscalationKnowledgePanel
              ref={knowledgeSectionRef}
              knowledgeEligible={knowledgeEligible}
              knowledge={knowledge}
              knowledgeBusy={knowledgeBusy}
              knowledgeNotice={knowledgeNotice}
              autoGenBanner={autoGenBanner}
              canPublish={knowledgeCanPublish}
              lifecycle={lifecycle}
              onGenerateKnowledge={handleGenerateKnowledge}
              onKnowledgeFieldChange={handleKnowledgeFieldChange}
              onSaveKnowledge={handleSaveKnowledge}
              onPublishKnowledge={handlePublishKnowledge}
              onUnpublishKnowledge={handleUnpublishKnowledge}
            />
          </details>

          <details className="esc-detail-secondary">
            <summary>Screenshots</summary>
            <div className="card esc-attachments-card">
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
          </details>

          <details className="esc-detail-secondary">
            <summary>Similar cases</summary>
            <div className="card esc-similar-card">
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
                        className="esc-similar-case-card"
                        onClick={() => { window.location.hash = `#/escalations/${item._id}`; }}
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
          </details>
        </div>

        {/* Right: Chat transcript + copilot — fixed in viewport */}
        <div className="esc-detail-right">
          <details className="esc-detail-secondary" open>
            <summary>Linked chat evidence</summary>
            <div className="card esc-transcript-card">
              {conversation && conversation.messages && conversation.messages.length > 0 ? (
                <div className="esc-transcript-list">
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
          </details>

          {conversation?.caseIntake?.runs?.some((run) => Array.isArray(run?.events) && run.events.length > 0) ? (
            <details className="esc-detail-secondary">
              <summary>Workflow log</summary>
              <WorkflowLogCard conversation={conversation} />
            </details>
          ) : null}

          <details className="esc-detail-secondary">
            <summary>Agent help</summary>
            <div className="esc-copilot-wrap">
              <CopilotPanel escalationId={escalation._id} title="Escalation Co-pilot" />
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
