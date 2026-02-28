import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { transitions, fadeSlideUp } from '../utils/motion.js';

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

function WaterfallRow({ req, windowStart, windowDuration, now }) {
  const effectiveEnd = req.endTime || now;
  const leftPct = ((req.startTime - windowStart) / windowDuration) * 100;
  const totalPct = ((effectiveEnd - req.startTime) / windowDuration) * 100;

  // TTFB portion — from start to headersTime
  const ttfbPct = req.headersTime
    ? ((req.headersTime - req.startTime) / windowDuration) * 100
    : 0;

  const bodyPct = Math.max(totalPct - ttfbPct, 0.3);
  const barColor = STATE_COLORS[req.state] || STATE_COLORS.pending;
  const isActive = req.state === 'pending' || req.state === 'streaming' || req.state === 'headers';
  const duration = effectiveEnd - req.startTime;

  return (
    <div className={`wf-row${isActive ? ' wf-row--active' : ''}`}>
      {/* Label column */}
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
      </div>

      {/* Track column */}
      <div className="wf-track">
        {/* TTFB bar (lighter) */}
        {ttfbPct > 0.2 && (
          <div
            className="wf-bar wf-bar--ttfb"
            style={{
              left: `${leftPct}%`,
              width: `${ttfbPct}%`,
            }}
          />
        )}
        {/* Body / stream bar */}
        <div
          className={`wf-bar${isActive ? ' wf-bar--pulse' : ''}`}
          style={{
            left: `${leftPct + ttfbPct}%`,
            width: `${bodyPct}%`,
            backgroundColor: barColor,
          }}
        />
        {/* Duration */}
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
      {/* Label column */}
      <div className="wf-label">
        <span className={`wf-method ${METHOD_CLASSES[group.method] || ''}`}>
          {group.method}
        </span>
        <span className="wf-url" title={group.endpoint}>
          {group.endpoint}
        </span>
        <span className="wf-group-count">{group.count}x</span>
      </div>

      {/* Track column — min/avg/max range bar */}
      <div className="wf-track">
        {/* Range bar: min to max */}
        <div
          className="wf-bar wf-bar--ttfb"
          style={{ left: `${minPct}%`, width: `${Math.max(maxPct - minPct, 0.5)}%` }}
        />
        {/* Avg marker */}
        <div
          className="wf-bar"
          style={{
            left: `${avgPct}%`,
            width: `${Math.max(maxPct - avgPct, 0.5)}%`,
            backgroundColor: group.active > 0 ? STATE_COLORS.streaming : STATE_COLORS.complete,
          }}
        />
        {/* Labels */}
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
    const dur = (req.endTime || now) - req.startTime;
    g.durations.push(dur);
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

  // Sort by count descending — chattiest endpoints first
  groups.sort((a, b) => b.count - a.count);
  return groups;
}

// ── RequestWaterfall ─────────────────────────────────────────

export default function RequestWaterfall({ requests, clearRequests, enabled, setEnabled }) {
  const [collapsed, setCollapsed] = useState(true);
  const [viewMode, setViewMode] = useState('timeline'); // 'timeline' | 'grouped'
  const bodyRef = useRef(null);

  const activeCount = useMemo(
    () => requests.filter(r => r.state === 'pending' || r.state === 'streaming' || r.state === 'headers').length,
    [requests],
  );

  // Only run animation frames when panel is open and there are active requests
  const now = useAnimationFrame(!collapsed && activeCount > 0);

  // Grouped view data
  const groups = useMemo(
    () => viewMode === 'grouped' ? groupRequests(requests, now) : [],
    [requests, now, viewMode],
  );
  const maxGroupDuration = useMemo(
    () => groups.length > 0 ? Math.max(...groups.map(g => g.max)) : 1,
    [groups],
  );

  // Auto-scroll to newest when a new request appears (timeline only)
  const prevLenRef = useRef(requests.length);
  useEffect(() => {
    if (viewMode === 'timeline' && requests.length > prevLenRef.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
    prevLenRef.current = requests.length;
  }, [requests.length, viewMode]);

  // Time window for bar positioning (timeline)
  const windowStart = requests.length > 0
    ? Math.min(...requests.map(r => r.startTime))
    : 0;
  const windowEnd = requests.length > 0
    ? Math.max(now, ...requests.map(r => r.endTime || now))
    : 1;
  const windowDuration = (windowEnd - windowStart) || 1;

  return (
    <div className="wf">
      {/* Toggle bar */}
      <button
        className="wf-toggle"
        onClick={() => setCollapsed(c => !c)}
        type="button"
        aria-expanded={!collapsed}
        aria-label="Toggle request waterfall"
      >
        <svg
          className={`wf-chevron${collapsed ? '' : ' wf-chevron--open'}`}
          width="12" height="12" viewBox="0 0 12 12"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="3 5 6 8 9 5" />
        </svg>
        <span className="wf-toggle-label">Network</span>
        {requests.length > 0 && (
          <span className="wf-count">{requests.length}</span>
        )}
        {activeCount > 0 && (
          <span className="wf-active-badge">{activeCount} active</span>
        )}
      </button>

      {/* Collapsible body */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            className="wf-body"
            ref={bodyRef}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transitions.fast}
          >
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
              <label className="wf-record-toggle">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={e => setEnabled(e.target.checked)}
                />
                Record
              </label>
              <button
                className="wf-clear-btn"
                onClick={clearRequests}
                type="button"
                disabled={requests.length === 0}
              >
                Clear
              </button>
            </div>

            {/* Rows */}
            {requests.length === 0 ? (
              <div className="wf-empty">No requests recorded</div>
            ) : viewMode === 'timeline' ? (
              <div className="wf-rows">
                {requests.map(req => (
                  <WaterfallRow
                    key={req.id}
                    req={req}
                    windowStart={windowStart}
                    windowDuration={windowDuration}
                    now={now}
                  />
                ))}
              </div>
            ) : (
              <div className="wf-rows">
                {groups.map(group => (
                  <GroupedRow
                    key={group.key}
                    group={group}
                    maxDuration={maxGroupDuration}
                  />
                ))}
              </div>
            )}

            {/* Grouped view legend */}
            {viewMode === 'grouped' && groups.length > 0 && (
              <div className="wf-legend">min / avg / max</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
