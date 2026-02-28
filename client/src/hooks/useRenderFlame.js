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

const TIMELINE_SECONDS = 60;

function buildTimeline(buckets, nowSec) {
  const arr = new Array(TIMELINE_SECONDS);
  let maxTotal = 1;
  for (let i = 0; i < TIMELINE_SECONDS; i++) {
    const b = buckets.get(nowSec - TIMELINE_SECONDS + 1 + i);
    if (b) {
      const t = b.green + b.amber + b.red;
      if (t > maxTotal) maxTotal = t;
    }
  }
  for (let i = 0; i < TIMELINE_SECONDS; i++) {
    const b = buckets.get(nowSec - TIMELINE_SECONDS + 1 + i);
    if (b) {
      const total = b.green + b.amber + b.red;
      if (total > 0) {
        const worst = b.red > 0 ? 'red' : b.amber > 0 ? 'amber' : 'green';
        arr[i] = { worst, intensity: total / maxTotal, total };
        continue;
      }
    }
    arr[i] = null;
  }
  return arr;
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
  const isDev = import.meta.env.DEV;

  const [segments, setSegments] = useState([]);
  const [expanded, setExpanded] = useState(() => {
    if (!isDev) return false;
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? false; } catch { return false; }
  });
  const [paused, setPaused] = useState(false);
  const [timeline, setTimeline] = useState([]);

  // Mutable buffer — onRender writes here, interval reads it
  const bufferRef = useRef([]);
  const countsRef = useRef({ green: 0, amber: 0, red: 0, total: 0, totalMs: 0 });
  const nextIdRef = useRef(1);
  const dirtyRef = useRef(false);
  const pausedRef = useRef(false);
  // Suppress the onRender call caused by our own setSegments flush.
  // Without this, flush→render→onRender→dirty→flush loops forever.
  const suppressRef = useRef(false);
  const timelineBucketsRef = useRef(new Map());
  const lastTimelineSecRef = useRef(0);

  useEffect(() => {
    if (!isDev) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(expanded)); } catch {}
  }, [expanded, isDev]);

  const toggleExpanded = useCallback(() => setExpanded(prev => !prev), []);
  const togglePaused = useCallback(() => {
    setPaused(prev => {
      pausedRef.current = !prev;
      return !prev;
    });
  }, []);

  // onRender: ONLY mutates refs. Never calls setState. Never schedules rAF.
  // This is the key to avoiding the feedback loop.
  const onRender = useCallback((_profilerId, phase, actualDuration) => {
    if (!isDev) return;
    if (pausedRef.current) return;
    // Skip counting the render caused by our own setSegments flush
    if (suppressRef.current) { suppressRef.current = false; return; }
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

    // Tally into current-second timeline bucket
    const sec = Math.floor(now / 1000);
    let bucket = timelineBucketsRef.current.get(sec);
    if (!bucket) { bucket = { green: 0, amber: 0, red: 0 }; timelineBucketsRef.current.set(sec, bucket); }
    bucket[tier]++;

    dirtyRef.current = true;
  }, [isDev]);

  // Fixed-interval flush: reads buffer, applies lifecycle, pushes to React state.
  // Runs at 4Hz regardless of render frequency. This is the ONLY place setState is called.
  useEffect(() => {
    if (!isDev) return;
    const tid = setInterval(() => {
      const buf = bufferRef.current;
      const now = Date.now();

      // When paused, skip lifecycle aging and flush — freeze segments in place
      if (pausedRef.current) return;

      // Apply lifecycle in-place
      let segmentsChanged = dirtyRef.current;
      for (let i = buf.length - 1; i >= 0; i--) {
        const seg = buf[i];
        const age = now - seg.createdAt;
        if (age >= REMOVE_AFTER_MS) {
          buf.splice(i, 1);
          segmentsChanged = true;
        } else if (age >= FADE_AFTER_MS && !seg.fading) {
          seg.fading = true;
          segmentsChanged = true;
        }
      }

      // Check if timeline second changed
      const nowSec = Math.floor(now / 1000);
      const timelineChanged = nowSec !== lastTimelineSecRef.current;

      if (!segmentsChanged && !timelineChanged) return;

      suppressRef.current = true;

      if (segmentsChanged) {
        dirtyRef.current = false;
        setSegments(buf.slice());
      }

      if (timelineChanged) {
        lastTimelineSecRef.current = nowSec;
        const cutoff = nowSec - TIMELINE_SECONDS - 1;
        for (const sec of timelineBucketsRef.current.keys()) {
          if (sec < cutoff) timelineBucketsRef.current.delete(sec);
        }
        setTimeline(buildTimeline(timelineBucketsRef.current, nowSec));
      }
    }, FLUSH_INTERVAL_MS);

    return () => clearInterval(tid);
  }, [isDev]);

  const clearAll = useCallback(() => {
    bufferRef.current.length = 0;
    countsRef.current = { green: 0, amber: 0, red: 0, total: 0, totalMs: 0 };
    timelineBucketsRef.current.clear();
    lastTimelineSecRef.current = 0;
    dirtyRef.current = false;
    setSegments([]);
    setTimeline([]);
  }, []);

  if (!isDev) {
    return { onRender: () => {}, segments: [], stats: { green: 0, amber: 0, red: 0, avg: '0' }, expanded: false, toggleExpanded: () => {}, paused: false, togglePaused: () => {}, clearAll: () => {}, timeline: [] };
  }

  const stats = {
    green: countsRef.current.green,
    amber: countsRef.current.amber,
    red: countsRef.current.red,
    avg: countsRef.current.total > 0
      ? (countsRef.current.totalMs / countsRef.current.total).toFixed(1)
      : '0',
  };

  return { onRender, segments, stats, expanded, toggleExpanded, paused, togglePaused, clearAll, timeline };
}
