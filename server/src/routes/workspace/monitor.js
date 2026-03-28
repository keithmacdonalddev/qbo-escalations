'use strict';

const express = require('express');

const router = express.Router();

router.get('/monitor', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const workspaceMonitor = require('../../services/workspace-monitor');
  workspaceMonitor.addSubscriber(res);

  req.on('close', () => {
    workspaceMonitor.removeSubscriber(res);
  });
});

router.get('/monitor/status', (req, res) => {
  const workspaceMonitor = require('../../services/workspace-monitor');
  res.json({ ok: true, ...workspaceMonitor.getStatus() });
});

module.exports = router;
