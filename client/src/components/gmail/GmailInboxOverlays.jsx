import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

export function KeyboardShortcutHelp({ onClose }) {
  const shortcuts = [
    { key: 'j / \u2193', desc: 'Next message' },
    { key: 'k / \u2191', desc: 'Previous message' },
    { key: 'Enter / o', desc: 'Open message' },
    { key: 'e', desc: 'Archive' },
    { key: '#', desc: 'Trash' },
    { key: 's', desc: 'Toggle star' },
    { key: 'r', desc: 'Reply' },
    { key: 'f', desc: 'Forward' },
    { key: 'c', desc: 'Compose' },
    { key: 'Esc', desc: 'Back / Close / Deselect' },
    { key: '/', desc: 'Focus search' },
    { key: '?', desc: 'This help' },
  ];

  return (
    <motion.div className="gmail-compose-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="gmail-shortcut-modal"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gmail-shortcut-header">
          <h3>Keyboard Shortcuts</h3>
          <button className="gmail-btn-icon" onClick={onClose} type="button" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="gmail-shortcut-grid">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.key} className="gmail-shortcut-row">
              <kbd className="gmail-shortcut-key">{shortcut.key}</kbd>
              <span className="gmail-shortcut-desc">{shortcut.desc}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

export function MessageContextMenu({ x, y, msg, onClose, onOpen, onReply, onForward, onArchive, onTrash, onToggleStar, onToggleRead }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) onClose();
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const style = { position: 'fixed', top: y, left: x, zIndex: 5000 };

  const items = [
    { label: 'Open', action: () => onOpen?.(msg.id) },
    { label: 'Reply', action: () => onReply?.(msg) },
    { label: 'Forward', action: () => onForward?.(msg) },
    { divider: true },
    { label: 'Archive', action: () => onArchive?.(msg.id) },
    { label: msg.isStarred ? 'Unstar' : 'Star', action: () => onToggleStar?.(msg) },
    { label: msg.isUnread ? 'Mark as read' : 'Mark as unread', action: () => onToggleRead?.(msg) },
    { label: 'Trash', action: () => onTrash?.(msg.id), danger: true },
    { divider: true },
    { label: 'Copy subject', action: () => { navigator.clipboard?.writeText(msg.subject || '').catch(() => {}); } },
    { label: 'Copy sender email', action: () => { navigator.clipboard?.writeText(msg.fromEmail || msg.from || '').catch(() => {}); } },
  ];

  return (
    <div ref={menuRef} className="gmail-context-menu" style={style}>
      {items.map((item, index) =>
        item.divider ? (
          <div key={`d${index}`} className="gmail-context-divider" />
        ) : (
          <button
            key={item.label}
            className={`gmail-context-item${item.danger ? ' gmail-context-item-danger' : ''}`}
            onClick={() => { item.action(); onClose(); }}
            type="button"
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}

export function SnoozeDropdown({ onSnooze, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const handle = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onClose();
    };

    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  const presets = [
    { label: 'Later today', time: 'today, 6:00 PM' },
    { label: 'Tomorrow', time: 'tomorrow, 8:00 AM' },
    { label: 'Next week', time: 'next Monday, 8:00 AM' },
  ];

  return (
    <div ref={ref} className="gmail-snooze-dropdown">
      <div className="gmail-snooze-title">Snooze until...</div>
      {presets.map((preset) => (
        <button
          key={preset.label}
          className="gmail-snooze-option"
          onClick={() => { onSnooze(preset.label, preset.time); onClose(); }}
          type="button"
        >
          <span>{preset.label}</span>
          <span className="gmail-snooze-time">{preset.time}</span>
        </button>
      ))}
    </div>
  );
}
