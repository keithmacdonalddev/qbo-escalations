import { apiFetch } from './http.js';
const BASE = '/api/usage';

function buildParams(dateFrom, dateTo, extra) {
  const params = new URLSearchParams();
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (extra) Object.entries(extra).forEach(([k, v]) => { if (v != null) params.set(k, v); });
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function getUsageSummary(dateFrom, dateTo) {
  const res = await apiFetch(`${BASE}/summary${buildParams(dateFrom, dateTo)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch usage summary');
  return data;
}

export async function getUsageByProvider(dateFrom, dateTo) {
  const res = await apiFetch(`${BASE}/by-provider${buildParams(dateFrom, dateTo)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch usage by provider');
  return data;
}

export async function getUsageByService(dateFrom, dateTo) {
  const res = await apiFetch(`${BASE}/by-service${buildParams(dateFrom, dateTo)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch usage by service');
  return data;
}

export async function getUsageTrends(dateFrom, dateTo, interval = 'daily') {
  const res = await apiFetch(`${BASE}/trends${buildParams(dateFrom, dateTo, { interval })}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch usage trends');
  return data;
}

export async function getUsageByCategory(dateFrom, dateTo, service) {
  const res = await apiFetch(`${BASE}/by-category${buildParams(dateFrom, dateTo, { service })}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch usage by category');
  return data;
}

export async function getUsageRecent(dateFrom, dateTo, page = 1, limit = 50) {
  const res = await apiFetch(`${BASE}/recent${buildParams(dateFrom, dateTo, { page, limit })}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch recent usage');
  return data;
}

export async function getUsageByConversation(conversationId) {
  const res = await apiFetch(`${BASE}/conversation/${encodeURIComponent(conversationId)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch conversation usage');
  return data;
}

export async function getUsageModels(dateFrom, dateTo) {
  const res = await apiFetch(`${BASE}/models${buildParams(dateFrom, dateTo)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch usage by model');
  return data;
}
