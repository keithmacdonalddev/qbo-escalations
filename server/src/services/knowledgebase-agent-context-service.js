'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Escalation = require('../models/Escalation');
const KnowledgeCandidate = require('../models/KnowledgeCandidate');
const { estimateBase64Bytes, extractBase64Payload } = require('../lib/chat-image');
const {
  getAgentPromptDefinition,
  getPromptSha256,
  getPromptVersionFromText,
  getRenderedAgentPrompt,
} = require('../lib/agent-prompt-store');
// Draft extraction goes through the shared capture-enabled provider dispatch
// (the same one triage uses), NOT the legacy pre-harness claude.js subprocess
// wrapper: every provider call must save its whole response to MongoDB as a
// ProviderCallPackage, and the agent must read its answer back from the saved
// package (see runKnowledgeBaseAgentCompletion).
const {
  DIRECT_TRIAGE_PROVIDERS,
  extractTriageTextFromProviderPackage,
  getEffectiveModel,
  runDirectTriageProviderCall,
  waitForProviderPackage,
} = require('./triage');
const {
  KNOWLEDGEBASE_PROVIDER_CALL_SITE,
  KNOWLEDGEBASE_PROVIDER_OPERATION,
} = require('./providers/provider-handoff');
const {
  normalizeKnowledgeCandidate,
  normalizeKnowledgeRecordId,
  searchKnowledge,
} = require('./knowledgebase-service');
const { listAgentRuntimeDefaults } = require('./agent-identity-service');
const { resolveAgentRuntimePolicy } = require('./room-agent-runtime');
const { DEFAULT_PROFILES } = require('./room-agents/agent-profiles');
const {
  KB_AGENT_TOOL_LINES,
  createKbAgentToolHandlers,
} = require('./knowledgebase-agent-tools');
const { runKnowledgeBaseAgentToolLoop } = require('./knowledgebase-agent-tool-loop');

const KNOWLEDGEBASE_AGENT_ID = 'knowledgebase-agent';
const UPLOADS_ROOT = path.resolve(__dirname, '..', '..', 'uploads');
const DEFAULT_MAX_CONTEXT_IMAGES = 12;
const DEFAULT_MAX_CONTEXT_IMAGE_BYTES = 24 * 1024 * 1024;
const DEFAULT_MAX_CONTEXT_MESSAGES = Number.MAX_SAFE_INTEGER;
const MAX_STORED_AGENT_MESSAGES = 80;

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function compactText(value, maxChars = 1000) {
  const text = safeString(value, '').replace(/\s+/g, ' ').trim();
  if (!text || text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function clonePlain(value, fallback = null) {
  if (!value || typeof value !== 'object') return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
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

function isLikelyObjectId(value) {
  return typeof value === 'string' && mongoose.isValidObjectId(value);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function getPromptMetadata() {
  const systemPrompt = getRenderedAgentPrompt(KNOWLEDGEBASE_AGENT_ID);
  const definition = getAgentPromptDefinition(KNOWLEDGEBASE_AGENT_ID);
  return {
    promptId: KNOWLEDGEBASE_AGENT_ID,
    promptName: definition?.name || 'Knowledge Base Agent',
    promptVersion: getPromptVersionFromText(systemPrompt),
    promptSha256: getPromptSha256(systemPrompt),
    systemPrompt,
  };
}

function getMaxContextImages() {
  return parsePositiveInt(process.env.KNOWLEDGEBASE_AGENT_MAX_IMAGES, DEFAULT_MAX_CONTEXT_IMAGES);
}

function getMaxContextImageBytes() {
  return parsePositiveInt(process.env.KNOWLEDGEBASE_AGENT_MAX_IMAGE_BYTES, DEFAULT_MAX_CONTEXT_IMAGE_BYTES);
}

function getMaxContextMessages() {
  return parsePositiveInt(process.env.KNOWLEDGEBASE_AGENT_MAX_MESSAGES, DEFAULT_MAX_CONTEXT_MESSAGES);
}

function mimeTypeFromPath(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/png';
}

function imageRefFromDataUrl({ dataUrl, source, conversationId, messageIndex, imageIndex, imageMeta, prompt }) {
  const payload = extractBase64Payload(dataUrl);
  const bytes = estimateBase64Bytes(payload);
  const mimeMatch = safeString(dataUrl).match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
  const imageId = source === 'conversation'
    ? `msg-${messageIndex}-img-${imageIndex}`
    : `image-${messageIndex}-${imageIndex}`;
  return {
    source,
    imageId,
    conversationId: conversationId || '',
    messageIndex,
    imageIndex,
    mimeType,
    bytes,
    url: source === 'conversation' && conversationId
      ? `/api/chat/image-archive/${encodeURIComponent(conversationId)}/${encodeURIComponent(imageId)}/file`
      : '',
    imageMeta: imageMeta && typeof imageMeta === 'object' ? imageMeta : null,
    prompt: compactText(prompt, 500),
    dataUrl,
  };
}

function collectConversationMessages(conversation) {
  const conversationId = objectIdString(conversation?._id);
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const maxMessages = getMaxContextMessages();
  const startIndex = Math.max(0, messages.length - maxMessages);
  const imageRefs = [];

  const normalized = messages.slice(-maxMessages).map((message, localIndex) => {
    const index = startIndex + localIndex;
    const images = Array.isArray(message?.images) ? message.images : [];
    const imageMeta = Array.isArray(message?.imageMeta) ? message.imageMeta : [];
    images.forEach((image, imageIndex) => {
      if (typeof image !== 'string' || !image.trim()) return;
      imageRefs.push(imageRefFromDataUrl({
        dataUrl: image,
        source: 'conversation',
        conversationId,
        messageIndex: index,
        imageIndex,
        imageMeta: imageMeta[imageIndex] || null,
        prompt: message?.content || '',
      }));
    });
    return {
      index,
      role: safeString(message?.role, 'user'),
      content: safeString(message?.content, ''),
      thinking: safeString(message?.thinking, ''),
      provider: safeString(message?.provider, ''),
      modelUsed: safeString(message?.modelUsed, ''),
      traceRequestId: safeString(message?.traceRequestId, ''),
      imageCount: images.length,
      imageMeta,
      timestamp: toIso(message?.timestamp),
    };
  });

  return { messages: normalized, imageRefs };
}

function collectEscalationScreenshotRefs(escalation) {
  const refs = [];
  const rawImages = [];
  const paths = Array.isArray(escalation?.screenshotPaths) ? escalation.screenshotPaths : [];
  paths.forEach((relativePath, index) => {
    const resolved = path.resolve(UPLOADS_ROOT, relativePath);
    const relative = path.relative(UPLOADS_ROOT, resolved);
    const isWithinUploads = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    const publicPath = safeString(relativePath).replace(/\\/g, '/');
    if (!isWithinUploads || !fs.existsSync(resolved)) {
      refs.push({
        source: 'escalation-screenshot',
        imageId: `screenshot-${index}`,
        path: relativePath,
        url: `/uploads/${publicPath}`,
        available: false,
      });
      return;
    }
    let bytes = 0;
    let dataUrl = '';
    try {
      const buffer = fs.readFileSync(resolved);
      bytes = buffer.length;
      dataUrl = `data:${mimeTypeFromPath(resolved)};base64,${buffer.toString('base64')}`;
    } catch {
      dataUrl = '';
    }
    refs.push({
      source: 'escalation-screenshot',
      imageId: `screenshot-${index}`,
      path: relativePath,
      url: `/uploads/${publicPath}`,
      bytes,
      available: Boolean(dataUrl),
    });
    if (dataUrl) rawImages.push({ dataUrl, bytes });
  });
  return { refs, rawImages };
}

function selectRawImages(imageRefs = [], screenshotRawImages = []) {
  const maxImages = getMaxContextImages();
  const maxBytes = getMaxContextImageBytes();
  const selected = [];
  let totalBytes = 0;

  const candidates = [
    ...imageRefs.map((ref) => ({ dataUrl: ref.dataUrl, bytes: ref.bytes || estimateBase64Bytes(extractBase64Payload(ref.dataUrl)), source: ref.source, imageId: ref.imageId })),
    ...screenshotRawImages.map((item, index) => ({ ...item, source: 'escalation-screenshot', imageId: `screenshot-${index}` })),
  ];

  for (const candidate of candidates) {
    if (!candidate.dataUrl || selected.length >= maxImages) break;
    const bytes = Number(candidate.bytes || 0);
    if (bytes > 0 && totalBytes + bytes > maxBytes) continue;
    selected.push(candidate.dataUrl);
    totalBytes += Math.max(0, bytes);
  }

  return {
    images: selected,
    totalBytes,
    omittedCount: Math.max(0, candidates.filter((item) => item.dataUrl).length - selected.length),
    limit: maxImages,
    byteLimit: maxBytes,
  };
}

function summarizeWorkflowAgents(caseIntake) {
  const runs = Array.isArray(caseIntake?.runs) ? caseIntake.runs : [];
  return [...new Set(runs.map((run) => safeString(run?.agentId)).filter(Boolean))];
}

function summarizeCaseIntake(caseIntake) {
  const intake = caseIntake && typeof caseIntake === 'object' ? caseIntake : {};
  const runs = Array.isArray(intake.runs) ? intake.runs : [];
  return {
    status: safeString(intake.status, 'none'),
    source: safeString(intake.source, ''),
    canonicalTemplate: safeString(intake.canonicalTemplate, ''),
    parseFields: clonePlain(intake.parseFields, null),
    parseMeta: clonePlain(intake.parseMeta, null),
    knownIssueSearchResult: clonePlain(intake.knownIssueSearchResult, null),
    triageCard: clonePlain(intake.triageCard, null),
    followUps: Array.isArray(intake.followUps) ? clonePlain(intake.followUps, []) : [],
    runs: runs.map((run) => ({
      id: safeString(run?.id),
      agentId: safeString(run?.agentId),
      agentName: safeString(run?.agentName),
      phase: safeString(run?.phase),
      status: safeString(run?.status),
      provider: safeString(run?.provider),
      model: safeString(run?.model),
      summary: compactText(run?.summary, 500),
      detail: clonePlain(run?.detail, null),
      fallback: clonePlain(run?.fallback, null),
      eventCount: Number(run?.eventCount || 0),
      events: Array.isArray(run?.events) ? clonePlain(run.events.slice(-80), []) : [],
      startedAt: toIso(run?.startedAt),
      completedAt: toIso(run?.completedAt),
      durationMs: run?.durationMs ?? null,
    })),
  };
}

function buildRelatedQuery({ candidate, draftData, escalation }) {
  return [
    draftData?.title,
    candidate?.title,
    draftData?.reportedProblem,
    candidate?.reportedProblem,
    candidate?.summary,
    escalation?.actualOutcome,
    escalation?.attemptingTo,
    escalation?.tsSteps,
    escalation?.resolution,
  ].map((value) => compactText(value, 220)).filter(Boolean).join(' ');
}

async function findRelatedKnowledge({ candidate, draftData, escalation }) {
  const query = buildRelatedQuery({ candidate, draftData, escalation });
  if (!query) return [];
  const result = await searchKnowledge({
    query,
    includeCandidates: true,
    includeLegacy: false,
    limit: 8,
  });
  const ownId = candidate?._id ? `candidate:${objectIdString(candidate._id)}` : '';
  return (result.records || [])
    .filter((record) => record.id !== ownId)
    .slice(0, 6)
    .map((record) => ({
      id: record.id,
      title: record.title,
      category: record.category,
      reviewStatus: record.reviewStatus,
      trustState: record.trustState,
      summary: record.summary,
      finalOutcome: record.finalOutcome,
      keySignals: record.keySignals,
    }));
}

async function loadCandidateFromRecordId(recordId) {
  const parsed = normalizeKnowledgeRecordId(recordId);
  if (!parsed.id || parsed.sourceType !== 'knowledge-candidate' || !isLikelyObjectId(parsed.id)) {
    const err = new Error('Knowledge Base Agent chat requires a knowledge draft record.');
    err.code = 'KNOWLEDGE_AGENT_RECORD_REQUIRED';
    err.status = 400;
    throw err;
  }
  const candidate = await KnowledgeCandidate.findById(parsed.id);
  if (!candidate) {
    const err = new Error('Knowledge record not found.');
    err.code = 'KNOWLEDGE_RECORD_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  return candidate;
}

async function buildKnowledgeBaseAgentContext({
  recordId = '',
  candidate = null,
  escalation = null,
  draftData = null,
  includeRelated = true,
  includeRawImages = false,
} = {}) {
  const sourceCandidate = candidate || (recordId ? await loadCandidateFromRecordId(recordId) : null);
  const candidateObject = sourceCandidate?.toObject ? sourceCandidate.toObject() : sourceCandidate;
  const escalationId = objectIdString(escalation?._id || candidateObject?.escalationId);
  const sourceEscalation = escalation
    || (isLikelyObjectId(escalationId) ? await Escalation.findById(escalationId).lean() : null);
  const conversationId = objectIdString(
    candidateObject?.conversationId
    || sourceEscalation?.conversationId
    || draftData?.conversationId
  );
  const conversation = isLikelyObjectId(conversationId)
    ? await Conversation.findById(conversationId).lean()
    : null;
  const conversationParts = collectConversationMessages(conversation);
  const screenshotParts = collectEscalationScreenshotRefs(sourceEscalation);
  const rawImageSelection = includeRawImages
    ? selectRawImages(conversationParts.imageRefs, screenshotParts.rawImages)
    : { images: [], totalBytes: 0, omittedCount: 0, limit: getMaxContextImages(), byteLimit: getMaxContextImageBytes() };
  const caseIntake = summarizeCaseIntake(conversation?.caseIntake);
  const relatedKnowledge = includeRelated
    ? await findRelatedKnowledge({ candidate: candidateObject, draftData, escalation: sourceEscalation })
    : [];
  const prompt = getPromptMetadata();
  const normalizedRecord = candidateObject ? normalizeKnowledgeCandidate(candidateObject) : null;
  const workflowAgents = summarizeWorkflowAgents(caseIntake);
  const sourceCounts = {
    hasKnowledgeDraft: Boolean(candidateObject),
    hasEscalation: Boolean(sourceEscalation),
    hasConversation: Boolean(conversation),
    conversationMessages: conversationParts.messages.length,
    conversationMessagesAvailable: Array.isArray(conversation?.messages) ? conversation.messages.length : 0,
    conversationImages: conversationParts.imageRefs.length,
    rawImagesProvidedToModel: rawImageSelection.images.length,
    rawImagesOmittedFromModel: rawImageSelection.omittedCount,
    escalationScreenshots: screenshotParts.refs.length,
    workflowRuns: Array.isArray(caseIntake.runs) ? caseIntake.runs.length : 0,
    relatedKnowledge: relatedKnowledge.length,
    followUps: Array.isArray(caseIntake.followUps) ? caseIntake.followUps.length : 0,
  };

  const context = {
    prompt: {
      id: prompt.promptId,
      name: prompt.promptName,
      version: prompt.promptVersion,
      sha256: prompt.promptSha256,
    },
    knowledgeDraft: normalizedRecord || {
      title: draftData?.title || '',
      category: draftData?.category || sourceEscalation?.category || 'unknown',
      customerGoal: draftData?.customerGoal || '',
      reportedProblem: draftData?.reportedProblem || '',
      evidenceFromCase: draftData?.evidenceFromCase || '',
      troubleshootingTried: draftData?.troubleshootingTried || '',
      confirmedCause: draftData?.confirmedCause || '',
      finalOutcome: draftData?.finalOutcome || '',
      invEscalationStatus: draftData?.invEscalationStatus || '',
      keySignals: draftData?.keySignals || [],
    },
    escalation: sourceEscalation ? {
      id: objectIdString(sourceEscalation._id),
      coid: safeString(sourceEscalation.coid),
      mid: safeString(sourceEscalation.mid),
      caseNumber: safeString(sourceEscalation.caseNumber),
      clientContact: safeString(sourceEscalation.clientContact),
      agentName: safeString(sourceEscalation.agentName),
      attemptingTo: safeString(sourceEscalation.attemptingTo),
      expectedOutcome: safeString(sourceEscalation.expectedOutcome),
      actualOutcome: safeString(sourceEscalation.actualOutcome),
      triedTestAccount: safeString(sourceEscalation.triedTestAccount),
      tsSteps: safeString(sourceEscalation.tsSteps),
      category: safeString(sourceEscalation.category),
      status: safeString(sourceEscalation.status),
      resolution: safeString(sourceEscalation.resolution),
      resolutionNotes: safeString(sourceEscalation.resolutionNotes),
      source: safeString(sourceEscalation.source),
      parseMeta: clonePlain(sourceEscalation.parseMeta, null),
      screenshotPaths: Array.isArray(sourceEscalation.screenshotPaths) ? sourceEscalation.screenshotPaths : [],
      screenshotHashes: Array.isArray(sourceEscalation.screenshotHashes) ? sourceEscalation.screenshotHashes : [],
      resolvedAt: toIso(sourceEscalation.resolvedAt),
      createdAt: toIso(sourceEscalation.createdAt),
      updatedAt: toIso(sourceEscalation.updatedAt),
    } : null,
    conversation: conversation ? {
      id: objectIdString(conversation._id),
      title: safeString(conversation.title),
      provider: safeString(conversation.provider),
      escalationId: objectIdString(conversation.escalationId),
      messageCount: Number(conversation.messageCount || conversationParts.messages.length),
      createdAt: toIso(conversation.createdAt),
      updatedAt: toIso(conversation.updatedAt),
      messages: conversationParts.messages,
      imageRefs: conversationParts.imageRefs.map(({ dataUrl, ...ref }) => ref),
    } : null,
    attachments: {
      conversationImages: conversationParts.imageRefs.map(({ dataUrl, ...ref }) => ref),
      escalationScreenshots: screenshotParts.refs,
      rawImagePolicy: {
        providedToModel: rawImageSelection.images.length,
        omittedFromModel: rawImageSelection.omittedCount,
        maxImages: rawImageSelection.limit,
        maxTotalBytes: rawImageSelection.byteLimit,
      },
    },
    workflow: {
      agents: workflowAgents,
      caseIntake,
    },
    relatedKnowledge,
    sourceCounts,
    builtAt: new Date().toISOString(),
  };

  return {
    context,
    contextText: buildKnowledgeBaseAgentContextText(context),
    rawImages: rawImageSelection.images,
    candidate: sourceCandidate,
    escalation: sourceEscalation,
    conversation,
    prompt,
  };
}

function buildKnowledgeBaseAgentContextText(context) {
  return [
    '# Current Knowledge Base Agent Context',
    '',
    'This is the complete available context package for the selected KB draft. Use it as source evidence. If a section is missing, say it is missing.',
    '',
    '## Context JSON',
    '```json',
    JSON.stringify(context, null, 2),
    '```',
  ].join('\n');
}

function buildKnowledgeBaseDraftExtractionPrompt(contextBundle) {
  return [
    contextBundle.contextText,
    '',
    '# Task',
    '',
    'Complete the reviewer-facing KB draft fields from this context.',
    '',
    'Return a raw JSON object only, with these fields:',
    '{',
    '  "title": "reusable KB title that follows the Title rules below",',
    '  "category": "QBO area",',
    '  "customerGoal": "formal 1-2 sentence summary of what CS/customer was attempting to do",',
    '  "reportedProblem": "formal 1-3 sentence summary of what went wrong",',
    '  "evidenceFromCase": "summary of template, screenshots, chat, assistant research, user notes, and INV-agent evidence",',
    '  "troubleshootingTried": "what had already been checked or attempted",',
    '  "confirmedCause": "why it happened, or Unknown with the missing proof",',
    '  "finalOutcome": "the answer to the original issue",',
    '  "invEscalationStatus": "INV/further escalation status and evidence requirement",',
    '  "importantBoundaries": ["when not to confuse this with another issue"],',
    '  "keySignals": ["retrieval clues for future matching"],',
    '  "summary": "1-2 sentence overview"',
    '}',
    '',
    'Title rules:',
    '- Pattern: symptom + where it appears + product area. Example: "Payroll Tax Center shows negative federal tax balance after overpayment instead of clearing to $0 (QBO Canada Payroll)".',
    '- Deliberately EXCLUDE case-specific values (dollar amounts, case numbers, COIDs, customer or company names). Other specialists searching future cases with different amounts must still match this title; the case-specific details belong in the evidence fields.',
    '- One concise sentence or phrase, no trailing period, at most 200 characters.',
    '',
    'Do not invent facts. Do not treat attempted troubleshooting as the final answer.',
  ].join('\n');
}

// Resolve the provider/model/failover policy for the KB agent at request time.
// Server-driven (the KB sidebar route only sends `message`), so we read the
// saved profile runtime here rather than threading it through the client. When
// the operator has not configured a runtime, this falls back to the neutral
// global catalog default with automatic failover, per the app-agnostic rule
// (never hardcode a brand). Failover is ALWAYS on for every agent.
async function resolveKbAgentRuntimePolicy() {
  let savedRuntime = null;
  try {
    const defaults = await listAgentRuntimeDefaults([KNOWLEDGEBASE_AGENT_ID]);
    savedRuntime = defaults?.[KNOWLEDGEBASE_AGENT_ID]?.runtime || null;
  } catch {
    savedRuntime = null;
  }

  // Translate the persisted runtime shape ({ provider, model, fallbackProvider,
  // fallbackModel, mode, reasoningEffort, serviceTier }) into the selection shape
  // resolveAgentRuntimePolicy consumes ({ primaryProvider, primaryModel, ... }).
  const selection = savedRuntime
    ? {
        primaryProvider: savedRuntime.provider,
        primaryModel: savedRuntime.model,
        fallbackProvider: savedRuntime.fallbackProvider,
        fallbackModel: savedRuntime.fallbackModel,
        mode: savedRuntime.mode,
        reasoningEffort: savedRuntime.reasoningEffort,
        serviceTier: savedRuntime.serviceTier,
      }
    : null;

  const profile = DEFAULT_PROFILES[KNOWLEDGEBASE_AGENT_ID] || { agentId: KNOWLEDGEBASE_AGENT_ID };
  const policy = resolveAgentRuntimePolicy(
    profile,
    selection ? { [KNOWLEDGEBASE_AGENT_ID]: selection } : {}
  );

  // Failover is always on for every agent (the engine fails over to the backup
  // automatically). The room-agent resolver always yields a distinct backup.
  return { ...policy, autoFailover: true };
}

function buildKnowledgeBaseAgentSidebarSystemPrompt(basePrompt) {
  return [
    basePrompt,
    '',
    '# Right Sidebar Conversation Mode',
    '',
    'You are chatting with the human reviewer about the currently open KB draft.',
    'The current draft, source escalation, linked chat, workflow agent outputs, image references, and related KB entries are provided in the user context message.',
    'You may answer questions that are not limited to QBO, but keep your primary role clear: help review, explain, and improve the KB draft.',
    'When the reviewer asks about a KB field, tie the answer back to the evidence in the current context.',
    'When the reviewer asks whether something is proven, separate source evidence from inference.',
    '',
    '# Editing The Draft',
    '',
    'You can actually SAVE edits to this draft using the tools below — your changes are applied directly and the reviewer sees a list of exactly what changed with one-click undo.',
    'Use the tools to inspect first and save second. After you save with kb.updateDraft, state in plain language exactly which fields you changed.',
    'You can NEVER approve, publish, deprecate, redact, or change review/trust status. Those are human-only decisions and the tools enforce that for you.',
    '',
    KB_AGENT_TOOL_LINES,
  ].join('\n');
}

// HTTP-provider response budget for the draft extraction. The extraction
// returns a multi-field JSON object, so it needs more room than triage's
// compact card (the shared dispatch defaults to triage's 1200).
const KB_DRAFT_MAX_OUTPUT_TOKENS = 4000;

// Flatten the completion messages into the single prompt string the shared
// provider dispatch sends. The draft extraction passes exactly one user
// message; multi-message input is flattened with role labels (same convention
// the claude-cli harness uses for multi-turn stdin prompts).
function buildUserPromptFromMessages(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length === 0) return '';
  if (list.length === 1) return safeString(list[0]?.content, '');
  const lines = list.map((message) => {
    const role = message?.role === 'assistant' ? 'Assistant' : message?.role === 'system' ? 'System' : 'User';
    return `${role}: ${safeString(message?.content, '')}`;
  });
  lines.push('Assistant:');
  return lines.join('\n\n');
}

// Knowledge Base Agent single-shot completion, provider-harness transport.
//
// House rule (mirrors the triage reference pattern in runTriage): hand the
// prompt to the capture-enabled provider dispatch with forceCapture, wait for
// the ProviderCallPackage to be readable in MongoDB, then build the result by
// reading the package back — never from the in-memory provider response. The
// whole provider payload (including any thinking/reasoning events the provider
// emitted) is persisted in the package.
//
// Provider/model/failover come from the agent profile runtime
// (resolveKbAgentRuntimePolicy — the single source of truth); failover is
// always on: the configured (or neutral-default) backup is attempted when the
// primary attempt fails. If BOTH attempts fail, the error propagates so the
// caller's deterministic draft remains the final resort.
//
// Images are carried on the CLI providers (claude/codex, via temp files); the
// shared dispatch builds text-only bodies for the HTTP providers, exactly as
// it does for triage — the context text still carries the image references.
//
// `directProviderCall` / `waitForPackage` / `runtimePolicy` are injection
// seams for tests, in the same style as runTriage's injectable options.
async function runKnowledgeBaseAgentCompletion({
  messages,
  images = [],
  timeoutMs = 120000,
  systemPromptMode = 'sidebar',
  runtimePolicy = null,
  // Extra origin metadata stamped onto the captured ProviderCallPackage
  // (e.g. the escalation that triggered a draft extraction) so the forensic
  // record links back to its source. Merged into captureOverrides.metadata.
  captureMetadata = null,
  directProviderCall = runDirectTriageProviderCall,
  waitForPackage = waitForProviderPackage,
} = {}) {
  const prompt = getPromptMetadata();
  const systemPrompt = systemPromptMode === 'draft'
    ? prompt.systemPrompt
    : buildKnowledgeBaseAgentSidebarSystemPrompt(prompt.systemPrompt);
  const policy = runtimePolicy || await resolveKbAgentRuntimePolicy();
  const promptTrace = {
    promptId: KNOWLEDGEBASE_AGENT_ID,
    promptVersion: prompt.promptVersion || '',
    promptLength: safeString(systemPrompt, '').length,
  };
  const userPrompt = buildUserPromptFromMessages(messages);

  // One full provider attempt: dispatch -> wait for the saved package -> read
  // the text back from the package. Each attempt produces and reads back its
  // OWN ProviderCallPackage (the capture pipeline keys off the providerTrace
  // returned by THIS call), so a backup never reuses the primary's package.
  async function attemptProviderCompletion(attemptProvider, attemptModel) {
    const providerResult = await directProviderCall({
      provider: attemptProvider,
      model: attemptModel,
      systemPrompt,
      userPrompt,
      images,
      reasoningEffort: policy.reasoningEffort || 'medium',
      serviceTier: policy.serviceTier || '',
      timeoutMs,
      promptTrace,
      maxTokens: KB_DRAFT_MAX_OUTPUT_TOKENS,
      captureOverrides: {
        callSite: KNOWLEDGEBASE_PROVIDER_CALL_SITE,
        operation: KNOWLEDGEBASE_PROVIDER_OPERATION,
        agent: KNOWLEDGEBASE_AGENT_ID,
        metadata: {
          sourceAgent: KNOWLEDGEBASE_AGENT_ID,
          systemPromptMode,
          ...(captureMetadata && typeof captureMetadata === 'object' ? captureMetadata : {}),
        },
      },
    });
    const providerTrace = providerResult?.providerTrace || null;
    const providerPackage = await waitForPackage(providerTrace);
    const payload = await extractTriageTextFromProviderPackage(providerPackage, providerTrace);
    if (!payload.text) {
      const emptyErr = new Error('Knowledge Base Agent provider package did not contain usable text.');
      emptyErr.code = 'PROVIDER_PACKAGE_EMPTY_RESPONSE';
      emptyErr.providerPackageId = providerTrace?.providerPackageId || null;
      throw emptyErr;
    }
    return { providerTrace, providerPackage, payload };
  }

  const primaryProvider = policy.primaryProvider;
  const primaryModel = getEffectiveModel(primaryProvider, policy.primaryModel);
  let provider = primaryProvider;
  let model = primaryModel;
  let attempt;
  try {
    attempt = await attemptProviderCompletion(primaryProvider, primaryModel);
  } catch (primaryErr) {
    // Automatic provider-to-provider failover, consistent with the universal
    // failover already shipped for chat/image-parser/triage. The backup is the
    // profile-resolved fallback (resolveKbAgentRuntimePolicy defaults it to the
    // neutral global alternate via resolveAgentBackup — no use-case reasoning).
    // Only a DISTINCT, supported provider is attempted; otherwise the primary
    // failure propagates to the caller's deterministic-draft final resort.
    const backupProvider = DIRECT_TRIAGE_PROVIDERS.includes(policy.fallbackProvider)
      ? policy.fallbackProvider
      : '';
    if (!backupProvider || backupProvider === primaryProvider) {
      throw primaryErr;
    }
    const backupModel = getEffectiveModel(backupProvider, policy.fallbackModel);
    console.warn(
      '[knowledgebase-agent] primary provider %s failed (%s); failing over to %s',
      primaryProvider,
      primaryErr?.message || primaryErr?.code || 'unknown error',
      backupProvider
    );
    provider = backupProvider;
    model = backupModel;
    attempt = await attemptProviderCompletion(backupProvider, backupModel);
  }

  return {
    text: attempt.payload.text,
    usage: attempt.providerTrace?.usage || null,
    prompt,
    providerUsed: provider,
    modelUsed: attempt.providerTrace?.model || model,
    reasoningEffort: policy.reasoningEffort || '',
    providerPackageId: safeString(attempt.providerTrace?.providerPackageId, ''),
    payloadSourcePath: attempt.payload.sourcePath || '',
    fallbackUsed: provider !== primaryProvider,
    fallbackFrom: provider !== primaryProvider ? primaryProvider : '',
  };
}

async function runKnowledgeBaseAgentDraftExtraction({
  escalation,
  draftData,
  candidate = null,
  // Test seams, forwarded to runKnowledgeBaseAgentCompletion.
  runtimePolicy = null,
  directProviderCall = undefined,
  waitForPackage = undefined,
} = {}) {
  const contextBundle = await buildKnowledgeBaseAgentContext({
    candidate,
    escalation,
    draftData,
    includeRawImages: true,
    includeRelated: true,
  });
  const completion = await runKnowledgeBaseAgentCompletion({
    messages: [
      {
        role: 'user',
        content: buildKnowledgeBaseDraftExtractionPrompt(contextBundle),
      },
    ],
    images: contextBundle.rawImages,
    timeoutMs: 120000,
    systemPromptMode: 'draft',
    runtimePolicy,
    // Forward link: the captured ProviderCallPackage records WHICH escalation
    // triggered this draft extraction (Mongo _id + human case number). Stamped
    // per attempt, so a failover backup's package carries the same origin.
    captureMetadata: {
      escalationId: escalation?._id ? String(escalation._id) : '',
      escalationCaseNumber: safeString(escalation?.caseNumber, ''),
    },
    ...(directProviderCall ? { directProviderCall } : {}),
    ...(waitForPackage ? { waitForPackage } : {}),
  });
  return {
    text: completion.text,
    usage: completion.usage,
    contextBundle,
    providerUsed: completion.providerUsed,
    modelUsed: completion.modelUsed,
    reasoningEffort: completion.reasoningEffort,
    providerPackageId: completion.providerPackageId,
    payloadSourcePath: completion.payloadSourcePath,
    fallbackUsed: completion.fallbackUsed,
    fallbackFrom: completion.fallbackFrom,
  };
}

function buildKbAgentSourceSummary(context = {}) {
  const counts = context.sourceCounts || {};
  return [
    counts.hasEscalation ? 'source escalation' : '',
    counts.hasConversation ? `${counts.conversationMessages || 0} chat message${counts.conversationMessages === 1 ? '' : 's'}` : '',
    counts.conversationImages ? `${counts.conversationImages} chat image${counts.conversationImages === 1 ? '' : 's'}` : '',
    counts.escalationScreenshots ? `${counts.escalationScreenshots} escalation screenshot${counts.escalationScreenshots === 1 ? '' : 's'}` : '',
    counts.workflowRuns ? `${counts.workflowRuns} workflow agent run${counts.workflowRuns === 1 ? '' : 's'}` : '',
    counts.relatedKnowledge ? `${counts.relatedKnowledge} related KB entr${counts.relatedKnowledge === 1 ? 'y' : 'ies'}` : '',
  ].filter(Boolean).join(', ');
}

function applyKnowledgeBaseAgentSnapshot(candidate, contextBundle) {
  if (!candidate || !contextBundle?.context) return;
  const context = contextBundle.context;
  candidate.kbAgent = {
    promptId: KNOWLEDGEBASE_AGENT_ID,
    promptVersion: context.prompt?.version || '',
    promptSha256: context.prompt?.sha256 || '',
    sourceSummary: buildKbAgentSourceSummary(context),
    sourceCounts: context.sourceCounts || {},
    workflowAgents: Array.isArray(context.workflow?.agents) ? context.workflow.agents : [],
    lastBuiltAt: new Date(),
  };
}

async function answerKnowledgeBaseAgentQuestion(recordId, message) {
  const cleanMessage = safeString(message, '').trim();
  if (!cleanMessage) {
    const err = new Error('Message is required.');
    err.code = 'KNOWLEDGE_AGENT_MESSAGE_REQUIRED';
    err.status = 400;
    throw err;
  }

  const candidate = await loadCandidateFromRecordId(recordId);
  const contextBundle = await buildKnowledgeBaseAgentContext({
    candidate,
    includeRawImages: true,
    includeRelated: true,
  });
  const existingMessages = Array.isArray(candidate.kbAgentMessages) ? candidate.kbAgentMessages : [];
  const priorMessages = existingMessages.slice(-20).map((item) => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: safeString(item.content, ''),
  }));
  const modelMessages = [
    {
      role: 'user',
      content: [
        contextBundle.contextText,
        '',
        'Use this current context for the sidebar conversation. The reviewer may ask about the KB fields, the source escalation, the chat, the workflow agents, related KB records, or broader questions.',
        'When the reviewer asks you to fill in, rewrite, or fix draft fields, actually save the change with the kb.updateDraft tool — do not just propose text.',
      ].join('\n'),
    },
    ...priorMessages,
    { role: 'user', content: cleanMessage },
  ];

  // Run the dedicated KB tool loop (provider/model/failover from the profile)
  // so the agent can read/search/check completeness and ACTUALLY save edits via
  // kb.updateDraft. The harness-backed single-shot path
  // (runKnowledgeBaseAgentCompletion) is retained only for the draft-extraction
  // flow, which has no tools.
  const candidateId = objectIdString(candidate._id);
  const runtimePolicy = await resolveKbAgentRuntimePolicy();
  const toolHandlers = createKbAgentToolHandlers({ recordId, candidateId });
  const prompt = getPromptMetadata();
  const systemPrompt = buildKnowledgeBaseAgentSidebarSystemPrompt(prompt.systemPrompt);

  const loopResult = await runKnowledgeBaseAgentToolLoop({
    systemPrompt,
    messagesForModel: modelMessages,
    images: contextBundle.rawImages,
    toolHandlers,
    runtimePolicy,
    timeoutMs: 120000,
    // Evidence identity: the captured ProviderCallPackages for this sidebar
    // exchange link back to the KB record/candidate being reviewed.
    captureMetadata: {
      sourceAgent: KNOWLEDGEBASE_AGENT_ID,
      recordId: safeString(recordId, ''),
      candidateId,
      ...(candidate?.caseNumber ? { caseNumber: safeString(candidate.caseNumber, '') } : {}),
    },
  });

  const appliedChanges = Array.isArray(loopResult.appliedChanges) ? loopResult.appliedChanges : [];

  // The tool's writes went through updateKnowledgeRecord, which loaded + saved
  // its OWN copy of the doc. Re-load so persisting kbAgentMessages here does not
  // clobber the fields the agent just edited.
  const freshCandidate = appliedChanges.length
    ? await loadCandidateFromRecordId(recordId)
    : candidate;

  const now = new Date();
  freshCandidate.kbAgentMessages = [
    ...(Array.isArray(freshCandidate.kbAgentMessages) ? freshCandidate.kbAgentMessages : existingMessages),
    { role: 'user', content: cleanMessage, createdAt: now },
    { role: 'assistant', content: loopResult.text, createdAt: new Date() },
  ].slice(-MAX_STORED_AGENT_MESSAGES);
  applyKnowledgeBaseAgentSnapshot(freshCandidate, contextBundle);
  await freshCandidate.save();

  return {
    answer: loopResult.text,
    messages: freshCandidate.kbAgentMessages.map((item) => ({
      role: item.role,
      content: item.content,
      createdAt: toIso(item.createdAt),
    })),
    appliedChanges,
    usage: loopResult.usage,
    provider: loopResult.providerUsed || null,
    model: loopResult.modelUsed || null,
    fallbackUsed: Boolean(loopResult.fallbackUsed),
    context: summarizeContextForClient(contextBundle.context),
  };
}

function summarizeContextForClient(context) {
  return {
    prompt: context.prompt,
    sourceCounts: context.sourceCounts,
    workflowAgents: context.workflow?.agents || [],
    caseIntakeStatus: context.workflow?.caseIntake?.status || 'none',
    relatedKnowledge: context.relatedKnowledge || [],
    conversation: context.conversation ? {
      id: context.conversation.id,
      title: context.conversation.title,
      messageCount: context.conversation.messageCount,
      imageCount: context.attachments?.conversationImages?.length || 0,
    } : null,
    escalation: context.escalation ? {
      id: context.escalation.id,
      caseNumber: context.escalation.caseNumber,
      category: context.escalation.category,
      status: context.escalation.status,
      screenshotCount: context.attachments?.escalationScreenshots?.length || 0,
    } : null,
  };
}

async function getKnowledgeBaseAgentRecordContext(recordId) {
  const candidate = await loadCandidateFromRecordId(recordId);
  const contextBundle = await buildKnowledgeBaseAgentContext({
    candidate,
    includeRawImages: false,
    includeRelated: true,
  });
  applyKnowledgeBaseAgentSnapshot(candidate, contextBundle);
  await candidate.save({ timestamps: false });
  // Surface the runtime the agent will ACTUALLY use for this draft so the
  // sidebar can show provider/model honestly. Same resolver the chat and
  // draft-extraction calls use (agent profile runtime is the source of truth).
  let runtime = null;
  try {
    const policy = await resolveKbAgentRuntimePolicy();
    runtime = {
      provider: policy.primaryProvider || '',
      providerLabel: policy.providerLabel || '',
      model: policy.reportedModel || '',
      reasoningEffort: policy.reasoningEffort || '',
    };
  } catch {
    runtime = null;
  }
  return {
    context: {
      ...summarizeContextForClient(contextBundle.context),
      workflow: contextBundle.context.workflow,
      attachments: contextBundle.context.attachments,
      runtime,
    },
    messages: (Array.isArray(candidate.kbAgentMessages) ? candidate.kbAgentMessages : []).map((item) => ({
      role: item.role,
      content: item.content,
      createdAt: toIso(item.createdAt),
    })),
  };
}

module.exports = {
  KNOWLEDGEBASE_AGENT_ID,
  answerKnowledgeBaseAgentQuestion,
  applyKnowledgeBaseAgentSnapshot,
  buildKnowledgeBaseAgentContext,
  buildKnowledgeBaseAgentContextText,
  buildKnowledgeBaseAgentSidebarSystemPrompt,
  buildKnowledgeBaseDraftExtractionPrompt,
  getKnowledgeBaseAgentRecordContext,
  resolveKbAgentRuntimePolicy,
  runKnowledgeBaseAgentDraftExtraction,
  runKnowledgeBaseAgentCompletion,
  summarizeContextForClient,
};
