import { useState } from 'react';
import { motion } from 'framer-motion';

export default function GmailComposeDraft({
  apiFetch,
  onClose,
  onSaved,
  onSent,
  initialTo,
  initialSubject,
  initialBody,
  initialCc,
  initialBcc,
  threadId,
  inReplyTo,
  references,
  mode,
  activeAccount,
}) {
  const [to, setTo] = useState(initialTo || '');
  const [cc, setCc] = useState(initialCc || '');
  const [bcc, setBcc] = useState(initialBcc || '');
  const [showCc, setShowCc] = useState(!!(initialCc));
  const [showBcc, setShowBcc] = useState(!!(initialBcc));
  const [subject, setSubject] = useState(initialSubject || '');
  const [body, setBody] = useState(initialBody || '');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const titleText = mode === 'reply' ? 'Reply' : mode === 'forward' ? 'Forward' : 'New Message';

  const handleSave = async () => {
    if (!to.trim()) { setError('"To" field is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const result = await apiFetch('/drafts', {
        method: 'POST',
        body: JSON.stringify({
          to: to.trim(),
          subject: subject.trim(),
          body,
          cc: cc.trim() || undefined,
          bcc: bcc.trim() || undefined,
        }),
      }, activeAccount || undefined);
      if (!result.ok) {
        setError(result.error || 'Failed to save draft');
      } else {
        setSuccessMsg('Draft saved!');
        onSaved?.();
        setTimeout(onClose, 1200);
      }
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    if (!to.trim()) { setError('"To" field is required'); return; }
    setSending(true);
    setError(null);
    try {
      const result = await apiFetch('/messages/send', {
        method: 'POST',
        body: JSON.stringify({
          to: to.trim(),
          cc: cc.trim() || undefined,
          bcc: bcc.trim() || undefined,
          subject: subject.trim(),
          body,
          threadId: threadId || undefined,
          inReplyTo: inReplyTo || undefined,
          references: references || undefined,
        }),
      }, activeAccount || undefined);
      if (!result.ok) {
        setError(result.error || 'Failed to send');
      } else {
        setSuccessMsg('Sent!');
        onSent?.();
        setTimeout(onClose, 1000);
      }
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setSending(false);
    }
  };

  return (
    <motion.div className="gmail-compose-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="gmail-compose"
        initial={{ opacity: 0, y: 40, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 40, scale: 0.96 }}
        transition={{ duration: 0.2 }}
      >
        <div className="gmail-compose-header">
          <h3>{titleText}</h3>
          <button className="gmail-btn-icon" onClick={onClose} type="button" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="gmail-compose-body">
          <div className="gmail-compose-field">
            <label>To</label>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com"
              autoFocus
            />
            <div className="gmail-compose-field-toggles">
              {!showCc && <button className="gmail-compose-cc-toggle" onClick={() => setShowCc(true)} type="button">Cc</button>}
              {!showBcc && <button className="gmail-compose-cc-toggle" onClick={() => setShowBcc(true)} type="button">Bcc</button>}
            </div>
          </div>
          {showCc && (
            <div className="gmail-compose-field">
              <label>Cc</label>
              <input
                type="text"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="cc@example.com"
              />
            </div>
          )}
          {showBcc && (
            <div className="gmail-compose-field">
              <label>Bcc</label>
              <input
                type="text"
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                placeholder="bcc@example.com"
              />
            </div>
          )}
          <div className="gmail-compose-field">
            <label>Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
            />
          </div>
          <textarea
            className="gmail-compose-textarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message..."
            rows={10}
          />
        </div>
        <div className="gmail-compose-footer">
          {error && <span className="gmail-compose-error">{error}</span>}
          {successMsg && <span className="gmail-compose-success">{successMsg}</span>}
          <div className="gmail-compose-actions">
            <button className="gmail-btn" onClick={onClose} type="button">Cancel</button>
            <button className="gmail-btn gmail-btn-secondary" onClick={handleSave} disabled={saving || sending} type="button">
              {saving ? 'Saving...' : 'Save Draft'}
            </button>
            <button className="gmail-btn gmail-btn-send" onClick={handleSend} disabled={sending || saving} type="button">
              {sending ? (
                <><div className="gmail-spinner gmail-spinner-sm" /> Sending...</>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                  Send
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
