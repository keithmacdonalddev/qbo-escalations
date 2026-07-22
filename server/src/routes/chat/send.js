'use strict';

const express = require('express');
const { randomUUID } = require('node:crypto');
const Conversation = require('../../models/Conversation');
const ParallelCandidateTurn = require('../../models/ParallelCandidateTurn');
const { normalizeChatRuntimeSettings } = require('../../lib/chat-settings');
const { normalizeChatImages } = require('../../lib/chat-image');
const { applyImageResponseCompliance } = require('../../lib/chat-triage');
const { createRateLimiter } = require('../../middleware/rate-limit');
const { isValidProvider, normalizeProvider } = require('../../services/providers/registry');
const { normalizeModelOverride, startChatOrchestration } = require('../../services/chat-orchestrator');
const { runAgentToolLoop } = require('../../services/agent-tool-loop');
const { SHARED_AGENT_TOOL_LINES } = require('../../services/shared-agent-tools');
const {
  createAiOperation,
  updateAiOperation,
  recordAiChunk,
  recordAiEvent,
  attachAiOperationController,
  deleteAiOperation,
} = require('../../services/ai-runtime');
const { reportServerError } = require('../../lib/server-error-pipeline');
const { getProviderModelId } = require('../../services/providers/catalog');
const {
  createTrace,
  patchTrace,
  appendTraceEvent,
  setTraceAttempts,
  setTraceUsage,
  buildParseStage,
  buildOutcome,
  summarizeUsage,
} = require('../../services/ai-traces');
const { archiveImages } = require('../../lib/image-archive');
const { extractQuickActions } = require('../../lib/quick-actions');
const {
  buildCommunityProfilesContext,
  buildIdentityMemoryContext,
  buildRelationshipCoordinationContext,
  getAgentIdentity,
  learnFromInteraction,
  listAgentIdentities,
  recordAgentActivity,
  recordAgentToolUsage,
} = require('../../services/agent-identity-service');
const { buildAgentIdentityOverlay } = require('../../services/room-agents/agent-profiles');
const {
  buildChatImageAugmentation,
  getChatGenerationValidationError,
  getParallelOpenTurnLimit,
  isParallelModeEnabled,
  prepareChatRequest,
  resolveAnalystFailoverPolicy,
} = require('../../services/chat-request-service');
const {
  appendCaseIntakeFollowUp,
  applyStageEventsToCaseIntake,
  buildCaseIntakeFromParsedEscalation,
  completeCaseIntakeAnalystRun,
  failCaseIntakeAnalystRun,
  normalizePipelineReceipts,
  stampCaseIntakeEvidence,
} = require('../../lib/case-intake');
const { isProviderCallPackageCaptureEnabled } = require('../../services/provider-call-package-recorder');
const { createStageEventBus } = require('../../lib/stage-events');
const { createLinkedEscalationFromConversation } = require('../../lib/escalation-dedup');
const { triggerKnowledgeDraftForEscalation } = require('../../services/knowledgebase-draft-trigger');
const {
  buildContextDebugPayload,
  deriveFallbackReasonCode,
  ensureMessagesArray,
  getProviderThinking,
  logChatTurn,
  normalizeMessageForModel,
  normalizeProviderThinking,
  saveConversationLenient,
  toCandidateFromResult,
} = require('./shared');
const {
  buildTraceStats,
  buildUsageSubdoc,
  isValidObjectId,
  logAttemptsUsage,
  safeString,
  sumResponseChars,
} = require('../../lib/chat-route-helpers');

const chatRouter = express.Router();
const chatRateLimit = createRateLimiter({ name: 'chat', limit: 20, windowMs: 60_000 });
const retryRateLimit = createRateLimiter({ name: 'chat-retry', limit: 12, windowMs: 60_000 });
const rawSseSafetyTimeoutMs = Number.parseInt(process.env.SSE_SAFETY_TIMEOUT_MS, 10);
const SSE_SAFETY_TIMEOUT_MS = Number.isFinite(rawSseSafetyTimeoutMs) && rawSseSafetyTimeoutMs > 0
  ? rawSseSafetyTimeoutMs
  : 180_000;
const MAIN_CHAT_TOOL_AGENT_ID = 'main-chat-assistant';
const CHAT_ACTIVITY_AGENT_ID = 'chat';
// The image-parser leg of chat is owned by the `image-analyst` AgentIdentity
// (see AGENT_RUNTIME_DEFINITIONS: id `image-parser` maps to agentId
// `image-analyst`). Its persisted profile runtime carries the operator's
// configured backup.
const IMAGE_PARSER_AGENT_ID = 'image-analyst';

async function persistRetryAnalystFailure(conversation, {
  provider,
  model,
  traceId,
  requestId,
  packageCaptureEnabled,
  errorCode,
  errorMessage,
  directUpdate = false,
} = {}) {
  if (!conversation.caseIntake || conversation.caseIntake.status === 'none') return;
  const completedAt = new Date();
  conversation.caseIntake = failCaseIntakeAnalystRun(conversation.caseIntake, {
    provider,
    model,
    traceId,
    error: { code: errorCode, message: errorMessage },
    evidenceReceipt: {
      attempted: true,
      completed: false,
      failed: true,
      messageSaved: false,
      thinkingCaptured: false,
      traceId: safeString(traceId, ''),
      requestId,
      provider,
      packageCaptureEnabled,
      errorCode,
      completedAt,
      reportedVia: 'server',
    },
    completedAt,
  });
  conversation.markModified?.('caseIntake');
  if (directUpdate) {
    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: { caseIntake: conversation.caseIntake } }
    ).catch(() => {});
    return;
  }
  await saveConversationLenient(conversation).catch(() => {});
}

// Resolve the operator's CONFIGURED image-parser backup from the `image-analyst`
// profile runtime so the chat image-parse leg fails over to it (not just the
// neutral global alternate) when the primary provider fails. No client sends the
// image-parser fallback, so the server reads the profile directly. Returns empty
// strings when nothing is configured, preserving parseImage's neutral default.
async function resolveImageParserProfileBackup() {
  const identity = await getAgentIdentity(IMAGE_PARSER_AGENT_ID).catch(() => null);
  const runtime = identity && identity.runtime && typeof identity.runtime === 'object'
    ? identity.runtime
    : null;
  return {
    fallbackProvider: safeString(runtime?.fallbackProvider, ''),
    fallbackModel: safeString(runtime?.fallbackModel, ''),
  };
}

function recordCaseIntakeWorkflowActivities(caseIntake, { conversationId, traceId } = {}) {
  const runs = Array.isArray(caseIntake?.runs) ? caseIntake.runs : [];
  const parserRun = runs.find((run) => run?.phase === 'parse-template');
  const knownIssueRun = runs.find((run) => run?.phase === 'known-issue-search');
  const triageRun = runs.find((run) => run?.phase === 'triage');

  if (parserRun) {
    recordAgentActivity('escalation-template-parser', {
      type: 'case-intake',
      phase: 'parse-template',
      status: parserRun.status || 'completed',
      summary: parserRun.summary || 'Escalation template parser captured a canonical template.',
      detail: {
        provider: parserRun.provider || '',
        model: parserRun.model || '',
        durationMs: Number.isFinite(Number(parserRun.durationMs)) ? Number(parserRun.durationMs) : null,
        fallbackUsed: Boolean(parserRun.fallbackUsed),
        fallbackFrom: parserRun.fallbackFrom || '',
        traceId: parserRun.traceId || traceId || '',
      },
      conversationId,
      metadata: { traceId: parserRun.traceId || traceId || '' },
    }, { surface: 'chat', conversationId }).catch(() => {});
  }

  if (knownIssueRun) {
    recordAgentActivity('known-issue-search-agent', {
      type: 'case-intake',
      phase: 'known-issue-search',
      status: knownIssueRun.status || 'completed',
      summary: knownIssueRun.summary || 'INV Search Agent checked active investigations.',
      detail: {
        provider: knownIssueRun.provider || '',
        model: knownIssueRun.model || '',
        durationMs: Number.isFinite(Number(knownIssueRun.durationMs)) ? Number(knownIssueRun.durationMs) : null,
        fallbackUsed: Boolean(knownIssueRun.fallbackUsed),
        fallbackFrom: knownIssueRun.fallbackFrom || '',
        traceId: knownIssueRun.traceId || traceId || '',
        resultStatus: knownIssueRun.detail?.status || '',
      },
      conversationId,
      metadata: { traceId: knownIssueRun.traceId || traceId || '' },
    }, { surface: 'chat', conversationId }).catch(() => {});
  }

  if (triageRun) {
    recordAgentActivity('triage-agent', {
      type: 'case-intake',
      phase: 'triage',
      status: triageRun.status || 'completed',
      summary: triageRun.summary || 'Triage agent prepared a first-pass case card.',
      detail: {
        provider: triageRun.provider || '',
        model: triageRun.model || '',
        durationMs: Number.isFinite(Number(triageRun.durationMs)) ? Number(triageRun.durationMs) : null,
        fallbackUsed: Boolean(triageRun.fallbackUsed || triageRun.detail?.fallback?.used),
        fallbackFrom: triageRun.fallbackFrom || '',
        usedDefaultRuntime: Boolean(triageRun.detail?.runtime?.usedDefault),
        traceId: triageRun.traceId || traceId || '',
      },
      conversationId,
      metadata: { traceId: triageRun.traceId || traceId || '' },
    }, { surface: 'chat', conversationId }).catch(() => {});
  }
}

function recordFollowUpParserActivity(followUp, { conversationId, traceId } = {}) {
  if (!followUp?.transcript) return;
  recordAgentActivity('follow-up-chat-parser', {
    type: 'case-intake',
    phase: 'follow-up-context',
    status: 'ok',
    summary: 'Parsed phone-agent follow-up chat context.',
    detail: {
      parserProvider: followUp.parserProvider || '',
      parserModel: followUp.parserModel || '',
      transcriptChars: followUp.transcript.length,
      traceId: followUp.traceId || traceId || '',
    },
    conversationId,
    metadata: { traceId: followUp.traceId || traceId || '' },
  }, { surface: 'chat', conversationId }).catch(() => {});
}

async function buildMainChatSystemPrompt(basePrompt, enableTools) {
  const normalizedBase = safeString(basePrompt, '');
  const identity = await getAgentIdentity('chat').catch(() => null);
  const identities = await listAgentIdentities().catch(() => []);
  return [
    normalizedBase,
    buildAgentIdentityOverlay(identity?.profile || 'chat'),
    buildIdentityMemoryContext(identity),
    buildRelationshipCoordinationContext(identity, identities.map((item) => item.agentId).filter((id) => id !== 'chat')),
    buildCommunityProfilesContext('chat', identities),
    enableTools ? SHARED_AGENT_TOOL_LINES : '',
  ].filter(Boolean).join('\n\n');
}

// Evidence identity for the main-chat ProviderCallPackages: which conversation
// (and, when parsed, which case/escalation) this provider call belongs to.
// Without this stamp, chat packages are only matchable to conversations by
// timestamp.
function buildConversationCaptureMetadata(conversation) {
  const caseNumber = safeString(conversation?.caseIntake?.parseFields?.caseNumber, '').trim();
  return {
    agentId: CHAT_ACTIVITY_AGENT_ID,
    conversationId: conversation?._id ? conversation._id.toString() : '',
    ...(caseNumber ? { caseNumber } : {}),
    ...(conversation?.escalationId ? { escalationId: String(conversation.escalationId) } : {}),
  };
}

function startMainChatExecution({
  useAgentTools,
  policy,
  messages,
  systemPrompt,
  reasoningEffort,
  timeoutMs,
  // Evidence identity (conversationId/caseNumber/...) stamped onto every
  // captured ProviderCallPackage this turn produces, on both execution paths.
  captureMetadata = null,
  onChunk,
  onThinkingChunk,
  onProviderError,
  onFallback,
  onDone,
  onError,
  onStatus,
}) {
  if (!useAgentTools) {
    return startChatOrchestration({
      mode: policy.mode,
      primaryProvider: policy.primaryProvider,
      primaryModel: policy.primaryModel,
      fallbackProvider: policy.fallbackProvider,
      fallbackModel: policy.fallbackModel,
      parallelProviders: policy.parallelProviders || undefined,
      autoFailover: policy.autoFailover === true,
      messages,
      systemPrompt,
      images: [],
      reasoningEffort,
      timeoutMs,
      captureMetadata,
      onChunk,
      onThinkingChunk,
      onProviderError,
      onFallback,
      onDone,
      onError,
    });
  }

  let cancelled = false;
  let abortToolLoop = null;
  Promise.resolve().then(async () => {
    onStatus?.({
      type: 'tool_ready',
      message: 'Assistant tools enabled. Inspecting before answering when needed.',
    });
    const handleToolLoopStatus = (status) => {
      onStatus?.(status);
      if (status?.type === 'provider_error') {
        onProviderError?.(status);
      } else if (status?.type === 'fallback') {
        onFallback?.(status);
      }
    };
    const result = await runAgentToolLoop({
      agent: {
        id: MAIN_CHAT_TOOL_AGENT_ID,
        preferredProvider: policy.primaryProvider,
      },
      systemPrompt,
      messagesForModel: messages,
      timeoutMs,
      captureMetadata,
      runtimePolicy: {
        mode: policy.mode,
        primaryProvider: policy.primaryProvider,
        primaryModel: policy.primaryModel,
        fallbackProvider: policy.fallbackProvider,
        fallbackModel: policy.fallbackModel,
        autoFailover: policy.autoFailover === true,
        reasoningEffort,
      },
      onChunk,
      onThinkingChunk,
      onStatus: handleToolLoopStatus,
      onActions: ({ results }) => {
        const count = Array.isArray(results) ? results.length : 0;
        handleToolLoopStatus({
          type: 'tool_actions',
          message: `Completed ${count} tool action${count === 1 ? '' : 's'}.`,
        });
      },
      isCancelled: () => cancelled,
      registerAbort: (abortFn) => {
        abortToolLoop = typeof abortFn === 'function' ? abortFn : null;
      },
    });
    if (cancelled) return;
    await onDone({
      fullResponse: result.fullResponse,
      usage: result.usage || null,
      providerUsed: result.providerUsed || policy.primaryProvider,
      modelUsed: result.modelUsed || null,
      mode: policy.mode,
      fallbackUsed: Boolean(result.fallbackUsed),
      fallbackFrom: result.fallbackFrom || null,
      attempts: Array.isArray(result.attempts) ? result.attempts : [],
      thinking: result.thinking || '',
      providerThinking: result.providerThinking || {},
      toolActions: result.actions || [],
      toolIterations: result.iterations || 0,
    });
  }).catch((err) => {
    if (cancelled || err?.code === 'ABORTED') return;
    onError?.(err);
  });

  return () => {
    cancelled = true;
    if (abortToolLoop) {
      try { abortToolLoop('Main chat request aborted'); } catch { /* ignore */ }
      abortToolLoop = null;
    }
  };
}

function resolveRequestedModel(providerId, modelOverride) {
  return normalizeModelOverride(modelOverride) || getProviderModelId(providerId);
}

chatRouter.post('/', chatRateLimit, async (req, res) => {
  const {
    conversationId,
    message,
    images: requestedImages,
    imageMeta: clientImageMeta,
    provider, // backward-compat alias for primaryProvider
    mode,
    primaryProvider,
    primaryModel,
    fallbackProvider,
    fallbackModel,
    parallelProviders,
    parsedEscalationText,
    parsedEscalationSource,
    parsedEscalationProvider,
    parsedEscalationModel,
    parsedEscalationElapsedMs,
    pipelineReceipts,
    followUpContextText,
    followUpContextSource,
    followUpContextProvider,
    followUpContextModel,
    agentRuntime,
    timeoutMs,
    settings: rawSettings,
  } = req.body || {};
  const normalizedPipelineReceipts = normalizePipelineReceipts(pipelineReceipts);
  const packageCaptureEnabled = isProviderCallPackageCaptureEnabled();
  const reasoningEffort = req.body?.reasoningEffort;
  const runtimeSettings = normalizeChatRuntimeSettings(rawSettings);
  const normalizedImagesResult = normalizeChatImages(requestedImages);
  const normalizedImages = normalizedImagesResult.ok ? normalizedImagesResult.images : [];
  const normalizedClientImageMeta = Array.isArray(clientImageMeta) ? clientImageMeta : [];

  if (!normalizedImagesResult.ok) {
    return res.status(400).json({
      ok: false,
      code: normalizedImagesResult.code,
      error: normalizedImagesResult.error,
    });
  }
  if (normalizedImages.length > 0) {
    return res.status(400).json({
      ok: false,
      code: 'CHAT_IMAGES_DISABLED',
      error: 'Main chat accepts text only. Use the Image Parser to convert screenshots or webcam captures into text first.',
    });
  }
  if (!message && normalizedImages.length === 0) {
    return res.status(400).json({ ok: false, code: 'MISSING_INPUT', error: 'Message required' });
  }
  if (conversationId !== undefined && conversationId !== null && conversationId !== '' && !isValidObjectId(conversationId)) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_CONVERSATION_ID',
      error: 'conversationId must be a valid ObjectId',
    });
  }
  if (primaryModel !== undefined && typeof primaryModel !== 'string') {
    return res.status(400).json({ ok: false, code: 'INVALID_MODEL', error: 'primaryModel must be a string' });
  }
  if (fallbackModel !== undefined && typeof fallbackModel !== 'string') {
    return res.status(400).json({ ok: false, code: 'INVALID_MODEL', error: 'fallbackModel must be a string' });
  }
  const generationValidationError = getChatGenerationValidationError({
    provider,
    primaryProvider,
    fallbackProvider,
    mode,
    parallelProviders,
    isValidProvider,
  });
  if (generationValidationError) {
    return res.status(generationValidationError.status).json(generationValidationError.body);
  }
  // Get or create conversation
  let conversation;
  let isNewConversation = false;
  if (conversationId) {
    conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
    }
  } else {
    conversation = new Conversation({
      title: message ? message.slice(0, 80) : 'Screenshot Analysis — ' + new Date().toLocaleDateString(),
      messages: [],
      provider: normalizeProvider(provider || runtimeSettings.providerStrategy.defaultPrimaryProvider),
    });
    await conversation.save();
    isNewConversation = true;
  }

  ensureMessagesArray(conversation);

  const userMsg = {
    role: 'user',
    content: message || '(image attached)',
    images: normalizedImages,
    imageMeta: normalizedClientImageMeta,
    traceRequestId: req.requestId,
    timestamp: new Date(),
  };

  const pendingMessagesForContext = [...conversation.messages, userMsg].map((m) => normalizeMessageForModel(m));
  const {
    contextBundle,
    effectiveReasoningEffort,
    effectiveTimeoutMs,
    guardrail,
    policy: resolvedPolicy,
    policyError,
    requestedFallback,
    requestedFallbackModel,
    requestedMode,
    requestedPrimaryModel,
    requestedPrimaryProvider,
  } = await prepareChatRequest({
    conversationProvider: conversation.provider,
    requestedProvider: provider,
    requestedPrimaryProvider: primaryProvider,
    requestedPrimaryModel: primaryModel,
    requestedFallbackProvider: fallbackProvider,
    requestedFallbackModel: fallbackModel,
    requestedParallelProviders: parallelProviders,
    requestedMode: mode,
    timeoutMs,
    runtimeSettings,
    reasoningEffort,
    normalizedMessages: pendingMessagesForContext,
  });
  if (policyError) {
    return res.status(policyError.status).json(policyError.body);
  }
  // Layer the QBO Assistant (AgentIdentity 'chat') per-agent runtime onto the
  // resolved policy so the analyst leg fails over to its profile-configured
  // backup when the primary provider crashes — even in single mode. The
  // profile is the single source of truth for provider/model selection.
  const analystIdentity = await getAgentIdentity('chat').catch(() => null);
  const policy = resolveAnalystFailoverPolicy(resolvedPolicy, analystIdentity?.runtime || null);
  const primaryTraceModel = resolveRequestedModel(policy.primaryProvider, policy.primaryModel);
  const fallbackTraceModel = resolveRequestedModel(policy.fallbackProvider, policy.fallbackModel);

  const traceStartedAt = new Date();
  const trace = await createTrace({
    requestId: req.requestId,
    service: 'chat',
    route: '/api/chat',
    turnKind: 'send',
    conversationId: conversation._id,
    promptPreview: safeString(message || userMsg.content, ''),
    messageLength: safeString(message || userMsg.content, '').length,
    normalizedImages,
    clientImageMeta: normalizedClientImageMeta,
    requested: {
      mode: requestedMode,
      reasoningEffort: effectiveReasoningEffort,
      timeoutMs: effectiveTimeoutMs,
      primaryProvider: requestedPrimaryProvider,
      primaryModel: requestedPrimaryModel,
      fallbackProvider: requestedFallback,
      fallbackModel: requestedFallbackModel,
      parallelProviders: parallelProviders || [],
    },
    resolved: {
      mode: policy.mode,
      reasoningEffort: effectiveReasoningEffort,
      timeoutMs: effectiveTimeoutMs,
      primaryProvider: policy.primaryProvider,
      primaryModel: policy.primaryModel,
      fallbackProvider: policy.fallbackProvider,
      fallbackModel: policy.fallbackModel,
      parallelProviders: policy.parallelProviders || [],
    },
  }).catch(() => null);
  await appendTraceEvent(trace?._id, {
    key: 'request_received',
    label: 'Request received',
    status: 'info',
    provider: policy.primaryProvider,
    model: primaryTraceModel,
    message: `Chat request queued for ${policy.primaryProvider}.`,
  }, traceStartedAt);
  await appendTraceEvent(trace?._id, {
    key: 'context_built',
    label: 'Context built',
    status: 'info',
    message: `Prepared ${contextBundle.messagesForModel.length} message(s) for the model.`,
    detail: {
      knowledgeMode: contextBundle.contextDebug?.knowledgeMode || '',
      estimatedInputTokens: contextBundle.contextDebug?.budgets?.estimatedInputTokens || 0,
    },
  }, traceStartedAt);

  if (guardrail.blocked) {
    await appendTraceEvent(trace?._id, {
      key: 'guardrail_blocked',
      label: 'Budget guardrail blocked request',
      status: 'error',
      code: guardrail.blockCode || 'BUDGET_GUARDRAIL_BLOCKED',
      message: guardrail.blockError || 'Budget guardrail blocked request',
      detail: guardrail.costEstimate || null,
    }, traceStartedAt);
    await patchTrace(trace?._id, {
      status: 'error',
      outcome: buildOutcome({
        providerUsed: policy.primaryProvider,
        modelUsed: primaryTraceModel,
        totalMs: Date.now() - traceStartedAt.getTime(),
        completedAt: new Date(),
        errorCode: guardrail.blockCode || 'BUDGET_GUARDRAIL_BLOCKED',
        errorMessage: guardrail.blockError || 'Budget guardrail blocked request',
      }),
    });
    if (isNewConversation && conversation.messages.length === 0) {
      await Conversation.findByIdAndDelete(conversation._id).catch(() => {});
    }
    return res.status(429).json({
      ok: false,
      code: guardrail.blockCode || 'BUDGET_GUARDRAIL_BLOCKED',
      error: guardrail.blockError || 'Budget guardrail blocked request',
      warnings: guardrail.warnings,
      costEstimate: guardrail.costEstimate,
    });
  }

  if (policy.mode === 'parallel') {
    if (!isParallelModeEnabled()) {
      await appendTraceEvent(trace?._id, {
        key: 'parallel_disabled',
        label: 'Parallel mode disabled',
        status: 'error',
        code: 'PARALLEL_MODE_DISABLED',
        message: 'Parallel mode is disabled',
      }, traceStartedAt);
      await patchTrace(trace?._id, {
        status: 'error',
        outcome: buildOutcome({
          providerUsed: policy.primaryProvider,
          modelUsed: primaryTraceModel,
          totalMs: Date.now() - traceStartedAt.getTime(),
          completedAt: new Date(),
          errorCode: 'PARALLEL_MODE_DISABLED',
          errorMessage: 'Parallel mode is disabled',
        }),
      });
      if (isNewConversation && conversation.messages.length === 0) {
        await Conversation.findByIdAndDelete(conversation._id).catch(() => {});
      }
      return res.status(409).json({
        ok: false,
        code: 'PARALLEL_MODE_DISABLED',
        error: 'Parallel mode is disabled',
      });
    }
    const openTurnLimit = getParallelOpenTurnLimit();
    const openTurnCount = await ParallelCandidateTurn.countDocuments({ service: 'chat', status: 'open' });
    if (openTurnCount >= openTurnLimit) {
      await appendTraceEvent(trace?._id, {
        key: 'parallel_limit',
        label: 'Parallel turn limit reached',
        status: 'error',
        code: 'PARALLEL_TURN_LIMIT',
        message: `Parallel open-turn limit reached (${openTurnLimit})`,
      }, traceStartedAt);
      await patchTrace(trace?._id, {
        status: 'error',
        outcome: buildOutcome({
          providerUsed: policy.primaryProvider,
          modelUsed: primaryTraceModel,
          totalMs: Date.now() - traceStartedAt.getTime(),
          completedAt: new Date(),
          errorCode: 'PARALLEL_TURN_LIMIT',
          errorMessage: `Parallel open-turn limit reached (${openTurnLimit})`,
        }),
      });
      if (isNewConversation && conversation.messages.length === 0) {
        await Conversation.findByIdAndDelete(conversation._id).catch(() => {});
      }
      return res.status(429).json({
        ok: false,
        code: 'PARALLEL_TURN_LIMIT',
        error: `Parallel open-turn limit reached (${openTurnLimit})`,
      });
    }
  }

  // Set up SSE headers IMMEDIATELY so the client knows the connection is alive
  // before the potentially slow triage parse begins.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendStageEvent = (eventName, payload) => {
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch { /* client disconnected */ }
  };
  const parserEventBus = createStageEventBus({ send: sendStageEvent, stageId: 'parser' });
  const knownIssueEventBus = createStageEventBus({ send: sendStageEvent, stageId: 'inv' });
  const mainEventBus = createStageEventBus({ send: sendStageEvent, stageId: 'main' });

  // Only read the image-parser profile when an image is actually being parsed.
  const imageParserBackup = req.body.imageParserProvider
    ? await resolveImageParserProfileBackup()
    : { fallbackProvider: '', fallbackModel: '' };

  const {
    effectiveSystemPrompt,
    imageTranscription,
    imageTriageContext,
    invMatchResult,
    nonEscalationIntent,
  } = await buildChatImageAugmentation({
    normalizedImages,
    messageText: message || '',
    baseSystemPrompt: contextBundle.systemPrompt,
    parserEventBus,
    knownIssueEventBus,
    emitStatus: async (statusMessage) => {
      try {
        const payload = statusMessage && typeof statusMessage === 'object'
          ? { type: 'status', ...statusMessage }
          : { type: 'status', message: statusMessage };
        res.write('event: status\ndata: ' + JSON.stringify(payload) + '\n\n');
      } catch { /* client disconnected */ }
    },
    onTranscriptionStart: async (stageMeta) => {
      const traceProvider = safeString(stageMeta?.provider, policy.primaryProvider);
      const traceModel = safeString(stageMeta?.model, '') || getProviderModelId(traceProvider);
      await appendTraceEvent(trace?._id, {
        key: 'transcription_started',
        label: 'Image transcription started',
        status: 'info',
        provider: traceProvider,
        model: traceModel,
        message: 'Running dedicated image parser transcription.',
      }, traceStartedAt);
    },
    onTranscriptionComplete: async (transcription) => {
      const traceProvider = safeString(transcription?.providerUsed, policy.primaryProvider);
      const traceModel = safeString(transcription?.model, '') || getProviderModelId(traceProvider);
      await appendTraceEvent(trace?._id, {
        key: transcription ? 'transcription_completed' : 'transcription_failed',
        label: transcription ? 'Image transcription completed' : 'Image transcription failed',
        status: transcription ? 'success' : 'warning',
        provider: traceProvider,
        model: traceModel,
        message: transcription
          ? `Image transcribed in ${transcription.elapsedMs || 0}ms (${(transcription.text || '').length} chars).`
          : 'Image transcription failed — chat continued without screenshot parsing.',
      }, traceStartedAt);
    },
    onKnownIssueStart: async (stageMeta) => {
      const traceProvider = safeString(stageMeta?.provider, policy.primaryProvider);
      const traceModel = safeString(stageMeta?.model, '') || getProviderModelId(traceProvider);
      await appendTraceEvent(trace?._id, {
        key: 'known_issue_search_started',
        label: 'INV Search Agent started',
        status: 'info',
        provider: traceProvider,
        model: traceModel,
        message: 'Searching active INV investigations before triage.',
      }, traceStartedAt);
    },
    imageParserConfig: req.body.imageParserProvider
      ? {
          provider: req.body.imageParserProvider,
          model: req.body.imageParserModel || undefined,
          reasoningEffort: req.body.imageParserReasoningEffort || undefined,
          serviceTier: req.body.imageParserServiceTier || undefined,
          promptId: req.body.imageParserPromptId || 'escalation-template-parser',
          // Wave 2 universal failover: carry the image-parser agent's backup so
          // the chat image-parse leg fails over BEFORE the generic-transcription
          // last resort. An explicit request fallback wins; otherwise the
          // image-analyst profile's CONFIGURED backup is used (resolved
          // server-side — no client sends it). parseImage still defaults to the
          // neutral global alternate when neither is set. No capability filtering.
          fallbackProvider: req.body.imageParserFallbackProvider || imageParserBackup.fallbackProvider || '',
          fallbackModel: req.body.imageParserFallbackModel || imageParserBackup.fallbackModel || '',
          agentRuntime,
        }
      : null,
    parsedEscalationText: safeString(parsedEscalationSource, '') === 'image-parser'
      ? safeString(parsedEscalationText, '')
      : '',
    parsedEscalationProvider: parsedEscalationProvider || policy.primaryProvider,
    parsedEscalationModel: parsedEscalationModel || '',
    parsedEscalationElapsedMs,
    triageAgentRuntime: agentRuntime,
    fallbackPolicy: policy,
  });
  const parsedEscalationCanonicalText = safeString(parsedEscalationSource, '') === 'image-parser'
    ? safeString(parsedEscalationText, '')
    : '';
  const followUpTranscript = safeString(followUpContextSource, '') === 'follow-up-chat-parser'
    ? safeString(followUpContextText, '')
    : '';
  if (parsedEscalationCanonicalText || imageTriageContext) {
    conversation.caseIntake = buildCaseIntakeFromParsedEscalation({
      existing: conversation.caseIntake,
      sourceText: parsedEscalationCanonicalText,
      imageTriageContext,
      parserProvider: parsedEscalationProvider || 'image-parser',
      parserModel: parsedEscalationModel || '',
      analystProvider: policy.primaryProvider,
      analystModel: policy.primaryModel || primaryTraceModel,
      traceId: trace ? trace._id.toString() : null,
      startedAt: traceStartedAt,
    });
    // Persist the buffered stage events from the parser / INV legs
    // onto the matching runs in caseIntake.runs[]. The popout reads these
    // events when the live SSE channel has already closed.
    conversation.caseIntake = applyStageEventsToCaseIntake(conversation.caseIntake, 'parser', parserEventBus.flush());
    conversation.caseIntake = applyStageEventsToCaseIntake(conversation.caseIntake, 'inv', knownIssueEventBus.flush());
    const parserRun = conversation.caseIntake.runs.find((run) => run?.phase === 'parse-template');
    const invRun = conversation.caseIntake.runs.find((run) => run?.phase === 'known-issue-search');
    const invSkipCode = imageTriageContext?.error?.code
      || (nonEscalationIntent ? 'NOT_APPLICABLE' : 'PARSE_VALIDATION_FAILED');
    const invSkipReason = imageTriageContext?.error?.message
      || (nonEscalationIntent
        ? 'Known-issue search did not apply to this non-escalation request.'
        : 'Parsed escalation validation did not pass, so known-issue search was skipped.');
    conversation.caseIntake = stampCaseIntakeEvidence(conversation.caseIntake, {
      parser: {
        ...(normalizedPipelineReceipts.parser || {}),
        attempted: true,
        completed: parserRun?.status === 'completed',
        failed: parserRun?.status === 'failed',
        contentProduced: Boolean(parsedEscalationCanonicalText),
        canonicalTemplateSaved: Boolean(conversation.caseIntake.canonicalTemplate),
        parsedFieldsSaved: Boolean(
          conversation.caseIntake.parseFields
          && Object.keys(conversation.caseIntake.parseFields).length > 0
        ),
        provider: parserRun?.provider || parsedEscalationProvider || '',
        packageCaptureEnabled,
        reportedVia: normalizedPipelineReceipts.parser ? 'client-and-server' : 'server',
      },
      inv: invRun
        ? {
            attempted: true,
            completed: invRun.status === 'completed',
            failed: invRun.status === 'failed',
            resultSaved: Boolean(conversation.caseIntake.knownIssueSearchResult),
            provider: invRun.provider || '',
            packageCaptureEnabled,
            reportedVia: 'server',
          }
        : {
            attempted: false,
            skipped: true,
            skipReason: invSkipCode,
            skipExplanation: invSkipReason,
            packageCaptureEnabled,
            reportedVia: 'server',
          },
      triage: normalizedPipelineReceipts.triage
        ? {
            ...normalizedPipelineReceipts.triage,
            packageCaptureEnabled,
          }
        : imageTriageContext?.parseFields && Object.keys(imageTriageContext.parseFields).length > 0
          ? {
              planned: true,
              packageCaptureEnabled,
              reportedVia: 'server-inferred',
            }
          : {
              planned: false,
              attempted: false,
              skipped: true,
              skipReason: invSkipCode,
              packageCaptureEnabled,
              reportedVia: 'server-inferred',
            },
    }, { updatedAt: traceStartedAt });
    conversation.markModified?.('caseIntake');
    recordCaseIntakeWorkflowActivities(conversation.caseIntake, {
      conversationId: conversation._id ? conversation._id.toString() : '',
      traceId: trace ? trace._id.toString() : '',
    });
  }
  if (followUpTranscript) {
    conversation.caseIntake = appendCaseIntakeFollowUp(conversation.caseIntake, {
      transcript: followUpTranscript,
      parserProvider: followUpContextProvider || 'follow-up-chat-parser',
      parserModel: followUpContextModel || '',
      traceId: trace ? trace._id.toString() : null,
      createdAt: traceStartedAt,
    });
    conversation.markModified?.('caseIntake');
    const latestFollowUp = Array.isArray(conversation.caseIntake?.followUps)
      ? conversation.caseIntake.followUps[conversation.caseIntake.followUps.length - 1]
      : null;
    recordFollowUpParserActivity(latestFollowUp, {
      conversationId: conversation._id ? conversation._id.toString() : '',
      traceId: trace ? trace._id.toString() : '',
    });
  }
  const useSharedAgentTools = policy.mode !== 'parallel' && !runtimeSettings.debug.disableSharedAgentTools;
  const orchestrationSystemPrompt = await buildMainChatSystemPrompt(effectiveSystemPrompt, useSharedAgentTools);
  if (invMatchResult.matches.length > 0) {
    await appendTraceEvent(trace?._id, {
      key: 'inv_match_completed',
      label: 'INV matching completed',
      status: 'success',
      message: `${invMatchResult.matches.length} known issue(s) matched.`,
    }, traceStartedAt);
  } else if (imageTriageContext?.knownIssueSearchResult) {
    await appendTraceEvent(trace?._id, {
      key: 'known_issue_search_completed',
      label: 'INV Search Agent completed',
      status: imageTriageContext.knownIssueSearchResult.ok ? 'success' : 'warning',
      message: imageTriageContext.knownIssueSearchResult.summary || 'Known issue search completed without a matched INV.',
      detail: imageTriageContext.knownIssueSearchResult.validation || null,
    }, traceStartedAt);
  }

  if (conversation.provider !== policy.primaryProvider) {
    conversation.provider = policy.primaryProvider;
  }

  // Save user message once context/guardrails are resolved.
  conversation.messages.push(userMsg);
  await learnFromInteraction(userMsg, { surface: 'chat' }).catch(() => {});
  await recordAgentActivity(CHAT_ACTIVITY_AGENT_ID, {
    type: 'message',
    phase: 'user-input',
    status: 'received',
    summary: 'Main chat received a new user message.',
    detail: userMsg.content,
    metadata: {
      conversationId: conversation._id.toString(),
    },
  }, {
    surface: 'chat',
    conversationId: conversation._id.toString(),
  }).catch(() => {});
  await saveConversationLenient(conversation);
  await appendTraceEvent(trace?._id, {
    key: 'user_message_saved',
    label: 'User message saved',
    status: 'info',
    message: 'Conversation state persisted before streaming started.',
  }, traceStartedAt);
  const requestTurnId = policy.mode === 'parallel' ? randomUUID() : null;

  if (requestTurnId) {
    try {
      const candidateProviders = policy.parallelProviders || [policy.primaryProvider, policy.fallbackProvider];
      await ParallelCandidateTurn.create({
        turnId: requestTurnId,
        service: 'chat',
        conversationId: conversation._id,
        status: 'open',
        requestedProviders: candidateProviders,
        candidates: candidateProviders
          .map((p) => ({ provider: p, state: 'ok', content: '' }))
          .filter((c, index, arr) => arr.findIndex((x) => x.provider === c.provider) === index),
      });
    } catch {
      // non-blocking for chat flow
    }
  }

  const contextDebugPayload = buildContextDebugPayload(runtimeSettings, contextBundle.contextDebug, guardrail.costEstimate);
  let responseClosed = false;
  let streamSettled = false;
  let runtimeOperationId = null;
  let heartbeat = null;
  let sseSafetyTimeout = null;
  let cleanupFn = null;

  // Clean up on client disconnect. Attach this before any SSE writes so fast
  // disconnects cannot miss the close event and leave timers alive.
  res.on('close', () => {
    responseClosed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (sseSafetyTimeout) clearTimeout(sseSafetyTimeout);
    if (!streamSettled) {
      if (runtimeOperationId) {
        updateAiOperation(runtimeOperationId, {
          clientConnected: false,
          phase: 'aborting',
        });
      }
      appendTraceEvent(trace?._id, {
        key: 'client_disconnected',
        label: 'Client disconnected',
        status: 'warning',
        provider: policy.primaryProvider,
        model: primaryTraceModel,
        code: 'CLIENT_DISCONNECTED',
        message: 'The client connection closed before the request settled.',
      }, traceStartedAt).catch(() => {});
      if (cleanupFn) cleanupFn();
    }
  });

  // Send start event with conversation ID
  await appendTraceEvent(trace?._id, {
    key: 'request_accepted',
    label: 'Request accepted',
    status: 'info',
    provider: policy.primaryProvider,
    model: primaryTraceModel,
    message: 'SSE stream opened and request accepted by the server.',
  }, traceStartedAt);
  res.write('event: start\ndata: ' + JSON.stringify({
    conversationId: conversation._id.toString(),
    requestId: req.requestId,
    traceId: trace ? trace._id.toString() : null,
    provider: policy.primaryProvider, // backward-compat
    primaryProvider: policy.primaryProvider,
    primaryModel: policy.primaryModel || null,
    fallbackProvider: policy.fallbackProvider || null,
    fallbackModel: policy.fallbackModel || null,
    parallelProviders: policy.mode === 'parallel' ? (policy.parallelProviders || [policy.primaryProvider, policy.fallbackProvider]) : null,
    mode: policy.mode,
    turnId: requestTurnId,
    warnings: guardrail.warnings || [],
    contextDebug: contextDebugPayload,
    caseIntake: conversation.caseIntake || null,
  }) + '\n\n');
  if (!responseClosed && conversation.caseIntake && conversation.caseIntake.status !== 'none') {
    try {
      res.write('event: case_intake\ndata: ' + JSON.stringify(conversation.caseIntake) + '\n\n');
    } catch { /* client disconnected */ }
  }
  // Emit transcription result as an SSE event so the client knows text was extracted.
  if (imageTranscription && imageTranscription.text && !responseClosed) {
    try {
      res.write('event: image_transcription\ndata: ' + JSON.stringify({
        text: imageTranscription.text,
        elapsedMs: imageTranscription.elapsedMs || 0,
        charCount: imageTranscription.text.length,
      }) + '\n\n');
    } catch { /* client disconnected */ }
  }
  // Triage now runs through the standalone /api/triage harness. /api/chat keeps
  // parser + INV context for the analyst answer but does not emit triage cards.
  // Emit INV matches SSE event so the client can show the InvMatchBanner.
  if (!responseClosed && invMatchResult.ssePayload.length > 0) {
    try {
      res.write('event: inv_matches\ndata: ' + JSON.stringify(invMatchResult.ssePayload) + '\n\n');
    } catch { /* client disconnected */ }
  }
  const turnStartedAt = Date.now();
  const requestId = req.requestId;
  const traceStats = {
    chunkCount: 0,
    chunkChars: 0,
    thinkingChunkCount: 0,
    providerErrors: 0,
    fallbacks: 0,
  };
  let firstThinkingMs = 0;
  let firstChunkMs = 0;
  const runtimeOperation = createAiOperation({
    kind: 'chat',
    route: '/api/chat',
    action: 'chat',
    provider: policy.primaryProvider,
    mode: policy.mode,
    conversationId: conversation._id.toString(),
    promptPreview: safeString(userMsg.content, ''),
    hasImages: normalizedImages.length > 0,
    messageCount: contextBundle.messagesForModel.length,
    providers: (policy.parallelProviders || [policy.primaryProvider, policy.fallbackProvider]).filter(Boolean),
  });
  runtimeOperationId = runtimeOperation.id;

  // Set up heartbeat
  heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* client gone */ }
  }, 15000);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  // SSE safety timeout — force-close if stream never settles
  sseSafetyTimeout = setTimeout(async () => {
    if (streamSettled || responseClosed) return;
    console.error('[chat] SSE safety timeout hit after %dms — force-closing hung stream', SSE_SAFETY_TIMEOUT_MS);
    streamSettled = true;
    clearInterval(heartbeat);
    if (conversation.caseIntake && conversation.caseIntake.status === 'analyst-running') {
      mainEventBus.emit('error', {
        code: 'SSE_STREAM_TIMEOUT',
        message: 'Request timed out - please try again',
      });
      mainEventBus.emit('stage.completed', {
        status: 'failed',
        durationMs: SSE_SAFETY_TIMEOUT_MS,
        provider: policy.primaryProvider,
        model: primaryTraceModel,
      });
      conversation.caseIntake = failCaseIntakeAnalystRun(conversation.caseIntake, {
        provider: policy.primaryProvider,
        model: primaryTraceModel,
        traceId: trace ? trace._id.toString() : null,
        error: {
          code: 'SSE_STREAM_TIMEOUT',
          message: 'Request timed out - please try again',
        },
        evidenceReceipt: {
          attempted: true,
          completed: false,
          failed: true,
          messageSaved: false,
          thinkingCaptured: false,
          traceId: trace ? trace._id.toString() : '',
          requestId: req.requestId,
          provider: policy.primaryProvider,
          packageCaptureEnabled,
          errorCode: 'SSE_STREAM_TIMEOUT',
          completedAt: new Date(),
          reportedVia: 'server',
        },
        completedAt: new Date(),
      });
      conversation.caseIntake = applyStageEventsToCaseIntake(conversation.caseIntake, 'main', mainEventBus.flush());
      conversation.markModified?.('caseIntake');
      await saveConversationLenient(conversation).catch(() => {});
    }
    try {
      res.write('event: error\ndata: ' + JSON.stringify({
        error: 'Request timed out — please try again',
        code: 'SSE_STREAM_TIMEOUT',
        caseIntake: conversation.caseIntake || null,
      }) + '\n\n');
      res.end();
    } catch { /* client already gone */ }
    if (cleanupFn) {
      try { cleanupFn(); } catch { /* ignore */ }
    }
  }, SSE_SAFETY_TIMEOUT_MS);
  if (typeof sseSafetyTimeout.unref === 'function') sseSafetyTimeout.unref();

  mainEventBus.emit('stage.started', {
    agentName: 'QBO Assistant',
    provider: policy.primaryProvider,
    model: policy.primaryModel || primaryTraceModel,
    mode: policy.mode,
    reasoningEffort: effectiveReasoningEffort || '',
    useAgentTools: Boolean(useSharedAgentTools),
  });
  mainEventBus.emit('llm.request', {
    provider: policy.primaryProvider,
    model: policy.primaryModel || primaryTraceModel,
    mode: policy.mode,
    reasoningEffort: effectiveReasoningEffort || '',
  });
  let mainStreamingEmitted = false;
  cleanupFn = startMainChatExecution({
    useAgentTools: useSharedAgentTools,
    policy,
    messages: contextBundle.messagesForModel,
    systemPrompt: orchestrationSystemPrompt,
    reasoningEffort: effectiveReasoningEffort,
    timeoutMs: effectiveTimeoutMs,
    captureMetadata: buildConversationCaptureMetadata(conversation),
    onChunk: ({ provider: chunkProvider, text }) => {
      recordAiChunk(runtimeOperationId, text, { provider: chunkProvider });
      traceStats.chunkCount += 1;
      traceStats.chunkChars += typeof text === 'string' ? text.length : 0;
      if (!firstChunkMs) {
        firstChunkMs = Date.now() - turnStartedAt;
        appendTraceEvent(trace?._id, {
          key: 'first_output',
          label: 'First output chunk',
          status: 'info',
          provider: chunkProvider,
          model: resolveRequestedModel(
            chunkProvider,
            chunkProvider === policy.primaryProvider
              ? policy.primaryModel
              : (chunkProvider === policy.fallbackProvider ? policy.fallbackModel : '')
          ),
          message: `First output chunk arrived from ${chunkProvider}.`,
          elapsedMs: firstChunkMs,
        }, traceStartedAt).catch(() => {});
      }
      if (!mainStreamingEmitted) {
        mainStreamingEmitted = true;
        mainEventBus.emit('llm.streaming', { provider: chunkProvider });
        mainEventBus.emit('chunk.first_token', {
          provider: chunkProvider,
          elapsedMs: firstChunkMs,
        });
      }
      try {
        res.write('event: chunk\ndata: ' + JSON.stringify({ provider: chunkProvider, text }) + '\n\n');
      } catch { /* client disconnected */ }
    },
    onThinkingChunk: ({ provider: thinkingProvider, thinking }) => {
      recordAiChunk(runtimeOperationId, thinking, { provider: thinkingProvider, thinking: true });
      traceStats.thinkingChunkCount += 1;
      if (!firstThinkingMs) {
        firstThinkingMs = Date.now() - turnStartedAt;
        appendTraceEvent(trace?._id, {
          key: 'first_thinking',
          label: 'First reasoning chunk',
          status: 'info',
          provider: thinkingProvider,
          model: resolveRequestedModel(
            thinkingProvider,
            thinkingProvider === policy.primaryProvider
              ? policy.primaryModel
              : (thinkingProvider === policy.fallbackProvider ? policy.fallbackModel : '')
          ),
          message: `First reasoning chunk arrived from ${thinkingProvider}.`,
          elapsedMs: firstThinkingMs,
        }, traceStartedAt).catch(() => {});
      }
      try {
        res.write('event: thinking\ndata: ' + JSON.stringify({ provider: thinkingProvider, thinking }) + '\n\n');
      } catch { /* client disconnected */ }
    },
    onProviderError: (data) => {
      recordAgentActivity(CHAT_ACTIVITY_AGENT_ID, {
        type: 'error',
        phase: 'provider-error',
        status: 'error',
        summary: data?.message || 'A main chat provider attempt failed.',
        detail: data,
      }, {
        surface: 'chat',
        conversationId: conversation._id.toString(),
      }).catch(() => {});
      traceStats.providerErrors += 1;
      recordAiEvent(runtimeOperationId, 'provider_error', {
        provider: data && data.provider ? data.provider : null,
        lastError: data ? {
          code: data.code || 'PROVIDER_EXEC_FAILED',
          message: data.message || 'Provider failed',
          detail: data.detail || '',
        } : null,
      });
      appendTraceEvent(trace?._id, {
        key: 'provider_error',
        label: 'Provider attempt failed',
        status: 'error',
        provider: data && data.provider ? data.provider : '',
        model: safeString(data && data.model, '') || getProviderModelId(data && data.provider ? data.provider : ''),
        code: data && data.code ? data.code : 'PROVIDER_EXEC_FAILED',
        message: data && data.message ? data.message : 'Provider failed',
        detail: data || null,
      }, traceStartedAt).catch(() => {});
      try {
        res.write('event: provider_error\ndata: ' + JSON.stringify(data) + '\n\n');
      } catch { /* client disconnected */ }
    },
    onFallback: (data) => {
      recordAgentActivity(CHAT_ACTIVITY_AGENT_ID, {
        type: 'fallback',
        phase: 'provider-fallback',
        status: 'warning',
        summary: `${data && data.from ? data.from : 'primary'} -> ${data && data.to ? data.to : 'fallback'}`,
        detail: data,
      }, {
        surface: 'chat',
        conversationId: conversation._id.toString(),
      }).catch(() => {});
      traceStats.fallbacks += 1;
      recordAiEvent(runtimeOperationId, 'fallback', {
        provider: data && data.from ? data.from : null,
        to: data && data.to ? data.to : null,
      });
      appendTraceEvent(trace?._id, {
        key: 'fallback',
        label: 'Fallback engaged',
        status: 'warning',
        provider: data && data.to ? data.to : '',
        model: safeString(data && data.toModel, '') || getProviderModelId(data && data.to ? data.to : ''),
        code: data && data.reason ? data.reason : 'PROVIDER_ERROR',
        message: `${data && data.from ? data.from : 'primary'} -> ${data && data.to ? data.to : 'fallback'}`,
        detail: data || null,
      }, traceStartedAt).catch(() => {});
      try {
        res.write('event: fallback\ndata: ' + JSON.stringify(data) + '\n\n');
      } catch { /* client disconnected */ }
    },
    onStatus: (status) => {
      recordAgentActivity(CHAT_ACTIVITY_AGENT_ID, {
        type: 'status',
        phase: status?.phase || status?.type || 'status',
        status: status?.type || 'info',
        summary: status?.message || 'Main chat emitted a status update.',
        detail: status,
      }, {
        surface: 'chat',
        conversationId: conversation._id.toString(),
      }).catch(() => {});
      try {
        res.write('event: status\ndata: ' + JSON.stringify(status) + '\n\n');
      } catch { /* client disconnected */ }
    },
    onDone: async (data) => {
      streamSettled = true;
      clearInterval(heartbeat);
      clearTimeout(sseSafetyTimeout);
      recordAiEvent(runtimeOperationId, 'saving', {
        provider: data && data.providerUsed ? data.providerUsed : policy.primaryProvider,
      });
      const latencyMs = Date.now() - turnStartedAt;
      // imageTriageContext is already resolved in the outer scope (awaited before orchestration).
      // Skip response compliance rewriting for non-escalation intents — the model's
      // natural response should not be forced into the 6-section triage format.
      const compliantData = (imageTriageContext && !nonEscalationIntent)
        ? applyImageResponseCompliance(data, imageTriageContext)
        : { ...data, responseRepaired: false };
      const attempts = compliantData.attempts || [];
      const providerThinking = normalizeProviderThinking(compliantData.providerThinking);
      logAttemptsUsage(attempts, { requestId, service: 'chat', conversationId: conversation._id, mode: compliantData.mode || policy.mode });
      logChatTurn({
        route: '/api/chat',
        conversationId: conversation._id.toString(),
        mode: compliantData.mode || policy.mode,
        requestedMode,
        requestedPrimaryProvider,
        providerUsed: compliantData.providerUsed,
        fallbackUsed: Boolean(compliantData.fallbackUsed),
        fallbackReasonCode: deriveFallbackReasonCode(compliantData.fallbackFrom, attempts),
        latencyMs,
        errorCode: null,
        attempts: attempts.length,
      });
      // Extract quick-action suggestions from the final response text (non-parallel only)
      const quickActions = (compliantData.mode !== 'parallel')
        ? extractQuickActions(compliantData.fullResponse)
        : [];

      try {
        if (compliantData.mode === 'parallel' && Array.isArray(compliantData.results)) {
          const turnId = compliantData.turnId || requestTurnId || randomUUID();
          const hasSuccessful = compliantData.results.some((r) => r.status === 'ok');
          try {
            await ParallelCandidateTurn.findOneAndUpdate(
              { turnId },
              {
                $set: {
                  service: 'chat',
                  conversationId: conversation._id,
                  status: hasSuccessful ? 'open' : 'expired',
                  candidates: compliantData.results.map(toCandidateFromResult),
                  attempts: compliantData.attempts || [],
                },
              },
              { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
            );
          } catch {
            // non-blocking for chat flow
          }
          const successful = compliantData.results.filter((r) => r.status === 'ok' && typeof r.fullResponse === 'string');
          for (const result of successful) {
            conversation.messages.push({
              role: 'assistant',
              content: result.fullResponse,
              thinking: getProviderThinking(providerThinking, result.provider, result.thinking || ''),
              provider: result.provider,
              modelUsed: safeString(result.modelUsed, '') || (result.usage && result.usage.model) || getProviderModelId(result.provider),
              mode: compliantData.mode || policy.mode,
              fallbackFrom: null,
              traceRequestId: req.requestId,
              attemptMeta: {
                attempts: compliantData.attempts || [],
                parallel: true,
                turnId,
                ...(Object.keys(providerThinking).length > 0 ? { providerThinking } : {}),
              },
              usage: buildUsageSubdoc(result.usage),
              timestamp: new Date(),
            });
          }
        } else {
          conversation.messages.push({
            role: 'assistant',
            content: compliantData.fullResponse,
            thinking: getProviderThinking(providerThinking, compliantData.providerUsed, compliantData.thinking || ''),
            provider: compliantData.providerUsed,
            modelUsed: safeString(compliantData.modelUsed, '') || (compliantData.usage && compliantData.usage.model) || getProviderModelId(compliantData.providerUsed || policy.primaryProvider),
            mode: compliantData.mode || policy.mode,
            fallbackFrom: compliantData.fallbackFrom || null,
            traceRequestId: req.requestId,
            attemptMeta: {
              attempts: compliantData.attempts || [],
              ...(Object.keys(providerThinking).length > 0 ? { providerThinking } : {}),
              ...(quickActions.length > 0 ? { quickActions } : {}),
            },
            usage: buildUsageSubdoc(compliantData.usage),
            timestamp: new Date(),
          });
        }
        await learnFromInteraction({
          role: 'assistant',
          agentId: 'chat',
          content: compliantData.fullResponse,
        }, { surface: 'chat' }).catch(() => {});
        await recordAgentActivity(CHAT_ACTIVITY_AGENT_ID, {
          type: 'response',
          phase: 'done',
          status: 'ok',
          summary: 'Main chat finished responding.',
          detail: {
            content: compliantData.fullResponse,
            providerUsed: compliantData.providerUsed || null,
            modelUsed: compliantData.modelUsed || null,
            usage: compliantData.usage || null,
            fallbackUsed: Boolean(compliantData.fallbackUsed),
            attempts: attempts.length,
            toolIterations: compliantData.toolIterations || 0,
            durationMs: latencyMs,
          },
        }, {
          surface: 'chat',
          conversationId: conversation._id.toString(),
        }).catch(() => {});
        if (Array.isArray(compliantData.toolActions) && compliantData.toolActions.length > 0) {
          await recordAgentToolUsage('chat', compliantData.toolActions, { surface: 'chat' }).catch(() => {});
        }

        // Generate a meaningful conversation title after the first exchange
        if (isNewConversation && conversation.messages.length >= 2) {
          const firstUserMsg = conversation.messages.find((m) => m.role === 'user');
          if (firstUserMsg) {
            const userContent = safeString(firstUserMsg.content, '');
            const coidMatch = userContent.match(/COID[\s/]*MID[:\s]*(\d+)/i);
            const caseMatch = userContent.match(/CASE[:\s]*(\S+)/i);
            const categoryMatch = userContent.match(/CATEGORY[:\s]*(\S+)/i);
            const invMatch = userContent.match(/INV-(\d{4,})/i);

            const parts = [];
            if (coidMatch) parts.push('COID ' + coidMatch[1]);
            if (invMatch) parts.push('INV-' + invMatch[1]);
            if (caseMatch) parts.push('Case ' + caseMatch[1]);
            if (categoryMatch) parts.push(categoryMatch[1].replace(/-/g, ' '));

            if (parts.length > 0) {
              conversation.title = parts.join(' \u2014 ');
            } else {
              // Fall back to trimmed first line / first 60 chars
              const trimmed = userContent.replace(/\s+/g, ' ').trim();
              conversation.title = trimmed.length > 60
                ? trimmed.slice(0, 60) + '...'
                : trimmed || 'Untitled';
            }
          }
        }

        // Persist Escalation record when image triage produced valid parseFields.
        // This mirrors the persist logic in /parse-escalation but runs automatically
        // for screenshots sent through the main chat flow.
        // Skip for non-escalation intents — user explicitly said this isn't an escalation.
        if (
          imageTriageContext
          && !nonEscalationIntent
          && imageTriageContext.parseFields
          && Object.keys(imageTriageContext.parseFields).length > 0
          && !conversation.escalationId // avoid duplicates on retries
        ) {
          try {
            const triageMeta = imageTriageContext.parseMeta || {};
            const linked = await createLinkedEscalationFromConversation({
              conversation,
              fields: imageTriageContext.parseFields,
              source: 'screenshot',
              parseMeta: {
                mode: triageMeta.mode || '',
                providerUsed: triageMeta.providerUsed || '',
                winner: triageMeta.winner || triageMeta.providerUsed || '',
                fallbackUsed: Boolean(triageMeta.fallbackUsed),
                fallbackFrom: triageMeta.fallbackFrom || '',
                validationScore: triageMeta.validation ? triageMeta.validation.score : null,
                validationConfidence: triageMeta.validation ? triageMeta.validation.confidence : '',
                validationIssues: triageMeta.validation ? triageMeta.validation.issues : [],
                usedRegexFallback: Boolean(triageMeta.usedRegexFallback),
                attempts: triageMeta.attempts || [],
              },
            });
            conversation.escalationId = linked.escalation._id;
            console.log(
              '[chat] Escalation %s from chat triage: %s (conv %s)',
              linked.reusedExisting ? 'reused' : 'persisted',
              linked.escalation._id,
              conversation._id
            );
            // Flow every pipeline escalation straight into the Knowledge Review
            // queue — status-independent, idempotent, and fire-and-forget so it
            // never delays the chat response.
            triggerKnowledgeDraftForEscalation(linked.escalation, {
              trigger: 'knowledge.chat-triage.auto-draft',
            });
          } catch (escErr) {
            // Non-fatal — do not break the chat flow if escalation persist fails
            console.warn('[chat] Failed to persist escalation from triage (non-fatal):', escErr.message);
          }
        }

        if (conversation.caseIntake && conversation.caseIntake.status === 'analyst-running') {
          const analystModelUsed = safeString(compliantData.modelUsed, '')
            || (compliantData.usage && compliantData.usage.model)
            || getProviderModelId(compliantData.providerUsed || policy.primaryProvider);
          const analystSummary = safeString(compliantData.fullResponse, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 240);
          mainEventBus.emit('llm.response', {
            latencyMs,
            provider: compliantData.providerUsed || policy.primaryProvider,
            model: analystModelUsed,
            usage: compliantData.usage ? {
              inputTokens: compliantData.usage.inputTokens,
              outputTokens: compliantData.usage.outputTokens,
              totalTokens: compliantData.usage.totalTokens,
            } : null,
            chunkCount: traceStats.chunkCount,
            chunkChars: traceStats.chunkChars,
            firstChunkMs,
            firstThinkingMs,
          });
          mainEventBus.emit('chunk.complete', {
            chunkCount: traceStats.chunkCount,
            chunkChars: traceStats.chunkChars,
            thinkingChunkCount: traceStats.thinkingChunkCount,
            outputTokens: compliantData.usage?.outputTokens ?? null,
          });
          mainEventBus.emit('stage.completed', {
            status: 'success',
            durationMs: latencyMs,
            provider: compliantData.providerUsed || policy.primaryProvider,
            model: analystModelUsed,
            fallbackUsed: Boolean(compliantData.fallbackUsed),
          });
          conversation.caseIntake = completeCaseIntakeAnalystRun(conversation.caseIntake, {
            provider: compliantData.providerUsed || policy.primaryProvider,
            model: analystModelUsed,
            traceId: trace ? trace._id.toString() : null,
            summary: analystSummary || 'Deep support guidance completed.',
            detail: {
              usage: compliantData.usage || null,
              fallbackUsed: Boolean(compliantData.fallbackUsed),
              fallbackFrom: compliantData.fallbackFrom || null,
              attempts: attempts.length,
            },
            evidenceReceipt: {
              attempted: true,
              completed: true,
              failed: false,
              messageSaved: true,
              thinkingCaptured: Boolean(
                safeString(compliantData.thinking, '').trim()
                || Object.values(providerThinking).some((value) => safeString(value, '').trim())
              ),
              traceId: trace ? trace._id.toString() : '',
              requestId: req.requestId,
              provider: compliantData.providerUsed || policy.primaryProvider,
              packageCaptureEnabled,
              completedAt: new Date(),
              reportedVia: 'server',
            },
            completedAt: new Date(),
          });
          conversation.caseIntake = applyStageEventsToCaseIntake(conversation.caseIntake, 'main', mainEventBus.flush());
          conversation.markModified?.('caseIntake');
        }

        await saveConversationLenient(conversation);
        await setTraceAttempts(trace?._id, attempts);
        await setTraceUsage(trace?._id, compliantData.usage);
        await patchTrace(trace?._id, {
          status: 'ok',
          responseChars: sumResponseChars(compliantData),
          stats: buildTraceStats(traceStats),
          outcome: buildOutcome({
            providerUsed: compliantData.providerUsed || policy.primaryProvider,
            modelUsed: safeString(compliantData.modelUsed, '') || (compliantData.usage && compliantData.usage.model) || getProviderModelId(compliantData.providerUsed || policy.primaryProvider),
            winner: compliantData.providerUsed || policy.primaryProvider,
            fallbackUsed: Boolean(compliantData.fallbackUsed),
            fallbackFrom: compliantData.fallbackFrom || null,
            responseRepaired: Boolean(compliantData.responseRepaired),
            totalMs: latencyMs,
            firstThinkingMs,
            firstChunkMs,
            completedAt: new Date(),
          }),
        });
        await appendTraceEvent(trace?._id, {
          key: 'conversation_saved',
          label: 'Conversation saved',
          status: 'success',
          provider: compliantData.providerUsed || policy.primaryProvider,
          model: safeString(compliantData.modelUsed, '') || (compliantData.usage && compliantData.usage.model) || getProviderModelId(compliantData.providerUsed || policy.primaryProvider),
          message: `Saved response and conversation state in ${latencyMs}ms.`,
          elapsedMs: latencyMs,
          detail: {
            attempts: attempts.length,
            responseRepaired: Boolean(compliantData.responseRepaired),
            usage: summarizeUsage(compliantData.usage),
          },
        }, traceStartedAt);

        // Fire-and-forget: archive images to disk with full metadata
        if (normalizedImages.length > 0) {
          try {
            const userMsgIndex = conversation.messages.length - (
              compliantData.mode === 'parallel' && Array.isArray(compliantData.results)
                ? compliantData.results.filter((r) => r.status === 'ok').length + 1
                : 2
            );
            const archiveModelParsing = safeString(imageTranscription && imageTranscription.text, '')
              || compliantData.fullResponse
              || (Array.isArray(compliantData.results) && compliantData.results.find((r) => r.status === 'ok')?.fullResponse)
              || '';
            archiveImages({
              conversationId: conversation._id.toString(),
              messageIndex: Math.max(0, userMsgIndex),
              images: normalizedImages,
              userPrompt: safeString(message, ''),
              modelParsing: archiveModelParsing,
              thinking: '',
              parseFields: imageTriageContext && imageTriageContext.parseFields ? imageTriageContext.parseFields : null,
              triageCard: imageTriageContext && imageTriageContext.triageCard ? imageTriageContext.triageCard : null,
              provider: safeString(
                imageTranscription && imageTranscription.providerUsed,
                (imageTriageContext && imageTriageContext.parseMeta && imageTriageContext.parseMeta.providerUsed)
                  || compliantData.providerUsed
                  || policy.primaryProvider
              ),
              usage: (imageTranscription && imageTranscription.usage) || compliantData.usage || null,
              timestamp: userMsg.timestamp,
            });
          } catch (archiveErr) {
            console.warn('[image-archive] Failed to archive chat images:', archiveErr.message);
          }
        }

        try {
          const usagePayload = buildUsageSubdoc(compliantData.usage);
          const responseModelUsed = safeString(compliantData.modelUsed, '')
            || (compliantData.usage && compliantData.usage.model)
            || getProviderModelId(compliantData.providerUsed || policy.primaryProvider);
          res.write('event: done\ndata: ' + JSON.stringify({
            conversationId: conversation._id.toString(),
            traceId: trace ? trace._id.toString() : null,
            provider: compliantData.mode === 'parallel' ? policy.primaryProvider : compliantData.providerUsed, // backward-compat
            providerUsed: compliantData.providerUsed,
            modelUsed: responseModelUsed || null,
            fallbackUsed: compliantData.fallbackUsed,
            fallbackFrom: compliantData.fallbackFrom || null,
            mode: compliantData.mode || policy.mode,
            turnId: compliantData.mode === 'parallel' ? (compliantData.turnId || requestTurnId) : null,
            attempts: compliantData.attempts || [],
            thinking: compliantData.thinking || '',
            providerThinking,
            fullResponse: compliantData.fullResponse,
            results: Array.isArray(compliantData.results) ? compliantData.results.map(r => ({
              ...r,
              usage: buildUsageSubdoc(r.usage),
            })) : null,
            usage: usagePayload,
            usageAvailable: !!compliantData.usage,
            responseRepaired: Boolean(compliantData.responseRepaired),
            warnings: guardrail.warnings || [],
            contextDebug: contextDebugPayload,
            citations: contextBundle.citations || [],
            quickActions,
            escalationId: conversation.escalationId ? conversation.escalationId.toString() : null,
            caseIntake: conversation.caseIntake || null,
          }) + '\n\n');
          res.end();
        } catch { /* client gone */ }
      } catch (onDoneErr) {
        if (conversation.caseIntake?.evidence?.receipts) {
          const failedAt = new Date();
          conversation.caseIntake = failCaseIntakeAnalystRun(conversation.caseIntake, {
            provider: policy.primaryProvider,
            model: primaryTraceModel,
            traceId: trace ? trace._id.toString() : null,
            error: {
              code: 'ONDONE_SAVE_FAILED',
              message: onDoneErr.message || 'Failed to save chat conversation',
            },
            evidenceReceipt: {
              attempted: true,
              completed: false,
              failed: true,
              messageSaved: false,
              thinkingCaptured: false,
              traceId: trace ? trace._id.toString() : '',
              requestId: req.requestId,
              provider: policy.primaryProvider,
              packageCaptureEnabled,
              errorCode: 'ONDONE_SAVE_FAILED',
              completedAt: failedAt,
              reportedVia: 'server',
            },
            completedAt: failedAt,
          });
          conversation.markModified?.('caseIntake');
          await Conversation.updateOne(
            { _id: conversation._id },
            { $set: { caseIntake: conversation.caseIntake } }
          ).catch(() => {});
        }
        patchTrace(trace?._id, {
          status: 'error',
          stats: buildTraceStats(traceStats),
          outcome: buildOutcome({
            providerUsed: policy.primaryProvider,
            modelUsed: primaryTraceModel,
            totalMs: Date.now() - turnStartedAt,
            firstThinkingMs,
            firstChunkMs,
            completedAt: new Date(),
            errorCode: 'ONDONE_SAVE_FAILED',
            errorMessage: onDoneErr.message || 'Failed to save chat conversation',
          }),
        }).catch(() => {});
        appendTraceEvent(trace?._id, {
          key: 'save_failed',
          label: 'Conversation save failed',
          status: 'error',
          provider: policy.primaryProvider,
          model: primaryTraceModel,
          code: 'ONDONE_SAVE_FAILED',
          message: onDoneErr.message || 'Failed to save chat conversation',
        }, traceStartedAt).catch(() => {});
        reportServerError({
          route: '/api/chat',
          message: onDoneErr.message || 'Failed to save chat conversation',
          code: 'ONDONE_SAVE_FAILED',
          detail: onDoneErr.stack || '',
          severity: 'error',
        });
        try {
          res.write('event: error\ndata: ' + JSON.stringify({
            error: onDoneErr.message || 'Failed to save conversation',
            code: 'ONDONE_SAVE_FAILED',
          }) + '\n\n');
          res.end();
        } catch { /* client gone */ }
      } finally {
        deleteAiOperation(runtimeOperationId);
      }
    },
    onError: async (err) => {
      streamSettled = true;
      clearInterval(heartbeat);
      clearTimeout(sseSafetyTimeout);
      recordAgentActivity(CHAT_ACTIVITY_AGENT_ID, {
        type: 'error',
        phase: 'error',
        status: 'error',
        summary: err.message || 'Main chat failed.',
        detail: {
          code: err.code || 'PROVIDER_EXEC_FAILED',
          detail: err.detail || '',
          attempts: err.attempts || [],
        },
      }, {
        surface: 'chat',
        conversationId: conversation._id.toString(),
      }).catch(() => {});
      recordAiEvent(runtimeOperationId, 'error', {
        lastError: {
          code: err.code || 'PROVIDER_EXEC_FAILED',
          message: err.message || 'Chat failed',
          detail: err.detail || '',
        },
      });
      const latencyMs = Date.now() - turnStartedAt;
      const attempts = err.attempts || [];
      logAttemptsUsage(attempts, { requestId, service: 'chat', conversationId: conversation._id, mode: policy.mode });
      logChatTurn({
        route: '/api/chat',
        conversationId: conversation._id.toString(),
        mode: policy.mode,
        requestedMode,
        requestedPrimaryProvider,
        providerUsed: null,
        fallbackUsed: false,
        fallbackReasonCode: deriveFallbackReasonCode(null, attempts),
        latencyMs,
        errorCode: err.code || 'PROVIDER_EXEC_FAILED',
        attempts: attempts.length,
      });
      setTraceAttempts(trace?._id, attempts).catch(() => {});
      patchTrace(trace?._id, {
        status: 'error',
        stats: buildTraceStats(traceStats),
        outcome: buildOutcome({
          providerUsed: policy.primaryProvider,
          modelUsed: safeString(err && err.modelUsed, '') || primaryTraceModel,
          totalMs: latencyMs,
          firstThinkingMs,
          firstChunkMs,
          completedAt: new Date(),
          errorCode: err.code || 'PROVIDER_EXEC_FAILED',
          errorMessage: err.message || 'Chat failed',
        }),
      }).catch(() => {});
      appendTraceEvent(trace?._id, {
        key: 'request_failed',
        label: 'Request failed',
        status: 'error',
        provider: policy.primaryProvider,
        model: safeString(err && err.modelUsed, '') || primaryTraceModel,
        code: err.code || 'PROVIDER_EXEC_FAILED',
        message: err.message || 'Chat failed',
        detail: {
          attempts,
          firstThinkingMs,
          firstChunkMs,
        },
        elapsedMs: latencyMs,
      }, traceStartedAt).catch(() => {});
      reportServerError({
        route: '/api/chat',
        message: err.message || 'Chat failed',
        code: err.code || 'PROVIDER_EXEC_FAILED',
        detail: err.detail || '',
        severity: 'error',
      });
      if (conversation.caseIntake && conversation.caseIntake.status === 'analyst-running') {
        mainEventBus.emit('error', {
          code: err.code || 'PROVIDER_EXEC_FAILED',
          message: err.message || 'Chat failed',
        });
        mainEventBus.emit('stage.completed', {
          status: 'failed',
          durationMs: latencyMs,
          provider: policy.primaryProvider,
          model: safeString(err && err.modelUsed, '') || primaryTraceModel,
        });
        conversation.caseIntake = failCaseIntakeAnalystRun(conversation.caseIntake, {
          provider: policy.primaryProvider,
          model: safeString(err && err.modelUsed, '') || primaryTraceModel,
          traceId: trace ? trace._id.toString() : null,
          error: {
            code: err.code || 'PROVIDER_EXEC_FAILED',
            message: err.message || 'Chat failed',
            detail: err.detail || '',
          },
          evidenceReceipt: {
            attempted: true,
            completed: false,
            failed: true,
            messageSaved: false,
            thinkingCaptured: false,
            traceId: trace ? trace._id.toString() : '',
            requestId: req.requestId,
            provider: policy.primaryProvider,
            packageCaptureEnabled,
            errorCode: err.code || 'PROVIDER_EXEC_FAILED',
            completedAt: new Date(),
            reportedVia: 'server',
          },
          completedAt: new Date(),
        });
        conversation.caseIntake = applyStageEventsToCaseIntake(conversation.caseIntake, 'main', mainEventBus.flush());
        conversation.markModified?.('caseIntake');
        await saveConversationLenient(conversation).catch(() => {});
      }
      if (requestTurnId && policy.mode === 'parallel') {
        ParallelCandidateTurn.findOneAndUpdate(
          { turnId: requestTurnId },
          {
            $set: {
              service: 'chat',
              conversationId: conversation._id,
              status: 'expired',
              attempts: err.attempts || [],
              candidates: (err.attempts || []).map((attempt) => ({
                provider: attempt.provider,
                content: '',
                state: attempt.errorCode === 'TIMEOUT' ? 'timeout' : 'error',
                errorCode: attempt.errorCode || '',
                errorMessage: attempt.errorMessage || '',
                errorDetail: attempt.errorDetail || '',
                latencyMs: Number(attempt.latencyMs) || 0,
              })),
            },
          },
          { upsert: true, setDefaultsOnInsert: true }
        ).catch((err2) => console.warn('ParallelCandidateTurn update failed (chat error):', err2.message));
      }
      try {
        res.write('event: error\ndata: ' + JSON.stringify({
          error: err.message || 'Chat failed',
          code: err.code || 'PROVIDER_EXEC_FAILED',
          detail: err.detail || '',
          attempts: err.attempts || [],
          warnings: guardrail.warnings || [],
          contextDebug: contextDebugPayload,
          caseIntake: conversation.caseIntake || null,
        }) + '\n\n');
        res.end();
      } catch { /* client disconnected */ }
      deleteAiOperation(runtimeOperationId);
    },
    onAbort: async (abortData) => {
      if (streamSettled) return;
      streamSettled = true;
      clearInterval(heartbeat);
      clearTimeout(sseSafetyTimeout);
      recordAiEvent(runtimeOperationId, 'aborting', {
        lastError: {
          code: 'CLIENT_ABORT',
          message: 'Chat request aborted',
          detail: '',
        },
      });
      logAttemptsUsage(abortData.attempts, { requestId, service: 'chat', conversationId: conversation._id, mode: policy.mode });
      setTraceAttempts(trace?._id, abortData.attempts || []).catch(() => {});
      patchTrace(trace?._id, {
        status: 'aborted',
        stats: buildTraceStats(traceStats),
        outcome: buildOutcome({
          providerUsed: policy.primaryProvider,
          modelUsed: primaryTraceModel,
          totalMs: Date.now() - turnStartedAt,
          firstThinkingMs,
          firstChunkMs,
          completedAt: new Date(),
          errorCode: 'CLIENT_ABORT',
          errorMessage: 'Chat request aborted before completion',
        }),
      }).catch(() => {});
      appendTraceEvent(trace?._id, {
        key: 'request_aborted',
        label: 'Request aborted',
        status: 'warning',
        provider: policy.primaryProvider,
        model: primaryTraceModel,
        code: 'CLIENT_ABORT',
        message: 'Chat request aborted before completion',
        detail: { attempts: abortData.attempts || [] },
      }, traceStartedAt).catch(() => {});
      if (conversation.caseIntake && conversation.caseIntake.status === 'analyst-running') {
        mainEventBus.emit('error', {
          code: 'CLIENT_ABORT',
          message: 'Chat request aborted before completion',
        });
        mainEventBus.emit('stage.completed', {
          status: 'failed',
          durationMs: Date.now() - turnStartedAt,
          provider: policy.primaryProvider,
          model: primaryTraceModel,
        });
        conversation.caseIntake = failCaseIntakeAnalystRun(conversation.caseIntake, {
          provider: policy.primaryProvider,
          model: primaryTraceModel,
          traceId: trace ? trace._id.toString() : null,
          error: {
            code: 'CLIENT_ABORT',
            message: 'Chat request aborted before completion',
          },
          evidenceReceipt: {
            attempted: true,
            completed: false,
            failed: true,
            messageSaved: false,
            thinkingCaptured: false,
            traceId: trace ? trace._id.toString() : '',
            requestId: req.requestId,
            provider: policy.primaryProvider,
            packageCaptureEnabled,
            errorCode: 'CLIENT_ABORT',
            completedAt: new Date(),
            reportedVia: 'server',
          },
          completedAt: new Date(),
        });
        conversation.caseIntake = applyStageEventsToCaseIntake(conversation.caseIntake, 'main', mainEventBus.flush());
        conversation.markModified?.('caseIntake');
        await saveConversationLenient(conversation).catch(() => {});
      }
      try {
        res.write('event: error\ndata: ' + JSON.stringify({
          error: 'Chat request aborted before completion',
          code: 'CLIENT_ABORT',
          attempts: abortData.attempts || [],
          warnings: guardrail.warnings || [],
          contextDebug: contextDebugPayload,
          caseIntake: conversation.caseIntake || null,
        }) + '\n\n');
        res.end();
      } catch { /* client disconnected */ }
      deleteAiOperation(runtimeOperationId);
    },
  });
  attachAiOperationController(runtimeOperationId, {
    abort: async (reason = 'Chat request aborted by supervisor') => {
      if (streamSettled) return;
      streamSettled = true;
      clearInterval(heartbeat);
      clearTimeout(sseSafetyTimeout);
      updateAiOperation(runtimeOperationId, {
        phase: 'aborting',
        lastError: {
          code: 'AUTO_ABORT',
          message: reason,
          detail: '',
        },
      });
      if (cleanupFn) cleanupFn();
      if (conversation.caseIntake && conversation.caseIntake.status === 'analyst-running') {
        conversation.caseIntake = failCaseIntakeAnalystRun(conversation.caseIntake, {
          provider: policy.primaryProvider,
          model: primaryTraceModel,
          traceId: trace ? trace._id.toString() : null,
          error: {
            code: 'AUTO_ABORT',
            message: reason,
          },
          evidenceReceipt: {
            attempted: true,
            completed: false,
            failed: true,
            messageSaved: false,
            thinkingCaptured: false,
            traceId: trace ? trace._id.toString() : '',
            requestId: req.requestId,
            provider: policy.primaryProvider,
            packageCaptureEnabled,
            errorCode: 'AUTO_ABORT',
            completedAt: new Date(),
            reportedVia: 'server',
          },
          completedAt: new Date(),
        });
        conversation.markModified?.('caseIntake');
        await saveConversationLenient(conversation).catch(() => {});
      }
      try {
        res.write('event: error\ndata: ' + JSON.stringify({
          error: reason,
          code: 'AUTO_ABORT',
          caseIntake: conversation.caseIntake || null,
        }) + '\n\n');
        res.end();
      } catch { /* client disconnected */ }
      deleteAiOperation(runtimeOperationId);
    },
  });
  if (responseClosed && cleanupFn && !streamSettled) cleanupFn();
});

// POST /api/chat/retry -- Retry last message in a conversation (removes bad assistant response, re-sends)
chatRouter.post('/retry', retryRateLimit, async (req, res) => {
  const {
    conversationId,
    provider, // backward-compat alias
    mode,
    primaryProvider,
    primaryModel,
    fallbackProvider,
    fallbackModel,
    parallelProviders,
    agentRuntime,
    timeoutMs,
    settings: rawSettings,
  } = req.body || {};
  const reasoningEffort = req.body?.reasoningEffort;
  const runtimeSettings = normalizeChatRuntimeSettings(rawSettings);
  const retryPackageCaptureEnabled = isProviderCallPackageCaptureEnabled();

  if (!conversationId) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'conversationId required' });
  }
  if (!isValidObjectId(conversationId)) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_CONVERSATION_ID',
      error: 'conversationId must be a valid ObjectId',
    });
  }
  if (primaryModel !== undefined && typeof primaryModel !== 'string') {
    return res.status(400).json({ ok: false, code: 'INVALID_MODEL', error: 'primaryModel must be a string' });
  }
  if (fallbackModel !== undefined && typeof fallbackModel !== 'string') {
    return res.status(400).json({ ok: false, code: 'INVALID_MODEL', error: 'fallbackModel must be a string' });
  }
  const retryValidationError = getChatGenerationValidationError({
    provider,
    primaryProvider,
    fallbackProvider,
    mode,
    parallelProviders,
    isValidProvider,
  });
  if (retryValidationError) {
    return res.status(retryValidationError.status).json(retryValidationError.body);
  }

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }
  ensureMessagesArray(conversation);

  // Build retry context from a non-mutating snapshot. We only persist removals
  // after policy/guardrail checks pass.
  const retryMessages = ensureMessagesArray(conversation).slice();
  let removedAnyAssistant = false;
  while (retryMessages.length > 0) {
    const lastMsg = retryMessages[retryMessages.length - 1];
    if (lastMsg.role !== 'assistant') break;
    retryMessages.pop();
    removedAnyAssistant = true;
  }

  // Find the last user message to re-send
  const lastUserMsg = [...retryMessages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) {
    return res.status(400).json({ ok: false, code: 'NO_USER_MSG', error: 'No user message to retry' });
  }
  await learnFromInteraction(lastUserMsg, { surface: 'chat' }).catch(() => {});
  await recordAgentActivity(CHAT_ACTIVITY_AGENT_ID, {
    type: 'message',
    phase: 'retry-input',
    status: 'received',
    summary: 'Main chat started a retry from the latest user message.',
    detail: lastUserMsg.content,
    metadata: {
      retry: true,
      conversationId: conversation._id.toString(),
    },
  }, {
    surface: 'chat',
    conversationId: conversation._id.toString(),
  }).catch(() => {});
  const normalizedImagesResult = normalizeChatImages(lastUserMsg.images || []);
  if (!normalizedImagesResult.ok) {
    return res.status(400).json({
      ok: false,
      code: normalizedImagesResult.code,
      error: normalizedImagesResult.error,
    });
  }
  const normalizedImages = normalizedImagesResult.images;
  if (normalizedImages.length > 0) {
    return res.status(400).json({
      ok: false,
      code: 'CHAT_IMAGES_DISABLED',
      error: 'This conversation turn includes an image. Re-run the screenshot or webcam capture through the Image Parser, then retry with text only.',
    });
  }
  const normalizedClientImageMeta = Array.isArray(lastUserMsg.imageMeta) ? lastUserMsg.imageMeta : [];

  const contextSourceMessages = retryMessages.map((m) => normalizeMessageForModel(m));
  const {
    contextBundle,
    effectiveReasoningEffort,
    effectiveTimeoutMs,
    guardrail,
    policy: resolvedPolicy,
    policyError,
    requestedFallback,
    requestedFallbackModel,
    requestedMode,
    requestedPrimaryModel,
    requestedPrimaryProvider,
  } = await prepareChatRequest({
    conversationProvider: conversation.provider,
    requestedProvider: provider,
    requestedPrimaryProvider: primaryProvider,
    requestedPrimaryModel: primaryModel,
    requestedFallbackProvider: fallbackProvider,
    requestedFallbackModel: fallbackModel,
    requestedParallelProviders: parallelProviders,
    requestedMode: mode,
    timeoutMs,
    runtimeSettings,
    reasoningEffort,
    normalizedMessages: contextSourceMessages,
  });
  if (policyError) {
    return res.status(policyError.status).json(policyError.body);
  }
  // Same analyst auto-failover layering as the main send path so retries keep
  // the QBO Assistant profile's resilient backup.
  const analystIdentity = await getAgentIdentity('chat').catch(() => null);
  const policy = resolveAnalystFailoverPolicy(resolvedPolicy, analystIdentity?.runtime || null);
  const primaryTraceModel = resolveRequestedModel(policy.primaryProvider, policy.primaryModel);
  const fallbackTraceModel = resolveRequestedModel(policy.fallbackProvider, policy.fallbackModel);

  const traceStartedAt = new Date();
  const trace = await createTrace({
    requestId: req.requestId,
    service: 'chat',
    route: '/api/chat/retry',
    turnKind: 'retry',
    conversationId: conversation._id,
    promptPreview: safeString(lastUserMsg && lastUserMsg.content, ''),
    messageLength: safeString(lastUserMsg && lastUserMsg.content, '').length,
    normalizedImages,
    clientImageMeta: normalizedClientImageMeta,
    requested: {
      mode: requestedMode,
      reasoningEffort: effectiveReasoningEffort,
      timeoutMs: effectiveTimeoutMs,
      primaryProvider: requestedPrimaryProvider,
      primaryModel: requestedPrimaryModel,
      fallbackProvider: requestedFallback,
      fallbackModel: requestedFallbackModel,
      parallelProviders: parallelProviders || [],
    },
    resolved: {
      mode: policy.mode,
      reasoningEffort: effectiveReasoningEffort,
      timeoutMs: effectiveTimeoutMs,
      primaryProvider: policy.primaryProvider,
      primaryModel: policy.primaryModel,
      fallbackProvider: policy.fallbackProvider,
      fallbackModel: policy.fallbackModel,
      parallelProviders: policy.parallelProviders || [],
    },
  }).catch(() => null);
  await appendTraceEvent(trace?._id, {
    key: 'retry_received',
    label: 'Retry request received',
    status: 'info',
    provider: policy.primaryProvider,
    model: primaryTraceModel,
    message: `Retry queued for ${policy.primaryProvider}.`,
  }, traceStartedAt);
  await appendTraceEvent(trace?._id, {
    key: 'context_built',
    label: 'Retry context built',
    status: 'info',
    message: `Prepared ${contextBundle.messagesForModel.length} message(s) for retry.`,
    detail: {
      knowledgeMode: contextBundle.contextDebug?.knowledgeMode || '',
      estimatedInputTokens: contextBundle.contextDebug?.budgets?.estimatedInputTokens || 0,
    },
  }, traceStartedAt);

  if (guardrail.blocked) {
    await appendTraceEvent(trace?._id, {
      key: 'guardrail_blocked',
      label: 'Budget guardrail blocked retry',
      status: 'error',
      code: guardrail.blockCode || 'BUDGET_GUARDRAIL_BLOCKED',
      message: guardrail.blockError || 'Budget guardrail blocked request',
      detail: guardrail.costEstimate || null,
    }, traceStartedAt);
    await patchTrace(trace?._id, {
      status: 'error',
      outcome: buildOutcome({
        providerUsed: policy.primaryProvider,
        modelUsed: primaryTraceModel,
        totalMs: Date.now() - traceStartedAt.getTime(),
        completedAt: new Date(),
        errorCode: guardrail.blockCode || 'BUDGET_GUARDRAIL_BLOCKED',
        errorMessage: guardrail.blockError || 'Budget guardrail blocked request',
      }),
    });
    return res.status(429).json({
      ok: false,
      code: guardrail.blockCode || 'BUDGET_GUARDRAIL_BLOCKED',
      error: guardrail.blockError || 'Budget guardrail blocked request',
      warnings: guardrail.warnings,
      costEstimate: guardrail.costEstimate,
    });
  }

  if (policy.mode === 'parallel') {
    if (!isParallelModeEnabled()) {
      await appendTraceEvent(trace?._id, {
        key: 'parallel_disabled',
        label: 'Parallel mode disabled',
        status: 'error',
        code: 'PARALLEL_MODE_DISABLED',
        message: 'Parallel mode is disabled',
      }, traceStartedAt);
      await patchTrace(trace?._id, {
        status: 'error',
        outcome: buildOutcome({
          providerUsed: policy.primaryProvider,
          modelUsed: primaryTraceModel,
          totalMs: Date.now() - traceStartedAt.getTime(),
          completedAt: new Date(),
          errorCode: 'PARALLEL_MODE_DISABLED',
          errorMessage: 'Parallel mode is disabled',
        }),
      });
      return res.status(409).json({
        ok: false,
        code: 'PARALLEL_MODE_DISABLED',
        error: 'Parallel mode is disabled',
      });
    }
    const openTurnLimit = getParallelOpenTurnLimit();
    const openTurnCount = await ParallelCandidateTurn.countDocuments({ service: 'chat', status: 'open' });
    if (openTurnCount >= openTurnLimit) {
      await appendTraceEvent(trace?._id, {
        key: 'parallel_limit',
        label: 'Parallel turn limit reached',
        status: 'error',
        code: 'PARALLEL_TURN_LIMIT',
        message: `Parallel open-turn limit reached (${openTurnLimit})`,
      }, traceStartedAt);
      await patchTrace(trace?._id, {
        status: 'error',
        outcome: buildOutcome({
          providerUsed: policy.primaryProvider,
          modelUsed: primaryTraceModel,
          totalMs: Date.now() - traceStartedAt.getTime(),
          completedAt: new Date(),
          errorCode: 'PARALLEL_TURN_LIMIT',
          errorMessage: `Parallel open-turn limit reached (${openTurnLimit})`,
        }),
      });
      return res.status(429).json({
        ok: false,
        code: 'PARALLEL_TURN_LIMIT',
        error: `Parallel open-turn limit reached (${openTurnLimit})`,
      });
    }
  }

  // Set up SSE headers IMMEDIATELY so the client knows the connection is alive
  // before the potentially slow triage parse begins.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Only read the image-parser profile when an image is actually being parsed.
  const imageParserBackup = req.body.imageParserProvider
    ? await resolveImageParserProfileBackup()
    : { fallbackProvider: '', fallbackModel: '' };

  const {
    effectiveSystemPrompt,
    imageTranscription,
    imageTriageContext,
    invMatchResult,
    nonEscalationIntent,
  } = await buildChatImageAugmentation({
    normalizedImages,
    messageText: safeString(lastUserMsg && lastUserMsg.content, ''),
    baseSystemPrompt: contextBundle.systemPrompt,
    emitStatus: async (statusMessage) => {
      try {
        const payload = statusMessage && typeof statusMessage === 'object'
          ? { type: 'status', ...statusMessage }
          : { type: 'status', message: statusMessage };
        res.write('event: status\ndata: ' + JSON.stringify(payload) + '\n\n');
      } catch { /* client disconnected */ }
    },
    onTranscriptionStart: async (stageMeta) => {
      const traceProvider = safeString(stageMeta?.provider, policy.primaryProvider);
      const traceModel = safeString(stageMeta?.model, '') || getProviderModelId(traceProvider);
      await appendTraceEvent(trace?._id, {
        key: 'transcription_started',
        label: 'Image transcription started',
        status: 'info',
        provider: traceProvider,
        model: traceModel,
        message: 'Running dedicated image parser transcription.',
      }, traceStartedAt);
    },
    onTranscriptionComplete: async (transcription) => {
      const traceProvider = safeString(transcription?.providerUsed, policy.primaryProvider);
      const traceModel = safeString(transcription?.model, '') || getProviderModelId(traceProvider);
      await appendTraceEvent(trace?._id, {
        key: transcription ? 'transcription_completed' : 'transcription_failed',
        label: transcription ? 'Image transcription completed' : 'Image transcription failed',
        status: transcription ? 'success' : 'warning',
        provider: traceProvider,
        model: traceModel,
        message: transcription
          ? `Image transcribed in ${transcription.elapsedMs || 0}ms (${(transcription.text || '').length} chars).`
          : 'Image transcription failed — chat continued without screenshot parsing.',
      }, traceStartedAt);
    },
    onKnownIssueStart: async (stageMeta) => {
      const traceProvider = safeString(stageMeta?.provider, policy.primaryProvider);
      const traceModel = safeString(stageMeta?.model, '') || getProviderModelId(traceProvider);
      await appendTraceEvent(trace?._id, {
        key: 'known_issue_search_started',
        label: 'INV Search Agent started',
        status: 'info',
        provider: traceProvider,
        model: traceModel,
        message: 'Searching active INV investigations before triage.',
      }, traceStartedAt);
    },
    imageParserConfig: req.body.imageParserProvider
      ? {
          provider: req.body.imageParserProvider,
          model: req.body.imageParserModel || undefined,
          reasoningEffort: req.body.imageParserReasoningEffort || undefined,
          serviceTier: req.body.imageParserServiceTier || undefined,
          promptId: req.body.imageParserPromptId || 'escalation-template-parser',
          // Wave 2 universal failover: carry the image-parser agent's backup so
          // the chat image-parse leg fails over BEFORE the generic-transcription
          // last resort. An explicit request fallback wins; otherwise the
          // image-analyst profile's CONFIGURED backup is used (resolved
          // server-side — no client sends it). parseImage still defaults to the
          // neutral global alternate when neither is set. No capability filtering.
          fallbackProvider: req.body.imageParserFallbackProvider || imageParserBackup.fallbackProvider || '',
          fallbackModel: req.body.imageParserFallbackModel || imageParserBackup.fallbackModel || '',
          agentRuntime,
        }
      : null,
    triageAgentRuntime: agentRuntime,
    fallbackPolicy: policy,
  });
  const useSharedAgentTools = policy.mode !== 'parallel' && !runtimeSettings.debug.disableSharedAgentTools;
  const orchestrationSystemPrompt = await buildMainChatSystemPrompt(effectiveSystemPrompt, useSharedAgentTools);
  if (invMatchResult.matches.length > 0) {
    await appendTraceEvent(trace?._id, {
      key: 'inv_match_completed',
      label: 'INV matching completed',
      status: 'success',
      message: `${invMatchResult.matches.length} known issue(s) matched.`,
    }, traceStartedAt);
  } else if (imageTriageContext?.knownIssueSearchResult) {
    await appendTraceEvent(trace?._id, {
      key: 'known_issue_search_completed',
      label: 'INV Search Agent completed',
      status: imageTriageContext.knownIssueSearchResult.ok ? 'success' : 'warning',
      message: imageTriageContext.knownIssueSearchResult.summary || 'Known issue search completed without a matched INV.',
      detail: imageTriageContext.knownIssueSearchResult.validation || null,
    }, traceStartedAt);
  }

  let shouldSaveConversation = false;
  if (removedAnyAssistant) {
    conversation.set('messages', retryMessages);
    shouldSaveConversation = true;
  }
  if (conversation.provider !== policy.primaryProvider) {
    conversation.provider = policy.primaryProvider;
    shouldSaveConversation = true;
  }
  if (shouldSaveConversation) {
    await saveConversationLenient(conversation);
  }
  const requestTurnId = policy.mode === 'parallel' ? randomUUID() : null;

  if (requestTurnId) {
    try {
      // Expire any existing open parallel turns for this conversation before creating a new one
      await ParallelCandidateTurn.updateMany(
        { conversationId: conversation._id, status: 'open' },
        { $set: { status: 'expired' } }
      );
      const candidateProviders = policy.parallelProviders || [policy.primaryProvider, policy.fallbackProvider];
      await ParallelCandidateTurn.create({
        turnId: requestTurnId,
        service: 'chat',
        conversationId: conversation._id,
        status: 'open',
        requestedProviders: candidateProviders,
        candidates: candidateProviders
          .map((p) => ({ provider: p, state: 'ok', content: '' }))
          .filter((c, index, arr) => arr.findIndex((x) => x.provider === c.provider) === index),
      });
    } catch {
      // non-blocking for chat flow
    }
  }

  const contextDebugPayload = buildContextDebugPayload(runtimeSettings, contextBundle.contextDebug, guardrail.costEstimate);
  let responseClosed = false;

  await appendTraceEvent(trace?._id, {
    key: 'request_accepted',
    label: 'Retry accepted',
    status: 'info',
    provider: policy.primaryProvider,
    model: primaryTraceModel,
    message: 'SSE stream opened and retry accepted by the server.',
  }, traceStartedAt);
  res.write('event: start\ndata: ' + JSON.stringify({
    conversationId: conversation._id.toString(),
    requestId: req.requestId,
    traceId: trace ? trace._id.toString() : null,
    retry: true,
    provider: policy.primaryProvider, // backward-compat
    primaryProvider: policy.primaryProvider,
    primaryModel: policy.primaryModel || null,
    fallbackProvider: policy.fallbackProvider || null,
    fallbackModel: policy.fallbackModel || null,
    parallelProviders: policy.mode === 'parallel' ? (policy.parallelProviders || [policy.primaryProvider, policy.fallbackProvider]) : null,
    mode: policy.mode,
    turnId: requestTurnId,
    warnings: guardrail.warnings || [],
    contextDebug: contextDebugPayload,
  }) + '\n\n');
  // Emit transcription result SSE for retry handler.
  if (imageTranscription && imageTranscription.text && !responseClosed) {
    try {
      res.write('event: image_transcription\ndata: ' + JSON.stringify({
        text: imageTranscription.text,
        elapsedMs: imageTranscription.elapsedMs || 0,
        charCount: imageTranscription.text.length,
      }) + '\n\n');
    } catch { /* client disconnected */ }
  }
  // Triage now runs through the standalone /api/triage harness. /api/chat/retry
  // keeps parser + INV context for the analyst answer but does not emit triage cards.
  // Emit INV matches SSE event (retry handler).
  if (!responseClosed && invMatchResult.ssePayload.length > 0) {
    try {
      res.write('event: inv_matches\ndata: ' + JSON.stringify(invMatchResult.ssePayload) + '\n\n');
    } catch { /* gone */ }
  }

  const turnStartedAt = Date.now();
  const retryRequestId = req.requestId;
  let retryStreamSettled = false;
  const traceStats = {
    chunkCount: 0,
    chunkChars: 0,
    thinkingChunkCount: 0,
    providerErrors: 0,
    fallbacks: 0,
  };
  let firstThinkingMs = 0;
  let firstChunkMs = 0;
  const retryRuntimeOperation = createAiOperation({
    kind: 'chat',
    route: '/api/chat/retry',
    action: 'chat-retry',
    provider: policy.primaryProvider,
    mode: policy.mode,
    conversationId: conversation._id.toString(),
    promptPreview: safeString(lastUserMsg && lastUserMsg.content, ''),
    hasImages: normalizedImages.length > 0,
    messageCount: contextBundle.messagesForModel.length,
    providers: (policy.parallelProviders || [policy.primaryProvider, policy.fallbackProvider]).filter(Boolean),
  });
  const retryRuntimeOperationId = retryRuntimeOperation.id;

  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* gone */ }
  }, 15000);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  // SSE safety timeout — force-close if retry stream never settles
  const sseSafetyTimeout = setTimeout(async () => {
    if (retryStreamSettled || responseClosed) return;
    console.error('[chat/retry] SSE safety timeout hit after %dms — force-closing hung stream', SSE_SAFETY_TIMEOUT_MS);
    retryStreamSettled = true;
    clearInterval(heartbeat);
    await persistRetryAnalystFailure(conversation, {
      provider: policy.primaryProvider,
      model: primaryTraceModel,
      traceId: trace ? trace._id.toString() : '',
      requestId: req.requestId,
      packageCaptureEnabled: retryPackageCaptureEnabled,
      errorCode: 'SSE_STREAM_TIMEOUT',
      errorMessage: 'Request timed out - please try again',
    });
    try {
      res.write('event: error\ndata: ' + JSON.stringify({
        error: 'Request timed out — please try again',
        code: 'SSE_STREAM_TIMEOUT',
      }) + '\n\n');
      res.end();
    } catch { /* client already gone */ }
    if (cleanupFn) {
      try { cleanupFn(); } catch { /* ignore */ }
    }
  }, SSE_SAFETY_TIMEOUT_MS);
  if (typeof sseSafetyTimeout.unref === 'function') sseSafetyTimeout.unref();

  const cleanupFn = startMainChatExecution({
    useAgentTools: useSharedAgentTools,
    policy,
    messages: contextBundle.messagesForModel,
    systemPrompt: orchestrationSystemPrompt,
    reasoningEffort: effectiveReasoningEffort,
    timeoutMs: effectiveTimeoutMs,
    captureMetadata: buildConversationCaptureMetadata(conversation),
    onChunk: ({ provider: chunkProvider, text }) => {
      recordAiChunk(retryRuntimeOperationId, text, { provider: chunkProvider });
      traceStats.chunkCount += 1;
      traceStats.chunkChars += typeof text === 'string' ? text.length : 0;
      if (!firstChunkMs) {
        firstChunkMs = Date.now() - turnStartedAt;
        appendTraceEvent(trace?._id, {
          key: 'first_output',
          label: 'First output chunk',
          status: 'info',
          provider: chunkProvider,
          model: resolveRequestedModel(
            chunkProvider,
            chunkProvider === policy.primaryProvider
              ? policy.primaryModel
              : (chunkProvider === policy.fallbackProvider ? policy.fallbackModel : '')
          ),
          message: `First output chunk arrived from ${chunkProvider}.`,
          elapsedMs: firstChunkMs,
        }, traceStartedAt).catch(() => {});
      }
      try { res.write('event: chunk\ndata: ' + JSON.stringify({ provider: chunkProvider, text }) + '\n\n'); } catch { /* gone */ }
    },
    onThinkingChunk: ({ provider: thinkingProvider, thinking }) => {
      recordAiChunk(retryRuntimeOperationId, thinking, { provider: thinkingProvider, thinking: true });
      traceStats.thinkingChunkCount += 1;
      if (!firstThinkingMs) {
        firstThinkingMs = Date.now() - turnStartedAt;
        appendTraceEvent(trace?._id, {
          key: 'first_thinking',
          label: 'First reasoning chunk',
          status: 'info',
          provider: thinkingProvider,
          model: resolveRequestedModel(
            thinkingProvider,
            thinkingProvider === policy.primaryProvider
              ? policy.primaryModel
              : (thinkingProvider === policy.fallbackProvider ? policy.fallbackModel : '')
          ),
          message: `First reasoning chunk arrived from ${thinkingProvider}.`,
          elapsedMs: firstThinkingMs,
        }, traceStartedAt).catch(() => {});
      }
      try { res.write('event: thinking\ndata: ' + JSON.stringify({ provider: thinkingProvider, thinking }) + '\n\n'); } catch { /* gone */ }
    },
    onProviderError: (data) => {
      recordAgentActivity(CHAT_ACTIVITY_AGENT_ID, {
        type: 'error',
        phase: 'retry-provider-error',
        status: 'error',
        summary: data?.message || 'A main chat retry provider attempt failed.',
        detail: data,
      }, {
        surface: 'chat',
        conversationId: conversation._id.toString(),
      }).catch(() => {});
      traceStats.providerErrors += 1;
      recordAiEvent(retryRuntimeOperationId, 'provider_error', {
        provider: data && data.provider ? data.provider : null,
        lastError: data ? {
          code: data.code || 'PROVIDER_EXEC_FAILED',
          message: data.message || 'Provider failed',
          detail: data.detail || '',
        } : null,
      });
      appendTraceEvent(trace?._id, {
        key: 'provider_error',
        label: 'Provider attempt failed',
        status: 'error',
        provider: data && data.provider ? data.provider : '',
        model: safeString(data && data.model, '') || getProviderModelId(data && data.provider ? data.provider : ''),
        code: data && data.code ? data.code : 'PROVIDER_EXEC_FAILED',
        message: data && data.message ? data.message : 'Provider failed',
        detail: data || null,
      }, traceStartedAt).catch(() => {});
      try { res.write('event: provider_error\ndata: ' + JSON.stringify(data) + '\n\n'); } catch { /* gone */ }
    },
    onFallback: (data) => {
      recordAgentActivity(CHAT_ACTIVITY_AGENT_ID, {
        type: 'fallback',
        phase: 'retry-provider-fallback',
        status: 'warning',
        summary: `${data && data.from ? data.from : 'primary'} -> ${data && data.to ? data.to : 'fallback'}`,
        detail: {
          retry: true,
          ...data,
        },
      }, {
        surface: 'chat',
        conversationId: conversation._id.toString(),
      }).catch(() => {});
      traceStats.fallbacks += 1;
      recordAiEvent(retryRuntimeOperationId, 'fallback', {
        provider: data && data.from ? data.from : null,
        to: data && data.to ? data.to : null,
      });
      appendTraceEvent(trace?._id, {
        key: 'fallback',
        label: 'Fallback engaged',
        status: 'warning',
        provider: data && data.to ? data.to : '',
        model: safeString(data && data.toModel, '') || getProviderModelId(data && data.to ? data.to : ''),
        code: data && data.reason ? data.reason : 'PROVIDER_ERROR',
        message: `${data && data.from ? data.from : 'primary'} -> ${data && data.to ? data.to : 'fallback'}`,
        detail: data || null,
      }, traceStartedAt).catch(() => {});
      try { res.write('event: fallback\ndata: ' + JSON.stringify(data) + '\n\n'); } catch { /* gone */ }
    },
    onStatus: (status) => {
      recordAgentActivity(CHAT_ACTIVITY_AGENT_ID, {
        type: 'status',
        phase: status?.phase || status?.type || 'status',
        status: status?.type || 'info',
        summary: status?.message || 'Main chat retry emitted a status update.',
        detail: {
          retry: true,
          ...status,
        },
      }, {
        surface: 'chat',
        conversationId: conversation._id.toString(),
      }).catch(() => {});
      try {
        res.write('event: status\ndata: ' + JSON.stringify(status) + '\n\n');
      } catch { /* gone */ }
    },
    onDone: async (data) => {
      retryStreamSettled = true;
      clearInterval(heartbeat);
      clearTimeout(sseSafetyTimeout);
      recordAiEvent(retryRuntimeOperationId, 'saving', {
        provider: data && data.providerUsed ? data.providerUsed : policy.primaryProvider,
      });
      const latencyMs = Date.now() - turnStartedAt;
      // imageTriageContext is already resolved in the outer scope (awaited before orchestration).
      // Skip response compliance rewriting for non-escalation intents.
      const compliantData = (imageTriageContext && !nonEscalationIntent)
        ? applyImageResponseCompliance(data, imageTriageContext)
        : { ...data, responseRepaired: false };
      const attempts = compliantData.attempts || [];
      const providerThinking = normalizeProviderThinking(compliantData.providerThinking);
      logAttemptsUsage(attempts, { requestId: retryRequestId, service: 'chat', conversationId: conversation._id, mode: compliantData.mode || policy.mode });
      logChatTurn({
        route: '/api/chat/retry',
        conversationId: conversation._id.toString(),
        mode: compliantData.mode || policy.mode,
        requestedMode,
        requestedPrimaryProvider,
        providerUsed: compliantData.providerUsed,
        fallbackUsed: Boolean(compliantData.fallbackUsed),
        fallbackReasonCode: deriveFallbackReasonCode(compliantData.fallbackFrom, attempts),
        latencyMs,
        errorCode: null,
        attempts: attempts.length,
      });
      // Extract quick-action suggestions from the final response text (non-parallel only)
      const quickActions = (compliantData.mode !== 'parallel')
        ? extractQuickActions(compliantData.fullResponse)
        : [];

      try {
        if (compliantData.mode === 'parallel' && Array.isArray(compliantData.results)) {
          const turnId = compliantData.turnId || requestTurnId || randomUUID();
          const hasSuccessful = compliantData.results.some((r) => r.status === 'ok');
          try {
            await ParallelCandidateTurn.findOneAndUpdate(
              { turnId },
              {
                $set: {
                  service: 'chat',
                  conversationId: conversation._id,
                  status: hasSuccessful ? 'open' : 'expired',
                  candidates: compliantData.results.map(toCandidateFromResult),
                  attempts: compliantData.attempts || [],
                },
              },
              { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
            );
          } catch {
            // non-blocking for chat flow
          }
          const successful = compliantData.results.filter((r) => r.status === 'ok' && typeof r.fullResponse === 'string');
          for (const result of successful) {
            conversation.messages.push({
              role: 'assistant',
              content: result.fullResponse,
              thinking: getProviderThinking(providerThinking, result.provider, result.thinking || ''),
              provider: result.provider,
              modelUsed: safeString(result.modelUsed, '') || (result.usage && result.usage.model) || getProviderModelId(result.provider),
              mode: compliantData.mode || policy.mode,
              fallbackFrom: null,
              traceRequestId: req.requestId,
              attemptMeta: {
                attempts: compliantData.attempts || [],
                parallel: true,
                turnId,
                ...(Object.keys(providerThinking).length > 0 ? { providerThinking } : {}),
              },
              usage: buildUsageSubdoc(result.usage),
              timestamp: new Date(),
            });
          }
        } else {
          conversation.messages.push({
            role: 'assistant',
            content: compliantData.fullResponse,
            thinking: getProviderThinking(providerThinking, compliantData.providerUsed, compliantData.thinking || ''),
            provider: compliantData.providerUsed,
            modelUsed: safeString(compliantData.modelUsed, '') || (compliantData.usage && compliantData.usage.model) || getProviderModelId(compliantData.providerUsed || policy.primaryProvider),
            mode: compliantData.mode || policy.mode,
            fallbackFrom: compliantData.fallbackFrom || null,
            traceRequestId: req.requestId,
            attemptMeta: {
              attempts: compliantData.attempts || [],
              ...(Object.keys(providerThinking).length > 0 ? { providerThinking } : {}),
              ...(quickActions.length > 0 ? { quickActions } : {}),
            },
            usage: buildUsageSubdoc(compliantData.usage),
            timestamp: new Date(),
          });
        }
        await learnFromInteraction({
          role: 'assistant',
          agentId: 'chat',
          content: compliantData.fullResponse,
        }, { surface: 'chat' }).catch(() => {});
        await recordAgentActivity(CHAT_ACTIVITY_AGENT_ID, {
          type: 'response',
          phase: 'retry-done',
          status: 'ok',
          summary: 'Main chat finished a retry response.',
          detail: {
            retry: true,
            content: compliantData.fullResponse,
            providerUsed: compliantData.providerUsed || null,
            modelUsed: compliantData.modelUsed || null,
            usage: compliantData.usage || null,
            fallbackUsed: Boolean(compliantData.fallbackUsed),
            attempts: attempts.length,
            toolIterations: compliantData.toolIterations || 0,
            durationMs: latencyMs,
          },
        }, {
          surface: 'chat',
          conversationId: conversation._id.toString(),
        }).catch(() => {});
        if (Array.isArray(compliantData.toolActions) && compliantData.toolActions.length > 0) {
          await recordAgentToolUsage('chat', compliantData.toolActions, { surface: 'chat' }).catch(() => {});
        }
        if (conversation.caseIntake?.status && conversation.caseIntake.status !== 'none') {
          conversation.caseIntake = completeCaseIntakeAnalystRun(conversation.caseIntake, {
            provider: compliantData.providerUsed || policy.primaryProvider,
            model: safeString(compliantData.modelUsed, '')
              || (compliantData.usage && compliantData.usage.model)
              || getProviderModelId(compliantData.providerUsed || policy.primaryProvider),
            traceId: trace ? trace._id.toString() : null,
            summary: 'Deep support guidance completed after retry.',
            detail: {
              usage: compliantData.usage || null,
              fallbackUsed: Boolean(compliantData.fallbackUsed),
              fallbackFrom: compliantData.fallbackFrom || null,
              attempts: attempts.length,
              retry: true,
            },
            evidenceReceipt: {
              attempted: true,
              completed: true,
              failed: false,
              messageSaved: true,
              thinkingCaptured: Boolean(
                safeString(compliantData.thinking, '').trim()
                || Object.values(providerThinking).some((value) => safeString(value, '').trim())
              ),
              traceId: trace ? trace._id.toString() : '',
              requestId: req.requestId,
              provider: compliantData.providerUsed || policy.primaryProvider,
              packageCaptureEnabled: retryPackageCaptureEnabled,
              errorCode: '',
              completedAt: new Date(),
              reportedVia: 'server',
            },
            completedAt: new Date(),
          });
          conversation.markModified?.('caseIntake');
        }
        await saveConversationLenient(conversation);
        await setTraceAttempts(trace?._id, attempts);
        await setTraceUsage(trace?._id, compliantData.usage);
        await patchTrace(trace?._id, {
          status: 'ok',
          responseChars: sumResponseChars(compliantData),
          stats: buildTraceStats(traceStats),
          outcome: buildOutcome({
            providerUsed: compliantData.providerUsed || policy.primaryProvider,
            modelUsed: safeString(compliantData.modelUsed, '') || (compliantData.usage && compliantData.usage.model) || getProviderModelId(compliantData.providerUsed || policy.primaryProvider),
            winner: compliantData.providerUsed || policy.primaryProvider,
            fallbackUsed: Boolean(compliantData.fallbackUsed),
            fallbackFrom: compliantData.fallbackFrom || null,
            responseRepaired: Boolean(compliantData.responseRepaired),
            totalMs: latencyMs,
            firstThinkingMs,
            firstChunkMs,
            completedAt: new Date(),
          }),
        });
        await appendTraceEvent(trace?._id, {
          key: 'conversation_saved',
          label: 'Retry saved',
          status: 'success',
          provider: compliantData.providerUsed || policy.primaryProvider,
          model: safeString(compliantData.modelUsed, '') || (compliantData.usage && compliantData.usage.model) || getProviderModelId(compliantData.providerUsed || policy.primaryProvider),
          message: `Saved retried response in ${latencyMs}ms.`,
          elapsedMs: latencyMs,
          detail: {
            attempts: attempts.length,
            responseRepaired: Boolean(compliantData.responseRepaired),
            usage: summarizeUsage(compliantData.usage),
          },
        }, traceStartedAt);

        // Fire-and-forget: archive images to disk with full metadata (retry)
        if (normalizedImages.length > 0) {
          try {
            const retryUserMsgIndex = conversation.messages.length - (
              compliantData.mode === 'parallel' && Array.isArray(compliantData.results)
                ? compliantData.results.filter((r) => r.status === 'ok').length + 1
                : 2
            );
            const retryArchiveModelParsing = safeString(imageTranscription && imageTranscription.text, '')
              || compliantData.fullResponse
              || (Array.isArray(compliantData.results) && compliantData.results.find((r) => r.status === 'ok')?.fullResponse)
              || '';
            archiveImages({
              conversationId: conversation._id.toString(),
              messageIndex: Math.max(0, retryUserMsgIndex),
              images: normalizedImages,
              userPrompt: safeString(lastUserMsg && lastUserMsg.content, ''),
              modelParsing: retryArchiveModelParsing,
              thinking: '',
              parseFields: imageTriageContext && imageTriageContext.parseFields ? imageTriageContext.parseFields : null,
              triageCard: imageTriageContext && imageTriageContext.triageCard ? imageTriageContext.triageCard : null,
              provider: safeString(
                imageTranscription && imageTranscription.providerUsed,
                (imageTriageContext && imageTriageContext.parseMeta && imageTriageContext.parseMeta.providerUsed)
                  || compliantData.providerUsed
                  || policy.primaryProvider
              ),
              usage: (imageTranscription && imageTranscription.usage) || compliantData.usage || null,
              timestamp: lastUserMsg && lastUserMsg.timestamp ? lastUserMsg.timestamp : new Date(),
            });
          } catch (archiveErr) {
            console.warn('[image-archive] Failed to archive retry images:', archiveErr.message);
          }
        }

        try {
          const retryUsagePayload = buildUsageSubdoc(compliantData.usage);
          const retryResponseModelUsed = safeString(compliantData.modelUsed, '')
            || (compliantData.usage && compliantData.usage.model)
            || getProviderModelId(compliantData.providerUsed || policy.primaryProvider);
          res.write('event: done\ndata: ' + JSON.stringify({
            conversationId: conversation._id.toString(),
            traceId: trace ? trace._id.toString() : null,
            provider: compliantData.mode === 'parallel' ? policy.primaryProvider : compliantData.providerUsed, // backward-compat
            providerUsed: compliantData.providerUsed,
            modelUsed: retryResponseModelUsed || null,
            fallbackUsed: compliantData.fallbackUsed,
            fallbackFrom: compliantData.fallbackFrom || null,
            mode: compliantData.mode || policy.mode,
            turnId: compliantData.mode === 'parallel' ? (compliantData.turnId || requestTurnId) : null,
            attempts: compliantData.attempts || [],
            thinking: compliantData.thinking || '',
            providerThinking,
            fullResponse: compliantData.fullResponse,
            results: Array.isArray(compliantData.results) ? compliantData.results.map(r => ({
              ...r,
              usage: buildUsageSubdoc(r.usage),
            })) : null,
            usage: retryUsagePayload,
            usageAvailable: !!compliantData.usage,
            responseRepaired: Boolean(compliantData.responseRepaired),
            warnings: guardrail.warnings || [],
            contextDebug: contextDebugPayload,
            citations: contextBundle.citations || [],
            quickActions,
          }) + '\n\n');
          res.end();
        } catch { /* gone */ }
      } catch (onDoneErr) {
        patchTrace(trace?._id, {
          status: 'error',
          stats: buildTraceStats(traceStats),
          outcome: buildOutcome({
            providerUsed: policy.primaryProvider,
            modelUsed: primaryTraceModel,
            totalMs: Date.now() - turnStartedAt,
            firstThinkingMs,
            firstChunkMs,
            completedAt: new Date(),
            errorCode: 'ONDONE_SAVE_FAILED',
            errorMessage: onDoneErr.message || 'Failed to save retried chat conversation',
          }),
        }).catch(() => {});
        appendTraceEvent(trace?._id, {
          key: 'save_failed',
          label: 'Retry save failed',
          status: 'error',
          provider: policy.primaryProvider,
          model: primaryTraceModel,
          code: 'ONDONE_SAVE_FAILED',
          message: onDoneErr.message || 'Failed to save retried chat conversation',
        }, traceStartedAt).catch(() => {});
        reportServerError({
          route: '/api/chat/retry',
          message: onDoneErr.message || 'Failed to save retried chat conversation',
          code: 'ONDONE_SAVE_FAILED',
          detail: onDoneErr.stack || '',
          severity: 'error',
        });
        await persistRetryAnalystFailure(conversation, {
          provider: policy.primaryProvider,
          model: primaryTraceModel,
          traceId: trace ? trace._id.toString() : '',
          requestId: req.requestId,
          packageCaptureEnabled: retryPackageCaptureEnabled,
          errorCode: 'ONDONE_SAVE_FAILED',
          errorMessage: onDoneErr.message || 'Failed to save retried chat conversation',
          directUpdate: true,
        });
        try {
          res.write('event: error\ndata: ' + JSON.stringify({
            error: onDoneErr.message || 'Failed to save conversation',
            code: 'ONDONE_SAVE_FAILED',
          }) + '\n\n');
          res.end();
        } catch { /* gone */ }
      } finally {
        deleteAiOperation(retryRuntimeOperationId);
      }
    },
    onError: async (err) => {
      retryStreamSettled = true;
      clearInterval(heartbeat);
      clearTimeout(sseSafetyTimeout);
      recordAgentActivity(CHAT_ACTIVITY_AGENT_ID, {
        type: 'error',
        phase: 'retry-error',
        status: 'error',
        summary: err.message || 'Main chat retry failed.',
        detail: {
          retry: true,
          code: err.code || 'PROVIDER_EXEC_FAILED',
          detail: err.detail || '',
          attempts: err.attempts || [],
        },
      }, {
        surface: 'chat',
        conversationId: conversation._id.toString(),
      }).catch(() => {});
      recordAiEvent(retryRuntimeOperationId, 'error', {
        lastError: {
          code: err.code || 'PROVIDER_EXEC_FAILED',
          message: err.message || 'Chat retry failed',
          detail: err.detail || '',
        },
      });
      const latencyMs = Date.now() - turnStartedAt;
      const attempts = err.attempts || [];
      logAttemptsUsage(attempts, { requestId: retryRequestId, service: 'chat', conversationId: conversation._id, mode: policy.mode });
      logChatTurn({
        route: '/api/chat/retry',
        conversationId: conversation._id.toString(),
        mode: policy.mode,
        requestedMode,
        requestedPrimaryProvider,
        providerUsed: null,
        fallbackUsed: false,
        fallbackReasonCode: deriveFallbackReasonCode(null, attempts),
        latencyMs,
        errorCode: err.code || 'PROVIDER_EXEC_FAILED',
        attempts: attempts.length,
      });
      setTraceAttempts(trace?._id, attempts).catch(() => {});
      patchTrace(trace?._id, {
        status: 'error',
        stats: buildTraceStats(traceStats),
        outcome: buildOutcome({
          providerUsed: policy.primaryProvider,
          modelUsed: safeString(err && err.modelUsed, '') || primaryTraceModel,
          totalMs: latencyMs,
          firstThinkingMs,
          firstChunkMs,
          completedAt: new Date(),
          errorCode: err.code || 'PROVIDER_EXEC_FAILED',
          errorMessage: err.message || 'Chat retry failed',
        }),
      }).catch(() => {});
      appendTraceEvent(trace?._id, {
        key: 'request_failed',
        label: 'Retry failed',
        status: 'error',
        provider: policy.primaryProvider,
        model: safeString(err && err.modelUsed, '') || primaryTraceModel,
        code: err.code || 'PROVIDER_EXEC_FAILED',
        message: err.message || 'Chat retry failed',
        detail: {
          attempts,
          firstThinkingMs,
          firstChunkMs,
        },
        elapsedMs: latencyMs,
      }, traceStartedAt).catch(() => {});
      reportServerError({
        route: '/api/chat/retry',
        message: err.message || 'Chat retry failed',
        code: err.code || 'PROVIDER_EXEC_FAILED',
        detail: err.detail || '',
        severity: 'error',
      });
      if (requestTurnId && policy.mode === 'parallel') {
        ParallelCandidateTurn.findOneAndUpdate(
          { turnId: requestTurnId },
          {
            $set: {
              service: 'chat',
              conversationId: conversation._id,
              status: 'expired',
              attempts: err.attempts || [],
              candidates: (err.attempts || []).map((attempt) => ({
                provider: attempt.provider,
                content: '',
                state: attempt.errorCode === 'TIMEOUT' ? 'timeout' : 'error',
                errorCode: attempt.errorCode || '',
                errorMessage: attempt.errorMessage || '',
                errorDetail: attempt.errorDetail || '',
                latencyMs: Number(attempt.latencyMs) || 0,
              })),
            },
          },
          { upsert: true, setDefaultsOnInsert: true }
        ).catch((err2) => console.warn('ParallelCandidateTurn update failed (retry error):', err2.message));
      }
      await persistRetryAnalystFailure(conversation, {
        provider: policy.primaryProvider,
        model: safeString(err && err.modelUsed, '') || primaryTraceModel,
        traceId: trace ? trace._id.toString() : '',
        requestId: req.requestId,
        packageCaptureEnabled: retryPackageCaptureEnabled,
        errorCode: err.code || 'PROVIDER_EXEC_FAILED',
        errorMessage: err.message || 'Chat retry failed',
      });
      try {
        res.write('event: error\ndata: ' + JSON.stringify({
          error: err.message || 'Chat retry failed',
          code: err.code || 'PROVIDER_EXEC_FAILED',
          detail: err.detail || '',
          attempts: err.attempts || [],
          warnings: guardrail.warnings || [],
          contextDebug: contextDebugPayload,
        }) + '\n\n');
        res.end();
      } catch { /* gone */ }
      deleteAiOperation(retryRuntimeOperationId);
    },
    onAbort: async (abortData) => {
      if (retryStreamSettled) return;
      retryStreamSettled = true;
      clearInterval(heartbeat);
      clearTimeout(sseSafetyTimeout);
      recordAiEvent(retryRuntimeOperationId, 'aborting', {
        lastError: {
          code: 'CLIENT_ABORT',
          message: 'Chat retry aborted',
          detail: '',
        },
      });
      logAttemptsUsage(abortData.attempts, { requestId: retryRequestId, service: 'chat', conversationId: conversation._id, mode: policy.mode });
      setTraceAttempts(trace?._id, abortData.attempts || []).catch(() => {});
      patchTrace(trace?._id, {
        status: 'aborted',
        stats: buildTraceStats(traceStats),
        outcome: buildOutcome({
          providerUsed: policy.primaryProvider,
          modelUsed: primaryTraceModel,
          totalMs: Date.now() - turnStartedAt,
          firstThinkingMs,
          firstChunkMs,
          completedAt: new Date(),
          errorCode: 'CLIENT_ABORT',
          errorMessage: 'Chat retry aborted before completion',
        }),
      }).catch(() => {});
      appendTraceEvent(trace?._id, {
        key: 'request_aborted',
        label: 'Retry aborted',
        status: 'warning',
        provider: policy.primaryProvider,
        model: primaryTraceModel,
        code: 'CLIENT_ABORT',
        message: 'Chat retry aborted before completion',
        detail: { attempts: abortData.attempts || [] },
      }, traceStartedAt).catch(() => {});
      await persistRetryAnalystFailure(conversation, {
        provider: policy.primaryProvider,
        model: primaryTraceModel,
        traceId: trace ? trace._id.toString() : '',
        requestId: req.requestId,
        packageCaptureEnabled: retryPackageCaptureEnabled,
        errorCode: 'CLIENT_ABORT',
        errorMessage: 'Chat retry aborted before completion',
      });
      try {
        res.write('event: error\ndata: ' + JSON.stringify({
          error: 'Chat retry aborted before completion',
          code: 'CLIENT_ABORT',
          attempts: abortData.attempts || [],
          warnings: guardrail.warnings || [],
          contextDebug: contextDebugPayload,
        }) + '\n\n');
        res.end();
      } catch { /* gone */ }
      deleteAiOperation(retryRuntimeOperationId);
    },
  });
  attachAiOperationController(retryRuntimeOperationId, {
    abort: async (reason = 'Chat retry aborted by supervisor') => {
      if (retryStreamSettled) return;
      retryStreamSettled = true;
      clearInterval(heartbeat);
      clearTimeout(sseSafetyTimeout);
      updateAiOperation(retryRuntimeOperationId, {
        phase: 'aborting',
        lastError: {
          code: 'AUTO_ABORT',
          message: reason,
          detail: '',
        },
      });
      if (cleanupFn) cleanupFn();
      await persistRetryAnalystFailure(conversation, {
        provider: policy.primaryProvider,
        model: primaryTraceModel,
        traceId: trace ? trace._id.toString() : '',
        requestId: req.requestId,
        packageCaptureEnabled: retryPackageCaptureEnabled,
        errorCode: 'AUTO_ABORT',
        errorMessage: reason,
      });
      try {
        res.write('event: error\ndata: ' + JSON.stringify({
          error: reason,
          code: 'AUTO_ABORT',
        }) + '\n\n');
        res.end();
      } catch { /* gone */ }
      deleteAiOperation(retryRuntimeOperationId);
    },
  });

  // See comment on main chat route — must use res.on('close') not req.on('close').
  res.on('close', () => {
    responseClosed = true;
    clearInterval(heartbeat);
    clearTimeout(sseSafetyTimeout);
    if (!retryStreamSettled) {
      updateAiOperation(retryRuntimeOperationId, {
        clientConnected: false,
        phase: 'aborting',
      });
      appendTraceEvent(trace?._id, {
        key: 'client_disconnected',
        label: 'Client disconnected',
        status: 'warning',
        provider: policy.primaryProvider,
        model: primaryTraceModel,
        code: 'CLIENT_DISCONNECTED',
        message: 'The client connection closed before the retry settled.',
      }, traceStartedAt).catch(() => {});
      if (cleanupFn) cleanupFn();
    }
  });
});

module.exports = chatRouter;
