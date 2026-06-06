import { useEffect, useState } from 'react';
import { getKnowledgeGaps } from '../api/escalationsApi.js';
import ConfirmModal from './ConfirmModal.jsx';
import Tooltip from './Tooltip.jsx';
import EscalationCard from './EscalationCard.jsx';
import KnowledgeGapsFlyout from './KnowledgeGapsFlyout.jsx';
import useEscalations, {
  ATTENTION_KIND_LABELS,
  ATTENTION_SORT_LABELS,
  ATTENTION_STATUS_LABELS,
  ESCALATION_CATEGORIES,
  ESCALATION_STATUSES,
  ESCALATION_STATUS_LABELS,
  REVIEW_STATUS_COLORS,
  REVIEW_STATUS_LABELS,
} from '../hooks/useEscalations.js';
import './EscalationDashboard.css';

const ATTENTION_KIND_ORDER = [
  'all',
  'parse-review',
  'missing-link',
  'missing-resolution',
  'stale-open',
  'knowledge-review',
  'agent-review',
  'agent-harness',
  'possible-duplicate',
];

export default function EscalationDashboard({ initialTab = 'escalations' }) {
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
    attentionKindCounts,
    attentionSeverityCounts,
    attentionRefreshMeta,
    attentionStatusFilter,
    setAttentionStatusFilter,
    attentionKindFilter,
    setAttentionKindFilter,
    attentionSort,
    setAttentionSort,
    attentionLoading,
    attentionError,
    attentionTotalAll,
    attentionUpdatingId,
    attentionSelectedIds,
    toggleAttentionSelection,
    setAllVisibleAttentionSelected,
    clearAttentionSelection,
    handleAttentionStatusChange,
    handleBulkAttentionStatusChange,
    requestDelete,
    deleteTarget,
    confirmDelete,
    cancelDelete,
    handleStatusChange,
    refresh,
  } = useEscalations({ initialTab });

  const [gaps, setGaps] = useState(null);
  const [gapsDays, setGapsDays] = useState(30);

  useEffect(() => {
    getKnowledgeGaps(gapsDays)
      .then(d => setGaps(d))
      .catch(() => setGaps(null));
  }, [gapsDays]);

  const attentionMission = buildAttentionMissionStats({
    counts: attentionCounts,
    severityCounts: attentionSeverityCounts,
    kindCounts: attentionKindCounts,
    items: attentionItems,
  });
  const attentionWorkflowRows = buildAttentionWorkflowRows(attentionKindCounts, attentionRefreshMeta);
  const recentAttentionItems = attentionItems.slice(0, 5);

  function focusAttentionKind(kind, status = 'open') {
    setActiveTab('attention');
    setAttentionStatusFilter(status);
    setAttentionKindFilter(kind);
    setAttentionSort('priority');
  }

  return (
    <div className="app-content-constrained">
      <div className="page-header">
        <h1 className="page-title">{initialTab === 'attention' ? 'Attention Center' : 'Escalations'}</h1>
        <span className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
          {activeTab === 'escalations'
            ? 'Track captured cases from intake through outcome and review.'
            : activeTab === 'attention'
              ? 'Review workflow items that need a decision.'
              : 'Review case lessons before agents can use them as trusted knowledge.'}
        </span>
        <Tooltip text={activeTab === 'escalations' ? 'Reload case data' : activeTab === 'attention' ? 'Reload attention queue' : 'Reload knowledge review'} level="medium">
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
          Knowledge Review
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
            <StatCard label="Captured" value={summary?.open ?? '--'} />
            <StatCard label="Working" value={summary?.inProgress ?? '--'} />
            <StatCard label="Resolved" value={summary?.resolved ?? '--'} />
            <StatCard label="Escalated Further" value={summary?.escalated ?? '--'} />
            <StatCard label="Avg Resolution" value={summary?.avgResolutionHours != null ? `${summary.avgResolutionHours}h` : '--'} />
          </div>

          <KnowledgeGapsFlyout
            gaps={gaps}
            gapsDays={gapsDays}
            onChangeDays={setGapsDays}
          />

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
                <div className="empty-state-title">No Cases Found</div>
                <div className="empty-state-desc">
                  {search || statusFilter || categoryFilter
                    ? 'Try adjusting your filters.'
                    : 'Cases appear here after image intake captures a structured escalation from chat. Open a case to work it, record the outcome, and create reviewed knowledge.'}
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

          <AttentionMissionStrip
            stats={attentionMission}
            onFocusKind={focusAttentionKind}
            onRefresh={refresh}
          />

          <div className="attention-command-layout">
            <div className="attention-command-main">
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

              <div className="attention-ops-panel">
                <div className="attention-ops-row">
                  <div className="attention-filter-group" aria-label="Filter attention items by type">
                    {ATTENTION_KIND_ORDER.map(kind => {
                      const count = kind === 'all'
                        ? Object.values(attentionKindCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0)
                        : (attentionKindCounts?.[kind] || 0);
                      return (
                        <button
                          type="button"
                          key={kind}
                          className={`attention-kind-chip${attentionKindFilter === kind ? ' is-active' : ''}`}
                          onClick={() => setAttentionKindFilter(kind)}
                        >
                          <span>{ATTENTION_KIND_LABELS[kind] || kind}</span>
                          <strong>{count}</strong>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="attention-ops-row attention-ops-row-secondary">
                  <div className="attention-select-group">
                    <select
                      value={attentionStatusFilter}
                      onChange={(e) => setAttentionStatusFilter(e.target.value)}
                      aria-label="Filter by attention status"
                    >
                      <option value="open">Open</option>
                      <option value="all">All Items</option>
                      <option value="resolved">Handled</option>
                      <option value="split">Separate</option>
                      <option value="dismissed">Dismissed</option>
                    </select>
                    <select
                      value={attentionSort}
                      onChange={(e) => setAttentionSort(e.target.value)}
                      aria-label="Sort attention items"
                    >
                      {Object.entries(ATTENTION_SORT_LABELS).map(([value, label]) => (
                        <option value={value} key={value}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="attention-severity-summary" aria-label="Attention severity summary">
                    <span className="attention-severity-count critical">{attentionSeverityCounts.critical || 0} critical</span>
                    <span className="attention-severity-count warning">{attentionSeverityCounts.warning || 0} warning</span>
                    <span className="attention-severity-count info">{attentionSeverityCounts.info || 0} info</span>
                  </div>

                  <span className="text-secondary attention-result-count">
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
                  <>
                    <AttentionBulkToolbar
                      itemCount={attentionItems.length}
                      selectedCount={attentionSelectedIds.length}
                      allSelected={attentionItems.length > 0 && attentionSelectedIds.length === attentionItems.length}
                      busy={attentionUpdatingId === 'bulk'}
                      onSelectAll={setAllVisibleAttentionSelected}
                      onClear={clearAttentionSelection}
                      onBulkStatusChange={handleBulkAttentionStatusChange}
                    />
                    <div className="attention-list">
                      {attentionItems.map(item => (
                        <AttentionItemRow
                          key={item._id}
                          item={item}
                          selected={attentionSelectedIds.includes(item._id)}
                          busy={attentionUpdatingId === item._id}
                          onToggleSelection={toggleAttentionSelection}
                          onStatusChange={handleAttentionStatusChange}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            <AttentionCommandRail
              mission={attentionMission}
              workflows={attentionWorkflowRows}
              recentItems={recentAttentionItems}
              onFocusKind={focusAttentionKind}
              onRefresh={refresh}
            />
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
                aria-label="Filter by review state"
                style={{ width: 'auto', minWidth: 140 }}
              >
                <option value="">All Review States</option>
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
                <div className="empty-state-title">No Review Drafts</div>
                <div className="empty-state-desc">
                  {kqStatusFilter || kqCategoryFilter
                    ? 'Try adjusting your filters.'
                    : 'Review drafts are created from resolved or escalated cases. Add the final outcome to a case, then create a review draft for knowledge review.'}
                </div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Review State</th>
                      <th>Title</th>
                      <th>Category</th>
                      <th>Confidence</th>
                      <th>Source Case</th>
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

function getAttentionDateMs(value) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatAttentionAge(value) {
  const ms = getAttentionDateMs(value);
  if (!ms) return '--';
  const elapsed = Math.max(0, Date.now() - ms);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function buildAttentionMissionStats({ counts = {}, severityCounts = {}, kindCounts = {}, items = [] } = {}) {
  const open = Number(counts.open || 0);
  const handled = Number(counts.resolved || 0) + Number(counts.split || 0) + Number(counts.dismissed || 0);
  const total = open + handled;
  const critical = Number(severityCounts.critical || 0);
  const warning = Number(severityCounts.warning || 0);
  const activeProducers = Object.entries(kindCounts || {}).filter(([, count]) => Number(count || 0) > 0).length;
  const oldest = items.reduce((candidate, item) => {
    const itemTime = getAttentionDateMs(item.lastDetectedAt || item.updatedAt || item.createdAt);
    if (!itemTime) return candidate;
    if (!candidate || itemTime < candidate) return itemTime;
    return candidate;
  }, 0);
  const handledRate = total ? Math.round((handled / total) * 100) : 100;
  const status = critical > 0 ? 'Needs review' : open > 0 ? 'Monitoring' : 'Operational';
  return {
    status,
    open,
    critical,
    warning,
    handledRate,
    activeProducers,
    oldestAge: oldest ? formatAttentionAge(oldest) : '--',
  };
}

function buildAttentionWorkflowRows(kindCounts = {}, refreshMeta = null) {
  return [
    { kind: 'parse-review', label: 'Parser Review', detail: 'Parse confidence and fallback checks', count: kindCounts['parse-review'] || 0, scanned: refreshMeta?.parserTriage?.scanned || 0 },
    { kind: 'missing-link', label: 'Link Integrity', detail: 'Escalation and conversation backlinks', count: kindCounts['missing-link'] || 0, scanned: (refreshMeta?.missingLinks?.scannedEscalations || 0) + (refreshMeta?.missingLinks?.scannedConversations || 0) },
    { kind: 'missing-resolution', label: 'Resolution Discipline', detail: 'Final notes and escalation reasons', count: kindCounts['missing-resolution'] || 0, scanned: 0 },
    { kind: 'stale-open', label: 'Stale Case Scanner', detail: 'Open and in-progress aging checks', count: kindCounts['stale-open'] || 0, scanned: refreshMeta?.stale?.scanned || 0 },
    { kind: 'knowledge-review', label: 'Knowledge Review', detail: 'Human review before agent reuse', count: kindCounts['knowledge-review'] || 0, scanned: 0 },
    { kind: 'agent-review', label: 'Agent Review', detail: 'Profile approval and follow-up checks', count: kindCounts['agent-review'] || 0, scanned: 0 },
    { kind: 'agent-harness', label: 'Agent Harness', detail: 'Harness warning and failure checks', count: kindCounts['agent-harness'] || 0, scanned: 0 },
    { kind: 'possible-duplicate', label: 'Duplicate Safety', detail: 'Likely duplicate case detection', count: kindCounts['possible-duplicate'] || 0, scanned: 0 },
  ];
}

function AttentionMissionStrip({ stats, onFocusKind, onRefresh }) {
  return (
    <div className="attention-mission-strip">
      <div className="attention-mission-status">
        <span className={`attention-engine-dot${stats.critical > 0 ? ' is-critical' : stats.open > 0 ? ' is-warning' : ''}`} />
        <div>
          <span>Workflow Engine</span>
          <strong>{stats.status}</strong>
        </div>
      </div>
      <MissionMetric label="Open Items" value={stats.open} />
      <MissionMetric label="Critical" value={stats.critical} tone={stats.critical > 0 ? 'critical' : ''} />
      <MissionMetric label="Active Producers" value={stats.activeProducers} />
      <MissionMetric label="Oldest Visible" value={stats.oldestAge} />
      <MissionMetric label="Handled Rate" value={`${stats.handledRate}%`} />
      <div className="attention-mission-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onFocusKind('parse-review')}>
          Parser
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onFocusKind('missing-link')}>
          Links
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}>
          Rescan
        </button>
      </div>
    </div>
  );
}

function MissionMetric({ label, value, tone = '' }) {
  return (
    <div className={`attention-mission-metric${tone ? ` tone-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AttentionCommandRail({ mission, workflows, recentItems, onFocusKind, onRefresh }) {
  const scanCount = workflows.reduce((sum, workflow) => sum + Number(workflow.scanned || 0), 0);
  return (
    <aside className="attention-command-rail">
      <section className="attention-rail-section">
        <div className="attention-rail-heading">
          <span>Active Workflows</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}>Scan</button>
        </div>
        <div className="attention-workflow-list">
          {workflows.map((workflow) => (
            <button
              type="button"
              key={workflow.kind}
              className={`attention-workflow-row${workflow.count > 0 ? ' has-items' : ''}`}
              onClick={() => onFocusKind(workflow.kind)}
            >
              <span>
                <strong>{workflow.label}</strong>
                <small>{workflow.detail}</small>
              </span>
              <em>{workflow.count > 0 ? workflow.count : 'OK'}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="attention-rail-section">
        <div className="attention-rail-heading">
          <span>System Health</span>
          <strong>{mission.status}</strong>
        </div>
        <div className="attention-health-meter">
          <span style={{ width: `${Math.max(4, Math.min(100, mission.handledRate))}%` }} />
        </div>
        <div className="attention-health-grid">
          <span>{mission.warning} warning</span>
          <span>{scanCount} scanned</span>
          <span>{mission.oldestAge} oldest</span>
        </div>
      </section>

      <section className="attention-rail-section">
        <div className="attention-rail-heading">
          <span>Queue Focus</span>
        </div>
        <div className="attention-focus-grid">
          <button type="button" onClick={() => onFocusKind('all')}>All Open</button>
          <button type="button" onClick={() => onFocusKind('missing-resolution')}>Resolution</button>
          <button type="button" onClick={() => onFocusKind('knowledge-review')}>Knowledge</button>
          <button type="button" onClick={() => onFocusKind('agent-review')}>Agents</button>
        </div>
      </section>

      <section className="attention-rail-section">
        <div className="attention-rail-heading">
          <span>Recent Outputs</span>
        </div>
        <div className="attention-recent-list">
          {recentItems.length ? recentItems.map((item) => (
            <button
              type="button"
              key={item._id}
              onClick={() => onFocusKind(item.kind || 'all', item.status || 'open')}
            >
              <strong>{item.title || ATTENTION_KIND_LABELS[item.kind] || 'Attention item'}</strong>
              <small>{ATTENTION_KIND_LABELS[item.kind] || item.kind || 'Workflow item'} - {formatAttentionAge(item.updatedAt || item.createdAt)}</small>
            </button>
          )) : (
            <span className="attention-rail-empty">No visible outputs</span>
          )}
        </div>
      </section>

      <section className="attention-rail-section">
        <div className="attention-rail-heading">
          <span>Resources</span>
        </div>
        <div className="attention-resource-links">
          <a href="#/escalations">Escalations</a>
          <a href="#/agents">Agents</a>
          <a href="#/playbook">Playbook</a>
          <a href="#/usage?tab=traces">Traces</a>
        </div>
      </section>
    </aside>
  );
}

function AttentionBulkToolbar({
  itemCount,
  selectedCount,
  allSelected,
  busy,
  onSelectAll,
  onClear,
  onBulkStatusChange,
}) {
  const hasSelection = selectedCount > 0;
  return (
    <div className="attention-bulk-toolbar">
      <label className="attention-select-visible">
        <input
          type="checkbox"
          checked={allSelected}
          disabled={!itemCount || busy}
          onChange={(event) => onSelectAll(event.target.checked)}
        />
        <span>{allSelected ? 'All visible selected' : 'Select visible'}</span>
      </label>
      <span className="attention-bulk-count">
        {selectedCount} selected
      </span>
      <div className="attention-bulk-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!hasSelection || busy}
          onClick={() => onBulkStatusChange('resolved', 'Bulk handled from attention center.')}
        >
          Handle Selected
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!hasSelection || busy}
          onClick={() => onBulkStatusChange('dismissed', 'Bulk dismissed from attention center.')}
        >
          Dismiss Selected
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!hasSelection || busy}
          onClick={() => onBulkStatusChange('open', '')}
        >
          Reopen Selected
        </button>
        {hasSelection && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={onClear}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function AttentionItemRow({ item, selected, busy, onToggleSelection, onStatusChange }) {
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
      <label className="attention-row-select" aria-label={`Select ${item.title || 'attention item'}`}>
        <input
          type="checkbox"
          checked={Boolean(selected)}
          onChange={() => onToggleSelection(item._id)}
        />
      </label>
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
            <span>Possible match: {getEscalationLabel(primaryCandidate.escalationId)} ({primaryCandidate.score || 0})</span>
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
            Match
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
