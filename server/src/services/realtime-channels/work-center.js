'use strict';

const {
  getWorkCenterEventWindow,
  getWorkCenterStatus,
  getWorkItems,
  subscribeWorkCenterEvents,
} = require('../work-center-events');

function createChannelError(code, error) {
  const err = new Error(error);
  err.code = code;
  return err;
}

function normalizeKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key === 'all') return 'all';
  throw createChannelError('INVALID_WORK_CENTER_SCOPE', 'work-center subscriptions require the "all" scope');
}

function sendWorkCenterEvent(sendEvent, event) {
  sendEvent(event.type, event, {
    seq: event.seq,
    eventId: event.eventId,
    at: event.occurredAt,
  });
}

async function subscribe({ key, params, sendEvent }) {
  const scope = normalizeKey(key);
  const requestedSeq = Number.isFinite(Number(params?.since)) ? Math.max(0, Number(params.since)) : 0;
  let active = true;
  let caughtUp = false;
  const pending = [];

  const unsubscribe = subscribeWorkCenterEvents((event) => {
    if (!active) return;
    if (!caughtUp) {
      pending.push(event);
      return;
    }
    sendWorkCenterEvent(sendEvent, event);
  });

  try {
    const baseline = getWorkCenterStatus().currentSeq;
    const replay = requestedSeq > 0
      ? getWorkCenterEventWindow(requestedSeq, { throughSeq: baseline })
      : null;

    if (!replay || !replay.replayAvailable) {
      sendEvent('snapshot', {
        scope,
        cursor: baseline,
        workItems: getWorkItems(),
        reason: replay ? 'replay-gap' : 'initial-subscription',
        ...(replay ? {
          requestedCursor: replay.requestedSeq,
          oldestAvailableCursor: replay.oldestSeq,
        } : {}),
      }, {
        seq: baseline,
        authoritative: true,
        resyncRequired: Boolean(replay),
      });
    } else {
      for (const event of replay.events) sendWorkCenterEvent(sendEvent, event);
    }

    caughtUp = true;
    pending
      .filter((event) => event.seq > baseline)
      .sort((left, right) => left.seq - right.seq)
      .forEach((event) => sendWorkCenterEvent(sendEvent, event));
    pending.length = 0;
  } catch (error) {
    unsubscribe();
    throw error;
  }

  return () => {
    if (!active) return;
    active = false;
    pending.length = 0;
    unsubscribe();
  };
}

module.exports = { subscribe };
