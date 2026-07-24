import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSubmissionId,
  loadReportingBootstrap,
  submitUserReport,
} from '../../api/ticketSnitchReporting.js';
import {
  captureScreenFrame,
  screenCaptureSupported,
  validateScreenshotFile,
} from './screenshotCapture.js';
import './UserReportDialog.css';

const REPORT_CHOICES = [
  {
    value: 'problem',
    tagline: 'Found a bug?',
    label: 'Report a Problem',
    titlePlaceholder: 'Example: Escalation notes do not save',
    explanationLabel: 'What happened?',
    explanationPlaceholder: 'Describe what happened, what you expected, and any steps that help us reproduce it.',
  },
  {
    value: 'feature',
    tagline: 'Have an idea?',
    label: 'Request a Feature',
    titlePlaceholder: 'Example: Add a faster review shortcut',
    explanationLabel: 'What would help?',
    explanationPlaceholder: 'Describe the capability you need and why it would make the app more useful.',
  },
  {
    value: 'feedback',
    tagline: 'Want to chat?',
    label: 'Submit Feedback',
    titlePlaceholder: 'Example: Make filters easier to scan',
    explanationLabel: 'What should we improve?',
    explanationPlaceholder: 'Share your observation and what would make the experience better.',
  },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function initialDraft() {
  return {
    kind: '',
    title: '',
    explanation: '',
    reporterName: '',
    reporterEmail: '',
    submissionId: createSubmissionId(),
    observedAt: new Date().toISOString(),
  };
}

function reportErrorMessage(error) {
  if (error?.status === 401 || error?.status === 403) {
    return 'This QBO Escalations installation is not permitted to submit reports. Your draft is still here.';
  }
  return error?.message || 'The report could not be sent. Your draft is still here.';
}

function fileSizeLabel(size) {
  if (size < 1024) return `${size} bytes`;
  return `${Math.ceil(size / 1024)} KB`;
}

export default function UserReportDialog({ open, onClose, errorCode = '' }) {
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const screenshotInputRef = useRef(null);
  const priorFocusRef = useRef(null);
  const [draft, setDraft] = useState(initialDraft);
  const [bootstrap, setBootstrap] = useState({ state: 'idle', token: '', reporterScope: '', requestId: '', reason: '', screenshotAvailable: false, dataUseUrl: '' });
  const [submitState, setSubmitState] = useState({ state: 'idle', ticket: null, replay: false, message: '', requestId: '' });
  const [errors, setErrors] = useState({});
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState('');
  const [captureState, setCaptureState] = useState({ state: 'idle', message: '' });

  const loadAvailability = useCallback(async () => {
    setBootstrap({ state: 'loading', token: '', reporterScope: '', requestId: '', reason: '', screenshotAvailable: false, dataUseUrl: '' });
    try {
      const result = await loadReportingBootstrap();
      setBootstrap({
        state: result.available ? 'ready' : 'unavailable',
        token: result.reportToken || '',
        reporterScope: result.reporterScope || '',
        requestId: result.requestId || '',
        reason: result.unavailableReason || '',
        screenshotAvailable: result.screenshotAvailable !== false,
        dataUseUrl: result.dataUseUrl || '',
      });
    } catch (error) {
      setBootstrap({
        state: error?.status === 401 || error?.status === 403 ? 'denied' : 'error',
        token: '',
        reporterScope: '',
        requestId: error?.requestId || '',
        reason: reportErrorMessage(error),
        screenshotAvailable: false,
        dataUseUrl: '',
      });
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    priorFocusRef.current = document.activeElement;
    loadAvailability();
    const frame = requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      priorFocusRef.current?.focus?.();
    };
  }, [loadAvailability, open]);


  useEffect(() => {
    if (open && bootstrap.state === 'ready') titleRef.current?.focus();
  }, [bootstrap.state, open]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!screenshot) {
      setScreenshotPreview('');
      return undefined;
    }
    if (typeof URL?.createObjectURL !== 'function') return undefined;
    const url = URL.createObjectURL(screenshot);
    setScreenshotPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && submitState.state !== 'submitting') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open, submitState.state]);

  if (!open) return null;

  const updateDraft = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: '' }));
    if (submitState.state === 'error') setSubmitState({ state: 'idle', ticket: null, replay: false, message: '', requestId: '' });
  };

  const chooseReportKind = (kind) => {
    updateDraft('kind', kind);
    requestAnimationFrame(() => titleRef.current?.focus());
  };

  const chooseScreenshot = (file) => {
    try {
      setScreenshot(validateScreenshotFile(file));
      setCaptureState({ state: 'ready', message: 'Screenshot ready. Review it before sending.' });
      if (screenshotInputRef.current) screenshotInputRef.current.value = '';
    } catch (error) {
      setCaptureState({ state: 'error', message: error.message });
    }
  };

  const handleCapture = async () => {
    setCaptureState({ state: 'capturing', message: 'Choose the tab, window, or screen you want to share.' });
    try {
      chooseScreenshot(await captureScreenFrame());
    } catch (error) {
      setCaptureState({
        state: error?.code === 'SCREENSHOT_CAPTURE_CANCELLED' ? 'notice' : 'error',
        message: error?.message || 'The screenshot could not be captured.',
      });
    }
  };

  const validate = () => {
    const next = {};
    const cleanTitle = draft.title.trim();
    const cleanExplanation = draft.explanation.trim();
    if (cleanTitle.length < 3) next.title = 'Enter at least 3 characters.';
    else if (cleanTitle.length > 240) next.title = 'Use 240 characters or fewer.';
    if (cleanExplanation.length < 10) next.explanation = 'Enter at least 10 characters so the team can understand the report.';
    else if (cleanExplanation.length > 40_000) next.explanation = 'Use 40,000 characters or fewer.';
    const cleanReporterName = draft.reporterName.trim();
    const cleanReporterEmail = draft.reporterEmail.trim();
    if (cleanReporterName && cleanReporterName.length < 2) next.reporterName = 'Enter at least 2 characters, or leave this blank.';
    else if (cleanReporterName.length > 120) next.reporterName = 'Use 120 characters or fewer.';
    if (cleanReporterEmail.length > 320) next.reporterEmail = 'Use 320 characters or fewer.';
    else if (cleanReporterEmail && !EMAIL_PATTERN.test(cleanReporterEmail)) next.reporterEmail = 'Enter a valid email address, or leave this blank.';
    setErrors(next);
    if (next.title) titleRef.current?.focus();
    else if (next.explanation) dialogRef.current?.querySelector('#user-report-explanation')?.focus();
    else if (next.reporterName) dialogRef.current?.querySelector('#user-report-name')?.focus();
    else if (next.reporterEmail) dialogRef.current?.querySelector('#user-report-email')?.focus();
    return Object.keys(next).length === 0;
  };

  const sendDraft = async ({ retryEvidence = false } = {}) => {
    if (!retryEvidence && !validate()) return;
    if (!online) {
      setSubmitState((current) => ({
        state: retryEvidence ? 'partial' : 'error',
        ticket: retryEvidence ? current.ticket : null,
        replay: retryEvidence ? current.replay : false,
        message: 'You are offline. Your draft and screenshot are still here; try again after the connection returns.',
        requestId: '',
      }));
      return;
    }
    setSubmitState((current) => ({
      state: retryEvidence ? 'retrying' : 'submitting',
      ticket: retryEvidence ? current.ticket : null,
      replay: retryEvidence ? current.replay : false,
      message: '',
      requestId: '',
    }));
    try {
      const result = await submitUserReport({
        reportToken: bootstrap.token,
        submissionId: draft.submissionId,
        observedAt: draft.observedAt,
        kind: draft.kind,
        title: draft.title.trim(),
        explanation: draft.explanation.trim(),
        reporterName: draft.reporterName.trim(),
        reporterEmail: draft.reporterEmail.trim(),
        errorCode,
        screenshot,
      });
      if (result.evidence?.status === 'failed') {
        setSubmitState({
          state: 'partial',
          ticket: result.ticket,
          replay: Boolean(result.idempotentReplay),
          message: result.evidence.message || 'The report was received, but its screenshot could not be attached.',
          requestId: result.evidence.requestId || result.requestId || '',
        });
        return;
      }
      setSubmitState({
        state: 'success',
        ticket: result.ticket,
        replay: Boolean(result.idempotentReplay),
        message: '',
        requestId: result.requestId || '',
        evidenceAttached: result.evidence?.status === 'attached',
      });
    } catch (error) {
      setSubmitState((current) => ({
        state: retryEvidence ? 'partial' : 'error',
        ticket: retryEvidence ? current.ticket : null,
        replay: retryEvidence ? current.replay : false,
        message: reportErrorMessage(error),
        requestId: error?.requestId || '',
      }));
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    await sendDraft();
  };

  const startAnother = () => {
    setDraft(initialDraft());
    setErrors({});
    setSubmitState({ state: 'idle', ticket: null, replay: false, message: '', requestId: '' });
    setScreenshot(null);
    setCaptureState({ state: 'idle', message: '' });
    loadAvailability();
    requestAnimationFrame(() => titleRef.current?.focus());
  };

  const busy = bootstrap.state === 'loading' || submitState.state === 'submitting' || submitState.state === 'retrying' || captureState.state === 'capturing';
  const canSubmit = bootstrap.state === 'ready' && online && !busy;
  const selectedChoice = REPORT_CHOICES.find((choice) => choice.value === draft.kind);

  return (
    <div
      className="user-report-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="user-report-dialog"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-report-title"
        aria-describedby="user-report-intro"
      >
        <header className="user-report-header">
          <div>
            <h2 id="user-report-title">Send feedback</h2>
            <p id="user-report-intro">Tell us what happened or what would make QBO Escalations better.</p>
          </div>
          <button type="button" className="user-report-close" onClick={onClose} disabled={busy} aria-label="Close reporting form">×</button>
        </header>

        {bootstrap.state === 'loading' ? (
          <div className="user-report-state" role="status" aria-live="polite">Checking reporting availability…</div>
        ) : bootstrap.state === 'unavailable' ? (
          <div className="user-report-state is-warning" role="status">
            <strong>Reporting is not connected on this server.</strong>
            <span>Your draft does not need a Ticket Snitch account. The server administrator needs to finish the private connection.</span>
          </div>
        ) : bootstrap.state === 'denied' ? (
          <div className="user-report-state is-error" role="alert">
            <strong>This installation cannot accept reports.</strong>
            <span>{bootstrap.reason}</span>
            {bootstrap.requestId ? <small>Request ID: {bootstrap.requestId}</small> : null}
          </div>
        ) : bootstrap.state === 'error' ? (
          <div className="user-report-state is-error" role="alert">
            <strong>Reporting could not be checked.</strong>
            <span>{bootstrap.reason}</span>
            {bootstrap.requestId ? <small>Request ID: {bootstrap.requestId}</small> : null}
            <button type="button" className="user-report-secondary" onClick={loadAvailability}>Try again</button>
          </div>
        ) : submitState.state === 'partial' || submitState.state === 'retrying' ? (
          <div className="user-report-success is-partial" role="alert" aria-live="assertive">
            <span className="user-report-success-mark" aria-hidden="true">!</span>
            <h3>Report received; screenshot needs another try</h3>
            <p>Ticket Snitch case <strong>{submitState.ticket?.key || 'created'}</strong> is safe. Retrying will not create a duplicate case.</p>
            <p>{submitState.message || 'The screenshot has not been attached yet.'}</p>
            {submitState.requestId ? <small>Request ID: {submitState.requestId}</small> : null}
            {!online ? <p className="user-report-replay">You are offline. The screenshot is still in this form.</p> : null}
            <div className="user-report-actions">
              <button type="button" className="user-report-secondary" onClick={onClose} disabled={busy}>Close</button>
              <button type="button" className="user-report-primary" onClick={() => sendDraft({ retryEvidence: true })} disabled={!online || busy || !screenshot}>
                {submitState.state === 'retrying' ? 'Retrying screenshot…' : 'Retry screenshot'}
              </button>
            </div>
          </div>
        ) : submitState.state === 'success' ? (
          <div className="user-report-success" role="status" aria-live="polite">
            <span className="user-report-success-mark" aria-hidden="true">✓</span>
            <h3>Report received</h3>
            <p>Ticket Snitch case <strong>{submitState.ticket?.key || 'created'}</strong> is ready for human review.</p>
            {submitState.evidenceAttached ? <p className="user-report-replay">Your approved screenshot is attached as case evidence.</p> : null}
            {submitState.replay ? <p className="user-report-replay">This report was already received. No duplicate was created.</p> : null}
            <p className="user-report-next">The team can now review, prioritize, assign, act on, verify, and close it.</p>
            <div className="user-report-actions">
              <button type="button" className="user-report-secondary" onClick={onClose}>Close</button>
              <button type="button" className="user-report-primary" onClick={startAnother}>Send another</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <fieldset className="user-report-types">
              <legend>Type</legend>
              <div className="user-report-type-grid" role="radiogroup" aria-label="Report type">
                {REPORT_CHOICES.map((choice) => (
                  <label key={choice.value} className={`user-report-type${draft.kind === choice.value ? ' is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="report-kind"
                      value={choice.value}
                      aria-label={choice.label}
                      aria-describedby={`user-report-type-tagline-${choice.value}`}
                      checked={draft.kind === choice.value}
                      onChange={() => chooseReportKind(choice.value)}
                    />
                    <span id={`user-report-type-tagline-${choice.value}`} className="user-report-type-tagline">{choice.tagline}</span>
                    <strong className="user-report-type-label">{choice.label}</strong>
                  </label>
                ))}
              </div>
            </fieldset>

            {selectedChoice ? (
              <div className="user-report-form-details" key={selectedChoice.value}>
            <div className="user-report-field">
              <div className="user-report-field-heading">
                <label htmlFor="user-report-summary">Short title</label>
                <small id="user-report-summary-help">Make it easy to recognize in a work queue.</small>
              </div>
              <input
                ref={titleRef}
                id="user-report-summary"
                value={draft.title}
                onChange={(event) => updateDraft('title', event.target.value)}
                maxLength={240}
                aria-invalid={Boolean(errors.title)}
                aria-describedby={errors.title ? 'user-report-summary-error' : 'user-report-summary-help'}
                placeholder={selectedChoice.titlePlaceholder}
              />
              {errors.title ? <span id="user-report-summary-error" className="user-report-field-error" role="alert">{errors.title}</span> : null}
            </div>

            <div className="user-report-field">
              <div className="user-report-field-heading">
                <label htmlFor="user-report-explanation">{selectedChoice.explanationLabel}</label>
                <small id="user-report-explanation-help">Do not include passwords, payment information, access tokens, or customer secrets.</small>
              </div>
              <textarea
                id="user-report-explanation"
                value={draft.explanation}
                onChange={(event) => updateDraft('explanation', event.target.value)}
                rows={6}
                maxLength={40_000}
                aria-invalid={Boolean(errors.explanation)}
                aria-describedby={errors.explanation ? 'user-report-explanation-error' : 'user-report-explanation-help'}
                placeholder={selectedChoice.explanationPlaceholder}
              />
              {errors.explanation ? <span id="user-report-explanation-error" className="user-report-field-error" role="alert">{errors.explanation}</span> : null}
            </div>

            <section
              className="user-report-screenshot"
              aria-labelledby="user-report-screenshot-title"
            >
              <div className="user-report-screenshot-heading">
                <h3 id="user-report-screenshot-title">Add a screenshot <small>Optional</small></h3>
                <p>A screenshot helps us understand your report and respond more effectively.</p>
              </div>
              {bootstrap.screenshotAvailable ? (
                <>
                  <input
                    ref={screenshotInputRef}
                    className="user-report-file-input"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-label="Add screenshot image"
                    onChange={(event) => chooseScreenshot(event.target.files?.[0])}
                  />
                  {screenshot ? (
                    <div className="user-report-screenshot-preview">
                      {screenshotPreview ? <img src={screenshotPreview} alt="Screenshot preview for this report" /> : null}
                      <div>
                        <strong>{screenshot.name}</strong>
                        <small>{fileSizeLabel(screenshot.size)} · {screenshot.type}</small>
                      </div>
                      <div className="user-report-screenshot-actions">
                        {screenCaptureSupported() ? <button type="button" className="user-report-secondary" onClick={handleCapture} disabled={busy}>Retake</button> : null}
                        <button type="button" className="user-report-secondary" onClick={() => screenshotInputRef.current?.click()} disabled={busy}>Replace</button>
                        <button type="button" className="user-report-secondary is-danger" onClick={() => {
                          setScreenshot(null);
                          setCaptureState({ state: 'notice', message: 'Screenshot removed from this report.' });
                        }} disabled={busy}>Remove</button>
                      </div>
                    </div>
                  ) : (
                    <div className="user-report-screenshot-empty">
                      {screenCaptureSupported() ? (
                        <button type="button" className="user-report-secondary" onClick={handleCapture} disabled={busy}>Capture screenshot</button>
                      ) : null}
                      <button type="button" className="user-report-secondary" onClick={() => screenshotInputRef.current?.click()} disabled={busy}>Choose image</button>
                    </div>
                  )}
                  {captureState.message ? (
                    <div className={`user-report-screenshot-message is-${captureState.state}`} role={captureState.state === 'error' ? 'alert' : 'status'} aria-live="polite">
                      {captureState.message}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="user-report-screenshot-unavailable" role="status">Screenshot attachments are not connected on this server yet. You can still send the text report.</p>
              )}
            </section>

            <section className="user-report-contact" aria-label="Optional contact details">
              <div className="user-report-contact-grid">
                <div className="user-report-field">
                  <label htmlFor="user-report-name">Name <small>Optional</small></label>
                  <input
                    id="user-report-name"
                    autoComplete="name"
                    value={draft.reporterName}
                    onChange={(event) => updateDraft('reporterName', event.target.value)}
                    maxLength={120}
                    aria-invalid={Boolean(errors.reporterName)}
                    aria-describedby={errors.reporterName ? 'user-report-name-error' : undefined}
                  />
                  {errors.reporterName ? <span id="user-report-name-error" className="user-report-field-error" role="alert">{errors.reporterName}</span> : null}
                </div>
                <div className="user-report-field">
                  <label htmlFor="user-report-email">Email <small>Optional</small></label>
                  <input
                    id="user-report-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={draft.reporterEmail}
                    onChange={(event) => updateDraft('reporterEmail', event.target.value)}
                    maxLength={320}
                    aria-invalid={Boolean(errors.reporterEmail)}
                    aria-describedby={errors.reporterEmail ? 'user-report-email-error' : undefined}
                  />
                  {errors.reporterEmail ? <span id="user-report-email-error" className="user-report-field-error" role="alert">{errors.reporterEmail}</span> : null}
                </div>
              </div>
            </section>

            {!online ? (
              <div className="user-report-inline-error" role="alert">You are offline. Your draft is preserved and can be sent when the connection returns.</div>
            ) : null}
            {submitState.state === 'error' ? (
              <div className="user-report-inline-error" role="alert">
                <span>{submitState.message}</span>
                {submitState.requestId ? <small>Request ID: {submitState.requestId}</small> : null}
              </div>
            ) : null}

            <div className="user-report-actions">
              <button type="button" className="user-report-secondary" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="user-report-primary" disabled={!canSubmit}>
                {submitState.state === 'submitting' ? 'Sending…' : 'Send report'}
              </button>
            </div>

            <p className="user-report-data-use">
              See how Ticket Snitch uses and stores report data{' '}
              {bootstrap.dataUseUrl ? (
                <a href={bootstrap.dataUseUrl} target="_blank" rel="noopener noreferrer">here</a>
              ) : (
                <span>in the Ticket Snitch data-use notice</span>
              )}.
            </p>
              </div>
            ) : null}
          </form>
        )}
      </section>
    </div>
  );
}
