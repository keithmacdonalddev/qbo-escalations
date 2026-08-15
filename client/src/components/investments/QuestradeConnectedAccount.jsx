import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import ConnectedAccountCard from '../connected-accounts/ConnectedAccountCard.jsx';
import './questrade-connected-account.css';

function QuestradeMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.25 16.25 9.1 12.4l2.75 2.75 6.9-7.15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.75 8h4v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.25 5.25v13.5h13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

function StateGlyph({ tone }) {
  if (tone === 'connected') {
    return <path d="m7.5 12 3 3 6-7" />;
  }
  if (tone === 'warning') {
    return <><path d="M12 7.5v5" /><path d="M12 16.5h.01" /></>;
  }
  if (tone === 'danger') {
    return <><path d="m9 9 6 6" /><path d="m15 9-6 6" /></>;
  }
  return <><path d="M12 10v6" /><path d="M12 7.5h.01" /></>;
}

function toneForState(state) {
  if (state === 'connected') return 'connected';
  if (['blocked', 'unavailable'].includes(state)) return 'danger';
  if (['reauthorization-required', 'locked', 'degraded'].includes(state)) return 'warning';
  return 'disconnected';
}

function formatSavedTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export default function QuestradeConnectedAccount({ connection }) {
  const reducedMotion = useReducedMotion();
  const data = connection.data;
  const statusLabel = connection.loading ? 'Checking...' : data?.statusLabel || (connection.error ? 'Unavailable' : 'Not connected');
  const statusTone = connection.loading ? 'loading' : connection.error ? 'danger' : toneForState(data?.state);
  const transition = reducedMotion ? { duration: 0 } : { duration: 0.18 };
  const summary = data?.state === 'disconnected' ? 'Questrade is not connected.' : data?.summary;
  const action = data?.state === 'disconnected'
    ? 'Live access is off, and no token or portfolio data is saved.'
    : data?.action;

  return (
    <ConnectedAccountCard
      className="questrade-account-card"
      icon={<QuestradeMark />}
      providerName="Questrade"
      providerDescription={`${data?.accountType || 'Margin'} account · ${data?.mode === 'simulated' ? 'Simulated preview' : 'Personal investments'}`}
      statusLabel={statusLabel}
      statusTone={statusTone}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={connection.loading ? 'loading' : data?.scenario || data?.state || 'error'}
          className="settings-accounts-body questrade-account-body"
          initial={{ opacity: 0, y: reducedMotion ? 0 : 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reducedMotion ? 0 : -5 }}
          transition={transition}
        >
          {connection.loading ? (
            <div className="settings-accounts-skeleton" aria-label="Checking Questrade connection">
              <div className="settings-accounts-skeleton-line" style={{ width: '72%' }} />
              <div className="settings-accounts-skeleton-line" style={{ width: '52%' }} />
            </div>
          ) : connection.error ? (
            <div className="questrade-state-message is-danger" role="alert">
              <strong>Status could not be loaded</strong>
              <p>{connection.error}</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={connection.refresh}>Try again</button>
            </div>
          ) : (
            <>
              <div className={`questrade-state-message is-${statusTone}`} role={statusTone === 'danger' ? 'alert' : 'status'}>
                <span className="questrade-state-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <StateGlyph tone={statusTone} />
                  </svg>
                </span>
                <span className="questrade-state-copy">
                  <strong>{summary}</strong>
                  <p>{action}</p>
                </span>
              </div>

              {(data.safeAccountId || data.lastSuccessfulSyncAt) && (
                <dl className="questrade-safe-details">
                  {data.safeAccountId && <div><dt>Account label</dt><dd>{data.safeAccountId}</dd></div>}
                  {data.lastSuccessfulSyncAt && <div><dt>Last complete save</dt><dd>{formatSavedTime(data.lastSuccessfulSyncAt)}</dd></div>}
                  {data.previousSnapshotAvailable && <div><dt>Saved data</dt><dd>Previous complete snapshot preserved</dd></div>}
                </dl>
              )}

              {data.fixtureControlsAvailable && (
                <details className="questrade-preview-tools">
                  <summary role="button" aria-label="Preview Questrade connection states">
                    <span>
                      <strong>Preview connection states</strong>
                      <small>Stage 1 · simulated only</small>
                    </span>
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
                  </summary>
                  <div className="questrade-preview-content">
                    <label className="questrade-scenario-control">
                      <span>Connection state</span>
                      <select
                        value={data.scenario}
                        disabled={connection.changingScenario}
                        onChange={(event) => connection.selectScenario(event.target.value)}
                        aria-label="Simulated Questrade state"
                      >
                        {(data.scenarios || []).map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.label}</option>)}
                      </select>
                    </label>
                    <p>No Questrade request or token is used. No financial values are loaded in this preview.</p>
                  </div>
                </details>
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </ConnectedAccountCard>
  );
}
