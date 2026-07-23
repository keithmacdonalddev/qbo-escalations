'use strict';

const { createHash, randomUUID } = require('node:crypto');
const Conversation = require('../models/Conversation');
const KnowledgeCandidate = require('../models/KnowledgeCandidate');
const RecoveryOperation = require('../models/RecoveryOperation');
const TriageResult = require('../models/TriageResult');
const { parseEscalationText } = require('../lib/escalation-parser');
const {
  EVIDENCE_CONTRACT_VERSION,
  evidenceAcknowledgementFingerprintMatches,
} = require('../lib/evidence-completeness');
const { compareTriageCards } = require('../lib/triage-recovery-compare');
const { getConversationEvidence } = require('./chat-conversation-service');
const { listAgentRuntimeDefaults } = require('./agent-identity-service');
const { resolveAgentBackup } = require('./agent-failover');
const { getProviderHealth } = require('./provider-health');
const { resolveApiKey } = require('./image-parser');
const {
  DIRECT_TRIAGE_PROVIDERS,
  TRIAGE_AGENT_ID,
  getEffectiveModel,
  peekPreflightCache,
  runTriage,
} = require('./triage');

const TRIAGE_RECOVERY_CODES = new Set(['TRIAGE_CARD', 'TRIAGE_RUN', 'TRIAGE_RESULT']);
const KEYED_PROVIDERS = new Set(['anthropic', 'openai', 'kimi', 'gemini']);
const URL_BASED_PROVIDERS = new Set(['llm-gateway', 'lm-studio']);
const ACTIVE_STATUSES = ['confirmed', 'running', 'cancel-requested', 'awaiting-acceptance'];
const RETRYABLE_TERMINAL_STATUSES = new Set(['failed', 'cancelled', 'interrupted']);
const TERMINAL_STATUSES = new Set([
  'succeeded',
  'succeeded-unverified',
  ...RETRYABLE_TERMINAL_STATUSES,
  'manual-review',
]);
const STALE_HEARTBEAT_MS = 3 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_PROGRESS_EVENTS = 50;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const inFlightOperations = new Map();

const PARSE_FIELD_KEYS = [
  'coid',
  'mid',
  'caseNumber',
  'clientContact',
  'agentName',
  'attemptingTo',
  'expectedOutcome',
  'actualOutcome',
  'kbToolsUsed',
  'triedTestAccount',
  'tsSteps',
  'category',
];

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

function clonePlain(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const raw = typeof value?.toObject === 'function' ? value.toObject() : value;
  try {
    return JSON.parse(JSON.stringify(raw));
  } catch {
    return fallback;
  }
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => safeString(value, '').trim())
    .filter(Boolean))];
}

function sanitizeFailureText(value, maxLength = 1000) {
  return safeString(value, '')
    .replace(/\b(Bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\b(api[_ -]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, maxLength);
}

function sanitizeOriginalEvidence(value) {
  const original = clonePlain(value, {}) || {};
  const failedRun = isObject(original.failedRun) ? original.failedRun : null;
  const runDetail = isObject(failedRun?.detail) ? failedRun.detail : {};
  const receipt = isObject(original.receipt) ? original.receipt : null;
  return {
    failureCode: safeString(original.failureCode, '').slice(0, 200),
    failureMessage: sanitizeFailureText(original.failureMessage),
    failedRun: failedRun ? {
      id: safeString(failedRun.id, ''),
      phase: safeString(failedRun.phase, ''),
      status: safeString(failedRun.status, ''),
      provider: safeString(failedRun.provider, ''),
      model: safeString(failedRun.model, ''),
      startedAt: failedRun.startedAt || null,
      completedAt: failedRun.completedAt || null,
      durationMs: failedRun.durationMs ?? null,
      summary: sanitizeFailureText(failedRun.summary, 500),
      traceId: safeString(failedRun.traceId, ''),
      resultId: safeString(runDetail.savedResultId || runDetail.resultId, ''),
      packageId: safeString(runDetail.providerPackageId || runDetail.packageId, ''),
      standaloneRunId: safeString(runDetail.standaloneRunId, ''),
    } : null,
    receipt: receipt ? {
      status: safeString(receipt.status, ''),
      attempted: Boolean(receipt.attempted),
      completed: Boolean(receipt.completed),
      failed: Boolean(receipt.failed),
      provider: safeString(receipt.provider, ''),
      model: safeString(receipt.model, ''),
      recordedAt: receipt.recordedAt || null,
      completedAt: receipt.completedAt || null,
      errorCode: safeString(receipt.errorCode || receipt.error?.code, '').slice(0, 200),
      errorMessage: sanitizeFailureText(receipt.errorMessage || receipt.error?.message),
      resultId: safeString(receipt.savedResultId, ''),
      standaloneRunId: safeString(receipt.standaloneRunId, ''),
      packageId: safeString(receipt.providerPackageId, ''),
      repairPackageId: safeString(receipt.repairPackageId, ''),
    } : null,
    resultId: safeString(original.resultId, ''),
    packageId: safeString(original.packageId, ''),
    traceIds: uniqueStrings(original.traceIds),
  };
}

const RECOVERY_GROUPS = [
  {
    id: 'no-cost',
    label: 'No-cost recoveries',
    description: 'Uses an already validated saved result and does not call the AI again.',
    order: 1,
  },
  {
    id: 'provider-call',
    label: 'Provider-call recoveries',
    description: 'Runs only the missing AI stage and may add provider cost.',
    order: 2,
  },
  {
    id: 'human-review',
    label: 'Human-review items',
    description: 'Cannot be recreated automatically without misrepresenting historical evidence.',
    order: 3,
  },
];

function recoveryGroupId(option) {
  if (option?.strategy === 'manual-review') return 'human-review';
  return option?.aiCallNeeded ? 'provider-call' : 'no-cost';
}

function finalizeRecoveryGroups(response) {
  const orderById = new Map(RECOVERY_GROUPS.map((group) => [group.id, group.order]));
  response.options = response.options
    .map((option, index) => {
      const group = recoveryGroupId(option);
      return { ...option, group, groupOrder: orderById.get(group), optionOrder: index + 1 };
    })
    .sort((left, right) => left.groupOrder - right.groupOrder || left.optionOrder - right.optionOrder);
  response.groups = RECOVERY_GROUPS.map((group) => ({
    ...group,
    optionPlanIds: response.options
      .filter((option) => option.group === group.id)
      .map((option) => option.planId),
  })).filter((group) => group.optionPlanIds.length > 0);
  return response;
}

function normalizeParseValue(key, value) {
  const text = safeString(value, '').replace(/\s+/g, ' ').trim();
  return key === 'category' || key === 'triedTestAccount' ? text.toLowerCase() : text;
}

function parseFieldsAgree(deterministicFields, savedFields) {
  if (!isObject(deterministicFields) || !isObject(savedFields) || Object.keys(savedFields).length === 0) return false;
  return PARSE_FIELD_KEYS.every((key) => (
    normalizeParseValue(key, deterministicFields[key]) === normalizeParseValue(key, savedFields[key])
  ));
}

function isUnexpiredTriageResult(result, now = new Date()) {
  if (!result) return false;
  if (!result.expiresAt) return true;
  const expiresAt = new Date(result.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}

function triageProviderIdentity(result) {
  return {
    provider: safeString(result?.providerUsed || result?.provider || result?.triageMeta?.providerUsed, '').trim(),
    model: safeString(result?.modelUsed || result?.model || result?.triageMeta?.model, '').trim(),
    providerPackageId: safeString(
      result?.providerPackageId || result?.triageMeta?.providerPackageId,
      ''
    ).trim(),
    failoverUsed: Boolean(result?.fallbackUsed && result?.status === 'success'),
    failoverFrom: safeString(result?.fallbackFrom, '').trim(),
  };
}

function isGenuineAiTriageResult(result) {
  if (!result || result.status !== 'success') return false;
  const triageSource = safeString(result.triageMeta?.source, '').trim().toLowerCase();
  const cardSource = safeString(result.card?.source, '').trim().toLowerCase();
  if (
    result.card?.fallback?.used
    || triageSource === 'fallback'
    || cardSource === 'rule-fallback'
    || cardSource === 'deterministic-fallback'
    || result.triageMeta?.validation?.passed === false
    || result.failureStage
    || result.errorCode
  ) {
    return false;
  }
  const { provider, model, providerPackageId } = triageProviderIdentity(result);
  return DIRECT_TRIAGE_PROVIDERS.includes(provider) && Boolean(model) && Boolean(providerPackageId);
}

function isReliablePreviousBaseline(result, inputSnapshot, deterministicFields) {
  return Boolean(
    result
    && isGenuineAiTriageResult(result)
    && isUnexpiredTriageResult(result)
    && sha256(safeString(result.parserText, '')) === inputSnapshot?.canonicalTemplateSha256
    && parseFieldsAgree(deterministicFields, result.parseFields)
  );
}

function resolvePreviousBaseline({
  sourceResult,
  inputSnapshot,
  deterministicFields,
  visibleCard = null,
}) {
  const reliable = isReliablePreviousBaseline(sourceResult, inputSnapshot, deterministicFields);
  return {
    displayCard: isObject(visibleCard)
      ? visibleCard
      : reliable && isObject(sourceResult?.card) ? sourceResult.card : null,
    reliable,
  };
}

function isRetryableTerminalOperation(operation) {
  return RETRYABLE_TERMINAL_STATUSES.has(operation?.status)
    || (operation?.status === 'manual-review' && operation?.errorCode === 'RECOVERY_CANDIDATE_EXPIRED');
}

function normalizeFingerprint(value) {
  return {
    contractVersion: Number(value?.contractVersion) || EVIDENCE_CONTRACT_VERSION,
    evidenceUpdatedAt: safeString(value?.evidenceUpdatedAt, ''),
    missingCodes: uniqueStrings(value?.missingCodes).sort(),
  };
}

function fingerprintMatches(left, right) {
  return evidenceAcknowledgementFingerprintMatches(
    normalizeFingerprint(left),
    normalizeFingerprint(right)
  );
}

function normalizeRuntimeSnapshot(value) {
  return {
    provider: safeString(value?.provider, '').trim(),
    model: safeString(value?.model, '').trim(),
    fallbackProvider: safeString(value?.fallbackProvider, '').trim(),
    fallbackModel: safeString(value?.fallbackModel, '').trim(),
    reasoningEffort: safeString(value?.reasoningEffort, '').trim(),
    serviceTier: safeString(value?.serviceTier, '').trim(),
  };
}

function runtimeSnapshotsMatch(left, right) {
  return stableJson(normalizeRuntimeSnapshot(left)) === stableJson(normalizeRuntimeSnapshot(right));
}

function buildDedupeKey({
  conversationId,
  stage,
  strategy,
  inputHash,
  evidenceFingerprint,
  runtimeSnapshot = null,
}) {
  return sha256({
    conversationId: safeString(conversationId, ''),
    stage,
    strategy,
    inputHash,
    evidenceFingerprint: normalizeFingerprint(evidenceFingerprint),
    runtimeSnapshot: normalizeRuntimeSnapshot(runtimeSnapshot),
  });
}

function operationPlanId(operation) {
  return safeString(operation?.planId || operation?.dedupeKey, '').trim();
}

function planOperationFilter(planId) {
  return { $or: [{ planId }, { dedupeKey: planId }] };
}

function buildAttemptDedupeKey(planId, attemptNumber) {
  return `${planId}:${attemptNumber}`;
}

function getTriageReceipt(conversation) {
  return clonePlain(conversation?.caseIntake?.evidence?.receipts?.triage, {}) || {};
}

function getTriageRuns(conversation) {
  const runs = Array.isArray(conversation?.caseIntake?.runs) ? conversation.caseIntake.runs : [];
  return runs.filter((run) => run && run.phase === 'triage');
}

function getOriginalTriageRun(conversation) {
  const runs = getTriageRuns(conversation);
  return runs.find((run) => run.status === 'failed') || runs[0] || null;
}

async function locateTriageResult(conversation, sourceRecordIds = null) {
  const receipt = getTriageReceipt(conversation);
  const resultId = safeString(sourceRecordIds?.triageResultId || receipt.savedResultId, '').trim();
  const runId = safeString(sourceRecordIds?.triageRunId || receipt.standaloneRunId, '').trim();

  if (resultId && TriageResult.base?.isValidObjectId(resultId)) {
    const byId = await TriageResult.findById(resultId).lean().catch(() => null);
    if (byId) return byId;
  }
  if (runId) {
    return TriageResult.findOne({ runId }).sort({ createdAt: -1 }).lean().catch(() => null);
  }
  return null;
}

function buildInputSnapshot(conversation, sourceResult = null) {
  const canonicalTemplate = safeString(conversation?.caseIntake?.canonicalTemplate, '');
  const parseFields = clonePlain(conversation?.caseIntake?.parseFields, {}) || {};
  const receipt = getTriageReceipt(conversation);
  return {
    canonicalTemplate,
    canonicalTemplateSha256: sha256(canonicalTemplate),
    parseFieldsSha256: sha256(parseFields),
    sourceRecordIds: {
      triageResultId: safeString(sourceResult?._id || receipt.savedResultId, ''),
      triageRunId: safeString(sourceResult?.runId || receipt.standaloneRunId, ''),
      providerPackageId: safeString(sourceResult?.providerPackageId || receipt.providerPackageId, ''),
    },
  };
}

function buildOriginalEvidence(conversation, evidence, sourceResult = null) {
  const receipt = getTriageReceipt(conversation);
  const failedRun = getOriginalTriageRun(conversation);
  const failureCode = safeString(
    receipt.errorCode
      || receipt.error?.code
      || failedRun?.detail?.errorCode
      || failedRun?.detail?.code
      || sourceResult?.errorCode,
    ''
  );
  const failureMessage = safeString(
    receipt.errorMessage
      || receipt.error?.message
      || failedRun?.detail?.errorMessage
      || failedRun?.detail?.message
      || failedRun?.summary,
    ''
  ).slice(0, 1000);
  return {
    failedRun: clonePlain(failedRun, null),
    receipt: clonePlain(receipt, null),
    failureCode,
    failureMessage,
    resultId: safeString(sourceResult?._id || receipt.savedResultId, ''),
    packageId: safeString(sourceResult?.providerPackageId || receipt.providerPackageId || receipt.repairPackageId, ''),
    traceIds: uniqueStrings([
      ...(Array.isArray(evidence?.identifiers?.traceIds) ? evidence.identifiers.traceIds : []),
      failedRun?.traceId,
    ]),
  };
}

async function resolveRuntimeSnapshot() {
  const defaults = await listAgentRuntimeDefaults([TRIAGE_AGENT_ID]);
  const configured = defaults?.[TRIAGE_AGENT_ID]?.runtime;
  const runtime = isObject(configured) ? configured : {};
  const provider = safeString(runtime.provider, '').trim() || 'lm-studio';
  const model = getEffectiveModel(provider, runtime.model);
  const backup = resolveAgentBackup(provider, isObject(configured) ? configured : null);
  const fallbackProvider = safeString(backup.provider, '').trim();
  const fallbackModel = fallbackProvider ? getEffectiveModel(fallbackProvider, backup.model) : '';
  return {
    provider,
    model,
    fallbackProvider,
    fallbackModel,
    reasoningEffort: safeString(runtime.reasoningEffort, '').trim() || 'high',
    serviceTier: safeString(runtime.serviceTier, '').trim(),
  };
}

async function buildReadiness(runtimeSnapshot) {
  const provider = runtimeSnapshot.provider;
  const model = runtimeSnapshot.model;
  const keyRequired = KEYED_PROVIDERS.has(provider);
  let keyConfigured = null;
  if (keyRequired) {
    keyConfigured = Boolean(await resolveApiKey(provider).catch(() => null));
  }
  const health = getProviderHealth(provider);
  const cachedPreflight = peekPreflightCache(provider, model);

  let label;
  let state = 'unknown';
  if (!DIRECT_TRIAGE_PROVIDERS.includes(provider)) {
    state = 'unsupported';
    label = 'The configured provider is not supported by the triage stage.';
  } else if (keyRequired && !keyConfigured) {
    state = 'key-required';
    label = 'The required provider key is not configured.';
  } else if (cachedPreflight?.ok === false) {
    state = 'failed-preflight';
    label = `The last connection check for this provider failed at ${cachedPreflight.checkedAt}; recovery would likely fail.`;
  } else if (cachedPreflight?.ok) {
    state = 'ready';
    label = 'A recent live readiness check passed.';
  } else if (!health.healthy) {
    state = 'unhealthy';
    label = 'Recent provider failures indicate that the provider may be unavailable.';
  } else if (keyRequired) {
    state = 'not-checked';
    label = 'Key configured; live readiness not checked.';
  } else if (URL_BASED_PROVIDERS.has(provider)) {
    state = 'not-checked';
    label = 'A server URL is configured; no API key is required, and live readiness has not been checked.';
  } else {
    state = 'not-checked';
    label = 'No API key is required; live readiness has not been checked.';
  }

  return {
    provider,
    model,
    keyRequired,
    keyConfigured,
    state,
    recentHealth: {
      healthy: Boolean(health.healthy),
      consecutiveFailures: Number(health.consecutiveFailures) || 0,
      lastSuccessAt: health.lastSuccessAt || null,
      lastFailureAt: health.lastFailureAt || null,
      lastErrorCode: health.lastErrorCode || '',
    },
    cachedPreflight: cachedPreflight || null,
    label,
  };
}

function assertRecoveryReadiness(readiness) {
  if (!DIRECT_TRIAGE_PROVIDERS.includes(readiness?.provider)) {
    throw createServiceError(
      'RECOVERY_PROVIDER_NOT_READY',
      'The reviewed provider is not supported by the triage stage. Update Runtime Defaults, then review recovery again.',
      409
    );
  }
  if (readiness.keyRequired && !readiness.keyConfigured) {
    throw createServiceError(
      'RECOVERY_PROVIDER_NOT_READY',
      'The reviewed provider requires a key, but no key is configured. Add the key, then review recovery again.',
      409
    );
  }
  if (!readiness.recentHealth?.healthy || readiness.cachedPreflight?.ok === false) {
    throw createServiceError(
      'RECOVERY_PROVIDER_NOT_READY',
      'Recent no-cost readiness signals show that the reviewed provider is unavailable. Check the provider, then review recovery again.',
      409
    );
  }
}

function estimateDuration(conversation, sourceResult) {
  const values = [
    ...getTriageRuns(conversation).map((run) => run.durationMs),
    sourceResult?.latencyMs,
  ];
  const durationMs = values
    .map(Number)
    .find((value) => Number.isFinite(value) && value > 0);
  if (!durationMs) return { estimatedDurationMs: null, estimatedDuration: 'Unknown — no prior triage duration was recorded.' };
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  return {
    estimatedDurationMs: Math.round(durationMs),
    estimatedDuration: `About ${seconds} second${seconds === 1 ? '' : 's'}, based on the prior triage run.`,
  };
}

async function buildDownstreamNote(conversation) {
  const candidateFilters = knowledgeCandidateFilters(conversation);
  const knowledgeCandidateExists = candidateFilters.length > 0
    ? Boolean(await KnowledgeCandidate.exists({ $or: candidateFilters }))
    : false;
  return {
    analyst: 'The existing analyst answer is unaffected because it does not depend on the saved triage card.',
    knowledgeDraft: knowledgeCandidateExists
      ? 'A knowledge draft exists for this escalation, so it may need human review after the triage result changes.'
      : 'No knowledge draft exists for this escalation, so there is no downstream draft to review.',
    knowledgeCandidateExists,
  };
}

function knowledgeCandidateFilters(conversation) {
  const candidateFilters = [];
  if (conversation?._id) candidateFilters.push({ conversationId: conversation._id });
  if (conversation?.escalationId) candidateFilters.push({ escalationId: conversation.escalationId });
  return candidateFilters;
}

function publicDownstreamMarker(operation) {
  const marking = operation?.downstreamMarking || {};
  if (!['pending', 'done'].includes(marking.status) || !marking.knowledgeCandidateId) return null;
  return {
    recoveryOperationId: safeString(operation.operationId, ''),
    knowledgeCandidateId: safeString(marking.knowledgeCandidateId, ''),
    markedAt: marking.markedAt || null,
    reason: safeString(marking.reason, ''),
  };
}

async function markDownstreamOperationSuperseded(
  operationId,
  supersededByRecoveryOperationId,
  { expectedStatuses = ['pending', 'done'] } = {}
) {
  if (!operationId || operationId === supersededByRecoveryOperationId) return false;
  const completedAt = new Date();
  const statusFilter = expectedStatuses.length === 1
    ? expectedStatuses[0]
    : { $in: expectedStatuses };
  const updated = await RecoveryOperation.updateOne(
    {
      operationId,
      'downstreamMarking.status': statusFilter,
    },
    {
      $set: {
        'downstreamMarking.status': 'superseded',
        'downstreamMarking.completedAt': completedAt,
        heartbeatAt: completedAt,
      },
      $unset: { 'postRecoveryEvidence.knowledgeDraftNeedsReview': 1 },
      $push: {
        progress: {
          $each: [{
            at: completedAt,
            kind: 'downstream-superseded',
            message: `A newer recovery (${supersededByRecoveryOperationId}) now owns the knowledge draft review marker.`,
          }],
          $slice: -MAX_PROGRESS_EVENTS,
        },
      },
    }
  );
  return updated.modifiedCount === 1;
}

function actualDownstreamMarkerOwner(candidate) {
  return safeString(
    candidate?.needsReviewAfterRecovery?.recoveryOperationId
      || candidate?.reviewedAfterRecovery?.recoveryOperationId,
    ''
  );
}

async function reconcileDoneDownstreamOwnership(operation) {
  const marking = operation?.downstreamMarking;
  if (marking?.status !== 'done' || !marking.knowledgeCandidateId) return operation;

  const candidate = await KnowledgeCandidate.findById(marking.knowledgeCandidateId)
    .select('needsReviewAfterRecovery reviewedAfterRecovery')
    .lean();
  const actualOwner = actualDownstreamMarkerOwner(candidate);
  if (!actualOwner || actualOwner === operation.operationId) return operation;

  await markDownstreamOperationSuperseded(operation.operationId, actualOwner, {
    expectedStatuses: ['done'],
  });
  operation.downstreamMarking.status = 'superseded';
  operation.downstreamMarking.completedAt = new Date();
  if (operation.postRecoveryEvidence?.knowledgeDraftNeedsReview) {
    delete operation.postRecoveryEvidence.knowledgeDraftNeedsReview;
  }
  return operation;
}

async function operationOutranksDownstreamOwner(operation, activeMarker) {
  const activeOperation = await RecoveryOperation.findOne({
    operationId: activeMarker.recoveryOperationId,
  }).select('attemptNumber downstreamMarking.markedAt').lean();
  const operationAttempt = Number(operation.attemptNumber) || 1;
  const activeAttempt = Number(activeOperation?.attemptNumber) || 1;
  const operationMarkedAt = validDateOr(operation.downstreamMarking.markedAt, new Date(0)).getTime();
  const activeMarkedAt = validDateOr(
    activeOperation?.downstreamMarking?.markedAt || activeMarker.markedAt,
    new Date(0)
  ).getTime();
  return operationAttempt > activeAttempt
    || (operationAttempt === activeAttempt && operationMarkedAt > activeMarkedAt);
}

async function claimDownstreamMarker(operation, candidateId, marker, activeMarker = null) {
  const filter = { _id: candidateId };
  const update = { $set: { needsReviewAfterRecovery: marker } };
  if (activeMarker?.recoveryOperationId) {
    filter['needsReviewAfterRecovery.recoveryOperationId'] = activeMarker.recoveryOperationId;
    update.$push = {
      recoveryReviewHistory: {
        recoveryOperationId: activeMarker.recoveryOperationId,
        markedAt: activeMarker.markedAt || null,
        reason: activeMarker.reason || '',
        supersededAt: new Date(),
        supersededByRecoveryOperationId: operation.operationId,
      },
    };
  } else {
    filter.needsReviewAfterRecovery = null;
  }
  const updated = await KnowledgeCandidate.findOneAndUpdate(filter, update, { returnDocument: 'after' })
    .select('_id needsReviewAfterRecovery')
    .lean();
  const ownsMarker = safeString(
    updated?.needsReviewAfterRecovery?.recoveryOperationId,
    ''
  ) === operation.operationId;
  if (ownsMarker && activeMarker?.recoveryOperationId !== undefined
    && activeMarker.recoveryOperationId !== operation.operationId) {
    await markDownstreamOperationSuperseded(activeMarker.recoveryOperationId, operation.operationId);
  }
  return ownsMarker;
}

async function prepareDownstreamMarkingIntent(
  operation,
  conversation,
  comparison,
  baselineReliable,
  commitStartedAt,
  markedAt
) {
  const candidateFilters = knowledgeCandidateFilters(conversation);
  const candidate = candidateFilters.length > 0
    ? await KnowledgeCandidate.findOne({ $or: candidateFilters }).select('_id').lean()
    : null;
  const reason = !comparison
    ? 'The previous triage result was lost, so this draft could not be checked against it. Review this knowledge draft before trusting or publishing it.'
    : !baselineReliable
      ? 'The previous triage result was lost or could not be fully verified, so this draft could not be checked against an authoritative result. Review this knowledge draft before trusting or publishing it.'
      : comparison.meaningfullyDifferent
        ? 'The triage result changed during recovery. Review this knowledge draft before trusting or publishing it.'
        : '';
  const downstreamMarking = reason
    ? {
        status: 'pending',
        knowledgeCandidateId: candidate?._id || null,
        reason,
        markedAt,
        completedAt: null,
      }
    : {
        status: 'none',
        knowledgeCandidateId: null,
        reason: '',
        markedAt: null,
        completedAt: null,
      };
  const recorded = await RecoveryOperation.updateOne(
    {
      operationId: operation.operationId,
      status: 'running',
      executorId: operation.executorId,
      commitStartedAt,
    },
    { $set: { downstreamMarking, heartbeatAt: markedAt } }
  );
  if (recorded.modifiedCount !== 1) {
    throw createServiceError('RECOVERY_STATE_CHANGED', 'Recovery lost ownership before its downstream review intent could be saved.', 409);
  }
  operation.downstreamMarking = downstreamMarking;
  return downstreamMarking;
}

async function applyPendingDownstreamMarker(operation) {
  if (operation?.downstreamMarking?.status !== 'pending') {
    return { marker: publicDownstreamMarker(operation), ownership: 'unchanged' };
  }
  let candidateId = operation.downstreamMarking.knowledgeCandidateId;
  if (!candidateId) {
    const conversation = await Conversation.findById(operation.conversationId)
      .select('_id escalationId')
      .lean();
    const filters = knowledgeCandidateFilters(conversation || { _id: operation.conversationId });
    const candidate = filters.length > 0
      ? await KnowledgeCandidate.findOne({ $or: filters })
      .select('_id')
      .lean()
      : null;
    if (!candidate) return { marker: null, ownership: 'unavailable' };
    const linked = await RecoveryOperation.updateOne(
      {
        operationId: operation.operationId,
        'downstreamMarking.status': 'pending',
        'downstreamMarking.knowledgeCandidateId': null,
      },
      { $set: { 'downstreamMarking.knowledgeCandidateId': candidate._id } }
    );
    if (linked.modifiedCount !== 1) {
      const latest = await RecoveryOperation.findOne({ operationId: operation.operationId })
        .select('downstreamMarking')
        .lean();
      candidateId = latest?.downstreamMarking?.knowledgeCandidateId || null;
      operation.downstreamMarking = latest?.downstreamMarking || operation.downstreamMarking;
    } else {
      candidateId = candidate._id;
      operation.downstreamMarking.knowledgeCandidateId = candidate._id;
    }
  }
  const marker = publicDownstreamMarker(operation);
  if (!marker || !candidateId) return { marker: null, ownership: 'unavailable' };
  const current = await KnowledgeCandidate.findById(candidateId)
    .select('_id needsReviewAfterRecovery reviewedAfterRecovery recoveryReviewHistory')
    .lean();
  if (!current) {
    throw createServiceError('KNOWLEDGE_CANDIDATE_MISSING', 'The linked knowledge draft no longer exists, so its recovery review marker could not be completed.', 409);
  }
  if (
    safeString(current.reviewedAfterRecovery?.recoveryOperationId, '') === operation.operationId
    || safeString(current.needsReviewAfterRecovery?.recoveryOperationId, '') === operation.operationId
  ) {
    return { marker, ownership: 'owned' };
  }
  const activeMarker = current.needsReviewAfterRecovery;
  if (activeMarker?.recoveryOperationId) {
    if (!(await operationOutranksDownstreamOwner(operation, activeMarker))) {
      return {
        marker: null,
        ownership: 'superseded',
        supersededByRecoveryOperationId: safeString(activeMarker.recoveryOperationId, ''),
      };
    }
  }
  if (await claimDownstreamMarker(operation, candidateId, marker, activeMarker)) {
    return { marker, ownership: 'owned' };
  }

  const latest = await KnowledgeCandidate.findById(candidateId)
    .select('needsReviewAfterRecovery reviewedAfterRecovery')
    .lean();
  if (
    safeString(latest?.needsReviewAfterRecovery?.recoveryOperationId, '') === operation.operationId
    || safeString(latest?.reviewedAfterRecovery?.recoveryOperationId, '') === operation.operationId
  ) return { marker, ownership: 'owned' };
  const latestActiveMarker = latest?.needsReviewAfterRecovery;
  const supersededByRecoveryOperationId = safeString(latestActiveMarker?.recoveryOperationId, '');
  if (supersededByRecoveryOperationId) {
    if (await operationOutranksDownstreamOwner(operation, latestActiveMarker)) {
      const tookOver = await claimDownstreamMarker(operation, candidateId, marker, latestActiveMarker);
      if (tookOver) return { marker, ownership: 'owned' };
    }
    return { marker: null, ownership: 'superseded', supersededByRecoveryOperationId };
  }
  throw createServiceError('KNOWLEDGE_MARKER_FAILED', 'The linked knowledge draft could not be marked for recovery review.', 500);
}

function manualRecoveryReason(artifact) {
  if (artifact.code === 'ANALYST_MESSAGE') {
    return 'The analyst answer was delivered to the browser but is not saved here. Server recovery cannot truthfully reconstruct the exact browser-only answer.';
  }
  if (artifact.code.includes('PROVIDER_PACKAGE')) {
    return 'The original provider-call package cannot be recreated after the call without presenting a new call as the original evidence.';
  }
  if (artifact.code === 'AI_TRACE') {
    return 'The original AI request trace cannot be recreated after the request without changing what the historical record claims.';
  }
  if (artifact.code.endsWith('_REASONING')) {
    return 'The original readable reasoning cannot be recreated after the model call without inventing historical evidence.';
  }
  if (artifact.code.endsWith('_RUN')) {
    return 'This saved stage record has no trustworthy source record that can be reattached automatically.';
  }
  return 'No trustworthy server-side source is available to recreate this historical evidence automatically.';
}

function buildPlanInputHash(inputSnapshot) {
  return sha256({
    canonicalTemplateSha256: inputSnapshot.canonicalTemplateSha256,
    parseFieldsSha256: inputSnapshot.parseFieldsSha256,
  });
}

async function buildRecoveryOptions(conversationId) {
  const evidence = await getConversationEvidence(conversationId);
  const response = {
    conversationId: safeString(conversationId, ''),
    evidenceStatus: evidence.status,
    settled: Boolean(evidence.settled),
    evidenceFingerprint: normalizeFingerprint(evidence.acknowledgementFingerprint),
    reason: '',
    recommendedOrderNote: 'Review no-cost recoveries first, then provider-call recoveries, then any items that require human review.',
    groups: [],
    options: [],
  };

  if (evidence.status === 'unknown' || !evidence.settled) {
    response.reason = evidence.settlingUntil
      ? 'Evidence is still settling. Wait for the current save window to finish, then review recovery again.'
      : 'Evidence completeness is unknown, so the server cannot offer a safe recovery action.';
    return response;
  }
  if (evidence.status === 'complete') {
    response.reason = 'All applicable evidence is already confirmed. No recovery is needed.';
    return response;
  }

  const conversation = await Conversation.findById(conversationId).lean();
  if (!conversation) throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  const missingArtifacts = (Array.isArray(evidence.missing) ? evidence.missing : [])
    .filter((artifact) => artifact?.code !== 'EVIDENCE_RECEIPTS');
  const triageArtifacts = missingArtifacts.filter((artifact) => TRIAGE_RECOVERY_CODES.has(artifact.code));
  const sourceResult = await locateTriageResult(conversation);
  const inputSnapshot = buildInputSnapshot(conversation, sourceResult);
  const inputHash = buildPlanInputHash(inputSnapshot);
  const deterministicFields = inputSnapshot.canonicalTemplate.trim()
    ? parseEscalationText(inputSnapshot.canonicalTemplate)
    : null;
  const currentParseFields = conversation.caseIntake?.parseFields || {};
  const artifactsByCode = new Map((evidence.artifacts || []).map((artifact) => [artifact.code, artifact]));
  const canonicalConfirmed = artifactsByCode.get('CANONICAL_TEMPLATE')?.state === 'confirmed';
  const parseFieldsConfirmed = artifactsByCode.get('PARSED_FIELDS')?.state === 'confirmed';
  const currentParseAgrees = Boolean(deterministicFields && parseFieldsAgree(deterministicFields, currentParseFields));
  const sourceIsGenuineAiResult = isGenuineAiTriageResult(sourceResult);
  const currentVisibleCard = isObject(conversation.caseIntake?.triageCard)
    ? conversation.caseIntake.triageCard
    : null;
  const previousBaseline = resolvePreviousBaseline({
    sourceResult,
    inputSnapshot,
    deterministicFields,
    visibleCard: currentVisibleCard,
  });
  // Comparison answers what the reviewer would see change. Baseline reliability
  // separately decides whether equivalence is allowed to suppress the review marker.
  const repersistComparison = sourceResult && currentVisibleCard
    ? compareTriageCards(currentVisibleCard, sourceResult.card)
    : { meaningfullyDifferent: false, differences: [], plainSummary: [] };
  const repersistEligible = Boolean(
    previousBaseline.reliable
    && currentParseAgrees
  );
  const rerunEligible = Boolean(
    inputSnapshot.canonicalTemplate.trim()
    && canonicalConfirmed
    && parseFieldsConfirmed
    && currentParseAgrees
  );
  const repersistNeedsAcceptance = repersistEligible && repersistComparison.meaningfullyDifferent;
  const downstream = await buildDownstreamNote(conversation);

  if (triageArtifacts.length > 0) {
    let strategy = 'manual-review';
    let reason = 'The saved triage input cannot be verified well enough for automatic recovery.';
    if (repersistEligible) {
      strategy = 'repersist';
      reason = repersistNeedsAcceptance
        ? 'A readable, unexpired triage result matches the verified input, but its card differs meaningfully from the visible card and will require acceptance before anything is replaced.'
        : 'A readable, unexpired triage result matches the current canonical input and can be reattached without another AI call.';
    } else if (rerunEligible) {
      strategy = 'rerun-stage';
      reason = sourceResult && !sourceIsGenuineAiResult
        ? 'The stored copy was an emergency fallback, not a real AI result, so the triage stage must be run again.'
        : sourceResult
          ? 'The old triage result no longer matches the verified input, so only the triage stage can be run again safely.'
          : 'No trustworthy saved triage result is available, but the canonical input and parsed fields are confirmed for a triage-only rerun.';
    } else if (sourceResult && !sourceIsGenuineAiResult) {
      reason = 'The stored copy was an emergency fallback, not a real AI result, and the current input is not verified well enough for a safe triage rerun.';
    } else if (!inputSnapshot.canonicalTemplate.trim()) {
      reason = 'The canonical escalation template is empty, so triage cannot be run safely.';
    } else if (!canonicalConfirmed || !parseFieldsConfirmed) {
      reason = 'The canonical template and parsed fields must both be confirmed before triage can be recovered.';
    } else if (!currentParseAgrees) {
      reason = 'A deterministic re-parse does not agree with the saved parsed fields, so a person must review the input before recovery.';
    }

    const runtimeSnapshot = strategy === 'rerun-stage' ? await resolveRuntimeSnapshot() : null;
    const readiness = runtimeSnapshot ? await buildReadiness(runtimeSnapshot) : null;
    const planId = buildDedupeKey({
      conversationId,
      stage: 'triage',
      strategy,
      inputHash,
      evidenceFingerprint: response.evidenceFingerprint,
      runtimeSnapshot,
    });
    response.options.push({
      planId,
      action: strategy,
      targetStage: 'triage',
      strategy,
      technicalDetail: { strategy },
      artifactCodes: triageArtifacts.map((artifact) => artifact.code).sort(),
      artifacts: triageArtifacts.map((artifact) => ({
        code: artifact.code,
        label: artifact.label,
        reason: artifact.reason,
      })),
      recommended: strategy !== 'manual-review',
      reason,
      aiCallNeeded: strategy === 'rerun-stage',
      costEstimate: strategy === 'rerun-stage'
        ? {
            amountKnown: false,
            amount: null,
            currency: null,
            message: 'A provider call is required, but the cost amount is unknown because no reliable estimate is available.',
          }
        : {
            amountKnown: true,
            amount: 0,
            currency: 'USD',
            message: 'No AI provider cost will be added because this reuses an already validated saved result.',
          },
      acceptanceRequired: Boolean(strategy === 'repersist' && repersistNeedsAcceptance),
      comparison: strategy === 'repersist' && repersistNeedsAcceptance ? repersistComparison : null,
      runtimeSnapshot,
      readiness,
      ...estimateDuration(conversation, sourceResult),
      cancellationBoundary: strategy === 'rerun-stage'
        ? 'You can cancel cleanly before provider handoff. After handoff, cancellation is best-effort; once the final database write begins, that atomic write will finish.'
        : strategy === 'repersist'
          ? 'You can cancel until the atomic database write begins. Once it begins, the write will finish as one unit.'
          : 'No automatic work will start from this option.',
      expectedWrites: strategy === 'repersist'
        ? (repersistNeedsAcceptance
          ? ['No conversation write occurs until the differing saved card is accepted.', 'After acceptance, one linked triage recovery run and an updated triage evidence receipt are written.']
          : ['One linked triage recovery run and an updated triage evidence receipt in the conversation.'])
        : strategy === 'rerun-stage'
          ? ['One new triage history result.', 'After validation or acceptance, one linked triage recovery run and an updated triage evidence receipt in the conversation.']
          : [],
      downstream,
      evidenceFingerprint: response.evidenceFingerprint,
    });
  }

  for (const artifact of missingArtifacts.filter((item) => !TRIAGE_RECOVERY_CODES.has(item.code))) {
    const strategy = 'manual-review';
    response.options.push({
      planId: buildDedupeKey({
        conversationId,
        stage: artifact.stage || 'pipeline',
        strategy,
        inputHash,
        evidenceFingerprint: response.evidenceFingerprint,
        runtimeSnapshot: null,
      }),
      action: strategy,
      targetStage: artifact.stage || 'pipeline',
      strategy,
      technicalDetail: { strategy },
      artifactCodes: [artifact.code],
      artifacts: [{ code: artifact.code, label: artifact.label, reason: artifact.reason }],
      recommended: false,
      reason: manualRecoveryReason(artifact),
      aiCallNeeded: false,
      costEstimate: {
        amountKnown: true,
        amount: 0,
        currency: 'USD',
        message: 'No automatic provider call will start for this item.',
      },
      runtimeSnapshot: null,
      readiness: null,
      estimatedDurationMs: null,
      estimatedDuration: 'Unknown — this item needs manual review.',
      cancellationBoundary: 'No automatic work will start from this option.',
      expectedWrites: [],
      downstream,
      evidenceFingerprint: response.evidenceFingerprint,
    });
  }

  if (response.options.length === 0) {
    response.reason = 'No safely recoverable missing evidence was found.';
  }
  return finalizeRecoveryGroups(response);
}

function publicAttempt(attempt) {
  const provenance = isObject(attempt?.provenance) ? attempt.provenance : {};
  return {
    attempt: attempt?.attempt || 1,
    strategy: attempt?.strategy || '',
    status: attempt?.status || '',
    provider: attempt?.provider || '',
    model: attempt?.model || '',
    providerPackageId: attempt?.providerPackageId || '',
    failoverUsed: Boolean(attempt?.failoverUsed),
    failoverFrom: attempt?.failoverFrom || '',
    startedAt: attempt?.startedAt || null,
    completedAt: attempt?.completedAt || null,
    durationMs: attempt?.durationMs ?? null,
    triageResultId: attempt?.triageResultId || '',
    errorCode: attempt?.errorCode || '',
    errorMessage: attempt?.errorMessage || '',
    provenance: {
      plannedProvider: safeString(provenance.plannedProvider, attempt?.provider || ''),
      plannedModel: safeString(provenance.plannedModel, attempt?.model || ''),
      providerHandoffAt: provenance.providerHandoffAt || null,
      contactedProviders: (Array.isArray(provenance.contactedProviders) ? provenance.contactedProviders : [])
        .map((contact) => ({
          attemptIndex: Number(contact?.attemptIndex) || 0,
          role: safeString(contact?.role, ''),
          provider: safeString(contact?.provider, ''),
          model: safeString(contact?.model, ''),
          contactedAt: contact?.contactedAt || null,
          providerPackageIds: uniqueStrings(contact?.providerPackageIds),
          traceIds: uniqueStrings(contact?.traceIds),
          errorCode: safeString(contact?.errorCode, ''),
        }))
        .filter((contact) => contact.provider),
      providerPackageIds: uniqueStrings(provenance.providerPackageIds),
      triageResultIds: uniqueStrings(provenance.triageResultIds),
      fallbackContacted: Boolean(provenance.fallbackContacted),
      costMayHaveBeenIncurred: Boolean(provenance.costMayHaveBeenIncurred),
    },
  };
}

function progressEventAt(operation, kinds) {
  const wanted = new Set(kinds);
  const event = (Array.isArray(operation?.progress) ? operation.progress : [])
    .find((item) => wanted.has(safeString(item?.kind, '')));
  return event?.at || null;
}

function serializeOperation(value) {
  const operation = clonePlain(value, {}) || {};
  const downstreamMarking = operation.downstreamMarking || { status: 'none' };
  const downstreamReviewRequired = ['pending', 'done'].includes(downstreamMarking.status);
  const knowledgeDraftNeedsReview = operation.postRecoveryEvidence?.knowledgeDraftNeedsReview
    || (downstreamReviewRequired ? publicDownstreamMarker(operation) : null);
  return {
    operationId: operation.operationId || '',
    planId: operationPlanId(operation),
    attemptNumber: Number(operation.attemptNumber) || 1,
    conversationId: safeString(operation.conversationId, ''),
    targetStage: operation.targetStage || '',
    strategy: operation.strategy || '',
    status: operation.status || '',
    evidenceFingerprint: operation.evidenceFingerprint || null,
    missingCodes: operation.missingCodes || [],
    inputSnapshot: operation.inputSnapshot ? {
      canonicalTemplateSha256: operation.inputSnapshot.canonicalTemplateSha256 || '',
      parseFieldsSha256: operation.inputSnapshot.parseFieldsSha256 || '',
      sourceRecordIds: operation.inputSnapshot.sourceRecordIds || {},
    } : null,
    originalEvidence: sanitizeOriginalEvidence(operation.originalEvidence),
    runtimeSnapshot: operation.runtimeSnapshot || null,
    attempts: (operation.attempts || []).map(publicAttempt),
    candidateResult: operation.candidateResult?.card ? operation.candidateResult : null,
    acceptedResult: operation.acceptedResult?.acceptedSha256 ? operation.acceptedResult : null,
    progress: operation.progress || [],
    postRecoveryEvidence: operation.postRecoveryEvidence || null,
    knowledgeDraftNeedsReview,
    downstreamReviewRequired,
    downstreamMarking: {
      status: downstreamMarking.status || 'none',
      knowledgeCandidateId: downstreamMarking.knowledgeCandidateId
        ? safeString(downstreamMarking.knowledgeCandidateId, '')
        : null,
      reason: downstreamMarking.reason || '',
      markedAt: downstreamMarking.markedAt || null,
      completedAt: downstreamMarking.completedAt || null,
    },
    conversationWriteApplied: Boolean(operation.conversationWriteApplied),
    providerHandoffAt: operation.attempts?.map((attempt) => attempt?.provenance?.providerHandoffAt).find(Boolean)
      || progressEventAt(operation, [
      'triage.agent_handoff_to_provider',
      'triage.generation_started',
    ]),
    commitStartedAt: operation.commitStartedAt || null,
    commitCompletedAt: operation.commitCompletedAt || null,
    heartbeatAt: operation.heartbeatAt || null,
    startedAt: operation.startedAt || null,
    completedAt: operation.completedAt || null,
    cancellationRequestedAt: operation.cancellationRequestedAt || null,
    cancellationAcknowledgedAt: operation.cancellationAcknowledgedAt || null,
    acceptExpiresAt: operation.acceptExpiresAt || null,
    errorCode: operation.errorCode || '',
    errorMessage: operation.errorMessage || '',
    createdAt: operation.createdAt || null,
    updatedAt: operation.updatedAt || null,
  };
}

function serializeHistoryOperation(value) {
  const operation = clonePlain(value, {}) || {};
  const serialized = serializeOperation(operation);
  return {
    operationId: serialized.operationId,
    planId: serialized.planId,
    attemptNumber: serialized.attemptNumber,
    targetStage: serialized.targetStage,
    strategy: serialized.strategy,
    status: serialized.status,
    missingCodes: serialized.missingCodes,
    originalEvidence: serialized.originalEvidence,
    runtimeSnapshot: serialized.runtimeSnapshot ? {
      provider: serialized.runtimeSnapshot.provider || '',
      model: serialized.runtimeSnapshot.model || '',
      actualProvider: serialized.runtimeSnapshot.actualProvider || '',
      actualModel: serialized.runtimeSnapshot.actualModel || '',
      actualProviderPackageId: serialized.runtimeSnapshot.actualProviderPackageId || '',
      failoverUsed: Boolean(serialized.runtimeSnapshot.failoverUsed),
      failoverFrom: serialized.runtimeSnapshot.failoverFrom || '',
    } : null,
    attempts: serialized.attempts,
    comparison: operation.candidateResult?.comparison ? {
      meaningfullyDifferent: Boolean(operation.candidateResult.comparison.meaningfullyDifferent),
      differences: Array.isArray(operation.candidateResult.comparison.differences)
        ? operation.candidateResult.comparison.differences
        : [],
      plainSummary: Array.isArray(operation.candidateResult.comparison.plainSummary)
        ? operation.candidateResult.comparison.plainSummary
        : [],
      previousResultVerified: Boolean(operation.candidateResult.comparison.previousResultVerified),
      candidateSha256: safeString(operation.candidateResult.comparison.candidateSha256, ''),
      previousSha256: safeString(operation.candidateResult.comparison.previousSha256, ''),
    } : null,
    acceptedAt: operation.acceptedResult?.acceptedAt || null,
    confirmedAt: progressEventAt(operation, ['confirmed']) || operation.createdAt || null,
    providerHandoffAt: serialized.providerHandoffAt,
    conversationWriteApplied: serialized.conversationWriteApplied,
    commitStartedAt: serialized.commitStartedAt,
    commitCompletedAt: serialized.commitCompletedAt,
    postRecoveryEvidence: serialized.postRecoveryEvidence,
    knowledgeDraftNeedsReview: serialized.knowledgeDraftNeedsReview,
    downstreamReviewRequired: serialized.downstreamReviewRequired,
    downstreamMarking: serialized.downstreamMarking,
    errorCode: serialized.errorCode,
    errorMessage: serialized.errorMessage,
    startedAt: serialized.startedAt,
    completedAt: serialized.completedAt,
    createdAt: serialized.createdAt,
    updatedAt: serialized.updatedAt,
  };
}

async function appendProgress(operationId, kind, message, detail = null, executorId = '') {
  const cleanDetail = detail && isObject(detail)
    ? Object.fromEntries(Object.entries(detail).filter(([key]) => (
      ['provider', 'model', 'code', 'status', 'source', 'cached', 'failureStage', 'surfaceToUser'].includes(key)
    )))
    : null;
  const filter = { operationId };
  if (executorId) filter.executorId = executorId;
  await RecoveryOperation.updateOne(
    filter,
    {
      $set: { heartbeatAt: new Date() },
      $push: {
        progress: {
          $each: [{ at: new Date(), kind, message: safeString(message, '').slice(0, 500), detail: cleanDetail }],
          $slice: -MAX_PROGRESS_EVENTS,
        },
      },
    }
  );
}

function eventMessage(kind) {
  const messages = {
    'triage.prompt_resolved': 'Triage instructions were resolved.',
    'triage.context_built': 'Verified triage context was prepared.',
    'triage.provider_selected': 'The configured triage provider was selected.',
    'triage.preflight_checked': 'Provider readiness was checked.',
    'triage.agent_handoff_to_provider': 'The triage request was handed to the provider.',
    'triage.provider_failover': 'The primary provider failed and the configured fallback was attempted.',
    'triage.generation_started': 'Triage generation started.',
    'triage.fields_extracted': 'The triage response fields were extracted.',
    'triage.output_validated': 'The triage response was validated.',
    'triage.repair_started': 'A one-time validation repair pass started.',
    'triage.repair_completed': 'The validation repair pass completed.',
    'triage.repair_failed': 'The validation repair pass did not complete.',
    error: 'The triage stage reported an error.',
  };
  return messages[kind] || '';
}

function createRecoveryEventBus(operationId, registryEntry) {
  return {
    emit(kind, detail = {}) {
      if (kind === 'triage.agent_handoff_to_provider') {
        const contactedAt = new Date();
        registryEntry.handedOff = true;
        registryEntry.providerHandoffAt ||= contactedAt;
        const provider = safeString(detail.provider, '');
        const model = safeString(detail.model, '');
        const role = safeString(detail.role, '') || (registryEntry.contactedProviders.length === 0 ? 'primary' : 'fallback');
        const attemptIndex = Number(detail.attemptIndex) || (registryEntry.contactedProviders.length + 1);
        const existing = registryEntry.contactedProviders.find((contact) => (
          contact.provider === provider && contact.model === model
          && contact.role === role && contact.attemptIndex === attemptIndex
        ));
        if (!existing && provider) {
          registryEntry.contactedProviders.push({
            attemptIndex,
            role,
            provider,
            model,
            contactedAt,
            providerPackageIds: [],
            traceIds: [],
            errorCode: '',
          });
        }
        const provenance = {
          plannedProvider: registryEntry.plannedProvider,
          plannedModel: registryEntry.plannedModel,
          providerHandoffAt: registryEntry.providerHandoffAt,
          contactedProviders: registryEntry.contactedProviders,
          providerPackageIds: [],
          triageResultIds: [],
          fallbackContacted: registryEntry.contactedProviders.length > 1,
          costMayHaveBeenIncurred: true,
        };
        const provenanceWrite = RecoveryOperation.updateOne(
          { operationId, executorId: registryEntry.executorId, 'attempts.attempt': 1 },
          { $set: { 'attempts.$.provenance': provenance, heartbeatAt: contactedAt } }
        ).catch(() => {});
        registryEntry.provenanceWrites.push(provenanceWrite);
      }
      const message = eventMessage(kind);
      if (!message) return;
      appendProgress(operationId, kind, message, detail, registryEntry.executorId).catch(() => {});
    },
  };
}

function buildAttemptProvenance(operation, registryEntry, resultLike, persistObservation) {
  const attempted = Array.isArray(resultLike?.triageMeta?.attempted)
    ? resultLike.triageMeta.attempted.filter((item) => item?.contacted !== false)
    : [];
  const contacts = [];
  const addContact = (candidate) => {
    const provider = safeString(candidate?.provider, '');
    if (!provider) return;
    const model = safeString(candidate?.model, '');
    const role = safeString(candidate?.role, '') || (contacts.length === 0 ? 'primary' : 'fallback');
    const attemptIndex = Number(candidate?.attemptIndex) || 0;
    let contact = contacts.find((item) => (
      item.provider === provider && item.model === model
      && item.role === role
      && (!attemptIndex || !item.attemptIndex || item.attemptIndex === attemptIndex)
    ));
    if (!contact) {
      contact = {
        attemptIndex,
        role,
        provider,
        model,
        contactedAt: candidate?.contactedAt || null,
        providerPackageIds: [],
        traceIds: [],
        errorCode: '',
      };
      contacts.push(contact);
    }
    contact.contactedAt ||= candidate?.contactedAt || null;
    contact.providerPackageIds = uniqueStrings([
      ...contact.providerPackageIds,
      candidate?.providerPackageId,
      ...(Array.isArray(candidate?.providerPackageIds) ? candidate.providerPackageIds : []),
    ]);
    contact.traceIds = uniqueStrings([
      ...contact.traceIds,
      candidate?.traceId,
      ...(Array.isArray(candidate?.traceIds) ? candidate.traceIds : []),
    ]);
    contact.errorCode ||= safeString(candidate?.errorCode, '');
  };
  registryEntry.contactedProviders.forEach(addContact);
  attempted.forEach(addContact);

  const producingPackageId = safeString(
    resultLike?.triageMeta?.providerPackageId
      || resultLike?.savedResult?.providerPackageId,
    ''
  );
  if (producingPackageId && contacts.length > 0) {
    const producingProvider = safeString(resultLike?.providerUsed || resultLike?.triageMeta?.providerUsed, '');
    const producing = contacts.find((contact) => contact.provider === producingProvider) || contacts.at(-1);
    producing.providerPackageIds = uniqueStrings([...producing.providerPackageIds, producingPackageId]);
  }
  const triageResultIds = uniqueStrings([
    persistObservation?.id,
    resultLike?.savedResult?.id,
    resultLike?.triageMeta?.resultId,
  ]);
  const providerHandoffAt = registryEntry.providerHandoffAt || null;
  return {
    plannedProvider: safeString(operation.runtimeSnapshot?.provider, ''),
    plannedModel: safeString(operation.runtimeSnapshot?.model, ''),
    providerHandoffAt,
    contactedProviders: contacts,
    providerPackageIds: uniqueStrings(contacts.flatMap((contact) => contact.providerPackageIds)),
    triageResultIds,
    fallbackContacted: contacts.some((contact) => ['backup', 'fallback'].includes(contact.role)),
    costMayHaveBeenIncurred: Boolean(providerHandoffAt),
  };
}

async function recordAttemptProvenance(operation, registryEntry, resultLike, persistObservation) {
  await Promise.allSettled(registryEntry.provenanceWrites || []);
  registryEntry.provenanceWrites = [];
  const provenance = buildAttemptProvenance(operation, registryEntry, resultLike, persistObservation);
  const write = await RecoveryOperation.updateOne(
    { operationId: operation.operationId, executorId: operation.executorId, 'attempts.attempt': 1 },
    { $set: { 'attempts.$.provenance': provenance, heartbeatAt: new Date() } }
  );
  if (write.modifiedCount !== 1) {
    throw createServiceError('RECOVERY_STATE_CHANGED', 'Recovery state changed before provider provenance could be recorded.', 409);
  }
  return provenance;
}

function validDateOr(value, fallback) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : fallback;
}

async function findAppliedConversationWrite(operation) {
  if (operation?.conversationWriteApplied) {
    return {
      appliedAt: validDateOr(operation.commitCompletedAt, new Date()),
      receipt: null,
    };
  }
  const conversation = await Conversation.findOne({
    _id: operation.conversationId,
    'caseIntake.evidence.receipts.triage.recoveryOperationId': operation.operationId,
  })
    .select('caseIntake.evidence.receipts.triage')
    .lean();
  if (!conversation) return null;
  const receipt = getTriageReceipt(conversation);
  if (safeString(receipt.recoveryOperationId, '') !== safeString(operation.operationId, '')) return null;
  return {
    appliedAt: validDateOr(receipt.completedAt || receipt.recordedAt, new Date()),
    receipt,
  };
}

async function reconcilePendingDownstreamMarking(operation, { conversationWriteKnownApplied = false } = {}) {
  if (operation?.downstreamMarking?.status !== 'pending') {
    return operation?.downstreamMarking?.status === 'done' ? publicDownstreamMarker(operation) : null;
  }
  if (!conversationWriteKnownApplied && !(await findAppliedConversationWrite(operation))) return null;

  const markerResult = await applyPendingDownstreamMarker(operation);
  if (markerResult.ownership === 'superseded') {
    await markDownstreamOperationSuperseded(
      operation.operationId,
      markerResult.supersededByRecoveryOperationId
    );
    operation.downstreamMarking.status = 'superseded';
    return null;
  }
  const marker = markerResult.marker;
  if (!marker) return null;
  const completedAt = new Date();
  const postRecoveryEvidence = {
    ...(clonePlain(operation.postRecoveryEvidence, {}) || {}),
    knowledgeDraftNeedsReview: marker,
  };
  const completed = await RecoveryOperation.updateOne(
    {
      operationId: operation.operationId,
      'downstreamMarking.status': 'pending',
    },
    {
      $set: {
        'downstreamMarking.status': 'done',
        'downstreamMarking.completedAt': completedAt,
        postRecoveryEvidence,
        heartbeatAt: completedAt,
      },
      $push: {
        progress: {
          $each: [{
            at: completedAt,
            kind: 'downstream-marked',
            message: 'The linked knowledge draft was marked for review after triage recovery.',
          }],
          $slice: -MAX_PROGRESS_EVENTS,
        },
      },
    }
  );
  if (completed.modifiedCount === 1) {
    operation.downstreamMarking.status = 'done';
    operation.downstreamMarking.completedAt = completedAt;
    operation.postRecoveryEvidence = postRecoveryEvidence;
    return marker;
  }
  const latest = await RecoveryOperation.findOne({ operationId: operation.operationId })
    .select('downstreamMarking postRecoveryEvidence')
    .lean();
  if (latest?.downstreamMarking?.status === 'done') return publicDownstreamMarker({
    operationId: operation.operationId,
    downstreamMarking: latest.downstreamMarking,
  });
  if (latest?.downstreamMarking?.status === 'superseded') return null;
  throw createServiceError('KNOWLEDGE_MARKER_INTENT_FAILED', 'The knowledge draft review marker was applied, but its recovery intent could not be completed.', 500);
}

async function reconcilePendingRecoveryForKnowledgeCandidate(candidateLike) {
  const candidate = candidateLike?.toObject ? candidateLike.toObject() : candidateLike;
  if (!candidate?._id) return 0;
  let conversationId = candidate.conversationId || null;
  if (!conversationId && candidate.escalationId) {
    const conversation = await Conversation.findOne({ escalationId: candidate.escalationId })
      .select('_id')
      .lean();
    conversationId = conversation?._id || null;
  }
  if (!conversationId) return 0;
  const operations = await RecoveryOperation.find({
    conversationId,
    'downstreamMarking.status': 'pending',
    $or: [
      { 'downstreamMarking.knowledgeCandidateId': null },
      { 'downstreamMarking.knowledgeCandidateId': candidate._id },
    ],
  })
    .sort({ createdAt: 1 })
    .limit(100)
    .lean();
  let reconciled = 0;
  for (const operation of operations) {
    try {
      const marker = await reconcilePendingDownstreamMarking(operation);
      if (marker) reconciled += 1;
    } catch {
      // The durable intent and publish gate keep this safe for a later retry.
    }
  }
  return reconciled;
}

async function reconcilePendingDownstreamMarkings() {
  const pending = await RecoveryOperation.find({ 'downstreamMarking.status': 'pending' })
    .sort({ updatedAt: 1 })
    .limit(100)
    .lean();
  for (const operation of pending) {
    try {
      await reconcilePendingDownstreamMarking(operation);
    } catch {
      // Leave the durable intent pending. A later status lookup or stale pass can retry it safely.
    }
  }
}

async function markWriteAppliedUnverified(operation, {
  executorId = '',
  allowedStatuses = ['confirmed', 'running', 'cancel-requested'],
  appliedAt = null,
  errorCode = 'RECOVERY_WRITE_APPLIED_VERIFICATION_INCOMPLETE',
  errorMessage = 'The recovery write was applied, but final evidence verification did not finish. Do not retry this plan.',
} = {}) {
  const completedAt = new Date();
  const guard = {
    operationId: operation.operationId,
    status: { $in: allowedStatuses },
  };
  if (executorId) guard.executorId = executorId;
  const result = await RecoveryOperation.updateOne(
    guard,
    {
      $set: {
        status: 'succeeded-unverified',
        conversationWriteApplied: true,
        commitCompletedAt: validDateOr(appliedAt || operation.commitCompletedAt, completedAt),
        completedAt,
        heartbeatAt: completedAt,
        errorCode,
        errorMessage,
      },
      $unset: { activePlanId: '' },
      $push: {
        progress: {
          $each: [{ at: completedAt, kind: 'succeeded-unverified', message: errorMessage }],
          $slice: -MAX_PROGRESS_EVENTS,
        },
      },
    }
  );
  if (result.modifiedCount !== 1) return false;
  await finishAttempt(operation.operationId, {
    status: 'succeeded-unverified',
    completedAt,
    errorCode,
    errorMessage,
  });
  return true;
}

async function markStaleRunningOperations() {
  if (!RecoveryOperation.db || RecoveryOperation.db.readyState !== 1) return;
  await reconcilePendingDownstreamMarkings();
  const now = new Date();
  const cutoff = new Date(now.getTime() - STALE_HEARTBEAT_MS);
  const liveOperationIds = [...inFlightOperations.keys()];
  const staleConditions = [
    {
      $or: [
        { heartbeatAt: { $lt: cutoff } },
        { heartbeatAt: null, createdAt: { $lt: cutoff } },
      ],
    },
    {
      $or: [
        { commitStartedAt: null },
        { commitStartedAt: { $lt: cutoff } },
      ],
    },
  ];
  const staleOperations = await RecoveryOperation.find({
    ...(liveOperationIds.length > 0 ? { operationId: { $nin: liveOperationIds } } : {}),
    status: { $in: ['confirmed', 'running', 'cancel-requested'] },
    $and: staleConditions,
  }).lean();

  for (const operation of staleOperations) {
    const appliedWrite = await findAppliedConversationWrite(operation);
    if (appliedWrite) {
      if (operation.downstreamMarking?.status === 'pending') {
        try {
          await reconcilePendingDownstreamMarking(operation, { conversationWriteKnownApplied: true });
        } catch {
          // The operation still records downstreamReviewRequired while a later lookup retries the marker.
        }
      }
      await markWriteAppliedUnverified(operation, {
        allowedStatuses: [operation.status],
        appliedAt: appliedWrite.appliedAt,
      });
      continue;
    }

    const guard = {
      operationId: operation.operationId,
      status: operation.status,
      $and: staleConditions,
    };
    if (operation.status === 'cancel-requested') {
      const cancelled = await RecoveryOperation.updateOne(
        guard,
        {
          $set: {
            status: 'cancelled',
            completedAt: now,
            heartbeatAt: now,
            cancellationAcknowledgedAt: now,
            errorCode: '',
            errorMessage: '',
            ...(operation.downstreamMarking?.status === 'pending' ? {
              'downstreamMarking.status': 'none',
              'downstreamMarking.completedAt': now,
            } : {}),
          },
          $unset: { activePlanId: '' },
          $push: {
            progress: {
              $each: [{ at: now, kind: 'cancelled', message: 'The stale cancellation request was closed without a matching conversation write receipt.' }],
              $slice: -MAX_PROGRESS_EVENTS,
            },
          },
        }
      );
      if (cancelled.modifiedCount === 1) {
        await finishAttempt(operation.operationId, {
          status: 'cancelled',
          completedAt: now,
          errorCode: 'RECOVERY_CANCELLED',
          errorMessage: 'The stale cancellation request was closed without a matching conversation write receipt.',
        });
      }
      continue;
    }

    const interruptedMessage = operation.status === 'confirmed'
      ? 'Recovery was confirmed, but execution did not start before the server stopped tracking it. It was not resumed automatically.'
      : 'The server stopped receiving recovery heartbeats. This operation was not resumed automatically.';
    const interrupted = await RecoveryOperation.updateOne(
      guard,
      {
        $set: {
          status: 'interrupted',
          completedAt: now,
          heartbeatAt: now,
          errorCode: 'RECOVERY_INTERRUPTED',
          errorMessage: interruptedMessage,
          ...(operation.downstreamMarking?.status === 'pending' ? {
            'downstreamMarking.status': 'none',
            'downstreamMarking.completedAt': now,
          } : {}),
        },
        $unset: { activePlanId: '' },
        $push: {
          progress: {
            $each: [{ at: now, kind: 'interrupted', message: interruptedMessage }],
            $slice: -MAX_PROGRESS_EVENTS,
          },
        },
      }
    );
    if (interrupted.modifiedCount === 1) {
      await finishAttempt(operation.operationId, {
        status: 'interrupted',
        completedAt: now,
        errorCode: 'RECOVERY_INTERRUPTED',
        errorMessage: interruptedMessage,
      });
    }
  }
}

function startHeartbeat(operationId, executorId) {
  const timer = setInterval(() => {
    RecoveryOperation.updateOne(
      { operationId, executorId, status: { $in: ['running', 'cancel-requested'] } },
      { $set: { heartbeatAt: new Date() } }
    ).catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

function deleteRegistryEntry(operationId, registryEntry) {
  if (inFlightOperations.get(operationId) === registryEntry) {
    inFlightOperations.delete(operationId);
  }
}

async function loadCurrentRecoveryState(operation) {
  const evidence = await getConversationEvidence(operation.conversationId);
  if (!fingerprintMatches(operation.evidenceFingerprint, evidence.acknowledgementFingerprint)) {
    throw createServiceError('EVIDENCE_CHANGED', 'Conversation evidence changed. Review the recovery options again.', 409);
  }
  const conversation = await Conversation.findById(operation.conversationId).lean();
  if (!conversation) throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  const canonicalTemplate = safeString(conversation.caseIntake?.canonicalTemplate, '');
  const parseFields = conversation.caseIntake?.parseFields || {};
  if (
    sha256(canonicalTemplate) !== operation.inputSnapshot?.canonicalTemplateSha256
    || sha256(parseFields) !== operation.inputSnapshot?.parseFieldsSha256
  ) {
    throw createServiceError('RECOVERY_INPUT_CHANGED', 'The verified triage input changed. Review the recovery options again.', 409);
  }
  const deterministic = parseEscalationText(canonicalTemplate);
  if (!parseFieldsAgree(deterministic, parseFields)) {
    throw createServiceError('RECOVERY_INPUT_MISMATCH', 'The deterministic parse no longer agrees with the saved fields.', 409);
  }
  return { evidence, conversation, deterministic, parseFields };
}

function buildRecoveredRunAndReceipt({ operation, conversation, sourceResult, resultLike, now }) {
  const previousReceipt = getTriageReceipt(conversation);
  const originalRun = operation.originalEvidence?.failedRun || getOriginalTriageRun(conversation);
  const recoversRunId = safeString(originalRun?.id || previousReceipt.standaloneRunId, '');
  const resultId = safeString(sourceResult?._id || resultLike?.savedResult?.id || resultLike?.triageMeta?.resultId, '');
  const standaloneRunId = safeString(sourceResult?.runId || resultLike?.runId, '');
  const identity = triageProviderIdentity({
    ...sourceResult,
    ...resultLike,
    status: resultLike?.status || sourceResult?.status,
    triageMeta: resultLike?.triageMeta || sourceResult?.triageMeta,
  });
  const providerPackageId = identity.providerPackageId;
  const fallbackUsed = identity.failoverUsed;
  const startedAt = new Date(now.getTime() - Math.max(0, Number(resultLike?.elapsedMs || sourceResult?.latencyMs) || 0));
  const recoveryRun = {
    id: randomUUID(),
    agentId: TRIAGE_AGENT_ID,
    agentName: 'Triage Agent',
    phase: 'triage',
    status: 'completed',
    provider: identity.provider,
    model: identity.model,
    traceId: '',
    startedAt,
    completedAt: now,
    durationMs: Math.max(0, Number(resultLike?.elapsedMs || sourceResult?.latencyMs) || 0),
    fallbackUsed,
    fallbackFrom: identity.failoverFrom,
    fallback: {
      used: fallbackUsed,
      reason: fallbackUsed
        ? (identity.failoverFrom
          ? `The validated result was produced by a backup provider after ${identity.failoverFrom} failed.`
          : 'The validated result was produced by a backup provider.')
        : '',
      from: identity.failoverFrom,
    },
    summary: 'Triage evidence was safely recovered from verified input.',
    detail: {
      confidence: resultLike?.card?.confidence || sourceResult?.card?.confidence || '',
      missingInfo: resultLike?.card?.missingInfo || sourceResult?.card?.missingInfo || [],
      source: 'evidence-recovery',
      providerPackageId,
      savedResultId: resultId,
      standaloneRunId,
      recoveryOperationId: operation.operationId,
      recoversRunId,
      validation: resultLike?.triageMeta?.validation || sourceResult?.triageMeta?.validation || null,
    },
    events: [{
      kind: 'triage.evidence_recovered',
      ts: now.getTime(),
      seq: 1,
      category: 'run',
      stageId: 'triage',
      runId: operation.operationId,
      data: { recoveryOperationId: operation.operationId, recoversRunId },
    }],
    eventCount: 1,
    recoveryOperationId: operation.operationId,
    recoversRunId,
  };
  const receipt = {
    planned: true,
    attempted: true,
    completed: true,
    failed: false,
    status: 'completed',
    cardSaved: true,
    resultSaveOk: true,
    saveFailureReported: false,
    savedResultId: resultId,
    standaloneRunId,
    providerPackageId,
    repairPackageId: safeString(
      resultLike?.triageMeta?.repair?.packageId || sourceResult?.triageMeta?.repair?.packageId,
      ''
    ),
    provider: identity.provider,
    model: identity.model,
    fallbackUsed,
    fallbackFrom: identity.failoverFrom,
    expiresAt: sourceResult?.expiresAt || resultLike?.savedResult?.expiresAt || null,
    completedAt: now,
    recordedAt: now,
    reportedVia: 'server',
    recoveryOperationId: operation.operationId,
    recoversRunId,
    errorCode: '',
    errorMessage: '',
    error: null,
  };
  return { recoveryRun, receipt };
}

async function recordActualProvider(operation, resultLike, sourceResult = null) {
  const identity = triageProviderIdentity({
    ...sourceResult,
    ...resultLike,
    status: resultLike?.status || sourceResult?.status,
    triageMeta: resultLike?.triageMeta || sourceResult?.triageMeta,
  });
  const result = await RecoveryOperation.updateOne(
    {
      operationId: operation.operationId,
      status: 'running',
      executorId: operation.executorId,
      'attempts.attempt': 1,
    },
    {
      $set: {
        'attempts.$.provider': identity.provider,
        'attempts.$.model': identity.model,
        'attempts.$.providerPackageId': identity.providerPackageId,
        'attempts.$.failoverUsed': identity.failoverUsed,
        'attempts.$.failoverFrom': identity.failoverFrom,
        'runtimeSnapshot.actualProvider': identity.provider,
        'runtimeSnapshot.actualModel': identity.model,
        'runtimeSnapshot.actualProviderPackageId': identity.providerPackageId,
        'runtimeSnapshot.failoverUsed': identity.failoverUsed,
        'runtimeSnapshot.failoverFrom': identity.failoverFrom,
        heartbeatAt: new Date(),
      },
    }
  );
  if (result.modifiedCount !== 1) {
    throw createServiceError('RECOVERY_STATE_CHANGED', 'Recovery state changed before the producing provider could be recorded.', 409);
  }
  operation.runtimeSnapshot = {
    ...(clonePlain(operation.runtimeSnapshot, {}) || {}),
    actualProvider: identity.provider,
    actualModel: identity.model,
    actualProviderPackageId: identity.providerPackageId,
    failoverUsed: identity.failoverUsed,
    failoverFrom: identity.failoverFrom,
  };
  return identity;
}

async function claimFinalCommit(operation, registryEntry) {
  const commitStartedAt = new Date();
  const claimed = await RecoveryOperation.updateOne(
    {
      operationId: operation.operationId,
      status: 'running',
      executorId: operation.executorId,
      commitStartedAt: null,
    },
    {
      $set: { commitStartedAt, heartbeatAt: commitStartedAt },
      $push: {
        progress: {
          $each: [{ at: commitStartedAt, kind: 'committing', message: 'The final guarded conversation write is starting.' }],
          $slice: -MAX_PROGRESS_EVENTS,
        },
      },
    }
  );
  if (claimed.modifiedCount !== 1) {
    throw createServiceError('RECOVERY_STATE_CHANGED', 'Recovery was cancelled or interrupted before the final write could start.', 409);
  }
  registryEntry.committing = true;
  registryEntry.commitStartedAt = commitStartedAt;
  operation.commitStartedAt = commitStartedAt;
  return commitStartedAt;
}

async function commitTriageResult(
  operation,
  currentState,
  sourceResult,
  resultLike,
  commitStartedAt,
  {
    comparison = operation?.candidateResult?.comparison || null,
    baselineReliable = Boolean(operation?.candidateResult?.comparison?.previousResultVerified),
  } = {}
) {
  const now = new Date();
  const { conversation } = currentState;
  const card = clonePlain(resultLike?.card || sourceResult?.card, null);
  if (!card) throw createServiceError('RECOVERY_CARD_MISSING', 'The verified triage result has no readable card.', 409);
  const { recoveryRun, receipt } = buildRecoveredRunAndReceipt({
    operation,
    conversation,
    sourceResult,
    resultLike,
    now,
  });
  const evidenceUpdatedAt = operation.evidenceFingerprint?.evidenceUpdatedAt;
  const ownsCommit = await RecoveryOperation.exists({
    operationId: operation.operationId,
    status: 'running',
    executorId: operation.executorId,
    commitStartedAt,
  });
  if (!ownsCommit) {
    throw createServiceError('RECOVERY_STATE_CHANGED', 'Recovery no longer owns the final write.', 409);
  }
  await prepareDownstreamMarkingIntent(
    operation,
    conversation,
    comparison,
    baselineReliable,
    commitStartedAt,
    now
  );
  const filter = {
    _id: operation.conversationId,
    'caseIntake.canonicalTemplate': operation.inputSnapshot.canonicalTemplate,
    'caseIntake.parseFields': currentState.parseFields,
  };
  if (evidenceUpdatedAt) {
    filter['caseIntake.evidence.updatedAt'] = new Date(evidenceUpdatedAt);
  } else {
    filter['caseIntake.evidence.updatedAt'] = { $exists: false };
  }
  const result = await Conversation.updateOne(
    filter,
    {
      $set: {
        'caseIntake.triageCard': card,
        'caseIntake.evidence.contractVersion': EVIDENCE_CONTRACT_VERSION,
        'caseIntake.evidence.receipts.triage': receipt,
        'caseIntake.evidence.updatedAt': now,
        'caseIntake.updatedAt': now,
      },
      $push: {
        'caseIntake.runs': { $each: [recoveryRun], $position: 0 },
      },
      $inc: { __v: 1 },
    }
  );
  if (result.modifiedCount !== 1) {
    throw createServiceError('EVIDENCE_CHANGED', 'Conversation evidence changed before the recovery write could commit.', 409);
  }
  const knowledgeDraftNeedsReview = await reconcilePendingDownstreamMarking(
    operation,
    { conversationWriteKnownApplied: true }
  );
  const writeMarker = await RecoveryOperation.updateOne(
    {
      operationId: operation.operationId,
      status: 'running',
      executorId: operation.executorId,
      commitStartedAt,
    },
    {
      $set: {
        conversationWriteApplied: true,
        commitCompletedAt: now,
        heartbeatAt: now,
        acceptedResult: {
          acceptedSha256: sha256(card),
          acceptedAt: now,
        },
        ...(knowledgeDraftNeedsReview ? {
          postRecoveryEvidence: {
            ...(clonePlain(operation.postRecoveryEvidence, {}) || {}),
            knowledgeDraftNeedsReview,
          },
        } : {}),
      },
      $push: {
        progress: {
          $each: [{ at: now, kind: 'write-applied', message: 'The guarded conversation recovery write was applied.' }],
          $slice: -MAX_PROGRESS_EVENTS,
        },
      },
    }
  );
  if (writeMarker.modifiedCount !== 1) {
    throw createServiceError(
      'RECOVERY_WRITE_MARKER_FAILED',
      'The conversation recovery write was applied, but its durable operation marker could not be saved.',
      500
    );
  }
  operation.conversationWriteApplied = true;
  operation.commitCompletedAt = now;
  operation.postRecoveryEvidence = knowledgeDraftNeedsReview
    ? {
        ...(clonePlain(operation.postRecoveryEvidence, {}) || {}),
        knowledgeDraftNeedsReview,
      }
    : null;
  return {
    card,
    resultId: receipt.savedResultId,
    runId: recoveryRun.id,
    committedAt: now,
    knowledgeDraftNeedsReview,
  };
}

async function finishAttempt(operationId, fields, guard = {}) {
  const completedAt = fields.completedAt || new Date();
  await RecoveryOperation.updateOne(
    { operationId, 'attempts.attempt': 1, ...guard },
    {
      $set: {
        'attempts.$.status': fields.status || 'completed',
        'attempts.$.completedAt': completedAt,
        'attempts.$.durationMs': fields.durationMs ?? null,
        'attempts.$.triageResultId': fields.triageResultId || '',
        'attempts.$.errorCode': fields.errorCode || '',
        'attempts.$.errorMessage': fields.errorMessage || '',
      },
    }
  );
}

async function failOperation(operationId, error, status = 'failed', {
  executorId = '',
  allowedStatuses = ['running', 'cancel-requested'],
} = {}) {
  const completedAt = new Date();
  const safeToReport = Number.isInteger(error?.status);
  const errorCode = safeToReport ? safeString(error?.code, 'RECOVERY_FAILED') : 'RECOVERY_FAILED';
  const errorMessage = safeToReport
    ? safeString(error?.message, 'Recovery failed.').slice(0, 1000)
    : 'Recovery could not be completed because of a server or database error.';
  const guard = { status: { $in: allowedStatuses } };
  if (executorId) guard.executorId = executorId;
  const currentOperation = await RecoveryOperation.findOne({ operationId, ...guard }).lean();
  if (currentOperation) {
    const appliedWrite = await findAppliedConversationWrite(currentOperation);
    if (appliedWrite) {
      if (currentOperation.downstreamMarking?.status === 'pending') {
        try {
          await reconcilePendingDownstreamMarking(currentOperation, { conversationWriteKnownApplied: true });
        } catch {
          // The pending intent remains visible and will be retried by later reconciliation lookups.
        }
      }
      await markWriteAppliedUnverified(currentOperation, {
        executorId,
        allowedStatuses,
        appliedAt: appliedWrite.appliedAt,
      });
      return;
    }
  }
  await finishAttempt(operationId, { status, completedAt, errorCode, errorMessage }, guard);
  await RecoveryOperation.updateOne(
    { operationId, ...guard },
    {
      $set: {
        status,
        completedAt,
        heartbeatAt: completedAt,
        errorCode,
        errorMessage,
        ...(currentOperation?.downstreamMarking?.status === 'pending' ? {
          'downstreamMarking.status': 'none',
          'downstreamMarking.completedAt': completedAt,
        } : {}),
      },
      $unset: { activePlanId: '' },
      $push: {
        progress: {
          $each: [{ at: completedAt, kind: status, message: errorMessage }],
          $slice: -MAX_PROGRESS_EVENTS,
        },
      },
    }
  );
}

async function markCancelled(operationId, message = 'Recovery was cancelled before any conversation evidence was changed.') {
  const now = new Date();
  const cancelled = await RecoveryOperation.updateOne(
    {
      operationId,
      status: { $in: ['confirmed', 'running', 'cancel-requested', 'awaiting-acceptance'] },
      commitStartedAt: null,
    },
    {
      $set: {
        status: 'cancelled',
        completedAt: now,
        heartbeatAt: now,
        cancellationRequestedAt: now,
        cancellationAcknowledgedAt: now,
        errorCode: '',
        errorMessage: '',
      },
      $unset: { activePlanId: '' },
      $push: {
        progress: {
          $each: [{ at: now, kind: 'cancelled', message }],
          $slice: -MAX_PROGRESS_EVENTS,
        },
      },
    }
  );
  if (cancelled.modifiedCount !== 1) return false;
  await finishAttempt(operationId, {
    status: 'cancelled',
    completedAt: now,
    errorCode: 'RECOVERY_CANCELLED',
    errorMessage: message,
  });
  return true;
}

async function finalizeCommittedOperation(operation, committed, startedAt) {
  const evidence = await getConversationEvidence(operation.conversationId);
  const artifactsByCode = new Map((evidence.artifacts || []).map((artifact) => [artifact.code, artifact]));
  const confirmedCodes = operation.missingCodes.filter((code) => artifactsByCode.get(code)?.state === 'confirmed');
  const allTargetedConfirmed = confirmedCodes.length === operation.missingCodes.length;
  const completedAt = new Date();
  const postRecoveryEvidence = {
    status: evidence.status,
    settled: Boolean(evidence.settled),
    confirmedTargetCodes: confirmedCodes,
    remainingMissingCodes: (evidence.missing || []).map((artifact) => artifact.code),
    checkedAt: evidence.checkedAt || completedAt,
    knowledgeDraftNeedsReview: committed.knowledgeDraftNeedsReview || null,
  };
  const status = allTargetedConfirmed ? 'succeeded' : 'succeeded-unverified';
  const errorCode = allTargetedConfirmed ? '' : 'TARGET_EVIDENCE_NOT_CONFIRMED';
  const errorMessage = allTargetedConfirmed
    ? ''
    : 'The conversation write completed, but the targeted evidence is still not confirmed.';
  const finalizationGuard = {
    status: 'running',
    executorId: operation.executorId,
    commitStartedAt: operation.commitStartedAt,
  };
  await finishAttempt(operation.operationId, {
    status,
    completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    triageResultId: committed.resultId,
    errorCode,
    errorMessage,
  }, finalizationGuard);
  const finalized = await RecoveryOperation.updateOne(
    { operationId: operation.operationId, ...finalizationGuard },
    {
      $set: {
        status,
        completedAt,
        heartbeatAt: completedAt,
        postRecoveryEvidence,
        acceptedResult: {
          acceptedSha256: sha256(committed.card),
          acceptedAt: committed.committedAt,
        },
        errorCode,
        errorMessage,
      },
      $unset: { activePlanId: '' },
      $push: {
        progress: {
          $each: [{
            at: completedAt,
            kind: status,
            message: allTargetedConfirmed
              ? 'The targeted triage evidence is now confirmed.'
              : errorMessage,
          }],
          $slice: -MAX_PROGRESS_EVENTS,
        },
      },
    }
  );
  if (finalized.modifiedCount !== 1) {
    throw createServiceError('RECOVERY_STATE_CHANGED', 'Recovery lost ownership before its final status could be saved.', 409);
  }
}

async function operationWasCancelled(operationId) {
  const current = await RecoveryOperation.findOne({ operationId }).select('status').lean();
  return current?.status === 'cancel-requested' || current?.status === 'cancelled';
}

async function parkCandidateIfDifferent({
  operation,
  registryEntry,
  startedAt,
  previousCard,
  candidateResult,
  resultLike,
  comparison = null,
  baselineReliable = false,
}) {
  if (!previousCard) return false;
  const resolvedComparison = comparison || compareTriageCards(previousCard, candidateResult.card);
  if (!resolvedComparison.meaningfullyDifferent) return false;
  if (registryEntry.controller.signal.aborted || registryEntry.cancelRequested) {
    await markCancelled(operation.operationId, 'The recovery cancellation was acknowledged; no candidate was adopted into the conversation.');
    return true;
  }
  const completedAt = new Date();
  const comparisonWithHashes = {
    ...resolvedComparison,
    previousResultVerified: Boolean(baselineReliable),
    candidateSha256: sha256(candidateResult.card),
    previousSha256: sha256(previousCard),
  };
  const parked = await RecoveryOperation.updateOne(
    {
      operationId: operation.operationId,
      status: 'running',
      executorId: operation.executorId,
      commitStartedAt: null,
      'attempts.attempt': 1,
    },
    {
      $set: {
        status: 'awaiting-acceptance',
        executorId: '',
        heartbeatAt: completedAt,
        acceptExpiresAt: candidateResult.expiresAt || null,
        'attempts.$.status': 'awaiting-acceptance',
        'attempts.$.completedAt': completedAt,
        'attempts.$.durationMs': completedAt.getTime() - startedAt.getTime(),
        'attempts.$.triageResultId': safeString(candidateResult._id, ''),
        candidateResult: {
          card: clonePlain(candidateResult.card, null),
          rawOutputSha256: sha256(resultLike?.rawOutput || candidateResult.rawOutput || ''),
          triageResultId: safeString(candidateResult._id, ''),
          comparison: comparisonWithHashes,
        },
        errorCode: '',
        errorMessage: '',
      },
      $push: {
        progress: {
          $each: [{
            at: completedAt,
            kind: 'awaiting-acceptance',
            message: operation.strategy === 'repersist'
              ? 'The matching saved triage card differs from the visible card and needs acceptance before replacement.'
              : 'The recovered triage card is meaningfully different and needs acceptance before the conversation changes.',
          }],
          $slice: -MAX_PROGRESS_EVENTS,
        },
      },
    }
  );
  if (parked.modifiedCount !== 1) {
    if (await operationWasCancelled(operation.operationId)) {
      await markCancelled(operation.operationId, 'The recovery cancellation was acknowledged; no candidate was adopted into the conversation.');
      return true;
    }
    throw createServiceError('RECOVERY_STATE_CHANGED', 'Recovery state changed before the candidate could be saved for review.', 409);
  }
  return true;
}

async function executeRepersist(operation, registryEntry, startedAt) {
  const currentState = await loadCurrentRecoveryState(operation);
  const sourceResult = await locateTriageResult(currentState.conversation, operation.inputSnapshot?.sourceRecordIds);
  if (sourceResult && !isGenuineAiTriageResult(sourceResult)) {
    throw createServiceError(
      'RECOVERY_SOURCE_UNAVAILABLE',
      'The stored copy was an emergency fallback, not a real AI result.',
      409
    );
  }
  if (
    !sourceResult
    || !isUnexpiredTriageResult(sourceResult)
    || sha256(safeString(sourceResult.parserText, '')) !== operation.inputSnapshot.canonicalTemplateSha256
    || !parseFieldsAgree(currentState.deterministic, sourceResult.parseFields)
  ) {
    throw createServiceError(
      'RECOVERY_SOURCE_UNAVAILABLE',
      'The original triage result is no longer readable, current, and matched to the verified input.',
      409
    );
  }
  if (registryEntry.controller.signal.aborted || await operationWasCancelled(operation.operationId)) {
    await markCancelled(operation.operationId);
    return;
  }
  await recordActualProvider(operation, sourceResult, sourceResult);
  const previousBaseline = resolvePreviousBaseline({
    sourceResult,
    inputSnapshot: operation.inputSnapshot,
    deterministicFields: currentState.deterministic,
    visibleCard: currentState.conversation?.caseIntake?.triageCard,
  });
  const previousCard = previousBaseline.displayCard;
  const comparison = previousCard ? compareTriageCards(previousCard, sourceResult.card) : null;
  const parked = await parkCandidateIfDifferent({
    operation,
    registryEntry,
    startedAt,
    previousCard,
    candidateResult: sourceResult,
    resultLike: sourceResult,
    comparison,
    baselineReliable: previousBaseline.reliable,
  });
  if (parked) return;
  if (registryEntry.controller.signal.aborted || await operationWasCancelled(operation.operationId)) {
    await markCancelled(operation.operationId);
    return;
  }
  const commitStartedAt = await claimFinalCommit(operation, registryEntry);
  const committed = await commitTriageResult(operation, currentState, sourceResult, {
    status: sourceResult.status,
    card: sourceResult.card,
    triageMeta: sourceResult.triageMeta,
    providerUsed: sourceResult.provider,
    modelUsed: sourceResult.model,
    elapsedMs: sourceResult.latencyMs,
    runId: sourceResult.runId,
    fallbackUsed: sourceResult.fallbackUsed,
  }, commitStartedAt, { comparison, baselineReliable: previousBaseline.reliable });
  await finalizeCommittedOperation(operation, committed, startedAt);
}

async function loadPriorBaseline(operation, conversation) {
  const sourceResult = await locateTriageResult(conversation, operation.inputSnapshot?.sourceRecordIds);
  const deterministicFields = operation.inputSnapshot?.canonicalTemplate
    ? parseEscalationText(operation.inputSnapshot.canonicalTemplate)
    : null;
  return resolvePreviousBaseline({
    sourceResult,
    inputSnapshot: operation.inputSnapshot,
    deterministicFields,
    visibleCard: conversation?.caseIntake?.triageCard,
  });
}

async function executeRerun(operation, registryEntry, startedAt) {
  const currentState = await loadCurrentRecoveryState(operation);
  let persistObservation = null;
  const runtime = operation.runtimeSnapshot || {};
  const runId = `recovery-${operation.operationId}`;
  let result;
  try {
    result = await runTriage(operation.inputSnapshot.canonicalTemplate, {
      runId,
      provider: runtime.provider,
      model: runtime.model,
      fallbackProvider: runtime.fallbackProvider,
      fallbackModel: runtime.fallbackModel,
      reasoningEffort: runtime.reasoningEffort,
      serviceTier: runtime.serviceTier,
      agentRuntime: { ...runtime, configured: true },
      signal: registryEntry.controller.signal,
      propagateAbort: true,
      eventBus: createRecoveryEventBus(operation.operationId, registryEntry),
      source: 'evidence-recovery',
      triageMeta: { recoveryOperationId: operation.operationId },
      onPersistResult(observation) {
        persistObservation = clonePlain(observation, null);
      },
    });
  } catch (error) {
    await recordAttemptProvenance(operation, registryEntry, error, persistObservation);
    throw error;
  }
  await recordAttemptProvenance(operation, registryEntry, result, persistObservation);

  if (await operationWasCancelled(operation.operationId) || registryEntry.controller.signal.aborted) {
    await markCancelled(operation.operationId, 'The recovery cancellation was acknowledged; no candidate was adopted into the conversation.');
    return;
  }
  if (!isGenuineAiTriageResult(result)) {
    throw createServiceError(
      'RECOVERY_TRIAGE_DEGRADED',
      'The provider was unavailable or returned a degraded triage result, so no cost-bearing result was adopted.',
      502
    );
  }
  const triageResultId = safeString(
    persistObservation?.id || result.savedResult?.id || result.triageMeta?.resultId,
    ''
  );
  if (!persistObservation?.ok || !triageResultId) {
    throw createServiceError(
      'TRIAGE_RESULT_SAVE_FAILED',
      'The new triage result could not be saved, so the conversation was left unchanged.',
      500
    );
  }

  const candidateResult = await TriageResult.findById(triageResultId).lean();
  if (!candidateResult || !isUnexpiredTriageResult(candidateResult) || !isGenuineAiTriageResult(candidateResult)) {
    throw createServiceError('TRIAGE_RESULT_UNREADABLE', 'The new triage history result is not readable.', 500);
  }
  const previousBaseline = await loadPriorBaseline(operation, currentState.conversation);
  const previousCard = previousBaseline.displayCard;
  const comparison = previousCard ? compareTriageCards(previousCard, candidateResult.card) : null;
  await recordActualProvider(operation, result, candidateResult);
  const parked = await parkCandidateIfDifferent({
    operation,
    registryEntry,
    startedAt,
    previousCard,
    candidateResult,
    resultLike: result,
    comparison,
    baselineReliable: previousBaseline.reliable,
  });
  if (parked) return;

  if (registryEntry.controller.signal.aborted || await operationWasCancelled(operation.operationId)) {
    await markCancelled(operation.operationId);
    return;
  }
  const commitStartedAt = await claimFinalCommit(operation, registryEntry);
  const committed = await commitTriageResult(operation, currentState, candidateResult, {
    ...result,
    runId,
  }, commitStartedAt, { comparison, baselineReliable: previousBaseline.reliable });
  await finalizeCommittedOperation(operation, committed, startedAt);
}

async function executeRecoveryOperation(operationId) {
  const startedAt = new Date();
  const executorId = randomUUID();
  const confirmed = await RecoveryOperation.findOne({ operationId, status: 'confirmed' }).lean();
  if (!confirmed) return;
  const operation = await RecoveryOperation.findOneAndUpdate(
    { operationId, status: 'confirmed' },
    {
      $set: {
        status: 'running',
        executorId,
        commitStartedAt: null,
        startedAt,
        heartbeatAt: startedAt,
        errorCode: '',
        errorMessage: '',
      },
      $push: {
        attempts: {
          attempt: 1,
          strategy: confirmed.strategy,
          status: 'running',
          provider: confirmed.runtimeSnapshot?.provider || '',
          model: confirmed.runtimeSnapshot?.model || '',
          startedAt,
        },
        progress: {
          $each: [{ at: startedAt, kind: 'running', message: 'Recovery started from the confirmed plan.' }],
          $slice: -MAX_PROGRESS_EVENTS,
        },
      },
    },
    { returnDocument: 'after' }
  ).lean();
  if (!operation) return;

  const registryEntry = {
    executorId,
    controller: new AbortController(),
    handedOff: false,
    providerHandoffAt: null,
    plannedProvider: safeString(operation.runtimeSnapshot?.provider, ''),
    plannedModel: safeString(operation.runtimeSnapshot?.model, ''),
    contactedProviders: [],
    provenanceWrites: [],
    committing: false,
    cancelRequested: false,
    heartbeatTimer: null,
  };
  registryEntry.heartbeatTimer = startHeartbeat(operationId, executorId);
  inFlightOperations.set(operationId, registryEntry);
  try {
    if (await operationWasCancelled(operationId)) {
      registryEntry.controller.abort();
      await markCancelled(operationId);
      return;
    }
    if (operation.strategy === 'repersist') {
      await executeRepersist(operation, registryEntry, startedAt);
    } else {
      await executeRerun(operation, registryEntry, startedAt);
    }
  } catch (error) {
    if (registryEntry.controller.signal.aborted || await operationWasCancelled(operationId)) {
      await markCancelled(operationId, 'The recovery cancellation was acknowledged; no candidate was adopted into the conversation.');
    } else {
      const manualReview = error?.code === 'RECOVERY_SOURCE_UNAVAILABLE' || error?.code === 'RECOVERY_INPUT_MISMATCH';
      await failOperation(operationId, error, manualReview ? 'manual-review' : 'failed', { executorId });
    }
  } finally {
    if (registryEntry.heartbeatTimer) clearInterval(registryEntry.heartbeatTimer);
    deleteRegistryEntry(operationId, registryEntry);
  }
}

async function confirmRecovery(conversationId, { action, evidenceFingerprint, idempotencyKey } = {}) {
  await markStaleRunningOperations();
  const cleanAction = safeString(action, '').trim();
  const cleanIdempotencyKey = safeString(idempotencyKey, '').trim();
  if (!cleanAction) throw createServiceError('RECOVERY_ACTION_REQUIRED', 'Choose a recovery action.', 400);
  if (!cleanIdempotencyKey || cleanIdempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw createServiceError('IDEMPOTENCY_KEY_REQUIRED', 'A valid idempotency key is required.', 400);
  }
  let operation = await RecoveryOperation.findOne({ idempotencyKey: cleanIdempotencyKey }).lean();
  if (operation) {
    if (
      safeString(operation.conversationId, '') !== safeString(conversationId, '')
      || operationPlanId(operation) !== cleanAction
    ) {
      throw createServiceError('IDEMPOTENCY_KEY_CONFLICT', 'That idempotency key belongs to a different recovery plan.', 409);
    }
    return { operation: serializeOperation(operation), created: false };
  }

  const existingOperations = await RecoveryOperation.find(planOperationFilter(cleanAction))
    .sort({ attemptNumber: -1, createdAt: -1 })
    .lean();
  const blockingOperation = existingOperations.find((candidate) => !isRetryableTerminalOperation(candidate));
  if (blockingOperation) {
    if (safeString(blockingOperation.conversationId, '') !== safeString(conversationId, '')) {
      throw createServiceError('IDEMPOTENCY_KEY_CONFLICT', 'That recovery plan belongs to a different conversation.', 409);
    }
    return { operation: serializeOperation(blockingOperation), created: false };
  }

  if (!isObject(evidenceFingerprint)) {
    throw createServiceError('EVIDENCE_FINGERPRINT_REQUIRED', 'The reviewed evidence fingerprint is required.', 400);
  }

  const plans = await buildRecoveryOptions(conversationId);
  if (!fingerprintMatches(evidenceFingerprint, plans.evidenceFingerprint)) {
    throw createServiceError('EVIDENCE_CHANGED', 'Conversation evidence changed. Review the recovery options again.', 409);
  }
  const plan = plans.options.find((option) => option.planId === cleanAction);
  if (!plan) {
    if (plans.options.some((option) => option.targetStage === 'triage')) {
      throw createServiceError(
        'RECOVERY_PLAN_CHANGED',
        'The reviewed recovery plan changed, including its provider settings. Review the options again.',
        409
      );
    }
    throw createServiceError('RECOVERY_PLAN_UNAVAILABLE', 'That recovery plan is no longer available. Review the options again.', 409);
  }
  if (plan.strategy === 'manual-review') {
    throw createServiceError('RECOVERY_NOT_AUTOMATABLE', plan.reason, 409);
  }

  const conversation = await Conversation.findById(conversationId).lean();
  if (!conversation) throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  const sourceResult = await locateTriageResult(conversation);
  const inputSnapshot = buildInputSnapshot(conversation, sourceResult);
  const confirmationEvidence = await getConversationEvidence(conversationId);
  if (!fingerprintMatches(evidenceFingerprint, confirmationEvidence.acknowledgementFingerprint)) {
    throw createServiceError('EVIDENCE_CHANGED', 'Conversation evidence changed. Review the recovery options again.', 409);
  }
  const confirmationPlanId = buildDedupeKey({
    conversationId,
    stage: 'triage',
    strategy: plan.strategy,
    inputHash: buildPlanInputHash(inputSnapshot),
    evidenceFingerprint: confirmationEvidence.acknowledgementFingerprint,
    runtimeSnapshot: plan.runtimeSnapshot,
  });
  if (confirmationPlanId !== plan.planId) {
    throw createServiceError('RECOVERY_INPUT_CHANGED', 'The verified triage input changed. Review the recovery options again.', 409);
  }
  const sourceIdentity = triageProviderIdentity(sourceResult);
  let runtimeSnapshot;
  if (plan.strategy === 'rerun-stage') {
    const reviewedRuntimeSnapshot = normalizeRuntimeSnapshot(plan.runtimeSnapshot);
    const currentRuntimeSnapshot = await resolveRuntimeSnapshot();
    if (!runtimeSnapshotsMatch(reviewedRuntimeSnapshot, currentRuntimeSnapshot)) {
      throw createServiceError(
        'RECOVERY_PLAN_CHANGED',
        'Runtime Defaults changed after this recovery plan was reviewed. Review the options again.',
        409
      );
    }
    const readiness = await buildReadiness(reviewedRuntimeSnapshot);
    assertRecoveryReadiness(readiness);
    runtimeSnapshot = reviewedRuntimeSnapshot;
  } else {
    runtimeSnapshot = {
      provider: '',
      model: '',
      fallbackProvider: '',
      fallbackModel: '',
      reasoningEffort: '',
      serviceTier: '',
      actualProvider: sourceIdentity.provider,
      actualModel: sourceIdentity.model,
      actualProviderPackageId: sourceIdentity.providerPackageId,
      failoverUsed: sourceIdentity.failoverUsed,
      failoverFrom: sourceIdentity.failoverFrom,
    };
  }
  const previousAttemptNumber = existingOperations.reduce(
    (highest, candidate) => Math.max(highest, Number(candidate.attemptNumber) || 1),
    0
  );
  const attemptNumber = previousAttemptNumber + 1;
  const dedupeKey = buildAttemptDedupeKey(plan.planId, attemptNumber);
  const operationId = randomUUID();
  const createdAt = new Date();
  const operationRecord = {
    operationId,
    idempotencyKey: cleanIdempotencyKey,
    dedupeKey,
    planId: plan.planId,
    attemptNumber,
    activePlanId: plan.planId,
    conversationId,
    targetStage: 'triage',
    strategy: plan.strategy,
    status: 'confirmed',
    evidenceFingerprint: normalizeFingerprint(confirmationEvidence.acknowledgementFingerprint),
    missingCodes: plan.artifactCodes,
    inputSnapshot,
    runtimeSnapshot,
    originalEvidence: buildOriginalEvidence(conversation, confirmationEvidence, sourceResult),
    acceptExpiresAt: plan.strategy === 'repersist' ? (sourceResult?.expiresAt || null) : null,
    progress: [{ at: createdAt, kind: 'confirmed', message: 'The recovery plan was confirmed from the current evidence.' }],
  };

  let writeResult;
  let created = false;
  try {
    writeResult = await RecoveryOperation.updateOne(
      { dedupeKey },
      { $setOnInsert: operationRecord },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    created = writeResult.upsertedCount === 1;
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }

  operation = await RecoveryOperation.findOne({ idempotencyKey: cleanIdempotencyKey }).lean();
  if (!operation) {
    operation = await RecoveryOperation.findOne({ activePlanId: plan.planId }).lean();
  }
  if (!operation) {
    operation = await RecoveryOperation.findOne({ dedupeKey }).lean();
  }
  if (!operation) throw createServiceError('RECOVERY_CREATE_FAILED', 'The recovery operation could not be created.', 500);
  if (
    safeString(operation.conversationId, '') !== safeString(conversationId, '')
    || operationPlanId(operation) !== plan.planId
  ) {
    throw createServiceError('IDEMPOTENCY_KEY_CONFLICT', 'That idempotency key belongs to a different recovery plan.', 409);
  }
  if (created) {
    setImmediate(() => {
      executeRecoveryOperation(operation.operationId)
        .catch((error) => failOperation(operation.operationId, error, 'failed', {
          allowedStatuses: ['confirmed', 'running', 'cancel-requested'],
        }))
        .catch(() => {});
    });
  }
  return { operation: serializeOperation(operation), created };
}

async function reconcileExpiredAwaitingAcceptance({ conversationId = null, operationId = '' } = {}) {
  const now = new Date();
  const reason = 'The stored result expired before it was accepted; human review is required.';
  const filter = {
    status: 'awaiting-acceptance',
    acceptExpiresAt: { $ne: null, $lte: now },
  };
  if (conversationId) filter.conversationId = conversationId;
  if (operationId) filter.operationId = operationId;
  await RecoveryOperation.updateMany(
    filter,
    {
      $set: {
        status: 'manual-review',
        completedAt: now,
        heartbeatAt: now,
        errorCode: 'RECOVERY_CANDIDATE_EXPIRED',
        errorMessage: reason,
        'attempts.$[attempt].status': 'manual-review',
        'attempts.$[attempt].completedAt': now,
        'attempts.$[attempt].errorCode': 'RECOVERY_CANDIDATE_EXPIRED',
        'attempts.$[attempt].errorMessage': reason,
      },
      $unset: { activePlanId: '' },
      $push: {
        progress: {
          $each: [{ at: now, kind: 'manual-review', message: reason }],
          $slice: -MAX_PROGRESS_EVENTS,
        },
      },
    },
    { arrayFilters: [{ 'attempt.status': 'awaiting-acceptance' }] }
  );
}

async function getOperation(conversationId, operationId) {
  await markStaleRunningOperations();
  await reconcileExpiredAwaitingAcceptance({ conversationId, operationId });
  const operation = await RecoveryOperation.findOne({ conversationId, operationId }).lean();
  if (!operation) throw createServiceError('RECOVERY_NOT_FOUND', 'Recovery operation not found.', 404);
  await reconcileDoneDownstreamOwnership(operation);
  return serializeOperation(operation);
}

async function listConversationRecoveryHistory(conversationId) {
  await markStaleRunningOperations();
  await reconcileExpiredAwaitingAcceptance({ conversationId });
  const conversationExists = await Conversation.exists({ _id: conversationId });
  if (!conversationExists) throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  const operations = await RecoveryOperation.find({ conversationId })
    .sort({ createdAt: 1, attemptNumber: 1 })
    .limit(100)
    .lean();
  await Promise.all(operations.map(reconcileDoneDownstreamOwnership));
  return operations.map(serializeHistoryOperation);
}

async function acceptCandidate(conversationId, operationId, { candidateSha256, previousSha256 } = {}) {
  await markStaleRunningOperations();
  const cleanCandidateSha = safeString(candidateSha256, '').trim();
  const cleanPreviousSha = safeString(previousSha256, '').trim();
  if (!cleanCandidateSha || !cleanPreviousSha) {
    throw createServiceError('RECOVERY_HASHES_REQUIRED', 'The candidate and previous-card hashes are required.', 400);
  }
  let operation = await RecoveryOperation.findOne({ conversationId, operationId }).lean();
  if (!operation) throw createServiceError('RECOVERY_NOT_FOUND', 'Recovery operation not found.', 404);
  const storedCandidateSha = safeString(operation.candidateResult?.comparison?.candidateSha256, '');
  const storedPreviousSha = safeString(operation.candidateResult?.comparison?.previousSha256, '');

  if (operation.status === 'succeeded' || operation.status === 'succeeded-unverified') {
    if (operation.acceptedResult?.acceptedSha256 === cleanCandidateSha) {
      return { operation: serializeOperation(operation), idempotent: true };
    }
    throw createServiceError('RECOVERY_ALREADY_DECIDED', 'A different recovery result was already accepted.', 409);
  }
  if (operation.status !== 'awaiting-acceptance') {
    throw createServiceError('RECOVERY_ALREADY_DECIDED', 'This recovery operation can no longer accept a candidate.', 409);
  }
  if (storedCandidateSha !== cleanCandidateSha || storedPreviousSha !== cleanPreviousSha) {
    throw createServiceError('RECOVERY_CANDIDATE_CHANGED', 'The shown recovery comparison changed. Review it again before accepting.', 409);
  }

  const candidateResult = await TriageResult.findById(operation.candidateResult?.triageResultId).lean();
  const acceptExpiresAt = candidateResult?.expiresAt || operation.acceptExpiresAt || null;
  const acceptExpiryMs = acceptExpiresAt ? new Date(acceptExpiresAt).getTime() : null;
  if (Number.isFinite(acceptExpiryMs) && acceptExpiryMs <= Date.now()) {
    const expiredError = createServiceError(
      'RECOVERY_CANDIDATE_EXPIRED',
      'This saved triage candidate expired before it was accepted. The operation now needs manual review.',
      409
    );
    await failOperation(operationId, expiredError, 'manual-review', {
      allowedStatuses: ['awaiting-acceptance'],
    });
    throw expiredError;
  }
  const currentState = await loadCurrentRecoveryState(operation);
  // The stored hashes protect the comparison the reviewer saw. Marker suppression
  // is stricter: it only trusts that visible card when a reliable stored source backs it.
  const previousBaseline = await loadPriorBaseline(operation, currentState.conversation);
  if (!previousBaseline.displayCard || sha256(previousBaseline.displayCard) !== cleanPreviousSha) {
    throw createServiceError('RECOVERY_PREVIOUS_CHANGED', 'The previous triage card changed. Review the comparison again.', 409);
  }
  if (
    !candidateResult
    || !isUnexpiredTriageResult(candidateResult)
    || !isGenuineAiTriageResult(candidateResult)
    || sha256(candidateResult.card) !== cleanCandidateSha
    || sha256(safeString(candidateResult.parserText, '')) !== operation.inputSnapshot.canonicalTemplateSha256
    || !parseFieldsAgree(currentState.deterministic, candidateResult.parseFields)
  ) {
    throw createServiceError('RECOVERY_CANDIDATE_CHANGED', 'The candidate result is no longer readable and unchanged.', 409);
  }

  const acceptedAt = new Date();
  const executorId = randomUUID();
  const locked = await RecoveryOperation.findOneAndUpdate(
    {
      conversationId,
      operationId,
      status: 'awaiting-acceptance',
      'candidateResult.comparison.candidateSha256': cleanCandidateSha,
      'candidateResult.comparison.previousSha256': cleanPreviousSha,
    },
    {
      $set: {
        status: 'running',
        executorId,
        commitStartedAt: null,
        heartbeatAt: acceptedAt,
        'attempts.$[attempt].status': 'running',
      },
      $push: {
        progress: {
          $each: [{ at: acceptedAt, kind: 'accepted', message: 'The reviewed candidate was accepted; the final atomic write is starting.' }],
          $slice: -MAX_PROGRESS_EVENTS,
        },
      },
    },
    { returnDocument: 'after', arrayFilters: [{ 'attempt.attempt': 1 }] }
  ).lean();
  if (!locked) {
    operation = await RecoveryOperation.findOne({ conversationId, operationId }).lean();
    if (
      (operation?.status === 'succeeded' || operation?.status === 'succeeded-unverified')
      && operation.acceptedResult?.acceptedSha256 === cleanCandidateSha
    ) {
      return { operation: serializeOperation(operation), idempotent: true };
    }
    throw createServiceError('RECOVERY_ALREADY_DECIDED', 'This recovery operation was already decided.', 409);
  }

  const registryEntry = {
    executorId,
    controller: new AbortController(),
    handedOff: false,
    committing: false,
    cancelRequested: false,
    heartbeatTimer: null,
  };
  registryEntry.heartbeatTimer = startHeartbeat(operationId, executorId);
  inFlightOperations.set(operationId, registryEntry);
  try {
    const commitStartedAt = await claimFinalCommit(locked, registryEntry);
    const committed = await commitTriageResult(locked, currentState, candidateResult, {
      status: candidateResult.status,
      card: candidateResult.card,
      triageMeta: candidateResult.triageMeta,
      providerUsed: candidateResult.provider,
      modelUsed: candidateResult.model,
      elapsedMs: candidateResult.latencyMs,
      runId: candidateResult.runId,
      fallbackUsed: candidateResult.fallbackUsed,
    }, commitStartedAt, {
      comparison: locked.candidateResult?.comparison || null,
      baselineReliable: previousBaseline.reliable,
    });
    await finalizeCommittedOperation(locked, committed, locked.startedAt ? new Date(locked.startedAt) : acceptedAt);
  } catch (error) {
    await failOperation(operationId, error, 'failed', { executorId });
    throw error;
  } finally {
    if (registryEntry.heartbeatTimer) clearInterval(registryEntry.heartbeatTimer);
    deleteRegistryEntry(operationId, registryEntry);
  }
  operation = await RecoveryOperation.findOne({ conversationId, operationId }).lean();
  return { operation: serializeOperation(operation), idempotent: false };
}

async function cancelOperation(conversationId, operationId) {
  await markStaleRunningOperations();
  let operation = await RecoveryOperation.findOne({ conversationId, operationId }).lean();
  if (!operation) throw createServiceError('RECOVERY_NOT_FOUND', 'Recovery operation not found.', 404);
  const registryEntry = inFlightOperations.get(operationId);

  if (operation.status === 'succeeded' || operation.status === 'succeeded-unverified') {
    return { operation: serializeOperation(operation), alreadyCompleted: true };
  }
  if (operation.status === 'cancelled') {
    return { operation: serializeOperation(operation), idempotent: true };
  }
  if (operation.status === 'cancel-requested') {
    return {
      operation: serializeOperation(operation),
      cancellationAcknowledged: true,
      bestEffort: true,
    };
  }
  if (TERMINAL_STATUSES.has(operation.status)) {
    throw createServiceError('RECOVERY_ALREADY_DECIDED', 'This recovery operation already ended.', 409);
  }
  if (registryEntry?.committing || operation.commitStartedAt) {
    return { operation: serializeOperation(operation), alreadyCompleted: true };
  }

  const now = new Date();
  const cleanCancel = operation.status === 'confirmed'
    || operation.status === 'awaiting-acceptance'
    || (operation.status === 'running' && (!registryEntry || !registryEntry.handedOff));
  if (registryEntry) registryEntry.cancelRequested = true;
  if (registryEntry?.controller && !registryEntry.controller.signal.aborted) {
    registryEntry.controller.abort();
  }
  if (cleanCancel) {
    const cancelled = await markCancelled(operationId, 'Recovery was cancelled before the final conversation write.');
    if (!cancelled) {
      operation = await RecoveryOperation.findOne({ conversationId, operationId }).lean();
      if (
        operation?.commitStartedAt
        || operation?.status === 'succeeded'
        || operation?.status === 'succeeded-unverified'
      ) {
        return { operation: serializeOperation(operation), alreadyCompleted: true };
      }
      if (operation?.status === 'cancelled') {
        return { operation: serializeOperation(operation), idempotent: true };
      }
      throw createServiceError('RECOVERY_STATE_CHANGED', 'Recovery state changed before cancellation could be recorded.', 409);
    }
  } else {
    const cancelWrite = await RecoveryOperation.updateOne(
      { conversationId, operationId, status: 'running', commitStartedAt: null },
      {
        $set: {
          status: 'cancel-requested',
          heartbeatAt: now,
          cancellationRequestedAt: now,
          cancellationAcknowledgedAt: now,
        },
        $push: {
          progress: {
            $each: [{ at: now, kind: 'cancel-requested', message: 'Cancellation was requested after provider handoff and is being attempted.' }],
            $slice: -MAX_PROGRESS_EVENTS,
          },
        },
      }
    );
    if (cancelWrite.modifiedCount !== 1) {
      const latest = await RecoveryOperation.findOne({ conversationId, operationId })
        .select('status commitStartedAt')
        .lean();
      if (
        latest?.commitStartedAt
        || latest?.status === 'succeeded'
        || latest?.status === 'succeeded-unverified'
      ) {
        operation = await RecoveryOperation.findOne({ conversationId, operationId }).lean();
        return { operation: serializeOperation(operation), alreadyCompleted: true };
      }
      if (latest?.status === 'awaiting-acceptance' && !registryEntry?.committing) {
        await markCancelled(operationId, 'The recovery cancellation was acknowledged; no candidate was adopted into the conversation.');
      }
    }
  }
  operation = await RecoveryOperation.findOne({ conversationId, operationId }).lean();
  return {
    operation: serializeOperation(operation),
    cancellationAcknowledged: true,
    bestEffort: !cleanCancel,
  };
}

async function listActiveOperations() {
  await markStaleRunningOperations();
  await reconcileExpiredAwaitingAcceptance();
  const operations = await RecoveryOperation.find({ status: { $in: ACTIVE_STATUSES } })
    .select('operationId conversationId targetStage strategy status missingCodes heartbeatAt startedAt createdAt updatedAt acceptExpiresAt candidateResult.comparison downstreamMarking')
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean();
  await Promise.all(operations.map(reconcileDoneDownstreamOwnership));
  return operations.map((operation) => ({
    operationId: operation.operationId,
    conversationId: safeString(operation.conversationId, ''),
    targetStage: operation.targetStage,
    strategy: operation.strategy,
    status: operation.status,
    missingCodes: operation.missingCodes || [],
    needsAcceptance: operation.status === 'awaiting-acceptance',
    comparisonSummary: operation.candidateResult?.comparison?.plainSummary || [],
    acceptExpiresAt: operation.acceptExpiresAt || null,
    heartbeatAt: operation.heartbeatAt || null,
    startedAt: operation.startedAt || null,
    createdAt: operation.createdAt || null,
    updatedAt: operation.updatedAt || null,
  }));
}

if (RecoveryOperation.db?.readyState === 1) {
  setImmediate(() => {
    markStaleRunningOperations().catch(() => {});
  });
} else {
  RecoveryOperation.db?.once('connected', () => {
    markStaleRunningOperations().catch(() => {});
  });
}

module.exports = {
  acceptCandidate,
  buildRecoveryOptions,
  cancelOperation,
  confirmRecovery,
  getOperation,
  listActiveOperations,
  listConversationRecoveryHistory,
  reconcilePendingRecoveryForKnowledgeCandidate,
};
