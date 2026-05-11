'use strict';

const Escalation = require('../models/Escalation');
const Conversation = require('../models/Conversation');
const EscalationAttentionItem = require('../models/EscalationAttentionItem');

const DUPLICATE_WARNING_THRESHOLD = 50;
const DUPLICATE_LOOKBACK_DAYS = 30;
const DUPLICATE_QUERY_LIMIT = 50;
const DUPLICATE_RESPONSE_LIMIT = 5;

const STOP_WORDS = new Set([
  'about',
  'account',
  'after',
  'again',
  'also',
  'cannot',
  'cleared',
  'customer',
  'expected',
  'failed',
  'fails',
  'from',
  'have',
  'into',
  'issue',
  'image',
  'needs',
  'online',
  'outcome',
  'quickbooks',
  'review',
  'screen',
  'screenshot',
  'should',
  'shown',
  'that',
  'their',
  'there',
  'this',
  'tried',
  'with',
  'would',
]);

function isValidObjectId(value) {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
}

function objectIdString(value) {
  if (!value) return '';
  if (typeof value.toHexString === 'function') return value.toHexString();
  if (value._id && value._id !== value) return objectIdString(value._id);
  return String(value);
}

function sameObjectId(a, b) {
  const left = objectIdString(a);
  const right = objectIdString(b);
  return Boolean(left && right && left === right);
}

function escapeRegex(value) {
  return safeString(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeString(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return String(value);
  } catch {
    return '';
  }
}

function compactText(value, maxChars = 160) {
  const compact = safeString(value).replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (!Number.isFinite(maxChars) || maxChars <= 0 || compact.length <= maxChars) return compact;
  return compact.slice(0, Math.max(0, maxChars - 3)).trimEnd() + '...';
}

function normalizeComparable(value) {
  return compactText(value, 500).toLowerCase();
}

function normalizeIdentifier(value) {
  return compactText(value, 120).toLowerCase();
}

function normalizeHashes(value) {
  const raw = Array.isArray(value) ? value : [value];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const hash = normalizeIdentifier(item);
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    out.push(hash);
  }
  return out;
}

function objectIdOrNull(value) {
  const id = objectIdString(value);
  return isValidObjectId(id) ? id : null;
}

function symptomText(fields = {}) {
  return [
    fields.attemptingTo,
    fields.expectedOutcome,
    fields.actualOutcome,
    fields.tsSteps,
  ].map((value) => safeString(value)).join(' ');
}

function tokenizeSymptoms(value) {
  const tokens = normalizeComparable(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
  return new Set(tokens.slice(0, 80));
}

function tokenOverlap(left, right) {
  if (!left.size || !right.size) return 0;
  let matches = 0;
  for (const token of left) {
    if (right.has(token)) matches++;
  }
  return matches / Math.min(left.size, right.size);
}

function addSignal(signals, signal) {
  if (!signals.includes(signal)) signals.push(signal);
}

function duplicateConfidence(score) {
  if (score >= 75) return 'high';
  if (score >= 65) return 'medium';
  return 'low';
}

function fieldsFromEscalation(escalation) {
  return {
    coid: escalation && escalation.coid,
    caseNumber: escalation && escalation.caseNumber,
    category: escalation && escalation.category,
    attemptingTo: escalation && escalation.attemptingTo,
    expectedOutcome: escalation && escalation.expectedOutcome,
    actualOutcome: escalation && escalation.actualOutcome,
    tsSteps: escalation && escalation.tsSteps,
    screenshotHashes: escalation && escalation.screenshotHashes,
  };
}

function scoreDuplicateCandidate(candidate, incomingFields, now = new Date()) {
  const incoming = incomingFields || {};
  const signals = [];
  let score = 0;

  const incomingCaseNumber = normalizeIdentifier(incoming.caseNumber);
  const candidateCaseNumber = normalizeIdentifier(candidate.caseNumber);
  if (incomingCaseNumber && candidateCaseNumber && incomingCaseNumber === candidateCaseNumber) {
    score += 75;
    addSignal(signals, 'same_case_number');
  }

  const incomingCoid = normalizeIdentifier(incoming.coid);
  const candidateCoid = normalizeIdentifier(candidate.coid);
  if (incomingCoid && candidateCoid && incomingCoid === candidateCoid) {
    score += 30;
    addSignal(signals, 'same_coid');
  }

  const incomingHashes = normalizeHashes(incoming.screenshotHashes);
  const candidateHashes = normalizeHashes(candidate.screenshotHashes);
  if (incomingHashes.length > 0 && candidateHashes.some((hash) => incomingHashes.includes(hash))) {
    score += 90;
    addSignal(signals, 'same_screenshot_hash');
  }

  const incomingCategory = normalizeIdentifier(incoming.category);
  const candidateCategory = normalizeIdentifier(candidate.category);
  if (incomingCategory && incomingCategory !== 'unknown' && incomingCategory === candidateCategory) {
    score += 10;
    addSignal(signals, 'same_category');
  }

  const incomingTokens = tokenizeSymptoms(symptomText(incoming));
  const candidateTokens = tokenizeSymptoms(symptomText(candidate));
  const overlap = tokenOverlap(incomingTokens, candidateTokens);
  if (overlap >= 0.5) {
    score += 35;
    addSignal(signals, 'strong_symptom_overlap');
  } else if (overlap >= 0.3) {
    score += 24;
    addSignal(signals, 'moderate_symptom_overlap');
  } else if (overlap >= 0.16) {
    score += 12;
    addSignal(signals, 'weak_symptom_overlap');
  }

  const createdAt = candidate.createdAt ? new Date(candidate.createdAt) : null;
  if (createdAt && Number.isFinite(createdAt.getTime()) && Number.isFinite(now.getTime())) {
    const ageDays = Math.abs(now.getTime() - createdAt.getTime()) / 86_400_000;
    if (ageDays <= DUPLICATE_LOOKBACK_DAYS) {
      score += 5;
      addSignal(signals, 'recent_window');
    }
  }

  return { score, signals, confidence: duplicateConfidence(score) };
}

function buildDuplicateCandidateSummary(candidate, scoreResult) {
  return {
    escalationId: objectIdString(candidate._id),
    conversationId: objectIdString(candidate.conversationId) || null,
    score: scoreResult.score,
    confidence: scoreResult.confidence,
    signals: scoreResult.signals,
    status: candidate.status || '',
    source: candidate.source || '',
    coid: candidate.coid || '',
    caseNumber: candidate.caseNumber || '',
    category: candidate.category || '',
    attemptingToPreview: compactText(candidate.attemptingTo, 140),
    actualOutcomePreview: compactText(candidate.actualOutcome, 140),
    createdAt: candidate.createdAt || null,
  };
}

function buildDuplicateCandidateQuery(fields, {
  excludeEscalationId = null,
  excludeConversationId = null,
  lookbackDays = DUPLICATE_LOOKBACK_DAYS,
} = {}) {
  const incoming = fields || {};
  const or = [];
  const caseNumber = compactText(incoming.caseNumber, 120);
  const coid = compactText(incoming.coid, 120);
  const screenshotHashes = normalizeHashes(incoming.screenshotHashes);
  const category = compactText(incoming.category, 80);
  const since = new Date(Date.now() - Math.max(1, lookbackDays) * 86_400_000);

  if (caseNumber) or.push({ caseNumber: { $regex: `^${escapeRegex(caseNumber)}$`, $options: 'i' } });
  if (coid) or.push({ coid: { $regex: `^${escapeRegex(coid)}$`, $options: 'i' } });
  if (screenshotHashes.length > 0) or.push({ screenshotHashes: { $in: screenshotHashes } });
  if (category && category !== 'unknown') {
    or.push({ category, createdAt: { $gte: since } });
  }

  if (or.length === 0) return null;

  const query = { $or: or };
  const excludedEscalation = objectIdString(excludeEscalationId);
  if (excludedEscalation && isValidObjectId(excludedEscalation)) {
    query._id = { $ne: excludedEscalation };
  }
  const excludedConversation = objectIdString(excludeConversationId);
  if (excludedConversation && isValidObjectId(excludedConversation)) {
    query.conversationId = { $ne: excludedConversation };
  }

  return query;
}

async function findDuplicateEscalationCandidates({
  fields,
  excludeEscalationId = null,
  excludeConversationId = null,
  lookbackDays = DUPLICATE_LOOKBACK_DAYS,
  limit = DUPLICATE_RESPONSE_LIMIT,
  now = new Date(),
} = {}) {
  const query = buildDuplicateCandidateQuery(fields, {
    excludeEscalationId,
    excludeConversationId,
    lookbackDays,
  });
  if (!query) return [];

  const candidates = await Escalation.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(DUPLICATE_QUERY_LIMIT)
    .lean();

  return candidates
    .map((candidate) => {
      const scoreResult = scoreDuplicateCandidate(candidate, fields, now);
      return buildDuplicateCandidateSummary(candidate, scoreResult);
    })
    .filter((candidate) => candidate.score >= DUPLICATE_WARNING_THRESHOLD)
    .sort((a, b) => b.score - a.score || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, Math.max(1, limit));
}

async function buildDuplicateWarningsForEscalation(escalation, {
  fields = null,
  excludeEscalationId = null,
  excludeConversationId = null,
} = {}) {
  if (!escalation) return [];
  const candidates = await findDuplicateEscalationCandidates({
    fields: {
      ...fieldsFromEscalation(escalation),
      ...(fields && typeof fields === 'object' ? fields : {}),
    },
    excludeEscalationId: excludeEscalationId || escalation._id,
    excludeConversationId: excludeConversationId || escalation.conversationId,
  });

  if (candidates.length === 0) return [];

  return [{
    code: 'POSSIBLE_DUPLICATE_ESCALATION',
    severity: candidates.some((candidate) => (
      candidate.confidence === 'high'
      || candidate.signals.includes('same_case_number')
      || candidate.signals.includes('same_screenshot_hash')
    )) ? 'warning' : 'info',
    message: 'Possible duplicate escalation candidates found from another conversation or intake path.',
    candidateCount: candidates.length,
    candidates,
  }];
}

function duplicateAttentionFingerprint(escalation, warning) {
  const sourceId = objectIdString(escalation && escalation._id);
  const candidateIds = (warning && Array.isArray(warning.candidates) ? warning.candidates : [])
    .map((candidate) => objectIdString(candidate.escalationId))
    .filter(Boolean)
    .sort();
  if (!sourceId || candidateIds.length === 0) return '';
  return `possible-duplicate:${sourceId}:${candidateIds.join(',')}`;
}

function uniqueSignals(candidates) {
  const out = [];
  for (const candidate of candidates || []) {
    for (const signal of candidate.signals || []) {
      if (!out.includes(signal)) out.push(signal);
    }
  }
  return out;
}

function mapAttentionCandidate(candidate) {
  return {
    escalationId: objectIdOrNull(candidate.escalationId),
    conversationId: objectIdOrNull(candidate.conversationId),
    score: Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : 0,
    confidence: safeString(candidate.confidence),
    signals: Array.isArray(candidate.signals) ? candidate.signals.map(safeString).filter(Boolean) : [],
    status: safeString(candidate.status),
    source: safeString(candidate.source),
    coid: safeString(candidate.coid),
    caseNumber: safeString(candidate.caseNumber),
    category: safeString(candidate.category),
    attemptingToPreview: compactText(candidate.attemptingToPreview, 140),
    actualOutcomePreview: compactText(candidate.actualOutcomePreview, 140),
    createdAt: candidate.createdAt || null,
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

async function persistDuplicateAttentionItems({ escalation, warnings } = {}) {
  if (!escalation || !Array.isArray(warnings) || warnings.length === 0) return [];

  const persisted = [];
  for (const warning of warnings) {
    if (!warning || warning.code !== 'POSSIBLE_DUPLICATE_ESCALATION') continue;
    const fingerprint = duplicateAttentionFingerprint(escalation, warning);
    if (!fingerprint) continue;

    const candidates = (warning.candidates || [])
      .map(mapAttentionCandidate)
      .filter((candidate) => candidate.escalationId);
    if (candidates.length === 0) continue;

    const signals = uniqueSignals(candidates);
    const strongest = candidates[0];
    const sourceId = objectIdOrNull(escalation._id);
    const sourceConversationId = objectIdOrNull(escalation.conversationId);
    const title = 'Possible duplicate escalation';
    const summary = strongest && strongest.caseNumber
      ? `Possible duplicate of case ${strongest.caseNumber}.`
      : 'Possible duplicate escalation candidate found.';

    const item = await EscalationAttentionItem.findOneAndUpdate(
      { fingerprint },
      {
        $setOnInsert: {
          kind: 'possible-duplicate',
          status: 'open',
          sourceEscalationId: sourceId,
          sourceConversationId,
          fingerprint,
          title,
        },
        $set: {
          severity: warning.severity || 'info',
          summary,
          candidates,
          signals,
          candidateCount: candidates.length,
          lastDetectedAt: new Date(),
        },
        $inc: { occurrenceCount: 1 },
      },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );
    persisted.push(item);
  }

  return persisted;
}

function attachAttentionItemsToWarnings(warnings, attentionItems) {
  if (!Array.isArray(warnings) || warnings.length === 0) return [];
  if (!Array.isArray(attentionItems) || attentionItems.length === 0) {
    return warnings;
  }

  const byFingerprint = new Map();
  for (const item of attentionItems) {
    const summary = attentionItemSummary(item);
    if (summary && summary.fingerprint) byFingerprint.set(summary.fingerprint, summary);
  }

  return warnings.map((warning) => {
    const fingerprint = warning && warning.code === 'POSSIBLE_DUPLICATE_ESCALATION'
      ? duplicateAttentionFingerprint({ _id: warning.sourceEscalationId || null }, warning)
      : '';
    const attentionItem = byFingerprint.get(fingerprint);
    if (!attentionItem) return warning;
    return {
      ...warning,
      attentionItemIds: [attentionItem.id],
    };
  });
}

async function withDuplicateWarnings(duplicateSafety, escalation, options = {}) {
  const warnings = await buildDuplicateWarningsForEscalation(escalation, options);
  const attentionItems = await persistDuplicateAttentionItems({ escalation, warnings });
  return {
    ...duplicateSafety,
    warnings: attachAttentionItemsToWarnings(
      warnings.map((warning) => ({
        ...warning,
        sourceEscalationId: objectIdString(escalation && escalation._id),
      })),
      attentionItems
    ),
    attentionItems: attentionItems.map(attentionItemSummary).filter(Boolean),
  };
}

async function buildDuplicateSafetyForEscalation(escalation, {
  fields = null,
  reason = 'created',
} = {}) {
  return withDuplicateWarnings({
    reusedExisting: false,
    reason,
    escalationId: objectIdString(escalation && escalation._id),
    conversationId: objectIdString(escalation && escalation.conversationId) || null,
  }, escalation, { fields });
}

function makeWorkflowError(code, message, statusCode, detail = null) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  if (detail) err.detail = detail;
  return err;
}

async function loadConversation(conversationId) {
  if (!isValidObjectId(objectIdString(conversationId))) {
    throw makeWorkflowError('INVALID_CONVERSATION_ID', 'conversationId must be a valid ObjectId', 400);
  }
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    throw makeWorkflowError('CONVERSATION_NOT_FOUND', 'Conversation not found', 404);
  }
  return conversation;
}

async function reconcileConversationLink(conversation, escalation) {
  let changed = false;

  if (!sameObjectId(escalation.conversationId, conversation._id)) {
    if (escalation.conversationId) {
      throw makeWorkflowError(
        'ESCALATION_ALREADY_LINKED',
        'Escalation is already linked to another conversation',
        409,
        { escalationId: objectIdString(escalation._id), conversationId: objectIdString(escalation.conversationId) }
      );
    }
    escalation.conversationId = conversation._id;
    changed = true;
  }

  if (!sameObjectId(conversation.escalationId, escalation._id)) {
    conversation.escalationId = escalation._id;
    await conversation.save();
  }
  if (changed) await escalation.save();
}

async function findLinkedEscalation(conversation) {
  if (!conversation || !conversation._id) return null;

  if (conversation.escalationId && isValidObjectId(objectIdString(conversation.escalationId))) {
    const linked = await Escalation.findById(conversation.escalationId);
    if (linked) {
      await reconcileConversationLink(conversation, linked);
      return { escalation: linked, reason: 'conversation_already_linked' };
    }
  }

  const existing = await Escalation.findOne({ conversationId: conversation._id }).sort({ createdAt: 1, _id: 1 });
  if (existing) {
    await reconcileConversationLink(conversation, existing);
    return { escalation: existing, reason: 'escalation_already_linked' };
  }

  return null;
}

async function createLinkedEscalationFromConversation({
  conversation,
  conversationId,
  fields = {},
  source = 'chat',
  parseMeta = null,
} = {}) {
  const resolvedConversation = conversation || await loadConversation(conversationId);
  const existing = await findLinkedEscalation(resolvedConversation);
  if (existing) {
    return {
      escalation: existing.escalation,
      reusedExisting: true,
      duplicateSafety: {
        reusedExisting: true,
        reason: existing.reason,
        conversationId: objectIdString(resolvedConversation._id),
        escalationId: objectIdString(existing.escalation._id),
      },
    };
  }

  const payload = {
    ...(fields && typeof fields === 'object' ? fields : {}),
    conversationId: resolvedConversation._id,
    source,
  };
  if (parseMeta && typeof parseMeta === 'object') payload.parseMeta = parseMeta;

  const escalation = new Escalation(payload);
  await escalation.save();

  resolvedConversation.escalationId = escalation._id;
  await resolvedConversation.save();

  return {
    escalation,
    reusedExisting: false,
    duplicateSafety: await withDuplicateWarnings({
      reusedExisting: false,
      reason: 'created',
      conversationId: objectIdString(resolvedConversation._id),
      escalationId: objectIdString(escalation._id),
    }, escalation, { fields: payload }),
  };
}

async function linkEscalationToConversation({ escalationId, conversationId, force = false } = {}) {
  if (!isValidObjectId(objectIdString(escalationId))) {
    throw makeWorkflowError('INVALID_ESCALATION_ID', 'Invalid escalation id', 400);
  }

  const [escalation, conversation] = await Promise.all([
    Escalation.findById(escalationId),
    loadConversation(conversationId),
  ]);

  if (!escalation) {
    throw makeWorkflowError('NOT_FOUND', 'Escalation not found', 404);
  }

  const conversationLinkedId = objectIdString(conversation.escalationId);
  if (conversationLinkedId && conversationLinkedId !== objectIdString(escalation._id)) {
    if (!force) {
      throw makeWorkflowError(
        'CONVERSATION_ALREADY_LINKED',
        'Conversation is already linked to another escalation',
        409,
        { conversationId: objectIdString(conversation._id), escalationId: conversationLinkedId }
      );
    }
    await Escalation.findByIdAndUpdate(conversationLinkedId, { $set: { conversationId: null } });
  }

  const existingForConversation = await Escalation.findOne({
    conversationId: conversation._id,
    _id: { $ne: escalation._id },
  });
  if (existingForConversation) {
    if (!force) {
      throw makeWorkflowError(
        'CONVERSATION_ALREADY_LINKED',
        'Conversation is already linked to another escalation',
        409,
        {
          conversationId: objectIdString(conversation._id),
          escalationId: objectIdString(existingForConversation._id),
        }
      );
    }
    existingForConversation.conversationId = null;
    await existingForConversation.save();
  }

  const previousConversationId = objectIdString(escalation.conversationId);
  if (previousConversationId && previousConversationId !== objectIdString(conversation._id)) {
    if (!force) {
      throw makeWorkflowError(
        'ESCALATION_ALREADY_LINKED',
        'Escalation is already linked to another conversation',
        409,
        { escalationId: objectIdString(escalation._id), conversationId: previousConversationId }
      );
    }
    await Conversation.findByIdAndUpdate(previousConversationId, { $set: { escalationId: null } });
  }

  escalation.conversationId = conversation._id;
  conversation.escalationId = escalation._id;
  await Promise.all([escalation.save(), conversation.save()]);

  return {
    escalation,
    duplicateSafety: {
      reusedExisting: false,
      reason: previousConversationId || conversationLinkedId || existingForConversation ? 'forced_relink' : 'linked',
      conversationId: objectIdString(conversation._id),
      escalationId: objectIdString(escalation._id),
      forced: Boolean(force),
    },
  };
}

function workflowErrorResponse(err) {
  if (!err || !err.statusCode) return null;
  return {
    statusCode: err.statusCode,
    body: {
      ok: false,
      code: err.code || 'ESCALATION_WORKFLOW_ERROR',
      error: err.message || 'Escalation workflow error',
      ...(err.detail ? { detail: err.detail } : {}),
    },
  };
}

module.exports = {
  buildDuplicateSafetyForEscalation,
  buildDuplicateWarningsForEscalation,
  createLinkedEscalationFromConversation,
  findDuplicateEscalationCandidates,
  findLinkedEscalation,
  isValidObjectId,
  linkEscalationToConversation,
  persistDuplicateAttentionItems,
  scoreDuplicateCandidate,
  workflowErrorResponse,
};
