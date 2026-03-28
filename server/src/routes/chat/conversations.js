'use strict';

const express = require('express');
const mongoose = require('mongoose');
const {
  deleteConversation,
  exportConversation,
  forkConversation,
  getConversation,
  getConversationMeta,
  getForkTree,
  listConversations,
  updateConversation,
} = require('../../services/chat-conversation-service');

const router = express.Router();

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function isValidObjectId(value) {
  return typeof value === 'string' && mongoose.isValidObjectId(value);
}

function sendConversationError(res, err, fallbackCode = 'INTERNAL', fallbackMessage = 'Conversation request failed') {
  const status = Number.isInteger(err?.status) ? err.status : 500;
  res.status(status).json({
    ok: false,
    code: err?.code || fallbackCode,
    error: err?.message || fallbackMessage,
  });
}

router.get('/', async (req, res) => {
  const parsedLimit = Number.parseInt(safeString(req.query.limit, ''), 10);
  const parsedSkip = Number.parseInt(
    safeString(req.query.skip !== undefined ? req.query.skip : req.query.offset, ''),
    10
  );
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 200)
    : 50;
  const skip = Number.isFinite(parsedSkip) && parsedSkip > 0 ? parsedSkip : 0;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const includeTotal = safeString(req.query.includeTotal, '') === '1';

  try {
    const result = await listConversations({ limit, skip, search, includeTotal });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return sendConversationError(res, err, 'LIST_FAILED', 'Failed to list conversations');
  }
});

router.use('/:id', (req, res, next) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_CONVERSATION_ID',
      error: 'conversationId must be a valid ObjectId',
    });
  }
  return next();
});

router.get('/:id/meta', async (req, res) => {
  try {
    const conversation = await getConversationMeta(req.params.id);
    return res.json({ ok: true, conversation });
  } catch (err) {
    return sendConversationError(res, err, 'NOT_FOUND', 'Conversation not found');
  }
});

router.get('/:id', async (req, res) => {
  try {
    const conversation = await getConversation(req.params.id);
    return res.json({ ok: true, conversation });
  } catch (err) {
    return sendConversationError(res, err, 'NOT_FOUND', 'Conversation not found');
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const conversation = await updateConversation(req.params.id, req.body || {});
    return res.json({ ok: true, conversation });
  } catch (err) {
    return sendConversationError(res, err, 'UPDATE_FAILED', 'Failed to update conversation');
  }
});

router.get('/:id/export', async (req, res) => {
  try {
    const text = await exportConversation(req.params.id);
    return res.json({ ok: true, text });
  } catch (err) {
    return sendConversationError(res, err, 'EXPORT_FAILED', 'Failed to export conversation');
  }
});

router.post('/:id/fork', async (req, res) => {
  try {
    const conversation = await forkConversation(req.params.id, req.body?.fromMessageIndex);
    return res.status(201).json({ ok: true, conversation });
  } catch (err) {
    return sendConversationError(res, err, 'FORK_FAILED', 'Failed to fork conversation');
  }
});

router.get('/:id/fork-tree', async (req, res) => {
  try {
    const tree = await getForkTree(req.params.id);
    return res.json({ ok: true, tree });
  } catch (err) {
    return sendConversationError(res, err, 'FORK_TREE_FAILED', 'Failed to load fork tree');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteConversation(req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    return sendConversationError(res, err, 'DELETE_FAILED', 'Failed to delete conversation');
  }
});

module.exports = router;
