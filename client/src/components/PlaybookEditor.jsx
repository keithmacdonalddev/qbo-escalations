import { useState, useEffect, useCallback } from 'react';
import { listCategories, getCategoryContent } from '../api/playbookApi.js';

const CAT_BADGE_MAP = {
  'payroll': 'cat-payroll',
  'bank-feeds': 'cat-bank-feeds',
  'reconciliation': 'cat-reconciliation',
  'permissions': 'cat-permissions',
  'billing': 'cat-billing',
  'tax': 'cat-tax',
  'invoicing': 'cat-invoicing',
  'reporting': 'cat-reporting',
  'general': 'cat-general',
};

export default function PlaybookEditor() {
  const [categories, setCategories] = useState([]);
  const [selectedCat, setSelectedCat] = useState(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const cats = await listCategories();
        setCategories(cats);
      } catch { /* graceful */ }
      setLoading(false);
    })();
  }, []);

  const handleSelect = useCallback(async (name) => {
    setSelectedCat(name);
    setContentLoading(true);
    try {
      const text = await getCategoryContent(name);
      setContent(text);
    } catch {
      setContent('Failed to load content.');
    }
    setContentLoading(false);
  }, []);

  return (
    <div className="app-content-constrained">
      <div className="page-header">
        <h1 className="page-title">Playbook</h1>
        <span className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
          These categories feed Claude's system prompt for escalation context.
        </span>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--sp-10)' }}>
          <span className="spinner" />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 'var(--sp-6)' }}>
          {/* Category list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {categories.map(cat => (
              <button
                key={cat.name}
                className={`card card-compact card-clickable${selectedCat === cat.name ? ' is-selected' : ''}`}
                onClick={() => handleSelect(cat.name)}
                type="button"
                style={{
                  textAlign: 'left',
                  cursor: 'pointer',
                  border: selectedCat === cat.name ? '1px solid var(--accent)' : undefined,
                  background: selectedCat === cat.name ? 'var(--accent-subtle)' : undefined,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className={`cat-badge ${CAT_BADGE_MAP[cat.name] || 'cat-general'}`}>
                    {cat.name.replace(/-/g, ' ')}
                  </span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                    {formatSize(cat.size)}
                  </span>
                </div>
              </button>
            ))}

            {categories.length === 0 && (
              <div className="text-secondary" style={{ fontSize: 'var(--text-sm)', padding: 'var(--sp-4)' }}>
                No playbook categories found. Add .md files to the playbook/categories/ directory.
              </div>
            )}
          </div>

          {/* Content viewer */}
          <div className="card" style={{ minHeight: 400 }}>
            {!selectedCat ? (
              <div className="empty-state">
                <div className="empty-state-title">Select a Category</div>
                <div className="empty-state-desc">
                  Click a category on the left to view its playbook content. This content is included in Claude's system prompt to provide QBO-specific expertise.
                </div>
              </div>
            ) : contentLoading ? (
              <div style={{ textAlign: 'center', padding: 'var(--sp-10)' }}>
                <span className="spinner" />
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-5)' }}>
                  <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, textTransform: 'capitalize' }}>
                    {selectedCat.replace(/-/g, ' ')}
                  </h2>
                  <CopyButton text={content} />
                </div>
                <div className="playbook-content" style={{
                  background: 'var(--bg-sunken)',
                  padding: 'var(--sp-6)',
                  borderRadius: 'var(--radius-md)',
                  maxHeight: 'calc(100vh - 300px)',
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  fontSize: 'var(--text-sm)',
                  lineHeight: 1.7,
                }}>
                  {content}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
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
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }, [text]);

  return (
    <button
      className={`copy-btn${copied ? ' is-copied' : ''}`}
      onClick={handleCopy}
      type="button"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
