const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Escalation = require('../models/Escalation');
const KnowledgeCandidate = require('../models/KnowledgeCandidate');
const EscalationAttentionItem = require('../models/EscalationAttentionItem');
const { hasCategoryPlaybook, unpublishKnowledgeCandidate } = require('../lib/knowledge-promotion');
const {
  buildDuplicateSafetyForEscalation,
  createLinkedEscalationFromConversation,
  linkEscalationToConversation,
  workflowErrorResponse,
} = require('../lib/escalation-dedup');
const {
  syncKnowledgeReviewAttentionItem,
  syncMissingLinkAttentionItems,
  syncParserTriageAttentionItems,
  syncResolutionDisciplineAttentionItem,
  syncStaleEscalationAttentionItems,
} = require('../lib/escalation-attention');
const {
  assertKnowledgePermission,
  publishKnowledgeRecord,
  resolveKnowledgeActor,
  updateKnowledgeRecord,
} = require('../services/knowledgebase-management-service');

function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const { createRateLimiter } = require('../middleware/rate-limit');
const { getRenderedAgentPrompt } = require('../lib/agent-prompt-store');
const { prompt: claudePrompt } = require('../services/claude');
let sharp = null;
try { sharp = require('sharp'); } catch { /* optional dependency */ }

const UPLOADS_ROOT = path.resolve(__dirname, '..', '..', 'uploads');
const ESCALATION_UPLOADS_DIR = path.join(UPLOADS_ROOT, 'escalations');
const MAX_RAW_IMAGE_BYTES = 20 * 1024 * 1024;
const screenshotRateLimit = createRateLimiter({ name: 'screenshot-upload', limit: 10, windowMs: 60_000 });
const KNOWLEDGE_REVIEW_STATUSES = new Set(['draft', 'approved', 'rejected']);
const KNOWLEDGE_PUBLISH_TARGETS = new Set(['category', 'edge-case', 'case-history-only']);
const KNOWLEDGE_REUSABLE_OUTCOMES = new Set([
  'canonical',
  'edge-case',
  'case-history-only',
  'customer-specific',
  'temporary-incident',
  'unsafe-to-reuse',
]);
const ELIGIBLE_KNOWLEDGE_STATUSES = new Set(['resolved', 'escalated-further']);
const ATTENTION_SEVERITY_WEIGHT = { critical: 3, warning: 2, info: 1 };
const ATTENTION_STATUS_WEIGHT = { open: 1, split: 2, resolved: 3, dismissed: 4 };

if (!fs.existsSync(ESCALATION_UPLOADS_DIR)) {
  fs.mkdirSync(ESCALATION_UPLOADS_DIR, { recursive: true });
}

function isPathWithinRoot(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function deriveSourceFromPayload(payload) {
  if (payload && payload.source === 'chat') {
    return 'chat';
  }
  if (payload && payload.conversationId) {
    return 'chat';
  }
  if (payload && Array.isArray(payload.screenshotPaths) && payload.screenshotPaths.length > 0) {
    return 'screenshot';
  }
  return 'manual';
}

function isValidObjectId(value) {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
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

function compactText(value, maxChars = 240) {
  const compact = safeString(value, '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (!Number.isFinite(maxChars) || maxChars <= 0 || compact.length <= maxChars) return compact;
  return compact.slice(0, Math.max(0, maxChars - 3)).trimEnd() + '...';
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = safeString(value, '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function firstNonEmpty(values, fallback = '') {
  if (!Array.isArray(values)) return fallback;
  for (const value of values) {
    const text = compactText(value, 500);
    if (text) return text;
  }
  return fallback;
}

function splitKeySignals(value, maxItems = 8) {
  const raw = Array.isArray(value)
    ? value
    : safeString(value, '').split(/\r?\n|,/);
  const out = [];
  const seen = new Set();

  for (const item of raw) {
    const text = compactText(item, 160);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxItems) break;
  }

  return out;
}

function normalizeCandidateConfidence(value, fallback = 0.6) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function resolveAttentionSort(value) {
  const sort = safeString(value, 'priority').trim();
  if (!sort || sort === 'priority') return 'priority';
  return sort;
}

function attentionDateMs(value) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function compareAttentionPriority(left, right) {
  const leftStatus = ATTENTION_STATUS_WEIGHT[left.status] || 99;
  const rightStatus = ATTENTION_STATUS_WEIGHT[right.status] || 99;
  if (leftStatus !== rightStatus) return leftStatus - rightStatus;

  const leftSeverity = ATTENTION_SEVERITY_WEIGHT[left.severity] || 0;
  const rightSeverity = ATTENTION_SEVERITY_WEIGHT[right.severity] || 0;
  if (leftSeverity !== rightSeverity) return rightSeverity - leftSeverity;

  const leftDetected = attentionDateMs(left.lastDetectedAt || left.updatedAt || left.createdAt);
  const rightDetected = attentionDateMs(right.lastDetectedAt || right.updatedAt || right.createdAt);
  return rightDetected - leftDetected;
}

function normalizeAttentionItemIds(value) {
  const raw = Array.isArray(value) ? value : [];
  const ids = [];
  const seen = new Set();
  for (const item of raw) {
    const id = safeString(item, '').trim();
    if (!isValidObjectId(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= 200) break;
  }
  return ids;
}

async function listAttentionItemsPage(filter, { sort, offset, limit }) {
  if (sort !== 'priority') {
    return EscalationAttentionItem.find(filter)
      .sort(sort)
      .skip(offset)
      .limit(limit)
      .populate('sourceEscalationId', 'coid caseNumber category status attemptingTo actualOutcome conversationId createdAt')
      .populate('sourceConversationId', 'title updatedAt messageCount lastMessagePreview escalationId')
      .populate('candidates.escalationId', 'coid caseNumber category status attemptingTo actualOutcome conversationId createdAt')
      .lean();
  }

  const sorted = await EscalationAttentionItem.find(filter)
    .select('_id status severity lastDetectedAt updatedAt createdAt')
    .lean();
  sorted.sort(compareAttentionPriority);
  const pageIds = sorted.slice(offset, offset + limit).map((item) => item._id);
  if (!pageIds.length) return [];

  const populated = await EscalationAttentionItem.find({ _id: { $in: pageIds } })
    .populate('sourceEscalationId', 'coid caseNumber category status attemptingTo actualOutcome conversationId createdAt')
    .populate('sourceConversationId', 'title updatedAt messageCount lastMessagePreview escalationId')
    .populate('candidates.escalationId', 'coid caseNumber category status attemptingTo actualOutcome conversationId createdAt')
    .lean();
  const byId = new Map(populated.map((item) => [String(item._id), item]));
  return pageIds.map((id) => byId.get(String(id))).filter(Boolean);
}

async function loadConversationSnapshot(conversationId) {
  if (!isValidObjectId(conversationId)) {
    return {
      conversationTitle: '',
      conversationPreview: '',
      conversationMessageCount: 0,
    };
  }

  const Conversation = require('../models/Conversation');
  const conversation = await Conversation.findById(conversationId)
    .select('title messages')
    .lean();

  if (!conversation) {
    return {
      conversationTitle: '',
      conversationPreview: '',
      conversationMessageCount: 0,
    };
  }

  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  const preview = messages
    .filter((msg) => msg && typeof msg.content === 'string' && msg.content.trim())
    .slice(-4)
    .map((msg) => `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${compactText(msg.content, 140)}`)
    .join(' | ');

  return {
    conversationTitle: safeString(conversation.title, ''),
    conversationPreview: compactText(preview, 600),
    conversationMessageCount: messages.length,
  };
}

function deriveKnowledgeTitle(escalation) {
  const raw = firstNonEmpty([
    escalation && escalation.actualOutcome,
    escalation && escalation.attemptingTo,
    escalation && escalation.resolution,
    escalation && escalation.category && escalation.category !== 'unknown'
      ? `${safeString(escalation.category).replace(/-/g, ' ')} reviewed learning`
      : '',
  ], 'Reviewed case learning');

  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function buildDraftSignals(escalation) {
  const signals = [];
  if (escalation && escalation.actualOutcome) {
    signals.push(compactText(escalation.actualOutcome, 160));
  }
  if (escalation && escalation.triedTestAccount && escalation.triedTestAccount !== 'unknown') {
    signals.push(`Tried test account: ${escalation.triedTestAccount}`);
  }
  if (escalation && escalation.tsSteps) {
    const fragments = safeString(escalation.tsSteps, '')
      .split(/\r?\n|[.;]/)
      .map((part) => compactText(part, 140))
      .filter(Boolean);
    for (const fragment of fragments.slice(0, 3)) {
      signals.push(fragment);
    }
  }
  return splitKeySignals(signals, 6);
}

async function buildKnowledgeDraftData(escalation, existing = null) {
  const snapshot = await loadConversationSnapshot(escalation.conversationId);
  const category = safeString(existing && existing.category, '').trim()
    || safeString(escalation.category, 'unknown').trim()
    || 'unknown';
  const defaultTarget = hasCategoryPlaybook(category) ? 'category' : 'edge-case';
  const summary = firstNonEmpty([
    escalation.resolution,
    escalation.resolutionNotes,
    escalation.actualOutcome,
    escalation.attemptingTo,
  ], '');

  return {
    escalationId: escalation._id,
    conversationId: escalation.conversationId || null,
    reviewStatus: existing && existing.reviewStatus && existing.reviewStatus !== 'published'
      ? existing.reviewStatus
      : 'draft',
    publishTarget: existing && existing.publishTarget
      ? existing.publishTarget
      : (ELIGIBLE_KNOWLEDGE_STATUSES.has(escalation.status) ? defaultTarget : 'case-history-only'),
    reusableOutcome: existing && existing.reusableOutcome
      ? existing.reusableOutcome
      : (defaultTarget === 'category' ? 'canonical' : 'edge-case'),
    title: safeString(existing && existing.title, '').trim() || deriveKnowledgeTitle(escalation),
    category,
    summary: safeString(existing && existing.summary, '').trim() || compactText(summary, 280),
    symptom: safeString(existing && existing.symptom, '').trim()
      || firstNonEmpty([escalation.actualOutcome, escalation.attemptingTo], ''),
    rootCause: safeString(existing && existing.rootCause, '').trim(),
    exactFix: safeString(existing && existing.exactFix, '').trim()
      || firstNonEmpty([escalation.resolution, escalation.resolutionNotes], ''),
    escalationPath: safeString(existing && existing.escalationPath, '').trim()
      || (escalation.status === 'escalated-further'
        ? firstNonEmpty([escalation.resolution, escalation.resolutionNotes], 'Escalated further for specialist review.')
        : ''),
    keySignals: Array.isArray(existing && existing.keySignals) && existing.keySignals.length > 0
      ? splitKeySignals(existing.keySignals, 8)
      : buildDraftSignals(escalation),
    confidence: normalizeCandidateConfidence(
      existing && existing.confidence,
      defaultTarget === 'category' ? 0.85 : 0.6
    ),
    reviewNotes: safeString(existing && existing.reviewNotes, '').trim(),
    sourceSnapshot: {
      status: escalation.status || '',
      category: escalation.category || '',
      coid: escalation.coid || '',
      caseNumber: escalation.caseNumber || '',
      attemptingTo: escalation.attemptingTo || '',
      actualOutcome: escalation.actualOutcome || '',
      tsSteps: escalation.tsSteps || '',
      resolution: escalation.resolution || '',
      resolutionNotes: escalation.resolutionNotes || '',
      conversationTitle: snapshot.conversationTitle,
      conversationPreview: snapshot.conversationPreview,
      conversationMessageCount: snapshot.conversationMessageCount,
      resolvedAt: escalation.resolvedAt || null,
    },
    generatedAt: new Date(),
  };
}

/**
 * AI enrichment: load the full conversation, ask Claude to extract structured
 * knowledge fields, and return parsed results. Returns null if no conversation
 * exists or Claude returns unparseable output.
 */
async function enrichKnowledgeDraft(escalation, draftData) {
  const Conversation = require('../models/Conversation');
  const conversationId = escalation.conversationId
    || (draftData && draftData.conversationId)
    || null;

  // Build context from escalation fields even if no conversation exists
  const escalationContext = [
    escalation.category && escalation.category !== 'unknown'
      ? `Category: ${escalation.category}`
      : '',
    escalation.attemptingTo ? `Customer attempting: ${escalation.attemptingTo}` : '',
    escalation.expectedOutcome ? `Expected outcome: ${escalation.expectedOutcome}` : '',
    escalation.actualOutcome ? `Actual outcome: ${escalation.actualOutcome}` : '',
    escalation.tsSteps ? `Troubleshooting steps taken: ${escalation.tsSteps}` : '',
    escalation.resolution ? `Resolution: ${escalation.resolution}` : '',
    escalation.resolutionNotes ? `Resolution notes: ${escalation.resolutionNotes}` : '',
    escalation.status ? `Final status: ${escalation.status}` : '',
  ].filter(Boolean).join('\n');

  // Load conversation messages if available
  let conversationTranscript = '';
  if (isValidObjectId(conversationId)) {
    const conversation = await Conversation.findById(conversationId)
      .select('title messages')
      .lean();
    if (conversation && Array.isArray(conversation.messages) && conversation.messages.length > 0) {
      // Take last 30 messages to avoid overwhelming the prompt
      const recent = conversation.messages.slice(-30);
      conversationTranscript = recent
        .filter((m) => m && typeof m.content === 'string' && m.content.trim())
        .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content.slice(0, 2000)}`)
        .join('\n\n');
    }
  }

  if (!escalationContext && !conversationTranscript) return null;

  const promptText = buildEnrichmentPrompt(escalationContext, conversationTranscript);

  const result = await claudePrompt(promptText, {
    systemPrompt: getRenderedAgentPrompt('escalation-enrichment'),
    reasoningEffort: 'low',
    timeoutMs: 60000,
  });

  if (!result || !result.text) return null;
  return parseEnrichmentResponse(result.text);
}

const ENRICHMENT_SYSTEM_PROMPT =
  'You are a QBO (QuickBooks Online) escalation knowledge analyst. ' +
  'Your job is to analyze resolved escalation cases and extract structured knowledge ' +
  'that will help other QBO escalation specialists handle similar issues faster. ' +
  'Be specific and practical. Use QBO terminology. Write for someone who already knows QBO ' +
  'but needs to quickly understand this specific issue pattern.';

function buildEnrichmentPrompt(escalationContext, conversationTranscript) {
  const parts = [
    'Analyze this resolved QBO escalation and extract structured knowledge.\n',
    '--- ESCALATION DATA ---',
    escalationContext,
  ];

  if (conversationTranscript) {
    parts.push(
      '',
      '--- CONVERSATION TRANSCRIPT ---',
      conversationTranscript,
    );
  }

  parts.push(
    '',
    '--- INSTRUCTIONS ---',
    'Return a JSON object with these fields (no markdown fences, just raw JSON):',
    '{',
    '  "title": "concise title for this knowledge entry (under 80 chars)",',
    '  "symptom": "what the customer reported or what the agent described as the problem",',
    '  "rootCause": "what was actually wrong — the underlying issue, not just the symptom",',
    '  "exactFix": "step-by-step resolution that another specialist could follow",',
    '  "keySignals": ["array of 2-5 clues that indicate this is the issue — things to look for in future cases"],',
    '  "summary": "1-2 sentence overview of the issue and resolution"',
    '}',
    '',
    'Rules:',
    '- If the conversation does not reveal a clear root cause, set rootCause to an empty string',
    '- exactFix must be actionable steps, not vague advice',
    '- keySignals should be observable facts (error messages, account states, specific behaviors)',
    '- Keep everything QBO-specific and practical',
    '- Do not invent information that is not in the data',
  );

  return parts.join('\n');
}

function parseEnrichmentResponse(text) {
  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed && typeof parsed === 'object') return validateEnrichmentFields(parsed);
  } catch { /* not raw JSON */ }

  // Try extracting JSON from markdown fences or embedded in text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed === 'object') return validateEnrichmentFields(parsed);
    } catch { /* malformed JSON */ }
  }

  return null;
}

function validateEnrichmentFields(obj) {
  const result = {};
  const stringFields = ['title', 'symptom', 'rootCause', 'exactFix', 'summary'];
  let hasContent = false;

  for (const field of stringFields) {
    if (typeof obj[field] === 'string' && obj[field].trim()) {
      result[field] = obj[field].trim();
      hasContent = true;
    }
  }

  if (Array.isArray(obj.keySignals)) {
    const signals = obj.keySignals
      .filter((s) => typeof s === 'string' && s.trim())
      .map((s) => s.trim())
      .slice(0, 8);
    if (signals.length > 0) {
      result.keySignals = signals;
      hasContent = true;
    }
  }

  return hasContent ? result : null;
}

function sanitizeKnowledgeCandidateUpdates(input) {
  const payload = input && typeof input === 'object' ? input : {};
  const updates = {};
  const stringFields = [
    'title',
    'category',
    'summary',
    'symptom',
    'rootCause',
    'exactFix',
    'escalationPath',
    'reviewNotes',
  ];

  for (const field of stringFields) {
    if (payload[field] !== undefined) {
      updates[field] = safeString(payload[field], '').trim();
    }
  }

  if (payload.reviewStatus !== undefined) {
    const status = safeString(payload.reviewStatus, '').trim().toLowerCase();
    if (!KNOWLEDGE_REVIEW_STATUSES.has(status)) {
      const err = new Error('Invalid reviewStatus');
      err.code = 'INVALID_REVIEW_STATUS';
      throw err;
    }
    updates.reviewStatus = status;
  }

  if (payload.publishTarget !== undefined) {
    const target = safeString(payload.publishTarget, '').trim().toLowerCase();
    if (!KNOWLEDGE_PUBLISH_TARGETS.has(target)) {
      const err = new Error('Invalid publishTarget');
      err.code = 'INVALID_PUBLISH_TARGET';
      throw err;
    }
    updates.publishTarget = target;
  }

  if (payload.reusableOutcome !== undefined) {
    const outcome = safeString(payload.reusableOutcome, '').trim().toLowerCase();
    if (!KNOWLEDGE_REUSABLE_OUTCOMES.has(outcome)) {
      const err = new Error('Invalid reusableOutcome');
      err.code = 'INVALID_REUSABLE_OUTCOME';
      throw err;
    }
    updates.reusableOutcome = outcome;
  }

  if (payload.keySignals !== undefined) {
    updates.keySignals = splitKeySignals(payload.keySignals, 8);
  }

  if (payload.confidence !== undefined) {
    updates.confidence = normalizeCandidateConfidence(payload.confidence);
  }

  return updates;
}

function decodeBase64Image(imageData) {
  if (typeof imageData !== 'string' || !imageData.trim()) return null;
  const dataUrlMatch = imageData.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (dataUrlMatch) {
    const ext = dataUrlMatch[1].toLowerCase() === 'jpeg' ? 'jpg' : dataUrlMatch[1].toLowerCase();
    return { ext, buffer: Buffer.from(dataUrlMatch[2], 'base64') };
  }

  // Fallback to png for raw base64 input
  return { ext: 'png', buffer: Buffer.from(imageData, 'base64') };
}

async function normalizeAndCompressImage(buffer, extHint) {
  if (!buffer || buffer.length === 0) return null;
  if (!sharp) return { buffer, ext: extHint || 'png' };

  try {
    const out = await sharp(buffer)
      .rotate()
      .resize({
        width: 1920,
        height: 1920,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 82,
        mozjpeg: true,
      })
      .toBuffer();
    return { buffer: out, ext: 'jpg' };
  } catch {
    return { buffer, ext: extHint || 'png' };
  }
}

function imageHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safeBasename(fileName) {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '');
}

function deleteFileIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch { /* ignore */ }
}

function removeDirIfEmpty(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath);
    if (entries.length === 0) fs.rmdirSync(dirPath);
  } catch { /* ignore */ }
}

function cleanupEscalationScreenshots(escalation) {
  if (!Array.isArray(escalation.screenshotPaths) || escalation.screenshotPaths.length === 0) return;
  const touchedDirs = new Set();
  for (const relative of escalation.screenshotPaths) {
    const resolved = path.resolve(UPLOADS_ROOT, relative);
    if (!isPathWithinRoot(UPLOADS_ROOT, resolved)) continue;
    deleteFileIfExists(resolved);
    touchedDirs.add(path.dirname(resolved));
  }
  for (const dir of touchedDirs) {
    removeDirIfEmpty(dir);
  }
}

function buildHashesFromPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return [];
  const hashes = [];

  for (const relativePath of paths) {
    const resolved = path.resolve(UPLOADS_ROOT, relativePath);
    if (!isPathWithinRoot(UPLOADS_ROOT, resolved)) continue;
    if (!fs.existsSync(resolved)) continue;
    try {
      const data = fs.readFileSync(resolved);
      hashes.push(imageHash(data));
    } catch { /* ignore unreadable files */ }
  }
  return hashes;
}

// GET /api/escalations/knowledge-gaps -- Analyze playbook coverage gaps
router.get('/knowledge-gaps', async (req, res) => {
  const Conversation = require('../models/Conversation');
  const { getCategories } = require('../lib/playbook-loader');
  const { days = 30 } = req.query;
  const since = new Date(Date.now() - Number(days) * 86400000);

  // 1. Get all escalations in the time window
  const escalations = await Escalation.find({
    createdAt: { $gte: since },
  }).lean();

  // 2. Get linked conversations for analysis
  const withConvos = escalations.filter(e => e.conversationId);
  const convos = await Conversation.find({
    _id: { $in: withConvos.map(e => e.conversationId) },
  }).lean();
  const convoMap = Object.fromEntries(convos.map(c => [c._id.toString(), c]));

  // 3. Analyze per category
  const categories = {};
  const HEDGES = [
    'i\'m not sure', 'i don\'t have', 'unclear', 'i cannot determine',
    'you may need to', 'i\'d recommend checking', 'i don\'t see this in',
    'this isn\'t covered', 'beyond my current', 'i\'m unable to find',
    'i\'m not certain', 'i lack information', 'not enough context',
  ];

  for (const esc of escalations) {
    const cat = esc.category || 'unknown';
    if (!categories[cat]) {
      categories[cat] = {
        total: 0, resolved: 0, escalatedFurther: 0, open: 0, inProgress: 0,
        messageCounts: [],
        longConversations: [],
        uncertainPhrases: 0,
      };
    }
    const bucket = categories[cat];
    bucket.total++;
    if (esc.status === 'resolved') bucket.resolved++;
    else if (esc.status === 'escalated-further') bucket.escalatedFurther++;
    else if (esc.status === 'in-progress') bucket.inProgress++;
    else bucket.open++;

    // Analyze linked conversation
    const convo = esc.conversationId ? convoMap[esc.conversationId.toString()] : null;
    if (convo) {
      const msgCount = convo.messages ? convo.messages.length : 0;
      bucket.messageCounts.push(msgCount);

      if (msgCount >= 10) {
        bucket.longConversations.push({
          escalationId: esc._id,
          conversationId: convo._id,
          messageCount: msgCount,
          category: cat,
          title: convo.title,
          attemptingTo: esc.attemptingTo,
        });
      }

      // Check AI responses for uncertainty language
      const aiMessages = (convo.messages || []).filter(m => m.role === 'assistant');
      for (const msg of aiMessages) {
        const lower = (msg.content || '').toLowerCase();
        if (HEDGES.some(h => lower.includes(h))) bucket.uncertainPhrases++;
      }
    }
  }

  // 4. Compute averages and build gap report
  const playbookCategories = getCategories();
  const gaps = [];

  for (const [cat, data] of Object.entries(categories)) {
    const avgMessageCount = data.messageCounts.length
      ? Math.round(data.messageCounts.reduce((a, b) => a + b, 0) / data.messageCounts.length * 10) / 10
      : 0;

    const resolutionRate = data.total > 0 ? Math.round(data.resolved / data.total * 100) : 0;
    const hasPlaybook = playbookCategories.includes(cat);

    // Gap score: lower = bigger gap (worse coverage)
    let gapScore = 100;
    if (!hasPlaybook) gapScore -= 40;
    gapScore -= (100 - resolutionRate) * 0.3;
    gapScore -= Math.min(data.uncertainPhrases * 5, 25);
    gapScore -= Math.min(data.longConversations.length * 3, 15);
    if (data.escalatedFurther > 0) gapScore -= data.escalatedFurther * 5;
    gapScore = Math.max(0, Math.round(gapScore));

    gaps.push({
      category: cat,
      gapScore,
      resolutionRate,
      hasPlaybook,
      total: data.total,
      resolved: data.resolved,
      escalatedFurther: data.escalatedFurther,
      open: data.open,
      inProgress: data.inProgress,
      avgMessageCount,
      longConversations: data.longConversations,
      uncertainPhrases: data.uncertainPhrases,
    });
  }

  // 5. Sort by gap score ascending (worst gaps first)
  gaps.sort((a, b) => a.gapScore - b.gapScore);

  // 6. Playbook categories with zero escalations in this period
  const unusedCategories = playbookCategories.filter(c => !categories[c]);

  res.json({
    ok: true,
    gaps,
    unusedCategories,
    period: { days: Number(days), since },
    totalEscalations: escalations.length,
  });
});

// GET /api/escalations/knowledge-candidates -- List all knowledge candidates with filters
router.get('/knowledge-candidates', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const sort = req.query.sort || '-createdAt';

  const filter = {};
  if (req.query.reviewStatus) filter.reviewStatus = req.query.reviewStatus;
  if (req.query.category) filter.category = req.query.category;
  if (req.query.reusableOutcome) filter.reusableOutcome = req.query.reusableOutcome;

  const [candidates, total] = await Promise.all([
    KnowledgeCandidate.find(filter)
      .sort(sort)
      .skip(offset)
      .limit(limit)
      .populate('escalationId', 'coid caseNumber category status attemptingTo agentName')
      .lean(),
    KnowledgeCandidate.countDocuments(filter),
  ]);

  // Status breakdown for the header counts (always unfiltered so the user
  // can see the full picture regardless of active filter)
  const statusCounts = await KnowledgeCandidate.aggregate([
    { $group: { _id: '$reviewStatus', count: { $sum: 1 } } },
  ]);
  const counts = { draft: 0, approved: 0, published: 0, rejected: 0 };
  for (const s of statusCounts) {
    if (s._id in counts) counts[s._id] = s.count;
  }

  res.json({ ok: true, candidates, total, counts });
});

// GET /api/escalations/attention-items -- Durable workflow review items
router.get('/attention-items', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const sort = resolveAttentionSort(req.query.sort || 'priority');
  const validKinds = new Set(EscalationAttentionItem.ATTENTION_KINDS || []);
  const validStatuses = new Set(EscalationAttentionItem.ATTENTION_STATUSES || []);
  const shouldRefresh = ['1', 'true', 'yes'].includes(safeString(req.query.refresh, '').trim().toLowerCase());
  const refresh = shouldRefresh
    ? {
      stale: await syncStaleEscalationAttentionItems(),
      parserTriage: await syncParserTriageAttentionItems(),
      missingLinks: await syncMissingLinkAttentionItems(),
    }
    : null;

  const status = safeString(req.query.status, 'open').trim();
  const filter = {};
  if (!status || status === 'open') {
    filter.status = 'open';
  } else if (status !== 'all') {
    if (!validStatuses.has(status)) {
      return res.status(400).json({ ok: false, code: 'INVALID_STATUS', error: 'Invalid attention item status' });
    }
    filter.status = status;
  }
  const kind = safeString(req.query.kind, '').trim();
  if (kind && kind !== 'all') {
    if (!validKinds.has(kind)) {
      return res.status(400).json({ ok: false, code: 'INVALID_KIND', error: 'Invalid attention item kind' });
    }
    filter.kind = kind;
  }

  const [items, total] = await Promise.all([
    listAttentionItemsPage(filter, { sort, offset, limit }),
    EscalationAttentionItem.countDocuments(filter),
  ]);

  const statusCounts = await EscalationAttentionItem.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const counts = { open: 0, resolved: 0, dismissed: 0, split: 0 };
  for (const item of statusCounts) {
    if (item._id in counts) counts[item._id] = item.count;
  }

  const [kindCountsRaw, severityCountsRaw] = await Promise.all([
    EscalationAttentionItem.aggregate([
      { $match: status === 'all' ? {} : { status: filter.status || 'open' } },
      { $group: { _id: '$kind', count: { $sum: 1 } } },
    ]),
    EscalationAttentionItem.aggregate([
      { $match: filter },
      { $group: { _id: '$severity', count: { $sum: 1 } } },
    ]),
  ]);
  const kindCounts = {};
  for (const item of kindCountsRaw) {
    if (item._id) kindCounts[item._id] = item.count;
  }
  const severityCounts = { critical: 0, warning: 0, info: 0 };
  for (const item of severityCountsRaw) {
    if (item._id in severityCounts) severityCounts[item._id] = item.count;
  }

  res.json({ ok: true, items, total, counts, kindCounts, severityCounts, sort, refresh });
});

// PATCH /api/escalations/attention-items/bulk -- Resolve/dismiss multiple review items
router.patch('/attention-items/bulk', async (req, res) => {
  const validStatuses = new Set(EscalationAttentionItem.ATTENTION_STATUSES || []);
  const nextStatus = safeString(req.body && req.body.status, '').trim();
  if (!validStatuses.has(nextStatus)) {
    return res.status(400).json({ ok: false, code: 'INVALID_STATUS', error: 'Invalid attention item status' });
  }

  const ids = normalizeAttentionItemIds(req.body && req.body.ids);
  if (!ids.length) {
    return res.status(400).json({ ok: false, code: 'NO_ITEMS_SELECTED', error: 'Select at least one valid attention item' });
  }

  const update = {
    status: nextStatus,
    resolutionNote: compactText(req.body && req.body.resolutionNote, 500),
    resolvedAt: nextStatus === 'open' ? null : new Date(),
  };
  const result = await EscalationAttentionItem.updateMany(
    { _id: { $in: ids } },
    { $set: update },
    { runValidators: true }
  );
  res.json({
    ok: true,
    matched: result.matchedCount || 0,
    modified: result.modifiedCount || 0,
    status: nextStatus,
  });
});

// PATCH /api/escalations/attention-items/:itemId -- Resolve or dismiss a review item
router.patch('/attention-items/:itemId', async (req, res) => {
  if (!isValidObjectId(req.params.itemId)) {
    return res.status(400).json({ ok: false, code: 'INVALID_ATTENTION_ITEM_ID', error: 'Invalid attention item id' });
  }

  const validStatuses = new Set(EscalationAttentionItem.ATTENTION_STATUSES || []);
  const nextStatus = safeString(req.body && req.body.status, '').trim();
  if (!validStatuses.has(nextStatus)) {
    return res.status(400).json({ ok: false, code: 'INVALID_STATUS', error: 'Invalid attention item status' });
  }

  const update = {
    status: nextStatus,
    resolutionNote: compactText(req.body && req.body.resolutionNote, 500),
    resolvedAt: nextStatus === 'open' ? null : new Date(),
  };

  const item = await EscalationAttentionItem.findByIdAndUpdate(
    req.params.itemId,
    { $set: update },
    { returnDocument: 'after', runValidators: true }
  )
    .populate('sourceEscalationId', 'coid caseNumber category status attemptingTo actualOutcome conversationId createdAt')
    .populate('sourceConversationId', 'title updatedAt messageCount lastMessagePreview escalationId')
    .populate('candidates.escalationId', 'coid caseNumber category status attemptingTo actualOutcome conversationId createdAt');

  if (!item) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Attention item not found' });
  }

  res.json({ ok: true, item: item.toObject() });
});

// GET /api/escalations -- List with filters
router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const sort = req.query.sort || '-createdAt';

  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.category) filter.category = req.query.category;
  if (req.query.coid) filter.coid = req.query.coid;
  if (req.query.caseNumber) filter.caseNumber = req.query.caseNumber;
  if (req.query.agent) filter.agentName = { $regex: escapeRegex(req.query.agent), $options: 'i' };
  if (req.query.search) {
    filter.$text = { $search: req.query.search };
  }

  const [escalations, total] = await Promise.all([
    Escalation.find(filter).sort(sort).skip(offset).limit(limit).lean(),
    Escalation.countDocuments(filter),
  ]);

  res.json({ ok: true, escalations, total });
});

// POST /api/escalations -- Create escalation
router.post('/', async (req, res) => {
  const allowed = ['coid', 'mid', 'caseNumber', 'clientContact', 'agentName',
    'attemptingTo', 'expectedOutcome', 'actualOutcome', 'tsSteps',
    'triedTestAccount', 'category', 'resolution', 'resolutionNotes'];
  const fields = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) fields[key] = req.body[key];
  }

  if (req.body.conversationId) {
    try {
      const linked = await createLinkedEscalationFromConversation({
        conversationId: req.body.conversationId,
        fields,
        source: deriveSourceFromPayload(req.body),
      });
      return res.status(linked.reusedExisting ? 200 : 201).json({
        ok: true,
        escalation: linked.escalation.toObject(),
        duplicateSafety: linked.duplicateSafety,
      });
    } catch (err) {
      const response = workflowErrorResponse(err);
      if (response) return res.status(response.statusCode).json(response.body);
      throw err;
    }
  }

  const escalation = new Escalation({
    ...fields,
    source: deriveSourceFromPayload(req.body),
  });
  await escalation.save();
  const duplicateSafety = await buildDuplicateSafetyForEscalation(escalation, { fields });
  res.status(201).json({
    ok: true,
    escalation: escalation.toObject(),
    duplicateSafety,
  });
});

// PATCH /api/escalations/:id -- Update escalation
router.patch('/:id', async (req, res) => {
  const allowed = ['coid', 'mid', 'caseNumber', 'clientContact', 'agentName',
    'attemptingTo', 'expectedOutcome', 'actualOutcome', 'tsSteps',
    'triedTestAccount', 'category', 'status', 'resolution', 'resolutionNotes'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  // Backward compatibility for clients still sending `notes`.
  if (req.body.notes !== undefined && updates.resolutionNotes === undefined) {
    updates.resolutionNotes = req.body.notes;
  }
  // If transitioning to resolved, set resolvedAt
  if (updates.status === 'resolved') {
    updates.resolvedAt = new Date();
  }

  const escalation = await Escalation.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { returnDocument: 'after', runValidators: true },
  );

  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }

  let resolutionDiscipline = null;
  if (
    Object.prototype.hasOwnProperty.call(updates, 'status')
    || Object.prototype.hasOwnProperty.call(updates, 'resolution')
    || Object.prototype.hasOwnProperty.call(updates, 'resolutionNotes')
  ) {
    resolutionDiscipline = await syncResolutionDisciplineAttentionItem(escalation);
  }

  res.json({ ok: true, escalation: escalation.toObject(), resolutionDiscipline });
});

// GET /api/escalations/similar -- Find past escalations with similar category/symptoms
// Query: ?category=X or ?escalationId=X (to find similar to an existing one) &limit=10
router.get('/similar', async (req, res) => {
  const { category, escalationId, symptoms, limit: limitStr } = req.query;
  const limit = Math.min(parseInt(limitStr) || 10, 50);

  let searchCategory = category;
  let searchText = symptoms || '';
  let excludeId = null;

  // If escalationId provided, use that escalation's category and symptoms
  if (escalationId) {
    const source = await Escalation.findById(escalationId).lean();
    if (!source) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Source escalation not found' });
    }
    searchCategory = source.category;
    searchText = [source.attemptingTo, source.actualOutcome, source.tsSteps].filter(Boolean).join(' ');
    excludeId = source._id;
  }

  if (!searchCategory && !searchText) {
    return res.status(400).json({ ok: false, code: 'MISSING_PARAMS', error: 'Provide category, escalationId, or symptoms' });
  }

  // Strategy: text search if symptoms available, otherwise category match
  const filter = {};
  if (excludeId) filter._id = { $ne: excludeId };

  let escalations;

  if (searchText && searchText.trim().length > 3) {
    // Full-text search scoped to category
    filter.$text = { $search: searchText };
    if (searchCategory && searchCategory !== 'unknown') filter.category = searchCategory;

    escalations = await Escalation.find(filter, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .lean();
  } else {
    // Category-only match, prefer resolved cases (training value)
    if (searchCategory) filter.category = searchCategory;

    escalations = await Escalation.find(filter)
      .sort({ status: 1, createdAt: -1 }) // resolved first, then newest
      .limit(limit)
      .lean();
  }

  res.json({ ok: true, escalations, count: escalations.length });
});

// GET /api/escalations/:id/knowledge -- Fetch the reviewed knowledge draft for an escalation
router.get('/:id/knowledge', async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ ok: false, code: 'INVALID_ESCALATION_ID', error: 'Invalid escalation id' });
  }

  const escalation = await Escalation.findById(req.params.id).select('_id conversationId').lean();
  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }

  const knowledge = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  return res.json({ ok: true, knowledge: knowledge || null });
});

// POST /api/escalations/:id/knowledge/generate -- Create or refresh a draft knowledge record
// Query params:
//   ?enrich=true  — run AI enrichment via Claude to produce high-quality structured fields
//   ?enrich=false — deterministic draft only (default)
router.post('/:id/knowledge/generate', async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ ok: false, code: 'INVALID_ESCALATION_ID', error: 'Invalid escalation id' });
  }

  const force = req.body && req.body.force === true;
  const enrich = (req.query.enrich || (req.body && req.body.enrich) || '').toString().toLowerCase() === 'true';
  const escalation = await Escalation.findById(req.params.id);
  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }
  if (!ELIGIBLE_KNOWLEDGE_STATUSES.has(escalation.status)) {
    return res.status(409).json({
      ok: false,
      code: 'KNOWLEDGE_SOURCE_NOT_FINALIZED',
      error: 'Only resolved or escalated-further escalations can generate reviewed knowledge',
    });
  }

  const existing = await KnowledgeCandidate.findOne({ escalationId: escalation._id });
  if (existing && existing.reviewStatus === 'published' && !force) {
    const knowledgeReview = await syncKnowledgeReviewAttentionItem(existing, escalation);
    return res.json({
      ok: true,
      knowledge: existing.toObject(),
      generated: false,
      published: true,
      knowledgeReview,
    });
  }
  if (existing && !force) {
    const knowledgeReview = await syncKnowledgeReviewAttentionItem(existing, escalation);
    return res.json({ ok: true, knowledge: existing.toObject(), generated: false, knowledgeReview });
  }

  const draftData = await buildKnowledgeDraftData(escalation, force ? existing : null);

  // AI enrichment: analyze the full conversation to produce structured knowledge fields
  let enriched = false;
  if (enrich) {
    try {
      const aiFields = await enrichKnowledgeDraft(escalation, draftData);
      if (aiFields) {
        if (aiFields.title && (!draftData.title || draftData.title === 'Reviewed case learning')) {
          draftData.title = aiFields.title;
        }
        if (aiFields.symptom) draftData.symptom = aiFields.symptom;
        if (aiFields.rootCause) draftData.rootCause = aiFields.rootCause;
        if (aiFields.exactFix) draftData.exactFix = aiFields.exactFix;
        if (aiFields.summary) draftData.summary = aiFields.summary;
        if (Array.isArray(aiFields.keySignals) && aiFields.keySignals.length > 0) {
          draftData.keySignals = splitKeySignals(aiFields.keySignals, 8);
        }
        if (aiFields.rootCause && aiFields.exactFix) {
          draftData.confidence = Math.min(1, draftData.confidence + 0.1);
        }
        enriched = true;
      }
    } catch (enrichErr) {
      console.warn('[knowledge/generate] AI enrichment failed, using deterministic draft:', enrichErr.message);
    }
  }

  const knowledge = existing || new KnowledgeCandidate({ escalationId: escalation._id });
  knowledge.set(draftData);
  if (!knowledge.reviewStatus) knowledge.reviewStatus = 'draft';
  await knowledge.save();
  const knowledgeReview = await syncKnowledgeReviewAttentionItem(knowledge, escalation);

  return res.json({ ok: true, knowledge: knowledge.toObject(), generated: true, enriched, knowledgeReview });
});

// PATCH /api/escalations/:id/knowledge -- Update the reviewed knowledge draft
router.patch('/:id/knowledge', async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ ok: false, code: 'INVALID_ESCALATION_ID', error: 'Invalid escalation id' });
  }

  const escalation = await Escalation.findById(req.params.id).select('_id conversationId').lean();
  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }

  const knowledge = await KnowledgeCandidate.findOne({ escalationId: escalation._id });
  if (!knowledge) {
    return res.status(404).json({ ok: false, code: 'KNOWLEDGE_NOT_FOUND', error: 'Knowledge draft not found' });
  }
  if (knowledge.reviewStatus === 'published') {
    return res.status(409).json({
      ok: false,
      code: 'KNOWLEDGE_ALREADY_PUBLISHED',
      error: 'Published knowledge entries are locked in this first version',
    });
  }

  try {
    const result = await updateKnowledgeRecord(
      `candidate:${knowledge._id}`,
      req.body || {},
      resolveKnowledgeActor(req)
    );
    const refreshed = await KnowledgeCandidate.findById(knowledge._id).lean();
    return res.json({ ok: true, knowledge: refreshed, knowledgeReview: result.knowledgeReview });
  } catch (err) {
    const code = err && err.code ? err.code : 'INVALID_KNOWLEDGE_UPDATE';
    const status = err?.status || (code.startsWith('INVALID_') ? 400 : 500);
    return res.status(status).json({ ok: false, code, error: err.message || 'Invalid knowledge update' });
  }
});

// POST /api/escalations/:id/knowledge/publish -- Publish an approved draft as database knowledge, optionally exporting markdown
router.post('/:id/knowledge/publish', async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ ok: false, code: 'INVALID_ESCALATION_ID', error: 'Invalid escalation id' });
  }

  const escalation = await Escalation.findById(req.params.id).lean();
  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }

  const knowledge = await KnowledgeCandidate.findOne({ escalationId: escalation._id });
  if (!knowledge) {
    return res.status(404).json({ ok: false, code: 'KNOWLEDGE_NOT_FOUND', error: 'Knowledge draft not found' });
  }
  try {
    assertKnowledgePermission(resolveKnowledgeActor(req), 'publish');
  } catch (err) {
    return res.status(err?.status || 403).json({
      ok: false,
      code: err?.code || 'KNOWLEDGE_PERMISSION_DENIED',
      error: err?.message || 'Knowledgebase publish permission is required.',
    });
  }
  if (knowledge.reviewStatus === 'published' && knowledge.publishedAt) {
    return res.json({ ok: true, knowledge: knowledge.toObject(), published: false, idempotent: true });
  }
  if (knowledge.reviewStatus !== 'approved') {
    return res.status(409).json({
      ok: false,
      code: 'KNOWLEDGE_REVIEW_REQUIRED',
      error: 'Knowledge draft must be marked approved before publish',
    });
  }
  if (knowledge.publishTarget === 'case-history-only') {
    return res.status(409).json({
      ok: false,
      code: 'KNOWLEDGE_NOT_PUBLISHABLE',
      error: 'Case-history-only entries are saved for review but not published into the playbook',
    });
  }

  try {
    const markdownDisabled = parseBoolean(process.env.KNOWLEDGE_MARKDOWN_PUBLISH_DISABLED, false);
    const exportMarkdown = !markdownDisabled && parseBoolean(req.body && req.body.exportMarkdown, true);
    const result = await publishKnowledgeRecord(
      `candidate:${knowledge._id}`,
      { ...(req.body || {}), exportMarkdown },
      resolveKnowledgeActor(req)
    );
    const refreshed = await KnowledgeCandidate.findById(knowledge._id).lean();

    return res.json({
      ok: true,
      knowledge: refreshed,
      publish: result.export,
      publishMode: result.export ? 'markdown-export' : 'database',
      published: result.published,
      idempotent: result.idempotent,
      knowledgeReview: result.knowledgeReview,
    });
  } catch (err) {
    const code = err && err.code ? err.code : 'KNOWLEDGE_PUBLISH_FAILED';
    const status = err?.status || ((
      code === 'INVALID_PUBLISH_TARGET'
      || code === 'CATEGORY_PLAYBOOK_NOT_FOUND'
      || code === 'KNOWLEDGE_REQUIRED'
    ) ? 400 : 500);
    return res.status(status).json({ ok: false, code, error: err.message || 'Failed to publish knowledge draft' });
  }
});

// POST /api/escalations/:id/knowledge/unpublish -- Retract published knowledge from the playbook
router.post('/:id/knowledge/unpublish', async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ ok: false, code: 'INVALID_ESCALATION_ID', error: 'Invalid escalation id' });
  }

  const escalation = await Escalation.findById(req.params.id).lean();
  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }

  const knowledge = await KnowledgeCandidate.findOne({ escalationId: escalation._id });
  if (!knowledge) {
    return res.status(404).json({ ok: false, code: 'KNOWLEDGE_NOT_FOUND', error: 'Knowledge draft not found' });
  }
  if (knowledge.reviewStatus !== 'published') {
    return res.status(409).json({
      ok: false,
      code: 'KNOWLEDGE_NOT_PUBLISHED',
      error: 'Knowledge draft is not currently published',
    });
  }

  try {
    const actor = resolveKnowledgeActor(req);
    assertKnowledgePermission(actor, 'publish');
    const result = knowledge.publishedDocType === 'database'
      ? { removed: false, databaseOnly: true }
      : unpublishKnowledgeCandidate({ knowledge: knowledge.toObject() });
    knowledge.reviewStatus = 'draft';
    knowledge.publishedAt = null;
    knowledge.publishedDocType = '';
    knowledge.publishedDocPath = '';
    knowledge.publishedMarker = '';
    knowledge.publishedSectionTitle = '';
    knowledge.auditEvents = Array.isArray(knowledge.auditEvents) ? knowledge.auditEvents : [];
    knowledge.auditEvents.push({
      eventId: `kb-record-unpublish-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
      action: 'record.unpublish',
      actor: actor.actor,
      role: actor.role,
      summary: result.databaseOnly
        ? 'Database-published knowledge record unpublished.'
        : 'Knowledge record unpublished and removed from markdown.',
      metadata: { result },
      createdAt: new Date(),
    });
    await knowledge.save();
    const knowledgeReview = await syncKnowledgeReviewAttentionItem(knowledge, escalation);

    return res.json({
      ok: true,
      knowledge: knowledge.toObject(),
      unpublish: result,
      knowledgeReview,
    });
  } catch (err) {
    const code = err && err.code ? err.code : 'KNOWLEDGE_UNPUBLISH_FAILED';
    const status = err?.status || (code === 'PUBLISHED_FILE_NOT_FOUND' ? 404 : 500);
    return res.status(status).json({ ok: false, code, error: err.message || 'Failed to unpublish knowledge' });
  }
});

// GET /api/escalations/:id -- Single escalation
router.get('/:id', async (req, res) => {
  const escalation = await Escalation.findById(req.params.id).lean();
  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }
  res.json({ ok: true, escalation });
});

// DELETE /api/escalations/:id -- Delete escalation
router.delete('/:id', async (req, res) => {
  const escalation = await Escalation.findById(req.params.id);
  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }

  if (escalation.conversationId) {
    const Conversation = require('../models/Conversation');
    await Conversation.findByIdAndUpdate(escalation.conversationId, { $set: { escalationId: null } });
  }

  cleanupEscalationScreenshots(escalation.toObject());
  await KnowledgeCandidate.deleteOne({ escalationId: escalation._id }).catch(() => {});
  await Escalation.findByIdAndDelete(req.params.id);

  res.json({ ok: true });
});

// POST /api/escalations/:id/transition -- Quick status transition
router.post('/:id/transition', async (req, res) => {
  const { status, resolution } = req.body;
  const validStatuses = ['open', 'in-progress', 'resolved', 'escalated-further'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ ok: false, code: 'INVALID_STATUS', error: 'Valid status required: ' + validStatuses.join(', ') });
  }

  const update = { status };
  if (status === 'resolved') {
    update.resolvedAt = new Date();
  }
  if ((status === 'resolved' || status === 'escalated-further') && resolution) {
    update.resolution = resolution;
  }

  const escalation = await Escalation.findByIdAndUpdate(
    req.params.id,
    { $set: update },
    { returnDocument: 'after', runValidators: true },
  );

  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }

  const resolutionDiscipline = await syncResolutionDisciplineAttentionItem(escalation);

  // When resolving or escalating further, check whether a knowledge draft already exists.
  // This tells the client whether to auto-generate one.
  let knowledgeExists = false;
  if (status === 'resolved' || status === 'escalated-further') {
    const existing = await KnowledgeCandidate.findOne(
      { escalationId: escalation._id },
      { _id: 1 },
    ).lean();
    knowledgeExists = Boolean(existing);
  }

  res.json({
    ok: true,
    escalation: escalation.toObject(),
    knowledgeEligible: (status === 'resolved' || status === 'escalated-further') && !knowledgeExists,
    resolutionDiscipline,
  });
});

// POST /api/escalations/:id/link -- Link escalation to a conversation
router.post('/:id/link', async (req, res) => {
  const { conversationId, force } = req.body;
  if (!conversationId) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'conversationId required' });
  }

  try {
    const linked = await linkEscalationToConversation({
      escalationId: req.params.id,
      conversationId,
      force: force === true,
    });
    return res.json({
      ok: true,
      escalation: linked.escalation.toObject(),
      duplicateSafety: linked.duplicateSafety,
    });
  } catch (err) {
    const response = workflowErrorResponse(err);
    if (response) return res.status(response.statusCode).json(response.body);
    throw err;
  }
});

// POST /api/escalations/:id/screenshots -- Attach screenshots to an escalation
router.post('/:id/screenshots', screenshotRateLimit, async (req, res) => {
  const { images } = req.body;
  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ ok: false, code: 'MISSING_IMAGES', error: 'images[] is required' });
  }
  if (images.length > 10) {
    return res.status(400).json({ ok: false, code: 'TOO_MANY_IMAGES', error: 'Maximum 10 images per request' });
  }

  const escalation = await Escalation.findById(req.params.id);
  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }

  const escalationDir = path.join(ESCALATION_UPLOADS_DIR, escalation._id.toString());
  if (!fs.existsSync(escalationDir)) {
    fs.mkdirSync(escalationDir, { recursive: true });
  }

  const createdPaths = [];
  let skippedInvalid = 0;
  let skippedDuplicates = 0;
  const currentPaths = escalation.screenshotPaths || [];
  const persistedHashes = Array.isArray(escalation.screenshotHashes) ? escalation.screenshotHashes : [];
  const hydratedHashes = persistedHashes.length === currentPaths.length
    ? persistedHashes
    : buildHashesFromPaths(currentPaths);
  const existingHashes = new Set(hydratedHashes.filter(Boolean));
  const nextPaths = [...currentPaths];
  const nextHashes = [...hydratedHashes];

  for (const image of images) {
    if (typeof image !== 'string' || image.trim().length < 50) {
      skippedInvalid++;
      continue;
    }

    const decoded = decodeBase64Image(image.trim());
    if (!decoded || !decoded.buffer || decoded.buffer.length === 0 || decoded.buffer.length > MAX_RAW_IMAGE_BYTES) {
      skippedInvalid++;
      continue;
    }

    const normalized = await normalizeAndCompressImage(decoded.buffer, decoded.ext);
    if (!normalized || !normalized.buffer || normalized.buffer.length === 0) {
      skippedInvalid++;
      continue;
    }

    const hash = imageHash(normalized.buffer);
    if (existingHashes.has(hash)) {
      skippedDuplicates++;
      continue;
    }

    const fileName = `${hash}.${normalized.ext}`;
    const filePath = path.join(escalationDir, safeBasename(fileName));
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, normalized.buffer);
    }

    const relativePath = path.relative(UPLOADS_ROOT, filePath).replace(/\\/g, '/');
    createdPaths.push(relativePath);
    nextPaths.push(relativePath);
    nextHashes.push(hash);
    existingHashes.add(hash);
  }

  if (createdPaths.length === 0) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_IMAGES',
      error: 'No valid images provided',
      skippedInvalid,
      skippedDuplicates,
    });
  }

  escalation.screenshotPaths = nextPaths;
  escalation.screenshotHashes = nextHashes;
  escalation.source = 'screenshot';
  await escalation.save();
  const duplicateSafety = await buildDuplicateSafetyForEscalation(escalation, {
    reason: 'screenshot_attached',
  });

  res.status(201).json({
    ok: true,
    createdCount: createdPaths.length,
    skippedInvalid,
    skippedDuplicates,
    screenshotPaths: escalation.screenshotPaths,
    escalation: escalation.toObject(),
    duplicateSafety,
  });
});

// DELETE /api/escalations/:id/screenshots/:filename -- Remove one screenshot
router.delete('/:id/screenshots/:filename', async (req, res) => {
  const escalation = await Escalation.findById(req.params.id);
  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }

  const fileName = safeBasename(req.params.filename);
  if (!fileName) {
    return res.status(400).json({ ok: false, code: 'INVALID_FILENAME', error: 'Invalid screenshot filename' });
  }

  const existing = escalation.screenshotPaths || [];
  const matchedIndex = existing.findIndex((p) => path.basename(p) === fileName);
  const matchedPath = matchedIndex >= 0 ? existing[matchedIndex] : null;
  if (!matchedPath) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Screenshot not found on escalation' });
  }

  const resolved = path.resolve(UPLOADS_ROOT, matchedPath);
  if (isPathWithinRoot(UPLOADS_ROOT, resolved)) {
    deleteFileIfExists(resolved);
    removeDirIfEmpty(path.dirname(resolved));
  }

  escalation.screenshotPaths = existing.filter((_, i) => i !== matchedIndex);
  if (Array.isArray(escalation.screenshotHashes)) {
    if (escalation.screenshotHashes.length === existing.length) {
      escalation.screenshotHashes = escalation.screenshotHashes.filter((_, i) => i !== matchedIndex);
    } else {
      escalation.screenshotHashes = buildHashesFromPaths(escalation.screenshotPaths);
    }
  }
  if (escalation.screenshotPaths.length === 0 && escalation.source === 'screenshot') {
    escalation.source = 'manual';
  }
  await escalation.save();

  res.json({ ok: true, screenshotPaths: escalation.screenshotPaths, escalation: escalation.toObject() });
});

// POST /api/escalations/from-conversation -- Create escalation from a chat conversation
// Expects parsed escalation fields + conversationId. Bidirectionally links both records.
router.post('/from-conversation', async (req, res) => {
  const { conversationId, ...fields } = req.body;
  if (!conversationId) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'conversationId required' });
  }

  // Pick allowed fields
  const allowed = ['coid', 'mid', 'caseNumber', 'clientContact', 'agentName',
    'attemptingTo', 'expectedOutcome', 'actualOutcome', 'tsSteps',
    'triedTestAccount', 'category', 'resolution', 'resolutionNotes'];
  const escalationFields = {};
  for (const key of allowed) {
    if (fields[key] !== undefined) escalationFields[key] = fields[key];
  }

  try {
    const linked = await createLinkedEscalationFromConversation({
      conversationId,
      fields: escalationFields,
      source: 'chat',
    });
    return res.status(linked.reusedExisting ? 200 : 201).json({
      ok: true,
      escalation: linked.escalation.toObject(),
      duplicateSafety: linked.duplicateSafety,
    });
  } catch (err) {
    const response = workflowErrorResponse(err);
    if (response) return res.status(response.statusCode).json(response.body);
    throw err;
  }
});

// POST /api/escalations/parse and POST /api/escalations/quick-parse were removed
// 2026-05-19 (parser-harness-hardening DECISIONS.md D7). Both routes were
// orphaned: the client wrappers parseEscalation and quickParseEscalation had
// no live importers, and the active chat-v5 image parse path is
// POST /api/image-parser/parse.

module.exports = router;
module.exports._internal = { isPathWithinRoot };
