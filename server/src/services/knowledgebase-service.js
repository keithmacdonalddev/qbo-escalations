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
  DEPRECATED: 'deprecated',
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

const FINAL_AGENT_OUTCOMES = new Set(['canonical', 'edge-case']);

// Read-time redaction mask. When a record is redacted
// (redaction.customerIdentifiersRedacted), every read path that goes through
// normalizeKnowledgeCandidate returns this marker instead of the stored
// free-text body content. The original text is NEVER modified in MongoDB —
// masking is applied on read only, so lifting the redaction restores the
// original content.
const REDACTION_MASK = '[redacted]';

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

function isRedactedCandidate(candidate) {
  return Boolean(candidate?.redaction?.customerIdentifiersRedacted);
}

function maskRedactedText(value) {
  return safeString(value, '').trim() ? REDACTION_MASK : '';
}

function maskRedactedStringArray(values) {
  return Array.isArray(values) && values.length > 0 ? [REDACTION_MASK] : [];
}

function emptyKnowledgeRecordPage({ limit = 50, offset = 0 } = {}) {
  return {
    records: [],
    total: 0,
    offset,
    limit,
  };
}

function baseTrustState(candidate) {
  const reviewStatus = safeString(candidate?.reviewStatus, 'draft');
  const reusableOutcome = safeString(candidate?.reusableOutcome, 'case-history-only');

  if (candidate?.deprecatedAt) return TRUST_STATES.DEPRECATED;
  if (reviewStatus === 'rejected') return TRUST_STATES.REJECTED;
  if (candidate?.needsReviewAfterRecovery?.recoveryOperationId) return TRUST_STATES.CANDIDATE;
  if (reusableOutcome === 'unsafe-to-reuse') return TRUST_STATES.RESTRICTED;
  if (reviewStatus === 'published') return TRUST_STATES.TRUSTED;
  if (reviewStatus === 'approved') return TRUST_STATES.REVIEWED;
  return TRUST_STATES.CANDIDATE;
}

function isRestrictiveTrustOverride(base, override) {
  if (!override || !Object.values(TRUST_STATES).includes(override)) return false;
  if ([TRUST_STATES.REJECTED, TRUST_STATES.RESTRICTED, TRUST_STATES.DEPRECATED].includes(override)) return true;
  if (override === TRUST_STATES.CANDIDATE) return base !== TRUST_STATES.CANDIDATE;
  if (override === TRUST_STATES.REVIEWED) {
    return base === TRUST_STATES.TRUSTED || base === TRUST_STATES.REVIEWED;
  }
  if (override === TRUST_STATES.TRUSTED) return base === TRUST_STATES.TRUSTED;
  return false;
}

function deriveTrustState(candidate) {
  const base = baseTrustState(candidate);
  const trustStateOverride = safeString(candidate?.trustStateOverride, '').trim();
  return isRestrictiveTrustOverride(base, trustStateOverride) ? trustStateOverride : base;
}

function deriveBaseAllowedUses(candidate) {
  const reviewStatus = safeString(candidate?.reviewStatus, 'draft');
  const reusableOutcome = safeString(candidate?.reusableOutcome, 'case-history-only');
  if (candidate?.deprecatedAt) return [ALLOWED_USES.DEPRECATED_WARNING, ALLOWED_USES.REVIEW_ONLY];

  const trusted = reviewStatus === 'published';

  if (reusableOutcome === 'unsafe-to-reuse') {
    return [ALLOWED_USES.REVIEW_ONLY];
  }

  if (reviewStatus === 'rejected') {
    return [ALLOWED_USES.REVIEW_ONLY];
  }

  if (candidate?.needsReviewAfterRecovery?.recoveryOperationId) {
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

function deriveAllowedUses(candidate) {
  const baseUses = deriveBaseAllowedUses(candidate);
  const override = Array.isArray(candidate?.allowedUsesOverride)
    ? candidate.allowedUsesOverride.filter((use) => Object.values(ALLOWED_USES).includes(use))
    : [];
  if (override.length === 0) return baseUses;
  const baseSet = new Set(baseUses);
  const restricted = [...new Set(override)].filter((use) => baseSet.has(use));
  return restricted.length > 0 ? restricted : [ALLOWED_USES.REVIEW_ONLY];
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
  if (candidate?.deprecatedAt) warnings.push('deprecated_guidance');
  if (candidate?.supersededBy) warnings.push('superseded_by_newer_guidance');
  if (candidate?.redaction?.customerIdentifiersRedacted) warnings.push('source_identifiers_redacted');
  if (candidate?.needsReviewAfterRecovery?.recoveryOperationId) warnings.push('triage_recovery_review_required');
  if (!allowedUses.some((use) => FINAL_AGENT_USES.has(use))) warnings.push('not_allowed_for_final_agent_response');
  if (!safeString(candidate?.finalOutcome || candidate?.exactFix, '').trim()) warnings.push('missing_exact_fix');
  if (!safeString(candidate?.confirmedCause || candidate?.rootCause, '').trim()) warnings.push('missing_root_cause');
  if (trustState === TRUST_STATES.RESTRICTED) warnings.push('restricted_trust_state');
  if (trustState === TRUST_STATES.DEPRECATED) warnings.push('deprecated_trust_state');

  return [...new Set(warnings)];
}

function buildCandidateEvidence(candidate) {
  const snapshot = candidate?.sourceSnapshot || {};
  const evidence = [];
  const redacted = Boolean(candidate?.redaction?.customerIdentifiersRedacted);

  if (candidate?.escalationId) {
    evidence.push({
      type: 'escalation',
      id: safeString(candidate.escalationId),
      label: snapshot.caseNumber
        ? `Case ${redacted ? '[redacted]' : snapshot.caseNumber}`
        : 'Source escalation',
      category: snapshot.category || candidate.category || '',
      status: snapshot.status || '',
      coid: redacted && snapshot.coid ? '[redacted]' : (snapshot.coid || ''),
      resolvedAt: toIso(snapshot.resolvedAt),
      evidenceStatus: snapshot.resolvedAt ? 'finalized-case' : 'case-snapshot',
    });
  }

  if (candidate?.conversationId) {
    evidence.push({
      type: 'conversation',
      id: safeString(candidate.conversationId),
      label: redacted ? 'Linked conversation' : (snapshot.conversationTitle || 'Linked conversation'),
      preview: redacted
        ? maskRedactedText(snapshot.conversationPreview)
        : compactText(snapshot.conversationPreview, 320),
      messageCount: Number(snapshot.conversationMessageCount || 0),
      evidenceStatus: 'conversation-snapshot',
    });
  }

  if (snapshot.resolution || snapshot.resolutionNotes) {
    evidence.push({
      type: 'resolution',
      label: 'Resolution text',
      text: redacted
        ? REDACTION_MASK
        : compactText(snapshot.resolution || snapshot.resolutionNotes, 500),
      evidenceStatus: 'review-source',
    });
  }

  const refs = Array.isArray(candidate?.evidenceRefs) ? candidate.evidenceRefs : [];
  for (const ref of refs.slice(0, 12)) {
    evidence.push({
      type: safeString(ref.type, 'note'),
      id: safeString(ref.id),
      label: redacted ? REDACTION_MASK : compactText(ref.label || ref.summary || ref.type, 160),
      status: safeString(ref.status),
      strength: clampConfidence(ref.strength),
      summary: redacted ? maskRedactedText(ref.summary) : compactText(ref.summary, 400),
      url: redacted ? maskRedactedText(ref.url) : safeString(ref.url),
      evidenceStatus: safeString(ref.status, 'supporting-evidence'),
    });
  }

  return evidence;
}

function normalizeAuditEvents(candidate) {
  const events = Array.isArray(candidate?.auditEvents) ? candidate.auditEvents : [];
  return events.slice(-40).reverse().map((event) => ({
    eventId: safeString(event.eventId),
    action: safeString(event.action),
    actor: safeString(event.actor),
    role: safeString(event.role),
    summary: compactText(event.summary, 300),
    metadata: event.metadata && typeof event.metadata === 'object' ? event.metadata : {},
    createdAt: toIso(event.createdAt),
  }));
}

function normalizeRelationships(candidate) {
  const relationships = Array.isArray(candidate?.relationships) ? candidate.relationships : [];
  return relationships.slice(0, 40).map((item) => ({
    type: safeString(item.type, 'related'),
    targetRecordId: safeString(item.targetRecordId),
    targetKnowledgeCandidateId: item.targetKnowledgeCandidateId ? safeString(item.targetKnowledgeCandidateId) : null,
    strength: clampConfidence(item.strength),
    status: safeString(item.status, 'proposed'),
    summary: compactText(item.summary, 300),
    evidence: normalizeStringArray(item.evidence, 8),
    proposedBy: safeString(item.proposedBy),
    reviewedBy: safeString(item.reviewedBy),
    createdAt: toIso(item.createdAt),
    reviewedAt: toIso(item.reviewedAt),
  }));
}

function normalizeOutcomeFeedback(candidate) {
  const feedback = Array.isArray(candidate?.outcomeFeedback) ? candidate.outcomeFeedback : [];
  return feedback.slice(-30).reverse().map((item) => ({
    source: safeString(item.source, 'manual'),
    outcome: safeString(item.outcome, 'unknown'),
    notes: compactText(item.notes, 300),
    actor: safeString(item.actor),
    escalationId: item.escalationId ? safeString(item.escalationId) : null,
    createdAt: toIso(item.createdAt),
  }));
}

function normalizeActionRecommendations(candidate) {
  const actions = Array.isArray(candidate?.actionRecommendations) ? candidate.actionRecommendations : [];
  return actions.slice(0, 12).map((item) => ({
    action: compactText(item.action, 220),
    priority: safeString(item.priority, 'medium'),
    rationale: compactText(item.rationale, 300),
    createdAt: toIso(item.createdAt),
  }));
}

// Free-text fields on the NORMALIZED record that carry case/customer-derived
// content. When a record is redacted, all of them are masked on read.
// Deliberately NOT masked (governance/operational metadata, no case body):
// category, trust/review/outcome states, allowedUses, warnings, lineage,
// auditEvents (machine-generated summaries + field lists), redaction.notes
// (authored by the redactor to document the redaction), kbAgent.sourceSummary
// (machine-generated source counts).
const REDACTED_RECORD_TEXT_FIELDS = [
  'title',
  'customerGoal',
  'reportedProblem',
  'evidenceFromCase',
  'troubleshootingTried',
  'confirmedCause',
  'finalOutcome',
  'invEscalationStatus',
  'summary',
  'symptom',
  'rootCause',
  'exactFix',
  'escalationPath',
  'reviewNotes',
  'deprecatedReason',
];
const REDACTED_RECORD_ARRAY_FIELDS = ['keySignals', 'importantBoundaries'];

// Single masking chokepoint for normalized records. Evidence entries are
// masked in buildCandidateEvidence (which sees the same redaction flag);
// everything else free-text is masked here. The stored document is untouched.
function applyRedactionMaskToRecord(record) {
  for (const field of REDACTED_RECORD_TEXT_FIELDS) {
    record[field] = maskRedactedText(record[field]);
  }
  for (const field of REDACTED_RECORD_ARRAY_FIELDS) {
    record[field] = maskRedactedStringArray(record[field]);
  }
  record.scope = {
    ...record.scope,
    appliesTo: maskRedactedStringArray(record.scope?.appliesTo),
    excludes: maskRedactedStringArray(record.scope?.excludes),
    versionNotes: maskRedactedText(record.scope?.versionNotes),
    customerScope: maskRedactedText(record.scope?.customerScope),
  };
  record.relationships = (record.relationships || []).map((item) => ({
    ...item,
    summary: maskRedactedText(item.summary),
    evidence: maskRedactedStringArray(item.evidence),
  }));
  record.outcomeFeedback = (record.outcomeFeedback || []).map((item) => ({
    ...item,
    notes: maskRedactedText(item.notes),
  }));
  record.actionRecommendations = (record.actionRecommendations || []).map((item) => ({
    ...item,
    action: maskRedactedText(item.action),
    rationale: maskRedactedText(item.rationale),
  }));
  return record;
}

function normalizeKnowledgeCandidate(candidate) {
  const source = candidate?.toObject ? candidate.toObject() : (candidate || {});
  const trustState = deriveTrustState(source);
  const allowedUses = deriveAllowedUses(source);
  const warnings = buildWarnings(source, trustState, allowedUses);

  const record = {
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
    customerGoal: compactText(source.customerGoal || source.sourceSnapshot?.attemptingTo, 700),
    reportedProblem: compactText(source.reportedProblem || source.symptom || source.sourceSnapshot?.actualOutcome, 700),
    evidenceFromCase: compactText(source.evidenceFromCase, 1200),
    troubleshootingTried: compactText(source.troubleshootingTried || source.sourceSnapshot?.tsSteps, 1200),
    confirmedCause: compactText(source.confirmedCause || source.rootCause, 700),
    finalOutcome: compactText(source.finalOutcome || source.exactFix || source.escalationPath, 1400),
    invEscalationStatus: compactText(source.invEscalationStatus, 700),
    importantBoundaries: normalizeStringArray(source.importantBoundaries || source.scope?.excludes, 12),
    summary: compactText(source.summary, 700),
    symptom: compactText(source.symptom || source.reportedProblem, 700),
    rootCause: compactText(source.rootCause || source.confirmedCause, 700),
    exactFix: compactText(source.exactFix || source.finalOutcome, 1400),
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
      reviewedBy: safeString(source.reviewedBy, ''),
      reviewedAt: toIso(source.reviewedAt),
      deprecatedAt: toIso(source.deprecatedAt),
    },
    reviewNotes: compactText(source.reviewNotes, 500),
    reviewedBy: safeString(source.reviewedBy, ''),
    reviewedAt: toIso(source.reviewedAt),
    deprecatedAt: toIso(source.deprecatedAt),
    deprecatedReason: compactText(source.deprecatedReason, 500),
    supersededBy: source.supersededBy ? `candidate:${safeString(source.supersededBy)}` : null,
    trustStateOverride: safeString(source.trustStateOverride, ''),
    allowedUsesOverride: Array.isArray(source.allowedUsesOverride) ? source.allowedUsesOverride : [],
    scope: {
      appliesTo: normalizeStringArray(source.scope?.appliesTo, 12),
      excludes: normalizeStringArray(source.scope?.excludes, 12),
      versionNotes: compactText(source.scope?.versionNotes, 500),
      customerScope: compactText(source.scope?.customerScope, 240),
      lastValidatedAt: toIso(source.scope?.lastValidatedAt),
    },
    redaction: {
      customerIdentifiersRedacted: Boolean(source.redaction?.customerIdentifiersRedacted),
      fields: normalizeStringArray(source.redaction?.fields, 16),
      notes: compactText(source.redaction?.notes, 300),
      redactedBy: safeString(source.redaction?.redactedBy, ''),
      redactedAt: toIso(source.redaction?.redactedAt),
    },
    relationships: normalizeRelationships(source),
    actionRecommendations: normalizeActionRecommendations(source),
    outcomeFeedback: normalizeOutcomeFeedback(source),
    auditEvents: normalizeAuditEvents(source),
    // Per-record creation provenance (empty generator = legacy record created
    // before provenance was persisted; the client renders an honest reduced
    // line for those instead of substituting current agent config).
    generation: {
      generator: safeString(source.generation?.generator, ''),
      agentId: safeString(source.generation?.agentId, ''),
      provider: safeString(source.generation?.provider, ''),
      model: safeString(source.generation?.model, ''),
      reasoningEffort: safeString(source.generation?.reasoningEffort, ''),
      // Back link to the captured ProviderCallPackage of the extraction call
      // (empty for deterministic/legacy records) — lets a future UI jump from
      // a draft to its forensic provider evidence.
      providerCallPackageId: safeString(source.generation?.providerCallPackageId, ''),
    },
    kbAgent: {
      promptId: safeString(source.kbAgent?.promptId),
      promptVersion: safeString(source.kbAgent?.promptVersion),
      promptSha256: safeString(source.kbAgent?.promptSha256),
      sourceSummary: compactText(source.kbAgent?.sourceSummary, 500),
      sourceCounts: source.kbAgent?.sourceCounts && typeof source.kbAgent.sourceCounts === 'object'
        ? source.kbAgent.sourceCounts
        : {},
      workflowAgents: normalizeStringArray(source.kbAgent?.workflowAgents, 20),
      lastBuiltAt: toIso(source.kbAgent?.lastBuiltAt),
      messageCount: Array.isArray(source.kbAgentMessages) ? source.kbAgentMessages.length : 0,
      lastMessageAt: Array.isArray(source.kbAgentMessages) && source.kbAgentMessages.length
        ? toIso(source.kbAgentMessages[source.kbAgentMessages.length - 1]?.createdAt)
        : null,
    },
    needsReviewAfterRecovery: source.needsReviewAfterRecovery?.recoveryOperationId ? {
      recoveryOperationId: safeString(source.needsReviewAfterRecovery.recoveryOperationId),
      markedAt: toIso(source.needsReviewAfterRecovery.markedAt),
      reason: compactText(source.needsReviewAfterRecovery.reason, 500),
    } : null,
    reviewedAfterRecovery: source.reviewedAfterRecovery?.recoveryOperationId ? {
      recoveryOperationId: safeString(source.reviewedAfterRecovery.recoveryOperationId),
      markedAt: toIso(source.reviewedAfterRecovery.markedAt),
      resolvedAt: toIso(source.reviewedAfterRecovery.resolvedAt),
      resolvedBy: safeString(source.reviewedAfterRecovery.resolvedBy),
      reason: compactText(source.reviewedAfterRecovery.reason, 500),
    } : null,
    recoveryReviewHistory: (Array.isArray(source.recoveryReviewHistory) ? source.recoveryReviewHistory : [])
      .slice(-40)
      .map((item) => ({
        recoveryOperationId: safeString(item.recoveryOperationId),
        markedAt: toIso(item.markedAt),
        reason: compactText(item.reason, 500),
        supersededAt: toIso(item.supersededAt),
        supersededByRecoveryOperationId: safeString(item.supersededByRecoveryOperationId),
      })),
    warnings,
    updatedAt: toIso(source.updatedAt),
  };

  return isRedactedCandidate(source) ? applyRedactionMaskToRecord(record) : record;
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
    // Redacted records are masked on read, so free-text matching against
    // their RAW stored content would let a caller confirm hidden content by
    // probing queries. Exclude them from text search entirely; they remain
    // visible in unqueried lists and by direct id.
    filter.$and = [
      { $or: clauses },
      { 'redaction.customerIdentifiersRedacted': { $ne: true } },
    ];
  }

  return filter;
}

function normalizeKnowledgeRecordId(value) {
  const text = safeString(value, '').trim();
  if (!text) return { sourceType: '', id: '' };
  if (text.startsWith('candidate:')) {
    return { sourceType: 'knowledge-candidate', id: text.slice('candidate:'.length) };
  }
  return { sourceType: 'knowledge-candidate', id: text };
}

function isLikelyObjectId(value) {
  return /^[a-f0-9]{24}$/i.test(safeString(value, '').trim());
}

function filterRecordForPolicy(record, {
  allowedUse = '',
  trustState = '',
  includeCandidates = true,
} = {}) {
  if (!record) return false;
  if (trustState && record.trustState !== trustState) return false;
  if (allowedUse && !record.allowedUses.includes(allowedUse)) return false;
  if (
    record.sourceType === 'knowledge-candidate'
    && (FINAL_AGENT_USES.has(allowedUse) || !includeCandidates)
    && (record.reviewStatus !== 'published' || record.trustState !== TRUST_STATES.TRUSTED)
  ) {
    return false;
  }
  if (!includeCandidates && ![
    TRUST_STATES.TRUSTED,
    TRUST_STATES.LEGACY_TRUSTED,
  ].includes(record.trustState)) {
    return false;
  }
  return true;
}

function applyPolicyQueryConstraints(filter, {
  allowedUse = '',
  trustState = '',
  includeCandidates = true,
} = {}) {
  const requestedOutcome = typeof filter.reusableOutcome === 'string'
    ? safeString(filter.reusableOutcome, '')
    : '';
  const shouldConstrainTrustedPolicy = !includeCandidates
    || trustState === TRUST_STATES.TRUSTED
    || FINAL_AGENT_USES.has(allowedUse);
  const requirePublished = () => {
    if (filter.reviewStatus && filter.reviewStatus !== 'published') {
      filter._id = null;
    } else {
      filter.reviewStatus = 'published';
    }
  };
  if (shouldConstrainTrustedPolicy) {
    requirePublished();
    filter.deprecatedAt = null;
    if (!requestedOutcome) {
      filter.reusableOutcome = { $ne: 'unsafe-to-reuse' };
    }
  }
  if (FINAL_AGENT_USES.has(allowedUse)) {
    if (requestedOutcome && !FINAL_AGENT_OUTCOMES.has(requestedOutcome)) {
      filter._id = null;
    } else {
      filter.reusableOutcome = requestedOutcome || { $in: [...FINAL_AGENT_OUTCOMES] };
    }
  }
  return filter;
}

async function getKnowledgeRecordById(recordId) {
  const parsed = normalizeKnowledgeRecordId(recordId);
  if (!parsed.id || parsed.sourceType !== 'knowledge-candidate' || !isLikelyObjectId(parsed.id) || !isKnowledgeCandidateDbReady()) {
    return null;
  }
  const doc = await KnowledgeCandidate.findById(parsed.id).lean();
  return doc ? normalizeKnowledgeCandidate(doc) : null;
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
  const policyOptions = {
    allowedUse: safeString(options.allowedUse, ''),
    trustState: safeString(options.trustState, ''),
    includeCandidates,
  };
  applyPolicyQueryConstraints(filter, policyOptions);
  const hasDerivedPolicyFilter = Boolean(
    policyOptions.allowedUse
    || policyOptions.trustState
    || !includeCandidates
  );

  if (!isKnowledgeCandidateDbReady()) {
    return emptyKnowledgeRecordPage({ limit, offset });
  }

  if (hasDerivedPolicyFilter) {
    const docs = await KnowledgeCandidate.find(filter)
      .sort(sort)
      .lean();
    const filtered = docs
      .map(normalizeKnowledgeCandidate)
      .filter((record) => filterRecordForPolicy(record, policyOptions));
    return {
      records: filtered.slice(offset, offset + limit),
      total: filtered.length,
      offset,
      limit,
    };
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
    .filter((record) => filterRecordForPolicy(record, policyOptions));

  return {
    records,
    total,
    offset,
    limit,
  };
}

// --- Relevance ranking (opt-in via rankByRelevance) -----------------------
// Default retrieval orders DB candidates by -updatedAt (recency), which lets
// recently touched but unrelated records crowd out genuinely relevant ones.
// When rankByRelevance is set, records are scored against the query terms and
// selected by match quality instead. Existing consumers that do not pass the
// flag keep the legacy recency behavior unchanged.

// Heavy fields are the operator-authored diagnostic core; a query term that
// hits one of these says far more about fit than a hit in snapshot prose.
const RELEVANCE_HEAVY_WEIGHT = 2;
const RELEVANCE_LIGHT_WEIGHT = 1;
const RELEVANCE_CLAIM_BOOST = 1;
const RELEVANCE_TRUST_BOOST = 1;
const RELEVANCE_CATEGORY_BOOST = 1;
// Legacy playbook chunks keep the lexical score computed by the playbook
// index (~1 point per matched query token plus small bonuses). A chunk that
// only grazes a single incidental term scores ~1 and is treated as noise.
const RELEVANCE_LEGACY_MIN_SCORE = 2;
// At most this many of the returned slots may be legacy-playbook records.
const RELEVANCE_LEGACY_CAP = 2;

// splitSearchTerms keeps short function words like "not" and "from" that the
// Mongo filter tolerates but that would poison match-quality scoring (raw
// substring checks would also let "not" hit "Notes"). Scoring drops them and
// matches whole tokens instead, like the playbook index does.
const RELEVANCE_TERM_STOPWORDS = new Set([
  'about', 'after', 'also', 'are', 'been', 'before', 'being', 'can', 'did',
  'does', 'from', 'had', 'has', 'have', 'here', 'into', 'its', 'just', 'not',
  'only', 'onto', 'our', 'than', 'that', 'them', 'then', 'there', 'they',
  'was', 'were', 'what', 'when', 'which', 'while', 'will', 'would', 'your',
]);

function relevanceTermsFromQuery(query) {
  return splitSearchTerms(query, 32).filter((term) => !RELEVANCE_TERM_STOPWORDS.has(term));
}

function relevanceTokens(values) {
  const tokens = new Set();
  for (const value of values) {
    for (const token of safeString(value, '').toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length >= 3) tokens.add(token);
    }
  }
  return tokens;
}

// Whole-token match, with a prefix allowance so "archive" still matches
// "archived". Terms under 4 chars (e.g. "cpp") must match a token exactly.
function termMatchesTokens(term, tokens) {
  if (tokens.has(term)) return true;
  if (term.length >= 4) {
    for (const token of tokens) {
      if (token.startsWith(term)) return true;
    }
  }
  return false;
}

function relevanceHaystacks(record) {
  const heavy = relevanceTokens([
    record.title,
    record.symptom,
    record.exactFix,
    ...(Array.isArray(record.keySignals) ? record.keySignals : []),
  ]);
  const light = relevanceTokens([
    record.summary,
    record.rootCause,
    record.escalationPath,
    record.customerGoal,
    record.reportedProblem,
    record.troubleshootingTried,
    record.confirmedCause,
    record.finalOutcome,
    record.category,
  ]);
  return { heavy, light };
}

function scoreRecordRelevance(record, terms, categoryHint = '') {
  const legacy = record?.sourceType === 'legacy-playbook';
  if (legacy) {
    // Legacy chunks already carry a term-overlap score from the playbook
    // search index — respect it rather than inventing a parallel scheme.
    // matchedTerms is recomputed against the chunk text purely so the trace
    // can show WHY the chunk was kept.
    const haystack = [record.title, record.exactFix]
      .map((value) => safeString(value, '')).join('\n').toLowerCase();
    const matchedTerms = terms.filter((term) => haystack.includes(term)).length;
    const score = Number(record.lineage?.score) || 0;
    return {
      score: Number(score.toFixed(3)),
      matchedTerms,
      claimBoost: 0,
      trustBoost: 0,
      categoryBoost: 0,
      legacy: true,
    };
  }

  const { heavy, light } = relevanceHaystacks(record);
  let termScore = 0;
  let matchedTerms = 0;
  for (const term of terms) {
    if (termMatchesTokens(term, heavy)) {
      termScore += RELEVANCE_HEAVY_WEIGHT;
      matchedTerms += 1;
    } else if (termMatchesTokens(term, light)) {
      termScore += RELEVANCE_LIGHT_WEIGHT;
      matchedTerms += 1;
    }
  }
  if (matchedTerms === 0) {
    return { score: 0, matchedTerms: 0, claimBoost: 0, trustBoost: 0, categoryBoost: 0, legacy: false };
  }

  // Records that contribute vetted operational facts (an exact fix, a root
  // cause, an escalation path, or key signals — the fields that sync into
  // operational claims) earn a boost over narrative-only records.
  const claimBoost = (
    compactText(record.exactFix)
    || compactText(record.rootCause)
    || compactText(record.escalationPath)
    || (Array.isArray(record.keySignals) && record.keySignals.length > 0)
  ) ? RELEVANCE_CLAIM_BOOST : 0;
  const trustBoost = record.trustState === TRUST_STATES.TRUSTED ? RELEVANCE_TRUST_BOOST : 0;
  // 'unknown' is the classifier sentinel AND the normalized-record default
  // category — never let unknown==unknown count as a category match.
  const hint = safeString(categoryHint, '').trim().toLowerCase();
  const recordCategory = safeString(record.category, '').trim().toLowerCase();
  const categoryBoost = (hint && hint !== 'unknown' && hint === recordCategory)
    ? RELEVANCE_CATEGORY_BOOST
    : 0;

  return {
    score: termScore + claimBoost + trustBoost + categoryBoost,
    matchedTerms,
    claimBoost,
    trustBoost,
    categoryBoost,
    legacy: false,
  };
}

function rankKnowledgeRecords(records, { terms = [], limit = 5, categoryHint = '' } = {}) {
  const scored = [];
  for (const record of records) {
    const relevance = scoreRecordRelevance(record, terms, categoryHint);
    if (relevance.legacy) {
      // Usefulness gate (legacy): the playbook index score must clear a
      // minimal bar, otherwise the chunk only grazed incidental terms.
      if (relevance.score < RELEVANCE_LEGACY_MIN_SCORE) continue;
    } else if (relevance.matchedTerms === 0) {
      // Usefulness gate (governed): zero meaningful term matches means the
      // record only matched masked/snapshot noise — never pad with it.
      continue;
    }
    scored.push({ ...record, relevance });
  }

  scored.sort((a, b) => {
    if (b.relevance.score !== a.relevance.score) return b.relevance.score - a.relevance.score;
    // Equal score: governed records are never displaced by legacy ones.
    if (a.relevance.legacy !== b.relevance.legacy) return a.relevance.legacy ? 1 : -1;
    // Final tie-break: recency. Legacy chunks have no updatedAt and sort last.
    return safeString(b.updatedAt, '').localeCompare(safeString(a.updatedAt, ''));
  });

  const out = [];
  const legacyCap = Math.min(RELEVANCE_LEGACY_CAP, limit);
  let legacyCount = 0;
  for (const record of scored) {
    if (out.length >= limit) break;
    if (record.relevance.legacy) {
      if (legacyCount >= legacyCap) continue;
      legacyCount += 1;
    }
    out.push(record);
  }
  return out;
}

async function searchKnowledge(options = {}) {
  const limit = parseLimit(options.limit, 10, 50);
  const includeLegacy = parseBoolean(options.includeLegacy, true);
  const includeCandidates = parseBoolean(options.includeCandidates, true);
  const query = safeString(options.query, '').trim();
  const terms = parseBoolean(options.rankByRelevance, false) ? relevanceTermsFromQuery(query) : [];
  const ranking = terms.length > 0;
  // When ranking, pull a wider candidate pool so relevant records that are
  // not the most recently updated still reach the scorer.
  const poolLimit = ranking ? Math.max(limit * 5, 25) : limit;

  const dbResult = await listKnowledgeRecords({
    ...options,
    query,
    limit: poolLimit,
    offset: 0,
    includeCandidates,
  });

  let legacyRecords = [];
  if (includeLegacy && query) {
    legacyRecords = searchPlaybookChunks(query, {
      topK: ranking ? Math.max(limit * 2, 10) : limit,
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

  const records = ranking
    ? rankKnowledgeRecords([...dbResult.records, ...legacyRecords], {
      terms,
      limit,
      categoryHint: safeString(options.categoryHint, ''),
    })
    : [...dbResult.records, ...legacyRecords].slice(0, limit);
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
    customerGoal: record.customerGoal,
    reportedProblem: record.reportedProblem,
    evidenceFromCase: record.evidenceFromCase,
    troubleshootingTried: record.troubleshootingTried,
    confirmedCause: record.confirmedCause,
    finalOutcome: record.finalOutcome,
    invEscalationStatus: record.invEscalationStatus,
    importantBoundaries: record.importantBoundaries,
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
    // Present only when rankByRelevance ranking ran — existing consumers that
    // do not opt in see an unchanged record shape.
    ...(record.relevance ? { relevance: record.relevance } : {}),
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
          [TRUST_STATES.RESTRICTED]: 0,
          [TRUST_STATES.DEPRECATED]: 0,
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

  // Trust-state counts MUST come from deriveTrustState — the same single
  // source of truth every read path uses — so each record lands in exactly
  // ONE bucket. The previous version mapped reviewStatus buckets straight
  // onto trust states (counting published-but-unsafe records as TRUSTED) and
  // layered overlapping countDocuments on top (double-booking restricted and
  // deprecated records). One projection over the governance fields keeps all
  // four breakdowns and the total consistent by construction.
  const docs = await KnowledgeCandidate.find({})
    .select('reviewStatus reusableOutcome publishTarget deprecatedAt trustStateOverride')
    .lean();

  const byReviewStatus = {};
  const byReusableOutcome = {};
  const byPublishTarget = {};
  const trustState = {
    [TRUST_STATES.CANDIDATE]: 0,
    [TRUST_STATES.REVIEWED]: 0,
    [TRUST_STATES.TRUSTED]: 0,
    [TRUST_STATES.REJECTED]: 0,
    [TRUST_STATES.RESTRICTED]: 0,
    [TRUST_STATES.DEPRECATED]: 0,
  };

  for (const doc of docs) {
    const reviewStatus = safeString(doc.reviewStatus, '') || 'unknown';
    const reusableOutcome = safeString(doc.reusableOutcome, '') || 'unknown';
    const publishTarget = safeString(doc.publishTarget, '') || 'unknown';
    byReviewStatus[reviewStatus] = (byReviewStatus[reviewStatus] || 0) + 1;
    byReusableOutcome[reusableOutcome] = (byReusableOutcome[reusableOutcome] || 0) + 1;
    byPublishTarget[publishTarget] = (byPublishTarget[publishTarget] || 0) + 1;
    const derived = deriveTrustState(doc);
    trustState[derived] = (trustState[derived] || 0) + 1;
  }

  return {
    candidates: {
      total: docs.length,
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
  REDACTION_MASK,
  TRUST_STATES,
  buildAgentKnowledgeContext,
  deriveAllowedUses,
  deriveTrustState,
  getKnowledgeRecordById,
  getKnowledgeSummary,
  listKnowledgeRecords,
  normalizeKnowledgeCandidate,
  normalizeKnowledgeRecordId,
  normalizePlaybookChunk,
  isKnowledgeCandidateDbReady,
  parseBoolean,
  parseLimit,
  parseOffset,
  rankKnowledgeRecords,
  scoreRecordRelevance,
  searchKnowledge,
};
