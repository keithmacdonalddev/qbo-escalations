import Tooltip from './Tooltip.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import PlaybookPanel from './PlaybookPanel.jsx';
import usePlaybook from '../hooks/usePlaybook.js';

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
  const {
    categories,
    selectedCategory,
    viewMode,
    loading,
    loadError,
    contentLoading,
    newCategoryName,
    setNewCategoryName,
    showCreateCategory,
    setShowCreateCategory,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    loadInitial,
    loadCategory,
    loadEdgeCases,
    loadFullPrompt,
    handleCreateCategory,
    handleDeleteSelectedCategory,
    heading,
    canHaveHistory,
    content,
    draftContent,
    isEditing,
    showHistory,
    showDiff,
    saveNotice,
    saving,
    diffLines,
    hasDiffChanges,
    saveLabel,
    versions,
    historyLoading,
    previewVersion,
    setDraftContent,
    setSaveLabel,
    handleStartEdit,
    handleCancelEdit,
    handleRequestSave,
    handleBackToEdit,
    handleClosePreview,
    handleConfirmSave,
    handleToggleHistory,
    handlePreviewVersion,
    handleRestoreVersion,
  } = usePlaybook();

  return (
    <div className="app-content-constrained">
      <div className="page-header">
        <h1 className="page-title">Playbook</h1>
        <span className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
          AI knowledge base and system guidance. Agent profiles and prompts now live in the dedicated Agents section.
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

            <div className="card card-compact" style={{ display: 'grid', gap: 'var(--sp-2)' }}>
              <span className="eyebrow">Agents</span>
              <span className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
                Profiles, prompts, learning, and history moved out of Playbook.
              </span>
              <a className="btn btn-secondary btn-sm" href="#/agents">Open Agents</a>
            </div>

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

          <PlaybookPanel
            heading={heading}
            viewMode={viewMode}
            selectedCategory={selectedCategory}
            content={content}
            draftContent={draftContent}
            contentLoading={contentLoading}
            isEditing={isEditing}
            showHistory={showHistory}
            showDiff={showDiff}
            saveNotice={saveNotice}
            saving={saving}
            diffLines={diffLines}
            hasDiffChanges={hasDiffChanges}
            saveLabel={saveLabel}
            versions={versions}
            historyLoading={historyLoading}
            previewVersion={previewVersion}
            canHaveHistory={canHaveHistory}
            hasUnsavedChanges={isEditing && draftContent !== content}
            onDraftContentChange={setDraftContent}
            onSaveLabelChange={setSaveLabel}
            onStartEdit={handleStartEdit}
            onCancelEdit={handleCancelEdit}
            onRequestSave={handleRequestSave}
            onBackToEdit={handleBackToEdit}
            onConfirmSave={handleConfirmSave}
            onToggleHistory={handleToggleHistory}
            onPreviewVersion={handlePreviewVersion}
            onRestoreVersion={handleRestoreVersion}
            onClosePreview={handleClosePreview}
            onDeleteCategoryRequest={() => setDeleteConfirmOpen(true)}
          />
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
