import { apiFetchJson } from './http.js';

const BASE = '/api/playbook';

export async function listCategories() {
  const data = await apiFetchJson(`${BASE}/categories`, {}, 'Failed to list categories');
  return data.categories;
}

export async function getCategoryContent(name) {
  const data = await apiFetchJson(`${BASE}/categories/${encodeURIComponent(name)}`, {}, 'Category not found');
  return data.content;
}

export async function updateCategoryContent(name, content, label) {
  const body = { content };
  if (label) body.label = label;
  await apiFetchJson(`${BASE}/categories/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 'Failed to update playbook category');
}

export async function createCategory(name, content = '') {
  const data = await apiFetchJson(`${BASE}/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  }, 'Failed to create category');
  return data.name;
}

export async function deleteCategory(name) {
  await apiFetchJson(`${BASE}/categories/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  }, 'Failed to delete category');
}

export async function getEdgeCases() {
  const data = await apiFetchJson(`${BASE}/edge-cases`, {}, 'Failed to fetch edge cases');
  return data.content;
}

export async function updateEdgeCases(content, label) {
  const body = { content };
  if (label) body.label = label;
  await apiFetchJson(`${BASE}/edge-cases`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 'Failed to update edge cases');
}

export async function getFullPlaybook() {
  const data = await apiFetchJson(`${BASE}/full`, {}, 'Failed to fetch full playbook');
  return data.content;
}

// ---------------------------------------------------------------------------
// Version history API
// ---------------------------------------------------------------------------

export async function listCategoryVersions(name) {
  const data = await apiFetchJson(`${BASE}/categories/${encodeURIComponent(name)}/versions`, {}, 'Failed to list category versions');
  return data.versions;
}

export async function getCategoryVersion(name, ts) {
  const data = await apiFetchJson(`${BASE}/categories/${encodeURIComponent(name)}/versions/${ts}`, {}, 'Version not found');
  return data.content;
}

export async function restoreCategoryVersion(name, ts) {
  await apiFetchJson(`${BASE}/categories/${encodeURIComponent(name)}/restore/${ts}`, {
    method: 'POST',
  }, 'Failed to restore category version');
}

export async function listEdgeCaseVersions() {
  const data = await apiFetchJson(`${BASE}/edge-cases/versions`, {}, 'Failed to list edge-case versions');
  return data.versions;
}

export async function getEdgeCaseVersion(ts) {
  const data = await apiFetchJson(`${BASE}/edge-cases/versions/${ts}`, {}, 'Version not found');
  return data.content;
}

export async function restoreEdgeCaseVersion(ts) {
  await apiFetchJson(`${BASE}/edge-cases/restore/${ts}`, {
    method: 'POST',
  }, 'Failed to restore edge-case version');
}
