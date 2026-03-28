'use strict';

const express = require('express');

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
    res.json({ ok: false, code: 'RULE_ERROR', error: err.message });
  }
});

router.post('/auto-actions/rules', async (req, res) => {
  const WorkspaceAutoRule = require('../../models/WorkspaceAutoRule');
  const autoActions = require('../../services/workspace-auto-actions');

  const { name, tier, conditionType, conditionValue, actionType, actionValue, createdBy } = req.body;

  if (!name || !conditionType || !conditionValue || !actionType) {
    return res.json({
      ok: false,
      code: 'MISSING_FIELD',
      error: 'name, conditionType, conditionValue, and actionType are required',
    });
  }

  const validConditionTypes = ['domain', 'label', 'age', 'keyword'];
  const validActionTypes = ['archive', 'markRead', 'label', 'trash'];
  const validTiers = ['silent', 'notify', 'ask'];

  if (!validConditionTypes.includes(conditionType)) {
    return res.json({ ok: false, code: 'INVALID_CONDITION', error: `conditionType must be one of: ${validConditionTypes.join(', ')}` });
  }
  if (!validActionTypes.includes(actionType)) {
    return res.json({ ok: false, code: 'INVALID_ACTION', error: `actionType must be one of: ${validActionTypes.join(', ')}` });
  }
  if (tier && !validTiers.includes(tier)) {
    return res.json({ ok: false, code: 'INVALID_TIER', error: `tier must be one of: ${validTiers.join(', ')}` });
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
    res.json({ ok: false, code: 'RULE_ERROR', error: err.message });
  }
});

router.patch('/auto-actions/rules/:ruleId/approve', async (req, res) => {
  try {
    const autoActions = require('../../services/workspace-auto-actions');
    const result = await autoActions.recordApproval(req.params.ruleId);
    if (!result) {
      return res.json({ ok: false, code: 'NOT_FOUND', error: 'Rule not found' });
    }
    res.json({
      ok: true,
      promoted: result.promoted,
      newTier: result.promoted ? result.newTier : undefined,
      approvalCount: result.rule.approvalCount,
      rejectionCount: result.rule.rejectionCount,
    });
  } catch (err) {
    res.json({ ok: false, code: 'RULE_ERROR', error: err.message });
  }
});

router.patch('/auto-actions/rules/:ruleId/reject', async (req, res) => {
  try {
    const autoActions = require('../../services/workspace-auto-actions');
    const result = await autoActions.recordRejection(req.params.ruleId);
    if (!result) {
      return res.json({ ok: false, code: 'NOT_FOUND', error: 'Rule not found' });
    }
    res.json({
      ok: true,
      demoted: result.demoted,
      newTier: result.demoted ? result.newTier : undefined,
      approvalCount: result.rule.approvalCount,
      rejectionCount: result.rule.rejectionCount,
    });
  } catch (err) {
    res.json({ ok: false, code: 'RULE_ERROR', error: err.message });
  }
});

router.delete('/auto-actions/rules/:ruleId', async (req, res) => {
  try {
    const WorkspaceAutoRule = require('../../models/WorkspaceAutoRule');
    const autoActions = require('../../services/workspace-auto-actions');

    const result = await WorkspaceAutoRule.findOneAndDelete({ ruleId: req.params.ruleId });
    if (!result) {
      return res.json({ ok: false, code: 'NOT_FOUND', error: 'Rule not found' });
    }

    autoActions.invalidateCache();
    res.json({ ok: true, deleted: req.params.ruleId });
  } catch (err) {
    res.json({ ok: false, code: 'RULE_ERROR', error: err.message });
  }
});

module.exports = router;
