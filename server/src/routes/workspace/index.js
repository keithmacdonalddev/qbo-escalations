'use strict';

const express = require('express');
const actionLog = require('../../services/workspace-action-log');
const {
  getWorkspaceRuntimeHealth,
} = require('../../services/workspace-runtime');
const workspaceActivityRouter = require('./activity');
const workspaceAiRouter = require('./ai');
const workspaceAlertsRouter = require('./alerts');
const workspaceAutoActionsRouter = require('./auto-actions');
const workspaceBriefingRouter = require('./briefing');
const workspaceCategorizationRouter = require('./categorization');
const workspaceConversationsRouter = require('./conversations');
const workspaceEntitiesRouter = require('./entities');
const workspaceFeedbackRouter = require('./feedback');
const workspaceMemoryRouter = require('./memory');
const workspaceMonitorRouter = require('./monitor');
const workspacePatternsRouter = require('./patterns');
const workspaceShipmentsRouter = require('./shipments');

const router = express.Router();

router.use(workspaceActivityRouter);
router.use(workspaceAiRouter);
router.use(workspaceAlertsRouter);
router.use(workspaceAutoActionsRouter);
router.use(workspaceBriefingRouter);
router.use(workspaceCategorizationRouter);
router.use(workspaceConversationsRouter);
router.use(workspaceEntitiesRouter);
router.use(workspaceFeedbackRouter);
router.use(workspaceMemoryRouter);
router.use(workspaceMonitorRouter);
router.use(workspacePatternsRouter);
router.use(workspaceShipmentsRouter);

router.get('/status', (req, res) => {
  res.json({
    ok: true,
    workspace: getWorkspaceRuntimeHealth(),
  });
});

router.get('/action-log', (req, res) => {
  const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 200);
  const actions = actionLog.getRecentActions(limit);
  res.json({
    ok: true,
    actions,
    total: actionLog.getTotalCount(),
  });
});

module.exports = router;
