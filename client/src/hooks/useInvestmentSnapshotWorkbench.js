import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteLocalInvestmentData,
  forceSnapshotReplayGap,
  getSnapshotRun,
  getSnapshotWorkbench,
  selectSnapshotDevScenario,
  startSnapshotRun,
} from '../api/investments.js';
import { getSharedRealtimeClient } from '../api/realtime.js';

const POLL_INTERVAL_MS = 900;

export default function useInvestmentSnapshotWorkbench() {
  const [source, setSourceState] = useState('simulated');
  const [workbench, setWorkbench] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [transportEnabled, setTransportEnabled] = useState(true);
  const [transport, setTransport] = useState(() => getSharedRealtimeClient().getStateSnapshot());
  const [transportNotice, setTransportNotice] = useState('');
  const [transportSubscriptionEpoch, setTransportSubscriptionEpoch] = useState(0);
  const activeRunIdRef = useRef('');
  const forcedReplaySinceRef = useRef(0);
  const refreshEpochRef = useRef(0);
  const suppressNextReadyNoticeRef = useRef(false);

  const refresh = useCallback(async (selectedSource = source) => {
    const refreshEpoch = ++refreshEpochRef.current;
    try {
      const data = await getSnapshotWorkbench(selectedSource);
      if (refreshEpoch !== refreshEpochRef.current) return data;
      setWorkbench(data);
      activeRunIdRef.current = data.activeRun?.runId || '';
      setError('');
      return data;
    } catch (requestError) {
      if (refreshEpoch !== refreshEpochRef.current) throw requestError;
      setError(requestError.message || 'Snapshot reconciliation could not be loaded.');
      throw requestError;
    } finally {
      if (refreshEpoch === refreshEpochRef.current) setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    refresh(source).catch(() => {});
  }, [refresh, source]);

  useEffect(() => {
    const realtime = getSharedRealtimeClient();
    const unsubscribeConnection = realtime.subscribeConnectionState(setTransport);
    if (!transportEnabled) return unsubscribeConnection;
    const unsubscribeChannel = realtime.subscribe({
      channel: 'investment-account',
      key: workbench?.account?.accountKey || 'all',
      params: forcedReplaySinceRef.current > 0 ? { since: forcedReplaySinceRef.current } : {},
      onSubscribed() {
        if (suppressNextReadyNoticeRef.current) {
          suppressNextReadyNoticeRef.current = false;
          refresh(source).catch(() => {});
          return;
        }
        setTransportNotice('Live reconciliation is ready.');
        refresh(source).catch(() => {});
      },
      onEvent(eventType, _data, meta) {
        if (eventType === 'snapshot') {
          if (meta?.resyncRequired) forcedReplaySinceRef.current = 0;
          setTransportNotice(meta?.resyncRequired
            ? 'A live-update gap was found. Saved state was checked again.'
            : 'Saved state was checked.');
        } else {
          setTransportNotice('A saved investment change was received.');
        }
        refresh(source).catch(() => {});
      },
      onError(message) {
        if (!['REALTIME_DISCONNECTED', 'REALTIME_ERROR'].includes(message?.code)) {
          setTransportNotice(message?.error || 'Live updates need attention.');
        }
      },
    });
    return () => {
      unsubscribeChannel();
      unsubscribeConnection();
    };
  }, [refresh, source, transportEnabled, transportSubscriptionEpoch, workbench?.account?.accountKey]);

  useEffect(() => {
    const runId = workbench?.activeRun?.runId || activeRunIdRef.current;
    const needsPolling = Boolean(runId);
    if (!needsPolling) return undefined;
    if (!transportEnabled || !transport.connected) {
      setTransportNotice(transportEnabled
        ? 'Live updates are reconnecting. Progress is being confirmed directly.'
        : 'WebSocket transport is off. Progress is being confirmed directly.');
    }
    const timer = window.setInterval(async () => {
      try {
        const result = await getSnapshotRun(runId);
        if (result.run?.status === 'running') {
          setWorkbench((current) => current ? { ...current, activeRun: result.run, latestRun: result.run } : current);
          return;
        }
        activeRunIdRef.current = '';
        window.clearInterval(timer);
        await refresh(source);
        setTransportNotice('Direct progress checks completed.');
      } catch (pollError) {
        setTransportNotice(pollError.message || 'Progress could not be confirmed yet.');
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, source, transport.connected, transportEnabled, workbench?.activeRun?.runId]);

  const setSource = useCallback((value) => {
    const next = value === 'live' ? 'live' : 'simulated';
    setLoading(true);
    setSourceState(next);
  }, []);

  const selectScenario = useCallback(async (scenario) => {
    await selectSnapshotDevScenario(scenario);
    await refresh('simulated');
  }, [refresh]);

  const run = useCallback(async () => {
    setStarting(true);
    setError('');
    try {
      const result = await startSnapshotRun(source);
      activeRunIdRef.current = result.run?.runId || '';
      setWorkbench((current) => {
        if (!current) return current;
        const currentRun = current.activeRun || current.latestRun;
        const sameRunAlreadyFinished = currentRun?.runId === result.run?.runId && currentRun.status !== 'running';
        return sameRunAlreadyFinished ? current : { ...current, activeRun: result.run, latestRun: result.run };
      });
      return result.run;
    } catch (runError) {
      setError(runError.message || 'Snapshot verification could not be started.');
      throw runError;
    } finally {
      setStarting(false);
    }
  }, [source]);

  const removeLocalData = useCallback(async (confirmation) => {
    setDeleting(true);
    setError('');
    try {
      const result = await deleteLocalInvestmentData(confirmation);
      activeRunIdRef.current = '';
      await refresh(source);
      return result;
    } catch (deleteError) {
      setError(deleteError.message || 'Local investment data could not be deleted.');
      throw deleteError;
    } finally {
      setDeleting(false);
    }
  }, [refresh, source]);

  const dropAndReconnect = useCallback(() => {
    setTransportNotice('Development check: reconnecting the investment event stream.');
    getSharedRealtimeClient().reconnectNow('Development socket-drop check');
  }, []);

  const forceReplayGap = useCallback(async () => {
    await forceSnapshotReplayGap();
    setTransportNotice('Development check: forcing an authoritative saved-state refresh.');
    forcedReplaySinceRef.current = 1;
    suppressNextReadyNoticeRef.current = true;
    setTransportSubscriptionEpoch((value) => value + 1);
  }, []);

  return {
    deleteLocalData: removeLocalData,
    deleting,
    dropAndReconnect,
    error,
    forceReplayGap,
    loading,
    refresh,
    run,
    selectScenario,
    setSource,
    setTransportEnabled,
    source,
    starting,
    transport,
    transportEnabled,
    transportNotice,
    workbench,
  };
}
