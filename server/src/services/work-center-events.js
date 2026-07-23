'use strict';

const crypto = require('node:crypto');

const EVENT_LIMIT = 500;
const WORK_ITEM_LIMIT = 80;
const RECENT_RETENTION_MS = 30 * 60 * 1000;
const PROCESS_ID = crypto.randomBytes(6).toString('hex');

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const _listeners = new Set();
const _workItems = new Map();
let _events = [];
let _sequence = 0;

function cleanText(value, max = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function cleanId(value) {
  if (!value) return '';
  if (typeof value.toHexString === 'function') return value.toHexString();
  if (value._id && value._id !== value) return cleanId(value._id);
  return cleanText(value, 120);
}

function isoDate(value, fallback = null) {
  const date = value ? new Date(value) : (fallback ? new Date(fallback) : null);
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeChangedFields(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((field) => cleanText(field, 100))
    .filter((field) => field && field !== 'updatedAt' && field !== '__v'))]
    .sort()
    .slice(0, 60);
}

function changedFieldsFromUpdate(update = {}) {
  const fields = [];
  for (const [key, value] of Object.entries(update || {})) {
    if (key.startsWith('$')) {
      if (value && typeof value === 'object' && !Array.isArray(value)) fields.push(...Object.keys(value));
    } else {
      fields.push(key);
    }
  }
  return normalizeChangedFields(fields);
}

function isTerminal(item) {
  return TERMINAL_STATUSES.has(item?.status);
}

function pruneWorkItems(now = Date.now()) {
  for (const [id, item] of _workItems.entries()) {
    const updatedAtMs = Date.parse(item.updatedAt || item.startedAt || '');
    if (isTerminal(item) && (!Number.isFinite(updatedAtMs) || now - updatedAtMs > RECENT_RETENTION_MS)) {
      _workItems.delete(id);
    }
  }

  if (_workItems.size <= WORK_ITEM_LIMIT) return;
  const ordered = [..._workItems.values()].sort((left, right) => {
    if (isTerminal(left) !== isTerminal(right)) return isTerminal(left) ? -1 : 1;
    return Date.parse(left.updatedAt || '') - Date.parse(right.updatedAt || '');
  });
  while (_workItems.size > WORK_ITEM_LIMIT && ordered.length > 0) {
    _workItems.delete(ordered.shift().id);
  }
}

function nextEvent(type, payload = {}) {
  _sequence += 1;
  const occurredAt = new Date().toISOString();
  const event = Object.freeze({
    eventId: `work-${PROCESS_ID}-${_sequence}`,
    seq: _sequence,
    type,
    occurredAt,
    ...payload,
  });
  _events.push(event);
  if (_events.length > EVENT_LIMIT) _events = _events.slice(-EVENT_LIMIT);

  for (const listener of _listeners) {
    try {
      listener(event);
    } catch {
      // One subscriber must not block the remaining live-work subscribers.
    }
  }
  return event;
}

function normalizeWorkItem(value = {}) {
  const id = cleanId(value.id);
  if (!id) return null;
  const now = new Date().toISOString();
  const startedAt = isoDate(value.startedAt, now) || now;
  const updatedAt = isoDate(value.updatedAt, now) || now;
  const status = TERMINAL_STATUSES.has(value.status) || value.status === 'running'
    ? value.status
    : 'running';

  return Object.freeze({
    id,
    source: cleanText(value.source, 40) || 'runtime',
    kind: cleanText(value.kind, 40) || 'work',
    title: cleanText(value.title, 140) || 'Work in progress',
    owner: cleanText(value.owner, 100),
    status,
    phase: cleanText(value.phase, 60),
    phaseLabel: cleanText(value.phaseLabel, 120),
    summary: cleanText(value.summary, 220),
    provider: cleanText(value.provider, 60),
    model: cleanText(value.model, 100),
    route: cleanText(value.route, 160),
    conversationId: cleanId(value.conversationId) || null,
    escalationId: cleanId(value.escalationId) || null,
    hasFallback: Boolean(value.hasFallback),
    startedAt,
    updatedAt,
    completedAt: isTerminal({ status }) ? (isoDate(value.completedAt, updatedAt) || updatedAt) : null,
  });
}

function publishWorkItem(value, { reason = 'updated' } = {}) {
  const item = normalizeWorkItem(value);
  if (!item) return null;
  pruneWorkItems();
  _workItems.set(item.id, item);
  pruneWorkItems();
  return nextEvent('work.changed', {
    reason: cleanText(reason, 60) || 'updated',
    workItem: item,
  });
}

function removeWorkItem(id, { preserveTerminal = true, reason = 'removed' } = {}) {
  const normalizedId = cleanId(id);
  const current = _workItems.get(normalizedId);
  if (!current || (preserveTerminal && isTerminal(current))) return null;
  _workItems.delete(normalizedId);
  return nextEvent('work.removed', {
    reason: cleanText(reason, 60) || 'removed',
    workItemId: normalizedId,
  });
}

const AI_PRESENTATION = Object.freeze({
  chat: { title: 'Preparing an assistant response', owner: 'QBO Assistant' },
  parse: { title: 'Reading case evidence', owner: 'Image Parser' },
  copilot: { title: 'Running Co-pilot', owner: 'Global Co-pilot' },
  gmail: { title: 'Preparing email help', owner: 'Email Assistant' },
});

const AI_PHASES = Object.freeze({
  starting: 'Starting',
  thinking: 'Reviewing the available evidence',
  streaming: 'Drafting the result',
  provider_error: 'Switching to a recovery path',
  fallback: 'Continuing with a backup provider',
  saving: 'Saving the result',
  aborting: 'Stopping',
  completed: 'Ready to review',
  error: 'Needs review',
});

function publishAiOperation(operation, { reason = 'updated' } = {}) {
  if (!operation?.id) return null;
  const presentation = AI_PRESENTATION[operation.kind] || AI_PRESENTATION.chat;
  const phase = cleanText(operation.phase, 60) || 'starting';
  const status = phase === 'completed'
    ? 'completed'
    : phase === 'error'
      ? 'failed'
      : 'running';
  const isRetry = operation.action === 'chat-retry';
  const title = isRetry ? 'Retrying an assistant response' : presentation.title;
  const provider = cleanText(operation.provider, 60);
  return publishWorkItem({
    id: `ai:${operation.id}`,
    source: 'ai-runtime',
    kind: operation.kind || 'chat',
    title,
    owner: presentation.owner,
    status,
    phase,
    phaseLabel: AI_PHASES[phase] || 'Working',
    summary: status === 'failed'
      ? 'The run stopped before a result was ready.'
      : status === 'completed'
        ? 'The result is ready to open and review.'
        : `${AI_PHASES[phase] || 'Working'}${provider ? ` with ${provider}` : ''}.`,
    provider,
    route: operation.route,
    conversationId: operation.conversationId,
    hasFallback: Number(operation.stats?.fallbacks || 0) > 0 || phase === 'fallback',
    startedAt: operation.startedAt,
    updatedAt: operation.updatedAt,
    completedAt: status === 'completed' || status === 'failed' ? operation.updatedAt : null,
  }, { reason });
}

function publishAgentSession(session, { reason = 'updated' } = {}) {
  if (!session?.id) return null;
  const rawStatus = cleanText(session.status, 40) || 'starting';
  const status = rawStatus === 'done'
    ? 'completed'
    : rawStatus === 'error'
      ? 'failed'
      : rawStatus === 'aborted'
        ? 'cancelled'
        : 'running';
  const metadata = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
  const provider = cleanText(metadata.currentProvider || metadata.provider, 60);
  const phase = cleanText(metadata.phase || rawStatus, 60);
  const title = cleanText(session.title, 140) || 'Workspace Agent';
  const hasFallback = Boolean(metadata.fallbackAt || metadata.fallbackTo || metadata.fallbackFrom);
  const phaseLabel = status === 'completed'
    ? 'Ready to review'
    : status === 'failed'
      ? 'Needs review'
      : status === 'cancelled'
        ? 'Stopped'
        : hasFallback
          ? 'Continuing with a backup provider'
          : phase === 'starting'
            ? 'Starting'
            : 'Working';

  return publishWorkItem({
    id: `agent:${session.id}`,
    source: 'agent-session',
    kind: session.agentType || 'agent',
    title,
    owner: title,
    status,
    phase,
    phaseLabel,
    summary: status === 'failed'
      ? 'The agent stopped before completing the request.'
      : status === 'completed'
        ? 'The agent result is ready to open and review.'
        : `${phaseLabel}${provider ? ` with ${provider}` : ''}.`,
    provider,
    model: metadata.currentModel || metadata.primaryModel,
    route: metadata.view ? `#/workspace/${encodeURIComponent(cleanText(metadata.view, 80))}` : '#/workspace',
    hasFallback,
    startedAt: session.createdAt,
    updatedAt: session.updatedAt,
    completedAt: isTerminal({ status }) ? session.updatedAt : null,
  }, { reason });
}

function toRecord(value) {
  if (!value) return null;
  return typeof value.toObject === 'function' ? value.toObject() : value;
}

function publishAttentionChange(value, { changedFields = [], action = 'updated', source = 'attention-model' } = {}) {
  const record = toRecord(value);
  const attentionItemId = cleanId(record?._id || value?.attentionItemId || value?.id);
  return nextEvent('attention.changed', {
    action: cleanText(action, 60) || 'updated',
    source: cleanText(source, 80) || 'attention-model',
    attentionItemId: attentionItemId || null,
    attention: record ? Object.freeze({
      id: attentionItemId || null,
      kind: cleanText(record.kind, 60),
      status: cleanText(record.status, 40),
      severity: cleanText(record.severity, 40),
      title: cleanText(record.title, 180),
      sourceEscalationId: cleanId(record.sourceEscalationId) || null,
      sourceConversationId: cleanId(record.sourceConversationId) || null,
      updatedAt: isoDate(record.updatedAt || record.lastDetectedAt || Date.now()),
    }) : null,
    changedFields: normalizeChangedFields(changedFields),
  });
}

function publishAttentionBulkChange(ids, { status = '', source = 'attention-route' } = {}) {
  const attentionItemIds = [...new Set((Array.isArray(ids) ? ids : []).map(cleanId).filter(Boolean))].slice(0, 200);
  return nextEvent('attention.changed', {
    action: 'bulk-updated',
    source: cleanText(source, 80) || 'attention-route',
    attentionItemId: null,
    attentionItemIds,
    attention: status ? Object.freeze({ status: cleanText(status, 40) }) : null,
    changedFields: ['resolutionNote', 'resolvedAt', 'status'],
  });
}

function getWorkItems() {
  pruneWorkItems();
  return [..._workItems.values()].sort((left, right) => {
    if (isTerminal(left) !== isTerminal(right)) return isTerminal(left) ? 1 : -1;
    return Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || '');
  });
}

function subscribeWorkCenterEvents(listener) {
  if (typeof listener !== 'function') return () => {};
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

function getWorkCenterEventWindow(since = 0, { throughSeq = _sequence } = {}) {
  const cursor = Number.isFinite(Number(since)) ? Math.max(0, Number(since)) : 0;
  const ceiling = Number.isFinite(Number(throughSeq)) ? Math.max(0, Number(throughSeq)) : _sequence;
  const oldestSeq = _events.length > 0 ? _events[0].seq : _sequence + 1;
  const replayAvailable = cursor <= _sequence && (_events.length === 0 || cursor >= oldestSeq - 1);
  return {
    events: replayAvailable ? _events.filter((event) => event.seq > cursor && event.seq <= ceiling) : [],
    replayAvailable,
    requestedSeq: cursor,
    currentSeq: _sequence,
    throughSeq: ceiling,
    oldestSeq,
  };
}

function getWorkCenterStatus() {
  const workItems = getWorkItems();
  return {
    currentSeq: _sequence,
    oldestSeq: _events.length > 0 ? _events[0].seq : _sequence + 1,
    retainedEventCount: _events.length,
    eventLimit: EVENT_LIMIT,
    workItemLimit: WORK_ITEM_LIMIT,
    activeWorkCount: workItems.filter((item) => !isTerminal(item)).length,
    recentWorkCount: workItems.filter(isTerminal).length,
    listenerCount: _listeners.size,
  };
}

function resetWorkCenterEvents() {
  _sequence = 0;
  _events = [];
  _workItems.clear();
  _listeners.clear();
}

module.exports = {
  EVENT_LIMIT,
  WORK_ITEM_LIMIT,
  changedFieldsFromUpdate,
  getWorkCenterEventWindow,
  getWorkCenterStatus,
  getWorkItems,
  publishAgentSession,
  publishAiOperation,
  publishAttentionBulkChange,
  publishAttentionChange,
  publishWorkItem,
  removeWorkItem,
  resetWorkCenterEvents,
  subscribeWorkCenterEvents,
};
