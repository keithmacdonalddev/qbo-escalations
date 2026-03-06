/**
 * Severity intelligence layer for the dev agent error pipeline.
 *
 * Classifies every error into one of 5 tiers so that critical crashes
 * are never blocked by a flood of deprecation warnings competing for
 * the same circuit breaker budget.
 *
 * Each tier has independent rate limits, batching windows, and
 * send-to-agent policies. CRITICAL errors bypass all budgets.
 */

export const SEVERITY = {
  CRITICAL: 1,   // App crash, UI freeze >15s, render crash
  URGENT: 2,     // Runtime error, unhandled rejection, console.error with stack
  ELEVATED: 3,   // API failure pattern, circuit breaker, server/stream error
  MONITORING: 4, // Performance degradation, health warnings, resource errors
  INFO: 5,       // Deprecated warnings, dedup savings, log-only noise
};

export const SEVERITY_LABELS = {
  [SEVERITY.CRITICAL]: 'CRITICAL',
  [SEVERITY.URGENT]: 'URGENT',
  [SEVERITY.ELEVATED]: 'ELEVATED',
  [SEVERITY.MONITORING]: 'MONITORING',
  [SEVERITY.INFO]: 'INFO',
};

/**
 * Per-tier budget configuration.
 *
 * @property {number} maxPerWindow  Max sends before tier is throttled (Infinity = no limit)
 * @property {number} windowMs     Rolling window duration in ms
 * @property {number} batchMs      Batching delay before send (0 = immediate)
 * @property {boolean} sendToAgent Whether errors at this tier ever reach the agent
 */
export const TIER_CONFIG = {
  [SEVERITY.CRITICAL]: { maxPerWindow: Infinity, windowMs: 300_000, batchMs: 0, sendToAgent: true },
  [SEVERITY.URGENT]:   { maxPerWindow: 2, windowMs: 300_000, batchMs: 0, sendToAgent: true },
  [SEVERITY.ELEVATED]: { maxPerWindow: 2, windowMs: 300_000, batchMs: 5_000, sendToAgent: true },
  [SEVERITY.MONITORING]: { maxPerWindow: 1, windowMs: 600_000, batchMs: 30_000, sendToAgent: true },
  [SEVERITY.INFO]:     { maxPerWindow: 0, windowMs: Infinity, batchMs: 0, sendToAgent: false },
};

/**
 * Classify an error object into a severity tier.
 *
 * The error shape is flexible — different capture surfaces attach
 * different metadata. The classifier checks `type`, `source`, `message`,
 * and `severity` fields in priority order.
 *
 * @param {{ type?: string, source?: string, message?: string, severity?: string }} error
 * @returns {number} One of the SEVERITY constants (1–5)
 */
export function classifySeverity(error) {
  if (!error) return SEVERITY.INFO;

  // --- Tier 1: CRITICAL — crashes and freezes ---
  if (error.type === 'react-crash') return SEVERITY.CRITICAL;
  if (error.type === 'health-warning' && error.message?.includes('freeze')) return SEVERITY.CRITICAL;
  if (error.type === 'health-warning' && error.message?.includes('CRITICAL')) return SEVERITY.CRITICAL;
  if (error.type === 'emergency') return SEVERITY.CRITICAL;

  // --- Tier 2: URGENT — runtime errors reaching the browser ---
  if (error.source === 'window.onerror' || error.source === 'window-error') return SEVERITY.URGENT;
  if (error.source === 'unhandled-rejection') return SEVERITY.URGENT;
  if (error.type === 'error-captured' && error.severity === 'error') return SEVERITY.URGENT;
  if (error.type === 'console-error') return SEVERITY.URGENT;

  // --- Tier 3: ELEVATED — API/server/stream issues ---
  if (error.type === 'api-error') return SEVERITY.ELEVATED;
  if (error.type === 'circuit-breaker') return SEVERITY.ELEVATED;
  if (error.type === 'server-error') return SEVERITY.ELEVATED;
  if (error.type === 'stream-error') return SEVERITY.ELEVATED;

  // --- Tier 4: MONITORING — health/perf/resources ---
  if (error.type === 'health-warning') return SEVERITY.MONITORING;
  if (error.type === 'perf-insight') return SEVERITY.MONITORING;
  if (error.type === 'resource-error') return SEVERITY.MONITORING;
  if (error.type === 'network-error') return SEVERITY.MONITORING;
  if (error.type === 'security-warning') return SEVERITY.MONITORING;

  // --- Tier 5: INFO — everything else ---
  return SEVERITY.INFO;
}
