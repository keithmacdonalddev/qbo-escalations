import { useEffect, useState } from 'react';
import { getKnowledgeGaps } from '../api/escalationsApi.js';
import ConfirmModal from './ConfirmModal.jsx';
import Tooltip from './Tooltip.jsx';
import EscalationCard from './EscalationCard.jsx';
import useEscalations, {
  ATTENTION_STATUS_LABELS,
  ESCALATION_CATEGORIES,
  ESCALATION_STATUSES,
  ESCALATION_STATUS_LABELS,
  REVIEW_STATUS_COLORS,
  REVIEW_STATUS_LABELS,
} from '../hooks/useEscalations.js';
import './EscalationDashboard.css';

export default function EscalationDashboard() {
  const {
    activeTab,
    setActiveTab,
    escalations,
    total,
    summary,
    statusFilter,
    setStatusFilter,
    categoryFilter,
    setCategoryFilter,
    search,
    setSearch,
    loading,
    loadError,
    kqCandidates,
    kqTotal,
    kqCounts,
    kqStatusFilter,
    setKqStatusFilter,
    kqCategoryFilter,
    setKqCategoryFilter,
    kqLoading,
    kqError,
    kqTotalAll,
    attentionItems,
    attentionTotal,
    attentionCounts,
    attentionStatusFilter,
    setAttentionStatusFilter,
    attentionLoading,
    attentionError,
    attentionTotalAll,
    attentionUpdatingId,
    handleAttentionStatusChange,
    requestDelete,
    deleteTarget,
    confirmDelete,
    cancelDelete,
    handleStatusChange,
    refresh,
  } = useEscalations();

  const [gaps, setGaps] = useState(null);
  const [gapsOpen, setGapsOpen] = useState(false);
  const [gapsDays, setGapsDays] = useState(30);

  useEffect(() => {
    getKnowledgeGaps(gapsDays)
      .then(d => setGaps(d))
      .catch(() => setGaps(null));
  }, [gapsDays]);

  return (
    <div className="app-content-constrained">
      <div className="page-header">
        <h1 className="page-title">Escalation Dashboard</h1>
        <span className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
          {activeTab === 'escalations'
            ? 'All parsed escalations — filter, search, and track resolution status.'
            : activeTab === 'attention'
              ? 'Review workflow items that need a decision.'
              : 'Review and track AI-generated knowledge drafts across all escalations.'}
        </span>
        <Tooltip text={activeTab === 'escalations' ? 'Reload escalation data' : activeTab === 'attention' ? 'Reload attention queue' : 'Reload knowledge queue'} level="medium">
          <button className="btn btn-secondary" onClick={refresh} type="button">
            Refresh
          </button>
        </Tooltip>
      </div>

      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-6)', borderBottom: '1px solid var(--border)' }}>
        <button
          type="button"
          onClick={() => setActiveTab('escalations')}
          style={{
            padding: 'var(--sp-3) var(--sp-5)',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'escalations' ? '2px solid var(--accent)' : '2px solid transparent',
            color: activeTab === 'escalations' ? 'var(--ink-primary)' : 'var(--ink-secondary)',
            fontWeight: activeTab === 'escalations' ? 600 : 400,
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            transition: 'color 0.15s, border-color 0.15s',
          }}
        >
          Escalations
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('attention')}
          style={{
            padding: 'var(--sp-3) var(--sp-5)',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'attention' ? '2px solid var(--accent)' : '2px solid transparent',
            color: activeTab === 'attention' ? 'var(--ink-primary)' : 'var(--ink-secondary)',
            fontWeight: activeTab === 'attention' ? 600 : 400,
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            transition: 'color 0.15s, border-color 0.15s',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-2)',
          }}
        >
          Attention
          {attentionTotalAll > 0 && (
            <span style={{
              background: attentionCounts.open > 0 ? 'var(--warning, #eab308)' : 'var(--surface-raised, var(--bg-secondary))',
              color: attentionCounts.open > 0 ? '#111827' : 'var(--ink-secondary)',
              fontSize: 'var(--text-xs)',
              borderRadius: '999px',
              padding: '1px 7px',
              fontWeight: 700,
              minWidth: 20,
              textAlign: 'center',
            }}>
              {attentionCounts.open || attentionTotalAll}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('knowledge')}
          style={{
            padding: 'var(--sp-3) var(--sp-5)',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'knowledge' ? '2px solid var(--accent)' : '2px solid transparent',
            color: activeTab === 'knowledge' ? 'var(--ink-primary)' : 'var(--ink-secondary)',
            fontWeight: activeTab === 'knowledge' ? 600 : 400,
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            transition: 'color 0.15s, border-color 0.15s',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-2)',
          }}
        >
          Knowledge Queue
          {kqTotalAll > 0 && (
            <span style={{
              background: kqCounts.draft > 0 ? 'var(--accent)' : 'var(--surface-raised, var(--bg-secondary))',
              color: kqCounts.draft > 0 ? '#fff' : 'var(--ink-secondary)',
              fontSize: 'var(--text-xs)',
              borderRadius: '999px',
              padding: '1px 7px',
              fontWeight: 600,
              minWidth: 20,
              textAlign: 'center',
            }}>
              {kqTotalAll}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'escalations' && (
        <>
          {loadError && (
            <div className="error-banner">
              <span>{loadError}</span>
              <button onClick={refresh} type="button">Retry</button>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--sp-5)', marginBottom: 'var(--sp-8)' }}>
            <StatCard label="Open" value={summary?.open ?? '--'} />
            <StatCard label="In Progress" value={summary?.inProgress ?? '--'} />
            <StatCard label="Resolved" value={summary?.resolved ?? '--'} />
            <StatCard label="Escalated" value={summary?.escalated ?? '--'} />
            <StatCard label="Avg Resolution" value={summary?.avgResolutionHours != null ? `${summary.avgResolutionHours}h` : '--'} />
          </div>

          {gaps && gaps.gaps && gaps.gaps.length > 0 && (
            <div className="knowledge-gaps">
              <button
                className="kg-toggle"
                onClick={() => setGapsOpen(prev => !prev)}
                type="button"
              >
                <span className="kg-toggle-label">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  Knowledge Gaps
                  <span className="kg-count">
                    {gaps.gaps.filter(g => g.gapScore < 50).length} need attention
                  </span>
                </span>
                <span className="kg-toggle-controls">
                  <select
                    value={gapsDays}
                    onChange={(e) => { e.stopPropagation(); setGapsDays(Number(e.target.value)); }}
                    onClick={(e) => e.stopPropagation()}
                    className="kg-days-select"
                  >
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                    <option value={30}>30 days</option>
                    <option value={60}>60 days</option>
                    <option value={90}>90 days</option>
                  </select>
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: gapsOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </button>
              {gapsOpen && (
                <div className="kg-body">
                  {gaps.gaps.map(g => (
                    <div key={g.category} className="kg-card">
                      <span className={`kg-score ${g.gapScore < 40 ? 'critical' : g.gapScore < 70 ? 'warning' : 'good'}`}>
                        {g.gapScore}
                      </span>
                      <div className="kg-info">
                        <div className="kg-category">
                          {g.category.replace(/-/g, ' ')}
                          {g.hasPlaybook ? (
                            <span className="kg-playbook-badge has" title="Has playbook coverage">PB</span>
                          ) : (
                            <span className="kg-playbook-badge missing" title="No playbook for this category">No PB</span>
                          )}
                        </div>
                        <div className="kg-meta">
                          <span>{g.resolutionRate}% resolved</span>
                          <span>{g.total} total</span>
                          {g.longConversations.length > 0 && (
                            <span>{g.longConversations.length} long convo{g.longConversations.length !== 1 ? 's' : ''}</span>
                          )}
                          {g.uncertainPhrases > 0 && (
                            <span>{g.uncertainPhrases} uncertain response{g.uncertainPhrases !== 1 ? 's' : ''}</span>
                          )}
                          {g.escalatedFurther > 0 && (
                            <span>{g.escalatedFurther} re-escalated</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {gaps.unusedCategories && gaps.unusedCategories.length > 0 && (
                    <div className="kg-unused">
                      <span className="kg-unused-label">Playbook categories with no escalations:</span>
                      {gaps.unusedCategories.map(c => (
                        <span key={c} className="kg-unused-tag">{c}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ marginBottom: 'var(--sp-5)' }}>
            <div className="filter-bar" style={{ border: 'none', padding: 0 }}>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
                style={{ width: 'auto', minWidth: 140 }}
              >
                {ESCALATION_STATUSES.map(s => (
                  <option key={s} value={s}>{ESCALATION_STATUS_LABELS[s] || s}</option>
                ))}
              </select>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label="Filter by category"
                style={{ width: 'auto', minWidth: 140 }}
              >
                <option value="">All Categories</option>
                {ESCALATION_CATEGORIES.slice(1).map(c => (
                  <option key={c} value={c}>{c.replace('-', ' ')}</option>
                ))}
              </select>
              <input
                type="search"
                placeholder="Search escalations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ minWidth: 200 }}
              />
              <span className="text-secondary" style={{ fontSize: 'var(--text-xs)', alignSelf: 'center' }}>
                {total} result{total !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {loading ? (
              <div style={{ padding: 'var(--sp-8)', textAlign: 'center' }}>
                <span className="spinner" />
              </div>
            ) : escalations.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">No Escalations Found</div>
                <div className="empty-state-desc">
                  {search || statusFilter || categoryFilter
                    ? 'Try adjusting your filters.'
                    : 'Escalations appear here when you paste a screenshot into the chat — the AI parses it automatically. You can also create them manually in conversation.'}
                </div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Category</th>
                      <th>Agent</th>
                      <th>Issue</th>
                      <th>COID</th>
                      <th>Created</th>
                      <th style={{ width: 80 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {escalations.map(esc => (
                      <EscalationCard
                        key={esc._id}
                        escalation={esc}
                        onOpen={() => {
                          window.location.hash = `#/escalations/${esc._id}`;
                        }}
                        onChangeStatus={handleStatusChange}
                        onDelete={requestDelete}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <ConfirmModal
            open={deleteTarget !== null}
            title="Delete Escalation"
            message="This escalation will be permanently deleted. This cannot be undone."
            confirmLabel="Delete"
            danger={true}
            onConfirm={confirmDelete}
            onCancel={cancelDelete}
          />
        </>
      )}

      {activeTab === 'attention' && (
        <>
          {attentionError && (
            <div className="error-banner">
              <span>{attentionError}</span>
              <button onClick={refresh} type="button">Retry</button>
            </div>
          )}

          <div className="attention-status-grid">
            {['open', 'resolved', 'split', 'dismissed'].map(status => (
              <button
                key={status}
                type="button"
                onClick={() => setAttentionStatusFilter(attentionStatusFilter === status ? 'all' : status)}
                className={`attention-status-tile${attentionStatusFilter === status ? ' is-active' : ''}`}
              >
                <span className="attention-status-value">{attentionCounts[status] || 0}</span>
                <span className="attention-status-label">{ATTENTION_STATUS_LABELS[status]}</span>
              </button>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 'var(--sp-5)' }}>
            <div className="filter-bar" style={{ border: 'none', padding: 0 }}>
              <select
                value={attentionStatusFilter}
                onChange={(e) => setAttentionStatusFilter(e.target.value)}
                aria-label="Filter by attention status"
                style={{ width: 'auto', minWidth: 150 }}
              >
                <option value="open">Open</option>
                <option value="all">All Items</option>
                <option value="resolved">Handled</option>
                <option value="split">Separate</option>
                <option value="dismissed">Dismissed</option>
              </select>
              <span className="text-secondary" style={{ fontSize: 'var(--text-xs)', alignSelf: 'center' }}>
                {attentionTotal} item{attentionTotal !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          <div className="card attention-list-card">
            {attentionLoading ? (
              <div style={{ padding: 'var(--sp-8)', textAlign: 'center' }}>
                <span className="spinner" />
              </div>
            ) : attentionItems.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">No Attention Items</div>
                <div className="empty-state-desc">
                  {attentionStatusFilter === 'open'
                    ? 'Open review items appear here when the workflow finds something that needs a decision.'
                    : 'No items match this status filter.'}
                </div>
              </div>
            ) : (
              <div className="attention-list">
                {attentionItems.map(item => (
                  <AttentionItemRow
                    key={item._id}
                    item={item}
                    busy={attentionUpdatingId === item._id}
                    onStatusChange={handleAttentionStatusChange}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'knowledge' && (
        <>
          {kqError && (
            <div className="error-banner">
              <span>{kqError}</span>
              <button onClick={refresh} type="button">Retry</button>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 'var(--sp-5)', marginBottom: 'var(--sp-8)' }}>
            {['draft', 'approved', 'published', 'rejected'].map(st => (
              <button
                key={st}
                type="button"
                onClick={() => setKqStatusFilter(kqStatusFilter === st ? '' : st)}
                style={{
                  cursor: 'pointer',
                  border: kqStatusFilter === st ? `2px solid ${REVIEW_STATUS_COLORS[st]}` : '2px solid transparent',
                  borderRadius: 'var(--radius, 8px)',
                  background: 'none',
                  padding: 0,
                }}
              >
                <div className="stat-card" style={{ margin: 0 }}>
                  <div className="stat-card-value" style={{ color: REVIEW_STATUS_COLORS[st] }}>
                    {kqCounts[st]}
                  </div>
                  <div className="stat-card-label">{REVIEW_STATUS_LABELS[st]}</div>
                </div>
              </button>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 'var(--sp-5)' }}>
            <div className="filter-bar" style={{ border: 'none', padding: 0 }}>
              <select
                value={kqStatusFilter}
                onChange={(e) => setKqStatusFilter(e.target.value)}
                aria-label="Filter by review status"
                style={{ width: 'auto', minWidth: 140 }}
              >
                <option value="">All Statuses</option>
                {Object.entries(REVIEW_STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <select
                value={kqCategoryFilter}
                onChange={(e) => setKqCategoryFilter(e.target.value)}
                aria-label="Filter by category"
                style={{ width: 'auto', minWidth: 140 }}
              >
                <option value="">All Categories</option>
                {ESCALATION_CATEGORIES.slice(1).map(c => (
                  <option key={c} value={c}>{c.replace('-', ' ')}</option>
                ))}
              </select>
              <span className="text-secondary" style={{ fontSize: 'var(--text-xs)', alignSelf: 'center' }}>
                {kqTotal} result{kqTotal !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {kqLoading ? (
              <div style={{ padding: 'var(--sp-8)', textAlign: 'center' }}>
                <span className="spinner" />
              </div>
            ) : kqCandidates.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">No Knowledge Candidates</div>
                <div className="empty-state-desc">
                  {kqStatusFilter || kqCategoryFilter
                    ? 'Try adjusting your filters.'
                    : 'Knowledge drafts are generated when escalations are resolved. Resolve an escalation to see candidates here.'}
                </div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Review Status</th>
                      <th>Title</th>
                      <th>Category</th>
                      <th>Confidence</th>
                      <th>Case ID</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kqCandidates.map(kc => {
                      const esc = kc.escalationId;
                      const escId = typeof esc === 'object' ? esc?._id : esc;
                      return (
                        <tr
                          key={kc._id}
                          className="table-clickable-row"
                          onClick={() => {
                            if (escId) window.location.hash = `#/escalations/${escId}`;
                          }}
                          style={{ cursor: escId ? 'pointer' : 'default' }}
                        >
                          <td>
                            <span
                              className="badge"
                              style={{
                                color: REVIEW_STATUS_COLORS[kc.reviewStatus] || 'var(--ink-secondary)',
                                borderColor: REVIEW_STATUS_COLORS[kc.reviewStatus] || 'var(--border)',
                                fontSize: 'var(--text-xs)',
                              }}
                            >
                              {REVIEW_STATUS_LABELS[kc.reviewStatus] || kc.reviewStatus}
                            </span>
                          </td>
                          <td className="truncate" style={{ maxWidth: 280 }}>
                            {kc.title || kc.summary?.slice(0, 60) || '--'}
                          </td>
                          <td>
                            <span className={`cat-badge cat-${kc.category || 'general'}`}>
                              {(kc.category || 'unknown').replace(/-/g, ' ')}
                            </span>
                          </td>
                          <td>
                            <span style={{
                              fontWeight: 600,
                              fontSize: 'var(--text-xs)',
                              color: kc.confidence >= 0.8 ? 'var(--success, #22c55e)' : kc.confidence >= 0.5 ? 'var(--warning, #eab308)' : 'var(--danger)',
                            }}>
                              {Math.round(kc.confidence * 100)}%
                            </span>
                          </td>
                          <td>
                            <span className="mono" style={{ fontSize: 'var(--text-xs)' }}>
                              {(typeof esc === 'object' ? esc?.caseNumber || esc?.coid : null) || '--'}
                            </span>
                          </td>
                          <td style={{ whiteSpace: 'nowrap', fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)' }}>
                            {new Date(kc.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function getEscalationRefId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value._id || '';
}

function getEscalationLabel(value) {
  if (!value || typeof value !== 'object') return 'Escalation';
  return value.caseNumber || value.coid || value.category || 'Escalation';
}

function formatSignals(signals = []) {
  return signals
    .map(signal => signal.replace(/_/g, ' '))
    .slice(0, 4)
    .join(', ');
}

function formatAttentionDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function AttentionItemRow({ item, busy, onStatusChange }) {
  const sourceId = getEscalationRefId(item.sourceEscalationId);
  const sourceConversationId = getEscalationRefId(item.sourceConversationId);
  const sourceAgentId = item.sourceType === 'agent' && item.metadata?.agentId
    ? String(item.metadata.agentId)
    : '';
  const candidates = Array.isArray(item.candidates) ? item.candidates : [];
  const primaryCandidate = candidates[0] || null;
  const candidateId = primaryCandidate ? getEscalationRefId(primaryCandidate.escalationId) : '';
  const isOpen = item.status === 'open';
  const isDuplicate = item.kind === 'possible-duplicate';
  let handledNote = 'Workflow review item handled.';
  if (isDuplicate) handledNote = 'Duplicate warning handled.';
  else if (sourceAgentId) handledNote = 'Agent attention item handled.';
  else if (item.kind === 'missing-link') handledNote = 'Link review item handled.';

  return (
    <div className="attention-item">
      <div className="attention-item-main">
        <div className="attention-item-header">
          <span className={`attention-severity attention-severity-${item.severity || 'info'}`}>
            {item.severity || 'info'}
          </span>
          <span className="attention-title">{item.title || 'Workflow review item'}</span>
          <span className="attention-date">{formatAttentionDate(item.updatedAt || item.createdAt)}</span>
        </div>
        <div className="attention-summary">{item.summary || 'Review this workflow item.'}</div>
        <div className="attention-meta">
          <span>Source: {item.sourceLabel || getEscalationLabel(item.sourceEscalationId)}</span>
          {primaryCandidate && (
            <span>Candidate: {getEscalationLabel(primaryCandidate.escalationId)} ({primaryCandidate.score || 0})</span>
          )}
          {item.signals?.length > 0 && <span>{formatSignals(item.signals)}</span>}
        </div>
      </div>
      <div className="attention-actions">
        {sourceId && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => { window.location.hash = `#/escalations/${sourceId}`; }}
          >
            Review
          </button>
        )}
        {sourceAgentId && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => { window.location.hash = `#/agents/${encodeURIComponent(sourceAgentId)}`; }}
          >
            Review Agent
          </button>
        )}
        {sourceConversationId && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => { window.location.hash = `#/chat/${encodeURIComponent(sourceConversationId)}`; }}
          >
            Open Chat
          </button>
        )}
        {candidateId && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => { window.location.hash = `#/escalations/${candidateId}`; }}
          >
            Candidate
          </button>
        )}
        {isOpen ? (
          <>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={() => onStatusChange(
                item._id,
                'resolved',
                handledNote
              )}
            >
              Handled
            </button>
            {isDuplicate && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() => onStatusChange(item._id, 'split', 'Confirmed as separate escalation.')}
              >
                Separate
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => onStatusChange(item._id, 'dismissed', 'Dismissed by reviewer.')}
            >
              Dismiss
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => onStatusChange(item._id, 'open', '')}
          >
            Reopen
          </button>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="stat-card">
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
    </div>
  );
}
