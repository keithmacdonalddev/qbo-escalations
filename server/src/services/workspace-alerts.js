'use strict';

const calendar = require('./calendar');
const gmail = require('./gmail');

// ---------------------------------------------------------------------------
// Workspace Alerts Service
//
// On-demand alert detection. Called by the workspace route when building
// context for the AI agent. NOT a background timer — fires only when the
// user sends a message.
// ---------------------------------------------------------------------------

/**
 * Detect alerts by scanning calendar events and recent emails.
 * Returns an array of alert objects.
 *
 * Alert types:
 *   - flight-approaching: flight-related event in next 6 hours
 *   - checkin-window: flight departing in 24-26 hours (check-in opening)
 *   - calendar-conflict: overlapping events or impossible travel
 *   - deadline-approaching: events/emails with deadline keywords within 48h
 *   - unresponded-important: 3+ starred unread emails older than 3 days
 *
 * @returns {Promise<Array<{type: string, severity: string, title: string, detail: string, sourceId: string, detectedAt: string}>>}
 */
async function detectAlerts() {
  const alerts = [];
  const now = new Date();

  // Fetch calendar events for the next 48 hours and recent important emails
  // in parallel for performance.
  const timeMin = now.toISOString();
  const time48h = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

  const [eventsRes, importantRes] = await Promise.all([
    calendar.listEvents({
      calendarId: 'primary',
      timeMin,
      timeMax: time48h,
      maxResults: 50,
    }).catch(err => {
      console.warn('[workspace-alerts] calendar.listEvents failed:', err.message);
      return null;
    }),
    gmail.listMessages({
      q: 'is:starred is:unread',
      maxResults: 20,
    }).catch(err => {
      console.warn('[workspace-alerts] gmail.listMessages failed:', err.message);
      return null;
    }),
  ]);

  const events = eventsRes?.ok ? (eventsRes.events || []) : [];
  const importantEmails = importantRes?.ok ? (importantRes.messages || []) : [];

  // -------------------------------------------------------------------------
  // 1. Flight approaching — flight-related events in next 6 hours
  // -------------------------------------------------------------------------
  const flightKeywords = /\b(flight|fly|airport|departure|boarding|gate|terminal|airline|flair|westjet|air canada|porter|delta|united|american|jetblue|southwest|swoop|spirit|frontier)\b/i;
  const sixHoursFromNow = new Date(now.getTime() + 6 * 60 * 60 * 1000);

  for (const evt of events) {
    const eventStart = parseEventTime(evt);
    if (!eventStart) continue;

    const textToCheck = `${evt.summary || ''} ${evt.description || ''} ${evt.location || ''}`;
    const isFlight = flightKeywords.test(textToCheck);
    if (!isFlight) continue;

    if (eventStart <= sixHoursFromNow) {
      const hoursUntil = Math.max(0, (eventStart - now) / (60 * 60 * 1000));
      const timeStr = hoursUntil < 1
        ? `${Math.round(hoursUntil * 60)} minutes`
        : `${hoursUntil.toFixed(1)} hours`;

      alerts.push({
        type: 'flight-approaching',
        severity: hoursUntil < 3 ? 'urgent' : 'warning',
        title: `Flight in ${timeStr}`,
        detail: `${evt.summary || 'Flight event'} at ${formatTime(eventStart)}. ${evt.location ? 'Location: ' + evt.location : ''}`.trim(),
        sourceId: evt.id || '',
        detectedAt: now.toISOString(),
      });
    }

    // 2. Check-in window — flights departing in 24-26 hours
    const hoursUntilFlight = (eventStart - now) / (60 * 60 * 1000);
    if (hoursUntilFlight >= 23 && hoursUntilFlight <= 26) {
      alerts.push({
        type: 'checkin-window',
        severity: 'warning',
        title: 'Check-in window opening',
        detail: `${evt.summary || 'Flight'} departs in ~${Math.round(hoursUntilFlight)} hours. Online check-in typically opens 24 hours before departure.`,
        sourceId: evt.id || '',
        detectedAt: now.toISOString(),
      });
    }
  }

  // -------------------------------------------------------------------------
  // 3. Calendar conflicts — overlapping events or impossible travel
  // -------------------------------------------------------------------------
  // Only check today's events (next 24h) for conflicts
  const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const todayEvents = events
    .filter((evt) => {
      const start = parseEventTime(evt);
      return start && start <= twentyFourHoursFromNow;
    })
    .map((evt) => ({
      ...evt,
      _start: parseEventTime(evt),
      _end: parseEventEndTime(evt),
    }))
    .filter((evt) => evt._start && evt._end)
    .sort((a, b) => a._start - b._start);

  for (let i = 0; i < todayEvents.length - 1; i++) {
    const current = todayEvents[i];
    const next = todayEvents[i + 1];

    // Check for time overlap
    if (current._end > next._start) {
      // Skip nested events — e.g. "Break" or "Lunch" inside a "Work" block
      const curName = (current.summary || '').toLowerCase();
      const nxtName = (next.summary || '').toLowerCase();
      const isNested = (current._start <= next._start && current._end >= next._end)
        || (next._start <= current._start && next._end >= current._end);
      const isSameName = curName === nxtName;
      if (isNested || isSameName) continue;

      alerts.push({
        type: 'calendar-conflict',
        severity: 'warning',
        title: 'Overlapping events',
        detail: `"${current.summary || 'Event'}" (ends ${formatTime(current._end)}) overlaps with "${next.summary || 'Event'}" (starts ${formatTime(next._start)}).`,
        sourceId: `${current.id || ''}|${next.id || ''}`,
        detectedAt: now.toISOString(),
      });
      continue; // Don't also check travel for overlapping events
    }

    // Check for impossible travel between locations
    const currentLoc = (current.location || '').trim().toLowerCase();
    const nextLoc = (next.location || '').trim().toLowerCase();

    if (currentLoc && nextLoc && currentLoc !== nextLoc) {
      const gapMinutes = (next._start - current._end) / (60 * 1000);
      const differentCities = areDifferentCities(currentLoc, nextLoc);

      // If different cities and less than 3 hours gap, flag it
      if (differentCities && gapMinutes < 180) {
        alerts.push({
          type: 'calendar-conflict',
          severity: 'warning',
          title: 'Tight travel between events',
          detail: `"${current.summary || 'Event'}" at ${currentLoc} ends ${formatTime(current._end)}, but "${next.summary || 'Event'}" at ${nextLoc} starts ${formatTime(next._start)} (${Math.round(gapMinutes)} min gap). Different locations may require more travel time.`,
          sourceId: `${current.id || ''}|${next.id || ''}`,
          detectedAt: now.toISOString(),
        });
      }
      // Same city but less than 15 min gap
      else if (!differentCities && gapMinutes < 15 && gapMinutes > 0) {
        alerts.push({
          type: 'calendar-conflict',
          severity: 'info',
          title: 'Back-to-back events',
          detail: `Only ${Math.round(gapMinutes)} minutes between "${current.summary || 'Event'}" and "${next.summary || 'Event'}" at different locations.`,
          sourceId: `${current.id || ''}|${next.id || ''}`,
          detectedAt: now.toISOString(),
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. Deadline approaching — events with deadline keywords in next 48h
  // -------------------------------------------------------------------------
  const deadlineKeywords = /\b(due|deadline|expires?|expiring|submit|submission|cutoff|cut-off|last day|final day|overdue)\b/i;

  for (const evt of events) {
    const textToCheck = `${evt.summary || ''} ${evt.description || ''}`;
    if (!deadlineKeywords.test(textToCheck)) continue;

    const eventStart = parseEventTime(evt);
    if (!eventStart) continue;

    const hoursUntil = (eventStart - now) / (60 * 60 * 1000);
    if (hoursUntil <= 48 && hoursUntil > 0) {
      alerts.push({
        type: 'deadline-approaching',
        severity: hoursUntil <= 6 ? 'urgent' : 'warning',
        title: 'Deadline approaching',
        detail: `"${evt.summary || 'Deadline'}" in ${hoursUntil < 1 ? Math.round(hoursUntil * 60) + ' minutes' : Math.round(hoursUntil) + ' hours'}.`,
        sourceId: evt.id || '',
        detectedAt: now.toISOString(),
      });
    }
  }

  // -------------------------------------------------------------------------
  // 5. Unresponded important emails — 3+ starred unread emails older than 3 days
  //
  // Spec: only alert when there are 3 or more unread starred emails that
  // have been sitting for more than 3 days (72h). Group them into a single
  // alert with a count rather than one alert per email.
  // -------------------------------------------------------------------------
  const threeDaysAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000);
  const oldStarredUnread = [];

  for (const msg of importantEmails) {
    if (!msg.isUnread) continue;

    const msgDate = msg.date ? new Date(msg.date) : null;
    if (!msgDate || isNaN(msgDate.getTime())) continue;

    if (msgDate < threeDaysAgo) {
      oldStarredUnread.push(msg);
    }
  }

  if (oldStarredUnread.length >= 3) {
    // Sort oldest first for the detail string
    oldStarredUnread.sort((a, b) => new Date(a.date) - new Date(b.date));
    const oldest = oldStarredUnread[0];
    const oldestHours = Math.round((now - new Date(oldest.date)) / (60 * 60 * 1000));
    const oldestDays = Math.round(oldestHours / 24);

    // Build a compact summary of the first few subjects
    const subjectPreview = oldStarredUnread
      .slice(0, 3)
      .map((m) => `"${m.subject || '(no subject)'}"`)
      .join(', ');
    const moreCount = oldStarredUnread.length > 3 ? ` and ${oldStarredUnread.length - 3} more` : '';

    alerts.push({
      type: 'unresponded-important',
      severity: oldestDays > 7 ? 'urgent' : 'warning',
      title: `${oldStarredUnread.length} starred emails need attention`,
      detail: `${subjectPreview}${moreCount} — oldest is ${oldestDays} day${oldestDays !== 1 ? 's' : ''} old.`,
      // Use a stable sourceId so dismissing this alert dismisses the group
      sourceId: `starred-batch:${oldStarredUnread.length}`,
      detectedAt: now.toISOString(),
    });
  }

  // Sort: urgent first, then warning, then info
  const severityOrder = { urgent: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2));

  return alerts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the start time of a calendar event into a Date.
 */
function parseEventTime(evt) {
  const dt = evt.start?.dateTime || evt.start?.date;
  if (!dt) return null;
  const d = new Date(dt);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Parse the end time of a calendar event into a Date.
 */
function parseEventEndTime(evt) {
  const dt = evt.end?.dateTime || evt.end?.date;
  if (!dt) return null;
  const d = new Date(dt);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format a Date to a short time string (e.g. "2:30 PM").
 */
function formatTime(date) {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Known virtual/non-physical location keywords. If a location matches one of
 * these we cannot determine travel conflict, so extractCity returns null.
 */
const VIRTUAL_LOCATION_RE = /^(zoom|teams|microsoft teams|google meet|meet|webex|online|virtual|remote|tbd|tba|phone|call|skype|slack|huddle|video ?call|web ?conference|dial[- ]?in|hangout|gotomeeting)$/i;

/**
 * Determine if two locations represent different cities.
 * Returns false when either location is virtual/unknown — we can't assess
 * travel time for non-physical locations.
 *
 * The 3-hour (180 min) threshold in the caller is a rough heuristic: it catches
 * obvious impossibilities (Toronto -> Vancouver in 45 min) but won't flag
 * scenarios where driving across the same metro area is tight. A proper
 * implementation would use a distance/routing API, but this is good enough for
 * a single-user assistant.
 */
function areDifferentCities(loc1, loc2) {
  const cityA = extractCity(loc1);
  const cityB = extractCity(loc2);

  // If either location is virtual/unknown, we can't determine a conflict
  if (!cityA || !cityB) return false;

  // Normalized city names match — same city
  if (cityA === cityB) return false;

  // Check if one city name contains the other (handles "New York" vs "New York City")
  if (cityA.includes(cityB) || cityB.includes(cityA)) return false;

  // City names are different — likely different places
  return true;
}

/**
 * Extract a city name from a location string.
 *
 * Handles:
 *   "123 Main St, Toronto, ON"            → "toronto"
 *   "Toronto, Ontario, Canada"            → "toronto"
 *   "London, United Kingdom"              → "london"
 *   "New York"                            → "new york"
 *   "Room 201" / "Zoom" / "Online"        → null
 *   "123 Main St, Toronto, ON M5V 2T6"   → "toronto"
 *   ""                                    → null
 *
 * Strategy:
 * 1. Return null for empty/virtual locations.
 * 2. Split by comma. Filter out parts that are street addresses (start with
 *    digit), postal codes, or 2-letter province/state/country abbreviations.
 * 3. If 3+ comma parts, the city is typically the second-to-last meaningful
 *    part (street, CITY, province pattern). For 2 parts it's the first
 *    meaningful part. For 1 part, return it as-is if it looks like a city name.
 */
function extractCity(location) {
  if (!location) return null;

  const trimmed = location.trim();
  if (!trimmed) return null;

  // Virtual / non-physical location — cannot determine travel
  if (VIRTUAL_LOCATION_RE.test(trimmed)) return null;

  // Single-word or simple names that are clearly not an address (no commas)
  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);

  // Filter out non-city parts
  const meaningful = parts.filter((part) => {
    // Street addresses start with a digit (e.g. "123 Main St")
    if (/^\d/.test(part)) return false;
    // Room / suite / floor designations
    if (/^(room|suite|ste|floor|fl|unit|apt|bldg|building)\b/i.test(part)) return false;
    // Canadian postal codes (A1A 1A1)
    if (/^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i.test(part)) return false;
    // US ZIP codes (12345 or 12345-6789)
    if (/^\d{5}(-\d{4})?$/.test(part)) return false;
    // 2-letter province/state codes when we have enough parts to distinguish
    if (/^[A-Z]{2}$/i.test(part) && parts.length > 2) return false;
    // Country names that aren't also city names (common suffixes)
    if (/^(canada|usa|us|united states|united kingdom|uk|australia)$/i.test(part) && parts.length > 1) return false;
    return true;
  });

  if (meaningful.length === 0) return null;

  // For multi-part addresses (street, city, province, country), the city is
  // typically the first meaningful part after filtering out the street address.
  // For "Toronto, ON" it's "Toronto". For "London, United Kingdom" it's "London".
  const city = meaningful[0].toLowerCase().trim();

  // Final virtual check on the extracted city (in case it was buried in a longer string)
  if (VIRTUAL_LOCATION_RE.test(city)) return null;

  // Reject single very short tokens that are unlikely to be city names
  if (city.length < 2) return null;

  return city;
}

module.exports = {
  detectAlerts,
};
