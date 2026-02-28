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

export async function updateCategoryContent(name, content) {
  const res = await apiFetch(`${BASE}/categories/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
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

export async function updateEdgeCases(content) {
  const res = await apiFetch(`${BASE}/edge-cases`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
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
