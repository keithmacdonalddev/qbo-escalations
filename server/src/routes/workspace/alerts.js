'use strict';

const express = require('express');

const router = express.Router();

router.get('/alerts', async (req, res) => {
  try {
    const workspaceAlerts = require('../../services/workspace-alerts');
    const detected = await workspaceAlerts.detectAlerts();
    res.json({ ok: true, alerts: detected });
  } catch (err) {
    res.json({ ok: true, alerts: [], error: err.message });
  }
});

router.get('/alerts/detect', async (req, res) => {
  try {
    const workspaceAlerts = require('../../services/workspace-alerts');
    const detected = await workspaceAlerts.detectAlerts();
    res.json({ ok: true, alerts: detected });
  } catch (err) {
    res.json({ ok: true, alerts: [], error: err.message });
  }
});

router.post('/alerts/interaction', async (req, res) => {
  const WorkspaceActivity = require('../../models/WorkspaceActivity');
  const { alertType, alertTitle, action, sourceId } = req.body;

  if (!alertType || !action) {
    return res.json({ ok: false, code: 'MISSING_FIELD', error: 'alertType and action are required' });
  }

  const validActions = ['clicked', 'dismissed', 'expired'];
  if (!validActions.includes(action)) {
    return res.json({ ok: false, code: 'INVALID_ACTION', error: `action must be one of: ${validActions.join(', ')}` });
  }

  try {
    await WorkspaceActivity.create({
      type: 'alert-interaction',
      summary: `Alert ${action}: ${alertTitle || alertType}`,
      details: { alertType, alertTitle, action, sourceId: sourceId || null },
    });
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, code: 'INTERACTION_LOG_ERROR', error: err.message });
  }
});

module.exports = router;
