import { apiFetch } from './http.js';

const BASE = '/api/playbook';

export async function listCategories() {
  const res = await apiFetch(`${BASE}/categories`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to list categories');
  return data.categories;
}

export async function getCategoryContent(name) {
  const res = await apiFetch(`${BASE}/categories/${encodeURIComponent(name)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Category not found');
  return data.content;
}

export async function updateCategoryContent(name, content, label) {
  const body = { content };
  if (label) body.label = label;
  const res = await apiFetch(`${BASE}/categories/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to update');
}

export async function createCategory(name, content = '') {
  const res = await apiFetch(`${BASE}/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to create category');
  return data.name;
}

export async function deleteCategory(name) {
  const res = await apiFetch(`${BASE}/categories/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to delete category');
}

export async function getEdgeCases() {
  const res = await apiFetch(`${BASE}/edge-cases`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch edge cases');
  return data.content;
}

export async function updateEdgeCases(content, label) {
  const body = { content };
  if (label) body.label = label;
  const res = await apiFetch(`${BASE}/edge-cases`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to update edge cases');
}

export async function getFullPlaybook() {
  const res = await apiFetch(`${BASE}/full`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch full playbook');
  return data.content;
}

// ---------------------------------------------------------------------------
// Version history API
// ---------------------------------------------------------------------------

export async function listCategoryVersions(name) {
  const res = await apiFetch(`${BASE}/categories/${encodeURIComponent(name)}/versions`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to list versions');
  return data.versions;
}

export async function getCategoryVersion(name, ts) {
  const res = await apiFetch(`${BASE}/categories/${encodeURIComponent(name)}/versions/${ts}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Version not found');
  return data.content;
}

export async function restoreCategoryVersion(name, ts) {
  const res = await apiFetch(`${BASE}/categories/${encodeURIComponent(name)}/restore/${ts}`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to restore version');
}

export async function listEdgeCaseVersions() {
  const res = await apiFetch(`${BASE}/edge-cases/versions`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to list versions');
  return data.versions;
}

export async function getEdgeCaseVersion(ts) {
  const res = await apiFetch(`${BASE}/edge-cases/versions/${ts}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Version not found');
  return data.content;
}

export async function restoreEdgeCaseVersion(ts) {
  const res = await apiFetch(`${BASE}/edge-cases/restore/${ts}`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to restore version');
}
