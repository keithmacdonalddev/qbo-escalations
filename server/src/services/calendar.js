'use strict';

const { google } = require('googleapis');
const { getAuth } = require('./gmail');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function notConnected() {
  return {
    ok: false,
    code: 'GMAIL_NOT_CONNECTED',
    error: 'Google account is not connected. Please connect via the Gmail page first.',
  };
}

/**
 * Build an authenticated Google Calendar v3 client.
 */
async function getCalendarClient() {
  const auth = await getAuth();
  if (!auth) return null;
  return google.calendar({ version: 'v3', auth });
}

/**
 * Normalize a Google Calendar event into a clean, consistent object.
 */
function normalizeEvent(ev) {
  if (!ev) return null;
  const isAllDay = !!(ev.start && ev.start.date);
  return {
    id: ev.id,
    calendarId: ev.organizer?.email || 'primary',
    summary: ev.summary || '(No title)',
    description: ev.description || '',
    location: ev.location || '',
    status: ev.status || 'confirmed',
    htmlLink: ev.htmlLink || '',
    hangoutLink: ev.hangoutLink || '',
    isAllDay,
    start: isAllDay
      ? { date: ev.start.date, dateTime: null, timeZone: ev.start.timeZone || null }
      : { date: null, dateTime: ev.start?.dateTime || null, timeZone: ev.start?.timeZone || null },
    end: isAllDay
      ? { date: ev.end.date, dateTime: null, timeZone: ev.end.timeZone || null }
      : { date: null, dateTime: ev.end?.dateTime || null, timeZone: ev.end?.timeZone || null },
    attendees: (ev.attendees || []).map((a) => ({
      email: a.email,
      displayName: a.displayName || '',
      responseStatus: a.responseStatus || 'needsAction',
      self: !!a.self,
      organizer: !!a.organizer,
    })),
    creator: ev.creator ? { email: ev.creator.email, displayName: ev.creator.displayName || '' } : null,
    organizer: ev.organizer ? { email: ev.organizer.email, displayName: ev.organizer.displayName || '' } : null,
    reminders: ev.reminders || { useDefault: true },
    recurrence: ev.recurrence || [],
    colorId: ev.colorId || null,
    created: ev.created || null,
    updated: ev.updated || null,
  };
}

// ---------------------------------------------------------------------------
// Calendar Operations
// ---------------------------------------------------------------------------

/**
 * List the user's calendars.
 */
async function listCalendars() {
  const cal = await getCalendarClient();
  if (!cal) return notConnected();

  const res = await cal.calendarList.list({ minAccessRole: 'reader' });
  const calendars = (res.data.items || []).map((c) => ({
    id: c.id,
    summary: c.summary || '',
    description: c.description || '',
    primary: !!c.primary,
    backgroundColor: c.backgroundColor || '#4285f4',
    foregroundColor: c.foregroundColor || '#ffffff',
    accessRole: c.accessRole || 'reader',
    timeZone: c.timeZone || '',
    selected: c.selected !== false,
  }));

  return { ok: true, calendars };
}

/**
 * List events from a calendar.
 * @param {Object} opts
 * @param {string} [opts.calendarId='primary']
 * @param {string} [opts.timeMin] - ISO date string (lower bound)
 * @param {string} [opts.timeMax] - ISO date string (upper bound)
 * @param {string} [opts.q] - Free-text search term
 * @param {number} [opts.maxResults=250]
 * @param {string} [opts.pageToken]
 */
async function listEvents({ calendarId = 'primary', timeMin, timeMax, q, maxResults = 250, pageToken } = {}) {
  const cal = await getCalendarClient();
  if (!cal) return notConnected();

  const params = {
    calendarId,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: Math.min(maxResults, 2500),
  };
  if (timeMin) params.timeMin = timeMin;
  if (timeMax) params.timeMax = timeMax;
  if (q) params.q = q;
  if (pageToken) params.pageToken = pageToken;

  const res = await cal.events.list(params);
  const events = (res.data.items || []).map(normalizeEvent);
  return {
    ok: true,
    events,
    nextPageToken: res.data.nextPageToken || null,
    timeZone: res.data.timeZone || null,
  };
}

/**
 * Get a single event by ID.
 */
async function getEvent(calendarId = 'primary', eventId) {
  const cal = await getCalendarClient();
  if (!cal) return notConnected();

  const res = await cal.events.get({ calendarId, eventId });
  return { ok: true, event: normalizeEvent(res.data) };
}

/**
 * Create a new event.
 * @param {string} calendarId
 * @param {Object} eventData - { summary, description, location, start, end, attendees, reminders, allDay }
 */
async function createEvent(calendarId = 'primary', eventData) {
  const cal = await getCalendarClient();
  if (!cal) return notConnected();

  const resource = {};
  if (eventData.summary) resource.summary = eventData.summary;
  if (eventData.description) resource.description = eventData.description;
  if (eventData.location) resource.location = eventData.location;

  // Build start/end — allDay uses `date`, timed uses `dateTime`
  if (eventData.allDay) {
    resource.start = { date: eventData.start };
    resource.end = { date: eventData.end };
  } else {
    resource.start = { dateTime: eventData.start, timeZone: eventData.timeZone || undefined };
    resource.end = { dateTime: eventData.end, timeZone: eventData.timeZone || undefined };
  }

  if (eventData.attendees && eventData.attendees.length > 0) {
    resource.attendees = eventData.attendees.map((email) =>
      typeof email === 'string' ? { email } : email
    );
  }

  if (eventData.reminders) {
    resource.reminders = eventData.reminders;
  }

  const res = await cal.events.insert({
    calendarId,
    requestBody: resource,
    sendUpdates: eventData.sendUpdates || 'none',
  });

  return { ok: true, event: normalizeEvent(res.data) };
}

/**
 * Update an existing event.
 */
async function updateEvent(calendarId = 'primary', eventId, updates) {
  const cal = await getCalendarClient();
  if (!cal) return notConnected();

  const resource = {};
  if (updates.summary !== undefined) resource.summary = updates.summary;
  if (updates.description !== undefined) resource.description = updates.description;
  if (updates.location !== undefined) resource.location = updates.location;

  if (updates.allDay) {
    if (updates.start) resource.start = { date: updates.start };
    if (updates.end) resource.end = { date: updates.end };
  } else {
    if (updates.start) resource.start = { dateTime: updates.start, timeZone: updates.timeZone || undefined };
    if (updates.end) resource.end = { dateTime: updates.end, timeZone: updates.timeZone || undefined };
  }

  if (updates.attendees) {
    resource.attendees = updates.attendees.map((email) =>
      typeof email === 'string' ? { email } : email
    );
  }

  if (updates.reminders) {
    resource.reminders = updates.reminders;
  }

  const res = await cal.events.patch({
    calendarId,
    eventId,
    requestBody: resource,
    sendUpdates: updates.sendUpdates || 'none',
  });

  return { ok: true, event: normalizeEvent(res.data) };
}

/**
 * Delete an event.
 */
async function deleteEvent(calendarId = 'primary', eventId) {
  const cal = await getCalendarClient();
  if (!cal) return notConnected();

  await cal.events.delete({
    calendarId,
    eventId,
    sendUpdates: 'none',
  });

  return { ok: true };
}

/**
 * Find free/busy information across calendars.
 * @param {string[]} calendarIds - Array of calendar IDs to check
 * @param {string} timeMin - ISO date string
 * @param {string} timeMax - ISO date string
 * @param {string} [timeZone] - IANA timezone string
 */
async function findFreeTime(calendarIds = ['primary'], timeMin, timeMax, timeZone) {
  const cal = await getCalendarClient();
  if (!cal) return notConnected();

  const res = await cal.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      timeZone: timeZone || 'UTC',
      items: calendarIds.map((id) => ({ id })),
    },
  });

  const calendars = res.data.calendars || {};
  const result = {};
  for (const [calId, data] of Object.entries(calendars)) {
    result[calId] = {
      busy: (data.busy || []).map((b) => ({ start: b.start, end: b.end })),
      errors: data.errors || [],
    };
  }

  return { ok: true, calendars: result, timeMin, timeMax };
}

module.exports = {
  listCalendars,
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  findFreeTime,
};
