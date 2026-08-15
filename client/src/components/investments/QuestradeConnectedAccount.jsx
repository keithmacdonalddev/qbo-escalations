import { useEffect, useRef, useState } from 'react';
import ConnectedAccountCard from '../connected-accounts/ConnectedAccountCard.jsx';
import AnchoredSettingsControl from '../connected-accounts/AnchoredSettingsControl.jsx';
import './questrade-connected-account.css';

const QUESTRADE_MARK_SRC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAExUlEQVR4AcRWXWgcVRT+zuwmsa02UUtLQCyKCkpQChHT7AatWLQ/+bHRCAoKVYlYbB9KQQxiKthCH4pWSBEULWKVFtPsNsZoUyJmN60aSQpifVBRjA2NihhLu5ufOX53N7OZmf1tfOhwz5xzvnPuud/MnXvnWrjCV0kEVFW+1MidMY08F9OeA0MaORrX470xjfRQ3h7S6ItD2vPAsB5ZcrnPU5DAsPZfxwFejiP6ExPPsPhBQF4Q4BGFvQlAM+Vpge4VyAkbFZPMPzSskTXES2qsm53HJ7biGt0+h8TPjL5KuYlSSruaSU/awLcxjX4Q1+6V9Au2LAKjeqwqhmifQt/gU1UW7J0/KIA+rgiMDWtPff40wENgQLuvvwDrCwEezN1JEoAwLl0cYI8C+wF0k+wEda5WbQMD5vvIFTSYZW5GRnSk7CoEjglwl/F9cl4g24MIrgpL07qQNG0LS0tHgzTvDEtz60mM3cD8+ykDFF+TJezbzemo8QVSboZAEudeIdJA8beoInA7B32zTjZO+YPG75ROm0QGKesFupUY3xTvC+0ahfVhn/ZVLEBpK0VgSLtvA3RXGnLf5fA5JLc0yOa/3WghOyQt7zLexHrT1K4mNZWY2eECUmaKgCDQwfksh/caXYXg1jZpm/PCxb2wNJ8AZCd8F8fYNaLHl7phy6x1Bh5zg7SV89Z+q2xM0l5UG8BoF2t87eu8IgH7UTdm2Ug2CuCbG+nnnH/jTrxc23wXAtmb3U9a3ZiZgnVuwNh8I+8b/X+lHNWfsIbv+9F7VdWMyxBS+0DWsrMwezIVLXDjTtd+WvuWF0hBrdTO8GOM+XKWn0L0ZgcjE7nRceb1ZEi2TM7beZUAdbOY7i9GgnnfZxexVjsYCah/u/3DCRbXsrYYCU7nn/463DmrHMwQIEnHXYwuTiK7qp0Z01KIf3dbkd2hGJKfBEfKUS+QGdPi1jnuLi+QlV/xp+TGSrNzk+AWfIe/vwX5zcHMG/jOcYzm/EgSVtbSNDG3COBbXibqJWF+cFwFYRNxyaUy/P6j41tkM+Q4jmbxJxw7v050COTz7PgCiWlMmFPTte4cPuBwrbRzeaZRK4BglCzttJu+C6Qxrr05f5/pDKBe2i4JEi3MzUvChv2Sk+9oPvDHjm20xV/sOIt8ahyXBGzMvjWog0EXlmUWI8EOd1PcbaoCSw+7ASvtzL1GrZRMI6n6IKa6uG1KBsxhFCbh7cBC+2tl/T9uNEWAO98pQA7Bd7HDszwRfzSiR/yblSezFBICOStI7vN0pJMiQI0gguaw8IOxfdKWQMVZc0oe0l7PB+XOK0ZCoX8tQ2VmPKdvBuC3MBVA+QYy/RXZVzUL8JQ8ez6mkdOU9+Iaed0/PUVIhP9FsveMfrbMXT5DwIBrZcMvAcyYdTti/GyRMmL3UJ7iB2PemND2tMIk9D4/CQ8BU6lOWserkAwJrE5Wv4hFXPUFl6iXhJWrfo20TYekcXcFKm7hHrGHOZmtk3ZJrVQSOQk4I9TKQxPm/B9C02qBvYZv5HmBHBDgKIWnnd1Oak7tkGDwHUD6vIKLF5DYVpAA5i8R0ZA8PBaS5oMhadoRkuY2ymaRTs8OOp/uUYYET8nPhKVpk19YY99/AAAA///gmCdVAAAABklEQVQDAJ87yFATN5xfAAAAAElFTkSuQmCC';
const QUESTRADE_API_CENTRE_URL = 'https://apphub.questrade.com/UI/ManageApp.aspx';

export function QuestradeMark({ size = 24 }) {
  return (
    <img src={QUESTRADE_MARK_SRC} width={size} height={size} alt="" aria-hidden="true" draggable="false" />
  );
}

function Checkmark() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m3.5 8.25 2.75 2.75 6.25-6.25" /></svg>;
}

function CloseIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>;
}

function formatEvidenceTime(value) {
  if (!value) return 'No saved evidence';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No saved evidence';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function formatRelativeEvidenceTime(value) {
  if (!value) return 'Not yet verified';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Verified previously';
  const elapsedMs = Date.now() - date.getTime();
  if (elapsedMs >= 0 && elapsedMs < 90_000) return 'Just now';
  if (elapsedMs >= 0 && elapsedMs < 60 * 60_000) {
    const minutes = Math.max(1, Math.round(elapsedMs / 60_000));
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (elapsedMs >= 0 && elapsedMs < 24 * 60 * 60_000) {
    const hours = Math.max(1, Math.floor(elapsedMs / (60 * 60_000)));
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  if (elapsedMs >= 0 && elapsedMs < 7 * 24 * 60 * 60_000) {
    const days = Math.max(1, Math.floor(elapsedMs / (24 * 60 * 60_000)));
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
  return formatEvidenceTime(value);
}

const STATE_PRESENTATION = Object.freeze({
  disconnected: {
    status: 'Not connected',
    tone: 'disconnected',
    symbol: '–',
    title: 'No Questrade authorization',
    description: 'No token or portfolio data is saved. Live access remains off.',
  },
  connected: {
    status: 'Connected',
    tone: 'connected',
    symbol: 'check',
    title: 'Margin account preview is ready',
    description: 'The simulated read-only connection and its last saved evidence are available.',
  },
  'account-selection-required': {
    status: 'Choose account', tone: 'warning', symbol: '!', title: 'Choose the account to use',
    description: 'Two safe simulated account choices are available.',
  },
  partial: {
    status: 'Needs attention', tone: 'warning', symbol: '!', title: 'Some account services need attention',
    description: 'Previously confirmed evidence remains available while the failed checks are retried.',
  },
  offline: {
    status: 'Questrade unavailable', tone: 'warning', symbol: '!', title: 'Questrade could not be reached',
    description: 'The simulated saved authorization and confirmed evidence remain unchanged.',
  },
  'rate-limited': {
    status: 'Try again later', tone: 'warning', symbol: '!', title: 'Questrade asked the app to wait',
    description: 'The simulated saved authorization remains unchanged.',
  },
  'reauthorization-required': {
    status: 'Authorization required',
    tone: 'warning',
    symbol: '!',
    title: 'Authorization needs renewal',
    description: 'Updates are paused. Previously saved portfolio evidence remains available.',
  },
  'revocation-pending': {
    status: 'Revocation pending', tone: 'warning', symbol: '!', title: 'Questrade could not confirm revocation',
    description: 'The simulated app has stopped local access while remote revocation remains unconfirmed.',
  },
  blocked: {
    status: 'Unsafe server blocked',
    tone: 'danger',
    symbol: '!',
    title: 'Unsafe connection blocked',
    description: 'The app refused an unapproved server. Credentials were not sent.',
  },
  locked: {
    status: 'Credential locked',
    tone: 'warning',
    symbol: '!',
    title: 'Credential access is locked',
    description: 'The saved credential cannot be opened for the current Windows user.',
  },
  unavailable: {
    status: 'Secure storage unavailable',
    tone: 'danger',
    symbol: '!',
    title: 'Secure storage is unavailable',
    description: 'The app will not accept a token until it can protect it safely.',
  },
  degraded: {
    status: 'Questrade unavailable',
    tone: 'warning',
    symbol: '!',
    title: 'Questrade is temporarily unavailable',
    description: 'The latest refresh failed. Previously saved evidence remains available.',
  },
});

const LIVE_STATE_PRESENTATION = Object.freeze({
  disconnected: {
    status: 'Not connected',
    tone: 'disconnected',
    symbol: '–',
    title: 'Ready to connect',
    description: 'Secure storage is ready. Add a Questrade authorization token when you want to connect.',
  },
  verifying: {
    status: 'Verifying',
    tone: 'loading',
    symbol: '…',
    title: 'Verifying your Margin account…',
    description: 'The credential is protected while Questrade account services are checked.',
  },
  'account-selection-required': {
    status: 'Choose account',
    tone: 'warning',
    symbol: '!',
    title: 'Choose the account to use',
    description: 'More than one Questrade account is available. Select the Margin account for this workspace.',
  },
  connected: {
    status: 'Connected',
    tone: 'connected',
    symbol: 'check',
    title: 'Questrade is connected',
    description: 'Balances, positions, orders, and executions completed a read-only access check.',
  },
  partial: {
    status: 'Needs attention',
    tone: 'warning',
    symbol: '!',
    title: 'Some account services need attention',
    description: 'The authorization is saved, but one or more read-only checks did not complete.',
  },
  'verification-failed': {
    status: 'Could not verify',
    tone: 'warning',
    symbol: '!',
    title: 'The account could not be verified',
    description: 'The authorization is protected. Try the account check again when Questrade is available.',
  },
  offline: {
    status: 'Questrade unavailable',
    tone: 'warning',
    symbol: '!',
    title: 'Questrade could not be reached',
    description: 'The saved authorization is unchanged. Try the account check again when the service is available.',
  },
  'rate-limited': {
    status: 'Try again later',
    tone: 'warning',
    symbol: '!',
    title: 'Questrade asked the app to wait',
    description: 'The saved authorization is unchanged. Wait briefly, then check the account again.',
  },
  'reauthorization-required': {
    status: 'Authorization required',
    tone: 'warning',
    symbol: '!',
    title: 'Questrade authorization needs renewal',
    description: 'Generate a new authorization token in Questrade, then reconnect here.',
  },
  disconnecting: {
    status: 'Disconnecting',
    tone: 'loading',
    symbol: '…',
    title: 'Disconnecting Questrade…',
    description: 'Local access is off while Questrade revocation is confirmed.',
  },
  'revocation-pending': {
    status: 'Revocation pending',
    tone: 'warning',
    symbol: '!',
    title: 'Questrade could not confirm revocation',
    description: 'This app has stopped local access. Retry when Questrade is available, or remove the local connection after revoking it manually.',
  },
  locked: {
    status: 'Credential locked',
    tone: 'warning',
    symbol: '!',
    title: 'The saved authorization is locked',
    description: 'This Windows user cannot open the saved credential. Local access remains off.',
  },
  unavailable: {
    status: 'Unavailable',
    tone: 'danger',
    symbol: '!',
    title: 'Secure storage is unavailable',
    description: 'The app will not accept a token until it can protect it safely.',
  },
});

export function getQuestradePresentation(connection) {
  if (connection?.operation) {
    const active = {
      reauthorizing: ['Renewing authorization', 'Questrade authorization is being renewed and checked.'],
      verifying: ['Checking account access', 'Balances, positions, orders, and executions are being checked.'],
      disconnecting: ['Disconnecting Questrade', 'Local access is off while Questrade revocation is confirmed.'],
      revoking: ['Retrying revocation', 'Local access remains off while Questrade is contacted again.'],
      forgetting: ['Removing local connection', 'The saved local connection is being removed.'],
    }[connection.operation];
    if (active) return { status: active[0], tone: 'loading', symbol: '…', title: `${active[0]}…`, description: active[1] };
  }
  if (connection?.loading) {
    return {
      status: 'Checking', tone: 'loading', symbol: '…', title: 'Checking account access…',
      description: 'The current simulated connection state is loading.',
    };
  }
  if (connection?.error) {
    return {
      status: 'Check failed', tone: 'warning', symbol: '!', title: 'Status could not be refreshed',
      description: 'The latest local check failed. Try again without changing the saved state.',
    };
  }
  const states = connection?.data?.mode === 'live' ? LIVE_STATE_PRESENTATION : STATE_PRESENTATION;
  return states[connection?.data?.state] || states.disconnected;
}

export function QuestradeDeveloperPreview({ connection }) {
  const data = connection?.data;

  if (!import.meta.env.DEV || !data?.fixtureControlsAvailable) return null;

  return (
    <section className="questrade-developer-preview" aria-label="Questrade state simulator" data-development-only="true">
      <div>
        <strong>State simulator</strong>
        <span>Changes only the safe local preview below.</span>
      </div>
      <label className="questrade-scenario-control">
        <span>Simulated state</span>
        <select
          value={data.scenario}
          disabled={connection.changingScenario}
          onChange={(event) => connection.selectScenario(event.target.value)}
          aria-label="Simulated Questrade state"
        >
          {(data.scenarios || []).map((scenario) => (
            <option key={scenario.id} value={scenario.id}>{scenario.label}</option>
          ))}
        </select>
      </label>
    </section>
  );
}

export function QuestradeAccountDetails({ connection, onBack, backRef, simulator = false, embedded = false, transitionClassName = '' }) {
  const data = connection?.data || {};
  const presentation = getQuestradePresentation(connection);
  const hasSavedEvidence = Boolean(data.lastSuccessfulSyncAt || data.previousSnapshotAvailable);
  const simulated = simulator || data.mode === 'simulated' || data.fixtureControlsAvailable === true;
  const live = data.mode === 'live' || simulator;
  const isFirstConnection = live && data.state === 'disconnected';
  const isReauthorization = live && data.state === 'reauthorization-required';
  const canRetryVerification = live
    && data.canRetryVerification
    && ['partial', 'verification-failed', 'offline', 'rate-limited'].includes(data.state);
  const revocationPending = live && data.state === 'revocation-pending';
  const canDisconnect = live && data.canDisconnect && !revocationPending;
  const focusConnectionAction = !embedded
    && data.secureStorageReady
    && (isFirstConnection || isReauthorization);
  const hasAccountContext = Boolean(data.selectedAccountKey || data.lastVerifiedAt || data.lastSuccessfulSyncAt)
    || (Array.isArray(data.accounts) && data.accounts.length > 0);
  const isConnectedRestingState = live
    && data.state === 'connected'
    && !connection?.loading
    && !connection?.error
    && !connection?.operation;
  const selectedAccountLabel = data.accounts?.find((account) => account.accountKey === data.selectedAccountKey)?.label
    || 'Margin account';
  const [showTokenEntry, setShowTokenEntry] = useState(false);
  const [token, setToken] = useState('');
  const [localError, setLocalError] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const tokenBusy = connection?.connecting || connection?.operation === 'reauthorizing';
  const connectButtonRef = useRef(null);
  const disconnectButtonRef = useRef(null);
  const restoreConnectFocusRef = useRef(false);
  const restoreDisconnectFocusRef = useRef(false);
  const Title = embedded ? 'h3' : 'h2';
  const showConnectedRestingState = hasAccountContext && (
    isConnectedRestingState
    || (confirmation === 'disconnect' && live && data.state === 'connected')
  );

  useEffect(() => {
    if (!showTokenEntry && restoreConnectFocusRef.current) {
      restoreConnectFocusRef.current = false;
      connectButtonRef.current?.focus();
    }
  }, [showTokenEntry]);

  useEffect(() => {
    if (!confirmation && restoreDisconnectFocusRef.current) {
      restoreDisconnectFocusRef.current = false;
      disconnectButtonRef.current?.focus();
    }
  }, [confirmation]);

  function cancelConfirmation() {
    if (connection?.operation) return;
    restoreDisconnectFocusRef.current = confirmation === 'disconnect';
    setLocalError('');
    setConfirmation('');
  }

  async function submitToken(event) {
    event.preventDefault();
    if (!token.trim() || tokenBusy) return;
    setLocalError('');
    try {
      await (isReauthorization ? connection.reauthorize(token) : connection.connect(token));
      setToken('');
      setShowTokenEntry(false);
    } catch (error) {
      setLocalError(error.message || 'Questrade could not be connected.');
    }
  }

  async function chooseAccount(accountKey) {
    setLocalError('');
    try {
      await connection.selectAccount(accountKey);
    } catch (error) {
      setLocalError(error.message || 'That account could not be selected.');
    }
  }

  async function runConfirmedAction() {
    setLocalError('');
    try {
      if (confirmation === 'disconnect') await connection.disconnect();
      if (confirmation === 'forget') await connection.forgetLocal();
      setConfirmation('');
    } catch (error) {
      setLocalError(error.message || 'The Questrade connection could not be updated.');
    }
  }

  return (
    <div className={`${embedded ? 'settings-v2-control-group questrade-simulation-panel' : 'settings-panel settings-accounts-stage'} questrade-settings-detail${confirmation === 'disconnect' ? ' is-confirming-disconnect' : ''}${transitionClassName}`} data-account-view={simulator ? 'questrade-simulator' : 'questrade'} data-development-only={simulator || undefined}>
      <header className="settings-account-detail-header" aria-hidden={confirmation === 'disconnect' ? 'true' : undefined} inert={confirmation === 'disconnect' ? true : undefined}>
        <div className="settings-account-detail-title">
          <span className="settings-account-detail-logo questrade-detail-logo"><QuestradeMark size={26} /></span>
          <div>
            <Title>{simulator ? 'Questrade Simulation' : 'Questrade'}</Title>
            {showConnectedRestingState ? (
              <p className="questrade-connected-byline">
                <span className="questrade-connected-status" role="status"><Checkmark />Connected</span>
                <span aria-hidden="true">·</span>
                <span title={`Verified ${formatEvidenceTime(data.lastVerifiedAt || data.lastSuccessfulSyncAt)}`}>Verified {formatRelativeEvidenceTime(data.lastVerifiedAt || data.lastSuccessfulSyncAt)}</span>
              </p>
            ) : (
              <p>{simulator ? 'Select a safe local state to review the preview.' : 'Read-only Margin account settings'}</p>
            )}
          </div>
        </div>
        <div className="questrade-detail-header-actions">
          {!embedded && !confirmation && <button ref={backRef} type="button" className="settings-account-detail-close" onClick={onBack} aria-label={`Close ${simulator ? 'Questrade simulation' : 'Questrade account settings'}`} autoFocus={!focusConnectionAction}>
            <CloseIcon />
          </button>}
        </div>
      </header>

      {simulator && <QuestradeDeveloperPreview connection={connection} />}

      {!simulator && simulated && <p className="questrade-preview-notice">Simulated data · No token is stored and Questrade is not contacted.</p>}

      <div className="settings-account-detail-surface" aria-hidden={confirmation === 'disconnect' ? 'true' : undefined} inert={confirmation === 'disconnect' ? true : undefined}>
        {!showTokenEntry && !isFirstConnection && !confirmation && !isConnectedRestingState && (
          <section className={`settings-account-health-summary is-${presentation.tone === 'connected' ? 'connected' : presentation.tone === 'danger' ? 'danger' : presentation.tone === 'warning' ? 'warning' : 'neutral'}`} aria-labelledby="questrade-health-title">
            <div className="settings-account-health-symbol" aria-hidden="true">{presentation.symbol === 'check' ? <Checkmark /> : presentation.symbol}</div>
            <div><h3 id="questrade-health-title">{presentation.title}</h3><p>{presentation.description}</p></div>
            {connection?.error && (
              <button type="button" className="settings-account-secondary-action" onClick={connection.refresh}>Try again</button>
            )}
          </section>
        )}

        {connection?.completion && !confirmation && (
          <p className="questrade-completion-message" role="status">
            {connection.completion === 'forgot-local'
              ? 'Local Questrade connection removed. Revoke the authorization in Questrade if it is still listed there.'
              : 'Questrade disconnected. Local access is off.'}
          </p>
        )}

        {live && data.state === 'account-selection-required' && (
          <section className="settings-account-section questrade-account-choice" aria-labelledby="questrade-account-choice-title">
            <div>
              <h3 id="questrade-account-choice-title">Available accounts</h3>
              <p>Only the account you choose will be used by this workspace.</p>
            </div>
            <div className="questrade-account-choice-list">
              {(data.accounts || []).map((account) => (
                <button
                  key={account.accountKey}
                  type="button"
                  onClick={() => chooseAccount(account.accountKey)}
                  disabled={connection.selectingAccount}
                >
                  <span><strong>{account.label}</strong><small>{account.status || 'Available'}</small></span>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {live && (isFirstConnection || isReauthorization) && data.secureStorageReady && !confirmation && (
          <section className={`settings-account-section questrade-connect-section${isFirstConnection ? ' is-first-connection' : ''}`} aria-labelledby="questrade-connect-title">
            {!showTokenEntry ? (
              <div className="questrade-connect-summary">
                <div>
                  <h3 id="questrade-connect-title">{isReauthorization ? 'Reconnect your Margin account' : 'Connect your Margin account'}</h3>
                  <p>View balances, positions, orders, and executions with read-only access. Trading remains unavailable.</p>
                  <span className="questrade-connect-assurance">Your authorization is encrypted by this app before it is saved.</span>
                </div>
                <button ref={connectButtonRef} type="button" className="settings-accounts-primary-action" onClick={() => setShowTokenEntry(true)} autoFocus={focusConnectionAction}>{isReauthorization ? 'Reconnect Questrade…' : 'Connect Questrade…'}</button>
              </div>
            ) : (
              <form className="questrade-token-form" onSubmit={submitToken}>
                <div>
                  <h3 id="questrade-connect-title">{isReauthorization ? 'Reconnect Questrade' : 'Connect Questrade'}</h3>
                  <p>Generate a new authorization token in Questrade, then return here to finish connecting.</p>
                </div>
                {!simulator && <div className="questrade-token-guide">
                  <div>
                    <strong>Generate an authorization token</strong>
                    <span>Open your personal application in Questrade API Centre and choose Generate new token.</span>
                  </div>
                  <a href={QUESTRADE_API_CENTRE_URL} target="_blank" rel="noreferrer">Open Questrade <span aria-hidden="true">↗</span></a>
                </div>}
                <label>
                  <span>{simulator ? 'Safe sample token' : 'Authorization token'}</span>
                  <input
                    type="password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck="false"
                    disabled={tokenBusy}
                    aria-describedby="questrade-token-help"
                    autoFocus
                  />
                </label>
                <p id="questrade-token-help" className="questrade-token-help">
                  {simulator
                    ? 'Any sample text advances this safe local simulation. It is not sent or stored.'
                    : 'It is sent only to this local app, encrypted before saving, and never shown here again.'}
                </p>
                <div className="questrade-token-actions">
                  <button type="button" className="settings-account-secondary-action" disabled={tokenBusy} onClick={() => { restoreConnectFocusRef.current = true; setToken(''); setLocalError(''); setShowTokenEntry(false); }}>Cancel</button>
                  <button type="submit" className="settings-accounts-primary-action" disabled={tokenBusy || !token.trim()}>
                    {tokenBusy ? (isReauthorization ? 'Renewing…' : 'Connecting…') : (isReauthorization ? 'Renew authorization' : 'Connect account')}
                  </button>
                </div>
              </form>
            )}
          </section>
        )}

        {confirmation && !showConnectedRestingState && (
          <section className="settings-account-section questrade-confirmation" aria-labelledby="questrade-confirmation-title">
            <div>
              <h3 id="questrade-confirmation-title">
                {confirmation === 'forget' ? 'Remove the local Questrade connection?' : 'Disconnect Questrade?'}
              </h3>
              <p>
                {confirmation === 'forget'
                  ? 'Questrade has not confirmed revocation. First revoke this authorization in Questrade, then remove the protected local credential and connection record here.'
                  : 'This app will stop local access immediately and ask Questrade to revoke the authorization. Previously saved portfolio evidence will remain available.'}
              </p>
            </div>
            <div className="questrade-confirmation-actions">
              <button type="button" className="settings-account-secondary-action" disabled={Boolean(connection.operation)} onClick={cancelConfirmation}>Cancel</button>
              <button type="button" className="settings-account-danger-action" disabled={Boolean(connection.operation)} onClick={runConfirmedAction}>
                {connection.operation
                  ? (confirmation === 'forget' ? 'Removing…' : 'Disconnecting…')
                  : (confirmation === 'forget' ? 'Remove locally' : 'Disconnect')}
              </button>
            </div>
          </section>
        )}

        {(localError || connection?.error) && !(confirmation === 'disconnect' && showConnectedRestingState) && <p className="questrade-connection-error" role="alert">{localError || connection.error}</p>}

        {!showTokenEntry && showConnectedRestingState && (
          <section className="questrade-connected-resting" aria-label="Connected Questrade account">
            <div className="questrade-connected-content">
              <div className="questrade-connected-access-summary">
                <div>
                  <h3>{simulated ? 'Margin demo' : selectedAccountLabel}</h3>
                  <p>Read-only portfolio access to balances, positions, orders, and executions.</p>
                </div>
                <AnchoredSettingsControl
                  label="Access details"
                  accessibleLabel="View read-only access details"
                  popoverLabel="Read-only access details"
                  placement="end"
                  layered
                  layeredSide="below"
                  flyoutClassName="questrade-access-flyout"
                >
                    <dl className="questrade-access-boundaries">
                      <div><dt>Portfolio data</dt><dd>Read-only</dd></div>
                      <div><dt>Market data</dt><dd>Not requested</dd></div>
                      <div><dt>Trading</dt><dd>Not permitted</dd></div>
                    </dl>
                </AnchoredSettingsControl>
              </div>
              {canDisconnect && (
                <div className="questrade-connected-footer">
                  <button ref={disconnectButtonRef} type="button" className="questrade-disconnect-link" aria-label="Disconnect Questrade" disabled={Boolean(connection.operation)} onClick={() => setConfirmation('disconnect')}>
                    <span>Disconnect Questrade…</span>
                  </button>
                </div>
              )}
            </div>

          </section>
        )}

        {!showTokenEntry && !confirmation && hasAccountContext && !isConnectedRestingState && (
          <>
            <section className="settings-account-section" aria-labelledby="questrade-account-title">
              <div className="settings-account-section-heading">
                <div><h3 id="questrade-account-title">Account</h3><p>{simulated ? 'This preview contains no account number, holdings, balances, or token.' : 'Account identifiers and credentials remain protected.'}</p></div>
              </div>
              <dl className="questrade-account-facts">
                <div><dt>Account</dt><dd>{simulated && (data.state === 'connected' || hasSavedEvidence) ? 'Margin demo' : selectedAccountLabel}</dd></div>
                <div><dt>Access</dt><dd>Read-only</dd></div>
                <div><dt>Live connection</dt><dd>{live && ['connected', 'partial'].includes(data.state) ? 'On' : 'Off'}</dd></div>
                <div><dt>Authorization</dt><dd>{presentation.status}</dd></div>
                <div><dt>Service checks</dt><dd>{live && data.state === 'connected' ? 'Completed' : live && data.lastCheckAt ? 'Attention needed' : 'Not completed'}</dd></div>
                <div><dt>Last confirmed</dt><dd>{formatEvidenceTime(data.lastVerifiedAt || data.lastSuccessfulSyncAt)}</dd></div>
              </dl>
            </section>

            {live && (canRetryVerification || isReauthorization || canDisconnect || revocationPending) && (
              <section className="settings-account-section questrade-connection-actions" aria-labelledby="questrade-actions-title">
                <div>
                  <h3 id="questrade-actions-title">Connection</h3>
                  <p>
                    {revocationPending
                      ? 'Local access is already off. Finish revocation or deliberately remove only the local connection.'
                      : isReauthorization
                        ? 'Renew only when Questrade reports that authorization or permission is missing.'
                        : canRetryVerification
                          ? 'Retry the read-only checks without replacing previously confirmed evidence.'
                          : 'Disconnecting stops this app from accessing Questrade.'}
                  </p>
                </div>
                <div className="questrade-connection-action-buttons">
                  {canRetryVerification && (
                    <button type="button" className="settings-account-secondary-action" disabled={Boolean(connection.operation)} onClick={() => connection.retryVerification().catch(() => {})}>
                      {connection.operation === 'verifying' ? 'Checking…' : 'Try again'}
                    </button>
                  )}
                  {revocationPending && (
                    <>
                      <button type="button" className="settings-accounts-primary-action" disabled={Boolean(connection.operation)} onClick={() => connection.retryRevocation().catch(() => {})}>
                        {connection.operation === 'revoking' ? 'Retrying…' : 'Retry revocation'}
                      </button>
                      <button type="button" className="settings-account-secondary-action" disabled={Boolean(connection.operation)} onClick={() => setConfirmation('forget')}>Remove locally…</button>
                    </>
                  )}
                  {canDisconnect && (
                    <button type="button" className="settings-account-danger-action" disabled={Boolean(connection.operation)} onClick={() => setConfirmation('disconnect')}>Disconnect…</button>
                  )}
                </div>
              </section>
            )}

            <section className="settings-account-section questrade-capabilities-section" aria-labelledby="questrade-capabilities-title">
              <div className="questrade-capability-summary">
                <div>
                  <h3 id="questrade-capabilities-title">What this connection can do</h3>
                  <p>This connection is read-only and cannot place or change trades.</p>
                </div>
                <AnchoredSettingsControl
                  label="Capabilities…"
                  accessibleLabel="View connection capabilities"
                  popoverLabel="Connection capabilities"
                >
                  <strong className="anchored-settings-heading">Connection capabilities</strong>
                  <dl className="questrade-capability-list">
                    <div><dt>Portfolio</dt><dd>Balances, positions, orders, and executions</dd></div>
                    <div><dt>Market data</dt><dd>Not enabled in this stage</dd></div>
                    <div><dt>Trading</dt><dd>Not allowed</dd></div>
                  </dl>
                </AnchoredSettingsControl>
              </div>
            </section>
          </>
        )}
      </div>

      {confirmation === 'disconnect' && showConnectedRestingState && (
        <div className="questrade-disconnect-confirmation-backdrop">
          <section
            className="questrade-disconnect-confirmation-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="questrade-disconnect-confirmation-title"
            aria-describedby="questrade-disconnect-confirmation-description"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !connection?.operation) {
                event.preventDefault();
                event.stopPropagation();
                cancelConfirmation();
              }
            }}
          >
            <div className="questrade-disconnect-confirmation-copy">
              <h3 id="questrade-disconnect-confirmation-title">Disconnect Questrade?</h3>
              <p id="questrade-disconnect-confirmation-description">Portfolio updates will stop. Saved information stays available.</p>
              {(localError || connection?.error) && <p className="questrade-connection-error" role="alert">{localError || connection.error}</p>}
            </div>
            <div className="questrade-confirmation-actions">
              <button type="button" className="settings-account-secondary-action" disabled={Boolean(connection.operation)} onClick={cancelConfirmation} autoFocus>Cancel</button>
              <button type="button" className="settings-account-danger-action" disabled={Boolean(connection.operation)} onClick={runConfirmedAction}>
                {connection.operation ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default function QuestradeConnectedAccount({ connection, onOpen, openButtonRef }) {
  const presentation = getQuestradePresentation(connection);
  return (
    <ConnectedAccountCard
      className="questrade-account-card"
      icon={<QuestradeMark />}
      providerName="Questrade"
      providerDescription="Personal investments · Margin account"
      statusLabel={presentation.status}
      statusTone={presentation.tone}
      onOpen={onOpen}
      openButtonRef={openButtonRef}
      openLabel="Open"
    />
  );
}
