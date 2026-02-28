const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { randomUUID } = require('node:crypto');
const Escalation = require('../models/Escalation');

function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const { parseEscalationText, looksLikeEscalation } = require('../lib/escalation-parser');
const { validateParsedEscalation } = require('../lib/parse-validation');
const { createRateLimiter } = require('../middleware/rate-limit');
const {
  VALID_PARSE_MODES,
  parseWithPolicy,
} = require('../services/parse-orchestrator');
const { isValidProvider } = require('../services/providers/registry');
const { logUsage } = require('../lib/usage-writer');
let sharp = null;
try { sharp = require('sharp'); } catch { /* optional dependency */ }

const UPLOADS_ROOT = path.resolve(__dirname, '..', '..', 'uploads');
const ESCALATION_UPLOADS_DIR = path.join(UPLOADS_ROOT, 'escalations');
const MAX_RAW_IMAGE_BYTES = 20 * 1024 * 1024;
const parseRateLimit = createRateLimiter({ name: 'escalation-parse', limit: 12, windowMs: 60_000 });
const screenshotRateLimit = createRateLimiter({ name: 'screenshot-upload', limit: 10, windowMs: 60_000 });

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

function isValidParseMode(mode) {
  return mode === undefined || mode === 'full' || mode === 'quick' || VALID_PARSE_MODES.has(mode);
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

  const escalation = new Escalation({
    ...fields,
    source: deriveSourceFromPayload(req.body),
  });
  await escalation.save();
  res.status(201).json({ ok: true, escalation: escalation.toObject() });
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
  res.json({ ok: true, escalation: escalation.toObject() });
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
    if (resolution) update.resolution = resolution;
  }

  const escalation = await Escalation.findByIdAndUpdate(
    req.params.id,
    { $set: update },
    { returnDocument: 'after', runValidators: true },
  );

  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }
  res.json({ ok: true, escalation: escalation.toObject() });
});

// POST /api/escalations/:id/link -- Link escalation to a conversation
router.post('/:id/link', async (req, res) => {
  const { conversationId } = req.body;
  if (!conversationId) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'conversationId required' });
  }

  const escalation = await Escalation.findByIdAndUpdate(
    req.params.id,
    { $set: { conversationId } },
    { returnDocument: 'after' },
  );

  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }

  // Also link the conversation back to the escalation
  const Conversation = require('../models/Conversation');
  await Conversation.findByIdAndUpdate(conversationId, { $set: { escalationId: req.params.id } });

  res.json({ ok: true, escalation: escalation.toObject() });
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

  res.status(201).json({
    ok: true,
    createdCount: createdPaths.length,
    skippedInvalid,
    skippedDuplicates,
    screenshotPaths: escalation.screenshotPaths,
    escalation: escalation.toObject(),
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

  const Conversation = require('../models/Conversation');
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }

  // Pick allowed fields
  const allowed = ['coid', 'mid', 'caseNumber', 'clientContact', 'agentName',
    'attemptingTo', 'expectedOutcome', 'actualOutcome', 'tsSteps',
    'triedTestAccount', 'category', 'resolution', 'resolutionNotes'];
  const escalationFields = {};
  for (const key of allowed) {
    if (fields[key] !== undefined) escalationFields[key] = fields[key];
  }

  // Create escalation linked to conversation
  const escalation = new Escalation({
    ...escalationFields,
    conversationId,
    source: 'chat',
  });
  await escalation.save();

  // Link conversation back to escalation
  conversation.escalationId = escalation._id;
  await conversation.save();

  res.status(201).json({ ok: true, escalation: escalation.toObject() });
});

// POST /api/escalations/parse -- Parse escalation from image/text and persist it.
// Backward-compatible modes:
// - mode=quick => regex-only parse
// - mode=full|single|fallback (or omitted) => provider orchestrated parse
router.post('/parse', parseRateLimit, async (req, res) => {
  const {
    image,
    text,
    mode,
    provider, // backward-compatible alias for primaryProvider
    primaryProvider,
    fallbackProvider,
    timeoutMs,
  } = req.body || {};
  if (!image && !text) {
    return res.status(400).json({ ok: false, code: 'MISSING_INPUT', error: 'Image or text required' });
  }
  if (!isValidParseMode(mode)) {
    return res.status(400).json({ ok: false, code: 'INVALID_MODE', error: 'Unsupported parse mode' });
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

  if (mode === 'quick') {
    // No AI call — no usage logging
    if (!text) {
      return res.status(400).json({ ok: false, code: 'MISSING_INPUT', error: 'Text required for quick mode' });
    }
    if (!looksLikeEscalation(text)) {
      return res.status(422).json({ ok: false, code: 'NOT_ESCALATION_TEXT', error: 'Text does not look like escalation content' });
    }

    const quickParsed = parseEscalationText(text);
    const quickValidation = validateParsedEscalation(quickParsed, { sourceText: text });
    const quickMeta = toParseResponseMeta({
      mode: 'single',
      providerUsed: 'regex',
      fallbackUsed: false,
      fallbackFrom: null,
      attempts: [{
        provider: 'regex',
        status: 'ok',
        latencyMs: 0,
        validationScore: quickValidation.score,
        validationIssues: quickValidation.issues,
      }],
      usedRegexFallback: false,
      validation: {
        passed: quickValidation.passed,
        score: quickValidation.score,
        confidence: quickValidation.confidence,
        issues: quickValidation.issues,
        fieldsFound: quickValidation.fieldsFound,
      },
    });

    const escalation = new Escalation({
      ...quickValidation.normalizedFields,
      source: 'manual',
      parseMeta: {
        mode: quickMeta.mode,
        providerUsed: quickMeta.providerUsed,
        winner: quickMeta.winner || quickMeta.providerUsed,
        fallbackUsed: quickMeta.fallbackUsed,
        fallbackFrom: '',
        validationScore: quickMeta.validation ? quickMeta.validation.score : null,
        validationConfidence: quickMeta.validation ? quickMeta.validation.confidence : '',
        validationIssues: quickMeta.validation ? quickMeta.validation.issues : [],
        usedRegexFallback: quickMeta.usedRegexFallback,
        attempts: quickMeta.attempts,
      },
    });
    await escalation.save();

    return res.status(201).json({
      ok: true,
      escalation: escalation.toObject(),
      _meta: quickMeta,
    });
  }

  const escParseRequestId = randomUUID();
  const resolvedMode = resolveParseMode(mode);
  try {
    const parseResult = await parseWithPolicy({
      image,
      text,
      mode: resolvedMode,
      primaryProvider: primaryProvider || provider,
      fallbackProvider,
      timeoutMs,
      allowRegexFallback: true,
    });
    const parseMeta = toParseResponseMeta(parseResult.meta);

    const escalation = new Escalation({
      ...parseResult.fields,
      source: image ? 'screenshot' : 'manual',
      parseMeta: {
        mode: parseMeta.mode,
        providerUsed: parseMeta.providerUsed,
        winner: parseMeta.winner || parseMeta.providerUsed,
        fallbackUsed: parseMeta.fallbackUsed,
        fallbackFrom: parseMeta.fallbackFrom || '',
        validationScore: parseMeta.validation ? parseMeta.validation.score : null,
        validationConfidence: parseMeta.validation ? parseMeta.validation.confidence : '',
        validationIssues: parseMeta.validation ? parseMeta.validation.issues : [],
        usedRegexFallback: parseMeta.usedRegexFallback,
        attempts: parseMeta.attempts,
      },
    });
    await escalation.save();

    // Log usage for AI attempts (skip regex)
    if (Array.isArray(parseResult.meta.attempts)) {
      for (let i = 0; i < parseResult.meta.attempts.length; i++) {
        const a = parseResult.meta.attempts[i];
        if (a.provider === 'regex') continue;
        const u = a.usage || {};
        logUsage({
          requestId: escParseRequestId, attemptIndex: i, service: 'parse', provider: a.provider,
          model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens,
          usageAvailable: !!a.usage, usageComplete: u.usageComplete, rawUsage: u.rawUsage,
          escalationId: escalation._id, mode: resolvedMode,
          status: a.status === 'ok' ? 'ok' : (a.errorCode === 'TIMEOUT' ? 'timeout' : 'error'), latencyMs: a.latencyMs,
        });
      }
    }

    return res.status(201).json({
      ok: true,
      escalation: escalation.toObject(),
      _meta: parseMeta,
    });
  } catch (err) {
    if (err && Array.isArray(err.attempts)) {
      for (let i = 0; i < err.attempts.length; i++) {
        const a = err.attempts[i];
        if (a.provider === 'regex') continue;
        const u = a.usage || {};
        logUsage({
          requestId: escParseRequestId, attemptIndex: i, service: 'parse', provider: a.provider,
          model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens,
          usageAvailable: !!a.usage, usageComplete: u.usageComplete, rawUsage: u.rawUsage,
          mode: resolvedMode, status: a.errorCode === 'TIMEOUT' ? 'timeout' : 'error', latencyMs: a.latencyMs,
        });
      }
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

// POST /api/escalations/quick-parse -- Regex-only parse (no Claude, instant)
// No AI call — no usage logging
router.post('/quick-parse', (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ ok: false, code: 'MISSING_INPUT', error: 'Text required' });
  }

  const parsed = parseEscalationText(text);
  const isEscalation = looksLikeEscalation(text);

  res.json({
    ok: true,
    escalation: parsed,
    isEscalation,
  });
});

module.exports = router;
module.exports._internal = { isPathWithinRoot };
