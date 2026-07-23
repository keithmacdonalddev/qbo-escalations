'use strict';

const crypto = require('node:crypto');

const EVENT_LIMIT = 500;
const PROCESS_ID = crypto.randomBytes(6).toString('hex');

let _sequence = 0;
let _events = [];
const _listeners = new Set();

function objectIdString(value) {
  if (!value) return '';
  if (typeof value.toHexString === 'function') return value.toHexString();
  if (value._id && value._id !== value) return objectIdString(value._id);
  return String(value);
}

function isoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function cleanText(value, max = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function normalizeChangedFields(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((field) => String(field || '').trim())
    .filter((field) => field && field !== 'updatedAt' && field !== '__v'))]
    .sort()
    .slice(0, 80);
}

function changedFieldsFromUpdate(update = {}) {
  const fields = [];
  for (const [key, value] of Object.entries(update || {})) {
    if (key.startsWith('$')) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      fields.push(...Object.keys(value));
      continue;
    }
    fields.push(key);
  }
  return normalizeChangedFields(fields);
}

function toRecord(value) {
  if (!value) return null;
  if (typeof value.toObject === 'function') return value.toObject();
  return value;
}

function publishCaseEvent({
  entityType,
  entityId,
  escalationId,
  action,
  changedFields = [],
  revision = null,
  summary = {},
  source = 'model',
} = {}) {
  const normalizedEscalationId = objectIdString(escalationId);
  const normalizedEntityId = objectIdString(entityId);
  if (!normalizedEscalationId || !normalizedEntityId || !entityType || !action) return null;

  _sequence += 1;
  const occurredAt = new Date().toISOString();
  const event = Object.freeze({
    eventId: `case-${PROCESS_ID}-${_sequence}`,
    seq: _sequence,
    type: `${entityType}.${action}`,
    entityType,
    entityId: normalizedEntityId,
    escalationId: normalizedEscalationId,
    action,
    changedFields: normalizeChangedFields(changedFields),
    revision: isoDate(revision),
    occurredAt,
    source: cleanText(source, 80) || 'model',
    summary: Object.freeze({
      caseNumber: cleanText(summary.caseNumber, 120),
      category: cleanText(summary.category, 80),
      status: cleanText(summary.status, 80),
      reviewStatus: cleanText(summary.reviewStatus, 80),
      title: cleanText(summary.title, 180),
    }),
  });

  _events.push(event);
  if (_events.length > EVENT_LIMIT) {
    _events = _events.slice(-EVENT_LIMIT);
  }

  for (const listener of _listeners) {
    try {
      listener(event);
    } catch {
      // One consumer must not prevent other tabs from receiving a saved change.
    }
  }

  return event;
}

function classifyEscalationAction(record, { operation = 'update', changedFields = [] } = {}) {
  if (operation === 'create') return 'created';
  if (operation === 'delete') return 'deleted';
  const fields = new Set(normalizeChangedFields(changedFields));
  if (fields.has('status') || fields.has('resolvedAt')) return 'status-changed';
  if (fields.has('conversationId')) return record?.conversationId ? 'linked' : 'unlinked';
  if (fields.has('screenshotPaths') || fields.has('screenshotHashes')) return 'evidence-changed';
  return 'updated';
}

function publishEscalationChange(value, options = {}) {
  const record = toRecord(value);
  if (!record?._id) return null;
  const changedFields = normalizeChangedFields(options.changedFields);
  return publishCaseEvent({
    entityType: 'escalation',
    entityId: record._id,
    escalationId: record._id,
    action: options.action || classifyEscalationAction(record, { ...options, changedFields }),
    changedFields,
    revision: record.updatedAt || record.createdAt,
    source: options.source || 'escalation-model',
    summary: {
      caseNumber: record.caseNumber,
      category: record.category,
      status: record.status,
    },
  });
}

function classifyKnowledgeAction(record, { operation = 'update', changedFields = [] } = {}) {
  if (operation === 'create') return 'created';
  if (operation === 'delete') return 'deleted';
  const normalizedFields = normalizeChangedFields(changedFields);
  const fields = new Set(normalizedFields);
  if (record?.reviewStatus === 'published' && (fields.has('reviewStatus') || fields.has('publishedAt'))) {
    return 'published';
  }
  if (record?.reviewStatus === 'approved' && fields.has('reviewStatus')) return 'approved';
  if (record?.reviewStatus === 'rejected' && fields.has('reviewStatus')) return 'rejected';
  if (record?.reviewStatus === 'draft' && fields.has('publishedAt')) return 'unpublished';
  if (fields.has('generatedAt') || normalizedFields.some((field) => field === 'generation' || field.startsWith('generation.'))) {
    return 'generated';
  }
  return 'updated';
}

function publishKnowledgeChange(value, options = {}) {
  const record = toRecord(value);
  if (!record?._id || !record.escalationId) return null;
  const changedFields = normalizeChangedFields(options.changedFields);
  return publishCaseEvent({
    entityType: 'knowledge',
    entityId: record._id,
    escalationId: record.escalationId,
    action: options.action || classifyKnowledgeAction(record, { ...options, changedFields }),
    changedFields,
    revision: record.updatedAt || record.createdAt,
    source: options.source || 'knowledge-model',
    summary: {
      category: record.category,
      reviewStatus: record.reviewStatus,
      title: record.title,
    },
  });
}

function publishKnowledgeFailure({ escalationId, entityId, title = '', source = 'knowledge-background' } = {}) {
  const normalizedEscalationId = objectIdString(escalationId);
  return publishCaseEvent({
    entityType: 'knowledge',
    entityId: objectIdString(entityId) || normalizedEscalationId,
    escalationId: normalizedEscalationId,
    action: 'failed',
    source,
    summary: { title },
  });
}

function subscribeCaseEvents(listener) {
  if (typeof listener !== 'function') return () => {};
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

function getCaseEventWindow(since = 0, { escalationId = '', throughSeq = _sequence } = {}) {
  const cursor = Number.isFinite(Number(since)) ? Math.max(0, Number(since)) : 0;
  const ceiling = Number.isFinite(Number(throughSeq)) ? Math.max(0, Number(throughSeq)) : _sequence;
  const oldestSeq = _events.length > 0 ? _events[0].seq : _sequence + 1;
  const replayAvailable = cursor <= _sequence && (_events.length === 0 || cursor >= oldestSeq - 1);
  const normalizedEscalationId = objectIdString(escalationId);
  const events = replayAvailable
    ? _events.filter((event) => (
      event.seq > cursor
      && event.seq <= ceiling
      && (!normalizedEscalationId || event.escalationId === normalizedEscalationId)
    ))
    : [];

  return {
    events,
    replayAvailable,
    requestedSeq: cursor,
    currentSeq: _sequence,
    throughSeq: ceiling,
    oldestSeq,
  };
}

function getCaseRealtimeStatus() {
  return {
    currentSeq: _sequence,
    oldestSeq: _events.length > 0 ? _events[0].seq : _sequence + 1,
    retainedEventCount: _events.length,
    eventLimit: EVENT_LIMIT,
    listenerCount: _listeners.size,
  };
}

function resetCaseRealtimeEvents() {
  _sequence = 0;
  _events = [];
  _listeners.clear();
}

module.exports = {
  EVENT_LIMIT,
  changedFieldsFromUpdate,
  getCaseEventWindow,
  getCaseRealtimeStatus,
  publishCaseEvent,
  publishEscalationChange,
  publishKnowledgeChange,
  publishKnowledgeFailure,
  resetCaseRealtimeEvents,
  subscribeCaseEvents,
};
