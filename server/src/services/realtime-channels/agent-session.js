'use strict';

const {
  getAgentSession,
  getAgentSessionEventsSince,
  subscribeAgentSession,
  attachAgentClient,
  detachAgentClient,
} = require('../agent-session-runtime');

function createChannelError(code, error) {
  const err = new Error(error);
  err.code = code;
  return err;
}

async function subscribe({ key, params, sendEvent }) {
  const sessionId = typeof key === 'string' ? key.trim() : '';
  if (!sessionId) {
    throw createChannelError('MISSING_SESSION_ID', 'agent-session subscriptions require a session id');
  }

  const session = getAgentSession(sessionId);
  if (!session) {
    throw createChannelError('SESSION_NOT_FOUND', 'Agent session not found');
  }

  const sinceSeq = Number.isFinite(Number(params?.since)) ? Number(params.since) : 0;
  let active = true;
  let unsubscribe = null;

  attachAgentClient(sessionId);
  sendEvent('session', session);

  for (const event of getAgentSessionEventsSince(sessionId, sinceSeq)) {
    sendEvent(event.type, event.data, { seq: event.seq });
  }

  unsubscribe = subscribeAgentSession(sessionId, (event) => {
    if (!active) return;
    sendEvent(event.type, event.data, { seq: event.seq });
  });

  return () => {
    if (!active) return;
    active = false;
    try {
      unsubscribe?.();
    } catch {
      // Ignore listener cleanup failures.
    }
    detachAgentClient(sessionId);
  };
}

module.exports = {
  subscribe,
};
