import { useEffect, useRef, useCallback } from 'react';
import { onRequestEvent } from '../api/http.js';

const ANALYSIS_INTERVAL_MS = 30_000;
const ALERT_COOLDOWN_MS = 300_000; // 5 min per endpoint
const WINDOW_MS = 300_000;         // analyze last 5 minutes
const P95_SLOW_MS = 3000;
const P95_REGRESSION_PCT = 0.5;    // 50% increase triggers alert
const ERROR_RATE_THRESHOLD = 0.5;
const MIN_REQUESTS_PERF = 5;
const MIN_REQUESTS_ERROR = 3;
const VOLUME_THRESHOLD = 30;       // requests per minute
const SSE_FAIL_THRESHOLD = 3;
const DEDUP_INFO_THRESHOLD = 10;
const OUTLIER_MULTIPLIER = 10;

/**
 * Analyzes HTTP request traffic in real-time and surfaces performance
 * insights to the dev agent. Subscribes to the same request event bus
 * that the waterfall UI uses, but runs automated analysis instead of
 * rendering a visual timeline.
 *
 * Insights:
 * - Slow endpoint trending (P95 > 3s or 50%+ regression)
 * - High error rates (>50% on any endpoint with 3+ requests)
 * - Request volume anomaly (>30 req/min)
 * - SSE stream failure patterns (3+ failures on same SSE endpoint)
 * - Dedup savings analysis (10+ saved = informational log)
 * - Latency spike detection (10x above endpoint P50)
 */
export function useWaterfallInsights({ enabled = true, isLeader, sendBackground, log }) {
  const requestsRef = useRef([]);
  const dedupCountRef = useRef(0);
  const alertedRef = useRef(new Map());     // endpoint -> lastAlertedAt
  const prevWindowRef = useRef(new Map());  // endpoint -> { p95 } from previous window
  const intervalRef = useRef(null);

  // ---- helpers ----

  const alertEndpoint = useCallback((endpoint, message, detail) => {
    const last = alertedRef.current.get(endpoint);
    if (last && Date.now() - last < ALERT_COOLDOWN_MS) return;
    alertedRef.current.set(endpoint, Date.now());

    log?.({ type: 'perf-insight', message, severity: 'warning', detail });
    sendBackground?.('auto-errors', `[AUTO-ERROR] Performance insight: ${message}\n\nInvestigate the server-side handler for this endpoint. Look for: slow database queries, missing indexes, unnecessary computation, large payload sizes.`);
  }, [log, sendBackground]);

  const logInfo = useCallback((message, detail) => {
    log?.({ type: 'perf-insight', message, severity: 'info', detail });
  }, [log]);

  // ---- analysis functions ----

  const groupByEndpoint = useCallback((reqs) => {
    const groups = new Map();
    for (const req of reqs) {
      try {
        const path = new URL(req.url, location.origin).pathname;
        if (!groups.has(path)) groups.set(path, []);
        groups.get(path).push(req);
      } catch { /* malformed URL — skip */ }
    }
    return groups;
  }, []);

  const percentile = useCallback((sorted, pct) => {
    if (sorted.length === 0) return 0;
    const idx = Math.min(Math.ceil(sorted.length * pct) - 1, sorted.length - 1);
    return sorted[Math.max(0, idx)];
  }, []);

  const runAnalysis = useCallback(() => {
    if (!isLeader) return;

    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    const recent = requestsRef.current.filter(r => r.timestamp > cutoff);

    // Prune old entries (keep only last 10 minutes for prev-window comparison)
    // Also enforce a hard cap of 5000 entries to prevent unbounded memory growth
    // in high-traffic scenarios.
    requestsRef.current = requestsRef.current.filter(r => r.timestamp > now - WINDOW_MS * 2);
    if (requestsRef.current.length > 5000) {
      requestsRef.current = requestsRef.current.slice(-5000);
    }

    // a) Slow endpoint trending
    const completed = recent.filter(r => r.phase === 'complete' && r.duration != null);
    const perfGroups = groupByEndpoint(completed);
    const currentP95s = new Map();

    for (const [endpoint, reqs] of perfGroups) {
      if (reqs.length < MIN_REQUESTS_PERF) continue;
      if (endpoint.includes('/api/dev/')) continue;

      const durations = reqs.map(r => r.duration).sort((a, b) => a - b);
      const p50 = percentile(durations, 0.5);
      const p95 = percentile(durations, 0.95);
      currentP95s.set(endpoint, { p95, p50 });

      if (p95 > P95_SLOW_MS) {
        alertEndpoint(endpoint,
          `Endpoint ${endpoint} is slow -- P50: ${Math.round(p50)}ms, P95: ${Math.round(p95)}ms over ${reqs.length} requests`,
          `Durations: min=${Math.round(durations[0])}ms, max=${Math.round(durations[durations.length - 1])}ms`
        );
      }

      // Check for regression vs previous window
      const prev = prevWindowRef.current.get(endpoint);
      if (prev && prev.p95 > 0 && p95 > prev.p95 * (1 + P95_REGRESSION_PCT)) {
        alertEndpoint(endpoint,
          `Endpoint ${endpoint} is getting slower -- P95 went from ${Math.round(prev.p95)}ms to ${Math.round(p95)}ms (+${Math.round(((p95 - prev.p95) / prev.p95) * 100)}%)`,
          `Previous window P95: ${Math.round(prev.p95)}ms, current: ${Math.round(p95)}ms`
        );
      }

      // f) Latency spike detection — individual outliers
      for (const req of reqs) {
        if (p50 > 0 && req.duration > p50 * OUTLIER_MULTIPLIER && req.duration > 1000) {
          logInfo(
            `Outlier request: ${req.method} ${endpoint} took ${Math.round(req.duration)}ms (P50 is ${Math.round(p50)}ms)`,
            `${Math.round(req.duration / p50)}x above median`
          );
        }
      }
    }

    // Save current P95s for next window comparison
    prevWindowRef.current = currentP95s;

    // b) High error rate detection
    const allWithStatus = recent.filter(r => r.phase === 'complete' || r.phase === 'error');
    const errorGroups = groupByEndpoint(allWithStatus);

    for (const [endpoint, reqs] of errorGroups) {
      if (reqs.length < MIN_REQUESTS_ERROR) continue;
      if (endpoint.includes('/api/dev/')) continue;

      const errors = reqs.filter(r => (r.status && r.status >= 400) || r.phase === 'error');
      const errorRate = errors.length / reqs.length;

      if (errorRate > ERROR_RATE_THRESHOLD) {
        const statuses = [...new Set(errors.map(e => e.status).filter(Boolean))];
        alertEndpoint(endpoint,
          `Endpoint ${endpoint} has a ${Math.round(errorRate * 100)}% error rate -- ${errors.length}/${reqs.length} requests failed. Statuses: ${statuses.join(', ') || 'network error'}`,
          `Error breakdown: ${statuses.map(s => `${s}: ${errors.filter(e => e.status === s).length}`).join(', ')}`
        );
      }
    }

    // c) Request volume anomaly
    const oneMinAgo = now - 60_000;
    const lastMinute = recent.filter(r => r.timestamp > oneMinAgo && r.phase === 'start');
    if (lastMinute.length > VOLUME_THRESHOLD) {
      // Only alert once per cooldown using a synthetic endpoint key
      alertEndpoint('__volume__',
        `High request volume: ${lastMinute.length} requests/min. The app may be polling too aggressively or triggering unnecessary API calls.`,
        `Top endpoints: ${[...groupByEndpoint(lastMinute)].sort((a, b) => b[1].length - a[1].length).slice(0, 3).map(([ep, rs]) => `${ep}: ${rs.length}`).join(', ')}`
      );
    }

    // d) SSE stream failure pattern
    const sseErrors = recent.filter(r => r.isSSE && r.phase === 'error');
    const sseGroups = groupByEndpoint(sseErrors);
    for (const [endpoint, reqs] of sseGroups) {
      if (reqs.length >= SSE_FAIL_THRESHOLD) {
        alertEndpoint(endpoint,
          `SSE stream to ${endpoint} keeps breaking -- ${reqs.length} failures in the last 5 minutes. Connection is unstable.`,
          `Error messages: ${[...new Set(reqs.map(r => r.error).filter(Boolean))].join('; ')}`
        );
      }
    }

    // e) Dedup savings analysis (informational)
    if (dedupCountRef.current >= DEDUP_INFO_THRESHOLD) {
      logInfo(
        `Dedup saved ${dedupCountRef.current} redundant requests in the last 30s. Components may need memoization.`,
        'Single-flight deduplication prevented duplicate GET requests from reaching the server'
      );
    }
    dedupCountRef.current = 0;
  }, [isLeader, groupByEndpoint, percentile, alertEndpoint, logInfo]);

  // ---- subscription + interval ----

  useEffect(() => {
    if (!enabled) return;

    const cleanups = [];

    try {
      const unsub = onRequestEvent((event) => {
        if (event.phase === 'dedup') {
          dedupCountRef.current++;
          return;
        }
        // Hard cap: prevent unbounded growth in high-traffic scenarios
        if (requestsRef.current.length < 10000) {
          requestsRef.current.push({
            ...event,
            timestamp: Date.now(),
          });
        }
      });
      cleanups.push(unsub);

      intervalRef.current = setInterval(runAnalysis, ANALYSIS_INTERVAL_MS);
      cleanups.push(() => { if (intervalRef.current) clearInterval(intervalRef.current); });
    } catch (err) {
      console.error('[DevAgent] useWaterfallInsights setup failed:', err);
    }

    return () => {
      for (const fn of cleanups) {
        try { fn(); } catch {}
      }
    };
  }, [enabled, runAnalysis]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      try { requestsRef.current = []; } catch {}
      try { dedupCountRef.current = 0; } catch {}
      try { alertedRef.current.clear(); } catch {}
      try { prevWindowRef.current.clear(); } catch {}
    };
  }, []);
}
