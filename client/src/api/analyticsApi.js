import { apiFetch } from './http.js';
const BASE = '/api/analytics';

export async function getSummary() {
  const res = await apiFetch(`${BASE}/summary`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch summary');
  return data.summary;
}

export async function getCategoryBreakdown(dateFrom, dateTo) {
  const params = new URLSearchParams();
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  const res = await apiFetch(`${BASE}/categories?${params}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch categories');
  return data.categories;
}

export async function getResolutionTimes(dateFrom, dateTo) {
  const params = new URLSearchParams();
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  const res = await apiFetch(`${BASE}/resolution-time?${params}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch resolution times');
  return data.resolutionTimes;
}

export async function getTopAgents(limit = 20) {
  const res = await apiFetch(`${BASE}/agents?limit=${limit}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch agents');
  return data.agents;
}

export async function getTrends(interval = 'daily', dateFrom, dateTo) {
  const params = new URLSearchParams({ interval });
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  const res = await apiFetch(`${BASE}/trends?${params}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch trends');
  return data.trends;
}

export async function getRecurringIssues(limit = 10) {
  const res = await apiFetch(`${BASE}/recurring?limit=${limit}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch recurring issues');
  return data.recurring;
}

export async function getTodaySnapshot() {
  const res = await apiFetch(`${BASE}/today`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch today snapshot');
  return data.today;
}

export async function getStatusFlow(dateFrom, dateTo) {
  const params = new URLSearchParams();
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  const suffix = params.toString() ? `?${params}` : '';
  const res = await apiFetch(`${BASE}/status-flow${suffix}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch status flow');
  return { total: data.total, flow: data.flow };
}

export async function getModelPerformance(dateFrom, dateTo, context) {
  const params = new URLSearchParams();
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (context) params.set('context', context);
  const suffix = params.toString() ? `?${params}` : '';
  const res = await apiFetch(`${BASE}/model-performance${suffix}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch model performance');
  return data;
}
