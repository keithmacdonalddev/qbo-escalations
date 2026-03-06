import { useState, useRef, useCallback, useEffect } from 'react';

const ERROR_THRESHOLD = 10;
const BURST_WINDOW = 5000;    // 5 seconds
const COOLDOWN = 120_000;     // 2 minutes

/**
 * Emergency mode backpressure hook.
 *
 * When 10+ errors arrive within a 5-second burst window, emergency mode
 * activates. This signals all non-critical monitors to disable and the
 * error pipeline to switch to batched summaries. Prevents noise floods
 * from cascading failures.
 *
 * Auto-exits after 2 minutes of calm. Manual reset also available.
 *
 * @param {object} opts
 * @param {Function} opts.log  Activity log function
 * @returns {{ emergencyActive: boolean, recordError: Function, resetEmergency: Function, burstCount: number }}
 */
export function useEmergencyMode({ log }) {
  const [emergencyActive, setEmergencyActive] = useState(false);
  const burstRef = useRef({ count: 0, windowStart: Date.now() });
  const cooldownTimerRef = useRef(null);
  const logRef = useRef(log);
  logRef.current = log;

  // Stable ref for emergencyActive so recordError callback doesn't
  // need it in deps (avoids re-creating callback on every state change)
  const emergencyRef = useRef(false);
  emergencyRef.current = emergencyActive;

  const recordError = useCallback(() => {
    const now = Date.now();

    // Reset window if expired
    if (now - burstRef.current.windowStart > BURST_WINDOW) {
      burstRef.current = { count: 1, windowStart: now };
      return;
    }

    burstRef.current.count++;

    if (burstRef.current.count > ERROR_THRESHOLD && !emergencyRef.current) {
      setEmergencyActive(true);
      logRef.current?.({
        type: 'emergency',
        message: `EMERGENCY MODE: ${burstRef.current.count} errors in ${BURST_WINDOW / 1000}s — pausing non-critical monitoring`,
        severity: 'error',
      });

      // Auto-exit after cooldown if no new burst
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = setTimeout(() => {
        cooldownTimerRef.current = null;
        setEmergencyActive(false);
        burstRef.current = { count: 0, windowStart: Date.now() };
        logRef.current?.({
          type: 'emergency',
          message: 'Emergency mode ended — monitoring resumed',
          severity: 'info',
        });
      }, COOLDOWN);
    }
  }, []); // Stable identity — reads everything via refs

  const resetEmergency = useCallback(() => {
    setEmergencyActive(false);
    burstRef.current = { count: 0, windowStart: Date.now() };
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
    logRef.current?.({
      type: 'emergency',
      message: 'Emergency mode manually reset — monitoring resumed',
      severity: 'info',
    });
  }, []);

  // Cleanup cooldown timer on unmount
  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    };
  }, []);

  return { emergencyActive, recordError, resetEmergency, burstCount: burstRef.current.count };
}
