const BASE = '/api/escalations';

export async function listEscalations({ status, category, search, agent, limit = 50, offset = 0, sort = '-createdAt' } = {}) {
  const params = new URLSearchParams({ limit, offset, sort });
  if (status) params.set('status', status);
  if (category) params.set('category', category);
  if (search) params.set('search', search);
  if (agent) params.set('agent', agent);

  const res = await fetch(`${BASE}?${params}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to list escalations');
  return { escalations: data.escalations, total: data.total };
}

export async function getEscalation(id) {
  const res = await fetch(`${BASE}/${id}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Escalation not found');
  return data.escalation;
}

export async function createEscalation(fields) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to create');
  return data.escalation;
}

export async function updateEscalation(id, fields) {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to update');
  return data.escalation;
}

export async function deleteEscalation(id) {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to delete');
}

/** Quick status transition */
export async function transitionEscalation(id, status, resolution = '') {
  const res = await fetch(`${BASE}/${id}/transition`, {
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
  const res = await fetch(`${BASE}/${id}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to link');
  return data.escalation;
}
