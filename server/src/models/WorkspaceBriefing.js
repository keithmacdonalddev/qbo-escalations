'use strict';

const mongoose = require('mongoose');

const workspaceBriefingSchema = new mongoose.Schema({
  date: {
    type: String,
    required: true,
    unique: true,
    match: /^\d{4}-\d{2}-\d{2}$/,
  },
  content: {
    type: String,
    required: true,
  },
  structured: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  generatedAt: {
    type: Date,
    default: Date.now,
  },
  alerts: {
    type: [String],
    default: [],
  },
  entityCount: {
    type: Number,
    default: 0,
  },
  read: {
    type: Boolean,
    default: false,
  },
  readAt: {
    type: Date,
    default: null,
  },
  // Metadata about what went into the briefing
  meta: {
    calendarEventCount: { type: Number, default: 0 },
    inboxMessageCount: { type: Number, default: 0 },
    memoryCount: { type: Number, default: 0 },
    generationTimeMs: { type: Number, default: 0 },
  },
});

// TTL index — auto-delete after 7 days
workspaceBriefingSchema.index({ generatedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

// date already has a unique index from schema definition — no duplicate needed

module.exports = mongoose.model('WorkspaceBriefing', workspaceBriefingSchema);
