'use strict';

const mongoose = require('mongoose');

// Disposable test data — short default retention. Env-tunable so an operator
// can keep results longer for a triage-quality investigation. Mirrors the
// UsageLog TTL pattern (dedicated expiresAt field + expireAfterSeconds:0 index)
// to avoid conflicting with the existing { createdAt: -1 } query index.
const DEFAULT_TTL_DAYS = 30;
const ttlDays = (() => {
  const env = Number.parseInt(process.env.TRIAGE_TEST_RESULT_TTL_DAYS, 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_TTL_DAYS;
})();

// Mirror of ImageParserTestResult but tuned for Stage 4 Triage Agent test
// runs. Captures the fixture used, the runtime that ran, the elapsed time,
// the full triage card + meta the agent produced, and the operator pass/fail
// review state so the AgentsView dashboard can aggregate pass-rate, fixture
// difficulty, and per-provider quality over time.
const triageTestResultSchema = new mongoose.Schema({
  agentId: { type: String, default: 'triage-agent', index: true },
  stage: { type: String, default: 'triage' },
  source: { type: String, default: 'triage-test' },

  fixture: { type: mongoose.Schema.Types.Mixed, default: null },
  provider: { type: String, default: '', index: true },
  providerLabel: { type: String, default: '' },
  model: { type: String, default: '', index: true },
  modelRequested: { type: String, default: '' },
  reasoningEffort: { type: String, default: '' },
  runtime: { type: mongoose.Schema.Types.Mixed, default: null },

  elapsedMs: { type: Number, default: 0 },
  status: { type: String, enum: ['pending-review', 'pass', 'fail'], default: 'pending-review', index: true },
  reviewedAt: { type: Date, default: null },
  reviewer: { type: String, default: 'operator' },
  operatorNote: { type: String, default: '' },

  // Triage output fields surfaced for at-a-glance dashboard rendering. The
  // full triageCard is also persisted below for deep review.
  severity: { type: String, default: '' },
  category: { type: String, default: '' },
  confidence: { type: String, default: '' },
  read: { type: String, default: '' },
  action: { type: String, default: '' },
  missingInfo: { type: [String], default: [] },
  categoryCheck: { type: mongoose.Schema.Types.Mixed, default: null },
  fallbackUsed: { type: Boolean, default: false },
  fallbackReason: { type: String, default: '' },
  cardSource: { type: String, default: '' },

  // Full payloads for forensic review.
  triageCard: { type: mongoose.Schema.Types.Mixed, default: null },
  triageMeta: { type: mongoose.Schema.Types.Mixed, default: null },
  parserText: { type: String, default: '' },
  parseFields: { type: mongoose.Schema.Types.Mixed, default: {} },
  providerPackageId: { type: String, default: '' },

  // TTL — MongoDB auto-removes docs past expiresAt (env-tunable retention).
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
  },
}, {
  timestamps: true,
  versionKey: false,
});

triageTestResultSchema.index({ createdAt: -1 });
triageTestResultSchema.index({ provider: 1, model: 1, createdAt: -1 });
triageTestResultSchema.index({ 'fixture.name': 1, createdAt: -1 });

// TTL index — separate expiresAt field avoids conflicting with createdAt index.
triageTestResultSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('TriageTestResult', triageTestResultSchema);
