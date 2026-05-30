'use strict';

const { buildChatModelContext } = require('../lib/chat-context-builder');
const chatImageModule = require('../lib/chat-image');
const { evaluateChatGuardrails } = require('../lib/chat-guardrails');
const chatTriageModule = require('../lib/chat-triage');
const { getRenderedAgentPrompt } = require('../lib/agent-prompt-store');
const { parseEscalationText } = require('../lib/escalation-parser');
const { validateCanonicalEscalationTemplateText } = require('../lib/escalation-template-contract');
const { validateParsedEscalation } = require('../lib/parse-validation');
const {
  VALID_MODES,
  normalizeModelOverride,
  resolvePolicy,
  startChatOrchestration,
} = require('./chat-orchestrator');
const {
  VALID_PARSE_MODES,
} = require('./parse-orchestrator');
const invMatcherModule = require('./inv-matcher');
const knownIssueSearchModule = require('./known-issue-search-agent');
const { createThinkingCoalescer } = require('../lib/thinking-coalescer');
const {
  getAlternateProvider,
  getDefaultProvider,
  normalizeProvider,
} = require('./providers/registry');
const { getProviderModelId } = require('./providers/catalog');

const DEFAULT_PARALLEL_OPEN_TURN_LIMIT = 8;
const DEFAULT_PROVIDER = getDefaultProvider();
const IMAGE_PARSER_VERBOSE_LOGS = process.env.IMAGE_PARSER_VERBOSE_LOGS === '1';
const TRIAGE_AGENT_ID = 'triage-agent';
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

  const contextBundle = buildChatModelContext({
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
  const fallbackProvider = normalizeProvider(
    runtimeConfigured
      ? (raw.fallbackProvider || getAlternateProvider(provider))
      : (fallbackPolicy?.fallbackProvider || getAlternateProvider(provider))
  );
  const requestedMode = normalizeTriageMode(runtimeConfigured ? raw.mode : fallbackPolicy?.mode);
  const policy = applyChatFeatureFlags(resolvePolicy({
    mode: requestedMode,
    primaryProvider: provider,
    primaryModel: normalizeModelOverride(runtimeConfigured ? raw.model : fallbackPolicy?.primaryModel),
    fallbackProvider,
    fallbackModel: normalizeModelOverride(runtimeConfigured ? raw.fallbackModel : fallbackPolicy?.fallbackModel),
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
    runtimeConfigured,
    usedDefaultRuntime: !runtimeConfigured,
    runtimeSource: runtimeConfigured ? 'agent-runtime' : 'request-default',
  };
}

function resolveTriageAgentPolicy({ agentRuntime, fallbackPolicy, fallbackReasoningEffort }) {
  return resolveWorkflowAgentPolicy({
    agentId: TRIAGE_AGENT_ID,
    agentRuntime,
    fallbackPolicy,
    fallbackReasoningEffort,
    aliases: ['triage', 'triageAgent'],
    defaultReasoningEffort: 'high',
  });
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

function normalizeTriageSeverity(value) {
  const match = safeString(value, '').toUpperCase().match(/\bP[1-4]\b/);
  return match ? match[0] : 'P3';
}

function normalizeTriageCategory(value) {
  const normalized = safeString(value, '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  const aliases = {
    reporting: 'reports',
    report: 'reports',
    bankfeeds: 'bank-feeds',
    'bank-feed': 'bank-feeds',
    banking: 'bank-feeds',
    permission: 'permissions',
    invoice: 'invoicing',
  };
  const category = aliases[normalized] || normalized;
  return [
    'payroll',
    'bank-feeds',
    'reconciliation',
    'permissions',
    'billing',
    'tax',
    'reports',
    'technical',
    'invoicing',
  ].includes(category) ? category : 'technical';
}

function normalizeTriageConfidence(value) {
  const normalized = safeString(value, '').trim().toLowerCase();
  if (normalized.includes('high')) return 'high';
  if (normalized.includes('medium')) return 'medium';
  if (normalized.includes('low')) return 'low';
  return normalized || 'medium';
}

function splitMissingInfo(value) {
  const text = safeString(value, '').trim();
  if (!text) return ['None'];
  if (/^(none|no obvious gaps|n\/a|na)$/i.test(text)) return ['None'];
  return text
    .split(/\n|;|\s+-\s+/)
    .map((item) => item.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 6);
}

function parseLabeledTriageOutput(output) {
  const text = safeString(output, '').trim();
  if (!text) return {};
  const fieldMap = {
    category: 'category',
    severity: 'severity',
    'fast read': 'read',
    read: 'read',
    'quick read': 'read',
    'immediate next step': 'action',
    'next step': 'action',
    action: 'action',
    'missing info': 'missingInfo',
    confidence: 'confidence',
    'category check': 'categoryCheck',
  };
  const result = {};
  let activeKey = '';

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const match = line.match(/^([A-Za-z][A-Za-z\s/-]{1,40}):\s*(.*)$/);
    if (match) {
      const label = match[1].trim().toLowerCase().replace(/\s+/g, ' ');
      const key = fieldMap[label];
      if (key) {
        activeKey = key;
        result[key] = match[2].trim();
        continue;
      }
    }
    if (activeKey && line.trim()) {
      result[activeKey] = `${result[activeKey] ? `${result[activeKey]}\n` : ''}${line.trim()}`;
    }
  }

  return result;
}

function buildTriageCardFromAgentOutput(output, parseFields) {
  const parsed = parseLabeledTriageOutput(output);
  const issues = [];
  for (const key of ['category', 'severity', 'read', 'action', 'confidence', 'categoryCheck']) {
    if (!safeString(parsed[key], '').trim()) issues.push(`missing_${key}`);
  }
  if (issues.length > 0) {
    return { card: null, issues };
  }

  const sourceFields = isPlainObject(parseFields) ? parseFields : {};
  const card = {
    agent: safeString(sourceFields.agentName, 'Unknown') || 'Unknown',
    client: safeString(sourceFields.clientContact, 'Unknown') || 'Unknown',
    category: normalizeTriageCategory(parsed.category),
    severity: normalizeTriageSeverity(parsed.severity),
    read: safeString(parsed.read, '').trim(),
    action: safeString(parsed.action, '').trim(),
    missingInfo: splitMissingInfo(parsed.missingInfo),
    confidence: normalizeTriageConfidence(parsed.confidence),
    categoryCheck: safeString(parsed.categoryCheck, '').trim(),
    source: 'triage-agent',
    fallback: {
      used: false,
    },
  };

  return { card, issues: [] };
}

function normalizeTriageGenerationSource(source) {
  const normalized = safeString(source, '').trim().toLowerCase();
  if (normalized === 'agent' || normalized === TRIAGE_AGENT_ID || normalized === 'model') {
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

function buildTriageAgentPromptInput({ parserText, parseFields }) {
  return [
    'Triage this parsed QBO escalation template.',
    '',
    'Use the parsed template as the source of truth. Do not assume external facts unless they are safe operational triage assumptions.',
    'Return only the required labeled fields from your triage-agent prompt.',
    '',
    'Parsed fields JSON:',
    JSON.stringify(parseFields || {}, null, 2),
    '',
    'Raw parsed template:',
    safeString(parserText, '').trim(),
  ].join('\n');
}

function runTriageAgentCompletion({ policy, parserText, parseFields, timeoutMs, eventBus }) {
  const startedAt = Date.now();
  const systemPrompt = getRenderedAgentPrompt(TRIAGE_AGENT_ID);
  const messages = [{
    role: 'user',
    content: buildTriageAgentPromptInput({ parserText, parseFields }),
  }];
  let streamingEmitted = false;
  const thinkingCoalescer = createThinkingCoalescer((delta) => {
    eventBus?.emit('llm.thinking', {
      provider: policy.primaryProvider,
      model: policy.primaryModel || getProviderModelId(policy.primaryProvider) || '',
      delta,
    });
  });

  return new Promise((resolve) => {
    let settled = false;
    let cleanup = null;

    function finish(result) {
      if (settled) return;
      settled = true;
      thinkingCoalescer.flush();
      resolve({
        ...result,
        latencyMs: result.latencyMs || (Date.now() - startedAt),
      });
    }

    eventBus?.emit('llm.request', {
      provider: policy.primaryProvider,
      model: policy.primaryModel || getProviderModelId(policy.primaryProvider) || '',
      reasoningEffort: policy.reasoningEffort || '',
      mode: policy.mode,
    });

    cleanup = startChatOrchestration({
      mode: policy.mode,
      primaryProvider: policy.primaryProvider,
      primaryModel: policy.primaryModel,
      fallbackProvider: policy.fallbackProvider,
      fallbackModel: policy.fallbackModel,
      messages,
      systemPrompt,
      images: [],
      reasoningEffort: policy.reasoningEffort,
      timeoutMs,
      onChunk: () => {
        if (!streamingEmitted) {
          streamingEmitted = true;
          eventBus?.emit('llm.streaming', { provider: policy.primaryProvider });
        }
      },
      onThinkingChunk: ({ thinking } = {}) => {
        thinkingCoalescer.push(typeof thinking === 'string' ? thinking : '');
      },
      onProviderError: (info) => {
        eventBus?.emit('error', {
          code: info?.code || 'PROVIDER_ERROR',
          message: info?.message || 'Provider attempt failed.',
          provider: info?.provider || '',
        });
      },
      onFallback: (info) => {
        eventBus?.emit('llm.fallback', {
          from: info?.from || '',
          to: info?.to || '',
          reason: info?.reason || '',
        });
      },
      onDone: (data) => {
        eventBus?.emit('llm.response', {
          latencyMs: Date.now() - startedAt,
          provider: data?.providerUsed || policy.primaryProvider,
          model: data?.modelUsed || getProviderModelId(data?.providerUsed) || '',
          usage: data?.usage ? {
            inputTokens: data.usage.inputTokens,
            outputTokens: data.usage.outputTokens,
            totalTokens: data.usage.totalTokens,
          } : null,
        });
        finish({
        ok: true,
        providerUsed: data.providerUsed,
        modelUsed: data.modelUsed || getProviderModelId(data.providerUsed),
        fullResponse: data.fullResponse || '',
        attempts: Array.isArray(data.attempts) ? data.attempts : [],
        fallbackUsed: Boolean(data.fallbackUsed),
        fallbackFrom: data.fallbackFrom || null,
        usage: data.usage || null,
        mode: data.mode || policy.mode,
        latencyMs: Date.now() - startedAt,
      });
      },
      onError: (err) => finish({
        ok: false,
        providerUsed: policy.primaryProvider,
        modelUsed: safeString(err?.modelUsed, '') || getProviderModelId(policy.primaryProvider),
        attempts: Array.isArray(err?.attempts) ? err.attempts : [],
        fallbackUsed: Boolean(err?.fallbackFrom),
        fallbackFrom: err?.fallbackFrom || null,
        usage: err?.usage || null,
        mode: err?.mode || policy.mode,
        error: {
          code: err?.code || 'TRIAGE_AGENT_FAILED',
          message: err?.message || 'Triage agent failed.',
          detail: err?.detail || '',
        },
        latencyMs: Date.now() - startedAt,
      }),
      onAbort: (abort) => finish({
        ok: false,
        providerUsed: policy.primaryProvider,
        modelUsed: getProviderModelId(policy.primaryProvider),
        attempts: Array.isArray(abort?.attempts) ? abort.attempts : [],
        fallbackUsed: false,
        fallbackFrom: null,
        usage: null,
        mode: policy.mode,
        error: {
          code: 'TRIAGE_AGENT_ABORTED',
          message: 'Triage agent was aborted.',
        },
        latencyMs: Date.now() - startedAt,
      }),
    });

    if (typeof cleanup !== 'function') {
      finish({
        ok: false,
        providerUsed: policy.primaryProvider,
        modelUsed: getProviderModelId(policy.primaryProvider),
        attempts: [],
        fallbackUsed: false,
        fallbackFrom: null,
        usage: null,
        mode: policy.mode,
        error: {
          code: 'TRIAGE_AGENT_NOT_STARTED',
          message: 'Triage agent did not start.',
        },
        latencyMs: Date.now() - startedAt,
      });
    }
  });
}

function buildTriageAgentMeta({ policy, result, validation, fallbackReason, fallbackFrom }) {
  const providerUsed = safeString(result?.providerUsed, policy.primaryProvider);
  const model = safeString(result?.modelUsed, '') || getProviderModelId(providerUsed) || '';
  const ruleFallback = Boolean(fallbackReason);
  return {
    mode: result?.mode || policy.mode,
    providerUsed,
    winner: providerUsed,
    fallbackUsed: Boolean(result?.fallbackUsed),
    fallbackFrom: ruleFallback ? (fallbackFrom || null) : (result?.fallbackFrom || null),
    attempts: Array.isArray(result?.attempts) ? result.attempts : [],
    candidates: [],
    usedRegexFallback: false,
    usedRuleFallback: ruleFallback,
    validation: validation || null,
    parsedBy: TRIAGE_AGENT_ID,
    confidence: validation?.confidence || '',
    fieldsFound: validation?.fieldsFound || 0,
    fallbackReason: fallbackReason || null,
    model,
    latencyMs: normalizeElapsedMs(result?.latencyMs),
    runtimeConfigured: Boolean(policy.runtimeConfigured),
    usedDefaultRuntime: Boolean(policy.usedDefaultRuntime),
    runtimeSource: policy.runtimeSource || '',
  };
}

function annotateRuleFallbackCard(card, reason) {
  const fallbackReason = safeString(reason, 'Triage agent did not produce a usable triage card.');
  return {
    ...(card || chatTriageModule.buildFallbackTriageCard()),
    source: 'rule-fallback',
    confidence: card?.confidence || 'low',
    fallback: {
      used: true,
      reason: fallbackReason,
      warning: 'This triage card was generated by deterministic fallback rules, not the configured Triage Agent model.',
    },
  };
}

function annotateDefaultRuntimeCard(card, policy) {
  if (!card || !policy?.usedDefaultRuntime) return card;
  return {
    ...card,
    runtime: {
      ...(card.runtime || {}),
      usedDefault: true,
      warning: 'Triage Agent profile has no saved runtime. This card used the request/default chat runtime.',
      provider: policy.primaryProvider,
      model: policy.primaryModel || getProviderModelId(policy.primaryProvider) || '',
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
  onTriageStart,
  runKnownIssueSearch = true,
  knownIssueEventBus,
  triageEventBus,
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
    triageEventBus?.emit('stage.skipped', {
      reason,
      code: baseContext.error?.code || 'PARSE_VALIDATION_FAILED',
    });
    triageEventBus?.emit('stage.completed', {
      status: 'failed',
      durationMs: 0,
      fallbackUsed: true,
    });
    return {
      ...baseContext,
      triageCard: annotateTriageGeneration(
        annotateRuleFallbackCard(baseContext.triageCard, reason),
        {
          source: 'server',
          latencyMs: baseContext.elapsedMs,
          provider: baseContext.parseMeta?.providerUsed || parserProvider,
          model: baseContext.parseMeta?.model || parserModel,
        }
      ),
      triageMeta: {
        mode: 'single',
        providerUsed: '',
        winner: '',
        fallbackUsed: false,
        fallbackFrom: 'parse-validation',
        attempts: [],
        candidates: [],
        usedRegexFallback: false,
        usedRuleFallback: true,
        validation: {
          passed: false,
          issues: [baseContext.error?.code || 'PARSE_VALIDATION_FAILED'],
          confidence: 'low',
          fieldsFound: 0,
        },
        parsedBy: 'rule-fallback',
        confidence: 'low',
        fieldsFound: 0,
        fallbackReason: reason,
        model: '',
      },
    };
  }

  const policy = resolveTriageAgentPolicy({
    agentRuntime: triageAgentRuntime,
    fallbackPolicy,
    fallbackReasoningEffort: reasoningEffort,
  });
  const knownIssuePolicy = resolveKnownIssueAgentPolicy({
    agentRuntime: triageAgentRuntime,
    fallbackPolicy,
    fallbackReasoningEffort: reasoningEffort,
  });
  // Emit pre-flight status events sequentially (cheap), then kick INV + Triage
  // off in parallel. Triage no longer consumes INV results, so they are
  // independent. Both must resolve before the analyst leg, which still
  // consumes knownIssueSearchResult downstream.
  if (runKnownIssueSearch && knownIssuePolicy.usedDefaultRuntime) {
    await emitStatus?.({
      level: 'warning',
      message: 'INV Search Agent has no saved runtime. Using the request/default chat runtime for this search pass.',
      code: 'KNOWN_ISSUE_AGENT_DEFAULT_RUNTIME',
      provider: knownIssuePolicy.primaryProvider,
      model: knownIssuePolicy.primaryModel || getProviderModelId(knownIssuePolicy.primaryProvider) || '',
    });
  }
  if (policy.usedDefaultRuntime) {
    await emitStatus?.({
      level: 'warning',
      message: 'Triage Agent has no saved runtime. Using the request/default chat runtime for this triage pass.',
      code: 'TRIAGE_AGENT_DEFAULT_RUNTIME',
      provider: policy.primaryProvider,
      model: policy.primaryModel || getProviderModelId(policy.primaryProvider) || '',
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

  const triagePromise = (async () => {
    await callOptional(onTriageStart, {
      provider: policy.primaryProvider,
      model: policy.primaryModel || getProviderModelId(policy.primaryProvider) || '',
    });
    await emitStatus?.({
      message: `Running Triage Agent with ${policy.primaryProvider}.`,
      code: 'TRIAGE_AGENT_STARTED',
      provider: policy.primaryProvider,
      model: policy.primaryModel || getProviderModelId(policy.primaryProvider) || '',
    });
    triageEventBus?.emit('stage.started', {
      agentName: 'Triage Agent',
      provider: policy.primaryProvider,
      model: policy.primaryModel || getProviderModelId(policy.primaryProvider) || '',
      reasoningEffort: policy.reasoningEffort || '',
    });
    triageEventBus?.emit('triage.context_built', {
      parseFieldCount: Object.keys(baseContext.parseFields || {}).length,
      parserTextChars: safeString(parserText, '').length,
    });
    return runTriageAgentCompletion({
      policy,
      parserText,
      parseFields: baseContext.parseFields,
      timeoutMs,
      eventBus: triageEventBus,
    });
  })();

  const [knownIssueSearchResult, result] = await Promise.all([knownIssuePromise, triagePromise]);

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
  if (result.ok) {
    const triagePreview = buildTriageCardFromAgentOutput(result.fullResponse, baseContext.parseFields);
    triageEventBus?.emit('triage.decision', {
      cardBuilt: Boolean(triagePreview.card),
      severity: triagePreview.card?.severity || '',
      category: triagePreview.card?.category || '',
      confidence: triagePreview.card?.confidence || '',
      validationIssues: Array.isArray(triagePreview.issues) ? triagePreview.issues : [],
    });
  } else {
    triageEventBus?.emit('triage.decision', {
      cardBuilt: false,
      errorCode: result.error?.code || 'TRIAGE_AGENT_FAILED',
    });
  }
  triageEventBus?.emit('stage.completed', {
    status: result.ok ? 'success' : 'failed',
    durationMs: normalizeElapsedMs(result.latencyMs),
    provider: result.providerUsed || policy.primaryProvider,
    model: result.modelUsed || getProviderModelId(result.providerUsed || policy.primaryProvider) || '',
    fallbackUsed: Boolean(result.fallbackUsed),
  });

  if (result.ok) {
    const parsedOutput = buildTriageCardFromAgentOutput(result.fullResponse, baseContext.parseFields);
    if (parsedOutput.card) {
      return {
        ...baseContext,
        knownIssueSearchResult,
        triageCard: annotateTriageGeneration(
          annotateDefaultRuntimeCard(parsedOutput.card, policy),
          {
            source: 'agent',
            latencyMs: result.latencyMs,
            provider: result.providerUsed || policy.primaryProvider,
            model: result.modelUsed || getProviderModelId(result.providerUsed || policy.primaryProvider) || '',
          }
        ),
        triageMeta: buildTriageAgentMeta({
          policy,
          result,
          validation: {
            passed: true,
            issues: [],
            confidence: parsedOutput.card.confidence,
            fieldsFound: 6,
            outputFormat: 'triage-agent-fields',
          },
        }),
        elapsedMs: result.latencyMs,
      };
    }

    const reason = `Triage Agent response did not match the required field format (${parsedOutput.issues.join(', ')}).`;
    await emitStatus?.({
      level: 'warning',
      message: `${reason} Showing rule fallback triage.`,
      code: 'TRIAGE_AGENT_FALLBACK',
      provider: result.providerUsed || policy.primaryProvider,
      model: result.modelUsed || getProviderModelId(result.providerUsed || policy.primaryProvider) || '',
    });
    return {
      ...baseContext,
      knownIssueSearchResult,
      triageCard: annotateTriageGeneration(
        annotateDefaultRuntimeCard(annotateRuleFallbackCard(baseContext.triageCard, reason), policy),
        {
          source: 'server',
          latencyMs: result.latencyMs,
          provider: result.providerUsed || policy.primaryProvider,
          model: result.modelUsed || getProviderModelId(result.providerUsed || policy.primaryProvider) || '',
        }
      ),
      triageMeta: buildTriageAgentMeta({
        policy,
        result,
        validation: {
          passed: false,
          issues: parsedOutput.issues,
          confidence: 'low',
          fieldsFound: 0,
          outputFormat: 'triage-agent-fields',
        },
        fallbackReason: reason,
        fallbackFrom: 'agent-shape',
      }),
      elapsedMs: result.latencyMs,
    };
  }

  const reason = result.error?.message || 'Triage Agent failed before returning a response.';
  await emitStatus?.({
    level: 'warning',
    message: `${reason} Showing rule fallback triage.`,
    code: 'TRIAGE_AGENT_FALLBACK',
    provider: result.providerUsed || policy.primaryProvider,
    model: result.modelUsed || getProviderModelId(result.providerUsed || policy.primaryProvider) || '',
  });
  return {
    ...baseContext,
    knownIssueSearchResult,
    triageCard: annotateTriageGeneration(
      annotateDefaultRuntimeCard(annotateRuleFallbackCard(baseContext.triageCard, reason), policy),
      {
        source: 'server',
        latencyMs: result.latencyMs,
        provider: result.providerUsed || policy.primaryProvider,
        model: result.modelUsed || getProviderModelId(result.providerUsed || policy.primaryProvider) || '',
      }
    ),
    triageMeta: buildTriageAgentMeta({
      policy,
      result,
      validation: {
        passed: false,
        issues: [result.error?.code || 'TRIAGE_AGENT_FAILED'],
        confidence: 'low',
        fieldsFound: 0,
        outputFormat: 'triage-agent-fields',
      },
      fallbackReason: reason,
      fallbackFrom: 'agent-error',
    }),
    elapsedMs: result.latencyMs,
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
  onTriageStart,
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
  triageEventBus,
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
          promptId: imageParserConfig.promptId || 'escalation-template-parser',
        });
        const parserResult = await parseImage(normalizedImages[0], {
          provider: imageParserConfig.provider,
          model: imageParserConfig.model || undefined,
          reasoningEffort: imageParserConfig.reasoningEffort || undefined,
          promptId: imageParserConfig.promptId || 'escalation-template-parser',
          timeoutMs: 45_000,
        });
        imageTranscription = {
          text: safeString(parserResult && parserResult.text, ''),
          usage: parserResult && parserResult.usage ? parserResult.usage : null,
          source: 'image-parser-agent',
          role: parserResult && parserResult.role ? parserResult.role : 'unknown',
          parseMeta: parserResult && parserResult.parseMeta ? parserResult.parseMeta : null,
          providerUsed: imageParserConfig.provider,
          model: safeString(
            (parserResult && parserResult.usage && parserResult.usage.model)
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
    await sendStatus('Running INV Search Agent before triage...');
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
        onTriageStart,
        knownIssueEventBus,
        triageEventBus,
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
        category: imageTriageContext?.triageCard?.category || null,
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
  resolveKnownIssueAgentPolicy,
  resolveTriageAgentPolicy,
  resolveParseMode,
  toParseResponseMeta,
};
