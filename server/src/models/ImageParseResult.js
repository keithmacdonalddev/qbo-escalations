'use strict';

const mongoose = require('mongoose');

// Operational history — longer default retention than the disposable test
// collections. Env-tunable. Mirrors the UsageLog TTL pattern (dedicated
// expiresAt field + expireAfterSeconds:0 index) to avoid conflicting with the
// existing { createdAt: -1 } query index.
const DEFAULT_TTL_DAYS = 90;
const ttlDays = (() => {
  const env = Number.parseInt(process.env.IMAGE_PARSE_RESULT_TTL_DAYS, 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_TTL_DAYS;
})();

const imageParseResultSchema = new mongoose.Schema({
  // Request context
  provider:       { type: String, required: true },           // 'llm-gateway', 'lm-studio', 'anthropic', 'openai', 'kimi', 'gemini'
  model:          { type: String, default: '' },              // model ID actually used
  modelRequested: { type: String, default: '' },              // model ID user requested
  parserPromptId: { type: String, default: 'escalation-template-parser' },  // prompt/harness used for the parse

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
  parseFields: { type: mongoose.Schema.Types.Mixed, default: {} },
  parseMeta: { type: mongoose.Schema.Types.Mixed, default: null },
  validationPassed: { type: Boolean, default: null },
  canonicalPassed: { type: Boolean, default: null },
  semanticPassed: { type: Boolean, default: null },
  parserIssues: { type: [String], default: [] },
  canonicalIssues: { type: [mongoose.Schema.Types.Mixed], default: [] },
  fieldsFound: { type: Number, default: 0 },
  errorCode:  { type: String, default: '' },
  errorMsg:   { type: String, default: '' },

  // Source tracking
  source: { type: String, enum: ['panel', 'chat', 'api'], default: 'panel' },
  providerTrace: { type: mongoose.Schema.Types.Mixed, default: null },

  // TTL — MongoDB auto-removes docs past expiresAt (env-tunable retention).
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
  },
}, {
  timestamps: true,
  versionKey: false,
});

imageParseResultSchema.index({ createdAt: -1 });
imageParseResultSchema.index({ provider: 1, createdAt: -1 });
imageParseResultSchema.index({ status: 1 });
imageParseResultSchema.index({ validationPassed: 1, createdAt: -1 });
imageParseResultSchema.index({ canonicalPassed: 1, createdAt: -1 });

// TTL index — separate expiresAt field avoids conflicting with createdAt index.
imageParseResultSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ImageParseResult', imageParseResultSchema);
