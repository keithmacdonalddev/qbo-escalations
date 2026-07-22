import { useState } from 'react';

export default function UnsavedResultNotice({
  text,
  error,
  onDismiss,
  resultLabel = 'triage card',
  downloadName = 'unsaved-triage-card.txt',
  ariaLabel = 'Triage card not saved',
}) {
  const [feedback, setFeedback] = useState('');

  async function copyVisibleResult() {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback('Copied');
    } catch {
      setFeedback('Copy failed');
    }
  }

  function downloadVisibleResult() {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    setFeedback('Downloaded');
  }

  function confirmDismissal() {
    const confirmed = window.confirm(
      `Dismiss this warning? Copy or download the ${resultLabel} first if you need to keep it.`,
    );
    if (confirmed) onDismiss?.();
  }

  return (
    <section className="v5-triage-unsaved" aria-label={ariaLabel}>
      <div className="v5-triage-unsaved__copy">
        <strong>Not saved</strong>
        <span>{error || `This ${resultLabel} is only available on this screen.`}</span>
      </div>
      <div className="v5-triage-unsaved__actions">
        <button type="button" onClick={copyVisibleResult}>Copy</button>
        <button type="button" onClick={downloadVisibleResult}>Download</button>
        <button type="button" onClick={confirmDismissal}>Dismiss warning</button>
      </div>
      {feedback && <span className="v5-triage-unsaved__feedback" role="status">{feedback}</span>}
    </section>
  );
}
