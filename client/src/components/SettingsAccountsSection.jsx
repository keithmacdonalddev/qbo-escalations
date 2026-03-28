import { AnimatePresence, motion } from 'framer-motion';

function GoogleLogo({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

export default function SettingsAccountsSection({
  googleAuth,
  connectedAccounts,
  primaryGoogleAccount,
  selectedDefaultEmailAccount,
  selectedDefaultCalendarAccount,
  defaultFallbackLabel,
  missingDefaultEmailAccount,
  missingDefaultCalendarAccount,
  savedFlash,
  onGoogleConnect,
  onGoogleDisconnect,
  googleConnecting,
  googleDisconnecting,
  onDefaultEmailAccountChange,
  onDefaultCalendarAccountChange,
}) {
  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h2 className="settings-panel-title">Connected Accounts</h2>
      </div>
      <p className="settings-section-desc">
        Manage external service connections. Connected accounts enable Gmail inbox access,
        email composition, and Google Calendar integration.
      </p>

      <div className="settings-accounts-card">
        <div className="settings-accounts-card-header">
          <div className="settings-accounts-provider">
            <div className="settings-accounts-provider-icon">
              <GoogleLogo size={24} />
            </div>
            <div className="settings-accounts-provider-info">
              <span className="settings-accounts-provider-name">Google</span>
              <span className="settings-accounts-provider-desc">Gmail &amp; Calendar</span>
            </div>
          </div>
          {googleAuth.loading ? (
            <span className="settings-accounts-status settings-accounts-status--loading">Checking...</span>
          ) : googleAuth.connected ? (
            <span className="settings-accounts-status settings-accounts-status--connected">
              <span className="settings-accounts-status-dot" />
              Connected
            </span>
          ) : (
            <span className="settings-accounts-status settings-accounts-status--disconnected">Not connected</span>
          )}
        </div>

        <AnimatePresence mode="wait">
          {googleAuth.loading ? (
            <motion.div
              key="loading"
              className="settings-accounts-body"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="settings-accounts-skeleton">
                <div className="settings-accounts-skeleton-line" style={{ width: '60%' }} />
                <div className="settings-accounts-skeleton-line" style={{ width: '80%' }} />
                <div className="settings-accounts-skeleton-line" style={{ width: '40%' }} />
              </div>
            </motion.div>
          ) : googleAuth.connected ? (
            <motion.div
              key="connected"
              className="settings-accounts-body"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
            >
              <div className="settings-accounts-email-row">
                <div className="settings-accounts-email-stack">
                  <div className="settings-accounts-email-badge">
                    <span className="settings-accounts-email-dot" />
                    <span className="settings-accounts-email-text">{primaryGoogleAccount || googleAuth.email}</span>
                  </div>
                  {connectedAccounts.length > 1 && (
                    <span className="settings-accounts-connected-count">
                      {connectedAccounts.length} connected Google accounts
                    </span>
                  )}
                </div>
                {googleAuth.connectedAt && (
                  <span className="settings-accounts-connected-since">
                    Connected {new Date(googleAuth.connectedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>

              {connectedAccounts.length > 0 && (
                <div className="settings-accounts-connected-list" aria-label="Connected Google accounts">
                  {connectedAccounts.map((account) => {
                    const isDefault = selectedDefaultEmailAccount
                      ? account.email === selectedDefaultEmailAccount
                      : account.email === connectedAccounts[0]?.email;
                    return (
                      <span
                        key={account.email}
                        className={`settings-accounts-connected-chip${isDefault ? ' is-primary' : ''}`}
                      >
                        {account.email}
                        {isDefault ? ' \u2713 Default' : ''}
                      </span>
                    );
                  })}
                </div>
              )}

              <div className="settings-accounts-defaults">
                <div className="settings-accounts-defaults-header">
                  <span className="settings-accounts-scopes-label">Default accounts</span>
                  <p className="settings-accounts-defaults-desc">
                    Choose which account to use by default across inbox and calendar.
                  </p>
                </div>

                <div className="settings-accounts-default-grid">
                  <label className="settings-accounts-default-field">
                    <span className="settings-accounts-default-label">
                      Default inbox
                      {savedFlash === 'email' && (
                        <span className="settings-accounts-saved-flash">{'\u2713'} Saved</span>
                      )}
                    </span>
                    <select
                      className="settings-accounts-default-select"
                      value={selectedDefaultEmailAccount}
                      onChange={onDefaultEmailAccountChange}
                    >
                      <option value="">{defaultFallbackLabel}</option>
                      {connectedAccounts.map((account) => (
                        <option key={account.email} value={account.email}>
                          {account.email}
                        </option>
                      ))}
                    </select>
                    {missingDefaultEmailAccount && (
                      <span className="settings-accounts-default-note">
                        The saved default is no longer connected. The first connected account will be used instead.
                      </span>
                    )}
                  </label>

                  <label className="settings-accounts-default-field">
                    <span className="settings-accounts-default-label">
                      Default calendar
                      {savedFlash === 'calendar' && (
                        <span className="settings-accounts-saved-flash">{'\u2713'} Saved</span>
                      )}
                    </span>
                    <select
                      className="settings-accounts-default-select"
                      value={selectedDefaultCalendarAccount}
                      onChange={onDefaultCalendarAccountChange}
                    >
                      <option value="">{defaultFallbackLabel}</option>
                      {connectedAccounts.map((account) => (
                        <option key={account.email} value={account.email}>
                          {account.email}
                        </option>
                      ))}
                    </select>
                    {missingDefaultCalendarAccount && (
                      <span className="settings-accounts-default-note">
                        The saved default is no longer connected. The first connected account will be used instead.
                      </span>
                    )}
                  </label>
                </div>
              </div>

              <div className="settings-accounts-scopes">
                <span className="settings-accounts-scopes-label">Granted permissions</span>
                <ul className="settings-accounts-scopes-list">
                  <li>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    <span>Gmail — read, send, compose, manage labels</span>
                  </li>
                  <li>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    <span>Google Calendar — read &amp; write events</span>
                  </li>
                  <li>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    <span>User profile — email address</span>
                  </li>
                </ul>
              </div>

              <div className="settings-accounts-actions">
                <button
                  className="settings-accounts-disconnect-btn"
                  onClick={onGoogleDisconnect}
                  disabled={googleDisconnecting}
                  type="button"
                >
                  {googleDisconnecting ? (
                    <>
                      <div className="settings-accounts-spinner" />
                      Disconnecting...
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 11-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></svg>
                      Disconnect Google Account
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="disconnected"
              className="settings-accounts-body"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
            >
              <p className="settings-accounts-empty-msg">
                Connect your Google account to access Gmail inbox, compose emails,
                and manage your Google Calendar — all from within the workspace.
              </p>

              {!googleAuth.appConfigured && (
                <div className="settings-accounts-warning">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                  <span>Google API credentials are not configured on the server. Set <code>GMAIL_CLIENT_ID</code> and <code>GMAIL_CLIENT_SECRET</code> in your server environment.</span>
                </div>
              )}

              <button
                className="settings-accounts-connect-btn"
                onClick={onGoogleConnect}
                disabled={googleConnecting || !googleAuth.appConfigured}
                type="button"
              >
                {googleConnecting ? (
                  <>
                    <div className="settings-accounts-spinner" />
                    Redirecting to Google...
                  </>
                ) : (
                  <>
                    <GoogleLogo size={18} />
                    Connect Google Account
                  </>
                )}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="settings-info-footer" style={{ marginTop: 'var(--sp-6)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>
          Your credentials are stored locally in the database and never shared.
          Disconnecting revokes the OAuth tokens with Google. You can reconnect at any time.
        </span>
      </div>
    </div>
  );
}
