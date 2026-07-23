'use strict';

const mongoose = require('mongoose');
const {
  getCaseEventWindow,
  getCaseRealtimeStatus,
  subscribeCaseEvents,
} = require('../case-realtime-events');

function createChannelError(code, error) {
  const err = new Error(error);
  err.code = code;
  return err;
}

function normalizeScopeKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key === 'all') return { key: 'all', escalationId: '' };
  if (!mongoose.isValidObjectId(key)) {
    throw createChannelError('INVALID_ESCALATION_ID', 'case-workflow subscriptions require "all" or a valid escalation id');
  }
  return { key, escalationId: key };
}

function sendCaseEvent(sendEvent, event) {
  sendEvent(event.type, event, {
    seq: event.seq,
    eventId: event.eventId,
    at: event.occurredAt,
    revision: event.revision,
  });
}

async function subscribe({ key, params, sendEvent }) {
  const scope = normalizeScopeKey(key);
  const requestedSeq = Number.isFinite(Number(params?.since)) ? Math.max(0, Number(params.since)) : 0;
  let active = true;
  let caughtUp = false;
  const pending = [];

  const unsubscribe = subscribeCaseEvents((event) => {
    if (!active) return;
    if (scope.escalationId && event.escalationId !== scope.escalationId) return;
    if (!caughtUp) {
      pending.push(event);
      return;
    }
    sendCaseEvent(sendEvent, event);
  });

  try {
    const baseline = getCaseRealtimeStatus().currentSeq;
    const replay = requestedSeq > 0
      ? getCaseEventWindow(requestedSeq, { escalationId: scope.escalationId, throughSeq: baseline })
      : null;

    if (!replay || !replay.replayAvailable) {
      const reason = replay ? 'replay-gap' : 'initial-subscription';
      sendEvent('snapshot', {
        scope: scope.key,
        escalationId: scope.escalationId || null,
        cursor: baseline,
        authoritativeRefreshRequired: true,
        reason,
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
      for (const event of replay.events) sendCaseEvent(sendEvent, event);
    }

    caughtUp = true;
    pending
      .filter((event) => event.seq > baseline)
      .sort((left, right) => left.seq - right.seq)
      .forEach((event) => sendCaseEvent(sendEvent, event));
    pending.length = 0;
  } catch (err) {
    unsubscribe();
    throw err;
  }

  return () => {
    if (!active) return;
    active = false;
    pending.length = 0;
    unsubscribe();
  };
}

module.exports = {
  subscribe,
};
