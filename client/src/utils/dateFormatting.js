/**
 * Shared date formatting utilities.
 *
 * Each function preserves the exact behavior of the component it was
 * extracted from — no formatting changes, no "improvements."
 */

/**
 * CalendarView format — expects a Date object.
 * Returns e.g. "Wed, Mar 4, 2026"
 */
export function formatDateCalendar(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * GmailInbox smart/relative format — expects a date string.
 * Today → time, yesterday → "Yesterday", <7 days → weekday,
 * same year → "Mar 4", otherwise → "Mar 4, 2026".
 */
export function formatDateRelative(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) {
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

/**
 * InvestigationsView format — expects a date string.
 * Returns e.g. "Mar 4, 2026". Fallback: "--".
 */
export function formatDateShort(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * ThreadViewer format — expects a timestamp/date string.
 * Returns e.g. "Mar 4, 14:30" (en-US, 24-hour).
 */
export function formatDateWithTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
