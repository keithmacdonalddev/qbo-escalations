import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSubmissionId,
  loadReportingBootstrap,
  submitUserReport,
} from '../../api/ticketSnitchReporting.js';
import './UserReportDialog.css';

const REPORT_CHOICES = [
  { value: 'problem', label: 'Problem', description: 'Something did not work as expected.' },
  { value: 'feature', label: 'Feature request', description: 'A new capability would make the app more useful.' },
  { value: 'feedback', label: 'Feedback', description: 'Share an improvement or general observation.' },
];

function initialDraft() {
  return {
    kind: 'problem',
    title: '',
    explanation: '',
    includeDiagnostics: false,
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

export default function UserReportDialog({ open, onClose, errorCode = '' }) {
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const priorFocusRef = useRef(null);
  const [draft, setDraft] = useState(initialDraft);
  const [bootstrap, setBootstrap] = useState({ state: 'idle', token: '', requestId: '', reason: '' });
  const [submitState, setSubmitState] = useState({ state: 'idle', ticket: null, replay: false, message: '', requestId: '' });
  const [errors, setErrors] = useState({});
  const [online, setOnline] = useState(() => navigator.onLine !== false);

  const loadAvailability = useCallback(async () => {
    setBootstrap({ state: 'loading', token: '', requestId: '', reason: '' });
    try {
      const result = await loadReportingBootstrap();
      setBootstrap({
        state: result.available ? 'ready' : 'unavailable',
        token: result.reportToken || '',
        requestId: result.requestId || '',
        reason: result.unavailableReason || '',
      });
    } catch (error) {
      setBootstrap({
        state: error?.status === 401 || error?.status === 403 ? 'denied' : 'error',
        token: '',
        requestId: error?.requestId || '',
        reason: reportErrorMessage(error),
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

  const validate = () => {
    const next = {};
    const cleanTitle = draft.title.trim();
    const cleanExplanation = draft.explanation.trim();
    if (cleanTitle.length < 3) next.title = 'Enter at least 3 characters.';
    else if (cleanTitle.length > 240) next.title = 'Use 240 characters or fewer.';
    if (cleanExplanation.length < 10) next.explanation = 'Enter at least 10 characters so the team can understand the report.';
    else if (cleanExplanation.length > 40_000) next.explanation = 'Use 40,000 characters or fewer.';
    setErrors(next);
    if (next.title) titleRef.current?.focus();
    else if (next.explanation) dialogRef.current?.querySelector('#user-report-explanation')?.focus();
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validate()) return;
    if (!online) {
      setSubmitState({ state: 'error', ticket: null, replay: false, message: 'You are offline. Your draft is still here; try again after the connection returns.', requestId: '' });
      return;
    }
    setSubmitState({ state: 'submitting', ticket: null, replay: false, message: '', requestId: '' });
    try {
      const result = await submitUserReport({
        reportToken: bootstrap.token,
        submissionId: draft.submissionId,
        observedAt: draft.observedAt,
        kind: draft.kind,
        title: draft.title.trim(),
        explanation: draft.explanation.trim(),
        includeDiagnostics: draft.includeDiagnostics,
        errorCode,
      });
      setSubmitState({
        state: 'success',
        ticket: result.ticket,
        replay: Boolean(result.idempotentReplay),
        message: '',
        requestId: result.requestId || '',
      });
    } catch (error) {
      setSubmitState({
        state: 'error',
        ticket: null,
        replay: false,
        message: reportErrorMessage(error),
        requestId: error?.requestId || '',
      });
    }
  };

  const startAnother = () => {
    setDraft(initialDraft());
    setErrors({});
    setSubmitState({ state: 'idle', ticket: null, replay: false, message: '', requestId: '' });
    loadAvailability();
    requestAnimationFrame(() => titleRef.current?.focus());
  };

  const busy = bootstrap.state === 'loading' || submitState.state === 'submitting';
  const canSubmit = bootstrap.state === 'ready' && online && !busy;

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
        ) : submitState.state === 'success' ? (
          <div className="user-report-success" role="status" aria-live="polite">
            <span className="user-report-success-mark" aria-hidden="true">✓</span>
            <h3>Report received</h3>
            <p>Ticket Snitch case <strong>{submitState.ticket?.key || 'created'}</strong> is ready for human review.</p>
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
              <legend>What would you like to share?</legend>
              <div className="user-report-type-grid" role="radiogroup" aria-label="Report type">
                {REPORT_CHOICES.map((choice) => (
                  <label key={choice.value} className={`user-report-type${draft.kind === choice.value ? ' is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="report-kind"
                      value={choice.value}
                      checked={draft.kind === choice.value}
                      onChange={() => updateDraft('kind', choice.value)}
                    />
                    <span><strong>{choice.label}</strong><small>{choice.description}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="user-report-field">
              <label htmlFor="user-report-summary">Short title</label>
              <input
                ref={titleRef}
                id="user-report-summary"
                value={draft.title}
                onChange={(event) => updateDraft('title', event.target.value)}
                maxLength={240}
                aria-invalid={Boolean(errors.title)}
                aria-describedby={errors.title ? 'user-report-summary-error' : 'user-report-summary-help'}
                placeholder="Example: Escalation notes do not save"
              />
              <span id="user-report-summary-help" className="user-report-help">Make it easy to recognize in a work queue.</span>
              {errors.title ? <span id="user-report-summary-error" className="user-report-field-error" role="alert">{errors.title}</span> : null}
            </div>

            <div className="user-report-field">
              <label htmlFor="user-report-explanation">What should we know?</label>
              <textarea
                id="user-report-explanation"
                value={draft.explanation}
                onChange={(event) => updateDraft('explanation', event.target.value)}
                rows={6}
                maxLength={40_000}
                aria-invalid={Boolean(errors.explanation)}
                aria-describedby={errors.explanation ? 'user-report-explanation-error' : 'user-report-explanation-help'}
                placeholder="Describe what happened, what you expected, or why the idea would help."
              />
              <span id="user-report-explanation-help" className="user-report-help">Do not include passwords, payment information, access tokens, or customer secrets.</span>
              {errors.explanation ? <span id="user-report-explanation-error" className="user-report-field-error" role="alert">{errors.explanation}</span> : null}
            </div>

            <label className="user-report-consent">
              <input
                type="checkbox"
                checked={draft.includeDiagnostics}
                onChange={(event) => updateDraft('includeDiagnostics', event.target.checked)}
              />
              <span>
                <strong>Include basic diagnostics</strong>
                <small>Share browser name, app version, screen size, language, current app page, time, and a safe error code when available. No cookies, tokens, logs, query strings, Gmail content, or customer data.</small>
              </span>
            </label>

            <details className="user-report-disclosure">
              <summary>What will be submitted?</summary>
              <p>Your selected type, title, explanation, current QBO page name, app version, time, and a private request ID. Optional diagnostics are included only when checked. Ticket Snitch uses this to organize human review and follow-through.</p>
            </details>

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
          </form>
        )}
      </section>
    </div>
  );
}
