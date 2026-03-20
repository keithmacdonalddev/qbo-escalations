import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ConfirmModal from './ConfirmModal.jsx';
import { DuplicateInvBanner, SimilarInvBanner } from './InvMatchBanner.jsx';
import './InvestigationsView.css';
import { formatDateShort as formatDate } from '../utils/dateFormatting.js';

const CATEGORIES = [
  'payroll', 'bank-feeds', 'reconciliation', 'permissions',
  'billing', 'tax', 'invoicing', 'reporting', 'inventory',
  'payments', 'integrations', 'general', 'technical', 'unknown',
];

const STATUSES = ['new', 'in-progress', 'closed'];

const SORT_OPTIONS = [
  { value: '-reportedDate', label: 'Newest' },
  { value: '-affectedCount', label: 'Most Matched' },
  { value: '-lastMatchedAt', label: 'Recently Matched' },
];

// --- API helpers ---

async function fetchInvestigations(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/investigations?${qs}`);
  return res.json();
}

async function fetchStats() {
  const res = await fetch('/api/investigations/stats');
  return res.json();
}

async function updateInvestigation(id, fields) {
  const res = await fetch(`/api/investigations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return res.json();
}

async function deleteInvestigation(id) {
  const res = await fetch(`/api/investigations/${id}`, { method: 'DELETE' });
  return res.json();
}

async function bulkImportInvestigations(investigations) {
  const res = await fetch('/api/investigations/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ investigations }),
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// INV text parser — extracts INV entries from free text (pasted from Slack)
// Handles formats like:
//   INV-147914 - No option to select a bank account...
//   INV-147914 | 2026-03-10 | Agent Name (Team) | Subject
// ---------------------------------------------------------------------------
function parseInvText(text) {
  if (!text || !text.trim()) return [];

  const lines = text.split('\n').filter(l => l.trim());
  const results = [];
  const seen = new Set();

  for (const line of lines) {
    // Match INV-XXXXXX anywhere in the line
    const invMatch = line.match(/\b(INV[-\s]?\d{4,})\b/i);
    if (!invMatch) continue;

    const invNumber = invMatch[1].replace(/\s+/g, '-').toUpperCase();
    if (seen.has(invNumber)) continue;
    seen.add(invNumber);

    // Try to extract the rest as subject — everything after the INV number and separator
    const afterInv = line.slice(line.indexOf(invMatch[0]) + invMatch[0].length).trim();
    let subject = '';
    let agentName = '';
    let team = '';
    let reportedDate = null;

    // Pipe-delimited format: INV-123456 | date | agent (team) | subject
    if (afterInv.includes('|')) {
      const parts = afterInv.split('|').map(p => p.trim());
      // Try to find a date-like part
      for (let i = 0; i < parts.length; i++) {
        if (/\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(parts[i]) || /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(parts[i])) {
          reportedDate = parts[i];
          parts.splice(i, 1);
          break;
        }
      }
      // Try to find agent/team part (contains parentheses)
      for (let i = 0; i < parts.length; i++) {
        const teamMatch = parts[i].match(/^(.+?)\s*\(([^)]+)\)\s*$/);
        if (teamMatch) {
          agentName = teamMatch[1].trim();
          team = teamMatch[2].trim();
          parts.splice(i, 1);
          break;
        }
      }
      // Remaining parts are subject
      subject = parts.filter(Boolean).join(' — ');
    } else {
      // Dash-delimited: INV-123456 - subject
      subject = afterInv.replace(/^[-–—:\s]+/, '').trim();
    }

    if (!subject) subject = '(no subject parsed)';

    results.push({
      invNumber,
      subject,
      agentName,
      team,
      reportedDate,
      source: 'manual',
    });
  }

  return results;
}

// --- Utility ---

function categoryLabel(cat) {
  if (!cat) return 'Unknown';
  return cat.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const STATUS_LABELS = { 'new': 'New', 'in-progress': 'In Progress', 'closed': 'Closed' };
function statusLabel(s) { return STATUS_LABELS[s] || s; }

// --- Component ---

export default function InvestigationsView() {
  // Data
  const [investigations, setInvestigations] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('-reportedDate');

  // UI state
  const [expandedId, setExpandedId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  // Import panel state
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importParsed, setImportParsed] = useState(null); // parsed preview
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState(null); // { imported, updated, duplicates, similarMatches, errors }

  const searchTimerRef = useRef(null);
  const debouncedSearchRef = useRef('');
  const copyTimerRef = useRef(null);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(searchTimerRef.current);
  }, [search]);

  // Fetch stats
  const loadStats = useCallback(async () => {
    try {
      const data = await fetchStats();
      if (data.ok) setStats(data.stats);
    } catch (err) { console.warn('[investigations] stats fetch failed:', err); }
  }, []);

  // Fetch list
  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params = { sort, limit: 200 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (category) params.category = category;
      if (status) params.status = status;
      const data = await fetchInvestigations(params);
      if (data.ok) {
        setInvestigations(data.investigations);
        setTotal(data.total);
      }
    } catch (err) { console.warn('[investigations] list fetch failed:', err); }
    setLoading(false);
  }, [debouncedSearch, category, status, sort]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadList(); }, [loadList]);

  // Cleanup timers
  useEffect(() => () => {
    clearTimeout(searchTimerRef.current);
    clearTimeout(copyTimerRef.current);
  }, []);

  // Handlers
  const handleCopyInv = useCallback((e, invNumber) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(invNumber).then(() => {
      setCopiedId(invNumber);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedId(null), 1500);
    });
  }, []);

  const handleToggleExpand = useCallback((id) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  const handleFieldSave = useCallback(async (id, field, value) => {
    const result = await updateInvestigation(id, { [field]: value });
    if (result.ok) {
      setInvestigations(prev => prev.map(inv =>
        inv._id === id ? { ...inv, ...result.investigation } : inv
      ));
      // Refresh stats since status changes affect counts
      if (field === 'status') loadStats();
    }
  }, [loadStats]);

  const handleBulkSave = useCallback(async (id, fields) => {
    const result = await updateInvestigation(id, fields);
    if (result.ok) {
      setInvestigations(prev => prev.map(inv =>
        inv._id === id ? { ...inv, ...result.investigation } : inv
      ));
      if ('status' in fields) loadStats();
    }
    return result;
  }, [loadStats]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const result = await deleteInvestigation(deleteTarget);
    if (result.ok) {
      setInvestigations(prev => prev.filter(inv => inv._id !== deleteTarget));
      setTotal(prev => prev - 1);
      if (expandedId === deleteTarget) setExpandedId(null);
      loadStats();
    }
    setDeleteTarget(null);
  }, [deleteTarget, expandedId, loadStats]);

  // Import handlers
  const handleParseImport = useCallback(() => {
    const parsed = parseInvText(importText);
    setImportParsed(parsed);
    setImportResult(null);
  }, [importText]);

  const handleExecuteImport = useCallback(async () => {
    if (!importParsed || importParsed.length === 0) return;
    setImportLoading(true);
    setImportResult(null);
    try {
      const result = await bulkImportInvestigations(importParsed);
      setImportResult(result);
      if (result.ok && (result.imported > 0 || result.updated > 0)) {
        // Refresh the list and stats
        loadList();
        loadStats();
      }
    } catch (err) {
      setImportResult({ ok: false, error: err.message });
    }
    setImportLoading(false);
  }, [importParsed, loadList, loadStats]);

  const handleCloseImport = useCallback(() => {
    setShowImport(false);
    setImportText('');
    setImportParsed(null);
    setImportResult(null);
  }, []);

  // Computed stats
  const statCards = useMemo(() => {
    if (!stats) return null;
    const activeCount = (stats.byStatus?.new || 0) + (stats.byStatus?.['in-progress'] || 0);
    const workaroundCount = stats.withWorkarounds || 0;
    const totalMatches = (stats.trending || []).reduce((sum, inv) => sum + (inv.affectedCount || 0), 0);
    const activeCats = Object.entries(stats.byCategory || {}).filter(([cat, count]) => count > 0).length;

    return [
      { label: 'Active INVs', value: activeCount, icon: 'alert' },
      { label: 'With Workarounds', value: workaroundCount, icon: 'check' },
      { label: 'Total Matches', value: totalMatches, icon: 'match' },
      { label: 'Categories', value: activeCats, icon: 'grid' },
    ];
  }, [stats]);

  return (
    <div className="inv-view">
      {/* Header */}
      <div className="inv-view-header">
        <h1 className="inv-view-title">Investigations</h1>
        <span className="inv-view-count">
          {!loading && `Showing ${investigations.length} of ${total} investigation${total !== 1 ? 's' : ''}`}
        </span>
        <button
          className="inv-import-toggle-btn"
          onClick={() => setShowImport(prev => !prev)}
          type="button"
        >
          {showImport ? 'Close Import' : '+ Import INVs'}
        </button>
      </div>

      {/* Import panel */}
      <AnimatePresence>
        {showImport && (
          <motion.div
            className="inv-import-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="inv-import-inner">
              <label className="inv-import-label">Paste INV entries from Slack</label>
              <textarea
                className="inv-import-textarea"
                value={importText}
                onChange={e => { setImportText(e.target.value); setImportParsed(null); setImportResult(null); }}
                placeholder={'INV-147914 - No option to select a bank account when receiving payment using android app\nINV-148001 | 2026-03-10 | John Smith (FE-SBG-T2) | Bank feed connection failing for TD Canada Trust'}
                rows={5}
              />
              <div className="inv-import-actions">
                <button
                  className="inv-import-parse-btn"
                  onClick={handleParseImport}
                  disabled={!importText.trim()}
                  type="button"
                >
                  Parse
                </button>
                {importParsed && importParsed.length > 0 && (
                  <button
                    className="inv-import-exec-btn"
                    onClick={handleExecuteImport}
                    disabled={importLoading}
                    type="button"
                  >
                    {importLoading ? 'Importing...' : `Import ${importParsed.length} INV${importParsed.length > 1 ? 's' : ''}`}
                  </button>
                )}
                <button
                  className="inv-import-cancel-btn"
                  onClick={handleCloseImport}
                  type="button"
                >
                  Cancel
                </button>
              </div>

              {/* Parse preview */}
              {importParsed && importParsed.length > 0 && !importResult && (
                <div className="inv-import-preview">
                  <div className="inv-import-preview-title">
                    Parsed {importParsed.length} INV{importParsed.length > 1 ? 's' : ''}:
                  </div>
                  {importParsed.map((inv, i) => (
                    <div key={inv.invNumber || i} className="inv-import-preview-row">
                      <span className="inv-badge">{inv.invNumber}</span>
                      <span className="inv-import-preview-subject">{inv.subject}</span>
                      {inv.agentName && (
                        <span className="inv-import-preview-meta">{inv.agentName}{inv.team ? ` (${inv.team})` : ''}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {importParsed && importParsed.length === 0 && (
                <div className="inv-import-empty">
                  No INV numbers found in the pasted text. Each line should contain an INV-XXXXXX number.
                </div>
              )}

              {/* Import result */}
              {importResult && importResult.ok && (
                <div className="inv-import-result">
                  <div className="inv-import-result-summary">
                    {importResult.imported > 0 && <span className="inv-import-result-new">{importResult.imported} new</span>}
                    {importResult.updated > 0 && <span className="inv-import-result-updated">{importResult.updated} updated</span>}
                    {importResult.duplicateCount > 0 && <span className="inv-import-result-dup">{importResult.duplicateCount} duplicate{importResult.duplicateCount > 1 ? 's' : ''}</span>}
                  </div>
                  <DuplicateInvBanner
                    duplicates={importResult.duplicates}
                    onDismiss={() => setImportResult(prev => prev ? { ...prev, duplicates: undefined, duplicateCount: 0 } : prev)}
                  />
                  <SimilarInvBanner
                    matches={importResult.similarMatches}
                    onDismiss={() => setImportResult(prev => prev ? { ...prev, similarMatches: undefined } : prev)}
                  />
                </div>
              )}

              {importResult && !importResult.ok && (
                <div className="inv-import-error">
                  Import failed: {importResult.error || 'Unknown error'}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats */}
      {statCards && (
        <div className="inv-stats-grid">
          {statCards.map(card => (
            <div key={card.label} className="inv-stat-card">
              <div className="inv-stat-icon">
                <StatIcon type={card.icon} />
              </div>
              <div className="inv-stat-value">{card.value}</div>
              <div className="inv-stat-label">{card.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="inv-filter-bar">
        <div className="inv-search-wrap">
          <svg className="inv-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            className="inv-search-input"
            placeholder="Search INV number, subject, notes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <select
          className="inv-filter-select"
          value={category}
          onChange={e => setCategory(e.target.value)}
        >
          <option value="">All Categories</option>
          {CATEGORIES.map(cat => (
            <option key={cat} value={cat}>{categoryLabel(cat)}</option>
          ))}
        </select>

        <select
          className="inv-filter-select"
          value={status}
          onChange={e => setStatus(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="active">Active (New + In Progress)</option>
          {STATUSES.map(s => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>

        <select
          className="inv-filter-select"
          value={sort}
          onChange={e => setSort(e.target.value)}
        >
          {SORT_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* List */}
      <div className="inv-list">
        {loading && investigations.length === 0 ? (
          // Loading skeleton
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="inv-skeleton-card">
              <div className="inv-skeleton-bar" style={{ width: 80 }} />
              <div className="inv-skeleton-bar" style={{ width: 56 }} />
              <div className="inv-skeleton-bar" style={{ width: 50 }} />
              <div className="inv-skeleton-bar" style={{ flex: 1 }} />
              <div className="inv-skeleton-bar" style={{ width: 65 }} />
              <div className="inv-skeleton-bar" style={{ width: 90 }} />
            </div>
          ))
        ) : investigations.length === 0 ? (
          <div className="inv-empty">
            <div className="inv-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </div>
            <div className="inv-empty-title">No investigations tracked yet</div>
            <div className="inv-empty-desc">
              Upload Slack screenshots in Chat to import INVs, or they will appear here as the system matches incoming escalations.
            </div>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {investigations.map(inv => (
              <InvCard
                key={inv._id}
                inv={inv}
                expanded={expandedId === inv._id}
                copiedId={copiedId}
                onToggle={() => handleToggleExpand(inv._id)}
                onCopy={handleCopyInv}
                onFieldSave={handleFieldSave}
                onBulkSave={handleBulkSave}
                onDelete={setDeleteTarget}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete Investigation"
        message="This investigation record will be permanently deleted. This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// --- INV Card ---

function InvCard({ inv, expanded, copiedId, onToggle, onCopy, onFieldSave, onBulkSave, onDelete }) {
  const [localDetails, setLocalDetails] = useState(inv.details || '');
  const [localWorkaround, setLocalWorkaround] = useState(inv.workaround || '');
  const [localResolution, setLocalResolution] = useState(inv.resolution || '');
  const [localNotes, setLocalNotes] = useState(inv.notes || '');
  const [localStatus, setLocalStatus] = useState(inv.status || 'new');
  const [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'error'
  const saveTimerRef = useRef(null);

  // Sync local state when inv data updates from server
  useEffect(() => {
    setLocalDetails(inv.details || '');
    setLocalWorkaround(inv.workaround || '');
    setLocalResolution(inv.resolution || '');
    setLocalNotes(inv.notes || '');
    setLocalStatus(inv.status || 'new');
  }, [inv.details, inv.workaround, inv.resolution, inv.notes, inv.status]);

  // Cleanup save timer
  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  const handleStatusChange = (e) => {
    const next = e.target.value;
    setLocalStatus(next);
    onFieldSave(inv._id, 'status', next);
  };

  const handleDetailsBlur = () => {
    if (localDetails !== (inv.details || '')) {
      onFieldSave(inv._id, 'details', localDetails);
    }
  };

  const handleWorkaroundBlur = () => {
    if (localWorkaround !== (inv.workaround || '')) {
      onFieldSave(inv._id, 'workaround', localWorkaround);
    }
  };

  const handleNotesBlur = () => {
    if (localNotes !== (inv.notes || '')) {
      onFieldSave(inv._id, 'notes', localNotes);
    }
  };

  const handleResolutionBlur = () => {
    if (localResolution !== (inv.resolution || '')) {
      onFieldSave(inv._id, 'resolution', localResolution);
    }
  };

  const handleSaveAll = async (e) => {
    e.stopPropagation();
    setSaveStatus('saving');
    clearTimeout(saveTimerRef.current);

    // Collect all changed fields into a single PATCH
    const changes = {};
    if (localDetails !== (inv.details || '')) changes.details = localDetails;
    if (localWorkaround !== (inv.workaround || '')) changes.workaround = localWorkaround;
    if (localResolution !== (inv.resolution || '')) changes.resolution = localResolution;
    if (localNotes !== (inv.notes || '')) changes.notes = localNotes;
    if (localStatus !== (inv.status || 'new')) changes.status = localStatus;

    if (Object.keys(changes).length === 0) {
      // Nothing changed — still show confirmation
      setSaveStatus('saved');
      saveTimerRef.current = setTimeout(() => setSaveStatus(null), 2000);
      return;
    }

    try {
      const result = await onBulkSave(inv._id, changes);
      if (result.ok) {
        setSaveStatus('saved');
        saveTimerRef.current = setTimeout(() => setSaveStatus(null), 2000);
      } else {
        setSaveStatus('error');
        saveTimerRef.current = setTimeout(() => setSaveStatus(null), 3000);
      }
    } catch {
      setSaveStatus('error');
      saveTimerRef.current = setTimeout(() => setSaveStatus(null), 3000);
    }
  };

  // Build tooltip text for hover
  const tooltipLines = [
    inv.subject,
    '',
    inv.reportedDate ? `Date: ${formatDate(inv.reportedDate)}` : null,
    inv.agentName ? `Agent: ${inv.agentName}${inv.team ? ` (${inv.team})` : ''}` : null,
    `Category: ${categoryLabel(inv.category)}`,
    `Status: ${statusLabel(inv.status || 'new')}`,
    inv.source ? `Source: ${inv.source}` : null,
    (inv.affectedCount || 0) > 0 ? `Matches: ${inv.affectedCount}` : null,
    inv.lastMatchedAt ? `Last matched: ${formatDate(inv.lastMatchedAt)}` : null,
    inv.details ? `\nDetails: ${inv.details.slice(0, 200)}${inv.details.length > 200 ? '...' : ''}` : null,
    inv.workaround ? `\nWorkaround: ${inv.workaround.slice(0, 200)}${inv.workaround.length > 200 ? '...' : ''}` : null,
    inv.resolution ? `\nResolution: ${inv.resolution.slice(0, 200)}${inv.resolution.length > 200 ? '...' : ''}` : null,
    inv.notes ? `\nNotes: ${inv.notes.slice(0, 200)}${inv.notes.length > 200 ? '...' : ''}` : null,
    inv.symptoms && inv.symptoms.length > 0 ? `\nSymptoms: ${inv.symptoms.join(', ')}` : null,
  ].filter(Boolean).join('\n');

  const agentShort = inv.agentName
    ? `${inv.agentName}${inv.team ? ` (${inv.team})` : ''}`
    : '';

  return (
    <div
      className={`inv-card${expanded ? ' expanded' : ''}`}
    >
      {/* Compact single-line summary row */}
      <div className="inv-card-summary" onClick={onToggle} title={tooltipLines}>
        {/* INV badge */}
        <span className="inv-badge">{inv.invNumber}</span>

        {/* Copy button */}
        <button
          className={`inv-copy-btn${copiedId === inv.invNumber ? ' copied' : ''}`}
          onClick={(e) => onCopy(e, inv.invNumber)}
          title="Copy INV number"
          type="button"
        >
          {copiedId === inv.invNumber ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          )}
        </button>

        {/* Category badge */}
        <span className={`cat-badge cat-${inv.category || 'unknown'}`}>
          {categoryLabel(inv.category)}
        </span>

        {/* Status dropdown — custom, dark-themed */}
        <StatusDropdown
          value={localStatus || 'new'}
          onChange={(nextStatus) => {
            setLocalStatus(nextStatus);
            onFieldSave(inv._id, 'status', nextStatus);
          }}
        />

        {/* Match count (inline, only if > 0) */}
        {(inv.affectedCount || 0) > 0 && (
          <span className="inv-match-count-inline">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            {inv.affectedCount}
          </span>
        )}

        {/* Truncated subject — takes remaining space */}
        <span className="inv-card-subject-compact">{inv.subject}</span>

        {/* Right-aligned meta: date + agent */}
        <span className="inv-card-meta-compact">
          {inv.reportedDate && (
            <span className="inv-meta-date">{formatDate(inv.reportedDate)}</span>
          )}
          {inv.reportedDate && agentShort && (
            <span className="inv-meta-sep">&middot;</span>
          )}
          {agentShort && (
            <span className="inv-meta-agent">{agentShort}</span>
          )}
        </span>

        {/* Expand chevron */}
        <svg
          className={`inv-expand-icon${expanded ? ' expanded' : ''}`}
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* Expanded detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            className="inv-card-detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="inv-detail-grid">
              {/* Full subject (visible in expanded view) */}
              <div className="inv-detail-field full-width">
                <label className="inv-detail-label">Subject</label>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)', lineHeight: 1.4 }}>
                  {inv.subject}
                </span>
              </div>

              {/* Status (editable) */}
              <div className="inv-detail-field">
                <label className="inv-detail-label">Status</label>
                <select
                  className="inv-detail-status-select"
                  value={localStatus}
                  onChange={handleStatusChange}
                  onClick={e => e.stopPropagation()}
                >
                  {STATUSES.map(s => (
                    <option key={s} value={s}>{statusLabel(s)}</option>
                  ))}
                </select>
              </div>

              {/* Source */}
              <div className="inv-detail-field">
                <label className="inv-detail-label">Source</label>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)', textTransform: 'capitalize' }}>
                  {inv.source || 'manual'}
                </span>
              </div>

              {/* Symptoms */}
              {inv.symptoms && inv.symptoms.length > 0 && (
                <div className="inv-detail-field full-width">
                  <label className="inv-detail-label">Symptoms</label>
                  <div className="inv-symptoms-list">
                    {inv.symptoms.map((symptom, i) => (
                      <span key={i} className="inv-symptom-pill">{symptom}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Details (editable) */}
              <div className="inv-detail-field full-width">
                <label className="inv-detail-label">Details</label>
                <textarea
                  className="inv-editable inv-details-edit"
                  value={localDetails}
                  onChange={e => setLocalDetails(e.target.value)}
                  onBlur={handleDetailsBlur}
                  onClick={e => e.stopPropagation()}
                  placeholder="Full issue description — what's happening, steps to reproduce, error messages, affected areas..."
                  rows={4}
                />
              </div>

              {/* Workaround (editable) */}
              <div className="inv-detail-field full-width">
                <label className="inv-detail-label">Workaround</label>
                <textarea
                  className="inv-editable inv-workaround-edit"
                  value={localWorkaround}
                  onChange={e => setLocalWorkaround(e.target.value)}
                  onBlur={handleWorkaroundBlur}
                  onClick={e => e.stopPropagation()}
                  placeholder="Add a workaround..."
                  rows={3}
                />
              </div>

              {/* Resolution (editable) */}
              <div className="inv-detail-field full-width">
                <label className="inv-detail-label">Resolution / Final Answer</label>
                <textarea
                  className="inv-editable inv-resolution-edit"
                  value={localResolution}
                  onChange={e => setLocalResolution(e.target.value)}
                  onBlur={handleResolutionBlur}
                  onClick={e => e.stopPropagation()}
                  placeholder="What actually fixed the issue..."
                  rows={3}
                />
              </div>

              {/* Notes (editable) */}
              <div className="inv-detail-field full-width">
                <label className="inv-detail-label">Notes</label>
                <textarea
                  className="inv-editable"
                  value={localNotes}
                  onChange={e => setLocalNotes(e.target.value)}
                  onBlur={handleNotesBlur}
                  onClick={e => e.stopPropagation()}
                  placeholder="Add notes..."
                  rows={3}
                />
              </div>

              {/* Timestamps */}
              <div className="inv-detail-field">
                <label className="inv-detail-label">Last Matched</label>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
                  {inv.lastMatchedAt ? formatDate(inv.lastMatchedAt) : 'Never'}
                </span>
              </div>

              <div className="inv-detail-field">
                <label className="inv-detail-label">Resolved At</label>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
                  {inv.resolvedAt ? formatDate(inv.resolvedAt) : '--'}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="inv-detail-actions">
              <div className="inv-detail-actions-left">
                <button
                  className={`inv-save-btn${saveStatus === 'saving' ? ' saving' : ''}`}
                  onClick={handleSaveAll}
                  disabled={saveStatus === 'saving'}
                  type="button"
                >
                  {saveStatus === 'saving' ? 'Saving...' : 'Save'}
                </button>
                {saveStatus === 'saved' && (
                  <span className="inv-save-feedback saved">Saved</span>
                )}
                {saveStatus === 'error' && (
                  <span className="inv-save-feedback error">Save failed</span>
                )}
              </div>
              <button
                className="inv-delete-btn"
                onClick={(e) => { e.stopPropagation(); onDelete(inv._id); }}
                type="button"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
                Delete Investigation
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Custom Status Dropdown (replaces native <select>) ---

function StatusDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on click-outside
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [open]);

  const handleSelect = (e, s) => {
    e.stopPropagation();
    setOpen(false);
    if (s !== value) onChange(s);
  };

  const label = STATUS_LABELS[value] || value;

  return (
    <span className={`inv-sdrop inv-sdrop-${value || 'new'}`} ref={ref}>
      <button
        type="button"
        className="inv-sdrop-trigger"
        onClick={(e) => { e.stopPropagation(); setOpen(prev => !prev); }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {label}
        <svg className="inv-sdrop-chevron" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="inv-sdrop-menu" role="listbox">
          {STATUSES.map(s => (
            <button
              key={s}
              type="button"
              className={`inv-sdrop-option inv-sdrop-opt-${s}${s === value ? ' active' : ''}`}
              role="option"
              aria-selected={s === value}
              onClick={(e) => handleSelect(e, s)}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// --- Stat Icons ---

function StatIcon({ type }) {
  const props = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

  switch (type) {
    case 'alert':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      );
    case 'check':
      return (
        <svg {...props}>
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      );
    case 'match':
      return (
        <svg {...props}>
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      );
    case 'grid':
      return (
        <svg {...props}>
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      );
    default:
      return null;
  }
}
