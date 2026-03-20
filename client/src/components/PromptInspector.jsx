import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiFetch } from '../api/http.js';
import './PromptInspector.css';

const API_URL = '/api/dev/prompt-inspector';
const VERSIONS_API = '/api/dev/prompt-versions';

function formatChars(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '0';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(Math.round(v));
}

function percent(value, total) {
  if (!total || !value) return 0;
  return Math.round((value / total) * 100);
}

/** Returns 'fresh' | 'aging' | 'stale' based on cache age in seconds */
function freshness(ageSeconds) {
  if (ageSeconds === null || ageSeconds === undefined) return null;
  if (ageSeconds < 120) return 'fresh';
  if (ageSeconds <= 300) return 'aging';
  return 'stale';
}

/** Small colored dot for cache freshness */
function FreshnessDot({ ageSeconds }) {
  const status = freshness(ageSeconds);
  if (!status) return null;
  const colors = { fresh: '#22c55e', aging: '#f59e0b', stale: '#ef4444' };
  const labels = { fresh: 'Fresh (< 2 min)', aging: 'Aging (2-5 min)', stale: 'Stale (> 5 min, refreshes next request)' };
  return (
    <span
      className="pi-freshness-dot"
      style={{ background: colors[status] }}
      title={labels[status]}
    />
  );
}

/** Copy-to-clipboard button */
function CopyBtn({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard not available */ }
  };
  return (
    <button
      className="pi-copy-btn"
      onClick={handleCopy}
      type="button"
      title={label}
    >
      {copied ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

/** Highlight matching text within a string */
function HighlightedText({ text, search }) {
  if (!search || !text) return <>{text}</>;
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let splitRegex, testRegex;
  try {
    splitRegex = new RegExp(`(${escaped})`, 'gi');
    testRegex = new RegExp(`^${escaped}$`, 'i');
  } catch {
    return <>{text}</>;
  }
  const parts = text.split(splitRegex);
  return (
    <>
      {parts.map((part, i) =>
        testRegex.test(part)
          ? <mark key={i} className="pi-search-highlight">{part}</mark>
          : part
      )}
    </>
  );
}

/**
 * Collapsible section with header showing label, chars/cap, freshness, and copy.
 */
function Section({ label, chars, cap, cacheAge, extra, content, search, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const pct = cap ? percent(chars, cap) : 0;
  const overBudget = pct > 90;

  const hasSearchMatch = useMemo(() => {
    if (!search || !content) return false;
    return content.toLowerCase().includes(search.toLowerCase());
  }, [search, content]);

  return (
    <div className={`pi-section${hasSearchMatch ? ' pi-search-match' : ''}`}>
      <button
        className="pi-section-header"
        onClick={() => setOpen(o => !o)}
        type="button"
        aria-expanded={open}
      >
        <span className="pi-section-chevron" data-open={open}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3,2 7,5 3,8" />
          </svg>
        </span>
        <FreshnessDot ageSeconds={cacheAge} />
        <span className="pi-section-label">{label}</span>
        <span className="pi-section-meta">
          <span className={`pi-chars-badge${overBudget ? ' pi-over-budget' : ''}`}>
            {formatChars(chars)} / {formatChars(cap)} ({pct}%)
          </span>
          {extra}
          {content && <CopyBtn text={content} label={`Copy ${label}`} />}
        </span>
      </button>
      {open && <div className="pi-section-body">{children}</div>}
    </div>
  );
}

/**
 * Horizontal stacked bar for budget visualization across all 4 sections.
 */
function BudgetBar({ segments }) {
  const total = segments.reduce((s, seg) => s + (seg.cap || 0), 0) || 1;

  return (
    <div className="pi-budget-bar-container">
      <div className="pi-budget-bar">
        {segments.map((seg) => {
          const widthPercent = ((seg.cap || 0) / total) * 100;
          const fillPercent = seg.cap ? Math.min(100, ((seg.chars || 0) / seg.cap) * 100) : 0;
          return (
            <div
              key={seg.label}
              className="pi-budget-segment"
              style={{ width: `${widthPercent}%` }}
              title={`${seg.label}: ${formatChars(seg.chars)} / ${formatChars(seg.cap)} chars (${Math.round(fillPercent)}%)`}
            >
              <div
                className="pi-budget-fill"
                style={{
                  width: `${fillPercent}%`,
                  background: seg.color,
                  opacity: fillPercent > 90 ? 1 : 0.75,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="pi-budget-legend">
        {segments.map((seg) => (
          <span key={seg.label} className="pi-legend-item">
            <span className="pi-legend-dot" style={{ background: seg.color }} />
            <span>{seg.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Relative time formatting (e.g., "2 min ago", "1h ago", "yesterday") */
function relativeTime(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));

  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

/**
 * Simple LCS-based line diff. Returns array of { type: 'unchanged'|'added'|'removed', text }.
 */
function computeLineDiff(oldText, newText) {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  // For very large prompts, limit diff computation to avoid browser freeze
  if (m * n > 2_000_000) {
    return [
      ...oldLines.map(text => ({ type: 'removed', text })),
      ...newLines.map(text => ({ type: 'added', text })),
    ];
  }

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: 'unchanged', text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'added', text: newLines[j - 1] });
      j--;
    } else {
      result.push({ type: 'removed', text: oldLines[i - 1] });
      i--;
    }
  }
  return result.reverse();
}

/**
 * VersionsTab -- Shows prompt version history with expand/diff capability.
 */
function VersionsTab({ currentPrompt }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedVersion, setExpandedVersion] = useState(null);
  const [expandLoading, setExpandLoading] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  const fetchVersions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(VERSIONS_API);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Failed to fetch versions');
      setVersions(json.versions || []);
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  const handleExpand = useCallback(async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedVersion(null);
      setShowDiff(false);
      return;
    }
    setExpandedId(id);
    setExpandedVersion(null);
    setShowDiff(false);
    setExpandLoading(true);
    try {
      const res = await apiFetch(`${VERSIONS_API}/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Failed to fetch version');
      setExpandedVersion(json.version);
    } catch {
      setExpandedVersion(null);
    } finally {
      setExpandLoading(false);
    }
  }, [expandedId]);

  const diffLines = useMemo(() => {
    if (!showDiff || !expandedVersion?.assembledPrompt || !currentPrompt) return [];
    return computeLineDiff(expandedVersion.assembledPrompt, currentPrompt);
  }, [showDiff, expandedVersion, currentPrompt]);

  const diffStats = useMemo(() => {
    if (!diffLines.length) return null;
    const added = diffLines.filter(l => l.type === 'added').length;
    const removed = diffLines.filter(l => l.type === 'removed').length;
    return { added, removed };
  }, [diffLines]);

  if (loading && versions.length === 0) {
    return (
      <div className="pi-loading">
        <span className="spinner spinner-sm" />
        <span>Loading version history...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pi-error">
        <span>Error: {error}</span>
        <button className="btn btn-sm btn-ghost" onClick={fetchVersions} type="button">Retry</button>
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="pi-empty-hint">
        No prompt versions recorded yet. Versions are saved automatically when the assembled prompt changes.
      </div>
    );
  }

  return (
    <div className="pi-versions-list">
      {versions.map((v, idx) => {
        const isExpanded = expandedId === v._id;
        const prev = versions[idx + 1]; // next older version
        const charDelta = prev ? v.totalChars - prev.totalChars : 0;

        return (
          <div
            key={v._id}
            className={`pi-versions-item${isExpanded ? ' pi-versions-item-expanded' : ''}`}
          >
            <button
              className="pi-versions-item-header"
              onClick={() => handleExpand(v._id)}
              type="button"
              aria-expanded={isExpanded}
            >
              <div className="pi-versions-item-left">
                <span className="pi-versions-hash" title={v.contextHash}>
                  {v.contextHash?.slice(0, 8)}
                </span>
                <span className="pi-versions-time" title={new Date(v.createdAt).toLocaleString()}>
                  {relativeTime(v.createdAt)}
                </span>
              </div>
              <div className="pi-versions-item-right">
                <span className="pi-versions-stats">
                  {formatChars(v.totalChars)} chars / ~{formatChars(v.estimatedTokens)} tok
                </span>
                {charDelta !== 0 && (
                  <span className={`pi-versions-delta ${charDelta > 0 ? 'pi-versions-delta-up' : 'pi-versions-delta-down'}`}>
                    {charDelta > 0 ? '+' : ''}{formatChars(Math.abs(charDelta))}
                  </span>
                )}
                {v.provider?.primary && (
                  <span className="pi-versions-provider">
                    {v.provider.primary}
                    {v.provider.model ? ` / ${v.provider.model}` : ''}
                  </span>
                )}
                <span className="pi-section-chevron" data-open={isExpanded}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3,2 7,5 3,8" />
                  </svg>
                </span>
              </div>
            </button>

            {isExpanded && (
              <div className="pi-versions-item-body">
                {expandLoading ? (
                  <div className="pi-loading">
                    <span className="spinner spinner-sm" />
                    <span>Loading version...</span>
                  </div>
                ) : expandedVersion ? (
                  <>
                    {/* Section breakdown */}
                    <div className="pi-versions-sections">
                      {expandedVersion.sections && Object.entries(expandedVersion.sections).map(([key, sec]) => (
                        <div key={key} className="pi-versions-section-row">
                          <span className="pi-versions-section-name">{key}</span>
                          <span className="pi-versions-section-stats">
                            {formatChars(sec.chars)} / {formatChars(sec.cap)}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Action buttons */}
                    <div className="pi-versions-actions">
                      <CopyBtn text={expandedVersion.assembledPrompt} label="Copy version prompt" />
                      {currentPrompt && (
                        <button
                          className={`btn btn-sm ${showDiff ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => setShowDiff(d => !d)}
                          type="button"
                        >
                          {showDiff ? 'Hide Diff' : 'Compare with Current'}
                        </button>
                      )}
                    </div>

                    {/* Diff view */}
                    {showDiff && diffLines.length > 0 && (
                      <div className="pi-versions-diff">
                        {diffStats && (
                          <div className="pi-versions-diff-stats">
                            <span className="pi-versions-diff-added">+{diffStats.added} added</span>
                            <span className="pi-versions-diff-removed">-{diffStats.removed} removed</span>
                          </div>
                        )}
                        <pre className="pi-versions-diff-content">
                          {diffLines.map((line, i) => (
                            <div
                              key={i}
                              className={`pi-versions-diff-line pi-versions-diff-${line.type}`}
                            >
                              <span className="pi-versions-diff-marker">
                                {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                              </span>
                              <span>{line.text}</span>
                            </div>
                          ))}
                        </pre>
                      </div>
                    )}

                    {/* Full prompt */}
                    {!showDiff && (
                      <pre className="pi-content-block pi-assembled-content">
                        {expandedVersion.assembledPrompt}
                      </pre>
                    )}
                  </>
                ) : (
                  <div className="pi-empty-hint">Failed to load version details.</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Tab switcher for main views */
function TabBar({ tabs, active, onChange }) {
  return (
    <div className="pi-tab-bar">
      {tabs.map(t => (
        <button
          key={t.id}
          className={`pi-tab${active === t.id ? ' pi-tab-active' : ''}`}
          onClick={() => onChange(t.id)}
          type="button"
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * PromptInspector -- Full transparency panel showing exactly what the dev agent sees.
 * Fetches from GET /api/dev/prompt-inspector?conversationId=xxx
 */
export default function PromptInspector({ isOpen, onClose, conversationId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('assembled');
  const searchRef = useRef(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (conversationId) params.set('conversationId', conversationId);
      const url = params.toString() ? `${API_URL}?${params}` : API_URL;
      const res = await apiFetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Failed to fetch prompt data');
      setData(json);
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  // Auto-fetch when panel opens or conversationId changes
  useEffect(() => {
    if (isOpen) fetchData();
  }, [isOpen, fetchData]);

  // Keyboard shortcut: Ctrl+F focuses search when panel is open
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && searchRef.current) {
        // Only capture if the inspector panel is focused or no other input is focused
        const active = document.activeElement;
        const isInPanel = searchRef.current.closest('.pi-panel')?.contains(active);
        if (isInPanel || active === document.body) {
          e.preventDefault();
          searchRef.current.focus();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen]);

  if (!isOpen) return null;

  const sections = data?.sections;
  const hasSections = !!(sections?.role && sections?.claudeMd && sections?.fileTree && sections?.memory);
  const budgetSegments = useMemo(() => {
    if (!hasSections) return [];
    return [
      { label: 'Role', chars: sections.role.chars, cap: sections.role.cap, color: 'var(--accent)' },
      { label: 'CLAUDE.md', chars: sections.claudeMd.chars, cap: sections.claudeMd.cap, color: 'var(--provider-b, #8b5cf6)' },
      { label: 'File Tree', chars: sections.fileTree.chars, cap: sections.fileTree.cap, color: 'var(--provider-c, #06b6d4)' },
      { label: 'Memory', chars: sections.memory.chars, cap: sections.memory.cap, color: 'var(--green, #22c55e)' },
    ];
  }, [hasSections, sections]);

  const tabs = [
    { id: 'assembled', label: 'Assembled Prompt' },
    { id: 'sections', label: 'Sections' },
    { id: 'history', label: 'Conversation' },
    { id: 'versions', label: 'Versions' },
  ];

  // Count search matches across all content
  const searchMatchCount = useMemo(() => {
    if (!search || !data) return 0;
    const needle = search.toLowerCase();
    let count = 0;
    const haystack = [
      data.assembledPrompt,
      sections?.role?.content,
      sections?.claudeMd?.content,
      sections?.fileTree?.content,
      sections?.memory?.content,
    ].filter(Boolean).join('\n');
    let idx = haystack.toLowerCase().indexOf(needle);
    while (idx !== -1) {
      count++;
      idx = haystack.toLowerCase().indexOf(needle, idx + 1);
    }
    return count;
  }, [search, data, sections]);

  return (
    <div className="pi-panel">
      <div className="pi-header">
        <div className="pi-header-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span>Prompt Inspector</span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
          <button
            className="btn btn-sm btn-ghost"
            onClick={fetchData}
            type="button"
            title="Refresh prompt data"
            disabled={loading}
          >
            {loading ? (
              <span className="spinner spinner-sm" />
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            )}
          </button>
          <button
            className="btn btn-sm btn-ghost pi-close-btn"
            onClick={onClose}
            type="button"
            title="Close inspector"
            aria-label="Close prompt inspector"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="pi-search-bar">
        <svg className="pi-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={searchRef}
          className="pi-search-input"
          type="text"
          placeholder="Search prompt content... (Ctrl+F)"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <span className="pi-search-count">
            {searchMatchCount} match{searchMatchCount !== 1 ? 'es' : ''}
          </span>
        )}
        {search && (
          <button
            className="pi-search-clear"
            onClick={() => setSearch('')}
            type="button"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      <div className="pi-body">
        {error && (
          <div className="pi-error">
            <span>Error: {error}</span>
            <button className="btn btn-sm btn-ghost" onClick={fetchData} type="button">Retry</button>
          </div>
        )}

        {!data && !error && loading && (
          <div className="pi-loading">
            <span className="spinner spinner-sm" />
            <span>Loading prompt data...</span>
          </div>
        )}

        {data && !hasSections && !error && (
          <div className="pi-error">
            <span>Prompt data loaded but sections are missing or malformed.</span>
            <button className="btn btn-sm btn-ghost" onClick={fetchData} type="button">Retry</button>
          </div>
        )}

        {data && hasSections && (
          <>
            {/* Provider + overview stats */}
            <div className="pi-overview">
              <div className="pi-stat">
                <span className="pi-stat-label">Total Chars</span>
                <span className="pi-stat-value">{formatChars(data.totalChars)}</span>
              </div>
              <div className="pi-stat">
                <span className="pi-stat-label">Est. Tokens</span>
                <span className="pi-stat-value pi-stat-highlight">{formatChars(data.estimatedTokens)}</span>
              </div>
              {data.provider && (
                <div className="pi-stat">
                  <span className="pi-stat-label">Provider</span>
                  <span className="pi-stat-value">{data.provider.primary}</span>
                </div>
              )}
              {data.provider?.model && (
                <div className="pi-stat">
                  <span className="pi-stat-label">Model</span>
                  <span className="pi-stat-value pi-model-value">{data.provider.model}</span>
                </div>
              )}
            </div>

            {/* Budget allocation bar */}
            {budgetSegments.length > 0 && <BudgetBar segments={budgetSegments} />}

            {/* Tab navigation */}
            <TabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />

            {/* ---- Assembled Prompt tab ---- */}
            {activeTab === 'assembled' && (
              <div className="pi-assembled-section">
                <div className="pi-assembled-header">
                  <span className="pi-assembled-meta">
                    {formatChars(data.assembledPromptChars)} chars / ~{formatChars(data.assembledPromptEstTokens)} tokens
                  </span>
                  <CopyBtn text={data.assembledPrompt} label="Copy Full Prompt" />
                </div>
                <pre className="pi-content-block pi-assembled-content">
                  <HighlightedText text={data.assembledPrompt} search={search} />
                </pre>
              </div>
            )}

            {/* ---- Sections tab ---- */}
            {activeTab === 'sections' && (
              <>
                {/* Role Identity */}
                <Section
                  label="Role Identity"
                  chars={sections.role.chars}
                  cap={sections.role.cap}
                  content={sections.role.content}
                  search={search}
                  defaultOpen={false}
                >
                  <pre className="pi-content-block">
                    <HighlightedText text={sections.role.content} search={search} />
                  </pre>
                </Section>

                {/* CLAUDE.md */}
                <Section
                  label="CLAUDE.md"
                  chars={sections.claudeMd.chars}
                  cap={sections.claudeMd.cap}
                  cacheAge={sections.claudeMd.cacheAge}
                  content={sections.claudeMd.content}
                  search={search}
                  defaultOpen={false}
                  extra={
                    sections.claudeMd.hash && (
                      <span className="pi-hash-badge" title={`Hash: ${sections.claudeMd.hash}`}>
                        #{sections.claudeMd.hash}
                      </span>
                    )
                  }
                >
                  {sections.claudeMd.loadedAt && (
                    <div className="pi-kv-row">
                      <span className="pi-kv-label">Loaded</span>
                      <span className="pi-kv-value">
                        {new Date(sections.claudeMd.loadedAt).toLocaleTimeString()}
                        {sections.claudeMd.cacheAge !== null && (
                          <span className="pi-age-badge"> ({sections.claudeMd.cacheAge}s ago)</span>
                        )}
                      </span>
                    </div>
                  )}
                  <pre className="pi-content-block">
                    <HighlightedText text={sections.claudeMd.content} search={search} />
                  </pre>
                </Section>

                {/* File Tree */}
                <Section
                  label="File Tree"
                  chars={sections.fileTree.chars}
                  cap={sections.fileTree.cap}
                  cacheAge={sections.fileTree.cacheAge}
                  content={sections.fileTree.content}
                  search={search}
                  defaultOpen={false}
                  extra={
                    <span className="pi-count-badge">{sections.fileTree.fileCount} files</span>
                  }
                >
                  {sections.fileTree.generatedAt && (
                    <div className="pi-kv-row">
                      <span className="pi-kv-label">Generated</span>
                      <span className="pi-kv-value">
                        {new Date(sections.fileTree.generatedAt).toLocaleTimeString()}
                        {sections.fileTree.cacheAge !== null && (
                          <span className="pi-age-badge"> ({sections.fileTree.cacheAge}s ago)</span>
                        )}
                      </span>
                    </div>
                  )}
                  <pre className="pi-content-block">
                    <HighlightedText text={sections.fileTree.content} search={search} />
                  </pre>
                </Section>

                {/* Agent Memory */}
                <Section
                  label="Agent Memory"
                  chars={sections.memory.chars}
                  cap={sections.memory.cap}
                  content={sections.memory.content}
                  search={search}
                  defaultOpen={false}
                  extra={
                    <span className="pi-count-badge">{sections.memory.entryCount} entries</span>
                  }
                >
                  {sections.memory.content ? (
                    <pre className="pi-content-block">
                      <HighlightedText text={sections.memory.content} search={search} />
                    </pre>
                  ) : (
                    <div className="pi-empty-hint">No memory entries retrieved.</div>
                  )}
                </Section>
              </>
            )}

            {/* ---- Conversation History tab ---- */}
            {activeTab === 'history' && (
              <div className="pi-history-section">
                {data.conversationHistory ? (
                  <>
                    <div className="pi-history-meta">
                      <span>{data.conversationHistory.messageCount} messages</span>
                      <span className="pi-history-sep">|</span>
                      <span>{formatChars(data.conversationHistory.totalChars)} chars</span>
                      <span className="pi-history-sep">|</span>
                      <span>~{formatChars(data.conversationHistory.estimatedTokens)} tokens</span>
                    </div>
                    <div className="pi-history-list">
                      {data.conversationHistory.messages.map((msg, i) => (
                        <div key={i} className={`pi-history-msg pi-role-${msg.role}`}>
                          <div className="pi-history-msg-header">
                            <span className={`pi-role-badge pi-role-badge-${msg.role}`}>
                              {msg.role}
                            </span>
                            <span className="pi-history-msg-meta">
                              {formatChars(msg.chars)} chars
                              {msg.provider && <span className="pi-history-provider">{msg.provider}</span>}
                            </span>
                          </div>
                          <div className="pi-history-msg-preview">
                            <HighlightedText text={msg.contentPreview} search={search} />
                            {msg.chars > 200 && <span className="pi-truncated">...</span>}
                          </div>
                          {msg.timestamp && (
                            <div className="pi-history-msg-time">
                              {new Date(msg.timestamp).toLocaleTimeString()}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="pi-empty-hint">
                    {conversationId
                      ? 'No conversation data loaded.'
                      : 'No active conversation. Start a chat to see history here.'}
                  </div>
                )}
              </div>
            )}

            {/* ---- Versions tab ---- */}
            {activeTab === 'versions' && (
              <VersionsTab currentPrompt={data.assembledPrompt} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
