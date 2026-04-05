'use strict';

const express = require('express');
const gmail = require('../../services/gmail');
const { createApiError, sendApiError } = require('../../lib/api-errors');

const router = express.Router();

router.post('/apply-categorization', async (req, res) => {
  const { label, messageIds } = req.body;

  if (!label || typeof label !== 'string') {
    return sendApiError(res, createApiError('MISSING_FIELD', '"label" (label name) is required', 400));
  }
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return sendApiError(res, createApiError('MISSING_FIELD', '"messageIds" array is required', 400));
  }

  try {
    const labelCache = require('../../lib/label-cache');
    const labelId = await labelCache.getLabelId(gmail, label);

    if (!labelId) {
      try {
        const createResult = await gmail.createLabel(label);
        if (!createResult.ok) {
          return sendApiError(
            res,
            createApiError('LABEL_NOT_FOUND', `Label "${label}" does not exist in Gmail and could not be created.`, 404)
          );
        }
        labelCache.invalidate();
        const newLabelId = createResult.label.id;
        const result = await gmail.batchModify(messageIds, { addLabelIds: [newLabelId] });
        return res.json({ ok: true, labelCreated: true, labelId: newLabelId, modifiedCount: result.modifiedCount || messageIds.length });
      } catch (createErr) {
        return sendApiError(
          res,
          createApiError('LABEL_CREATE_ERROR', `Failed to create label "${label}": ${createErr.message}`, 502)
        );
      }
    }

    const result = await gmail.batchModify(messageIds, { addLabelIds: [labelId] });
    res.json({ ok: true, labelCreated: false, labelId, modifiedCount: result.modifiedCount || messageIds.length });
  } catch (err) {
    console.error('[workspace] apply-categorization error:', err.message);
    return sendApiError(res, createApiError('CATEGORIZATION_ERROR', err.message || 'Failed to apply categorization', 500));
  }
});

module.exports = router;
