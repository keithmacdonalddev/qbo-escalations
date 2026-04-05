'use strict';

const express = require('express');
const { createApiError, sendApiError } = require('../../lib/api-errors');

const router = express.Router();

router.get('/auto-actions', async (req, res) => {
  const autoActions = require('../../services/workspace-auto-actions');
  try {
    const allRules = await autoActions.getAllRules();
    res.json({
      ok: true,
      rules: allRules.map((r) => ({
        id: r.id,
        name: r.name,
        tier: r.tier,
        builtin: !!r.builtin,
        description: r.description,
      })),
    });
  } catch (err) {
    res.json({
      ok: true,
      degraded: true,
      warning: err.message || 'Failed to load learned rules. Showing built-in rules only.',
      rules: autoActions.BUILTIN_RULES.map((r) => ({
        id: r.id,
        name: r.name,
        tier: r.tier,
        builtin: true,
        description: r.description,
      })),
    });
  }
});

router.get('/auto-actions/rules', async (req, res) => {
  try {
    const autoActions = require('../../services/workspace-auto-actions');
    const WorkspaceAutoRule = require('../../models/WorkspaceAutoRule');

    const [builtinRules, learnedRules] = await Promise.all([
      Promise.resolve(autoActions.BUILTIN_RULES.map((r) => ({
        ruleId: r.id,
        name: r.name,
        tier: r.tier,
        builtin: true,
        description: r.description,
        active: true,
      }))),
      WorkspaceAutoRule.find().sort({ createdAt: -1 }).lean(),
    ]);

    const rules = [
      ...builtinRules,
      ...learnedRules.map((r) => ({
        ruleId: r.ruleId,
        name: r.name,
        tier: r.tier,
        builtin: false,
        conditionType: r.conditionType,
        conditionValue: r.conditionValue,
        actionType: r.actionType,
        actionValue: r.actionValue,
        approvalCount: r.approvalCount,
        rejectionCount: r.rejectionCount,
        active: r.active,
        createdBy: r.createdBy,
        triggerCount: r.triggerCount,
        lastTriggeredAt: r.lastTriggeredAt,
        createdAt: r.createdAt,
      })),
    ];

    res.json({ ok: true, rules });
  } catch (err) {
    return sendApiError(res, createApiError('RULE_ERROR', err.message || 'Failed to load auto-action rules', 500));
  }
});

router.post('/auto-actions/rules', async (req, res) => {
  const WorkspaceAutoRule = require('../../models/WorkspaceAutoRule');
  const autoActions = require('../../services/workspace-auto-actions');

  const { name, tier, conditionType, conditionValue, actionType, actionValue, createdBy } = req.body;

  if (!name || !conditionType || !conditionValue || !actionType) {
    return sendApiError(
      res,
      createApiError('MISSING_FIELD', 'name, conditionType, conditionValue, and actionType are required', 400)
    );
  }

  const validConditionTypes = ['domain', 'label', 'age', 'keyword'];
  const validActionTypes = ['archive', 'markRead', 'label', 'trash'];
  const validTiers = ['silent', 'notify', 'ask'];

  if (!validConditionTypes.includes(conditionType)) {
    return sendApiError(
      res,
      createApiError('INVALID_CONDITION', `conditionType must be one of: ${validConditionTypes.join(', ')}`, 400)
    );
  }
  if (!validActionTypes.includes(actionType)) {
    return sendApiError(
      res,
      createApiError('INVALID_ACTION', `actionType must be one of: ${validActionTypes.join(', ')}`, 400)
    );
  }
  if (tier && !validTiers.includes(tier)) {
    return sendApiError(
      res,
      createApiError('INVALID_TIER', `tier must be one of: ${validTiers.join(', ')}`, 400)
    );
  }

  try {
    const ruleId = `learned-${conditionType}-${conditionValue.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30)}-${actionType}`;

    const rule = await WorkspaceAutoRule.findOneAndUpdate(
      { ruleId },
      {
        name,
        tier: tier || 'ask',
        conditionType,
        conditionValue,
        actionType,
        actionValue: actionValue || '',
        createdBy: createdBy || 'user',
        active: true,
      },
      { upsert: true, returnDocument: 'after', lean: true, setDefaultsOnInsert: true },
    );

    autoActions.invalidateCache();
    res.json({ ok: true, rule });
  } catch (err) {
    return sendApiError(res, createApiError('RULE_ERROR', err.message || 'Failed to save auto-action rule', 500));
  }
});

router.patch('/auto-actions/rules/:ruleId/approve', async (req, res) => {
  try {
    const autoActions = require('../../services/workspace-auto-actions');
    const result = await autoActions.recordApproval(req.params.ruleId);
    if (!result) {
      return sendApiError(res, createApiError('NOT_FOUND', 'Rule not found', 404));
    }
    res.json({
      ok: true,
      promoted: result.promoted,
      newTier: result.promoted ? result.newTier : undefined,
      approvalCount: result.rule.approvalCount,
      rejectionCount: result.rule.rejectionCount,
    });
  } catch (err) {
    return sendApiError(res, createApiError('RULE_ERROR', err.message || 'Failed to approve auto-action rule', 500));
  }
});

router.patch('/auto-actions/rules/:ruleId/reject', async (req, res) => {
  try {
    const autoActions = require('../../services/workspace-auto-actions');
    const result = await autoActions.recordRejection(req.params.ruleId);
    if (!result) {
      return sendApiError(res, createApiError('NOT_FOUND', 'Rule not found', 404));
    }
    res.json({
      ok: true,
      demoted: result.demoted,
      newTier: result.demoted ? result.newTier : undefined,
      approvalCount: result.rule.approvalCount,
      rejectionCount: result.rule.rejectionCount,
    });
  } catch (err) {
    return sendApiError(res, createApiError('RULE_ERROR', err.message || 'Failed to reject auto-action rule', 500));
  }
});

router.delete('/auto-actions/rules/:ruleId', async (req, res) => {
  try {
    const WorkspaceAutoRule = require('../../models/WorkspaceAutoRule');
    const autoActions = require('../../services/workspace-auto-actions');

    const result = await WorkspaceAutoRule.findOneAndDelete({ ruleId: req.params.ruleId });
    if (!result) {
      return sendApiError(res, createApiError('NOT_FOUND', 'Rule not found', 404));
    }

    autoActions.invalidateCache();
    res.json({ ok: true, deleted: req.params.ruleId });
  } catch (err) {
    return sendApiError(res, createApiError('RULE_ERROR', err.message || 'Failed to delete auto-action rule', 500));
  }
});

module.exports = router;
