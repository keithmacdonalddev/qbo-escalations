import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Cross-tab leader election via BroadcastChannel.
 *
 * Only the leader tab should run autonomous background work (auto-errors,
 * code-reviews, quality-scans).  Multiple tabs opening the same app would
 * otherwise duplicate all background requests.
 *
 * Election protocol:
 * 1. On mount, broadcast a candidacy message with tabId + timestamp.
 * 2. If no existing leader responds within ELECTION_TIMEOUT_MS, claim leadership.
 * 3. Leader broadcasts a heartbeat every HEARTBEAT_MS.
 * 4. If a tab becomes hidden for >VISIBILITY_TIMEOUT_MS, it relinquishes.
 * 5. On beforeunload, broadcast relinquish.
 * 6. If BroadcastChannel is unavailable, assume leadership (single-tab fallback).
 */

const BC_CHANNEL = 'qbo-dev-agent-leadership';
const ELECTION_TIMEOUT_MS = 200;
const HEARTBEAT_MS = 5000;
const VISIBILITY_TIMEOUT_MS = 10000;

function generateTabId() {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useTabLeadership({ log } = {}) {
  const [isLeader, setIsLeader] = useState(false);
  const tabIdRef = useRef(generateTabId());
  const bcRef = useRef(null);
  const heartbeatRef = useRef(null);
  const electionTimerRef = useRef(null);
  const visibilityTimerRef = useRef(null);
  const isLeaderRef = useRef(false);
  const statusListenersRef = useRef(new Set());
  const logRef = useRef(log);
  logRef.current = log;

  const broadcastStatus = useCallback((payload) => {
    try {
      bcRef.current?.postMessage({
        type: 'status',
        tabId: tabIdRef.current,
        ...payload,
      });
    } catch { /* channel may be closed */ }
  }, []);

  const onStatusUpdate = useCallback((fn) => {
    statusListenersRef.current.add(fn);
    return () => statusListenersRef.current.delete(fn);
  }, []);

  useEffect(() => {
    // Fallback: if BroadcastChannel unavailable, assume leader
    if (typeof BroadcastChannel === 'undefined') {
      setIsLeader(true);
      isLeaderRef.current = true;
      return;
    }

    const bc = new BroadcastChannel(BC_CHANNEL);
    bcRef.current = bc;
    const tabId = tabIdRef.current;

    function claimLeadership() {
      setIsLeader(true);
      isLeaderRef.current = true;
      logRef.current?.({ type: 'leader-change', message: 'This tab is now the leader' });
      // Start heartbeat
      heartbeatRef.current = setInterval(() => {
        try {
          bc.postMessage({ type: 'heartbeat', tabId, ts: Date.now() });
        } catch { /* closed */ }
      }, HEARTBEAT_MS);
    }

    function relinquish() {
      setIsLeader(false);
      isLeaderRef.current = false;
      logRef.current?.({ type: 'leader-change', message: 'This tab relinquished leadership' });
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      try {
        bc.postMessage({ type: 'relinquish', tabId });
      } catch { /* closed */ }
    }

    // Listen for messages
    bc.onmessage = (event) => {
      const msg = event.data;
      if (!msg || !msg.type) return;

      if (msg.type === 'candidacy' && msg.tabId !== tabId) {
        // Another tab is running for election
        if (isLeaderRef.current) {
          // Respond: we are the leader, stand down
          bc.postMessage({ type: 'leader-present', tabId, ts: Date.now() });
        }
        return;
      }

      if (msg.type === 'leader-present' && msg.tabId !== tabId) {
        // An existing leader responded — cancel our election
        if (electionTimerRef.current) {
          clearTimeout(electionTimerRef.current);
          electionTimerRef.current = null;
        }
        setIsLeader(false);
        isLeaderRef.current = false;
        return;
      }

      if (msg.type === 'heartbeat' && msg.tabId !== tabId) {
        // Another tab is the leader — if we thought we were, step down
        if (isLeaderRef.current) {
          // Conflict: compare timestamps — older tab wins
          // In practice, the heartbeat sender IS the leader, so just yield
          relinquish();
        }
        return;
      }

      if (msg.type === 'relinquish' && msg.tabId !== tabId) {
        // Leader gone — start a new election
        if (!isLeaderRef.current) {
          // Clear any pending election timer before starting a new one
          if (electionTimerRef.current) {
            clearTimeout(electionTimerRef.current);
            electionTimerRef.current = null;
          }
          bc.postMessage({ type: 'candidacy', tabId, ts: Date.now() });
          electionTimerRef.current = setTimeout(() => {
            electionTimerRef.current = null;
            claimLeadership();
          }, ELECTION_TIMEOUT_MS);
        }
        return;
      }

      if (msg.type === 'status') {
        for (const fn of statusListenersRef.current) {
          try { fn(msg); } catch { /* listener error */ }
        }
        return;
      }
    };

    // Start election
    bc.postMessage({ type: 'candidacy', tabId, ts: Date.now() });
    electionTimerRef.current = setTimeout(() => {
      electionTimerRef.current = null;
      claimLeadership();
    }, ELECTION_TIMEOUT_MS);

    // Visibility change: relinquish after extended hidden period
    function handleVisibility() {
      if (document.hidden) {
        visibilityTimerRef.current = setTimeout(() => {
          if (isLeaderRef.current) relinquish();
        }, VISIBILITY_TIMEOUT_MS);
      } else {
        if (visibilityTimerRef.current) {
          clearTimeout(visibilityTimerRef.current);
          visibilityTimerRef.current = null;
        }
        // If we're not the leader and tab is now visible, try to claim
        if (!isLeaderRef.current) {
          // Clear any pending election timer before starting a new one
          if (electionTimerRef.current) {
            clearTimeout(electionTimerRef.current);
            electionTimerRef.current = null;
          }
          bc.postMessage({ type: 'candidacy', tabId, ts: Date.now() });
          electionTimerRef.current = setTimeout(() => {
            electionTimerRef.current = null;
            claimLeadership();
          }, ELECTION_TIMEOUT_MS);
        }
      }
    }

    function handleUnload() {
      if (isLeaderRef.current) relinquish();
    }

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (electionTimerRef.current) clearTimeout(electionTimerRef.current);
      if (visibilityTimerRef.current) clearTimeout(visibilityTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleUnload);
      if (isLeaderRef.current) {
        try { bc.postMessage({ type: 'relinquish', tabId }); } catch { /* */ }
      }
      try { bc.close(); } catch { /* */ }
      bcRef.current = null;
    };
  }, []);

  return {
    isLeader,
    tabId: tabIdRef.current,
    broadcastStatus,
    onStatusUpdate,
  };
}
