import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getUsageSummary,
  getUsageByProvider,
  getUsageByService,
  getUsageTrends,
  getUsageByCategory,
  getUsageRecent,
  getUsageModels,
} from '../api/usageApi.js';
import TraceDashboard from './TraceDashboard.jsx';
import { getProviderLabel, isClaudeProvider } from '../lib/providerCatalog.js';

function formatTokens(n) {
  if (n == null) return '--';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatCost(micros) {
  if (micros == null) return '--';
  return '$' + (micros / 1_000_000).toFixed(2);
}

function formatCostPrecise(micros) {
  if (micros == null || micros === 0) return '$0.0000';
  return '$' + (micros / 1_000_000).toFixed(4);
}

function formatLatency(ms) {
  if (ms == null || ms === 0) return '--';
  return (ms / 1000).toFixed(1) + 's';
}

function formatRatio(input, output) {
  if (!output || output === 0) return '--';
  return (input / output).toFixed(1) + ':1';
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function providerLabel(p) { return getProviderLabel(p) || p; }

function providerBadgeClass(p) {
  if (!p) return 'badge-provider';
  const lower = (p || '').toLowerCase();
  if (lower.includes('claude')) return 'badge-provider badge-claude';
  if (lower.includes('codex') || lower.includes('gpt') || lower.includes('openai')) return 'badge-provider badge-codex';
  return 'badge-provider';
}

function serviceBadgeClass(s) {
  return `badge-service badge-service-${s || 'chat'}`;
}

function statusBadgeClass(s) {
  const map = { ok: 'badge-ok', error: 'badge-error', timeout: 'badge-timeout', abort: 'badge-abort' };
  return `badge-status ${map[s] || 'badge-ok'}`;
}

const CAT_BADGE_MAP = {
  payroll: 'cat-payroll', 'bank-feeds': 'cat-bank-feeds', reconciliation: 'cat-reconciliation',
  permissions: 'cat-permissions', billing: 'cat-billing', tax: 'cat-tax',
  invoicing: 'cat-invoicing', reporting: 'cat-reporting', technical: 'cat-technical',
  general: 'cat-general', unknown: 'cat-general',
};

function normalizeUsageTab(value) {
  return value === 'traces' ? 'traces' : 'usage';
}

function buildUsageHash(tab, traceState = {}) {
  if (normalizeUsageTab(tab) !== 'traces') return '#/usage';
  const params = new URLSearchParams();
  params.set('tab', 'traces');
  if (String(traceState.conversationId || '').trim()) params.set('conversationId', String(traceState.conversationId).trim());
  if (String(traceState.traceId || '').trim()) params.set('traceId', String(traceState.traceId).trim());
  return `#/usage?${params.toString()}`;
}

export default function UsageDashboard({
  initialTab = 'usage',
  initialTraceConversationId = '',
  initialTraceId = '',
}) {
  const [dateFrom, setDateFrom] = useState(daysAgoISO(14));
  const [dateTo, setDateTo] = useState(todayISO());
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [activeTab, setActiveTab] = useState(() => normalizeUsageTab(initialTab));
  const [traceRouteState, setTraceRouteState] = useState(() => ({
    conversationId: initialTraceConversationId || '',
    traceId: initialTraceId || '',
  }));

  const [summary, setSummary] = useState(null);
  const [requestsToday, setRequestsToday] = useState(null);
  const [providers, setProviders] = useState([]);
  const [services, setServices] = useState([]);
  const [trends, setTrends] = useState([]);
  const [categories, setCategories] = useState([]);
  const [recent, setRecent] = useState([]);
  const [models, setModels] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [dataAvailableFrom, setDataAvailableFrom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [recentPage, setRecentPage] = useState(1);
  const firstRenderRef = useRef(true);

  useEffect(() => {
    setActiveTab(normalizeUsageTab(initialTab));
  }, [initialTab]);

  useEffect(() => {
    setTraceRouteState({
      conversationId: initialTraceConversationId || '',
      traceId: initialTraceId || '',
    });
  }, [initialTraceConversationId, initialTraceId]);

  const fetchAll = useCallback(async (page = 1) => {
    if (activeTab !== 'usage') return;
    const today = todayISO();
    setError(null);
    try {
      const [sumRes, todayRes, provRes, svcRes, trendRes, catRes, recentRes, modelRes] = await Promise.all([
        getUsageSummary(dateFrom, dateTo),
        getUsageSummary(today, today),
        getUsageByProvider(dateFrom, dateTo),
        getUsageByService(dateFrom, dateTo),
        getUsageTrends(dateFrom, dateTo, 'daily'),
        getUsageByCategory(dateFrom, dateTo),
        getUsageRecent(dateFrom, dateTo, page, 50),
        getUsageModels(dateFrom, dateTo),
      ]);
      setSummary(sumRes.summary);
      setRequestsToday(todayRes.summary?.totalRequests ?? 0);
      setProviders(provRes.providers || []);
      setServices(svcRes.services || []);
      setTrends(trendRes.trends || []);
      setCategories(catRes.categories || []);
      setRecent(recentRes.recent || []);
      setModels(modelRes.models || []);
      setPagination(recentRes.pagination || { page: 1, limit: 50, total: 0, totalPages: 1 });
      setDataAvailableFrom(sumRes.dataAvailableFrom || trendRes.dataAvailableFrom || null);
    } catch (err) {
      setError(err.message || 'Failed to load usage data');
    }
    setLoading(false);
  }, [activeTab, dateFrom, dateTo]);

  useEffect(() => {
    if (activeTab !== 'usage') return;
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      fetchAll(1);
      return;
    }
    setLoading(true);
    setRecentPage(1);
    fetchAll(1);
  }, [activeTab, fetchAll]);

  useEffect(() => {
    if (activeTab !== 'usage' || !autoRefresh) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchAll(recentPage);
    }, 30_000);
    return () => clearInterval(interval);
  }, [activeTab, autoRefresh, fetchAll, recentPage]);

  const handlePageChange = useCallback((newPage) => {
    setRecentPage(newPage);
    const defaultPag = { page: newPage, limit: 50, total: 0, totalPages: 1 };
    (async () => {
      try {
        const res = await getUsageRecent(dateFrom, dateTo, newPage, 50);
        setRecent(res.recent || []);
        setPagination(res.pagination || defaultPag);
      } catch {}
    })();
  }, [dateFrom, dateTo]);

  const errorBanner = error ? (
    <div style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-6)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
      Failed to load usage data: {error}
    </div>
  ) : null;

  const totalTokens = summary?.totalTokens ?? 0;
  const totalCost = summary?.totalCostMicros ?? 0;
  const totalRequests = summary?.totalRequests ?? 0;
  const avgCost = totalRequests > 0 ? totalCost / totalRequests : null;
  const topProviderRow = providers.length > 0
    ? [...providers].sort((a, b) => (b.requests || 0) - (a.requests || 0))[0]
    : null;
  const topProvider = topProviderRow
    ? `${providerLabel(topProviderRow.provider)} (${totalRequests > 0 ? Math.round((topProviderRow.requests / totalRequests) * 100) : 0}%)`
    : '--';
  const usageCoverage = summary?.usageCoveragePercent ?? 0;
  const usageCompleteCoverage = summary?.usageCompleteCoveragePercent ?? 0;
  const maxTrendCost = trends.length > 0 ? Math.max(...trends.map((t) => t.totalCostMicros || 0), 1) : 1;
  const maxProviderTokens = providers.length > 0 ? Math.max(...providers.map((p) => p.totalTokens || 0), 1) : 1;
  const maxProviderCost = providers.length > 0 ? Math.max(...providers.map((p) => p.totalCostMicros || 0), 1) : 1;
  const maxServiceReq = services.length > 0 ? Math.max(...services.map((s) => s.requests || 0), 1) : 1;
  const maxModelReq = models.length > 0 ? Math.max(...models.map((m) => m.requests || 0), 1) : 1;
  const showUsageLoading = activeTab === 'usage' && loading;
  const handleTabChange = useCallback((nextTab) => {
    setActiveTab(nextTab);
    const nextHash = buildUsageHash(nextTab, traceRouteState);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }, [traceRouteState]);

  return (
    <div className="app-content-constrained">
      <div className="page-header">
        <h1 className="page-title">Usage Monitor</h1>
        <span className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
          Usage, model performance over time, and full per-turn trace logs.
        </span>
      </div>

      <div className="usage-tab-strip">
        <button
          className={`usage-tab-pill${activeTab === 'usage' ? ' is-active' : ''}`}
          onClick={() => handleTabChange('usage')}
          type="button"
        >
          Usage
        </button>
        <button
          className={`usage-tab-pill${activeTab === 'traces' ? ' is-active' : ''}`}
          onClick={() => handleTabChange('traces')}
          type="button"
        >
          Trace Monitor
        </button>
      </div>

      {activeTab === 'usage' ? errorBanner : null}

      <div className="usage-controls" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', marginBottom: 'var(--sp-6)', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
          From
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="usage-date-input" />
        </label>
        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
          To
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="usage-date-input" />
        </label>
        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto-refresh (30s)
        </label>
      </div>

      {activeTab === 'traces' ? (
        <>
          {traceRouteState.conversationId ? (
            <div className="usage-notice" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', marginBottom: 'var(--sp-6)', padding: 'var(--sp-3) var(--sp-4)', background: 'var(--bg-sunken)', borderRadius: 'var(--radius-md)' }}>
              Showing trace history scoped to conversation <span className="mono">{traceRouteState.conversationId}</span>. You can clear or replace that filter inside Trace Monitor.
            </div>
          ) : null}
          <TraceDashboard
            dateFrom={dateFrom}
            dateTo={dateTo}
            autoRefresh={autoRefresh}
            initialConversationId={initialTraceConversationId}
            initialSelectedTraceId={initialTraceId}
            onRouteStateChange={setTraceRouteState}
            active
          />
        </>
      ) : showUsageLoading ? (
        <div className="app-content-constrained" style={{ textAlign: 'center', padding: 'var(--sp-10)' }}>
          <span className="spinner" />
        </div>
      ) : (
        <>
          {dataAvailableFrom && (
            <div className="usage-notice" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', marginBottom: 'var(--sp-6)', padding: 'var(--sp-3) var(--sp-4)', background: 'var(--bg-sunken)', borderRadius: 'var(--radius-md)' }}>
              Data available since {new Date(dataAvailableFrom).toISOString().slice(0, 10)} &middot; All times in UTC
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(145px, 1fr))', gap: 'var(--sp-4)', marginBottom: 'var(--sp-8)' }}>
            <StatCard label="Total Tokens" value={formatTokens(totalTokens)} />
            <StatCard label="Total Cost" value={formatCost(totalCost)} />
            <StatCard label="Avg Cost / Req" value={avgCost != null ? formatCostPrecise(avgCost) : '--'} />
            <StatCard label="Requests Today" value={requestsToday != null ? requestsToday.toLocaleString() : '--'} />
            <StatCard label="Input : Output" value={formatRatio(summary?.totalInputTokens, summary?.totalOutputTokens)} />
            <StatCard label="Top Provider" value={topProvider} />
            <StatCard label="Data Captured" value={`${usageCoverage}%`} accent />
            <StatCard label="Fully Costed" value={`${usageCompleteCoverage}%`} accent />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(400px, 100%), 1fr))', gap: 'var(--sp-6)', marginBottom: 'var(--sp-8)' }}>
            <div className="card">
              <h2 className="usage-card-title">Cost Trends (Daily)</h2>
              {trends.length === 0 ? (
                <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No trend data</div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-1)', height: 140 }}>
                  {trends.slice(-30).map((t) => (
                    <div key={t.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>
                      <div
                        title={`${t.date}: ${formatCost(t.totalCostMicros)} (${t.requests} req)`}
                        style={{
                          width: '100%',
                          minHeight: 2,
                          height: `${Math.max(2, Math.round(((t.totalCostMicros || 0) / maxTrendCost) * 100))}%`,
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
              <h2 className="usage-card-title">Provider Comparison</h2>
              {providers.length === 0 ? (
                <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No data</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>Tokens</div>
                    {providers.map((p) => (
                      <div key={p.provider + '-tok'} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
                        <span className={providerBadgeClass(p.provider)} style={{ minWidth: 70 }}>{providerLabel(p.provider)}</span>
                        <div style={{ flex: 1, height: 8, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
                          <div style={{ width: `${(p.totalTokens / maxProviderTokens) * 100}%`, height: '100%', background: isClaudeProvider(p.provider) ? 'var(--provider-a)' : 'var(--provider-b)', borderRadius: 'var(--radius-pill)' }} />
                        </div>
                        <span className="mono" style={{ fontSize: 'var(--text-xs)', minWidth: 60, textAlign: 'right' }}>{formatTokens(p.totalTokens)}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>Cost</div>
                    {providers.map((p) => (
                      <div key={p.provider + '-cost'} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
                        <span className={providerBadgeClass(p.provider)} style={{ minWidth: 70 }}>{providerLabel(p.provider)}</span>
                        <div style={{ flex: 1, height: 8, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
                          <div style={{ width: `${(p.totalCostMicros / maxProviderCost) * 100}%`, height: '100%', background: isClaudeProvider(p.provider) ? 'var(--provider-a)' : 'var(--provider-b)', borderRadius: 'var(--radius-pill)' }} />
                        </div>
                        <span className="mono" style={{ fontSize: 'var(--text-xs)', minWidth: 70, textAlign: 'right' }}>{formatCost(p.totalCostMicros)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="card">
              <h2 className="usage-card-title">Service Breakdown</h2>
              {services.length === 0 ? (
                <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No data</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                  {services.map((s) => (
                    <div key={s.service} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                      <span className={serviceBadgeClass(s.service)} style={{ minWidth: 70 }}>{s.service}</span>
                      <div style={{ flex: 1, height: 8, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
                        <div style={{ width: `${(s.requests / maxServiceReq) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 'var(--radius-pill)' }} />
                      </div>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, minWidth: 40, textAlign: 'right' }}>{s.requests}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h2 className="usage-card-title">Model Distribution</h2>
              {models.length === 0 ? (
                <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No data</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                  {models.map((m) => (
                    <div key={m.model + m.provider} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                      <span className="mono" style={{ fontSize: 'var(--text-xs)', minWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.model}>{m.model || '(unknown)'}</span>
                      <div style={{ flex: 1, height: 8, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
                        <div style={{ width: `${(m.requests / maxModelReq) * 100}%`, height: '100%', background: isClaudeProvider(m.provider) ? 'var(--provider-a)' : 'var(--provider-b)', borderRadius: 'var(--radius-pill)' }} />
                      </div>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, minWidth: 40, textAlign: 'right' }}>{m.requests}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <h2 className="usage-card-title">Category Cost</h2>
              {categories.length === 0 ? (
                <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No data</div>
              ) : (
                <table className="table" style={{ fontSize: 'var(--text-sm)' }}>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Service</th>
                      <th style={{ textAlign: 'right' }}>Requests</th>
                      <th style={{ textAlign: 'right' }}>Tokens</th>
                      <th style={{ textAlign: 'right' }}>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((c) => (
                      <tr key={`${c.service}-${c.category}`}>
                        <td>
                          <span className={`cat-badge ${CAT_BADGE_MAP[c.category] || 'cat-general'}`}>
                            {(c.category || 'unknown').replace(/-/g, ' ')}
                          </span>
                        </td>
                        <td><span className={serviceBadgeClass(c.service)}>{c.service}</span></td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.requests}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatTokens(c.totalTokens)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{formatCost(c.totalCostMicros)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 'var(--sp-8)' }}>
            <h2 className="usage-card-title">Recent Requests</h2>
            {recent.length === 0 ? (
              <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No requests in this period</div>
            ) : (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table className="table usage-recent-table" style={{ fontSize: 'var(--text-sm)' }}>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Service</th>
                        <th>Provider</th>
                        <th>Model</th>
                        <th style={{ textAlign: 'right' }}>In</th>
                        <th style={{ textAlign: 'right' }}>Out</th>
                        <th style={{ textAlign: 'right' }}>Cost</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'right' }}>Latency</th>
                        <th style={{ textAlign: 'center' }}>Usage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((r) => (
                        <tr key={r.id} className={r.status !== 'ok' ? `usage-row-${r.status}` : ''}>
                          <td style={{ whiteSpace: 'nowrap', fontSize: 'var(--text-xs)' }}>
                            {new Date(r.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
                          </td>
                          <td><span className={serviceBadgeClass(r.service)}>{r.service}</span></td>
                          <td><span className={providerBadgeClass(r.provider)}>{providerLabel(r.provider)}</span></td>
                          <td><span className="mono" style={{ fontSize: 'var(--text-xs)' }}>{r.model || '--'}</span></td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.inputTokens?.toLocaleString()}</td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.outputTokens?.toLocaleString()}</td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCostPrecise(r.totalCostMicros)}</td>
                          <td><span className={statusBadgeClass(r.status)}>{r.status}</span></td>
                          <td style={{ textAlign: 'right' }}>{formatLatency(r.latencyMs)}</td>
                          <td style={{ textAlign: 'center', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>
                            <span
                              title={r.usageComplete ? 'Fully costed' : r.usageAvailable ? 'Data captured, not fully costed' : 'No usage data'}
                              style={{
                                display: 'inline-block',
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: r.usageComplete ? 'var(--success, #22c55e)' : r.usageAvailable ? 'var(--warning, #f59e0b)' : 'var(--ink-tertiary)',
                                marginRight: 4,
                                verticalAlign: 'middle',
                              }}
                            />
                            <span style={{ verticalAlign: 'middle' }}>
                              {r.usageComplete ? 'Full' : r.usageAvailable ? 'Partial' : '--'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="usage-pagination">
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                    Showing {((pagination.page - 1) * pagination.limit) + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} requests
                  </span>
                  <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                    <button className="btn btn-sm btn-ghost" disabled={pagination.page <= 1} onClick={() => handlePageChange(pagination.page - 1)} type="button">Prev</button>
                    <button className="btn btn-sm btn-ghost" disabled={pagination.page >= pagination.totalPages} onClick={() => handlePageChange(pagination.page + 1)} type="button">Next</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className="stat-card">
      <div className="stat-card-value" style={accent ? { color: 'var(--accent)' } : undefined}>{value}</div>
      <div className="stat-card-label">{label}</div>
    </div>
  );
}
