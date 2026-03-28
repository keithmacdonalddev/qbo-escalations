'use strict';

const express = require('express');

const router = express.Router();

router.get('/conversations', async (req, res) => {
  try {
    const WorkspaceConversation = require('../../models/WorkspaceConversation');
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
    const conversations = await WorkspaceConversation.listRecent('default', limit);
    res.json({ ok: true, conversations });
  } catch (err) {
    res.status(500).json({ ok: false, code: 'CONVERSATIONS_LIST_ERROR', error: err.message });
  }
});

router.get('/conversation/:sessionId', async (req, res) => {
  try {
    const WorkspaceConversation = require('../../models/WorkspaceConversation');
    const { sessionId } = req.params;
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ ok: false, code: 'MISSING_SESSION_ID', error: 'sessionId is required' });
    }
    const messages = await WorkspaceConversation.getHistory(sessionId);
    res.json({ ok: true, sessionId, messages });
  } catch (err) {
    res.status(500).json({ ok: false, code: 'CONVERSATION_ERROR', error: err.message });
  }
});

module.exports = router;
