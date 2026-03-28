import { useCallback, useState } from 'react';

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

function formatTs(ts) {
  return new Date(typeof ts === 'string' ? parseInt(ts, 10) : ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export default function PlaybookPanel({
  heading,
  viewMode,
  selectedCategory,
  content,
  draftContent,
  contentLoading,
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
  canHaveHistory,
  hasUnsavedChanges,
  onDraftContentChange,
  onSaveLabelChange,
  onStartEdit,
  onCancelEdit,
  onRequestSave,
  onBackToEdit,
  onConfirmSave,
  onToggleHistory,
  onPreviewVersion,
  onRestoreVersion,
  onClosePreview,
  onDeleteCategoryRequest,
}) {
  return (
    <div className="card" style={{ minHeight: 440 }}>
      {contentLoading ? (
        <div style={{ textAlign: 'center', padding: 'var(--sp-10)' }}>
          <span className="spinner" />
        </div>
      ) : (
        <div>
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

              {showDiff ? (
                <>
                  <button className="btn btn-secondary btn-sm" onClick={onBackToEdit} type="button">
                    Back to Edit
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={onConfirmSave}
                    disabled={saving || !hasDiffChanges}
                    type="button"
                  >
                    {saving ? 'Saving...' : 'Confirm Save'}
                  </button>
                </>
              ) : (
                <>
                  {viewMode === 'category' && selectedCategory && !isEditing && !showHistory && (
                    <button className="btn btn-ghost btn-sm" onClick={onDeleteCategoryRequest} type="button" style={{ color: 'var(--danger)' }}>
                      Delete Category
                    </button>
                  )}
                  {canHaveHistory && !isEditing && (
                    <button
                      className={`btn btn-sm ${showHistory ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={onToggleHistory}
                      type="button"
                    >
                      {showHistory ? 'Close History' : 'History'}
                    </button>
                  )}
                  {viewMode !== 'full' && !showHistory && (isEditing ? (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={onCancelEdit} type="button">Cancel</button>
                      <button className="btn btn-primary btn-sm" onClick={onRequestSave} disabled={saving || !hasUnsavedChanges} type="button">
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                    </>
                  ) : (
                    canHaveHistory && (
                      <button className="btn btn-secondary btn-sm" onClick={onStartEdit} type="button">Edit</button>
                    )
                  ))}
                  {!showHistory && <CopyButton text={content} />}
                </>
              )}
            </div>
          </div>

          {showDiff ? (
            <DiffPanel diffLines={diffLines} hasDiffChanges={hasDiffChanges} saveLabel={saveLabel} onSaveLabelChange={onSaveLabelChange} />
          ) : showHistory ? (
            <HistoryPanel
              versions={versions}
              loading={historyLoading}
              previewVersion={previewVersion}
              onPreview={onPreviewVersion}
              onRestore={onRestoreVersion}
              onClosePreview={onClosePreview}
            />
          ) : isEditing ? (
            <textarea
              value={draftContent}
              onChange={(e) => onDraftContentChange(e.target.value)}
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
  );
}

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
          let bg;
          let color;
          let prefix;
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

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [text]);

  return (
    <button className={`copy-btn${copied ? ' is-copied' : ''}`} onClick={handleCopy} type="button">
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
