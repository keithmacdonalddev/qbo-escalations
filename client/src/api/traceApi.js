import { apiFetchJson } from './http.js';

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
  return apiFetchJson(`${BASE}/summary${buildParams(dateFrom, dateTo, filters)}`, {}, 'Failed to fetch trace summary');
}

export async function getTraceModels(dateFrom, dateTo, filters = {}) {
  return apiFetchJson(`${BASE}/models${buildParams(dateFrom, dateTo, filters)}`, {}, 'Failed to fetch trace model summary');
}

export async function getTraceModelTrends(dateFrom, dateTo, filters = {}, interval = 'daily', seriesLimit = 6) {
  return apiFetchJson(`${BASE}/model-trends${buildParams(dateFrom, dateTo, {
    ...filters,
    interval,
    seriesLimit,
  })}`, {}, 'Failed to fetch trace model trends');
}

export async function getTraceRecent(dateFrom, dateTo, filters = {}, page = 1, limit = 50) {
  return apiFetchJson(`${BASE}/recent${buildParams(dateFrom, dateTo, {
    ...filters,
    page,
    limit,
  })}`, {}, 'Failed to fetch recent traces');
}

export async function getTraceDetail(traceId) {
  const data = await apiFetchJson(`${BASE}/${encodeURIComponent(traceId)}`, {}, 'Failed to fetch trace detail');
  return data.trace;
}

export async function getConversationTraces(conversationId) {
  const data = await apiFetchJson(`${BASE}/conversation/${encodeURIComponent(conversationId)}`, {}, 'Failed to fetch conversation traces');
  return data.traces || [];
}
