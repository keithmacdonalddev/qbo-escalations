'use strict';

const { registerServiceStub } = require('../../server/src/lib/harness-service-gate');

const HARNESS_ACCOUNT_EMAIL = 'harness@example.com';
const HARNESS_AUTH_URL = 'https://example.test/harness/google-oauth';
const HARNESS_MESSAGE_ID = 'gmail-msg-1';
const HARNESS_THREAD_ID = 'gmail-thread-1';
const HARNESS_DRAFT_ID = 'gmail-draft-1';
const HARNESS_LABEL_ID = 'Label_harness';
const HARNESS_FILTER_ID = 'filter-harness-1';
const HARNESS_CALENDAR_ID = 'primary';
const HARNESS_EVENT_ID = 'calendar-event-1';

const DEFAULT_GMAIL_ACCOUNT = Object.freeze({
  email: HARNESS_ACCOUNT_EMAIL,
  connectedAt: '2026-04-19T10:00:00.000Z',
  lastUsed: '2026-04-19T10:15:00.000Z',
});

const DEFAULT_GMAIL_MESSAGE = Object.freeze({
  id: HARNESS_MESSAGE_ID,
  threadId: HARNESS_THREAD_ID,
  snippet: 'Harness message preview',
  subject: 'Harness inbox message',
  from: 'Harness Sender',
  fromEmail: 'sender@example.com',
  to: HARNESS_ACCOUNT_EMAIL,
  date: '2026-04-19T10:30:00.000Z',
  unread: true,
  labelIds: ['INBOX', 'UNREAD'],
});

const DEFAULT_GMAIL_LABEL = Object.freeze({
  id: HARNESS_LABEL_ID,
  name: 'Harness',
  type: 'user',
});

const DEFAULT_GMAIL_DRAFT = Object.freeze({
  draftId: HARNESS_DRAFT_ID,
  messageId: HARNESS_MESSAGE_ID,
  threadId: HARNESS_THREAD_ID,
  from: 'Harness Sender',
  fromEmail: HARNESS_ACCOUNT_EMAIL,
  to: 'recipient@example.com',
  subject: 'Harness draft',
  date: '2026-04-19T10:45:00.000Z',
  snippet: 'Draft body preview',
});

const DEFAULT_GMAIL_FILTER = Object.freeze({
  id: HARNESS_FILTER_ID,
  criteria: { from: 'newsletter@example.com' },
  action: { removeLabelIds: ['INBOX'] },
});

const DEFAULT_GMAIL_SUBSCRIPTION = Object.freeze({
  domain: 'newsletter.example.com',
  fromEmail: 'news@newsletter.example.com',
  fromName: 'Harness Newsletter',
  count: 3,
  latestSubject: 'Harness weekly update',
  latestDate: '2026-04-19T11:00:00.000Z',
  listUnsubscribe: '<mailto:unsubscribe@newsletter.example.com>',
});

const DEFAULT_CALENDAR = Object.freeze({
  id: HARNESS_CALENDAR_ID,
  summary: 'Harness Calendar',
  description: 'Deterministic calendar for harness mode.',
  primary: true,
  backgroundColor: '#4285f4',
  foregroundColor: '#ffffff',
  accessRole: 'owner',
  timeZone: 'UTC',
  selected: true,
});

const DEFAULT_CALENDAR_EVENT = Object.freeze({
  id: HARNESS_EVENT_ID,
  calendarId: HARNESS_CALENDAR_ID,
  summary: 'Harness Event',
  description: 'Deterministic calendar event for harness mode.',
  location: 'Video call',
  status: 'confirmed',
  htmlLink: 'https://calendar.google.com/calendar/event?eid=harness',
  hangoutLink: '',
  isAllDay: false,
  start: { date: null, dateTime: '2026-04-19T13:00:00.000Z', timeZone: 'UTC' },
  end: { date: null, dateTime: '2026-04-19T13:30:00.000Z', timeZone: 'UTC' },
  attendees: [
    {
      email: HARNESS_ACCOUNT_EMAIL,
      displayName: 'Harness Account',
      responseStatus: 'accepted',
      self: true,
      organizer: true,
    },
  ],
  creator: { email: HARNESS_ACCOUNT_EMAIL, displayName: 'Harness Account' },
  organizer: { email: HARNESS_ACCOUNT_EMAIL, displayName: 'Harness Account' },
  reminders: { useDefault: true },
  recurrence: [],
  colorId: null,
  created: '2026-04-19T12:00:00.000Z',
  updated: '2026-04-19T12:00:00.000Z',
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildConnectedStatus() {
  return {
    ok: true,
    connected: true,
    email: HARNESS_ACCOUNT_EMAIL,
    appConfigured: true,
    connectedAt: DEFAULT_GMAIL_ACCOUNT.connectedAt,
    scopes: 'gmail.readonly gmail.send calendar',
    activeAccount: HARNESS_ACCOUNT_EMAIL,
    accounts: [clone(DEFAULT_GMAIL_ACCOUNT)],
  };
}

function buildProfile() {
  return {
    ok: true,
    email: HARNESS_ACCOUNT_EMAIL,
    messagesTotal: 12,
    threadsTotal: 7,
    historyId: 'history-harness-1',
  };
}

function buildUnifiedMessages({ maxResults = 25 } = {}) {
  const messages = Array.from({ length: Math.min(maxResults, 2) }, (_value, index) => ({
    ...clone(DEFAULT_GMAIL_MESSAGE),
    id: `${HARNESS_MESSAGE_ID}-${index + 1}`,
    threadId: `${HARNESS_THREAD_ID}-${index + 1}`,
    account: HARNESS_ACCOUNT_EMAIL,
  }));

  return {
    ok: true,
    messages,
    accounts: [HARNESS_ACCOUNT_EMAIL],
    nextPageTokens: {},
    errors: [],
  };
}

function buildListMessages({ maxResults = 20 } = {}) {
  const messages = Array.from({ length: Math.min(maxResults, 2) }, (_value, index) => ({
    ...clone(DEFAULT_GMAIL_MESSAGE),
    id: `${HARNESS_MESSAGE_ID}-${index + 1}`,
    threadId: `${HARNESS_THREAD_ID}-${index + 1}`,
  }));

  return {
    ok: true,
    messages,
    nextPageToken: null,
    resultSizeEstimate: messages.length,
  };
}

function buildMessage(messageId) {
  return {
    ok: true,
    id: messageId || HARNESS_MESSAGE_ID,
    threadId: HARNESS_THREAD_ID,
    from: 'Harness Sender',
    fromEmail: 'sender@example.com',
    to: HARNESS_ACCOUNT_EMAIL,
    cc: '',
    subject: 'Harness inbox message',
    date: '2026-04-19T10:30:00.000Z',
    snippet: 'Harness message preview',
    bodyType: 'html',
    body: '<p>Harness email body</p>',
    attachments: [],
    labelIds: ['INBOX', 'UNREAD'],
    trackerCount: 0,
    trackers: [],
  };
}

function buildLabels() {
  return {
    ok: true,
    labels: [clone(DEFAULT_GMAIL_LABEL)],
  };
}

function buildDrafts() {
  return {
    ok: true,
    drafts: [clone(DEFAULT_GMAIL_DRAFT)],
  };
}

function buildFilters() {
  return {
    ok: true,
    filters: [clone(DEFAULT_GMAIL_FILTER)],
  };
}

function buildCalendars() {
  return {
    ok: true,
    calendars: [clone(DEFAULT_CALENDAR)],
  };
}

function buildEvents({ maxResults = 250, calendarId = HARNESS_CALENDAR_ID } = {}) {
  const count = Math.min(maxResults, 2);
  const events = Array.from({ length: count }, (_value, index) => ({
    ...clone(DEFAULT_CALENDAR_EVENT),
    id: `${HARNESS_EVENT_ID}-${index + 1}`,
    calendarId,
  }));

  return {
    ok: true,
    events,
    nextPageToken: null,
    timeZone: 'UTC',
  };
}

function buildEvent(calendarId, eventId, overrides = {}) {
  return {
    ok: true,
    event: {
      ...clone(DEFAULT_CALENDAR_EVENT),
      calendarId: calendarId || HARNESS_CALENDAR_ID,
      id: eventId || HARNESS_EVENT_ID,
      ...overrides,
    },
  };
}

function installDefaultConnectedServiceStubs() {
  registerServiceStub('gmail', 'getAuthUrl', () => HARNESS_AUTH_URL);
  registerServiceStub('gmail', 'handleCallback', async () => ({ email: HARNESS_ACCOUNT_EMAIL }));
  registerServiceStub('gmail', 'disconnect', async () => undefined);
  registerServiceStub('gmail', 'getAuthStatus', async () => buildConnectedStatus());
  registerServiceStub('gmail', 'listAccounts', async () => ({
    ok: true,
    accounts: [clone(DEFAULT_GMAIL_ACCOUNT)],
  }));
  registerServiceStub('gmail', 'switchAccount', async (email) => ({
    ok: true,
    activeAccount: email || HARNESS_ACCOUNT_EMAIL,
  }));
  registerServiceStub('gmail', 'listUnifiedMessages', async (options = {}) => buildUnifiedMessages(options));
  registerServiceStub('gmail', 'getUnifiedUnreadCounts', async () => ({
    ok: true,
    counts: {
      [HARNESS_ACCOUNT_EMAIL]: 2,
      total: 2,
    },
  }));
  registerServiceStub('gmail', 'getProfile', async () => buildProfile());
  registerServiceStub('gmail', 'listMessages', async (options = {}) => buildListMessages(options));
  registerServiceStub('gmail', 'getMessage', async (messageId) => buildMessage(messageId));
  registerServiceStub('gmail', 'listLabels', async () => buildLabels());
  registerServiceStub('gmail', 'createLabel', async (name) => ({
    ok: true,
    label: {
      ...clone(DEFAULT_GMAIL_LABEL),
      name: typeof name === 'string' && name.trim() ? name.trim() : DEFAULT_GMAIL_LABEL.name,
    },
  }));
  registerServiceStub('gmail', 'createDraft', async () => ({
    ok: true,
    draftId: HARNESS_DRAFT_ID,
    messageId: HARNESS_MESSAGE_ID,
    threadId: HARNESS_THREAD_ID,
  }));
  registerServiceStub('gmail', 'listDrafts', async () => buildDrafts());
  registerServiceStub('gmail', 'sendMessage', async ({ threadId } = {}) => ({
    ok: true,
    messageId: `${HARNESS_MESSAGE_ID}-sent`,
    threadId: threadId || HARNESS_THREAD_ID,
    labelIds: ['SENT'],
  }));
  registerServiceStub('gmail', 'sendDraft', async (draftId) => ({
    ok: true,
    messageId: `${HARNESS_MESSAGE_ID}-${draftId || 'draft'}-sent`,
    threadId: HARNESS_THREAD_ID,
    labelIds: ['SENT'],
  }));
  registerServiceStub('gmail', 'modifyMessage', async (messageId, { addLabelIds = [] } = {}) => ({
    ok: true,
    id: messageId || HARNESS_MESSAGE_ID,
    threadId: HARNESS_THREAD_ID,
    labelIds: addLabelIds.length > 0 ? addLabelIds : ['INBOX'],
  }));
  registerServiceStub('gmail', 'trashMessage', async (messageId) => ({
    ok: true,
    id: messageId || HARNESS_MESSAGE_ID,
  }));
  registerServiceStub('gmail', 'untrashMessage', async (messageId) => ({
    ok: true,
    id: messageId || HARNESS_MESSAGE_ID,
  }));
  registerServiceStub('gmail', 'deleteMessage', async (messageId) => ({
    ok: true,
    id: messageId || HARNESS_MESSAGE_ID,
  }));
  registerServiceStub('gmail', 'batchModify', async (messageIds = []) => ({
    ok: true,
    modifiedCount: Array.isArray(messageIds) ? messageIds.length : 0,
  }));
  registerServiceStub('gmail', 'scanSubscriptions', async () => ({
    ok: true,
    subscriptions: [clone(DEFAULT_GMAIL_SUBSCRIPTION)],
    scannedCount: 3,
  }));
  registerServiceStub('gmail', 'listFilters', async () => buildFilters());
  registerServiceStub('gmail', 'createFilter', async ({ criteria = {}, action = {} } = {}) => ({
    ok: true,
    filter: {
      id: HARNESS_FILTER_ID,
      criteria,
      action,
    },
  }));
  registerServiceStub('gmail', 'deleteFilter', async (filterId) => ({
    ok: true,
    deleted: filterId || HARNESS_FILTER_ID,
  }));

  registerServiceStub('calendar', 'listCalendars', async () => buildCalendars());
  registerServiceStub('calendar', 'listEvents', async (options = {}) => buildEvents(options));
  registerServiceStub('calendar', 'getEvent', async (calendarId, eventId) => buildEvent(calendarId, eventId));
  registerServiceStub('calendar', 'createEvent', async (calendarId, eventData = {}) => buildEvent(calendarId, HARNESS_EVENT_ID, {
    summary: eventData.summary || DEFAULT_CALENDAR_EVENT.summary,
    description: eventData.description || DEFAULT_CALENDAR_EVENT.description,
    location: eventData.location || DEFAULT_CALENDAR_EVENT.location,
    isAllDay: Boolean(eventData.allDay),
    start: eventData.allDay
      ? { date: eventData.start || '2026-04-19', dateTime: null, timeZone: null }
      : {
          date: null,
          dateTime: eventData.start || DEFAULT_CALENDAR_EVENT.start.dateTime,
          timeZone: eventData.timeZone || 'UTC',
        },
    end: eventData.allDay
      ? { date: eventData.end || '2026-04-20', dateTime: null, timeZone: null }
      : {
          date: null,
          dateTime: eventData.end || DEFAULT_CALENDAR_EVENT.end.dateTime,
          timeZone: eventData.timeZone || 'UTC',
        },
  }));
  registerServiceStub('calendar', 'updateEvent', async (calendarId, eventId, updates = {}) => buildEvent(calendarId, eventId, {
    summary: updates.summary || DEFAULT_CALENDAR_EVENT.summary,
    description: updates.description || DEFAULT_CALENDAR_EVENT.description,
    location: updates.location || DEFAULT_CALENDAR_EVENT.location,
  }));
  registerServiceStub('calendar', 'deleteEvent', async () => ({ ok: true }));
  registerServiceStub('calendar', 'findFreeTime', async (calendarIds = ['primary'], timeMin, timeMax) => ({
    ok: true,
    calendars: Object.fromEntries(
      (Array.isArray(calendarIds) ? calendarIds : ['primary']).map((calendarId) => [
        calendarId,
        {
          busy: [
            {
              start: timeMin || '2026-04-19T13:00:00.000Z',
              end: timeMax || '2026-04-19T13:30:00.000Z',
            },
          ],
          errors: [],
        },
      ])
    ),
    timeMin: timeMin || '2026-04-19T13:00:00.000Z',
    timeMax: timeMax || '2026-04-19T13:30:00.000Z',
  }));
}

module.exports = {
  HARNESS_ACCOUNT_EMAIL,
  DEFAULT_CALENDAR,
  DEFAULT_CALENDAR_EVENT,
  DEFAULT_GMAIL_ACCOUNT,
  DEFAULT_GMAIL_DRAFT,
  DEFAULT_GMAIL_FILTER,
  DEFAULT_GMAIL_LABEL,
  DEFAULT_GMAIL_MESSAGE,
  DEFAULT_GMAIL_SUBSCRIPTION,
  HARNESS_AUTH_URL,
  installDefaultConnectedServiceStubs,
};
