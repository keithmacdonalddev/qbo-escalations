import { apiFetch } from './http.js';
const BASE = '/api/escalations';

function toApiError(data, fallbackMessage) {
  const err = new Error((data && data.error) || fallbackMessage || 'Request failed');
  if (data && data.code) err.code = data.code;
  if (data && data.detail) err.detail = data.detail;
  if (data && Array.isArray(data.attempts)) err.attempts = data.attempts;
  return err;
}

export async function listEscalations({ status, category, search, agent, limit = 50, offset = 0, sort = '-createdAt' } = {}) {
  const params = new URLSearchParams({ limit, offset, sort });
  if (status) params.set('status', status);
  if (category) params.set('category', category);
  if (search) params.set('search', search);
  if (agent) params.set('agent', agent);

  const res = await apiFetch(`${BASE}?${params}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to list escalations');
  return { escalations: data.escalations, total: data.total };
}

export async function getEscalation(id) {
  const res = await apiFetch(`${BASE}/${id}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Escalation not found');
  return data.escalation;
}

export async function createEscalation(fields) {
  const res = await apiFetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to create');
  return data.escalation;
}

export async function updateEscalation(id, fields) {
  const res = await apiFetch(`${BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to update');
  return data.escalation;
}

export async function deleteEscalation(id) {
  const res = await apiFetch(`${BASE}/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to delete');
}

/** Quick status transition */
export async function transitionEscalation(id, status, resolution = '') {
  const res = await apiFetch(`${BASE}/${id}/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, resolution }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to transition');
  return data.escalation;
}

/** Link escalation to conversation */
export async function linkEscalation(id, conversationId) {
  const res = await apiFetch(`${BASE}/${id}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to link');
  return data.escalation;
}

/** Parse escalation from image/text and persist it */
export async function parseEscalation({
  image,
  text,
  mode,
  provider,
  primaryProvider,
  fallbackProvider,
  timeoutMs,
} = {}) {
  const res = await apiFetch(`${BASE}/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image,
      text,
      mode,
      provider,
      primaryProvider,
      fallbackProvider,
      timeoutMs,
    }),
  });
  const data = await res.json();
  if (!data.ok) throw toApiError(data, 'Failed to parse escalation');
  return data;
}

/** Regex-only quick parse (does not persist record) */
export async function quickParseEscalation(text) {
  const res = await apiFetch(`${BASE}/quick-parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to quick-parse escalation');
  return data;
}

/** Create escalation directly from a chat conversation */
export async function createEscalationFromConversation(conversationId, fields) {
  const res = await apiFetch(`${BASE}/from-conversation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, ...fields }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to create escalation from conversation');
  return data.escalation;
}

/** Fetch similar escalations by category/symptoms or escalationId */
export async function listSimilarEscalations({ escalationId, category, symptoms, limit = 10 } = {}) {
  const params = new URLSearchParams();
  if (escalationId) params.set('escalationId', escalationId);
  if (category) params.set('category', category);
  if (symptoms) params.set('symptoms', symptoms);
  params.set('limit', String(limit));

  const res = await apiFetch(`${BASE}/similar?${params}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch similar escalations');
  return data.escalations;
}

/** Attach screenshots to an escalation (base64 images) */
export async function uploadEscalationScreenshots(id, images) {
  const res = await apiFetch(`${BASE}/${id}/screenshots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to upload screenshots');
  return data.escalation;
}

/** Remove one screenshot attachment from an escalation */
export async function deleteEscalationScreenshot(id, filename) {
  const res = await apiFetch(`${BASE}/${id}/screenshots/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to delete screenshot');
  return data.escalation;
}
