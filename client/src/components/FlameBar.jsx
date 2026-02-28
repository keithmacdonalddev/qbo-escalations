import { memo } from 'react';

/**
 * Dev-only render flame bar. Deliberately avoids Framer Motion —
 * AnimatePresence + rapid segment churn was a major memory source.
 * Pure CSS transitions are sufficient and zero-overhead.
 */
function FlameBar({ segments, stats, expanded, toggleExpanded }) {
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

      {/* Stats overlay */}
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
      </div>

      {/* Toggle */}
      <button
        className={`flame-toggle${expanded ? ' flame-toggle--shifted' : ''}`}
        onClick={toggleExpanded}
        type="button"
        title={expanded ? 'Collapse flame bar' : 'Expand flame bar'}
      >
        {expanded ? '\u25BE collapse' : '\u25B8 expand'}
      </button>
    </>
  );
}

export default memo(FlameBar);
