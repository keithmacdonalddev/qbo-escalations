import { apiFetchJson } from './http.js';

const BASE = '/api/agent-identities';

export async function listAgentIdentities() {
  const data = await apiFetchJson(BASE, {}, 'Failed to load agents');
  return data.agents;
}

export async function getAgentIdentity(id) {
  const data = await apiFetchJson(`${BASE}/${encodeURIComponent(id)}`, {}, 'Failed to load agent');
  return data.agent;
}

export async function updateAgentIdentity(id, profile, summary) {
  const data = await apiFetchJson(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile, summary }),
  }, 'Failed to save agent profile');
  return data.agent;
}

export async function getAgentIdentityHistory(id) {
  const data = await apiFetchJson(`${BASE}/${encodeURIComponent(id)}/history`, {}, 'Failed to load agent history');
  return data.history;
}
