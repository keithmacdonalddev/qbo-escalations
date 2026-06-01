'use strict';

const mongoose = require('mongoose');

// Disposable test data — short default retention. Env-tunable so an operator
// can keep results longer for a triage-quality investigation. Mirrors the
// UsageLog TTL pattern (dedicated expiresAt field + expireAfterSeconds:0 index)
// to avoid conflicting with the existing { createdAt: -1 } query index.
const DEFAULT_TTL_DAYS = 30;
const ttlDays = (() => {
  const env = Number.parseInt(process.env.IMAGE_PARSER_TEST_RESULT_TTL_DAYS, 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_TTL_DAYS;
})();

const imageParserTestResultSchema = new mongoose.Schema({
  agentId: { type: String, default: 'escalation-template-parser', index: true },
  stage: { type: String, default: 'parser' },
  source: { type: String, default: 'pipeline-test' },

  fixture: { type: mongoose.Schema.Types.Mixed, default: null },
  provider: { type: String, default: '', index: true },
  providerLabel: { type: String, default: '' },
  model: { type: String, default: '', index: true },
  modelRequested: { type: String, default: '' },
  reasoningEffort: { type: String, default: '' },
  serviceTier: { type: String, default: '' },
  runtime: { type: mongoose.Schema.Types.Mixed, default: null },
  promptId: { type: String, default: 'escalation-template-parser', index: true },
  promptVersion: { type: String, default: '', index: true },
  promptSha256: { type: String, default: '' },
  promptLength: { type: Number, default: 0 },
  providerPackageId: { type: String, default: '', index: true },
  providerHarness: { type: String, default: '' },
  providerTrace: { type: mongoose.Schema.Types.Mixed, default: null },

  elapsedMs: { type: Number, default: 0 },
  status: { type: String, enum: ['pending-review', 'pass', 'fail'], default: 'pending-review', index: true },
  reviewedAt: { type: Date, default: null },
  reviewer: { type: String, default: 'operator' },
  operatorNote: { type: String, default: '' },

  canonicalPassed: { type: Boolean, default: null },
  semanticPassed: { type: Boolean, default: null },
  parserIssues: { type: [String], default: [] },
  canonicalIssues: { type: [mongoose.Schema.Types.Mixed], default: [] },
  fieldsFound: { type: Number, default: 0 },
  exactMatchPassed: { type: Boolean, default: null },
  exactMatchCheckedAt: { type: Date, default: null },
  exactMatchBaselineSource: { type: String, default: '' },
  exactMatchSummary: { type: mongoose.Schema.Types.Mixed, default: null },

  parsedText: { type: String, default: '' },
  parseFields: { type: mongoose.Schema.Types.Mixed, default: {} },
  parseMeta: { type: mongoose.Schema.Types.Mixed, default: null },
  usage: { type: mongoose.Schema.Types.Mixed, default: null },
  apiCost: { type: mongoose.Schema.Types.Mixed, default: null },
  fallbackEligible: { type: Boolean, default: false, index: true },
  fallbackUsed: { type: Boolean, default: false },
  fallbackFrom: { type: String, default: null },
  fallbackReason: { type: String, default: '' },
  recoverySurface: { type: String, default: 'none' },

  // TTL — MongoDB auto-removes docs past expiresAt (env-tunable retention).
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
  },
}, {
  timestamps: true,
  versionKey: false,
});

imageParserTestResultSchema.index({ createdAt: -1 });
imageParserTestResultSchema.index({ provider: 1, model: 1, createdAt: -1 });
imageParserTestResultSchema.index({ 'fixture.name': 1, createdAt: -1 });
imageParserTestResultSchema.index({ promptId: 1, promptVersion: 1, createdAt: -1 });

// TTL index — separate expiresAt field avoids conflicting with createdAt index.
imageParserTestResultSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ImageParserTestResult', imageParserTestResultSchema);
