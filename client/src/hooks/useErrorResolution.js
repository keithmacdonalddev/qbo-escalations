import { useRef, useCallback, useMemo, useEffect } from 'react';

const VERIFY_WINDOW = 60_000; // 60 seconds after agent responds
const MAX_RETRIES = 3;

/**
 * Tracks reported errors and verifies whether the dev agent's fix actually worked.
 *
 * Lifecycle per error hash:
 *   pending -> awaiting-verification -> resolved | failed | escalated
 *
 * After the agent responds, a 60-second verification window opens.
 * If the same error hash recurs during that window (via markRecurrence),
 * the fix is considered failed and the error is retried with escalation
 * context up to MAX_RETRIES times. After that, it is marked escalated.
 *
 * @param {object} opts
 * @param {Function} opts.sendBackground  Background channel sender
 * @param {Function} opts.log             Activity log function
 */
export function useErrorResolution({ sendBackground, log } = {}) {
  const trackerRef = useRef(new Map()); // errorHash -> ResolutionEntry
  const timersRef = useRef(new Map()); // errorHash -> timeoutId (for cleanup)

  // Refs for stable callbacks
  const sendBackgroundRef = useRef(sendBackground);
  sendBackgroundRef.current = sendBackground;
  const logRef = useRef(log);
  logRef.current = log;

  /**
   * Called when an error is sent to the agent for fixing.
   * @param {string} errorHash   Unique hash from useErrorCapture
   * @param {string} errorMessage  Human-readable error message
   * @param {string} channel       Channel used (e.g. 'auto-errors')
   */
  const trackError = useCallback((errorHash, errorMessage, channel) => {
    const existing = trackerRef.current.get(errorHash);

    // If already tracking this hash and it's awaiting verification,
    // mark recurrence instead of overwriting
    if (existing && existing.status === 'awaiting-verification') {
      existing.recurred = true;
      return;
    }

    trackerRef.current.set(errorHash, {
      hash: errorHash,
      message: errorMessage,
      channel,
      reportedAt: Date.now(),
      status: 'pending', // pending -> awaiting-verification -> resolved | failed | escalated
      retries: existing ? existing.retries : 0,
      agentResponse: null,
      recurred: false,
      verifyAfter: null,
    });

    cleanup();
  }, []);

  /**
   * Verify whether a fix worked by checking for recurrence.
   * Called automatically after the verification window expires.
   */
  const verifyResolution = useCallback((errorHash) => {
    const entry = trackerRef.current.get(errorHash);
    if (!entry || entry.status !== 'awaiting-verification') return;

    // Clear the timer reference
    timersRef.current.delete(errorHash);

    if (!entry.recurred) {
      // Error did NOT recur within the window -- fix worked
      entry.status = 'resolved';
      logRef.current?.({
        type: 'error-resolved',
        message: `Fixed: ${entry.message.slice(0, 80)}`,
        severity: 'success',
      });
    } else {
      // Error recurred -- fix failed
      entry.retries++;
      entry.recurred = false;

      if (entry.retries < MAX_RETRIES) {
        entry.status = 'retry';
        logRef.current?.({
          type: 'error-retry',
          message: `Fix failed, retrying (${entry.retries}/${MAX_RETRIES}): ${entry.message.slice(0, 60)}`,
          severity: 'warning',
        });

        // Re-send with escalation context
        if (typeof sendBackgroundRef.current === 'function') {
          const retryMessage = [
            `[AUTO-ERROR] Previous fix FAILED for: ${entry.message}`,
            '',
            `The error recurred within 60 seconds of your fix. This is attempt ${entry.retries + 1}/${MAX_RETRIES}.`,
            '',
            entry.agentResponse
              ? `Previous response summary: ${entry.agentResponse.slice(0, 300)}`
              : '',
            '',
            'Try a different approach. The previous fix did not resolve the root cause.',
          ].filter(Boolean).join('\n');

          sendBackgroundRef.current('auto-errors', retryMessage)
            .then((result) => {
              if (result?.assistantText) {
                recordAgentResponse(errorHash, result.assistantText, result?.toolEvents);
              }
            })
            .catch(() => {
              // If retry send itself fails, escalate immediately
              entry.status = 'escalated';
              logRef.current?.({
                type: 'error-escalated',
                message: `Retry send failed, escalated: ${entry.message.slice(0, 60)}`,
                severity: 'error',
              });
            });
        }
      } else {
        entry.status = 'escalated';
        logRef.current?.({
          type: 'error-escalated',
          message: `Unresolved after ${MAX_RETRIES} attempts: ${entry.message.slice(0, 60)}`,
          severity: 'error',
        });
      }
    }
  }, []); // reads sendBackground and log via refs

  /**
   * Called when the agent responds to an error report.
   * Opens the 60-second verification window.
   *
   * @param {string} errorHash    Hash of the error that was reported
   * @param {string} response     Agent's assistantText response
   * @param {object[]} [toolEvents] Optional tool events from the agent response
   */
  const recordAgentResponse = useCallback((errorHash, response, toolEvents) => {
    const entry = trackerRef.current.get(errorHash);
    if (!entry) return;

    entry.status = 'awaiting-verification';
    entry.agentResponse = response;
    entry.recurred = false;
    entry.hmrApplied = false;
    entry.verifyAfter = Date.now() + VERIFY_WINDOW;

    // Extract file paths from tool events (Write/Edit tools)
    const agentFiles = [];
    if (toolEvents && Array.isArray(toolEvents)) {
      for (const evt of toolEvents) {
        if (evt.tool === 'Write' || evt.tool === 'Edit') {
          const fp = evt.input?.file_path || evt.details?.file_path || evt.details?.input?.file_path;
          if (fp) agentFiles.push(fp);
        }
      }
    }
    entry.agentFiles = agentFiles;

    // Clear any existing timer for this hash
    const existingTimer = timersRef.current.get(errorHash);
    if (existingTimer) clearTimeout(existingTimer);

    // Set up verification timer
    const timerId = setTimeout(() => {
      verifyResolution(errorHash);
    }, VERIFY_WINDOW);
    timersRef.current.set(errorHash, timerId);
  }, [verifyResolution]);

  /**
   * Called when Vite HMR applies module updates.
   * Checks if any pending/awaiting-verification entries relate to the updated
   * files, and if so, marks them as having their fix applied via HMR.
   *
   * @param {string[]} updatedPaths  Array of module paths that HMR updated
   */
  const onHMRUpdate = useCallback((updatedPaths) => {
    if (!updatedPaths || updatedPaths.length === 0) return;

    for (const [hash, entry] of trackerRef.current) {
      if (entry.status !== 'pending' && entry.status !== 'awaiting-verification') continue;
      if (!entry.agentFiles || entry.agentFiles.length === 0) continue;

      // Check if any agent-edited file matches an HMR-updated module path.
      // Agent files are full paths, HMR paths are relative -- so check if
      // the HMR path is a suffix of the agent file path.
      const matched = entry.agentFiles.some(agentFile =>
        updatedPaths.some(hmrPath => {
          const normalizedAgent = agentFile.replace(/\\/g, '/');
          const normalizedHMR = hmrPath.replace(/\\/g, '/');
          return normalizedAgent.endsWith(normalizedHMR)
            || normalizedHMR.endsWith(normalizedAgent)
            || normalizedAgent.includes(normalizedHMR)
            || normalizedHMR.includes(normalizedAgent);
        })
      );

      if (matched && !entry.hmrApplied) {
        entry.hmrApplied = true;
        entry.hmrAppliedAt = Date.now();
        logRef.current?.({
          type: 'fix-applied',
          message: `Fix applied via HMR: ${entry.message.slice(0, 60)}`,
          severity: 'success',
        });
      }
    }
  }, []);

  /**
   * Called when the same error recurs (same hash appears again).
   * If currently in awaiting-verification state, marks as recurred
   * so the verification timer knows the fix failed.
   *
   * @param {string} errorHash  Hash from useErrorCapture
   */
  const markRecurrence = useCallback((errorHash) => {
    const entry = trackerRef.current.get(errorHash);
    if (entry && entry.status === 'awaiting-verification') {
      entry.recurred = true;
    }
  }, []);

  /**
   * Get aggregate resolution stats.
   * @returns {{ pending: number, awaiting: number, resolved: number, failed: number, escalated: number, total: number }}
   */
  const getStats = useCallback(() => {
    const stats = { pending: 0, awaiting: 0, resolved: 0, failed: 0, escalated: 0, total: 0 };
    for (const entry of trackerRef.current.values()) {
      stats.total++;
      if (entry.status === 'resolved') stats.resolved++;
      else if (entry.status === 'escalated') stats.escalated++;
      else if (entry.status === 'awaiting-verification') stats.awaiting++;
      else if (entry.status === 'retry') stats.failed++;
      else stats.pending++;
    }
    return stats;
  }, []);

  /**
   * Cleanup old entries -- keep at most 50 by recency.
   * Also clears timers for evicted entries.
   */
  const cleanup = useCallback(() => {
    if (trackerRef.current.size <= 50) return;

    const entries = [...trackerRef.current.entries()]
      .sort((a, b) => b[1].reportedAt - a[1].reportedAt);

    const keep = new Set(entries.slice(0, 50).map(([k]) => k));
    const evicted = entries.slice(50);

    for (const [hash] of evicted) {
      const timer = timersRef.current.get(hash);
      if (timer) {
        clearTimeout(timer);
        timersRef.current.delete(hash);
      }
      trackerRef.current.delete(hash);
    }
  }, []);

  /**
   * Get the current status of a specific error hash.
   * @param {string} errorHash
   * @returns {string|null} Status or null if not tracked
   */
  const getStatus = useCallback((errorHash) => {
    return trackerRef.current.get(errorHash)?.status || null;
  }, []);

  return useMemo(() => ({
    trackError,
    recordAgentResponse,
    markRecurrence,
    onHMRUpdate,
    getStats,
    getStatus,
    cleanup,
  }), [trackError, recordAgentResponse, markRecurrence, onHMRUpdate, getStats, getStatus, cleanup]);
}
