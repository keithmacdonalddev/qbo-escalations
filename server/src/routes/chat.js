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
const { transcribeImage } = require('../services/claude');
const {
  createAiOperation,
  updateAiOperation,
  recordAiChunk,
  recordAiEvent,
  attachAiOperationController,
  deleteAiOperation,
} = require('../services/ai-runtime');
const { reportServerError } = require('../lib/server-error-pipeline');
const { logUsage } = require('../lib/usage-writer');
const { calculateCost } = require('../lib/pricing');
const { getProviderModelId } = require('../services/providers/catalog');
const {
  createTrace,
  patchTrace,
  appendTraceEvent,
  setTraceAttempts,
  setTraceUsage,
  buildParseStage,
  buildOutcome,
  summarizeUsage,
} = require('../services/ai-traces');
const { archiveImages, getArchive, getAllImages, getImageFile, getArchiveStats } = require('../lib/image-archive');
const { extractQuickActions } = require('../lib/quick-actions');
const {
  matchFromParseFields,
  matchInvestigations,
  incrementMatchCount,
} = require('../services/inv-matcher');

const SSE_SAFETY_TIMEOUT_MS = parseInt(process.env.SSE_SAFETY_TIMEOUT_MS, 10) || 300000; // 5 minutes

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

/**
 * Detect whether the user's message indicates a NON-escalation intent.
 * When true, the server should skip the triage parse, 6-section format
 * enforcement, response compliance rewriting, and auto-escalation creation.
 *
 * Examples: "this is not an escalation", "add these INVs", "list of inv",
 * "parse these investigation entries", "what does this error mean?", etc.
 */
function isNonEscalationIntent(messageText) {
  const text = safeString(messageText, '').toLowerCase().trim();
  if (!text) return false;

  // Explicit negation of escalation intent
  if (/\bnot\s+(an?\s+)?escalation\b/.test(text)) return true;
  if (/\bdon'?t\s+(triage|parse\s+as\s+escalation|create\s+escalation)\b/.test(text)) return true;
  if (/\bskip\s+(triage|escalation)\b/.test(text)) return true;
  if (/\bno\s+triage\b/.test(text)) return true;

  // INV-related requests (adding/listing investigations, not escalation triage)
  if (/\binv[-\s]?\d{4,}/.test(text) && /\b(add|list|parse|track|import|update|show)\b/.test(text)) return true;
  if (/\b(add|import|parse)\s+(these\s+)?(inv|investigation)\b/.test(text)) return true;
  if (/\blist\s+of\s+inv\b/.test(text)) return true;
  if (/\binvestigation\s+(entries|list|numbers|screenshot)\b/.test(text)) return true;

  // General non-triage intents with images
  if (/\b(what\s+does\s+this|what\s+is\s+this|can\s+you\s+read|help\s+me\s+understand)\b/.test(text)) return true;
  if (/\b(summarize|transcribe|translate|extract\s+text)\b/.test(text)) return true;

  return false;
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

function buildTriageRefBlock(parseFields) {
  if (!parseFields || typeof parseFields !== 'object') return '';
  const f = parseFields;
  const lines = [
    '\n\n--- PRE-PARSED ESCALATION DATA (use as canonical reference) ---',
    f.coid ? `COID/MID: ${f.coid}${f.mid ? '/' + f.mid : ''}` : '',
    f.caseNumber ? `Case: ${f.caseNumber}` : '',
    f.clientContact ? `Client/Contact: ${f.clientContact}` : '',
    f.agentName ? `Agent: ${f.agentName}` : '',
    f.attemptingTo ? `CX Attempting: ${f.attemptingTo}` : '',
    f.expectedOutcome ? `Expected Outcome: ${f.expectedOutcome}` : '',
    f.actualOutcome ? `Actual Outcome: ${f.actualOutcome}` : '',
    f.tsSteps ? `TS Steps: ${f.tsSteps}` : '',
    f.triedTestAccount ? `Tried Test Account: ${f.triedTestAccount}` : '',
    f.category ? `Category: ${f.category}` : '',
    f.severity ? `Severity: ${f.severity}` : '',
    f.product ? `Product: ${f.product}` : '',
    f.summary ? `Summary: ${f.summary}` : '',
    '--- END PRE-PARSED DATA ---\n',
  ].filter(Boolean).join('\n');
  // Only return block if at least one real field was present (beyond the delimiters)
  return lines.split('\n').filter(l => !l.startsWith('---') && l.trim()).length > 0 ? lines : '';
}

// --- Image Transcription Pipeline ---
// For ALL image messages, run a fast transcription-only step before anything else.
// This gives Claude accurate text from the screenshot regardless of whether the
// intent is escalation triage, INV import, or a general question.

const IMAGE_TRANSCRIBE_TIMEOUT_MS = parsePositiveInt(
  process.env.CHAT_IMAGE_TRANSCRIBE_TIMEOUT_MS, 45000
);

/**
 * Run a fast image-to-text transcription for the first image in the array.
 * Returns { text, usage, elapsedMs } on success, or null on any failure.
 * This is intentionally fire-and-continue: if transcription fails, the chat
 * still proceeds — Claude will see the raw image via temp file + prompt.
 */
async function transcribeImageForChat(images, options = {}) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const startedAt = Date.now();
  try {
    const result = await transcribeImage(images[0], {
      model: options.model || undefined,
      reasoningEffort: options.reasoningEffort || 'medium',
      timeoutMs: options.timeoutMs || IMAGE_TRANSCRIBE_TIMEOUT_MS,
    });
    return {
      text: result && result.text ? result.text : '',
      usage: result && result.usage ? result.usage : null,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    console.warn('[chat] Image transcription failed (non-fatal):', err.message);
    return null;
  }
}

/**
 * Build a system prompt block with the transcribed image text so Claude has
 * an accurate textual representation instead of relying solely on vision.
 */
function buildTranscriptionRefBlock(transcriptionText) {
  const text = safeString(transcriptionText, '').trim();
  if (!text) return '';
  return [
    '\n\n--- IMAGE TRANSCRIPTION (server-extracted, use as primary text reference) ---',
    text,
    '--- END IMAGE TRANSCRIPTION ---\n',
  ].join('\n');
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
    '- Pre-parsed escalation data is provided in the system prompt. Use it as the canonical source for IDs, names, and field values. You may reference the attached image for additional visual context but rely on the pre-parsed data for accuracy.',
    '- If pre-parsed data is not available for a field, and the image text is unclear, say it is unclear rather than guessing.',
    '- Keep the response concise and actionable.',
  ].join('\n');
  const base = safeString(baseSystemPrompt, '').trim();
  return base ? `${base}\n\n${runtimeRules}` : runtimeRules;
}

// ---------------------------------------------------------------------------
// Live INV Matching — query active investigations for matching known issues
// ---------------------------------------------------------------------------

/**
 * Build a system prompt block listing matched INV investigations so Claude
 * can reference known issues, workarounds, and affected-user counts.
 */
function buildInvMatchRefBlock(matches) {
  if (!Array.isArray(matches) || matches.length === 0) return '';
  const entries = matches.map((m) => {
    const inv = m.investigation || m;
    const lines = [`- **${inv.invNumber}** — ${inv.subject || '(no subject)'}`];
    if (inv.status) lines.push(`  Status: ${inv.status}`);
    if (inv.details) lines.push(`  Details: ${inv.details}`);
    if (inv.resolution) lines.push(`  Resolution: ${inv.resolution}`);
    if (inv.workaround) lines.push(`  Workaround: ${inv.workaround}`);
    if (inv.notes) lines.push(`  Notes: ${inv.notes}`);
    if (inv.affectedCount > 0) lines.push(`  Affected users: ${inv.affectedCount}`);
    if (inv.category) lines.push(`  Category: ${inv.category}`);
    return lines.join('\n');
  });
  return [
    '\n\n--- KNOWN ISSUE MATCHES (active INV investigations) ---',
    'The following known issues were automatically matched to this escalation.',
    'Reference them in your response when relevant. Tell the agent to give the',
    'customer the INV number and add them to affected users if the issue matches.',
    '',
    ...entries,
    '--- END KNOWN ISSUE MATCHES ---\n',
  ].join('\n');
}

/**
 * Run INV matching against the user message and/or triage parse fields.
 * Returns { matches, ssPayload } where matches is the raw scored array
 * and ssPayload is the flattened array for the SSE event.
 * Designed to be fast and non-blocking — failures return empty results.
 */
async function runInvMatching({ message, parseFields, category }) {
  try {
    let matches = [];

    // Strategy 1: If we have structured parse fields, use them (best signal)
    if (parseFields && typeof parseFields === 'object') {
      const pfWithCategory = { ...parseFields };
      if (category && !pfWithCategory.category) pfWithCategory.category = category;
      matches = await matchFromParseFields(pfWithCategory);
    }

    // Strategy 2: Fall back to free-text matching on the user message
    if (matches.length === 0 && message && typeof message === 'string' && message.trim()) {
      matches = await matchInvestigations(message.trim(), {
        category: category || null,
        limit: 5,
      });
      // Assign confidence levels for text-only matches
      matches = matches.map((m) => ({
        ...m,
        confidence: m.confidence || (m.score >= 40 ? 'exact' : m.score >= 20 ? 'likely' : 'possible'),
      }));
    }

    if (matches.length === 0) return { matches: [], ssePayload: [] };

    // Increment match counts (fire-and-forget, non-blocking)
    for (const m of matches) {
      const inv = m.investigation || m;
      if (inv._id) incrementMatchCount(inv._id).catch(() => {});
    }

    // Build SSE payload (flattened for client)
    const ssePayload = matches.map((m) => {
      const inv = m.investigation || m;
      return {
        _id: inv._id ? inv._id.toString() : undefined,
        invNumber: inv.invNumber,
        subject: inv.subject,
        workaround: inv.workaround || '',
        notes: inv.notes || '',
        category: inv.category || '',
        status: inv.status || '',
        affectedCount: inv.affectedCount || 0,
        confidence: m.confidence || 'possible',
        score: m.score || 0,
      };
    });

    return { matches, ssePayload };
  } catch (err) {
    console.warn('[chat] INV matching failed (non-fatal):', err.message);
    return { matches: [], ssePayload: [] };
  }
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
    ? Math.min(timeoutMs, 60000)
    : 60000;

  let parseFields = null;
  let parseMeta = null;
  let error = null;
  const startedAt = Date.now();
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
    parseMeta = parseResult && parseResult.meta ? parseResult.meta : null;
  } catch (err) {
    parseFields = null;
    error = err || null;
  }

  return {
    triageCard: parseFields ? buildServerTriageCard(parseFields) : buildFallbackTriageCard(),
    parseFields: parseFields || {},
    parseMeta: parseMeta ? toParseResponseMeta(parseMeta) : null,
    elapsedMs: Date.now() - startedAt,
    error: error ? {
      code: error.code || 'TRIAGE_FAILED',
      message: error.message || 'Image triage failed',
    } : null,
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

function buildTraceStats(traceStats) {
  return {
    chunkCount: Number(traceStats?.chunkCount) || 0,
    chunkChars: Number(traceStats?.chunkChars) || 0,
    thinkingChunkCount: Number(traceStats?.thinkingChunkCount) || 0,
    providerErrors: Number(traceStats?.providerErrors) || 0,
    fallbacks: Number(traceStats?.fallbacks) || 0,
  };
}

function sumResponseChars(data) {
  if (!data || typeof data !== 'object') return 0;
  if (Array.isArray(data.results)) {
    return data.results.reduce((sum, result) => (
      sum + (typeof result?.fullResponse === 'string' ? result.fullResponse.length : 0)
    ), 0);
  }
  return typeof data.fullResponse === 'string' ? data.fullResponse.length : 0;
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
    thinking: typeof result.thinking === 'string' ? result.thinking : '',
    state,
    errorCode: result.status === 'ok' ? '' : (result.errorCode || ''),
    errorMessage: result.status === 'ok' ? '' : (result.errorMessage || ''),
    errorDetail: result.status === 'ok' ? '' : (result.errorDetail || ''),
    latencyMs: Number(result.latencyMs) || 0,
    usage: result.usage ? buildUsageSubdoc(result.usage) : null,
  };
}

function normalizeProviderThinking(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = {};
  for (const [provider, thinking] of Object.entries(value)) {
    if (typeof thinking !== 'string') continue;
    if (!thinking.trim()) continue;
    normalized[provider] = thinking;
  }
  return normalized;
}

function getProviderThinking(providerThinking, provider, fallback = '') {
  if (provider && typeof providerThinking?.[provider] === 'string' && providerThinking[provider].trim()) {
    return providerThinking[provider];
  }
  return typeof fallback === 'string' ? fallback : '';
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

function normalizeConversationListTitle(title, lastPreview) {
  const normalizedTitle = safeString(title, '').trim();
  if (normalizedTitle) return normalizedTitle;

  const normalizedPreview = safeString(lastPreview, '').trim();
  if (normalizedPreview) return normalizedPreview;

  return 'Untitled conversation';
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
    imageMeta: clientImageMeta,
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
  const normalizedClientImageMeta = Array.isArray(clientImageMeta) ? clientImageMeta : [];

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
    imageMeta: normalizedClientImageMeta,
    traceRequestId: req.requestId,
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
      fallbackProvider: requestedFallback,
      parallelProviders: parallelProviders || [],
    },
    resolved: {
      mode: policy.mode,
      reasoningEffort: effectiveReasoningEffort,
      timeoutMs: effectiveTimeoutMs,
      primaryProvider: policy.primaryProvider,
      fallbackProvider: policy.fallbackProvider,
      parallelProviders: policy.parallelProviders || [],
    },
  }).catch(() => null);
  await appendTraceEvent(trace?._id, {
    key: 'request_received',
    label: 'Request received',
    status: 'info',
    provider: policy.primaryProvider,
    model: getProviderModelId(policy.primaryProvider),
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
        modelUsed: getProviderModelId(policy.primaryProvider),
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
          modelUsed: getProviderModelId(policy.primaryProvider),
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
          modelUsed: getProviderModelId(policy.primaryProvider),
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

  // Detect whether the user is requesting something other than escalation triage.
  // When true, skip the expensive pre-parse, 6-section format enforcement, and
  // auto-escalation creation — just let the model respond naturally.
  const nonEscalationIntent = isNonEscalationIntent(message);

  // --- Image Transcription Pipeline (runs for ALL image messages) ---
  // Step 1: Fast transcription — extract all visible text from the image.
  // This runs regardless of intent so Claude always has accurate OCR text.
  let imageTranscription = null;
  if (normalizedImages.length > 0) {
    try {
      res.write('data: ' + JSON.stringify({ type: 'status', message: 'Reading image text...' }) + '\n\n');
    } catch { /* client disconnected */ }
    await appendTraceEvent(trace?._id, {
      key: 'transcription_started',
      label: 'Image transcription started',
      status: 'info',
      provider: policy.primaryProvider,
      model: getProviderModelId(policy.primaryProvider),
      message: 'Running fast image-to-text transcription.',
    }, traceStartedAt);

    imageTranscription = await transcribeImageForChat(normalizedImages, {
      model: getProviderModelId(policy.primaryProvider),
      reasoningEffort: 'medium',
      timeoutMs: IMAGE_TRANSCRIBE_TIMEOUT_MS,
    });

    await appendTraceEvent(trace?._id, {
      key: imageTranscription ? 'transcription_completed' : 'transcription_failed',
      label: imageTranscription ? 'Image transcription completed' : 'Image transcription failed',
      status: imageTranscription ? 'success' : 'warning',
      provider: policy.primaryProvider,
      model: getProviderModelId(policy.primaryProvider),
      message: imageTranscription
        ? `Image transcribed in ${imageTranscription.elapsedMs || 0}ms (${(imageTranscription.text || '').length} chars).`
        : 'Image transcription failed — Claude will rely on raw image vision.',
    }, traceStartedAt);
  }

  // Step 2: For escalation intent, also run the structured triage parse.
  if (normalizedImages.length > 0 && !nonEscalationIntent) {
    try {
      res.write('data: ' + JSON.stringify({ type: 'status', message: 'Parsing escalation fields...' }) + '\n\n');
    } catch { /* client disconnected */ }
    await appendTraceEvent(trace?._id, {
      key: 'triage_started',
      label: 'Image triage started',
      status: 'info',
      provider: policy.primaryProvider,
      model: getProviderModelId(policy.primaryProvider),
      message: 'Running structured escalation field extraction.',
    }, traceStartedAt);
  }
  const imageTriageContext = (normalizedImages.length > 0 && !nonEscalationIntent)
    ? await buildImageTriageContext({
      images: normalizedImages,
      mode: policy.mode,
      primaryProvider: policy.primaryProvider,
      fallbackProvider: policy.fallbackProvider,
      reasoningEffort: effectiveReasoningEffort,
      timeoutMs: effectiveTimeoutMs,
    }).catch(() => null)
    : null;

  // Step 3: Build the effective system prompt with transcription and triage data.
  let effectiveSystemPrompt = (normalizedImages.length > 0 && !nonEscalationIntent)
    ? buildImageTurnSystemPrompt(contextBundle.systemPrompt)
    : contextBundle.systemPrompt;
  // Always inject transcription text when available — gives Claude accurate
  // OCR text regardless of escalation vs non-escalation intent.
  if (imageTranscription && imageTranscription.text) {
    const transcriptionBlock = buildTranscriptionRefBlock(imageTranscription.text);
    if (transcriptionBlock) effectiveSystemPrompt = effectiveSystemPrompt + transcriptionBlock;
  }
  // Inject pre-parsed triage fields into the system prompt so Claude has
  // canonical reference data instead of squinting at the image.
  if (imageTriageContext && imageTriageContext.parseFields) {
    const refBlock = buildTriageRefBlock(imageTriageContext.parseFields);
    if (refBlock) effectiveSystemPrompt = effectiveSystemPrompt + refBlock;
  }

  // Step 4: Live INV matching — query active investigations for known issues.
  // Uses triage parse fields when available (best signal), falls back to
  // free-text matching on the user message. Results injected into system
  // prompt and emitted as SSE event for the client UI.
  const triageCategory = imageTriageContext?.triageCard?.category || null;
  const invMatchResult = await runInvMatching({
    message: message || (imageTranscription && imageTranscription.text) || '',
    parseFields: imageTriageContext?.parseFields || null,
    category: triageCategory,
  });
  if (invMatchResult.matches.length > 0) {
    const invBlock = buildInvMatchRefBlock(invMatchResult.matches);
    if (invBlock) effectiveSystemPrompt = effectiveSystemPrompt + invBlock;
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
    model: getProviderModelId(policy.primaryProvider),
    message: 'SSE stream opened and request accepted by the server.',
  }, traceStartedAt);
  res.write('event: start\ndata: ' + JSON.stringify({
    conversationId: conversation._id.toString(),
    requestId: req.requestId,
    traceId: trace ? trace._id.toString() : null,
    provider: policy.primaryProvider, // backward-compat
    primaryProvider: policy.primaryProvider,
    fallbackProvider: policy.mode === 'fallback' ? policy.fallbackProvider : null,
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
          providerUsed: policy.primaryProvider,
          modelUsed: getProviderModelId(triageMeta?.providerUsed || policy.primaryProvider),
        }
      ),
    }).catch(() => {});
    appendTraceEvent(trace?._id, {
      key: triageMeta ? 'triage_completed' : 'triage_failed',
      label: triageMeta ? 'Image triage completed' : 'Image triage failed',
      status: triageMeta ? 'success' : 'error',
      provider: triageMeta?.providerUsed || policy.primaryProvider,
      model: getProviderModelId(triageMeta?.providerUsed || policy.primaryProvider),
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
          model: getProviderModelId(chunkProvider),
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
          model: getProviderModelId(thinkingProvider),
          message: `First reasoning chunk arrived from ${thinkingProvider}.`,
          elapsedMs: firstThinkingMs,
        }, traceStartedAt).catch(() => {});
      }
      try {
        res.write('event: thinking\ndata: ' + JSON.stringify({ provider: thinkingProvider, thinking }) + '\n\n');
      } catch { /* client disconnected */ }
    },
    onProviderError: (data) => {
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
        model: getProviderModelId(data && data.provider ? data.provider : ''),
        code: data && data.code ? data.code : 'PROVIDER_EXEC_FAILED',
        message: data && data.message ? data.message : 'Provider failed',
        detail: data || null,
      }, traceStartedAt).catch(() => {});
      try {
        res.write('event: provider_error\ndata: ' + JSON.stringify(data) + '\n\n');
      } catch { /* client disconnected */ }
    },
    onFallback: (data) => {
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
        model: getProviderModelId(data && data.to ? data.to : ''),
        code: data && data.reason ? data.reason : 'PROVIDER_ERROR',
        message: `${data && data.from ? data.from : 'primary'} -> ${data && data.to ? data.to : 'fallback'}`,
        detail: data || null,
      }, traceStartedAt).catch(() => {});
      try {
        res.write('event: fallback\ndata: ' + JSON.stringify(data) + '\n\n');
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

        if (conversation.title === 'New Conversation' && conversation.messages.length >= 2) {
          const firstUserMsg = conversation.messages.find((m) => m.role === 'user');
          if (firstUserMsg) conversation.title = safeString(firstUserMsg.content, '').slice(0, 80);
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
            modelUsed: (compliantData.usage && compliantData.usage.model) || getProviderModelId(compliantData.providerUsed || policy.primaryProvider),
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
          model: (compliantData.usage && compliantData.usage.model) || getProviderModelId(compliantData.providerUsed || policy.primaryProvider),
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
            const archiveModelParsing = compliantData.fullResponse
              || (Array.isArray(compliantData.results) && compliantData.results.find((r) => r.status === 'ok')?.fullResponse)
              || '';
            archiveImages({
              conversationId: conversation._id.toString(),
              messageIndex: Math.max(0, userMsgIndex),
              images: normalizedImages,
              userPrompt: safeString(message, ''),
              modelParsing: archiveModelParsing,
              parseFields: imageTriageContext && imageTriageContext.parseFields ? imageTriageContext.parseFields : null,
              triageCard: imageTriageContext && imageTriageContext.triageCard ? imageTriageContext.triageCard : null,
              provider: compliantData.providerUsed || policy.primaryProvider,
              usage: compliantData.usage || null,
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
            modelUsed: getProviderModelId(policy.primaryProvider),
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
          model: getProviderModelId(policy.primaryProvider),
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
          modelUsed: getProviderModelId(policy.primaryProvider),
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
        model: getProviderModelId(policy.primaryProvider),
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
          modelUsed: getProviderModelId(policy.primaryProvider),
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
        model: getProviderModelId(policy.primaryProvider),
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
        model: getProviderModelId(policy.primaryProvider),
        code: 'CLIENT_DISCONNECTED',
        message: 'The client connection closed before the request settled.',
      }, traceStartedAt).catch(() => {});
      if (cleanupFn) cleanupFn();
    }
  });
});

// POST /api/chat/parse-escalation -- Parse escalation from image/text
chatRouter.post('/parse-escalation', parseRateLimit, async (req, res) => {
  const {
    image,
    imageMeta,
    text,
    mode,
    provider, // backward-compatible alias for primaryProvider
    primaryProvider,
    fallbackProvider,
    reasoningEffort,
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

  const parseRequestId = req.requestId || randomUUID();
  const resolvedMode = resolveParseMode(mode);
  const traceStartedAt = new Date();
  const selectedProvider = primaryProvider || provider || DEFAULT_PROVIDER;
  const normalizedClientImageMeta = Array.isArray(imageMeta) ? imageMeta : [];
  const parseRuntimeOperation = createAiOperation({
    kind: 'parse',
    route: '/api/chat/parse-escalation',
    action: 'chat-parse-escalation',
    provider: selectedProvider,
    mode: resolvedMode,
    promptPreview: text || '[image parse]',
    hasImages: Boolean(image),
    messageCount: text ? 1 : 0,
    providers: [selectedProvider, fallbackProvider].filter(Boolean),
  });
  const parseRuntimeOperationId = parseRuntimeOperation.id;
  const trace = await createTrace({
    requestId: parseRequestId,
    service: 'parse',
    route: '/api/chat/parse-escalation',
    turnKind: 'parse',
    promptPreview: text || '[image parse]',
    messageLength: typeof text === 'string' ? text.length : 0,
    normalizedImages: image ? [image] : [],
    clientImageMeta: normalizedClientImageMeta,
    requested: {
      mode: resolvedMode,
      reasoningEffort,
      timeoutMs,
      primaryProvider: selectedProvider,
      fallbackProvider,
    },
    resolved: {
      mode: resolvedMode,
      reasoningEffort,
      timeoutMs,
      primaryProvider: selectedProvider,
      fallbackProvider,
    },
  }).catch(() => null);
  await appendTraceEvent(trace?._id, {
    key: 'parse_request_received',
    label: 'Parse request received',
    status: 'info',
    provider: selectedProvider,
    model: getProviderModelId(selectedProvider),
    message: image
      ? 'Received chat-side image escalation parse request.'
      : 'Received chat-side text escalation parse request.',
  }, traceStartedAt).catch(() => null);
  let parseSettled = false;
  res.on('close', () => {
    if (parseSettled) return;
    updateAiOperation(parseRuntimeOperationId, {
      clientConnected: false,
      phase: 'aborting',
    });
    patchTrace(trace?._id, {
      status: 'aborted',
      postParse: buildParseStage(
        {
          mode: resolvedMode,
          providerUsed: selectedProvider,
          attempts: [],
        },
        'error',
        {
          traceId: trace?._id,
          latencyMs: Date.now() - traceStartedAt.getTime(),
          startedAt: traceStartedAt,
          completedAt: new Date(),
        }
      ),
      outcome: buildOutcome({
        providerUsed: selectedProvider,
        modelUsed: getProviderModelId(selectedProvider),
        totalMs: Date.now() - traceStartedAt.getTime(),
        completedAt: new Date(),
        errorCode: 'CLIENT_DISCONNECTED',
        errorMessage: 'The client connection closed before parse completed.',
      }),
    }).catch(() => null);
    appendTraceEvent(trace?._id, {
      key: 'client_disconnected',
      label: 'Client disconnected',
      status: 'warning',
      provider: selectedProvider,
      model: getProviderModelId(selectedProvider),
      code: 'CLIENT_DISCONNECTED',
      message: 'The client connection closed before the parse request settled.',
    }, traceStartedAt).catch(() => null);
  });
  try {
    await appendTraceEvent(trace?._id, {
      key: 'parse_started',
      label: 'Provider parse started',
      status: 'info',
      provider: selectedProvider,
      model: getProviderModelId(selectedProvider),
      message: 'Running provider-orchestrated chat parse.',
    }, traceStartedAt).catch(() => null);
    const parseResult = await parseWithPolicy({
      image,
      text,
      mode: resolvedMode,
      primaryProvider: selectedProvider,
      fallbackProvider,
      reasoningEffort,
      timeoutMs,
      allowRegexFallback: true,
    });
    const responseMeta = toParseResponseMeta(parseResult.meta);
    await setTraceAttempts(trace?._id, parseResult.meta?.attempts || []).catch(() => null);
    await setTraceUsage(
      trace?._id,
      (responseMeta.attempts || []).find((attempt) => attempt.status === 'ok' && attempt.provider === responseMeta.providerUsed)?.usage || null
    ).catch(() => null);
    recordAiEvent(parseRuntimeOperationId, 'saving', {
      provider: responseMeta.providerUsed || selectedProvider,
    });

    let escalation = null;
    if (persist) {
      escalation = new Escalation({
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
      await appendTraceEvent(trace?._id, {
        key: 'parse_persisted',
        label: 'Escalation persisted',
        status: 'success',
        provider: responseMeta.providerUsed || selectedProvider,
        model: getProviderModelId(responseMeta.providerUsed || selectedProvider),
        message: 'Structured parse was saved as an escalation record.',
        detail: { escalationId: escalation._id },
      }, traceStartedAt).catch(() => null);
    } else {
      logAttemptsUsage(parseResult.meta.attempts, { requestId: parseRequestId, service: 'parse', mode: resolvedMode });
    }
    await patchTrace(trace?._id, {
      status: 'ok',
      escalationId: escalation?._id || null,
      postParse: buildParseStage(responseMeta, 'ok', {
        traceId: trace?._id,
        latencyMs: Date.now() - traceStartedAt.getTime(),
        startedAt: traceStartedAt,
        completedAt: new Date(),
        escalationId: escalation?._id || null,
      }),
      outcome: buildOutcome({
        providerUsed: responseMeta.providerUsed || selectedProvider,
        modelUsed: getProviderModelId(responseMeta.providerUsed || selectedProvider),
        winner: responseMeta.winner || responseMeta.providerUsed,
        fallbackUsed: Boolean(responseMeta.fallbackUsed),
        fallbackFrom: responseMeta.fallbackFrom || '',
        totalMs: Date.now() - traceStartedAt.getTime(),
        completedAt: new Date(),
      }),
    }).catch(() => null);
    await appendTraceEvent(trace?._id, {
      key: 'parse_completed',
      label: 'Structured parse completed',
      status: 'success',
      provider: responseMeta.providerUsed || selectedProvider,
      model: getProviderModelId(responseMeta.providerUsed || selectedProvider),
      message: 'Structured parse completed successfully.',
      detail: responseMeta.validation || null,
    }, traceStartedAt).catch(() => null);
    parseSettled = true;
    recordAiEvent(parseRuntimeOperationId, 'completed', {
      provider: responseMeta.providerUsed || selectedProvider,
    });
    deleteAiOperation(parseRuntimeOperationId);
    if (persist) {
      return res.status(201).json({
        ok: true,
        escalation: escalation.toObject(),
        _meta: responseMeta,
        traceId: trace ? trace._id.toString() : null,
      });
    }
    return res.json({
      ok: true,
      escalation: parseResult.fields,
      _meta: responseMeta,
      traceId: trace ? trace._id.toString() : null,
    });
  } catch (err) {
    if (err && Array.isArray(err.attempts)) {
      logAttemptsUsage(err.attempts, { requestId: parseRequestId, service: 'parse', mode: resolvedMode });
    }
    await setTraceAttempts(trace?._id, err && Array.isArray(err.attempts) ? err.attempts : []).catch(() => null);
    await patchTrace(trace?._id, {
      status: 'error',
      postParse: buildParseStage(
        {
          mode: resolvedMode,
          providerUsed: selectedProvider,
          attempts: err && Array.isArray(err.attempts) ? err.attempts : [],
        },
        'error',
        {
          traceId: trace?._id,
          latencyMs: Date.now() - traceStartedAt.getTime(),
          startedAt: traceStartedAt,
          completedAt: new Date(),
        }
      ),
      outcome: buildOutcome({
        providerUsed: selectedProvider,
        modelUsed: getProviderModelId(selectedProvider),
        totalMs: Date.now() - traceStartedAt.getTime(),
        completedAt: new Date(),
        errorCode: err && err.code ? err.code : 'PARSE_FAILED',
        errorMessage: err && err.message ? err.message : 'Failed to parse escalation',
      }),
    }).catch(() => null);
    await appendTraceEvent(trace?._id, {
      key: 'parse_failed',
      label: 'Structured parse failed',
      status: 'error',
      provider: selectedProvider,
      model: getProviderModelId(selectedProvider),
      code: err && err.code ? err.code : 'PARSE_FAILED',
      message: err && err.message ? err.message : 'Failed to parse escalation',
      detail: { attempts: err && Array.isArray(err.attempts) ? err.attempts : [] },
    }, traceStartedAt).catch(() => null);
    parseSettled = true;
    recordAiEvent(parseRuntimeOperationId, 'error', {
      provider: selectedProvider,
      lastError: {
        code: err && err.code ? err.code : 'PARSE_FAILED',
        message: err && err.message ? err.message : 'Failed to parse escalation',
        detail: '',
      },
    });
    reportServerError({
      route: '/api/chat/parse-escalation',
      message: err && err.message ? err.message : 'Failed to parse escalation',
      code: err && err.code ? err.code : 'PARSE_FAILED',
      detail: err && err.stack ? err.stack : '',
      severity: 'error',
    });
    deleteAiOperation(parseRuntimeOperationId);
    const code = err && err.code ? err.code : 'PARSE_FAILED';
    const status = code === 'PARSE_FAILED' ? 422 : 500;
    return res.status(status).json({
      ok: false,
      code,
      error: err && err.message ? err.message : 'Failed to parse escalation',
      attempts: err && Array.isArray(err.attempts) ? err.attempts : [],
      traceId: trace ? trace._id.toString() : null,
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
  const includeTotal = safeString(req.query.includeTotal, '') === '1';
  const escapedSearch = escapeRegexLiteral(search);

  const filter = escapedSearch
    ? { title: { $regex: escapedSearch, $options: 'i' } }
    : {};

  try {
    // Use denormalized messageCount + lastMessagePreview fields (maintained by
    // pre-save hook) so MongoDB never touches the messages array.
    const listFields = 'title provider escalationId createdAt updatedAt messageCount lastMessagePreview forkedFrom forkMessageIndex';
    const conversationsPromise = Conversation.find(filter)
      .select(listFields)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .maxTimeMS(8000);
    const totalPromise = includeTotal
      ? Conversation.countDocuments(filter).maxTimeMS(5000)
      : Promise.resolve(undefined);
    const [conversations, total] = await Promise.all([
      conversationsPromise,
      totalPromise,
    ]);

    const items = conversations.map((c) => ({
      _id: c._id,
      title: normalizeConversationListTitle(c.title, c.lastMessagePreview?.preview),
      provider: normalizeProvider(c.provider),
      messageCount: c.messageCount || 0,
      lastMessage: c.lastMessagePreview || null,
      escalationId: c.escalationId,
      forkedFrom: c.forkedFrom || null,
      forkMessageIndex: c.forkMessageIndex != null ? c.forkMessageIndex : null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));

    if (includeTotal) {
      return res.json({ ok: true, conversations: items, total });
    }

    return res.json({ ok: true, conversations: items });
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
conversationsRouter.get('/:id/meta', async (req, res) => {
  const conversation = await Conversation.findById(req.params.id)
    .select('provider escalationId forkedFrom forkMessageIndex')
    .lean();
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }
  res.json({ ok: true, conversation });
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
    if (msg.role === 'assistant' && typeof msg.thinking === 'string' && msg.thinking.trim()) {
      lines.push('');
      lines.push('[Reasoning]');
      lines.push(msg.thinking);
    }
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
    thinking: m.thinking || '',
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
    forkedFrom: source._id,
    forkMessageIndex: sliceEnd - 1,
  });
  await forked.save();

  res.status(201).json({ ok: true, conversation: forked.toObject() });
});

// GET /api/conversations/:id/fork-tree -- Get the full fork tree for a conversation
conversationsRouter.get('/:id/fork-tree', async (req, res) => {
  const conv = await Conversation.findById(req.params.id).lean();
  if (!conv) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }

  // Walk up the forkedFrom chain to find the root
  let rootId = conv._id;
  let current = conv;
  const visited = new Set([rootId.toString()]);
  while (current.forkedFrom) {
    const parentId = current.forkedFrom;
    if (visited.has(parentId.toString())) break; // cycle guard
    visited.add(parentId.toString());
    const parent = await Conversation.findById(parentId)
      .select('_id title forkedFrom forkMessageIndex messageCount createdAt')
      .lean();
    if (!parent) break;
    rootId = parent._id;
    current = parent;
  }

  // Find all conversations that are forks (have forkedFrom set)
  const allForks = await Conversation.find({ forkedFrom: { $ne: null } })
    .select('_id title forkedFrom forkMessageIndex messageCount createdAt')
    .lean();

  const root = await Conversation.findById(rootId)
    .select('_id title messageCount createdAt')
    .lean();

  if (!root) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Root conversation not found' });
  }

  const buildTree = (parentId) => {
    const children = allForks.filter((f) => f.forkedFrom?.toString() === parentId.toString());
    return children.map((c) => ({
      _id: c._id,
      title: c.title,
      messageCount: c.messageCount,
      forkMessageIndex: c.forkMessageIndex,
      createdAt: c.createdAt,
      children: buildTree(c._id),
    }));
  };

  res.json({
    ok: true,
    tree: {
      _id: root._id,
      title: root.title,
      messageCount: root.messageCount,
      createdAt: root.createdAt,
      children: buildTree(root._id),
    },
  });
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
  const normalizedClientImageMeta = Array.isArray(lastUserMsg.imageMeta) ? lastUserMsg.imageMeta : [];

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
      fallbackProvider: requestedFallback,
      parallelProviders: parallelProviders || [],
    },
    resolved: {
      mode: policy.mode,
      reasoningEffort: effectiveReasoningEffort,
      timeoutMs: effectiveTimeoutMs,
      primaryProvider: policy.primaryProvider,
      fallbackProvider: policy.fallbackProvider,
      parallelProviders: policy.parallelProviders || [],
    },
  }).catch(() => null);
  await appendTraceEvent(trace?._id, {
    key: 'retry_received',
    label: 'Retry request received',
    status: 'info',
    provider: policy.primaryProvider,
    model: getProviderModelId(policy.primaryProvider),
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
        modelUsed: getProviderModelId(policy.primaryProvider),
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
          modelUsed: getProviderModelId(policy.primaryProvider),
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
          modelUsed: getProviderModelId(policy.primaryProvider),
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

  // Detect non-escalation intent from the original user message being retried.
  const nonEscalationIntent = isNonEscalationIntent(safeString(lastUserMsg.content, ''));

  // --- Image Transcription Pipeline (retry handler, same pattern as main handler) ---
  // Step 1: Fast transcription for ALL image messages.
  let imageTranscription = null;
  if (normalizedImages.length > 0) {
    try {
      res.write('data: ' + JSON.stringify({ type: 'status', message: 'Reading image text...' }) + '\n\n');
    } catch { /* client disconnected */ }

    imageTranscription = await transcribeImageForChat(normalizedImages, {
      model: getProviderModelId(policy.primaryProvider),
      reasoningEffort: 'medium',
      timeoutMs: IMAGE_TRANSCRIBE_TIMEOUT_MS,
    });
  }

  // Step 2: For escalation intent, also run structured triage parse.
  if (normalizedImages.length > 0 && !nonEscalationIntent) {
    try {
      res.write('data: ' + JSON.stringify({ type: 'status', message: 'Parsing escalation fields...' }) + '\n\n');
    } catch { /* client disconnected */ }
  }
  const imageTriageContext = (normalizedImages.length > 0 && !nonEscalationIntent)
    ? await buildImageTriageContext({
      images: normalizedImages,
      mode: policy.mode,
      primaryProvider: policy.primaryProvider,
      fallbackProvider: policy.fallbackProvider,
      reasoningEffort: effectiveReasoningEffort,
      timeoutMs: effectiveTimeoutMs,
    }).catch(() => null)
    : null;

  // Step 3: Build effective system prompt with transcription + triage data.
  let effectiveSystemPrompt = (normalizedImages.length > 0 && !nonEscalationIntent)
    ? buildImageTurnSystemPrompt(contextBundle.systemPrompt)
    : contextBundle.systemPrompt;
  if (imageTranscription && imageTranscription.text) {
    const transcriptionBlock = buildTranscriptionRefBlock(imageTranscription.text);
    if (transcriptionBlock) effectiveSystemPrompt = effectiveSystemPrompt + transcriptionBlock;
  }
  if (imageTriageContext && imageTriageContext.parseFields) {
    const refBlock = buildTriageRefBlock(imageTriageContext.parseFields);
    if (refBlock) effectiveSystemPrompt = effectiveSystemPrompt + refBlock;
  }

  // Step 4: Live INV matching (retry handler — same logic as main handler).
  const triageCategory = imageTriageContext?.triageCard?.category || null;
  const lastUserContent = safeString(lastUserMsg && lastUserMsg.content, '');
  const invMatchResult = await runInvMatching({
    message: lastUserContent || (imageTranscription && imageTranscription.text) || '',
    parseFields: imageTriageContext?.parseFields || null,
    category: triageCategory,
  });
  if (invMatchResult.matches.length > 0) {
    const invBlock = buildInvMatchRefBlock(invMatchResult.matches);
    if (invBlock) effectiveSystemPrompt = effectiveSystemPrompt + invBlock;
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
    model: getProviderModelId(policy.primaryProvider),
    message: 'SSE stream opened and retry accepted by the server.',
  }, traceStartedAt);
  res.write('event: start\ndata: ' + JSON.stringify({
    conversationId: conversation._id.toString(),
    requestId: req.requestId,
    traceId: trace ? trace._id.toString() : null,
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
          providerUsed: policy.primaryProvider,
          modelUsed: getProviderModelId(triageMeta?.providerUsed || policy.primaryProvider),
        }
      ),
    }).catch(() => {});
    appendTraceEvent(trace?._id, {
      key: triageMeta ? 'triage_completed' : 'triage_failed',
      label: triageMeta ? 'Image triage completed' : 'Image triage failed',
      status: triageMeta ? 'success' : 'error',
      provider: triageMeta?.providerUsed || policy.primaryProvider,
      model: getProviderModelId(triageMeta?.providerUsed || policy.primaryProvider),
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
          model: getProviderModelId(chunkProvider),
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
          model: getProviderModelId(thinkingProvider),
          message: `First reasoning chunk arrived from ${thinkingProvider}.`,
          elapsedMs: firstThinkingMs,
        }, traceStartedAt).catch(() => {});
      }
      try { res.write('event: thinking\ndata: ' + JSON.stringify({ provider: thinkingProvider, thinking }) + '\n\n'); } catch { /* gone */ }
    },
    onProviderError: (data) => {
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
        model: getProviderModelId(data && data.provider ? data.provider : ''),
        code: data && data.code ? data.code : 'PROVIDER_EXEC_FAILED',
        message: data && data.message ? data.message : 'Provider failed',
        detail: data || null,
      }, traceStartedAt).catch(() => {});
      try { res.write('event: provider_error\ndata: ' + JSON.stringify(data) + '\n\n'); } catch { /* gone */ }
    },
    onFallback: (data) => {
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
        model: getProviderModelId(data && data.to ? data.to : ''),
        code: data && data.reason ? data.reason : 'PROVIDER_ERROR',
        message: `${data && data.from ? data.from : 'primary'} -> ${data && data.to ? data.to : 'fallback'}`,
        detail: data || null,
      }, traceStartedAt).catch(() => {});
      try { res.write('event: fallback\ndata: ' + JSON.stringify(data) + '\n\n'); } catch { /* gone */ }
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
        await saveConversationLenient(conversation);
        await setTraceAttempts(trace?._id, attempts);
        await setTraceUsage(trace?._id, compliantData.usage);
        await patchTrace(trace?._id, {
          status: 'ok',
          responseChars: sumResponseChars(compliantData),
          stats: buildTraceStats(traceStats),
          outcome: buildOutcome({
            providerUsed: compliantData.providerUsed || policy.primaryProvider,
            modelUsed: (compliantData.usage && compliantData.usage.model) || getProviderModelId(compliantData.providerUsed || policy.primaryProvider),
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
          model: (compliantData.usage && compliantData.usage.model) || getProviderModelId(compliantData.providerUsed || policy.primaryProvider),
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
            const retryArchiveModelParsing = compliantData.fullResponse
              || (Array.isArray(compliantData.results) && compliantData.results.find((r) => r.status === 'ok')?.fullResponse)
              || '';
            archiveImages({
              conversationId: conversation._id.toString(),
              messageIndex: Math.max(0, retryUserMsgIndex),
              images: normalizedImages,
              userPrompt: safeString(lastUserMsg && lastUserMsg.content, ''),
              modelParsing: retryArchiveModelParsing,
              parseFields: imageTriageContext && imageTriageContext.parseFields ? imageTriageContext.parseFields : null,
              triageCard: imageTriageContext && imageTriageContext.triageCard ? imageTriageContext.triageCard : null,
              provider: compliantData.providerUsed || policy.primaryProvider,
              usage: compliantData.usage || null,
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
            modelUsed: getProviderModelId(policy.primaryProvider),
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
          model: getProviderModelId(policy.primaryProvider),
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
          modelUsed: getProviderModelId(policy.primaryProvider),
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
        model: getProviderModelId(policy.primaryProvider),
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
          modelUsed: getProviderModelId(policy.primaryProvider),
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
        model: getProviderModelId(policy.primaryProvider),
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
        model: getProviderModelId(policy.primaryProvider),
        code: 'CLIENT_DISCONNECTED',
        message: 'The client connection closed before the retry settled.',
      }, traceStartedAt).catch(() => {});
      if (cleanupFn) cleanupFn();
    }
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
          thinking: candidate.thinking || '',
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

// GET /api/chat/image-archive/stats -- Archive-wide statistics
chatRouter.get('/image-archive/stats', (req, res) => {
  const result = getArchiveStats();
  if (!result.ok) {
    return res.status(500).json({ ok: false, code: 'ARCHIVE_STATS_FAILED', error: result.error });
  }
  res.json({ ok: true, ...result.stats });
});

// GET /api/chat/image-archive/all -- All archived images with filtering + pagination
chatRouter.get('/image-archive/all', (req, res) => {
  const { grade, dateFrom, dateTo, conversationId, limit = '200', offset = '0' } = req.query;
  const result = getAllImages({
    grade: grade || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    conversationId: conversationId || undefined,
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
  });
  res.json({ ok: true, ...result });
});

// GET /api/chat/image-archive/:conversationId -- List all archived images for a conversation
chatRouter.get('/image-archive/:conversationId', (req, res) => {
  const { conversationId } = req.params;
  if (!isValidObjectId(conversationId)) {
    return res.status(400).json({ ok: false, code: 'INVALID_CONVERSATION_ID', error: 'Invalid conversationId' });
  }
  const result = getArchive(conversationId);
  if (!result.ok) {
    return res.status(500).json({ ok: false, code: 'ARCHIVE_READ_FAILED', error: result.error });
  }
  res.json({ ok: true, images: result.images, count: result.images.length });
});

// GET /api/chat/image-archive/:conversationId/:imageId/file -- Serve an archived image file
chatRouter.get('/image-archive/:conversationId/:imageId/file', (req, res) => {
  const { conversationId, imageId } = req.params;
  if (!isValidObjectId(conversationId)) {
    return res.status(400).json({ ok: false, code: 'INVALID_CONVERSATION_ID', error: 'Invalid conversationId' });
  }
  const result = getImageFile(conversationId, imageId);
  if (!result.ok) {
    return res.status(404).json({ ok: false, code: 'IMAGE_NOT_FOUND', error: result.error });
  }
  res.setHeader('Content-Type', result.contentType || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(result.filePath);
});

// GET /api/chat/image-archive/:conversationId/:imageId/metadata -- Serve metadata JSON for a single image
chatRouter.get('/image-archive/:conversationId/:imageId/metadata', (req, res) => {
  const { conversationId, imageId } = req.params;
  if (!isValidObjectId(conversationId)) {
    return res.status(400).json({ ok: false, code: 'INVALID_CONVERSATION_ID', error: 'Invalid conversationId' });
  }
  const archive = getArchive(conversationId);
  if (!archive.ok) {
    return res.status(500).json({ ok: false, code: 'ARCHIVE_READ_FAILED', error: archive.error });
  }
  const entry = archive.images.find((img) => img._imageId === imageId);
  if (!entry) {
    return res.status(404).json({ ok: false, code: 'IMAGE_NOT_FOUND', error: 'Image metadata not found' });
  }
  res.json({ ok: true, metadata: entry });
});

module.exports = { chatRouter, conversationsRouter };
