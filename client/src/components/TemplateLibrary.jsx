import { useState, useEffect, useCallback } from 'react';
import { listTemplates, trackTemplateUsage } from '../api/templatesApi.js';

const CATEGORY_FILTER_OPTIONS = [
  '', 'acknowledgment', 'follow-up', 'escalation-up',
  'payroll', 'bank-feeds', 'reconciliation', 'permissions',
  'billing', 'tax', 'invoicing', 'reporting', 'general',
];

export default function TemplateLibrary() {
  const [templates, setTemplates] = useState([]);
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listTemplates(category || undefined);
      setTemplates(list);
    } catch { /* graceful */ }
    setLoading(false);
  }, [category]);

  useEffect(() => { load(); }, [load]);

  const handleCopy = useCallback(async (template) => {
    try {
      await navigator.clipboard.writeText(template.body);
      setCopiedId(template._id);
      setTimeout(() => setCopiedId(null), 2000);
      trackTemplateUsage(template._id).catch(() => {});
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = template.body;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedId(template._id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }, []);

  return (
    <div className="app-content-constrained">
      <div className="page-header">
        <h1 className="page-title">Response Templates</h1>
      </div>

      {/* Category filter */}
      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-6)' }}>
        {CATEGORY_FILTER_OPTIONS.map(cat => (
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
                ? `No templates in the "${category.replace('-', ' ')}" category yet.`
                : 'Response templates will appear here when created. Templates help you respond to common escalation patterns faster.'}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--sp-5)' }}>
          {templates.map(tmpl => (
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

              {tmpl.variables && tmpl.variables.length > 0 && (
                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                  {tmpl.variables.map((v, i) => (
                    <span key={i} className="mono" style={{
                      fontSize: 'var(--text-xs)',
                      background: 'var(--accent-subtle)',
                      color: 'var(--accent)',
                      padding: '1px 6px',
                      borderRadius: 'var(--radius-sm)',
                    }}>
                      {`{${v}}`}
                    </span>
                  ))}
                </div>
              )}

              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', marginTop: 'auto' }}>
                Used {tmpl.usageCount || 0} time{(tmpl.usageCount || 0) !== 1 ? 's' : ''}
                {tmpl.lastUsed && ` · Last: ${new Date(tmpl.lastUsed).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
