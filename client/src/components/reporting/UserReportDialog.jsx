import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  createSubmissionId,
  getReportingContext,
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
import { loadSavedReceipts, removeSavedReceipt, saveReceipt } from './customerReceipts.js';
import ScreenshotEditor from './ScreenshotEditor.jsx';
import './UserReportDialog.css';

const REPORT_CHOICES = [
  {
    value: 'problem',
    tagline: 'Found a bug?',
    label: 'Report a Problem',
    titlePlaceholder: 'Example: Escalation notes do not save',
    explanationLabel: 'What happened?',
    explanationPlaceholder: 'What happened, what did you expect, and how can we reproduce it?',
  },
  {
    value: 'feature',
    tagline: 'Have an idea?',
    label: 'Request a Feature',
    titlePlaceholder: 'Example: Add a faster review shortcut',
    explanationLabel: 'What would help?',
    explanationPlaceholder: 'What do you need, and what would it make easier?',
  },
  {
    value: 'feedback',
    tagline: 'Want to chat?',
    label: 'Submit Feedback',
    titlePlaceholder: 'Example: Make filters easier to scan',
    explanationLabel: 'What should we improve?',
    explanationPlaceholder: 'What feels harder than it should, and what would feel better?',
  },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRIVACY_REMINDER = 'Leave out passwords, payment information, access tokens, and customer secrets.';
const DRAFT_PREFIX = 'qbo-ticket-snitch-draft:v1:';

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

function draftHasContent(draft) {
  return Boolean(draft.kind || draft.title.trim() || draft.explanation.trim() || draft.reporterName.trim() || draft.reporterEmail.trim());
}

function draftStorageKey(scope) {
  return `${DRAFT_PREFIX}${encodeURIComponent(String(scope || '').slice(0, 128))}`;
}

function loadSessionDraft(scope) {
  if (!scope || !globalThis.sessionStorage) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(draftStorageKey(scope)) || 'null');
    if (!value || !REPORT_CHOICES.some((choice) => choice.value === value.kind)) return null;
    return {
      ...initialDraft(),
      kind: value.kind,
      title: String(value.title || '').slice(0, 240),
      explanation: String(value.explanation || '').slice(0, 40_000),
      reporterName: String(value.reporterName || '').slice(0, 120),
      reporterEmail: String(value.reporterEmail || '').slice(0, 320),
      submissionId: String(value.submissionId || createSubmissionId()),
      observedAt: String(value.observedAt || new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

function saveSessionDraft(scope, draft) {
  if (!scope || !globalThis.sessionStorage) return;
  if (!draftHasContent(draft)) {
    sessionStorage.removeItem(draftStorageKey(scope));
    return;
  }
  sessionStorage.setItem(draftStorageKey(scope), JSON.stringify(draft));
}

function clearSessionDraft(scope) {
  if (scope && globalThis.sessionStorage) sessionStorage.removeItem(draftStorageKey(scope));
}

function suggestedTitle(explanation) {
  const clean = String(explanation || '').replace(/\s+/g, ' ').trim();
  if (clean.length < 24) return '';
  const firstThought = clean.split(/(?<=[.!?])\s|\n/)[0].replace(/[.!?]+$/, '').trim();
  if (firstThought.length < 3) return '';
  return firstThought.length > 96 ? `${firstThought.slice(0, 93).trim()}…` : firstThought;
}

function ReportChoiceIcon({ kind }) {
  if (kind === 'problem') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="8.25" /><path d="M12 7.5v5M12 16.25h.01" /></svg>;
  if (kind === 'feature') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 17.5h6M10 21h4M8.2 14.2a6 6 0 1 1 7.6 0c-1.1.8-1.8 1.7-1.8 2.8h-4c0-1.1-.7-2-1.8-2.8Z" /></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 14a4 4 0 0 1-4 4H9l-5 3v-7a8 8 0 1 1 16 0Z" /><path d="M8.5 11.5h7M8.5 14.5h4.5" /></svg>;
}

function UtilityIcon({ kind }) {
  if (kind === 'screenshot') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m7 15 3-3 2.5 2.5 2-2L19 17" /><circle cx="16.5" cy="9" r="1.25" /></svg>;
  if (kind === 'contact') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5Z" /><path d="m5 7 7 5 7-5" /></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3 5 6v5c0 4.6 2.8 8.4 7 10 4.2-1.6 7-5.4 7-10V6Z" /><path d="m9.5 12 1.7 1.7 3.6-3.7" /></svg>;
}

function reportErrorMessage(error) {
  if (error?.status === 401 || error?.status === 403) return 'This installation is not permitted to submit reports. Your draft is still here.';
  return error?.message || 'The report could not be sent. Your draft is still here.';
}

function fileSizeLabel(size) {
  if (size < 1024) return `${size} bytes`;
  return `${Math.ceil(size / 1024)} KB`;
}

function readableDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function UserReportDialog({ open, onClose, errorCode = '' }) {
  const dialogRef = useRef(null);
  const firstChoiceRef = useRef(null);
  const titleRef = useRef(null);
  const formDetailsRef = useRef(null);
  const additionToRevealRef = useRef('');
  const screenshotInputRef = useRef(null);
  const priorFocusRef = useRef(null);
  const hydratedScopeRef = useRef('');
  const [draft, setDraft] = useState(initialDraft);
  const [bootstrap, setBootstrap] = useState({ state: 'idle', token: '', reporterScope: '', requestId: '', reason: '', screenshotAvailable: false, dataUseUrl: '' });
  const [submitState, setSubmitState] = useState({ state: 'idle', ticket: null, replay: false, message: '', requestId: '' });
  const [errors, setErrors] = useState({});
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState('');
  const [editingScreenshot, setEditingScreenshot] = useState(false);
  const [captureState, setCaptureState] = useState({ state: 'idle', message: '' });
  const [captureHidden, setCaptureHidden] = useState(false);
  const [additions, setAdditions] = useState({ screenshot: false, contact: false });
  const [draftRestored, setDraftRestored] = useState(false);
  const [view, setView] = useState('form');
  const [savedReceipts, setSavedReceipts] = useState([]);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [receiptState, setReceiptState] = useState({ state: 'idle', data: null, message: '', requestId: '' });
  const [replyDraft, setReplyDraft] = useState({ body: '', actionId: createSubmissionId() });
  const [validationNote, setValidationNote] = useState('');
  const busy = bootstrap.state === 'loading'
    || submitState.state === 'submitting'
    || submitState.state === 'retrying'
    || captureState.state === 'capturing'
    || receiptState.state === 'replying'
    || receiptState.state === 'validating';
  const selectedChoice = REPORT_CHOICES.find((choice) => choice.value === draft.kind);
  const latestReceipt = savedReceipts[0] || null;
  const titleSuggestion = useMemo(() => (!draft.title.trim() ? suggestedTitle(draft.explanation) : ''), [draft.explanation, draft.title]);
  const context = useMemo(() => getReportingContext(errorCode), [errorCode]);

  useEffect(() => {
    const name = additionToRevealRef.current;
    if (!name || !additions[name]) return undefined;
    const frame = requestAnimationFrame(() => {
      const container = formDetailsRef.current;
      const panel = container?.querySelector(`[data-addition-panel="${name}"]`);
      const footer = container?.querySelector('.user-report-submit-bar');
      if (!container || !panel || !footer) return;
      const overlap = panel.getBoundingClientRect().bottom - footer.getBoundingClientRect().top + 8;
      if (overlap > 0) container.scrollTop = Math.min(
        container.scrollTop + overlap,
        container.scrollHeight - container.clientHeight,
      );
      additionToRevealRef.current = '';
    });
    return () => cancelAnimationFrame(frame);
  }, [additions]);

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
      setBootstrap({ state: error?.status === 401 || error?.status === 403 ? 'denied' : 'error', token: '', reporterScope: '', requestId: error?.requestId || '', reason: reportErrorMessage(error), screenshotAvailable: false, dataUseUrl: '' });
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    priorFocusRef.current = document.activeElement;
    loadAvailability();
    return () => priorFocusRef.current?.focus?.();
  }, [loadAvailability, open]);

  useEffect(() => {
    if (!open || bootstrap.state !== 'ready') return;
    requestAnimationFrame(() => (selectedChoice ? titleRef.current : firstChoiceRef.current)?.focus({ preventScroll: true }));
  }, [bootstrap.state, open]);

  useEffect(() => {
    if (!open || !bootstrap.reporterScope || hydratedScopeRef.current === bootstrap.reporterScope) return;
    hydratedScopeRef.current = bootstrap.reporterScope;
    setSavedReceipts(loadSavedReceipts(bootstrap.reporterScope));
    const saved = loadSessionDraft(bootstrap.reporterScope);
    if (saved && !draftHasContent(draft)) {
      setDraft(saved);
      setDraftRestored(true);
      setAdditions({ screenshot: false, contact: Boolean(saved.reporterName || saved.reporterEmail) });
    }
  }, [bootstrap.reporterScope, draft, open]);

  useEffect(() => {
    if (bootstrap.reporterScope && submitState.state !== 'success') saveSessionDraft(bootstrap.reporterScope, draft);
  }, [bootstrap.reporterScope, draft, submitState.state]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); };
  }, []);

  useEffect(() => {
    if (!screenshot || typeof URL?.createObjectURL !== 'function') { setScreenshotPreview(''); return undefined; }
    const url = URL.createObjectURL(screenshot);
    setScreenshotPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);

  const closeDialog = useCallback(() => {
    if (busy) return;
    if (bootstrap.reporterScope && submitState.state !== 'success') saveSessionDraft(bootstrap.reporterScope, draft);
    onClose();
  }, [bootstrap.reporterScope, busy, draft, onClose, submitState.state]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeDialog(); return; }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeDialog, open]);

  const updateDraft = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setDraftRestored(false);
    setErrors((current) => ({ ...current, [field]: '' }));
    if (submitState.state === 'error') setSubmitState({ state: 'idle', ticket: null, replay: false, message: '', requestId: '' });
  };

  const chooseReportKind = (kind) => {
    updateDraft('kind', kind);
    requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
  };

  const toggleAddition = (name) => {
    if (!additions[name]) additionToRevealRef.current = name;
    setAdditions((current) => ({ ...current, [name]: !current[name] }));
  };

  const chooseScreenshot = (file) => {
    try {
      setScreenshot(validateScreenshotFile(file));
      setAdditions((current) => ({ ...current, screenshot: true }));
      setEditingScreenshot(false);
      setCaptureState({ state: 'ready', message: 'Ready to send. Review or cover private details first.' });
      if (screenshotInputRef.current) screenshotInputRef.current.value = '';
    } catch (error) {
      setCaptureState({ state: 'error', message: error.message });
    }
  };

  const waitForPaint = (hidden) => new Promise((resolve) => {
    setCaptureHidden(hidden);
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });

  const handleCapture = async () => {
    setCaptureState({ state: 'capturing', message: 'Choose the tab, window, or screen you want to share.' });
    try {
      chooseScreenshot(await captureScreenFrame({ beforeFrame: () => waitForPaint(true), afterFrame: () => waitForPaint(false) }));
    } catch (error) {
      setCaptureHidden(false);
      setCaptureState({ state: error?.code === 'SCREENSHOT_CAPTURE_CANCELLED' ? 'notice' : 'error', message: error?.message || 'The screenshot could not be captured.' });
    }
  };

  const validate = () => {
    const next = {};
    const cleanTitle = draft.title.trim();
    const cleanExplanation = draft.explanation.trim();
    if (cleanTitle.length < 3) next.title = 'Enter at least 3 characters.';
    if (cleanExplanation.length < 10) next.explanation = 'Add a little more detail so the team can act on this.';
    if (draft.reporterName.trim() && draft.reporterName.trim().length < 2) next.reporterName = 'Enter at least 2 characters, or leave this blank.';
    if (draft.reporterEmail.trim() && !EMAIL_PATTERN.test(draft.reporterEmail.trim())) next.reporterEmail = 'Enter a valid email address, or leave this blank.';
    setErrors(next);
    if (next.reporterName || next.reporterEmail) setAdditions((current) => ({ ...current, contact: true }));
    requestAnimationFrame(() => {
      if (next.title) titleRef.current?.focus();
      else if (next.explanation) dialogRef.current?.querySelector('#user-report-explanation')?.focus();
      else if (next.reporterName) dialogRef.current?.querySelector('#user-report-name')?.focus();
      else if (next.reporterEmail) dialogRef.current?.querySelector('#user-report-email')?.focus();
    });
    return Object.keys(next).length === 0;
  };

  const rememberReceipt = (result) => {
    if (!bootstrap.reporterScope || !result?.customerReceipt?.handle || !result?.ticket?.key) return null;
    const stored = { key: result.ticket.key, title: draft.title.trim(), handle: result.customerReceipt.handle, expiresAt: result.customerReceipt.expiresAt, createdAt: new Date().toISOString() };
    setSavedReceipts(saveReceipt(bootstrap.reporterScope, stored));
    setSelectedReceipt(stored);
    return stored;
  };

  const sendDraft = async ({ retryEvidence = false } = {}) => {
    if (!retryEvidence && !validate()) return;
    if (!online) { setSubmitState((current) => ({ ...current, state: retryEvidence ? 'partial' : 'error', message: 'You are offline. Your draft and screenshot are still here.' })); return; }
    setSubmitState((current) => ({ state: retryEvidence ? 'retrying' : 'submitting', ticket: retryEvidence ? current.ticket : null, replay: retryEvidence ? current.replay : false, message: '', requestId: '', receipt: retryEvidence ? current.receipt : null }));
    try {
      const result = await submitUserReport({ reportToken: bootstrap.token, submissionId: draft.submissionId, observedAt: draft.observedAt, kind: draft.kind, title: draft.title.trim(), explanation: draft.explanation.trim(), reporterName: draft.reporterName.trim(), reporterEmail: draft.reporterEmail.trim(), errorCode, screenshot });
      const receipt = rememberReceipt(result);
      if (result.evidence?.status === 'failed') {
        saveSessionDraft(bootstrap.reporterScope, draft);
        setSubmitState({ state: 'partial', ticket: result.ticket, replay: Boolean(result.idempotentReplay), message: result.evidence.message || 'The report was received, but its screenshot could not be attached.', requestId: result.evidence.requestId || result.requestId || '', receipt });
        return;
      }
      clearSessionDraft(bootstrap.reporterScope);
      setSubmitState({ state: 'success', ticket: result.ticket, replay: Boolean(result.idempotentReplay), message: '', requestId: result.requestId || '', evidenceAttached: result.evidence?.status === 'attached', receipt });
    } catch (error) {
      setSubmitState((current) => ({ ...current, state: retryEvidence ? 'partial' : 'error', message: reportErrorMessage(error), requestId: error?.requestId || '' }));
    }
  };

  const openReceipt = useCallback(async (receipt) => {
    if (!receipt) return;
    setSelectedReceipt(receipt);
    setView('receipt');
    if (!online) { setReceiptState({ state: 'error', data: null, message: 'Reconnect to load the latest status.', requestId: '' }); return; }
    setReceiptState({ state: 'loading', data: null, message: '', requestId: '' });
    try {
      let token = bootstrap.token;
      if (!token) token = (await loadReportingBootstrap()).reportToken;
      const result = await loadCustomerReceipt({ reportToken: token, receiptHandle: receipt.handle });
      setReceiptState({ state: 'ready', data: result.data, message: '', requestId: result.requestId || '' });
    } catch (error) {
      setReceiptState({ state: error?.status === 401 || error?.status === 403 ? 'expired' : 'error', data: null, message: error?.message || 'The latest status could not be loaded.', requestId: error?.requestId || '' });
    }
  }, [bootstrap.token, online]);

  const sendReply = async (event) => {
    event.preventDefault();
    if (!replyDraft.body.trim() || !selectedReceipt || receiptState.state !== 'ready') return;
    const currentData = receiptState.data;
    setReceiptState((current) => ({ ...current, state: 'replying', message: '' }));
    try {
      await replyToCustomerReceipt({ reportToken: bootstrap.token, receiptHandle: selectedReceipt.handle, actionId: replyDraft.actionId, body: replyDraft.body.trim() });
      setReplyDraft({ body: '', actionId: createSubmissionId() });
      await openReceipt(selectedReceipt);
    } catch (error) {
      setReceiptState({ state: 'ready', data: currentData, message: error?.message || 'Your reply could not be sent. It is still here.', requestId: error?.requestId || '' });
    }
  };

  const sendValidation = async (outcome) => {
    if (!selectedReceipt || receiptState.state !== 'ready') return;
    const currentData = receiptState.data;
    setReceiptState((current) => ({ ...current, state: 'validating', message: '' }));
    try {
      await validateCustomerReceipt({ reportToken: bootstrap.token, receiptHandle: selectedReceipt.handle, actionId: createSubmissionId(), workItemVersion: currentData.version, outcome, note: validationNote.trim() });
      setValidationNote('');
      await openReceipt(selectedReceipt);
    } catch (error) {
      setReceiptState({ state: 'ready', data: currentData, message: error?.message || 'Your confirmation could not be saved.', requestId: error?.requestId || '' });
    }
  };

  const discardDraft = () => {
    clearSessionDraft(bootstrap.reporterScope);
    setDraft(initialDraft());
    setScreenshot(null);
    setErrors({});
    setAdditions({ screenshot: false, contact: false });
    setDraftRestored(false);
    requestAnimationFrame(() => firstChoiceRef.current?.focus());
  };

  const startAnother = () => {
    clearSessionDraft(bootstrap.reporterScope);
    setDraft(initialDraft());
    setScreenshot(null);
    setErrors({});
    setAdditions({ screenshot: false, contact: false });
    setSubmitState({ state: 'idle', ticket: null, replay: false, message: '', requestId: '' });
    setView('form');
    requestAnimationFrame(() => firstChoiceRef.current?.focus());
  };

  if (!open) return null;
  const canSubmit = bootstrap.state === 'ready' && online && !busy;

  const receiptContent = () => {
    if (receiptState.state === 'loading') return <div className="user-report-state" role="status">Loading the latest update…</div>;
    if (receiptState.state === 'expired') return <div className="user-report-state is-warning" role="alert"><strong>This private receipt is no longer available.</strong><span>{receiptState.message}</span><button type="button" className="user-report-secondary" onClick={() => { setSavedReceipts(removeSavedReceipt(bootstrap.reporterScope, selectedReceipt.key)); setView('form'); }}>Remove saved receipt</button></div>;
    if (!receiptState.data) return <div className="user-report-state is-error" role="alert"><strong>Status could not be loaded.</strong><span>{receiptState.message}</span><button type="button" className="user-report-secondary" onClick={() => openReceipt(selectedReceipt)}>Try again</button></div>;
    const data = receiptState.data;
    return <>
      <section className="user-report-public-status" aria-labelledby="user-report-live-title">
        <div className="user-report-public-status-heading"><div><span className="user-report-case-key">{data.key}</span><h3 id="user-report-live-title">{data.title}</h3></div><strong className={`user-report-status-text status-${data.status}`}>{data.statusLabel}</strong></div>
        <p>{data.publicSummary}</p>
        <small>Updated {readableDate(data.updatedAt)}</small>
        {data.needsReporterReply ? <div className="user-report-inline-notice">The team is waiting for your reply.</div> : null}
      </section>
      <section className="user-report-public-updates" aria-labelledby="user-report-updates-title">
        <h4 id="user-report-updates-title">Conversation</h4>
        {data.updates?.length ? <div className="user-report-update-list">{data.updates.map((update) => <article key={update.id} className={update.direction === 'customer' ? 'is-customer' : 'is-team'}><div><strong>{update.authorLabel || (update.direction === 'customer' ? 'You' : 'Team')}</strong><time dateTime={update.createdAt}>{readableDate(update.createdAt)}</time></div><p>{update.body}</p></article>)}</div> : <p className="user-report-empty-copy">No public update yet. You can still add useful context below.</p>}
        <form className="user-report-reply-form" onSubmit={sendReply}><label htmlFor="user-report-reply">Add a reply</label><textarea id="user-report-reply" value={replyDraft.body} onChange={(event) => setReplyDraft((current) => ({ ...current, body: event.target.value }))} maxLength={10_000} placeholder="Add a detail, answer a question, or share what changed." /><button type="submit" className="user-report-secondary" disabled={!online || receiptState.state !== 'ready' || !replyDraft.body.trim()}>{receiptState.state === 'replying' ? 'Sending…' : 'Send reply'}</button></form>
      </section>
      {data.canValidate ? <section className="user-report-validation" aria-labelledby="user-report-validation-title"><div><h4 id="user-report-validation-title">Did this solve it?</h4><p>Your answer becomes evidence for the human owner; it does not close the ticket by itself.</p></div><textarea aria-label="Optional outcome note" value={validationNote} onChange={(event) => setValidationNote(event.target.value)} maxLength={10_000} placeholder="Optional: tell us what you checked." /><div className="user-report-validation-actions"><button type="button" className="user-report-secondary" onClick={() => sendValidation('not_fixed')} disabled={receiptState.state !== 'ready'}>Not fixed</button><button type="button" className="user-report-primary" onClick={() => sendValidation('fixed')} disabled={receiptState.state !== 'ready'}>Fixed for me</button></div></section> : null}
      {receiptState.message ? <div className="user-report-inline-error" role="alert">{receiptState.message}{receiptState.requestId ? <small>Request ID: {receiptState.requestId}</small> : null}</div> : null}
    </>;
  };

  return createPortal(
    <div className={`user-report-backdrop${captureHidden ? ' is-capture-hidden' : ''}`} onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
      <section ref={dialogRef} className={`user-report-dialog${view === 'receipt' ? ' is-receipt' : selectedChoice ? ' is-expanded' : ' is-chooser'}${latestReceipt && !selectedChoice ? ' has-latest' : ''}`} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="user-report-title">
        <header className="user-report-header">
          <h2 id="user-report-title">Help us improve QBO</h2>
          <div className="user-report-header-actions">
            {view === 'form' && latestReceipt && submitState.state !== 'success' && submitState.state !== 'partial' && submitState.state !== 'retrying' ? <button type="button" className="user-report-latest-link" onClick={() => openReceipt(latestReceipt)}><span>{latestReceipt.key}</span> View status</button> : null}
            {view === 'receipt' ? <button type="button" className="user-report-latest-link" onClick={() => setView('form')}>New report</button> : null}
            <button type="button" className="user-report-close" onClick={closeDialog} disabled={busy} aria-label="Close reporting form">×</button>
          </div>
        </header>

        {view === 'receipt' ? <div className="user-report-receipt-detail" aria-live="polite">{receiptContent()}</div> : bootstrap.state === 'loading' ? <div className="user-report-state" role="status">Checking reporting availability…</div> : bootstrap.state === 'unavailable' ? <div className="user-report-state is-warning"><strong>Reporting is not connected on this server.</strong><span>The administrator needs to finish the private Ticket Snitch connection.</span></div> : bootstrap.state === 'denied' || bootstrap.state === 'error' ? <div className="user-report-state is-error" role="alert"><strong>Reporting could not be opened.</strong><span>{bootstrap.reason}</span>{bootstrap.requestId ? <small>Request ID: {bootstrap.requestId}</small> : null}<button type="button" className="user-report-secondary" onClick={loadAvailability}>Try again</button></div> : submitState.state === 'partial' || submitState.state === 'retrying' ? (
          <div className="user-report-success is-partial" role="alert"><span className="user-report-success-mark">!</span><h3>Report received; screenshot needs another try</h3><p><strong>{submitState.ticket?.key}</strong> is safe. Retrying will not create a duplicate.</p><p>{submitState.message}</p><div className="user-report-actions"><button type="button" className="user-report-secondary" onClick={closeDialog}>Close</button>{submitState.receipt ? <button type="button" className="user-report-secondary" onClick={() => openReceipt(submitState.receipt)}>View live status</button> : null}<button type="button" className="user-report-primary" onClick={() => sendDraft({ retryEvidence: true })} disabled={!online || busy || !screenshot}>{submitState.state === 'retrying' ? 'Retrying…' : 'Retry screenshot'}</button></div></div>
        ) : submitState.state === 'success' ? (
          <div className="user-report-success" role="status" aria-live="polite"><span className="user-report-success-mark">✓</span><h3>You’re in the loop</h3><p><strong>{submitState.ticket?.key || 'Your report'}</strong> is with the team. You can return here for owner-approved updates, reply, and confirm whether a fix worked.</p>{submitState.evidenceAttached ? <p className="user-report-replay">Your reviewed screenshot is attached.</p> : null}{submitState.replay ? <p className="user-report-replay">This report was already received. No duplicate was created.</p> : null}<div className="user-report-actions"><button type="button" className="user-report-secondary" onClick={closeDialog}>Close</button><button type="button" className="user-report-secondary" onClick={startAnother}>Send another</button>{submitState.receipt ? <button type="button" className="user-report-primary" onClick={() => openReceipt(submitState.receipt)}>View live status</button> : null}</div></div>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); sendDraft(); }} noValidate>
            <fieldset className="user-report-types" aria-label="Choose what to send">
              <div className="user-report-type-grid">{REPORT_CHOICES.map((choice, index) => <label key={choice.value} data-kind={choice.value} className={`user-report-type${draft.kind === choice.value ? ' is-selected' : ''}`}><input ref={index === 0 ? firstChoiceRef : undefined} type="radio" name="report-kind" value={choice.value} aria-label={choice.label} aria-describedby={`user-report-type-tagline-${choice.value}`} checked={draft.kind === choice.value} onChange={() => chooseReportKind(choice.value)} /><span className="user-report-type-icon"><ReportChoiceIcon kind={choice.value} /></span><span className="user-report-type-copy"><span id={`user-report-type-tagline-${choice.value}`} className="user-report-type-tagline">{choice.tagline}</span><strong className="user-report-type-label">{choice.label}</strong></span><span className="user-report-type-chevron">›</span></label>)}</div>
            </fieldset>

            {selectedChoice ? <div ref={formDetailsRef} className="user-report-form-details">
              <div className="user-report-writing">
                <div className="user-report-field"><div className="user-report-field-heading"><span className="user-report-field-label-copy"><label htmlFor="user-report-summary">Short title</label><small id="user-report-summary-help">Easy to spot later</small></span><span className={`user-report-character-count${draft.title.length >= 180 ? ' is-relevant' : ''}`}>{draft.title.length}/240</span></div><input ref={titleRef} id="user-report-summary" required value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} maxLength={240} aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? 'user-report-summary-error' : 'user-report-summary-help'} placeholder={selectedChoice.titlePlaceholder} />{errors.title ? <span id="user-report-summary-error" className="user-report-field-error" role="alert">{errors.title}</span> : null}</div>
                <div className="user-report-field"><div className="user-report-field-heading"><span className="user-report-field-label-copy"><label htmlFor="user-report-explanation">{selectedChoice.explanationLabel}</label><span id="user-report-privacy-note" className="user-report-privacy-tip" role="note" tabIndex={0} aria-label={`Privacy reminder: ${PRIVACY_REMINDER}`} data-tooltip={PRIVACY_REMINDER}><UtilityIcon kind="privacy" /></span></span><span className={`user-report-character-count${draft.explanation.length >= 32_000 ? ' is-relevant' : ''}`}>{draft.explanation.length.toLocaleString()}/40,000</span></div><textarea id="user-report-explanation" required value={draft.explanation} onChange={(event) => updateDraft('explanation', event.target.value)} rows={6} maxLength={40_000} aria-invalid={Boolean(errors.explanation)} aria-describedby={errors.explanation ? 'user-report-explanation-error' : 'user-report-privacy-note'} placeholder={selectedChoice.explanationPlaceholder} />{errors.explanation ? <span id="user-report-explanation-error" className="user-report-field-error" role="alert">{errors.explanation}</span> : null}{titleSuggestion ? <button type="button" className="user-report-title-suggestion" onClick={() => { updateDraft('title', titleSuggestion); requestAnimationFrame(() => titleRef.current?.focus()); }}>Use as title: “{titleSuggestion}”</button> : null}</div>
              </div>

              <div className="user-report-additions" aria-label="Optional additions">
                <div className="user-report-addition-choices">
                  <button type="button" className={additions.screenshot ? 'is-open' : ''} aria-expanded={additions.screenshot} onClick={() => toggleAddition('screenshot')}><UtilityIcon kind="screenshot" /><span><strong>Add a screenshot</strong><small>Show us exactly what you see</small></span><b>+</b></button>
                  <button type="button" className={additions.contact ? 'is-open' : ''} aria-expanded={additions.contact} onClick={() => toggleAddition('contact')}><UtilityIcon kind="contact" /><span><strong>Get a reply</strong><small>Leave contact details for follow-up</small></span><b>+</b></button>
                </div>
                {additions.screenshot ? <section className="user-report-addition-panel user-report-screenshot" data-addition-panel="screenshot" aria-label="Add a screenshot">
                  {bootstrap.screenshotAvailable ? <><input ref={screenshotInputRef} className="user-report-file-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Add screenshot image" onChange={(event) => chooseScreenshot(event.target.files?.[0])} />{editingScreenshot && screenshot && screenshotPreview ? <ScreenshotEditor file={screenshot} src={screenshotPreview} onApply={chooseScreenshot} onCancel={() => setEditingScreenshot(false)} /> : screenshot ? <div className="user-report-screenshot-preview">{screenshotPreview ? <img src={screenshotPreview} alt="Screenshot preview for this report" /> : null}<div><strong>{screenshot.name}</strong><small>{fileSizeLabel(screenshot.size)} · stays local until you send</small></div><div className="user-report-screenshot-actions"><button type="button" className="user-report-secondary" onClick={() => setEditingScreenshot(true)}>Crop or cover details</button>{screenCaptureSupported() ? <button type="button" className="user-report-secondary" onClick={handleCapture}>Retake</button> : null}<button type="button" className="user-report-secondary" onClick={() => screenshotInputRef.current?.click()}>Replace</button><button type="button" className="user-report-link-button is-danger" onClick={() => { setScreenshot(null); setCaptureState({ state: 'notice', message: 'Screenshot removed.' }); }}>Remove</button></div></div> : <div className="user-report-screenshot-empty"><p>The feedback window hides itself before capture. You choose exactly what to share.</p><div>{screenCaptureSupported() ? <button type="button" className="user-report-secondary is-emphasized" onClick={handleCapture}>Capture screenshot</button> : null}<button type="button" className="user-report-secondary" onClick={() => screenshotInputRef.current?.click()}>Choose image</button></div></div>}{captureState.message ? <div className={`user-report-screenshot-message is-${captureState.state}`} role={captureState.state === 'error' ? 'alert' : 'status'}>{captureState.message}</div> : null}</> : <p className="user-report-screenshot-unavailable">Screenshots are unavailable on this server. Your text report still works.</p>}
                </section> : null}
                {additions.contact ? <section className="user-report-addition-panel user-report-contact" data-addition-panel="contact" aria-label="Contact details"><p>Add an email only if you want the team to follow up directly.</p><div className="user-report-contact-grid"><div className="user-report-field"><label htmlFor="user-report-name">Name</label><input id="user-report-name" autoComplete="name" value={draft.reporterName} onChange={(event) => updateDraft('reporterName', event.target.value)} maxLength={120} aria-invalid={Boolean(errors.reporterName)} placeholder="Your name" />{errors.reporterName ? <span className="user-report-field-error" role="alert">{errors.reporterName}</span> : null}</div><div className="user-report-field"><label htmlFor="user-report-email">Email</label><input id="user-report-email" type="email" inputMode="email" autoComplete="email" value={draft.reporterEmail} onChange={(event) => updateDraft('reporterEmail', event.target.value)} maxLength={320} aria-invalid={Boolean(errors.reporterEmail)} placeholder="you@example.com" />{errors.reporterEmail ? <span className="user-report-field-error" role="alert">{errors.reporterEmail}</span> : null}</div></div></section> : null}
              </div>

              {!online ? <div className="user-report-inline-error" role="alert">You are offline. This draft will be ready when you reconnect.</div> : null}{submitState.state === 'error' ? <div className="user-report-inline-error" role="alert">{submitState.message}{submitState.requestId ? <small>Request ID: {submitState.requestId}</small> : null}</div> : null}
              <footer className="user-report-submit-bar">
                <div className="user-report-trust-row"><details><summary>What’s included</summary><div><span>Page: {context.routeName || '#/'}</span><span>App: {context.appVersion}</span><span>Browser, {context.viewport}, {context.locale}, {context.timezone}</span>{errorCode ? <span>Error reference: {errorCode}</span> : null}</div></details><span>{draftRestored ? 'Draft restored from this session' : draftHasContent(draft) ? 'Draft saved in this browser session' : 'Sent for human review'}</span>{bootstrap.dataUseUrl ? <a href={bootstrap.dataUseUrl} target="_blank" rel="noopener noreferrer">Data use</a> : null}</div>
                <div className="user-report-actions">{draftHasContent(draft) ? <button type="button" className="user-report-link-button" onClick={discardDraft}>Discard</button> : null}<button type="button" className="user-report-secondary" onClick={closeDialog}>Close</button><button type="submit" className="user-report-primary" disabled={!canSubmit}>{submitState.state === 'submitting' ? 'Sending…' : 'Send report'}</button></div>
              </footer>
            </div> : null}
          </form>
        )}
      </section>
    </div>, document.body,
  );
}
