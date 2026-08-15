const STATUS_CLASS = Object.freeze({
  connected: 'settings-accounts-status--connected',
  loading: 'settings-accounts-status--loading',
  warning: 'settings-accounts-status--warning',
  danger: 'settings-accounts-status--danger',
  disconnected: 'settings-accounts-status--disconnected',
  unavailable: 'settings-accounts-status--unavailable',
});

export default function ConnectedAccountCard({
  icon,
  providerName,
  providerDescription,
  providerMeta,
  statusLabel,
  statusTone = 'disconnected',
  badges = [],
  action,
  notice,
  onOpen,
  openButtonRef,
  openLabel = 'Manage',
  className = '',
}) {
  const content = (
    <div className="settings-accounts-card-header">
      <div className="settings-accounts-provider">
        <div className="settings-accounts-provider-icon">{icon}</div>
        <div className="settings-accounts-provider-info">
          <span className="settings-accounts-provider-name">{providerName}</span>
          <span className="settings-accounts-provider-desc">{providerDescription}</span>
          {providerMeta && <span className="settings-accounts-provider-meta">{providerMeta}</span>}
          {badges.length > 0 && (
            <span className="connected-account-badges" aria-label="Connection characteristics">
              {badges.map((badge) => <span key={badge}>{badge}</span>)}
            </span>
          )}
        </div>
      </div>
      <div className="settings-accounts-card-controls">
        <span className={`settings-accounts-status ${STATUS_CLASS[statusTone] || STATUS_CLASS.disconnected}`}>
          <span className="settings-accounts-status-dot" aria-hidden="true" />
          {statusLabel}
        </span>
        {action}
        {onOpen && (
          <span className="settings-accounts-row-chevron" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m6.5 4.5 3.5 3.5-3.5 3.5" /></svg>
          </span>
        )}
      </div>
    </div>
  );

  return (
    <section className={`settings-accounts-card ${className}`.trim()} aria-label={`${providerName} connection`}>
      {onOpen ? (
        <button
          ref={openButtonRef}
          type="button"
          className="settings-accounts-card-row"
          aria-label={`${openLabel} ${providerName}`}
          onClick={onOpen}
        >
          {content}
        </button>
      ) : content}
      {notice && <div className="settings-accounts-notice">{notice}</div>}
    </section>
  );
}
