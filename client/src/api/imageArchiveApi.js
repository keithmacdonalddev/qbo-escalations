import { apiFetch } from './http.js';

const BASE = '/api/chat/image-archive';

export async function getArchiveStats() {
  const res = await apiFetch(`${BASE}/stats`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch archive stats');
  return data;
}

export async function getAllArchivedImages({ grade, dateFrom, dateTo, conversationId, limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams();
  params.set('limit', limit);
  params.set('offset', offset);
  if (grade) params.set('grade', grade);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (conversationId) params.set('conversationId', conversationId);
  const res = await apiFetch(`${BASE}/all?${params}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch images');
  return { images: data.images, total: data.total };
}

export function getImageFileUrl(conversationId, imageId) {
  return `${BASE}/${conversationId}/${imageId}/file`;
}
