import { memo, useState, useEffect } from 'react';

/**
 * Dev-only render flame bar. Deliberately avoids Framer Motion —
 * AnimatePresence + rapid segment churn was a major memory source.
 * Pure CSS transitions are sufficient and zero-overhead.
 */
function FlameBar({ segments, stats, expanded, toggleExpanded, paused, togglePaused, clearAll, timeline }) {
  // HMR reload indicator — reads timestamp from sessionStorage, fades out after 30s
  const [hmrAge, setHmrAge] = useState(null);
  useEffect(() => {
    let raw;
    try { raw = sessionStorage.getItem('qbo-hmr-reload-at'); } catch {}
    if (!raw) return;
    const ts = Number(raw);
    const update = () => {
      const sec = Math.round((Date.now() - ts) / 1000);
      if (sec > 30) { setHmrAge(null); sessionStorage.removeItem('qbo-hmr-reload-at'); return; }
      setHmrAge(sec < 2 ? 'just now' : `${sec}s ago`);
    };
    update();
    const tid = setInterval(update, 1000);
    return () => clearInterval(tid);
  }, []);

  if (!segments) return null;

  return (
    <>
      {/* Bar strip */}
      <div className={`flame-bar${expanded ? ' flame-bar--expanded' : ''}`}>
        {segments.map(seg => (
          <div
            key={seg.id}
            className={`flame-seg flame-seg--${seg.tier}${seg.fading ? ' flame-seg--fading' : ''}`}
            style={{ width: seg.width }}
            title={`${seg.duration.toFixed(1)}ms (${seg.phase})`}
          >
            {expanded && (
              <span className="flame-seg-inline">
                {seg.duration < 10 ? seg.duration.toFixed(1) : Math.round(seg.duration)}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Heatmap timeline — 60s render density minimap */}
      <div className={`flame-timeline${expanded ? ' flame-timeline--expanded' : ''}`}>
        {timeline && timeline.map((bucket, i) => (
          <div
            key={i}
            className={`flame-tl-col${bucket ? ` flame-tl-col--${bucket.worst}` : ''}`}
            style={bucket ? { opacity: 0.2 + bucket.intensity * 0.8 } : undefined}
            title={expanded && bucket
              ? `${bucket.total} render${bucket.total !== 1 ? 's' : ''} · ${i === timeline.length - 1 ? 'now' : `${timeline.length - 1 - i}s ago`}`
              : undefined}
          />
        ))}
      </div>

      {/* Stats + controls unified strip */}
      <div className={`flame-stats${expanded ? ' flame-stats--shifted' : ''}`}>
        <span>
          <span className="flame-dot flame-dot--green" />
          <span className="flame-stat-val">{stats.green}</span>
        </span>
        <span>
          <span className="flame-dot flame-dot--amber" />
          <span className="flame-stat-val">{stats.amber}</span>
        </span>
        <span>
          <span className="flame-dot flame-dot--red" />
          <span className="flame-stat-val">{stats.red}</span>
        </span>
        <span>
          avg <span className="flame-stat-val">{stats.avg}ms</span>
        </span>
        {paused && <span className="flame-paused-badge">PAUSED</span>}
        {hmrAge && <span className="flame-hmr-badge" title="Last HMR auto-reload">reloaded {hmrAge}</span>}

        <span className="flame-controls-inline">
          <button
            className={`flame-ctrl-btn${paused ? ' flame-ctrl-btn--active' : ''}`}
            onClick={togglePaused}
            type="button"
            title={paused ? 'Resume recording' : 'Pause recording'}
          >
            {paused ? '\u25B6' : '\u2759\u2759'}
          </button>
          <button
            className="flame-ctrl-btn"
            onClick={clearAll}
            type="button"
            title="Clear all segments and reset stats"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
          <button
            className="flame-ctrl-btn"
            onClick={toggleExpanded}
            type="button"
            title={expanded ? 'Collapse flame bar' : 'Expand flame bar'}
          >
            {expanded ? '\u25BE' : '\u25B8'}
          </button>
        </span>
      </div>
    </>
  );
}

export default memo(FlameBar);
