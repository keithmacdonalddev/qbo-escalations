const BASE = '/api/analytics';

export async function getSummary() {
  const res = await fetch(`${BASE}/summary`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch summary');
  return data.summary;
}

export async function getCategoryBreakdown(dateFrom, dateTo) {
  const params = new URLSearchParams();
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  const res = await fetch(`${BASE}/categories?${params}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch categories');
  return data.categories;
}

export async function getResolutionTimes(dateFrom, dateTo) {
  const params = new URLSearchParams();
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  const res = await fetch(`${BASE}/resolution-time?${params}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch resolution times');
  return data.resolutionTimes;
}

export async function getTopAgents(limit = 20) {
  const res = await fetch(`${BASE}/agents?limit=${limit}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch agents');
  return data.agents;
}

export async function getTrends(interval = 'daily', dateFrom, dateTo) {
  const params = new URLSearchParams({ interval });
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  const res = await fetch(`${BASE}/trends?${params}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch trends');
  return data.trends;
}

export async function getRecurringIssues(limit = 10) {
  const res = await fetch(`${BASE}/recurring?limit=${limit}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch recurring issues');
  return data.recurring;
}
