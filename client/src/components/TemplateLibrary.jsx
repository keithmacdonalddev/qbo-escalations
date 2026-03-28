import ConfirmModal from './ConfirmModal.jsx';
import Tooltip from './Tooltip.jsx';
import TemplateCard from './TemplateCard.jsx';
import {
  CATEGORY_FILTER_OPTIONS,
  useTemplates,
} from '../hooks/useTemplates.js';

export default function TemplateLibrary() {
  const {
    templates,
    category,
    setCategory,
    loading,
    copiedId,
    isFormOpen,
    editingTemplate,
    form,
    setForm,
    renderVars,
    setRenderVars,
    rendered,
    renderUnresolved,
    saving,
    error,
    deleteTarget,
    currentVariableList,
    load,
    openCreateForm,
    openEditForm,
    closeForm,
    handleCopy,
    handleSave,
    confirmDeleteTemplate,
    handleDuplicate,
    handleRender,
    setDeleteTarget,
  } = useTemplates();

  return (
    <div className="app-content-constrained">
      <div className="page-header">
        <h1 className="page-title">Response Templates</h1>
        <span className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
          Pre-written responses for common escalation scenarios — copy, customize, and send.
        </span>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <Tooltip text="Reload templates from server" level="medium"><button className="btn btn-secondary" onClick={load} type="button">Refresh</button></Tooltip>
          <button className="btn btn-primary" onClick={openCreateForm} type="button">New Template</button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 'var(--sp-4)', borderColor: 'var(--danger)' }}>
          <span className="text-danger">{error}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-6)' }}>
        {CATEGORY_FILTER_OPTIONS.map((cat) => (
          <button
            key={cat}
            className={`btn btn-sm ${category === cat ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setCategory(cat)}
            type="button"
          >
            {cat ? cat.replace('-', ' ') : 'All'}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isFormOpen ? '1fr 420px' : '1fr', gap: 'var(--sp-5)' }}>
        <div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 'var(--sp-10)' }}>
              <span className="spinner" />
            </div>
          ) : templates.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-title">No Templates Found</div>
                <div className="empty-state-desc">
                  {category
                    ? `No templates in "${category.replace('-', ' ')}" yet.`
                    : 'Templates are pre-written messages you can copy into escalation responses. Click "New Template" to create one with placeholders like {{clientName}} for quick personalization.'}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--sp-5)' }}>
              {templates.map((tmpl) => (
                <TemplateCard
                  key={tmpl._id}
                  template={tmpl}
                  copied={copiedId === tmpl._id}
                  onCopy={handleCopy}
                  onEdit={openEditForm}
                  onDuplicate={handleDuplicate}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          )}
        </div>

        {isFormOpen && (
          <div className="card" style={{ position: 'sticky', top: 'var(--sp-6)', alignSelf: 'start' }}>
            <h2 style={{ margin: 0, marginBottom: 'var(--sp-3)', fontSize: 'var(--text-md)', fontWeight: 700 }}>
              {editingTemplate ? 'Edit Template' : 'Create Template'}
            </h2>

            <div className="form-group">
              <label className="form-label">Category</label>
              <select value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}>
                {CATEGORY_FILTER_OPTIONS.filter(Boolean).map((cat) => (
                  <option key={cat} value={cat}>{cat.replace('-', ' ')}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Title</label>
              <input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Variables (comma-separated)</label>
              <input
                value={form.variables}
                onChange={(e) => setForm((prev) => ({ ...prev, variables: e.target.value }))}
                placeholder="clientName, caseNumber"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Body</label>
              <textarea
                value={form.body}
                onChange={(e) => setForm((prev) => ({ ...prev, body: e.target.value }))}
                rows={8}
              />
            </div>

            <div className="form-actions" style={{ marginTop: 0, marginBottom: 'var(--sp-4)' }}>
              <button className="btn btn-secondary" onClick={closeForm} type="button">Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving || !form.title.trim() || !form.body.trim() || !form.category.trim()}
                type="button"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>

            {editingTemplate && currentVariableList.length > 0 && (
              <div style={{ borderTop: '1px solid var(--line-subtle)', paddingTop: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                <h3 style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 700 }}>Render Preview</h3>
                {currentVariableList.map((name) => (
                  <div key={name}>
                    <label className="form-label">{name}</label>
                    <input
                      value={renderVars[name] || ''}
                      onChange={(e) => setRenderVars((prev) => ({ ...prev, [name]: e.target.value }))}
                    />
                  </div>
                ))}
                <Tooltip text="Preview the template with sample data" level="medium"><button className="btn btn-secondary btn-sm" onClick={handleRender} type="button">Render</button></Tooltip>
                {rendered && (
                  <div className="playbook-content" style={{ background: 'var(--bg-sunken)', borderRadius: 'var(--radius-md)', padding: 'var(--sp-3)', whiteSpace: 'pre-wrap' }}>
                    {rendered}
                    {renderUnresolved.length > 0 && (
                      <div style={{ marginTop: 'var(--sp-2)', fontSize: 'var(--text-xs)', color: 'var(--warning)' }}>
                        Unresolved: {renderUnresolved.join(', ')}
                      </div>
                    )}
                    <div style={{ marginTop: 'var(--sp-2)' }}>
                      <button className="copy-btn" onClick={() => handleCopy(editingTemplate, rendered)} type="button">Copy Rendered</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete Template"
        message="This template will be permanently deleted. This cannot be undone."
        confirmLabel="Delete"
        danger={true}
        onConfirm={confirmDeleteTemplate}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
