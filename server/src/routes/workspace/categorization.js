'use strict';

const express = require('express');
const gmail = require('../../services/gmail');

const router = express.Router();

router.post('/apply-categorization', async (req, res) => {
  const { label, messageIds } = req.body;

  if (!label || typeof label !== 'string') {
    return res.json({ ok: false, code: 'MISSING_FIELD', error: '"label" (label name) is required' });
  }
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return res.json({ ok: false, code: 'MISSING_FIELD', error: '"messageIds" array is required' });
  }

  try {
    const labelCache = require('../../lib/label-cache');
    const labelId = await labelCache.getLabelId(gmail, label);

    if (!labelId) {
      try {
        const createResult = await gmail.createLabel(label);
        if (!createResult.ok) {
          return res.json({ ok: false, code: 'LABEL_NOT_FOUND', error: `Label "${label}" does not exist in Gmail and could not be created.` });
        }
        labelCache.invalidate();
        const newLabelId = createResult.label.id;
        const result = await gmail.batchModify(messageIds, { addLabelIds: [newLabelId] });
        return res.json({ ok: true, labelCreated: true, labelId: newLabelId, modifiedCount: result.modifiedCount || messageIds.length });
      } catch (createErr) {
        return res.json({ ok: false, code: 'LABEL_CREATE_ERROR', error: `Failed to create label "${label}": ${createErr.message}` });
      }
    }

    const result = await gmail.batchModify(messageIds, { addLabelIds: [labelId] });
    res.json({ ok: true, labelCreated: false, labelId, modifiedCount: result.modifiedCount || messageIds.length });
  } catch (err) {
    console.error('[workspace] apply-categorization error:', err.message);
    res.json({ ok: false, code: 'CATEGORIZATION_ERROR', error: err.message });
  }
});

module.exports = router;
