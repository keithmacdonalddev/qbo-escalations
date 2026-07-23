import { useCallback, useEffect, useRef, useState } from 'react';
import { getSharedRealtimeClient } from '../api/realtime.js';

const SYNC_COALESCE_MS = 120;

function deriveStatus(connection, syncError) {
  if (syncError) return 'stale';
  if (connection?.connected && connection?.state === 'connected') return 'connected';
  if (connection?.state === 'offline') return 'offline';
  if (connection?.state === 'stale' || connection?.state === 'degraded') return 'stale';
  return 'reconnecting';
}

export default function useCaseRealtime({
  escalationId = '',
  enabled = true,
  onSync,
  onCaseEvent,
} = {}) {
  const syncRef = useRef(onSync);
  const eventRef = useRef(onCaseEvent);
  const syncTimerRef = useRef(0);
  const mountedRef = useRef(true);
  const syncGenerationRef = useRef(0);
  const [connection, setConnection] = useState(() => getSharedRealtimeClient().getStateSnapshot());
  const [syncError, setSyncError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [lastEventAt, setLastEventAt] = useState(null);

  syncRef.current = onSync;
  eventRef.current = onCaseEvent;

  const runSync = useCallback(async (reason = 'live-update', event = null) => {
    const generation = ++syncGenerationRef.current;
    setSyncing(true);
    try {
      await syncRef.current?.({ reason, event });
      if (!mountedRef.current || generation !== syncGenerationRef.current) return;
      setSyncError('');
      setLastSyncedAt(Date.now());
    } catch (error) {
      if (!mountedRef.current || generation !== syncGenerationRef.current) return;
      setSyncError(error?.message || 'Latest case data could not be confirmed.');
    } finally {
      if (mountedRef.current && generation === syncGenerationRef.current) setSyncing(false);
    }
  }, []);

  const scheduleSync = useCallback((reason, event) => {
    if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = 0;
      runSync(reason, event);
    }, reason === 'snapshot' || reason === 'replay-gap' ? 0 : SYNC_COALESCE_MS);
  }, [runSync]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return () => { mountedRef.current = false; };

    const realtime = getSharedRealtimeClient();
    const unsubscribeConnection = realtime.subscribeConnectionState(setConnection);
    const unsubscribeChannel = realtime.subscribe({
      channel: 'case-workflow',
      key: escalationId || 'all',
      onSubscribed() {
        scheduleSync('subscribed', null);
      },
      onEvent(eventType, data, meta) {
        const event = data && typeof data === 'object' ? data : null;
        setLastEventAt(Date.now());
        if (eventType === 'snapshot') {
          scheduleSync(meta?.resyncRequired ? 'replay-gap' : 'snapshot', event);
          return;
        }
        eventRef.current?.(eventType, event, meta || null);
        scheduleSync('live-event', event);
      },
      onError(message) {
        if (message?.code === 'REALTIME_DISCONNECTED' || message?.code === 'REALTIME_ERROR') return;
        setSyncError(message?.error || 'Live case updates could not be confirmed.');
      },
    });

    return () => {
      mountedRef.current = false;
      syncGenerationRef.current += 1;
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = 0;
      unsubscribeChannel();
      unsubscribeConnection();
    };
  }, [enabled, escalationId, scheduleSync]);

  const retry = useCallback(() => {
    const realtime = getSharedRealtimeClient();
    realtime.reconnectNow('Retrying live updates');
    runSync('manual-retry');
  }, [runSync]);

  return {
    connection,
    status: deriveStatus(connection, syncError),
    syncing,
    syncError,
    lastSyncedAt,
    lastEventAt,
    retry,
  };
}
