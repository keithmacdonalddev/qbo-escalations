import { useState, useEffect, useRef, useMemo } from 'react';

// ── Helpers ──────────────────────────────────────────────────

function formatDuration(ms) {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

const STATE_COLORS = {
  pending:   'var(--ink-tertiary)',
  headers:   'var(--ink-secondary)',
  streaming: 'var(--accent)',
  complete:  'var(--success, #34a853)',
  error:     'var(--danger, #e8574a)',
  aborted:   'var(--warning, #c47c1e)',
};

const METHOD_CLASSES = {
  GET:    '',
  POST:   'wf-method--post',
  PATCH:  'wf-method--patch',
  PUT:    'wf-method--patch',
  DELETE: 'wf-method--delete',
};

// ── useAnimationFrame — ticks ~60fps only when needed ────────

function useAnimationFrame(active) {
  const [now, setNow] = useState(() => performance.now());
  const rafRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    let running = true;
    function tick() {
      if (!running) return;
      setNow(performance.now());
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active]);

  return now;
}

// ── WaterfallRow ─────────────────────────────────────────────

function WaterfallRow({ req, windowStart, windowDuration, now, slowThreshold, onReplay }) {
  const effectiveEnd = req.endTime || now;
  const leftPct = ((req.startTime - windowStart) / windowDuration) * 100;
  const totalPct = ((effectiveEnd - req.startTime) / windowDuration) * 100;

  const ttfbPct = req.headersTime
    ? ((req.headersTime - req.startTime) / windowDuration) * 100
    : 0;

  const bodyPct = Math.max(totalPct - ttfbPct, 0.3);
  const barColor = STATE_COLORS[req.state] || STATE_COLORS.pending;
  const isActive = req.state === 'pending' || req.state === 'streaming' || req.state === 'headers';
  const duration = effectiveEnd - req.startTime;
  const isSlow = slowThreshold > 0 && duration > slowThreshold;

  return (
    <div className={`wf-row${isActive ? ' wf-row--active' : ''}${isSlow ? ' wf-row--slow' : ''}`}>
      <div className="wf-label">
        <span className={`wf-method ${METHOD_CLASSES[req.method] || ''}`}>
          {req.method}
        </span>
        <span className="wf-url" title={req.url}>
          {req.url.split('?')[0].replace('/api/', '')}
        </span>
        <span className={`wf-status${req.ok === false ? ' wf-status--err' : ''}`}>
          {req.status || '\u2026'}
        </span>
        {!isActive && onReplay && (
          <button
            className="wf-replay-btn"
            onClick={(e) => { e.stopPropagation(); onReplay(req.id); }}
            type="button"
            title={`Replay ${req.method} ${req.url.split('?')[0].replace('/api/', '')}`}
            aria-label="Replay request"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.65 6.35A7.96 7.96 0 0012 4a8 8 0 108 8h-2a6 6 0 11-1.76-4.24L14 10h7V3l-3.35 3.35z" />
            </svg>
          </button>
        )}
      </div>
      <div className="wf-track">
        {ttfbPct > 0.2 && (
          <div
            className="wf-bar wf-bar--ttfb"
            style={{ left: `${leftPct}%`, width: `${ttfbPct}%` }}
          />
        )}
        <div
          className={`wf-bar${isActive ? ' wf-bar--pulse' : ''}`}
          style={{
            left: `${leftPct + ttfbPct}%`,
            width: `${bodyPct}%`,
            backgroundColor: barColor,
          }}
        />
        <span
          className="wf-duration"
          style={{ left: `${Math.min(leftPct + totalPct + 0.5, 95)}%` }}
        >
          {formatDuration(duration)}
        </span>
      </div>
    </div>
  );
}

// ── GroupedRow ───────────────────────────────────────────────

function GroupedRow({ group, maxDuration }) {
  const scale = maxDuration > 0 ? 1 / maxDuration : 1;
  const minPct = (group.min * scale) * 100;
  const avgPct = (group.avg * scale) * 100;
  const maxPct = (group.max * scale) * 100;

  return (
    <div className={`wf-row${group.active > 0 ? ' wf-row--active' : ''}`}>
      <div className="wf-label">
        <span className={`wf-method ${METHOD_CLASSES[group.method] || ''}`}>
          {group.method}
        </span>
        <span className="wf-url" title={group.endpoint}>
          {group.endpoint}
        </span>
        <span className="wf-group-count">{group.count}x</span>
      </div>
      <div className="wf-track">
        <div
          className="wf-bar wf-bar--ttfb"
          style={{ left: `${minPct}%`, width: `${Math.max(maxPct - minPct, 0.5)}%` }}
        />
        <div
          className="wf-bar"
          style={{
            left: `${avgPct}%`,
            width: `${Math.max(maxPct - avgPct, 0.5)}%`,
            backgroundColor: group.active > 0 ? STATE_COLORS.streaming : STATE_COLORS.complete,
          }}
        />
        <span className="wf-duration wf-duration--grouped">
          {formatDuration(group.min)} / {formatDuration(group.avg)} / {formatDuration(group.max)}
        </span>
      </div>
    </div>
  );
}

// ── groupRequests ────────────────────────────────────────────

function groupRequests(requests, now) {
  const map = new Map();
  for (const req of requests) {
    const endpoint = req.url.split('?')[0].replace('/api/', '');
    const key = `${req.method} ${endpoint}`;
    if (!map.has(key)) {
      map.set(key, { method: req.method, endpoint, count: 0, durations: [], active: 0 });
    }
    const g = map.get(key);
    g.count++;
    const isActive = req.state === 'pending' || req.state === 'streaming' || req.state === 'headers';
    if (isActive) g.active++;
    g.durations.push((req.endTime || now) - req.startTime);
  }

  const groups = [];
  for (const g of map.values()) {
    const sorted = g.durations.sort((a, b) => a - b);
    groups.push({
      key: `${g.method} ${g.endpoint}`,
      method: g.method,
      endpoint: g.endpoint,
      count: g.count,
      active: g.active,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    });
  }

  groups.sort((a, b) => b.count - a.count);
  return groups;
}

// ── RequestWaterfall (content — no collapse wrapper) ─────────

export default function RequestWaterfall({
  requests, clearRequests, enabled, setEnabled,
  slowThreshold, setSlowThreshold, persist, setPersist,
  replayRequest,
}) {
  const [viewMode, setViewMode] = useState('timeline');
  const rowsRef = useRef(null);

  const activeCount = useMemo(
    () => requests.filter(r => r.state === 'pending' || r.state === 'streaming' || r.state === 'headers').length,
    [requests],
  );

  const now = useAnimationFrame(activeCount > 0);

  const groups = useMemo(
    () => viewMode === 'grouped' ? groupRequests(requests, now) : [],
    [requests, now, viewMode],
  );
  const maxGroupDuration = useMemo(
    () => groups.length > 0 ? Math.max(...groups.map(g => g.max)) : 1,
    [groups],
  );

  // Auto-scroll to newest
  const prevLenRef = useRef(requests.length);
  useEffect(() => {
    if (viewMode === 'timeline' && requests.length > prevLenRef.current && rowsRef.current) {
      rowsRef.current.scrollTop = rowsRef.current.scrollHeight;
    }
    prevLenRef.current = requests.length;
  }, [requests.length, viewMode]);

  const windowStart = requests.length > 0
    ? Math.min(...requests.map(r => r.startTime))
    : 0;
  const windowEnd = requests.length > 0
    ? Math.max(now, ...requests.map(r => r.endTime || now))
    : 1;
  const windowDuration = (windowEnd - windowStart) || 1;

  return (
    <div className="wf-sidebar-content">
      {/* Toolbar */}
      <div className="wf-toolbar">
        <div className="wf-view-toggle">
          <button
            className={`wf-view-btn${viewMode === 'timeline' ? ' wf-view-btn--active' : ''}`}
            onClick={() => setViewMode('timeline')}
            type="button"
          >
            Timeline
          </button>
          <button
            className={`wf-view-btn${viewMode === 'grouped' ? ' wf-view-btn--active' : ''}`}
            onClick={() => setViewMode('grouped')}
            type="button"
          >
            Grouped
          </button>
        </div>
        <div className="wf-toolbar-row">
          <label className="wf-record-toggle">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            Record
          </label>
          <label className="wf-record-toggle" title="Persist request history across page reloads">
            <input type="checkbox" checked={persist} onChange={e => setPersist(e.target.checked)} />
            Persist
          </label>
        </div>
        <div className="wf-toolbar-row">
          <div className="wf-slow-input" title="Highlight requests slower than this threshold">
            <span>Slow:</span>
            <input
              type="number"
              min="0"
              step="100"
              value={slowThreshold}
              onChange={e => setSlowThreshold(Math.max(0, Number(e.target.value) || 0))}
            />
            <span>ms</span>
          </div>
          <button
            className="wf-clear-btn"
            onClick={clearRequests}
            type="button"
            disabled={requests.length === 0}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Rows */}
      {requests.length === 0 ? (
        <div className="wf-empty">No requests recorded</div>
      ) : viewMode === 'timeline' ? (
        <div className="wf-rows" ref={rowsRef}>
          {requests.map(req => (
            <WaterfallRow
              key={req.id}
              req={req}
              windowStart={windowStart}
              windowDuration={windowDuration}
              now={now}
              slowThreshold={slowThreshold}
              onReplay={replayRequest}
            />
          ))}
        </div>
      ) : (
        <div className="wf-rows" ref={rowsRef}>
          {groups.map(group => (
            <GroupedRow
              key={group.key}
              group={group}
              maxDuration={maxGroupDuration}
            />
          ))}
        </div>
      )}

      {viewMode === 'grouped' && groups.length > 0 && (
        <div className="wf-legend">min / avg / max</div>
      )}
    </div>
  );
}
