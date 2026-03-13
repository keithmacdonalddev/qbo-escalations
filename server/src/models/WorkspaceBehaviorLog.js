'use strict';

const mongoose = require('mongoose');

/**
 * WorkspaceBehaviorLog — tracks user actions for pattern detection.
 *
 * The workspace agent logs every mutating action (archive, label, trash,
 * markRead, star, send, reply) the user triggers through the agent.
 *
 * After enough occurrences of the same actionType + targetDomain pair are
 * recorded, the pattern learner proposes a new auto-action rule.
 *
 * Logs are automatically deleted after 90 days via a TTL index so behavior
 * data doesn't accumulate indefinitely.
 */

const ACTION_TYPES = [
  'archive', 'label', 'trash', 'markRead', 'markUnread',
  'star', 'unstar', 'send', 'reply', 'draft',
  'removeLabel', 'batchModify', 'createFilter', 'deleteFilter',
];

const workspaceBehaviorLogSchema = new mongoose.Schema({
  actionType: {
    type: String,
    required: true,
    enum: ACTION_TYPES,
  },
  targetDomain: {
    type: String,
    default: '',
  },
  targetLabel: {
    type: String,
    default: '',
  },
  targetSubject: {
    type: String,
    default: '',
    maxlength: 100,
  },
  sourceCategory: {
    type: String,
    default: '',
  },
  emailAge: {
    type: Number,
    default: null,
  },
  toolName: {
    type: String,
    default: '',
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// TTL index: auto-delete after 90 days
workspaceBehaviorLogSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);

// Query index for pattern detection aggregation
workspaceBehaviorLogSchema.index({ actionType: 1, targetDomain: 1, timestamp: -1 });

// Index for finding recent actions by tool name
workspaceBehaviorLogSchema.index({ toolName: 1, timestamp: -1 });

module.exports = mongoose.model('WorkspaceBehaviorLog', workspaceBehaviorLogSchema);
