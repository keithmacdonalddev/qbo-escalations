import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Self-monitoring heartbeat for the dev agent system.
 *
 * Runs leader-only checks every 60s:
 *   1. Server reachability via raw fetch to /api/health (bypasses circuit breaker)
 *   2. Time since last successful background send
 *
 * Returns:
 *   - agentHealthy: boolean (true = all checks pass)
 *   - healthDetails: { issues: string[], checkedAt: number|null }
 *   - recordBgSuccess: () => void  (call after each successful background send)
 */
export function useAgentSelfCheck({ isLeader, log } = {}) {
  const [agentHealthy, setAgentHealthy] = useState(true);
  const [healthDetails, setHealthDetails] = useState({ issues: [], checkedAt: null });
  const lastSuccessRef = useRef({ bg: 0, server: 0 });
  const logRef = useRef(log);
  logRef.current = log;

  // Stable callback for external callers to record a successful bg send
  const recordBgSuccess = useCallback(() => {
    lastSuccessRef.current.bg = Date.now();
  }, []);

  useEffect(() => {
    if (!isLeader) return;

    async function runCheck() {
      const issues = [];
      const now = Date.now();

      // 1. Server reachable? Use raw fetch to avoid circuit breaker / apiFetch wrappers
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch('/api/health', { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          lastSuccessRef.current.server = now;
        } else {
          issues.push(`Server returned ${res.status}`);
        }
      } catch {
        const downFor = now - lastSuccessRef.current.server;
        if (lastSuccessRef.current.server > 0 && downFor > 90_000) {
          issues.push(`Server unreachable for ${Math.round(downFor / 1000)}s`);
        } else if (lastSuccessRef.current.server === 0) {
          issues.push('Server has never responded');
        }
        // If server === 0 and downFor < 90s, we're in the grace period — no issue yet
      }

      // 2. Background sends working?
      // Only flag if we HAVE sent before but haven't in 10+ minutes
      if (lastSuccessRef.current.bg > 0) {
        const sinceLast = now - lastSuccessRef.current.bg;
        if (sinceLast > 600_000) {
          issues.push(`No successful background send in ${Math.round(sinceLast / 60_000)}m`);
        }
      }

      const healthy = issues.length === 0;
      setAgentHealthy(healthy);
      setHealthDetails({ issues, checkedAt: now });

      if (!healthy) {
        logRef.current?.({
          type: 'agent-health',
          message: `Self-check: ${issues.join('; ')}`,
          severity: 'warning',
        });
      }
    }

    // Initial check after 10s grace period (let everything boot)
    const initialDelay = setTimeout(runCheck, 10_000);

    // Subsequent checks every 60s
    const interval = setInterval(runCheck, 60_000);

    return () => {
      clearTimeout(initialDelay);
      clearInterval(interval);
    };
  }, [isLeader]);

  return { agentHealthy, healthDetails, recordBgSuccess };
}
