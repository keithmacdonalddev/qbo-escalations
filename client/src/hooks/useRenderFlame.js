import { useState, useRef, useCallback, useEffect } from 'react';

const MAX_SEGMENTS = 60;
const FADE_AFTER_MS = 2500;
const REMOVE_AFTER_MS = 4500;
const STORAGE_KEY = 'qbo-flame-expanded';
const FLUSH_INTERVAL_MS = 250; // Throttle state updates to 4/sec max

function getTier(ms) {
  if (ms < 8) return 'green';
  if (ms <= 16) return 'amber';
  return 'red';
}

/**
 * Captures React.Profiler render timings for the dev-only flame bar.
 *
 * Critical: This hook must NOT cause a feedback loop. The Profiler fires
 * onRender for every commit. If onRender triggers a state update, that
 * state update causes another commit, which fires onRender again → OOM.
 *
 * Solution: onRender only mutates refs (zero React state). A fixed-interval
 * timer (not rAF) flushes ref→state at 4Hz. This decouples measurement
 * from rendering and caps the update rate.
 */
export function useRenderFlame() {
  if (!import.meta.env.DEV) {
    return { onRender: () => {}, segments: [], stats: { green: 0, amber: 0, red: 0, avg: '0' }, expanded: false, toggleExpanded: () => {} };
  }

  const [segments, setSegments] = useState([]);
  const [expanded, setExpanded] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? false; } catch { return false; }
  });

  // Mutable buffer — onRender writes here, interval reads it
  const bufferRef = useRef([]);
  const countsRef = useRef({ green: 0, amber: 0, red: 0, total: 0, totalMs: 0 });
  const nextIdRef = useRef(1);
  const dirtyRef = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(expanded)); } catch {}
  }, [expanded]);

  const toggleExpanded = useCallback(() => setExpanded(prev => !prev), []);

  // onRender: ONLY mutates refs. Never calls setState. Never schedules rAF.
  // This is the key to avoiding the feedback loop.
  const onRender = useCallback((_profilerId, phase, actualDuration) => {
    const tier = getTier(actualDuration);
    const id = nextIdRef.current++;
    const width = Math.max(3, Math.min(40, actualDuration * 1.5));
    const now = Date.now();

    const buf = bufferRef.current;
    // Mutate in place — push + shift, no spread copies
    buf.push({ id, duration: actualDuration, phase, tier, width, fading: false, createdAt: now });
    while (buf.length > MAX_SEGMENTS) buf.shift();

    const c = countsRef.current;
    c[tier]++;
    c.total++;
    c.totalMs += actualDuration;

    dirtyRef.current = true;
  }, []);

  // Fixed-interval flush: reads buffer, applies lifecycle, pushes to React state.
  // Runs at 4Hz regardless of render frequency. This is the ONLY place setState is called.
  useEffect(() => {
    const tid = setInterval(() => {
      const buf = bufferRef.current;
      const now = Date.now();

      // Apply lifecycle in-place
      let changed = dirtyRef.current;
      for (let i = buf.length - 1; i >= 0; i--) {
        const seg = buf[i];
        const age = now - seg.createdAt;
        if (age >= REMOVE_AFTER_MS) {
          buf.splice(i, 1);
          changed = true;
        } else if (age >= FADE_AFTER_MS && !seg.fading) {
          seg.fading = true;
          changed = true;
        }
      }

      if (changed) {
        dirtyRef.current = false;
        // Shallow copy for React — but only 4 times/sec, not per render
        setSegments(buf.slice());
      }
    }, FLUSH_INTERVAL_MS);

    return () => clearInterval(tid);
  }, []);

  const stats = {
    green: countsRef.current.green,
    amber: countsRef.current.amber,
    red: countsRef.current.red,
    avg: countsRef.current.total > 0
      ? (countsRef.current.totalMs / countsRef.current.total).toFixed(1)
      : '0',
  };

  return { onRender, segments, stats, expanded, toggleExpanded };
}
