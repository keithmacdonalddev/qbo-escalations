'use strict';

const crypto = require('node:crypto');

const EVENT_LIMIT = 200;
const PROCESS_ID = crypto.randomBytes(6).toString('hex');
const EVENT_TYPES = new Set([
  'sync-started',
  'sync-progressed',
  'snapshot-published',
  'sync-failed',
  'reauthorization-required',
  'snapshot-data-deleted',
]);

let sequence = 0;
let events = [];
const listeners = new Set();

function safeAccountKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{8,100}$/.test(key) ? key : '';
}

function publishInvestmentAccountEvent({ accountKey, eventType, eventTime = new Date(), snapshotId = null } = {}) {
  const key = safeAccountKey(accountKey);
  if (!key || !EVENT_TYPES.has(eventType)) return null;
  const at = eventTime instanceof Date ? eventTime : new Date(eventTime);
  if (!Number.isFinite(at.getTime())) return null;
  const safeSnapshotId = snapshotId === null ? null : safeAccountKey(snapshotId);
  sequence += 1;
  const data = Object.freeze({
    accountKey: key,
    eventType,
    eventTime: at.toISOString(),
    snapshotId: safeSnapshotId,
  });
  const event = Object.freeze({
    seq: sequence,
    eventId: `investment-${PROCESS_ID}-${sequence}`,
    data,
  });
  events.push(event);
  if (events.length > EVENT_LIMIT) events = events.slice(-EVENT_LIMIT);
  for (const listener of listeners) {
    try { listener(event); } catch { /* One subscriber cannot block another. */ }
  }
  return event;
}

function subscribeInvestmentAccountEvents(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getInvestmentAccountEventWindow(since = 0, { accountKey = '', throughSeq = sequence } = {}) {
  const cursor = Number.isFinite(Number(since)) ? Math.max(0, Number(since)) : 0;
  const ceiling = Number.isFinite(Number(throughSeq)) ? Math.max(0, Number(throughSeq)) : sequence;
  const oldestSeq = events.length > 0 ? events[0].seq : sequence + 1;
  const replayAvailable = cursor <= sequence && (events.length === 0 || cursor >= oldestSeq - 1);
  return {
    events: replayAvailable ? events.filter((event) => (
      event.seq > cursor
      && event.seq <= ceiling
      && (!accountKey || event.data.accountKey === accountKey)
    )) : [],
    replayAvailable,
    requestedSeq: cursor,
    currentSeq: sequence,
    oldestSeq,
  };
}

function getInvestmentAccountEventStatus() {
  return {
    currentSeq: sequence,
    oldestSeq: events.length > 0 ? events[0].seq : sequence + 1,
    retainedEventCount: events.length,
    processId: PROCESS_ID,
  };
}

function resetInvestmentAccountEvents() {
  sequence = 0;
  events = [];
  listeners.clear();
}

function forceInvestmentAccountReplayGap(accountKey) {
  const published = [];
  for (let index = 0; index < EVENT_LIMIT + 5; index += 1) {
    published.push(publishInvestmentAccountEvent({
      accountKey,
      eventType: 'sync-progressed',
      eventTime: new Date(Date.now() + index),
      snapshotId: null,
    }));
  }
  return published.filter(Boolean).length;
}

module.exports = {
  EVENT_LIMIT,
  forceInvestmentAccountReplayGap,
  getInvestmentAccountEventStatus,
  getInvestmentAccountEventWindow,
  publishInvestmentAccountEvent,
  resetInvestmentAccountEvents,
  subscribeInvestmentAccountEvents,
};
