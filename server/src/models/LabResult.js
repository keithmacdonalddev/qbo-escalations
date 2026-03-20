'use strict';

const mongoose = require('mongoose');

const labResultSchema = new mongoose.Schema({
  provider:         { type: String, required: true },
  label:            { type: String, default: '' },
  family:           { type: String, default: '' },
  model:            { type: String, default: '' },
  reasoningEffort:  { type: String, default: 'high' },
  status:           { type: String, enum: ['ok', 'error'], required: true },
  outputText:       { type: String, default: '' },
  thinkingText:     { type: String, default: '' },
  error:            { type: String, default: '' },
  latencyMs:        { type: Number, default: 0 },

  usage: {
    inputTokens:  { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    cost:         { type: Number, default: 0 },
  },

  textMetrics: {
    words:          { type: Number, default: 0 },
    lines:          { type: Number, default: 0 },
    nonEmptyLines:  { type: Number, default: 0 },
    chars:          { type: Number, default: 0 },
    numericTokens:  { type: Number, default: 0 },
    charsPerSecond: { type: Number, default: null },
    totalTokens:    { type: Number, default: null },
  },

  imageSource: { type: String, default: '' },
  imageName:   { type: String, default: '' },

  createdAt: { type: Date, default: Date.now },
}, {
  timestamps: false,
  versionKey: false,
});

// Query indexes for the history endpoint
labResultSchema.index({ createdAt: -1 });
labResultSchema.index({ provider: 1, createdAt: -1 });
labResultSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('LabResult', labResultSchema);
