import { apiFetch } from './http.js';

const BASE = '/api/templates';

export async function listTemplates(category) {
  const params = category ? `?category=${category}` : '';
  const res = await apiFetch(`${BASE}${params}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to list templates');
  return data.templates;
}

export async function getTemplate(id) {
  const res = await apiFetch(`${BASE}/${id}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Template not found');
  return data.template;
}

export async function createTemplate(fields) {
  const res = await apiFetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to create');
  return data.template;
}

export async function updateTemplate(id, fields) {
  const res = await apiFetch(`${BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to update');
  return data.template;
}

export async function deleteTemplate(id) {
  const res = await apiFetch(`${BASE}/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to delete');
}

export async function renderTemplate(id, variables) {
  const res = await apiFetch(`${BASE}/${id}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variables }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to render template');
  return data;
}

export async function duplicateTemplate(id) {
  const res = await apiFetch(`${BASE}/${id}/duplicate`, { method: 'POST' });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to duplicate template');
  return data.template;
}

export async function trackTemplateUsage(id) {
  const res = await apiFetch(`${BASE}/${id}/use`, { method: 'POST' });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to track usage');
  return data.usageCount;
}
