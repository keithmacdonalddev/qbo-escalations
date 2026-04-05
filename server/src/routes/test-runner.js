'use strict';

const express = require('express');
const {
  abortActiveRun,
  getGroupCatalog,
  runTests,
  serializeGroupTests,
} = require('../services/test-runner');

const router = express.Router();

router.get('/groups', (req, res) => {
  const catalog = getGroupCatalog();
  res.json({ ok: true, ...catalog });
});

router.get('/groups/:groupId/tests', (req, res) => {
  const groupId = String(req.params.groupId || '').trim();
  const files = serializeGroupTests(groupId);
  if (files === null) {
    return res.status(404).json({ ok: false, code: 'UNKNOWN_GROUP', error: 'Unknown test group' });
  }

  res.json({ ok: true, files });
});

router.post('/run', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const groupId = typeof body.group === 'string' && body.group.trim() ? body.group.trim() : 'all';

  if (typeof req.setResponseTimeout === 'function') {
    req.setResponseTimeout(15 * 60_000);
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  let connected = true;
  function handleDisconnect() {
    if (res.writableEnded) return;
    connected = false;
    abortActiveRun();
  }

  req.on('aborted', handleDisconnect);
  res.on('close', handleDisconnect);

  function writeEvent(event, payload) {
    if (!connected) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  try {
    await runTests({
      groupId,
      writeEvent,
      isClientConnected: () => connected,
    });
  } catch (err) {
    if (!connected) return;
    if (err && err.code === 'UNKNOWN_GROUP') {
      writeEvent('error', { message: err.message || 'Unknown test group' });
      return res.end();
    }
    if (err && err.code === 'RUN_IN_PROGRESS') {
      writeEvent('error', { message: err.message || 'A test run is already in progress' });
      return res.end();
    }

    writeEvent('error', { message: err && err.message ? err.message : 'Test run failed unexpectedly' });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

module.exports = router;
