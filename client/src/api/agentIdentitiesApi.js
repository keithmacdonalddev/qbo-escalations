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

export async function listAgentRuntimeDefaults(ids = []) {
  const query = Array.isArray(ids) && ids.length > 0
    ? `?ids=${ids.map((id) => encodeURIComponent(id)).join(',')}`
    : '';
  const data = await apiFetchJson(`${BASE}/runtime-defaults${query}`, {}, 'Failed to load agent runtime defaults');
  return data.runtimes || {};
}

export async function getAgentHealth(ids = [], options = {}) {
  const params = new URLSearchParams();
  if (Array.isArray(ids) && ids.length > 0) params.set('ids', ids.join(','));
  if (options.forceRefresh) params.set('refresh', '1');
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiFetchJson(`${BASE}/health${query}`, {}, 'Failed to load agent health');
}

export async function getProviderStrategyHealth(providerStrategy = {}, options = {}) {
  const params = new URLSearchParams();
  if (options.forceRefresh) params.set('refresh', '1');
  if (options.healthLevel) params.set('level', options.healthLevel);
  if (options.trigger) params.set('trigger', options.trigger);
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiFetchJson(`${BASE}/provider-strategy/health${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerStrategy: providerStrategy || {},
      forceRefresh: options.forceRefresh === true,
      healthLevel: options.healthLevel || undefined,
      trigger: options.trigger || undefined,
    }),
    noRetry: true,
    timeout: options.timeout || 45_000,
  }, 'Failed to load provider health');
}

export async function listProviderStrategyHealthLogs(options = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await apiFetchJson(`${BASE}/provider-strategy/health/logs${query}`, {}, 'Failed to load provider health logs');
  return data.logs || [];
}

export async function updateAgentEnabled(id, enabled, summary) {
  const data = await apiFetchJson(`${BASE}/${encodeURIComponent(id)}/enabled`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: enabled !== false, summary }),
  }, 'Failed to update agent status');
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

export async function updateAgentRuntime(id, runtime, summary) {
  const data = await apiFetchJson(`${BASE}/${encodeURIComponent(id)}/runtime`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runtime, summary }),
  }, 'Failed to save agent runtime defaults');
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

export async function listImageParserTestResults(options = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.provider) params.set('provider', options.provider);
  if (options.model) params.set('model', options.model);
  if (options.fixture) params.set('fixture', options.fixture);
  if (options.status) params.set('status', options.status);
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiFetchJson(`/api/pipeline-tests/parser-results${query}`, {}, 'Failed to load image parser test results');
}

export async function updateImageParserTestResult(id, payload) {
  const data = await apiFetchJson(`/api/pipeline-tests/parser-results/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  }, 'Failed to update image parser test result');
  return data.result;
}
