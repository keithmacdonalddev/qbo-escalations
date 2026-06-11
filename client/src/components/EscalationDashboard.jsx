import ConfirmModal from './ConfirmModal.jsx';
import Tooltip from './Tooltip.jsx';
import EscalationCard from './EscalationCard.jsx';
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

const ATTENTION_STATUS_SEGMENTS = ['all', 'open', 'resolved', 'split', 'dismissed'];

const ATTENTION_KIND_HINTS = {
  'parse-review': 'Parse confidence and fallback checks',
  'missing-link': 'Escalation and conversation backlinks',
  'missing-resolution': 'Final notes and escalation reasons',
  'stale-open': 'Open and in-progress aging checks',
  'knowledge-review': 'Human review before agent reuse',
  'agent-review': 'Profile approval and follow-up checks',
  'agent-harness': 'Harness warning and failure checks',
  'possible-duplicate': 'Likely duplicate case detection',
};

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
    refresh,
  } = useEscalations({ initialTab });

  const attentionMission = buildAttentionMissionStats({
    counts: attentionCounts,
    severityCounts: attentionSeverityCounts,
  });
  const scannedCount = countScannedRecords(attentionRefreshMeta);
  const showAgentColumn = escalations.some(esc => esc.agentName);

  function focusAttentionKind(kind, status = 'open') {
    setActiveTab('attention');
    setAttentionStatusFilter(status);
    setAttentionKindFilter(kind);
    setAttentionSort('priority');
  }

  return (
    <div className="app-content-constrained escalations-console">
      <div className="page-header">
        <div className="esc-header-text">
          <h1 className="page-title">Escalations</h1>
          {activeTab === 'escalations' && (
            <div className="esc-stat-line" aria-label="Escalation summary">
              {buildEscalationStatLine(summary).map(stat => (
                <span key={stat.key} className="esc-stat">
                  <strong>{stat.value}</strong> {stat.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <Tooltip text={activeTab === 'escalations' ? 'Reload case data' : activeTab === 'attention' ? 'Reload attention queue' : 'Reload knowledge review'} level="medium">
          <button className="btn btn-secondary" onClick={refresh} type="button">
            Refresh
          </button>
        </Tooltip>
      </div>

      <div className="esc-toolbar">
        <div className="esc-switcher">
          <button
            type="button"
            className={`esc-tab${activeTab === 'escalations' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('escalations')}
          >
            Escalations
          </button>
          <button
            type="button"
            className={`esc-tab${activeTab === 'attention' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('attention')}
          >
            Attention
            {attentionTotalAll > 0 && (
              <span className={`esc-tab-count${attentionCounts.open > 0 ? ' is-alert' : ''}`}>
                {attentionCounts.open || attentionTotalAll}
              </span>
            )}
          </button>
          <button
            type="button"
            className={`esc-tab${activeTab === 'knowledge' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('knowledge')}
          >
            Knowledge Review
            {kqTotalAll > 0 && (
              <span className={`esc-tab-count${kqCounts.draft > 0 ? ' is-info' : ''}`}>
                {kqTotalAll}
              </span>
            )}
          </button>
        </div>

        {activeTab === 'escalations' && (
          <div className="esc-toolbar-controls">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
            >
              {ESCALATION_STATUSES.map(s => (
                <option key={s} value={s}>{ESCALATION_STATUS_LABELS[s] || s}</option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter by category"
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
            />
            <span className="esc-filter-count">
              {total} result{total !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {activeTab === 'attention' && (
          <div className="esc-toolbar-controls">
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
        )}

        {activeTab === 'knowledge' && (
          <div className="esc-toolbar-controls">
            <select
              value={kqStatusFilter}
              onChange={(e) => setKqStatusFilter(e.target.value)}
              aria-label="Filter by review state"
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
            >
              <option value="">All Categories</option>
              {ESCALATION_CATEGORIES.slice(1).map(c => (
                <option key={c} value={c}>{c.replace('-', ' ')}</option>
              ))}
            </select>
            <span className="esc-filter-count">
              {kqTotal} result{kqTotal !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {activeTab === 'escalations' && (
        <>
          {loadError && (
            <div className="error-banner">
              <span>{loadError}</span>
              <button onClick={refresh} type="button">Retry</button>
            </div>
          )}

          <div className="card esc-grid-card">
            {loading ? (
              <div className="esc-loading">
                <span className="spinner" />
              </div>
            ) : escalations.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">No Cases Found</div>
                <div className="empty-state-desc">
                  {search || statusFilter || categoryFilter
                    ? 'Try adjusting your filters.'
                    : 'Cases appear here once image intake captures an escalation from chat.'}
                </div>
              </div>
            ) : (
              <div className="esc-grid-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Category</th>
                      {showAgentColumn && <th>Agent</th>}
                      <th>Issue</th>
                      <th>COID</th>
                      <th>Created</th>
                      <th className="esc-cell-actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {escalations.map(esc => (
                      <EscalationCard
                        key={esc._id}
                        escalation={esc}
                        showAgent={showAgentColumn}
                        onOpen={() => {
                          window.location.hash = `#/escalations/${esc._id}`;
                        }}
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

          <div className="attention-ops-panel">
            <div className="attention-ops-row">
              <div className="esc-attn-seg-row" aria-label="Filter attention items by status">
                {ATTENTION_STATUS_SEGMENTS.map(status => {
                  const count = status === 'all'
                    ? ['open', 'resolved', 'split', 'dismissed'].reduce((sum, key) => sum + Number(attentionCounts[key] || 0), 0)
                    : Number(attentionCounts[status] || 0);
                  return (
                    <button
                      key={status}
                      type="button"
                      className={`esc-attn-seg${attentionStatusFilter === status ? ' is-active' : ''}`}
                      onClick={() => setAttentionStatusFilter(status)}
                    >
                      <span>{status === 'all' ? 'All' : ATTENTION_STATUS_LABELS[status]}</span>
                      <strong>{count}</strong>
                    </button>
                  );
                })}
              </div>

              {(attentionSeverityCounts.critical > 0 || attentionSeverityCounts.warning > 0) && (
                <span className="esc-attn-sev-line" aria-label="Attention severity summary">
                  {attentionSeverityCounts.critical > 0 && (
                    <span className="sev-critical">{attentionSeverityCounts.critical} critical</span>
                  )}
                  {attentionSeverityCounts.warning > 0 && (
                    <span className="sev-warning">{attentionSeverityCounts.warning} warning</span>
                  )}
                </span>
              )}

              <div className="esc-attn-right">
                <span className="esc-attn-engine">
                  <i
                    className={`attention-engine-dot${attentionMission.critical > 0 ? ' is-critical' : attentionMission.open > 0 ? ' is-warning' : ''}`}
                    aria-hidden="true"
                  />
                  {attentionMission.status}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => focusAttentionKind('parse-review')}>
                  Parser
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => focusAttentionKind('missing-link')}>
                  Links
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={refresh}
                  title={scannedCount != null ? `Last scan checked ${scannedCount} record${scannedCount === 1 ? '' : 's'}` : undefined}
                >
                  Rescan
                </button>
              </div>
            </div>

            <div className="attention-ops-row attention-ops-row-secondary">
              <div className="attention-filter-group" aria-label="Filter attention items by type">
                {ATTENTION_KIND_ORDER.map(kind => {
                  const count = kind === 'all'
                    ? Object.values(attentionKindCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0)
                    : (attentionKindCounts?.[kind] || 0);
                  if (kind !== 'all' && count === 0 && attentionKindFilter !== kind) return null;
                  return (
                    <button
                      type="button"
                      key={kind}
                      title={ATTENTION_KIND_HINTS[kind] || undefined}
                      className={`attention-kind-chip${attentionKindFilter === kind ? ' is-active' : ''}`}
                      onClick={() => setAttentionKindFilter(kind)}
                    >
                      <span>{ATTENTION_KIND_LABELS[kind] || kind}</span>
                      <strong>{count}</strong>
                    </button>
                  );
                })}
              </div>

              <span className="attention-result-count">
                {attentionTotal} item{attentionTotal !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          <div className="card attention-list-card">
            {attentionLoading ? (
              <div className="esc-loading">
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

          <div className="esc-attn-related">
            <span>Related</span>
            <a href="#/escalations">Escalations</a>
            <a href="#/agents">Agents</a>
            <a href="#/playbook">Playbook</a>
            <a href="#/usage?tab=traces">Traces</a>
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

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 12 }}>
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

          <div className="card esc-grid-card">
            {kqLoading ? (
              <div className="esc-loading">
                <span className="spinner" />
              </div>
            ) : kqCandidates.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">No Review Drafts</div>
                <div className="empty-state-desc">
                  {kqStatusFilter || kqCategoryFilter
                    ? 'Try adjusting your filters.'
                    : 'Review drafts are created automatically from every case that comes through the pipeline. Once a case is captured, its draft appears here for review.'}
                </div>
              </div>
            ) : (
              <div className="esc-grid-wrap">
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

function buildAttentionMissionStats({ counts = {}, severityCounts = {} } = {}) {
  const open = Number(counts.open || 0);
  const handled = Number(counts.resolved || 0) + Number(counts.split || 0) + Number(counts.dismissed || 0);
  const total = open + handled;
  const critical = Number(severityCounts.critical || 0);
  const handledRate = total ? Math.round((handled / total) * 100) : null;
  const status = critical > 0 ? 'Needs review' : open > 0 ? 'Monitoring' : 'Operational';
  return { status, open, critical, handledRate };
}

function countScannedRecords(refreshMeta) {
  if (!refreshMeta) return null;
  return Number(refreshMeta?.parserTriage?.scanned || 0)
    + Number(refreshMeta?.missingLinks?.scannedEscalations || 0)
    + Number(refreshMeta?.missingLinks?.scannedConversations || 0)
    + Number(refreshMeta?.stale?.scanned || 0);
}

function buildEscalationStatLine(summary) {
  if (!summary) return [{ key: 'captured', value: '--', label: 'captured' }];
  const stats = [{ key: 'captured', value: summary.open ?? 0, label: 'captured' }];
  if (Number(summary.inProgress) > 0) stats.push({ key: 'working', value: summary.inProgress, label: 'working' });
  if (Number(summary.resolved) > 0) stats.push({ key: 'resolved', value: summary.resolved, label: 'resolved' });
  if (Number(summary.escalated) > 0) stats.push({ key: 'escalated', value: summary.escalated, label: 'escalated further' });
  if (summary.avgResolutionHours != null && Number(summary.avgResolutionHours) > 0) {
    stats.push({ key: 'avg', value: `${summary.avgResolutionHours}h`, label: 'avg resolution' });
  }
  return stats;
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
    <div className="attention-list-head">
      <label className="attention-select-all">
        <input
          type="checkbox"
          checked={allSelected}
          disabled={!itemCount || busy}
          onChange={(event) => onSelectAll(event.target.checked)}
          aria-label="Select all visible items"
        />
        <span>Select all</span>
      </label>
      <div className="attention-bulk-zone">
        <div
          className={`attention-bulk-toolbar${hasSelection ? ' is-on' : ''}`}
          aria-hidden={!hasSelection}
        >
          <span className="attention-bulk-count">
            {selectedCount} selected
          </span>
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
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!hasSelection || busy}
            onClick={onClear}
          >
            Clear
          </button>
        </div>
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

  const severity = item.severity || 'info';
  const severityClass = severity === 'critical' ? ' sev-critical' : severity === 'warning' ? ' sev-warning' : '';

  return (
    <div className={`attention-item${severityClass}`}>
      <label className="attention-row-select" aria-label={`Select ${item.title || 'attention item'}`}>
        <input
          type="checkbox"
          checked={Boolean(selected)}
          onChange={() => onToggleSelection(item._id)}
        />
      </label>
      <div className="attention-item-main">
        <div className="attention-title">{item.title || 'Workflow review item'}</div>
        <div className="attention-summary">{item.summary || 'Review this workflow item.'}</div>
        <div className="attention-meta">
          <span className={`attention-meta-sev${severityClass}`}>{severity}</span>
          <span>{item.sourceLabel || getEscalationLabel(item.sourceEscalationId)}</span>
          {primaryCandidate && (
            <span>match: {getEscalationLabel(primaryCandidate.escalationId)} ({primaryCandidate.score || 0})</span>
          )}
          {item.signals?.length > 0 && <span>{formatSignals(item.signals)}</span>}
          <span>{formatAttentionDate(item.updatedAt || item.createdAt)}</span>
        </div>
      </div>
      <div className="attention-actions">
        {sourceId && (
          <button
            type="button"
            className="btn btn-ghost btn-sm esc-quiet-action"
            onClick={() => { window.location.hash = `#/escalations/${sourceId}`; }}
          >
            Review
          </button>
        )}
        {sourceAgentId && (
          <button
            type="button"
            className="btn btn-ghost btn-sm esc-quiet-action"
            onClick={() => { window.location.hash = `#/agents/${encodeURIComponent(sourceAgentId)}`; }}
          >
            Review Agent
          </button>
        )}
        {sourceConversationId && (
          <button
            type="button"
            className="btn btn-ghost btn-sm esc-reveal"
            onClick={() => { window.location.hash = `#/chat/${encodeURIComponent(sourceConversationId)}`; }}
          >
            Open Chat
          </button>
        )}
        {candidateId && (
          <button
            type="button"
            className="btn btn-ghost btn-sm esc-reveal"
            onClick={() => { window.location.hash = `#/escalations/${candidateId}`; }}
          >
            Match
          </button>
        )}
        {isOpen ? (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm esc-reveal"
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
                className="btn btn-ghost btn-sm esc-reveal"
                disabled={busy}
                onClick={() => onStatusChange(item._id, 'split', 'Confirmed as separate escalation.')}
              >
                Separate
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm esc-reveal"
              disabled={busy}
              onClick={() => onStatusChange(item._id, 'dismissed', 'Dismissed by reviewer.')}
            >
              Dismiss
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm esc-quiet-action"
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
