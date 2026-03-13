import { useCallback, useEffect, useRef } from 'react';

const AUTO_ERROR_MIN_INTERVAL_MS = 5_000;
const DEFAULT_MIN_INTERVAL_MS = 2_000;
const DUPLICATE_COOLDOWN_MS = 60_000;
const MAX_QUEUE_SIZE = 40;

function normalizeMessage(message) {
  return String(message || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function fingerprint(channel, message) {
  return `${channel}:${normalizeMessage(message)}`;
}

export function useMonitorDispatch({ enabled = true, sendBackground, log }) {
  const sendBackgroundRef = useRef(sendBackground);
  sendBackgroundRef.current = sendBackground;
  const logRef = useRef(log);
  logRef.current = log;
  const queueRef = useRef([]);
  const pendingRef = useRef(new Map());
  const recentRef = useRef(new Map());
  const inFlightRef = useRef(false);
  const nextAllowedAtRef = useRef(0);
  const timerRef = useRef(null);
  const drainQueueRef = useRef(() => {});

  const scheduleDrain = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const delay = Math.max(50, nextAllowedAtRef.current - Date.now());
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      drainQueueRef.current();
    }, delay);
  }, []);

  const drainQueue = useCallback(async () => {
    if (!enabled) return;
    if (inFlightRef.current) return;
    if (queueRef.current.length === 0) return;
    if (typeof sendBackgroundRef.current !== 'function') return;

    const now = Date.now();
    if (now < nextAllowedAtRef.current) {
      scheduleDrain();
      return;
    }

    const item = queueRef.current.shift();
    if (!item) return;
    pendingRef.current.delete(item.key);
    inFlightRef.current = true;

    try {
      const result = await sendBackgroundRef.current(item.channel, item.message, item.options);
      recentRef.current.set(item.key, Date.now());
      const minInterval = item.channel === 'auto-errors' ? AUTO_ERROR_MIN_INTERVAL_MS : DEFAULT_MIN_INTERVAL_MS;
      nextAllowedAtRef.current = Date.now() + minInterval;
      item.resolve(result);

      // Prune stale dedup entries to prevent unbounded growth
      if (recentRef.current.size > 100) {
        const pruneNow = Date.now();
        for (const [k, ts] of recentRef.current) {
          if (pruneNow - ts > DUPLICATE_COOLDOWN_MS) {
            recentRef.current.delete(k);
          }
        }
      }
    } catch (err) {
      item.reject(err);
    } finally {
      inFlightRef.current = false;
      if (queueRef.current.length > 0) scheduleDrain();
    }
  }, [enabled, scheduleDrain]);

  const dispatch = useCallback((channel, message, options = {}) => {
    if (!enabled || typeof sendBackgroundRef.current !== 'function') return Promise.resolve(null);

    const key = fingerprint(channel, message);
    const now = Date.now();
    const lastSentAt = recentRef.current.get(key) || 0;
    if (now - lastSentAt < DUPLICATE_COOLDOWN_MS) {
      logRef.current?.({
        type: 'bg-suppressed',
        message: `Suppressed duplicate ${channel} report`,
        channel,
        severity: 'info',
      });
      return Promise.resolve({ suppressed: true, reason: 'duplicate-cooldown' });
    }

    if (pendingRef.current.has(key)) {
      logRef.current?.({
        type: 'bg-suppressed',
        message: `Coalesced duplicate queued ${channel} report`,
        channel,
        severity: 'info',
      });
      return Promise.resolve({ suppressed: true, reason: 'duplicate-pending' });
    }

    return new Promise((resolve, reject) => {
      const entry = {
        key,
        channel,
        message,
        options,
        enqueuedAt: now,
        resolve,
        reject,
      };

      queueRef.current.push(entry);
      pendingRef.current.set(key, entry);

      if (queueRef.current.length > MAX_QUEUE_SIZE) {
        const dropped = queueRef.current.shift();
        if (dropped) {
          pendingRef.current.delete(dropped.key);
          dropped.resolve({ suppressed: true, reason: 'queue-overflow' });
          logRef.current?.({
            type: 'bg-suppressed',
            message: `Dropped oldest queued ${dropped.channel} report due to monitor queue pressure`,
            channel: dropped.channel,
            severity: 'warning',
          });
        }
      }

      drainQueue();
    });
  }, [enabled, drainQueue]);

  drainQueueRef.current = drainQueue;

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return dispatch;
}
