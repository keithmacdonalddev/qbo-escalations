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
const {
  getAlternateProvider,
  getDefaultProvider,
  normalizeProvider,
} = require('./providers/registry');

const DEFAULT_PARALLEL_OPEN_TURN_LIMIT = 8;
const DEFAULT_PROVIDER = getDefaultProvider();
const IMAGE_PARSER_VERBOSE_LOGS = process.env.IMAGE_PARSER_VERBOSE_LOGS === '1';

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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
  const normalizedRequestedPrimaryModel = normalizeModelOverride(requestedPrimaryModel);
  const normalizedRequestedFallbackModel = normalizeModelOverride(requestedFallbackModel);

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

function buildParserDerivedTriageContext({
  parserText,
  parserProvider,
  parserUsage,
  parserModel,
  elapsedMs,
}) {
  const text = safeString(parserText, '').trim();
  const normalizedModel = safeString(
    (parserUsage && parserUsage.model) || parserModel,
    ''
  );

  if (!text) {
    return {
      triageCard: chatTriageModule.buildFallbackTriageCard(),
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
      },
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
  const parsedFields = validation.passed ? validation.normalizedFields : {};
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
      ? chatTriageModule.buildServerTriageCard(parsedFields)
      : chatTriageModule.buildFallbackTriageCard(),
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
    },
    elapsedMs,
    error,
  };
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
  onTriageStart,
  imageParserConfig,
  parsedEscalationText,
  parsedEscalationProvider,
  parsedEscalationModel,
  transcriptionModel,
  effectiveReasoningEffort,
  effectiveTimeoutMs,
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
      elapsedMs: 0,
    };
  }
  if (normalizedImages.length > 0) {
    if (!imageParserConfig?.provider) {
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
      await sendStatus('Parsing image with dedicated image parser...');
      try {
        const { parseImage } = require('./image-parser');
        const parserResult = await parseImage(normalizedImages[0], {
          provider: imageParserConfig.provider,
          model: imageParserConfig.model || undefined,
          timeoutMs: 45_000,
        });
        imageTranscription = {
          text: safeString(parserResult && parserResult.text, ''),
          usage: parserResult && parserResult.usage ? parserResult.usage : null,
          source: 'image-parser-agent',
          role: parserResult && parserResult.role ? parserResult.role : 'unknown',
          providerUsed: imageParserConfig.provider,
          model: safeString(
            (parserResult && parserResult.usage && parserResult.usage.model)
              || imageParserConfig.model,
            ''
          ),
          elapsedMs: Date.now() - parserStartedAt,
        };
        if (imageTranscription.role === 'inv-list') {
          nonEscalationIntent = true;
        }
        if (!safeString(imageTranscription.text, '').trim()) {
          imageTranscription = await runChatImageTranscriptionFallback({
            normalizedImages,
            transcriptionModel,
            effectiveReasoningEffort,
            effectiveTimeoutMs,
            sendStatus,
          });
        }
      } catch (err) {
        parserError = err || null;
        if (IMAGE_PARSER_VERBOSE_LOGS) {
          console.warn('[chat] Dedicated image parser failed; falling back to standard image transcription:', err.message);
        }
        await sendStatus('Image parser failed. Falling back to standard image transcription.');
        imageTranscription = await runChatImageTranscriptionFallback({
          normalizedImages,
          transcriptionModel,
          effectiveReasoningEffort,
          effectiveTimeoutMs,
          sendStatus,
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
    await callOptional(onTriageStart, {
      provider: imageTranscription.providerUsed || imageParserConfig?.provider || DEFAULT_PROVIDER,
      model: imageTranscription.model || imageParserConfig?.model || '',
    });
    await sendStatus(
      normalizedImages.length > 0
        ? 'Deriving escalation fields from image parser output...'
        : 'Deriving escalation fields from parsed screenshot text...'
    );
  }

  const imageTriageContext = shouldRunTriage
    ? buildParserDerivedTriageContext({
        parserText: imageTranscription.text,
        parserProvider: imageTranscription.providerUsed || imageParserConfig?.provider || DEFAULT_PROVIDER,
        parserUsage: imageTranscription.usage || null,
        parserModel: imageTranscription.model || imageParserConfig?.model || '',
        elapsedMs: imageTranscription.elapsedMs || 0,
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

  const triageCategory = imageTriageContext?.triageCard?.category || null;
  const invMatchResult = await runInvMatching({
    message: (imageTranscription && imageTranscription.text) || safeString(messageText, ''),
    parseFields: imageTriageContext?.parseFields || null,
    category: triageCategory,
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
  buildChatImageAugmentation,
  buildParserDerivedTriageContext,
  getChatGenerationValidationError,
  getParallelOpenTurnLimit,
  isParallelModeEnabled,
  isValidMode,
  isValidParseMode,
  normalizeReasoningEffort,
  prepareChatRequest,
  resolveParseMode,
  toParseResponseMeta,
};
