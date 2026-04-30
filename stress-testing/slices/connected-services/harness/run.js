'use strict';

const assert = require('node:assert/strict');

const { registerServiceStub } = require('../../../../server/src/lib/harness-service-gate');
const {
  buildSliceReport,
  createSeed,
  requestJson,
  resetHarnessStubs,
  writeReport,
} = require('../../../scripts/harness-runner-utils');
const { runWithHarness } = require('../../../scripts/fixtures/common');

const SLICE_ID = 'connected-services';

async function runSlice(context = {}) {
  return runWithHarness(context, async (harness) => {
    const startedAt = new Date();
    const seed = createSeed(SLICE_ID);

    resetHarnessStubs();

    const authRes = await requestJson(harness.baseUrl, '/api/gmail/auth/status');
    const accountsRes = await requestJson(harness.baseUrl, '/api/gmail/accounts');
    const unreadCountsRes = await requestJson(harness.baseUrl, '/api/gmail/unified/unread-counts');
    const unifiedRes = await requestJson(harness.baseUrl, '/api/gmail/unified', {
      query: { maxResults: 2 },
    });
    const messagesRes = await requestJson(harness.baseUrl, '/api/gmail/messages', {
      query: { maxResults: 2 },
    });
    const firstMessageId = messagesRes.data.messages[0].id;
    const messageRes = await requestJson(harness.baseUrl, `/api/gmail/messages/${firstMessageId}`);
    const labelsRes = await requestJson(harness.baseUrl, '/api/gmail/labels');
    const profileRes = await requestJson(harness.baseUrl, '/api/gmail/profile');
    const subscriptionsRes = await requestJson(harness.baseUrl, '/api/gmail/subscriptions');

    assert.equal(authRes.data.connected, true);
    assert.equal(accountsRes.data.accounts.length, 1);
    assert.equal(unreadCountsRes.data.counts.total, 2);
    assert.equal(unifiedRes.data.messages.length, 2);
    assert.equal(messagesRes.data.messages.length, 2);
    assert.equal(messageRes.data.id, firstMessageId);
    assert.equal(labelsRes.data.labels[0].id, 'Label_harness');
    assert.equal(profileRes.data.email, 'harness@example.com');
    assert.equal(subscriptionsRes.data.subscriptions[0].domain, 'newsletter.example.com');

    const createLabelRes = await requestJson(harness.baseUrl, '/api/gmail/labels', {
      method: 'POST',
      json: {
        name: `Harness-${seed}`,
      },
    });
    const createDraftRes = await requestJson(harness.baseUrl, '/api/gmail/drafts', {
      method: 'POST',
      json: {
        to: 'recipient@example.com',
        subject: `Harness draft ${seed}`,
        body: 'Deterministic harness draft body.',
      },
    });
    const sendMessageRes = await requestJson(harness.baseUrl, '/api/gmail/messages/send', {
      method: 'POST',
      json: {
        to: 'recipient@example.com',
        subject: `Harness outbound ${seed}`,
        body: 'Deterministic harness outbound email.',
      },
    });
    const sendDraftRes = await requestJson(harness.baseUrl, `/api/gmail/drafts/${createDraftRes.data.draftId}/send`, {
      method: 'POST',
      json: {},
    });
    const batchModifyRes = await requestJson(harness.baseUrl, '/api/gmail/messages/batch', {
      method: 'PATCH',
      json: {
        messageIds: [firstMessageId],
        addLabelIds: ['ARCHIVE'],
      },
    });
    const modifyRes = await requestJson(harness.baseUrl, `/api/gmail/messages/${firstMessageId}`, {
      method: 'PATCH',
      json: {
        addLabelIds: ['STARRED'],
      },
    });
    const trashRes = await requestJson(harness.baseUrl, `/api/gmail/messages/${firstMessageId}`, {
      method: 'DELETE',
    });
    const untrashRes = await requestJson(harness.baseUrl, `/api/gmail/messages/${firstMessageId}/untrash`, {
      method: 'POST',
      json: {},
    });
    const filterRes = await requestJson(harness.baseUrl, '/api/gmail/filters', {
      method: 'POST',
      json: {
        criteria: { from: 'newsletter@example.com' },
        action: { removeLabelIds: ['INBOX'] },
      },
    });
    const deleteFilterRes = await requestJson(harness.baseUrl, `/api/gmail/filters/${filterRes.data.filter.id}`, {
      method: 'DELETE',
    });

    assert.equal(createLabelRes.data.label.name, `Harness-${seed}`);
    assert.equal(createDraftRes.data.draftId, 'gmail-draft-1');
    assert.equal(sendMessageRes.data.messageId, 'gmail-msg-1-sent');
    assert.match(sendDraftRes.data.messageId, /^gmail-msg-1-/);
    assert.equal(batchModifyRes.data.modifiedCount, 1);
    assert.ok(Array.isArray(modifyRes.data.labelIds));
    assert.equal(trashRes.data.id, firstMessageId);
    assert.equal(untrashRes.data.id, firstMessageId);
    assert.equal(filterRes.data.ok, true);
    assert.equal(deleteFilterRes.data.deleted, 'filter-harness-1');

    const calendarsRes = await requestJson(harness.baseUrl, '/api/calendar/calendars');
    const eventsRes = await requestJson(harness.baseUrl, '/api/calendar/events', {
      query: { maxResults: 2 },
    });
    const eventDetailRes = await requestJson(harness.baseUrl, `/api/calendar/events/${eventsRes.data.events[0].id}`, {
      query: { calendarId: 'primary' },
    });
    const createEventRes = await requestJson(harness.baseUrl, '/api/calendar/events', {
      method: 'POST',
      json: {
        summary: `Stress runner event ${seed}`,
        start: '2026-04-20T13:00:00.000Z',
        end: '2026-04-20T13:30:00.000Z',
        location: 'Harness room',
      },
    });
    const updateEventRes = await requestJson(harness.baseUrl, `/api/calendar/events/${createEventRes.data.event.id}`, {
      method: 'PATCH',
      json: {
        calendarId: 'primary',
        summary: `Stress runner event ${seed} updated`,
        location: 'Harness room 2',
      },
    });
    const deleteEventRes = await requestJson(harness.baseUrl, `/api/calendar/events/${createEventRes.data.event.id}`, {
      method: 'DELETE',
      query: { calendarId: 'primary' },
    });
    const freebusyRes = await requestJson(harness.baseUrl, '/api/calendar/freebusy', {
      method: 'POST',
      json: {
        calendarIds: ['primary'],
        timeMin: '2026-04-20T13:00:00.000Z',
        timeMax: '2026-04-20T14:00:00.000Z',
      },
    });

    assert.equal(calendarsRes.data.calendars[0].id, 'primary');
    assert.equal(eventsRes.data.events.length, 2);
    assert.equal(eventDetailRes.data.event.id, 'calendar-event-1-1');
    assert.equal(createEventRes.data.event.summary, `Stress runner event ${seed}`);
    assert.equal(updateEventRes.data.event.summary, `Stress runner event ${seed} updated`);
    assert.equal(deleteEventRes.data.ok, true);
    assert.equal(freebusyRes.data.ok, true);

    const badFilterRes = await requestJson(harness.baseUrl, '/api/gmail/filters', {
      method: 'POST',
      expectStatus: 400,
      json: {
        criteria: { from: 'broken@example.com' },
      },
    });
    assert.equal(badFilterRes.data.code, 'MISSING_FIELD');

    const badCalendarCreateRes = await requestJson(harness.baseUrl, '/api/calendar/events', {
      method: 'POST',
      expectStatus: 400,
      json: {
        start: '2026-04-20T13:00:00.000Z',
        end: '2026-04-20T13:30:00.000Z',
      },
    });
    assert.equal(badCalendarCreateRes.data.code, 'MISSING_FIELD');

    registerServiceStub('gmail', 'createFilter', async () => ({
      ok: false,
      code: 'FILTER_REJECTED',
      error: `Harness rejected filter for ${seed}`,
    }));
    const rejectedFilterRes = await requestJson(harness.baseUrl, '/api/gmail/filters', {
      method: 'POST',
      expectStatus: 400,
      json: {
        criteria: { from: 'newsletter@example.com' },
        action: { removeLabelIds: ['INBOX'] },
      },
    });
    assert.equal(rejectedFilterRes.data.code, 'FILTER_REJECTED');

    const finishedAt = new Date();
    const report = buildSliceReport(SLICE_ID, {
      description: 'Exercises Gmail and Calendar read, write, validation, and service-level failure scenarios through the harness-gated public HTTP APIs.',
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      seed,
      baseUrl: harness.baseUrl,
      startupControls: harness.startupControls || null,
      fixtures: [
        {
          id: 'gmail-read-surfaces-roundtrip',
          kind: 'workflow',
          description: 'GET Gmail auth/accounts/unified/messages/message detail/labels/profile/subscriptions through deterministic connected-service stubs.',
          ok: true,
          assertions: {
            gmailAccount: authRes.data.email,
            accountCount: accountsRes.data.accounts.length,
            unifiedUnreadTotal: unreadCountsRes.data.counts.total,
            firstMessageId,
            profileEmail: profileRes.data.email,
            subscriptionDomain: subscriptionsRes.data.subscriptions[0].domain,
          },
        },
        {
          id: 'gmail-write-surfaces-roundtrip',
          kind: 'workflow',
          description: 'POST Gmail label/draft/message send/filter routes plus PATCH/DELETE message and filter mutations.',
          ok: true,
          assertions: {
            createdLabelName: createLabelRes.data.label.name,
            createdDraftId: createDraftRes.data.draftId,
            sentMessageId: sendMessageRes.data.messageId,
            sentDraftMessageId: sendDraftRes.data.messageId,
            modifiedCount: batchModifyRes.data.modifiedCount,
            createdFilterId: filterRes.data.filter.id,
            deletedFilterId: deleteFilterRes.data.deleted,
          },
        },
        {
          id: 'calendar-read-write-roundtrip',
          kind: 'workflow',
          description: 'GET Calendar calendars/events/event detail, POST createEvent/freebusy, PATCH updateEvent, and DELETE event.',
          ok: true,
          assertions: {
            primaryCalendarId: calendarsRes.data.calendars[0].id,
            listedEventId: eventsRes.data.events[0].id,
            detailedEventId: eventDetailRes.data.event.id,
            createdCalendarEventId: createEventRes.data.event.id,
            updatedCalendarEventSummary: updateEventRes.data.event.summary,
            freebusyCalendarIds: Object.keys(freebusyRes.data.calendars),
          },
        },
        {
          id: 'connected-service-validation-and-business-failures',
          kind: 'failure',
          description: 'Exercise validation failures on Gmail/Calendar routes and a harness-level Gmail createFilter business rejection.',
          ok: true,
          assertions: {
            missingFilterFieldCode: badFilterRes.data.code,
            missingCalendarFieldCode: badCalendarCreateRes.data.code,
            rejectedFilterCode: rejectedFilterRes.data.code,
          },
        },
      ],
      notes: [
        'Connected-service coverage is currently Gmail + Calendar only; shipment harness coverage remains out of scope for this runner pass.',
      ],
    });
    const paths = writeReport(SLICE_ID, report);
    report.paths = paths;
    return report;
  });
}

if (require.main === module) {
  runSlice().then((report) => {
    console.log(JSON.stringify({
      slice: report.slice,
      ok: report.ok,
      reportPath: report.paths.reportPath,
    }, null, 2));
    process.exit(report.ok ? 0 : 1);
  }).catch((err) => {
    console.error(err.stack || err);
    process.exit(1);
  });
}

module.exports = {
  SLICE_ID,
  runSlice,
};
