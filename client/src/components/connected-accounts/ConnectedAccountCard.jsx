const STATUS_CLASS = Object.freeze({
  connected: 'settings-accounts-status--connected',
  loading: 'settings-accounts-status--loading',
  warning: 'settings-accounts-status--warning',
  danger: 'settings-accounts-status--danger',
  disconnected: 'settings-accounts-status--disconnected',
});

export default function ConnectedAccountCard({
  icon,
  providerName,
  providerDescription,
  statusLabel,
  statusTone = 'disconnected',
  badges = [],
  children,
  className = '',
}) {
  return (
    <section className={`settings-accounts-card ${className}`.trim()} aria-label={`${providerName} connection`}>
      <div className="settings-accounts-card-header">
        <div className="settings-accounts-provider">
          <div className="settings-accounts-provider-icon">{icon}</div>
          <div className="settings-accounts-provider-info">
            <span className="settings-accounts-provider-name">{providerName}</span>
            <span className="settings-accounts-provider-desc">{providerDescription}</span>
            {badges.length > 0 && (
              <span className="connected-account-badges" aria-label="Connection characteristics">
                {badges.map((badge) => <span key={badge}>{badge}</span>)}
              </span>
            )}
          </div>
        </div>
        <span className={`settings-accounts-status ${STATUS_CLASS[statusTone] || STATUS_CLASS.disconnected}`}>
          <span className="settings-accounts-status-dot" aria-hidden="true" />
          {statusLabel}
        </span>
      </div>
      {children}
    </section>
  );
}
