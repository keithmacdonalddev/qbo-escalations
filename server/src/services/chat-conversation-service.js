'use strict';

const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Escalation = require('../models/Escalation');
const AiTrace = require('../models/AiTrace');
const ImageParseResult = require('../models/ImageParseResult');
const TriageResult = require('../models/TriageResult');
const {
  normalizeProvider,
  getProviderLabel,
} = require('./providers/registry');
const { sumCaseIntakeEvents } = require('./event-stats-service');
const {
  applyTriageResultToCaseIntake,
  stampCaseIntakeEvidence,
} = require('../lib/case-intake');
const {
  evaluateEvidenceCompleteness,
  evaluateEvidenceStatusFromConversation,
} = require('../lib/evidence-completeness');

const PHASE_BY_STAGE = {
  parser: 'parse-template',
  inv: 'known-issue-search',
  triage: 'triage',
  main: 'analyst',
};

function createServiceError(code, message, status = 500) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function normalizeConversationListTitle(title, lastPreview) {
  const normalizedTitle = safeString(title, '').trim();
  if (normalizedTitle) return normalizedTitle;

  const normalizedPreview = safeString(lastPreview, '').trim();
  if (normalizedPreview) return normalizedPreview;

  return 'Untitled conversation';
}

function escapeRegexLiteral(value) {
  return safeString(value, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listConversations({ limit, skip, search, includeTotal }) {
  if (mongoose.connection.readyState !== 1) {
    throw createServiceError('DB_UNAVAILABLE', 'Database is not available', 503);
  }

  const escapedSearch = escapeRegexLiteral(search);
  const filter = escapedSearch
    ? {
        $or: [
          { title: { $regex: escapedSearch, $options: 'i' } },
          { 'messages.0.content': { $regex: escapedSearch, $options: 'i' } },
        ],
      }
    : {};

  try {
    // caseIntake.runs is a Mixed subdocument so Mongo can't project nested
    // paths individually. Pull the whole array — sumCaseIntakeEvents only
    // touches each run's eventCount/events.length, which is cheap.
    const listFields = 'title provider escalationId createdAt updatedAt messageCount lastMessagePreview forkedFrom forkMessageIndex caseIntake.status caseIntake.runs caseIntake.evidence';
    const conversationsPromise = Conversation.find(filter)
      .select(listFields)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .maxTimeMS(8000);
    const totalPromise = includeTotal
      ? Conversation.countDocuments(filter).maxTimeMS(5000)
      : Promise.resolve(undefined);
    const [conversations, total] = await Promise.all([
      conversationsPromise,
      totalPromise,
    ]);
    const escalationIds = [...new Set(
      conversations
        .map((conversation) => conversation.escalationId)
        .filter(Boolean)
        .map((id) => id.toString())
    )];
    const escalationDocs = escalationIds.length > 0
      ? await Escalation.find({ _id: { $in: escalationIds } })
        .select('caseNumber coid agentName clientContact category status')
        .lean()
        .maxTimeMS(5000)
      : [];
    const escalationById = new Map(escalationDocs.map((escalation) => [escalation._id.toString(), escalation]));

    const evidenceCheckedAt = new Date();
    const items = conversations.map((conversation) => ({
      _id: conversation._id,
      title: normalizeConversationListTitle(conversation.title, conversation.lastMessagePreview?.preview),
      provider: normalizeProvider(conversation.provider),
      messageCount: conversation.messageCount || 0,
      lastMessage: conversation.lastMessagePreview || null,
      escalationId: conversation.escalationId,
      escalation: conversation.escalationId
        ? escalationById.get(conversation.escalationId.toString()) || null
        : null,
      forkedFrom: conversation.forkedFrom || null,
      forkMessageIndex: conversation.forkMessageIndex != null ? conversation.forkMessageIndex : null,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      totalEventCount: sumCaseIntakeEvents(conversation.caseIntake),
      evidenceStatus: evaluateEvidenceStatusFromConversation(conversation, evidenceCheckedAt),
    }));

    return includeTotal
      ? { conversations: items, total }
      : { conversations: items };
  } catch (err) {
    const isTimeout = err.codeName === 'MaxTimeMSExpired' || err.code === 50;
    throw createServiceError(
      isTimeout ? 'QUERY_TIMEOUT' : 'LIST_FAILED',
      isTimeout ? 'Query timed out' : 'Failed to list conversations',
      isTimeout ? 504 : 500
    );
  }
}

async function getConversationMeta(id) {
  const conversation = await Conversation.findById(id)
    .select('provider escalationId forkedFrom forkMessageIndex')
    .lean();
  if (!conversation) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }
  return conversation;
}

async function getConversation(id) {
  const conversation = await Conversation.findById(id).lean();
  if (!conversation) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }
  return conversation;
}

async function getConversationEvidence(id, { now = new Date() } = {}) {
  const conversation = await Conversation.findById(id).lean();
  if (!conversation) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }

  const parserReceipt = conversation.caseIntake?.evidence?.receipts?.parser || {};
  const triageReceipt = conversation.caseIntake?.evidence?.receipts?.triage || {};
  const analystReceipt = conversation.caseIntake?.evidence?.receipts?.analyst || {};
  const parseResultId = safeString(parserReceipt.resultId, '').trim();
  const triageResultId = safeString(triageReceipt.savedResultId, '').trim();
  const standaloneRunId = safeString(triageReceipt.standaloneRunId, '').trim();

  // Phase 1 verifies the referenced parser row here; signed client receipts
  // (full client-authenticity) are intentionally out of scope for this phase.
  const imageParsePromise = parseResultId && mongoose.isValidObjectId(parseResultId)
    ? ImageParseResult.findById(parseResultId).lean().catch(() => null)
    : Promise.resolve(null);

  const triageFilters = [];
  if (triageResultId && mongoose.isValidObjectId(triageResultId)) {
    triageFilters.push({ _id: triageResultId });
  }
  if (standaloneRunId) {
    triageFilters.push({ runId: standaloneRunId });
  }
  const triageResultPromise = triageFilters.length > 0
    ? TriageResult.findOne(triageFilters.length === 1 ? triageFilters[0] : { $or: triageFilters })
      .lean()
      .catch(() => null)
    : Promise.resolve(null);

  const traceFilters = [];
  const analystTraceId = safeString(analystReceipt.traceId, '').trim();
  const analystRequestId = safeString(analystReceipt.requestId, '').trim();
  if (analystTraceId && mongoose.isValidObjectId(analystTraceId)) {
    traceFilters.push({ _id: analystTraceId });
  }
  if (analystRequestId) traceFilters.push({ requestId: analystRequestId });
  const tracesPromise = traceFilters.length > 0
    ? AiTrace.find({
        conversationId: conversation._id,
        $or: traceFilters,
      })
      .sort({ createdAt: -1 })
      .lean()
      .catch(() => [])
    : Promise.resolve([]);

  const [imageParseResult, triageResult, traces] = await Promise.all([
    imageParsePromise,
    triageResultPromise,
    tracesPromise,
  ]);

  return evaluateEvidenceCompleteness({
    conversation,
    triageResult,
    imageParseResult,
    traces,
    now,
  });
}

async function acknowledgeConversationEvidence(id, { acknowledged, acknowledgedNote } = {}) {
  if (acknowledged !== true) {
    throw createServiceError('ACKNOWLEDGEMENT_REQUIRED', 'acknowledged must be true', 400);
  }
  if (acknowledgedNote !== undefined && typeof acknowledgedNote !== 'string') {
    throw createServiceError('INVALID_ACKNOWLEDGEMENT_NOTE', 'acknowledgedNote must be a string', 400);
  }

  const acknowledgedAt = new Date();
  const note = typeof acknowledgedNote === 'string'
    ? acknowledgedNote.trim().slice(0, 1000)
    : '';
  const currentEvidence = await getConversationEvidence(id);
  const fingerprint = currentEvidence.acknowledgementFingerprint;
  const conversation = await Conversation.findByIdAndUpdate(
    id,
    {
      $set: {
        'caseIntake.evidence.acknowledgedAt': acknowledgedAt,
        'caseIntake.evidence.acknowledgedNote': note,
        'caseIntake.evidence.acknowledgedFingerprint': fingerprint,
      },
    },
    { returnDocument: 'after' }
  ).lean();
  if (!conversation) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }

  return {
    acknowledgedAt: conversation.caseIntake?.evidence?.acknowledgedAt || acknowledgedAt,
    acknowledgedNote: conversation.caseIntake?.evidence?.acknowledgedNote || '',
    fingerprint: conversation.caseIntake?.evidence?.acknowledgedFingerprint || fingerprint,
  };
}

async function listConversationStageEvents({ stage = 'parser', limit = 50 } = {}) {
  if (mongoose.connection.readyState !== 1) {
    throw createServiceError('DB_UNAVAILABLE', 'Database is not available', 503);
  }

  const phase = PHASE_BY_STAGE[stage];
  if (!phase) {
    throw createServiceError('INVALID_STAGE', 'Unsupported conversation event stage', 400);
  }

  const safeLimit = Number.isFinite(Number(limit))
    ? Math.min(Math.max(Number(limit), 1), 200)
    : 50;

  const conversations = await Conversation.find({
    caseIntake: { $exists: true },
    'caseIntake.runs': {
      $elemMatch: {
        phase,
        'events.0': { $exists: true },
      },
    },
  })
    .select('title provider createdAt updatedAt messageCount lastMessagePreview caseIntake.runs')
    .sort({ updatedAt: -1 })
    .limit(safeLimit)
    .lean()
    .maxTimeMS(8000);

  const sessions = [];
  const events = [];

  for (const conversation of conversations) {
    const runs = Array.isArray(conversation.caseIntake?.runs)
      ? conversation.caseIntake.runs
      : [];
    const run = runs.find((candidate) => candidate && candidate.phase === phase);
    const runEvents = Array.isArray(run?.events) ? run.events : [];
    if (!runEvents.length) continue;

    const conversationId = conversation._id?.toString();
    sessions.push({
      _id: conversation._id,
      title: normalizeConversationListTitle(conversation.title, conversation.lastMessagePreview?.preview),
      provider: normalizeProvider(conversation.provider),
      messageCount: conversation.messageCount || 0,
      lastMessage: conversation.lastMessagePreview || null,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      totalEventCount: runEvents.length,
      runStatus: run.status || '',
      runStartedAt: run.startedAt || null,
      runFinishedAt: run.finishedAt || null,
    });

    runEvents.forEach((event, index) => {
      events.push({
        key: `${conversationId || 'conversation'}-${event.seq ?? index}-${event.kind || 'event'}`,
        conversationId,
        conversationTitle: normalizeConversationListTitle(conversation.title, conversation.lastMessagePreview?.preview),
        runStatus: run.status || '',
        runStartedAt: run.startedAt || null,
        runFinishedAt: run.finishedAt || null,
        seq: event.seq ?? index,
        ts: event.ts || run.finishedAt || run.startedAt || conversation.updatedAt,
        kind: event.kind || 'parser event',
        category: event.category || '',
        stageId: event.stageId || stage,
        data: event.data || {},
      });
    });
  }

  events.sort((a, b) => {
    const bTime = Number(new Date(b.ts).getTime()) || Number(b.ts) || 0;
    const aTime = Number(new Date(a.ts).getTime()) || Number(a.ts) || 0;
    if (bTime !== aTime) return bTime - aTime;
    return Number(b.seq || 0) - Number(a.seq || 0);
  });

  return {
    stage,
    phase,
    sessions,
    events,
  };
}

async function updateConversation(id, { title, escalationId }) {
  const update = {};
  if (typeof title === 'string') update.title = title.slice(0, 200);
  if (escalationId !== undefined) update.escalationId = escalationId || null;

  if (Object.keys(update).length === 0) {
    throw createServiceError('NO_FIELDS', 'No fields to update', 400);
  }

  const conversation = await Conversation.findByIdAndUpdate(
    id,
    { $set: update },
    { returnDocument: 'after' }
  ).lean();

  if (!conversation) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }
  return conversation;
}

// Persist a standalone Triage Agent result onto a conversation's caseIntake.
// Called by the client AFTER both the /api/triage and /api/chat legs settle —
// the chat route saves the conversation before emitting its `done` event, so
// this deferred write cannot be clobbered by the pipeline's own save. Only
// real pipeline runs hit this path; the operator test harness never has a
// conversationId. Capped events array; rejects when nothing to record.
async function recordConversationTriageResult(id, input = {}) {
  const {
  triageCard,
  triageMeta,
  error,
  events,
  durationMs,
  startedAt,
  completedAt,
  traceId,
  } = input;
  const savedResultIdProvided = Object.prototype.hasOwnProperty.call(input, 'savedResultId');
  const savedResultId = safeString(input.savedResultId, '').trim().slice(0, 160);
  const standaloneRunId = safeString(input.standaloneRunId, '').trim().slice(0, 160);
  const repairPackageId = safeString(input.repairPackageId, '').trim().slice(0, 160);
  const hasCard = triageCard && typeof triageCard === 'object';
  const hasMeta = triageMeta && typeof triageMeta === 'object';
  const hasError = error && typeof error === 'object';
  if (!hasCard && !hasMeta && !hasError) {
    throw createServiceError('TRIAGE_RESULT_EMPTY', 'triageCard, triageMeta, or error is required', 400);
  }

  const conversation = await Conversation.findById(id);
  if (!conversation) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }

  conversation.caseIntake = applyTriageResultToCaseIntake(conversation.caseIntake, {
    triageCard: hasCard ? triageCard : null,
    triageMeta: hasMeta ? triageMeta : null,
    error: hasError ? error : null,
    events: Array.isArray(events) ? events.slice(0, 200) : [],
    durationMs,
    startedAt,
    completedAt,
    traceId: safeString(traceId, ''),
    savedResultId,
    standaloneRunId,
    repairPackageId,
  });
  const triageRun = conversation.caseIntake?.runs?.find((run) => run?.phase === 'triage');
  const failed = triageRun?.status === 'failed';
  conversation.caseIntake = stampCaseIntakeEvidence(conversation.caseIntake, {
    triage: {
      planned: true,
      attempted: true,
      completed: !failed,
      failed,
      cardSaved: Boolean(hasCard),
      resultSaveOk: savedResultIdProvided ? Boolean(savedResultId) : undefined,
      saveFailureReported: savedResultIdProvided && !savedResultId,
      savedResultId,
      standaloneRunId,
      providerPackageId: safeString(triageMeta?.providerPackageId, '').slice(0, 160),
      repairPackageId,
      completedAt: completedAt || new Date(),
      reportedVia: 'server',
    },
  }, { updatedAt: completedAt || new Date() });
  conversation.markModified('caseIntake');
  await conversation.save();

  return conversation.caseIntake;
}

async function exportConversation(id) {
  const conversation = await Conversation.findById(id).lean();
  if (!conversation) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }

  const lines = [
    `Conversation: ${safeString(conversation.title, 'Conversation')}`,
    `Date: ${new Date(conversation.createdAt).toLocaleString()}`,
    `Messages: ${conversation.messages.length}`,
  ];

  if (conversation.escalationId) {
    const escalation = await Escalation.findById(conversation.escalationId).lean();
    if (escalation) {
      lines.push('');
      lines.push('=== LINKED ESCALATION ===');
      if (escalation.coid) lines.push(`COID: ${escalation.coid}`);
      if (escalation.mid) lines.push(`MID: ${escalation.mid}`);
      if (escalation.caseNumber) lines.push(`Case #: ${escalation.caseNumber}`);
      if (escalation.clientContact) lines.push(`Client: ${escalation.clientContact}`);
      if (escalation.agentName) lines.push(`Agent: ${escalation.agentName}`);
      lines.push(`Category: ${escalation.category}`);
      lines.push(`Status: ${escalation.status}`);
      if (escalation.attemptingTo) lines.push(`Attempting: ${escalation.attemptingTo}`);
      if (escalation.actualOutcome) lines.push(`Actual Outcome: ${escalation.actualOutcome}`);
      if (escalation.resolution) lines.push(`Resolution: ${escalation.resolution}`);
      if (escalation.resolvedAt) lines.push(`Resolved: ${new Date(escalation.resolvedAt).toLocaleString()}`);
      lines.push('========================');
    }
  }

  lines.push('---', '');

  for (const message of conversation.messages) {
    let label = 'System';
    if (message.role === 'user') {
      label = 'Agent';
    } else if (message.role === 'assistant') {
      label = getProviderLabel(message.provider || conversation.provider);
      if (message.fallbackFrom) {
        label += ` (fallback from ${getProviderLabel(message.fallbackFrom)})`;
      }
    }
    const time = message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : '';
    lines.push(`[${label}] ${time}`);
    lines.push(safeString(message.content, ''));
    if (message.role === 'assistant' && typeof message.thinking === 'string' && message.thinking.trim()) {
      lines.push('');
      lines.push('[Reasoning]');
      lines.push(message.thinking);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function forkConversation(id, fromMessageIndex) {
  const source = await Conversation.findById(id);
  if (!source) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }

  let sliceEnd = source.messages.length;
  if (fromMessageIndex !== undefined) {
    const index = Number(fromMessageIndex);
    if (!Number.isInteger(index) || index < 0 || index >= source.messages.length) {
      throw createServiceError('INVALID_INDEX', 'fromMessageIndex must be a valid message index', 400);
    }
    sliceEnd = index + 1;
  }

  const messages = source.messages.slice(0, sliceEnd).map((message) => ({
    role: message.role,
    content: message.content,
    thinking: message.thinking || '',
    images: message.images || [],
    provider: message.provider,
    mode: message.mode,
    fallbackFrom: message.fallbackFrom,
    attemptMeta: message.attemptMeta || null,
    usage: message.usage || null,
    timestamp: message.timestamp || new Date(),
  }));

  const forked = new Conversation({
    title: ((source.title || 'Conversation') + ' (fork)').slice(0, 200),
    messages,
    provider: normalizeProvider(source.provider),
    escalationId: source.escalationId || null,
    systemPromptHash: source.systemPromptHash || '',
    caseIntake: source.caseIntake ? JSON.parse(JSON.stringify(source.caseIntake)) : undefined,
    forkedFrom: source._id,
    forkMessageIndex: sliceEnd - 1,
  });
  await forked.save();
  return forked.toObject();
}

async function getForkTree(id) {
  const conversation = await Conversation.findById(id).lean();
  if (!conversation) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }

  let rootId = conversation._id;
  let current = conversation;
  const visited = new Set([rootId.toString()]);
  while (current.forkedFrom) {
    const parentId = current.forkedFrom;
    if (visited.has(parentId.toString())) break;
    visited.add(parentId.toString());
    const parent = await Conversation.findById(parentId)
      .select('_id title forkedFrom forkMessageIndex messageCount createdAt')
      .lean();
    if (!parent) break;
    rootId = parent._id;
    current = parent;
  }

  const allForks = await Conversation.find({ forkedFrom: { $ne: null } })
    .select('_id title forkedFrom forkMessageIndex messageCount createdAt')
    .lean();

  const root = await Conversation.findById(rootId)
    .select('_id title messageCount createdAt')
    .lean();

  if (!root) {
    throw createServiceError('NOT_FOUND', 'Root conversation not found', 404);
  }

  const buildTree = (parentId) => {
    const children = allForks.filter((fork) => fork.forkedFrom?.toString() === parentId.toString());
    return children.map((child) => ({
      _id: child._id,
      title: child.title,
      messageCount: child.messageCount,
      forkMessageIndex: child.forkMessageIndex,
      createdAt: child.createdAt,
      children: buildTree(child._id),
    }));
  };

  return {
    _id: root._id,
    title: root.title,
    messageCount: root.messageCount,
    createdAt: root.createdAt,
    children: buildTree(root._id),
  };
}

async function deleteConversation(id) {
  const conversation = await Conversation.findById(id);
  if (!conversation) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }

  if (conversation.escalationId) {
    await Escalation.findByIdAndUpdate(conversation.escalationId, { $set: { conversationId: null } });
  }

  const result = await Conversation.findByIdAndDelete(id);
  if (!result) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }
}

module.exports = {
  acknowledgeConversationEvidence,
  deleteConversation,
  exportConversation,
  forkConversation,
  getConversation,
  getConversationEvidence,
  getConversationMeta,
  getForkTree,
  listConversationStageEvents,
  listConversations,
  recordConversationTriageResult,
  updateConversation,
};
