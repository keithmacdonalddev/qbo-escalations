import { useState, useEffect } from 'react';
import { getSummary, getCategoryBreakdown, getTopAgents, getRecurringIssues } from '../api/analyticsApi.js';

const CAT_BADGE_MAP = {
  'payroll': 'cat-payroll', 'bank-feeds': 'cat-bank-feeds',
  'reconciliation': 'cat-reconciliation', 'permissions': 'cat-permissions',
  'billing': 'cat-billing', 'tax': 'cat-tax', 'invoicing': 'cat-invoicing',
  'reporting': 'cat-reporting', 'general': 'cat-general', 'unknown': 'cat-general',
};

export default function Analytics() {
  const [summary, setSummary] = useState(null);
  const [categories, setCategories] = useState([]);
  const [agents, setAgents] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [sum, cats, ags, rec] = await Promise.all([
          getSummary(),
          getCategoryBreakdown(),
          getTopAgents(10),
          getRecurringIssues(8),
        ]);
        setSummary(sum);
        setCategories(cats);
        setAgents(ags);
        setRecurring(rec);
      } catch { /* graceful */ }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="app-content-constrained" style={{ textAlign: 'center', padding: 'var(--sp-10)' }}>
        <span className="spinner" />
      </div>
    );
  }

  const maxCatCount = categories.length > 0 ? Math.max(...categories.map(c => c.count)) : 1;

  return (
    <div className="app-content-constrained">
      <div className="page-header">
        <h1 className="page-title">Analytics</h1>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--sp-5)', marginBottom: 'var(--sp-8)' }}>
        <div className="stat-card">
          <div className="stat-card-value">{summary?.total ?? '--'}</div>
          <div className="stat-card-label">Total Escalations</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-value">
            {summary?.total > 0
              ? `${Math.round((summary.resolved / summary.total) * 100)}%`
              : '--'}
          </div>
          <div className="stat-card-label">Resolution Rate</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-value">
            {summary?.avgResolutionHours != null ? `${summary.avgResolutionHours}h` : '--'}
          </div>
          <div className="stat-card-label">Avg Resolution Time</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-value">{summary?.open ?? '--'}</div>
          <div className="stat-card-label">Currently Open</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 'var(--sp-6)' }}>
        {/* Category breakdown */}
        <div className="card">
          <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, marginBottom: 'var(--sp-5)' }}>
            By Category
          </h2>
          {categories.length === 0 ? (
            <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No data yet</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {categories.map(cat => (
                <div key={cat.category} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                  <span className={`cat-badge ${CAT_BADGE_MAP[cat.category] || 'cat-general'}`} style={{ minWidth: 100 }}>
                    {(cat.category || 'unknown').replace('-', ' ')}
                  </span>
                  <div style={{ flex: 1, height: 8, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
                    <div style={{
                      width: `${(cat.count / maxCatCount) * 100}%`,
                      height: '100%',
                      background: 'var(--accent)',
                      borderRadius: 'var(--radius-pill)',
                      transition: 'width 300ms ease',
                    }} />
                  </div>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, minWidth: 30, textAlign: 'right' }}>
                    {cat.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top agents */}
        <div className="card">
          <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, marginBottom: 'var(--sp-5)' }}>
            Top Escalating Agents
          </h2>
          {agents.length === 0 ? (
            <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No data yet</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th style={{ textAlign: 'right' }}>Count</th>
                </tr>
              </thead>
              <tbody>
                {agents.map(ag => (
                  <tr key={ag.agentName}>
                    <td>{ag.agentName}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{ag.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recurring issues */}
        <div className="card" style={{ gridColumn: 'span 1' }}>
          <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, marginBottom: 'var(--sp-5)' }}>
            Recurring Issues
          </h2>
          {recurring.length === 0 ? (
            <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No recurring patterns detected yet</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {recurring.map((item, i) => (
                <div key={i} className="card-compact" style={{ border: '1px solid var(--line-subtle)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="truncate" style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>
                        {item.issue}
                      </div>
                      <span className={`cat-badge ${CAT_BADGE_MAP[item.category] || 'cat-general'}`} style={{ marginTop: 'var(--sp-1)' }}>
                        {(item.category || 'unknown').replace('-', ' ')}
                      </span>
                    </div>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                      x{item.count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
