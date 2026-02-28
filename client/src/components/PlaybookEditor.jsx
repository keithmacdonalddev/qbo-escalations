import { useState, useEffect, useCallback } from 'react';
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

export default function PlaybookEditor() {
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

  const loadCategories = useCallback(async () => {
    const cats = await listCategories();
    setCategories(cats);
    return cats;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadCategories();
      } catch { /* graceful */ }
      setLoading(false);
    })();
  }, [loadCategories]);

  const loadCategory = useCallback(async (name) => {
    setSelectedCategory(name);
    setViewMode('category');
    setIsEditing(false);
    setSaveNotice('');
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
  }, []);

  const loadEdgeCases = useCallback(async () => {
    setViewMode('edge-cases');
    setSelectedCategory(null);
    setIsEditing(false);
    setSaveNotice('');
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
  }, []);

  const loadFullPrompt = useCallback(async () => {
    setViewMode('full');
    setSelectedCategory(null);
    setIsEditing(false);
    setSaveNotice('');
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
  }, []);

  const handleStartEdit = useCallback(() => {
    if (viewMode === 'full') return;
    setDraftContent(content);
    setIsEditing(true);
    setSaveNotice('');
  }, [content, viewMode]);

  const handleCancelEdit = useCallback(() => {
    setDraftContent(content);
    setIsEditing(false);
  }, [content]);

  const handleSave = useCallback(async () => {
    if (saving || viewMode === 'full') return;
    setSaving(true);
    try {
      if (viewMode === 'category' && selectedCategory) {
        await updateCategoryContent(selectedCategory, draftContent);
      } else if (viewMode === 'edge-cases') {
        await updateEdgeCases(draftContent);
      }
      setContent(draftContent);
      setIsEditing(false);
      setSaveNotice('Saved');
      setTimeout(() => setSaveNotice(''), 2000);
    } catch {
      setSaveNotice('Save failed');
      setTimeout(() => setSaveNotice(''), 2000);
    }
    setSaving(false);
  }, [saving, viewMode, selectedCategory, draftContent]);

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
      setSaveNotice('Create failed');
      setTimeout(() => setSaveNotice(''), 2000);
    }
  }, [newCategoryName, loadCategories, loadCategory]);

  const handleDeleteSelectedCategory = useCallback(async () => {
    if (!selectedCategory) return;
    try {
      await deleteCategory(selectedCategory);
      setSelectedCategory(null);
      setContent('');
      setDraftContent('');
      setViewMode('category');
      await loadCategories();
    } catch {
      setSaveNotice('Delete failed');
      setTimeout(() => setSaveNotice(''), 2000);
    }
    setDeleteConfirmOpen(false);
  }, [selectedCategory, loadCategories]);

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

  return (
    <div className="app-content-constrained">
      <div className="page-header">
        <h1 className="page-title">Playbook</h1>
        <span className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
          Manage category guides, edge cases, and the full loaded system prompt.
        </span>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--sp-10)' }}>
          <span className="spinner" />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 280px) 1fr', gap: 'var(--sp-6)' }}>
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

          <div className="card" style={{ minHeight: 440 }}>
            {contentLoading ? (
              <div style={{ textAlign: 'center', padding: 'var(--sp-10)' }}>
                <span className="spinner" />
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-4)', gap: 'var(--sp-2)' }}>
                  <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 700, textTransform: 'capitalize' }}>{heading}</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                    {saveNotice && (
                      <span style={{ fontSize: 'var(--text-xs)', color: saveNotice === 'Saved' ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                        {saveNotice}
                      </span>
                    )}
                    {viewMode === 'category' && selectedCategory && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirmOpen(true)} type="button" style={{ color: 'var(--danger)' }}>
                        Delete Category
                      </button>
                    )}
                    {viewMode !== 'full' && (isEditing ? (
                      <>
                        <button className="btn btn-secondary btn-sm" onClick={handleCancelEdit} type="button">Cancel</button>
                        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !hasUnsavedChanges} type="button">
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                      </>
                    ) : (
                      <button className="btn btn-secondary btn-sm" onClick={handleStartEdit} type="button">Edit</button>
                    ))}
                    <CopyButton text={content} />
                  </div>
                </div>

                {isEditing ? (
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
                    {content || 'Select a category or view mode to load content.'}
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

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
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
