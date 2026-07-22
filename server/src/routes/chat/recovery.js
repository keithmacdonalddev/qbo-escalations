'use strict';

const express = require('express');
const { isValidObjectId } = require('../../lib/chat-route-helpers');
const {
  acceptCandidate,
  buildRecoveryOptions,
  cancelOperation,
  confirmRecovery,
  getOperation,
  listActiveOperations,
  listConversationRecoveryHistory,
} = require('../../services/evidence-recovery-service');

const router = express.Router();

function sendRecoveryError(res, error, fallbackCode, fallbackMessage) {
  const safeToReport = Number.isInteger(error?.status);
  const status = safeToReport ? error.status : 500;
  return res.status(status).json({
    ok: false,
    code: safeToReport ? (error?.code || fallbackCode) : fallbackCode,
    error: safeToReport ? (error?.message || fallbackMessage) : fallbackMessage,
  });
}

router.get('/recovery/active', async (_req, res) => {
  try {
    const operations = await listActiveOperations();
    return res.json({ ok: true, operations });
  } catch (error) {
    return sendRecoveryError(res, error, 'RECOVERY_LIST_FAILED', 'Failed to load active recovery operations.');
  }
});

router.use('/:id/evidence/recovery', (req, res, next) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_CONVERSATION_ID',
      error: 'conversationId must be a valid ObjectId',
    });
  }
  return next();
});

router.get('/:id/evidence/recovery', async (req, res) => {
  try {
    const recovery = await buildRecoveryOptions(req.params.id);
    return res.json({ ok: true, recovery });
  } catch (error) {
    return sendRecoveryError(res, error, 'RECOVERY_OPTIONS_FAILED', 'Failed to build safe recovery options.');
  }
});

router.post('/:id/evidence/recovery', async (req, res) => {
  try {
    const result = await confirmRecovery(req.params.id, req.body || {});
    return res.status(result.created ? 202 : 200).json({ ok: true, ...result });
  } catch (error) {
    return sendRecoveryError(res, error, 'RECOVERY_CONFIRM_FAILED', 'Failed to confirm recovery.');
  }
});

router.get('/:id/evidence/recovery/history', async (req, res) => {
  try {
    const operations = await listConversationRecoveryHistory(req.params.id);
    return res.json({ ok: true, operations });
  } catch (error) {
    return sendRecoveryError(res, error, 'RECOVERY_HISTORY_FAILED', 'Failed to load recovery history.');
  }
});

router.get('/:id/evidence/recovery/:operationId', async (req, res) => {
  try {
    const operation = await getOperation(req.params.id, req.params.operationId);
    return res.json({ ok: true, operation });
  } catch (error) {
    return sendRecoveryError(res, error, 'RECOVERY_STATUS_FAILED', 'Failed to load recovery status.');
  }
});

router.post('/:id/evidence/recovery/:operationId/accept', async (req, res) => {
  try {
    const result = await acceptCandidate(
      req.params.id,
      req.params.operationId,
      req.body || {}
    );
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendRecoveryError(res, error, 'RECOVERY_ACCEPT_FAILED', 'Failed to accept the recovery candidate.');
  }
});

router.post('/:id/evidence/recovery/:operationId/cancel', async (req, res) => {
  try {
    const result = await cancelOperation(req.params.id, req.params.operationId);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendRecoveryError(res, error, 'RECOVERY_CANCEL_FAILED', 'Failed to cancel recovery.');
  }
});

module.exports = router;
