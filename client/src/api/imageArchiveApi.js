import { apiFetchJson } from './http.js';

const BASE = '/api/chat/image-archive';

export async function getArchiveStats() {
  return apiFetchJson(`${BASE}/stats`, { noDedupe: true }, 'Failed to fetch archive stats');
}

export async function getAllArchivedImages({ grade, dateFrom, dateTo, conversationId, limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams();
  params.set('limit', limit);
  params.set('offset', offset);
  if (grade) params.set('grade', grade);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (conversationId) params.set('conversationId', conversationId);
  const data = await apiFetchJson(`${BASE}/all?${params}`, { noDedupe: true }, 'Failed to fetch archived images');
  return { images: data.images, total: data.total };
}

export function getImageFileUrl(conversationId, imageId) {
  return `${BASE}/${conversationId}/${imageId}/file`;
}
