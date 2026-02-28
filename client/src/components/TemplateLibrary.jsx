import { useMemo, useState, useEffect, useCallback } from 'react';
import ConfirmModal from './ConfirmModal.jsx';
import Tooltip from './Tooltip.jsx';
import {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  duplicateTemplate,
  renderTemplate,
  trackTemplateUsage,
} from '../api/templatesApi.js';

const CATEGORY_FILTER_OPTIONS = [
  '', 'acknowledgment', 'follow-up', 'escalation-up',
  'payroll', 'bank-feeds', 'reconciliation', 'permissions',
  'billing', 'tax', 'invoicing', 'reporting', 'technical', 'general',
];

const EMPTY_FORM = { category: 'general', title: '', body: '', variables: '' };

export default function TemplateLibrary() {
  const [templates, setTemplates] = useState([]);
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [renderVars, setRenderVars] = useState({});
  const [rendered, setRendered] = useState('');
  const [renderUnresolved, setRenderUnresolved] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listTemplates(category || undefined);
      setTemplates(list);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [category]);

  useEffect(() => { load(); }, [load]);

  const currentVariableList = useMemo(() => {
    const src = editingTemplate ? editingTemplate.variables || [] : [];
    return src;
  }, [editingTemplate]);

  const openCreateForm = useCallback(() => {
    setIsFormOpen(true);
    setEditingTemplate(null);
    setForm(EMPTY_FORM);
    setRenderVars({});
    setRendered('');
    setRenderUnresolved([]);
    setError('');
  }, []);

  const openEditForm = useCallback((template) => {
    setIsFormOpen(true);
    setEditingTemplate(template);
    setForm({
      category: template.category || 'general',
      title: template.title || '',
      body: template.body || '',
      variables: (template.variables || []).join(', '),
    });
    const initialVars = {};
    for (const v of template.variables || []) initialVars[v] = '';
    setRenderVars(initialVars);
    setRendered('');
    setRenderUnresolved([]);
    setError('');
  }, []);

  const closeForm = useCallback(() => {
    setIsFormOpen(false);
    setEditingTemplate(null);
    setForm(EMPTY_FORM);
    setRenderVars({});
    setRendered('');
    setRenderUnresolved([]);
    setError('');
  }, []);

  const handleCopy = useCallback(async (template, textOverride) => {
    const text = textOverride || template.body;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(template._id);
      setTimeout(() => setCopiedId(null), 2000);
      trackTemplateUsage(template._id).catch(() => {});
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedId(template._id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        category: form.category.trim(),
        title: form.title.trim(),
        body: form.body,
        variables: form.variables
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      };
      if (editingTemplate) {
        await updateTemplate(editingTemplate._id, payload);
      } else {
        await createTemplate(payload);
      }
      await load();
      closeForm();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }, [form, editingTemplate, load, closeForm]);

  const confirmDeleteTemplate = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteTemplate(deleteTarget);
      await load();
      if (editingTemplate && editingTemplate._id === deleteTarget) closeForm();
    } catch (err) {
      setError(err.message);
    }
    setDeleteTarget(null);
  }, [deleteTarget, load, editingTemplate, closeForm]);

  const handleDuplicate = useCallback(async (templateId) => {
    try {
      await duplicateTemplate(templateId);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }, [load]);

  const handleRender = useCallback(async () => {
    if (!editingTemplate) return;
    try {
      const result = await renderTemplate(editingTemplate._id, renderVars);
      setRendered(result.rendered || '');
      setRenderUnresolved(result.unresolvedVars || []);
    } catch (err) {
      setError(err.message);
    }
  }, [editingTemplate, renderVars]);

  return (
    <div className="app-content-constrained">
      <div className="page-header">
        <h1 className="page-title">Response Templates</h1>
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
                    : 'Create your first template to speed up escalations.'}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--sp-5)' }}>
              {templates.map((tmpl) => (
                <div key={tmpl._id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 'var(--text-md)', marginBottom: 'var(--sp-1)' }}>
                        {tmpl.title}
                      </div>
                      <span className={`cat-badge cat-${tmpl.category || 'general'}`}>
                        {(tmpl.category || 'general').replace('-', ' ')}
                      </span>
                    </div>
                    <button
                      className={`copy-btn${copiedId === tmpl._id ? ' is-copied' : ''}`}
                      onClick={() => handleCopy(tmpl)}
                      type="button"
                    >
                      {copiedId === tmpl._id ? 'Copied' : 'Copy'}
                    </button>
                  </div>

                  <div style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--ink-secondary)',
                    whiteSpace: 'pre-wrap',
                    maxHeight: 160,
                    overflow: 'hidden',
                    lineHeight: 1.6,
                    background: 'var(--bg-sunken)',
                    padding: 'var(--sp-4)',
                    borderRadius: 'var(--radius-md)',
                  }}>
                    {tmpl.body}
                  </div>

                  <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEditForm(tmpl)} type="button">Edit</button>
                    <Tooltip text="Create a copy of this template" level="medium"><button className="btn btn-secondary btn-sm" onClick={() => handleDuplicate(tmpl._id)} type="button">Duplicate</button></Tooltip>
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setDeleteTarget(tmpl._id)} type="button">Delete</button>
                  </div>

                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                    Used {tmpl.usageCount || 0} time{(tmpl.usageCount || 0) !== 1 ? 's' : ''}
                    {tmpl.lastUsed && ` · Last: ${new Date(tmpl.lastUsed).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
                  </div>
                </div>
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
