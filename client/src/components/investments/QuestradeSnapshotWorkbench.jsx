import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useInvestmentSnapshotWorkbench from '../../hooks/useInvestmentSnapshotWorkbench.js';
import './questrade-snapshot-workbench.css';

const STEP_LABELS = Object.freeze({
  account: 'Account',
  balances: 'Balances',
  positions: 'Positions',
  validate: 'Validate completeness',
  publish: 'Publish snapshot',
});

function friendlyValue(value) {
  return value === null || value === undefined || value === '' ? 'Unknown' : value;
}

function formatTime(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function shortReference(value) {
  const text = String(value || '');
  return text ? `${text.slice(0, 8)}…${text.slice(-4)}` : 'None';
}

function RunEvidence({ run, latestSnapshot }) {
  if (!run) {
    return <p className="snapshot-empty-copy">No verification has run for this source.</p>;
  }
  const failed = ['failed', 'incomplete'].includes(run.status);
  return (
    <>
      <div className={`snapshot-run-summary is-${run.status}`} role={failed ? 'alert' : 'status'}>
        <strong>{run.status === 'running' ? 'Verification in progress' : run.status === 'completed' ? 'Verification complete' : 'Verification incomplete'}</strong>
        <span>{failed
          ? `No new snapshot was saved${latestSnapshot ? '; the prior complete snapshot is still latest.' : '.'}`
          : run.status === 'completed' ? 'A complete saved snapshot is available.' : 'Each required section must complete before anything is published.'}</span>
      </div>
      <ol className="snapshot-step-list">
        {(run.steps || []).map((step) => (
          <li key={step.id} className={`is-${step.status}`}>
            <span className="snapshot-step-symbol" aria-hidden="true">{step.status === 'completed' ? '✓' : step.status === 'failed' ? '!' : step.status === 'running' ? '…' : '·'}</span>
            <span>{STEP_LABELS[step.id] || step.id}</span>
            <small>{step.status}</small>
          </li>
        ))}
      </ol>
      {failed && <p className="snapshot-safe-error">Stopped at {STEP_LABELS[run.failureSection] || 'verification'}. Retry when ready.</p>}
    </>
  );
}

function SnapshotEvidence({ snapshot, emptyHeadingRef }) {
  const [recordsOpen, setRecordsOpen] = useState(false);
  if (!snapshot) {
    return (
      <div className="snapshot-no-evidence">
        <strong ref={emptyHeadingRef} tabIndex="-1">No complete snapshot saved</strong>
        <p>Missing evidence is shown as unknown—not as a zero balance or empty portfolio.</p>
      </div>
    );
  }
  return (
    <>
      <dl className="snapshot-evidence-meta">
        <div><dt>Currencies</dt><dd>{snapshot.counts?.currencies ?? 0}</dd></div>
        <div><dt>Positions</dt><dd>{snapshot.counts?.positions ?? 0}</dd></div>
        <div><dt>Observed by Questrade</dt><dd>{formatTime(snapshot.observedAt)}</dd></div>
        <div><dt>Fetched by this app</dt><dd>{formatTime(snapshot.fetchedAt)}</dd></div>
        <div><dt>Snapshot reference</dt><dd>{shortReference(snapshot.snapshotId)}</dd></div>
        <div><dt>Integrity</dt><dd>Complete · {shortReference(snapshot.contentHash)}</dd></div>
      </dl>
      <div className="snapshot-currency-list" aria-label="Normalized balance evidence">
        {(snapshot.balances || []).map((balance) => (
          <div key={balance.currency}>
            <strong>{balance.currency}</strong>
            <span>Cash <b>{friendlyValue(balance.cash)}</b></span>
            <span>Equity <b>{friendlyValue(balance.totalEquity)}</b></span>
            <span>Buying power <b>{friendlyValue(balance.buyingPower)}</b></span>
          </div>
        ))}
      </div>
      <button type="button" className="snapshot-disclosure" aria-expanded={recordsOpen} onClick={() => setRecordsOpen((value) => !value)}>
        <span>View normalized records</span><span aria-hidden="true">{recordsOpen ? '⌃' : '⌄'}</span>
      </button>
      {recordsOpen && (
        <div className="snapshot-normalized-records">
          {(snapshot.positions || []).map((position) => (
            <dl key={`${position.symbol}-${position.symbolId || ''}`}>
              <div><dt>Symbol</dt><dd>{position.symbol}</dd></div>
              <div><dt>Quantity</dt><dd>{friendlyValue(position.quantity)}</dd></div>
              <div><dt>Average price</dt><dd>{friendlyValue(position.averagePrice)}</dd></div>
              <div><dt>Market value</dt><dd>{friendlyValue(position.marketValue)}</dd></div>
            </dl>
          ))}
        </div>
      )}
    </>
  );
}

function DeleteDialog({ counts, deleting, onCancel, onConfirm }) {
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const [confirmation, setConfirmation] = useState('');
  useEffect(() => {
    inputRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === 'Escape' && !deleting) onCancel();
      if (event.key !== 'Tab') return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [deleting, onCancel]);

  return createPortal(
    <div className="snapshot-delete-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) onCancel(); }}>
      <section ref={dialogRef} className="snapshot-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="snapshot-delete-title">
        <h3 id="snapshot-delete-title">Delete local investment data from this computer?</h3>
        <p>This removes {counts?.accounts || 0} account record, {counts?.runs || 0} verification run{counts?.runs === 1 ? '' : 's'}, and {counts?.snapshots || 0} snapshot{counts?.snapshots === 1 ? '' : 's'}. Questrade authorization and the rest of the app remain unchanged.</p>
        {deleting ? (
          <div className="snapshot-delete-progress" role="status" aria-live="polite">
            <span className="snapshot-delete-spinner" aria-hidden="true" />
            <span><strong>Deleting local investment data…</strong><small>Finishing securely on this computer.</small></span>
          </div>
        ) : (
          <label><span>Type <b>DELETE INVESTMENT DATA</b> to continue</span><input ref={inputRef} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
        )}
        <div className="snapshot-delete-actions">
          <button type="button" className="btn btn-ghost" disabled={deleting} onClick={onCancel}>Cancel</button>
          <button type="button" className="btn snapshot-delete-confirm" disabled={deleting || confirmation !== 'DELETE INVESTMENT DATA'} onClick={() => onConfirm(confirmation)}>{deleting ? 'Deleting…' : 'Delete local data'}</button>
        </div>
      </section>
    </div>, document.body,
  );
}

export default function QuestradeSnapshotWorkbench({ onOpenConnectedAccounts }) {
  const state = useInvestmentSnapshotWorkbench();
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [transportOpen, setTransportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [completionNotice, setCompletionNotice] = useState('');
  const deleteTriggerRef = useRef(null);
  const emptySnapshotRef = useRef(null);
  const completionTimerRef = useRef(null);
  const sawRunningVerificationRef = useRef(false);
  const run = state.workbench?.activeRun || state.workbench?.latestRun;
  const snapshot = state.workbench?.latestSnapshot;
  const ready = state.workbench?.readiness === 'ready';
  const priorSnapshotStillLatest = Boolean(snapshot && ['failed', 'incomplete'].includes(run?.status));
  const scenarioOptions = state.workbench?.scenarios || [];
  const realtimeLabel = useMemo(() => {
    if (!state.transportEnabled) return 'WebSocket off · direct progress checks available';
    if (state.transport.connected) return 'Live reconciliation ready';
    return 'Live reconciliation reconnecting';
  }, [state.transport.connected, state.transportEnabled]);

  useEffect(() => {
    const activeStatus = state.workbench?.activeRun?.status;
    if (activeStatus === 'running') {
      sawRunningVerificationRef.current = true;
      setCompletionNotice('');
      return undefined;
    }
    if (sawRunningVerificationRef.current && state.workbench?.latestRun?.status === 'completed') {
      sawRunningVerificationRef.current = false;
      setCompletionNotice('Complete snapshot saved.');
      window.clearTimeout(completionTimerRef.current);
      completionTimerRef.current = window.setTimeout(() => setCompletionNotice(''), 3200);
    }
    return undefined;
  }, [state.workbench?.activeRun?.status, state.workbench?.latestRun?.runId, state.workbench?.latestRun?.status]);

  useEffect(() => () => window.clearTimeout(completionTimerRef.current), []);

  async function runVerification() {
    try {
      await state.run();
      setAnnouncement('Snapshot verification started.');
    } catch { /* The visible error is supplied by the hook. */ }
  }

  async function confirmDelete(value) {
    try {
      await state.deleteLocalData(value);
      setDeleteOpen(false);
      setAnnouncement('Local investment data deleted. Questrade remains connected.');
      window.setTimeout(() => emptySnapshotRef.current?.focus(), 0);
    } catch { /* The dialog stays open and the workbench shows the safe error. */ }
  }

  if (!import.meta.env.DEV) return null;

  return (
    <section className="snapshot-workbench" data-development-only="questrade-snapshot-reconciliation" aria-labelledby="snapshot-workbench-title">
      <div className="sr-only" aria-live="polite">{announcement}</div>
      <header className="snapshot-workbench-header">
        <div>
          <span className="snapshot-development-label">Development-only verification</span>
          <h3 id="snapshot-workbench-title">Questrade snapshot reconciliation</h3>
          <p>Create and inspect one complete saved portfolio copy before the Investments workspace is built.</p>
        </div>
        <span className={`snapshot-transport-state${state.transport.connected && state.transportEnabled ? ' is-ready' : ''}`}>{realtimeLabel}</span>
      </header>

      <div className="snapshot-command-bar">
        <label><span>Source</span><select value={state.source} onChange={(event) => state.setSource(event.target.value)}><option value="simulated">Safe simulation</option><option value="live">Connected Margin account</option></select></label>
        {state.source === 'simulated' && <label className="snapshot-scenario-select"><span>Verification case</span><select value={state.workbench?.scenario || ''} disabled={state.loading || Boolean(state.workbench?.activeRun)} onChange={(event) => state.selectScenario(event.target.value)}>{scenarioOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}
        <button type="button" className="btn btn-primary snapshot-run-button" disabled={state.loading || state.starting || Boolean(state.workbench?.activeRun) || !ready} onClick={runVerification}>{state.starting ? 'Starting…' : state.workbench?.activeRun ? 'Verification running…' : 'Run snapshot verification'}</button>
      </div>

      <p className="snapshot-trust-line">Simulation never contacts Questrade. Live verification is manual and read-only. Nothing runs at startup.</p>
      {completionNotice && <p className="snapshot-completion-notice" role="status"><span aria-hidden="true">✓</span>{completionNotice}</p>}
      {state.loading && <p className="snapshot-loading" role="status">Loading saved snapshot state…</p>}
      {state.error && <p className="snapshot-workbench-error" role="alert">{state.error}</p>}
      {!state.loading && !ready && (
        <div className="snapshot-blocked-state">
          <div><strong>Live verification is not ready</strong><p>{state.workbench?.sourceError?.message || 'Connect Questrade before running a live snapshot verification.'}</p></div>
          <button type="button" className="btn btn-ghost" onClick={onOpenConnectedAccounts}>Open Connected Accounts</button>
        </div>
      )}

      <div className="snapshot-work-area">
        <section aria-labelledby="snapshot-current-title">
          <div className="snapshot-section-heading"><div><span>Current verification</span><h4 id="snapshot-current-title">Required sections</h4></div>{run?.status === 'completed' && <b className="is-complete">Complete</b>}</div>
          <RunEvidence run={run} latestSnapshot={snapshot} />
        </section>
        <section aria-labelledby="snapshot-latest-title">
          <div className="snapshot-section-heading"><div><span>Saved evidence</span><h4 id="snapshot-latest-title">Latest complete snapshot</h4></div>{snapshot && <b className="is-complete">{priorSnapshotStillLatest ? 'Still latest · ' : ''}Integrity confirmed</b>}</div>
          <SnapshotEvidence snapshot={snapshot} emptyHeadingRef={emptySnapshotRef} />
        </section>
      </div>

      <div className="snapshot-secondary-sections">
        <section>
          <button type="button" className="snapshot-secondary-trigger" aria-expanded={transportOpen} onClick={() => setTransportOpen((value) => !value)}><span><strong>Transport recovery checks</strong><small>{state.transportNotice || 'Socket events trigger authoritative REST refetches.'}</small></span><span aria-hidden="true">{transportOpen ? '⌃' : '⌄'}</span></button>
          {transportOpen && <div className="snapshot-secondary-content snapshot-transport-controls">
            <label><input type="checkbox" checked={state.transportEnabled} onChange={(event) => state.setTransportEnabled(event.target.checked)} /> Use WebSocket transport</label>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!state.transportEnabled} onClick={state.dropAndReconnect}>Drop and reconnect</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!state.transportEnabled || !state.workbench?.account} onClick={state.forceReplayGap}>Force replay gap</button>
          </div>}
        </section>
        <section>
          <button type="button" className="snapshot-secondary-trigger" aria-expanded={privacyOpen} onClick={() => setPrivacyOpen((value) => !value)}><span><strong>Local data and privacy</strong><small>{state.workbench?.storedCounts?.total || 0} Stage 3A record{state.workbench?.storedCounts?.total === 1 ? '' : 's'} stored on this computer.</small></span><span aria-hidden="true">{privacyOpen ? '⌃' : '⌄'}</span></button>
          {privacyOpen && <div className="snapshot-secondary-content"><p>Deletion removes snapshot records only. It does not disconnect Questrade or affect any other feature.</p><button ref={deleteTriggerRef} type="button" className="btn snapshot-delete-trigger" disabled={!state.workbench?.storedCounts?.total} onClick={() => setDeleteOpen(true)}>Delete local investment data…</button></div>}
        </section>
      </div>

      {deleteOpen && <DeleteDialog counts={state.workbench?.storedCounts} deleting={state.deleting} onCancel={() => { setDeleteOpen(false); window.setTimeout(() => deleteTriggerRef.current?.focus(), 0); }} onConfirm={confirmDelete} />}
    </section>
  );
}
