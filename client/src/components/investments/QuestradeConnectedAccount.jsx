import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import ConnectedAccountCard from '../connected-accounts/ConnectedAccountCard.jsx';
import './questrade-connected-account.css';

function QuestradeMark() {
  return (
    <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="6" fill="currentColor" opacity="0.13" />
      <path d="M7.3 7.1h9.4v3.1h-2.9v6.7h-3.6v-6.7H7.3V7.1Z" fill="currentColor" />
      <path d="m14.1 14.7 2.6 2.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
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

  return (
    <ConnectedAccountCard
      className="questrade-account-card"
      icon={<QuestradeMark />}
      providerName="Questrade"
      providerDescription="Personal investments"
      statusLabel={statusLabel}
      statusTone={statusTone}
      badges={[data?.accountType || 'Margin', data?.mode === 'simulated' ? 'Simulated' : 'Read-only']}
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
                <strong>{data.summary}</strong>
                <p>{data.action}</p>
              </div>

              {(data.safeAccountId || data.lastSuccessfulSyncAt) && (
                <dl className="questrade-safe-details">
                  {data.safeAccountId && <div><dt>Safe account label</dt><dd>{data.safeAccountId}</dd></div>}
                  {data.lastSuccessfulSyncAt && <div><dt>Last complete save</dt><dd>{formatSavedTime(data.lastSuccessfulSyncAt)}</dd></div>}
                  {data.previousSnapshotAvailable && <div><dt>Saved data</dt><dd>Previous complete snapshot preserved</dd></div>}
                </dl>
              )}

              {data.fixtureControlsAvailable && (
                <label className="questrade-scenario-control">
                  <span><strong>Stage 1 test state</strong><small>Simulated only. No Questrade request or token is used.</small></span>
                  <select
                    value={data.scenario}
                    disabled={connection.changingScenario}
                    onChange={(event) => connection.selectScenario(event.target.value)}
                    aria-label="Simulated Questrade state"
                  >
                    {(data.scenarios || []).map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.label}</option>)}
                  </select>
                </label>
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </ConnectedAccountCard>
  );
}
