import { apiFetch } from './http.js';

const BASE = '/api/traces';

function buildParams(dateFrom, dateTo, filters = {}) {
  const params = new URLSearchParams();
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

export async function getTraceSummary(dateFrom, dateTo, filters = {}) {
  const res = await apiFetch(`${BASE}/summary${buildParams(dateFrom, dateTo, filters)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch trace summary');
  return data;
}

export async function getTraceModels(dateFrom, dateTo, filters = {}) {
  const res = await apiFetch(`${BASE}/models${buildParams(dateFrom, dateTo, filters)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch trace model summary');
  return data;
}

export async function getTraceModelTrends(dateFrom, dateTo, filters = {}, interval = 'daily', seriesLimit = 6) {
  const res = await apiFetch(`${BASE}/model-trends${buildParams(dateFrom, dateTo, {
    ...filters,
    interval,
    seriesLimit,
  })}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch trace model trends');
  return data;
}

export async function getTraceRecent(dateFrom, dateTo, filters = {}, page = 1, limit = 50) {
  const res = await apiFetch(`${BASE}/recent${buildParams(dateFrom, dateTo, {
    ...filters,
    page,
    limit,
  })}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch recent traces');
  return data;
}

export async function getTraceDetail(traceId) {
  const res = await apiFetch(`${BASE}/${encodeURIComponent(traceId)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch trace detail');
  return data.trace;
}

export async function getConversationTraces(conversationId) {
  const res = await apiFetch(`${BASE}/conversation/${encodeURIComponent(conversationId)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch conversation traces');
  return data.traces || [];
}
