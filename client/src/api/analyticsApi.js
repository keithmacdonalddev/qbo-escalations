import { apiFetchJson } from './http.js';
const BASE = '/api/analytics';

export async function getSummary() {
  const data = await apiFetchJson(`${BASE}/summary`, {}, 'Failed to fetch summary');
  return data.summary;
}

export async function getCategoryBreakdown(dateFrom, dateTo) {
  const params = new URLSearchParams();
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  const data = await apiFetchJson(`${BASE}/categories?${params}`, {}, 'Failed to fetch categories');
  return data.categories;
}

export async function getResolutionTimes(dateFrom, dateTo) {
  const params = new URLSearchParams();
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  const data = await apiFetchJson(`${BASE}/resolution-time?${params}`, {}, 'Failed to fetch resolution times');
  return data.resolutionTimes;
}

export async function getTopAgents(limit = 20) {
  const data = await apiFetchJson(`${BASE}/agents?limit=${limit}`, {}, 'Failed to fetch agents');
  return data.agents;
}

export async function getTrends(interval = 'daily', dateFrom, dateTo) {
  const params = new URLSearchParams({ interval });
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  const data = await apiFetchJson(`${BASE}/trends?${params}`, {}, 'Failed to fetch trends');
  return data.trends;
}

export async function getRecurringIssues(limit = 10) {
  const data = await apiFetchJson(`${BASE}/recurring?limit=${limit}`, {}, 'Failed to fetch recurring issues');
  return data.recurring;
}

export async function getTodaySnapshot() {
  const data = await apiFetchJson(`${BASE}/today`, {}, 'Failed to fetch today snapshot');
  return data.today;
}

export async function getStatusFlow(dateFrom, dateTo) {
  const params = new URLSearchParams();
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  const suffix = params.toString() ? `?${params}` : '';
  const data = await apiFetchJson(`${BASE}/status-flow${suffix}`, {}, 'Failed to fetch status flow');
  return { total: data.total, flow: data.flow };
}

export async function getModelPerformance(dateFrom, dateTo, context) {
  const params = new URLSearchParams();
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (context) params.set('context', context);
  const suffix = params.toString() ? `?${params}` : '';
  return apiFetchJson(`${BASE}/model-performance${suffix}`, {}, 'Failed to fetch model performance');
}
