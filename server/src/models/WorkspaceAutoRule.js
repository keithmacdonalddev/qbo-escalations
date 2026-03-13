'use strict';

const mongoose = require('mongoose');

const CONDITION_TYPES = ['domain', 'label', 'age', 'keyword'];
const ACTION_TYPES = ['archive', 'markRead', 'label', 'trash'];
const TIER_TYPES = ['silent', 'notify', 'ask'];

const workspaceAutoRuleSchema = new mongoose.Schema({
  ruleId: {
    type: String,
    required: true,
    unique: true,
  },
  name: {
    type: String,
    required: true,
  },
  tier: {
    type: String,
    enum: TIER_TYPES,
    default: 'ask',
  },
  conditionType: {
    type: String,
    enum: CONDITION_TYPES,
    required: true,
  },
  conditionValue: {
    type: String,
    required: true,
  },
  actionType: {
    type: String,
    enum: ACTION_TYPES,
    required: true,
  },
  actionValue: {
    type: String,
    default: '',
  },
  approvalCount: {
    type: Number,
    default: 0,
  },
  rejectionCount: {
    type: Number,
    default: 0,
  },
  active: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: String,
    enum: ['user', 'agent', 'system'],
    default: 'user',
  },
  lastTriggeredAt: {
    type: Date,
    default: null,
  },
  triggerCount: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

// ruleId already has a unique index from schema definition — no duplicate needed
// Active rules query
workspaceAutoRuleSchema.index({ active: 1, tier: 1 });

module.exports = mongoose.model('WorkspaceAutoRule', workspaceAutoRuleSchema);
