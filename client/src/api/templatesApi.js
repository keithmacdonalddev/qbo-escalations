import { apiFetchJson } from './http.js';

const BASE = '/api/templates';

export async function listTemplates(category) {
  const params = category ? `?category=${category}` : '';
  const data = await apiFetchJson(`${BASE}${params}`, {}, 'Failed to list templates');
  return data.templates;
}

export async function getTemplate(id) {
  const data = await apiFetchJson(`${BASE}/${id}`, {}, 'Template not found');
  return data.template;
}

export async function createTemplate(fields) {
  const data = await apiFetchJson(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  }, 'Failed to create template');
  return data.template;
}

export async function updateTemplate(id, fields) {
  const data = await apiFetchJson(`${BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  }, 'Failed to update template');
  return data.template;
}

export async function deleteTemplate(id) {
  await apiFetchJson(`${BASE}/${id}`, { method: 'DELETE' }, 'Failed to delete template');
}

export async function renderTemplate(id, variables) {
  return apiFetchJson(`${BASE}/${id}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variables }),
  }, 'Failed to render template');
}

export async function duplicateTemplate(id) {
  const data = await apiFetchJson(`${BASE}/${id}/duplicate`, { method: 'POST' }, 'Failed to duplicate template');
  return data.template;
}

export async function trackTemplateUsage(id) {
  const data = await apiFetchJson(`${BASE}/${id}/use`, { method: 'POST' }, 'Failed to track template usage');
  return data.usageCount;
}
