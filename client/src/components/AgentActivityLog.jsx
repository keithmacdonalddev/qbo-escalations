import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useDevAgent } from '../context/DevAgentContext.jsx';
import { SEVERITY, SEVERITY_LABELS } from '../lib/severityClassifier.js';
import ThreadViewer from './ThreadViewer.jsx';
import './AgentActivityLog.css';

/** Severity badge CSS class map */
const SEVERITY_BADGE_CLASS = {
  [SEVERITY.CRITICAL]: 'aal-sev aal-sev--critical',
  [SEVERITY.URGENT]: 'aal-sev aal-sev--urgent',
  [SEVERITY.ELEVATED]: 'aal-sev aal-sev--elevated',
  [SEVERITY.MONITORING]: 'aal-sev aal-sev--monitoring',
  [SEVERITY.INFO]: 'aal-sev aal-sev--info',
};

/** Map event types to color classes */
const TYPE_COLORS = {
  'error-captured': 'aal-red',
  'api-error': 'aal-red',
  'react-crash': 'aal-red',
  'stream-error': 'aal-red',
  'server-error': 'aal-red',
  'error-reported': 'aal-amber',
  'bg-send': 'aal-amber',
  'error-circuit': 'aal-amber',
  'bg-tools': 'aal-blue',
  'bg-files-changed': 'aal-green',
  'bg-response': 'aal-green',
  'bg-rate-limit': 'aal-amber',
  'bg-suppressed': 'aal-gray',
  'bg-collapsed': 'aal-gray',
  'fg-response': 'aal-green',
  'task-completed': 'aal-green',
  'fg-send': 'aal-blue',
  'task-queued': 'aal-blue',
  'review-queued': 'aal-blue',
  'change-detected': 'aal-blue',
  'task-started': 'aal-blue',
  'idle-scan': 'aal-gray',
  'leader-change': 'aal-gray',
  'context-refresh': 'aal-gray',
  'bg-rotate': 'aal-gray',
  'circuit-breaker': 'aal-amber',
  'telemetry': 'aal-gray',
  'health-warning': 'aal-amber',
  'perf-insight': 'aal-amber',
  'emergency': 'aal-red',
  'console-error': 'aal-red',
  'console-warn': 'aal-gray',
  'error-resolved': 'aal-green',
  'error-retry': 'aal-amber',
  'error-escalated': 'aal-red',
  'fix-applied': 'aal-green',
  'hmr-update': 'aal-blue',
  'hmr-reload': 'aal-amber',
  'hmr-error': 'aal-red',
  'monitor-lifecycle': 'aal-gray',
  'agent-health': 'aal-amber',
};

/** Map event types to filter categories */
const TYPE_CATEGORIES = {
  'error-captured': 'errors',
  'error-reported': 'errors',
  'error-circuit': 'errors',
  'api-error': 'errors',
  'stream-error': 'errors',
  'react-crash': 'errors',
  'server-error': 'errors',
  'circuit-breaker': 'errors',
  'task-queued': 'tasks',
  'task-started': 'tasks',
  'task-completed': 'tasks',
  'idle-scan': 'tasks',
  'bg-send': 'background',
  'bg-tools': 'background',
  'bg-files-changed': 'background',
  'bg-response': 'background',
  'bg-rate-limit': 'background',
  'bg-suppressed': 'background',
  'bg-collapsed': 'background',
  'bg-rotate': 'background',
  'fg-send': 'foreground',
  'fg-response': 'foreground',
  'change-detected': 'system',
  'review-queued': 'system',
  'leader-change': 'system',
  'context-refresh': 'system',
  'telemetry': 'telemetry',
  'health-warning': 'system',
  'perf-insight': 'performance',
  'emergency': 'errors',
  'console-error': 'errors',
  'console-warn': 'system',
  'error-resolved': 'resolution',
  'error-retry': 'resolution',
  'error-escalated': 'resolution',
  'fix-applied': 'resolution',
  'hmr-update': 'system',
  'hmr-reload': 'system',
  'hmr-error': 'errors',
  'monitor-lifecycle': 'system',
  'agent-health': 'system',
};

const FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'errors', label: 'Errors' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'background', label: 'Background' },
  { key: 'foreground', label: 'Foreground' },
  { key: 'system', label: 'System' },
  { key: 'telemetry', label: 'Telemetry' },
  { key: 'performance', label: 'Perf' },
  { key: 'resolution', label: 'Resolution' },
];

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatTypeLabel(type) {
  return (type || 'unknown').toUpperCase().replace(/-/g, ' ');
}

/**
 * Persistent, always-streaming terminal-style activity log.
 * Renders inside DevMode as a bottom panel showing every agent event in real-time.
 *
 * Features:
 * - Auto-scrolls to bottom (with user-scroll-lock detection)
 * - Color-coded by event type (red/amber/green/blue/gray)
 * - Click to expand detail
 * - Filter chips (All / Errors / Tasks / Background / Foreground / System)
 * - Pause auto-scroll and clear controls
 * - Entry count in header
 *
 * @param {{ compact?: boolean }} props
 */
export default function AgentActivityLog({ compact = false }) {
  const { activityLog, emergencyActive, resetEmergency } = useDevAgent();
  const entries = activityLog?.entries || [];
  const clear = activityLog?.clear;

  const [filter, setFilter] = useState('all');
  const [paused, setPaused] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [collapsed, setCollapsed] = useState(true);
  const [threadChannel, setThreadChannel] = useState(null);
  const scrollRef = useRef(null);
  const isUserScrolledRef = useRef(false);
  const prevLengthRef = useRef(0);

  // Filter entries
  const filtered = useMemo(() => {
    if (filter === 'all') return entries;
    return entries.filter(e => TYPE_CATEGORIES[e.type] === filter);
  }, [entries, filter]);

  // Auto-scroll: track whether user has scrolled up
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    isUserScrolledRef.current = !atBottom;
  }, []);

  // Auto-scroll to bottom on new entries (unless user scrolled up or paused)
  useEffect(() => {
    if (paused || isUserScrolledRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    if (filtered.length > prevLengthRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevLengthRef.current = filtered.length;
  }, [filtered, paused]);

  const toggleExpand = useCallback((id) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  // Compact mode: show last 5 entries, no filters
  if (compact) {
    const recent = entries.slice(-5);
    return (
      <div className="aal-compact">
        <div className="aal-compact-header">
          <span className="aal-compact-title">Activity</span>
          <span className="aal-compact-count">{entries.length}</span>
        </div>
        <div className="aal-compact-list">
          {recent.length === 0 && (
            <div className="aal-empty">No activity yet</div>
          )}
          {recent.map(entry => (
            <div key={entry.id} className={`aal-compact-line ${TYPE_COLORS[entry.type] || 'aal-gray'}`}>
              <span className="aal-time">{formatTime(entry.timestamp)}</span>
              <span className="aal-type-tag">{formatTypeLabel(entry.type)}</span>
              {entry._severity != null && (
                <span className={SEVERITY_BADGE_CLASS[entry._severity] || 'aal-sev aal-sev--info'}>
                  {SEVERITY_LABELS[entry._severity] || 'INFO'}
                </span>
              )}
              <span className="aal-msg">{entry.message}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Count entries by category for badge numbers
  const categoryCounts = useMemo(() => {
    const counts = {};
    for (const e of entries) {
      const cat = TYPE_CATEGORIES[e.type] || 'system';
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [entries]);

  return (
    <div className={`aal-panel${collapsed ? ' aal-panel--collapsed' : ''}`}>
      {/* Header */}
      <div className="aal-header">
        <div className="aal-header-left">
          <button
            className="aal-collapse-btn"
            onClick={() => setCollapsed(c => !c)}
            type="button"
            title={collapsed ? 'Expand activity log' : 'Collapse activity log'}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              {collapsed
                ? <polyline points="6 9 12 15 18 9" />
                : <polyline points="6 15 12 9 18 15" />
              }
            </svg>
          </button>
          <span className="aal-title">Activity Log</span>
          <span className="aal-count">{entries.length}</span>
          {entries.length > 0 && filtered.length !== entries.length && (
            <span className="aal-filtered-count">({filtered.length} shown)</span>
          )}
        </div>
        <div className="aal-header-right">
          {/* Filter chips */}
          {!collapsed && (
            <div className="aal-filters">
              {FILTER_OPTIONS.map(f => (
                <button
                  key={f.key}
                  className={`aal-filter-chip${filter === f.key ? ' is-active' : ''}`}
                  onClick={() => setFilter(f.key)}
                  type="button"
                >
                  {f.label}
                  {f.key !== 'all' && categoryCounts[f.key] ? (
                    <span className="aal-filter-badge">{categoryCounts[f.key]}</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
          {!collapsed && (
            <>
              <button
                className={`aal-ctrl-btn${paused ? ' is-active' : ''}`}
                onClick={() => {
                  setPaused(p => !p);
                  if (paused) {
                    isUserScrolledRef.current = false;
                    const el = scrollRef.current;
                    if (el) el.scrollTop = el.scrollHeight;
                  }
                }}
                type="button"
                title={paused ? 'Resume auto-scroll' : 'Pause auto-scroll'}
              >
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button
                className="aal-ctrl-btn"
                onClick={clear}
                type="button"
                title="Clear log"
              >
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {/* Emergency mode banner */}
      {emergencyActive && !collapsed && (
        <div className="aal-emergency-banner">
          <span className="aal-emergency-icon">!</span>
          <span className="aal-emergency-text">
            EMERGENCY MODE — Non-critical monitoring paused, errors batched
          </span>
          <button
            className="aal-emergency-reset"
            onClick={resetEmergency}
            type="button"
          >
            Reset
          </button>
        </div>
      )}

      {/* Log body */}
      {!collapsed && (
        <div className="aal-body" ref={scrollRef} onScroll={handleScroll} style={{ position: 'relative' }}>
          {filtered.length === 0 && (
            <div className="aal-empty">
              {entries.length === 0
                ? 'Waiting for agent activity...'
                : 'No entries match the current filter.'}
            </div>
          )}
          {filtered.map(entry => {
            const isExpanded = expandedId === entry.id;
            const colorClass = TYPE_COLORS[entry.type] || 'aal-gray';
            return (
              <div
                key={entry.id}
                className={`aal-entry ${colorClass}${isExpanded ? ' is-expanded' : ''}`}
                onClick={() => toggleExpand(entry.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') toggleExpand(entry.id); }}
              >
                <span className="aal-time">{formatTime(entry.timestamp)}</span>
                <span className={`aal-type-tag ${colorClass}`}>{formatTypeLabel(entry.type)}</span>
                {entry._severity != null && (
                  <span className={SEVERITY_BADGE_CLASS[entry._severity] || 'aal-sev aal-sev--info'}>
                    {SEVERITY_LABELS[entry._severity] || 'INFO'}
                  </span>
                )}
                <span className="aal-msg">{entry.message}</span>
                {entry.type === 'error-escalated' && (
                  <span className="aal-badge aal-badge--unresolved">UNRESOLVED</span>
                )}
                {entry.type === 'error-resolved' && (
                  <span className="aal-badge aal-badge--resolved">RESOLVED</span>
                )}
                {entry.channel && <span className="aal-channel">{entry.channel}</span>}
                {entry.detail && <span className="aal-expand-hint">{isExpanded ? '-' : '+'}</span>}
                {isExpanded && entry.detail && (
                  <pre className="aal-detail">{entry.detail}</pre>
                )}
                {isExpanded && entry.channel && (entry.type === 'bg-response' || entry.type === 'bg-send') && (
                  <button
                    className="aal-thread-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setThreadChannel(entry.channel);
                    }}
                    type="button"
                  >
                    View Thread &rarr;
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Thread viewer slide-over */}
      {threadChannel && (
        <ThreadViewer
          channel={threadChannel}
          onClose={() => setThreadChannel(null)}
        />
      )}
    </div>
  );
}
