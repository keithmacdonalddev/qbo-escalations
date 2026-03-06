'use strict';

const mongoose = require('mongoose');

const ACTION_TYPES = ['error-fix', 'code-review', 'idle-scan', 'user-request', 'change-detected', 'pattern-learned'];
const CATEGORIES = ['runtime-error', 'build-error', 'style', 'logic', 'performance', 'security', 'quality', 'other'];

const devAgentLogSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ACTION_TYPES,
    required: true,
    index: true,
  },
  summary: {
    type: String,
    required: true,
    maxlength: 500,
  },
  detail: {
    type: String,
    default: '',
    maxlength: 5000,
  },
  filesAffected: [{
    type: String,
    maxlength: 300,
  }],
  resolution: {
    type: String,
    default: '',
    maxlength: 2000,
  },
  category: {
    type: String,
    enum: CATEGORIES,
    default: 'other',
  },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DevConversation',
  },
  provider: { type: String },
  tokens: {
    input: Number,
    output: Number,
  },
}, {
  timestamps: true,
});

// Query patterns: recent entries, filter by type, find by affected file
devAgentLogSchema.index({ createdAt: -1 });
devAgentLogSchema.index({ type: 1, createdAt: -1 });
devAgentLogSchema.index({ filesAffected: 1 });

// TTL: auto-expire entries after 7 days
devAgentLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('DevAgentLog', devAgentLogSchema);
