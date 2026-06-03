'use strict';

const Escalation = require('../models/Escalation');
const EscalationAttentionItem = require('../models/EscalationAttentionItem');
const KnowledgeCandidate = require('../models/KnowledgeCandidate');
const { recordAgentActivity } = require('./agent-identity-service');

const KNOWLEDGEBASE_AGENT_ID = 'knowledgebase-agent';
const FINALIZED_ESCALATION_STATUSES = ['resolved', 'escalated-further'];
const REVIEWABLE_CANDIDATE_STATUSES = ['draft', 'rejected'];
const TRUSTED_REUSABLE_OUTCOMES = ['canonical', 'edge-case'];
const DEFAULT_SCAN_LIMIT = 100;
const DEFAULT_STALE_TRUSTED_DAYS = 180;
const LOW_CONFIDENCE_THRESHOLD = 0.55;
const DAY_MS = 24 * 60 * 60 * 1000;

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function compactText(value, maxChars = 300) {
  const text = safeString(value, '').replace(/\s+/g, ' ').trim();
  if (!text || text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function clampNumber(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function parseScanLimit(value, fallback = DEFAULT_SCAN_LIMIT) {
  return clampNumber(Number.parseInt(value, 10), fallback, 1, 500);
}

function parseStaleTrustedDays(value, fallback = DEFAULT_STALE_TRUSTED_DAYS) {
  return clampNumber(Number.parseInt(value, 10), fallback, 1, 3650);
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
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

function isModelReady(model) {
  return Boolean(model && model.db && model.db.readyState === 1);
}

function isKnowledgebaseAgentDbReady() {
  return isModelReady(Escalation)
    && isModelReady(KnowledgeCandidate)
    && isModelReady(EscalationAttentionItem);
}

function labelEscalation(escalation = {}) {
  const caseNumber = compactText(escalation.caseNumber, 80);
  if (caseNumber) return `case ${caseNumber}`;
  const coid = compactText(escalation.coid, 80);
  if (coid) return `COID ${coid}`;
  const category = compactText(escalation.category, 80);
  if (category) return `${category} escalation`;
  return 'This escalation';
}

function buildEscalationEvidence(escalation = {}) {
  return [{
    type: 'escalation',
    id: objectIdString(escalation._id),
    label: labelEscalation(escalation),
    status: safeString(escalation.status),
    category: safeString(escalation.category),
    caseNumber: safeString(escalation.caseNumber),
    coid: safeString(escalation.coid),
    resolvedAt: toIso(escalation.resolvedAt),
    fieldsPresent: [
      escalation.attemptingTo ? 'attemptingTo' : '',
      escalation.actualOutcome ? 'actualOutcome' : '',
      escalation.tsSteps ? 'tsSteps' : '',
      escalation.resolution ? 'resolution' : '',
      escalation.resolutionNotes ? 'resolutionNotes' : '',
    ].filter(Boolean),
  }];
}

function buildCandidateEvidence(candidate = {}) {
  const snapshot = candidate.sourceSnapshot || {};
  return [{
    type: 'knowledge-candidate',
    id: objectIdString(candidate._id),
    label: compactText(candidate.title, 120) || 'Knowledge candidate',
    reviewStatus: safeString(candidate.reviewStatus),
    reusableOutcome: safeString(candidate.reusableOutcome),
    category: safeString(candidate.category),
    escalationId: objectIdString(candidate.escalationId),
  }, {
    type: 'source-snapshot',
    id: objectIdString(candidate.escalationId),
    label: snapshot.caseNumber ? `Case ${snapshot.caseNumber}` : 'Source escalation snapshot',
    status: safeString(snapshot.status),
    category: safeString(snapshot.category || candidate.category),
    caseNumber: safeString(snapshot.caseNumber),
    resolvedAt: toIso(snapshot.resolvedAt),
    fieldsPresent: [
      snapshot.attemptingTo ? 'attemptingTo' : '',
      snapshot.actualOutcome ? 'actualOutcome' : '',
      snapshot.resolution ? 'resolution' : '',
      snapshot.resolutionNotes ? 'resolutionNotes' : '',
    ].filter(Boolean),
  }];
}

function inferDraftTitle(escalation = {}) {
  const category = safeString(escalation.category, 'unknown');
  const symptom = compactText(escalation.actualOutcome || escalation.attemptingTo, 80);
  return symptom ? `${category}: ${symptom}` : `${category} resolved case learning`;
}

function recommendReusableOutcome({ candidate = null, escalation = null } = {}) {
  const rootCause = compactText(candidate && candidate.rootCause);
  const exactFix = compactText((candidate && candidate.exactFix) || (escalation && escalation.resolution));
  const escalationPath = compactText(candidate && candidate.escalationPath);
  const confidence = Number(candidate && candidate.confidence);
  const status = safeString((escalation && escalation.status) || (candidate && candidate.sourceSnapshot && candidate.sourceSnapshot.status));

  if (status === 'escalated-further' || (!exactFix && escalationPath)) {
    return 'edge-case';
  }
  if (rootCause && exactFix && (!Number.isFinite(confidence) || confidence >= 0.75)) {
    return 'canonical';
  }
  if (exactFix || compactText(escalation && escalation.resolutionNotes)) {
    return 'case-history-only';
  }
  return 'customer-specific';
}

function buildSuggestedDraft(escalation = {}) {
  return {
    title: inferDraftTitle(escalation),
    category: safeString(escalation.category, 'unknown') || 'unknown',
    summary: compactText(
      escalation.resolution || escalation.resolutionNotes || escalation.actualOutcome || escalation.attemptingTo,
      700
    ),
    symptom: compactText(escalation.actualOutcome || escalation.attemptingTo, 700),
    rootCause: '',
    exactFix: compactText(escalation.resolution || escalation.resolutionNotes, 1200),
    escalationPath: escalation.status === 'escalated-further'
      ? compactText(escalation.resolution || escalation.resolutionNotes, 700)
      : '',
    recommendedReusableOutcome: recommendReusableOutcome({ escalation }),
    confidence: escalation.resolution || escalation.resolutionNotes ? 0.55 : 0.35,
  };
}

function buildMissingDraftProposal(escalation = {}) {
  const escalationId = objectIdString(escalation._id);
  const label = labelEscalation(escalation);
  const suggestedDraft = buildSuggestedDraft(escalation);
  const fingerprint = `knowledge-review:${escalationId}`;
  return {
    id: `kb-agent:missing-draft:${escalationId}`,
    agentId: KNOWLEDGEBASE_AGENT_ID,
    type: 'missing-knowledge-draft',
    severity: 'warning',
    title: 'Finalized case needs a knowledge draft',
    summary: `${label} is finalized but has no knowledge candidate for review.`,
    sourceEvidence: buildEscalationEvidence(escalation),
    recommendedAction: 'Generate or review a draft before this case becomes reusable guidance.',
    suggestedDraft,
    attention: {
      fingerprint,
      sourceEscalationId: escalationId,
      sourceConversationId: objectIdString(escalation.conversationId) || null,
      sourceLabel: label,
      candidates: [],
      signals: [
        'knowledgebase_agent_missing_draft',
        `status_${safeString(escalation.status).replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
      ],
    },
    createdAt: new Date().toISOString(),
  };
}

function getCandidateQualityIssues(candidate = {}) {
  const issues = [];
  const snapshot = candidate.sourceSnapshot || {};
  const reviewStatus = safeString(candidate.reviewStatus, 'draft');
  const confidence = Number(candidate.confidence);
  const hasFixOrPath = Boolean(compactText(candidate.exactFix) || compactText(candidate.escalationPath));
  const hasEvidence = Boolean(
    compactText(snapshot.resolution)
    || compactText(snapshot.resolutionNotes)
    || compactText(snapshot.attemptingTo)
    || compactText(snapshot.actualOutcome)
    || snapshot.resolvedAt
  );

  if (reviewStatus === 'draft') issues.push('needs_human_review');
  if (reviewStatus === 'rejected' && !compactText(candidate.reviewNotes)) {
    issues.push('rejected_without_review_notes');
  }
  if (!compactText(candidate.summary)) issues.push('missing_summary');
  if (!compactText(candidate.symptom)) issues.push('missing_symptom');
  if (!compactText(candidate.rootCause)) issues.push('missing_root_cause');
  if (!hasFixOrPath) issues.push('missing_fix_or_escalation_path');
  if (Number.isFinite(confidence) && confidence > 0 && confidence < LOW_CONFIDENCE_THRESHOLD) {
    issues.push('low_confidence');
  }
  if (!hasEvidence) issues.push('weak_source_evidence');

  return [...new Set(issues)];
}

function buildAttentionCandidate(candidate = {}) {
  return {
    escalationId: candidate.escalationId,
    conversationId: candidate.conversationId || null,
    score: 1,
    confidence: 'medium',
    signals: ['knowledge_candidate_review'],
    status: safeString(candidate.reviewStatus),
    source: 'knowledge-candidate',
    coid: safeString(candidate.sourceSnapshot && candidate.sourceSnapshot.coid),
    caseNumber: safeString(candidate.sourceSnapshot && candidate.sourceSnapshot.caseNumber),
    category: safeString(candidate.category),
    attemptingToPreview: compactText(candidate.sourceSnapshot && candidate.sourceSnapshot.attemptingTo, 160),
    actualOutcomePreview: compactText(
      candidate.symptom || (candidate.sourceSnapshot && candidate.sourceSnapshot.actualOutcome),
      160
    ),
    createdAt: candidate.createdAt || null,
  };
}

function buildCandidateQualityProposal(candidate = {}) {
  const issues = getCandidateQualityIssues(candidate);
  if (issues.length === 0) return null;

  const escalationId = objectIdString(candidate.escalationId);
  if (!escalationId) return null;

  const label = compactText(candidate.sourceSnapshot && candidate.sourceSnapshot.caseNumber, 80)
    ? `case ${candidate.sourceSnapshot.caseNumber}`
    : compactText(candidate.title, 80) || 'Knowledge candidate';
  const fingerprint = `knowledge-review:${escalationId}`;
  const reviewStatus = safeString(candidate.reviewStatus, 'draft') || 'draft';
  const isRejectedWithoutNotes = issues.includes('rejected_without_review_notes');

  return {
    id: `kb-agent:candidate-quality:${objectIdString(candidate._id)}`,
    agentId: KNOWLEDGEBASE_AGENT_ID,
    type: isRejectedWithoutNotes ? 'rejected-candidate-needs-notes' : 'candidate-quality-review',
    severity: issues.some((issue) => issue === 'weak_source_evidence' || issue === 'missing_fix_or_escalation_path')
      ? 'warning'
      : 'info',
    title: isRejectedWithoutNotes ? 'Rejected knowledge needs notes' : 'Knowledge candidate needs quality review',
    summary: `${label} has a ${reviewStatus} knowledge candidate flagged for ${issues.join(', ')}.`,
    sourceEvidence: buildCandidateEvidence(candidate),
    recommendedAction: 'Review the candidate, fill missing fields, and approve/reject/publish only after source evidence is clear.',
    recommendedReusableOutcome: recommendReusableOutcome({ candidate }),
    candidateId: objectIdString(candidate._id),
    qualityIssues: issues,
    attention: {
      fingerprint,
      sourceEscalationId: escalationId,
      sourceConversationId: objectIdString(candidate.conversationId) || null,
      sourceLabel: label,
      candidates: [],
      signals: [
        'knowledgebase_agent_candidate_quality',
        `review_status_${reviewStatus.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
        ...issues,
      ],
    },
    createdAt: new Date().toISOString(),
  };
}

function normalizeDuplicateKey(candidate = {}) {
  const category = safeString(candidate.category, 'unknown').toLowerCase();
  const text = safeString(candidate.symptom || candidate.title || candidate.summary, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .filter((token) => !['draft', 'case', 'issue', 'with', 'from', 'that', 'this', 'customer'].includes(token))
    .slice(0, 10)
    .join('-');
  if (!text || text.length < 12) return '';
  return `${category}:${text}`;
}

function duplicateFingerprint(duplicateKey) {
  return `knowledge-review:duplicate:${duplicateKey}`.slice(0, 240);
}

function buildDuplicateProposal(duplicateKey, candidates = []) {
  const usable = candidates
    .filter((candidate) => candidate && candidate.escalationId)
    .slice(0, 6);
  if (usable.length < 2) return null;

  const first = usable[0];
  const fingerprint = duplicateFingerprint(duplicateKey);
  const title = compactText(first.title || first.symptom || 'Potential duplicate knowledge candidates', 120);
  return {
    id: `kb-agent:duplicate:${duplicateKey}`,
    agentId: KNOWLEDGEBASE_AGENT_ID,
    type: 'duplicate-candidate-review',
    severity: 'info',
    title: 'Potential duplicate knowledge candidates',
    summary: `${usable.length} knowledge candidates appear to describe the same ${safeString(first.category, 'unknown')} issue: ${title}.`,
    sourceEvidence: usable.flatMap(buildCandidateEvidence).slice(0, 12),
    recommendedAction: 'Compare the candidates and merge, reject, or scope them so agents do not receive conflicting guidance.',
    duplicateKey,
    candidateIds: usable.map((candidate) => objectIdString(candidate._id)).filter(Boolean),
    attention: {
      fingerprint,
      sourceEscalationId: objectIdString(first.escalationId),
      sourceConversationId: objectIdString(first.conversationId) || null,
      sourceLabel: 'Potential duplicate knowledge',
      candidates: usable.map(buildAttentionCandidate),
      signals: ['knowledgebase_agent_duplicate_candidates', `duplicate_count_${usable.length}`],
    },
    createdAt: new Date().toISOString(),
  };
}

function getCandidateAgeDays(candidate = {}, now = Date.now()) {
  const date = candidate.publishedAt || candidate.updatedAt || candidate.createdAt;
  const time = new Date(date || 0).getTime();
  if (!time) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now - time) / DAY_MS));
}

function buildStaleTrustedProposal(candidate = {}, staleTrustedDays = DEFAULT_STALE_TRUSTED_DAYS, now = Date.now()) {
  const escalationId = objectIdString(candidate.escalationId);
  if (!escalationId) return null;
  const ageDays = getCandidateAgeDays(candidate, now);
  if (ageDays < staleTrustedDays) return null;

  const candidateId = objectIdString(candidate._id);
  const title = compactText(candidate.title || candidate.symptom || 'Trusted knowledge record', 120);
  return {
    id: `kb-agent:stale-trusted:${candidateId}`,
    agentId: KNOWLEDGEBASE_AGENT_ID,
    type: 'stale-trusted-review',
    severity: 'info',
    title: 'Trusted knowledge may be stale',
    summary: `${title} has been trusted for ${Number.isFinite(ageDays) ? `${ageDays} days` : 'an unknown age'} and should be rechecked.`,
    sourceEvidence: buildCandidateEvidence(candidate),
    recommendedAction: 'Reconfirm the trusted guidance against current QBO behavior before agents keep relying on it.',
    candidateId,
    staleDays: Number.isFinite(ageDays) ? ageDays : null,
    staleTrustedDays,
    attention: {
      fingerprint: `knowledge-review:stale:${candidateId}`,
      sourceEscalationId: escalationId,
      sourceConversationId: objectIdString(candidate.conversationId) || null,
      sourceLabel: title,
      candidates: [],
      signals: [
        'knowledgebase_agent_stale_trusted',
        `stale_threshold_${staleTrustedDays}_days`,
        `reusable_outcome_${safeString(candidate.reusableOutcome).replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
      ],
    },
    createdAt: new Date().toISOString(),
  };
}

async function findMissingDraftProposals(limit) {
  const escalations = await Escalation.find({
    status: { $in: FINALIZED_ESCALATION_STATUSES },
    $or: [
      { resolution: /\S/ },
      { resolutionNotes: /\S/ },
      { resolvedAt: { $ne: null } },
    ],
  })
    .sort('-updatedAt')
    .limit(limit)
    .lean();

  if (escalations.length === 0) return [];

  const escalationIds = escalations.map((escalation) => escalation._id);
  const existing = await KnowledgeCandidate.find(
    { escalationId: { $in: escalationIds } },
    { escalationId: 1 }
  ).lean();
  const withCandidate = new Set(existing.map((candidate) => objectIdString(candidate.escalationId)));

  return escalations
    .filter((escalation) => !withCandidate.has(objectIdString(escalation._id)))
    .map(buildMissingDraftProposal);
}

async function findCandidateQualityProposals(limit) {
  const candidates = await KnowledgeCandidate.find({
    reviewStatus: { $in: REVIEWABLE_CANDIDATE_STATUSES },
  })
    .sort('-updatedAt')
    .limit(limit)
    .lean();

  return candidates
    .map(buildCandidateQualityProposal)
    .filter(Boolean);
}

async function findDuplicateProposals(limit) {
  const candidates = await KnowledgeCandidate.find({
    reviewStatus: { $ne: 'rejected' },
  })
    .sort('-updatedAt')
    .limit(Math.min(limit * 4, 1000))
    .lean();

  const groups = new Map();
  for (const candidate of candidates) {
    const key = normalizeDuplicateKey(candidate);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(candidate);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length >= 2)
    .slice(0, limit)
    .map(([key, group]) => buildDuplicateProposal(key, group))
    .filter(Boolean);
}

async function findStaleTrustedProposals(limit, staleTrustedDays, now = Date.now()) {
  const cutoff = new Date(now - staleTrustedDays * DAY_MS);
  const candidates = await KnowledgeCandidate.find({
    reviewStatus: 'published',
    reusableOutcome: { $in: TRUSTED_REUSABLE_OUTCOMES },
    $or: [
      { publishedAt: { $lt: cutoff } },
      { publishedAt: null, updatedAt: { $lt: cutoff } },
    ],
  })
    .sort('publishedAt updatedAt')
    .limit(limit)
    .lean();

  return candidates
    .map((candidate) => buildStaleTrustedProposal(candidate, staleTrustedDays, now))
    .filter(Boolean);
}

function attentionMetadataForProposal(proposal = {}) {
  return {
    agentId: KNOWLEDGEBASE_AGENT_ID,
    proposalId: proposal.id,
    proposalType: proposal.type,
    recommendedAction: proposal.recommendedAction,
    recommendedReusableOutcome: proposal.recommendedReusableOutcome || proposal.suggestedDraft?.recommendedReusableOutcome || '',
    qualityIssues: proposal.qualityIssues || [],
    candidateId: proposal.candidateId || '',
    candidateIds: proposal.candidateIds || [],
    duplicateKey: proposal.duplicateKey || '',
    staleDays: proposal.staleDays ?? null,
    staleTrustedDays: proposal.staleTrustedDays ?? null,
    sourceEvidence: proposal.sourceEvidence || [],
    suggestedDraft: proposal.suggestedDraft || null,
  };
}

function summarizeAttentionItem(item) {
  if (!item) return null;
  const doc = typeof item.toObject === 'function' ? item.toObject() : item;
  return {
    id: objectIdString(doc._id),
    kind: safeString(doc.kind),
    status: safeString(doc.status),
    severity: safeString(doc.severity),
    fingerprint: safeString(doc.fingerprint),
  };
}

async function upsertProposalAttentionItem(proposal = {}) {
  const attention = proposal.attention || {};
  if (!attention.fingerprint || !attention.sourceEscalationId) {
    return { action: 'skipped', item: null };
  }

  const item = await EscalationAttentionItem.findOneAndUpdate(
    { fingerprint: attention.fingerprint },
    {
      $setOnInsert: {
        kind: 'knowledge-review',
        fingerprint: attention.fingerprint,
        sourceEscalationId: attention.sourceEscalationId,
        sourceType: 'agent',
      },
      $set: {
        status: 'open',
        resolvedAt: null,
        sourceConversationId: attention.sourceConversationId || null,
        sourceLabel: attention.sourceLabel || 'Knowledgebase Agent',
        severity: proposal.severity || 'info',
        title: proposal.title || 'Knowledgebase review proposal',
        summary: compactText(proposal.summary, 500),
        candidates: Array.isArray(attention.candidates) ? attention.candidates.slice(0, 12) : [],
        candidateCount: Array.isArray(attention.candidates) ? attention.candidates.length : 0,
        signals: Array.isArray(attention.signals) ? attention.signals.filter(Boolean).slice(0, 16) : [],
        metadata: attentionMetadataForProposal(proposal),
        lastDetectedAt: new Date(),
      },
      $inc: { occurrenceCount: 1 },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  return { action: 'opened', item: summarizeAttentionItem(item) };
}

async function persistProposalAttentionItems(proposals = []) {
  const results = [];
  for (const proposal of proposals) {
    results.push({
      proposalId: proposal.id,
      ...(await upsertProposalAttentionItem(proposal)),
    });
  }
  return {
    results,
    opened: results.filter((result) => result.action === 'opened').length,
    skipped: results.filter((result) => result.action === 'skipped').length,
  };
}

async function recordScanActivity(scan) {
  try {
    await recordAgentActivity(KNOWLEDGEBASE_AGENT_ID, {
      type: 'knowledgebase-scan',
      phase: scan.dryRun ? 'dry-run' : 'review-scan',
      status: scan.proposals.length ? 'review-needed' : 'ok',
      summary: scan.proposals.length
        ? `Knowledgebase scan found ${scan.proposals.length} review proposal${scan.proposals.length === 1 ? '' : 's'}.`
        : 'Knowledgebase scan found no review proposals.',
      detail: scan.proposals.slice(0, 12).map((proposal) => `${proposal.type}: ${proposal.summary}`).join('\n'),
      metadata: {
        scanId: scan.scanId,
        dryRun: scan.dryRun,
        counts: scan.counts,
        attention: scan.attention,
      },
    }, { surface: 'knowledgebase' });
    return { recorded: true, error: '' };
  } catch (err) {
    return { recorded: false, error: err.message || 'Failed to record agent activity.' };
  }
}

async function getKnowledgebaseAgentStatus() {
  const dbReady = isKnowledgebaseAgentDbReady();
  if (!dbReady) {
    return {
      agentId: KNOWLEDGEBASE_AGENT_ID,
      dbReady: false,
      capabilities: {
        missingDraftScan: true,
        candidateQualityScan: true,
        duplicateCandidateScan: true,
        staleTrustedScan: true,
        attentionItems: true,
        approvesKnowledge: false,
        publishesKnowledge: false,
      },
      counts: {
        finalizedEscalations: 0,
        candidates: 0,
        openKnowledgeReviewItems: 0,
      },
    };
  }

  const [finalizedEscalations, candidates, openKnowledgeReviewItems] = await Promise.all([
    Escalation.countDocuments({ status: { $in: FINALIZED_ESCALATION_STATUSES } }),
    KnowledgeCandidate.countDocuments({}),
    EscalationAttentionItem.countDocuments({ kind: 'knowledge-review', status: 'open' }),
  ]);

  return {
    agentId: KNOWLEDGEBASE_AGENT_ID,
    dbReady: true,
    profileRoute: `/api/agent-identities/${KNOWLEDGEBASE_AGENT_ID}`,
    scanRoute: '/api/knowledge/agent/scan',
    capabilities: {
      missingDraftScan: true,
      candidateQualityScan: true,
      duplicateCandidateScan: true,
      staleTrustedScan: true,
      attentionItems: true,
      approvesKnowledge: false,
      publishesKnowledge: false,
    },
    counts: {
      finalizedEscalations,
      candidates,
      openKnowledgeReviewItems,
    },
  };
}

async function scanKnowledgebaseAgent(options = {}) {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const limit = parseScanLimit(options.limit);
  const staleTrustedDays = parseStaleTrustedDays(options.staleTrustedDays);
  const dryRun = options.dryRun === true;
  const persistAttention = options.persistAttention !== false && !dryRun;
  const persistActivity = options.persistActivity !== false && !dryRun;
  const scanId = `kb-scan-${started.toString(36)}`;

  if (!isKnowledgebaseAgentDbReady()) {
    const completedAt = new Date().toISOString();
    return {
      agentId: KNOWLEDGEBASE_AGENT_ID,
      scanId,
      status: 'skipped',
      dbReady: false,
      dryRun,
      startedAt,
      completedAt,
      durationMs: Date.now() - started,
      limit,
      staleTrustedDays,
      counts: {
        missingDraft: 0,
        candidateQuality: 0,
        duplicateCandidate: 0,
        staleTrusted: 0,
        proposals: 0,
      },
      proposals: [],
      attention: { opened: 0, skipped: 0, results: [] },
      activity: { recorded: false, error: 'MongoDB is not connected.' },
      warning: 'Knowledgebase agent scan skipped because MongoDB is not connected.',
    };
  }

  const [
    missingDraftProposals,
    candidateQualityProposals,
    duplicateProposals,
    staleTrustedProposals,
  ] = await Promise.all([
    findMissingDraftProposals(limit),
    findCandidateQualityProposals(limit),
    findDuplicateProposals(limit),
    findStaleTrustedProposals(limit, staleTrustedDays, started),
  ]);

  const proposals = [
    ...missingDraftProposals,
    ...candidateQualityProposals,
    ...duplicateProposals,
    ...staleTrustedProposals,
  ];
  const attention = persistAttention
    ? await persistProposalAttentionItems(proposals)
    : { opened: 0, skipped: 0, results: [] };

  const completedAt = new Date().toISOString();
  const scan = {
    agentId: KNOWLEDGEBASE_AGENT_ID,
    scanId,
    status: proposals.length ? 'review-needed' : 'ok',
    dbReady: true,
    dryRun,
    startedAt,
    completedAt,
    durationMs: Date.now() - started,
    limit,
    staleTrustedDays,
    counts: {
      missingDraft: missingDraftProposals.length,
      candidateQuality: candidateQualityProposals.length,
      duplicateCandidate: duplicateProposals.length,
      staleTrusted: staleTrustedProposals.length,
      proposals: proposals.length,
    },
    proposals,
    attention,
    activity: { recorded: false, error: '' },
  };

  if (persistActivity) {
    scan.activity = await recordScanActivity(scan);
  }

  return scan;
}

module.exports = {
  KNOWLEDGEBASE_AGENT_ID,
  buildCandidateQualityProposal,
  buildDuplicateProposal,
  buildMissingDraftProposal,
  buildStaleTrustedProposal,
  getCandidateQualityIssues,
  getKnowledgebaseAgentStatus,
  isKnowledgebaseAgentDbReady,
  normalizeDuplicateKey,
  parseScanLimit,
  parseStaleTrustedDays,
  recommendReusableOutcome,
  scanKnowledgebaseAgent,
};
