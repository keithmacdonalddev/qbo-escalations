import { useState } from 'react';

export default function UnsavedTriageNotice({ text, error, onDismiss }) {
  const [feedback, setFeedback] = useState('');

  async function copyVisibleCard() {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback('Copied');
    } catch {
      setFeedback('Copy failed');
    }
  }

  function downloadVisibleCard() {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'unsaved-triage-card.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    setFeedback('Downloaded');
  }

  return (
    <section className="v5-triage-unsaved" aria-label="Triage card not saved">
      <div className="v5-triage-unsaved__copy">
        <strong>Not saved</strong>
        <span>{error || 'This triage card is only available on this screen.'}</span>
      </div>
      <div className="v5-triage-unsaved__actions">
        <button type="button" onClick={copyVisibleCard}>Copy</button>
        <button type="button" onClick={downloadVisibleCard}>Download</button>
        <button type="button" onClick={onDismiss}>Dismiss warning</button>
      </div>
      {feedback && <span className="v5-triage-unsaved__feedback" role="status">{feedback}</span>}
    </section>
  );
}
