import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

function getAlertKey(alert) {
  return `${alert?.type || 'unknown'}:${alert?.sourceId || ''}`;
}

function formatReactionTime(ts) {
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return ts;
  }
}

export default function WorkspaceSignalRail({
  alerts = [],
  nudges = [],
  dismissedAlerts = new Set(),
  snoozedAlerts = new Map(),
  dismissedNudges = new Set(),
  alertReactions = [],
  streaming = false,
  patternActionLoading = new Set(),
  onAlertAction,
  onSnoozeAlert,
  onDismissAlert,
  onLogAlertInteraction,
  onDismissNudge,
  onAcceptPatternRule,
  onRejectPatternRule,
  onApplyCategorization,
}) {
  const alertSeverityAdjustments = useMemo(() => {
    if (alertReactions.length < 30) return {};
    const byType = {};
    for (const reaction of alertReactions) {
      if (!byType[reaction.type]) byType[reaction.type] = { clicked: 0, dismissed: 0, expired: 0 };
      if (reaction.action === 'clicked') byType[reaction.type].clicked++;
      else if (reaction.action === 'dismissed') byType[reaction.type].dismissed++;
      else if (reaction.action === 'expired') byType[reaction.type].expired++;
    }

    const adjustments = {};
    for (const [type, stats] of Object.entries(byType)) {
      const total = stats.clicked + stats.dismissed + stats.expired;
      if (total < 10) continue;
      const dismissRate = stats.dismissed / total;
      const clickRate = stats.clicked / total;
      if (dismissRate > 0.7) adjustments[type] = 'info';
      else if (clickRate > 0.7) adjustments[type] = 'urgent';
    }
    return adjustments;
  }, [alertReactions]);

  const visibleAlerts = useMemo(
    () => alerts.filter((alert) => {
      const key = getAlertKey(alert);
      if (dismissedAlerts.has(key)) return false;
      const snoozeUntil = snoozedAlerts.get(key);
      if (snoozeUntil && snoozeUntil > Date.now()) return false;
      return true;
    }).map((alert) => {
      const adjusted = alertSeverityAdjustments[alert.type];
      return adjusted ? { ...alert, severity: adjusted, _severityAdjusted: true } : alert;
    }),
    [alerts, dismissedAlerts, snoozedAlerts, alertSeverityAdjustments],
  );

  const visibleNudges = useMemo(
    () => nudges.filter((nudge) => !dismissedNudges.has(nudge.id)),
    [nudges, dismissedNudges],
  );

  return (
    <>
      {alertReactions.length >= 5 && (
        <div className="alert-heatmap">
          <span className="alert-heatmap-label">
            Alert reactions
            {Object.keys(alertSeverityAdjustments).length > 0 && (
              <span
                className="alert-heatmap-adjusted"
                title={`Auto-adjusted: ${Object.entries(alertSeverityAdjustments).map(([type, severity]) => `${type} \u2192 ${severity}`).join(', ')}`}
              >
                {' \u00B7 '}auto-tuned
              </span>
            )}
          </span>
          <div className="alert-heatmap-strip">
            {alertReactions.slice(-50).map((reaction, index) => (
              <div
                key={`${reaction.timestamp}-${index}`}
                className={`alert-heatmap-cell alert-heatmap-cell--${reaction.action}`}
                title={`${reaction.title} \u2014 ${formatReactionTime(reaction.timestamp)}`}
              />
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {visibleAlerts.length > 0 && (
          <motion.div
            className="workspace-alerts"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            {visibleAlerts.map((alert, index) => {
              const key = getAlertKey(alert);
              return (
                <motion.div
                  key={key}
                  className={`workspace-alert workspace-alert-${alert.severity || 'info'}${alert.isNew ? ' workspace-alert-new' : ''}${streaming ? '' : ' workspace-alert-actionable'}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={{ duration: 0.15, delay: index * 0.05 }}
                  role="button"
                  tabIndex={streaming ? -1 : 0}
                  aria-disabled={streaming ? 'true' : 'false'}
                  aria-label={streaming ? `${alert.title}. Wait for the current request to finish.` : `Send this alert to the workspace agent: ${alert.title}`}
                  title={streaming ? 'Wait for the current request to finish' : 'Send this alert to the workspace agent'}
                  onClick={() => onAlertAction?.(alert)}
                  onKeyDown={(event) => {
                    if (streaming) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onAlertAction?.(alert);
                    }
                  }}
                >
                  <span className="workspace-alert-icon">
                    {alert.severity === 'urgent' ? '\uD83D\uDEA8' : alert.severity === 'warning' ? '\u26A0\uFE0F' : '\u2139\uFE0F'}
                  </span>
                  <div className="workspace-alert-content">
                    <strong>{alert.title}</strong>
                    {alert.detail && <span>{alert.detail}</span>}
                    {!streaming && <span className="workspace-alert-action-hint">Click to send to agent</span>}
                    {alert.isNew && <span className="workspace-alert-badge">NEW</span>}
                  </div>
                  <button
                    className="workspace-alert-snooze"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSnoozeAlert?.(key);
                      onLogAlertInteraction?.(alert, 'snoozed');
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                    type="button"
                    title="Snooze 30 min"
                    aria-label="Snooze alert for 30 minutes"
                  >
                    {'\uD83D\uDD14'}
                  </button>
                  <button
                    className="workspace-alert-dismiss"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDismissAlert?.(key);
                      onLogAlertInteraction?.(alert, 'dismissed');
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                    type="button"
                    aria-label="Dismiss alert"
                  >
                    \u00D7
                  </button>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {visibleNudges.length > 0 && (
          <motion.div
            className="workspace-nudges"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            {visibleNudges.map((nudge, index) => (
              <motion.div
                key={nudge.id}
                className={`workspace-nudge${nudge.type === 'pattern-detected' ? ' workspace-nudge--pattern' : ''}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 6 }}
                transition={{ duration: 0.12, delay: index * 0.04 }}
              >
                <span className="workspace-nudge-icon">
                  {nudge.type === 'categorize-emails' ? '\uD83D\uDCE5'
                    : nudge.type === 'pattern-detected' ? '\uD83E\uDDE0'
                    : '\uD83D\uDCA1'}
                </span>
                <div className="workspace-nudge-content">
                  <span className="workspace-nudge-title">{nudge.title}</span>
                  {nudge.detail && <span className="workspace-nudge-detail">{nudge.detail}</span>}
                </div>
                {nudge.type === 'pattern-detected' && nudge.ruleId ? (
                  <div className="workspace-nudge-actions">
                    <button
                      className="workspace-nudge-accept"
                      onClick={() => onAcceptPatternRule?.(nudge)}
                      disabled={patternActionLoading.has(nudge.id)}
                      type="button"
                      aria-label="Accept this rule"
                      title="Enable this auto-action"
                    >
                      {patternActionLoading.has(nudge.id) ? '...' : 'Yes'}
                    </button>
                    <button
                      className="workspace-nudge-reject"
                      onClick={() => onRejectPatternRule?.(nudge)}
                      disabled={patternActionLoading.has(nudge.id)}
                      type="button"
                      aria-label="Reject this rule"
                      title="No thanks"
                    >
                      No
                    </button>
                  </div>
                ) : nudge.type === 'categorize-emails' && nudge.messageIds?.length > 0 ? (
                  <div className="workspace-nudge-actions">
                    <button
                      className="workspace-nudge-accept"
                      onClick={() => onApplyCategorization?.(nudge)}
                      disabled={patternActionLoading.has(nudge.id)}
                      type="button"
                      aria-label={`Apply label "${nudge.label}"`}
                      title={`Label ${nudge.count || nudge.messageIds.length} emails as "${nudge.label}"`}
                    >
                      {patternActionLoading.has(nudge.id) ? '...' : 'Apply'}
                    </button>
                    <button
                      className="workspace-nudge-dismiss"
                      onClick={() => onDismissNudge?.(nudge.id)}
                      type="button"
                      aria-label="Dismiss suggestion"
                    >
                      {'\u00D7'}
                    </button>
                  </div>
                ) : (
                  <button
                    className="workspace-nudge-dismiss"
                    onClick={() => onDismissNudge?.(nudge.id)}
                    type="button"
                    aria-label="Dismiss suggestion"
                  >
                    {'\u00D7'}
                  </button>
                )}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
