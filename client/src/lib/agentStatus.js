// agentStatus.js
//
// Shared utilities for translating the agent registry's `health.status` token
// (online / offline / disabled / unknown) into the legacy "operational" token
// (active / degraded / disabled / idle) that drives the existing CSS classes
// declared in `components/AgentsView.css` (imported globally in main.jsx).
//
// Why this file exists:
//   Multiple surfaces (AgentsView dots, PipelineSidebar dots, the upcoming
//   AgentBootOverlay, and inline save-time recheck results) all need the same
//   mapping. Extracting it here keeps a single source of truth so the four
//   `status-dot-*` CSS classes always render in agreement with what the
//   registry reports.
//
// Mapping rationale:
//   online   → active   (green dot, the only "all good" state)
//   offline  → degraded (orange dot, matches the existing "broken/attention"
//                        CSS class — this CSS palette has no red; orange is
//                        the strongest attention color present)
//   disabled → disabled (gray dot, agent is intentionally off)
//   unknown  → idle     (gray dot, neutral while we're still checking)

const HEALTH_TO_OPERATIONAL = Object.freeze({
  online: 'active',
  offline: 'degraded',
  disabled: 'disabled',
  unknown: 'idle',
});

/**
 * Map a registry health status (online/offline/disabled/unknown) onto the
 * operational token (active/degraded/disabled/idle) that the `status-dot-*`
 * CSS classes are keyed on. Anything unrecognized (including undefined/null)
 * falls back to 'idle' so dots never render as a missing class.
 *
 * @param {string|null|undefined} healthStatus
 * @returns {'active'|'degraded'|'disabled'|'idle'}
 */
export function healthStatusToOperationalToken(healthStatus) {
  return HEALTH_TO_OPERATIONAL[healthStatus] || 'idle';
}

/**
 * Human-readable labels keyed by the registry's health.status token. Use these
 * for `title` and `aria-label` on a dot so the tooltip wording matches what
 * the registry actually reports (not the legacy operational token).
 */
export const HEALTH_STATUS_LABELS = Object.freeze({
  online: 'Online',
  offline: 'Offline',
  disabled: 'Disabled',
  unknown: 'Checking...',
});

/**
 * Convenience: get the user-facing label for a health status token, with a
 * safe fallback so the dot's tooltip is never blank.
 *
 * @param {string|null|undefined} healthStatus
 * @returns {string}
 */
export function healthStatusLabel(healthStatus) {
  return HEALTH_STATUS_LABELS[healthStatus] || HEALTH_STATUS_LABELS.unknown;
}

/**
 * Format a `checkedAt` ISO timestamp (or epoch ms) into a relative-time
 * string ("12s ago", "3m ago", "2h ago"), or null if the input is missing
 * or invalid. Used to extend dot tooltips with a freshness hint per AC#13
 * ("Online · last checked 12s ago").
 *
 * Notes:
 *   - Returns "just now" for diffs under 5s so a dot that JUST refreshed
 *     doesn't show a misleading "0s ago".
 *   - Negative diffs (server clock ahead of client) fall back to "just now"
 *     rather than emitting "-3s ago".
 *   - Hours past 24h fall back to a literal "1d+ ago" so a stale dot from
 *     a long-idle tab still produces a sensible tooltip instead of "47h ago".
 *
 * @param {string|number|Date|null|undefined} checkedAt
 * @returns {string|null}
 */
export function formatLastChecked(checkedAt) {
  if (!checkedAt) return null;
  const checkedMs = checkedAt instanceof Date
    ? checkedAt.getTime()
    : new Date(checkedAt).getTime();
  if (!Number.isFinite(checkedMs)) return null;
  const diffMs = Date.now() - checkedMs;
  if (!Number.isFinite(diffMs)) return null;
  if (diffMs < 5_000) return 'just now';
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return '1d+ ago';
}

/**
 * Build the full dot tooltip text — status label plus freshness hint when
 * available. Matches the plan's exceeds-bar format: "Online · last checked
 * 12s ago" / "Offline · last checked 47s ago". When no checkedAt is
 * provided (or it failed to parse), returns just the status label so the
 * tooltip is still meaningful.
 *
 * @param {string|null|undefined} healthStatus
 * @param {string|number|Date|null|undefined} checkedAt
 * @returns {string}
 */
export function buildDotTooltip(healthStatus, checkedAt) {
  const label = healthStatusLabel(healthStatus);
  const fresh = formatLastChecked(checkedAt);
  return fresh ? `${label} · last checked ${fresh}` : label;
}
