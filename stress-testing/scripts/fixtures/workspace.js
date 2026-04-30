'use strict';

const {
  pollUntil,
  requestJson,
} = require('../harness-runner-utils');

async function createWorkspaceSession(baseUrl, payload, options = {}) {
  const response = await requestJson(baseUrl, '/api/agents/sessions', {
    method: 'POST',
    json: payload,
    ...options,
  });

  return {
    response,
    sessionId: response.data.session.id,
    session: response.data.session,
  };
}

async function waitForWorkspaceSessionStatus(baseUrl, sessionId, status, {
  timeoutMs = 10_000,
  description = `workspace session ${status}`,
} = {}) {
  return pollUntil(
    async () => {
      const response = await requestJson(baseUrl, `/api/agents/sessions/${sessionId}`);
      return response.data.session.status === status ? response.data : null;
    },
    {
      timeoutMs,
      description,
    }
  );
}

module.exports = {
  createWorkspaceSession,
  waitForWorkspaceSessionStatus,
};
