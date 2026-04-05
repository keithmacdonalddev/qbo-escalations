import { apiFetchJson } from './http.js';
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
  return apiFetchJson(`${BASE}/summary${buildParams(dateFrom, dateTo)}`, {}, 'Failed to fetch usage summary');
}

export async function getUsageByProvider(dateFrom, dateTo) {
  return apiFetchJson(`${BASE}/by-provider${buildParams(dateFrom, dateTo)}`, {}, 'Failed to fetch usage by provider');
}

export async function getUsageByService(dateFrom, dateTo) {
  return apiFetchJson(`${BASE}/by-service${buildParams(dateFrom, dateTo)}`, {}, 'Failed to fetch usage by service');
}

export async function getUsageTrends(dateFrom, dateTo, interval = 'daily') {
  return apiFetchJson(`${BASE}/trends${buildParams(dateFrom, dateTo, { interval })}`, {}, 'Failed to fetch usage trends');
}

export async function getUsageByCategory(dateFrom, dateTo, service) {
  return apiFetchJson(`${BASE}/by-category${buildParams(dateFrom, dateTo, { service })}`, {}, 'Failed to fetch usage by category');
}

export async function getUsageRecent(dateFrom, dateTo, page = 1, limit = 50) {
  return apiFetchJson(`${BASE}/recent${buildParams(dateFrom, dateTo, { page, limit })}`, {}, 'Failed to fetch recent usage');
}

export async function getUsageByConversation(conversationId) {
  return apiFetchJson(`${BASE}/conversation/${encodeURIComponent(conversationId)}`, {}, 'Failed to fetch conversation usage');
}

export async function getUsageModels(dateFrom, dateTo) {
  return apiFetchJson(`${BASE}/models${buildParams(dateFrom, dateTo)}`, {}, 'Failed to fetch usage by model');
}
