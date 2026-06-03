const KnowledgeCandidate = require('../models/KnowledgeCandidate');
const {
  getPlaybookSourceInfo,
  searchPlaybookChunks,
} = require('../lib/playbook-loader');

const TRUST_STATES = Object.freeze({
  CANDIDATE: 'candidate',
  REVIEWED: 'reviewed',
  TRUSTED: 'trusted',
  REJECTED: 'rejected',
  RESTRICTED: 'restricted',
  LEGACY_TRUSTED: 'legacy-trusted',
});

const ALLOWED_USES = Object.freeze({
  AGENT_RESPONSE: 'agent-response',
  TRIAGE: 'triage',
  SIMILARITY_SEARCH: 'similarity-search',
  PATTERN_DETECTION: 'pattern-detection',
  PLAYBOOK_EXPORT: 'playbook-export',
  REVIEW_ONLY: 'review-only',
  DEPRECATED_WARNING: 'deprecated-warning',
});

const FINAL_AGENT_USES = new Set([
  ALLOWED_USES.AGENT_RESPONSE,
  ALLOWED_USES.TRIAGE,
]);

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
  return text.slice(0, Math.max(0, maxChars - 3)).trimEnd() + '...';
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
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

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function escapeRegex(value) {
  return safeString(value, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitSearchTerms(query, limit = 12) {
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'with',
    'that',
    'this',
    'says',
    'saying',
    'customer',
    'client',
    'agent',
    'issue',
    'problem',
  ]);
  const terms = safeString(query, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !stopWords.has(term));
  const out = [];
  const seen = new Set();
  for (const term of terms) {
    if (seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= limit) break;
  }
  return out;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = safeString(value, '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseLimit(value, fallback = 20, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseOffset(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function isKnowledgeCandidateDbReady() {
  return Boolean(KnowledgeCandidate.db && KnowledgeCandidate.db.readyState === 1);
}

function emptyKnowledgeRecordPage({ limit = 50, offset = 0 } = {}) {
  return {
    records: [],
    total: 0,
    offset,
    limit,
  };
}

function deriveTrustState(candidate) {
  const reviewStatus = safeString(candidate?.reviewStatus, 'draft');
  const reusableOutcome = safeString(candidate?.reusableOutcome, 'case-history-only');

  if (reviewStatus === 'rejected') return TRUST_STATES.REJECTED;
  if (reusableOutcome === 'unsafe-to-reuse') return TRUST_STATES.RESTRICTED;
  if (reviewStatus === 'published') return TRUST_STATES.TRUSTED;
  if (reviewStatus === 'approved') return TRUST_STATES.REVIEWED;
  return TRUST_STATES.CANDIDATE;
}

function deriveAllowedUses(candidate) {
  const reviewStatus = safeString(candidate?.reviewStatus, 'draft');
  const reusableOutcome = safeString(candidate?.reusableOutcome, 'case-history-only');
  const trusted = reviewStatus === 'published';

  if (reusableOutcome === 'unsafe-to-reuse') {
    return [ALLOWED_USES.REVIEW_ONLY];
  }

  if (reviewStatus === 'rejected') {
    return [ALLOWED_USES.REVIEW_ONLY];
  }

  if (reusableOutcome === 'case-history-only' || reusableOutcome === 'customer-specific') {
    return [
      ALLOWED_USES.SIMILARITY_SEARCH,
      ALLOWED_USES.PATTERN_DETECTION,
      ALLOWED_USES.REVIEW_ONLY,
    ];
  }

  if (reusableOutcome === 'temporary-incident') {
    return trusted
      ? [
        ALLOWED_USES.PATTERN_DETECTION,
        ALLOWED_USES.DEPRECATED_WARNING,
        ALLOWED_USES.REVIEW_ONLY,
      ]
      : [ALLOWED_USES.REVIEW_ONLY, ALLOWED_USES.PATTERN_DETECTION];
  }

  if (trusted && (reusableOutcome === 'canonical' || reusableOutcome === 'edge-case')) {
    return [
      ALLOWED_USES.AGENT_RESPONSE,
      ALLOWED_USES.TRIAGE,
      ALLOWED_USES.SIMILARITY_SEARCH,
      ALLOWED_USES.PATTERN_DETECTION,
      ALLOWED_USES.PLAYBOOK_EXPORT,
    ];
  }

  if (reviewStatus === 'approved') {
    return [
      ALLOWED_USES.SIMILARITY_SEARCH,
      ALLOWED_USES.PATTERN_DETECTION,
      ALLOWED_USES.REVIEW_ONLY,
    ];
  }

  return [ALLOWED_USES.REVIEW_ONLY];
}

function buildWarnings(candidate, trustState, allowedUses) {
  const warnings = [];
  const reviewStatus = safeString(candidate?.reviewStatus, 'draft');
  const reusableOutcome = safeString(candidate?.reusableOutcome, 'case-history-only');

  if (reviewStatus === 'draft') warnings.push('candidate_needs_review');
  if (reviewStatus === 'approved') warnings.push('approved_but_not_trusted_for_agent_response');
  if (reviewStatus === 'rejected') warnings.push('rejected_do_not_use_as_guidance');
  if (reusableOutcome === 'case-history-only') warnings.push('case_history_only_not_general_guidance');
  if (reusableOutcome === 'customer-specific') warnings.push('customer_specific_scope');
  if (reusableOutcome === 'temporary-incident') warnings.push('temporary_incident_scope');
  if (reusableOutcome === 'unsafe-to-reuse') warnings.push('unsafe_to_reuse');
  if (!allowedUses.some((use) => FINAL_AGENT_USES.has(use))) warnings.push('not_allowed_for_final_agent_response');
  if (!safeString(candidate?.exactFix, '').trim()) warnings.push('missing_exact_fix');
  if (!safeString(candidate?.rootCause, '').trim()) warnings.push('missing_root_cause');
  if (trustState === TRUST_STATES.RESTRICTED) warnings.push('restricted_trust_state');

  return [...new Set(warnings)];
}

function buildCandidateEvidence(candidate) {
  const snapshot = candidate?.sourceSnapshot || {};
  const evidence = [];

  if (candidate?.escalationId) {
    evidence.push({
      type: 'escalation',
      id: safeString(candidate.escalationId),
      label: snapshot.caseNumber
        ? `Case ${snapshot.caseNumber}`
        : 'Source escalation',
      category: snapshot.category || candidate.category || '',
      status: snapshot.status || '',
      coid: snapshot.coid || '',
      resolvedAt: toIso(snapshot.resolvedAt),
      evidenceStatus: snapshot.resolvedAt ? 'finalized-case' : 'case-snapshot',
    });
  }

  if (candidate?.conversationId) {
    evidence.push({
      type: 'conversation',
      id: safeString(candidate.conversationId),
      label: snapshot.conversationTitle || 'Linked conversation',
      preview: compactText(snapshot.conversationPreview, 320),
      messageCount: Number(snapshot.conversationMessageCount || 0),
      evidenceStatus: 'conversation-snapshot',
    });
  }

  if (snapshot.resolution || snapshot.resolutionNotes) {
    evidence.push({
      type: 'resolution',
      label: 'Resolution text',
      text: compactText(snapshot.resolution || snapshot.resolutionNotes, 500),
      evidenceStatus: 'review-source',
    });
  }

  return evidence;
}

function normalizeKnowledgeCandidate(candidate) {
  const source = candidate?.toObject ? candidate.toObject() : (candidate || {});
  const trustState = deriveTrustState(source);
  const allowedUses = deriveAllowedUses(source);
  const warnings = buildWarnings(source, trustState, allowedUses);

  return {
    id: `candidate:${safeString(source._id)}`,
    sourceType: 'knowledge-candidate',
    recordType: 'case-learning',
    sourceIds: {
      knowledgeCandidateId: safeString(source._id),
      escalationId: safeString(source.escalationId),
      conversationId: source.conversationId ? safeString(source.conversationId) : null,
    },
    title: compactText(source.title || 'Reviewed case learning', 160),
    category: safeString(source.category, 'unknown'),
    summary: compactText(source.summary, 700),
    symptom: compactText(source.symptom, 700),
    rootCause: compactText(source.rootCause, 700),
    exactFix: compactText(source.exactFix, 1400),
    escalationPath: compactText(source.escalationPath, 700),
    keySignals: normalizeStringArray(source.keySignals, 8),
    confidence: clampConfidence(source.confidence),
    trustState,
    reviewStatus: safeString(source.reviewStatus, 'draft'),
    reusableOutcome: safeString(source.reusableOutcome, 'case-history-only'),
    publishTarget: safeString(source.publishTarget, 'case-history-only'),
    allowedUses,
    evidence: buildCandidateEvidence(source),
    lineage: {
      generatedAt: toIso(source.generatedAt),
      publishedAt: toIso(source.publishedAt),
      createdAt: toIso(source.createdAt),
      updatedAt: toIso(source.updatedAt),
      publishedDocType: safeString(source.publishedDocType, ''),
      publishedDocPath: safeString(source.publishedDocPath, ''),
      publishedMarker: safeString(source.publishedMarker, ''),
      publishedSectionTitle: safeString(source.publishedSectionTitle, ''),
    },
    reviewNotes: compactText(source.reviewNotes, 500),
    warnings,
    updatedAt: toIso(source.updatedAt),
  };
}

function normalizePlaybookChunk(chunk) {
  const sourceName = safeString(chunk?.sourceName, 'unknown');
  const sourceType = safeString(chunk?.sourceType, 'playbook');
  const title = safeString(chunk?.title, '').trim();
  const id = `legacy-playbook:${sourceType}:${sourceName}:${safeString(chunk?.id, '')}`;

  return {
    id,
    sourceType: 'legacy-playbook',
    recordType: `${sourceType}-chunk`,
    sourceIds: {
      playbookSourceType: sourceType,
      playbookSourceName: sourceName,
      playbookPath: safeString(chunk?.path, ''),
    },
    title: title || sourceName,
    category: sourceType === 'category' ? sourceName : '',
    summary: compactText(chunk?.text, 700),
    symptom: '',
    rootCause: '',
    exactFix: compactText(chunk?.text, 1400),
    escalationPath: '',
    keySignals: [],
    confidence: 0,
    trustState: TRUST_STATES.LEGACY_TRUSTED,
    reviewStatus: 'legacy',
    reusableOutcome: 'legacy-playbook',
    publishTarget: 'legacy-playbook',
    allowedUses: [
      ALLOWED_USES.AGENT_RESPONSE,
      ALLOWED_USES.TRIAGE,
      ALLOWED_USES.SIMILARITY_SEARCH,
      ALLOWED_USES.PATTERN_DETECTION,
    ],
    evidence: [{
      type: 'playbook-file',
      label: sourceName,
      path: safeString(chunk?.path, ''),
      title,
      evidenceStatus: 'legacy-playbook',
    }],
    lineage: {
      score: Number(chunk?.score || 0),
      chars: Number(chunk?.chars || 0),
    },
    reviewNotes: '',
    warnings: ['legacy_playbook_missing_database_evidence_lifecycle'],
    updatedAt: null,
  };
}

function buildCandidateFilter({ query, reviewStatus, category, reusableOutcome } = {}) {
  const filter = {};
  const normalizedReviewStatus = safeString(reviewStatus, '').trim();
  const normalizedCategory = safeString(category, '').trim();
  const normalizedReusableOutcome = safeString(reusableOutcome, '').trim();

  if (normalizedReviewStatus) filter.reviewStatus = normalizedReviewStatus;
  if (normalizedCategory) filter.category = normalizedCategory;
  if (normalizedReusableOutcome) filter.reusableOutcome = normalizedReusableOutcome;

  const search = safeString(query, '').trim();
  if (search) {
    const regexes = [
      new RegExp(escapeRegex(search), 'i'),
      ...splitSearchTerms(search).map((term) => new RegExp(escapeRegex(term), 'i')),
    ];
    const clauses = [];
    for (const regex of regexes) {
      clauses.push(
        { title: regex },
        { summary: regex },
        { symptom: regex },
        { rootCause: regex },
        { exactFix: regex },
        { escalationPath: regex },
        { keySignals: regex },
        { 'sourceSnapshot.caseNumber': regex },
        { 'sourceSnapshot.attemptingTo': regex },
        { 'sourceSnapshot.actualOutcome': regex },
        { 'sourceSnapshot.resolution': regex },
        { 'sourceSnapshot.resolutionNotes': regex },
        { 'sourceSnapshot.conversationTitle': regex },
        { 'sourceSnapshot.conversationPreview': regex },
      );
    }
    filter.$or = clauses;
  }

  return filter;
}

function filterRecordForPolicy(record, {
  allowedUse = '',
  trustState = '',
  includeCandidates = true,
} = {}) {
  if (!record) return false;
  if (trustState && record.trustState !== trustState) return false;
  if (allowedUse && !record.allowedUses.includes(allowedUse)) return false;
  if (!includeCandidates && ![
    TRUST_STATES.TRUSTED,
    TRUST_STATES.LEGACY_TRUSTED,
  ].includes(record.trustState)) {
    return false;
  }
  return true;
}

function normalizeSort(sort) {
  const value = safeString(sort, '-updatedAt').trim();
  const allowed = new Set([
    '-updatedAt',
    'updatedAt',
    '-createdAt',
    'createdAt',
    '-publishedAt',
    'publishedAt',
    'category',
    '-category',
    'reviewStatus',
    '-reviewStatus',
  ]);
  return allowed.has(value) ? value : '-updatedAt';
}

async function listKnowledgeRecords(options = {}) {
  const limit = parseLimit(options.limit, 50, 200);
  const offset = parseOffset(options.offset);
  const includeCandidates = parseBoolean(options.includeCandidates, true);
  const filter = buildCandidateFilter(options);
  const sort = normalizeSort(options.sort);

  if (!isKnowledgeCandidateDbReady()) {
    return emptyKnowledgeRecordPage({ limit, offset });
  }

  const [docs, total] = await Promise.all([
    KnowledgeCandidate.find(filter)
      .sort(sort)
      .skip(offset)
      .limit(limit)
      .lean(),
    KnowledgeCandidate.countDocuments(filter),
  ]);

  const records = docs
    .map(normalizeKnowledgeCandidate)
    .filter((record) => filterRecordForPolicy(record, {
      allowedUse: safeString(options.allowedUse, ''),
      trustState: safeString(options.trustState, ''),
      includeCandidates,
    }));

  return {
    records,
    total,
    offset,
    limit,
  };
}

async function searchKnowledge(options = {}) {
  const limit = parseLimit(options.limit, 10, 50);
  const includeLegacy = parseBoolean(options.includeLegacy, true);
  const includeCandidates = parseBoolean(options.includeCandidates, true);
  const query = safeString(options.query, '').trim();

  const dbResult = await listKnowledgeRecords({
    ...options,
    query,
    limit,
    offset: 0,
    includeCandidates,
  });

  let legacyRecords = [];
  if (includeLegacy && query) {
    legacyRecords = searchPlaybookChunks(query, {
      topK: limit,
      minScore: options.minScore,
      allowedCategories: options.allowedCategories,
      allowedTemplates: options.allowedTemplates,
      allowedTopLevel: options.allowedTopLevel,
    })
      .map(normalizePlaybookChunk)
      .filter((record) => filterRecordForPolicy(record, {
        allowedUse: safeString(options.allowedUse, ''),
        trustState: safeString(options.trustState, ''),
        includeCandidates,
      }));
  }

  const records = [...dbResult.records, ...legacyRecords].slice(0, limit);
  return {
    query,
    records,
    total: records.length,
    dbTotal: dbResult.total,
    legacyTotal: legacyRecords.length,
  };
}

function toAgentContextRecord(record) {
  return {
    id: record.id,
    sourceType: record.sourceType,
    title: record.title,
    category: record.category,
    trustState: record.trustState,
    reviewStatus: record.reviewStatus,
    reusableOutcome: record.reusableOutcome,
    confidence: record.confidence,
    allowedUses: record.allowedUses,
    summary: record.summary,
    symptom: record.symptom,
    rootCause: record.rootCause,
    exactFix: record.exactFix,
    keySignals: record.keySignals,
    evidence: record.evidence.map((item) => ({
      type: item.type,
      id: item.id || null,
      label: item.label || '',
      evidenceStatus: item.evidenceStatus || '',
    })),
    warnings: record.warnings,
  };
}

async function buildAgentKnowledgeContext(options = {}) {
  const allowedUse = safeString(options.allowedUse, ALLOWED_USES.AGENT_RESPONSE).trim()
    || ALLOWED_USES.AGENT_RESPONSE;
  const limit = parseLimit(options.limit, 6, 20);
  const includeLegacy = parseBoolean(options.includeLegacy, true);
  const includeCandidates = parseBoolean(options.includeCandidates, false);

  const result = await searchKnowledge({
    ...options,
    allowedUse,
    limit,
    includeLegacy,
    includeCandidates,
  });

  const records = result.records
    .filter((record) => filterRecordForPolicy(record, {
      allowedUse,
      includeCandidates,
    }))
    .slice(0, limit)
    .map(toAgentContextRecord);

  return {
    query: safeString(options.query, '').trim(),
    allowedUse,
    records,
    policy: {
      includeLegacy,
      includeCandidates,
      finalAgentUses: [...FINAL_AGENT_USES],
      note: includeCandidates
        ? 'Candidate records may be included but must be labelled as untrusted.'
        : 'Only trusted or legacy-trusted records are returned by default.',
    },
  };
}

async function getKnowledgeSummary() {
  const playbookSources = getPlaybookSourceInfo();
  if (!isKnowledgeCandidateDbReady()) {
    return {
      candidates: {
        total: 0,
        byReviewStatus: {},
        byReusableOutcome: {},
        byPublishTarget: {},
        byTrustState: {
          [TRUST_STATES.CANDIDATE]: 0,
          [TRUST_STATES.REVIEWED]: 0,
          [TRUST_STATES.TRUSTED]: 0,
          [TRUST_STATES.REJECTED]: 0,
        },
      },
      legacyPlaybook: {
        sourceCount: playbookSources.length,
        sources: playbookSources.map((source) => ({
          sourceType: source.sourceType,
          sourceName: source.sourceName,
          path: source.path,
          chars: source.chars,
        })),
      },
      policy: {
        trustedAgentStates: [TRUST_STATES.TRUSTED, TRUST_STATES.LEGACY_TRUSTED],
        finalAgentUses: [...FINAL_AGENT_USES],
      },
    };
  }

  const [
    reviewStatusCounts,
    reusableOutcomeCounts,
    publishTargetCounts,
  ] = await Promise.all([
    KnowledgeCandidate.aggregate([{ $group: { _id: '$reviewStatus', count: { $sum: 1 } } }]),
    KnowledgeCandidate.aggregate([{ $group: { _id: '$reusableOutcome', count: { $sum: 1 } } }]),
    KnowledgeCandidate.aggregate([{ $group: { _id: '$publishTarget', count: { $sum: 1 } } }]),
  ]);

  const byReviewStatus = {};
  const byReusableOutcome = {};
  const byPublishTarget = {};

  for (const item of reviewStatusCounts) byReviewStatus[item._id || 'unknown'] = item.count;
  for (const item of reusableOutcomeCounts) byReusableOutcome[item._id || 'unknown'] = item.count;
  for (const item of publishTargetCounts) byPublishTarget[item._id || 'unknown'] = item.count;

  const trustState = {
    [TRUST_STATES.CANDIDATE]: byReviewStatus.draft || 0,
    [TRUST_STATES.REVIEWED]: byReviewStatus.approved || 0,
    [TRUST_STATES.TRUSTED]: byReviewStatus.published || 0,
    [TRUST_STATES.REJECTED]: byReviewStatus.rejected || 0,
  };

  return {
    candidates: {
      total: Object.values(byReviewStatus).reduce((sum, count) => sum + count, 0),
      byReviewStatus,
      byReusableOutcome,
      byPublishTarget,
      byTrustState: trustState,
    },
    legacyPlaybook: {
      sourceCount: playbookSources.length,
      sources: playbookSources.map((source) => ({
        sourceType: source.sourceType,
        sourceName: source.sourceName,
        path: source.path,
        chars: source.chars,
      })),
    },
    policy: {
      trustedAgentStates: [TRUST_STATES.TRUSTED, TRUST_STATES.LEGACY_TRUSTED],
      finalAgentUses: [...FINAL_AGENT_USES],
    },
  };
}

module.exports = {
  ALLOWED_USES,
  TRUST_STATES,
  buildAgentKnowledgeContext,
  deriveAllowedUses,
  deriveTrustState,
  getKnowledgeSummary,
  listKnowledgeRecords,
  normalizeKnowledgeCandidate,
  normalizePlaybookChunk,
  isKnowledgeCandidateDbReady,
  parseBoolean,
  parseLimit,
  parseOffset,
  searchKnowledge,
};
