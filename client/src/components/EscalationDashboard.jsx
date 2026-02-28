import { useState, useEffect, useCallback } from 'react';
import { listEscalations, updateEscalation, deleteEscalation } from '../api/escalationsApi.js';
import { getSummary } from '../api/analyticsApi.js';
import ConfirmModal from './ConfirmModal.jsx';
import Tooltip from './Tooltip.jsx';

const STATUSES = ['', 'open', 'in-progress', 'resolved', 'escalated-further'];
const STATUS_LABELS = { '': 'All Statuses', 'open': 'Open', 'in-progress': 'In Progress', 'resolved': 'Resolved', 'escalated-further': 'Escalated' };
const CATEGORIES = ['', 'payroll', 'bank-feeds', 'reconciliation', 'permissions', 'billing', 'tax', 'invoicing', 'reporting', 'technical', 'general', 'unknown'];

const STATUS_BADGE_MAP = {
  'open': 'badge-open',
  'in-progress': 'badge-progress',
  'resolved': 'badge-resolved',
  'escalated-further': 'badge-escalated',
};

export default function EscalationDashboard() {
  const [escalations, setEscalations] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [escData, summaryData] = await Promise.all([
        listEscalations({ status: statusFilter || undefined, category: categoryFilter || undefined, search: debouncedSearch || undefined }),
        getSummary(),
      ]);
      setEscalations(escData.escalations);
      setTotal(escData.total);
      setSummary(summaryData);
    } catch {
      // Fail gracefully — show empty
    }
    setLoading(false);
  }, [statusFilter, categoryFilter, debouncedSearch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleStatusChange = useCallback(async (id, newStatus) => {
    try {
      await updateEscalation(id, { status: newStatus });
      loadData();
    } catch { /* ignore */ }
  }, [loadData]);

  const [deleteTarget, setDeleteTarget] = useState(null);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteEscalation(deleteTarget);
      loadData();
    } catch { /* ignore */ }
    setDeleteTarget(null);
  }, [deleteTarget, loadData]);

  return (
    <div className="app-content-constrained">
      <div className="page-header">
        <h1 className="page-title">Escalation Dashboard</h1>
        <Tooltip text="Reload escalation data" level="medium">
          <button className="btn btn-secondary" onClick={loadData} type="button">
            Refresh
          </button>
        </Tooltip>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--sp-5)', marginBottom: 'var(--sp-8)' }}>
        <StatCard label="Open" value={summary?.open ?? '--'} />
        <StatCard label="In Progress" value={summary?.inProgress ?? '--'} />
        <StatCard label="Resolved" value={summary?.resolved ?? '--'} />
        <StatCard label="Escalated" value={summary?.escalated ?? '--'} />
        <StatCard label="Avg Resolution" value={summary?.avgResolutionHours != null ? `${summary.avgResolutionHours}h` : '--'} />
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 'var(--sp-5)' }}>
        <div className="filter-bar" style={{ border: 'none', padding: 0 }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            style={{ width: 'auto', minWidth: 140 }}
          >
            {STATUSES.map(s => (
              <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>
            ))}
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
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
                : 'Escalations will appear here when you parse screenshots or create them in chat.'}
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
