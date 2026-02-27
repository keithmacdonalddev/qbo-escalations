import { useEffect, useRef, useCallback } from 'react';

/**
 * Confirmation modal for destructive actions.
 * Traps focus, closes on Escape, prevents accidental deletions.
 */
export default function ConfirmModal({ open, title, message, confirmLabel = 'Delete', danger = true, onConfirm, onCancel }) {
  const confirmRef = useRef(null);
  const overlayRef = useRef(null);

  // Focus confirm button when modal opens
  useEffect(() => {
    if (open) {
      confirmRef.current?.focus();
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  // Close on overlay click
  const handleOverlayClick = useCallback((e) => {
    if (e.target === overlayRef.current) onCancel();
  }, [onCancel]);

  if (!open) return null;

  return (
    <div className="modal-overlay" ref={overlayRef} onClick={handleOverlayClick} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal-title">{title}</div>
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--ink-secondary)', lineHeight: 1.5 }}>
          {message}
        </p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            ref={confirmRef}
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
