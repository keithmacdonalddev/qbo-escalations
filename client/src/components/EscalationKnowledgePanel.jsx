import { forwardRef } from 'react';

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

function EscalationKnowledgePanel(
  {
    knowledgeEligible,
    knowledge,
    knowledgeBusy,
    knowledgeNotice,
    autoGenBanner,
    canPublish,
    onGenerateKnowledge,
    onKnowledgeFieldChange,
    onSaveKnowledge,
    onPublishKnowledge,
    onUnpublishKnowledge,
  },
  ref,
) {
  const knowledgeLocked = knowledge?.reviewStatus === 'published';

  return (
    <div className="card" ref={ref}>
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
              onClick={() => onGenerateKnowledge(false)}
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
                onChange={(e) => onKnowledgeFieldChange('reviewStatus', e.target.value)}
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
                onChange={(e) => onKnowledgeFieldChange('publishTarget', e.target.value)}
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
                onChange={(e) => onKnowledgeFieldChange('reusableOutcome', e.target.value)}
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
                onChange={(e) => onKnowledgeFieldChange('confidence', Number(e.target.value))}
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
              onChange={(e) => onKnowledgeFieldChange('category', e.target.value)}
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
              onChange={(e) => onKnowledgeFieldChange('title', e.target.value)}
              disabled={knowledgeBusy || knowledgeLocked}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
            <span className="eyebrow">Summary</span>
            <textarea
              value={knowledge.summary || ''}
              onChange={(e) => onKnowledgeFieldChange('summary', e.target.value)}
              rows={2}
              disabled={knowledgeBusy || knowledgeLocked}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
            <span className="eyebrow">Symptom</span>
            <textarea
              value={knowledge.symptom || ''}
              onChange={(e) => onKnowledgeFieldChange('symptom', e.target.value)}
              rows={2}
              disabled={knowledgeBusy || knowledgeLocked}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
            <span className="eyebrow">Root Cause</span>
            <textarea
              value={knowledge.rootCause || ''}
              onChange={(e) => onKnowledgeFieldChange('rootCause', e.target.value)}
              rows={2}
              disabled={knowledgeBusy || knowledgeLocked}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
            <span className="eyebrow">Exact Fix</span>
            <textarea
              value={knowledge.exactFix || ''}
              onChange={(e) => onKnowledgeFieldChange('exactFix', e.target.value)}
              rows={4}
              disabled={knowledgeBusy || knowledgeLocked}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
            <span className="eyebrow">Escalation Path</span>
            <textarea
              value={knowledge.escalationPath || ''}
              onChange={(e) => onKnowledgeFieldChange('escalationPath', e.target.value)}
              rows={2}
              disabled={knowledgeBusy || knowledgeLocked}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
            <span className="eyebrow">Signals To Look For</span>
            <textarea
              value={Array.isArray(knowledge.keySignals) ? knowledge.keySignals.join('\n') : ''}
              onChange={(e) => onKnowledgeFieldChange(
                'keySignals',
                e.target.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
              )}
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
              onChange={(e) => onKnowledgeFieldChange('reviewNotes', e.target.value)}
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
                  onClick={() => onGenerateKnowledge(true)}
                  disabled={knowledgeBusy}
                  type="button"
                >
                  Refresh Draft
                </button>
              )}
              {!knowledgeLocked && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={onSaveKnowledge}
                  disabled={knowledgeBusy}
                  type="button"
                >
                  {knowledgeBusy ? 'Saving...' : 'Save Draft'}
                </button>
              )}
              {knowledgeLocked ? (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={onUnpublishKnowledge}
                  disabled={knowledgeBusy}
                  type="button"
                  style={{ color: 'var(--danger)' }}
                >
                  {knowledgeBusy ? 'Unpublishing...' : 'Unpublish'}
                </button>
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={onPublishKnowledge}
                  disabled={!canPublish || knowledgeBusy}
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
  );
}

export default forwardRef(EscalationKnowledgePanel);
