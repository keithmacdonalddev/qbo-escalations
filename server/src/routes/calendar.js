'use strict';

const express = require('express');
const calendar = require('../services/calendar');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/calendar/calendars — list all calendars
// ---------------------------------------------------------------------------
router.get('/calendars', async (req, res) => {
  try {
    const result = await calendar.listCalendars(req.query.account || undefined);
    if (!result.ok) return res.status(result.code === 'GMAIL_NOT_CONNECTED' ? 401 : 500).json(result);
    res.json(result);
  } catch (err) {
    console.error('[Calendar] listCalendars error:', err.message);
    res.status(500).json({ ok: false, code: 'CALENDAR_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/calendar/events — list/search events
// Query params: calendarId, timeMin, timeMax, q, maxResults, pageToken
// ---------------------------------------------------------------------------
router.get('/events', async (req, res) => {
  try {
    const { calendarId, timeMin, timeMax, q, maxResults, pageToken, account } = req.query;
    const result = await calendar.listEvents({
      calendarId: calendarId || 'primary',
      timeMin: timeMin || undefined,
      timeMax: timeMax || undefined,
      q: q || undefined,
      maxResults: maxResults && Number.isFinite(parseInt(maxResults, 10)) ? parseInt(maxResults, 10) : 250,
      pageToken: pageToken || undefined,
      account: account || undefined,
    });
    if (!result.ok) return res.status(result.code === 'GMAIL_NOT_CONNECTED' ? 401 : 500).json(result);
    res.json(result);
  } catch (err) {
    // Google API returns 404 for non-existent / unsubscribed calendar IDs — handle gracefully
    const is404 = err.code === 404 || err.status === 404 || (err.message && err.message.includes('Not Found'));
    if (is404) {
      return res.json({ ok: true, events: [], calendarNotFound: true });
    }
    console.error('[Calendar] listEvents error:', err.message);
    res.status(500).json({ ok: false, code: 'CALENDAR_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/calendar/events/:id — get event details
// Query param: calendarId (defaults to 'primary')
// ---------------------------------------------------------------------------
router.get('/events/:id', async (req, res) => {
  try {
    const calendarId = req.query.calendarId || 'primary';
    const result = await calendar.getEvent(calendarId, req.params.id, req.query.account || undefined);
    if (!result.ok) return res.status(result.code === 'GMAIL_NOT_CONNECTED' ? 401 : 500).json(result);
    res.json(result);
  } catch (err) {
    console.error('[Calendar] getEvent error:', err.message);
    res.status(500).json({ ok: false, code: 'CALENDAR_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/calendar/events — create a new event
// Body: { calendarId, summary, description, location, start, end, allDay, attendees, timeZone }
// ---------------------------------------------------------------------------
router.post('/events', async (req, res) => {
  try {
    const { calendarId, account, ...eventData } = req.body;
    if (!eventData.summary) {
      return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: '"summary" field is required' });
    }
    if (!eventData.start || !eventData.end) {
      return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: '"start" and "end" fields are required' });
    }
    const result = await calendar.createEvent(calendarId || 'primary', eventData, account || undefined);
    if (!result.ok) return res.status(result.code === 'GMAIL_NOT_CONNECTED' ? 401 : 500).json(result);
    res.json(result);
  } catch (err) {
    console.error('[Calendar] createEvent error:', err.message);
    res.status(500).json({ ok: false, code: 'CALENDAR_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/calendar/events/:id — update an event
// Body: { calendarId, summary, description, location, start, end, allDay, attendees, timeZone }
// ---------------------------------------------------------------------------
router.patch('/events/:id', async (req, res) => {
  try {
    const { calendarId, account, ...updates } = req.body;
    const result = await calendar.updateEvent(calendarId || 'primary', req.params.id, updates, account || undefined);
    if (!result.ok) return res.status(result.code === 'GMAIL_NOT_CONNECTED' ? 401 : 500).json(result);
    res.json(result);
  } catch (err) {
    console.error('[Calendar] updateEvent error:', err.message);
    res.status(500).json({ ok: false, code: 'CALENDAR_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/calendar/events/:id — delete an event
// Query param: calendarId (defaults to 'primary')
// ---------------------------------------------------------------------------
router.delete('/events/:id', async (req, res) => {
  try {
    const calendarId = req.query.calendarId || 'primary';
    const result = await calendar.deleteEvent(calendarId, req.params.id, req.query.account || undefined);
    if (!result.ok) return res.status(result.code === 'GMAIL_NOT_CONNECTED' ? 401 : 500).json(result);
    res.json(result);
  } catch (err) {
    console.error('[Calendar] deleteEvent error:', err.message);
    res.status(500).json({ ok: false, code: 'CALENDAR_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/calendar/freebusy — find free/busy time
// Body: { calendarIds, timeMin, timeMax, timeZone }
// ---------------------------------------------------------------------------
router.post('/freebusy', async (req, res) => {
  try {
    const { calendarIds, timeMin, timeMax, timeZone, account } = req.body;
    if (!timeMin || !timeMax) {
      return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: '"timeMin" and "timeMax" are required' });
    }
    const result = await calendar.findFreeTime(
      calendarIds || ['primary'],
      timeMin,
      timeMax,
      timeZone || undefined,
      account || undefined,
    );
    if (!result.ok) return res.status(result.code === 'GMAIL_NOT_CONNECTED' ? 401 : 500).json(result);
    res.json(result);
  } catch (err) {
    console.error('[Calendar] findFreeTime error:', err.message);
    res.status(500).json({ ok: false, code: 'CALENDAR_ERROR', error: err.message });
  }
});

module.exports = router;
