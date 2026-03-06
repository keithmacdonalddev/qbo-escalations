const express = require('express');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const chatRouter = express.Router();
const conversationsRouter = express.Router();
const Conversation = require('../models/Conversation');
const Escalation = require('../models/Escalation');
const ParallelCandidateTurn = require('../models/ParallelCandidateTurn');
const { normalizeChatRuntimeSettings } = require('../lib/chat-settings');
const { buildChatModelContext } = require('../lib/chat-context-builder');
const { evaluateChatGuardrails } = require('../lib/chat-guardrails');
const { createRateLimiter } = require('../middleware/rate-limit');
const {
  isValidProvider,
  normalizeProvider,
  getProviderLabel,
  getDefaultProvider,
  getAlternateProvider,
} = require('../services/providers/registry');
const {
  VALID_MODES,
  resolvePolicy,
  startChatOrchestration,
} = require('../services/chat-orchestrator');
const {
  VALID_PARSE_MODES,
  parseWithPolicy,
} = require('../services/parse-orchestrator');
const { logUsage } = require('../lib/usage-writer');
const { calculateCost } = require('../lib/pricing');

const DEFAULT_PROVIDER = getDefaultProvider();
const TRIAGE_ALLOWED_CATEGORIES = Object.freeze([
  'payroll',
  'bank-feeds',
  'reconciliation',
  'permissions',
  'billing',
  'tax',
  'reports',
  'technical',
  'invoicing',
]);
const TRIAGE_CATEGORY_MAP = Object.freeze({
  payroll: 'payroll',
  'bank-feeds': 'bank-feeds',
  reconciliation: 'reconciliation',
  permissions: 'permissions',
  billing: 'billing',
  tax: 'tax',
  reports: 'reports',
  reporting: 'reports',
  technical: 'technical',
  invoicing: 'invoicing',
});
const QUICK_PARSE_SECTION_TITLES = Object.freeze([
  'What the Agent Is Attempting',
  'Expected vs Actual Outcome',
  'Troubleshooting Steps Taken',
  'Diagnosis',
  'Steps for Agent',
  'Customer-Facing Explanation',
]);

function firstNonEmpty(values, fallback = '') {
  if (!Array.isArray(values)) return fallback;
  for (const value of values) {
    const text = safeString(value, '').trim();
    if (text) return text;
  }
  return fallback;
}

function normalizeTriageCategory(rawCategory) {
  const normalized = safeString(rawCategory, '').trim().toLowerCase();
  const mapped = TRIAGE_CATEGORY_MAP[normalized];
  if (mapped && TRIAGE_ALLOWED_CATEGORIES.includes(mapped)) return mapped;
  return 'technical';
}

function inferTriageSeverity(fields) {
  const haystack = [
    safeString(fields && fields.attemptingTo, ''),
    safeString(fields && fields.expectedOutcome, ''),
    safeString(fields && fields.actualOutcome, ''),
    safeString(fields && fields.tsSteps, ''),
  ].join(' ').toLowerCase();

  if (/(outage|down for everyone|all users|system down|security breach|data loss)/.test(haystack)) return 'P1';
  if (/(cannot|can't|unable|blocked|lock(ed)? out|hard stop|failed|error)/.test(haystack)) return 'P2';
  if (/(slow|intermittent|workaround|degraded|delay)/.test(haystack)) return 'P3';
  return 'P3';
}

function buildTriageRead(fields, category) {
  const attempting = safeString(fields && fields.attemptingTo, '').trim();
  const actual = safeString(fields && fields.actualOutcome, '').trim();

  if (attempting && actual) {
    return `The agent is trying to ${attempting}, but ${actual}. This looks like a ${category} workflow issue in QBO that needs targeted troubleshooting.`;
  }
  if (actual) {
    return `${actual}. This appears to be a ${category} issue and likely needs a focused settings and browser/session check.`;
  }
  if (attempting) {
    return `The agent is trying to ${attempting}, but the expected result is not happening. This appears to be a ${category} workflow issue.`;
  }
  return 'The screenshot indicates a QBO workflow issue that needs focused troubleshooting to isolate the failing step.';
}

function buildTriageAction(fields, category) {
  const attempted = safeString(fields && fields.attemptingTo, '').trim();
  if (category === 'bank-feeds') {
    return 'Capture the exact bank error text/code and retry the connection once in an incognito window.';
  }
  if (category === 'payroll') {
    return 'Confirm payroll deadline impact and capture the exact payroll error text/code before the next retry.';
  }
  if (category === 'permissions') {
    return 'Verify the user role and company access level, then retest the exact same step.';
  }
  if (attempted) {
    return `Capture the exact error text/code while retrying "${attempted}" once in an incognito window.`;
  }
  return 'Capture the exact error text/code and reproduce the issue once in an incognito window before escalating.';
}

function buildFallbackTriageCard() {
  return {
    agent: 'Unknown',
    client: 'Unknown',
    category: 'technical',
    severity: 'P3',
    read: 'The screenshot indicates a QBO workflow issue that needs focused troubleshooting to isolate the exact failure point.',
    action: 'Capture the exact error text/code and reproduce the issue once in an incognito window before escalating.',
  };
}

function buildServerTriageCard(fields) {
  const sourceFields = fields && typeof fields === 'object' ? fields : {};
  const category = normalizeTriageCategory(sourceFields.category);
  const severity = inferTriageSeverity(sourceFields);
  return {
    agent: firstNonEmpty([sourceFields.agentName], 'Unknown'),
    client: firstNonEmpty([sourceFields.clientContact], 'Unknown'),
    category,
    severity,
    read: buildTriageRead(sourceFields, category),
    action: buildTriageAction(sourceFields, category),
  };
}

function buildImageTurnSystemPrompt(baseSystemPrompt) {
  const runtimeRules = [
    'Image Turn Runtime Contract (server-enforced):',
    '- A triage card is already emitted by the server. Do NOT output TRIAGE_START/TRIAGE_END blocks or repeat the triage card.',
    '- Return the response in this exact compact format with these headings only:',
    '1. What the Agent Is Attempting',
    '2. Expected vs Actual Outcome',
    '3. Troubleshooting Steps Taken',
    '4. Diagnosis',
    '5. Steps for Agent',
    '6. Customer-Facing Explanation',
    '- Keep the response concise and actionable.',
  ].join('\n');
  const base = safeString(baseSystemPrompt, '').trim();
  return base ? `${base}\n\n${runtimeRules}` : runtimeRules;
}

function responseHasQuickParseSections(text) {
  const normalized = safeString(text, '').toLowerCase();
  if (!normalized.trim()) return false;
  return QUICK_PARSE_SECTION_TITLES.every((title) => normalized.includes(title.toLowerCase()));
}

function summarizeModelText(text) {
  const compact = safeString(text, '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= 220) return compact;
  return `${compact.slice(0, 217)}...`;
}

function buildQuickParseRepairResponse({ fields, triageCard, originalText }) {
  const sourceFields = fields && typeof fields === 'object' ? fields : {};
  const triage = triageCard || buildFallbackTriageCard();

  const attempting = firstNonEmpty([sourceFields.attemptingTo], 'Unknown');
  const expected = firstNonEmpty([sourceFields.expectedOutcome], 'Unknown');
  const actual = firstNonEmpty([sourceFields.actualOutcome], 'Unknown');
  const tsSteps = firstNonEmpty([sourceFields.tsSteps], 'Unknown');
  const diagnosis = firstNonEmpty([triage.read], 'This appears to be a QBO workflow issue requiring targeted troubleshooting.');
  const action = firstNonEmpty([triage.action], 'Capture the exact error text/code and reproduce once in an incognito window.');
  const modelSummary = summarizeModelText(originalText);
  const customerExplanation = expected !== 'Unknown' && actual !== 'Unknown'
    ? `You expected ${expected.toLowerCase()}, but ${actual.toLowerCase()}. We are now isolating the exact point of failure and next best fix.`
    : 'We can see the workflow is not behaving as expected, and we are isolating the exact cause so we can provide the fastest safe fix.';

  return [
    '1. What the Agent Is Attempting',
    attempting,
    '',
    '2. Expected vs Actual Outcome',
    `Expected: ${expected}`,
    `Actual: ${actual}`,
    '',
    '3. Troubleshooting Steps Taken',
    tsSteps,
    '',
    '4. Diagnosis',
    modelSummary ? `${diagnosis}\nAdditional context: ${modelSummary}` : diagnosis,
    '',
    '5. Steps for Agent',
    `1. ${action}`,
    '2. Verify the exact QBO navigation path and permission/session state before retrying the same step.',
    '3. If the issue persists, capture timestamp and exact error text/code, then escalate with the expected vs actual result.',
    '',
    '6. Customer-Facing Explanation',
    customerExplanation,
  ].join('\n');
}

function repairImageTurnResponse(text, triageContext) {
  const original = safeString(text, '').trim();
  if (responseHasQuickParseSections(original)) return original;
  return buildQuickParseRepairResponse({
    fields: triageContext && triageContext.parseFields ? triageContext.parseFields : {},
    triageCard: triageContext && triageContext.triageCard ? triageContext.triageCard : buildFallbackTriageCard(),
    originalText: original,
  });
}

function applyImageResponseCompliance(data, triageContext) {
  if (!triageContext || !triageContext.triageCard) {
    return { ...data, responseRepaired: false };
  }

  let repairedAny = false;
  const next = { ...data };

  if (typeof next.fullResponse === 'string') {
    const repaired = repairImageTurnResponse(next.fullResponse, triageContext);
    if (repaired !== next.fullResponse) repairedAny = true;
    next.fullResponse = repaired;
  }

  if (Array.isArray(next.results)) {
    next.results = next.results.map((result) => {
      if (!result || result.status !== 'ok' || typeof result.fullResponse !== 'string') return result;
      const repaired = repairImageTurnResponse(result.fullResponse, triageContext);
      const changed = repaired !== result.fullResponse;
      if (changed) repairedAny = true;
      return {
        ...result,
        fullResponse: repaired,
        responseRepaired: changed,
      };
    });
  }

  next.responseRepaired = repairedAny;
  return next;
}

async function buildImageTriageContext({ images, mode, primaryProvider, fallbackProvider, reasoningEffort, timeoutMs }) {
  if (!Array.isArray(images) || images.length === 0) return null;

  const triageMode = mode === 'parallel' ? 'fallback' : (mode === 'fallback' ? 'fallback' : 'single');
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.min(timeoutMs, 15000)
    : 15000;

  let parseFields = null;
  try {
    const parseResult = await parseWithPolicy({
      image: images[0],
      text: '',
      mode: triageMode,
      primaryProvider,
      fallbackProvider,
      reasoningEffort,
      timeoutMs: effectiveTimeoutMs,
      allowRegexFallback: false,
    });
    parseFields = parseResult && parseResult.fields ? parseResult.fields : null;
  } catch {
    parseFields = null;
  }

  return {
    triageCard: parseFields ? buildServerTriageCard(parseFields) : buildFallbackTriageCard(),
    parseFields: parseFields || {},
  };
}

function buildUsageSubdoc(usage) {
  if (!usage) return null;
  const inputTokens = usage.inputTokens || 0;
  const outputTokens = usage.outputTokens || 0;
  const cost = calculateCost(inputTokens, outputTokens, usage.model, null);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    model: usage.model || null,
    totalCostMicros: cost.totalCostMicros,
    usageAvailable: true,
  };
}

// --- Triage Card Stream Detector ---
// Buffers early chunks when images are present, looking for <!-- TRIAGE_START/END -->
// delimiters. Emits a parsed triage card object and passes remaining text through.
function createTriageCardDetector() {
  let buffer = '';
  let emitted = false;
  const TRIAGE_START = '<!-- TRIAGE_START -->';
  const TRIAGE_END = '<!-- TRIAGE_END -->';
  const MAX_BUFFER = 4096;

  function parseTriageBlock(block) {
    const fields = {};
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/^(Agent|Client|Category|Severity|Read|Action):\s*(.+)$/i);
      if (match) {
        fields[match[1].toLowerCase()] = match[2].trim();
      }
    }
    if (!fields.category || !fields.severity) return null;
    return {
      agent: fields.agent || 'Unknown',
      client: fields.client || 'Unknown',
      category: fields.category,
      severity: fields.severity,
      read: fields.read || '',
      action: fields.action || '',
    };
  }

  function feed(text) {
    if (emitted) {
      return { triageCard: null, passthrough: text };
    }

    buffer += text;

    // Safety: flush if buffer grows too large without finding end marker
    if (buffer.length > MAX_BUFFER && !buffer.includes(TRIAGE_END)) {
      emitted = true;
      const flushed = buffer;
      buffer = '';
      return { triageCard: null, passthrough: flushed };
    }

    const endIdx = buffer.indexOf(TRIAGE_END);
    if (endIdx === -1) {
      return { triageCard: null, passthrough: '' };
    }

    emitted = true;
    const startIdx = buffer.indexOf(TRIAGE_START);
    const afterEnd = endIdx + TRIAGE_END.length;

    if (startIdx === -1) {
      const flushed = buffer;
      buffer = '';
      return { triageCard: null, passthrough: flushed };
    }

    const blockContent = buffer.slice(startIdx + TRIAGE_START.length, endIdx);
    const parsed = parseTriageBlock(blockContent);
    // Strip triage block from visible stream; pass through everything after it
    const remainder = buffer.slice(afterEnd);
    buffer = '';
    return { triageCard: parsed, passthrough: remainder };
  }

  return { feed };
}

function logAttemptsUsage(attempts, opts) {
  if (!Array.isArray(attempts)) return;
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    if (a.provider === 'regex') continue;
    const u = a.usage || {};
    const status = opts.statusOverride
      || (a.status === 'ok' ? 'ok' : (a.errorCode === 'TIMEOUT' ? 'timeout' : (a.errorCode === 'ABORT' ? 'abort' : 'error')));
    logUsage({
      requestId: opts.requestId,
      attemptIndex: i,
      service: opts.service,
      provider: a.provider,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      usageAvailable: !!a.usage,
      usageComplete: u.usageComplete,
      rawUsage: u.rawUsage,
      conversationId: opts.conversationId,
      escalationId: opts.escalationId,
      category: opts.category,
      mode: opts.mode,
      status,
      latencyMs: a.latencyMs,
    });
  }
}
const chatRateLimit = createRateLimiter({ name: 'chat', limit: 20, windowMs: 60_000 });
const retryRateLimit = createRateLimiter({ name: 'chat-retry', limit: 12, windowMs: 60_000 });
const parseRateLimit = createRateLimiter({ name: 'chat-parse', limit: 12, windowMs: 60_000 });
const parallelDecisionRateLimit = createRateLimiter({ name: 'chat-parallel-decision', limit: 30, windowMs: 60_000 });
const DEFAULT_PARALLEL_OPEN_TURN_LIMIT = 8;
const DEFAULT_CHAT_MAX_IMAGES = 6;
const DEFAULT_CHAT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_CHAT_MAX_TOTAL_IMAGE_BYTES = 30 * 1024 * 1024;

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
  const firstError = attempts.find((a) => a.status === 'error' && a.errorMessage);
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
  };
}

function isParallelModeEnabled() {
  return process.env.FEATURE_CHAT_PARALLEL_MODE !== '0';
}

function isParallelAcceptEnabled() {
  return process.env.FEATURE_CHAT_PARALLEL_ACCEPT !== '0';
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

function getChatMaxImages() {
  return parsePositiveInt(process.env.CHAT_MAX_IMAGES_PER_REQUEST, DEFAULT_CHAT_MAX_IMAGES);
}

function getChatMaxImageBytes() {
  return parsePositiveInt(process.env.CHAT_MAX_IMAGE_BYTES, DEFAULT_CHAT_MAX_IMAGE_BYTES);
}

function getChatMaxTotalImageBytes() {
  return parsePositiveInt(process.env.CHAT_MAX_TOTAL_IMAGE_BYTES, DEFAULT_CHAT_MAX_TOTAL_IMAGE_BYTES);
}

function isParallelTurnMessage(msg, turnId) {
  return Boolean(
    msg
      && msg.role === 'assistant'
      && msg.mode === 'parallel'
      && msg.attemptMeta
      && msg.attemptMeta.parallel === true
      && msg.attemptMeta.turnId === turnId
  );
}

function isValidObjectId(value) {
  return typeof value === 'string' && mongoose.isValidObjectId(value);
}

function toCandidateFromResult(result) {
  const state = result.status === 'ok'
    ? 'ok'
    : (result.errorCode === 'TIMEOUT' ? 'timeout' : 'error');
  return {
    provider: result.provider,
    content: result.status === 'ok' ? (result.fullResponse || '') : '',
    state,
    errorCode: result.status === 'ok' ? '' : (result.errorCode || ''),
    errorMessage: result.status === 'ok' ? '' : (result.errorMessage || ''),
    errorDetail: result.status === 'ok' ? '' : (result.errorDetail || ''),
    latencyMs: Number(result.latencyMs) || 0,
    usage: result.usage ? buildUsageSubdoc(result.usage) : null,
  };
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

function escapeRegexLiteral(value) {
  return safeString(value, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractBase64Payload(image) {
  const trimmed = safeString(image, '').trim();
  const dataUrlMatch = trimmed.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/);
  return dataUrlMatch ? dataUrlMatch[1] : trimmed;
}

function estimateBase64Bytes(base64Payload) {
  const normalized = safeString(base64Payload, '').replace(/\s+/g, '');
  if (!normalized) return 0;
  const padding = normalized.endsWith('==') ? 2 : (normalized.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function normalizeChatImages(images) {
  if (images === undefined || images === null) {
    return { ok: true, images: [], totalBytes: 0 };
  }
  if (!Array.isArray(images)) {
    return { ok: false, code: 'INVALID_IMAGES', error: 'images must be an array of base64 strings' };
  }
  if (images.length > getChatMaxImages()) {
    return {
      ok: false,
      code: 'TOO_MANY_IMAGES',
      error: `Maximum ${getChatMaxImages()} images per request`,
    };
  }

  const maxImageBytes = getChatMaxImageBytes();
  const maxTotalBytes = getChatMaxTotalImageBytes();
  let totalBytes = 0;
  const normalizedImages = [];

  for (const rawImage of images) {
    if (typeof rawImage !== 'string') {
      return { ok: false, code: 'INVALID_IMAGE', error: 'Each image must be a base64 string' };
    }
    const trimmed = rawImage.trim();
    if (!trimmed) {
      return { ok: false, code: 'INVALID_IMAGE', error: 'Each image must be a non-empty base64 string' };
    }
    const bytes = estimateBase64Bytes(extractBase64Payload(trimmed));
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return { ok: false, code: 'INVALID_IMAGE', error: 'Unable to decode image payload' };
    }
    if (bytes > maxImageBytes) {
      return {
        ok: false,
        code: 'IMAGE_TOO_LARGE',
        error: `Image exceeds ${maxImageBytes} bytes`,
      };
    }
    totalBytes += bytes;
    if (totalBytes > maxTotalBytes) {
      return {
        ok: false,
        code: 'IMAGES_TOO_LARGE',
        error: `Total image payload exceeds ${maxTotalBytes} bytes`,
      };
    }
    normalizedImages.push(trimmed);
  }

  return { ok: true, images: normalizedImages, totalBytes };
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

function deriveFallbackReasonCode(fallbackFrom, attempts) {
  if (!fallbackFrom || !Array.isArray(attempts)) return null;
  const failedAttempt = attempts.find((attempt) => (
    attempt
      && attempt.provider === fallbackFrom
      && attempt.status === 'error'
  ));
  return failedAttempt ? (failedAttempt.errorCode || null) : null;
}

function logChatTurn(payload) {
  const base = {
    event: 'chat_turn',
    ts: new Date().toISOString(),
  };
  try {
    console.info(JSON.stringify({ ...base, ...payload }));
  } catch {
    console.info('[chat_turn]', payload && payload.conversationId ? payload.conversationId : '');
  }
}

function ensureMessagesArray(conversation) {
  if (!conversation) return [];
  if (Array.isArray(conversation.messages)) return conversation.messages;
  conversation.messages = [];
  return conversation.messages;
}

function normalizeMessageForModel(message) {
  if (!message || typeof message !== 'object') {
    return { role: 'user', content: '' };
  }
  const role = message.role === 'assistant' || message.role === 'system' ? message.role : 'user';
  return {
    role,
    content: safeString(message.content, ''),
  };
}

function shouldEmitContextDebug(runtimeSettings) {
  return Boolean(
    runtimeSettings
      && runtimeSettings.debug
      && (runtimeSettings.debug.showContextDebug || runtimeSettings.debug.emitContextDebugSse)
  );
}

function buildContextDebugPayload(runtimeSettings, contextDebug, costEstimate) {
  if (!shouldEmitContextDebug(runtimeSettings)) return null;
  if (!contextDebug || typeof contextDebug !== 'object') return null;
  return {
    ...contextDebug,
    costEstimate: costEstimate || null,
  };
}

async function saveConversationLenient(conversation) {
  try {
    await conversation.save();
  } catch (err) {
    if (!err || err.name !== 'ValidationError') throw err;

    // Legacy documents may contain old enum values in message metadata.
    // Fall back to a direct update to avoid blocking new chat activity locally.
    const serializedMessages = Array.isArray(conversation.messages)
      ? conversation.messages.map((msg) => (
        msg && typeof msg.toObject === 'function' ? msg.toObject() : msg
      ))
      : [];
    await Conversation.updateOne(
      { _id: conversation._id },
      {
        $set: {
          title: conversation.title || 'New Conversation',
          provider: normalizeProvider(conversation.provider),
          messages: serializedMessages,
          escalationId: conversation.escalationId || null,
          systemPromptHash: conversation.systemPromptHash || '',
          updatedAt: new Date(),
        },
      }
    );
  }
}

// POST /api/chat -- Send message to selected provider, returns SSE stream
chatRouter.post('/', chatRateLimit, async (req, res) => {
  const {
    conversationId,
    message,
    images: requestedImages,
    provider, // backward-compat alias for primaryProvider
    mode,
    primaryProvider,
    fallbackProvider,
    parallelProviders,
    timeoutMs,
    settings: rawSettings,
  } = req.body || {};
  const reasoningEffort = req.body?.reasoningEffort;
  const runtimeSettings = normalizeChatRuntimeSettings(rawSettings);
  const normalizedImagesResult = normalizeChatImages(requestedImages);
  const normalizedImages = normalizedImagesResult.ok ? normalizedImagesResult.images : [];

  if (!normalizedImagesResult.ok) {
    return res.status(400).json({
      ok: false,
      code: normalizedImagesResult.code,
      error: normalizedImagesResult.error,
    });
  }
  if (!message && normalizedImages.length === 0) {
    return res.status(400).json({ ok: false, code: 'MISSING_INPUT', error: 'Message or images required' });
  }
  if (conversationId !== undefined && conversationId !== null && conversationId !== '' && !isValidObjectId(conversationId)) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_CONVERSATION_ID',
      error: 'conversationId must be a valid ObjectId',
    });
  }
  if (provider !== undefined && !isValidProvider(provider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported provider' });
  }
  if (primaryProvider !== undefined && !isValidProvider(primaryProvider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported primary provider' });
  }
  if (fallbackProvider !== undefined && !isValidProvider(fallbackProvider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported fallback provider' });
  }
  if (!isValidMode(mode)) {
    return res.status(400).json({ ok: false, code: 'INVALID_MODE', error: 'Unsupported mode' });
  }

  if (parallelProviders !== undefined) {
    if (!Array.isArray(parallelProviders)) {
      return res.status(400).json({ ok: false, code: 'INVALID_PARALLEL_PROVIDERS', error: 'parallelProviders must be an array' });
    }
    // Note: spec name PARALLEL_PROVIDER_LIMIT_EXCEEDED consolidated into PARALLEL_PROVIDER_COUNT_INVALID
    if (parallelProviders.length < 2 || parallelProviders.length > 4) {
      return res.status(400).json({ ok: false, code: 'PARALLEL_PROVIDER_COUNT_INVALID', error: 'parallelProviders must contain 2 to 4 providers' });
    }
    const uniqueParallel = [...new Set(parallelProviders)];
    if (uniqueParallel.length !== parallelProviders.length) {
      return res.status(400).json({ ok: false, code: 'INVALID_PARALLEL_PROVIDERS', error: 'parallelProviders must contain unique providers' });
    }
    for (const pp of parallelProviders) {
      if (!isValidProvider(pp)) {
        return res.status(400).json({ ok: false, code: 'INVALID_PARALLEL_PROVIDERS', error: `Invalid provider in parallelProviders: ${pp}` });
      }
    }
    if (mode !== 'parallel') {
      return res.status(400).json({ ok: false, code: 'INVALID_PARALLEL_PROVIDERS', error: 'parallelProviders only allowed when mode is parallel' });
    }
    if (primaryProvider && !parallelProviders.includes(normalizeProvider(primaryProvider))) {
      return res.status(400).json({ ok: false, code: 'INVALID_PARALLEL_PROVIDERS', error: 'primaryProvider must be included in parallelProviders' });
    }
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

  const requestedPrimary = primaryProvider
    || provider
    || conversation.provider
    || runtimeSettings.providerStrategy.defaultPrimaryProvider
    || DEFAULT_PROVIDER;
  const requestedMode = mode || runtimeSettings.providerStrategy.defaultMode || 'single';
  const requestedFallback = fallbackProvider || runtimeSettings.providerStrategy.defaultFallbackProvider;
  const explicitTimeoutMs = parsePositiveInt(timeoutMs, 0);
  const effectiveTimeoutMs = explicitTimeoutMs || runtimeSettings.providerStrategy.timeoutMs || undefined;
  const effectiveReasoningEffort = normalizeReasoningEffort(
    reasoningEffort,
    runtimeSettings.providerStrategy.reasoningEffort || 'high'
  );
  const requestedPrimaryProvider = normalizeProvider(requestedPrimary);
  let policy = applyChatFeatureFlags(resolvePolicy({
    mode: requestedMode,
    primaryProvider: requestedPrimary,
    fallbackProvider: requestedFallback,
    parallelProviders: parallelProviders || undefined,
  }));

  ensureMessagesArray(conversation);

  const userMsg = {
    role: 'user',
    content: message || '(image attached)',
    images: normalizedImages,
    timestamp: new Date(),
  };

  const pendingMessagesForContext = [...conversation.messages, userMsg].map((m) => normalizeMessageForModel(m));
  const contextBundle = buildChatModelContext({
    normalizedMessages: pendingMessagesForContext,
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
      fallbackProvider: guardrail.policyOverride.fallbackProvider,
      parallelProviders: guardrail.policyOverride.parallelProviders || policy.parallelProviders,
    }));
  }

  if (!policy.parallelProviders && (policy.mode === 'fallback' || policy.mode === 'parallel') && policy.fallbackProvider === policy.primaryProvider) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_FALLBACK_PROVIDER',
      error: 'fallbackProvider must differ from primaryProvider in fallback/parallel mode',
    });
  }

  if (guardrail.blocked) {
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

  let imageTriageContext = null;
  if (normalizedImages.length > 0) {
    imageTriageContext = await buildImageTriageContext({
      images: normalizedImages,
      mode: policy.mode,
      primaryProvider: policy.primaryProvider,
      fallbackProvider: policy.fallbackProvider,
      reasoningEffort: effectiveReasoningEffort,
      timeoutMs: effectiveTimeoutMs,
    });
  }
  const effectiveSystemPrompt = normalizedImages.length > 0
    ? buildImageTurnSystemPrompt(contextBundle.systemPrompt)
    : contextBundle.systemPrompt;

  if (conversation.provider !== policy.primaryProvider) {
    conversation.provider = policy.primaryProvider;
  }

  // Save user message once context/guardrails are resolved.
  conversation.messages.push(userMsg);
  await saveConversationLenient(conversation);

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
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

  // Send start event with conversation ID
  res.write('event: start\ndata: ' + JSON.stringify({
    conversationId: conversation._id.toString(),
    requestId: req.requestId,
    provider: policy.primaryProvider, // backward-compat
    primaryProvider: policy.primaryProvider,
    fallbackProvider: policy.mode === 'fallback' ? policy.fallbackProvider : null,
    parallelProviders: policy.mode === 'parallel' ? (policy.parallelProviders || [policy.primaryProvider, policy.fallbackProvider]) : null,
    mode: policy.mode,
    turnId: requestTurnId,
    warnings: guardrail.warnings || [],
    contextDebug: contextDebugPayload,
  }) + '\n\n');
  if (imageTriageContext && imageTriageContext.triageCard) {
    try {
      res.write('event: triage_card\ndata: ' + JSON.stringify(imageTriageContext.triageCard) + '\n\n');
    } catch { /* client disconnected */ }
  }
  const turnStartedAt = Date.now();
  const requestId = req.requestId;
  let streamSettled = false;

  // Set up heartbeat
  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* client gone */ }
  }, 15000);

  const cleanupFn = startChatOrchestration({
    mode: policy.mode,
    primaryProvider: policy.primaryProvider,
    fallbackProvider: policy.fallbackProvider,
    parallelProviders: policy.parallelProviders || undefined,
    messages: contextBundle.messagesForModel,
    systemPrompt: effectiveSystemPrompt,
    images: normalizedImages,
    reasoningEffort: effectiveReasoningEffort,
    timeoutMs: effectiveTimeoutMs,
    onChunk: ({ provider: chunkProvider, text }) => {
      try {
        res.write('event: chunk\ndata: ' + JSON.stringify({ provider: chunkProvider, text }) + '\n\n');
      } catch { /* client disconnected */ }
    },
    onThinkingChunk: ({ provider: thinkingProvider, thinking }) => {
      try {
        res.write('event: thinking\ndata: ' + JSON.stringify({ provider: thinkingProvider, thinking }) + '\n\n');
      } catch { /* client disconnected */ }
    },
    onProviderError: (data) => {
      try {
        res.write('event: provider_error\ndata: ' + JSON.stringify(data) + '\n\n');
      } catch { /* client disconnected */ }
    },
    onFallback: (data) => {
      try {
        res.write('event: fallback\ndata: ' + JSON.stringify(data) + '\n\n');
      } catch { /* client disconnected */ }
    },
    onDone: async (data) => {
      streamSettled = true;
      clearInterval(heartbeat);
      const latencyMs = Date.now() - turnStartedAt;
      const compliantData = imageTriageContext ? applyImageResponseCompliance(data, imageTriageContext) : { ...data, responseRepaired: false };
      const attempts = compliantData.attempts || [];
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
              provider: result.provider,
              mode: compliantData.mode || policy.mode,
              fallbackFrom: null,
              attemptMeta: { attempts: compliantData.attempts || [], parallel: true, turnId },
              usage: buildUsageSubdoc(result.usage),
              timestamp: new Date(),
            });
          }
        } else {
          conversation.messages.push({
            role: 'assistant',
            content: compliantData.fullResponse,
            provider: compliantData.providerUsed,
            mode: compliantData.mode || policy.mode,
            fallbackFrom: compliantData.fallbackFrom || null,
            attemptMeta: { attempts: compliantData.attempts || [] },
            usage: buildUsageSubdoc(compliantData.usage),
            timestamp: new Date(),
          });
        }

        if (conversation.title === 'New Conversation' && conversation.messages.length >= 2) {
          const firstUserMsg = conversation.messages.find((m) => m.role === 'user');
          if (firstUserMsg) conversation.title = safeString(firstUserMsg.content, '').slice(0, 80);
        }

        await saveConversationLenient(conversation);

        try {
          const usagePayload = buildUsageSubdoc(compliantData.usage);
          res.write('event: done\ndata: ' + JSON.stringify({
            conversationId: conversation._id.toString(),
            provider: compliantData.mode === 'parallel' ? policy.primaryProvider : compliantData.providerUsed, // backward-compat
            providerUsed: compliantData.providerUsed,
            fallbackUsed: compliantData.fallbackUsed,
            fallbackFrom: compliantData.fallbackFrom || null,
            mode: compliantData.mode || policy.mode,
            turnId: compliantData.mode === 'parallel' ? (compliantData.turnId || requestTurnId) : null,
            attempts: compliantData.attempts || [],
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
          }) + '\n\n');
          res.end();
        } catch { /* client gone */ }
      } catch (onDoneErr) {
        try {
          res.write('event: error\ndata: ' + JSON.stringify({
            error: onDoneErr.message || 'Failed to save conversation',
            code: 'ONDONE_SAVE_FAILED',
          }) + '\n\n');
          res.end();
        } catch { /* client gone */ }
      }
    },
    onError: (err) => {
      streamSettled = true;
      clearInterval(heartbeat);
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
    },
    onAbort: (abortData) => {
      logAttemptsUsage(abortData.attempts, { requestId, service: 'chat', conversationId: conversation._id, mode: policy.mode });
    },
  });

  // Clean up on client disconnect.
  // NOTE: must use res.on('close'), NOT req.on('close'). By the time this
  // async handler runs, Express has already consumed and closed the request
  // body stream, so req's 'close' event has already fired before we can
  // register a listener. The response stream's 'close' event correctly fires
  // when the underlying TCP socket is torn down (e.g. client tab close).
  res.on('close', () => {
    clearInterval(heartbeat);
    if (!streamSettled && cleanupFn) cleanupFn();
  });
});

// POST /api/chat/parse-escalation -- Parse escalation from image/text
chatRouter.post('/parse-escalation', parseRateLimit, async (req, res) => {
  const {
    image,
    text,
    mode,
    provider, // backward-compatible alias for primaryProvider
    primaryProvider,
    fallbackProvider,
    timeoutMs,
    persist,
  } = req.body || {};

  if (!image && !text) {
    return res.status(400).json({ ok: false, code: 'MISSING_INPUT', error: 'Image or text required' });
  }
  if (provider !== undefined && !isValidProvider(provider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported provider' });
  }
  if (primaryProvider !== undefined && !isValidProvider(primaryProvider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported primary provider' });
  }
  if (fallbackProvider !== undefined && !isValidProvider(fallbackProvider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported fallback provider' });
  }
  if (!isValidParseMode(mode)) {
    return res.status(400).json({ ok: false, code: 'INVALID_MODE', error: 'Unsupported parse mode' });
  }

  const parseRequestId = randomUUID();
  const resolvedMode = resolveParseMode(mode);
  try {
    const parseResult = await parseWithPolicy({
      image,
      text,
      mode: resolvedMode,
      primaryProvider: primaryProvider || provider || DEFAULT_PROVIDER,
      fallbackProvider,
      reasoningEffort,
      timeoutMs,
      allowRegexFallback: true,
    });
    const responseMeta = toParseResponseMeta(parseResult.meta);

    if (persist) {
      const escalation = new Escalation({
        ...parseResult.fields,
        source: image ? 'screenshot' : 'chat',
        parseMeta: {
          mode: responseMeta.mode,
          providerUsed: responseMeta.providerUsed,
          winner: responseMeta.winner || responseMeta.providerUsed,
          fallbackUsed: responseMeta.fallbackUsed,
          fallbackFrom: responseMeta.fallbackFrom || '',
          validationScore: responseMeta.validation ? responseMeta.validation.score : null,
          validationConfidence: responseMeta.validation ? responseMeta.validation.confidence : '',
          validationIssues: responseMeta.validation ? responseMeta.validation.issues : [],
          usedRegexFallback: responseMeta.usedRegexFallback,
          attempts: responseMeta.attempts,
        },
      });
      await escalation.save();
      logAttemptsUsage(parseResult.meta.attempts, { requestId: parseRequestId, service: 'parse', escalationId: escalation._id, mode: resolvedMode });
      return res.status(201).json({ ok: true, escalation: escalation.toObject(), _meta: responseMeta });
    }

    logAttemptsUsage(parseResult.meta.attempts, { requestId: parseRequestId, service: 'parse', mode: resolvedMode });
    return res.json({ ok: true, escalation: parseResult.fields, _meta: responseMeta });
  } catch (err) {
    if (err && Array.isArray(err.attempts)) {
      logAttemptsUsage(err.attempts, { requestId: parseRequestId, service: 'parse', mode: resolvedMode });
    }
    const code = err && err.code ? err.code : 'PARSE_FAILED';
    const status = code === 'PARSE_FAILED' ? 422 : 500;
    return res.status(status).json({
      ok: false,
      code,
      error: err && err.message ? err.message : 'Failed to parse escalation',
      attempts: err && Array.isArray(err.attempts) ? err.attempts : [],
    });
  }
});

// GET /api/conversations -- List conversations (with optional search)
conversationsRouter.get('/', async (req, res) => {
  // Fail fast when DB is not connected — prevents requests from hanging
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ ok: false, code: 'DB_UNAVAILABLE', error: 'Database is not available' });
  }

  const parsedLimit = Number.parseInt(safeString(req.query.limit, ''), 10);
  const parsedSkip = Number.parseInt(
    safeString(req.query.skip !== undefined ? req.query.skip : req.query.offset, ''),
    10
  );
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 200)
    : 50;
  const skip = Number.isFinite(parsedSkip) && parsedSkip > 0 ? parsedSkip : 0;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const escapedSearch = escapeRegexLiteral(search);

  const filter = escapedSearch
    ? { title: { $regex: escapedSearch, $options: 'i' } }
    : {};

  try {
    // Aggregation pipeline projects only needed fields server-side,
    // avoiding transfer of the full messages array per conversation.
    const conversations = await Conversation.aggregate([
      { $match: filter },
      { $sort: { updatedAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      { $project: {
        title: 1,
        provider: 1,
        escalationId: 1,
        createdAt: 1,
        updatedAt: 1,
        messageCount: { $size: { $ifNull: ['$messages', []] } },
        lastMessage: { $arrayElemAt: ['$messages', -1] },
      }},
    ]).option({ maxTimeMS: 8000 });

    const items = conversations.map((c) => {
      const lastMsg = c.lastMessage || null;
      const preview = lastMsg ? safeString(lastMsg.content, '').slice(0, 120) : '';
      return {
        _id: c._id,
        title: safeString(c.title, 'Conversation'),
        provider: normalizeProvider(c.provider),
        messageCount: c.messageCount || 0,
        lastMessage: lastMsg ? {
          role: lastMsg.role,
          preview,
          provider: lastMsg.provider,
          timestamp: lastMsg.timestamp,
        } : null,
        escalationId: c.escalationId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      };
    });

    const total = await Conversation.countDocuments(filter).maxTimeMS(5000);
    res.json({ ok: true, conversations: items, total });
  } catch (err) {
    const isTimeout = err.codeName === 'MaxTimeMSExpired' || err.code === 50;
    res.status(isTimeout ? 504 : 500).json({
      ok: false,
      code: isTimeout ? 'QUERY_TIMEOUT' : 'LIST_FAILED',
      error: isTimeout ? 'Query timed out' : 'Failed to list conversations',
    });
  }
});

conversationsRouter.use('/:id', (req, res, next) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_CONVERSATION_ID',
      error: 'conversationId must be a valid ObjectId',
    });
  }
  return next();
});

// GET /api/conversations/:id -- Get full conversation
conversationsRouter.get('/:id', async (req, res) => {
  const conversation = await Conversation.findById(req.params.id).lean();
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }
  res.json({ ok: true, conversation });
});

// PATCH /api/conversations/:id -- Update conversation (rename, link to escalation)
conversationsRouter.patch('/:id', async (req, res) => {
  const { title, escalationId } = req.body;
  const update = {};
  if (typeof title === 'string') update.title = title.slice(0, 200);
  if (escalationId !== undefined) update.escalationId = escalationId || null;

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ ok: false, code: 'NO_FIELDS', error: 'No fields to update' });
  }

  const conversation = await Conversation.findByIdAndUpdate(
    req.params.id,
    { $set: update },
    { returnDocument: 'after' }
  ).lean();

  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }
  res.json({ ok: true, conversation });
});

// GET /api/conversations/:id/export -- Export conversation as plain text (includes linked escalation)
conversationsRouter.get('/:id/export', async (req, res) => {
  const conversation = await Conversation.findById(req.params.id).lean();
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }

  const lines = [
    `Conversation: ${safeString(conversation.title, 'Conversation')}`,
    `Date: ${new Date(conversation.createdAt).toLocaleString()}`,
    `Messages: ${conversation.messages.length}`,
  ];

  // Include linked escalation data if present
  if (conversation.escalationId) {
    const Escalation = require('../models/Escalation');
    const escalation = await Escalation.findById(conversation.escalationId).lean();
    if (escalation) {
      lines.push('');
      lines.push('=== LINKED ESCALATION ===');
      if (escalation.coid) lines.push(`COID: ${escalation.coid}`);
      if (escalation.mid) lines.push(`MID: ${escalation.mid}`);
      if (escalation.caseNumber) lines.push(`Case #: ${escalation.caseNumber}`);
      if (escalation.clientContact) lines.push(`Client: ${escalation.clientContact}`);
      if (escalation.agentName) lines.push(`Agent: ${escalation.agentName}`);
      lines.push(`Category: ${escalation.category}`);
      lines.push(`Status: ${escalation.status}`);
      if (escalation.attemptingTo) lines.push(`Attempting: ${escalation.attemptingTo}`);
      if (escalation.actualOutcome) lines.push(`Actual Outcome: ${escalation.actualOutcome}`);
      if (escalation.resolution) lines.push(`Resolution: ${escalation.resolution}`);
      if (escalation.resolvedAt) lines.push(`Resolved: ${new Date(escalation.resolvedAt).toLocaleString()}`);
      lines.push('========================');
    }
  }

  lines.push('---', '');

  for (const msg of conversation.messages) {
    let label = 'System';
    if (msg.role === 'user') {
      label = 'Agent';
    } else if (msg.role === 'assistant') {
      label = getProviderLabel(msg.provider || conversation.provider);
      if (msg.fallbackFrom) {
        label += ` (fallback from ${getProviderLabel(msg.fallbackFrom)})`;
      }
    }
    const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '';
    lines.push(`[${label}] ${time}`);
    lines.push(safeString(msg.content, ''));
    lines.push('');
  }

  const text = lines.join('\n');
  res.json({ ok: true, text });
});

// POST /api/conversations/:id/fork -- Fork conversation from a message index
conversationsRouter.post('/:id/fork', async (req, res) => {
  const source = await Conversation.findById(req.params.id);
  if (!source) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }

  let sliceEnd = source.messages.length;
  if (req.body.fromMessageIndex !== undefined) {
    const idx = Number(req.body.fromMessageIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= source.messages.length) {
      return res.status(400).json({ ok: false, code: 'INVALID_INDEX', error: 'fromMessageIndex must be a valid message index' });
    }
    sliceEnd = idx + 1;
  }

  const messages = source.messages.slice(0, sliceEnd).map((m) => ({
    role: m.role,
    content: m.content,
    images: m.images || [],
    provider: m.provider,
    mode: m.mode,
    fallbackFrom: m.fallbackFrom,
    attemptMeta: m.attemptMeta || null,
    usage: m.usage || null,
    timestamp: m.timestamp || new Date(),
  }));

  const forked = new Conversation({
    title: ((source.title || 'Conversation') + ' (fork)').slice(0, 200),
    messages,
    provider: normalizeProvider(source.provider),
    escalationId: source.escalationId || null,
    systemPromptHash: source.systemPromptHash || '',
  });
  await forked.save();

  res.status(201).json({ ok: true, conversation: forked.toObject() });
});

// POST /api/chat/retry -- Retry last message in a conversation (removes bad assistant response, re-sends)
chatRouter.post('/retry', retryRateLimit, async (req, res) => {
  const {
    conversationId,
    provider, // backward-compat alias
    mode,
    primaryProvider,
    fallbackProvider,
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
  if (provider !== undefined && !isValidProvider(provider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported provider' });
  }
  if (primaryProvider !== undefined && !isValidProvider(primaryProvider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported primary provider' });
  }
  if (fallbackProvider !== undefined && !isValidProvider(fallbackProvider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported fallback provider' });
  }
  if (!isValidMode(mode)) {
    return res.status(400).json({ ok: false, code: 'INVALID_MODE', error: 'Unsupported mode' });
  }

  if (parallelProviders !== undefined) {
    if (!Array.isArray(parallelProviders)) {
      return res.status(400).json({ ok: false, code: 'INVALID_PARALLEL_PROVIDERS', error: 'parallelProviders must be an array' });
    }
    // Note: spec name PARALLEL_PROVIDER_LIMIT_EXCEEDED consolidated into PARALLEL_PROVIDER_COUNT_INVALID
    if (parallelProviders.length < 2 || parallelProviders.length > 4) {
      return res.status(400).json({ ok: false, code: 'PARALLEL_PROVIDER_COUNT_INVALID', error: 'parallelProviders must contain 2 to 4 providers' });
    }
    const uniqueParallel = [...new Set(parallelProviders)];
    if (uniqueParallel.length !== parallelProviders.length) {
      return res.status(400).json({ ok: false, code: 'INVALID_PARALLEL_PROVIDERS', error: 'parallelProviders must contain unique providers' });
    }
    for (const pp of parallelProviders) {
      if (!isValidProvider(pp)) {
        return res.status(400).json({ ok: false, code: 'INVALID_PARALLEL_PROVIDERS', error: `Invalid provider in parallelProviders: ${pp}` });
      }
    }
    if (mode !== 'parallel') {
      return res.status(400).json({ ok: false, code: 'INVALID_PARALLEL_PROVIDERS', error: 'parallelProviders only allowed when mode is parallel' });
    }
    if (primaryProvider && !parallelProviders.includes(normalizeProvider(primaryProvider))) {
      return res.status(400).json({ ok: false, code: 'INVALID_PARALLEL_PROVIDERS', error: 'primaryProvider must be included in parallelProviders' });
    }
  }

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }
  ensureMessagesArray(conversation);

  const requestedPrimary = primaryProvider
    || provider
    || conversation.provider
    || runtimeSettings.providerStrategy.defaultPrimaryProvider
    || DEFAULT_PROVIDER;
  const requestedMode = mode || runtimeSettings.providerStrategy.defaultMode || 'single';
  const requestedFallback = fallbackProvider || runtimeSettings.providerStrategy.defaultFallbackProvider;
  const explicitTimeoutMs = parsePositiveInt(timeoutMs, 0);
  const effectiveTimeoutMs = explicitTimeoutMs || runtimeSettings.providerStrategy.timeoutMs || undefined;
  const effectiveReasoningEffort = normalizeReasoningEffort(
    reasoningEffort,
    runtimeSettings.providerStrategy.reasoningEffort || 'high'
  );
  const requestedPrimaryProvider = normalizeProvider(requestedPrimary);
  let policy = applyChatFeatureFlags(resolvePolicy({
    mode: requestedMode,
    primaryProvider: requestedPrimary,
    fallbackProvider: requestedFallback,
    parallelProviders: parallelProviders || undefined,
  }));

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
  const normalizedImagesResult = normalizeChatImages(lastUserMsg.images || []);
  if (!normalizedImagesResult.ok) {
    return res.status(400).json({
      ok: false,
      code: normalizedImagesResult.code,
      error: normalizedImagesResult.error,
    });
  }
  const normalizedImages = normalizedImagesResult.images;

  const contextSourceMessages = retryMessages.map((m) => normalizeMessageForModel(m));
  const contextBundle = buildChatModelContext({
    normalizedMessages: contextSourceMessages,
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
      fallbackProvider: guardrail.policyOverride.fallbackProvider,
      parallelProviders: guardrail.policyOverride.parallelProviders || policy.parallelProviders,
    }));
  }

  if (!policy.parallelProviders && (policy.mode === 'fallback' || policy.mode === 'parallel') && policy.fallbackProvider === policy.primaryProvider) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_FALLBACK_PROVIDER',
      error: 'fallbackProvider must differ from primaryProvider in fallback/parallel mode',
    });
  }

  if (guardrail.blocked) {
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
      return res.status(409).json({
        ok: false,
        code: 'PARALLEL_MODE_DISABLED',
        error: 'Parallel mode is disabled',
      });
    }
    const openTurnLimit = getParallelOpenTurnLimit();
    const openTurnCount = await ParallelCandidateTurn.countDocuments({ service: 'chat', status: 'open' });
    if (openTurnCount >= openTurnLimit) {
      return res.status(429).json({
        ok: false,
        code: 'PARALLEL_TURN_LIMIT',
        error: `Parallel open-turn limit reached (${openTurnLimit})`,
      });
    }
  }

  let imageTriageContext = null;
  if (normalizedImages.length > 0) {
    imageTriageContext = await buildImageTriageContext({
      images: normalizedImages,
      mode: policy.mode,
      primaryProvider: policy.primaryProvider,
      fallbackProvider: policy.fallbackProvider,
      reasoningEffort: effectiveReasoningEffort,
      timeoutMs: effectiveTimeoutMs,
    });
  }
  const effectiveSystemPrompt = normalizedImages.length > 0
    ? buildImageTurnSystemPrompt(contextBundle.systemPrompt)
    : contextBundle.systemPrompt;

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

  // Set up SSE and re-run the chat flow
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
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

  res.write('event: start\ndata: ' + JSON.stringify({
    conversationId: conversation._id.toString(),
    requestId: req.requestId,
    retry: true,
    provider: policy.primaryProvider, // backward-compat
    primaryProvider: policy.primaryProvider,
    fallbackProvider: policy.mode === 'fallback' ? policy.fallbackProvider : null,
    parallelProviders: policy.mode === 'parallel' ? (policy.parallelProviders || [policy.primaryProvider, policy.fallbackProvider]) : null,
    mode: policy.mode,
    turnId: requestTurnId,
    warnings: guardrail.warnings || [],
    contextDebug: contextDebugPayload,
  }) + '\n\n');
  if (imageTriageContext && imageTriageContext.triageCard) {
    try {
      res.write('event: triage_card\ndata: ' + JSON.stringify(imageTriageContext.triageCard) + '\n\n');
    } catch { /* gone */ }
  }

  const turnStartedAt = Date.now();
  const retryRequestId = randomUUID();
  let retryStreamSettled = false;

  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* gone */ }
  }, 15000);

  const cleanupFn = startChatOrchestration({
    mode: policy.mode,
    primaryProvider: policy.primaryProvider,
    fallbackProvider: policy.fallbackProvider,
    parallelProviders: policy.parallelProviders || undefined,
    messages: contextBundle.messagesForModel,
    systemPrompt: effectiveSystemPrompt,
    images: normalizedImages,
    reasoningEffort: effectiveReasoningEffort,
    timeoutMs: effectiveTimeoutMs,
    onChunk: ({ provider: chunkProvider, text }) => {
      try { res.write('event: chunk\ndata: ' + JSON.stringify({ provider: chunkProvider, text }) + '\n\n'); } catch { /* gone */ }
    },
    onThinkingChunk: ({ provider: thinkingProvider, thinking }) => {
      try { res.write('event: thinking\ndata: ' + JSON.stringify({ provider: thinkingProvider, thinking }) + '\n\n'); } catch { /* gone */ }
    },
    onProviderError: (data) => {
      try { res.write('event: provider_error\ndata: ' + JSON.stringify(data) + '\n\n'); } catch { /* gone */ }
    },
    onFallback: (data) => {
      try { res.write('event: fallback\ndata: ' + JSON.stringify(data) + '\n\n'); } catch { /* gone */ }
    },
    onDone: async (data) => {
      retryStreamSettled = true;
      clearInterval(heartbeat);
      const latencyMs = Date.now() - turnStartedAt;
      const compliantData = imageTriageContext ? applyImageResponseCompliance(data, imageTriageContext) : { ...data, responseRepaired: false };
      const attempts = compliantData.attempts || [];
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
              provider: result.provider,
              mode: compliantData.mode || policy.mode,
              fallbackFrom: null,
              attemptMeta: { attempts: compliantData.attempts || [], parallel: true, turnId },
              usage: buildUsageSubdoc(result.usage),
              timestamp: new Date(),
            });
          }
        } else {
          conversation.messages.push({
            role: 'assistant',
            content: compliantData.fullResponse,
            provider: compliantData.providerUsed,
            mode: compliantData.mode || policy.mode,
            fallbackFrom: compliantData.fallbackFrom || null,
            attemptMeta: { attempts: compliantData.attempts || [] },
            usage: buildUsageSubdoc(compliantData.usage),
            timestamp: new Date(),
          });
        }
        await saveConversationLenient(conversation);
        try {
          const retryUsagePayload = buildUsageSubdoc(compliantData.usage);
          res.write('event: done\ndata: ' + JSON.stringify({
            conversationId: conversation._id.toString(),
            provider: compliantData.mode === 'parallel' ? policy.primaryProvider : compliantData.providerUsed, // backward-compat
            providerUsed: compliantData.providerUsed,
            fallbackUsed: compliantData.fallbackUsed,
            fallbackFrom: compliantData.fallbackFrom || null,
            mode: compliantData.mode || policy.mode,
            turnId: compliantData.mode === 'parallel' ? (compliantData.turnId || requestTurnId) : null,
            attempts: compliantData.attempts || [],
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
          }) + '\n\n');
          res.end();
        } catch { /* gone */ }
      } catch (onDoneErr) {
        try {
          res.write('event: error\ndata: ' + JSON.stringify({
            error: onDoneErr.message || 'Failed to save conversation',
            code: 'ONDONE_SAVE_FAILED',
          }) + '\n\n');
          res.end();
        } catch { /* gone */ }
      }
    },
    onError: (err) => {
      retryStreamSettled = true;
      clearInterval(heartbeat);
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
    },
    onAbort: (abortData) => {
      logAttemptsUsage(abortData.attempts, { requestId: retryRequestId, service: 'chat', conversationId: conversation._id, mode: policy.mode });
    },
  });

  // See comment on main chat route — must use res.on('close') not req.on('close').
  res.on('close', () => {
    clearInterval(heartbeat);
    if (!retryStreamSettled && cleanupFn) cleanupFn();
  });
});

// POST /api/chat/parallel/:turnId/accept -- Accept a parallel candidate and commit winner canonically
chatRouter.post('/parallel/:turnId/accept', parallelDecisionRateLimit, async (req, res) => {
  const { turnId } = req.params;
  const { conversationId, provider, editedContent } = req.body || {};

  if (!isParallelAcceptEnabled()) {
    return res.status(409).json({
      ok: false,
      code: 'PARALLEL_ACCEPT_DISABLED',
      error: 'Parallel accept is disabled',
    });
  }

  if (!turnId) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'turnId required' });
  }
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
  if (!provider || !isValidProvider(provider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Supported provider required' });
  }
  if (editedContent !== undefined && typeof editedContent !== 'string') {
    return res.status(400).json({ ok: false, code: 'INVALID_FIELD', error: 'editedContent must be a string when provided' });
  }

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }
  const turnDoc = await ParallelCandidateTurn.findOne({ turnId, conversationId: conversation._id }).lean();
  if (turnDoc && Array.isArray(turnDoc.requestedProviders) && turnDoc.requestedProviders.length > 0) {
    if (!turnDoc.requestedProviders.includes(provider)) {
      return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Provider not in requested parallel providers' });
    }
  }
  if (turnDoc) {
    if (turnDoc.status === 'accepted') {
      if (turnDoc.acceptedProvider === provider) {
        return res.json({
          ok: true,
          idempotent: true,
          conversationId: conversation._id.toString(),
          turnId,
          acceptedProvider: turnDoc.acceptedProvider,
          acceptedContent: turnDoc.acceptedContent || '',
          conversation: conversation.toObject(),
        });
      }
      return res.status(409).json({
        ok: false,
        code: 'TURN_ALREADY_ACCEPTED',
        error: 'Parallel turn already accepted',
        acceptedProvider: turnDoc.acceptedProvider || null,
      });
    }
    if (turnDoc.status === 'discarded') {
      return res.status(409).json({
        ok: false,
        code: 'TURN_DISCARDED',
        error: 'Parallel turn is discarded',
      });
    }
    if (turnDoc.status === 'expired') {
      return res.status(409).json({
        ok: false,
        code: 'TURN_EXPIRED',
        error: 'Parallel turn is expired',
      });
    }
  }

  const turnEntries = conversation.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => isParallelTurnMessage(message, turnId));

  if (turnEntries.length === 0) {
    return res.status(404).json({ ok: false, code: 'TURN_NOT_FOUND', error: 'Parallel turn not found' });
  }

  const alreadyAccepted = turnEntries.find(({ message }) => Boolean(message.attemptMeta && message.attemptMeta.accepted));
  if (alreadyAccepted) {
    if (alreadyAccepted.message.provider === provider) {
      return res.json({
        ok: true,
        idempotent: true,
        conversationId: conversation._id.toString(),
        turnId,
        acceptedProvider: alreadyAccepted.message.provider,
        acceptedContent: alreadyAccepted.message.content,
        conversation: conversation.toObject(),
      });
    }
    return res.status(409).json({
      ok: false,
      code: 'TURN_ALREADY_ACCEPTED',
      error: 'Parallel turn already accepted',
      acceptedProvider: alreadyAccepted.message.provider,
    });
  }

  const winnerEntry = turnEntries.find(({ message }) => message.provider === provider);
  if (!winnerEntry) {
    return res.status(404).json({
      ok: false,
      code: 'TURN_PROVIDER_NOT_FOUND',
      error: 'Provider candidate not found for this turn',
    });
  }

  const resolvedContent = typeof editedContent === 'string' && editedContent.trim()
    ? editedContent
    : winnerEntry.message.content;
  const acceptedAt = new Date();
  if (conversation.provider !== provider) {
    conversation.provider = provider;
  }

  const turnIndexes = turnEntries.map((entry) => entry.index);
  const firstTurnIndex = Math.min(...turnIndexes);
  const turnIndexSet = new Set(turnIndexes);
  const winnerMessage = winnerEntry.message && typeof winnerEntry.message.toObject === 'function'
    ? winnerEntry.message.toObject()
    : { ...winnerEntry.message };
  winnerMessage.content = resolvedContent;
  winnerMessage.provider = provider;
  winnerMessage.mode = 'parallel';
  winnerMessage.fallbackFrom = null;
  winnerMessage.attemptMeta = {
    ...(winnerMessage.attemptMeta || {}),
    parallel: true,
    turnId,
    accepted: true,
    rejected: false,
    acceptedAt,
    acceptedProvider: provider,
    rejectedAt: undefined,
  };

  // Canonicalize accepted turn to one assistant message.
  const retainedMessages = conversation.messages.filter((_, idx) => !turnIndexSet.has(idx));
  retainedMessages.splice(firstTurnIndex, 0, winnerMessage);
  conversation.set('messages', retainedMessages);
  await saveConversationLenient(conversation);

  // Record model performance metrics — one entry per losing provider (non-blocking)
  try {
const ModelPerformance = require('../models/ModelPerformance');
const { getAlternateProvider } = require('../services/providers/registry');
    const turnDoc2 = await ParallelCandidateTurn.findOne({ turnId, conversationId: conversation._id }).lean();
    const candidates = turnDoc2 ? turnDoc2.candidates : [];
    const winnerCandidate = candidates.find(c => c.provider === provider);
    const loserCandidates = candidates.filter(c => c.provider !== provider);
    const userMsgBefore = conversation.messages
      .slice(0, firstTurnIndex)
      .reverse()
      .find(m => m.role === 'user');
    const isImageParse = userMsgBefore && Array.isArray(userMsgBefore.images) && userMsgBefore.images.length > 0;
    const wc = (text) => text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
    for (const loser of loserCandidates) {
      await ModelPerformance.create({
        turnId,
        conversationId: conversation._id,
        winnerProvider: provider,
        loserProvider: loser.provider,
        winnerLatencyMs: winnerCandidate ? winnerCandidate.latencyMs : 0,
        loserLatencyMs: loser.latencyMs || 0,
        winnerWordCount: wc(resolvedContent),
        loserWordCount: wc(loser.content),
        context: isImageParse ? 'image-parse' : 'general-chat',
        decidedAt: acceptedAt,
      });
    }
    // Fallback: if no loser candidates found (e.g. missing turnDoc), create a single record
    if (loserCandidates.length === 0) {
      await ModelPerformance.create({
        turnId,
        conversationId: conversation._id,
        winnerProvider: provider,
        loserProvider: getAlternateProvider(provider),
        winnerLatencyMs: winnerCandidate ? winnerCandidate.latencyMs : 0,
        loserLatencyMs: 0,
        winnerWordCount: wc(resolvedContent),
        loserWordCount: 0,
        context: isImageParse ? 'image-parse' : 'general-chat',
        decidedAt: acceptedAt,
      });
    }
  } catch (_perfErr) {
    // Performance tracking must never break the accept flow
  }

  const acceptedMessage = conversation.messages[firstTurnIndex] || null;
  const acceptedMessageIndex = firstTurnIndex;
  ParallelCandidateTurn.findOneAndUpdate(
    { turnId, conversationId: conversation._id },
    {
      $set: {
        service: 'chat',
        conversationId: conversation._id,
        status: 'accepted',
        acceptedProvider: provider,
        acceptedContent: acceptedMessage ? acceptedMessage.content : resolvedContent,
        acceptedAt,
        acceptedMessageIndex: acceptedMessageIndex >= 0 ? acceptedMessageIndex : null,
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  ).catch((err) => console.warn('ParallelCandidateTurn update failed (accept):', err.message));
  return res.json({
    ok: true,
    idempotent: false,
    conversationId: conversation._id.toString(),
    turnId,
    acceptedProvider: provider,
    acceptedContent: acceptedMessage ? acceptedMessage.content : resolvedContent,
    conversation: conversation.toObject(),
  });
});

// POST /api/chat/parallel/:turnId/discard -- Discard an unaccepted parallel turn
chatRouter.post('/parallel/:turnId/discard', parallelDecisionRateLimit, async (req, res) => {
  const { turnId } = req.params;
  const { conversationId } = req.body || {};

  if (!isParallelAcceptEnabled()) {
    return res.status(409).json({
      ok: false,
      code: 'PARALLEL_ACCEPT_DISABLED',
      error: 'Parallel accept is disabled',
    });
  }

  if (!turnId) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'turnId required' });
  }
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

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }
  const turnDoc = await ParallelCandidateTurn.findOne({ turnId, conversationId: conversation._id }).lean();
  if (turnDoc) {
    if (turnDoc.status === 'accepted') {
      return res.status(409).json({
        ok: false,
        code: 'TURN_ALREADY_ACCEPTED',
        error: 'Parallel turn already accepted',
        acceptedProvider: turnDoc.acceptedProvider || null,
      });
    }
    if (turnDoc.status === 'discarded') {
      return res.json({
        ok: true,
        idempotent: true,
        conversationId: conversation._id.toString(),
        turnId,
        discardedCount: 0,
        conversation: conversation.toObject(),
      });
    }
  }

  const turnEntries = conversation.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => isParallelTurnMessage(message, turnId));

  if (turnEntries.length === 0) {
    return res.status(404).json({ ok: false, code: 'TURN_NOT_FOUND', error: 'Parallel turn not found' });
  }

  const alreadyAccepted = turnEntries.find(({ message }) => Boolean(message.attemptMeta && message.attemptMeta.accepted));
  if (alreadyAccepted) {
    return res.status(409).json({
      ok: false,
      code: 'TURN_ALREADY_ACCEPTED',
      error: 'Parallel turn already accepted',
      acceptedProvider: alreadyAccepted.message.provider,
    });
  }

  const turnIndexes = new Set(turnEntries.map((entry) => entry.index));
  const retainedMessages = conversation.messages.filter((_, idx) => !turnIndexes.has(idx));
  conversation.set('messages', retainedMessages);
  await saveConversationLenient(conversation);
  ParallelCandidateTurn.findOneAndUpdate(
    { turnId, conversationId: conversation._id },
    {
      $set: {
        service: 'chat',
        conversationId: conversation._id,
        status: 'discarded',
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  ).catch((err) => console.warn('ParallelCandidateTurn update failed (discard):', err.message));

  return res.json({
    ok: true,
    conversationId: conversation._id.toString(),
    turnId,
    discardedCount: turnEntries.length,
    conversation: conversation.toObject(),
  });
});

// POST /api/chat/parallel/:turnId/unaccept -- Reverse an acceptance, restoring both candidates to open state
chatRouter.post('/parallel/:turnId/unaccept', parallelDecisionRateLimit, async (req, res) => {
  const { turnId } = req.params;
  const { conversationId } = req.body || {};

  if (!isParallelAcceptEnabled()) {
    return res.status(409).json({ ok: false, code: 'PARALLEL_ACCEPT_DISABLED', error: 'Parallel accept is disabled' });
  }
  if (!turnId) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'turnId required' });
  }
  if (!conversationId) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'conversationId required' });
  }
  if (!isValidObjectId(conversationId)) {
    return res.status(400).json({ ok: false, code: 'INVALID_CONVERSATION_ID', error: 'conversationId must be a valid ObjectId' });
  }

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }
  const turnDoc = await ParallelCandidateTurn.findOne({ turnId, conversationId: conversation._id }).lean();

  const turnEntries = conversation.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => isParallelTurnMessage(message, turnId));

  if (turnEntries.length === 0 && (!turnDoc || turnDoc.status !== 'accepted')) {
    return res.status(404).json({ ok: false, code: 'TURN_NOT_FOUND', error: 'Parallel turn not found' });
  }

  // Check that the turn was actually accepted
  const acceptedEntry = turnEntries.find(({ message }) => Boolean(message.attemptMeta && message.attemptMeta.accepted));
  const turnWasAccepted = Boolean(acceptedEntry) || (turnDoc && turnDoc.status === 'accepted');
  if (!turnWasAccepted) {
    return res.json({ ok: true, idempotent: true, conversationId: conversation._id.toString(), turnId, conversation: conversation.toObject() });
  }

  const candidates = Array.isArray(turnDoc?.candidates) ? turnDoc.candidates : [];
  const insertionIndex = turnEntries.length > 0
    ? Math.min(...turnEntries.map((entry) => entry.index))
    : (Number.isInteger(turnDoc?.acceptedMessageIndex) ? turnDoc.acceptedMessageIndex : conversation.messages.length);
  const turnIndexSet = new Set(turnEntries.map((entry) => entry.index));
  const attempts = Array.isArray(turnDoc?.attempts)
    ? turnDoc.attempts
    : (acceptedEntry?.message?.attemptMeta?.attempts || []);

  if (candidates.length > 0) {
    const restoredMessages = candidates
      .filter((candidate) => candidate && isValidProvider(candidate.provider))
      .map((candidate) => {
        const isAcceptedProvider = turnDoc?.acceptedProvider && candidate.provider === turnDoc.acceptedProvider;
        const content = isAcceptedProvider && turnDoc?.acceptedContent !== undefined && turnDoc?.acceptedContent !== null
          ? turnDoc.acceptedContent
          : (candidate.content || '');
        return {
          role: 'assistant',
          content,
          provider: candidate.provider,
          mode: 'parallel',
          fallbackFrom: null,
          attemptMeta: {
            attempts,
            parallel: true,
            turnId,
            accepted: false,
            rejected: false,
            acceptedAt: undefined,
            acceptedProvider: undefined,
            rejectedAt: undefined,
          },
          usage: candidate.usage || null,
          timestamp: new Date(),
        };
      });

    if (restoredMessages.length > 0) {
      const retainedMessages = conversation.messages.filter((_, idx) => !turnIndexSet.has(idx));
      retainedMessages.splice(insertionIndex, 0, ...restoredMessages);
      conversation.set('messages', retainedMessages);
    }
  } else {
    // Fallback for legacy records that do not have persisted candidates.
    for (const entry of turnEntries) {
      entry.message.attemptMeta = {
        ...(entry.message.attemptMeta || {}),
        parallel: true,
        turnId,
        accepted: false,
        rejected: false,
        acceptedAt: undefined,
        acceptedProvider: undefined,
        rejectedAt: undefined,
      };
    }
    conversation.markModified('messages');
  }
  await saveConversationLenient(conversation);

  // Reset ParallelCandidateTurn status back to open
  ParallelCandidateTurn.findOneAndUpdate(
    { turnId, conversationId: conversation._id },
    {
      $set: {
        status: 'open',
        acceptedProvider: null,
        acceptedContent: null,
        acceptedAt: null,
        acceptedMessageIndex: null,
      },
    }
  ).catch((err) => console.warn('ParallelCandidateTurn update failed (reset):', err.message));

  // Remove all ModelPerformance records for this turn (non-blocking)
  try {
    const ModelPerformance = require('../models/ModelPerformance');
    await ModelPerformance.deleteMany({ turnId });
  } catch (_e) { /* non-blocking */ }

  return res.json({
    ok: true,
    conversationId: conversation._id.toString(),
    turnId,
    conversation: conversation.toObject(),
  });
});

// DELETE /api/conversations/:id -- Delete conversation
conversationsRouter.delete('/:id', async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }

  if (conversation.escalationId) {
    const Escalation = require('../models/Escalation');
    await Escalation.findByIdAndUpdate(conversation.escalationId, { $set: { conversationId: null } });
  }

  const result = await Conversation.findByIdAndDelete(req.params.id);
  if (!result) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }
  res.json({ ok: true });
});

module.exports = { chatRouter, conversationsRouter };
