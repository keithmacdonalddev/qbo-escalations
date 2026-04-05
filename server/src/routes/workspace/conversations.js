'use strict';

const express = require('express');
const { sendApiError } = require('../../lib/api-errors');

const router = express.Router();

function sendWorkspaceConversationError(res, err, fallbackCode, fallbackMessage) {
  const status = Number.isInteger(err?.status) ? err.status : 500;
  const safeMessage = status >= 500
    ? fallbackMessage
    : (err?.message || fallbackMessage);
  return sendApiError(res, {
    status,
    code: err?.code || fallbackCode,
    message: safeMessage,
  });
}

router.get('/conversations', async (req, res) => {
  try {
    const WorkspaceConversation = require('../../models/WorkspaceConversation');
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
    const conversations = await WorkspaceConversation.listRecent('default', limit);
    res.json({ ok: true, conversations });
  } catch (err) {
    return sendWorkspaceConversationError(
      res,
      err,
      'CONVERSATIONS_LIST_ERROR',
      'Failed to load workspace conversations'
    );
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
    return sendWorkspaceConversationError(
      res,
      err,
      'CONVERSATION_ERROR',
      'Failed to load workspace conversation'
    );
  }
});

module.exports = router;
