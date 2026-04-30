'use strict';

const mongoose = require('mongoose');

const imageParseResultSchema = new mongoose.Schema({
  // Request context
  provider:       { type: String, required: true },           // 'llm-gateway', 'lm-studio', 'anthropic', 'openai', 'kimi', 'gemini'
  model:          { type: String, default: '' },              // model ID actually used
  modelRequested: { type: String, default: '' },              // model ID user requested
  parserPromptId: { type: String, default: 'image-parser' },  // prompt/harness used for the parse

  // Image input stats
  image: {
    originalFormat:    { type: String, default: '' },         // 'image/webp', 'image/png', etc.
    finalFormat:       { type: String, default: '' },         // format after conversion
    originalSizeBytes: { type: Number, default: 0 },
    finalSizeBytes:    { type: Number, default: 0 },
    wasConverted:      { type: Boolean, default: false },
    conversionTimeMs:  { type: Number, default: 0 },
    sourceFileName:    { type: String, default: '' },
    sourceContentType: { type: String, default: '' },
    sourceSizeBytes:   { type: Number, default: 0 },
    sourceStoredAt:    { type: Date, default: null },
  },

  // Token usage
  inputTokens:  { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  totalTokens:  { type: Number, default: 0 },

  // Timing
  totalElapsedMs:    { type: Number, default: 0 },           // full request duration
  providerLatencyMs: { type: Number, default: 0 },           // just the provider call
  conversionTimeMs:  { type: Number, default: 0 },           // image format conversion time

  // Result
  status:     { type: String, enum: ['ok', 'error', 'timeout'], default: 'ok' },
  role:       { type: String, default: '' },
  parsedText: { type: String, default: '' },
  textLength: { type: Number, default: 0 },
  errorCode:  { type: String, default: '' },
  errorMsg:   { type: String, default: '' },

  // Source tracking
  source: { type: String, enum: ['panel', 'chat', 'api'], default: 'panel' },
}, {
  timestamps: true,
  versionKey: false,
});

imageParseResultSchema.index({ createdAt: -1 });
imageParseResultSchema.index({ provider: 1, createdAt: -1 });
imageParseResultSchema.index({ status: 1 });

module.exports = mongoose.model('ImageParseResult', imageParseResultSchema);
