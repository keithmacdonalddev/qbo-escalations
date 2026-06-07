'use strict';

const { buildChatModelContext } = require('../lib/chat-context-builder');
const chatImageModule = require('../lib/chat-image');
const { evaluateChatGuardrails } = require('../lib/chat-guardrails');
const chatTriageModule = require('../lib/chat-triage');
const { parseEscalationText } = require('../lib/escalation-parser');
const { validateCanonicalEscalationTemplateText } = require('../lib/escalation-template-contract');
const { validateParsedEscalation } = require('../lib/parse-validation');
const {
  VALID_MODES,
  normalizeModelOverride,
  resolvePolicy,
} = require('./chat-orchestrator');
const {
  VALID_PARSE_MODES,
} = require('./parse-orchestrator');
const invMatcherModule = require('./inv-matcher');
const knownIssueSearchModule = require('./known-issue-search-agent');
const {
  getAlternateProvider,
  getDefaultProvider,
  getProviderTransport,
  normalizeProvider,
} = require('./providers/registry');
const { getProviderModelId } = require('./providers/catalog');
const { resolveAgentBackup } = require('./agent-failover');

const DEFAULT_PARALLEL_OPEN_TURN_LIMIT = 8;
const DEFAULT_PROVIDER = getDefaultProvider();
const CODEX_SERVICE_TIERS = new Set(['fast', 'priority', 'flex']);
const IMAGE_PARSER_VERBOSE_LOGS = process.env.IMAGE_PARSER_VERBOSE_LOGS === '1';
const KNOWN_ISSUE_AGENT_ID = knownIssueSearchModule.KNOWN_ISSUE_AGENT_ID;

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function parserIssueToText(issue) {
  if (!issue) return '';
  if (typeof issue === 'string') return safeString(issue, '').replace(/\s+/g, ' ').trim();
  if (typeof issue === 'object') {
    return safeString(issue.message || issue.code || issue.reason || issue.field, '').replace(/\s+/g, ' ').trim();
  }
  return safeString(issue, '').replace(/\s+/g, ' ').trim();
}

function summarizeImageParserValidationFailure(parseMeta) {
  if (!parseMeta || parseMeta.passed !== false) return null;
  const canonical = parseMeta.canonicalTemplate && typeof parseMeta.canonicalTemplate === 'object'
    ? parseMeta.canonicalTemplate
    : {};
  const directIssue = Array.isArray(parseMeta.issues)
    ? parseMeta.issues.map(parserIssueToText).find(Boolean)
    : '';
  const canonicalIssue = Array.isArray(canonical.issues)
    ? canonical.issues.map(parserIssueToText).find(Boolean)
    : '';
  const issue = directIssue || canonicalIssue || 'validation failed';
  return {
    code: 'PARSER_VALIDATION_FAILED',
    issue,
    message: `Image Parser output failed validation (${issue}). Falling back to generic image transcription.`,
  };
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeElapsedMs(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

function normalizeReasoningEffort(value, fallback = 'high') {
  const normalized = safeString(value, '').trim().toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'xhigh') {
    return normalized;
  }
  return fallback;
}

function isValidMode(mode) {
  return mode === undefined || VALID_MODES.has(mode);
}

function isValidParseMode(mode) {
  return mode === undefined || mode === 'full' || VALID_PARSE_MODES.has(mode);
}

function resolveParseMode(mode) {
  if (mode === undefined || mode === null || mode === '' || mode === 'full') return 'single';
  return mode;
}

function toParseResponseMeta(meta) {
  const validation = meta && meta.validation ? meta.validation : null;
  const attempts = meta && Array.isArray(meta.attempts) ? meta.attempts : [];
  const candidates = meta && Array.isArray(meta.candidates) ? meta.candidates : [];
  const firstError = attempts.find((attempt) => attempt.status === 'error' && attempt.errorMessage);
  return {
    mode: meta ? meta.mode : 'single',
    providerUsed: meta ? meta.providerUsed : '',
    winner: meta && meta.winner ? meta.winner : (meta ? meta.providerUsed : ''),
    fallbackUsed: Boolean(meta && meta.fallbackUsed),
    fallbackFrom: meta && meta.fallbackFrom ? meta.fallbackFrom : null,
    attempts,
    candidates,
    usedRegexFallback: Boolean(meta && meta.usedRegexFallback),
    validation,
    parsedBy: meta ? meta.providerUsed : '',
    confidence: validation ? validation.confidence : 'low',
    fieldsFound: validation ? validation.fieldsFound : 0,
    fallbackReason: firstError ? firstError.errorMessage : null,
    model: meta && meta.model ? meta.model : '',
  };
}

function isParallelModeEnabled() {
  return process.env.FEATURE_CHAT_PARALLEL_MODE !== '0';
}

function isChatProviderParityEnabled() {
  return process.env.FEATURE_CHAT_PROVIDER_PARITY !== '0';
}

function isChatFallbackModeEnabled() {
  return process.env.FEATURE_CHAT_FALLBACK_MODE !== '0';
}

function getParallelOpenTurnLimit() {
  const raw = Number.parseInt(process.env.PARALLEL_OPEN_TURN_LIMIT || `${DEFAULT_PARALLEL_OPEN_TURN_LIMIT}`, 10);
  if (!Number.isInteger(raw) || raw <= 0) return DEFAULT_PARALLEL_OPEN_TURN_LIMIT;
  return raw;
}

function applyChatFeatureFlags(policy) {
  const next = { ...policy };
  if (!isChatProviderParityEnabled()) {
    next.mode = 'single';
    next.primaryProvider = DEFAULT_PROVIDER;
    next.fallbackProvider = getAlternateProvider(DEFAULT_PROVIDER);
    next.parallelProviders = null;
    return next;
  }
  if (!isChatFallbackModeEnabled() && next.mode === 'fallback') {
    next.mode = 'single';
    next.fallbackProvider = getAlternateProvider(next.primaryProvider);
    next.parallelProviders = null;
  }
  return next;
}

function getChatGenerationValidationError({
  provider,
  primaryProvider,
  fallbackProvider,
  mode,
  parallelProviders,
  isValidProvider,
}) {
  if (provider !== undefined && !isValidProvider(provider)) {
    return { status: 400, body: { ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported provider' } };
  }
  if (primaryProvider !== undefined && !isValidProvider(primaryProvider)) {
    return { status: 400, body: { ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported primary provider' } };
  }
  if (fallbackProvider !== undefined && !isValidProvider(fallbackProvider)) {
    return { status: 400, body: { ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported fallback provider' } };
  }
  if (!isValidMode(mode)) {
    return { status: 400, body: { ok: false, code: 'INVALID_MODE', error: 'Unsupported mode' } };
  }
  if (parallelProviders === undefined) return null;
  if (!Array.isArray(parallelProviders)) {
    return { status: 400, body: { ok: false, code: 'INVALID_PARALLEL_PROVIDERS', error: 'parallelProviders must be an array' } };
  }
  if (parallelProviders.length < 2 || parallelProviders.length > 4) {
    return {
      status: 400,
      body: {
        ok: false,
        code: 'PARALLEL_PROVIDER_COUNT_INVALID',
        error: 'parallelProviders must contain 2 to 4 providers',
      },
    };
  }
  const uniqueParallel = [...new Set(parallelProviders)];
  if (uniqueParallel.length !== parallelProviders.length) {
    return {
      status: 400,
      body: {
        ok: false,
        code: 'INVALID_PARALLEL_PROVIDERS',
        error: 'parallelProviders must contain unique providers',
      },
    };
  }
  for (const candidate of parallelProviders) {
    if (!isValidProvider(candidate)) {
      return {
        status: 400,
        body: {
          ok: false,
          code: 'INVALID_PARALLEL_PROVIDERS',
          error: `Invalid provider in parallelProviders: ${candidate}`,
        },
      };
    }
  }
  if (mode !== 'parallel') {
    return {
      status: 400,
      body: {
        ok: false,
        code: 'INVALID_PARALLEL_PROVIDERS',
        error: 'parallelProviders only allowed when mode is parallel',
      },
    };
  }
  if (primaryProvider && !parallelProviders.includes(normalizeProvider(primaryProvider))) {
    return {
      status: 400,
      body: {
        ok: false,
        code: 'INVALID_PARALLEL_PROVIDERS',
        error: 'primaryProvider must be included in parallelProviders',
      },
    };
  }
  return null;
}

async function prepareChatRequest({
  conversationProvider,
  requestedProvider,
  requestedPrimaryProvider,
  requestedPrimaryModel,
  requestedFallbackProvider,
  requestedFallbackModel,
  requestedParallelProviders,
  requestedMode,
  timeoutMs,
  runtimeSettings,
  reasoningEffort,
  normalizedMessages,
}) {
  const requestedPrimary = requestedPrimaryProvider
    || requestedProvider
    || conversationProvider
    || runtimeSettings.providerStrategy.defaultPrimaryProvider
    || DEFAULT_PROVIDER;
  const resolvedRequestedMode = requestedMode || runtimeSettings.providerStrategy.defaultMode || 'single';
  const resolvedRequestedFallback = requestedFallbackProvider || runtimeSettings.providerStrategy.defaultFallbackProvider;
  const explicitTimeoutMs = parsePositiveInt(timeoutMs, 0);
  const effectiveTimeoutMs = explicitTimeoutMs || runtimeSettings.providerStrategy.timeoutMs || undefined;
  const effectiveReasoningEffort = normalizeReasoningEffort(
    reasoningEffort,
    runtimeSettings.providerStrategy.reasoningEffort || 'high'
  );
  const normalizedRequestedPrimaryProvider = normalizeProvider(requestedPrimary);
  const normalizedRequestedFallbackProvider = normalizeProvider(
    resolvedRequestedFallback || getAlternateProvider(normalizedRequestedPrimaryProvider)
  );
  const normalizedRequestedPrimaryModel = normalizeModelOverride(
    requestedPrimaryModel || runtimeSettings.providerStrategy.defaultPrimaryModel
  );
  const normalizedRequestedFallbackModel = normalizeModelOverride(
    requestedFallbackModel || runtimeSettings.providerStrategy.defaultFallbackModel
  );

  let policy = applyChatFeatureFlags(resolvePolicy({
    mode: resolvedRequestedMode,
    primaryProvider: requestedPrimary,
    primaryModel: normalizedRequestedPrimaryModel,
    fallbackProvider: resolvedRequestedFallback,
    fallbackModel: normalizedRequestedFallbackModel,
    parallelProviders: requestedParallelProviders || undefined,
  }));

  const contextBundle = await buildChatModelContext({
    normalizedMessages,
    settings: runtimeSettings,
  });
  const guardrail = await evaluateChatGuardrails({
    settings: runtimeSettings,
    estimatedInputTokens: contextBundle.contextDebug.budgets.estimatedInputTokens,
    policy,
  });

  if (guardrail.policyOverride) {
    policy = applyChatFeatureFlags(resolvePolicy({
      mode: guardrail.policyOverride.mode,
      primaryProvider: guardrail.policyOverride.primaryProvider,
      primaryModel: normalizedRequestedPrimaryModel,
      fallbackProvider: guardrail.policyOverride.fallbackProvider,
      fallbackModel: normalizedRequestedFallbackModel,
      parallelProviders: guardrail.policyOverride.parallelProviders || policy.parallelProviders,
    }));
  }

  policy.primaryModel = policy.primaryProvider === normalizedRequestedPrimaryProvider
    ? normalizedRequestedPrimaryModel
    : '';
  policy.fallbackModel = policy.fallbackProvider === normalizedRequestedFallbackProvider
    ? normalizedRequestedFallbackModel
    : '';

  const policyError = !policy.parallelProviders
    && (policy.mode === 'fallback' || policy.mode === 'parallel')
    && policy.fallbackProvider === policy.primaryProvider
    ? {
      status: 400,
      body: {
        ok: false,
        code: 'INVALID_FALLBACK_PROVIDER',
        error: 'fallbackProvider must differ from primaryProvider in fallback/parallel mode',
      },
    }
    : null;

  return {
    contextBundle,
    effectiveReasoningEffort,
    effectiveTimeoutMs,
    guardrail,
    policy,
    policyError,
    requestedFallback: resolvedRequestedFallback,
    requestedFallbackModel: normalizedRequestedFallbackModel,
    requestedMode: resolvedRequestedMode,
    requestedPrimaryModel: normalizedRequestedPrimaryModel,
    requestedPrimaryProvider: normalizedRequestedPrimaryProvider,
  };
}

function buildImageParserAttempt({ provider, usage, validation, latencyMs, model, status, errorCode, errorMessage }) {
  const attempt = {
    provider,
    status,
    latencyMs,
  };
  if (validation) {
    attempt.validationScore = validation.score;
    attempt.validationIssues = validation.issues;
  }
  if (errorCode) attempt.errorCode = errorCode;
  if (errorMessage) attempt.errorMessage = errorMessage;
  if (usage) {
    attempt.inputTokens = usage.inputTokens;
    attempt.outputTokens = usage.outputTokens;
    attempt.model = usage.model || model || '';
    attempt.usage = usage;
  } else if (model) {
    attempt.model = model;
  }
  return attempt;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function mergeTrustedParseFields(baseFields, overrideFields) {
  const base = isPlainObject(baseFields) ? { ...baseFields } : {};
  const overrides = isPlainObject(overrideFields) ? overrideFields : {};
  const fields = [
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

  for (const field of fields) {
    const current = safeString(base[field], '').trim();
    const next = safeString(overrides[field], '').trim();
    if ((!current || current === 'unknown') && next && next !== 'unknown') {
      base[field] = next;
    }
  }

  return base;
}

function normalizeTriageMode(value) {
  return value === 'fallback' ? 'fallback' : 'single';
}

function providerSupportsCodexServiceTier(provider) {
  return provider && getProviderTransport(provider) === 'codex';
}

function normalizeWorkflowServiceTier(provider, fallbackProvider, value) {
  if (!providerSupportsCodexServiceTier(provider) && !providerSupportsCodexServiceTier(fallbackProvider)) {
    return '';
  }
  const requested = safeString(value, '').trim().toLowerCase();
  if (requested === 'priority') return 'fast';
  return CODEX_SERVICE_TIERS.has(requested) ? requested : 'fast';
}

function readAgentRuntimeSelection(agentRuntime, agentId, aliases = []) {
  if (!isPlainObject(agentRuntime)) return {};
  return agentRuntime[agentId]
    || agentRuntime[agentId.replace(/-/g, '')]
    || aliases.map((alias) => agentRuntime[alias]).find(Boolean)
    || {};
}

function resolveWorkflowAgentPolicy({
  agentId,
  agentRuntime,
  fallbackPolicy,
  fallbackReasoningEffort,
  aliases = [],
  defaultReasoningEffort = 'high',
}) {
  const raw = readAgentRuntimeSelection(agentRuntime, agentId, aliases);
  const runtimeConfigured = raw.configured === true || (raw.configured === undefined && Boolean(raw.provider));
  const provider = normalizeProvider(
    runtimeConfigured
      ? raw.provider
      : (fallbackPolicy?.primaryProvider || DEFAULT_PROVIDER)
  );
  // Shared, use-case-agnostic backup resolution (same helper every leg uses).
  // The selection's fallbackProvider/Model wins when distinct; otherwise the
  // request policy's resolved fallback, else the neutral global alternate.
  const backupSource = runtimeConfigured
    ? raw
    : { fallbackProvider: fallbackPolicy?.fallbackProvider, fallbackModel: fallbackPolicy?.fallbackModel };
  const backup = resolveAgentBackup(provider, backupSource);
  const fallbackProvider = backup.provider;
  const requestedMode = normalizeTriageMode(runtimeConfigured ? raw.mode : fallbackPolicy?.mode);
  const policy = applyChatFeatureFlags(resolvePolicy({
    mode: requestedMode,
    primaryProvider: provider,
    primaryModel: normalizeModelOverride(runtimeConfigured ? raw.model : fallbackPolicy?.primaryModel),
    fallbackProvider,
    fallbackModel: backup.model,
  }));

  if (policy.mode === 'fallback' && policy.fallbackProvider === policy.primaryProvider) {
    policy.mode = 'single';
  }

  return {
    ...policy,
    reasoningEffort: normalizeReasoningEffort(
      runtimeConfigured ? raw.reasoningEffort : fallbackReasoningEffort,
      fallbackReasoningEffort || defaultReasoningEffort
    ),
    serviceTier: normalizeWorkflowServiceTier(
      provider,
      fallbackProvider,
      runtimeConfigured ? raw.serviceTier : fallbackPolicy?.serviceTier
    ),
    runtimeConfigured,
    usedDefaultRuntime: !runtimeConfigured,
    runtimeSource: runtimeConfigured ? 'agent-runtime' : 'request-default',
  };
}

function resolveKnownIssueAgentPolicy({ agentRuntime, fallbackPolicy, fallbackReasoningEffort }) {
  return resolveWorkflowAgentPolicy({
    agentId: KNOWN_ISSUE_AGENT_ID,
    agentRuntime,
    fallbackPolicy,
    fallbackReasoningEffort,
    aliases: ['knownIssueSearch', 'knownIssueSearchAgent', 'invSearch', 'invSearchAgent'],
    defaultReasoningEffort: 'high',
  });
}

/**
 * Layer the analyst ("QBO Assistant", AgentIdentity key `chat`) per-agent
 * runtime backup onto the already-resolved request policy so the main-chat leg's
 * backup is sourced from the agent's own Runtime Defaults (the profile is the
 * single source of truth for provider/model selection).
 *
 * Automatic failover itself is no longer this function's job — it is now ALWAYS
 * ON in the orchestrator for every sequential policy (see
 * resolveSequentialProviders). This function only ensures the analyst's BACKUP
 * provider/model reflects the profile rather than just the global default. It
 * delegates the backup rule to the shared, use-case-agnostic
 * `resolveAgentBackup` helper so the analyst resolves its backup exactly like
 * every other leg — there is one mechanism, not two.
 *
 * Behavior:
 *   - Primary selection is left untouched (request/conversation/global wins as
 *     before — the profile does not steal the primary the user picked).
 *   - The backup provider/model comes from the profile runtime's
 *     `fallbackProvider`/`fallbackModel` when the profile supplies a distinct
 *     provider; otherwise the neutral global alternate is used. A backup that
 *     collapses to the primary is re-derived so a DISTINCT backup always exists.
 *   - The success path is unchanged — the backup is only ever invoked if the
 *     primary attempt fails (no extra cost/latency otherwise).
 *
 * Parallel-mode policies are returned unchanged (parallel has its own provider
 * set and failover semantics). When the chat fallback feature flag is disabled
 * we also leave the policy untouched, matching applyChatFeatureFlags.
 *
 * @param {object} policy        Resolved request policy from prepareChatRequest.
 * @param {object|null} agentRuntime  AgentIdentity('chat').runtime (or null when
 *                                    the profile has not configured a runtime).
 */
function resolveAnalystFailoverPolicy(policy, agentRuntime) {
  if (!policy || policy.mode === 'parallel') return policy;
  if (!isChatFallbackModeEnabled()) return policy;

  // Shared, use-case-agnostic backup resolution (same helper every leg uses).
  // When the profile supplies a distinct backup it wins; otherwise we fall back
  // to whatever the request policy already resolved, else the global alternate.
  const profileBackup = resolveAgentBackup(policy.primaryProvider, agentRuntime);
  const backupProvider = profileBackup.fromProfile
    ? profileBackup.provider
    : (policy.fallbackProvider || profileBackup.provider);
  const backupModel = profileBackup.fromProfile
    ? profileBackup.model
    : (backupProvider === policy.fallbackProvider ? (policy.fallbackModel || '') : '');

  const hasDistinctFallback = backupProvider !== policy.primaryProvider;

  // Rebuild through resolvePolicy so the model-override injection guard runs on
  // any profile-supplied fallback model before it can reach a CLI spawn.
  // resolvePolicy now guarantees a distinct backup and the engine always fails
  // over, so no autoFailover flag is needed.
  const augmented = resolvePolicy({
    mode: policy.mode,
    primaryProvider: policy.primaryProvider,
    primaryModel: policy.primaryModel,
    fallbackProvider: hasDistinctFallback ? backupProvider : policy.fallbackProvider,
    fallbackModel: hasDistinctFallback ? backupModel : policy.fallbackModel,
    parallelProviders: policy.parallelProviders,
  });

  return {
    ...augmented,
    analystFallbackSource: profileBackup.fromProfile ? 'agent-profile' : 'global-default',
  };
}

function buildTriageCardFromAgentOutput(output, parseFields) {
  const built = chatTriageModule.buildSoftValidatedTriageCardFromOutput(output, parseFields);
  return {
    card: built.card,
    issues: Array.isArray(built.validation?.issues)
      ? built.validation.issues.map((issue) => issue.code || issue.message || String(issue)).filter(Boolean)
      : [],
    validation: built.validation,
    severity: built.severity,
  };
}

function normalizeTriageGenerationSource(source) {
  const normalized = safeString(source, '').trim().toLowerCase();
  if (normalized === 'agent' || normalized === 'triage-agent' || normalized === 'model') {
    return 'agent';
  }
  return 'server';
}

function annotateTriageGeneration(card, {
  source,
  latencyMs,
  provider,
  model,
} = {}) {
  const baseCard = card || chatTriageModule.buildFallbackTriageCard();
  const normalizedSource = normalizeTriageGenerationSource(source);
  const existingGeneration = baseCard.generation && typeof baseCard.generation === 'object'
    ? baseCard.generation
    : {};
  const providerLabel = safeString(provider, '').trim();
  const modelLabel = safeString(model, '').trim();
  return {
    ...baseCard,
    generation: {
      ...existingGeneration,
      source: normalizedSource,
      label: normalizedSource === 'agent' ? 'Agent generated' : 'Server generated',
      latencyMs: normalizeElapsedMs(latencyMs),
      provider: providerLabel,
      model: modelLabel,
    },
  };
}

function buildParserDerivedTriageContext({
  parserText,
  parserProvider,
  parserUsage,
  parserModel,
  elapsedMs,
  parseFieldsOverride,
}) {
  const text = safeString(parserText, '').trim();
  const normalizedModel = safeString(
    (parserUsage && parserUsage.model) || parserModel,
    ''
  );

  if (!text) {
    return {
      triageCard: annotateTriageGeneration(chatTriageModule.buildFallbackTriageCard(), {
        source: 'server',
        latencyMs: elapsedMs,
        provider: parserProvider,
        model: normalizedModel,
      }),
      parseFields: {},
      parseMeta: {
        mode: 'single',
        providerUsed: parserProvider,
        winner: parserProvider,
        fallbackUsed: false,
        fallbackFrom: null,
        attempts: [
          buildImageParserAttempt({
            provider: parserProvider,
            usage: parserUsage,
            latencyMs: elapsedMs,
            model: normalizedModel,
            status: 'error',
            errorCode: 'EMPTY_PARSER_OUTPUT',
            errorMessage: 'Image parser returned no text output',
          }),
        ],
        candidates: [],
        usedRegexFallback: true,
        validation: null,
        parsedBy: parserProvider,
        confidence: 'low',
        fieldsFound: 0,
        fallbackReason: 'Image parser returned no text output',
        model: normalizedModel,
        latencyMs: normalizeElapsedMs(elapsedMs),
      },
      triageMeta: null,
      elapsedMs,
      error: {
        code: 'EMPTY_PARSER_OUTPUT',
        message: 'Image parser returned no text output',
      },
    };
  }

  const regexParsed = parseEscalationText(text);
  const semanticValidation = validateParsedEscalation(regexParsed, { sourceText: text });
  const canonicalTemplate = validateCanonicalEscalationTemplateText(text);
  const validation = {
    ...semanticValidation,
    passed: semanticValidation.passed && canonicalTemplate.ok,
    issues: [
      ...semanticValidation.issues,
      ...canonicalTemplate.issues.map((issue) => `canonical_${issue.code}`),
    ],
  };
  const trustedFields = mergeTrustedParseFields(validation.normalizedFields, parseFieldsOverride);
  const parsedFields = validation.passed ? trustedFields : {};
  const fallbackFields = semanticValidation.passed ? trustedFields : {};
  let error = null;
  if (!semanticValidation.passed) {
    error = {
      code: 'PARSE_VALIDATION_FAILED',
      message: `Image parser output did not validate (score ${semanticValidation.score})`,
    };
  } else if (!canonicalTemplate.ok) {
    error = {
      code: 'CANONICAL_TEMPLATE_VALIDATION_FAILED',
      message: 'Image parser output did not match the canonical escalation template.',
    };
  }
  const attempts = [
    buildImageParserAttempt({
      provider: parserProvider,
      usage: parserUsage,
      validation,
      latencyMs: elapsedMs,
      model: normalizedModel,
      status: validation.passed ? 'ok' : 'error',
      errorCode: error ? error.code : '',
      errorMessage: error ? error.message : '',
    }),
  ];

  return {
    triageCard: validation.passed
      ? annotateTriageGeneration(chatTriageModule.buildServerTriageCard(parsedFields), {
          source: 'server',
          latencyMs: elapsedMs,
          provider: parserProvider,
          model: normalizedModel,
        })
      : annotateTriageGeneration(
          Object.keys(fallbackFields).length > 0
            ? chatTriageModule.buildServerTriageCard(fallbackFields)
            : chatTriageModule.buildFallbackTriageCard(),
          {
            source: 'server',
            latencyMs: elapsedMs,
            provider: parserProvider,
            model: normalizedModel,
          }
        ),
    parseFields: parsedFields,
    parseMeta: {
      mode: 'single',
      providerUsed: parserProvider,
      winner: parserProvider,
      fallbackUsed: false,
      fallbackFrom: null,
      attempts,
      candidates: validation.passed
        ? [{
            provider: parserProvider,
            status: 'ok',
            latencyMs: elapsedMs,
            validationScore: validation.score,
            validationIssues: validation.issues,
            fields: parsedFields,
            usage: parserUsage || null,
          }]
        : [],
      usedRegexFallback: true,
      validation: {
        passed: validation.passed,
        score: validation.score,
        confidence: validation.confidence,
        issues: validation.issues,
        fieldsFound: validation.fieldsFound,
        semanticPassed: semanticValidation.passed,
        canonicalTemplate: {
          passed: canonicalTemplate.ok,
          issues: canonicalTemplate.issues,
          labels: canonicalTemplate.labels,
        },
      },
      parsedBy: parserProvider,
      confidence: validation.confidence,
      fieldsFound: validation.fieldsFound,
      fallbackReason: error ? error.message : null,
      model: normalizedModel,
      latencyMs: normalizeElapsedMs(elapsedMs),
    },
    triageMeta: null,
    elapsedMs,
    error,
  };
}

async function buildAgentBackedTriageContext({
  parserText,
  parserProvider,
  parserUsage,
  parserModel,
  elapsedMs,
  parseFieldsOverride,
  triageAgentRuntime,
  fallbackPolicy,
  reasoningEffort,
  timeoutMs,
  emitStatus,
  onKnownIssueStart,
  runKnownIssueSearch = true,
  knownIssueEventBus,
}) {
  const baseContext = buildParserDerivedTriageContext({
    parserText,
    parserProvider,
    parserUsage,
    parserModel,
    elapsedMs,
    parseFieldsOverride,
  });

  if (baseContext.error || !baseContext.parseFields || Object.keys(baseContext.parseFields).length === 0) {
    const reason = baseContext.error?.message || 'Parsed template did not validate, so model-backed triage was skipped.';
    knownIssueEventBus?.emit('stage.skipped', {
      reason,
      code: baseContext.error?.code || 'PARSE_VALIDATION_FAILED',
    });
    knownIssueEventBus?.emit('stage.completed', {
      status: 'failed',
      durationMs: 0,
      fallbackUsed: true,
    });
    return {
      ...baseContext,
      knownIssueSearchResult: null,
      triageCard: null,
      triageMeta: null,
    };
  }

  const knownIssuePolicy = resolveKnownIssueAgentPolicy({
    agentRuntime: triageAgentRuntime,
    fallbackPolicy,
    fallbackReasoningEffort: reasoningEffort,
  });

  if (runKnownIssueSearch && knownIssuePolicy.usedDefaultRuntime) {
    await emitStatus?.({
      level: 'warning',
      message: 'INV Search Agent has no saved runtime. Using the request/default chat runtime for this search pass.',
      code: 'KNOWN_ISSUE_AGENT_DEFAULT_RUNTIME',
      provider: knownIssuePolicy.primaryProvider,
      model: knownIssuePolicy.primaryModel || getProviderModelId(knownIssuePolicy.primaryProvider) || '',
    });
  }

  const knownIssuePromise = runKnownIssueSearch
    ? (async () => {
      await callOptional(onKnownIssueStart, {
        provider: knownIssuePolicy.primaryProvider,
        model: knownIssuePolicy.primaryModel || getProviderModelId(knownIssuePolicy.primaryProvider) || '',
      });
      knownIssueEventBus?.emit('stage.started', {
        agentName: 'INV Search Agent',
        provider: knownIssuePolicy.primaryProvider,
        model: knownIssuePolicy.primaryModel || getProviderModelId(knownIssuePolicy.primaryProvider) || '',
        reasoningEffort: knownIssuePolicy.reasoningEffort || '',
        serviceTier: knownIssuePolicy.serviceTier || '',
      });
      return knownIssueSearchModule.runKnownIssueSearchAgent({
        parserText,
        parseFields: baseContext.parseFields,
        policy: knownIssuePolicy,
        timeoutMs,
        emitStatus,
        eventBus: knownIssueEventBus,
      });
    })()
    : Promise.resolve(null);

  const knownIssueSearchResult = await knownIssuePromise;

  if (knownIssueSearchResult) {
    const matchCount = Array.isArray(knownIssueSearchResult.matches) ? knownIssueSearchResult.matches.length : 0;
    knownIssueEventBus?.emit('inv.matches_found', {
      status: knownIssueSearchResult.status || '',
      matchCount,
      validationPassed: Boolean(knownIssueSearchResult.validation?.passed),
    });
    knownIssueEventBus?.emit('stage.completed', {
      status: knownIssueSearchResult.ok ? 'success' : 'failed',
      durationMs: normalizeElapsedMs(knownIssueSearchResult.meta?.latencyMs),
      provider: knownIssueSearchResult.meta?.providerUsed || knownIssuePolicy.primaryProvider,
      model: knownIssueSearchResult.meta?.model || getProviderModelId(knownIssuePolicy.primaryProvider) || '',
    });
  }

  return {
    ...baseContext,
    knownIssueSearchResult,
    triageCard: null,
    triageMeta: null,
    elapsedMs: baseContext.elapsedMs,
  };
}

function isStrongInvMatch(match) {
  if (!match || typeof match !== 'object') return false;
  const confidence = String(match.confidence || '').toLowerCase();
  const score = Number(match.score || 0);
  return confidence === 'exact' || score >= 40;
}

async function runInvMatching({ message, parseFields, category }) {
  try {
    let matches = [];

    if (parseFields && typeof parseFields === 'object') {
      const fieldsWithCategory = { ...parseFields };
      if (category && !fieldsWithCategory.category) fieldsWithCategory.category = category;
      matches = await invMatcherModule.matchFromParseFields(fieldsWithCategory);
    }

    if (matches.length === 0 && message && typeof message === 'string' && message.trim()) {
      matches = await invMatcherModule.matchInvestigations(message.trim(), {
        category: category || null,
        limit: 5,
      });
      matches = matches.map((match) => ({
        ...match,
        confidence: match.confidence || (match.score >= 40 ? 'exact' : match.score >= 20 ? 'likely' : 'possible'),
      }));
    }

    matches = matches.filter(isStrongInvMatch).slice(0, 3);

    if (matches.length === 0) return { matches: [], ssePayload: [] };

    for (const match of matches) {
      const investigation = match.investigation || match;
      if (investigation._id) invMatcherModule.incrementMatchCount(investigation._id).catch(() => {});
    }

    const ssePayload = matches.map((match) => {
      const investigation = match.investigation || match;
      return {
        _id: investigation._id ? investigation._id.toString() : undefined,
        invNumber: investigation.invNumber,
        subject: investigation.subject,
        workaround: investigation.workaround || '',
        notes: investigation.notes || '',
        category: investigation.category || '',
        status: investigation.status || '',
        affectedCount: investigation.affectedCount || 0,
        confidence: match.confidence || 'possible',
        score: match.score || 0,
      };
    });

    return { matches, ssePayload };
  } catch (err) {
    console.warn('[chat] INV matching failed (non-fatal):', err.message);
    return { matches: [], ssePayload: [] };
  }
}

async function callOptional(callback, payload) {
  if (typeof callback !== 'function') return;
  await callback(payload);
}

async function runChatImageTranscriptionFallback({
  normalizedImages,
  transcriptionModel,
  effectiveReasoningEffort,
  effectiveTimeoutMs,
  sendStatus,
}) {
  await sendStatus('Using standard image transcription...');
  const transcription = await chatImageModule.transcribeImageForChat(normalizedImages, {
    model: transcriptionModel || undefined,
    reasoningEffort: effectiveReasoningEffort || 'high',
    timeoutMs: effectiveTimeoutMs || undefined,
  });

  if (!transcription) return null;
  return {
    ...transcription,
    source: 'chat-image-transcription',
    role: 'unknown',
  };
}

async function buildChatImageAugmentation({
  normalizedImages,
  messageText,
  baseSystemPrompt,
  emitStatus,
  onTranscriptionStart,
  onTranscriptionComplete,
  onKnownIssueStart,
  imageParserConfig,
  parsedEscalationText,
  parsedEscalationProvider,
  parsedEscalationModel,
  parsedEscalationElapsedMs,
  transcriptionModel,
  effectiveReasoningEffort,
  effectiveTimeoutMs,
  triageAgentRuntime,
  fallbackPolicy,
  parserEventBus,
  knownIssueEventBus,
}) {
  let nonEscalationIntent = chatTriageModule.isNonEscalationIntent(messageText);
  const sendStatus = typeof emitStatus === 'function' ? emitStatus : async () => {};

  let imageTranscription = null;
  let parserError = null;
  const providedParsedText = safeString(parsedEscalationText, '').trim();
  if (providedParsedText && normalizedImages.length === 0) {
    imageTranscription = {
      text: providedParsedText,
      usage: null,
      source: 'parsed-escalation-text',
      role: 'escalation',
      providerUsed: normalizeProvider(parsedEscalationProvider || DEFAULT_PROVIDER),
      model: safeString(parsedEscalationModel, ''),
      elapsedMs: normalizeElapsedMs(parsedEscalationElapsedMs),
    };
    // Parser ran client-side via /api/image-parser/parse (which streams its
    // own stage_event SSE). Don't synthesize a replay here — emit a single
    // marker so the popout's saved-events fallback shows context if reopened.
    parserEventBus?.emit('parser.replay_skipped', {
      reason: 'events streamed by /api/image-parser/parse',
      provider: imageTranscription.providerUsed,
      model: imageTranscription.model,
      elapsedMs: imageTranscription.elapsedMs,
      charCount: imageTranscription.text.length,
    });
  }
  if (normalizedImages.length > 0) {
    if (!imageParserConfig?.provider) {
      await sendStatus({
        level: 'warning',
        message: 'Image Parser is not configured for this request. Using generic image transcription instead.',
        code: 'IMAGE_PARSER_AGENT_DISABLED',
      });
      imageTranscription = await runChatImageTranscriptionFallback({
        normalizedImages,
        transcriptionModel,
        effectiveReasoningEffort,
        effectiveTimeoutMs,
        sendStatus,
      });
      await callOptional(onTranscriptionComplete, imageTranscription);
    } else {
      const parserStartedAt = Date.now();
      await callOptional(onTranscriptionStart, {
        provider: imageParserConfig.provider,
        model: imageParserConfig.model || '',
      });
        parserEventBus?.emit('stage.started', {
          agentName: 'Image Parser',
          provider: imageParserConfig.provider,
          model: imageParserConfig.model || '',
          reasoningEffort: imageParserConfig.reasoningEffort || '',
          serviceTier: imageParserConfig.serviceTier || '',
        });
      parserEventBus?.emit('prompt.rendered', {
        promptId: imageParserConfig.promptId || 'escalation-template-parser',
      });
      await sendStatus('Parsing image with dedicated image parser...');
      try {
        const { parseImage } = require('./image-parser');
        parserEventBus?.emit('llm.request', {
          provider: imageParserConfig.provider,
          model: imageParserConfig.model || '',
          reasoningEffort: imageParserConfig.reasoningEffort || '',
          serviceTier: imageParserConfig.serviceTier || '',
          promptId: imageParserConfig.promptId || 'escalation-template-parser',
        });
        const parserResult = await parseImage(normalizedImages[0], {
          provider: imageParserConfig.provider,
          model: imageParserConfig.model || undefined,
          reasoningEffort: imageParserConfig.reasoningEffort || undefined,
          serviceTier: imageParserConfig.serviceTier || undefined,
          // Wave 2 universal failover: fail over to the image-parser agent's
          // backup on a primary-provider failure BEFORE the generic-transcription
          // last resort below. agentRuntime signals failover intent (defaults to
          // the neutral global alternate); an explicit fallback wins. No
          // capability filtering.
          fallbackProvider: imageParserConfig.fallbackProvider || '',
          fallbackModel: imageParserConfig.fallbackModel || '',
          agentRuntime: imageParserConfig.agentRuntime || null,
          promptId: imageParserConfig.promptId || 'escalation-template-parser',
          timeoutMs: 45_000,
        });
        imageTranscription = {
          text: safeString(parserResult && parserResult.text, ''),
          usage: parserResult && parserResult.usage ? parserResult.usage : null,
          source: 'image-parser-agent',
          role: parserResult && parserResult.role ? parserResult.role : 'unknown',
          parseMeta: parserResult && parserResult.parseMeta ? parserResult.parseMeta : null,
          // After an automatic failover, providerUsed is the backup that produced
          // the parse; fall back to the requested provider otherwise.
          providerUsed: safeString(parserResult && parserResult.providerUsed, '') || imageParserConfig.provider,
          fallbackUsed: Boolean(parserResult && parserResult.fallbackUsed),
          fallbackFrom: safeString(parserResult && parserResult.fallbackFrom, ''),
          model: safeString(
            (parserResult && parserResult.usage && parserResult.usage.model)
              || (parserResult && parserResult.modelUsed)
              || imageParserConfig.model,
            ''
          ),
          elapsedMs: Date.now() - parserStartedAt,
        };
        parserEventBus?.emit('llm.response', {
          latencyMs: imageTranscription.elapsedMs,
          provider: imageTranscription.providerUsed,
          model: imageTranscription.model,
          charCount: imageTranscription.text.length,
          usage: imageTranscription.usage ? {
            inputTokens: imageTranscription.usage.inputTokens,
            outputTokens: imageTranscription.usage.outputTokens,
            totalTokens: imageTranscription.usage.totalTokens,
          } : null,
        });
        const validationFailure = summarizeImageParserValidationFailure(parserResult?.parseMeta);
        if (validationFailure) {
          parserEventBus?.emit('error', {
            code: validationFailure.code,
            message: validationFailure.message,
          });
          await sendStatus({
            level: 'warning',
            message: validationFailure.message,
            code: validationFailure.code,
            provider: imageParserConfig.provider,
            model: imageParserConfig.model || '',
            fallbackUsed: true,
            fallbackFrom: 'parse-validation',
            fallbackReason: validationFailure.issue,
          });
          imageTranscription = await runChatImageTranscriptionFallback({
            normalizedImages,
            transcriptionModel,
            effectiveReasoningEffort,
            effectiveTimeoutMs,
            sendStatus,
          });
          parserEventBus?.emit('stage.completed', {
            status: 'failed',
            durationMs: Date.now() - parserStartedAt,
            fallbackUsed: true,
            fallbackFrom: 'parse-validation',
            fallbackReason: validationFailure.issue,
          });
        } else if (!safeString(imageTranscription.text, '').trim()) {
          parserEventBus?.emit('error', {
            code: 'IMAGE_PARSER_EMPTY_OUTPUT',
            message: 'Image Parser returned empty text. Falling back to generic image transcription.',
          });
          await sendStatus({
            level: 'warning',
            message: 'Image Parser returned empty text. Falling back to generic image transcription.',
            code: 'IMAGE_PARSER_EMPTY_OUTPUT',
            provider: imageParserConfig.provider,
            model: imageParserConfig.model || '',
          });
          imageTranscription = await runChatImageTranscriptionFallback({
            normalizedImages,
            transcriptionModel,
            effectiveReasoningEffort,
            effectiveTimeoutMs,
            sendStatus,
          });
          parserEventBus?.emit('stage.completed', {
            status: 'failed',
            durationMs: Date.now() - parserStartedAt,
            fallbackUsed: true,
          });
        } else {
          if (imageTranscription.role === 'inv-list') {
            nonEscalationIntent = true;
            parserEventBus?.emit('image.normalized', { role: 'inv-list' });
          } else if (imageTranscription.role) {
            parserEventBus?.emit('image.normalized', { role: imageTranscription.role });
          }
          parserEventBus?.emit('stage.completed', {
            status: 'success',
            durationMs: Date.now() - parserStartedAt,
            provider: imageTranscription.providerUsed,
            model: imageTranscription.model,
          });
        }
      } catch (err) {
        parserError = err || null;
        const captureFailed = err?.code === 'PROVIDER_PACKAGE_CAPTURE_FAILED';
        const fallbackMessage = captureFailed
          ? 'Image Parser provider responded, but required Mongo provider-package capture failed. Falling back to generic image transcription.'
          : 'Image Parser failed. Falling back to generic image transcription.';
        parserEventBus?.emit('error', {
          code: err?.code || 'IMAGE_PARSER_FAILED',
          message: err?.message || fallbackMessage,
          providerPackageId: err?.providerTrace?.providerPackageId || null,
          providerHarness: err?.providerTrace?.providerHarness || null,
          captureMode: err?.captureMode || err?.providerTrace?.captureMode || null,
        });
        if (IMAGE_PARSER_VERBOSE_LOGS) {
          console.warn('[chat] Dedicated image parser failed; falling back to standard image transcription:', err.message);
        }
        await sendStatus({
          level: 'warning',
          message: fallbackMessage,
          code: captureFailed ? 'IMAGE_PARSER_PACKAGE_CAPTURE_FALLBACK' : 'IMAGE_PARSER_FALLBACK',
          provider: imageParserConfig.provider,
          model: imageParserConfig.model || '',
          providerPackageId: err?.providerTrace?.providerPackageId || null,
          captureMode: err?.captureMode || err?.providerTrace?.captureMode || null,
          fallbackUsed: true,
          fallbackFrom: captureFailed ? 'provider-package-capture' : 'image-parser-error',
        });
        imageTranscription = await runChatImageTranscriptionFallback({
          normalizedImages,
          transcriptionModel,
          effectiveReasoningEffort,
          effectiveTimeoutMs,
          sendStatus,
        });
        parserEventBus?.emit('stage.completed', {
          status: 'failed',
          durationMs: Date.now() - parserStartedAt,
          fallbackUsed: true,
          fallbackFrom: captureFailed ? 'provider-package-capture' : 'image-parser-error',
        });
      }
      await callOptional(onTranscriptionComplete, imageTranscription);
    }
  }

  const shouldRunTriage = (
    (normalizedImages.length > 0 || Boolean(providedParsedText))
    && !nonEscalationIntent
    && imageTranscription
    && safeString(imageTranscription.text, '').trim()
  );

  if (shouldRunTriage) {
    await sendStatus('Running INV Search Agent...');
  }

  const imageTriageContext = shouldRunTriage
    ? await buildAgentBackedTriageContext({
        parserText: imageTranscription.text,
        parserProvider: imageTranscription.providerUsed || imageParserConfig?.provider || DEFAULT_PROVIDER,
        parserUsage: imageTranscription.usage || null,
        parserModel: imageTranscription.model || imageParserConfig?.model || '',
        elapsedMs: imageTranscription.elapsedMs || 0,
        triageAgentRuntime,
        fallbackPolicy,
        reasoningEffort: effectiveReasoningEffort,
        timeoutMs: effectiveTimeoutMs,
        emitStatus: sendStatus,
        onKnownIssueStart,
        knownIssueEventBus,
      })
    : null;

  const hasStructuredImageContext = Boolean(
    imageTriageContext
    && imageTriageContext.parseFields
    && Object.keys(imageTriageContext.parseFields).length > 0
  );

  let effectiveSystemPrompt = hasStructuredImageContext
    ? chatTriageModule.buildImageTurnSystemPrompt(baseSystemPrompt)
    : baseSystemPrompt;

  if (imageTranscription && imageTranscription.text) {
    const transcriptionBlock = chatImageModule.buildTranscriptionRefBlock(imageTranscription.text);
    if (transcriptionBlock) effectiveSystemPrompt += transcriptionBlock;
  }

  if (imageTriageContext && imageTriageContext.parseFields) {
    const triageBlock = chatTriageModule.buildTriageRefBlock(imageTriageContext.parseFields);
    if (triageBlock) effectiveSystemPrompt += triageBlock;
  }

  const knownIssueSearchResult = imageTriageContext?.knownIssueSearchResult || null;
  if (knownIssueSearchResult) {
    const knownIssueBlock = chatTriageModule.buildKnownIssueSearchRefBlock(knownIssueSearchResult);
    if (knownIssueBlock) effectiveSystemPrompt += knownIssueBlock;
  }

  const invMatchResult = knownIssueSearchResult
    ? knownIssueSearchModule.knownIssueSearchToInvMatchResult(knownIssueSearchResult)
    : await runInvMatching({
        message: (imageTranscription && imageTranscription.text) || safeString(messageText, ''),
        parseFields: imageTriageContext?.parseFields || null,
        category: imageTriageContext?.parseFields?.category || null,
      });

  if (invMatchResult.matches.length > 0) {
    const invBlock = chatTriageModule.buildInvMatchRefBlock(invMatchResult.matches);
    if (invBlock) effectiveSystemPrompt += invBlock;
  }

  return {
    effectiveSystemPrompt,
    imageTranscription,
    imageTriageContext,
    invMatchResult,
    nonEscalationIntent,
    parserError,
  };
}

module.exports = {
  DEFAULT_PROVIDER,
  buildAgentBackedTriageContext,
  buildChatImageAugmentation,
  buildParserDerivedTriageContext,
  buildTriageCardFromAgentOutput,
  getChatGenerationValidationError,
  getParallelOpenTurnLimit,
  isParallelModeEnabled,
  isValidMode,
  isValidParseMode,
  normalizeReasoningEffort,
  prepareChatRequest,
  resolveAnalystFailoverPolicy,
  resolveKnownIssueAgentPolicy,
  resolveParseMode,
  toParseResponseMeta,
};
