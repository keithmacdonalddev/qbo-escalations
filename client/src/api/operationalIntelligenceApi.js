import { apiFetchJson } from './http.js';

const BASE = '/api/operational-intelligence';

export async function getOperationalIntelligenceRecord(recordId, options = {}) {
  const params = new URLSearchParams();
  if (options.syncIfMissing !== undefined) {
    params.set('syncIfMissing', options.syncIfMissing ? 'true' : 'false');
  }
  const suffix = params.toString() ? `?${params}` : '';
  const data = await apiFetchJson(
    `${BASE}/records/${encodeURIComponent(recordId)}${suffix}`,
    {},
    'Failed to load indexed claims and evidence'
  );
  return data.intelligence;
}

export async function getOperationalIntelligenceSummary() {
  const data = await apiFetchJson(`${BASE}/summary`, {}, 'Failed to load operational intelligence summary');
  return data.summary;
}
