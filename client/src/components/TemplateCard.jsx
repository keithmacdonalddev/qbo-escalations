import Tooltip from './Tooltip.jsx';

export default function TemplateCard({
  template,
  copied,
  onCopy,
  onEdit,
  onDuplicate,
  onDelete,
}) {
  const category = template.category || 'general';
  const usageCount = template.usageCount || 0;

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 'var(--text-md)', marginBottom: 'var(--sp-1)' }}>
            {template.title}
          </div>
          <span className={`cat-badge cat-${category}`}>
            {category.replace('-', ' ')}
          </span>
        </div>
        <button
          className={`copy-btn${copied ? ' is-copied' : ''}`}
          onClick={() => onCopy(template)}
          type="button"
        >
          {copied ? 'Copied' : 'Copy'}
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
        {template.body}
      </div>

      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => onEdit(template)} type="button">Edit</button>
        <Tooltip text="Create a copy of this template" level="medium">
          <button className="btn btn-secondary btn-sm" onClick={() => onDuplicate(template._id)} type="button">Duplicate</button>
        </Tooltip>
        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => onDelete(template._id)} type="button">Delete</button>
      </div>

      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
        Used {usageCount} time{usageCount !== 1 ? 's' : ''}
        {template.lastUsed && ` · Last: ${new Date(template.lastUsed).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
      </div>
    </div>
  );
}
