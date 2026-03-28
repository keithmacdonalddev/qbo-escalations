/**
 * Structured runtime telemetry breadcrumbs.
 *
 * These events are lightweight app-level markers, not console noise.
 * They accumulate in a ring buffer so crash handling and diagnostics
 * can inspect recent user actions without adding network overhead.
 */

const BREADCRUMB_BUFFER_SIZE = 50;
const breadcrumbs = [];

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
}

// ── Read the breadcrumb trail ───────────────────────────────────────
export function getBreadcrumbs() {
  return breadcrumbs.slice();
}
