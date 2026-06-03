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

function sameObjectId(left, right) {
  const leftId = objectIdString(left);
  const rightId = objectIdString(right);
  return Boolean(leftId && rightId && leftId === rightId);
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

function getConversationLabel(conversation) {
  const title = compactText(conversation && conversation.title, 80);
  if (title) return `conversation ${title}`;
  return 'This conversation';
}

function missingResolutionFingerprint(escalation) {
  const id = objectIdString(escalation && escalation._id);
  return id ? `missing-resolution:${id}` : '';
}

function staleOpenFingerprint(escalation) {
  const id = objectIdString(escalation && escalation._id);
  return id ? `stale-open:${id}` : '';
}

function parseReviewFingerprint(escalation) {
  const id = objectIdString(escalation && escalation._id);
  return id ? `parse-review:${id}` : '';
}

function missingEscalationLinkFingerprint(escalation) {
  const id = objectIdString(escalation && escalation._id);
  return id ? `missing-link:escalation:${id}` : '';
}

function missingConversationLinkFingerprint(conversation) {
  const id = objectIdString(conversation && conversation._id);
  return id ? `missing-link:conversation:${id}` : '';
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

function normalizeIssueList(value, maxItems = 12) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const issue of value) {
    const text = compactText(issue, 120);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getParseReviewSignals(escalation) {
  const parseMeta = escalation && escalation.parseMeta && typeof escalation.parseMeta === 'object'
    ? escalation.parseMeta
    : {};
  const signals = [];
  const issues = normalizeIssueList(parseMeta.validationIssues);
  if (issues.length) signals.push(...issues);
  if (parseMeta.usedRegexFallback) signals.push('regex_fallback_used');
  if (parseMeta.fallbackUsed) signals.push('provider_fallback_used');
  if (safeString(parseMeta.validationConfidence, '').trim() === 'low') signals.push('low_parse_confidence');
  const validationScore = finiteNumberOrNull(parseMeta.validationScore);
  if (validationScore !== null && validationScore < 0.55) {
    signals.push('low_parse_score');
  }
  const attempts = Array.isArray(parseMeta.attempts) ? parseMeta.attempts : [];
  if (attempts.some((attempt) => safeString(attempt && attempt.status, '').trim() === 'error')) {
    signals.push('parse_attempt_failed');
  }
  return normalizeIssueList(signals, 16);
}

function buildParseReviewAttentionItem(escalation) {
  const fingerprint = parseReviewFingerprint(escalation);
  if (!fingerprint) return null;

  const signals = getParseReviewSignals(escalation);
  if (!signals.length) return null;

  const parseMeta = escalation && escalation.parseMeta && typeof escalation.parseMeta === 'object'
    ? escalation.parseMeta
    : {};
  const label = getEscalationLabel(escalation);
  const criticalSignals = new Set([
    'missing_attemptingTo',
    'missing_actualOutcome',
    'regex_fallback_used',
    'low_parse_confidence',
    'low_parse_score',
  ]);
  const severity = signals.some((signal) => criticalSignals.has(signal)) ? 'critical' : 'warning';
  return {
    kind: 'parse-review',
    severity,
    fingerprint,
    title: 'Parser output needs review',
    summary: `${label} was created with parser or triage uncertainty: ${signals.slice(0, 4).join(', ')}.`,
    signals,
    metadata: {
      providerUsed: safeString(parseMeta.providerUsed, ''),
      fallbackUsed: Boolean(parseMeta.fallbackUsed),
      usedRegexFallback: Boolean(parseMeta.usedRegexFallback),
      validationScore: finiteNumberOrNull(parseMeta.validationScore),
      validationConfidence: safeString(parseMeta.validationConfidence, ''),
    },
  };
}

function buildEscalationMissingLinkAttentionItem(escalation, conversation = null) {
  const fingerprint = missingEscalationLinkFingerprint(escalation);
  if (!fingerprint || !escalation || !escalation.conversationId) return null;

  const expectedConversationId = objectIdString(escalation.conversationId);
  const actualBacklinkId = objectIdString(conversation && conversation.escalationId);
  if (conversation && sameObjectId(actualBacklinkId, escalation._id)) return null;

  const missingConversation = !conversation;
  return {
    kind: 'missing-link',
    severity: missingConversation ? 'critical' : 'warning',
    fingerprint,
    title: missingConversation ? 'Linked conversation is missing' : 'Escalation link mismatch',
    summary: missingConversation
      ? `${getEscalationLabel(escalation)} points to a conversation that no longer exists.`
      : `${getEscalationLabel(escalation)} points to conversation ${expectedConversationId}, but that conversation points to ${actualBacklinkId || 'no escalation'}.`,
    signals: [missingConversation ? 'missing_conversation' : 'conversation_backlink_mismatch'],
    metadata: {
      expectedConversationId,
      actualEscalationId: actualBacklinkId,
    },
  };
}

function buildConversationMissingLinkAttentionItem(conversation, escalation = null) {
  const fingerprint = missingConversationLinkFingerprint(conversation);
  if (!fingerprint || !conversation || !conversation.escalationId) return null;

  const expectedEscalationId = objectIdString(conversation.escalationId);
  const actualConversationId = objectIdString(escalation && escalation.conversationId);
  if (escalation && sameObjectId(actualConversationId, conversation._id)) return null;

  const missingEscalation = !escalation;
  return {
    kind: 'missing-link',
    severity: missingEscalation ? 'critical' : 'warning',
    fingerprint,
    title: missingEscalation ? 'Linked escalation is missing' : 'Conversation link mismatch',
    summary: missingEscalation
      ? `${getConversationLabel(conversation)} points to an escalation that no longer exists.`
      : `${getConversationLabel(conversation)} points to escalation ${expectedEscalationId}, but that escalation points to ${actualConversationId || 'no conversation'}.`,
    signals: [missingEscalation ? 'missing_escalation' : 'escalation_backlink_mismatch'],
    metadata: {
      expectedEscalationId,
      actualConversationId,
    },
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
  if (!compactText(knowledge && knowledge.rootCause)) missing.push('root_cause');
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
  const confidence = Number(knowledge && knowledge.confidence);
  const lowConfidence = Number.isFinite(confidence) && confidence > 0 && confidence < 0.55;
  const snapshot = (knowledge && knowledge.sourceSnapshot) || {};
  const hasSourceEvidence = Boolean(firstNonEmpty([
    snapshot.resolution,
    snapshot.resolutionNotes,
    snapshot.resolvedAt,
    snapshot.caseNumber,
    snapshot.attemptingTo,
    snapshot.actualOutcome,
  ]));
  const qualitySignals = [
    ...missingFields.map((field) => `missing_${field}`),
    ...(lowConfidence ? ['low_confidence'] : []),
    ...(!hasSourceEvidence ? ['weak_source_evidence'] : []),
  ];
  return {
    kind: 'knowledge-review',
    severity: qualitySignals.length ? 'warning' : 'info',
    fingerprint,
    title: 'Knowledge draft needs review',
    summary: qualitySignals.length
      ? `${label} has a knowledge draft waiting for review; flagged ${qualitySignals.join(', ')}.`
      : `${label} has a knowledge draft waiting for human review before reuse.`,
    signals: [
      'knowledge_draft_review',
      ...qualitySignals,
    ],
    metadata: {
      reviewStatus,
      missingFields,
      confidence: Number.isFinite(confidence) ? confidence : null,
      lowConfidence,
      weakSourceEvidence: !hasSourceEvidence,
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

async function openParseReviewAttentionItem(escalation) {
  const payload = buildParseReviewAttentionItem(escalation);
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
        lastDetectedAt: new Date(),
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
}

async function closeResolvedParseReviewAttentionItems() {
  const openItems = await EscalationAttentionItem.find({ kind: 'parse-review', status: 'open' })
    .populate('sourceEscalationId')
    .limit(200);

  let closed = 0;
  for (const item of openItems) {
    if (buildParseReviewAttentionItem(item.sourceEscalationId)) continue;
    item.status = 'resolved';
    item.resolutionNote = 'Parser metadata no longer requires review.';
    item.resolvedAt = new Date();
    await item.save();
    closed += 1;
  }
  return closed;
}

async function syncParserTriageAttentionItems({ limit = 100 } = {}) {
  const Escalation = require('../models/Escalation');
  const flaggedEscalations = await Escalation.find({
    $or: [
      { 'parseMeta.usedRegexFallback': true },
      { 'parseMeta.fallbackUsed': true },
      { 'parseMeta.validationConfidence': 'low' },
      {
        $and: [
          { 'parseMeta.validationScore': { $type: 'number' } },
          { 'parseMeta.validationScore': { $lt: 0.55 } },
        ],
      },
      { 'parseMeta.validationIssues.0': { $exists: true } },
      { 'parseMeta.attempts.status': 'error' },
    ],
  })
    .sort({ updatedAt: -1 })
    .limit(Math.max(1, Math.min(Number(limit) || 100, 500)));

  let opened = 0;
  for (const escalation of flaggedEscalations) {
    const item = await openParseReviewAttentionItem(escalation);
    if (item) opened += 1;
  }

  const closed = await closeResolvedParseReviewAttentionItems();
  return { opened, closed, scanned: flaggedEscalations.length };
}

async function openMissingLinkAttentionItem(payload, { escalation = null, conversation = null } = {}) {
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
        fingerprint: payload.fingerprint,
        occurrenceCount: 1,
      },
      $set: {
        status: 'open',
        resolvedAt: null,
        sourceType: escalation ? 'escalation' : 'conversation',
        sourceEscalationId: escalation && escalation._id ? escalation._id : null,
        sourceConversationId: (
          (conversation && conversation._id)
          || (escalation && escalation.conversationId)
          || null
        ),
        sourceLabel: escalation ? getEscalationLabel(escalation) : getConversationLabel(conversation),
        severity: payload.severity,
        title: payload.title,
        summary: payload.summary,
        candidates: [],
        signals: payload.signals,
        candidateCount: 0,
        metadata: payload.metadata,
        lastDetectedAt: new Date(),
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
}

async function closeResolvedMissingLinkAttentionItems() {
  const Escalation = require('../models/Escalation');
  const Conversation = require('../models/Conversation');
  const openItems = await EscalationAttentionItem.find({ kind: 'missing-link', status: 'open' })
    .populate('sourceEscalationId')
    .populate('sourceConversationId')
    .limit(200);

  let closed = 0;
  for (const item of openItems) {
    const fingerprint = safeString(item.fingerprint, '');
    let stillBroken = null;
    if (fingerprint.startsWith('missing-link:escalation:')) {
      if (item.sourceEscalationId) {
        const currentConversation = item.sourceEscalationId.conversationId
          ? await Conversation.findById(item.sourceEscalationId.conversationId)
          : null;
        stillBroken = buildEscalationMissingLinkAttentionItem(item.sourceEscalationId, currentConversation);
      }
    } else if (fingerprint.startsWith('missing-link:conversation:')) {
      if (item.sourceConversationId) {
        const currentEscalation = item.sourceConversationId.escalationId
          ? await Escalation.findById(item.sourceConversationId.escalationId)
          : null;
        stillBroken = buildConversationMissingLinkAttentionItem(item.sourceConversationId, currentEscalation);
      }
    }
    if (stillBroken) continue;
    item.status = 'resolved';
    item.resolutionNote = 'Escalation and conversation links are no longer broken.';
    item.resolvedAt = new Date();
    await item.save();
    closed += 1;
  }
  return closed;
}

async function syncMissingLinkAttentionItems({ limit = 100 } = {}) {
  const Escalation = require('../models/Escalation');
  const Conversation = require('../models/Conversation');
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const linkedEscalations = await Escalation.find({ conversationId: { $ne: null } })
    .sort({ updatedAt: -1 })
    .limit(cappedLimit);
  const linkedConversations = await Conversation.find({ escalationId: { $ne: null } })
    .sort({ updatedAt: -1 })
    .limit(cappedLimit);

  let opened = 0;
  for (const escalation of linkedEscalations) {
    const conversation = await Conversation.findById(escalation.conversationId);
    const payload = buildEscalationMissingLinkAttentionItem(escalation, conversation);
    const item = await openMissingLinkAttentionItem(payload, { escalation, conversation });
    if (item) opened += 1;
  }

  for (const conversation of linkedConversations) {
    const escalation = await Escalation.findById(conversation.escalationId);
    const payload = buildConversationMissingLinkAttentionItem(conversation, escalation);
    const item = await openMissingLinkAttentionItem(payload, { escalation: null, conversation });
    if (item) opened += 1;
  }

  const closed = await closeResolvedMissingLinkAttentionItems();
  return {
    opened,
    closed,
    scannedEscalations: linkedEscalations.length,
    scannedConversations: linkedConversations.length,
  };
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
  buildParseReviewAttentionItem,
  buildStaleOpenAttentionItem,
  hasResolutionExplanation,
  syncMissingLinkAttentionItems,
  syncParserTriageAttentionItems,
  syncStaleEscalationAttentionItems,
  syncKnowledgeReviewAttentionItem,
  syncResolutionDisciplineAttentionItem,
};
