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
  pinned: {
    type: Boolean,
    default: false,
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
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

// TTL: auto-expire entries when expiresAt is reached.
// Pinned entries have expiresAt: null, so MongoDB TTL skips them.
devAgentLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const DevAgentLog = mongoose.model('DevAgentLog', devAgentLogSchema);

// Self-healing migration: drop the old TTL index on createdAt if it exists.
// The old index (`{ createdAt: 1 }, { expireAfterSeconds: 604800 }`) would
// delete ALL docs after 7 days regardless of pinned status. The new TTL uses
// expiresAt which is null for pinned entries (MongoDB skips null TTL fields).
DevAgentLog.collection.indexes()
  .then(indexes => {
    const oldTtl = indexes.find(idx =>
      idx.key && idx.key.createdAt === 1 && typeof idx.expireAfterSeconds === 'number'
    );
    if (oldTtl) {
      return DevAgentLog.collection.dropIndex(oldTtl.name).then(() => {
        console.log('[DevAgentLog] Dropped old TTL index on createdAt:', oldTtl.name);
      });
    }
  })
  .catch(() => { /* collection may not exist yet — safe to ignore */ });

module.exports = DevAgentLog;
