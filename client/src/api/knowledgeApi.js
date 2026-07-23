import { apiFetchJson } from './http.js';

const BASE = '/api/knowledge';

function appendIfPresent(params, key, value) {
  if (value === undefined || value === null || value === '') return;
  params.set(key, String(value));
}

function buildKnowledgeParams(options = {}) {
  const params = new URLSearchParams();
  appendIfPresent(params, 'q', options.query);
  appendIfPresent(params, 'reviewStatus', options.reviewStatus);
  appendIfPresent(params, 'category', options.category);
  appendIfPresent(params, 'reusableOutcome', options.reusableOutcome);
  appendIfPresent(params, 'trustState', options.trustState);
  appendIfPresent(params, 'allowedUse', options.allowedUse);
  appendIfPresent(params, 'sort', options.sort || '-updatedAt');
  appendIfPresent(params, 'limit', options.limit || 50);
  appendIfPresent(params, 'offset', options.offset || 0);
  if (options.includeLegacy !== undefined) params.set('includeLegacy', options.includeLegacy ? 'true' : 'false');
  if (options.includeCandidates !== undefined) params.set('includeCandidates', options.includeCandidates ? 'true' : 'false');
  return params;
}

export async function getKnowledgeSummary() {
  const data = await apiFetchJson(`${BASE}/summary`, {}, 'Failed to load knowledge summary');
  return data.summary;
}

export async function listKnowledgeRecords(options = {}) {
  const params = buildKnowledgeParams(options);
  const data = await apiFetchJson(`${BASE}/records?${params}`, {}, 'Failed to load knowledge records');
  return {
    records: data.records || [],
    total: data.total || 0,
    offset: data.offset || 0,
    limit: data.limit || options.limit || 50,
  };
}

export async function getKnowledgeRecord(id) {
  const data = await apiFetchJson(`${BASE}/records/${encodeURIComponent(id)}`, {}, 'Failed to load knowledge record');
  return data.record;
}

export async function getKnowledgeAgentRecordContext(id) {
  const data = await apiFetchJson(
    `${BASE}/records/${encodeURIComponent(id)}/agent-context`,
    {},
    'Failed to load Knowledge Base Agent context',
  );
  return {
    context: data.context || null,
    messages: data.messages || [],
  };
}

export async function sendKnowledgeAgentMessage(id, message) {
  const data = await apiFetchJson(`${BASE}/records/${encodeURIComponent(id)}/agent-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    timeout: 120_000,
    noRetry: true,
  }, 'Knowledge Base Agent chat failed');
  return {
    answer: data.answer || '',
    messages: data.messages || [],
    context: data.context || null,
    usage: data.usage || null,
    appliedChanges: Array.isArray(data.appliedChanges) ? data.appliedChanges : [],
    provider: data.provider || null,
    model: data.model || null,
    fallbackUsed: Boolean(data.fallbackUsed),
  };
}

export async function updateKnowledgeRecord(id, fields) {
  const data = await apiFetchJson(`${BASE}/records/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields || {}),
  }, 'Failed to update knowledge record');
  return data.record;
}

export async function resolveKnowledgeRecoveryReview(id, recoveryOperationId) {
  const data = await apiFetchJson(`${BASE}/records/${encodeURIComponent(id)}/recovery-review/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recoveryOperationId }),
  }, 'Failed to mark the recovery review complete');
  return data.record;
}

export async function publishKnowledgeRecord(id, options = {}) {
  const data = await apiFetchJson(`${BASE}/records/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      exportMarkdown: Boolean(options.exportMarkdown),
    }),
  }, 'Failed to publish knowledge record');
  return data;
}

export async function deprecateKnowledgeRecord(id, fields = {}) {
  const data = await apiFetchJson(`${BASE}/records/${encodeURIComponent(id)}/deprecate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  }, 'Failed to deprecate knowledge record');
  return data.record;
}

export async function redactKnowledgeRecord(id, fields = {}) {
  const data = await apiFetchJson(`${BASE}/records/${encodeURIComponent(id)}/redact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  }, 'Failed to redact knowledge record');
  return data.record;
}

export async function addKnowledgeRelationship(id, fields = {}) {
  const data = await apiFetchJson(`${BASE}/records/${encodeURIComponent(id)}/relationships`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  }, 'Failed to add knowledge relationship');
  return data.record;
}

export async function recordKnowledgeFeedback(id, fields = {}) {
  const data = await apiFetchJson(`${BASE}/records/${encodeURIComponent(id)}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  }, 'Failed to record knowledge feedback');
  return data.record;
}

export async function getKnowledgeOntologySummary() {
  const data = await apiFetchJson(`${BASE}/ontology/summary`, {}, 'Failed to load ontology summary');
  return data.summary;
}

export async function exportKnowledge(options = {}) {
  const params = buildKnowledgeParams({
    ...options,
    limit: options.limit || 500,
  });
  params.set('format', options.format || 'json');
  const data = await apiFetchJson(`${BASE}/export?${params}`, {}, 'Failed to export knowledgebase');
  return data.export;
}

export async function searchKnowledge(options = {}) {
  const params = buildKnowledgeParams(options);
  const data = await apiFetchJson(`${BASE}/search?${params}`, {}, 'Failed to search knowledge');
  return {
    records: data.records || [],
    total: data.total || 0,
    dbTotal: data.dbTotal || 0,
    legacyTotal: data.legacyTotal || 0,
    query: data.query || options.query || '',
  };
}

export async function getKnowledgeAgentStatus() {
  const data = await apiFetchJson(`${BASE}/agent/status`, {}, 'Failed to load knowledgebase agent status');
  return data.status;
}

export async function scanKnowledgeAgent(options = {}) {
  const data = await apiFetchJson(`${BASE}/agent/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      limit: options.limit || 100,
      staleTrustedDays: options.staleTrustedDays || 180,
      dryRun: Boolean(options.dryRun),
      persistAttention: options.persistAttention !== false,
      persistActivity: options.persistActivity !== false,
    }),
    timeout: 45_000,
  }, 'Failed to run knowledgebase agent scan');
  return data.scan;
}

export async function runKnowledgeAgentHarness(options = {}) {
  const data = await apiFetchJson(`${BASE}/agent/harness/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      escalationId: options.escalationId || '',
    }),
    timeout: 45_000,
    noRetry: true,
  }, 'Failed to run knowledgebase agent harness');
  return data.harness;
}
