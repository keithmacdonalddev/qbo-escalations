'use strict';

const mongoose = require('mongoose');

const MAX_VERSIONS = 100;

const promptVersionSchema = new mongoose.Schema({
  contextHash: {
    type: String,
    required: true,
    index: true,
  },
  assembledPrompt: {
    type: String,
    required: true,
  },
  totalChars: {
    type: Number,
    default: 0,
  },
  estimatedTokens: {
    type: Number,
    default: 0,
  },
  sections: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  provider: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

// Efficient listing: newest first
promptVersionSchema.index({ createdAt: -1 });

/**
 * Prune old versions beyond the cap.
 * Called after inserting a new version.
 */
promptVersionSchema.statics.pruneOldVersions = async function () {
  const count = await this.countDocuments();
  if (count <= MAX_VERSIONS) return 0;

  // Find the createdAt of the Nth newest document
  const cutoff = await this.find()
    .sort({ createdAt: -1 })
    .skip(MAX_VERSIONS)
    .limit(1)
    .select('createdAt')
    .lean();

  if (cutoff.length === 0) return 0;

  const result = await this.deleteMany({ createdAt: { $lte: cutoff[0].createdAt } });
  return result.deletedCount || 0;
};

promptVersionSchema.statics.MAX_VERSIONS = MAX_VERSIONS;

module.exports = mongoose.model('PromptVersion', promptVersionSchema);
