import { useState, useEffect, useRef, useMemo } from 'react';

// ── Friendly endpoint-to-feature name mapping ────────────────

const ENDPOINT_NAMES = {
  'chat/send': 'Chat',
  'chat/conversations': 'Conversations',
  'chat/history': 'Chat History',
  'escalations': 'Escalations',
  'gmail/threads': 'Email',
  'gmail/send': 'Send Email',
  'gmail/labels': 'Email Labels',
  'calendar': 'Calendar',
  'copilot': 'AI Copilot',
  'dev/health': 'System Health',
  'dev/server-errors': 'Error Monitor',
  'dev/monitor': 'Monitor',
  'workspace/status': 'Workspace',
  'workspace/briefing': 'Briefing',
  'traces': 'AI Traces',
  'agents': 'Agents',
};

function friendlyEndpoint(rawUrl) {
  const short = rawUrl.split('?')[0].replace('/api/', '');
  for (const [pattern, name] of Object.entries(ENDPOINT_NAMES)) {
    if (short === pattern || short.startsWith(pattern + '/')) return name;
  }
  // Best-effort: strip /api/, capitalize first segment
  const first = short.split('/')[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

// ── Friendly status code labels ──────────────────────────────

function friendlyStatus(status, ok, state) {
  if (!status && (state === 'pending' || state === 'headers' || state === 'streaming')) return 'Loading\u2026';
  if (!status) return '\u2026';
  if (status === 200 || status === 201 || status === 204) return 'OK';
  if (status === 400) return 'Bad Request';
  if (status === 401) return 'Unauthorized';
  if (status === 403) return 'Forbidden';
  if (status === 404) return 'Not Found';
  if (status === 429) return 'Rate Limited';
  if (status >= 500) return 'Failed';
  if (ok === false) return 'Error';
  return 'OK';
}

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

// ── HelpTip — small "?" icon with hover tooltip ─────────────

function HelpTip({ text }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);

  return (
    <span
      className="wf-help"
      ref={ref}
      onMouseEnter={() => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        const bw = 220;
        let left = r.left + r.width / 2 - bw / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
        const above = window.innerHeight - r.bottom < 140;
        setPos({ left, above, anchor: above ? r.top : r.bottom });
      }}
      onMouseLeave={() => setPos(null)}
      onClick={e => { e.stopPropagation(); e.preventDefault(); }}
    >
      ?
      {pos && (
        <span
          className="wf-help-bubble"
          style={{
            position: 'fixed',
            left: pos.left,
            ...(pos.above
              ? { bottom: window.innerHeight - pos.anchor + 8 }
              : { top: pos.anchor + 8 }),
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

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
    <div className={`wf-row${isActive ? ' wf-row--active' : ''}${isSlow ? ' wf-row--slow' : ''}${req.isDuplicate ? ' wf-row--duplicate' : ''}`}>
      <div className="wf-label">
        <span className={`wf-method ${METHOD_CLASSES[req.method] || ''}`} title={req.method === 'GET' ? 'Loading data from the server' : req.method === 'POST' ? 'Sending data to the server' : req.method}>
          {req.method}
        </span>
        <span className="wf-url" title={req.url.split('?')[0].replace('/api/', '')}>
          {friendlyEndpoint(req.url)}
        </span>
        <span className={`wf-status${req.ok === false || (req.status && req.status >= 400) ? ' wf-status--err' : req.status >= 200 && req.status < 300 ? ' wf-status--ok' : ''}`} title={req.status ? `Status ${req.status}` : 'Waiting for response...'}>
          {friendlyStatus(req.status, req.ok, req.state)}
        </span>
        {req.isDuplicate && (
          <span className="wf-duplicate-badge" title="The app sent this same request twice within 100ms — usually a bug causing wasted work">
            DUP
          </span>
        )}
        {!isActive && onReplay && req.canReplay !== false && (
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

function shortEndpoint(endpoint) {
  const parts = endpoint.split('/');
  if (parts.length <= 1) return endpoint;
  // Show "prefix/last" — keeps the parent for context, prioritizes the distinguishing segment
  return parts.length === 2 ? endpoint : `${parts[0]}/\u2026/${parts[parts.length - 1]}`;
}

function GroupedRow({ group, maxDuration, slowThreshold }) {
  const scale = maxDuration > 0 ? 1 / maxDuration : 1;
  const minPct = (group.min * scale) * 100;
  const avgPct = (group.avg * scale) * 100;
  const maxPct = (group.max * scale) * 100;
  const isHot = slowThreshold > 0 && group.p95 > slowThreshold;

  return (
    <div className={`wf-row${group.active > 0 ? ' wf-row--active' : ''}${isHot ? ' wf-row--hot' : ''}`}>
      <div className="wf-label">
        <span className={`wf-method ${METHOD_CLASSES[group.method] || ''}`} title={group.method === 'GET' ? 'Loading data from the server' : group.method === 'POST' ? 'Sending data to the server' : group.method}>
          {group.method}
        </span>
        <span className="wf-url" title={group.endpoint}>
          {friendlyEndpoint('/api/' + group.endpoint)}
        </span>
        {isHot && (
          <span className="wf-hot-badge" title={`Slow endpoint — most requests take over ${formatDuration(group.p95)}`}>
            <svg className="wf-hot-flame" width="10" height="12" viewBox="0 0 16 20" fill="currentColor">
              <path d="M8 0C8 0 2 6.5 2 12a6 6 0 0012 0c0-2-.7-3.8-2-5.2 0 0-.5 2.2-2 3.2 0-3-1.5-5.5-2-6-.5 1.5-1.5 2.5-1.5 2.5S8 3 8 0z" />
            </svg>
          </span>
        )}
        <span className="wf-group-count" title={`Called ${group.count} time${group.count !== 1 ? 's' : ''} — higher count means the app uses this endpoint a lot`}>{group.count}x</span>
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
            backgroundColor: isHot ? 'var(--warning, #c47c1e)' : group.active > 0 ? STATE_COLORS.streaming : STATE_COLORS.complete,
          }}
        />
        <span className="wf-duration wf-duration--grouped" title={`Fastest: ${formatDuration(group.min)} · Average: ${formatDuration(group.avg)} · Slowest: ${formatDuration(group.max)}`}>
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
    const p95Idx = Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1);
    groups.push({
      key: `${g.method} ${g.endpoint}`,
      method: g.method,
      endpoint: g.endpoint,
      count: g.count,
      active: g.active,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      p95: sorted[p95Idx],
    });
  }

  groups.sort((a, b) => b.count - a.count);
  return groups;
}

// ── RequestWaterfall (content — no collapse wrapper) ─────────

export default function RequestWaterfall({
  requests, clearRequests, enabled, setEnabled,
  slowThreshold, setSlowThreshold, persist, setPersist,
  replayRequest, budget, defaultView = 'timeline',
}) {
  const [viewMode, setViewMode] = useState(defaultView);
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
          <HelpTip text="Timeline shows every request in order. Grouped combines identical requests to show patterns, counts, and speed ranges." />
        </div>
        <div className="wf-toolbar-row">
          <label className="wf-record-toggle">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            Record
          </label>
          <HelpTip text="When on, captures every server request your app makes. Turn off to pause without losing what's already recorded." />
          <label className="wf-record-toggle">
            <input type="checkbox" checked={persist} onChange={e => setPersist(e.target.checked)} />
            Persist
          </label>
          <HelpTip text="Keeps the request log even when you reload the page. Turn off to start fresh each time." />
        </div>
        <div className="wf-toolbar-row">
          <div className="wf-slow-input">
            <span>Slow:</span>
            <input
              type="number"
              min="0"
              step="100"
              value={slowThreshold}
              onChange={e => setSlowThreshold(Math.max(0, Number(e.target.value) || 0))}
            />
            <span>ms</span>
            <HelpTip text="Requests slower than this get highlighted red. 1000ms = 1 second. Lower the number to catch more slow requests." />
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

      {/* Budget indicator */}
      {budget && (
        <div className="wf-budget">
          <div className="wf-budget-item">
            <span className={`wf-budget-dot wf-budget-dot--${activeCount > 0 ? 'active' : 'idle'}`} />
            <span className="wf-budget-value">{activeCount}</span>
            <span className="wf-budget-label">active</span>
            <HelpTip text="Server requests happening right now. 0 means the app is idle — nothing loading." />
          </div>
          <div className="wf-budget-sep" />
          <div className="wf-budget-item">
            <svg className="wf-budget-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M7 17L17 7M17 7H7M17 7V17" />
            </svg>
            <span className="wf-budget-value">{budget.dedupSaves}</span>
            <span className="wf-budget-label">deduped</span>
            <HelpTip text="Times the app skipped a duplicate request by reusing one already in progress. Higher number = less wasted work." />
          </div>
          <div className="wf-budget-sep" />
          <div className="wf-budget-item">
            <span className={`wf-budget-dot wf-budget-dot--circuit-${budget.circuit}`} />
            <span className="wf-budget-label">
              {budget.circuit === 'closed' ? 'Circuit OK'
                : budget.circuit === 'open' ? 'Circuit OPEN'
                : `Circuit ${budget.failures}/${budget.threshold}`}
            </span>
            <HelpTip text="A safety switch. If many requests fail in a row, it temporarily blocks new ones to protect the server. 'OK' = everything is healthy." />
          </div>
        </div>
      )}

      {/* Row guide — explains what each part of a row means */}
      {requests.length > 0 && (
        <div className="wf-row-guide">
          <span className="wf-guide-item">
            <span className="wf-method">GET</span>
            <span className="wf-guide-sep">/</span>
            <span className="wf-method wf-method--post">POST</span>
            <HelpTip text="GET = your app is loading data from the server (conversations, analytics, etc). POST = your app is sending data (like a chat message or image)." />
          </span>
          <span className="wf-guide-item">
            <svg className="wf-hot-flame" width="10" height="12" viewBox="0 0 16 20" fill="currentColor"><path d="M8 0C8 0 2 6.5 2 12a6 6 0 0012 0c0-2-.7-3.8-2-5.2 0 0-.5 2.2-2 3.2 0-3-1.5-5.5-2-6-.5 1.5-1.5 2.5-1.5 2.5S8 3 8 0z" /></svg>
            <HelpTip text="Fire icon = this endpoint is consistently slow. It's taking longer than your 'Slow' threshold most of the time. Worth investigating." />
          </span>
          <span className="wf-guide-item">
            <span className="wf-guide-example">10x</span>
            <HelpTip text="How many times this endpoint was called. High numbers with fire icons may mean the app is making too many slow requests." />
          </span>
          <span className="wf-guide-item">
            <span className="wf-guide-bar" />
            <HelpTip text="The colored bar shows response time visually. Longer bar = slower response. Green = fast, orange/red = slow." />
          </span>
          <span className="wf-guide-item">
            <span className="wf-guide-red">Red text</span>
            <HelpTip text="Red numbers mean very slow responses. These are the requests most likely causing lag or delays in the app." />
          </span>
        </div>
      )}

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
              slowThreshold={slowThreshold}
            />
          ))}
        </div>
      )}

      {viewMode === 'grouped' && groups.length > 0 && (
        <div className="wf-legend">
          min / avg / max
          <HelpTip text="For each endpoint: the fastest response / the typical (average) response / the slowest response." />
        </div>
      )}
    </div>
  );
}
