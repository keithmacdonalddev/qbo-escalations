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
