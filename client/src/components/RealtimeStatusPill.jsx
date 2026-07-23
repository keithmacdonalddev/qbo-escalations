function statusCopy(realtime) {
  if (realtime.status === 'connected') {
    return realtime.syncing
      ? { label: 'Syncing', detail: 'Confirming the latest case changes.' }
      : { label: 'Live', detail: 'Case changes will appear automatically.' };
  }
  if (realtime.status === 'offline') {
    return { label: 'Offline', detail: 'Changes may be out of date until this device reconnects.' };
  }
  if (realtime.status === 'stale') {
    return { label: 'Updates paused', detail: realtime.syncError || 'The latest case changes cannot be confirmed yet.' };
  }
  return { label: 'Reconnecting', detail: 'The app is restoring live case updates.' };
}

export default function RealtimeStatusPill({ realtime, className = '' }) {
  if (!realtime) return null;
  const copy = statusCopy(realtime);
  const needsAction = realtime.status !== 'connected';
  const classes = [
    'realtime-status-pill',
    `is-${realtime.status}`,
    realtime.syncing ? 'is-syncing' : '',
    className,
  ].filter(Boolean).join(' ');

  if (needsAction) {
    return (
      <button
        type="button"
        className={classes}
        onClick={realtime.retry}
        title={`${copy.detail} Select to retry now.`}
        aria-label={`${copy.label}. ${copy.detail} Retry live updates.`}
      >
        <span className="realtime-status-dot" aria-hidden="true" />
        <span>{copy.label}</span>
        <span className="realtime-status-action" aria-hidden="true">Retry</span>
      </button>
    );
  }

  return (
    <span className={classes} title={copy.detail} role="status" aria-label={`${copy.label}. ${copy.detail}`}>
      <span className="realtime-status-dot" aria-hidden="true" />
      <span>{copy.label}</span>
    </span>
  );
}
