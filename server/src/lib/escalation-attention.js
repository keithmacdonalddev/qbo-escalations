const EscalationAttentionItem = require('../models/EscalationAttentionItem');

const RESOLUTION_DISCIPLINE_STATUSES = new Set(['resolved', 'escalated-further']);

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

module.exports = {
  buildMissingResolutionAttentionItem,
  hasResolutionExplanation,
  syncResolutionDisciplineAttentionItem,
};
