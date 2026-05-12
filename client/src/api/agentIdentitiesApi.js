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

export async function createAgentIdentity(payload) {
  const data = await apiFetchJson(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  }, 'Failed to create agent');
  return data.agent;
}

export async function importAgentIdentities(payload) {
  const data = await apiFetchJson(`${BASE}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  }, 'Failed to import agents');
  return {
    agents: data.agents || [],
    failed: data.failed || [],
  };
}

export async function recordAgentReview(id, review) {
  const data = await apiFetchJson(`${BASE}/${encodeURIComponent(id)}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(review || {}),
  }, 'Failed to record agent review');
  return data.agent;
}

export async function recordAgentHarnessRun(id, run) {
  const data = await apiFetchJson(`${BASE}/${encodeURIComponent(id)}/harness-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(run || {}),
  }, 'Failed to record harness run');
  return data.agent;
}
