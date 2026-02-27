const BASE = '/api/playbook';

export async function listCategories() {
  const res = await fetch(`${BASE}/categories`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to list categories');
  return data.categories;
}

export async function getCategoryContent(name) {
  const res = await fetch(`${BASE}/categories/${encodeURIComponent(name)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Category not found');
  return data.content;
}

export async function updateCategoryContent(name, content) {
  const res = await fetch(`${BASE}/categories/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to update');
}

export async function getEdgeCases() {
  const res = await fetch(`${BASE}/edge-cases`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch edge cases');
  return data.content;
}
