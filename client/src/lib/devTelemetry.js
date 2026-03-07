/**
 * Structured telemetry for the dev agent.
 *
 * NOT console.log -- these are intentional sensor points baked into
 * every critical path.  They serve three purposes:
 *
 * 1. Always appear in the AgentActivityLog (real-time UI).
 * 2. Accumulate in a ring-buffer of breadcrumbs that gets attached to
 *    auto-error reports, giving the agent context for every crash.
 * 3. Can trigger an immediate alert to the background agent when
 *    something critical happens (telAlert).
 *
 * Zero external dependencies. Synchronous push to array -- no perf impact.
 */

const BREADCRUMB_BUFFER_SIZE = 50;
const breadcrumbs = [];
let _logFn = null;   // Set by DevAgentProvider on mount
let _sendFn = null;  // Set by DevAgentProvider on mount
let _loggingEnabled = true; // Toggled by Settings → Dev Tools

// ── Bootstrap (called once by DevAgentProvider) ─────────────────────
export function initTelemetry(log, sendBackground) {
  _logFn = log;
  _sendFn = sendBackground;
}

// ── Toggle logging (breadcrumbs always accumulate) ──────────────────
export function setTelemetryLogging(enabled) {
  _loggingEnabled = enabled;
}

// ── Category constants ──────────────────────────────────────────────
export const TEL = {
  // Navigation
  PAGE_VIEW:        'page-view',
  ROUTE_CHANGE:     'route-change',

  // User actions
  USER_ACTION:      'user-action',
  FORM_SUBMIT:      'form-submit',

  // Data flow
  DATA_LOAD:        'data-load',
  DATA_ERROR:       'data-error',
  DATA_EMPTY:       'data-empty',

  // AI / Chat
  CHAT_SEND:        'chat-send',
  CHAT_RESPONSE:    'chat-response',
  CHAT_ERROR:       'chat-error',
  PROVIDER_SWITCH:  'provider-switch',
  STREAM_START:     'stream-start',
  STREAM_END:       'stream-end',

  // Lifecycle / State
  STATE_ANOMALY:    'state-anomaly',
  MOUNT:            'mount',
  UNMOUNT:          'unmount',

  // Performance
  SLOW_RENDER:      'slow-render',
  SLOW_OPERATION:   'slow-operation',
};

// ── Main telemetry call ─────────────────────────────────────────────
export function tel(category, message, detail = null) {
  const entry = { category, message, detail, timestamp: Date.now() };

  // Always push to the breadcrumb ring-buffer
  breadcrumbs.push(entry);
  if (breadcrumbs.length > BREADCRUMB_BUFFER_SIZE) breadcrumbs.shift();

  // Push to the activity log stream so the UI picks it up
  if (_loggingEnabled && _logFn) {
    _logFn({
      type: 'telemetry',
      message: `[${category}] ${message}`,
      detail: detail ? JSON.stringify(detail) : undefined,
      severity:
        category.includes('error') || category.includes('anomaly')
          ? 'warning'
          : 'info',
    });
  }
}

// ── Read the breadcrumb trail ───────────────────────────────────────
export function getBreadcrumbs() {
  return breadcrumbs.slice();
}

// ── Critical alert — immediately notify the dev agent ───────────────
export function telAlert(message, detail = null) {
  // Record the alert itself as a breadcrumb
  tel(TEL.STATE_ANOMALY, message, detail);

  const trail = breadcrumbs
    .slice(-10)
    .map(
      (b) =>
        `  [${new Date(b.timestamp).toLocaleTimeString()}] ${b.category}: ${b.message}`,
    )
    .join('\n');

  if (_sendFn) {
    _sendFn(
      'auto-errors',
      `[AUTO-ERROR] Telemetry alert: ${message}\n\n${detail || ''}\n\nBreadcrumb trail (last 10 actions):\n${trail}\n\nUse the breadcrumb trail to understand what the user was doing before this issue occurred.`,
    );
  }
}
