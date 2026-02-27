const BASE = '/api/templates';

export async function listTemplates(category) {
  const params = category ? `?category=${category}` : '';
  const res = await fetch(`${BASE}${params}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to list templates');
  return data.templates;
}

export async function getTemplate(id) {
  const res = await fetch(`${BASE}/${id}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Template not found');
  return data.template;
}

export async function createTemplate(fields) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to create');
  return data.template;
}

export async function updateTemplate(id, fields) {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to update');
  return data.template;
}

export async function deleteTemplate(id) {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to delete');
}

export async function trackTemplateUsage(id) {
  const res = await fetch(`${BASE}/${id}/use`, { method: 'POST' });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to track usage');
  return data.usageCount;
}
