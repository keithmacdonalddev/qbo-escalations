'use strict';

const MAX_ATTEMPTS = 50;

const attempts = [];

function createAttemptId() {
  return `rr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneAttempt(attempt) {
  const now = Date.now();
  return {
    id: attempt.id,
    source: attempt.source || 'supervisor',
    status: attempt.status || 'running',
    reason: attempt.reason || '',
    startedAt: new Date(attempt.startedAt).toISOString(),
    updatedAt: new Date(attempt.updatedAt).toISOString(),
    completedAt: attempt.completedAt ? new Date(attempt.completedAt).toISOString() : null,
    ageMs: now - attempt.startedAt,
    idleMs: now - attempt.updatedAt,
    requestedWorkspaceIds: [...(attempt.requestedWorkspaceIds || [])],
    requestedAiIds: [...(attempt.requestedAiIds || [])],
    linkedIncidentKeys: [...(attempt.linkedIncidentKeys || [])],
    results: {
      abortedWorkspaceIds: [...(attempt.results?.abortedWorkspaceIds || [])],
      abortedAiIds: [...(attempt.results?.abortedAiIds || [])],
      verifiedWorkspaceIds: [...(attempt.results?.verifiedWorkspaceIds || [])],
      verifiedAiIds: [...(attempt.results?.verifiedAiIds || [])],
      remainingWorkspaceIds: [...(attempt.results?.remainingWorkspaceIds || [])],
      remainingAiIds: [...(attempt.results?.remainingAiIds || [])],
      missingWorkspaceIds: [...(attempt.results?.missingWorkspaceIds || [])],
      missingAiIds: [...(attempt.results?.missingAiIds || [])],
      workspaceFailures: [...(attempt.results?.workspaceFailures || [])],
      aiFailures: [...(attempt.results?.aiFailures || [])],
    },
    summary: attempt.summary || null,
    lastError: attempt.lastError || null,
  };
}

function trimAttempts() {
  if (attempts.length <= MAX_ATTEMPTS) return;
  attempts.splice(0, attempts.length - MAX_ATTEMPTS);
}

function createRuntimeRemediationAttempt({
  source = 'supervisor',
  reason = 'Runtime remediation requested',
  workspaceSessionIds = [],
  aiOperationIds = [],
} = {}) {
  const now = Date.now();
  const attempt = {
    id: createAttemptId(),
    source,
    status: 'running',
    reason: String(reason || '').trim().slice(0, 240),
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    requestedWorkspaceIds: [...new Set((Array.isArray(workspaceSessionIds) ? workspaceSessionIds : []).filter(Boolean))],
    requestedAiIds: [...new Set((Array.isArray(aiOperationIds) ? aiOperationIds : []).filter(Boolean))],
    linkedIncidentKeys: [],
    results: {
      abortedWorkspaceIds: [],
      abortedAiIds: [],
      verifiedWorkspaceIds: [],
      verifiedAiIds: [],
      remainingWorkspaceIds: [],
      remainingAiIds: [],
      missingWorkspaceIds: [],
      missingAiIds: [],
      workspaceFailures: [],
      aiFailures: [],
    },
    summary: null,
    lastError: null,
  };
  attempts.push(attempt);
  trimAttempts();
  return cloneAttempt(attempt);
}

function updateRuntimeRemediationAttempt(id, patch = {}) {
  const attempt = attempts.find((entry) => entry.id === id);
  if (!attempt) return null;

  attempt.updatedAt = Date.now();
  if (patch.status) attempt.status = patch.status;
  if (patch.summary !== undefined) attempt.summary = patch.summary;
  if (patch.reason !== undefined) attempt.reason = String(patch.reason || '').trim().slice(0, 240);
  if (patch.completedAt !== undefined) attempt.completedAt = patch.completedAt;
  if (patch.lastError !== undefined) attempt.lastError = patch.lastError;
  if (Array.isArray(patch.linkedIncidentKeys)) attempt.linkedIncidentKeys = [...new Set(patch.linkedIncidentKeys.filter(Boolean))];

  if (patch.results && typeof patch.results === 'object') {
    attempt.results = {
      ...attempt.results,
      ...patch.results,
    };
  }

  trimAttempts();
  return cloneAttempt(attempt);
}

function finalizeRuntimeRemediationAttempt(id, patch = {}) {
  return updateRuntimeRemediationAttempt(id, {
    ...patch,
    completedAt: patch.completedAt || Date.now(),
  });
}

function getRuntimeRemediationHealth() {
  const entries = [...attempts]
    .sort((a, b) => (b.updatedAt || b.startedAt) - (a.updatedAt || a.startedAt))
    .map(cloneAttempt);

  return {
    totalAttempts: entries.length,
    activeAttempts: entries.filter((entry) => entry.status === 'running').length,
    verifiedAttempts: entries.filter((entry) => entry.status === 'verified').length,
    partialAttempts: entries.filter((entry) => entry.status === 'partial').length,
    failedAttempts: entries.filter((entry) => entry.status === 'failed').length,
    recentAttempts: entries.slice(0, 10),
  };
}

module.exports = {
  createRuntimeRemediationAttempt,
  updateRuntimeRemediationAttempt,
  finalizeRuntimeRemediationAttempt,
  getRuntimeRemediationHealth,
};
