'use strict';

const express = require('express');
const { createApiError, sendApiError } = require('../../lib/api-errors');

const router = express.Router();

router.get('/alerts', async (req, res) => {
  try {
    const workspaceAlerts = require('../../services/workspace-alerts');
    const detected = await workspaceAlerts.detectAlerts();
    res.json({ ok: true, alerts: detected });
  } catch (err) {
    return sendApiError(
      res,
      createApiError('ALERT_FETCH_ERROR', err.message || 'Failed to detect alerts', 503)
    );
  }
});

router.get('/alerts/detect', async (req, res) => {
  try {
    const workspaceAlerts = require('../../services/workspace-alerts');
    const detected = await workspaceAlerts.detectAlerts();
    res.json({ ok: true, alerts: detected });
  } catch (err) {
    return sendApiError(
      res,
      createApiError('ALERT_FETCH_ERROR', err.message || 'Failed to detect alerts', 503)
    );
  }
});

router.post('/alerts/interaction', async (req, res) => {
  const WorkspaceActivity = require('../../models/WorkspaceActivity');
  const { alertType, alertTitle, action, sourceId } = req.body;

  if (!alertType || !action) {
    return sendApiError(res, createApiError('MISSING_FIELD', 'alertType and action are required', 400));
  }

  const validActions = ['clicked', 'dismissed', 'expired'];
  if (!validActions.includes(action)) {
    return sendApiError(
      res,
      createApiError('INVALID_ACTION', `action must be one of: ${validActions.join(', ')}`, 400)
    );
  }

  try {
    await WorkspaceActivity.create({
      type: 'alert-interaction',
      summary: `Alert ${action}: ${alertTitle || alertType}`,
      details: { alertType, alertTitle, action, sourceId: sourceId || null },
    });
    res.json({ ok: true });
  } catch (err) {
    return sendApiError(res, createApiError('INTERACTION_LOG_ERROR', err.message || 'Failed to record alert interaction', 500));
  }
});

module.exports = router;
