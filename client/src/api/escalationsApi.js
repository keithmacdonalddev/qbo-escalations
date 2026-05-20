import { apiFetchJson } from './http.js';
import { serializeJsonRequestBody } from '../lib/jsonRequestBody.js';
const BASE = '/api/escalations';

export async function listEscalations({ status, category, search, agent, limit = 50, offset = 0, sort = '-createdAt' } = {}) {
  const params = new URLSearchParams({ limit, offset, sort });
  if (status) params.set('status', status);
  if (category) params.set('category', category);
  if (search) params.set('search', search);
  if (agent) params.set('agent', agent);

  const data = await apiFetchJson(`${BASE}?${params}`, {}, 'Failed to list escalations');
  return { escalations: data.escalations, total: data.total };
}

export async function getEscalation(id) {
  const data = await apiFetchJson(`${BASE}/${id}`, {}, 'Escalation not found');
  return data.escalation;
}

export async function createEscalation(fields) {
  const data = await apiFetchJson(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  }, 'Failed to create escalation');
  return data.escalation;
}

export async function updateEscalation(id, fields) {
  const data = await apiFetchJson(`${BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  }, 'Failed to update escalation');
  return data.escalation;
}

export async function deleteEscalation(id) {
  await apiFetchJson(`${BASE}/${id}`, { method: 'DELETE' }, 'Failed to delete escalation');
}

export async function getEscalationKnowledge(id) {
  const data = await apiFetchJson(`${BASE}/${id}/knowledge`, {}, 'Failed to load knowledge draft');
  return data.knowledge || null;
}

export async function generateEscalationKnowledge(id, { force = false, enrich = false } = {}) {
  const data = await apiFetchJson(`${BASE}/${id}/knowledge/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force, enrich }),
  }, 'Failed to generate knowledge draft');
  return data.knowledge;
}

export async function updateEscalationKnowledge(id, fields) {
  const data = await apiFetchJson(`${BASE}/${id}/knowledge`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  }, 'Failed to update knowledge draft');
  return data.knowledge;
}

export async function publishEscalationKnowledge(id) {
  return apiFetchJson(`${BASE}/${id}/knowledge/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }, 'Failed to publish knowledge draft');
}

export async function unpublishEscalationKnowledge(id) {
  return apiFetchJson(`${BASE}/${id}/knowledge/unpublish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }, 'Failed to unpublish knowledge');
}

/** Quick status transition — returns { escalation, knowledgeEligible } */
export async function transitionEscalation(id, status, resolution = '') {
  const data = await apiFetchJson(`${BASE}/${id}/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, resolution }),
  }, 'Failed to transition escalation');
  return { escalation: data.escalation, knowledgeEligible: Boolean(data.knowledgeEligible) };
}

/** Link escalation to conversation */
export async function linkEscalation(id, conversationId) {
  const data = await apiFetchJson(`${BASE}/${id}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId }),
  }, 'Failed to link escalation');
  return data.escalation;
}

// parseEscalation and quickParseEscalation wrappers were removed 2026-05-19
// (parser-harness-hardening DECISIONS.md D7) along with their server routes
// POST /api/escalations/parse and POST /api/escalations/quick-parse. No live
// client code imported them. The active chat-v5 image parse path goes through
// POST /api/image-parser/parse (see client/src/api/imageParserApi.js).

/** Create escalation directly from a chat conversation */
export async function createEscalationFromConversation(conversationId, fields) {
  const data = await apiFetchJson(`${BASE}/from-conversation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, ...fields }),
  }, 'Failed to create escalation from conversation');
  return data.escalation;
}

/** List all knowledge candidates with filters */
export async function listKnowledgeCandidates({ reviewStatus, category, reusableOutcome, sort = '-createdAt', limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit, offset, sort });
  if (reviewStatus) params.set('reviewStatus', reviewStatus);
  if (category) params.set('category', category);
  if (reusableOutcome) params.set('reusableOutcome', reusableOutcome);

  const data = await apiFetchJson(`${BASE}/knowledge-candidates?${params}`, {}, 'Failed to list knowledge candidates');
  return { candidates: data.candidates, total: data.total, counts: data.counts };
}

/** List workflow attention items for review */
export async function listAttentionItems({ status = 'open', kind, refresh = false, sort = 'priority', limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams({ status, limit, offset, sort });
  if (kind) params.set('kind', kind);
  if (refresh) params.set('refresh', '1');

  const options = refresh ? { timeout: 45_000 } : {};
  const data = await apiFetchJson(`${BASE}/attention-items?${params}`, options, 'Failed to list attention items');
  return {
    items: data.items,
    total: data.total,
    counts: data.counts,
    kindCounts: data.kindCounts || {},
    severityCounts: data.severityCounts || {},
    sort: data.sort || sort,
    refresh: data.refresh || null,
  };
}

/** Update a workflow attention item review state */
export async function updateAttentionItem(id, { status, resolutionNote = '' } = {}) {
  const data = await apiFetchJson(`${BASE}/attention-items/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, resolutionNote }),
  }, 'Failed to update attention item');
  return data.item;
}

/** Update multiple workflow attention items at once */
export async function bulkUpdateAttentionItems(ids, { status, resolutionNote = '' } = {}) {
  return apiFetchJson(`${BASE}/attention-items/bulk`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, status, resolutionNote }),
  }, 'Failed to update attention items');
}

/** Fetch knowledge gap analysis for playbook coverage */
export async function getKnowledgeGaps(days = 30) {
  return apiFetchJson(`${BASE}/knowledge-gaps?days=${days}`, {}, 'Failed to fetch knowledge gaps');
}

/** Fetch similar escalations by category/symptoms or escalationId */
export async function listSimilarEscalations({ escalationId, category, symptoms, limit = 10 } = {}) {
  const params = new URLSearchParams();
  if (escalationId) params.set('escalationId', escalationId);
  if (category) params.set('category', category);
  if (symptoms) params.set('symptoms', symptoms);
  params.set('limit', String(limit));

  const data = await apiFetchJson(`${BASE}/similar?${params}`, {}, 'Failed to fetch similar escalations');
  return data.escalations;
}

/** Attach screenshots to an escalation (base64 images) */
export async function uploadEscalationScreenshots(id, images) {
  const data = await apiFetchJson(`${BASE}/${id}/screenshots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await serializeJsonRequestBody({ images }, {
      offThread: Array.isArray(images) && images.length > 0,
    }),
  }, 'Failed to upload escalation screenshots');
  return data.escalation;
}

/** Remove one screenshot attachment from an escalation */
export async function deleteEscalationScreenshot(id, filename) {
  const data = await apiFetchJson(`${BASE}/${id}/screenshots/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  }, 'Failed to delete escalation screenshot');
  return data.escalation;
}
