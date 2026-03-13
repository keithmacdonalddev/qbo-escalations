import { useCallback, useEffect, useMemo, useState } from 'react';
import RightSidebar from './RightSidebar.jsx';
import {
  getTraceDetail,
  getTraceModelTrends,
  getTraceModels,
  getTraceRecent,
  getTraceSummary,
} from '../api/traceApi.js';
import { PROVIDER_OPTIONS, getProviderLabel } from '../lib/providerCatalog.js';

const TREND_METRICS = Object.freeze([
  { value: 'avgTotalMs', label: 'Avg total time', type: 'ms' },
  { value: 'avgFirstChunkMs', label: 'Avg first output', type: 'ms' },
  { value: 'avgFirstThinkingMs', label: 'Avg first reasoning', type: 'ms' },
  { value: 'avgTriageMs', label: 'Avg triage time', type: 'ms' },
  { value: 'avgPostParseMs', label: 'Avg post-parse time', type: 'ms' },
  { value: 'errorRatePercent', label: 'Error rate', type: 'percent' },
  { value: 'avgPreparedBytes', label: 'Avg prepared image size', type: 'bytes' },
]);

function formatMs(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '--';
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '--';
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

function formatPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${n.toFixed(n >= 10 ? 0 : 1)}%`;
}

function formatScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(2);
}

function traceStatusBadge(status) {
  if (status === 'error') return 'badge-status badge-error';
  if (status === 'aborted') return 'badge-status badge-abort';
  if (status === 'running') return 'badge-status badge-timeout';
  return 'badge-status badge-ok';
}

function providerBadgeClass(provider) {
  const normalized = String(provider || '').toLowerCase();
  if (normalized.includes('claude')) return 'badge-provider badge-claude';
  if (normalized.includes('gpt') || normalized.includes('codex') || normalized.includes('openai')) {
    return 'badge-provider badge-codex';
  }
  return 'badge-provider';
}

function formatMetricValue(metric, value) {
  const config = TREND_METRICS.find((entry) => entry.value === metric) || TREND_METRICS[0];
  if (config.type === 'percent') return formatPercent(value || 0);
  if (config.type === 'bytes') return formatBytes(value);
  return formatMs(value);
}

function buildTraceHash({ conversationId = '', traceId = '' } = {}) {
  const params = new URLSearchParams();
  params.set('tab', 'traces');
  if (String(conversationId || '').trim()) params.set('conversationId', String(conversationId).trim());
  if (String(traceId || '').trim()) params.set('traceId', String(traceId).trim());
  return `#/usage?${params.toString()}`;
}

function SparkBars({ points, metric = 'avgTotalMs' }) {
  const values = (points || []).map((point) => Number(point?.[metric]) || 0);
  const max = Math.max(...values, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 44 }}>
      {(points || []).map((point) => {
        const value = Number(point?.[metric]) || 0;
        return (
          <div
            key={`${point.date}-${metric}`}
            title={`${point.date}: ${formatMetricValue(metric, value)} (${point.requests} req)`}
            style={{
              flex: 1,
              minWidth: 6,
              height: `${Math.max(8, Math.round((value / max) * 100))}%`,
              background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 88%, #fff 12%), color-mix(in srgb, var(--accent) 40%, transparent))',
              borderRadius: 'var(--radius-sm)',
            }}
          />
        );
      })}
    </div>
  );
}

function TraceStatCard({ label, value, helper = '' }) {
  return (
    <div className="stat-card">
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
      {helper ? <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', marginTop: 'var(--sp-1)' }}>{helper}</div> : null}
    </div>
  );
}

function TraceDetailPanel({ trace }) {
  if (!trace) return null;
  const images = Array.isArray(trace.images) ? trace.images : [];
  const attempts = Array.isArray(trace.attempts) ? trace.attempts : [];
  const events = Array.isArray(trace.events) ? trace.events : [];
  const requested = trace.requested || {};
  const resolved = trace.resolved || {};
  const outcome = trace.outcome || {};
  const triage = trace.triage || {};
  const postParse = trace.postParse || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div className="eyebrow">Trace</div>
            <div style={{ fontSize: 'var(--text-md)', fontWeight: 700 }}>{trace.service} · {trace.turnKind}</div>
            <div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', marginTop: 4 }}>{trace.requestId}</div>
          </div>
          <span className={traceStatusBadge(trace.status)}>{trace.status}</span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-4)' }}>
          <span className={providerBadgeClass(outcome.providerUsed || requested.primaryProvider)}>{getProviderLabel(outcome.providerUsed || requested.primaryProvider || '')}</span>
          <span className="badge-service badge-service-chat">{outcome.modelUsed || requested.primaryModel || '(unknown model)'}</span>
          <span className="badge-service badge-service-parse">{resolved.mode || requested.mode || 'single'}</span>
          <span className="badge-service badge-service-copilot">Total {formatMs(outcome.totalMs)}</span>
          <span className="badge-service badge-service-dev">1st output {formatMs(outcome.firstChunkMs)}</span>
          <span className="badge-service badge-service-dev">1st reasoning {formatMs(outcome.firstThinkingMs)}</span>
        </div>
        {trace.promptPreview ? (
          <div style={{ marginTop: 'var(--sp-4)', fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
            {trace.promptPreview}
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-4)', flexWrap: 'wrap' }}>
          {trace.conversationId ? (
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => { window.location.hash = `#/chat/${trace.conversationId}`; }}>
              Open Conversation
            </button>
          ) : null}
          {trace.parentTraceId ? (
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={() => { window.location.hash = buildTraceHash({ conversationId: trace.conversationId, traceId: trace.parentTraceId }); }}
            >
              Open Parent Trace
            </button>
          ) : null}
          {postParse.traceId ? (
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={() => { window.location.hash = buildTraceHash({ conversationId: trace.conversationId, traceId: postParse.traceId }); }}
            >
              Open Post-Parse Trace
            </button>
          ) : null}
          <button
            className="btn btn-sm btn-ghost"
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}${buildTraceHash({ conversationId: trace.conversationId, traceId: trace._id || trace.id })}`);
              } catch {}
            }}
          >
            Copy Trace Link
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h2 className="usage-card-title">Configuration</h2>
        <table className="table" style={{ fontSize: 'var(--text-sm)' }}>
          <tbody>
            <tr><td>Requested provider</td><td>{requested.primaryProvider ? getProviderLabel(requested.primaryProvider) : '--'}</td></tr>
            <tr><td>Requested model</td><td className="mono">{requested.primaryModel || '--'}</td></tr>
            <tr><td>Resolved provider</td><td>{resolved.primaryProvider ? getProviderLabel(resolved.primaryProvider) : '--'}</td></tr>
            <tr><td>Resolved model</td><td className="mono">{resolved.primaryModel || '--'}</td></tr>
            <tr><td>Fallback</td><td>{resolved.fallbackProvider ? `${getProviderLabel(resolved.fallbackProvider)} · ${resolved.fallbackModel || ''}` : '--'}</td></tr>
            <tr><td>Reasoning effort</td><td>{resolved.reasoningEffort || requested.reasoningEffort || '--'}</td></tr>
            <tr><td>Timeout</td><td>{requested.timeoutMs ? formatMs(requested.timeoutMs) : '--'}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h2 className="usage-card-title">Image Inputs</h2>
        {images.length === 0 ? (
          <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No images on this trace.</div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            {images.map((image) => (
              <div key={`${image.index}-${image.name || image.mimeType}`} style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 'var(--sp-4)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                  <strong>{image.name || `Image ${image.index + 1}`}</strong>
                  <span className="mono" style={{ fontSize: 'var(--text-xs)' }}>{image.mimeType || '--'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--sp-3)', marginTop: 'var(--sp-3)', fontSize: 'var(--text-sm)' }}>
                  <div>Original: {formatBytes(image.originalBytes)} · {image.originalWidth || '--'}×{image.originalHeight || '--'}</div>
                  <div>Prepared: {formatBytes(image.preparedBytes)} · {image.preparedWidth || '--'}×{image.preparedHeight || '--'}</div>
                  <div>Prep time: {formatMs(image.prepDurationMs)}</div>
                  <div>Compression: {image.compressionRatio ? `${image.compressionRatio}x` : '--'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h2 className="usage-card-title">Stage Summary</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--sp-3)' }}>
          <TraceStatCard label="Total" value={formatMs(outcome.totalMs)} />
          <TraceStatCard label="First Reasoning" value={formatMs(outcome.firstThinkingMs)} />
          <TraceStatCard label="First Output" value={formatMs(outcome.firstChunkMs)} />
          <TraceStatCard label="Triage" value={formatMs(triage.latencyMs)} helper={formatScore(triage.validationScore)} />
          <TraceStatCard label="Post-Parse" value={formatMs(postParse.latencyMs)} helper={formatScore(postParse.validationScore)} />
          <TraceStatCard label="Usage" value={trace.usage?.totalTokens ? `${trace.usage.totalTokens.toLocaleString()} tok` : '--'} helper={trace.usage?.totalCostMicros ? `$${(trace.usage.totalCostMicros / 1_000_000).toFixed(4)}` : ''} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h2 className="usage-card-title">Attempts</h2>
        {attempts.length === 0 ? (
          <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No attempt metadata recorded.</div>
        ) : (
          <table className="table" style={{ fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Model</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Latency</th>
                <th style={{ textAlign: 'right' }}>Tokens</th>
                <th style={{ textAlign: 'right' }}>Parse Score</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((attempt, index) => (
                <tr key={`${attempt.provider}-${index}`}>
                  <td>{getProviderLabel(attempt.provider || '')}</td>
                  <td className="mono">{attempt.model || '--'}</td>
                  <td><span className={traceStatusBadge(attempt.status === 'ok' ? 'ok' : 'error')}>{attempt.status}</span></td>
                  <td style={{ textAlign: 'right' }}>{formatMs(attempt.latencyMs)}</td>
                  <td style={{ textAlign: 'right' }}>{attempt.totalTokens ? attempt.totalTokens.toLocaleString() : '--'}</td>
                  <td style={{ textAlign: 'right' }}>{formatScore(attempt.validationScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h2 className="usage-card-title">Timeline</h2>
        {events.length === 0 ? (
          <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No stage events captured.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            {events.map((event, index) => (
              <div key={`${event.key || 'event'}-${index}`} style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 'var(--sp-3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                  <strong>{event.label || event.key || 'Event'}</strong>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                    {new Date(event.at).toLocaleString()} · {formatMs(event.elapsedMs)}
                  </span>
                </div>
                {event.message ? <div style={{ marginTop: 6, fontSize: 'var(--text-sm)' }}>{event.message}</div> : null}
                {(event.provider || event.model || event.code) ? (
                  <div style={{ marginTop: 6, fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                    {event.provider ? <span>{getProviderLabel(event.provider)}</span> : null}
                    {event.model ? <span className="mono">{event.model}</span> : null}
                    {event.code ? <span className="mono">{event.code}</span> : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="card" style={{ marginBottom: 0 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Raw Trace JSON</summary>
        <pre style={{ marginTop: 'var(--sp-4)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 'var(--text-xs)' }}>
          {JSON.stringify(trace, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export default function TraceDashboard({
  dateFrom,
  dateTo,
  autoRefresh = false,
  initialConversationId = '',
  initialSelectedTraceId = '',
  onRouteStateChange = null,
  active = true,
}) {
  const [service, setService] = useState('');
  const [status, setStatus] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [hasImages, setHasImages] = useState('all');
  const [conversationId, setConversationId] = useState(initialConversationId || '');
  const [trendMetric, setTrendMetric] = useState('avgTotalMs');
  const [trendInterval, setTrendInterval] = useState('daily');
  const [seriesLimit, setSeriesLimit] = useState(6);
  const [summary, setSummary] = useState(null);
  const [models, setModels] = useState([]);
  const [trends, setTrends] = useState([]);
  const [recent, setRecent] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [dataAvailableFrom, setDataAvailableFrom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedTraceId, setSelectedTraceId] = useState(initialSelectedTraceId || null);
  const [selectedTrace, setSelectedTrace] = useState(null);
  const [recentPage, setRecentPage] = useState(1);

  useEffect(() => {
    setConversationId(initialConversationId || '');
  }, [initialConversationId]);

  useEffect(() => {
    setSelectedTraceId(initialSelectedTraceId || null);
  }, [initialSelectedTraceId]);

  useEffect(() => {
    if (typeof onRouteStateChange !== 'function') return;
    onRouteStateChange({
      conversationId: conversationId.trim(),
      traceId: selectedTraceId || '',
    });
  }, [conversationId, selectedTraceId, onRouteStateChange]);

  const filters = useMemo(() => ({
    service: service || undefined,
    status: status || undefined,
    provider: provider || undefined,
    model: model.trim() || undefined,
    conversationId: conversationId.trim() || undefined,
    hasImages: hasImages === 'all' ? undefined : (hasImages === 'images'),
  }), [service, status, provider, model, conversationId, hasImages]);

  const fetchAll = useCallback(async (page = 1) => {
    if (!active) return;
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, modelsRes, trendsRes, recentRes] = await Promise.all([
        getTraceSummary(dateFrom, dateTo, filters),
        getTraceModels(dateFrom, dateTo, filters),
        getTraceModelTrends(dateFrom, dateTo, filters, trendInterval, seriesLimit),
        getTraceRecent(dateFrom, dateTo, filters, page, 40),
      ]);
      setSummary(summaryRes.summary || null);
      setModels(modelsRes.models || []);
      setTrends(trendsRes.series || []);
      setRecent(recentRes.recent || []);
      setPagination(recentRes.pagination || { page: 1, limit: 40, total: 0, totalPages: 1 });
      setDataAvailableFrom(summaryRes.dataAvailableFrom || modelsRes.dataAvailableFrom || trendsRes.dataAvailableFrom || recentRes.dataAvailableFrom || null);
    } catch (err) {
      setError(err.message || 'Failed to load trace monitor data');
    }
    setLoading(false);
  }, [active, dateFrom, dateTo, filters, trendInterval, seriesLimit]);

  useEffect(() => {
    if (!active) return;
    setRecentPage(1);
    fetchAll(1);
  }, [fetchAll, active]);

  useEffect(() => {
    if (!active || !autoRefresh) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') fetchAll(recentPage);
    }, 30_000);
    return () => clearInterval(timer);
  }, [active, autoRefresh, fetchAll, recentPage]);

  useEffect(() => {
    if (!selectedTraceId) {
      setSelectedTrace(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    getTraceDetail(selectedTraceId)
      .then((trace) => {
        if (!cancelled) setSelectedTrace(trace);
      })
      .catch((err) => {
        if (!cancelled) setSelectedTrace({ error: err.message || 'Failed to load trace detail' });
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedTraceId]);

  const handlePageChange = useCallback((page) => {
    setRecentPage(page);
    fetchAll(page);
  }, [fetchAll]);

  const handleSelectTrace = useCallback((traceId) => {
    setSelectedTraceId(traceId || null);
    const nextHash = buildTraceHash({
      conversationId,
      traceId,
    });
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }, [conversationId]);

  const handleCloseTrace = useCallback(() => {
    setSelectedTraceId(null);
    const nextHash = buildTraceHash({ conversationId });
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }, [conversationId]);

  if (!active) return null;

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', marginBottom: 'var(--sp-6)' }}>
        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
          Service
          <select value={service} onChange={(e) => setService(e.target.value)} className="usage-date-input" style={{ minWidth: 130 }}>
            <option value="">All</option>
            <option value="chat">Chat</option>
            <option value="parse">Parse</option>
          </select>
        </label>
        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="usage-date-input" style={{ minWidth: 130 }}>
            <option value="">All</option>
            <option value="ok">OK</option>
            <option value="error">Error</option>
            <option value="aborted">Aborted</option>
            <option value="running">Running</option>
          </select>
        </label>
        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
          Provider
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="usage-date-input" style={{ minWidth: 170 }}>
            <option value="">All</option>
            {PROVIDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
          Model
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="usage-date-input"
            placeholder="Filter by model"
            list="trace-model-options"
            style={{ minWidth: 180 }}
          />
          <datalist id="trace-model-options">
            {models.map((entry) => (
              <option key={`${entry.provider}-${entry.model}`} value={entry.model || ''} />
            ))}
          </datalist>
        </label>
        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
          Images
          <select value={hasImages} onChange={(e) => setHasImages(e.target.value)} className="usage-date-input" style={{ minWidth: 130 }}>
            <option value="all">All</option>
            <option value="images">Images only</option>
            <option value="text">Text only</option>
          </select>
        </label>
        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
          Conversation
          <input
            type="text"
            value={conversationId}
            onChange={(e) => setConversationId(e.target.value)}
            className="usage-date-input"
            placeholder="Conversation ID"
            style={{ minWidth: 220 }}
          />
        </label>
      </div>

      {dataAvailableFrom ? (
        <div className="usage-notice" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', marginBottom: 'var(--sp-6)', padding: 'var(--sp-3) var(--sp-4)', background: 'var(--bg-sunken)', borderRadius: 'var(--radius-md)' }}>
          Trace data available since {new Date(dataAvailableFrom).toISOString().slice(0, 10)}.
        </div>
      ) : null}

      {error ? (
        <div style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-6)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="app-content-constrained" style={{ textAlign: 'center', padding: 'var(--sp-10)' }}>
          <span className="spinner" />
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(145px, 1fr))', gap: 'var(--sp-4)', marginBottom: 'var(--sp-8)' }}>
            <TraceStatCard label="Traces" value={(summary?.totalTraces || 0).toLocaleString()} />
            <TraceStatCard label="Image Turns" value={formatPercent(summary?.imageTurnPercent || 0)} helper={(summary?.imageTurns || 0).toLocaleString()} />
            <TraceStatCard label="Avg Total" value={formatMs(summary?.avgTotalMs)} />
            <TraceStatCard label="Avg 1st Output" value={formatMs(summary?.avgFirstChunkMs)} />
            <TraceStatCard label="Avg 1st Reasoning" value={formatMs(summary?.avgFirstThinkingMs)} />
            <TraceStatCard label="Fallback Rate" value={formatPercent(summary?.fallbackRatePercent || 0)} />
            <TraceStatCard label="Error Rate" value={formatPercent(summary?.errorRatePercent || 0)} />
            <TraceStatCard label="Avg Prepared Bytes" value={formatBytes(summary?.avgPreparedBytes)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(420px, 100%), 1fr))', gap: 'var(--sp-6)', marginBottom: 'var(--sp-8)' }}>
            <div className="card">
              <h2 className="usage-card-title">Model Snapshot</h2>
              {models.length === 0 ? (
                <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No trace data for these filters.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ fontSize: 'var(--text-sm)', minWidth: 760 }}>
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th style={{ textAlign: 'right' }}>Req</th>
                        <th style={{ textAlign: 'right' }}>Avg Total</th>
                        <th style={{ textAlign: 'right' }}>1st Output</th>
                        <th style={{ textAlign: 'right' }}>1st Reasoning</th>
                        <th style={{ textAlign: 'right' }}>Errors</th>
                        <th style={{ textAlign: 'right' }}>Fallback</th>
                        <th style={{ textAlign: 'right' }}>Images</th>
                        <th style={{ textAlign: 'right' }}>Avg Parse</th>
                        <th style={{ textAlign: 'right' }}>Avg Img Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {models.slice(0, 12).map((entry) => (
                        <tr key={`${entry.provider}-${entry.model}`}>
                          <td>
                            <div>{getProviderLabel(entry.provider || '')}</div>
                            <div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>{entry.model || '(unknown)'}</div>
                          </td>
                          <td style={{ textAlign: 'right' }}>{entry.requests}</td>
                          <td style={{ textAlign: 'right' }}>{formatMs(entry.avgTotalMs)}</td>
                          <td style={{ textAlign: 'right' }}>{formatMs(entry.avgFirstChunkMs)}</td>
                          <td style={{ textAlign: 'right' }}>{formatMs(entry.avgFirstThinkingMs)}</td>
                          <td style={{ textAlign: 'right' }}>{formatPercent(entry.errorRatePercent)}</td>
                          <td style={{ textAlign: 'right' }}>{formatPercent(entry.fallbackRatePercent)}</td>
                          <td style={{ textAlign: 'right' }}>{entry.imageTurns || 0}</td>
                          <td style={{ textAlign: 'right' }}>{formatScore(entry.avgPostParseScore ?? entry.avgTriageScore)}</td>
                          <td style={{ textAlign: 'right' }}>{formatBytes(entry.avgPreparedBytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-4)', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 'var(--sp-4)' }}>
                <h2 className="usage-card-title" style={{ marginBottom: 0 }}>Model Trends Over Time</h2>
                <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)' }}>
                    Metric
                    <select value={trendMetric} onChange={(e) => setTrendMetric(e.target.value)} className="usage-date-input" style={{ minWidth: 170 }}>
                      {TREND_METRICS.map((entry) => (
                        <option key={entry.value} value={entry.value}>{entry.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)' }}>
                    Interval
                    <select value={trendInterval} onChange={(e) => setTrendInterval(e.target.value)} className="usage-date-input" style={{ minWidth: 130 }}>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </label>
                  <label style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)' }}>
                    Top models
                    <select value={seriesLimit} onChange={(e) => setSeriesLimit(Number(e.target.value) || 6)} className="usage-date-input" style={{ minWidth: 110 }}>
                      <option value="4">4</option>
                      <option value="6">6</option>
                      <option value="8">8</option>
                      <option value="10">10</option>
                    </select>
                  </label>
                </div>
              </div>
              {trends.length === 0 ? (
                <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No model trend data for these filters.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
                  {trends.map((series) => (
                    <div key={`${series.provider}-${series.model}`} style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 'var(--sp-4)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)', alignItems: 'flex-start', marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}>
                        <div>
                          <div>{getProviderLabel(series.provider || '')}</div>
                          <div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>{series.model || '(unknown)'}</div>
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                          {series.totalRequests} req
                        </div>
                      </div>
                      <SparkBars points={series.points} metric={trendMetric} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)', fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                        <span>
                          Latest {TREND_METRICS.find((entry) => entry.value === trendMetric)?.label?.toLowerCase() || 'metric'}:{' '}
                          {formatMetricValue(trendMetric, series.points[series.points.length - 1]?.[trendMetric])}
                        </span>
                        <span>Latest error rate: {formatPercent(series.points[series.points.length - 1]?.errorRatePercent || 0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 'var(--sp-8)' }}>
            <h2 className="usage-card-title">Recent Trace Runs</h2>
            {recent.length === 0 ? (
              <div className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>No traces in this period.</div>
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
                        <th style={{ textAlign: 'right' }}>Images</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                        <th style={{ textAlign: 'right' }}>1st Output</th>
                        <th style={{ textAlign: 'right' }}>Triage</th>
                        <th style={{ textAlign: 'right' }}>Post-Parse</th>
                        <th style={{ textAlign: 'right' }}>Parse Score</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((row) => (
                        <tr key={row.id}>
                          <td style={{ whiteSpace: 'nowrap', fontSize: 'var(--text-xs)' }}>
                            {new Date(row.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td><span className={`badge-service badge-service-${row.service || 'chat'}`}>{row.service}</span></td>
                          <td><span className={providerBadgeClass(row.providerUsed || row.requestedPrimaryProvider)}>{getProviderLabel(row.providerUsed || row.requestedPrimaryProvider || '')}</span></td>
                          <td className="mono" title={row.modelUsed || row.requestedPrimaryModel}>{row.modelUsed || row.requestedPrimaryModel || '--'}</td>
                          <td style={{ textAlign: 'right' }}>
                            {row.imageCount || 0}
                            {row.firstImage?.preparedWidth ? (
                              <div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                                {row.firstImage.preparedWidth}×{row.firstImage.preparedHeight}
                              </div>
                            ) : null}
                          </td>
                          <td style={{ textAlign: 'right' }}>{formatMs(row.totalMs)}</td>
                          <td style={{ textAlign: 'right' }}>{formatMs(row.firstChunkMs)}</td>
                          <td style={{ textAlign: 'right' }}>{formatMs(row.triageMs)}</td>
                          <td style={{ textAlign: 'right' }}>{formatMs(row.postParseMs)}</td>
                          <td style={{ textAlign: 'right' }}>{formatScore(row.postParseScore ?? row.triageScore)}</td>
                          <td><span className={traceStatusBadge(row.status)}>{row.status}</span></td>
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn btn-sm btn-ghost" type="button" onClick={() => handleSelectTrace(row.id)}>
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="usage-pagination">
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                    Showing {((pagination.page - 1) * pagination.limit) + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} traces
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

      <RightSidebar
        open={Boolean(selectedTraceId)}
        onClose={handleCloseTrace}
        title={detailLoading ? 'Loading Trace...' : 'Trace Detail'}
        width={440}
      >
        {detailLoading ? (
          <div style={{ padding: 'var(--sp-6)', textAlign: 'center' }}>
            <span className="spinner" />
          </div>
        ) : selectedTrace?.error ? (
          <div className="card">{selectedTrace.error}</div>
        ) : (
          <TraceDetailPanel trace={selectedTrace} />
        )}
      </RightSidebar>
    </div>
  );
}
