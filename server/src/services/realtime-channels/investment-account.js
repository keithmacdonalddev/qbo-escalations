'use strict';

const {
  getInvestmentAccountEventStatus,
  getInvestmentAccountEventWindow,
  subscribeInvestmentAccountEvents,
} = require('../investment-account-events');

function normalizeKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key === 'all') return '';
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) {
    const error = new Error('investment-account subscriptions require "all" or a safe account key');
    error.code = 'INVALID_INVESTMENT_ACCOUNT_KEY';
    throw error;
  }
  return key;
}

function sendInvestmentEvent(sendEvent, event) {
  sendEvent(event.data.eventType, event.data, {
    seq: event.seq,
    eventId: event.eventId,
    at: event.data.eventTime,
  });
}

async function subscribe({ key, params, sendEvent }) {
  const accountKey = normalizeKey(key);
  const requestedSeq = Number.isFinite(Number(params?.since)) ? Math.max(0, Number(params.since)) : 0;
  let active = true;
  let caughtUp = false;
  const pending = [];
  const unsubscribe = subscribeInvestmentAccountEvents((event) => {
    if (!active || (accountKey && event.data.accountKey !== accountKey)) return;
    if (!caughtUp) pending.push(event);
    else sendInvestmentEvent(sendEvent, event);
  });

  try {
    const status = getInvestmentAccountEventStatus();
    const replay = requestedSeq > 0
      ? getInvestmentAccountEventWindow(requestedSeq, { accountKey, throughSeq: status.currentSeq })
      : null;
    if (!replay || !replay.replayAvailable) {
      sendEvent('snapshot', {
        accountKey: accountKey || 'all',
        eventType: 'sync-progressed',
        eventTime: new Date().toISOString(),
        snapshotId: null,
      }, {
        seq: status.currentSeq,
        processId: status.processId,
        authoritative: true,
        resyncRequired: Boolean(replay),
      });
    } else {
      replay.events.forEach((event) => sendInvestmentEvent(sendEvent, event));
    }
    caughtUp = true;
    pending.filter((event) => event.seq > status.currentSeq).sort((a, b) => a.seq - b.seq)
      .forEach((event) => sendInvestmentEvent(sendEvent, event));
    pending.length = 0;
  } catch (error) {
    unsubscribe();
    throw error;
  }

  return () => {
    active = false;
    pending.length = 0;
    unsubscribe();
  };
}

module.exports = { subscribe };
