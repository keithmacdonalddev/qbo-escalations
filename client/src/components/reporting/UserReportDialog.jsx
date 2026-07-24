import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSubmissionId,
  loadCustomerReceipt,
  loadReportingBootstrap,
  replyToCustomerReceipt,
  submitUserReport,
  validateCustomerReceipt,
} from '../../api/ticketSnitchReporting.js';
import {
  captureScreenFrame,
  screenCaptureSupported,
  validateScreenshotFile,
} from './screenshotCapture.js';
import {
  loadSavedReceipts,
  removeSavedReceipt,
  saveReceipt,
} from './customerReceipts.js';
import './UserReportDialog.css';

const REPORT_CHOICES = [
  { value: 'problem', label: 'Problem' },
  { value: 'feature', label: 'Feature request' },
  { value: 'feedback', label: 'Feedback' },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function initialDraft() {
  return {
    kind: 'problem',
    title: '',
    explanation: '',
    reporterName: '',
    reporterEmail: '',
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
  const [bootstrap, setBootstrap] = useState({ state: 'idle', token: '', reporterScope: '', requestId: '', reason: '', screenshotAvailable: false });
  const [submitState, setSubmitState] = useState({ state: 'idle', ticket: null, replay: false, message: '', requestId: '' });
  const [errors, setErrors] = useState({});
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState('');
  const [captureState, setCaptureState] = useState({ state: 'idle', message: '' });
  const [view, setView] = useState('form');
  const [savedReceipts, setSavedReceipts] = useState([]);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [receiptState, setReceiptState] = useState({ state: 'idle', data: null, message: '', requestId: '' });
  const [replyDraft, setReplyDraft] = useState({ body: '', actionId: createSubmissionId() });
  const [validationDraft, setValidationDraft] = useState({ outcome: '', note: '', actionId: createSubmissionId() });

  const loadAvailability = useCallback(async () => {
    setBootstrap({ state: 'loading', token: '', reporterScope: '', requestId: '', reason: '', screenshotAvailable: false });
    try {
      const result = await loadReportingBootstrap();
      setBootstrap({
        state: result.available ? 'ready' : 'unavailable',
        token: result.reportToken || '',
        reporterScope: result.reporterScope || '',
        requestId: result.requestId || '',
        reason: result.unavailableReason || '',
        screenshotAvailable: result.screenshotAvailable !== false,
      });
    } catch (error) {
      setBootstrap({
        state: error?.status === 401 || error?.status === 403 ? 'denied' : 'error',
        token: '',
        reporterScope: '',
        requestId: error?.requestId || '',
        reason: reportErrorMessage(error),
        screenshotAvailable: false,
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
    if (!open || !bootstrap.reporterScope) return;
    setSavedReceipts(loadSavedReceipts(bootstrap.reporterScope));
  }, [bootstrap.reporterScope, open]);

  const rememberReceipt = useCallback((result) => {
    if (!bootstrap.reporterScope || !result?.customerReceipt?.handle || !result?.ticket?.key) return null;
    const stored = {
      key: result.ticket.key,
      title: draft.title.trim(),
      handle: result.customerReceipt.handle,
      expiresAt: result.customerReceipt.expiresAt,
      createdAt: new Date().toISOString(),
    };
    setSavedReceipts(saveReceipt(bootstrap.reporterScope, stored));
    setSelectedReceipt(stored);
    return stored;
  }, [bootstrap.reporterScope, draft.title]);

  const openReceipt = useCallback(async (receipt) => {
    setSelectedReceipt(receipt);
    setView('receipt');
    if (!online) {
      setReceiptState({
        state: 'error',
        data: null,
        message: 'You are offline. Reconnect to load the latest report status.',
        requestId: '',
      });
      return;
    }
    setReceiptState({ state: 'loading', data: null, message: '', requestId: '' });
    try {
      let reportToken = bootstrap.token;
      if (!reportToken) {
        const refreshed = await loadReportingBootstrap();
        reportToken = refreshed.reportToken;
        setBootstrap((current) => ({ ...current, token: reportToken, state: refreshed.available ? 'ready' : 'unavailable' }));
      }
      const result = await loadCustomerReceipt({ reportToken, receiptHandle: receipt.handle });
      setReceiptState({ state: 'ready', data: result.data, message: '', requestId: result.requestId || '' });
    } catch (error) {
      setReceiptState({
        state: error?.status === 401 || error?.status === 403 ? 'expired' : 'error',
        data: null,
        message: error?.message || 'The report status could not be loaded.',
        requestId: error?.requestId || '',
      });
    }
  }, [bootstrap.token, online]);

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

  const handleScreenshotPaste = (event) => {
    const image = Array.from(event.clipboardData?.items || [])
      .find((item) => item.type?.startsWith('image/'))
      ?.getAsFile?.();
    if (!image) {
      setCaptureState({ state: 'notice', message: 'The clipboard does not contain a supported image.' });
      return;
    }
    event.preventDefault();
    chooseScreenshot(image);
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
        includeDiagnostics: draft.includeDiagnostics,
        errorCode,
        screenshot,
      });
      const storedReceipt = rememberReceipt(result);
      if (result.evidence?.status === 'failed') {
        setSubmitState({
          state: 'partial',
          ticket: result.ticket,
          replay: Boolean(result.idempotentReplay),
          message: result.evidence.message || 'The report was received, but its screenshot could not be attached.',
          requestId: result.evidence.requestId || result.requestId || '',
          receipt: storedReceipt,
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
        receipt: storedReceipt,
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

  const sendReceiptReply = async (event) => {
    event.preventDefault();
    const body = replyDraft.body.trim();
    if (!body || !selectedReceipt || receiptState.state !== 'ready') return;
    if (!online) {
      setReceiptState((current) => ({ ...current, message: 'You are offline. Your reply is still here.' }));
      return;
    }
    setReceiptState((current) => ({ ...current, state: 'replying', message: '', requestId: '' }));
    try {
      await replyToCustomerReceipt({
        reportToken: bootstrap.token,
        receiptHandle: selectedReceipt.handle,
        actionId: replyDraft.actionId,
        body,
      });
      setReplyDraft({ body: '', actionId: createSubmissionId() });
      await openReceipt(selectedReceipt);
    } catch (error) {
      setReceiptState((current) => ({
        ...current,
        state: 'ready',
        message: error?.message || 'Your reply could not be sent. It is still here.',
        requestId: error?.requestId || '',
      }));
    }
  };

  const sendReceiptValidation = async (outcome) => {
    if (!selectedReceipt || receiptState.state !== 'ready') return;
    if (!online) {
      setReceiptState((current) => ({ ...current, message: 'You are offline. Reconnect before confirming the outcome.' }));
      return;
    }
    setReceiptState((current) => ({ ...current, state: 'validating', message: '', requestId: '' }));
    try {
      await validateCustomerReceipt({
        reportToken: bootstrap.token,
        receiptHandle: selectedReceipt.handle,
        actionId: validationDraft.actionId,
        workItemVersion: receiptState.data.version,
        outcome,
        note: validationDraft.note.trim(),
      });
      setValidationDraft({ outcome, note: '', actionId: createSubmissionId() });
      await openReceipt(selectedReceipt);
    } catch (error) {
      setReceiptState((current) => ({
        ...current,
        state: 'ready',
        message: error?.message || 'Your outcome confirmation could not be saved.',
        requestId: error?.requestId || '',
      }));
    }
  };

  const forgetReceipt = () => {
    if (!selectedReceipt || !bootstrap.reporterScope) return;
    setSavedReceipts(removeSavedReceipt(bootstrap.reporterScope, selectedReceipt.key));
    setSelectedReceipt(null);
    setReceiptState({ state: 'idle', data: null, message: '', requestId: '' });
    setView('receipts');
  };

  const startAnother = () => {
    setDraft(initialDraft());
    setErrors({});
    setSubmitState({ state: 'idle', ticket: null, replay: false, message: '', requestId: '' });
    setScreenshot(null);
    setCaptureState({ state: 'idle', message: '' });
    setView('form');
    loadAvailability();
    requestAnimationFrame(() => titleRef.current?.focus());
  };

  const busy = bootstrap.state === 'loading' || submitState.state === 'submitting' || submitState.state === 'retrying' || captureState.state === 'capturing';
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

        <nav className="user-report-view-tabs" aria-label="Feedback and report status">
          <button
            type="button"
            className={view === 'form' ? 'is-active' : ''}
            aria-current={view === 'form' ? 'page' : undefined}
            onClick={() => setView('form')}
          >
            New report
          </button>
          <button
            type="button"
            className={view !== 'form' ? 'is-active' : ''}
            aria-current={view !== 'form' ? 'page' : undefined}
            onClick={() => setView('receipts')}
          >
            My reports{savedReceipts.length ? ` (${savedReceipts.length})` : ''}
          </button>
        </nav>

        {view === 'receipts' ? (
          <div className="user-report-receipts" aria-live="polite">
            <div className="user-report-section-heading">
              <div>
                <h3>My reports</h3>
                <p>Private receipts saved for this anonymous browser identity.</p>
              </div>
            </div>
            {savedReceipts.length ? (
              <div className="user-report-receipt-list">
                {savedReceipts.map((receipt) => {
                  const expired = new Date(receipt.expiresAt).getTime() <= Date.now();
                  return (
                    <button
                      type="button"
                      key={receipt.key}
                      className="user-report-receipt-row"
                      onClick={() => openReceipt(receipt)}
                    >
                      <span>
                        <strong>{receipt.key}</strong>
                        <small>{receipt.title || 'Submitted feedback'}</small>
                      </span>
                      <span className={expired ? 'is-expired' : ''}>
                        {expired ? 'Receipt expired' : 'View status'}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="user-report-state">
                <strong>No saved report receipts yet.</strong>
                <span>When you send feedback, its private receipt will appear here so you can return, reply, and confirm the outcome.</span>
                <button type="button" className="user-report-primary" onClick={() => setView('form')}>Send feedback</button>
              </div>
            )}
          </div>
        ) : view === 'receipt' ? (
          <div className="user-report-receipt-detail" aria-live="polite">
            <button type="button" className="user-report-back-link" onClick={() => setView('receipts')}>← Back to my reports</button>
            {receiptState.state === 'loading' ? (
              <div className="user-report-state" role="status">Loading the latest report status…</div>
            ) : receiptState.state === 'expired' ? (
              <div className="user-report-state is-warning" role="alert">
                <strong>This private receipt is invalid, expired, or revoked.</strong>
                <span>{receiptState.message}</span>
                {receiptState.requestId ? <small>Request ID: {receiptState.requestId}</small> : null}
                <button type="button" className="user-report-secondary" onClick={forgetReceipt}>Remove saved receipt</button>
              </div>
            ) : receiptState.state === 'error' ? (
              <div className="user-report-state is-error" role="alert">
                <strong>The report status could not be loaded.</strong>
                <span>{receiptState.message}</span>
                {receiptState.requestId ? <small>Request ID: {receiptState.requestId}</small> : null}
                <button type="button" className="user-report-secondary" disabled={!online} onClick={() => openReceipt(selectedReceipt)}>Try again</button>
              </div>
            ) : receiptState.data ? (
              <>
                <section className="user-report-public-status">
                  <div className="user-report-public-status-heading">
                    <div>
                      <span className="user-report-case-key">{receiptState.data.key}</span>
                      <h3>{receiptState.data.title}</h3>
                    </div>
                    <span className={`user-report-status-pill status-${receiptState.data.status}`}>{receiptState.data.statusLabel}</span>
                  </div>
                  <p>{receiptState.data.publicSummary}</p>
                  {receiptState.data.needsReporterReply ? (
                    <div className="user-report-inline-notice">The team is waiting for more information from you.</div>
                  ) : null}
                  <small>Updated {new Date(receiptState.data.updatedAt).toLocaleString()}</small>
                </section>

                <section className="user-report-public-updates">
                  <h4>Conversation</h4>
                  {receiptState.data.updates?.length ? (
                    <div className="user-report-update-list">
                      {receiptState.data.updates.map((update) => (
                        <article key={update.id} className={`is-${update.direction}`}>
                          <div>
                            <strong>{update.authorLabel}</strong>
                            <time dateTime={update.createdAt}>{new Date(update.createdAt).toLocaleString()}</time>
                          </div>
                          <p>{update.body}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="user-report-empty-copy">No public updates yet. Internal notes and evidence are never shown here.</p>
                  )}
                  <form onSubmit={sendReceiptReply} className="user-report-reply-form">
                    <label htmlFor="user-report-reply">Add information or ask a question</label>
                    <textarea
                      id="user-report-reply"
                      value={replyDraft.body}
                      onChange={(event) => setReplyDraft((current) => ({ ...current, body: event.target.value }))}
                      maxLength={10_000}
                      disabled={receiptState.state === 'replying' || receiptState.state === 'validating'}
                    />
                    <button
                      type="submit"
                      className="user-report-primary"
                      disabled={!online || !replyDraft.body.trim() || receiptState.state === 'replying' || receiptState.state === 'validating'}
                    >
                      {receiptState.state === 'replying' ? 'Sending reply…' : 'Send reply'}
                    </button>
                  </form>
                </section>

                {receiptState.data.canValidate ? (
                  <section className="user-report-validation">
                    <h4>Did this solve the problem?</h4>
                    <p>Your answer helps the owner decide the next step. It never closes or reopens the case automatically.</p>
                    {receiptState.data.reporterValidation?.outcome ? (
                      <div className="user-report-inline-notice">
                        Latest answer: <strong>{receiptState.data.reporterValidation.outcome === 'fixed' ? 'Fixed' : 'Not fixed'}</strong>
                      </div>
                    ) : null}
                    <label htmlFor="user-report-validation-note">Optional note</label>
                    <textarea
                      id="user-report-validation-note"
                      value={validationDraft.note}
                      onChange={(event) => setValidationDraft((current) => ({ ...current, note: event.target.value }))}
                      maxLength={5000}
                      disabled={receiptState.state === 'replying' || receiptState.state === 'validating'}
                    />
                    <div className="user-report-validation-actions">
                      <button type="button" className="user-report-secondary" disabled={!online || receiptState.state === 'validating'} onClick={() => sendReceiptValidation('not_fixed')}>Not fixed</button>
                      <button type="button" className="user-report-primary" disabled={!online || receiptState.state === 'validating'} onClick={() => sendReceiptValidation('fixed')}>Fixed</button>
                    </div>
                  </section>
                ) : null}

                {receiptState.message ? (
                  <div className="user-report-inline-error" role="alert">
                    <span>{receiptState.message}</span>
                    {receiptState.requestId ? <small>Request ID: {receiptState.requestId}</small> : null}
                  </div>
                ) : null}

                <div className="user-report-actions">
                  <button type="button" className="user-report-secondary" onClick={forgetReceipt}>Remove from this browser</button>
                  <button type="button" className="user-report-secondary" disabled={!online} onClick={() => openReceipt(selectedReceipt)}>Refresh status</button>
                </div>
              </>
            ) : (
              <div className="user-report-state">Choose a saved report to continue.</div>
            )}
          </div>
        ) : bootstrap.state === 'loading' ? (
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
              {submitState.receipt ? (
                <button type="button" className="user-report-secondary" onClick={() => openReceipt(submitState.receipt)} disabled={busy}>View report status</button>
              ) : null}
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
              {submitState.receipt ? (
                <button type="button" className="user-report-secondary" onClick={() => openReceipt(submitState.receipt)}>View report status</button>
              ) : null}
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
                      checked={draft.kind === choice.value}
                      onChange={() => updateDraft('kind', choice.value)}
                    />
                    <span>{choice.label}</span>
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

            <section className="user-report-contact" aria-labelledby="user-report-contact-title">
              <div className="user-report-section-heading">
                <div>
                  <h3 id="user-report-contact-title">Contact details</h3>
                  <p>Optional. Leave both fields blank to report anonymously.</p>
                </div>
                <span>Optional</span>
              </div>
              <div className="user-report-contact-grid">
                <div className="user-report-field">
                  <label htmlFor="user-report-name">Name</label>
                  <input
                    id="user-report-name"
                    autoComplete="name"
                    value={draft.reporterName}
                    onChange={(event) => updateDraft('reporterName', event.target.value)}
                    maxLength={120}
                    aria-invalid={Boolean(errors.reporterName)}
                    aria-describedby={errors.reporterName ? 'user-report-name-error' : 'user-report-contact-help'}
                  />
                  {errors.reporterName ? <span id="user-report-name-error" className="user-report-field-error" role="alert">{errors.reporterName}</span> : null}
                </div>
                <div className="user-report-field">
                  <label htmlFor="user-report-email">Email</label>
                  <input
                    id="user-report-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={draft.reporterEmail}
                    onChange={(event) => updateDraft('reporterEmail', event.target.value)}
                    maxLength={320}
                    aria-invalid={Boolean(errors.reporterEmail)}
                    aria-describedby={errors.reporterEmail ? 'user-report-email-error' : 'user-report-contact-help'}
                  />
                  {errors.reporterEmail ? <span id="user-report-email-error" className="user-report-field-error" role="alert">{errors.reporterEmail}</span> : null}
                </div>
              </div>
              <p id="user-report-contact-help" className="user-report-help">These details are self-reported and are used only to identify this report and support future follow-up. They do not create an account or prove identity.</p>
            </section>

            <section
              className="user-report-screenshot"
              aria-labelledby="user-report-screenshot-title"
              onPaste={bootstrap.screenshotAvailable ? handleScreenshotPaste : undefined}
              tabIndex={bootstrap.screenshotAvailable ? 0 : undefined}
            >
              <div className="user-report-screenshot-heading">
                <div>
                  <h3 id="user-report-screenshot-title">Optional screenshot</h3>
                  <p>A screenshot can contain sensitive information. Review it carefully before you send this report.</p>
                </div>
                <span>Optional</span>
              </div>
              {bootstrap.screenshotAvailable ? (
                <>
                  <p className="user-report-screenshot-explainer">
                    Capture screenshot asks your browser to let you choose a tab, window, or screen. It takes one still image, never records audio, and stops sharing immediately.
                  </p>
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
                      <div className="user-report-screenshot-actions">
                        {screenCaptureSupported() ? (
                          <button type="button" className="user-report-secondary" onClick={handleCapture} disabled={busy}>Capture screenshot</button>
                        ) : null}
                        <button type="button" className="user-report-secondary" onClick={() => screenshotInputRef.current?.click()} disabled={busy}>Add image</button>
                      </div>
                      <small>{screenCaptureSupported() ? 'Or focus this area and paste an image from your clipboard.' : 'Screen capture is unavailable in this browser. Add an image or focus this area and paste one.'}</small>
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
              <p>Your selected type, title, explanation, current QBO page name, app version, time, and a private request ID. Your name and email are included only when you enter them; otherwise the report is anonymous. Optional diagnostics are included only when checked. {screenshot ? 'The screenshot shown above will also be attached as private case evidence.' : 'No screenshot will be submitted.'} Ticket Snitch uses this to organize human review and follow-through.</p>
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
