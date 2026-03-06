import { useCallback, useRef, useMemo, useEffect } from 'react';
import { useErrorCapture } from './useErrorCapture.js';
import { getBreadcrumbs } from '../lib/devTelemetry.js';
import { classifySeverity, TIER_CONFIG, SEVERITY, SEVERITY_LABELS } from '../lib/severityClassifier.js';

/**
 * Connects useErrorCapture to the background agent's auto-errors channel.
 *
 * Accepts sendBackground and isLeader as props (NOT from useDevAgent) to
 * avoid a circular dependency — this hook is called inside DevAgentProvider
 * before the context value is assembled.
 *
 * Safety features:
 * - Per-tier budgets: each severity tier has independent rate limits
 *   so CRITICAL errors are never blocked by WARNING/INFO noise
 * - CRITICAL: unlimited, immediate, always sends
 * - URGENT: 2 per 5min, immediate
 * - ELEVATED: 2 per 5min, 5s batching
 * - MONITORING: 1 per 10min, 30s batching
 * - INFO: never sends (log only)
 * - Feedback loop prevention: ignores errors originating from /api/dev/
 * - Leader-only: non-leader tabs stay silent
 * - Stack truncation: only first 8 stack frames sent
 * - Emergency batching: when emergencyActive, batch errors into 5s summaries
 *
 * @param {object} opts
 * @param {boolean}  [opts.enabled=true]   Master kill switch (gates error capture setup)
 * @param {Function} opts.sendBackground  sendBackground(channel, message, options)
 * @param {boolean}  opts.isLeader        Whether this tab is the leader
 * @param {Function} opts.log             Activity log function
 * @param {boolean}  [opts.emergencyActive]  Whether emergency mode is active
 * @param {Function} [opts.recordError]   Callback to record error for burst detection
 * @param {object}   [opts.errorResolution] Resolution tracker from useErrorResolution
 */
export function useAutoErrorReporter({ enabled = true, sendBackground, isLeader, log, emergencyActive, recordError, errorResolution }) {
  // Per-tier budget tracking: severity -> { count, windowStart }
  const tierCountsRef = useRef({});
  // Per-tier batch buffers: severity -> error[]
  const tierBatchRef = useRef({});
  // Per-tier batch timers: severity -> timeout id
  const tierTimerRef = useRef({});

  // Emergency batching refs
  const batchRef = useRef([]);
  const batchTimerRef = useRef(null);
  const sendBackgroundRef = useRef(sendBackground);
  sendBackgroundRef.current = sendBackground;
  const logRef = useRef(log);
  logRef.current = log;
  const emergencyRef = useRef(emergencyActive);
  emergencyRef.current = emergencyActive;
  const recordErrorRef = useRef(recordError);
  recordErrorRef.current = recordError;
  const errorResolutionRef = useRef(errorResolution);
  errorResolutionRef.current = errorResolution;

  /**
   * Check whether a tier still has budget remaining in its current window.
   * Returns true if the error can be sent, false if throttled.
   */
  function checkTierBudget(severity) {
    const config = TIER_CONFIG[severity];
    if (!config) return false;
    if (!config.sendToAgent) return false; // Tier 5 (INFO): never send

    const now = Date.now();
    if (!tierCountsRef.current[severity]) {
      tierCountsRef.current[severity] = { count: 0, windowStart: now };
    }
    const tier = tierCountsRef.current[severity];

    // Reset window if expired
    if (now - tier.windowStart > config.windowMs) {
      tier.count = 0;
      tier.windowStart = now;
    }

    return tier.count < config.maxPerWindow;
  }

  /**
   * Record a send against the tier's budget.
   */
  function consumeTierBudget(severity) {
    if (!tierCountsRef.current[severity]) {
      tierCountsRef.current[severity] = { count: 0, windowStart: Date.now() };
    }
    tierCountsRef.current[severity].count++;
  }

  /**
   * Build the message payload for an error.
   */
  function buildMessage(err) {
    const countNote = err.count > 1 ? ` (occurred ${err.count}x)` : '';
    const stackLines = err.stack
      ? err.stack.split('\n').slice(0, 8).join('\n')
      : '';

    const crumbs = getBreadcrumbs();
    const trailSection = crumbs.length > 0
      ? '\n\nBreadcrumb trail (last 10 actions before error):\n' +
        crumbs.slice(-10).map(b =>
          `  [${new Date(b.timestamp).toLocaleTimeString()}] ${b.category}: ${b.message}`
        ).join('\n')
      : '';

    return [
      `[AUTO-ERROR] Runtime error detected${countNote}`,
      '',
      `Error: ${err.message}`,
      stackLines ? `Stack:\n${stackLines}` : '',
      err.source ? `Source: ${err.source}:${err.line}:${err.col}` : '',
      '',
      'Fix this error. Read the source file, identify the root cause, and apply the fix.',
    ].filter(Boolean).join('\n') + trailSection;
  }

  /**
   * Send a single error immediately (CRITICAL/URGENT) or buffer for batching
   * (ELEVATED/MONITORING) based on the tier's batchMs config.
   */
  function sendOrBatch(err, severity) {
    const config = TIER_CONFIG[severity];
    const label = SEVERITY_LABELS[severity];

    // No batching: send immediately
    if (!config.batchMs || config.batchMs === 0) {
      const message = buildMessage(err);
      const errPreview = (err.message || '').length > 60 ? (err.message || '').slice(0, 60) + '...' : err.message;
      logRef.current?.({ type: 'error-captured', message: `[${label}] Runtime error: ${errPreview}`, severity: 'error', _severity: severity });

      // Track error in resolution system and capture agent response
      const resolution = errorResolutionRef.current;
      resolution?.trackError(err.hash, err.message, 'auto-errors');

      const resultPromise = sendBackgroundRef.current?.('auto-errors', message);
      consumeTierBudget(severity);
      logRef.current?.({ type: 'error-reported', message: `[${label}] Sent to auto-errors`, channel: 'auto-errors', _severity: severity });

      // Asynchronously capture the agent response for resolution verification
      if (resultPromise && resolution) {
        resultPromise.then((result) => {
          if (result?.assistantText) {
            resolution.recordAgentResponse(err.hash, result.assistantText, result.toolEvents);
          }
        }).catch(() => {}); // Errors handled elsewhere
      }
      return;
    }

    // Batching: accumulate and flush after batchMs
    if (!tierBatchRef.current[severity]) {
      tierBatchRef.current[severity] = [];
    }
    tierBatchRef.current[severity].push(err);

    if (!tierTimerRef.current[severity]) {
      tierTimerRef.current[severity] = setTimeout(() => {
        tierTimerRef.current[severity] = null;
        const batch = (tierBatchRef.current[severity] || []).splice(0);
        if (batch.length === 0) return;

        // Recheck budget at flush time (window may have reset)
        if (!checkTierBudget(severity)) {
          logRef.current?.({ type: 'error-circuit', message: `[${label}] Tier budget exhausted, ${batch.length} batched errors dropped`, severity: 'warning', _severity: severity });
          return;
        }

        const resolution = errorResolutionRef.current;
        let resultPromise;

        if (batch.length === 1) {
          // Single error: send normally
          const message = buildMessage(batch[0]);
          resolution?.trackError(batch[0].hash, batch[0].message, 'auto-errors');
          resultPromise = sendBackgroundRef.current?.('auto-errors', message);
        } else {
          // Multiple errors: send as batch summary, track each hash
          const summary = batch.map(e => `- ${(e.message || '').slice(0, 80)}`).join('\n');
          for (const e of batch) {
            resolution?.trackError(e.hash, e.message, 'auto-errors');
          }
          resultPromise = sendBackgroundRef.current?.('auto-errors', `[AUTO-ERROR] ${label} batch: ${batch.length} errors in ${config.batchMs / 1000}s window\n\n${summary}\n\nMultiple ${label.toLowerCase()}-level errors collected. Investigate the pattern.`);
        }

        // Capture agent response for resolution verification
        if (resultPromise && resolution) {
          resultPromise.then((result) => {
            if (result?.assistantText) {
              for (const e of batch) {
                resolution.recordAgentResponse(e.hash, result.assistantText, result.toolEvents);
              }
            }
          }).catch(() => {}); // Errors handled elsewhere
        }

        consumeTierBudget(severity);
        logRef.current?.({
          type: 'error-reported',
          message: `[${label}] Batched ${batch.length} error(s) sent to auto-errors`,
          channel: 'auto-errors',
          _severity: severity,
        });
      }, config.batchMs);
    }
  }

  const handleErrors = useCallback((errors) => {
    if (!isLeader) return;
    if (typeof sendBackgroundRef.current !== 'function') return;

    // Record each error for burst detection (emergency mode trigger)
    for (let i = 0; i < errors.length; i++) {
      recordErrorRef.current?.();
    }

    // Emergency mode: batch ALL errors into a single summary regardless of tier
    if (emergencyRef.current) {
      for (const err of errors) {
        if (err.stack?.includes('/api/dev/')) continue;
        if (err.source?.includes('/api/dev/')) continue;
        if (err.stack?.includes('useAutoErrorReporter')) continue;
        if (err.stack?.includes('useErrorCapture')) continue;
        batchRef.current.push(err);
      }
      // Flush batch after 5 seconds of accumulation
      if (!batchTimerRef.current && batchRef.current.length > 0) {
        batchTimerRef.current = setTimeout(() => {
          batchTimerRef.current = null;
          const batch = batchRef.current.splice(0);
          if (batch.length === 0) return;

          const summary = batch.map(e => `- ${(e.message || '').slice(0, 80)}`).join('\n');
          logRef.current?.({
            type: 'error-captured',
            message: `Emergency batch: ${batch.length} errors collected`,
            severity: 'error',
            _severity: SEVERITY.CRITICAL,
          });

          sendBackgroundRef.current?.('auto-errors', `[AUTO-ERROR] Emergency batch: ${batch.length} errors in rapid succession\n\n${summary}\n\nMultiple errors fired rapidly. This may indicate a cascading failure. Investigate the root cause.`);
          logRef.current?.({ type: 'error-reported', message: `Emergency batch sent (${batch.length} errors)`, channel: 'auto-errors', _severity: SEVERITY.CRITICAL });
        }, 5000);
      }
      return;
    }

    for (const err of errors) {
      // Signal recurrence to the resolution tracker (before any filtering).
      // If this error hash is currently awaiting verification from a previous
      // fix attempt, this marks the fix as failed.
      errorResolutionRef.current?.markRecurrence(err.hash);

      // Feedback loop prevention: skip errors from dev API requests
      if (err.stack?.includes('/api/dev/')) continue;
      if (err.source?.includes('/api/dev/')) continue;
      // Also skip errors from this hook itself
      if (err.stack?.includes('useAutoErrorReporter')) continue;
      if (err.stack?.includes('useErrorCapture')) continue;

      // Classify severity based on error metadata
      const severity = classifySeverity(err);
      const label = SEVERITY_LABELS[severity];
      const config = TIER_CONFIG[severity];

      // INFO tier: log only, never send
      if (!config.sendToAgent) {
        const errPreview = (err.message || '').length > 60 ? (err.message || '').slice(0, 60) + '...' : err.message;
        logRef.current?.({ type: 'error-captured', message: `[${label}] ${errPreview} (log only)`, severity: 'info', _severity: severity });
        continue;
      }

      // Check tier-specific budget
      if (!checkTierBudget(severity)) {
        logRef.current?.({ type: 'error-circuit', message: `[${label}] Tier budget exhausted (${tierCountsRef.current[severity]?.count}/${config.maxPerWindow} in window)`, severity: 'warning', _severity: severity });
        continue;
      }

      sendOrBatch(err, severity);
    }
  }, [isLeader]); // Stable: reads sendBackground, log, emergencyActive, recordError via refs

  useErrorCapture({ enabled: enabled && isLeader, onErrors: handleErrors });

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
      // Clean up per-tier batch timers
      for (const severity of Object.keys(tierTimerRef.current)) {
        if (tierTimerRef.current[severity]) {
          clearTimeout(tierTimerRef.current[severity]);
        }
      }
    };
  }, []);

  return useMemo(() => ({
    tierCounts: tierCountsRef.current,
    isActive: isLeader,
  }), [isLeader]);
}
