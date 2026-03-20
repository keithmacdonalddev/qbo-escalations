import { useState, useEffect, useCallback, useRef } from 'react';
import { listEscalations, updateEscalation, deleteEscalation, getKnowledgeGaps, listKnowledgeCandidates } from '../api/escalationsApi.js';
import { getSummary } from '../api/analyticsApi.js';
import { useToast } from '../hooks/useToast.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import Tooltip from './Tooltip.jsx';
import { tel, TEL } from '../lib/devTelemetry.js';
import './EscalationDashboard.css';

const STATUSES = ['', 'open', 'in-progress', 'resolved', 'escalated-further'];
const STATUS_LABELS = { '': 'All Statuses', 'open': 'Open', 'in-progress': 'In Progress', 'resolved': 'Resolved', 'escalated-further': 'Escalated' };
const CATEGORIES = ['', 'payroll', 'bank-feeds', 'reconciliation', 'permissions', 'billing', 'tax', 'invoicing', 'reporting', 'technical', 'general', 'unknown'];

const STATUS_BADGE_MAP = {
  'open': 'badge-open',
  'in-progress': 'badge-progress',
  'resolved': 'badge-resolved',
  'escalated-further': 'badge-escalated',
};

const REVIEW_STATUS_LABELS = { draft: 'Draft', approved: 'Approved', published: 'Published', rejected: 'Rejected' };
const REVIEW_STATUS_COLORS = { draft: 'var(--ink-secondary)', approved: 'var(--success, #22c55e)', published: 'var(--accent)', rejected: 'var(--danger)' };

export default function EscalationDashboard() {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [activeTab, setActiveTab] = useState('escalations');
  const [escalations, setEscalations] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Knowledge Queue state
  const [kqCandidates, setKqCandidates] = useState([]);
  const [kqTotal, setKqTotal] = useState(0);
  const [kqCounts, setKqCounts] = useState({ draft: 0, approved: 0, published: 0, rejected: 0 });
  const [kqStatusFilter, setKqStatusFilter] = useState('');
  const [kqCategoryFilter, setKqCategoryFilter] = useState('');
  const [kqLoading, setKqLoading] = useState(false);
  const [kqError, setKqError] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadData = useCallback(async (signal) => {
    setLoading(true);
    try {
      const [escData, summaryData] = await Promise.all([
        listEscalations({ status: statusFilter || undefined, category: categoryFilter || undefined, search: debouncedSearch || undefined }),
        getSummary(),
      ]);
      if (signal?.aborted) return;
      setEscalations(escData.escalations);
      setTotal(escData.total);
      setSummary(summaryData);
      setLoadError(null);
      tel(TEL.DATA_LOAD, `Loaded ${escData.escalations.length} escalations`, { total: escData.total });
      if (escData.escalations.length === 0) {
        tel(TEL.DATA_EMPTY, 'No escalations found', { hasFilters: !!(statusFilter || categoryFilter || debouncedSearch) });
      }
    } catch {
      if (signal?.aborted) return;
      setLoadError('Failed to load escalations');
      tel(TEL.DATA_ERROR, 'Failed to load escalations', { statusFilter, categoryFilter, search: debouncedSearch });
    }
    if (signal?.aborted) return;
    setLoading(false);
  }, [statusFilter, categoryFilter, debouncedSearch]);

  useEffect(() => {
    const ac = new AbortController();
    loadData(ac.signal);
    return () => ac.abort();
  }, [loadData]);

  // Knowledge Queue loader
  const loadKnowledgeQueue = useCallback(async () => {
    setKqLoading(true);
    try {
      const data = await listKnowledgeCandidates({
        reviewStatus: kqStatusFilter || undefined,
        category: kqCategoryFilter || undefined,
      });
      setKqCandidates(data.candidates);
      setKqTotal(data.total);
      setKqCounts(data.counts);
      setKqError(null);
    } catch {
      setKqError('Failed to load knowledge candidates');
    }
    setKqLoading(false);
  }, [kqStatusFilter, kqCategoryFilter]);

  useEffect(() => {
    if (activeTab === 'knowledge') loadKnowledgeQueue();
  }, [activeTab, loadKnowledgeQueue]);

  const handleStatusChange = useCallback(async (id, newStatus) => {
    tel(TEL.USER_ACTION, `Changed escalation status to ${newStatus}`, { escalationId: id, newStatus });
    try {
      await updateEscalation(id, { status: newStatus });
      loadData();
    } catch { toastRef.current.error('Failed to update status'); }
  }, [loadData]);

  const [gaps, setGaps] = useState(null);
  const [gapsOpen, setGapsOpen] = useState(false);
  const [gapsDays, setGapsDays] = useState(30);

  useEffect(() => {
    getKnowledgeGaps(gapsDays)
      .then(d => setGaps(d))
      .catch(() => setGaps(null));
  }, [gapsDays]);

  const [deleteTarget, setDeleteTarget] = useState(null);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteEscalation(deleteTarget);
      loadData();
    } catch { toastRef.current.error('Failed to delete escalation'); }
    setDeleteTarget(null);
  }, [deleteTarget, loadData]);

  const kqTotalAll = kqCounts.draft + kqCounts.approved + kqCounts.published + kqCounts.rejected;

  return (
    <div className="app-content-constrained">
      <div className="page-header">
        <h1 className="page-title">Escalation Dashboard</h1>
        <span className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
          {activeTab === 'escalations'
            ? 'All parsed escalations — filter, search, and track resolution status.'
            : 'Review and track AI-generated knowledge drafts across all escalations.'}
        </span>
        <Tooltip text={activeTab === 'escalations' ? 'Reload escalation data' : 'Reload knowledge queue'} level="medium">
          <button className="btn btn-secondary" onClick={activeTab === 'escalations' ? loadData : loadKnowledgeQueue} type="button">
            Refresh
          </button>
        </Tooltip>
      </div>

      {/* Tab switcher */}
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
              <button onClick={loadData} type="button">Retry</button>
            </div>
          )}

          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--sp-5)', marginBottom: 'var(--sp-8)' }}>
            <StatCard label="Open" value={summary?.open ?? '--'} />
            <StatCard label="In Progress" value={summary?.inProgress ?? '--'} />
            <StatCard label="Resolved" value={summary?.resolved ?? '--'} />
            <StatCard label="Escalated" value={summary?.escalated ?? '--'} />
            <StatCard label="Avg Resolution" value={summary?.avgResolutionHours != null ? `${summary.avgResolutionHours}h` : '--'} />
          </div>

          {/* Knowledge Gaps */}
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

          {/* Filters */}
          <div className="card" style={{ marginBottom: 'var(--sp-5)' }}>
            <div className="filter-bar" style={{ border: 'none', padding: 0 }}>
              <select
                value={statusFilter}
                onChange={(e) => { tel(TEL.USER_ACTION, `Filtered by status: ${e.target.value || 'all'}`, { filterType: 'status', filterValue: e.target.value }); setStatusFilter(e.target.value); }}
                aria-label="Filter by status"
                style={{ width: 'auto', minWidth: 140 }}
              >
                {STATUSES.map(s => (
                  <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>
                ))}
              </select>
              <select
                value={categoryFilter}
                onChange={(e) => { tel(TEL.USER_ACTION, `Filtered by category: ${e.target.value || 'all'}`, { filterType: 'category', filterValue: e.target.value }); setCategoryFilter(e.target.value); }}
                aria-label="Filter by category"
                style={{ width: 'auto', minWidth: 140 }}
              >
                <option value="">All Categories</option>
                {CATEGORIES.slice(1).map(c => (
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

          {/* Escalation list */}
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
                      <tr
                        key={esc._id}
                        className="table-clickable-row"
                        onClick={() => {
                          window.location.hash = `#/escalations/${esc._id}`;
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          <select
                            value={esc.status}
                            onChange={(e) => { e.stopPropagation(); handleStatusChange(esc._id, e.target.value); }}
                            className={`badge ${STATUS_BADGE_MAP[esc.status] || ''}`}
                            style={{ border: 'none', cursor: 'pointer', fontSize: 'var(--text-xs)', padding: '2px 6px' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {STATUSES.slice(1).map(s => (
                              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <span className={`cat-badge cat-${esc.category || 'general'}`}>
                            {(esc.category || 'general').replace('-', ' ')}
                          </span>
                        </td>
                        <td className="truncate" style={{ maxWidth: 120 }}>{esc.agentName || '--'}</td>
                        <td className="truncate" style={{ maxWidth: 250 }}>
                          {esc.attemptingTo || '--'}
                          {esc.conversationId && (
                            <Tooltip text="This escalation has a linked conversation" level="medium">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4, verticalAlign: 'middle' }}>
                                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                              </svg>
                            </Tooltip>
                          )}
                        </td>
                        <td><span className="mono">{esc.coid || '--'}</span></td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)' }}>
                          {new Date(esc.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </td>
                        <td>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget(esc._id); }}
                            title="Delete escalation"
                            type="button"
                            style={{ color: 'var(--danger)', opacity: 0.6 }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
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
            onConfirm={handleDelete}
            onCancel={() => setDeleteTarget(null)}
          />
        </>
      )}

      {activeTab === 'knowledge' && (
        <>
          {kqError && (
            <div className="error-banner">
              <span>{kqError}</span>
              <button onClick={loadKnowledgeQueue} type="button">Retry</button>
            </div>
          )}

          {/* Knowledge status counts */}
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

          {/* Knowledge filters */}
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
                {CATEGORIES.slice(1).map(c => (
                  <option key={c} value={c}>{c.replace('-', ' ')}</option>
                ))}
              </select>
              <span className="text-secondary" style={{ fontSize: 'var(--text-xs)', alignSelf: 'center' }}>
                {kqTotal} result{kqTotal !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {/* Knowledge candidates list */}
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

function StatCard({ label, value }) {
  return (
    <div className="stat-card">
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
    </div>
  );
}
