import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetchJson } from '../api/http.js';
import { GMAIL_MESSAGES_MUTATED_EVENT } from '../lib/gmailUiEvents.js';
import {
  ALERT_EXPIRY_MS,
  loadAlertReactions,
  loadDismissedAlerts,
  loadSnoozedAlerts,
  logAlertReaction,
  persistDismissedAlert,
  persistSnoozedAlert,
  pruneBriefingCardsForMutations,
  removeSnoozedAlert,
} from '../lib/workspaceAlertBriefing.js';

export default function useWorkspaceAlertBriefingState({ open, workspaceMonitor } = {}) {
  const [alerts, setAlerts] = useState([]);
  const [dismissedAlerts, setDismissedAlerts] = useState(() => {
    const persisted = loadDismissedAlerts();
    return new Set(persisted.keys());
  });
  const [snoozedAlerts, setSnoozedAlerts] = useState(() => loadSnoozedAlerts());
  const [alertReactions, setAlertReactions] = useState(() => loadAlertReactions());
  const [briefing, setBriefing] = useState(null);
  const [briefingExpanded, setBriefingExpanded] = useState(false);
  const [briefingDismissed, setBriefingDismissed] = useState(false);

  const alertFetchedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      alertFetchedRef.current = false;
      return;
    }
    if (alertFetchedRef.current) return;
    alertFetchedRef.current = true;

    apiFetchJson('/api/workspace/alerts/detect', {}, 'Failed to detect workspace alerts')
      .then((data) => {
        if (Array.isArray(data?.alerts)) {
          setAlerts(data.alerts);
        }
      })
      .catch(() => {
        // silent — SSE will provide alerts once connected
      });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (Array.isArray(workspaceMonitor?.alerts)) {
      setAlerts(workspaceMonitor.alerts);
    }
  }, [open, workspaceMonitor?.alerts]);

  const logAlertInteraction = useCallback((alert, action) => {
    apiFetchJson('/api/workspace/alerts/interaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alertType: alert?.type,
        alertTitle: alert?.title || '',
        action,
        sourceId: alert?.sourceId || '',
      }),
    }, 'Failed to record alert interaction').catch(() => {
      // fire-and-forget
    });
    setAlertReactions(logAlertReaction(alert, action));
  }, []);

  const dismissAlert = useCallback((key) => {
    setDismissedAlerts((prev) => new Set([...prev, key]));
    persistDismissedAlert(key);
  }, []);

  const snoozeAlert = useCallback((key) => {
    setSnoozedAlerts((prev) => {
      const next = new Map(prev);
      next.set(key, Date.now() + 30 * 60 * 1000);
      return next;
    });
    persistSnoozedAlert(key);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setAlerts((prev) => {
        const now = Date.now();
        const expired = [];
        const remaining = prev.filter((alert) => {
          const age = now - new Date(alert.detectedAt || now).getTime();
          const ttl = ALERT_EXPIRY_MS[alert.severity] || ALERT_EXPIRY_MS.info;
          if (age >= ttl) {
            expired.push(alert);
            return false;
          }
          return true;
        });

        if (expired.length > 0) {
          setDismissedAlerts((prevDismissed) => {
            const next = new Set(prevDismissed);
            for (const alert of expired) {
              const key = `${alert.type}:${alert.sourceId || ''}`;
              next.add(key);
              persistDismissedAlert(key);
            }
            return next;
          });

          let latestReactions;
          for (const alert of expired) {
            latestReactions = logAlertReaction(alert, 'expired');
          }
          if (latestReactions) setAlertReactions(latestReactions);
        }

        return expired.length > 0 ? remaining : prev;
      });

      setSnoozedAlerts((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map();
        for (const [key, until] of prev) {
          if (until > now) {
            next.set(key, until);
          } else {
            changed = true;
            removeSnoozedAlert(key);
          }
        }
        return changed ? next : prev;
      });
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetchJson('/api/workspace/briefing/today', {}, 'Failed to load today briefing');
        if (!cancelled && data?.briefing) {
          setBriefing(data.briefing);
          setBriefingDismissed(false);
          if (!data.briefing.read) setBriefingExpanded(true);
        }
      } catch {
        // Briefing check is optional — don't block the panel
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    const handleExternalMutations = (event) => {
      const incoming = Array.isArray(event?.detail?.mutations) ? event.detail.mutations : [];
      if (incoming.length === 0) return;
      setBriefing((prev) => pruneBriefingCardsForMutations(prev, incoming));
    };

    window.addEventListener(GMAIL_MESSAGES_MUTATED_EVENT, handleExternalMutations);
    return () => window.removeEventListener(GMAIL_MESSAGES_MUTATED_EVENT, handleExternalMutations);
  }, []);

  const markBriefingRead = useCallback(async () => {
    if (!briefing?.date) return;
    try {
      await apiFetchJson(`/api/workspace/briefing/${briefing.date}/read`, { method: 'PATCH' }, 'Failed to mark briefing as read');
      setBriefing((prev) => (prev ? { ...prev, read: true } : null));
    } catch {
      // Best effort
    }
  }, [briefing?.date]);

  const handleBriefingToggle = useCallback(() => {
    setBriefingExpanded((prev) => {
      const next = !prev;
      if (next && briefing && !briefing.read) {
        markBriefingRead();
      }
      return next;
    });
  }, [briefing, markBriefingRead]);

  const handleBriefingDismiss = useCallback(() => {
    setBriefingDismissed(true);
    if (briefing && !briefing.read) {
      markBriefingRead();
    }
  }, [briefing, markBriefingRead]);

  return {
    alerts,
    dismissedAlerts,
    snoozedAlerts,
    alertReactions,
    briefing,
    briefingExpanded,
    briefingDismissed,
    dismissAlert,
    snoozeAlert,
    logAlertInteraction,
    handleBriefingToggle,
    handleBriefingDismiss,
  };
}
