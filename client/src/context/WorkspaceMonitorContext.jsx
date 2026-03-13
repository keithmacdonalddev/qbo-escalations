import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

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

function safeParseEvent(event) {
  try {
    return JSON.parse(event?.data || '{}');
  } catch {
    return null;
  }
}

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

    let eventSource;
    try {
      eventSource = new EventSource('/api/workspace/monitor');
    } catch {
      setConnected(false);
      return undefined;
    }

    const onSnapshot = (event) => {
      const data = safeParseEvent(event);
      if (!data) return;
      if (Array.isArray(data.alerts)) setAlerts(data.alerts);
      if (Array.isArray(data.nudges)) setNudges(data.nudges);
      setConnected(true);
      setLastSnapshotAt(Date.now());
    };

    const onAlert = (event) => {
      const alert = safeParseEvent(event);
      if (!alert) return;
      setAlerts((prev) => {
        const key = `${alert.type}:${alert.sourceId || ''}`;
        const filtered = prev.filter((item) => `${item.type}:${item.sourceId || ''}` !== key);
        return [...filtered, alert];
      });
    };

    const onAlertResolved = (event) => {
      const data = safeParseEvent(event);
      if (!data) return;
      const key = `${data.type}:${data.sourceId || ''}`;
      setAlerts((prev) => prev.filter((item) => `${item.type}:${item.sourceId || ''}` !== key));
    };

    const onNudges = (event) => {
      const data = safeParseEvent(event);
      if (!data || !Array.isArray(data.nudges)) return;
      setNudges(data.nudges);
    };

    const onNudge = (event) => {
      const nudge = safeParseEvent(event);
      if (!nudge?.id) return;
      setNudges((prev) => {
        const filtered = prev.filter((item) => item.id !== nudge.id);
        return [...filtered, nudge];
      });
    };

    const onLabelsChanged = () => {
      setInboxRefreshToken((value) => value + 1);
    };

    const onWorkCompleted = (event) => {
      const data = safeParseEvent(event);
      if (!data) return;

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

    const onProactiveMessage = (event) => {
      const data = safeParseEvent(event);
      if (!data) return;
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

    eventSource.addEventListener('snapshot', onSnapshot);
    eventSource.addEventListener('alert', onAlert);
    eventSource.addEventListener('alert-resolved', onAlertResolved);
    eventSource.addEventListener('nudges', onNudges);
    eventSource.addEventListener('nudge', onNudge);
    eventSource.addEventListener('labels-changed', onLabelsChanged);
    eventSource.addEventListener('work-completed', onWorkCompleted);
    eventSource.addEventListener('proactive-message', onProactiveMessage);
    eventSource.addEventListener('heartbeat', onHeartbeat);
    eventSource.onopen = () => setConnected(true);
    eventSource.onerror = () => setConnected(false);

    return () => {
      try {
        eventSource.close();
      } catch {
        // ignore close failures
      }
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
