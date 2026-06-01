import { apiFetch, apiFetchJson, readApiResponse } from './http.js';

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

export async function updateAgentEnabled(id, enabled, summary, options = {}) {
  if (typeof options.onLifecycleEvent === 'function') {
    return updateAgentEnabledStream(id, enabled, summary, options);
  }
  const data = await apiFetchJson(`${BASE}/${encodeURIComponent(id)}/enabled`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: enabled !== false, summary, clientSteps: options.clientSteps }),
  }, 'Failed to update agent status');
  return data;
}

async function updateAgentEnabledStream(id, enabled, summary, options = {}) {
  const onLifecycleEvent = options.onLifecycleEvent;
  const res = await apiFetch(`${BASE}/${encodeURIComponent(id)}/enabled/stream`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: enabled !== false, summary, clientSteps: options.clientSteps }),
    noRetry: true,
    timeout: 90_000,
  });

  if (!res.body?.getReader) {
    return readApiResponse(res, 'Failed to update agent status');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalPayload = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      const event = parseLifecycleStreamLine(line);
      if (!event) continue;
      onLifecycleEvent(event);
      if (event.type === 'complete' || event.type === 'error') {
        finalPayload = event;
      }
    }
  }

  buffer += decoder.decode();
  const trailingEvent = parseLifecycleStreamLine(buffer);
  if (trailingEvent) {
    onLifecycleEvent(trailingEvent);
    if (trailingEvent.type === 'complete' || trailingEvent.type === 'error') {
      finalPayload = trailingEvent;
    }
  }

  if (!finalPayload) {
    throw Object.assign(new Error('Lifecycle stream ended before completion.'), {
      code: 'LIFECYCLE_STREAM_INCOMPLETE',
    });
  }
  if (finalPayload.ok === false || finalPayload.type === 'error') {
    throw Object.assign(new Error(finalPayload.error || 'Failed to update agent status.'), finalPayload);
  }
  return finalPayload;
}

function parseLifecycleStreamLine(line) {
  const trimmed = typeof line === 'string' ? line.trim() : '';
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
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
  return {
    history: data.history || [],
    activity: data.activity || data.history || [],
  };
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

export async function programmaticCheckImageParserTestResult(id) {
  return apiFetchJson(`/api/pipeline-tests/parser-results/${encodeURIComponent(id)}/programmatic-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewer: 'programmatic-check' }),
    noRetry: true,
  }, 'Failed to run parser output check');
}

export async function retestImageParserTestResult(result) {
  const fixtureName = String(result?.fixture?.name || '').trim();

  const previousRuntime = result?.runtime && typeof result.runtime === 'object' ? result.runtime : {};
  const parserRuntime = {
    ...previousRuntime,
    provider: result?.provider || previousRuntime.provider || '',
    model: result?.model || previousRuntime.model || '',
    reasoningEffort: result?.reasoningEffort || previousRuntime.reasoningEffort || '',
  };

  return apiFetchJson('/api/pipeline-tests/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stage: 'parser',
      retest: true,
      fixtureName,
      runtime: {
        imageParser: parserRuntime,
        'image-parser': parserRuntime,
        'escalation-template-parser': parserRuntime,
      },
    }),
    timeout: 180_000,
    noRetry: true,
  }, 'Failed to retest parser image');
}

export async function deleteImageParserTestResult(id) {
  const data = await apiFetchJson(`/api/pipeline-tests/parser-results/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    noRetry: true,
  }, 'Failed to delete image parser test result');
  return data;
}

export async function listImageParserHistory(options = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.page) params.set('page', String(options.page));
  if (options.provider) params.set('provider', options.provider);
  if (options.status) params.set('status', options.status);
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiFetchJson(`/api/image-parser/history${query}`, {}, 'Failed to load image parser history');
}

// Stage 4 Triage Agent test results. Same shape as the parser equivalents
// above but pointed at /api/triage-tests/... which is the dedicated route
// added alongside the triage parity work.
export async function listTriageTestResults(options = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.provider) params.set('provider', options.provider);
  if (options.model) params.set('model', options.model);
  if (options.fixture) params.set('fixture', options.fixture);
  if (options.status) params.set('status', options.status);
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiFetchJson(`/api/triage-tests/results${query}`, {}, 'Failed to load triage agent test results');
}

export async function updateTriageTestResult(id, payload) {
  const data = await apiFetchJson(`/api/triage-tests/results/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  }, 'Failed to update triage agent test result');
  return data.result;
}
