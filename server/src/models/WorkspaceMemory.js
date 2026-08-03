'use strict';

const mongoose = require('mongoose');

const MEMORY_TYPES = ['trip', 'preference', 'pattern', 'fact', 'alert'];
const MEMORY_TRUST_STATUSES = ['durable', 'pending'];
const MEMORY_PROVENANCE_KINDS = [
  'explicit-user-statement',
  'assistant-observation',
  'email-observation',
  'manual-review',
  'legacy',
];
const LEGACY_UNTRUSTED_SOURCE_PATTERN = /^(?:email:|auto-extracted from agent response|auto-detected entity)/i;

const workspaceMemorySchema = new mongoose.Schema({
  type: {
    type: String,
    enum: MEMORY_TYPES,
    required: true,
  },
  key: {
    type: String,
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  source: {
    type: String,
    default: '',
  },
  confidence: {
    type: Number,
    default: 1.0,
    min: 0,
    max: 1,
  },
  trustStatus: {
    type: String,
    enum: MEMORY_TRUST_STATUSES,
    default: 'pending',
    index: true,
  },
  provenance: {
    kind: {
      type: String,
      enum: MEMORY_PROVENANCE_KINDS,
      default: 'legacy',
    },
    sourceId: {
      type: String,
      default: '',
    },
    excerpt: {
      type: String,
      default: '',
    },
    capturedAt: {
      type: Date,
      default: null,
    },
  },
  expiresAt: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Unique key for upsert operations
workspaceMemorySchema.index({ key: 1 }, { unique: true });

// TTL index — MongoDB automatically removes docs past expiresAt
workspaceMemorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Query by type
workspaceMemorySchema.index({ type: 1, updatedAt: -1 });
workspaceMemorySchema.index({ trustStatus: 1, type: 1, updatedAt: -1 });

// Text index for search on content + key
workspaceMemorySchema.index({ content: 'text', key: 'text' });

// ---------------------------------------------------------------------------
// Pre-save: update `updatedAt`
// ---------------------------------------------------------------------------

workspaceMemorySchema.pre('save', function () {
  this.updatedAt = new Date();
});

// ---------------------------------------------------------------------------
// Static methods
// ---------------------------------------------------------------------------

workspaceMemorySchema.statics.buildDurableFilter = function (additional = {}) {
  return {
    $and: [
      additional,
      { $or: [{ trustStatus: 'durable' }, { trustStatus: { $exists: false } }] },
      { source: { $not: LEGACY_UNTRUSTED_SOURCE_PATTERN } },
      { $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] },
    ],
  };
};

/**
 * Full-text search on content + key fields.
 * Falls back to regex search if text index yields no results.
 * @param {string} query - Search query
 * @param {number} [limit=10] - Max results
 */
workspaceMemorySchema.statics.findRelevant = async function (query, limit = 10) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return this.find(this.buildDurableFilter())
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();
  }

  const trimmed = query.trim();

  // Try text search first (uses the text index)
  try {
    const textResults = await this.find(
      this.buildDurableFilter({ $text: { $search: trimmed } }),
      { score: { $meta: 'textScore' } },
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .lean();

    if (textResults.length > 0) return textResults;
  } catch {
    // Text search can fail if index isn't ready yet — fall through to regex
  }

  // Fallback: case-insensitive regex search on content and key
  const escapedQuery = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedQuery, 'i');
  return this.find(this.buildDurableFilter({ $or: [{ content: regex }, { key: regex }] }))
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();
};

/**
 * Upsert a fact by key. Creates if missing, updates if exists.
 * @param {string} key - Unique memory key
 * @param {Object} data - Fields to set (type, content, metadata, source, confidence, expiresAt)
 */
workspaceMemorySchema.statics.upsertFact = async function (key, data) {
  const update = {
    ...data,
    updatedAt: new Date(),
  };
  // Only set createdAt on insert (not update)
  const setOnInsert = { createdAt: new Date() };
  if (update.key) delete update.key; // key is the filter, not an update field

  return this.findOneAndUpdate(
    { key },
    { $set: update, $setOnInsert: setOnInsert },
    { upsert: true, returnDocument: 'after', lean: true },
  );
};

/**
 * Get all memories of a specific type (excluding expired).
 * @param {string} type - Memory type
 */
workspaceMemorySchema.statics.getByType = async function (type) {
  return this.find(this.buildDurableFilter({ type }))
    .sort({ updatedAt: -1 })
    .lean();
};

module.exports = mongoose.model('WorkspaceMemory', workspaceMemorySchema);
