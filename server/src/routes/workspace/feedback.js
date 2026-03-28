'use strict';

const express = require('express');

const router = express.Router();

router.post('/feedback', async (req, res) => {
  const WorkspaceFeedback = require('../../models/WorkspaceFeedback');
  const { sessionId, messageIndex, rating, comment } = req.body;

  if (!sessionId || messageIndex == null || !rating) {
    return res.json({ ok: false, code: 'MISSING_FIELD', error: 'sessionId, messageIndex, and rating are required' });
  }
  if (rating !== 'up' && rating !== 'down') {
    return res.json({ ok: false, code: 'INVALID_RATING', error: 'rating must be "up" or "down"' });
  }

  const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.slice(0, 200) : '';

  try {
    const feedback = await WorkspaceFeedback.findOneAndUpdate(
      { sessionId, messageIndex },
      { rating, comment: comment || '', prompt, createdAt: new Date() },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    res.json({ ok: true, id: feedback._id });
  } catch (err) {
    res.json({ ok: false, code: 'FEEDBACK_ERROR', error: err.message });
  }
});

router.get('/feedback/stats', async (req, res) => {
  const WorkspaceFeedback = require('../../models/WorkspaceFeedback');

  try {
    const [total, positive, negative, recentNegative] = await Promise.all([
      WorkspaceFeedback.countDocuments(),
      WorkspaceFeedback.countDocuments({ rating: 'up' }),
      WorkspaceFeedback.countDocuments({ rating: 'down' }),
      WorkspaceFeedback.find({ rating: 'down' })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
    ]);

    res.json({
      ok: true,
      total,
      positive,
      negative,
      positiveRate: total > 0 ? Math.round((positive / total) * 100) : null,
      recentNegative: recentNegative.map((feedback) => ({
        sessionId: feedback.sessionId,
        messageIndex: feedback.messageIndex,
        prompt: feedback.prompt,
        comment: feedback.comment,
        createdAt: feedback.createdAt,
      })),
    });
  } catch (err) {
    res.json({ ok: false, code: 'FEEDBACK_ERROR', error: err.message });
  }
});

module.exports = router;
