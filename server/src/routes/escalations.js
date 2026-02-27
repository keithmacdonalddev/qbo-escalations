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
  const escalation = new Escalation(req.body);
  await escalation.save();
  res.status(201).json({ ok: true, escalation: escalation.toObject() });
});

// PATCH /api/escalations/:id -- Update escalation
router.patch('/:id', async (req, res) => {
  // If transitioning to resolved, set resolvedAt
  const updates = { ...req.body };
  if (updates.status === 'resolved' && !updates.resolvedAt) {
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

// POST /api/escalations/parse -- Parse escalation from image/text
router.post('/parse', async (req, res) => {
  const { image, text } = req.body;
  if (!image && !text) {
    return res.status(400).json({ ok: false, code: 'MISSING_INPUT', error: 'Image or text required' });
  }

  const parsed = await claude.parseEscalation(image || text);

  // Create escalation record from parsed data
  const escalation = new Escalation({
    ...parsed,
    source: image ? 'screenshot' : 'manual',
  });
  await escalation.save();

  res.status(201).json({ ok: true, escalation: escalation.toObject() });
});

module.exports = router;
