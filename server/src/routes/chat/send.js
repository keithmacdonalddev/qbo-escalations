'use strict';

const express = require('express');
const { randomUUID } = require('node:crypto');
const Conversation = require('../../models/Conversation');
const Escalation = require('../../models/Escalation');
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
} = require('../../services/chat-request-service');
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

function startMainChatExecution({
  useAgentTools,
  policy,
  messages,
  systemPrompt,
  reasoningEffort,
  timeoutMs,
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
      messages,
      systemPrompt,
      images: [],
      reasoningEffort,
      timeoutMs,
      onChunk,
      onThinkingChunk,
      onProviderError,
      onFallback,
      onDone,
      onError,
    });
  }

  let cancelled = false;
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
      onStatus: handleToolLoopStatus,
      onActions: ({ results }) => {
        const count = Array.isArray(results) ? results.length : 0;
        handleToolLoopStatus({
          type: 'tool_actions',
          message: `Completed ${count} tool action${count === 1 ? '' : 's'}.`,
        });
      },
      isCancelled: () => cancelled,
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
      thinking: '',
      providerThinking: {},
      toolActions: result.actions || [],
      toolIterations: result.iterations || 0,
    });
  }).catch((err) => {
    if (cancelled || err?.code === 'ABORTED') return;
    onError?.(err);
  });

  return () => {
    cancelled = true;
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
    timeoutMs,
    settings: rawSettings,
  } = req.body || {};
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
    policy,
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
    emitStatus: async (statusMessage) => {
      try {
        res.write('event: status\ndata: ' + JSON.stringify({ type: 'status', message: statusMessage }) + '\n\n');
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
    onTriageStart: async (stageMeta) => {
      const traceProvider = safeString(stageMeta?.provider, policy.primaryProvider);
      const traceModel = safeString(stageMeta?.model, '') || getProviderModelId(traceProvider);
      await appendTraceEvent(trace?._id, {
        key: 'triage_started',
        label: 'Image triage started',
        status: 'info',
        provider: traceProvider,
        model: traceModel,
        message: 'Deriving structured escalation fields from image parser output.',
      }, traceStartedAt);
    },
    imageParserConfig: req.body.imageParserProvider
      ? { provider: req.body.imageParserProvider, model: req.body.imageParserModel || undefined }
      : null,
    parsedEscalationText: safeString(parsedEscalationSource, '') === 'image-parser'
      ? safeString(parsedEscalationText, '')
      : '',
    parsedEscalationProvider: parsedEscalationProvider || policy.primaryProvider,
    parsedEscalationModel: parsedEscalationModel || '',
  });
  const useSharedAgentTools = policy.mode !== 'parallel';
  const orchestrationSystemPrompt = await buildMainChatSystemPrompt(effectiveSystemPrompt, useSharedAgentTools);
  if (invMatchResult.matches.length > 0) {
    await appendTraceEvent(trace?._id, {
      key: 'inv_match_completed',
      label: 'INV matching completed',
      status: 'success',
      message: `${invMatchResult.matches.length} known issue(s) matched.`,
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
    fallbackProvider: policy.mode === 'fallback' ? policy.fallbackProvider : null,
    fallbackModel: policy.mode === 'fallback' ? (policy.fallbackModel || null) : null,
    parallelProviders: policy.mode === 'parallel' ? (policy.parallelProviders || [policy.primaryProvider, policy.fallbackProvider]) : null,
    mode: policy.mode,
    turnId: requestTurnId,
    warnings: guardrail.warnings || [],
    contextDebug: contextDebugPayload,
  }) + '\n\n');
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
  // Triage is already awaited — emit trace events and triage card SSE synchronously.
  if (imageTriageContext) {
    const triageMeta = imageTriageContext.parseMeta;
    patchTrace(trace?._id, {
      triage: buildParseStage(
        triageMeta,
        triageMeta ? 'ok' : 'error',
        {
          latencyMs: imageTriageContext.elapsedMs || 0,
          startedAt: traceStartedAt,
          completedAt: new Date(),
          card: imageTriageContext.triageCard || null,
          providerUsed: triageMeta?.providerUsed || policy.primaryProvider,
          modelUsed: safeString(triageMeta?.model, '') || getProviderModelId(triageMeta?.providerUsed || policy.primaryProvider),
        }
      ),
    }).catch(() => {});
    appendTraceEvent(trace?._id, {
      key: triageMeta ? 'triage_completed' : 'triage_failed',
      label: triageMeta ? 'Image triage completed' : 'Image triage failed',
      status: triageMeta ? 'success' : 'error',
      provider: triageMeta?.providerUsed || policy.primaryProvider,
      model: safeString(triageMeta?.model, '') || getProviderModelId(triageMeta?.providerUsed || policy.primaryProvider),
      code: imageTriageContext.error?.code || '',
      message: triageMeta
        ? `Image triage completed in ${imageTriageContext.elapsedMs || 0}ms.`
        : (imageTriageContext.error?.message || 'Image triage did not return structured fields.'),
      detail: triageMeta?.validation || imageTriageContext.error || null,
    }, traceStartedAt).catch(() => {});
    if (!responseClosed && imageTriageContext.triageCard) {
      try {
        res.write('event: triage_card\ndata: ' + JSON.stringify(imageTriageContext.triageCard) + '\n\n');
      } catch { /* client disconnected */ }
    }
  }
  // Emit INV matches SSE event so the client can show the InvMatchBanner.
  if (!responseClosed && invMatchResult.ssePayload.length > 0) {
    try {
      res.write('event: inv_matches\ndata: ' + JSON.stringify(invMatchResult.ssePayload) + '\n\n');
    } catch { /* client disconnected */ }
  }
  const turnStartedAt = Date.now();
  const requestId = req.requestId;
  let streamSettled = false;
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
  const runtimeOperationId = runtimeOperation.id;

  // Set up heartbeat
  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* client gone */ }
  }, 15000);

  // SSE safety timeout — force-close if stream never settles
  const sseSafetyTimeout = setTimeout(() => {
    if (streamSettled || responseClosed) return;
    console.error('[chat] SSE safety timeout hit after %dms — force-closing hung stream', SSE_SAFETY_TIMEOUT_MS);
    streamSettled = true;
    clearInterval(heartbeat);
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

  const cleanupFn = startMainChatExecution({
    useAgentTools: useSharedAgentTools,
    policy,
    messages: contextBundle.messagesForModel,
    systemPrompt: orchestrationSystemPrompt,
    reasoningEffort: effectiveReasoningEffort,
    timeoutMs: effectiveTimeoutMs,
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
            const escalation = new Escalation({
              ...imageTriageContext.parseFields,
              source: 'screenshot',
              conversationId: conversation._id,
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
            await escalation.save();
            conversation.escalationId = escalation._id;
            console.log('[chat] Escalation persisted from chat triage: %s (conv %s)', escalation._id, conversation._id);
          } catch (escErr) {
            // Non-fatal — do not break the chat flow if escalation persist fails
            console.warn('[chat] Failed to persist escalation from triage (non-fatal):', escErr.message);
          }
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
          res.write('event: done\ndata: ' + JSON.stringify({
            conversationId: conversation._id.toString(),
            traceId: trace ? trace._id.toString() : null,
            provider: compliantData.mode === 'parallel' ? policy.primaryProvider : compliantData.providerUsed, // backward-compat
            providerUsed: compliantData.providerUsed,
            modelUsed: compliantData.modelUsed || null,
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
          }) + '\n\n');
          res.end();
        } catch { /* client gone */ }
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
    onError: (err) => {
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
        }) + '\n\n');
        res.end();
      } catch { /* client disconnected */ }
      deleteAiOperation(runtimeOperationId);
    },
    onAbort: (abortData) => {
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
      try {
        res.write('event: error\ndata: ' + JSON.stringify({
          error: 'Chat request aborted before completion',
          code: 'CLIENT_ABORT',
          attempts: abortData.attempts || [],
          warnings: guardrail.warnings || [],
          contextDebug: contextDebugPayload,
        }) + '\n\n');
        res.end();
      } catch { /* client disconnected */ }
      deleteAiOperation(runtimeOperationId);
    },
  });
  attachAiOperationController(runtimeOperationId, {
    abort: (reason = 'Chat request aborted by supervisor') => {
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
      try {
        res.write('event: error\ndata: ' + JSON.stringify({
          error: reason,
          code: 'AUTO_ABORT',
        }) + '\n\n');
        res.end();
      } catch { /* client disconnected */ }
      deleteAiOperation(runtimeOperationId);
    },
  });

  // Clean up on client disconnect.
  // NOTE: must use res.on('close'), NOT req.on('close'). By the time this
  // async handler runs, Express has already consumed and closed the request
  // body stream, so req's 'close' event has already fired before we can
  // register a listener. The response stream's 'close' event correctly fires
  // when the underlying TCP socket is torn down (e.g. client tab close).
  res.on('close', () => {
    responseClosed = true;
    clearInterval(heartbeat);
    clearTimeout(sseSafetyTimeout);
    if (!streamSettled) {
      updateAiOperation(runtimeOperationId, {
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
        message: 'The client connection closed before the request settled.',
      }, traceStartedAt).catch(() => {});
      if (cleanupFn) cleanupFn();
    }
  });
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
    timeoutMs,
    settings: rawSettings,
  } = req.body || {};
  const reasoningEffort = req.body?.reasoningEffort;
  const runtimeSettings = normalizeChatRuntimeSettings(rawSettings);

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
    policy,
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
        res.write('event: status\ndata: ' + JSON.stringify({ type: 'status', message: statusMessage }) + '\n\n');
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
    onTriageStart: async (stageMeta) => {
      const traceProvider = safeString(stageMeta?.provider, policy.primaryProvider);
      const traceModel = safeString(stageMeta?.model, '') || getProviderModelId(traceProvider);
      await appendTraceEvent(trace?._id, {
        key: 'triage_started',
        label: 'Image triage started',
        status: 'info',
        provider: traceProvider,
        model: traceModel,
        message: 'Deriving structured escalation fields from image parser output.',
      }, traceStartedAt);
    },
    imageParserConfig: req.body.imageParserProvider
      ? { provider: req.body.imageParserProvider, model: req.body.imageParserModel || undefined }
      : null,
  });
  const useSharedAgentTools = policy.mode !== 'parallel';
  const orchestrationSystemPrompt = await buildMainChatSystemPrompt(effectiveSystemPrompt, useSharedAgentTools);
  if (invMatchResult.matches.length > 0) {
    await appendTraceEvent(trace?._id, {
      key: 'inv_match_completed',
      label: 'INV matching completed',
      status: 'success',
      message: `${invMatchResult.matches.length} known issue(s) matched.`,
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
    fallbackProvider: policy.mode === 'fallback' ? policy.fallbackProvider : null,
    fallbackModel: policy.mode === 'fallback' ? (policy.fallbackModel || null) : null,
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
  // Triage already resolved — emit trace events and triage card SSE synchronously.
  if (imageTriageContext) {
    const triageMeta = imageTriageContext.parseMeta;
    patchTrace(trace?._id, {
      triage: buildParseStage(
        triageMeta,
        triageMeta ? 'ok' : 'error',
        {
          latencyMs: imageTriageContext.elapsedMs || 0,
          startedAt: traceStartedAt,
          completedAt: new Date(),
          card: imageTriageContext.triageCard || null,
          providerUsed: triageMeta?.providerUsed || policy.primaryProvider,
          modelUsed: safeString(triageMeta?.model, '') || getProviderModelId(triageMeta?.providerUsed || policy.primaryProvider),
        }
      ),
    }).catch(() => {});
    appendTraceEvent(trace?._id, {
      key: triageMeta ? 'triage_completed' : 'triage_failed',
      label: triageMeta ? 'Image triage completed' : 'Image triage failed',
      status: triageMeta ? 'success' : 'error',
      provider: triageMeta?.providerUsed || policy.primaryProvider,
      model: safeString(triageMeta?.model, '') || getProviderModelId(triageMeta?.providerUsed || policy.primaryProvider),
      code: imageTriageContext.error?.code || '',
      message: triageMeta
        ? `Image triage completed in ${imageTriageContext.elapsedMs || 0}ms.`
        : (imageTriageContext.error?.message || 'Image triage did not return structured fields.'),
      detail: triageMeta?.validation || imageTriageContext.error || null,
    }, traceStartedAt).catch(() => {});
    if (!responseClosed && imageTriageContext.triageCard) {
      try {
        res.write('event: triage_card\ndata: ' + JSON.stringify(imageTriageContext.triageCard) + '\n\n');
      } catch { /* gone */ }
    }
  }
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

  // SSE safety timeout — force-close if retry stream never settles
  const sseSafetyTimeout = setTimeout(() => {
    if (retryStreamSettled || responseClosed) return;
    console.error('[chat/retry] SSE safety timeout hit after %dms — force-closing hung stream', SSE_SAFETY_TIMEOUT_MS);
    retryStreamSettled = true;
    clearInterval(heartbeat);
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

  const cleanupFn = startMainChatExecution({
    useAgentTools: useSharedAgentTools,
    policy,
    messages: contextBundle.messagesForModel,
    systemPrompt: orchestrationSystemPrompt,
    reasoningEffort: effectiveReasoningEffort,
    timeoutMs: effectiveTimeoutMs,
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
          },
        }, {
          surface: 'chat',
          conversationId: conversation._id.toString(),
        }).catch(() => {});
        if (Array.isArray(compliantData.toolActions) && compliantData.toolActions.length > 0) {
          await recordAgentToolUsage('chat', compliantData.toolActions, { surface: 'chat' }).catch(() => {});
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
          res.write('event: done\ndata: ' + JSON.stringify({
            conversationId: conversation._id.toString(),
            traceId: trace ? trace._id.toString() : null,
            provider: compliantData.mode === 'parallel' ? policy.primaryProvider : compliantData.providerUsed, // backward-compat
            providerUsed: compliantData.providerUsed,
            modelUsed: compliantData.modelUsed || null,
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
    onError: (err) => {
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
    onAbort: (abortData) => {
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
    abort: (reason = 'Chat retry aborted by supervisor') => {
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
