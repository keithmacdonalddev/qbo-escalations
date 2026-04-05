import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getSharedRealtimeClient } from '../api/realtime.js';
import { dispatchGmailMutations, gmailMutationsFromMonitorPayload } from '../lib/gmailUiEvents.js';

const DEFAULT_CTX = Object.freeze({
  connected: false,
  alerts: [],
  nudges: [],
  inboxRefreshToken: 0,
  lastProactiveMessage: null,
  lastWorkCompleted: null,
  lastHeartbeatAt: 0,
  lastSnapshotAt: 0,
});

const WorkspaceMonitorContext = createContext(DEFAULT_CTX);

export function WorkspaceMonitorProvider({ enabled = true, children }) {
  const [connected, setConnected] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [nudges, setNudges] = useState([]);
  const [inboxRefreshToken, setInboxRefreshToken] = useState(0);
  const [lastProactiveMessage, setLastProactiveMessage] = useState(null);
  const [lastWorkCompleted, setLastWorkCompleted] = useState(null);
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState(0);
  const [lastSnapshotAt, setLastSnapshotAt] = useState(0);
  const proactiveIdRef = useRef(0);
  const workCompletedIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return undefined;
    }

    const realtime = getSharedRealtimeClient();

    const onSnapshot = (data) => {
      if (!data || typeof data !== 'object') return;
      if (Array.isArray(data.alerts)) setAlerts(data.alerts);
      if (Array.isArray(data.nudges)) setNudges(data.nudges);
      if (data.lastWorkSummary && typeof data.lastWorkSummary === 'object') {
        workCompletedIdRef.current += 1;
        setLastWorkCompleted({
          id: workCompletedIdRef.current,
          payload: data.lastWorkSummary,
        });
      }
      if (data.lastProactiveMessage && typeof data.lastProactiveMessage === 'object') {
        proactiveIdRef.current += 1;
        setLastProactiveMessage({
          id: proactiveIdRef.current,
          payload: data.lastProactiveMessage,
        });
      }
      setConnected(true);
      setLastSnapshotAt(Date.now());
    };

    const onAlert = (alert) => {
      if (!alert || typeof alert !== 'object') return;
      setAlerts((prev) => {
        const key = `${alert.type}:${alert.sourceId || ''}`;
        const filtered = prev.filter((item) => `${item.type}:${item.sourceId || ''}` !== key);
        return [...filtered, alert];
      });
    };

    const onAlertResolved = (data) => {
      if (!data || typeof data !== 'object') return;
      const key = `${data.type}:${data.sourceId || ''}`;
      setAlerts((prev) => prev.filter((item) => `${item.type}:${item.sourceId || ''}` !== key));
    };

    const onNudges = (data) => {
      if (!data || !Array.isArray(data.nudges)) return;
      setNudges(data.nudges);
    };

    const onNudge = (nudge) => {
      if (!nudge?.id) return;
      setNudges((prev) => {
        const filtered = prev.filter((item) => item.id !== nudge.id);
        return [...filtered, nudge];
      });
    };

    const onLabelsChanged = (data) => {
      const mutations = gmailMutationsFromMonitorPayload(data);
      if (mutations.length > 0) {
        dispatchGmailMutations(mutations, { source: 'workspace-monitor' });
      }
      setInboxRefreshToken((value) => value + 1);
    };

    const onWorkCompleted = (data) => {
      if (!data || typeof data !== 'object') return;

      const shouldRefreshInbox = (data.labelsApplied || 0) > 0
        || (data.silentActionsRun || 0) > 0
        || (data.notifyActionsRun || 0) > 0;
      if (shouldRefreshInbox) {
        setInboxRefreshToken((value) => value + 1);
      }

      workCompletedIdRef.current += 1;
      setLastWorkCompleted({
        id: workCompletedIdRef.current,
        payload: data,
      });
    };

    const onProactiveMessage = (data) => {
      if (!data || typeof data !== 'object') return;
      proactiveIdRef.current += 1;
      setLastProactiveMessage({
        id: proactiveIdRef.current,
        payload: data,
      });
    };

    const onHeartbeat = () => {
      setConnected(true);
      setLastHeartbeatAt(Date.now());
    };

    const unsubscribeConnection = realtime.subscribeConnectionState((state) => {
      setConnected(Boolean(state?.connected));
    });

    const unsubscribe = realtime.subscribe({
      channel: 'workspace-monitor',
      onEvent(eventType, data) {
        if (eventType === 'snapshot') onSnapshot(data);
        else if (eventType === 'alert') onAlert(data);
        else if (eventType === 'alert-resolved') onAlertResolved(data);
        else if (eventType === 'nudges') onNudges(data);
        else if (eventType === 'nudge') onNudge(data);
        else if (eventType === 'labels-changed') onLabelsChanged(data);
        else if (eventType === 'work-completed') onWorkCompleted(data);
        else if (eventType === 'proactive-message') onProactiveMessage(data);
        else if (eventType === 'heartbeat') onHeartbeat();
      },
      onError() {
        setConnected(false);
      },
    });

    return () => {
      unsubscribe();
      unsubscribeConnection();
    };
  }, [enabled]);

  const value = useMemo(() => ({
    connected,
    alerts,
    nudges,
    inboxRefreshToken,
    lastProactiveMessage,
    lastWorkCompleted,
    lastHeartbeatAt,
    lastSnapshotAt,
  }), [
    connected,
    alerts,
    nudges,
    inboxRefreshToken,
    lastProactiveMessage,
    lastWorkCompleted,
    lastHeartbeatAt,
    lastSnapshotAt,
  ]);

  return (
    <WorkspaceMonitorContext.Provider value={value}>
      {children}
    </WorkspaceMonitorContext.Provider>
  );
}

export function useWorkspaceMonitorStream() {
  return useContext(WorkspaceMonitorContext) || DEFAULT_CTX;
}
