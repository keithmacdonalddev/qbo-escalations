'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const KnowledgeCandidate = require('../models/KnowledgeCandidate');
const OperationalClaim = require('../models/OperationalClaim');
const OperationalEvidence = require('../models/OperationalEvidence');
const {
  ALLOWED_USES,
  TRUST_STATES,
  buildAgentKnowledgeContext,
  deriveAllowedUses,
  deriveTrustState,
  normalizeKnowledgeRecordId,
  parseBoolean,
  parseLimit,
} = require('./knowledgebase-service');

const ALL_ALLOWED_USES = Object.freeze(Object.values(ALLOWED_USES));
const FINAL_AGENT_USES = new Set([ALLOWED_USES.AGENT_RESPONSE, ALLOWED_USES.TRIAGE]);
const ACTIVE_CLAIM_STATUSES = new Set(['candidate', 'reviewed', 'trusted']);

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function compactText(value, maxChars = 700) {
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
    const text = compactText(item, 240);
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

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function hashText(value, chars = 16) {
  return crypto.createHash('sha1').update(safeString(value, '')).digest('hex').slice(0, chars);
}

function normalizeTextKey(value) {
  return compactText(value, 1200).toLowerCase();
}

function escapeRegex(value) {
  return safeString(value, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourceRecordIdFor(candidate) {
  const id = safeString(candidate?._id || candidate?.id, '').replace(/^candidate:/, '');
  return id ? `candidate:${id}` : '';
}

function objectIdOrNull(value) {
  const id = safeString(value, '').trim();
  return mongoose.isValidObjectId(id) ? id : null;
}

function validationStatusFor(candidate, trustState) {
  const reviewStatus = safeString(candidate?.reviewStatus, 'draft');
  const reusableOutcome = safeString(candidate?.reusableOutcome, 'case-history-only');
  if (candidate?.deprecatedAt || trustState === TRUST_STATES.DEPRECATED) return 'deprecated';
  if (reviewStatus === 'rejected' || trustState === TRUST_STATES.REJECTED) return 'rejected';
  if (reusableOutcome === 'unsafe-to-reuse' || trustState === TRUST_STATES.RESTRICTED) return 'restricted';
  if (reviewStatus === 'published' && trustState === TRUST_STATES.TRUSTED) return 'trusted';
  if (reviewStatus === 'approved' || trustState === TRUST_STATES.REVIEWED) return 'reviewed';
  return 'candidate';
}

function buildPolicy(candidate) {
  const trustState = deriveTrustState(candidate);
  const allowedUses = deriveAllowedUses(candidate);
  const validationStatus = validationStatusFor(candidate, trustState);
  const allowedSet = new Set(allowedUses);
  return {
    trustState,
    allowedUses,
    notAllowedUses: ALL_ALLOWED_USES.filter((use) => !allowedSet.has(use)),
    validationStatus,
    agentSafe: validationStatus === 'trusted' && allowedUses.some((use) => FINAL_AGENT_USES.has(use)),
  };
}

function buildEvidenceSpecs(candidate) {
  const sourceRecordId = sourceRecordIdFor(candidate);
  const knowledgeCandidateId = objectIdOrNull(candidate?._id);
  const escalationId = objectIdOrNull(candidate?.escalationId);
  const conversationId = objectIdOrNull(candidate?.conversationId);
  const snapshot = candidate?.sourceSnapshot || {};
  const redacted = Boolean(candidate?.redaction?.customerIdentifiersRedacted);
  const base = {
    sourceRecordId,
    knowledgeCandidateId,
    escalationId,
    conversationId,
    redacted,
  };
  const specs = [];

  if (escalationId) {
    const caseLabel = snapshot.caseNumber
      ? `Case ${redacted ? '[redacted]' : snapshot.caseNumber}`
      : 'Source escalation';
    specs.push({
      ...base,
      evidenceKey: `${sourceRecordId}:evidence:escalation:${escalationId}`,
      sourceType: 'escalation',
      sourceId: safeString(escalationId),
      label: caseLabel,
      summary: compactText([
        snapshot.status ? `Status: ${snapshot.status}` : '',
        snapshot.category ? `Category: ${snapshot.category}` : '',
        snapshot.actualOutcome ? `Outcome: ${snapshot.actualOutcome}` : '',
      ].filter(Boolean).join(' | '), 500),
      text: compactText([
        snapshot.attemptingTo,
        snapshot.actualOutcome,
        snapshot.tsSteps,
      ].filter(Boolean).join('\n'), 1600),
      evidenceStatus: snapshot.resolvedAt ? 'finalized-case' : 'case-snapshot',
      strength: snapshot.resolvedAt ? 0.85 : 0.55,
      metadata: {
        status: safeString(snapshot.status),
        category: safeString(snapshot.category || candidate?.category),
        coid: redacted && snapshot.coid ? '[redacted]' : safeString(snapshot.coid),
        caseNumber: redacted && snapshot.caseNumber ? '[redacted]' : safeString(snapshot.caseNumber),
        resolvedAt: snapshot.resolvedAt || null,
      },
    });
  }

  if (conversationId) {
    specs.push({
      ...base,
      evidenceKey: `${sourceRecordId}:evidence:conversation:${conversationId}`,
      sourceType: 'conversation',
      sourceId: safeString(conversationId),
      label: compactText(snapshot.conversationTitle || 'Linked conversation', 180),
      summary: compactText(snapshot.conversationPreview, 700),
      text: compactText(snapshot.conversationPreview, 1600),
      evidenceStatus: 'conversation-snapshot',
      strength: snapshot.conversationPreview ? 0.65 : 0.4,
      metadata: {
        messageCount: Number(snapshot.conversationMessageCount || 0),
      },
    });
  }

  const resolutionText = compactText([
    snapshot.resolution,
    snapshot.resolutionNotes,
    candidate?.exactFix,
    candidate?.escalationPath,
  ].filter(Boolean).join('\n'), 1800);
  if (resolutionText) {
    specs.push({
      ...base,
      evidenceKey: `${sourceRecordId}:evidence:resolution:${hashText(resolutionText)}`,
      sourceType: 'resolution',
      sourceId: safeString(escalationId),
      label: 'Resolution text',
      summary: compactText(snapshot.resolution || snapshot.resolutionNotes || candidate?.exactFix, 700),
      text: resolutionText,
      evidenceStatus: 'review-source',
      strength: 0.8,
      metadata: {
        hasExactFix: Boolean(compactText(candidate?.exactFix)),
        hasEscalationPath: Boolean(compactText(candidate?.escalationPath)),
      },
    });
  }

  const refs = Array.isArray(candidate?.evidenceRefs) ? candidate.evidenceRefs : [];
  for (const ref of refs.slice(0, 20)) {
    const label = compactText(ref?.label || ref?.summary || ref?.id || ref?.type || 'Supporting evidence', 180);
    const keySource = `${ref?.type || 'note'}:${ref?.id || label}:${ref?.summary || ''}`;
    specs.push({
      ...base,
      evidenceKey: `${sourceRecordId}:evidence:ref:${hashText(keySource)}`,
      sourceType: 'knowledge-ref',
      sourceId: compactText(ref?.id, 200),
      label,
      summary: compactText(ref?.summary, 700),
      text: compactText(ref?.summary, 1200),
      url: compactText(ref?.url, 1000),
      evidenceStatus: compactText(ref?.status || 'supporting-evidence', 120),
      strength: clampConfidence(ref?.strength, 0.5),
      metadata: {
        refType: compactText(ref?.type || 'note', 80),
        createdAt: ref?.createdAt || null,
      },
    });
  }

  return specs.filter((spec) => spec.sourceRecordId && spec.evidenceKey);
}

function pushClaim(specs, candidate, claimType, text, metadata = {}) {
  const sourceRecordId = sourceRecordIdFor(candidate);
  const value = compactText(text, claimType === 'fix' ? 1600 : 900);
  if (!sourceRecordId || !value) return;
  specs.push({
    claimKey: `${sourceRecordId}:claim:${claimType}:${hashText(value)}`,
    sourceRecordId,
    knowledgeCandidateId: objectIdOrNull(candidate?._id),
    escalationId: objectIdOrNull(candidate?.escalationId),
    conversationId: objectIdOrNull(candidate?.conversationId),
    claimType,
    text: value,
    metadata,
  });
}

function buildClaimSpecs(candidate) {
  const specs = [];
  pushClaim(specs, candidate, 'summary', candidate?.summary, { field: 'summary' });
  pushClaim(specs, candidate, 'symptom', candidate?.symptom, { field: 'symptom' });
  pushClaim(specs, candidate, 'root-cause', candidate?.rootCause, { field: 'rootCause' });
  pushClaim(specs, candidate, 'fix', candidate?.exactFix, { field: 'exactFix' });
  pushClaim(specs, candidate, 'escalation-path', candidate?.escalationPath, { field: 'escalationPath' });
  const signals = normalizeStringArray(candidate?.keySignals, 8);
  signals.forEach((signal, index) => {
    pushClaim(specs, candidate, 'key-signal', signal, { field: 'keySignals', index });
  });
  return specs;
}

function normalizeEvidence(doc) {
  const source = doc?.toObject ? doc.toObject() : (doc || {});
  return {
    id: safeString(source._id),
    evidenceKey: safeString(source.evidenceKey),
    sourceRecordId: safeString(source.sourceRecordId),
    sourceType: safeString(source.sourceType),
    sourceId: safeString(source.sourceId),
    label: safeString(source.label),
    summary: compactText(source.summary, 700),
    text: compactText(source.text, 1000),
    url: safeString(source.url),
    status: safeString(source.status, 'active'),
    evidenceStatus: safeString(source.evidenceStatus),
    strength: clampConfidence(source.strength, 0.5),
    redacted: Boolean(source.redacted),
    metadata: source.metadata && typeof source.metadata === 'object' ? source.metadata : {},
    createdAt: toIso(source.createdAt),
    updatedAt: toIso(source.updatedAt),
  };
}

function normalizeClaim(doc) {
  const source = doc?.toObject ? doc.toObject() : (doc || {});
  return {
    id: safeString(source._id),
    claimKey: safeString(source.claimKey),
    sourceRecordId: safeString(source.sourceRecordId),
    claimType: safeString(source.claimType, 'summary'),
    text: compactText(source.text, 1200),
    category: safeString(source.category, 'unknown'),
    validationStatus: safeString(source.validationStatus, 'candidate'),
    trustState: safeString(source.trustState, 'candidate'),
    reviewStatus: safeString(source.reviewStatus, 'draft'),
    reusableOutcome: safeString(source.reusableOutcome, 'case-history-only'),
    publishTarget: safeString(source.publishTarget, 'case-history-only'),
    confidence: clampConfidence(source.confidence, 0.5),
    allowedUses: Array.isArray(source.allowedUses) ? source.allowedUses : [],
    notAllowedUses: Array.isArray(source.notAllowedUses) ? source.notAllowedUses : [],
    agentSafe: Boolean(source.agentSafe),
    scope: {
      appliesTo: normalizeStringArray(source.scope?.appliesTo, 12),
      excludes: normalizeStringArray(source.scope?.excludes, 12),
      customerScope: compactText(source.scope?.customerScope, 240),
      versionNotes: compactText(source.scope?.versionNotes, 500),
    },
    evidenceIds: Array.isArray(source.evidenceIds) ? source.evidenceIds.map((id) => safeString(id)).filter(Boolean) : [],
    evidenceKeys: Array.isArray(source.evidenceKeys) ? source.evidenceKeys : [],
    sourceIds: source.sourceIds && typeof source.sourceIds === 'object' ? source.sourceIds : {},
    reviewedBy: safeString(source.reviewedBy),
    reviewedAt: toIso(source.reviewedAt),
    publishedAt: toIso(source.publishedAt),
    deprecatedAt: toIso(source.deprecatedAt),
    metadata: source.metadata && typeof source.metadata === 'object' ? source.metadata : {},
    updatedAt: toIso(source.updatedAt),
  };
}

async function upsertEvidence(spec, now) {
  return OperationalEvidence.findOneAndUpdate(
    { evidenceKey: spec.evidenceKey },
    {
      $set: {
        ...spec,
        status: 'active',
        lastSyncedAt: now,
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

async function upsertClaim(spec, candidate, policy, evidenceDocs, now, actor = {}, trigger = 'knowledge.sync') {
  const evidenceIds = evidenceDocs.map((doc) => doc._id);
  const evidenceKeys = evidenceDocs.map((doc) => doc.evidenceKey);
  const scope = candidate?.scope || {};
  return OperationalClaim.findOneAndUpdate(
    { claimKey: spec.claimKey },
    {
      $set: {
        ...spec,
        normalizedText: normalizeTextKey(spec.text),
        category: compactText(candidate?.category || 'unknown', 120),
        validationStatus: policy.validationStatus,
        trustState: policy.trustState,
        reviewStatus: compactText(candidate?.reviewStatus || 'draft', 80),
        reusableOutcome: compactText(candidate?.reusableOutcome || 'case-history-only', 120),
        publishTarget: compactText(candidate?.publishTarget || 'case-history-only', 120),
        confidence: clampConfidence(candidate?.confidence, 0.5),
        allowedUses: policy.allowedUses,
        notAllowedUses: policy.notAllowedUses,
        agentSafe: policy.agentSafe,
        scope: {
          appliesTo: normalizeStringArray(scope.appliesTo, 20),
          excludes: normalizeStringArray(scope.excludes, 20),
          customerScope: compactText(scope.customerScope, 240),
          versionNotes: compactText(scope.versionNotes, 500),
        },
        evidenceIds,
        evidenceKeys,
        sourceIds: {
          knowledgeCandidateId: safeString(candidate?._id),
          escalationId: safeString(candidate?.escalationId),
          conversationId: candidate?.conversationId ? safeString(candidate.conversationId) : '',
        },
        reviewedBy: compactText(candidate?.reviewedBy || actor?.actor, 120),
        reviewedAt: candidate?.reviewedAt || null,
        publishedAt: candidate?.publishedAt || null,
        deprecatedAt: candidate?.deprecatedAt || null,
        metadata: {
          ...(spec.metadata || {}),
          trigger,
          syncedBy: compactText(actor?.actor || 'system', 120),
        },
        lastSyncedAt: now,
      },
      $setOnInsert: {
        proposedBy: compactText(actor?.actor || 'system', 120),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

async function syncOperationalIntelligenceForKnowledgeCandidate({ knowledge, actor = {}, trigger = 'knowledge.sync' } = {}) {
  const candidate = knowledge?.toObject ? knowledge.toObject() : (knowledge || {});
  const sourceRecordId = sourceRecordIdFor(candidate);
  if (!sourceRecordId || !objectIdOrNull(candidate?._id)) {
    return {
      synced: false,
      sourceRecordId,
      claims: [],
      evidence: [],
      reason: 'missing-knowledge-candidate-id',
    };
  }

  const now = new Date();
  const policy = buildPolicy(candidate);
  const evidenceSpecs = buildEvidenceSpecs(candidate);
  const evidenceDocs = [];
  for (const spec of evidenceSpecs) {
    evidenceDocs.push(await upsertEvidence(spec, now));
  }

  const activeEvidenceKeys = evidenceDocs.map((doc) => doc.evidenceKey);
  await OperationalEvidence.updateMany(
    {
      sourceRecordId,
      evidenceKey: { $nin: activeEvidenceKeys },
      status: 'active',
    },
    {
      $set: {
        status: candidate.deprecatedAt ? 'deprecated' : 'superseded',
        lastSyncedAt: now,
      },
    }
  );

  const claimSpecs = buildClaimSpecs(candidate);
  const claimDocs = [];
  for (const spec of claimSpecs) {
    claimDocs.push(await upsertClaim(spec, candidate, policy, evidenceDocs, now, actor, trigger));
  }

  const activeClaimKeys = claimDocs.map((doc) => doc.claimKey);
  const inactiveFilter = activeClaimKeys.length
    ? { claimKey: { $nin: activeClaimKeys } }
    : {};
  await OperationalClaim.updateMany(
    {
      sourceRecordId,
      ...inactiveFilter,
      validationStatus: { $nin: ['deprecated', 'superseded'] },
    },
    {
      $set: {
        validationStatus: candidate.deprecatedAt ? 'deprecated' : 'superseded',
        trustState: TRUST_STATES.DEPRECATED,
        allowedUses: [ALLOWED_USES.REVIEW_ONLY],
        notAllowedUses: ALL_ALLOWED_USES.filter((use) => use !== ALLOWED_USES.REVIEW_ONLY),
        agentSafe: false,
        deprecatedAt: candidate.deprecatedAt || now,
        supersededAt: candidate.deprecatedAt ? null : now,
        lastSyncedAt: now,
      },
    }
  );

  return {
    synced: true,
    sourceRecordId,
    policy: {
      validationStatus: policy.validationStatus,
      trustState: policy.trustState,
      allowedUses: policy.allowedUses,
      agentSafe: policy.agentSafe,
    },
    claims: claimDocs.map(normalizeClaim),
    evidence: evidenceDocs.map(normalizeEvidence),
  };
}

async function loadCandidateForRecordId(recordId) {
  const parsed = normalizeKnowledgeRecordId(recordId);
  if (!parsed.id || parsed.sourceType !== 'knowledge-candidate' || !mongoose.isValidObjectId(parsed.id)) {
    return null;
  }
  return KnowledgeCandidate.findById(parsed.id);
}

async function ensureOperationalIntelligenceForRecord(recordId) {
  const sourceRecordId = safeString(recordId, '').startsWith('candidate:')
    ? safeString(recordId, '')
    : `candidate:${safeString(recordId, '').replace(/^candidate:/, '')}`;
  const existing = await OperationalClaim.exists({ sourceRecordId });
  if (existing) return null;
  const candidate = await loadCandidateForRecordId(sourceRecordId);
  if (!candidate) return null;
  return syncOperationalIntelligenceForKnowledgeCandidate({
    knowledge: candidate,
    actor: { actor: 'operational-intelligence', role: 'system' },
    trigger: 'operational-intelligence.backfill',
  });
}

async function getOperationalIntelligenceForRecord(recordId, options = {}) {
  const parsed = normalizeKnowledgeRecordId(recordId);
  if (!parsed.id || parsed.sourceType !== 'knowledge-candidate' || !mongoose.isValidObjectId(parsed.id)) {
    const err = new Error('Invalid knowledge record id.');
    err.status = 400;
    err.code = 'INVALID_KNOWLEDGE_RECORD_ID';
    throw err;
  }

  const sourceRecordId = `candidate:${parsed.id}`;
  if (parseBoolean(options.syncIfMissing, true)) {
    await ensureOperationalIntelligenceForRecord(sourceRecordId);
  }
  const [claims, evidence] = await Promise.all([
    OperationalClaim.find({ sourceRecordId }).sort({ claimType: 1, updatedAt: -1 }).lean(),
    OperationalEvidence.find({ sourceRecordId }).sort({ sourceType: 1, updatedAt: -1 }).lean(),
  ]);

  return {
    sourceRecordId,
    claims: claims.map(normalizeClaim),
    evidence: evidence.map(normalizeEvidence),
    counts: {
      claims: claims.length,
      evidence: evidence.length,
      trustedClaims: claims.filter((claim) => claim.validationStatus === 'trusted').length,
      agentSafeClaims: claims.filter((claim) => claim.agentSafe).length,
    },
  };
}

function buildClaimQueryFilter(options = {}) {
  const filter = {};
  const includeCandidates = parseBoolean(options.includeCandidates, false);
  const includeDeprecated = parseBoolean(options.includeDeprecated, false);
  const allowedUse = compactText(options.allowedUse || ALLOWED_USES.AGENT_RESPONSE, 80);
  const query = compactText(options.query || options.q, 500);
  const recordIds = Array.isArray(options.sourceRecordIds)
    ? options.sourceRecordIds.map((id) => compactText(id, 120)).filter(Boolean)
    : [];

  if (recordIds.length > 0) {
    filter.sourceRecordId = { $in: recordIds };
  }
  if (allowedUse) {
    filter.allowedUses = allowedUse;
  }
  if (!includeDeprecated) {
    filter.validationStatus = { $nin: ['deprecated', 'superseded', 'rejected', 'restricted'] };
  }
  if (!includeCandidates) {
    filter.validationStatus = 'trusted';
    filter.agentSafe = true;
  } else if (!filter.validationStatus) {
    filter.validationStatus = { $in: [...ACTIVE_CLAIM_STATUSES] };
  }
  if (query) {
    const regex = new RegExp(escapeRegex(query), 'i');
    filter.$or = [
      { text: regex },
      { normalizedText: regex },
      { category: regex },
      { sourceRecordId: regex },
    ];
  }
  return filter;
}

async function listOperationalClaims(options = {}) {
  const limit = parseLimit(options.limit, 10, 50);
  const filter = buildClaimQueryFilter(options);
  const claims = await OperationalClaim.find(filter)
    .sort({ agentSafe: -1, confidence: -1, updatedAt: -1 })
    .limit(limit)
    .lean();
  return claims.map(normalizeClaim);
}

async function ensureOperationalIntelligenceForRecords(records = []) {
  const recordIds = records
    .map((record) => safeString(record?.id))
    .filter((id) => id.startsWith('candidate:'));
  for (const recordId of recordIds) {
    await ensureOperationalIntelligenceForRecord(recordId);
  }
}

async function buildOperationalIntelligenceContext(options = {}) {
  const allowedUse = compactText(options.allowedUse || ALLOWED_USES.AGENT_RESPONSE, 80);
  const limit = parseLimit(options.limit, 6, 20);
  const knowledgeContext = await buildAgentKnowledgeContext({
    ...options,
    allowedUse,
    limit,
  });
  const records = Array.isArray(knowledgeContext.records) ? knowledgeContext.records : [];
  await ensureOperationalIntelligenceForRecords(records);

  const sourceRecordIds = records
    .map((record) => safeString(record.id))
    .filter((id) => id.startsWith('candidate:'));
  const { query, q, ...claimOptions } = options;
  const claims = sourceRecordIds.length > 0
    ? await listOperationalClaims({
      ...claimOptions,
      allowedUse,
      sourceRecordIds,
      limit: Math.max(limit * 4, 12),
    })
    : [];

  const claimsByRecord = new Map();
  for (const claim of claims) {
    if (!claimsByRecord.has(claim.sourceRecordId)) claimsByRecord.set(claim.sourceRecordId, []);
    claimsByRecord.get(claim.sourceRecordId).push(claim);
  }

  return {
    ...knowledgeContext,
    allowedUse,
    records: records.map((record) => ({
      ...record,
      operationalClaims: (claimsByRecord.get(record.id) || []).slice(0, 6),
    })),
    claims,
    policy: {
      ...(knowledgeContext.policy || {}),
      operationalIntelligence: {
        source: 'knowledge-candidates',
        finalAgentUses: [...FINAL_AGENT_USES],
        note: parseBoolean(options.includeCandidates, false)
          ? 'Candidate claims may be included but must be labelled as untrusted.'
          : 'Only trusted, agent-safe claims are returned by default.',
      },
    },
  };
}

async function getOperationalIntelligenceSummary() {
  if (!OperationalClaim.db || OperationalClaim.db.readyState !== 1) {
    return {
      dbReady: false,
      claims: { total: 0, byValidationStatus: {}, byClaimType: {}, agentSafe: 0 },
      evidence: { total: 0, bySourceType: {} },
    };
  }

  const [
    claimStatusCounts,
    claimTypeCounts,
    evidenceTypeCounts,
    claimTotal,
    evidenceTotal,
    agentSafe,
  ] = await Promise.all([
    OperationalClaim.aggregate([{ $group: { _id: '$validationStatus', count: { $sum: 1 } } }]),
    OperationalClaim.aggregate([{ $group: { _id: '$claimType', count: { $sum: 1 } } }]),
    OperationalEvidence.aggregate([{ $group: { _id: '$sourceType', count: { $sum: 1 } } }]),
    OperationalClaim.countDocuments({}),
    OperationalEvidence.countDocuments({}),
    OperationalClaim.countDocuments({ agentSafe: true }),
  ]);

  const byValidationStatus = {};
  const byClaimType = {};
  const bySourceType = {};
  for (const item of claimStatusCounts) byValidationStatus[item._id || 'unknown'] = item.count;
  for (const item of claimTypeCounts) byClaimType[item._id || 'unknown'] = item.count;
  for (const item of evidenceTypeCounts) bySourceType[item._id || 'unknown'] = item.count;

  return {
    dbReady: true,
    claims: {
      total: claimTotal,
      byValidationStatus,
      byClaimType,
      agentSafe,
    },
    evidence: {
      total: evidenceTotal,
      bySourceType,
    },
  };
}

async function deleteOperationalIntelligenceForRecord(recordId) {
  const parsed = normalizeKnowledgeRecordId(recordId);
  const sourceRecordId = parsed.id ? `candidate:${parsed.id}` : safeString(recordId);
  if (!sourceRecordId) return { deletedClaims: 0, deletedEvidence: 0 };
  const [claims, evidence] = await Promise.all([
    OperationalClaim.deleteMany({ sourceRecordId }),
    OperationalEvidence.deleteMany({ sourceRecordId }),
  ]);
  return {
    deletedClaims: claims.deletedCount || 0,
    deletedEvidence: evidence.deletedCount || 0,
  };
}

module.exports = {
  buildOperationalIntelligenceContext,
  deleteOperationalIntelligenceForRecord,
  getOperationalIntelligenceForRecord,
  getOperationalIntelligenceSummary,
  listOperationalClaims,
  normalizeClaim,
  normalizeEvidence,
  syncOperationalIntelligenceForKnowledgeCandidate,
};
