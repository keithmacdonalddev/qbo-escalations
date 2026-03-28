import { getAccountColor, getInitials, avatarColor } from '../../lib/gmail/gmailInboxHelpers.jsx';
import { formatDateRelative as formatDate } from '../../utils/dateFormatting.js';

export default function GmailMessageRow({
  msg,
  onClick,
  selected,
  onSelect,
  focused,
  onArchive,
  onTrash,
  onToggleStar,
  onToggleRead,
  onContextMenu,
  density,
  isUnifiedMode,
}) {
  const hasAttachment = msg.hasAttachments || (msg.attachments && msg.attachments.length > 0);

  return (
    <div
      className={`gmail-msg-row${msg.isUnread ? ' is-unread' : ''}${selected ? ' is-selected' : ''}${focused ? ' is-focused' : ''}`}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(e, msg);
      }}
    >
      <label className="gmail-select-checkbox" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={!!selected}
          onChange={(e) => onSelect?.(msg.id, e.target.checked)}
        />
        <span className="gmail-select-checkmark" />
      </label>
      <button
        className="gmail-msg-row-inner"
        onClick={() => onClick?.(msg.id)}
        type="button"
      >
        <div className="gmail-msg-avatar" style={{ background: avatarColor(msg.fromEmail || msg.from) }}>
          {getInitials(msg.from)}
        </div>
        <div className="gmail-msg-content">
          <div className="gmail-msg-top">
            {isUnifiedMode && msg.account && (
              <span
                className="gmail-unified-account-dot"
                style={{ background: getAccountColor(msg.account) }}
                title={msg.account}
              />
            )}
            <span className="gmail-msg-from">{msg.from || '(unknown)'}</span>
            {isUnifiedMode && msg.account && (
              <span className="gmail-unified-account-label" style={{ color: getAccountColor(msg.account) }}>
                {msg.account}
              </span>
            )}
            <span className="gmail-msg-date-area">
              {hasAttachment && (
                <svg className="gmail-msg-attachment-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                </svg>
              )}
              <span className="gmail-msg-date">{formatDate(msg.date)}</span>
            </span>
          </div>
          <div className="gmail-msg-subject">{msg.subject}</div>
          {density !== 'compact' && <div className="gmail-msg-snippet">{msg.snippet}</div>}
        </div>
        {msg.isStarred && (
          <svg className="gmail-msg-star" width="14" height="14" viewBox="0 0 24 24" fill="var(--warning)" stroke="var(--warning)" strokeWidth="1.5">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        )}
      </button>
      <div className="gmail-msg-hover-actions" onClick={(e) => e.stopPropagation()}>
        <button className="gmail-hover-btn" onClick={() => onArchive?.(msg.id)} type="button" title="Archive" aria-label="Archive">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
          </svg>
        </button>
        <button className="gmail-hover-btn" onClick={() => onTrash?.(msg.id)} type="button" title="Trash" aria-label="Trash">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>
        <button className="gmail-hover-btn" onClick={() => onToggleRead?.(msg)} type="button" title={msg.isUnread ? 'Mark read' : 'Mark unread'} aria-label={msg.isUnread ? 'Mark read' : 'Mark unread'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 7l10 6 10-6" />
          </svg>
        </button>
        <button className="gmail-hover-btn" onClick={() => onToggleStar?.(msg)} type="button" title={msg.isStarred ? 'Unstar' : 'Star'} aria-label={msg.isStarred ? 'Unstar' : 'Star'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill={msg.isStarred ? 'var(--warning)' : 'none'} stroke={msg.isStarred ? 'var(--warning)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
