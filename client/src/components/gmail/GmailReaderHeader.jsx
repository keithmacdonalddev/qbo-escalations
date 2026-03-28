import { avatarColor, formatFullDate, getInitials } from '../../lib/gmail/gmailInboxHelpers.jsx';

function formatAttachmentSize(size) {
  if (size > 1048576) return `${(size / 1048576).toFixed(1)} MB`;
  if (size > 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

export default function GmailReaderHeader({ msg }) {
  if (!msg) return null;

  return (
    <>
      <h2 className="gmail-reader-subject">{msg.subject}</h2>
      <div className="gmail-reader-meta">
        <div className="gmail-reader-avatar" style={{ background: avatarColor(msg.fromEmail || msg.from) }}>
          {getInitials(msg.from)}
        </div>
        <div className="gmail-reader-meta-text">
          <div className="gmail-reader-from">
            <strong>{msg.from}</strong>
            {msg.fromEmail && <span className="gmail-reader-email">&lt;{msg.fromEmail}&gt;</span>}
          </div>
          <div className="gmail-reader-to">
            to {msg.to}
            {msg.cc && <span> cc {msg.cc}</span>}
          </div>
        </div>
        <div className="gmail-reader-date">{formatFullDate(msg.date)}</div>
      </div>

      {msg.attachments && msg.attachments.length > 0 && (
        <div className="gmail-reader-attachments">
          <div className="gmail-reader-attachments-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
            {msg.attachments.length} attachment{msg.attachments.length !== 1 ? 's' : ''}
          </div>
          <div className="gmail-reader-attachment-list">
            {msg.attachments.map((att, i) => (
              <div key={i} className="gmail-reader-attachment-chip">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span>{att.filename}</span>
                <span className="gmail-reader-attachment-size">{formatAttachmentSize(att.size || 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
