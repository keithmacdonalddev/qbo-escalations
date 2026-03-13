import { useState, useEffect, useRef, useMemo } from 'react';

/**
 * HealthBanner — slim status strip at the very top of the app.
 *
 * Reads the same request data from useRequestWaterfall and shows:
 *   Green:  "All systems working" (auto-hides after 3s)
 *   Yellow: "Chat is responding slowly" etc.
 *   Red:    "2 features aren't working" etc.
 *
 * Click the pill to expand a per-feature detail panel.
 */

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

function featureName(url) {
  const short = url.split('?')[0].replace('/api/', '');
  for (const [pattern, name] of Object.entries(ENDPOINT_NAMES)) {
    if (short === pattern || short.startsWith(pattern + '/')) return name;
  }
  // best-effort: capitalize first segment
  const first = short.split('/')[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function formatDuration(ms) {
  if (ms >= 10000) return (ms / 1000).toFixed(0) + 's';
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
  return (ms / 1000).toFixed(2) + 's';
}

export default function HealthBanner({ requests, slowThreshold = 500 }) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [greenVisible, setGreenVisible] = useState(false);
  const greenTimerRef = useRef(null);
  const prevLevelRef = useRef('green');

  // Analyze recent requests (last 30 seconds only)
  const { level, message, details } = useMemo(() => {
    const now = performance.now();
    const recent = requests.filter(r => !r.restored && now - r.startTime < 30_000);

    // Failures: status >= 500 or state === 'error' in recent window
    const failed = recent.filter(r => r.state === 'error' || (r.status && r.status >= 500));
    // Slow: completed requests exceeding threshold
    const slow = recent.filter(r => {
      if (r.state !== 'complete') return false;
      const dur = (r.endTime || now) - r.startTime;
      return slowThreshold > 0 && dur > slowThreshold;
    });

    // Build details array — one entry per request that's bad
    const rawDetails = [];
    for (const r of failed) {
      const dur = (r.endTime || now) - r.startTime;
      rawDetails.push({
        name: featureName(r.url),
        duration: dur,
        status: 'error',
        statusCode: r.status || null,
      });
    }
    for (const r of slow) {
      const dur = (r.endTime || now) - r.startTime;
      rawDetails.push({
        name: featureName(r.url),
        duration: dur,
        status: 'slow',
        statusCode: r.status || null,
      });
    }

    // Deduplicate by name, keeping worst entry (error > slow, then longest duration)
    const byName = new Map();
    for (const d of rawDetails) {
      const existing = byName.get(d.name);
      if (!existing) {
        byName.set(d.name, d);
      } else {
        const existingPriority = existing.status === 'error' ? 1 : 0;
        const newPriority = d.status === 'error' ? 1 : 0;
        if (newPriority > existingPriority || (newPriority === existingPriority && d.duration > existing.duration)) {
          byName.set(d.name, d);
        }
      }
    }
    const dedupedDetails = [...byName.values()].sort((a, b) => {
      // errors first, then by duration desc
      if (a.status !== b.status) return a.status === 'error' ? -1 : 1;
      return b.duration - a.duration;
    });

    const failedFeatures = [...new Set(failed.map(r => featureName(r.url)))];
    if (failedFeatures.length > 0) {
      const msg = failedFeatures.length === 1
        ? `${failedFeatures[0]} is not working`
        : `${failedFeatures.slice(0, 3).join(', ')}${failedFeatures.length > 3 ? ` +${failedFeatures.length - 3} more` : ''} not working`;
      return { level: 'red', message: msg, details: dedupedDetails };
    }

    const slowFeatures = [...new Set(slow.map(r => featureName(r.url)))];
    if (slowFeatures.length > 0) {
      const msg = slowFeatures.length === 1
        ? `${slowFeatures[0]} is responding slowly`
        : `${slowFeatures.slice(0, 3).join(', ')}${slowFeatures.length > 3 ? ` +${slowFeatures.length - 3} more` : ''} responding slowly`;
      return { level: 'yellow', message: msg, details: dedupedDetails };
    }

    return { level: 'green', message: 'All systems working', details: [] };
  }, [requests, slowThreshold]);

  // When transitioning TO green, flash briefly then hide
  useEffect(() => {
    if (level === 'green' && prevLevelRef.current !== 'green') {
      setGreenVisible(true);
      setDismissed(false);
      setExpanded(false);
      greenTimerRef.current = setTimeout(() => setGreenVisible(false), 3000);
    } else if (level !== 'green') {
      setGreenVisible(false);
      setDismissed(false);
      if (greenTimerRef.current) clearTimeout(greenTimerRef.current);
    }
    prevLevelRef.current = level;
    return () => {
      if (greenTimerRef.current) clearTimeout(greenTimerRef.current);
    };
  }, [level]);

  // Reset expanded when dismissed
  useEffect(() => {
    if (dismissed) setExpanded(false);
  }, [dismissed]);

  // Don't show anything if green and not flashing, or dismissed
  if (dismissed) return null;
  if (level === 'green' && !greenVisible) return null;

  const levelClass = level === 'red' ? 'health-banner--red'
    : level === 'yellow' ? 'health-banner--yellow'
    : 'health-banner--green';

  const canExpand = level !== 'green' && details.length > 0;

  return (
    <div
      className={`health-banner ${levelClass}`}
      onClick={canExpand ? () => setExpanded(e => !e) : undefined}
      style={canExpand ? { cursor: 'pointer' } : undefined}
    >
      <span className="health-banner-dot" />
      <span className="health-banner-text">
        {message}
        {canExpand && (
          <span className={`health-banner-expand-hint${expanded ? ' health-banner-expand-hint--open' : ''}`}>
            {'\u25BE'}
          </span>
        )}
      </span>
      {level !== 'green' && (
        <button
          className="health-banner-dismiss"
          onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
          type="button"
          aria-label="Dismiss"
        >
          &times;
        </button>
      )}
      {expanded && canExpand && (
        <div className="health-banner-details" onClick={(e) => e.stopPropagation()}>
          {details.map((d) => (
            <div key={d.name} className="health-banner-detail-row">
              <span
                className="health-banner-detail-dot"
                style={{ background: d.status === 'error' ? 'var(--danger, #ef4444)' : 'var(--warning, #eab308)' }}
              />
              <span className="health-banner-detail-name">{d.name}</span>
              <span className="health-banner-detail-code">
                {d.status === 'error' && d.statusCode ? d.statusCode : '\u2014'}
              </span>
              <span className="health-banner-detail-time">{formatDuration(d.duration)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
