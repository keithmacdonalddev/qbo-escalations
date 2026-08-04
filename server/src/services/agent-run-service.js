'use strict';

const { createHash, randomBytes, randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const AgentRun = require('../models/AgentRun');

const ACTIVE_STATUSES = Object.freeze(['queued', 'running']);
const TERMINAL_STATUSES = Object.freeze([
  'succeeded',
  'failed',
  'timed-out',
  'incomplete',
  'cancelled',
  'stale',
]);
const COMPLETION_STATUSES = Object.freeze(['succeeded', 'failed', 'timed-out', 'incomplete']);
const COMPLETABLE_ATTEMPT_STATUSES = new Set(['succeeded', 'failed', 'timed-out', 'incomplete']);
const COMPLETION_REASONS = Object.freeze({
  succeeded: new Set(['succeeded']),
  failed: new Set(['execution-failed']),
  'timed-out': new Set(['provider-timeout']),
  incomplete: new Set(['output-validation-failed', 'evidence-save-gap']),
});
const ATTEMPT_STATUSES = new Set(AgentRun.ATTEMPT_STATUSES);
const SETTABLE_VALIDATION_STATUSES = new Set(['passed', 'failed', 'skipped']);
const DEFAULT_LEASE_TTL_MS = 30_000;
const MAX_LEASE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_IDEMPOTENCY_KEY_LENGTH = 512;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_STRUCTURED_DETAIL_CHARS = 16 * 1024;
const MAX_PACKAGE_REFS = 32;
const MAX_EVIDENCE_OUTPUT_CHARS = 200_000;

function createServiceError(code, message, status = 500) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function requireNonEmptyString(value, field, maxLength = 1000) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw createServiceError('AGENT_RUN_INVALID_INPUT', `${field} is required.`, 400);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw createServiceError(
      'AGENT_RUN_INVALID_INPUT',
      `${field} must be at most ${maxLength} characters.`,
      400
    );
  }
  return normalized;
}

function optionalString(value, maxLength = 4000) {
  if (value === null || value === undefined) return '';
  return String(value).slice(0, maxLength);
}

function boundedStructuredValue(value, field, maxChars = MAX_STRUCTURED_DETAIL_CHARS) {
  if (value === null || value === undefined) return null;
  let serialized;
  try {
    serialized = canonicalJson(value);
  } catch (error) {
    if (error?.code) throw error;
    throw createServiceError('AGENT_RUN_INVALID_INPUT', `${field} must be JSON-compatible structured data.`, 400);
  }
  if (serialized.length > maxChars) {
    throw createServiceError(
      'AGENT_RUN_INVALID_INPUT',
      `${field} must be at most ${maxChars} canonical characters.`,
      400
    );
  }
  return JSON.parse(JSON.stringify(value));
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeUsage(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createServiceError('AGENT_RUN_INVALID_INPUT', 'usage must be an object.', 400);
  }
  return {
    inputTokens: nonNegativeNumber(value.inputTokens),
    outputTokens: nonNegativeNumber(value.outputTokens),
    totalTokens: nonNegativeNumber(value.totalTokens)
      || nonNegativeNumber(value.inputTokens) + nonNegativeNumber(value.outputTokens),
    cacheReadTokens: nonNegativeNumber(value.cacheReadTokens),
    cacheWriteTokens: nonNegativeNumber(value.cacheWriteTokens),
    reasoningTokens: nonNegativeNumber(value.reasoningTokens),
    totalCostMicros: nonNegativeNumber(value.totalCostMicros),
    usageAvailable: value.usageAvailable !== false,
    serviceTier: optionalString(value.serviceTier || value.providerReported?.serviceTier, 200),
    finishReason: optionalString(value.finishReason, 200),
  };
}

function normalizeFallbackDetails(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createServiceError('AGENT_RUN_INVALID_INPUT', 'fallbackDecision.details must be an object.', 400);
  }
  return {
    code: optionalString(value.code, 500),
    message: optionalString(value.message, 2000),
    healthCode: optionalString(value.healthCode, 500),
    evaluationId: optionalString(value.evaluationId, 1000),
    authorityVersion: optionalString(value.authorityVersion, 500),
  };
}

function normalizeValidationDetails(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createServiceError('AGENT_RUN_INVALID_INPUT', 'validation.details must be an object.', 400);
  }
  return {
    outputChars: nonNegativeNumber(value.outputChars),
    citationCount: nonNegativeNumber(value.citationCount),
    evidenceCount: nonNegativeNumber(value.evidenceCount),
    supportValidation: optionalString(value.supportValidation, 500),
    summary: optionalString(value.summary, 2000),
  };
}

function optionalRef(value, field, maxLength = 1000) {
  if (value === null || value === undefined || value === '') return null;
  return requireNonEmptyString(value, field, maxLength);
}

function asDate(value, field = 'date') {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value ?? Date.now());
  if (!Number.isFinite(date.getTime())) {
    throw createServiceError('AGENT_RUN_INVALID_INPUT', `${field} must be a valid date.`, 400);
  }
  return date;
}

function leaseTtl(value) {
  const ttlMs = value ?? DEFAULT_LEASE_TTL_MS;
  if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_LEASE_TTL_MS) {
    throw createServiceError(
      'AGENT_RUN_INVALID_INPUT',
      `leaseTtlMs must be an integer between 1 and ${MAX_LEASE_TTL_MS}.`,
      400
    );
  }
  return ttlMs;
}

function canonicalJson(value, seen = new Set()) {
  if (value === null) return 'null';
  if (value === undefined) return '{"$undefined":true}';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '{"$number":"NaN"}';
    if (value === Infinity) return '{"$number":"Infinity"}';
    if (value === -Infinity) return '{"$number":"-Infinity"}';
    if (Object.is(value, -0)) return '{"$number":"-0"}';
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') return `{"$bigint":${JSON.stringify(value.toString())}}`;
  if (typeof value !== 'object') {
    throw createServiceError(
      'AGENT_RUN_UNHASHABLE_INPUT',
      `Agent-run input contains unsupported ${typeof value} data.`,
      400
    );
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw createServiceError('AGENT_RUN_UNHASHABLE_INPUT', 'Agent-run input contains an invalid date.', 400);
    }
    return `{"$date":${JSON.stringify(value.toISOString())}}`;
  }
  if (Buffer.isBuffer(value)) return `{"$buffer":${JSON.stringify(value.toString('base64'))}}`;
  if (seen.has(value)) {
    throw createServiceError('AGENT_RUN_UNHASHABLE_INPUT', 'Agent-run input cannot contain a cycle.', 400);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry, seen)).join(',')}]`;
    if (value instanceof Map) {
      const entries = [...value.entries()]
        .map(([key, entryValue]) => [canonicalJson(key), canonicalJson(entryValue, seen)])
        .sort(([left], [right]) => left.localeCompare(right));
      return `{"$map":[${entries.map(([key, entryValue]) => `[${key},${entryValue}]`).join(',')}]}`;
    }
    if (value instanceof Set) {
      const entries = [...value].map((entry) => canonicalJson(entry, seen)).sort();
      return `{"$set":[${entries.join(',')}]}`;
    }
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`);
    return `{${entries.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hashExactValue(value) {
  return sha256(typeof value === 'string' ? value : canonicalJson(value));
}

function hashAgentRunInputs({ prompt, provider, context, request } = {}) {
  const hashes = {
    algorithm: 'sha256',
    encoding: 'utf8-string-or-canonical-json-v1',
    prompt: hashExactValue(prompt),
    provider: hashExactValue(provider),
    context: hashExactValue(context),
    request: hashExactValue(request),
  };
  hashes.combined = sha256(canonicalJson({
    prompt: hashes.prompt,
    provider: hashes.provider,
    context: hashes.context,
    request: hashes.request,
  }));
  return hashes;
}

function hashesMatch(left, right) {
  return ['algorithm', 'encoding', 'prompt', 'provider', 'context', 'request', 'combined']
    .every((key) => left?.[key] === right?.[key]);
}

function normalizeRunManifest(source, inputHashes) {
  const manifest = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  if (manifest.promptHash && manifest.promptHash !== inputHashes.prompt) {
    throw createServiceError(
      'AGENT_RUN_PROMPT_HASH_MISMATCH',
      'promptHash must match the exact prompt input hash.',
      400
    );
  }
  const refs = manifest.refs && typeof manifest.refs === 'object' && !Array.isArray(manifest.refs)
    ? manifest.refs
    : {};
  return {
    agentId: requireNonEmptyString(manifest.agentId, 'agentId', 500),
    useCase: requireNonEmptyString(manifest.useCase, 'useCase', 500),
    surface: requireNonEmptyString(manifest.surface, 'surface', 500),
    purpose: requireNonEmptyString(manifest.purpose, 'purpose', 500),
    trigger: requireNonEmptyString(manifest.trigger, 'trigger', 500),
    requestId: requireNonEmptyString(manifest.requestId, 'requestId', 1000),
    promptId: requireNonEmptyString(manifest.promptId, 'promptId', 1000),
    promptVersion: requireNonEmptyString(manifest.promptVersion, 'promptVersion', 500),
    promptHash: inputHashes.prompt,
    actor: requireNonEmptyString(manifest.actor, 'actor', 1000),
    refs: {
      conversationId: optionalRef(refs.conversationId, 'refs.conversationId'),
      roomId: optionalRef(refs.roomId, 'refs.roomId'),
      escalationId: optionalRef(refs.escalationId, 'refs.escalationId'),
      caseNumber: optionalRef(refs.caseNumber, 'refs.caseNumber'),
      contextRef: optionalRef(refs.contextRef, 'refs.contextRef'),
    },
  };
}

function manifestMatches(run, manifest) {
  const directFields = [
    'agentId',
    'useCase',
    'surface',
    'purpose',
    'trigger',
    'requestId',
    'promptId',
    'promptVersion',
    'promptHash',
    'actor',
  ];
  if (!directFields.every((field) => run?.[field] === manifest[field])) return false;
  return ['conversationId', 'roomId', 'escalationId', 'caseNumber', 'contextRef']
    .every((field) => (run?.refs?.[field] ?? null) === manifest.refs[field]);
}

async function createOrReuseAgentRun(options = {}) {
  const idempotencyKey = requireNonEmptyString(
    options.idempotencyKey,
    'idempotencyKey',
    MAX_IDEMPOTENCY_KEY_LENGTH
  );
  const inputs = options.inputs && typeof options.inputs === 'object'
    ? options.inputs
    : options;
  const inputHashes = hashAgentRunInputs(inputs);
  const manifest = normalizeRunManifest(options.manifest || options, inputHashes);

  let existing = await AgentRun.findOne({ idempotencyKey });
  if (existing) {
    if (!hashesMatch(existing.inputHashes, inputHashes) || !manifestMatches(existing, manifest)) {
      throw createServiceError(
        'AGENT_RUN_IDEMPOTENCY_CONFLICT',
        'This idempotency key is already attached to different agent-run inputs.',
        409
      );
    }
    return { run: existing, reused: true, idempotent: true };
  }

  try {
    const run = await AgentRun.create({ idempotencyKey, inputHashes, ...manifest });
    return { run, reused: false, idempotent: false };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    existing = await AgentRun.findOne({ idempotencyKey });
    if (
      !existing
      || !hashesMatch(existing.inputHashes, inputHashes)
      || !manifestMatches(existing, manifest)
    ) {
      throw createServiceError(
        'AGENT_RUN_IDEMPOTENCY_CONFLICT',
        'This idempotency key is already attached to different agent-run inputs.',
        409
      );
    }
    return { run: existing, reused: true, idempotent: true };
  }
}

function normalizeRunId(runId) {
  if (!mongoose.isObjectIdOrHexString(runId)) {
    throw createServiceError('AGENT_RUN_INVALID_ID', 'runId must be a valid MongoDB id.', 400);
  }
  return runId;
}

function normalizeLeaseCredentials({ owner, leaseToken }) {
  return {
    owner: requireNonEmptyString(owner, 'owner', 500),
    leaseToken: requireNonEmptyString(leaseToken, 'leaseToken', 1000),
  };
}

function activeLeaseFilter(runId, owner, leaseToken, now) {
  return {
    _id: normalizeRunId(runId),
    status: 'running',
    'lease.owner': owner,
    'lease.tokenHash': sha256(leaseToken),
    'lease.expiresAt': { $gt: now },
  };
}

async function acquireAgentRunLease({
  runId,
  owner,
  leaseToken = randomBytes(32).toString('hex'),
  leaseTtlMs = DEFAULT_LEASE_TTL_MS,
  now = new Date(),
} = {}) {
  const normalizedRunId = normalizeRunId(runId);
  const normalizedOwner = requireNonEmptyString(owner, 'owner', 500);
  const normalizedToken = requireNonEmptyString(leaseToken, 'leaseToken', 1000);
  const acquiredAt = asDate(now, 'now');
  const expiresAt = new Date(acquiredAt.getTime() + leaseTtl(leaseTtlMs));

  const run = await AgentRun.findOneAndUpdate(
    {
      _id: normalizedRunId,
      status: { $in: ACTIVE_STATUSES },
      $or: [
        { lease: null },
        { 'lease.expiresAt': { $exists: false } },
        { 'lease.expiresAt': { $lte: acquiredAt } },
      ],
    },
    [{
      $set: {
        status: 'running',
        startedAt: { $ifNull: ['$startedAt', acquiredAt] },
        attempts: {
          $map: {
            input: { $ifNull: ['$attempts', []] },
            as: 'attempt',
            in: {
              $cond: [
                { $eq: ['$$attempt.status', 'running'] },
                {
                  $mergeObjects: [
                    '$$attempt',
                    {
                      status: 'stale',
                      completedAt: acquiredAt,
                      error: {
                        code: 'AGENT_RUN_LEASE_RECLAIMED',
                        message: 'The previous executor lease expired and a new executor reclaimed the run.',
                      },
                    },
                  ],
                },
                '$$attempt',
              ],
            },
          },
        },
        leaseGeneration: { $add: [{ $ifNull: ['$leaseGeneration', 0] }, 1] },
        lease: {
          owner: normalizedOwner,
          generation: { $add: [{ $ifNull: ['$leaseGeneration', 0] }, 1] },
          tokenHash: sha256(normalizedToken),
          acquiredAt,
          expiresAt,
          heartbeatAt: acquiredAt,
        },
      },
    }],
    { returnDocument: 'after', updatePipeline: true }
  );

  if (!run) {
    const current = await AgentRun.findById(normalizedRunId).select('status lease').lean();
    if (!current) throw createServiceError('AGENT_RUN_NOT_FOUND', 'Agent run not found.', 404);
    if (TERMINAL_STATUSES.includes(current.status)) {
      throw createServiceError('AGENT_RUN_TERMINAL', `Agent run already ended as ${current.status}.`, 409);
    }
    throw createServiceError('AGENT_RUN_LEASE_HELD', 'Agent run already has an active lease.', 409);
  }

  return { run, leaseToken: normalizedToken };
}

async function heartbeatAgentRunLease({
  runId,
  owner,
  leaseToken,
  leaseTtlMs = DEFAULT_LEASE_TTL_MS,
  now = new Date(),
} = {}) {
  const credentials = normalizeLeaseCredentials({ owner, leaseToken });
  const heartbeatAt = asDate(now, 'now');
  const expiresAt = new Date(heartbeatAt.getTime() + leaseTtl(leaseTtlMs));
  const run = await AgentRun.findOneAndUpdate(
    activeLeaseFilter(runId, credentials.owner, credentials.leaseToken, heartbeatAt),
    { $set: { 'lease.heartbeatAt': heartbeatAt, 'lease.expiresAt': expiresAt } },
    { returnDocument: 'after', runValidators: true }
  );
  if (!run) {
    throw createServiceError('AGENT_RUN_LEASE_LOST', 'The agent-run lease is missing, expired, or owned elsewhere.', 409);
  }
  return run;
}

function normalizePackageRefs(packageRefs) {
  if (packageRefs === null || packageRefs === undefined) return [];
  if (!Array.isArray(packageRefs)) {
    throw createServiceError('AGENT_RUN_INVALID_INPUT', 'packageRefs must be an array.', 400);
  }
  if (packageRefs.length > MAX_PACKAGE_REFS) {
    throw createServiceError('AGENT_RUN_INVALID_INPUT', `packageRefs must contain at most ${MAX_PACKAGE_REFS} entries.`, 400);
  }
  return packageRefs.map((reference, index) => {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
      throw createServiceError('AGENT_RUN_INVALID_INPUT', `packageRefs[${index}] must be an object.`, 400);
    }
    const normalized = {
      kind: requireNonEmptyString(reference.kind, `packageRefs[${index}].kind`, 200),
      id: requireNonEmptyString(reference.id, `packageRefs[${index}].id`, 1000),
      sha256: reference.sha256 ?? null,
    };
    if (normalized.sha256 !== null && !SHA256_PATTERN.test(normalized.sha256)) {
      throw createServiceError(
        'AGENT_RUN_INVALID_INPUT',
        `packageRefs[${index}].sha256 must be a lowercase SHA-256 digest.`,
        400
      );
    }
    return normalized;
  });
}

function normalizeFallbackDecision(value) {
  const decision = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    considered: Boolean(decision.considered),
    used: Boolean(decision.used),
    reason: optionalString(decision.reason || 'not-considered', 2000),
    fromProvider: optionalString(decision.fromProvider, 500),
    fromModel: optionalString(decision.fromModel, 500),
    toProvider: optionalString(decision.toProvider, 500),
    toModel: optionalString(decision.toModel, 500),
    details: normalizeFallbackDetails(decision.details),
  };
}

function normalizeAttempt(attempt, now) {
  if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) {
    throw createServiceError('AGENT_RUN_INVALID_INPUT', 'attempt must be an object.', 400);
  }
  if (!Number.isInteger(attempt.attemptNumber) || attempt.attemptNumber < 1) {
    throw createServiceError('AGENT_RUN_INVALID_INPUT', 'attempt.attemptNumber must be a positive integer.', 400);
  }
  if (!ATTEMPT_STATUSES.has(attempt.status) || attempt.status !== 'running') {
    throw createServiceError(
      'AGENT_RUN_INVALID_INPUT',
      'A new attempt must start as running and be terminalized through completeAgentRunAttempt.',
      400
    );
  }
  const startedAt = asDate(attempt.startedAt ?? now, 'attempt.startedAt');
  return {
    attemptId: requireNonEmptyString(attempt.attemptId || randomUUID(), 'attempt.attemptId', 500),
    attemptNumber: attempt.attemptNumber,
    leaseGeneration: Number.isInteger(attempt.leaseGeneration) && attempt.leaseGeneration > 0
      ? attempt.leaseGeneration
      : (() => { throw createServiceError('AGENT_RUN_INVALID_INPUT', 'attempt.leaseGeneration must be a positive integer.', 400); })(),
    agentId: requireNonEmptyString(attempt.agentId, 'attempt.agentId', 500),
    status: attempt.status,
    provider: requireNonEmptyString(attempt.provider, 'attempt.provider', 500),
    model: requireNonEmptyString(attempt.model, 'attempt.model', 500),
    role: requireNonEmptyString(attempt.role, 'attempt.role', 500),
    packageRefs: normalizePackageRefs(attempt.packageRefs),
    usage: normalizeUsage(attempt.usage),
    fallbackDecision: normalizeFallbackDecision(attempt.fallbackDecision),
    error: attempt.error ? {
      code: optionalString(attempt.error.code, 500),
      message: optionalString(attempt.error.message, 4000),
    } : null,
    startedAt,
    completedAt: null,
  };
}

async function recordAgentRunAttempt({
  runId,
  owner,
  leaseToken,
  attempt,
  now = new Date(),
} = {}) {
  const credentials = normalizeLeaseCredentials({ owner, leaseToken });
  const recordedAt = asDate(now, 'now');
  const leaseOwner = await AgentRun.findOne(
    activeLeaseFilter(runId, credentials.owner, credentials.leaseToken, recordedAt)
  ).select('agentId leaseGeneration cancellation').lean();
  if (!leaseOwner) {
    const current = await AgentRun.findById(normalizeRunId(runId)).select('cancellation').lean();
    if (current?.cancellation?.requestedAt) {
      throw createServiceError('AGENT_RUN_CANCEL_REQUESTED', 'The agent run is awaiting cancellation acknowledgement.', 409);
    }
    throw createServiceError('AGENT_RUN_LEASE_LOST', 'The agent-run lease is missing, expired, or owned elsewhere.', 409);
  }
  // Lease provenance is stamped from the server-owned run. A caller may not
  // select another agent or claim a different executor generation.
  const normalizedAttempt = normalizeAttempt({
    ...attempt,
    agentId: leaseOwner.agentId,
    leaseGeneration: leaseOwner.leaseGeneration,
  }, recordedAt);
  const run = await AgentRun.findOneAndUpdate(
    {
      ...activeLeaseFilter(runId, credentials.owner, credentials.leaseToken, recordedAt),
      cancellation: null,
      'attempts.attemptId': { $ne: normalizedAttempt.attemptId },
      'attempts.attemptNumber': { $ne: normalizedAttempt.attemptNumber },
    },
    { $push: { attempts: normalizedAttempt } },
    { returnDocument: 'after', runValidators: true }
  );
  if (!run) {
    const current = await AgentRun.findById(normalizeRunId(runId))
      .select('status lease attempts cancellation')
      .lean();
    if (current?.attempts?.some((entry) => (
      entry.attemptId === normalizedAttempt.attemptId
      || entry.attemptNumber === normalizedAttempt.attemptNumber
    ))) {
      throw createServiceError('AGENT_RUN_ATTEMPT_CONFLICT', 'Attempt id or number was already recorded.', 409);
    }
    if (current?.cancellation?.requestedAt) {
      throw createServiceError('AGENT_RUN_CANCEL_REQUESTED', 'The agent run is awaiting cancellation acknowledgement.', 409);
    }
    throw createServiceError('AGENT_RUN_LEASE_LOST', 'The agent-run lease is missing, expired, or owned elsewhere.', 409);
  }
  return run;
}

function attemptSelector({ attemptId, attemptNumber } = {}) {
  if (attemptId !== null && attemptId !== undefined && attemptId !== '') {
    const value = requireNonEmptyString(attemptId, 'attemptId', 500);
    return {
      query: { attemptId: value, status: 'running' },
      arrayFilter: { 'target.attemptId': value, 'target.status': 'running' },
      matches: (attempt) => attempt.attemptId === value,
    };
  }
  if (Number.isInteger(attemptNumber) && attemptNumber > 0) {
    return {
      query: { attemptNumber, status: 'running' },
      arrayFilter: { 'target.attemptNumber': attemptNumber, 'target.status': 'running' },
      matches: (attempt) => attempt.attemptNumber === attemptNumber,
    };
  }
  throw createServiceError(
    'AGENT_RUN_INVALID_INPUT',
    'attemptId or a positive attemptNumber is required.',
    400
  );
}

function defaultAttemptError(status) {
  if (status === 'succeeded') return null;
  if (status === 'timed-out') {
    return { code: 'PROVIDER_TIMEOUT', message: 'The provider attempt timed out.' };
  }
  if (status === 'incomplete') {
    return { code: 'AGENT_ATTEMPT_INCOMPLETE', message: 'The provider attempt ended without complete evidence.' };
  }
  return { code: 'AGENT_ATTEMPT_FAILED', message: 'The provider attempt failed.' };
}

async function completeAgentRunAttempt({
  runId,
  owner,
  leaseToken,
  attemptId,
  attemptNumber,
  status,
  packageRefs,
  usage,
  fallbackDecision,
  error,
  now = new Date(),
} = {}) {
  if (!COMPLETABLE_ATTEMPT_STATUSES.has(status)) {
    throw createServiceError(
      'AGENT_RUN_INVALID_INPUT',
      'Attempt status must be succeeded, failed, timed-out, or incomplete.',
      400
    );
  }
  const credentials = normalizeLeaseCredentials({ owner, leaseToken });
  const completedAt = asDate(now, 'now');
  const selector = attemptSelector({ attemptId, attemptNumber });
  const fallbackError = defaultAttemptError(status);
  const normalizedError = status === 'succeeded' ? null : {
    code: optionalString(error?.code || fallbackError.code, 500),
    message: optionalString(error?.message || fallbackError.message, 4000),
  };
  const set = {
    'attempts.$[target].status': status,
    'attempts.$[target].completedAt': completedAt,
    'attempts.$[target].error': normalizedError,
  };
  if (packageRefs !== undefined) {
    set['attempts.$[target].packageRefs'] = normalizePackageRefs(packageRefs);
  }
  if (usage !== undefined) set['attempts.$[target].usage'] = normalizeUsage(usage);
  if (fallbackDecision !== undefined) {
    set['attempts.$[target].fallbackDecision'] = normalizeFallbackDecision(fallbackDecision);
  }

  const run = await AgentRun.findOneAndUpdate(
    {
      ...activeLeaseFilter(runId, credentials.owner, credentials.leaseToken, completedAt),
      cancellation: null,
      attempts: { $elemMatch: selector.query },
    },
    { $set: set },
    {
      arrayFilters: [selector.arrayFilter],
      returnDocument: 'after',
      runValidators: true,
    }
  );
  if (run) return run;

  const current = await AgentRun.findById(normalizeRunId(runId)).select('status lease attempts cancellation').lean();
  const existingAttempt = current?.attempts?.find(selector.matches);
  if (existingAttempt && existingAttempt.status !== 'running') {
    throw createServiceError(
      'AGENT_RUN_ATTEMPT_ALREADY_TERMINAL',
      `Attempt already ended as ${existingAttempt.status}.`,
      409
    );
  }
  if (current?.cancellation?.requestedAt) {
    throw createServiceError('AGENT_RUN_CANCEL_REQUESTED', 'The agent run is awaiting cancellation acknowledgement.', 409);
  }
  if (!existingAttempt) {
    throw createServiceError('AGENT_RUN_ATTEMPT_NOT_FOUND', 'Running attempt not found.', 404);
  }
  throw createServiceError('AGENT_RUN_LEASE_LOST', 'The agent-run lease is missing, expired, or owned elsewhere.', 409);
}

async function setAgentRunOutputValidation({
  runId,
  owner,
  leaseToken,
  validation,
  now = new Date(),
} = {}) {
  const credentials = normalizeLeaseCredentials({ owner, leaseToken });
  const checkedAt = asDate(now, 'now');
  if (!validation || typeof validation !== 'object' || Array.isArray(validation)) {
    throw createServiceError('AGENT_RUN_INVALID_INPUT', 'validation must be an object.', 400);
  }
  if (!SETTABLE_VALIDATION_STATUSES.has(validation.status)) {
    throw createServiceError(
      'AGENT_RUN_INVALID_INPUT',
      'validation.status must be passed, failed, or skipped.',
      400
    );
  }
  const outputSha256 = validation.outputSha256 ?? null;
  if (outputSha256 !== null && !SHA256_PATTERN.test(outputSha256)) {
    throw createServiceError('AGENT_RUN_INVALID_INPUT', 'validation.outputSha256 must be a lowercase SHA-256 digest.', 400);
  }
  const normalizedValidation = {
    status: validation.status,
    validator: optionalString(validation.validator, 500),
    schemaRef: optionalString(validation.schemaRef, 1000),
    outputSha256,
    issues: (Array.isArray(validation.errors) ? validation.errors : [])
      .slice(0, 64)
      .map((entry) => optionalString(entry, 2000)),
    details: normalizeValidationDetails(validation.details),
    packageRefs: normalizePackageRefs(validation.packageRefs),
    evidenceVerification: {
      status: 'unverified',
      verifier: '',
      checkedAt,
      detail: 'Caller-supplied package references are not repository-verified; they cannot authorize a succeeded run.',
    },
    checkedAt,
  };
  const run = await AgentRun.findOneAndUpdate(
    {
      ...activeLeaseFilter(runId, credentials.owner, credentials.leaseToken, checkedAt),
      cancellation: null,
    },
    { $set: { outputValidation: normalizedValidation } },
    { returnDocument: 'after', runValidators: true }
  );
  if (!run) {
    const current = await AgentRun.findById(normalizeRunId(runId)).select('cancellation').lean();
    if (current?.cancellation?.requestedAt) {
      throw createServiceError('AGENT_RUN_CANCEL_REQUESTED', 'The agent run is awaiting cancellation acknowledgement.', 409);
    }
    throw createServiceError('AGENT_RUN_LEASE_LOST', 'The agent-run lease is missing, expired, or owned elsewhere.', 409);
  }
  return run;
}

function parseEvidenceReference(reference) {
  const normalized = normalizePackageRefs([reference])[0];
  if (!['conversation-message', 'room-message'].includes(normalized.kind)) {
    throw createServiceError(
      'AGENT_RUN_EVIDENCE_KIND_UNSUPPORTED',
      `Agent-run evidence kind ${normalized.kind} is not repository-verifiable.`,
      400
    );
  }
  const separator = normalized.id.lastIndexOf(':');
  const documentId = separator > 0 ? normalized.id.slice(0, separator) : '';
  const index = Number.parseInt(separator > 0 ? normalized.id.slice(separator + 1) : '', 10);
  if (!mongoose.isObjectIdOrHexString(documentId) || !Number.isInteger(index) || index < 0) {
    throw createServiceError(
      'AGENT_RUN_EVIDENCE_REF_INVALID',
      `${normalized.kind} evidence IDs must be <document-id>:<message-index>.`,
      400
    );
  }
  return { ...normalized, documentId, index };
}

async function readSavedMessageEvidence(reference) {
  const parsed = parseEvidenceReference(reference);
  const Model = parsed.kind === 'conversation-message'
    ? require('../models/Conversation')
    : require('../models/ChatRoom');
  const document = await Model.findById(parsed.documentId).select('messages').lean();
  const message = document?.messages?.[parsed.index];
  if (!message || message.role !== 'assistant' || typeof message.content !== 'string') {
    throw createServiceError(
      'AGENT_RUN_EVIDENCE_NOT_FOUND',
      `Saved assistant output ${parsed.id} was not found.`,
      409
    );
  }
  const contentSha256 = sha256(message.content);
  if (parsed.sha256 && parsed.sha256 !== contentSha256) {
    throw createServiceError(
      'AGENT_RUN_EVIDENCE_HASH_MISMATCH',
      `Saved assistant output ${parsed.id} does not match its declared hash.`,
      409
    );
  }
  return {
    kind: parsed.kind,
    id: parsed.id,
    sha256: contentSha256,
    agentId: optionalString(message.agentId, 500),
    content: message.content,
  };
}

function buildVerifiedOutputValue(evidence) {
  if (evidence.length === 1) return evidence[0].content;
  return evidence.map((entry) => ({
    kind: entry.kind,
    id: entry.id,
    agentId: entry.agentId,
    content: entry.content,
  }));
}

async function verifySavedAgentRunOutput({
  runId,
  owner,
  leaseToken,
  packageRefs,
  validator = 'saved-agent-output-v1',
  schemaRef = 'agent-output/text-v1',
  now = new Date(),
} = {}) {
  const credentials = normalizeLeaseCredentials({ owner, leaseToken });
  const checkedAt = asDate(now, 'now');
  const normalizedRefs = normalizePackageRefs(packageRefs);
  if (normalizedRefs.length === 0) {
    throw createServiceError('AGENT_RUN_EVIDENCE_REF_REQUIRED', 'At least one saved output reference is required.', 400);
  }
  const evidence = [];
  for (const reference of normalizedRefs) evidence.push(await readSavedMessageEvidence(reference));
  const outputValue = buildVerifiedOutputValue(evidence);
  const serializedOutput = typeof outputValue === 'string' ? outputValue : canonicalJson(outputValue);
  if (!serializedOutput.trim() || serializedOutput.length > MAX_EVIDENCE_OUTPUT_CHARS) {
    throw createServiceError(
      'AGENT_RUN_OUTPUT_VALIDATION_FAILED',
      `Saved output must contain 1 to ${MAX_EVIDENCE_OUTPUT_CHARS} characters.`,
      409
    );
  }
  const outputSha256 = sha256(serializedOutput);
  const verifiedRefs = evidence.map(({ kind, id, sha256: evidenceSha }) => ({
    kind,
    id,
    sha256: evidenceSha,
  }));
  const outputValidation = {
    status: 'passed',
    validator: optionalString(validator, 500),
    schemaRef: optionalString(schemaRef, 1000),
    outputSha256,
    issues: [],
    details: {
      outputChars: serializedOutput.length,
      citationCount: 0,
      evidenceCount: evidence.length,
      supportValidation: 'saved-output-hash-verified',
      summary: 'The server re-read the saved assistant message content and verified its output hash.',
    },
    packageRefs: verifiedRefs,
    evidenceVerification: {
      status: 'verified',
      verifier: 'agent-run-saved-message-verifier-v1',
      checkedAt,
      detail: 'Verified against persisted assistant message content in the repository.',
    },
    checkedAt,
  };
  const run = await AgentRun.findOneAndUpdate(
    {
      ...activeLeaseFilter(runId, credentials.owner, credentials.leaseToken, checkedAt),
      cancellation: null,
    },
    { $set: { outputValidation } },
    { returnDocument: 'after', runValidators: true }
  );
  if (!run) {
    throw createServiceError('AGENT_RUN_LEASE_LOST', 'The agent-run lease is missing, expired, or owned elsewhere.', 409);
  }
  return run;
}

async function completeAgentRun({
  runId,
  owner,
  leaseToken,
  status,
  terminalReason,
  error = null,
  now = new Date(),
} = {}) {
  if (!COMPLETION_STATUSES.includes(status)) {
    throw createServiceError(
      'AGENT_RUN_INVALID_INPUT',
      'status must be succeeded, failed, timed-out, or incomplete.',
      400
    );
  }
  const defaultReason = {
    succeeded: 'succeeded',
    failed: 'execution-failed',
    'timed-out': 'provider-timeout',
  }[status];
  const normalizedReason = terminalReason || defaultReason;
  if (!COMPLETION_REASONS[status].has(normalizedReason)) {
    throw createServiceError(
      'AGENT_RUN_INVALID_INPUT',
      status === 'incomplete'
        ? 'An incomplete run must identify output-validation-failed or evidence-save-gap.'
        : `terminalReason for ${status} must be ${[...COMPLETION_REASONS[status]].join(' or ')}.`,
      400
    );
  }
  const credentials = normalizeLeaseCredentials({ owner, leaseToken });
  const completedAt = asDate(now, 'now');
  const filter = {
    ...activeLeaseFilter(runId, credentials.owner, credentials.leaseToken, completedAt),
    cancellation: null,
  };
  if (status === 'succeeded') {
    filter['outputValidation.status'] = 'passed';
    filter['outputValidation.outputSha256'] = { $regex: SHA256_PATTERN };
    filter['outputValidation.packageRefs.0'] = { $exists: true };
    filter['outputValidation.evidenceVerification.status'] = 'verified';
    filter['attempts.status'] = 'succeeded';
    filter.attempts = { $not: { $elemMatch: { status: 'running' } } };
  }
  if (normalizedReason === 'output-validation-failed') {
    filter['outputValidation.status'] = 'failed';
  }
  const defaultError = {
    'execution-failed': {
      code: 'AGENT_RUN_FAILED',
      message: 'The agent run failed during execution.',
    },
    'provider-timeout': {
      code: 'PROVIDER_TIMEOUT',
      message: 'The provider did not finish before its deadline.',
    },
    'output-validation-failed': {
      code: 'OUTPUT_VALIDATION_FAILED',
      message: 'Provider output failed the required validation contract.',
    },
    'evidence-save-gap': {
      code: 'EVIDENCE_SAVE_GAP',
      message: 'The run ended before all required evidence was saved.',
    },
  }[normalizedReason] || null;
  const completionError = status === 'succeeded' ? null : {
    code: optionalString(error?.code || defaultError.code, 500),
    message: optionalString(error?.message || defaultError.message, 4000),
  };
  const terminalSet = {
    status,
    terminalReason: normalizedReason,
    completedAt,
    completionError,
    lease: null,
  };
  const updateOptions = { returnDocument: 'after', runValidators: true };
  if (status !== 'succeeded') {
    terminalSet['attempts.$[running].status'] = status;
    terminalSet['attempts.$[running].completedAt'] = completedAt;
    terminalSet['attempts.$[running].error'] = completionError;
    updateOptions.arrayFilters = [{ 'running.status': 'running' }];
  }
  const run = await AgentRun.findOneAndUpdate(filter, { $set: terminalSet }, updateOptions);
  if (!run) {
    const current = await AgentRun.findById(normalizeRunId(runId))
      .select('status lease outputValidation cancellation attempts.status')
      .lean();
    if (!current) throw createServiceError('AGENT_RUN_NOT_FOUND', 'Agent run not found.', 404);
    if (current.cancellation?.requestedAt) {
      throw createServiceError('AGENT_RUN_CANCEL_REQUESTED', 'The agent run is awaiting cancellation acknowledgement.', 409);
    }
    if (status === 'succeeded' && current.outputValidation?.status !== 'passed') {
      throw createServiceError(
        'AGENT_RUN_VALIDATION_REQUIRED',
        'A successful agent run requires passed output validation.',
        409
      );
    }
    if (status === 'succeeded' && current.attempts?.some((attempt) => attempt.status === 'running')) {
      throw createServiceError(
        'AGENT_RUN_ATTEMPT_STILL_RUNNING',
        'A successful run cannot retain a running attempt; complete the attempt explicitly first.',
        409
      );
    }
    if (status === 'succeeded' && !current.attempts?.some((attempt) => attempt.status === 'succeeded')) {
      throw createServiceError(
        'AGENT_RUN_SUCCEEDED_ATTEMPT_REQUIRED',
        'A successful run requires at least one explicitly completed successful attempt.',
        409
      );
    }
    if (status === 'succeeded' && !SHA256_PATTERN.test(current.outputValidation?.outputSha256 || '')) {
      throw createServiceError(
        'AGENT_RUN_RESULT_HASH_REQUIRED',
        'A successful agent run requires the exact validated output SHA-256 hash.',
        409
      );
    }
    if (status === 'succeeded' && !current.outputValidation?.packageRefs?.length) {
      throw createServiceError(
        'AGENT_RUN_EVIDENCE_REF_REQUIRED',
        'A successful agent run requires at least one saved validation evidence reference.',
        409
      );
    }
    if (status === 'succeeded' && current.outputValidation?.evidenceVerification?.status !== 'verified') {
      throw createServiceError(
        'AGENT_RUN_EVIDENCE_UNVERIFIED',
        'A successful agent run requires server-verified repository evidence; caller-supplied references remain unverified.',
        409
      );
    }
    if (
      normalizedReason === 'output-validation-failed'
      && current.outputValidation?.status !== 'failed'
    ) {
      throw createServiceError(
        'AGENT_RUN_VALIDATION_STATE_MISMATCH',
        'Output-validation-failed requires a saved failed validation result.',
        409
      );
    }
    if (TERMINAL_STATUSES.includes(current.status)) {
      throw createServiceError('AGENT_RUN_TERMINAL', `Agent run already ended as ${current.status}.`, 409);
    }
    throw createServiceError('AGENT_RUN_LEASE_LOST', 'The agent-run lease is missing, expired, or owned elsewhere.', 409);
  }
  return run;
}

async function cancelAgentRun({
  runId,
  requestedBy = '',
  reason = '',
  now = new Date(),
} = {}) {
  const normalizedRunId = normalizeRunId(runId);
  const requestedAt = asDate(now, 'now');
  const baseCancellation = {
    requestedAt,
    acknowledgedAt: null,
    databaseOnlyAt: null,
    mode: 'executor-acknowledgement-required',
    requestedBy: optionalString(requestedBy, 500),
    reason: optionalString(reason, 4000),
  };
  const queued = await AgentRun.findOneAndUpdate(
    { _id: normalizedRunId, status: 'queued', cancellation: null },
    {
      $set: {
        status: 'cancelled',
        cancellation: {
          ...baseCancellation,
          databaseOnlyAt: requestedAt,
          mode: 'database-only',
        },
        terminalReason: 'database-only-cancellation',
        completedAt: requestedAt,
        lease: null,
        'attempts.$[running].status': 'cancelled',
        'attempts.$[running].completedAt': requestedAt,
        'attempts.$[running].error': {
          code: 'AGENT_RUN_CANCELLED',
          message: baseCancellation.reason || 'The queued agent run was cancelled before execution.',
        },
      },
    },
    {
      arrayFilters: [{ 'running.status': 'running' }],
      returnDocument: 'after',
      runValidators: true,
    }
  );
  if (queued) {
    return {
      run: queued,
      reused: false,
      idempotent: false,
      cancelRequested: false,
      databaseOnly: true,
    };
  }

  const running = await AgentRun.findOneAndUpdate(
    { _id: normalizedRunId, status: 'running', cancellation: null },
    { $set: { cancellation: baseCancellation } },
    { returnDocument: 'after', runValidators: true }
  );
  if (running) {
    return {
      run: running,
      reused: false,
      idempotent: false,
      cancelRequested: true,
      databaseOnly: false,
    };
  }

  const current = await AgentRun.findById(normalizedRunId);
  if (!current) throw createServiceError('AGENT_RUN_NOT_FOUND', 'Agent run not found.', 404);
  if (current.status === 'cancelled') {
    return { run: current, reused: true, idempotent: true, cancelRequested: false };
  }
  if (current.status === 'running' && current.cancellation?.requestedAt) {
    return {
      run: current,
      reused: true,
      idempotent: true,
      cancelRequested: true,
      databaseOnly: false,
    };
  }
  throw createServiceError('AGENT_RUN_TERMINAL', `Agent run already ended as ${current.status}.`, 409);
}

async function acknowledgeAgentRunCancellation({
  runId,
  owner,
  leaseToken,
  now = new Date(),
} = {}) {
  const credentials = normalizeLeaseCredentials({ owner, leaseToken });
  const acknowledgedAt = asDate(now, 'now');
  const run = await AgentRun.findOneAndUpdate(
    {
      ...activeLeaseFilter(runId, credentials.owner, credentials.leaseToken, acknowledgedAt),
      'cancellation.requestedAt': { $ne: null },
      'cancellation.acknowledgedAt': null,
    },
    {
      $set: {
        status: 'cancelled',
        terminalReason: 'executor-acknowledged-cancellation',
        completedAt: acknowledgedAt,
        lease: null,
        'cancellation.acknowledgedAt': acknowledgedAt,
        'cancellation.mode': 'executor-acknowledged',
        'attempts.$[running].status': 'cancelled',
        'attempts.$[running].completedAt': acknowledgedAt,
        'attempts.$[running].error': {
          code: 'AGENT_RUN_CANCELLED',
          message: 'The lease owner acknowledged the cancellation request.',
        },
      },
    },
    {
      arrayFilters: [{ 'running.status': 'running' }],
      returnDocument: 'after',
      runValidators: true,
    }
  );
  if (run) return { run, reused: false, idempotent: false };

  const current = await AgentRun.findById(normalizeRunId(runId));
  if (!current) throw createServiceError('AGENT_RUN_NOT_FOUND', 'Agent run not found.', 404);
  if (
    current.status === 'cancelled'
    && current.cancellation?.mode === 'executor-acknowledged'
  ) {
    return { run: current, reused: true, idempotent: true };
  }
  if (!current.cancellation?.requestedAt) {
    throw createServiceError('AGENT_RUN_CANCEL_NOT_REQUESTED', 'No cancellation is awaiting acknowledgement.', 409);
  }
  throw createServiceError('AGENT_RUN_LEASE_LOST', 'The agent-run lease is missing, expired, or owned elsewhere.', 409);
}

async function markAgentRunStale({
  runId,
  reason = 'lease-expired',
  now = new Date(),
} = {}) {
  const normalizedRunId = normalizeRunId(runId);
  const detectedAt = asDate(now, 'now');
  const staleness = {
    detectedAt,
    reason: requireNonEmptyString(reason, 'reason', 2000),
  };
  const run = await AgentRun.findOneAndUpdate(
    {
      _id: normalizedRunId,
      status: 'running',
      'lease.expiresAt': { $lte: detectedAt },
    },
    {
      $set: {
        status: 'stale',
        staleness,
        terminalReason: 'lease-expired',
        completedAt: detectedAt,
        lease: null,
        'attempts.$[running].status': 'stale',
        'attempts.$[running].completedAt': detectedAt,
        'attempts.$[running].error': {
          code: 'AGENT_RUN_STALE',
          message: 'The executor lease expired before the run completed.',
        },
      },
    },
    {
      arrayFilters: [{ 'running.status': 'running' }],
      returnDocument: 'after',
      runValidators: true,
    }
  );
  if (run) return { run, reused: false, idempotent: false };

  const current = await AgentRun.findById(normalizedRunId);
  if (!current) throw createServiceError('AGENT_RUN_NOT_FOUND', 'Agent run not found.', 404);
  if (current.status === 'stale') return { run: current, reused: true, idempotent: true };
  if (TERMINAL_STATUSES.includes(current.status)) {
    throw createServiceError('AGENT_RUN_TERMINAL', `Agent run already ended as ${current.status}.`, 409);
  }
  throw createServiceError('AGENT_RUN_NOT_STALE', 'Agent run still has a live lease.', 409);
}

async function reconcileAbandonedAgentRun({ runId, now = new Date(), queuedGraceMs = 60_000 } = {}) {
  const normalizedRunId = normalizeRunId(runId);
  const checkedAt = asDate(now, 'now');
  const current = await AgentRun.findById(normalizedRunId);
  if (!current) throw createServiceError('AGENT_RUN_NOT_FOUND', 'Agent run not found.', 404);

  if (current.status === 'running') {
    const leaseExpiry = current.lease?.expiresAt ? new Date(current.lease.expiresAt) : null;
    if (leaseExpiry && leaseExpiry.getTime() <= checkedAt.getTime()) {
      return (await markAgentRunStale({
        runId: normalizedRunId,
        reason: 'executor-heartbeat-expired',
        now: checkedAt,
      })).run;
    }
  }

  if (current.status === 'queued') {
    const graceMs = Number.isFinite(Number(queuedGraceMs)) ? Math.max(0, Number(queuedGraceMs)) : 60_000;
    const createdAt = current.createdAt ? new Date(current.createdAt) : null;
    if (createdAt && createdAt.getTime() <= checkedAt.getTime() - graceMs) {
      const staleness = {
        detectedAt: checkedAt,
        reason: 'executor-never-acquired-lease',
      };
      const stale = await AgentRun.findOneAndUpdate(
        { _id: normalizedRunId, status: 'queued', createdAt: { $lte: new Date(checkedAt.getTime() - graceMs) } },
        {
          $set: {
            status: 'stale',
            staleness,
            terminalReason: 'lease-expired',
            completedAt: checkedAt,
          },
        },
        { returnDocument: 'after', runValidators: true }
      );
      if (stale) return stale;
      return AgentRun.findById(normalizedRunId);
    }
  }

  return current;
}

module.exports = {
  DEFAULT_LEASE_TTL_MS,
  acknowledgeAgentRunCancellation,
  acquireAgentRunLease,
  cancelAgentRun,
  completeAgentRun,
  completeAgentRunAttempt,
  createOrReuseAgentRun,
  createServiceError,
  hashAgentRunInputs,
  heartbeatAgentRunLease,
  markAgentRunStale,
  reconcileAbandonedAgentRun,
  recordAgentRunAttempt,
  setAgentRunOutputValidation,
  verifySavedAgentRunOutput,
};
