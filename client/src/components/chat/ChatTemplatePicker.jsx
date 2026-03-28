import { AnimatePresence, motion } from 'framer-motion';
import { fade, transitions } from '../../utils/motion.js';

const TEMPLATE_CATEGORIES = [
  '',
  'acknowledgment',
  'follow-up',
  'escalation-up',
  'payroll',
  'bank-feeds',
  'reconciliation',
  'general',
];

export default function ChatTemplatePicker({
  showTemplatePicker,
  templateCategory,
  loadingTemplates,
  templates,
  onClose,
  onCategoryChange,
  onInsert,
}) {
  return (
    <AnimatePresence>
      {showTemplatePicker && (
        <motion.div
          key="template-overlay"
          className="modal-overlay"
          onClick={onClose}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
          tabIndex={0}
          role="dialog"
          aria-modal="true"
          {...fade}
          transition={transitions.fast}
        >
          <motion.div
            className="card"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={transitions.emphasis}
            style={{
              width: 'min(600px, 90vw)',
              maxHeight: '70vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-4)' }}>
              <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Insert Template</h2>
              <button
                className="btn btn-ghost btn-sm"
                onClick={onClose}
                type="button"
              >
                Close
              </button>
            </div>

            <div style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap', marginBottom: 'var(--sp-4)' }}>
              {TEMPLATE_CATEGORIES.map((cat) => (
                <button
                  key={cat || 'all'}
                  className={`btn btn-sm ${templateCategory === cat ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => onCategoryChange(cat)}
                  type="button"
                  style={{ fontSize: 'var(--text-xs)' }}
                >
                  {cat ? cat.replace('-', ' ') : 'All'}
                </button>
              ))}
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {loadingTemplates ? (
                <div style={{ textAlign: 'center', padding: 'var(--sp-6)' }}>
                  <span className="spinner spinner-sm" />
                </div>
              ) : templates.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 'var(--sp-6)', color: 'var(--ink-secondary)' }}>
                  No templates found.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                  {templates.map((template) => (
                    <button
                      key={template._id}
                      onClick={() => onInsert(template)}
                      type="button"
                      style={{
                        textAlign: 'left',
                        padding: 'var(--sp-3) var(--sp-4)',
                        background: 'var(--bg-sunken)',
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        transition: 'border-color 140ms ease',
                      }}
                      onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                      onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-1)' }}>
                        <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{template.title}</span>
                        <span className={`cat-badge cat-${template.category || 'general'}`} style={{ fontSize: 'var(--text-xs)' }}>
                          {(template.category || 'general').replace('-', ' ')}
                        </span>
                      </div>
                      <div style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--ink-secondary)',
                        whiteSpace: 'pre-wrap',
                        maxHeight: 60,
                        overflow: 'hidden',
                        lineHeight: 1.5,
                      }}>
                        {template.body}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
