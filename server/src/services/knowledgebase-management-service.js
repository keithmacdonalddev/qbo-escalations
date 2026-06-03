'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const Escalation = require('../models/Escalation');
const KnowledgeCandidate = require('../models/KnowledgeCandidate');
const { syncKnowledgeReviewAttentionItem } = require('../lib/escalation-attention');
const { publishKnowledgeCandidate } = require('../lib/knowledge-promotion');
const {
  ALLOWED_USES,
  TRUST_STATES,
  deriveAllowedUses,
  getKnowledgeRecordById,
  listKnowledgeRecords,
  normalizeKnowledgeCandidate,
  normalizeKnowledgeRecordId,
  parseBoolean,
  parseLimit,
} = require('./knowledgebase-service');

const KNOWLEDGE_ROLES = Object.freeze({
  VIEWER: 'viewer',
  REVIEWER: 'reviewer',
  PUBLISHER: 'publisher',
  ADMIN: 'admin',
});

const ROLE_PERMISSIONS = Object.freeze({
  [KNOWLEDGE_ROLES.VIEWER]: new Set(['read']),
  [KNOWLEDGE_ROLES.REVIEWER]: new Set(['read', 'review', 'feedback', 'relationship', 'export']),
  [KNOWLEDGE_ROLES.PUBLISHER]: new Set(['read', 'review', 'feedback', 'relationship', 'export', 'publish', 'deprecate']),
  [KNOWLEDGE_ROLES.ADMIN]: new Set(['read', 'review', 'feedback', 'relationship', 'export', 'publish', 'deprecate', 'redact', 'admin']),
});

const FINAL_AGENT_USES = new Set([
  ALLOWED_USES.AGENT_RESPONSE,
  ALLOWED_USES.TRIAGE,
]);

const EDITABLE_TEXT_FIELDS = [
  'title',
  'summary',
  'symptom',
  'rootCause',
  'exactFix',
  'escalationPath',
  'reviewNotes',
  'category',
];

const REVIEW_STATUSES = new Set(['draft', 'approved', 'rejected']);
const PUBLISH_TARGETS = new Set(['category', 'edge-case', 'case-history-only']);
const REUSABLE_OUTCOMES = new Set([
  'canonical',
  'edge-case',
  'case-history-only',
  'customer-specific',
  'temporary-incident',
  'unsafe-to-reuse',
]);
const RELATIONSHIP_TYPES = new Set([
  'duplicate-of',
  'contradicts',
  'supersedes',
  'superseded-by',
  'narrows',
  'expands',
  'related',
  'same-root-cause',
]);
const RELATIONSHIP_STATUSES = new Set(['proposed', 'confirmed', 'rejected']);
const FEEDBACK_OUTCOMES = new Set(['worked', 'did-not-work', 'partial', 'unknown']);
const ACTION_PRIORITIES = new Set(['low', 'medium', 'high']);

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function compactText(value, maxChars = 500) {
  const text = safeString(value, '').replace(/\s+/g, ' ').trim();
  if (!text || text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function normalizeStringArray(value, limit = 12) {
  const raw = Array.isArray(value)
    ? value
    : safeString(value, '').split(/\r?\n|,/);
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const text = compactText(item, 220);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function clampConfidence(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function createServiceError(code, status, message) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function makeEventId(action) {
  return `kb-${action}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function defaultKnowledgeRole() {
  if (process.env.KNOWLEDGE_DEFAULT_ROLE) {
    return safeString(process.env.KNOWLEDGE_DEFAULT_ROLE).trim().toLowerCase();
  }
  return process.env.NODE_ENV === 'production' ? KNOWLEDGE_ROLES.VIEWER : KNOWLEDGE_ROLES.ADMIN;
}

function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = safeString(value, '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function resolveKnowledgeActor(reqOrActor = {}) {
  if (reqOrActor.actor || reqOrActor.role) {
    return {
      actor: compactText(reqOrActor.actor || 'system', 80),
      role: safeString(reqOrActor.role || defaultKnowledgeRole()).toLowerCase(),
    };
  }

  const headers = reqOrActor.headers || {};
  const user = reqOrActor.user || reqOrActor.auth || {};
  const trustRoleHeaders = process.env.NODE_ENV !== 'production'
    || envFlag('KNOWLEDGE_TRUST_REQUEST_ROLE_HEADERS', false);
  const actor = user.id
    || user.email
    || headers['x-knowledge-actor']
    || headers['x-user-id']
    || headers['x-user-email']
    || (process.env.NODE_ENV === 'production' ? 'anonymous' : 'local-user');
  const role = user.knowledgeRole
    || user.role
    || (trustRoleHeaders ? headers['x-knowledge-role'] : '')
    || defaultKnowledgeRole();
  return {
    actor: compactText(actor, 80),
    role: safeString(role, defaultKnowledgeRole()).toLowerCase(),
  };
}

function assertKnowledgePermission(actor, permission) {
  const role = safeString(actor?.role, defaultKnowledgeRole()).toLowerCase();
  const permissions = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS[KNOWLEDGE_ROLES.VIEWER];
  if (!permissions.has(permission)) {
    throw createServiceError(
      'KNOWLEDGE_PERMISSION_DENIED',
      403,
      `Knowledgebase ${permission} permission is required.`
    );
  }
}

function appendAuditEvent(doc, { action, actor, summary, metadata = {} } = {}) {
  doc.auditEvents = Array.isArray(doc.auditEvents) ? doc.auditEvents : [];
  doc.auditEvents.push({
    eventId: makeEventId(action || 'event'),
    action: safeString(action, 'event'),
    actor: safeString(actor?.actor, 'system'),
    role: safeString(actor?.role, ''),
    summary: compactText(summary, 500),
    metadata,
    createdAt: new Date(),
  });
  if (doc.auditEvents.length > 120) {
    doc.auditEvents = doc.auditEvents.slice(-120);
  }
}

function appendReviewHistory(doc, actor, notes = '') {
  doc.reviewHistory = Array.isArray(doc.reviewHistory) ? doc.reviewHistory : [];
  doc.reviewHistory.push({
    status: safeString(doc.reviewStatus),
    actor: safeString(actor?.actor, 'system'),
    notes: compactText(notes || doc.reviewNotes, 500),
    createdAt: new Date(),
  });
  if (doc.reviewHistory.length > 80) {
    doc.reviewHistory = doc.reviewHistory.slice(-80);
  }
}

async function loadCandidateForRecord(recordId) {
  const parsed = normalizeKnowledgeRecordId(recordId);
  if (!parsed.id || parsed.sourceType !== 'knowledge-candidate' || !mongoose.isValidObjectId(parsed.id)) {
    throw createServiceError('INVALID_KNOWLEDGE_RECORD_ID', 400, 'Invalid knowledge record id.');
  }
  const doc = await KnowledgeCandidate.findById(parsed.id);
  if (!doc) {
    throw createServiceError('KNOWLEDGE_RECORD_NOT_FOUND', 404, 'Knowledge record not found.');
  }
  return doc;
}

async function syncReviewAttention(doc) {
  if (!doc || !doc.escalationId) return { action: 'skipped', item: null };
  const escalation = await Escalation.findById(doc.escalationId)
    .select('_id conversationId status category caseNumber coid attemptingTo actualOutcome resolution resolutionNotes')
    .lean();
  return syncKnowledgeReviewAttentionItem(doc, escalation || {});
}

async function assertCandidateRecordExists(recordId, code = 'INVALID_KNOWLEDGE_RECORD_ID') {
  const parsed = normalizeKnowledgeRecordId(recordId);
  if (!parsed.id || parsed.sourceType !== 'knowledge-candidate' || !mongoose.isValidObjectId(parsed.id)) {
    throw createServiceError(code, 400, 'Invalid knowledge record id.');
  }
  const exists = await KnowledgeCandidate.exists({ _id: parsed.id });
  if (!exists) {
    throw createServiceError('KNOWLEDGE_RECORD_NOT_FOUND', 404, 'Knowledge record not found.');
  }
  return parsed;
}

function sanitizeKnowledgePatch(payload = {}) {
  const updates = {};
  for (const field of EDITABLE_TEXT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      updates[field] = compactText(payload[field], field === 'exactFix' ? 2000 : 900);
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'reviewStatus')) {
    const value = safeString(payload.reviewStatus).trim().toLowerCase();
    if (!REVIEW_STATUSES.has(value)) throw createServiceError('INVALID_REVIEW_STATUS', 400, 'Invalid review status.');
    updates.reviewStatus = value;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'publishTarget')) {
    const value = safeString(payload.publishTarget).trim().toLowerCase();
    if (!PUBLISH_TARGETS.has(value)) throw createServiceError('INVALID_PUBLISH_TARGET', 400, 'Invalid publish target.');
    updates.publishTarget = value;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'reusableOutcome')) {
    const value = safeString(payload.reusableOutcome).trim().toLowerCase();
    if (!REUSABLE_OUTCOMES.has(value)) throw createServiceError('INVALID_REUSABLE_OUTCOME', 400, 'Invalid reusable outcome.');
    updates.reusableOutcome = value;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'confidence')) {
    updates.confidence = clampConfidence(payload.confidence, 0.6);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'keySignals')) {
    updates.keySignals = normalizeStringArray(payload.keySignals, 12);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'allowedUsesOverride')) {
    const allowed = normalizeStringArray(payload.allowedUsesOverride, 12)
      .filter((use) => Object.values(ALLOWED_USES).includes(use));
    if (allowed.some((use) => FINAL_AGENT_USES.has(use))) {
      throw createServiceError('INVALID_ALLOWED_USE_OVERRIDE', 400, 'Final agent uses require database publish.');
    }
    updates.allowedUsesOverride = [...new Set(allowed)];
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'trustStateOverride')) {
    const state = safeString(payload.trustStateOverride).trim();
    if (state && !Object.values(TRUST_STATES).includes(state)) {
      throw createServiceError('INVALID_TRUST_STATE', 400, 'Invalid trust state override.');
    }
    if (state === TRUST_STATES.TRUSTED) {
      throw createServiceError('INVALID_TRUST_STATE', 400, 'Trusted state requires database publish.');
    }
    updates.trustStateOverride = state;
  }
  if (payload.scope && typeof payload.scope === 'object') {
    updates.scope = {
      appliesTo: normalizeStringArray(payload.scope.appliesTo, 20),
      excludes: normalizeStringArray(payload.scope.excludes, 20),
      versionNotes: compactText(payload.scope.versionNotes, 700),
      customerScope: compactText(payload.scope.customerScope, 240),
      lastValidatedAt: payload.scope.lastValidatedAt ? new Date(payload.scope.lastValidatedAt) : null,
    };
  }
  if (Array.isArray(payload.actionRecommendations)) {
    updates.actionRecommendations = payload.actionRecommendations.slice(0, 12).map((item) => ({
      action: compactText(item?.action, 220),
      priority: ACTION_PRIORITIES.has(item?.priority) ? item.priority : 'medium',
      rationale: compactText(item?.rationale, 300),
      createdAt: item?.createdAt ? new Date(item.createdAt) : new Date(),
    })).filter((item) => item.action);
  }
  return updates;
}

async function updateKnowledgeRecord(recordId, payload = {}, actorInput = {}) {
  const actor = resolveKnowledgeActor(actorInput);
  assertKnowledgePermission(actor, 'review');
  const doc = await loadCandidateForRecord(recordId);
  if (doc.reviewStatus === 'published') {
    throw createServiceError('KNOWLEDGE_PUBLISHED_LOCKED', 409, 'Deprecate trusted knowledge before changing it.');
  }

  const updates = sanitizeKnowledgePatch(payload);
  const previousStatus = doc.reviewStatus;
  doc.set(updates);
  if (updates.reviewStatus && updates.reviewStatus !== previousStatus) {
    doc.reviewedBy = actor.actor;
    doc.reviewedAt = new Date();
    appendReviewHistory(doc, actor, payload.reviewNotes || '');
  }
  appendAuditEvent(doc, {
    action: 'record.update',
    actor,
    summary: 'Knowledge record updated.',
    metadata: { fields: Object.keys(updates), previousStatus, nextStatus: doc.reviewStatus },
  });
  await doc.save();
  const knowledgeReview = await syncReviewAttention(doc);
  return { record: normalizeKnowledgeCandidate(doc), knowledgeReview };
}

async function publishKnowledgeRecord(recordId, options = {}, actorInput = {}) {
  const actor = resolveKnowledgeActor(actorInput);
  assertKnowledgePermission(actor, 'publish');
  const exportMarkdown = parseBoolean(options.exportMarkdown, false);
  const doc = await loadCandidateForRecord(recordId);

  if (doc.reviewStatus === 'published' && doc.publishedAt) {
    return { record: normalizeKnowledgeCandidate(doc), published: false, idempotent: true, export: null };
  }
  if (doc.reviewStatus !== 'approved') {
    throw createServiceError('KNOWLEDGE_REVIEW_REQUIRED', 409, 'Knowledge record must be approved before publish.');
  }
  if (doc.publishTarget === 'case-history-only') {
    throw createServiceError('KNOWLEDGE_NOT_PUBLISHABLE', 409, 'Case-history-only records are not publishable trusted guidance.');
  }

  let publish = null;
  if (exportMarkdown) {
    const escalation = await Escalation.findById(doc.escalationId).lean();
    publish = publishKnowledgeCandidate({ knowledge: doc.toObject(), escalation: escalation || {} });
    doc.publishedDocType = publish.docType;
    doc.publishedDocPath = publish.relativePath;
    doc.publishedMarker = publish.marker;
    doc.publishedSectionTitle = publish.sectionTitle;
  } else {
    doc.publishedDocType = 'database';
    doc.publishedDocPath = '';
    doc.publishedMarker = `knowledge-candidate:${doc._id}`;
    doc.publishedSectionTitle = '';
  }

  doc.reviewStatus = 'published';
  doc.publishedAt = new Date();
  doc.reviewedBy = doc.reviewedBy || actor.actor;
  doc.reviewedAt = doc.reviewedAt || new Date();
  appendAuditEvent(doc, {
    action: exportMarkdown ? 'record.publish.markdown' : 'record.publish.database',
    actor,
    summary: exportMarkdown
      ? 'Knowledge record published and exported to markdown.'
      : 'Knowledge record published in the database.',
    metadata: { exportMarkdown, publishTarget: doc.publishTarget, publish },
  });
  await doc.save();
  const knowledgeReview = await syncReviewAttention(doc);
  return { record: normalizeKnowledgeCandidate(doc), published: true, export: publish, knowledgeReview };
}

async function deprecateKnowledgeRecord(recordId, payload = {}, actorInput = {}) {
  const actor = resolveKnowledgeActor(actorInput);
  assertKnowledgePermission(actor, 'deprecate');
  const doc = await loadCandidateForRecord(recordId);
  doc.deprecatedAt = new Date();
  doc.deprecatedReason = compactText(payload.reason || payload.deprecatedReason, 700);
  if (payload.supersededBy) {
    const parsed = await assertCandidateRecordExists(payload.supersededBy, 'INVALID_SUPERSEDED_BY');
    doc.supersededBy = parsed.id || null;
  }
  appendAuditEvent(doc, {
    action: 'record.deprecate',
    actor,
    summary: doc.deprecatedReason || 'Knowledge record deprecated.',
    metadata: { supersededBy: payload.supersededBy || '' },
  });
  await doc.save();
  const knowledgeReview = await syncReviewAttention(doc);
  return { record: normalizeKnowledgeCandidate(doc), knowledgeReview };
}

async function redactKnowledgeRecord(recordId, payload = {}, actorInput = {}) {
  const actor = resolveKnowledgeActor(actorInput);
  assertKnowledgePermission(actor, 'redact');
  const doc = await loadCandidateForRecord(recordId);
  doc.redaction = {
    customerIdentifiersRedacted: payload.customerIdentifiersRedacted !== false,
    fields: normalizeStringArray(payload.fields || ['caseNumber', 'coid'], 20),
    notes: compactText(payload.notes, 500),
    redactedBy: actor.actor,
    redactedAt: new Date(),
  };
  appendAuditEvent(doc, {
    action: 'record.redact',
    actor,
    summary: 'Knowledge record source identifiers marked for redaction.',
    metadata: { fields: doc.redaction.fields },
  });
  await doc.save();
  return normalizeKnowledgeCandidate(doc);
}

async function addKnowledgeRelationship(recordId, payload = {}, actorInput = {}) {
  const actor = resolveKnowledgeActor(actorInput);
  assertKnowledgePermission(actor, 'relationship');
  const doc = await loadCandidateForRecord(recordId);
  const target = normalizeKnowledgeRecordId(payload.targetRecordId || payload.targetKnowledgeCandidateId);
  if (!target.id) {
    throw createServiceError('INVALID_RELATIONSHIP_TARGET', 400, 'Relationship target is required.');
  }
  const type = RELATIONSHIP_TYPES.has(payload.type) ? payload.type : 'related';
  const status = RELATIONSHIP_STATUSES.has(payload.status) ? payload.status : 'proposed';
  doc.relationships = Array.isArray(doc.relationships) ? doc.relationships : [];
  await assertCandidateRecordExists(target.id, 'INVALID_RELATIONSHIP_TARGET');
  doc.relationships.push({
    type,
    targetRecordId: `candidate:${target.id}`,
    targetKnowledgeCandidateId: target.id,
    strength: clampConfidence(payload.strength, 0.5),
    status,
    summary: compactText(payload.summary, 500),
    evidence: normalizeStringArray(payload.evidence, 12),
    proposedBy: actor.actor,
    reviewedBy: status === 'confirmed' || status === 'rejected' ? actor.actor : '',
    createdAt: new Date(),
    reviewedAt: status === 'confirmed' || status === 'rejected' ? new Date() : null,
  });
  appendAuditEvent(doc, {
    action: 'relationship.add',
    actor,
    summary: `Knowledge relationship added: ${type}.`,
    metadata: { type, status, targetRecordId: `candidate:${target.id}` },
  });
  await doc.save();
  return normalizeKnowledgeCandidate(doc);
}

async function recordKnowledgeFeedback(recordId, payload = {}, actorInput = {}) {
  const actor = resolveKnowledgeActor(actorInput);
  assertKnowledgePermission(actor, 'feedback');
  const doc = await loadCandidateForRecord(recordId);
  const outcome = FEEDBACK_OUTCOMES.has(payload.outcome) ? payload.outcome : 'unknown';
  doc.outcomeFeedback = Array.isArray(doc.outcomeFeedback) ? doc.outcomeFeedback : [];
  doc.outcomeFeedback.push({
    source: compactText(payload.source || 'manual', 80),
    outcome,
    notes: compactText(payload.notes, 700),
    actor: actor.actor,
    escalationId: payload.escalationId || null,
    createdAt: new Date(),
  });
  appendAuditEvent(doc, {
    action: 'feedback.add',
    actor,
    summary: `Outcome feedback recorded: ${outcome}.`,
    metadata: { outcome, source: payload.source || 'manual' },
  });
  await doc.save();
  return normalizeKnowledgeCandidate(doc);
}

function markdownForRecord(record) {
  const lines = [
    `# ${record.title || 'Knowledge Record'}`,
    '',
    `- ID: ${record.id}`,
    `- Trust state: ${record.trustState}`,
    `- Review status: ${record.reviewStatus}`,
    `- Category: ${record.category}`,
    `- Reusable outcome: ${record.reusableOutcome}`,
    `- Allowed uses: ${(record.allowedUses || []).join(', ') || 'none'}`,
    '',
    '## Summary',
    record.summary || 'No summary recorded.',
    '',
    '## Symptom',
    record.symptom || 'No symptom recorded.',
    '',
    '## Root Cause',
    record.rootCause || 'No root cause recorded.',
    '',
    '## Exact Fix',
    record.exactFix || record.escalationPath || 'No fix recorded.',
    '',
    '## Evidence',
    ...(record.evidence || []).map((item) => `- ${item.label || item.type}: ${item.evidenceStatus || item.status || 'evidence'}`),
  ];
  return `${lines.join('\n')}\n`;
}

async function exportKnowledgeRecords(options = {}, actorInput = {}) {
  const actor = resolveKnowledgeActor(actorInput);
  assertKnowledgePermission(actor, 'export');
  const format = safeString(options.format, 'json').toLowerCase() === 'markdown' ? 'markdown' : 'json';
  const includeCandidates = parseBoolean(options.includeCandidates, true);
  const limit = parseLimit(options.limit, 500, 1000);
  const result = await listKnowledgeRecords({
    ...options,
    includeCandidates,
    includeLegacy: false,
    limit,
  });
  const records = result.records || [];
  if (format === 'markdown') {
    return {
      format,
      filename: `qbo-knowledgebase-${new Date().toISOString().slice(0, 10)}.md`,
      contentType: 'text/markdown; charset=utf-8',
      content: records.map(markdownForRecord).join('\n---\n\n'),
      count: records.length,
    };
  }
  return {
    format,
    filename: `qbo-knowledgebase-${new Date().toISOString().slice(0, 10)}.json`,
    contentType: 'application/json; charset=utf-8',
    content: JSON.stringify({
      exportedAt: new Date().toISOString(),
      exportedBy: actor.actor,
      policy: {
        redactionAppliedByRecord: true,
        databaseFirstExport: true,
      },
      records,
    }, null, 2),
    count: records.length,
  };
}

async function getKnowledgeOntologySummary() {
  if (!KnowledgeCandidate.db || KnowledgeCandidate.db.readyState !== 1) {
    return {
      totalRecords: 0,
      byCategory: {},
      relationshipCounts: {},
      feedbackCounts: {},
      evidenceStrength: { average: 0, weak: 0, medium: 0, strong: 0 },
      coverageGaps: [],
    };
  }
  const docs = await KnowledgeCandidate.find({}).lean();
  const byCategory = {};
  const relationshipCounts = {};
  const feedbackCounts = {};
  let strengthSum = 0;
  let strengthCount = 0;
  let weak = 0;
  let medium = 0;
  let strong = 0;

  for (const doc of docs) {
    const category = safeString(doc.category, 'unknown') || 'unknown';
    byCategory[category] = (byCategory[category] || 0) + 1;
    for (const rel of doc.relationships || []) {
      relationshipCounts[rel.type || 'related'] = (relationshipCounts[rel.type || 'related'] || 0) + 1;
    }
    for (const feedback of doc.outcomeFeedback || []) {
      feedbackCounts[feedback.outcome || 'unknown'] = (feedbackCounts[feedback.outcome || 'unknown'] || 0) + 1;
    }
    const strengths = (doc.evidenceRefs || []).map((item) => clampConfidence(item.strength, 0.5));
    const recordStrength = strengths.length
      ? strengths.reduce((sum, value) => sum + value, 0) / strengths.length
      : (doc.reviewStatus === 'published' ? 0.75 : 0.45);
    strengthSum += recordStrength;
    strengthCount += 1;
    if (recordStrength < 0.45) weak += 1;
    else if (recordStrength < 0.75) medium += 1;
    else strong += 1;
  }

  const coverageGaps = Object.entries(byCategory)
    .filter(([, count]) => count < 2)
    .map(([category, count]) => ({
      category,
      count,
      recommendation: 'Add or review more finalized case evidence for this category.',
    }));

  return {
    totalRecords: docs.length,
    byCategory,
    relationshipCounts,
    feedbackCounts,
    evidenceStrength: {
      average: strengthCount ? Number((strengthSum / strengthCount).toFixed(2)) : 0,
      weak,
      medium,
      strong,
    },
    coverageGaps,
  };
}

module.exports = {
  KNOWLEDGE_ROLES,
  addKnowledgeRelationship,
  assertKnowledgePermission,
  deprecateKnowledgeRecord,
  exportKnowledgeRecords,
  getKnowledgeOntologySummary,
  publishKnowledgeRecord,
  redactKnowledgeRecord,
  recordKnowledgeFeedback,
  resolveKnowledgeActor,
  updateKnowledgeRecord,
  getKnowledgeRecordById,
};
