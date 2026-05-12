const EscalationAttentionItem = require('../models/EscalationAttentionItem');

const RESOLUTION_DISCIPLINE_STATUSES = new Set(['resolved', 'escalated-further']);
const STALE_OPEN_DAYS = 14;
const STALE_IN_PROGRESS_DAYS = 7;

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function compactText(value, maxChars = 240) {
  const compact = safeString(value, '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (!Number.isFinite(maxChars) || maxChars <= 0 || compact.length <= maxChars) return compact;
  return compact.slice(0, Math.max(0, maxChars - 3)).trimEnd() + '...';
}

function objectIdString(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  try {
    if (value._id && value._id !== value) return objectIdString(value._id);
    return value.toString();
  } catch {
    return '';
  }
}

function firstNonEmpty(values, fallback = '') {
  if (!Array.isArray(values)) return fallback;
  for (const value of values) {
    const text = compactText(value, 500);
    if (text) return text;
  }
  return fallback;
}

function hasResolutionExplanation(escalation) {
  return Boolean(firstNonEmpty([
    escalation && escalation.resolution,
    escalation && escalation.resolutionNotes,
  ]));
}

function getEscalationLabel(escalation) {
  const caseNumber = compactText(escalation && escalation.caseNumber, 80);
  if (caseNumber) return `case ${caseNumber}`;
  const coid = compactText(escalation && escalation.coid, 80);
  if (coid) return `COID ${coid}`;
  const category = compactText(escalation && escalation.category, 80);
  if (category) return `${category} escalation`;
  return 'This escalation';
}

function missingResolutionFingerprint(escalation) {
  const id = objectIdString(escalation && escalation._id);
  return id ? `missing-resolution:${id}` : '';
}

function staleOpenFingerprint(escalation) {
  const id = objectIdString(escalation && escalation._id);
  return id ? `stale-open:${id}` : '';
}

function knowledgeReviewFingerprint(knowledge, escalation) {
  const id = objectIdString(
    knowledge && knowledge.escalationId
      ? knowledge.escalationId
      : escalation && escalation._id
  );
  return id ? `knowledge-review:${id}` : '';
}

function buildMissingResolutionAttentionItem(escalation) {
  const status = safeString(escalation && escalation.status, '').trim();
  const fingerprint = missingResolutionFingerprint(escalation);
  if (!fingerprint || !RESOLUTION_DISCIPLINE_STATUSES.has(status) || hasResolutionExplanation(escalation)) {
    return null;
  }

  const isEscalatedFurther = status === 'escalated-further';
  const label = getEscalationLabel(escalation);
  return {
    kind: 'missing-resolution',
    severity: 'warning',
    fingerprint,
    title: isEscalatedFurther ? 'Missing escalation reason' : 'Missing resolution notes',
    summary: isEscalatedFurther
      ? `${label} was escalated further without a reason or next escalation path.`
      : `${label} was marked resolved without a resolution summary or reason.`,
    signals: [isEscalatedFurther ? 'missing_escalation_reason' : 'missing_resolution_notes'],
  };
}

function getEscalationUpdatedAt(escalation) {
  const updated = escalation && (escalation.updatedAt || escalation.createdAt);
  const date = updated ? new Date(updated) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function daysSince(date, now = new Date()) {
  if (!date) return 0;
  const elapsedMs = now.getTime() - date.getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  return Math.floor(elapsedMs / 86_400_000);
}

function getStaleThresholdDays(status) {
  if (status === 'in-progress') return STALE_IN_PROGRESS_DAYS;
  if (status === 'open') return STALE_OPEN_DAYS;
  return null;
}

function isEscalationStale(escalation, now = new Date()) {
  const status = safeString(escalation && escalation.status, '').trim();
  const thresholdDays = getStaleThresholdDays(status);
  if (!thresholdDays) return false;
  const updatedAt = getEscalationUpdatedAt(escalation);
  return Boolean(updatedAt && daysSince(updatedAt, now) >= thresholdDays);
}

function buildStaleOpenAttentionItem(escalation, now = new Date()) {
  const fingerprint = staleOpenFingerprint(escalation);
  if (!fingerprint || !isEscalationStale(escalation, now)) return null;

  const status = safeString(escalation && escalation.status, '').trim();
  const thresholdDays = getStaleThresholdDays(status);
  const updatedAt = getEscalationUpdatedAt(escalation);
  const staleDays = daysSince(updatedAt, now);
  const label = getEscalationLabel(escalation);
  return {
    kind: 'stale-open',
    severity: staleDays >= thresholdDays * 2 ? 'critical' : 'warning',
    fingerprint,
    title: status === 'in-progress' ? 'In-progress case is stale' : 'Open case is stale',
    summary: `${label} has been ${status} for ${staleDays} days without a workflow update.`,
    signals: [
      'stale_case',
      `status_${status.replace(/[^a-z0-9]+/gi, '_')}`,
      `stale_${staleDays}_days`,
    ],
    metadata: {
      status,
      staleDays,
      thresholdDays,
      lastWorkflowUpdateAt: updatedAt,
    },
  };
}

function getMissingKnowledgeFields(knowledge) {
  const missing = [];
  if (!compactText(knowledge && knowledge.summary)) missing.push('summary');
  if (!compactText(knowledge && knowledge.symptom)) missing.push('symptom');
  if (
    !compactText(knowledge && knowledge.exactFix)
    && !compactText(knowledge && knowledge.escalationPath)
  ) {
    missing.push('fix_or_escalation_path');
  }
  return missing;
}

function buildKnowledgeReviewAttentionItem(knowledge, escalation) {
  const fingerprint = knowledgeReviewFingerprint(knowledge, escalation);
  if (!fingerprint) return null;

  const reviewStatus = safeString(knowledge && knowledge.reviewStatus, 'draft').trim() || 'draft';
  if (reviewStatus === 'approved' || reviewStatus === 'published') return null;
  if (reviewStatus === 'rejected' && compactText(knowledge && knowledge.reviewNotes)) return null;
  if (reviewStatus !== 'draft' && reviewStatus !== 'rejected') return null;

  const label = getEscalationLabel(escalation || (knowledge && knowledge.sourceSnapshot) || {});
  if (reviewStatus === 'rejected') {
    return {
      kind: 'knowledge-review',
      severity: 'warning',
      fingerprint,
      title: 'Rejected knowledge needs notes',
      summary: `${label} has a rejected knowledge draft without reviewer notes explaining why it should not be reused.`,
      signals: ['knowledge_rejected_without_notes'],
      metadata: {
        reviewStatus,
        missingFields: ['reviewNotes'],
      },
    };
  }

  const missingFields = getMissingKnowledgeFields(knowledge);
  return {
    kind: 'knowledge-review',
    severity: missingFields.length ? 'warning' : 'info',
    fingerprint,
    title: 'Knowledge draft needs review',
    summary: missingFields.length
      ? `${label} has a knowledge draft waiting for review; missing ${missingFields.join(', ')}.`
      : `${label} has a knowledge draft waiting for human review before reuse.`,
    signals: [
      'knowledge_draft_review',
      ...missingFields.map((field) => `missing_${field}`),
    ],
    metadata: {
      reviewStatus,
      missingFields,
    },
  };
}

function attentionItemSummary(item) {
  if (!item) return null;
  const doc = typeof item.toObject === 'function' ? item.toObject() : item;
  return {
    id: objectIdString(doc._id),
    status: doc.status || '',
    kind: doc.kind || '',
    severity: doc.severity || '',
    fingerprint: doc.fingerprint || '',
  };
}

async function syncResolutionDisciplineAttentionItem(escalation) {
  const fingerprint = missingResolutionFingerprint(escalation);
  if (!fingerprint) return { action: 'skipped', item: null };

  const payload = buildMissingResolutionAttentionItem(escalation);
  if (!payload) {
    const item = await EscalationAttentionItem.findOneAndUpdate(
      { fingerprint, kind: 'missing-resolution', status: { $ne: 'resolved' } },
      {
        $set: {
          status: 'resolved',
          resolutionNote: hasResolutionExplanation(escalation)
            ? 'Resolution explanation added.'
            : 'Status no longer requires resolution explanation.',
          resolvedAt: new Date(),
        },
      },
      { returnDocument: 'after', runValidators: true }
    );
    return { action: item ? 'closed' : 'none', item: attentionItemSummary(item) };
  }

  const item = await EscalationAttentionItem.findOneAndUpdate(
    { fingerprint },
    {
      $setOnInsert: {
        kind: payload.kind,
        sourceEscalationId: escalation._id,
        fingerprint,
      },
      $set: {
        status: 'open',
        resolvedAt: null,
        sourceConversationId: escalation.conversationId || null,
        severity: payload.severity,
        title: payload.title,
        summary: payload.summary,
        candidates: [],
        signals: payload.signals,
        candidateCount: 0,
        lastDetectedAt: new Date(),
      },
      $inc: { occurrenceCount: 1 },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  return { action: 'opened', item: attentionItemSummary(item) };
}

async function openStaleEscalationAttentionItem(escalation, now = new Date()) {
  const payload = buildStaleOpenAttentionItem(escalation, now);
  if (!payload) return null;

  const existing = await EscalationAttentionItem.findOne({ fingerprint: payload.fingerprint }).lean();
  if (existing && existing.status !== 'open') {
    return null;
  }

  return EscalationAttentionItem.findOneAndUpdate(
    { fingerprint: payload.fingerprint },
    {
      $setOnInsert: {
        kind: payload.kind,
        sourceEscalationId: escalation._id,
        sourceType: 'escalation',
        fingerprint: payload.fingerprint,
        occurrenceCount: 1,
      },
      $set: {
        status: 'open',
        resolvedAt: null,
        sourceConversationId: escalation.conversationId || null,
        sourceLabel: getEscalationLabel(escalation),
        severity: payload.severity,
        title: payload.title,
        summary: payload.summary,
        candidates: [],
        signals: payload.signals,
        candidateCount: 0,
        metadata: payload.metadata,
        lastDetectedAt: now,
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
}

async function closeResolvedStaleEscalationAttentionItems(now = new Date()) {
  const openItems = await EscalationAttentionItem.find({ kind: 'stale-open', status: 'open' })
    .populate('sourceEscalationId')
    .limit(200);

  let closed = 0;
  for (const item of openItems) {
    if (isEscalationStale(item.sourceEscalationId, now)) continue;
    item.status = 'resolved';
    item.resolutionNote = 'Escalation is no longer stale or no longer open.';
    item.resolvedAt = now;
    await item.save();
    closed += 1;
  }
  return closed;
}

async function syncStaleEscalationAttentionItems({ now = new Date(), limit = 100 } = {}) {
  const Escalation = require('../models/Escalation');
  const openCutoff = new Date(now.getTime() - STALE_OPEN_DAYS * 86_400_000);
  const inProgressCutoff = new Date(now.getTime() - STALE_IN_PROGRESS_DAYS * 86_400_000);
  const staleEscalations = await Escalation.find({
    $or: [
      { status: 'open', updatedAt: { $lte: openCutoff } },
      { status: 'in-progress', updatedAt: { $lte: inProgressCutoff } },
    ],
  })
    .sort({ updatedAt: 1 })
    .limit(Math.max(1, Math.min(Number(limit) || 100, 500)));

  let opened = 0;
  for (const escalation of staleEscalations) {
    const item = await openStaleEscalationAttentionItem(escalation, now);
    if (item) opened += 1;
  }

  const closed = await closeResolvedStaleEscalationAttentionItems(now);
  return { opened, closed, scanned: staleEscalations.length };
}

async function syncKnowledgeReviewAttentionItem(knowledge, escalation) {
  const fingerprint = knowledgeReviewFingerprint(knowledge, escalation);
  if (!fingerprint) return { action: 'skipped', item: null };

  const payload = buildKnowledgeReviewAttentionItem(knowledge, escalation);
  if (!payload) {
    const item = await EscalationAttentionItem.findOneAndUpdate(
      { fingerprint, kind: 'knowledge-review', status: { $ne: 'resolved' } },
      {
        $set: {
          status: 'resolved',
          resolutionNote: 'Knowledge review state no longer requires attention.',
          resolvedAt: new Date(),
        },
      },
      { returnDocument: 'after', runValidators: true }
    );
    return { action: item ? 'closed' : 'none', item: attentionItemSummary(item) };
  }

  const knowledgeId = objectIdString(knowledge && knowledge._id);
  const item = await EscalationAttentionItem.findOneAndUpdate(
    { fingerprint },
    {
      $setOnInsert: {
        kind: payload.kind,
        sourceEscalationId: escalation && escalation._id ? escalation._id : knowledge && knowledge.escalationId,
        sourceType: 'escalation',
        fingerprint,
      },
      $set: {
        status: 'open',
        resolvedAt: null,
        sourceConversationId: (
          (knowledge && knowledge.conversationId)
          || (escalation && escalation.conversationId)
          || null
        ),
        sourceLabel: getEscalationLabel(escalation || (knowledge && knowledge.sourceSnapshot) || {}),
        severity: payload.severity,
        title: payload.title,
        summary: payload.summary,
        candidates: [],
        signals: payload.signals,
        candidateCount: 0,
        metadata: {
          knowledgeId,
          publishTarget: knowledge && knowledge.publishTarget,
          reusableOutcome: knowledge && knowledge.reusableOutcome,
          ...payload.metadata,
        },
        lastDetectedAt: new Date(),
      },
      $inc: { occurrenceCount: 1 },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  return { action: 'opened', item: attentionItemSummary(item) };
}

module.exports = {
  buildMissingResolutionAttentionItem,
  buildKnowledgeReviewAttentionItem,
  buildStaleOpenAttentionItem,
  hasResolutionExplanation,
  syncStaleEscalationAttentionItems,
  syncKnowledgeReviewAttentionItem,
  syncResolutionDisciplineAttentionItem,
};
