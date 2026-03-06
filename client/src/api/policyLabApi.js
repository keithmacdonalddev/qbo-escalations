import { apiFetch } from './http.js';

const BASE = '/api/policy-lab';

export async function getPolicyLabBootstrap() {
  const response = await apiFetch(`${BASE}/bootstrap`);
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Failed to load Policy Lab.');
  }
  return payload;
}

export async function getPolicyLabHistory() {
  const response = await apiFetch(`${BASE}/history`);
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Failed to load Policy Lab history.');
  }
  return payload.history || [];
}

export async function getProjectPolicyArtifact(targetPath) {
  const response = await apiFetch(`${BASE}/project-artifact?path=${encodeURIComponent(targetPath)}`);
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Failed to load the selected project file.');
  }
  return payload.artifact;
}

export async function runPolicyLabEvaluation(body) {
  const response = await apiFetch(`${BASE}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeout: 180_000,
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Policy Lab evaluation failed.');
  }
  return payload;
}
