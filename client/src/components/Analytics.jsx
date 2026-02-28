import { useState, useEffect, useRef } from 'react';
import {
  getSummary,
  getCategoryBreakdown,
  getTopAgents,
  getRecurringIssues,
  getResolutionTimes,
  getTrends,
  getTodaySnapshot,
  getStatusFlow,
  getModelPerformance,
} from '../api/analyticsApi.js';
import CopilotPanel from './CopilotPanel.jsx';
import Tooltip from './Tooltip.jsx';

const ANALYTICS_PROVIDER_LABELS = {
  claude: 'Claude',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'chatgpt-5.3-codex-high': 'ChatGPT 5.3 Codex',
  'gpt-5-mini': 'GPT-5 Mini',
};

const CAT_BADGE_MAP = {
  payroll: 'cat-payroll',
  'bank-feeds': 'cat-bank-feeds',
  reconciliation: 'cat-reconciliation',
  permissions: 'cat-permissions',
  billing: 'cat-billing',
  tax: 'cat-tax',
  invoicing: 'cat-invoicing',
  reporting: 'cat-reporting',
  technical: 'cat-technical',
  general: 'cat-general',
  unknown: 'cat-general',
};

const STATUS_LABELS = {
  open: 'Open',
  'in-progress': 'In Progress',
  resolved: 'Resolved',
  'escalated-further': 'Escalated',
};

export default function Analytics() {
  const [summary, setSummary] = useState(null);
  const [categories, setCategories] = useState([]);
  const [agents, setAgents] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [resolutionTimes, setResolutionTimes] = useState([]);
  const [trends, setTrends] = useState([]);
  const [today, setToday] = useState(null);
  const [statusFlow, setStatusFlow] = useState({ total: 0, flow: {} });
  const [modelPerf, setModelPerf] = useState(null);
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    (async () => {
      try {
        const [sum, cats, ags, rec, resTime, trendData, todayData, flowData, modelPerfData] = await Promise.all([
          getSummary(),
          getCategoryBreakdown(),
          getTopAgents(10),
          getRecurringIssues(8),
          getResolutionTimes(),
          getTrends('daily'),
          getTodaySnapshot(),
          getStatusFlow(),
          getModelPerformance().catch(() => null),
        ]);
        setSummary(sum);
        setCategories(cats);
        setAgents(ags);
        setRecurring(rec);
        setResolutionTimes(resTime);
        setTrends(trendData);
        setToday(todayData);
        setStatusFlow(flowData || { total: 0, flow: {} });
        setModelPerf(modelPerfData);
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

  const maxCatCount = categories.length > 0 ? Math.max(...categories.map((c) => c.count)) : 1;
  const maxTrendCount = trends.length > 0 ? Math.max(...trends.map((t) => t.count)) : 1;

  return (
    <div className="app-content-constrained">
      <div className="page-header">
        <h1 className="page-title">Analytics</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--sp-5)', marginBottom: 'var(--sp-8)' }}>
        <StatCard label="Total Escalations" value={summary?.total ?? '--'} />
        <StatCard label="Resolution Rate" value={summary?.total > 0 ? `${Math.round((summary.resolved / summary.total) * 100)}%` : '--'} />
        <StatCard label="Avg Resolution" value={summary?.avgResolutionHours != null ? `${summary.avgResolutionHours}h` : '--'} />
        <StatCard label="Open Backlog" value={summary?.open ?? '--'} />
        <StatCard label="Created Today" value={today?.created ?? '--'} />
        <StatCard label="Resolved Today" value={today?.resolved ?? '--'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 'var(--sp-6)' }}>
        <div className="card">
          <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, marginBottom: 'var(--sp-5)' }}>By Category</h2>
          {categories.length === 0 ? (
            <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No data yet</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {categories.map((cat) => (
                <div key={cat.category} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                  <span className={`cat-badge ${CAT_BADGE_MAP[cat.category] || 'cat-general'}`} style={{ minWidth: 110 }}>
                    {(cat.category || 'unknown').replace('-', ' ')}
                  </span>
                  <div style={{ flex: 1, height: 8, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${(cat.count / maxCatCount) * 100}%`,
                        height: '100%',
                        background: 'var(--accent)',
                        borderRadius: 'var(--radius-pill)',
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, minWidth: 30, textAlign: 'right' }}>{cat.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, marginBottom: 'var(--sp-5)' }}>Status Flow</h2>
          {statusFlow?.total ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {Object.keys(STATUS_LABELS).map((status) => {
                const item = statusFlow.flow?.[status] || { count: 0, percent: 0 };
                return (
                  <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                    <span style={{ minWidth: 110, fontSize: 'var(--text-sm)' }}>{STATUS_LABELS[status]}</span>
                    <div style={{ flex: 1, height: 8, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
                      <div style={{ width: `${item.percent || 0}%`, height: '100%', background: 'var(--accent)', borderRadius: 'var(--radius-pill)' }} />
                    </div>
                    <span style={{ minWidth: 70, textAlign: 'right', fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)' }}>
                      {item.count} ({item.percent || 0}%)
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No data yet</div>
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, marginBottom: 'var(--sp-5)' }}>Daily Trends</h2>
          {trends.length === 0 ? (
            <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No trend data yet</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-1)', height: 140 }}>
              {trends.slice(-20).map((t) => (
                <div key={t.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
                  <div
                    title={`${t.date}: ${t.count}`}
                    style={{
                      width: '100%',
                      minHeight: 2,
                      height: `${Math.max(2, Math.round((t.count / maxTrendCount) * 100))}%`,
                      background: 'var(--accent)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, marginBottom: 'var(--sp-5)' }}>Resolution Time by Category</h2>
          {resolutionTimes.length === 0 ? (
            <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No resolved data yet</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th style={{ textAlign: 'right' }}>Avg Hours</th>
                </tr>
              </thead>
              <tbody>
                {resolutionTimes.map((item) => (
                  <tr key={item.category}>
                    <td>
                      <span className={`cat-badge ${CAT_BADGE_MAP[item.category] || 'cat-general'}`}>
                        {(item.category || 'unknown').replace('-', ' ')}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{item.avgHours}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, marginBottom: 'var(--sp-5)' }}>Top Escalating Agents</h2>
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
                {agents.map((ag) => (
                  <tr key={ag.agentName}>
                    <td>{ag.agentName}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{ag.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, marginBottom: 'var(--sp-5)' }}>Recurring Issues</h2>
          {recurring.length === 0 ? (
            <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No recurring patterns detected yet</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {recurring.map((item, i) => (
                <div key={i} className="card-compact" style={{ border: '1px solid var(--line-subtle)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="truncate" style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{item.issue}</div>
                      <span className={`cat-badge ${CAT_BADGE_MAP[item.category] || 'cat-general'}`} style={{ marginTop: 'var(--sp-1)' }}>
                        {(item.category || 'unknown').replace('-', ' ')}
                      </span>
                    </div>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>x{item.count}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Model Performance Section */}
        {modelPerf && modelPerf.totalDecisions > 0 && (
          <div style={{ marginTop: 'var(--sp-8)' }}>
            <Tooltip text="Win rate, latency, and cost per model" level="high">
              <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: 'var(--sp-5)', letterSpacing: '-0.01em' }}>
                Model Performance
              </h2>
            </Tooltip>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--sp-5)', marginBottom: 'var(--sp-5)' }}>
              <StatCard label="Total Parallel Decisions" value={modelPerf.totalDecisions} />
              {modelPerf.providers.map(p => (
                <div key={p.provider} className="stat-card">
                  <div className="stat-card-value" style={{ color: ['claude', 'claude-sonnet-4-6'].includes(p.provider) ? 'var(--provider-a)' : 'var(--provider-b)' }}>
                    {p.winRate}%
                  </div>
                  <div className="stat-card-label">
                    {ANALYTICS_PROVIDER_LABELS[p.provider] || p.provider} Win Rate
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', marginTop: 'var(--sp-2)', fontFamily: 'var(--font-mono)' }}>
                    {p.wins}W / {p.losses}L &middot; Avg {(p.winAvgLatencyMs / 1000).toFixed(1)}s
                  </div>
                </div>
              ))}
            </div>
            {/* Detailed breakdown table */}
            <div className="card" style={{ padding: 'var(--sp-5)' }}>
              <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 'var(--sp-4)' }}>
                Detailed Breakdown
              </h3>
              <table className="table" style={{ fontSize: 'var(--text-sm)' }}>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Wins</th>
                    <th>Losses</th>
                    <th>Win Rate</th>
                    <th>Avg Win Latency</th>
                    <th>Avg Win Words</th>
                  </tr>
                </thead>
                <tbody>
                  {modelPerf.providers.map(p => (
                    <tr key={p.provider}>
                      <td style={{ fontWeight: 600, color: ['claude', 'claude-sonnet-4-6'].includes(p.provider) ? 'var(--provider-a)' : 'var(--provider-b)' }}>
                        <Tooltip text="Performance metrics for this AI provider" level="high">
                          {ANALYTICS_PROVIDER_LABELS[p.provider] || p.provider}
                        </Tooltip>
                      </td>
                      <td style={{ color: 'var(--success)' }}>{p.wins}</td>
                      <td style={{ color: 'var(--danger)' }}>{p.losses}</td>
                      <td style={{ fontWeight: 600 }}>{p.winRate}%</td>
                      <td>{(p.winAvgLatencyMs / 1000).toFixed(1)}s</td>
                      <td>{p.winAvgWordCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {modelPerf.byContext.length > 0 && (
                <div style={{ marginTop: 'var(--sp-4)', display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
                  <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    By Context:
                  </span>
                  {modelPerf.byContext.map(c => (
                    <span key={c.context} className="badge badge-progress" style={{ fontSize: 'var(--text-xs)' }}>
                      {c.context}: {c.count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <CopilotPanel title="Analytics Co-pilot" />
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
