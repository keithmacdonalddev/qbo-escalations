const express = require('express');
const router = express.Router();
const Escalation = require('../models/Escalation');
const claude = require('../services/claude');
const { parseEscalationText, looksLikeEscalation } = require('../lib/escalation-parser');

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
  if (req.query.agent) filter.agentName = { $regex: req.query.agent, $options: 'i' };
  if (req.query.search) {
    filter.$text = { $search: req.query.search };
  }

  const [escalations, total] = await Promise.all([
    Escalation.find(filter).sort(sort).skip(offset).limit(limit).lean(),
    Escalation.countDocuments(filter),
  ]);

  res.json({ ok: true, escalations, total });
});

// GET /api/escalations/:id -- Single escalation
router.get('/:id', async (req, res) => {
  const escalation = await Escalation.findById(req.params.id).lean();
  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }
  res.json({ ok: true, escalation });
});

// POST /api/escalations -- Create escalation
router.post('/', async (req, res) => {
  const allowed = ['coid', 'mid', 'caseNumber', 'clientContact', 'agentName',
    'attemptingTo', 'expectedOutcome', 'actualOutcome', 'tsSteps',
    'triedTestAccount', 'category', 'source'];
  const fields = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) fields[key] = req.body[key];
  }

  const escalation = new Escalation(fields);
  await escalation.save();
  res.status(201).json({ ok: true, escalation: escalation.toObject() });
});

// PATCH /api/escalations/:id -- Update escalation
router.patch('/:id', async (req, res) => {
  const allowed = ['coid', 'mid', 'caseNumber', 'clientContact', 'agentName',
    'attemptingTo', 'expectedOutcome', 'actualOutcome', 'tsSteps',
    'triedTestAccount', 'category', 'status', 'resolution'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  // If transitioning to resolved, set resolvedAt
  if (updates.status === 'resolved') {
    updates.resolvedAt = new Date();
  }

  const escalation = await Escalation.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { new: true, runValidators: true },
  );

  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }
  res.json({ ok: true, escalation: escalation.toObject() });
});

// DELETE /api/escalations/:id -- Delete escalation
router.delete('/:id', async (req, res) => {
  const result = await Escalation.findByIdAndDelete(req.params.id);
  if (!result) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }
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
    { new: true, runValidators: true },
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
    { new: true },
  );

  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }

  // Also link the conversation back to the escalation
  const Conversation = require('../models/Conversation');
  await Conversation.findByIdAndUpdate(conversationId, { $set: { escalationId: req.params.id } });

  res.json({ ok: true, escalation: escalation.toObject() });
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
    'triedTestAccount', 'category', 'source'];
  const escalationFields = {};
  for (const key of allowed) {
    if (fields[key] !== undefined) escalationFields[key] = fields[key];
  }

  // Create escalation linked to conversation
  const escalation = new Escalation({
    ...escalationFields,
    conversationId,
    source: escalationFields.source || 'manual',
  });
  await escalation.save();

  // Link conversation back to escalation
  conversation.escalationId = escalation._id;
  await conversation.save();

  res.status(201).json({ ok: true, escalation: escalation.toObject() });
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

// POST /api/escalations/parse -- Parse escalation from image/text
// Uses Claude for images, regex fallback for text if Claude fails
router.post('/parse', async (req, res) => {
  const { image, text, mode } = req.body;
  if (!image && !text) {
    return res.status(400).json({ ok: false, code: 'MISSING_INPUT', error: 'Image or text required' });
  }

  let parsed;

  if (mode === 'quick' && text && looksLikeEscalation(text)) {
    // Quick mode: regex only, no Claude call (instant)
    parsed = parseEscalationText(text);
  } else {
    // Full mode: try Claude first, fall back to regex for text
    try {
      parsed = await claude.parseEscalation(image || text);
      parsed._parsedBy = 'claude';
    } catch (err) {
      if (text && looksLikeEscalation(text)) {
        parsed = parseEscalationText(text);
        parsed._fallbackReason = err.message;
      } else {
        throw err; // Express 5 catches this
      }
    }
  }

  // Create escalation record from parsed data
  const { _parseConfidence, _fieldsFound, _parsedBy, _fallbackReason, ...fields } = parsed;
  const escalation = new Escalation({
    ...fields,
    source: image ? 'screenshot' : 'manual',
  });
  await escalation.save();

  res.status(201).json({
    ok: true,
    escalation: escalation.toObject(),
    _meta: { parsedBy: _parsedBy, confidence: _parseConfidence, fieldsFound: _fieldsFound, fallbackReason: _fallbackReason },
  });
});

// POST /api/escalations/quick-parse -- Regex-only parse (no Claude, instant)
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
