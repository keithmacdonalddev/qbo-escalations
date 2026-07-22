import { apiFetchJson } from './http.js';

const BASE = '/api/conversations';

function recoveryBase(conversationId) {
  return `${BASE}/${encodeURIComponent(conversationId)}/evidence/recovery`;
}

export async function getEvidenceRecoveryOptions(conversationId) {
  return apiFetchJson(
    recoveryBase(conversationId),
    {},
    'Could not load recovery options',
  );
}

export async function confirmEvidenceRecovery(conversationId, {
  action,
  evidenceFingerprint,
  idempotencyKey,
}) {
  return apiFetchJson(recoveryBase(conversationId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, evidenceFingerprint, idempotencyKey }),
  }, 'Could not start recovery');
}

export async function getEvidenceRecoveryOperation(conversationId, operationId) {
  return apiFetchJson(
    `${recoveryBase(conversationId)}/${encodeURIComponent(operationId)}`,
    {},
    'Could not check recovery progress',
  );
}

export async function acceptEvidenceRecoveryCandidate(conversationId, operationId, {
  candidateSha256,
  previousSha256,
}) {
  return apiFetchJson(`${recoveryBase(conversationId)}/${encodeURIComponent(operationId)}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidateSha256, previousSha256 }),
  }, 'Could not accept the recovered result');
}

export async function cancelEvidenceRecovery(conversationId, operationId) {
  return apiFetchJson(`${recoveryBase(conversationId)}/${encodeURIComponent(operationId)}/cancel`, {
    method: 'POST',
  }, 'Could not request cancellation');
}

export async function listActiveEvidenceRecoveries() {
  return apiFetchJson(
    `${BASE}/recovery/active`,
    {},
    'Could not check pending recoveries',
  );
}
