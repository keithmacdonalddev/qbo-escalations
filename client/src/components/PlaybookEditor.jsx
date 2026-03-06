import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../hooks/useToast.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import Tooltip from './Tooltip.jsx';
import {
  listCategories,
  getCategoryContent,
  updateCategoryContent,
  createCategory,
  deleteCategory,
  getEdgeCases,
  updateEdgeCases,
  getFullPlaybook,
  listCategoryVersions,
  getCategoryVersion,
  restoreCategoryVersion,
  listEdgeCaseVersions,
  getEdgeCaseVersion,
  restoreEdgeCaseVersion,
} from '../api/playbookApi.js';

const CAT_BADGE_MAP = {
  payroll: 'cat-payroll',
  'bank-feeds': 'cat-bank-feeds',
  reconciliation: 'cat-reconciliation',
  permissions: 'cat-permissions',
  billing: 'cat-billing',
  tax: 'cat-tax',
  invoicing: 'cat-invoicing',
  reporting: 'cat-reporting',
  technical: 'cat-technical',
  general: 'cat-general',
};

// ---------------------------------------------------------------------------
// Line-by-line diff utility (no npm packages)
// Returns array of { type: 'added' | 'removed' | 'unchanged', text: string }
// Uses a simple LCS-based approach for clean diffs.
// ---------------------------------------------------------------------------
function computeDiff(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
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

  // Backtrack to produce diff
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
  result.reverse();
  return result;
}

export default function PlaybookEditor() {
  const toast = useToast();
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [viewMode, setViewMode] = useState('category'); // category | edge-cases | full
  const [content, setContent] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // Diff state
  const [showDiff, setShowDiff] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');

  // History state
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(null); // { ts, content }

  const loadCategories = useCallback(async () => {
    const cats = await listCategories();
    setCategories(cats);
    return cats;
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await loadCategories();
    } catch {
      setLoadError('Failed to load playbook categories');
    }
    setLoading(false);
  }, [loadCategories]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // Reset diff/history when switching content
  const resetPanels = useCallback(() => {
    setShowDiff(false);
    setShowHistory(false);
    setVersions([]);
    setPreviewVersion(null);
  }, []);

  const loadCategory = useCallback(async (name) => {
    setSelectedCategory(name);
    setViewMode('category');
    setIsEditing(false);
    setSaveNotice('');
    resetPanels();
    setContentLoading(true);
    try {
      const text = await getCategoryContent(name);
      setContent(text);
      setDraftContent(text);
    } catch {
      setContent('Failed to load content.');
      setDraftContent('Failed to load content.');
    }
    setContentLoading(false);
  }, [resetPanels]);

  const loadEdgeCases = useCallback(async () => {
    setViewMode('edge-cases');
    setSelectedCategory(null);
    setIsEditing(false);
    setSaveNotice('');
    resetPanels();
    setContentLoading(true);
    try {
      const text = await getEdgeCases();
      setContent(text);
      setDraftContent(text);
    } catch {
      setContent('Failed to load edge cases.');
      setDraftContent('Failed to load edge cases.');
    }
    setContentLoading(false);
  }, [resetPanels]);

  const loadFullPrompt = useCallback(async () => {
    setViewMode('full');
    setSelectedCategory(null);
    setIsEditing(false);
    setSaveNotice('');
    resetPanels();
    setContentLoading(true);
    try {
      const text = await getFullPlaybook();
      setContent(text);
      setDraftContent(text);
    } catch {
      setContent('Failed to load full playbook.');
      setDraftContent('Failed to load full playbook.');
    }
    setContentLoading(false);
  }, [resetPanels]);

  const handleStartEdit = useCallback(() => {
    if (viewMode === 'full') return;
    setDraftContent(content);
    setIsEditing(true);
    setSaveNotice('');
    setShowDiff(false);
    setShowHistory(false);
    setPreviewVersion(null);
  }, [content, viewMode]);

  const handleCancelEdit = useCallback(() => {
    setDraftContent(content);
    setIsEditing(false);
    setShowDiff(false);
  }, [content]);

  // Show diff panel instead of saving immediately
  const handleRequestSave = useCallback(() => {
    if (saving || viewMode === 'full') return;
    setSaveLabel('');
    setShowDiff(true);
  }, [saving, viewMode]);

  const handleConfirmSave = useCallback(async () => {
    if (saving || viewMode === 'full') return;
    setSaving(true);
    try {
      const label = saveLabel.trim() || undefined;
      if (viewMode === 'category' && selectedCategory) {
        await updateCategoryContent(selectedCategory, draftContent, label);
      } else if (viewMode === 'edge-cases') {
        await updateEdgeCases(draftContent, label);
      }
      setContent(draftContent);
      setIsEditing(false);
      setShowDiff(false);
      setSaveLabel('');
      setSaveNotice('Saved');
      setTimeout(() => setSaveNotice(''), 2000);
    } catch {
      toast.error('Failed to save playbook changes');
    }
    setSaving(false);
  }, [saving, viewMode, selectedCategory, draftContent, saveLabel, toast]);

  const handleBackToEdit = useCallback(() => {
    setShowDiff(false);
  }, []);

  // History
  const handleToggleHistory = useCallback(async () => {
    if (showHistory) {
      setShowHistory(false);
      setPreviewVersion(null);
      return;
    }
    setShowHistory(true);
    setPreviewVersion(null);
    setHistoryLoading(true);
    try {
      let vers;
      if (viewMode === 'category' && selectedCategory) {
        vers = await listCategoryVersions(selectedCategory);
      } else if (viewMode === 'edge-cases') {
        vers = await listEdgeCaseVersions();
      } else {
        vers = [];
      }
      setVersions(vers);
    } catch {
      toast.error('Failed to load version history');
      setVersions([]);
    }
    setHistoryLoading(false);
  }, [showHistory, viewMode, selectedCategory, toast]);

  const handlePreviewVersion = useCallback(async (ts) => {
    try {
      let versionContent;
      if (viewMode === 'category' && selectedCategory) {
        versionContent = await getCategoryVersion(selectedCategory, ts);
      } else {
        versionContent = await getEdgeCaseVersion(ts);
      }
      setPreviewVersion({ ts, content: versionContent });
    } catch {
      toast.error('Failed to load version preview');
    }
  }, [viewMode, selectedCategory, toast]);

  const handleRestoreVersion = useCallback(async (ts) => {
    try {
      if (viewMode === 'category' && selectedCategory) {
        await restoreCategoryVersion(selectedCategory, ts);
        const text = await getCategoryContent(selectedCategory);
        setContent(text);
        setDraftContent(text);
      } else if (viewMode === 'edge-cases') {
        await restoreEdgeCaseVersion(ts);
        const text = await getEdgeCases();
        setContent(text);
        setDraftContent(text);
      }
      setShowHistory(false);
      setPreviewVersion(null);
      const label = formatTs(ts);
      toast.success(`Restored version from ${label}`);
    } catch {
      toast.error('Failed to restore version');
    }
  }, [viewMode, selectedCategory, toast]);

  const handleCreateCategory = useCallback(async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      const createdName = await createCategory(name, '# ' + name + '\n\n');
      setNewCategoryName('');
      setShowCreateCategory(false);
      await loadCategories();
      await loadCategory(createdName);
    } catch {
      toast.error('Failed to create category');
    }
  }, [newCategoryName, loadCategories, loadCategory, toast]);

  const handleDeleteSelectedCategory = useCallback(async () => {
    if (!selectedCategory) return;
    try {
      await deleteCategory(selectedCategory);
      setSelectedCategory(null);
      setContent('');
      setDraftContent('');
      setViewMode('category');
      resetPanels();
      await loadCategories();
    } catch {
      toast.error('Failed to delete category');
    }
    setDeleteConfirmOpen(false);
  }, [selectedCategory, loadCategories, resetPanels, toast]);

  const hasUnsavedChanges = isEditing && draftContent !== content;

  useEffect(() => {
    const handler = (e) => { if (hasUnsavedChanges) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  const heading = viewMode === 'full'
    ? 'Full System Prompt'
    : viewMode === 'edge-cases'
      ? 'Edge Cases'
      : (selectedCategory ? selectedCategory.replace(/-/g, ' ') : 'Select a Category');

  const canHaveHistory = viewMode !== 'full' && (viewMode === 'edge-cases' || selectedCategory);

  // Diff lines (computed only when showDiff is true)
  const diffLines = showDiff ? computeDiff(content, draftContent) : [];
  const hasDiffChanges = diffLines.some((l) => l.type !== 'unchanged');

  return (
    <div className="app-content-constrained">
      <div className="page-header">
        <h1 className="page-title">Playbook</h1>
        <span className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
          AI knowledge base — edits here shape how Claude answers.
        </span>
      </div>

      {loadError && (
        <div className="error-banner">
          <span>{loadError}</span>
          <button onClick={loadInitial} type="button">Retry</button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--sp-10)' }}>
          <span className="spinner" />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 280px) 1fr', gap: 'var(--sp-6)' }}>
          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            <Tooltip text="View edge case scenarios and handling" level="medium">
              <button className={`btn btn-sm ${viewMode === 'edge-cases' ? 'btn-primary' : 'btn-secondary'}`} onClick={loadEdgeCases} type="button">
                Edge Cases
              </button>
            </Tooltip>
            <Tooltip text="View the complete system prompt sent to AI" level="medium">
              <button className={`btn btn-sm ${viewMode === 'full' ? 'btn-primary' : 'btn-secondary'}`} onClick={loadFullPrompt} type="button">
                Full Prompt (Read-only)
              </button>
            </Tooltip>

            <div style={{ borderTop: '1px solid var(--line-subtle)', margin: 'var(--sp-2) 0' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="eyebrow">Categories</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCreateCategory((p) => !p)} type="button">
                {showCreateCategory ? 'Close' : 'New'}
              </button>
            </div>

            {showCreateCategory && (
              <div className="card card-compact" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="new-category-name"
                />
                <button className="btn btn-primary btn-sm" onClick={handleCreateCategory} type="button">
                  Create Category
                </button>
              </div>
            )}

            {categories.map((cat) => (
              <button
                key={cat.name}
                className={`card card-compact card-clickable${selectedCategory === cat.name && viewMode === 'category' ? ' is-selected' : ''}`}
                onClick={() => loadCategory(cat.name)}
                type="button"
                style={{
                  textAlign: 'left',
                  border: selectedCategory === cat.name && viewMode === 'category' ? '1px solid var(--accent)' : undefined,
                  background: selectedCategory === cat.name && viewMode === 'category' ? 'var(--accent-subtle)' : undefined,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className={`cat-badge ${CAT_BADGE_MAP[cat.name] || 'cat-general'}`}>
                    {cat.name.replace(/-/g, ' ')}
                  </span>
                  <Tooltip text="Size of this category in characters" level="high">
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>{formatSize(cat.size)}</span>
                  </Tooltip>
                </div>
              </button>
            ))}

            {categories.length === 0 && (
              <div className="text-secondary" style={{ fontSize: 'var(--text-sm)', padding: 'var(--sp-3)' }}>
                No categories found.
              </div>
            )}
          </div>

          {/* Main content panel */}
          <div className="card" style={{ minHeight: 440 }}>
            {contentLoading ? (
              <div style={{ textAlign: 'center', padding: 'var(--sp-10)' }}>
                <span className="spinner" />
              </div>
            ) : (
              <div>
                {/* Header toolbar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-4)', gap: 'var(--sp-2)' }}>
                  <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 700, textTransform: 'capitalize' }}>
                    {showDiff ? 'Review Changes' : heading}
                  </h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                    {saveNotice && (
                      <span style={{ fontSize: 'var(--text-xs)', color: saveNotice === 'Saved' ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                        {saveNotice}
                      </span>
                    )}

                    {/* Diff panel actions */}
                    {showDiff ? (
                      <>
                        <button className="btn btn-secondary btn-sm" onClick={handleBackToEdit} type="button">
                          Back to Edit
                        </button>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={handleConfirmSave}
                          disabled={saving || !hasDiffChanges}
                          type="button"
                        >
                          {saving ? 'Saving...' : 'Confirm Save'}
                        </button>
                      </>
                    ) : (
                      <>
                        {viewMode === 'category' && selectedCategory && !isEditing && !showHistory && (
                          <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirmOpen(true)} type="button" style={{ color: 'var(--danger)' }}>
                            Delete Category
                          </button>
                        )}
                        {canHaveHistory && !isEditing && (
                          <button
                            className={`btn btn-sm ${showHistory ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={handleToggleHistory}
                            type="button"
                          >
                            {showHistory ? 'Close History' : 'History'}
                          </button>
                        )}
                        {viewMode !== 'full' && !showHistory && (isEditing ? (
                          <>
                            <button className="btn btn-secondary btn-sm" onClick={handleCancelEdit} type="button">Cancel</button>
                            <button className="btn btn-primary btn-sm" onClick={handleRequestSave} disabled={saving || !hasUnsavedChanges} type="button">
                              {saving ? 'Saving...' : 'Save'}
                            </button>
                          </>
                        ) : (
                          canHaveHistory && (
                            <button className="btn btn-secondary btn-sm" onClick={handleStartEdit} type="button">Edit</button>
                          )
                        ))}
                        {!showHistory && <CopyButton text={content} />}
                      </>
                    )}
                  </div>
                </div>

                {/* Body: diff | history | editor | viewer */}
                {showDiff ? (
                  <DiffPanel diffLines={diffLines} hasDiffChanges={hasDiffChanges} saveLabel={saveLabel} onSaveLabelChange={setSaveLabel} />
                ) : showHistory ? (
                  <HistoryPanel
                    versions={versions}
                    loading={historyLoading}
                    previewVersion={previewVersion}
                    onPreview={handlePreviewVersion}
                    onRestore={handleRestoreVersion}
                    onClosePreview={() => setPreviewVersion(null)}
                  />
                ) : isEditing ? (
                  <textarea
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                    style={{
                      width: '100%',
                      minHeight: 'calc(100vh - 320px)',
                      maxHeight: 'calc(100vh - 260px)',
                      resize: 'vertical',
                      background: 'var(--bg-sunken)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--sp-5)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-sm)',
                      lineHeight: 1.6,
                      color: 'var(--ink)',
                    }}
                  />
                ) : !content && !selectedCategory && viewMode === 'category' ? (
                  <PlaybookEmptyState />
                ) : (
                  <div
                    className="playbook-content"
                    style={{
                      background: 'var(--bg-sunken)',
                      padding: 'var(--sp-6)',
                      borderRadius: 'var(--radius-md)',
                      maxHeight: 'calc(100vh - 300px)',
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      fontSize: 'var(--text-sm)',
                      lineHeight: 1.7,
                    }}
                  >
                    {content}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      <ConfirmModal
        open={deleteConfirmOpen}
        title="Delete Category"
        message={`Delete category "${selectedCategory}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger={true}
        onConfirm={handleDeleteSelectedCategory}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlaybookEmptyState — shown when no content is selected
// ---------------------------------------------------------------------------
function PlaybookEmptyState() {
  const items = [
    { label: 'Categories', desc: 'Topic guides like payroll, billing, and bank feeds. Pick one from the sidebar to view or edit.' },
    { label: 'Edge Cases', desc: 'Tricky scenarios that don\'t fit a category. Click "Edge Cases" above.' },
    { label: 'Full Prompt', desc: 'Read-only view of the complete system prompt Claude receives.' },
  ];

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 'var(--sp-10)' }}>
      <div style={{ maxWidth: 480 }}>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--ink)', marginBottom: 'var(--sp-4)', marginTop: 0 }}>
          Get Started with the Playbook
        </h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)', lineHeight: 1.6, marginBottom: 'var(--sp-6)', marginTop: 0 }}>
          The Playbook is what the AI reads before every chat. Edit it to change how Claude answers escalation questions — no restart needed.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          {items.map((item) => (
            <div key={item.label} style={{ paddingLeft: 'var(--sp-4)', borderLeft: '2px solid var(--line)' }}>
              <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                {item.label}
              </span>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-tertiary)' }}>
                {' — '}{item.desc}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiffPanel component
// ---------------------------------------------------------------------------
function DiffPanel({ diffLines, hasDiffChanges, saveLabel, onSaveLabelChange }) {
  if (!hasDiffChanges) {
    return (
      <div style={{
        background: 'var(--bg-sunken)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--sp-8)',
        textAlign: 'center',
        color: 'var(--ink-tertiary)',
        fontSize: 'var(--text-sm)',
      }}>
        No changes to save.
      </div>
    );
  }

  return (
    <div>
      <div style={{
        background: 'var(--bg-sunken)',
        borderRadius: 'var(--radius-md)',
        overflowY: 'auto',
        maxHeight: 'calc(100vh - 380px)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-sm)',
        lineHeight: 1.6,
        border: '1px solid var(--line)',
      }}>
        {diffLines.map((line, idx) => {
          let bg, color, prefix;
          if (line.type === 'added') {
            bg = 'rgba(34,197,94,0.12)';
            color = 'var(--success)';
            prefix = '+ ';
          } else if (line.type === 'removed') {
            bg = 'rgba(220,38,38,0.12)';
            color = 'var(--danger)';
            prefix = '- ';
          } else {
            bg = 'transparent';
            color = 'var(--ink-tertiary)';
            prefix = '  ';
          }
          return (
            <div
              key={idx}
              style={{
                background: bg,
                color,
                padding: '1px var(--sp-4)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              <span style={{ userSelect: 'none', opacity: 0.6 }}>{prefix}</span>
              {line.text}
            </div>
          );
        })}
      </div>
      <input
        type="text"
        value={saveLabel}
        onChange={(e) => onSaveLabelChange(e.target.value)}
        placeholder="Save note (optional, e.g. 'added 2024 payroll rules')"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          fontSize: 'var(--text-sm)',
          padding: 'var(--sp-3) var(--sp-4)',
          background: 'var(--bg-sunken)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-md)',
          marginTop: 'var(--sp-4)',
          color: 'var(--ink)',
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// HistoryPanel component
// ---------------------------------------------------------------------------
function HistoryPanel({ versions, loading, previewVersion, onPreview, onRestore, onClosePreview }) {
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 'var(--sp-10)' }}>
        <span className="spinner" />
      </div>
    );
  }

  if (previewVersion) {
    return (
      <div>
        <div style={{
          background: 'rgba(234,179,8,0.1)',
          border: '1px solid rgba(234,179,8,0.3)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--sp-3) var(--sp-4)',
          marginBottom: 'var(--sp-4)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--sp-2)',
        }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
            Previewing version from {formatTs(previewVersion.ts)} — not the current saved version
          </span>
          <button className="btn btn-ghost btn-sm" onClick={onClosePreview} type="button">
            Back to list
          </button>
        </div>
        <div style={{
          background: 'var(--bg-sunken)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--sp-6)',
          maxHeight: 'calc(100vh - 360px)',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          lineHeight: 1.7,
          color: 'var(--ink)',
        }}>
          {previewVersion.content}
        </div>
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div style={{
        background: 'var(--bg-sunken)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--sp-8)',
        textAlign: 'center',
        color: 'var(--ink-tertiary)',
        fontSize: 'var(--text-sm)',
      }}>
        No version history yet.
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--sp-2)',
      maxHeight: 'calc(100vh - 300px)',
      overflowY: 'auto',
    }}>
      {versions.map((v) => (
        <div
          key={v.ts}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 'var(--sp-3) var(--sp-4)',
            background: 'var(--bg-sunken)',
            borderRadius: 'var(--radius-md)',
            gap: 'var(--sp-3)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)', fontWeight: 500 }}>
              {formatTs(v.ts)}
            </span>
            {v.label && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)', fontStyle: 'italic' }}>
                {v.label}
              </span>
            )}
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
              {formatSize(v.size)}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => onPreview(v.ts)}
              type="button"
            >
              Preview
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onRestore(v.ts)}
              type="button"
              style={{ color: 'var(--accent)' }}
            >
              Restore
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

function formatTs(ts) {
  return new Date(typeof ts === 'string' ? parseInt(ts) : ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }, [text]);

  return (
    <button className={`copy-btn${copied ? ' is-copied' : ''}`} onClick={handleCopy} type="button">
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
