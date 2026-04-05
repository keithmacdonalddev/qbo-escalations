'use strict';

const express = require('express');
const { createApiError, sendApiError } = require('../../lib/api-errors');

const router = express.Router();

router.post('/feedback', async (req, res) => {
  const WorkspaceFeedback = require('../../models/WorkspaceFeedback');
  const { sessionId, messageIndex, rating, comment } = req.body;

  if (!sessionId || messageIndex == null || !rating) {
    return sendApiError(
      res,
      createApiError('MISSING_FIELD', 'sessionId, messageIndex, and rating are required', 400)
    );
  }
  if (rating !== 'up' && rating !== 'down') {
    return sendApiError(res, createApiError('INVALID_RATING', 'rating must be "up" or "down"', 400));
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
    return sendApiError(res, createApiError('FEEDBACK_ERROR', err.message || 'Failed to save feedback', 500));
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
    return sendApiError(res, createApiError('FEEDBACK_ERROR', err.message || 'Failed to load feedback stats', 500));
  }
});

module.exports = router;
