import { useState, useEffect, useRef, useMemo } from 'react';
import './HealthBanner.css';

/**
 * HealthBanner — slim status strip at the very top of the app.
 *
 * Reads the same request data from useRequestWaterfall and shows:
 *   Green:  "All systems working" (auto-hides after 3s)
 *   Yellow: "Chat is responding slowly" etc.
 *   Red:    "Recent Chat request failed" etc.
 *
 * Click the pill to expand a per-feature detail panel.
 */

const ENDPOINT_NAMES = {
  'agent-identities/provider-strategy/health/logs': 'Provider health logs',
  'agent-identities/provider-strategy/health': 'Provider health check',
  'agent-identities/runtime-defaults': 'Agent runtime defaults',
  'agent-identities/lifecycle': 'Agent lifecycle',
  'agent-identities/health': 'Agent health',
  'agent-identities': 'Agent profiles',
  'chat/send': 'Chat',
  'chat/parse-escalation': 'Triage Preview',
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
  'image-parser': 'Image Parser',
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

function requestSortTime(request, now) {
  return request.endTime || request.headersTime || request.startTime || now;
}

function isFailedRequest(request) {
  return request.state === 'error' || (request.status && request.status >= 500);
}

function hasRequestOutcome(request) {
  return request.state === 'complete' || request.state === 'error' || request.state === 'aborted';
}

function requestDuration(request, now) {
  return (request.endTime || now) - request.startTime;
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

    // Show the latest request state per feature. A failed request followed by
    // a successful retry should not keep claiming that feature is down.
    const latestByName = new Map();
    for (const request of recent) {
      if (!hasRequestOutcome(request)) continue;
      const name = featureName(request.url);
      const sortTime = requestSortTime(request, now);
      const existing = latestByName.get(name);
      if (!existing || sortTime >= existing.sortTime) {
        latestByName.set(name, { name, request, sortTime });
      }
    }

    const latestRows = [...latestByName.values()];
    // Failures: status >= 500 or state === 'error' on the latest feature request
    const failed = latestRows.filter(({ request }) => isFailedRequest(request));
    // Slow: completed latest requests exceeding threshold, excluding failures
    const slow = latestRows.filter(({ request }) => {
      if (isFailedRequest(request)) return false;
      if (request.state !== 'complete') return false;
      const dur = requestDuration(request, now);
      return slowThreshold > 0 && dur > slowThreshold;
    });

    // Build details array — one entry per request that's bad
    const rawDetails = [];
    for (const { name, request } of failed) {
      const dur = requestDuration(request, now);
      rawDetails.push({
        name,
        duration: dur,
        status: 'error',
        statusCode: request.status || null,
      });
    }
    for (const { name, request } of slow) {
      const dur = requestDuration(request, now);
      rawDetails.push({
        name,
        duration: dur,
        status: 'slow',
        statusCode: request.status || null,
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

    const failedFeatures = failed.map(({ name }) => name);
    if (failedFeatures.length > 0) {
      const msg = failedFeatures.length === 1
        ? `Recent ${failedFeatures[0]} request failed`
        : `Recent failed requests: ${failedFeatures.slice(0, 3).join(', ')}${failedFeatures.length > 3 ? ` +${failedFeatures.length - 3} more` : ''}`;
      return { level: 'red', message: msg, details: dedupedDetails };
    }

    const slowFeatures = slow.map(({ name }) => name);
    if (slowFeatures.length > 0) {
      const msg = slowFeatures.length === 1
        ? `Recent ${slowFeatures[0]} request was slow`
        : `Recent slow requests: ${slowFeatures.slice(0, 3).join(', ')}${slowFeatures.length > 3 ? ` +${slowFeatures.length - 3} more` : ''}`;
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
      role="status"
      aria-live="polite"
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
